/**
 * Minimal raw-HTTP client for the Keenable API (no SDK). Server-only.
 *
 * Verified against the live API on 2026-11-21:
 * - Base https://api.keenable.ai. With KEENABLE_API_KEY: POST /v1/search and GET /v1/fetch,
 *   key in the X-API-Key header. Without a key: POST /v1/search/public and GET /v1/fetch/public,
 *   which REQUIRE an X-Keenable-Title header (400 missing_app_title otherwise).
 * - Keyless limits: 10 requests/second and 1,000/hour per IP (X-RateLimit-* headers).
 * - Errors are JSON: { error, message, type, code, fix?, retryable, retry_after_seconds?, request_id }.
 */
import { z } from "zod";

import { KEENABLE } from "./budget";

const BASE_URL = "https://api.keenable.ai";
/** App identifier for keyless calls. Generic on purpose. */
const APP_TITLE = "research-explorer";

export type KeenableErrorCode =
  | "timeout"
  | "aborted"
  | "network"
  | "rate_limited"
  | "http_error"
  | "invalid_response"
  | (string & {}); // Keenable's own codes, e.g. "page_not_found", "content_not_extracted"

export class KeenableError extends Error {
  readonly status?: number;
  readonly code: KeenableErrorCode;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(
    message: string,
    opts: { code: KeenableErrorCode; status?: number; retryable?: boolean; requestId?: string },
  ) {
    super(message);
    this.name = "KeenableError";
    this.code = opts.code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
    this.requestId = opts.requestId;
  }
}

const ErrorBodySchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  retryable: z.boolean().optional(),
  retry_after_seconds: z.number().optional(),
  request_id: z.string().optional(),
});

function apiKey(): string | undefined {
  const key = process.env.KEENABLE_API_KEY?.trim();
  return key ? key : undefined;
}

export const hasKeenableKey = () => apiKey() !== undefined;

// Space out request starts so parallel branches stay under the per-second limit.
let nextSlot = 0;
async function waitForSlot(signal?: AbortSignal): Promise<void> {
  const interval = hasKeenableKey() ? KEENABLE.minIntervalMsKeyed : KEENABLE.minIntervalMsKeyless;
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + interval;
  if (start > now) await sleep(start - now, signal);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterMs(res: Response, body: z.infer<typeof ErrorBodySchema> | undefined): number | undefined {
  if (body?.retry_after_seconds !== undefined) return body.retry_after_seconds * 1000;
  const header = res.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

type Endpoint = "search" | "fetch";

interface RequestSpec {
  endpoint: Endpoint;
  method: "GET" | "POST";
  query?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

async function attempt(spec: RequestSpec): Promise<{ res: Response; json: unknown }> {
  const key = apiKey();
  const path = key ? `/v1/${spec.endpoint}` : `/v1/${spec.endpoint}/public`;
  const url = new URL(path, BASE_URL);
  for (const [k, v] of Object.entries(spec.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = { accept: "application/json" };
  if (key) headers["X-API-Key"] = key;
  else headers["X-Keenable-Title"] = APP_TITLE;
  if (spec.body !== undefined) headers["content-type"] = "application/json";

  const timeout = AbortSignal.timeout(KEENABLE.timeoutMs);
  const signal = spec.signal ? AbortSignal.any([spec.signal, timeout]) : timeout;

  await waitForSlot(spec.signal);
  const res = await fetch(url, {
    method: spec.method,
    headers,
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    signal,
    redirect: "error", // never follow a redirect with the API key attached
    cache: "no-store",
  });
  const json: unknown = await res.json().catch(() => undefined);
  return { res, json };
}

/**
 * One Keenable call with a 15 s timeout and ONE retry on network errors or 429
 * (honoring Retry-After up to a few seconds). Returns the parsed JSON body on 2xx;
 * throws KeenableError otherwise.
 */
export async function keenableRequest(spec: RequestSpec): Promise<unknown> {
  for (let tryNo = 0; ; tryNo++) {
    const canRetry = tryNo === 0;
    let res: Response;
    let json: unknown;
    try {
      ({ res, json } = await attempt(spec));
    } catch (err) {
      if (spec.signal?.aborted) throw new KeenableError("Request aborted.", { code: "aborted" });
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new KeenableError(`Keenable did not respond within ${KEENABLE.timeoutMs / 1000}s.`, {
          code: "timeout",
        });
      }
      if (canRetry) {
        await sleep(500, spec.signal);
        continue;
      }
      throw new KeenableError(`Network error calling Keenable: ${(err as Error).message}`, {
        code: "network",
        retryable: true,
      });
    }

    if (res.ok) {
      if (json === undefined || typeof json !== "object" || json === null) {
        throw new KeenableError("Keenable returned a non-JSON response.", {
          code: "invalid_response",
          status: res.status,
        });
      }
      return json;
    }

    const body = ErrorBodySchema.safeParse(json);
    const err = body.success ? body.data : undefined;
    const requestId = err?.request_id ?? res.headers.get("x-request-id") ?? undefined;
    const message = err?.message ?? err?.error ?? `Keenable returned HTTP ${res.status}.`;

    if (res.status === 429) {
      const wait = retryAfterMs(res, err) ?? 1000;
      if (canRetry && err?.retryable !== false && wait <= KEENABLE.maxRetryWaitMs) {
        await sleep(Math.max(wait, 250), spec.signal);
        continue;
      }
      throw new KeenableError(`Keenable rate limit reached: ${message}`, {
        code: "rate_limited",
        status: 429,
        retryable: true,
        requestId,
      });
    }

    throw new KeenableError(message, {
      code: err?.code ?? "http_error",
      status: res.status,
      retryable: err?.retryable ?? res.status >= 500,
      requestId,
    });
  }
}
