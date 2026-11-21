/**
 * POST /api/research: researches ONE branch (also used for "investigate this gap").
 * search -> select -> retrieve -> extract -> verify quotes in code (src/lib/research/pipeline.ts).
 *
 * - Always answers within BUDGET.branchTimeLimitMs (45 s): "partial" with what finished if time runs out.
 * - A page that cannot be opened never fails the branch; it is returned with retrievalStatus "failed".
 * - 200 with status "failed" + note when the branch produced nothing usable (sources are still returned).
 * - HTTP errors only when there is nothing to keep: every search failed (502 / 429 / 504),
 *   the LLM is not configured (500), or the request is invalid (400 / 413).
 * - Dev only: a branch whose title or question contains "#fail" returns a 502, so error UI can be tested.
 * - Dev only: "#browser" makes the top page skip Keenable, so (with SOLARI_API_KEY set) it is read by
 *   the Solari cloud-browser fallback and comes back with retrievedVia "browser".
 */
import { apiError, errorResponseFor, MAX_BODY_BYTES, readJsonBody, respondWith } from "@/app/api/_lib/http";
import { API_ERROR_CODES, ResearchRequestSchema, ResearchResponseSchema } from "@/lib/contracts";
import { researchBranch, ResearchSearchError, skipKeenableForTopPage } from "@/lib/research/pipeline";

/** For hosts that enforce a function time limit (Vercel); the pipeline itself stops at 45 s. */
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = await readJsonBody(req, ResearchRequestSchema, MAX_BODY_BYTES.research);
  if (!body.ok) return body.response;
  const { branch } = body.data;

  const dev = process.env.NODE_ENV !== "production";
  const label = `${branch.title} ${branch.question}`;
  if (dev && label.includes("#fail")) {
    return apiError(502, API_ERROR_CODES.UPSTREAM_ERROR, "Dev test hook: forced failure because the branch contains #fail.");
  }
  const deps = dev && label.includes("#browser") ? skipKeenableForTopPage("Keenable skipped by the #browser dev hook") : undefined;

  try {
    const { response } = await researchBranch(body.data, { signal: req.signal, ...(deps ? { deps } : {}) });
    return respondWith(ResearchResponseSchema, response);
  } catch (err) {
    if (err instanceof ResearchSearchError) {
      switch (err.kind) {
        case "rate_limited":
          return apiError(429, API_ERROR_CODES.RATE_LIMITED, err.message);
        case "timeout":
          return apiError(504, API_ERROR_CODES.TIMEOUT, err.message);
        default:
          return apiError(502, API_ERROR_CODES.UPSTREAM_ERROR, err.message);
      }
    }
    return errorResponseFor(err, "research");
  }
}
