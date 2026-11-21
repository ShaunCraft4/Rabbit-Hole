/**
 * The extractor: one branch's retrieved pages -> candidate claims with quotes (prompt 2, fast
 * model). Server-only. This does NOT verify anything: every quote it returns is checked in code
 * (src/lib/research/pipeline.ts, buildVerifiedClaims) before it can reach the client.
 */
import { randomBytes } from "node:crypto";

import { callJSON } from "./client";
import { EXTRACT_SYSTEM, extractUser, type ExtractPromptBranch, type ExtractPromptSource } from "./prompts";
import { extractOutputSchema, type ExtractOutput } from "./schemas";

export type ExtractSource = ExtractPromptSource;

export interface ExtractInput {
  branch: ExtractPromptBranch & { id: string };
  /** Readable sources only (full_text or snippet_only), with the exact text quotes are checked against. */
  sources: ExtractSource[];
  signal?: AbortSignal;
  /** Overall deadline for the call, including its one repair retry. */
  timeoutMs?: number;
}

export async function extractClaims(input: ExtractInput): Promise<ExtractOutput> {
  if (input.sources.length === 0) return { claims: [], malformed: 0 };
  const nonce = randomBytes(4).toString("hex");
  return callJSON({
    label: `extract ${input.branch.id}`,
    tier: "fast",
    system: EXTRACT_SYSTEM,
    user: extractUser(input.branch, input.sources, nonce),
    schema: extractOutputSchema,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
}
