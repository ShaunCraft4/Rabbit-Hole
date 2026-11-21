/**
 * Shared helpers for the API routes (Engine-owned; "_lib" is a private folder, not a route).
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { LLMError } from "@/lib/ai/client";
import { API_ERROR_CODES, LIMITS, type ApiError } from "@/lib/contracts";

/** Request body caps in bytes, per route. */
export const MAX_BODY_BYTES = {
  plan: 16_000,
  research: 64_000,
  analyze: 1_000_000,
  report: 1_000_000,
} as const;

export function apiError(status: number, code: string, message: string): NextResponse<ApiError> {
  const body: ApiError = {
    error: { code, message: message.slice(0, LIMITS.errorMessageChars) },
  };
  return NextResponse.json(body, { status });
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join(".") || "(body)"}: ${issue.message}`)
    .join("; ");
}

type ParseResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse<ApiError> };

/** Reads, size-checks, JSON-parses and zod-validates a request body. */
export async function readJsonBody<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes: number,
): Promise<ParseResult<z.infer<S>>> {
  const tooLarge = () =>
    apiError(413, API_ERROR_CODES.PAYLOAD_TOO_LARGE, `Request body must be at most ${maxBytes} bytes.`);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, response: tooLarge() };

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, response: apiError(400, API_ERROR_CODES.INVALID_JSON, "Could not read the request body.") };
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) return { ok: false, response: tooLarge() };

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, response: apiError(400, API_ERROR_CODES.INVALID_JSON, "Request body must be valid JSON.") };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      response: apiError(400, API_ERROR_CODES.INVALID_REQUEST, describeIssues(parsed.error)),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Validates a response against its contract schema before sending it.
 * A response that breaks the contract (for example a Source that still carries `text`)
 * becomes a 500 instead of reaching the client.
 */
export function respondWith<S extends z.ZodType>(
  schema: S,
  data: z.input<S>,
  init?: ResponseInit,
): NextResponse {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error("[api] response failed contract validation:", describeIssues(parsed.error));
    return apiError(500, API_ERROR_CODES.INTERNAL, "The server produced an invalid response.");
  }
  return NextResponse.json(parsed.data, init);
}

/**
 * Maps an exception from a route's work to the contract error shape.
 * Details go to the server log (already redacted by the LLM client); the client gets a
 * short, safe message.
 */
export function errorResponseFor(err: unknown, label: string): NextResponse<ApiError> {
  if (err instanceof LLMError) {
    console.warn(`[api] ${label}: ${err.code}${err.status ? ` (provider HTTP ${err.status})` : ""}: ${err.message}`);
    switch (err.code) {
      case "LLM_INVALID_OUTPUT":
        return apiError(502, API_ERROR_CODES.MODEL_OUTPUT_INVALID, `The model returned invalid output for ${label}, even after a retry. Please try again.`);
      case "LLM_TIMEOUT":
      case "LLM_ABORTED":
        return apiError(504, API_ERROR_CODES.TIMEOUT, `The model took too long to answer (${label}). Please try again.`);
      case "LLM_RATE_LIMITED":
        return apiError(429, API_ERROR_CODES.RATE_LIMITED, "The model provider is rate limiting requests. Please wait a moment and try again.");
      case "LLM_NOT_CONFIGURED":
        return apiError(500, API_ERROR_CODES.INTERNAL, "The server's LLM is not configured correctly (check LLM_* in .env.local and the server log).");
      case "LLM_UPSTREAM":
        return apiError(502, API_ERROR_CODES.UPSTREAM_ERROR, `The model provider failed (${label}). Please try again.`);
    }
  }
  console.error(`[api] ${label}: unexpected error`, err);
  return apiError(500, API_ERROR_CODES.INTERNAL, "Something went wrong on the server.");
}

/** Marks stub responses so they are easy to tell apart from real ones in devtools. */
export const STUB_RESPONSE_INIT: ResponseInit = { headers: { "x-rabbit-hole-stub": "1" } };

/** Simulated latency for stub routes: 1 to 2 seconds. */
export function stubDelay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1000 + Math.random() * 1000));
}
