/**
 * POST /api/report: the Golden Key report (src/lib/ai/report.ts), written by the strong model from
 * the graph contents only: verified claims, open gaps, accepted connections. No new research.
 *
 * Code checks every id and every stated number against the request and guarantees at least one
 * next step. Errors: 400/413 invalid request, 502 MODEL_OUTPUT_INVALID when the model's output is
 * still invalid after one retry (or UPSTREAM_ERROR when the provider fails), 504 timeout,
 * 429 rate limited, 500 LLM not configured.
 */
import { errorResponseFor, MAX_BODY_BYTES, readJsonBody, respondWith } from "@/app/api/_lib/http";
import { writeReport } from "@/lib/ai/report";
import { ReportRequestSchema, ReportResponseSchema } from "@/lib/contracts";

/** For hosts that enforce a function time limit (Vercel); the model call itself stops at 75 s. */
export const maxDuration = 90;

export async function POST(req: Request) {
  const body = await readJsonBody(req, ReportRequestSchema, MAX_BODY_BYTES.report);
  if (!body.ok) return body.response;

  try {
    const { response } = await writeReport(body.data, { signal: req.signal });
    return respondWith(ReportResponseSchema, response);
  } catch (err) {
    return errorResponseFor(err, "report");
  }
}
