/**
 * POST /api/plan: the White Rabbit. Question -> goal, assumptions and 3 to 5 research
 * branches with 2 search queries each (prompt 1, fast model).
 */
import { errorResponseFor, MAX_BODY_BYTES, readJsonBody, respondWith } from "@/app/api/_lib/http";
import { planQuestion } from "@/lib/ai/plan";
import { PlanRequestSchema, PlanResponseSchema } from "@/lib/contracts";

export async function POST(req: Request) {
  const body = await readJsonBody(req, PlanRequestSchema, MAX_BODY_BYTES.plan);
  if (!body.ok) return body.response;

  try {
    const plan = await planQuestion(body.data.question, { signal: req.signal });
    return respondWith(PlanResponseSchema, plan);
  } catch (err) {
    return errorResponseFor(err, "plan");
  }
}
