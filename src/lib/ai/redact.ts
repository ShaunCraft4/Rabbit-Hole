/**
 * Secret hygiene for logs, errors and responses. Server-only.
 * The real values of the secret env vars are masked wherever they appear, plus anything shaped like
 * an API key, a bearer token or a websocket URL (Solari session endpoints carry credentials).
 */

const SECRET_ENV_VARS = ["LLM_API_KEY", "KEENABLE_API_KEY", "SOLARI_API_KEY"] as const;

/** The current secret values (only ones long enough to be meaningful). */
function secretValues(): string[] {
  return SECRET_ENV_VARS.map((name) => process.env[name]?.trim() ?? "").filter((v) => v.length >= 8);
}

/** Masks secrets in text that may be logged, thrown or returned. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const secret of secretValues()) out = out.split(secret).join("[redacted]");
  return out
    .replace(/\b(sk|pk|rk|keen|gsk|xai|key|slr)[-_][A-Za-z0-9_\-*.]{6,}/gi, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9_\-.=]{8,}/gi, "Bearer [redacted]")
    .replace(/\bwss?:\/\/[^\s"'<>]+/gi, "ws://[redacted]");
}

/** True when the text contains the value of any secret env var (used to block a response). */
export function containsSecret(text: string): boolean {
  return secretValues().some((secret) => text.includes(secret));
}
