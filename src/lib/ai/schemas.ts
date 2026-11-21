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

// ---------------------------------------------------------------------------
// 3. ANALYZE
// ---------------------------------------------------------------------------

export type AnalyzeGapKind = "missing" | "conflict" | "outdated" | "weak";
export type AnalyzeRelationship = "supports" | "contradicts" | "depends_on" | "related_to";

export interface RawGap {
  kind: AnalyzeGapKind;
  question: string;
  whyItMatters: string;
  claimIds: string[];
  branchId?: string;
  suggestedQuery?: string;
}

export interface RawClaimGroup {
  status: "corroborated" | "conflicting";
  claimIds: string[];
  note?: string;
}

export interface RawOutdated {
  claimId: string;
  reason: string;
}

export interface RawConnection {
  from: string;
  to: string;
  relationship: AnalyzeRelationship;
  explanation: string;
}

/** The analysis as the model returned it, before any id or evidence check (see src/lib/ai/analyze.ts). */
export interface AnalyzeModelOutput {
  gaps: RawGap[];
  claimGroups: RawClaimGroup[];
  outdated: RawOutdated[];
  connections: RawConnection[];
  /** Items dropped because they were missing a field or had an unknown kind. */
  malformed: number;
}

/** Lowercase snake_case key for loose enum matching ("Depends on" -> "depends_on"). */
const enumKey = (v: unknown) =>
  typeof v === "string"
    ? v
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : "";

function gapKind(v: unknown): AnalyzeGapKind | undefined {
  const k = enumKey(v);
  if (k.startsWith("missing") || k === "gap" || k === "unknown") return "missing";
  if (k.startsWith("conflict") || k.startsWith("contradict")) return "conflict";
  if (k.startsWith("outdat") || k.startsWith("stale") || k === "old") return "outdated";
  if (k.startsWith("weak") || k.includes("condition") || k.includes("snippet") || k.includes("qualifier")) return "weak";
  return undefined;
}

function groupStatus(v: unknown): RawClaimGroup["status"] | undefined {
  const k = enumKey(v);
  if (k.startsWith("corroborat") || k.startsWith("same") || k.startsWith("agree") || k === "consistent") return "corroborated";
  if (k.startsWith("conflict") || k.startsWith("contradict")) return "conflicting";
  return undefined;
}

function relationship(v: unknown): AnalyzeRelationship | undefined {
  const k = enumKey(v);
  if (k.startsWith("depend") || k === "requires" || k === "prerequisite") return "depends_on";
  if (k.startsWith("support")) return "supports";
  if (k.startsWith("contradict") || k.startsWith("conflict")) return "contradicts";
  if (k.startsWith("related") || k === "relates_to") return "related_to";
  return undefined;
}

/** Trimmed, non-empty text, cut to `max` characters (model prose; cutting is harmless). */
const prose = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max))
    .pipe(z.string().min(1));

const optionalProse = (max: number) =>
  z
    .string()
    .nullish()
    .transform((s) => s?.replace(/\s+/g, " ").trim().slice(0, max) || undefined);

/** A list of ids: strings only, trimmed, de-duplicated (order kept). */
const idList = z
  .array(z.unknown())
  .nullish()
  .transform((list) => [
    ...new Set((list ?? []).flatMap((x) => (typeof x === "string" && x.trim() ? [x.trim()] : []))),
  ]);

const GapItemSchema = z.object({
  kind: z.unknown().transform(gapKind).pipe(z.enum(["missing", "conflict", "outdated", "weak"])),
  question: prose(LIMITS.gapQuestionChars),
  whyItMatters: prose(LIMITS.gapWhyChars),
  claimIds: idList,
  branchId: optionalProse(LIMITS.idChars),
  suggestedQuery: z
    .string()
    .nullish()
    .transform((q) => (q ? cleanQuery(q).slice(0, LIMITS.queryChars) || undefined : undefined)),
});

const GroupItemSchema = z.object({
  status: z.unknown().transform(groupStatus).pipe(z.enum(["corroborated", "conflicting"])),
  claimIds: idList,
  note: optionalProse(LIMITS.explanationChars),
});

const OutdatedItemSchema = z.object({
  claimId: z.string().trim().min(1),
  reason: prose(LIMITS.explanationChars),
});

const ConnectionItemSchema = z.object({
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
  relationship: z.unknown().transform(relationship).pipe(z.enum(["supports", "contradicts", "depends_on", "related_to"])),
  explanation: prose(LIMITS.explanationChars),
});

/** Most items of each kind read from the reply; the code keeps far fewer. */
const ANALYZE_MAX_ITEMS = 30;

function parseItems<T>(schema: z.ZodType<T>, list: unknown[] | null | undefined, onBad: () => void): T[] {
  const out: T[] = [];
  for (const item of (list ?? []).slice(0, ANALYZE_MAX_ITEMS)) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else onBad();
  }
  return out;
}

/**
 * Model output schema for the analysis. Only the top-level shape can fail (which triggers the
 * one repair retry). Each item is parsed on its own; a bad item is counted and dropped.
 * Ids are NOT checked here: src/lib/ai/analyze.ts checks every id against the request.
 */
export const analyzeOutputSchema = z
  .object(
    {
      gaps: z.array(z.unknown()).nullish(),
      claimGroups: z.array(z.unknown()).nullish(),
      groups: z.array(z.unknown()).nullish(),
      outdated: z.array(z.unknown()).nullish(),
      connections: z.array(z.unknown()).nullish(),
    },
    { error: 'the reply must be one JSON object with "gaps", "claimGroups", "outdated" and "connections" arrays' },
  )
  .refine(
    (raw) => [raw.gaps, raw.claimGroups, raw.groups, raw.outdated, raw.connections].some((v) => v !== undefined),
    { error: 'the reply must have top-level "gaps", "claimGroups", "outdated" and "connections" arrays (use [] when empty)' },
  )
  .transform((raw): AnalyzeModelOutput => {
    let malformed = 0;
    const bad = () => {
      malformed++;
    };
    const gaps = parseItems(GapItemSchema, raw.gaps, bad);
    const claimGroups = parseItems(GroupItemSchema, raw.claimGroups ?? raw.groups, bad);
    const outdated = parseItems(OutdatedItemSchema, raw.outdated, bad);
    const connections = parseItems(ConnectionItemSchema, raw.connections, bad);
    return { gaps, claimGroups, outdated, connections, malformed };
  });

// ---------------------------------------------------------------------------
// 4. REPORT
// ---------------------------------------------------------------------------

/** The report as the model returned it, before id and grounding checks (see src/lib/ai/report.ts). */
export interface RawReport {
  directAnswer: string;
  keyDiscoveries: { claimId: string; summary: string }[];
  planChangingConnections: { connectionId: string; text: string }[];
  uncertainties: { gapId?: string; text: string }[];
  nextSteps: { step: string; reason?: string; basedOn: string[] }[];
  malformed: number;
}

/** A bare string where an object was expected becomes {[key]: string}. */
const fromString = (key: string) => (v: unknown) => (typeof v === "string" ? { [key]: v } : v);

const DiscoveryItemSchema = z.object({
  claimId: z.string().trim().min(1),
  summary: prose(LIMITS.reportItemChars),
});

const ConnectionTextItemSchema = z.object({
  connectionId: z.string().trim().min(1),
  text: prose(LIMITS.reportItemChars),
});

const UncertaintyItemSchema = z.preprocess(
  fromString("text"),
  z.object({ gapId: optionalProse(LIMITS.idChars), text: prose(LIMITS.reportItemChars) }),
);

const NextStepItemSchema = z.preprocess(
  fromString("step"),
  z.object({
    step: prose(LIMITS.reportItemChars),
    reason: optionalProse(LIMITS.reportItemChars),
    basedOn: idList,
  }),
);

/**
 * Model output schema for the report. A missing or empty directAnswer (or a non-object reply)
 * fails and triggers the one repair retry; list items are parsed one by one and bad ones dropped.
 */
export const reportOutputSchema = z
  .object(
    {
      directAnswer: z
        .string({ error: '"directAnswer" must be a string of 3 to 5 sentences' })
        .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, LIMITS.directAnswerChars))
        .pipe(z.string().min(1, '"directAnswer" must not be empty')),
      keyDiscoveries: z.array(z.unknown()).nullish(),
      planChangingConnections: z.array(z.unknown()).nullish(),
      uncertainties: z.array(z.unknown()).nullish(),
      nextSteps: z.array(z.unknown()).nullish(),
    },
    { error: 'the reply must be one JSON object with "directAnswer", "keyDiscoveries", "planChangingConnections", "uncertainties" and "nextSteps"' },
  )
  .transform((raw): RawReport => {
    let malformed = 0;
    const bad = () => {
      malformed++;
    };
    const keyDiscoveries = parseItems(DiscoveryItemSchema, raw.keyDiscoveries, bad);
    const planChangingConnections = parseItems(ConnectionTextItemSchema, raw.planChangingConnections, bad);
    const uncertainties = parseItems(UncertaintyItemSchema, raw.uncertainties, bad);
    const nextSteps = parseItems(NextStepItemSchema, raw.nextSteps, bad);
    return { directAnswer: raw.directAnswer, keyDiscoveries, planChangingConnections, uncertainties, nextSteps, malformed };
  });
