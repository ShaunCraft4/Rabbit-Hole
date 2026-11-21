/**
 * zod schemas for model output (what the model must return, before ids are assigned).
 * Validation messages here are shown to the model on its one repair retry, so they are
 * written as instructions.
 */
import { z } from "zod";

import { LIMITS } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// 1. PLAN
// ---------------------------------------------------------------------------

const PLAN_MIN_BRANCHES = 3;
const PLAN_MAX_BRANCHES = LIMITS.maxPlanBranches; // 5
const PLAN_QUERIES_PER_BRANCH = 2;

/** Lenient shape accepted from the model; normalizePlan tidies it before the strict check. */
const PlanRawSchema = z.object({
  goal: z.string().trim().min(1).max(LIMITS.goalChars),
  assumptions: z.array(z.string()).max(20).default([]),
  branches: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(LIMITS.branchTitleChars),
        question: z.string().trim().min(1).max(LIMITS.branchQuestionChars),
        queries: z.array(z.string()).max(10),
      }),
    )
    .max(12),
});

/** What the plan must look like after normalization. */
const PlanCheckedSchema = z.object({
  goal: z.string(),
  assumptions: z.array(z.string().min(1).max(LIMITS.assumptionChars)).max(LIMITS.maxAssumptions),
  branches: z
    .array(
      z.object({
        title: z.string(),
        question: z.string(),
        queries: z
          .array(z.string().min(3).max(LIMITS.queryChars))
          .length(
            PLAN_QUERIES_PER_BRANCH,
            `each branch needs exactly ${PLAN_QUERIES_PER_BRANCH} distinct search queries that are not the user's question and not repeated in other branches`,
          ),
      }),
    )
    .min(PLAN_MIN_BRANCHES, `give ${PLAN_MIN_BRANCHES} to ${PLAN_MAX_BRANCHES} distinct branches with different titles`)
    .max(PLAN_MAX_BRANCHES),
});

export type PlanModelOutput = z.infer<typeof PlanCheckedSchema>;

/** Lowercase, punctuation-free, single-spaced: for duplicate detection only. */
const canon = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Strips wrapping quotes and collapses whitespace in a model-written query. */
const cleanQuery = (q: string) =>
  q
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Model output schema for the plan, bound to the user's question.
 * Normalizes (dedupes branches and queries, drops queries that copy the question,
 * caps counts), then enforces 3 to 5 branches with exactly 2 queries each.
 */
export function planOutputSchema(question: string) {
  const questionCanon = canon(question);
  return PlanRawSchema.transform((raw) => {
    const seenTitles = new Set<string>();
    const seenQueries = new Set<string>();
    const branches: { title: string; question: string; queries: string[] }[] = [];
    for (const b of raw.branches) {
      const titleKey = canon(b.title);
      if (!titleKey || seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);
      const queries: string[] = [];
      for (const q of b.queries) {
        const cleaned = cleanQuery(q);
        const key = canon(cleaned);
        if (!key || key === questionCanon || seenQueries.has(key)) continue;
        seenQueries.add(key);
        queries.push(cleaned);
        if (queries.length === PLAN_QUERIES_PER_BRANCH) break;
      }
      branches.push({ title: b.title.replace(/[.:;!?]+$/, "").trim(), question: b.question, queries });
    }
    const assumptions = [...new Set(raw.assumptions.map((a) => a.trim()).filter(Boolean))]
      .map((a) => a.slice(0, LIMITS.assumptionChars))
      .slice(0, LIMITS.maxAssumptions);
    // Prefer branches that ended up with both queries; if too few remain, keep them all so the
    // strict check fails and the model is asked to fix its plan.
    const complete = branches.filter((b) => b.queries.length === PLAN_QUERIES_PER_BRANCH);
    const chosen = complete.length >= PLAN_MIN_BRANCHES ? complete : branches;
    return { goal: raw.goal, assumptions, branches: chosen.slice(0, PLAN_MAX_BRANCHES) };
  }).pipe(PlanCheckedSchema);
}

// ---------------------------------------------------------------------------
// 2. EXTRACT
// ---------------------------------------------------------------------------

export const CLAIM_TYPES = ["requirement", "deadline", "amount", "process", "contact", "other"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

/** One claim as the extractor returned it, before verification and id assignment. */
export interface ExtractedClaim {
  sourceId: string;
  excerpt: string;
  text: string;
  claimType: ClaimType;
  dateMentioned?: string;
}

export interface ExtractOutput {
  claims: ExtractedClaim[];
  /** Items dropped because they were missing a field or broke a limit (counted as rejected). */
  malformed: number;
}

/** Most items the model may return; anything beyond is ignored (the branch keeps 8 at most). */
const EXTRACT_MAX_ITEMS = 40;

const QUOTE_CHARS = `"'“”‘’«»`;
const WRAPPING_QUOTES = new RegExp(`^[${QUOTE_CHARS}]([\\s\\S]*)[${QUOTE_CHARS}]$`);

/**
 * Undoes harmless decoration the model adds around a quote: wrapping quotation marks and a
 * leading or trailing ellipsis. What remains is a contiguous piece of what the model wrote, so
 * if it then verifies, those exact words really are on the page. Ellipses INSIDE the quote are
 * left alone, so a stitched quote still fails verification.
 */
function cleanExcerpt(raw: string): string {
  let s = raw.trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    const wrapped = s.match(WRAPPING_QUOTES);
    if (wrapped) s = wrapped[1].trim();
    s = s
      .replace(/^(\.{3}|…)\s*/, "")
      .replace(/\s*(\.{3}|…)$/, "")
      .trim();
    if (s === before) break;
  }
  return s;
}

const NO_DATE = new Set(["", "none", "n/a", "na", "null", "not mentioned", "unknown", "not specified"]);

const ExtractItemSchema = z.object({
  sourceId: z.string().trim().min(1).max(LIMITS.idChars),
  excerpt: z.string().transform(cleanExcerpt).pipe(z.string().min(1).max(LIMITS.excerptChars)),
  text: z.string().trim().min(1).max(LIMITS.claimTextChars),
  claimType: z
    .string()
    .nullish()
    .transform((t): ClaimType => {
      const v = (t ?? "").trim().toLowerCase();
      return (CLAIM_TYPES as readonly string[]).includes(v) ? (v as ClaimType) : "other";
    }),
  dateMentioned: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((d) => {
      const v = d === null || d === undefined ? "" : String(d).trim();
      return NO_DATE.has(v.toLowerCase()) || v.length > LIMITS.dateChars ? undefined : v;
    }),
});

/**
 * Model output schema for extraction. Only the top-level shape can fail (which triggers the
 * one repair retry); each claim is parsed on its own, and a bad item is counted and dropped
 * instead of throwing away the whole reply.
 */
export const extractOutputSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { claims: v } : v),
  z
    .object({
      claims: z.array(z.unknown(), {
        error: 'the reply must be an object with a "claims" array (use [] when nothing is relevant)',
      }),
    })
    .transform((raw): ExtractOutput => {
      const claims: ExtractedClaim[] = [];
      let malformed = 0;
      for (const item of raw.claims.slice(0, EXTRACT_MAX_ITEMS)) {
        const parsed = ExtractItemSchema.safeParse(item);
        if (!parsed.success) {
          malformed++;
          continue;
        }
        const { dateMentioned, ...rest } = parsed.data;
        claims.push(dateMentioned ? { ...rest, dateMentioned } : rest);
      }
      return { claims, malformed };
    }),
);
