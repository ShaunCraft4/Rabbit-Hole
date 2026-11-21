/**
 * POST /api/plan (STUB). Returns the fixture's plan for any question.
 * Replaced by the real White Rabbit planner in step A2.
 */
import { MAX_BODY_BYTES, readJsonBody, respondWith, STUB_RESPONSE_INIT, stubDelay } from "@/app/api/_lib/http";
import { mockInvestigation } from "@/fixtures";
import { PlanRequestSchema, PlanResponseSchema, type PlanResponse } from "@/lib/contracts";

export async function POST(req: Request) {
  const body = await readJsonBody(req, PlanRequestSchema, MAX_BODY_BYTES.plan);
  if (!body.ok) return body.response;

  await stubDelay();

  const plan: PlanResponse = {
    goal: "Fund a student organization event at Example University",
    assumptions: mockInvestigation.assumptions,
    branches: mockInvestigation.branches.map(({ id, title, question, queries }) => ({
      id,
      title,
      question,
      queries,
    })),
  };
  return respondWith(PlanResponseSchema, plan, STUB_RESPONSE_INIT);
}
