/**
 * The White Rabbit: question -> research plan (prompt 1, fast model). Server-only.
 */
import { LIMITS, type PlanResponse } from "@/lib/contracts";

import { callJSON } from "./client";
import { PLAN_SYSTEM, planUser } from "./prompts";
import { planOutputSchema } from "./schemas";

/** Stable, URL-safe id from a title: "Deadlines & Process!" -> "deadlines-process". */
export function slugId(title: string, taken: Set<string>, fallback: string): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // strip accents
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48)
      .replace(/-+$/g, "") || fallback;
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`.slice(0, LIMITS.idChars);
  taken.add(id);
  return id;
}

export async function planQuestion(question: string, opts: { signal?: AbortSignal } = {}): Promise<PlanResponse> {
  const plan = await callJSON({
    label: "plan",
    tier: "fast",
    system: PLAN_SYSTEM,
    user: planUser(question),
    schema: planOutputSchema(question),
    signal: opts.signal,
  });

  const taken = new Set<string>();
  return {
    goal: plan.goal,
    assumptions: plan.assumptions,
    branches: plan.branches.map((b, i) => ({
      id: slugId(b.title, taken, `branch-${i + 1}`),
      title: b.title,
      question: b.question,
      queries: b.queries,
    })),
  };
}
