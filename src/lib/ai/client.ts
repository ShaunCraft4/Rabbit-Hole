/**
 * Provider-agnostic structured LLM calls (any OpenAI-compatible endpoint). Server-only.
 *
 * Env (read at call time): LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_FAST, LLM_MODEL_STRONG.
 * - Asks for JSON via response_format json_object; if the provider rejects that (or a custom
 *   temperature), it retries without it and remembers that for the model.
 * - Strips markdown fences / prose around the JSON, parses, validates with zod, and retries ONCE
 *   on parse or validation failure with the error appended to the conversation.
 * - One overall deadline (default 40 s) covers every attempt.
 * - Never logs secrets; upstream error text is redacted before it is logged or thrown.
 */
import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming, ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { z } from "zod";

export type ModelTier = "fast" | "strong";

export type LLMErrorCode =
  | "LLM_NOT_CONFIGURED" // missing key/model, or the provider rejected the key or model
  | "LLM_TIMEOUT"
  | "LLM_ABORTED" // the caller's signal aborted
  | "LLM_RATE_LIMITED"
  | "LLM_UPSTREAM" // provider/network error
  | "LLM_INVALID_OUTPUT"; // still invalid after the one repair retry

export class LLMError extends Error {
  readonly code: LLMErrorCode;
  /** HTTP status from the provider, when there was one. */
  readonly status?: number;

  constructor(code: LLMErrorCode, message: string, status?: number) {
    super(message);
    this.name = "LLMError";
    this.code = code;
    this.status = status;
  }
}

export interface CallJSONOptions<T> {
  system: string;
  user: string;
  /** Validates (and may transform) the parsed JSON. Its error messages are shown to the model on retry. */
  schema: z.ZodType<T>;
  tier: ModelTier;
  /** Default 0.2. */
  temperature?: number;
  /** Overall deadline for every attempt together. Default 40 000 ms. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Short name for logs, e.g. "plan". */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 40_000;
const DEFAULT_TEMPERATURE = 0.2;
const JSON_INSTRUCTION =
  "Respond with exactly one JSON object and nothing else: no markdown fences, no comments, no text before or after it.";

interface LLMConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

function readConfig(tier: ModelTier): LLMConfig {
  const baseURL = process.env.LLM_BASE_URL?.trim() || "https://api.openai.com/v1";
  const fast = process.env.LLM_MODEL_FAST?.trim();
  const strong = process.env.LLM_MODEL_STRONG?.trim();
  const model = tier === "fast" ? fast || strong : strong || fast;
  let apiKey = process.env.LLM_API_KEY?.trim() ?? "";
  // Local OpenAI-compatible servers (Ollama, LM Studio, a mock) often need no key.
  if (!apiKey && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(baseURL)) apiKey = "not-needed";
  if (!apiKey) throw new LLMError("LLM_NOT_CONFIGURED", "LLM_API_KEY is not set.");
  if (!model) throw new LLMError("LLM_NOT_CONFIGURED", "LLM_MODEL_FAST / LLM_MODEL_STRONG are not set.");
  return { baseURL, apiKey, model };
}

const clients = new Map<string, OpenAI>();
function clientFor(cfg: LLMConfig): OpenAI {
  const key = `${cfg.baseURL}\n${cfg.apiKey}`;
  let client = clients.get(key);
  if (!client) {
    // maxRetries 1: the SDK backs off once on 429/5xx/connection errors, inside our deadline.
    client = new OpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey, maxRetries: 1, timeout: DEFAULT_TIMEOUT_MS });
    clients.set(key, client);
  }
  return client;
}

/** Per baseURL+model: request features the provider turned out not to support. */
const unsupported = new Map<string, { responseFormat?: boolean; temperature?: boolean }>();

/** Removes anything that looks like a credential from text that may be logged or thrown. */
function redact(text: string, secret?: string): string {
  let out = text;
  if (secret && secret.length >= 6) out = out.split(secret).join("[redacted]");
  return out
    .replace(/\b(sk|pk|rk|keen|gsk|xai|key)[-_][A-Za-z0-9_\-*.]{6,}/gi, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9_\-.=]{8,}/gi, "Bearer [redacted]")
    .slice(0, 500);
}

/** Pulls the JSON value out of a model reply: strips ``` fences and any prose around it. */
export function extractJSON(raw: string): unknown {
  let text = raw.trim();
  const fenced = text.match(/```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```/);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[{[]/);
    const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new SyntaxError("The reply did not contain a JSON object.");
  }
}

function describeZodError(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function mapProviderError(err: unknown, cfg: LLMConfig, timedOut: boolean, callerAborted: boolean): LLMError {
  if (timedOut) return new LLMError("LLM_TIMEOUT", "The model did not answer in time.");
  if (callerAborted) return new LLMError("LLM_ABORTED", "The request was cancelled.");
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new LLMError("LLM_TIMEOUT", "The model did not answer in time.");
  if (err instanceof OpenAI.APIConnectionError) {
    return new LLMError("LLM_UPSTREAM", `Could not reach the LLM provider: ${redact(err.message, cfg.apiKey)}`);
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status;
    const msg = redact(err.message, cfg.apiKey);
    if (status === 429) return new LLMError("LLM_RATE_LIMITED", `The LLM provider is rate limiting: ${msg}`, 429);
    if (status === 401 || status === 403) {
      return new LLMError("LLM_NOT_CONFIGURED", `The LLM provider rejected the API key (HTTP ${status}).`, status);
    }
    if (status === 404) {
      return new LLMError("LLM_NOT_CONFIGURED", `The LLM provider does not know model "${cfg.model}" (HTTP 404).`, 404);
    }
    return new LLMError("LLM_UPSTREAM", `LLM provider error (HTTP ${status ?? "?"}): ${msg}`, status);
  }
  return new LLMError("LLM_UPSTREAM", `LLM call failed: ${redact(String((err as Error)?.message ?? err), cfg.apiKey)}`);
}

/**
 * Calls the model for one JSON object and returns it validated by `schema`.
 * Throws LLMError.
 */
export async function callJSON<T>(opts: CallJSONOptions<T>): Promise<T> {
  const cfg = readConfig(opts.tier);
  const client = clientFor(cfg);
  const label = opts.label ?? "llm";
  const featureKey = `${cfg.baseURL}\n${cfg.model}`;
  const temperature = opts.temperature ?? DEFAULT_TEMPERATURE;

  const deadline = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: `${opts.system.trim()}\n\n${JSON_INSTRUCTION}` },
    { role: "user", content: opts.user },
  ];

  const started = Date.now();
  const MAX_REPAIRS = 1;
  for (let attemptNo = 0; ; attemptNo++) {
    const raw = await complete();
    let problem: string;
    try {
      const parsed = opts.schema.safeParse(extractJSON(raw));
      if (parsed.success) {
        console.info(`[llm] ${label} ${opts.tier}=${cfg.model} ok in ${Date.now() - started} ms (attempt ${attemptNo + 1})`);
        return parsed.data;
      }
      problem = `It did not match the required shape: ${describeZodError(parsed.error)}`;
    } catch (err) {
      problem = `It was not valid JSON: ${(err as Error).message}`;
    }

    console.warn(`[llm] ${label} attempt ${attemptNo + 1} invalid: ${redact(problem).slice(0, 300)}`);
    if (attemptNo >= MAX_REPAIRS) {
      throw new LLMError("LLM_INVALID_OUTPUT", `The model's output was still invalid after a retry. ${redact(problem)}`);
    }
    messages.push(
      { role: "assistant", content: raw.slice(0, 6000) },
      {
        role: "user",
        content: `Your previous reply was invalid. ${problem}\nReply again with ONLY the corrected JSON object.`,
      },
    );
  }

  /** One chat completion, adapting to providers that reject response_format or temperature. */
  async function complete(): Promise<string> {
    for (let adapt = 0; adapt < 3; adapt++) {
      const flags = unsupported.get(featureKey) ?? {};
      const body: ChatCompletionCreateParamsNonStreaming = {
        model: cfg.model,
        messages,
        ...(flags.temperature ? {} : { temperature }),
        ...(flags.responseFormat ? {} : { response_format: { type: "json_object" as const } }),
      };
      try {
        const completion = await client.chat.completions.create(body, { signal });
        const choice = completion.choices?.[0];
        const content = choice?.message?.content;
        // A reply cut off by the token limit fails JSON parsing and goes through the repair retry.
        if (typeof content === "string" && content.trim()) return content;
        const refusal = (choice?.message as { refusal?: string | null } | undefined)?.refusal;
        return refusal ? `REFUSAL: ${refusal}` : "";
      } catch (err) {
        if (err instanceof OpenAI.BadRequestError) {
          const msg = err.message.toLowerCase();
          if (!flags.responseFormat && /response_format|json_object|json mode|response format/.test(msg)) {
            unsupported.set(featureKey, { ...flags, responseFormat: true });
            console.warn(`[llm] ${cfg.model} rejected response_format json_object; relying on the prompt.`);
            continue;
          }
          if (!flags.temperature && /temperature/.test(msg)) {
            unsupported.set(featureKey, { ...flags, temperature: true });
            console.warn(`[llm] ${cfg.model} rejected a custom temperature; using the provider default.`);
            continue;
          }
        }
        const mapped = mapProviderError(err, cfg, deadline.aborted, !!opts.signal?.aborted);
        console.warn(`[llm] ${label} ${opts.tier}=${cfg.model} failed after ${Date.now() - started} ms: ${mapped.code} ${mapped.message}`);
        throw mapped;
      }
    }
    throw new LLMError("LLM_UPSTREAM", "The LLM provider rejected the request format.");
  }
}

/** True when the server has an LLM configured (does not validate the key). */
export function isLLMConfigured(): boolean {
  try {
    readConfig("fast");
    return true;
  } catch {
    return false;
  }
}
