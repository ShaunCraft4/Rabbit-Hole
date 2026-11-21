/**
 * Rabbit Hole API contracts: zod schemas + inferred types for every route.
 *
 * FROZEN CONTRACT. Do not edit without the CONTRACT protocol (see CLAUDE.md).
 *
 * - Server routes validate every request with these schemas and validate their own
 *   response before sending it.
 * - The client parses every response with these schemas.
 * - Every error response is HTTP 4xx/5xx with body ApiError: { error: { code, message } }.
 * - Sources sent over HTTP are PublicSource: Source WITHOUT `text`. PublicSourceSchema is
 *   strict, so a response that leaks page text fails validation instead of reaching the client.
 */
import { z } from "zod";

import type {
  Branch,
  BranchStatus,
  Claim,
  Connection,
  ConnectionRelationship,
  EvidenceStatus,
  Gap,
  GapKind,
  GapStatus,
  Investigation,
  Report,
  RetrievalStatus,
  RetrievedVia,
  Source,
} from "./types";

// ---------------------------------------------------------------------------
// Limits (shared so the UI can enforce the same caps the server does)
// ---------------------------------------------------------------------------

export const LIMITS = {
  questionChars: 1000,
  goalChars: 400,
  maxAssumptions: 8,
  assumptionChars: 300,
  idChars: 80,
  branchTitleChars: 120,
  branchQuestionChars: 500,
  queryChars: 300,
  maxQueriesPerBranch: 4,
  /** Branches the planner may return. */
  maxPlanBranches: 5,
  /** Branches in an investigation (plan + user-added + gap follow-ups). */
  maxBranches: 10,
  urlChars: 2048,
  domainChars: 253,
  sourceTitleChars: 500,
  snippetChars: 2000,
  /** Server-only page text. */
  sourceTextChars: 100_000,
  dateChars: 100,
  claimTextChars: 800,
  excerptChars: 600,
  /** Per research response. */
  maxSourcesPerResearch: 30,
  maxClaimsPerResearch: 30,
  maxExcludeSourceIds: 200,
  /** Per investigation / analyze / report request. */
  maxSources: 100,
  maxClaims: 150,
  maxGaps: 20,
  maxConnections: 20,
  gapQuestionChars: 500,
  gapWhyChars: 800,
  maxGapClaimIds: 20,
  explanationChars: 800,
  noteChars: 500,
  directAnswerChars: 3000,
  reportItemChars: 800,
  maxKeyDiscoveries: 12,
  maxPlanChangingConnections: 10,
  maxUncertainties: 15,
  maxNextSteps: 12,
  maxRejectedClaims: 10_000,
  errorCodeChars: 64,
  errorMessageChars: 1000,
} as const;

export const API_ROUTES = {
  plan: "/api/plan",
  research: "/api/research",
  analyze: "/api/analyze",
  report: "/api/report",
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().trim().min(1).max(max);

/** Ids are URL- and DOM-safe: letters, digits, "_" and "-". */
export const IdSchema = z
  .string()
  .min(1)
  .max(LIMITS.idChars)
  .regex(/^[A-Za-z0-9_-]+$/, "ids may only contain letters, digits, '_' and '-'");

/** Only http(s) links are ever stored or shown (BLUEPRINT section 16). */
export const HttpUrlSchema = z.url({ protocol: /^https?$/ }).max(LIMITS.urlChars);

export const QuestionSchema = text(LIMITS.questionChars);

const AssumptionsSchema = z.array(text(LIMITS.assumptionChars)).max(LIMITS.maxAssumptions);

// ---------------------------------------------------------------------------
// Domain schemas (mirror src/lib/types.ts; checked at compile time at the bottom)
// ---------------------------------------------------------------------------

export const NodeTypeSchema = z.enum(["root", "branch", "discovery", "gap"]);

export const EvidenceStatusSchema = z.enum([
  "single_source",
  "corroborated",
  "conflicting",
  "outdated",
  "snippet_only",
]);

export const RetrievalStatusSchema = z.enum(["full_text", "snippet_only", "failed"]);

export const RetrievedViaSchema = z.enum(["keenable", "browser"]);

/** Full server-side Source, including the server-only `text`. Never send this over HTTP. */
export const SourceSchema = z.object({
  id: IdSchema,
  url: HttpUrlSchema,
  domain: text(LIMITS.domainChars),
  title: text(LIMITS.sourceTitleChars),
  retrievalStatus: RetrievalStatusSchema,
  publishedAt: z.string().max(LIMITS.dateChars).optional(),
  text: z.string().max(LIMITS.sourceTextChars).optional(),
  snippet: z.string().max(LIMITS.snippetChars).optional(),
  retrievedVia: RetrievedViaSchema.optional(),
});

/** A Source as it travels over HTTP and lives on the client: `text` is rejected. */
export const PublicSourceSchema = SourceSchema.omit({ text: true }).strict();
export type PublicSource = Omit<Source, "text">;

export const ClaimSchema = z.object({
  id: IdSchema,
  branchId: IdSchema,
  text: text(LIMITS.claimTextChars),
  excerpt: text(LIMITS.excerptChars),
  sourceId: IdSchema,
  verified: z.boolean(),
  evidenceStatus: EvidenceStatusSchema,
  dateMentioned: z.string().max(LIMITS.dateChars).optional(),
});

/** Research responses only ever contain claims whose excerpt passed verifyExcerpt. */
export const VerifiedClaimSchema = ClaimSchema.extend({ verified: z.literal(true) });

export const GapKindSchema = z.enum(["missing", "conflict", "outdated", "weak"]);
export const GapStatusSchema = z.enum(["open", "resolved", "dismissed"]);

export const GapSchema = z.object({
  id: IdSchema,
  branchId: IdSchema.optional(),
  question: text(LIMITS.gapQuestionChars),
  whyItMatters: text(LIMITS.gapWhyChars),
  kind: GapKindSchema,
  claimIds: z.array(IdSchema).max(LIMITS.maxGapClaimIds),
  suggestedQuery: z.string().trim().max(LIMITS.queryChars).optional(),
  status: GapStatusSchema,
});

export const ConnectionRelationshipSchema = z.enum([
  "supports",
  "contradicts",
  "depends_on",
  "related_to",
]);

export const ConnectionSchema = z.object({
  id: IdSchema,
  /** Claim id. */
  from: IdSchema,
  /** Claim id. */
  to: IdSchema,
  relationship: ConnectionRelationshipSchema,
  explanation: text(LIMITS.explanationChars),
  accepted: z.boolean().optional(),
});

export const BranchStatusSchema = z.enum(["idle", "running", "done", "failed"]);

/** A branch as planned / sent to research: no status. */
export const PlanBranchSchema = z.object({
  id: IdSchema,
  title: text(LIMITS.branchTitleChars),
  question: text(LIMITS.branchQuestionChars),
  queries: z.array(text(LIMITS.queryChars)).min(1).max(LIMITS.maxQueriesPerBranch),
});
export type PlanBranch = z.infer<typeof PlanBranchSchema>;

/** The minimal branch reference the analyze route needs. Extra fields are stripped. */
export const BranchRefSchema = PlanBranchSchema.pick({ id: true, title: true, question: true });
export type BranchRef = z.infer<typeof BranchRefSchema>;

export const BranchSchema = PlanBranchSchema.extend({ status: BranchStatusSchema });

export const ReportSchema = z.object({
  directAnswer: text(LIMITS.directAnswerChars),
  keyDiscoveries: z
    .array(z.object({ claimId: IdSchema, summary: text(LIMITS.reportItemChars) }))
    .max(LIMITS.maxKeyDiscoveries),
  planChangingConnections: z
    .array(z.object({ connectionId: IdSchema, text: text(LIMITS.reportItemChars) }))
    .max(LIMITS.maxPlanChangingConnections),
  uncertainties: z
    .array(z.object({ gapId: IdSchema.optional(), text: text(LIMITS.reportItemChars) }))
    .max(LIMITS.maxUncertainties),
  nextSteps: z
    .array(
      z.object({
        step: text(LIMITS.reportItemChars),
        reason: z.string().trim().max(LIMITS.reportItemChars).optional(),
      }),
    )
    .min(1)
    .max(LIMITS.maxNextSteps),
});

/**
 * A client-side or saved Investigation (store, localStorage, fixtures, public/demo-investigation.json).
 * Sources are PublicSource: an Investigation that leaves the server never carries page text.
 * Unknown top-level keys (for example the fixture's "_mock") are stripped on parse.
 */
export const InvestigationSchema = z.object({
  id: IdSchema,
  question: QuestionSchema,
  assumptions: AssumptionsSchema,
  branches: z.array(BranchSchema).max(LIMITS.maxBranches),
  sources: z.array(PublicSourceSchema).max(LIMITS.maxSources),
  claims: z.array(ClaimSchema).max(LIMITS.maxClaims),
  gaps: z.array(GapSchema).max(LIMITS.maxGaps),
  connections: z.array(ConnectionSchema).max(LIMITS.maxConnections),
  report: ReportSchema.optional(),
  rejectedClaims: z.number().int().min(0).max(LIMITS.maxRejectedClaims),
});

// ---------------------------------------------------------------------------
// POST /api/plan
// ---------------------------------------------------------------------------

export const PlanRequestSchema = z.object({
  question: QuestionSchema,
});
export type PlanRequest = z.infer<typeof PlanRequestSchema>;

export const PlanResponseSchema = z.object({
  goal: text(LIMITS.goalChars),
  assumptions: AssumptionsSchema,
  branches: z.array(PlanBranchSchema).min(1).max(LIMITS.maxPlanBranches),
});
export type PlanResponse = z.infer<typeof PlanResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/research  (one branch; also used for "investigate this gap")
// ---------------------------------------------------------------------------

export const ResearchRequestSchema = z.object({
  branch: PlanBranchSchema,
  /** Source ids the client already has; the route will not return them again. */
  excludeSourceIds: z.array(IdSchema).max(LIMITS.maxExcludeSourceIds).optional(),
  /** Set when this research run follows up a gap; echoed back in the response. */
  forGapId: IdSchema.optional(),
});
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;

export const ResearchStatusSchema = z.enum(["done", "partial", "failed"]);
export type ResearchStatus = z.infer<typeof ResearchStatusSchema>;

export const ResearchResponseSchema = z.object({
  branchId: IdSchema,
  forGapId: IdSchema.optional(),
  /** "partial" = time or budget ran out; what was finished is included. */
  status: ResearchStatusSchema,
  /** Human-readable explanation, e.g. why a run is partial or failed. */
  note: z.string().max(LIMITS.noteChars).optional(),
  /** Never contains `text`. Includes failed sources (retrievalStatus "failed"). */
  sources: z.array(PublicSourceSchema).max(LIMITS.maxSourcesPerResearch),
  /** Verified claims only. Each sourceId is in `sources` or in the request's excludeSourceIds. */
  claims: z.array(VerifiedClaimSchema).max(LIMITS.maxClaimsPerResearch),
  /** Claims dropped because their excerpt was not found in the page text. */
  rejectedClaims: z.number().int().min(0).max(LIMITS.maxRejectedClaims),
});
export type ResearchResponse = z.infer<typeof ResearchResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/analyze  (Cheshire Cat + Mad Hatter)
// ---------------------------------------------------------------------------

export const AnalyzeRequestSchema = z.object({
  question: QuestionSchema,
  branches: z.array(BranchRefSchema).min(1).max(LIMITS.maxBranches),
  claims: z.array(ClaimSchema).max(LIMITS.maxClaims),
  sources: z.array(PublicSourceSchema).max(LIMITS.maxSources),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const ClaimUpdateSchema = z.object({
  claimId: IdSchema,
  evidenceStatus: EvidenceStatusSchema,
});
export type ClaimUpdate = z.infer<typeof ClaimUpdateSchema>;

export const AnalyzeResponseSchema = z.object({
  /** New gaps, all with status "open". */
  gaps: z.array(GapSchema).max(LIMITS.maxGaps),
  /** Only claims whose evidenceStatus should change. */
  claimUpdates: z.array(ClaimUpdateSchema).max(LIMITS.maxClaims),
  /** Suggested connections, all with accepted: false. */
  connections: z.array(ConnectionSchema).max(LIMITS.maxConnections),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/report  (Golden Key)
// ---------------------------------------------------------------------------

/**
 * The report reads only what is in the graph (BLUEPRINT section 7): it uses verified claims,
 * gaps whose status is "open", and connections whose accepted === true. Send everything;
 * the route does the filtering.
 */
export const ReportRequestSchema = z.object({
  question: QuestionSchema,
  assumptions: AssumptionsSchema,
  claims: z.array(ClaimSchema).max(LIMITS.maxClaims),
  sources: z.array(PublicSourceSchema).max(LIMITS.maxSources),
  gaps: z.array(GapSchema).max(LIMITS.maxGaps),
  connections: z.array(ConnectionSchema).max(LIMITS.maxConnections),
});
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ReportResponseSchema = ReportSchema;
export type ReportResponse = Report;

// ---------------------------------------------------------------------------
// Errors (every route, HTTP 4xx/5xx)
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(LIMITS.errorCodeChars),
    message: z.string().max(LIMITS.errorMessageChars),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Codes the routes use today. `code` is a plain string, so new codes never break parsing. */
export const API_ERROR_CODES = {
  INVALID_JSON: "INVALID_JSON", // 400: body is not JSON
  INVALID_REQUEST: "INVALID_REQUEST", // 400: body failed the request schema
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE", // 413
  RATE_LIMITED: "RATE_LIMITED", // 429: retry later
  UPSTREAM_ERROR: "UPSTREAM_ERROR", // 502: search or LLM provider failed
  MODEL_OUTPUT_INVALID: "MODEL_OUTPUT_INVALID", // 502: model output failed validation after one retry
  TIMEOUT: "TIMEOUT", // 504
  INTERNAL: "INTERNAL", // 500
} as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// ---------------------------------------------------------------------------
// Referential integrity (ids that must point at something)
// ---------------------------------------------------------------------------

/**
 * Returns human-readable problems with cross-references in an Investigation
 * (duplicate ids, claims citing unknown sources, gaps/connections/report citing unknown ids).
 * An empty array means the investigation is internally consistent.
 */
export function investigationIntegrityIssues(inv: Investigation): string[] {
  const issues: string[] = [];
  const dupes = (label: string, ids: string[]) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) issues.push(`duplicate ${label} id "${id}"`);
      seen.add(id);
    }
    return seen;
  };
  dupes("branch", inv.branches.map((b) => b.id));
  const sourceIds = dupes("source", inv.sources.map((s) => s.id));
  const claimIds = dupes("claim", inv.claims.map((c) => c.id));
  const gapIds = dupes("gap", inv.gaps.map((g) => g.id));
  const connectionIds = dupes("connection", inv.connections.map((c) => c.id));

  for (const c of inv.claims) {
    if (!sourceIds.has(c.sourceId)) issues.push(`claim "${c.id}" cites unknown source "${c.sourceId}"`);
  }
  for (const g of inv.gaps) {
    for (const id of g.claimIds) {
      if (!claimIds.has(id)) issues.push(`gap "${g.id}" cites unknown claim "${id}"`);
    }
  }
  for (const c of inv.connections) {
    if (!claimIds.has(c.from)) issues.push(`connection "${c.id}" has unknown from "${c.from}"`);
    if (!claimIds.has(c.to)) issues.push(`connection "${c.id}" has unknown to "${c.to}"`);
  }
  if (inv.report) {
    for (const d of inv.report.keyDiscoveries) {
      if (!claimIds.has(d.claimId)) issues.push(`report cites unknown claim "${d.claimId}"`);
    }
    for (const p of inv.report.planChangingConnections) {
      if (!connectionIds.has(p.connectionId)) {
        issues.push(`report cites unknown connection "${p.connectionId}"`);
      }
    }
    for (const u of inv.report.uncertainties) {
      if (u.gapId && !gapIds.has(u.gapId)) issues.push(`report cites unknown gap "${u.gapId}"`);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Compile-time proof that the schemas match src/lib/types.ts.
// If a type and its schema drift apart, `npm run typecheck` fails here.
// ---------------------------------------------------------------------------

type Expect<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type SameShape<A, B> = Same<A, B> extends true ? Same<keyof A, keyof B> : false;

export type _ContractsMatchTypes = [
  Expect<Same<z.infer<typeof EvidenceStatusSchema>, EvidenceStatus>>,
  Expect<Same<z.infer<typeof RetrievalStatusSchema>, RetrievalStatus>>,
  Expect<Same<z.infer<typeof RetrievedViaSchema>, RetrievedVia>>,
  Expect<Same<z.infer<typeof GapKindSchema>, GapKind>>,
  Expect<Same<z.infer<typeof GapStatusSchema>, GapStatus>>,
  Expect<Same<z.infer<typeof ConnectionRelationshipSchema>, ConnectionRelationship>>,
  Expect<Same<z.infer<typeof BranchStatusSchema>, BranchStatus>>,
  Expect<SameShape<z.infer<typeof SourceSchema>, Source>>,
  Expect<SameShape<z.infer<typeof PublicSourceSchema>, PublicSource>>,
  Expect<SameShape<z.infer<typeof ClaimSchema>, Claim>>,
  Expect<SameShape<z.infer<typeof GapSchema>, Gap>>,
  Expect<SameShape<z.infer<typeof ConnectionSchema>, Connection>>,
  Expect<SameShape<z.infer<typeof BranchSchema>, Branch>>,
  Expect<SameShape<z.infer<typeof ReportSchema>, Report>>,
  Expect<SameShape<z.infer<typeof InvestigationSchema>, Investigation>>,
];
