/**
 * The Cheshire Cat + the Mad Hatter (prompt 3, strong model). Server-only.
 *
 * The model PROPOSES gaps, claim groups, outdated flags and connections; code DECIDES
 * (docs/BLUEPRINT.md section 6), never trusting the model blindly:
 * - anything that cites a claim id not in the request is dropped;
 * - "corroborated" needs a group whose claims come from at least 2 distinct source domains,
 *   counted here from the request's sources, not from the model;
 * - "conflicting" / "outdated" only apply to existing claims, and "outdated" needs a date,
 *   year or publish date on the claim to be judged against;
 * - connections must join claims from DIFFERENT branches and carry a real explanation;
 * - generic and near-duplicate gaps are dropped; ids are generated here; gaps start "open"
 *   and connections start accepted: false.
 */
import { createHash, randomBytes } from "node:crypto";

import { LIMITS, type AnalyzeRequest, type AnalyzeResponse, type ClaimUpdate, type PublicSource } from "@/lib/contracts";
import { focusTerms } from "@/lib/research/text";
import { fallbackLabel } from "@/lib/skilltree/labels";
import type { Claim, Connection, EvidenceStatus, Gap } from "@/lib/types";

import { callJSON } from "./client";
import { slugId } from "./plan";
import { ANALYZE_SYSTEM, analyzeUser, type AnalyzePromptClaim } from "./prompts";
import { analyzeOutputSchema, type AnalyzeModelOutput } from "./schemas";

export const ANALYSIS = {
  maxGaps: 5,
  maxConnections: 4,
  /** Distinct source domains a "same fact" group needs before its claims count as corroborated. */
  minCorroborationDomains: 2,
  /** Two gaps whose questions share this much of their content words (Jaccard) are duplicates. */
  gapSimilarity: 0.6,
  /** A connection explanation shorter than this many words is not an explanation. */
  minExplanationWords: 4,
  /** Overall deadline for the strong-model call, including its one repair retry. */
  timeoutMs: 75_000,
} as const;

export interface GroupReport {
  status: "corroborated" | "conflicting";
  claimIds: string[];
  /** Distinct source domains of the group's claims (computed in code). */
  domains: string[];
  applied: boolean;
  reason?: string;
}

export interface AnalysisStats {
  claims: number;
  modelMs: number;
  malformed: number;
  proposed: { gaps: number; groups: number; outdated: number; connections: number };
  groups: GroupReport[];
  /** Why proposed items were dropped, with counts. */
  dropped: Record<string, number>;
}

export interface AnalysisRun {
  response: AnalyzeResponse;
  stats: AnalysisStats;
}

// ---------------------------------------------------------------------------
// Post-processing (pure)
// ---------------------------------------------------------------------------

/** Words that make a gap question generic when they are all it has. */
const GENERIC_WORDS = new Set([
  "more", "further", "additional", "research", "information", "info", "details", "detail", "needed",
  "need", "check", "website", "site", "sources", "source", "verify", "confirm", "investigate",
  "investigation", "else", "anything", "other", "know", "known", "about", "specific", "general",
]);

/** True for gaps like "Is more research needed?" that name nothing concrete. */
export function isGenericGap(question: string): boolean {
  return focusTerms(question).filter((t) => !GENERIC_WORDS.has(t)).length < 2;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** A claim can only be judged outdated if it carries a date, a year or a publish date. */
function hasDateEvidence(claim: Claim, source: PublicSource | undefined): boolean {
  return Boolean(claim.dateMentioned?.trim() || source?.publishedAt?.trim() || /\b(19|20)\d{2}\b/.test(`${claim.text} ${claim.excerpt}`));
}

const shortHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 12);

/** Evidence status from retrieval alone (what /api/research assigns), before any analysis. */
function baseStatus(claim: Claim, source: PublicSource | undefined): EvidenceStatus {
  if (source) return source.retrievalStatus === "snippet_only" ? "snippet_only" : "single_source";
  return claim.evidenceStatus === "snippet_only" ? "snippet_only" : "single_source";
}

/**
 * Turns the model's proposals into a contract-valid AnalyzeResponse, checking every id and
 * every evidence label against the request.
 */
export function buildAnalysis(raw: AnalyzeModelOutput, req: AnalyzeRequest): AnalysisRun {
  const dropped: Record<string, number> = {};
  const drop = (reason: string) => {
    dropped[reason] = (dropped[reason] ?? 0) + 1;
  };

  const claims = req.claims.filter((c) => c.verified);
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const sourceById = new Map(req.sources.map((s) => [s.id, s]));
  const branchIds = new Set(req.branches.map((b) => b.id));
  const domainOfClaim = (c: Claim) => sourceById.get(c.sourceId)?.domain.trim().toLowerCase() || undefined;

  // 1. Evidence groups: conflicts apply as proposed; corroboration only with 2+ domains.
  const conflicting = new Set<string>();
  const corroborated = new Set<string>();
  const groups: GroupReport[] = [];
  for (const g of raw.claimGroups) {
    const known = g.claimIds.filter((id) => claimById.has(id));
    const domains = [...new Set(known.map((id) => domainOfClaim(claimById.get(id)!)).filter((d): d is string => Boolean(d)))];
    const report: GroupReport = { status: g.status, claimIds: g.claimIds, domains, applied: false };
    groups.push(report);
    if (known.length < g.claimIds.length) {
      drop("group_unknown_id");
      report.reason = "cites an unknown claim id";
    } else if (known.length < 2) {
      drop("group_too_small");
      report.reason = "fewer than 2 claims";
    } else if (g.status === "corroborated" && domains.length < ANALYSIS.minCorroborationDomains) {
      drop("corroboration_one_domain");
      report.reason = `only ${domains.length} source domain`;
    } else {
      report.applied = true;
      for (const id of known) (g.status === "conflicting" ? conflicting : corroborated).add(id);
    }
  }

  // 2. Outdated flags.
  const outdated = new Set<string>();
  for (const o of raw.outdated) {
    const claim = claimById.get(o.claimId);
    if (!claim) drop("outdated_unknown_id");
    else if (!hasDateEvidence(claim, sourceById.get(claim.sourceId))) drop("outdated_no_date");
    else outdated.add(claim.id);
  }

  // 3. Final status per claim: conflicting > outdated > corroborated > retrieval-based status.
  //    Computed from scratch each time, so a re-analysis can also take a label away.
  const claimUpdates: ClaimUpdate[] = [];
  for (const c of claims) {
    const next: EvidenceStatus = conflicting.has(c.id)
      ? "conflicting"
      : outdated.has(c.id)
        ? "outdated"
        : corroborated.has(c.id)
          ? "corroborated"
          : baseStatus(c, sourceById.get(c.sourceId));
    if (next !== c.evidenceStatus) claimUpdates.push({ claimId: c.id, evidenceStatus: next });
  }

  // 4. Gaps.
  const gaps: Gap[] = [];
  const gapTerms: Set<string>[] = [];
  const takenSlugs = new Set<string>();
  for (const g of raw.gaps) {
    if (g.claimIds.some((id) => !claimById.has(id))) {
      drop("gap_unknown_id");
      continue;
    }
    // A "missing" gap can stand alone; the other kinds must cite the claims they are about.
    if (g.claimIds.length < (g.kind === "conflict" ? 2 : g.kind === "missing" ? 0 : 1)) {
      drop("gap_without_claims");
      continue;
    }
    if (isGenericGap(g.question)) {
      drop("gap_generic");
      continue;
    }
    const terms = new Set(focusTerms(g.question));
    const duplicate =
      gapTerms.some((t) => jaccard(t, terms) >= ANALYSIS.gapSimilarity) ||
      gaps.some((x) => x.kind === g.kind && g.claimIds.length > 0 && sameSet(x.claimIds, g.claimIds));
    if (duplicate) {
      drop("gap_duplicate");
      continue;
    }
    if (gaps.length >= ANALYSIS.maxGaps) {
      drop("gap_over_cap");
      continue;
    }
    let branchId = g.branchId && branchIds.has(g.branchId) ? g.branchId : undefined;
    if (g.branchId && !branchId) drop("gap_unknown_branch_id_removed");
    if (!branchId) {
      // Attach the gap to a branch when every claim it cites belongs to the same one.
      const cited = new Set(g.claimIds.map((id) => claimById.get(id)!.branchId));
      const only = cited.size === 1 ? [...cited][0] : undefined;
      if (only && branchIds.has(only)) branchId = only;
    }
    gapTerms.push(terms);
    gaps.push({
      id: `gap-${slugId(g.question, takenSlugs, String(gaps.length + 1))}`,
      ...(branchId ? { branchId } : {}),
      question: g.question,
      whyItMatters: g.whyItMatters,
      kind: g.kind,
      claimIds: g.claimIds.slice(0, LIMITS.maxGapClaimIds),
      ...(g.suggestedQuery ? { suggestedQuery: g.suggestedQuery } : {}),
      status: "open",
      label: g.label ?? fallbackLabel(g.question),
    });
  }

  // 5. Connections (the Mad Hatter).
  const connections: Connection[] = [];
  const pairs = new Set<string>();
  for (const c of raw.connections) {
    const from = claimById.get(c.from);
    const to = claimById.get(c.to);
    if (!from || !to) {
      drop("connection_unknown_id");
      continue;
    }
    if (from.id === to.id || from.branchId === to.branchId) {
      drop("connection_same_branch");
      continue;
    }
    if (c.explanation.split(/\s+/).filter(Boolean).length < ANALYSIS.minExplanationWords) {
      drop("connection_no_explanation");
      continue;
    }
    const pair = [from.id, to.id].sort().join("\n");
    if (pairs.has(pair)) {
      drop("connection_duplicate");
      continue;
    }
    if (connections.length >= ANALYSIS.maxConnections) {
      drop("connection_over_cap");
      continue;
    }
    pairs.add(pair);
    connections.push({
      // Stable for the same link, so a re-analysis can keep the user's accept/dismiss choice.
      id: `conn-${shortHash(`${from.id}\n${to.id}\n${c.relationship}`)}`,
      from: from.id,
      to: to.id,
      relationship: c.relationship,
      explanation: c.explanation,
      accepted: false,
    });
  }

  return {
    response: { gaps, claimUpdates, connections },
    stats: {
      claims: claims.length,
      modelMs: 0,
      malformed: raw.malformed,
      proposed: {
        gaps: raw.gaps.length,
        groups: raw.claimGroups.length,
        outdated: raw.outdated.length,
        connections: raw.connections.length,
      },
      groups,
      dropped,
    },
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** Runs the analysis over every verified claim in the request. Throws LLMError. */
export async function analyzeInvestigation(req: AnalyzeRequest, opts: { signal?: AbortSignal } = {}): Promise<AnalysisRun> {
  const started = Date.now();
  const claims = req.claims.filter((c) => c.verified);
  if (claims.length === 0) {
    const run = buildAnalysis({ gaps: [], claimGroups: [], outdated: [], connections: [], malformed: 0 }, req);
    console.info("[analyze] no verified claims; nothing to analyze");
    return run;
  }

  const sourceById = new Map(req.sources.map((s) => [s.id, s]));
  const branchOrder = new Map(req.branches.map((b, i) => [b.id, i]));
  const ordered = claims
    .map((c, i) => ({ c, i, b: branchOrder.get(c.branchId) ?? req.branches.length }))
    .sort((x, y) => x.b - y.b || x.i - y.i)
    .map(({ c }) => c);
  const promptClaims: AnalyzePromptClaim[] = ordered.map((c) => {
    const s = sourceById.get(c.sourceId);
    return {
      id: c.id,
      branchId: c.branchId,
      text: c.text,
      excerpt: c.excerpt,
      ...(c.dateMentioned ? { dateMentioned: c.dateMentioned } : {}),
      ...(s ? { domain: s.domain, retrievalStatus: s.retrievalStatus } : {}),
      ...(!s && c.evidenceStatus === "snippet_only" ? { retrievalStatus: "snippet_only" as const } : {}),
      ...(s?.publishedAt ? { publishedAt: s.publishedAt } : {}),
    };
  });

  const raw = await callJSON({
    label: "analyze",
    tier: "strong",
    system: ANALYZE_SYSTEM,
    user: analyzeUser(req.question, req.branches, promptClaims, randomBytes(4).toString("hex")),
    schema: analyzeOutputSchema,
    signal: opts.signal,
    timeoutMs: ANALYSIS.timeoutMs,
  });

  const run = buildAnalysis(raw, req);
  run.stats.modelMs = Date.now() - started;
  logAnalysis(run);
  return run;
}

function countBy<T extends string>(items: T[]): string {
  const counts = new Map<T, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  return [...counts].map(([k, n]) => `${n} ${k}`).join(", ");
}

function logAnalysis(run: AnalysisRun): void {
  const { response: r, stats: s } = run;
  const dropped = Object.entries(s.dropped)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  console.info(
    `[analyze] ${s.claims} claims in ${(s.modelMs / 1000).toFixed(1)}s -> ${r.gaps.length} gaps` +
      `${r.gaps.length ? ` (${countBy(r.gaps.map((g) => g.kind))})` : ""}, ${r.connections.length} connections, ` +
      `${r.claimUpdates.length} updates${r.claimUpdates.length ? ` (${countBy(r.claimUpdates.map((u) => u.evidenceStatus))})` : ""}` +
      ` | proposed ${s.proposed.gaps} gaps, ${s.proposed.groups} groups, ${s.proposed.outdated} outdated, ${s.proposed.connections} connections` +
      `${s.malformed ? `, ${s.malformed} malformed` : ""}${dropped ? ` | dropped: ${dropped}` : ""}`,
  );
}
