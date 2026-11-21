/**
 * POST /api/analyze: the Cheshire Cat (gaps, conflicts, outdated flags, corroboration) and the
 * Mad Hatter (cross-branch connections) in one strong-model call (src/lib/ai/analyze.ts).
 *
 * The model only proposes; code checks every id against the request, computes corroboration from
 * real source domains, generates ids, and returns gaps with status "open" and connections with
 * accepted: false. Errors: 400/413 invalid request, 502 model output invalid after a retry or
 * provider failure, 504 timeout, 429 rate limited, 500 LLM not configured.
 */
import { errorResponseFor, MAX_BODY_BYTES, readJsonBody, respondWith } from "@/app/api/_lib/http";
import { analyzeInvestigation } from "@/lib/ai/analyze";
import { AnalyzeRequestSchema, AnalyzeResponseSchema } from "@/lib/contracts";

/** For hosts that enforce a function time limit (Vercel); the model call itself stops at 75 s. */
export const maxDuration = 90;

export async function POST(req: Request) {
  const body = await readJsonBody(req, AnalyzeRequestSchema, MAX_BODY_BYTES.analyze);
  if (!body.ok) return body.response;

  try {
    const { response } = await analyzeInvestigation(body.data, { signal: req.signal });
    return respondWith(AnalyzeResponseSchema, response);
  } catch (err) {
    return errorResponseFor(err, "analyze");
  }
}
