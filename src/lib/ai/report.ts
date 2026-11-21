/**
 * The Golden Key (prompt 4, strong model). Server-only.
 *
 * Writes the final report from the graph contents ONLY (docs/BLUEPRINT.md section 7): verified
 * claims, open gaps and accepted connections. No new research. Code then checks the draft:
 * - ids: key discoveries must cite a verified claim, plan-changing connections an accepted
 *   connection, uncertainties an open gap (when they cite one), next steps claims/gaps/connections;
 *   anything citing an unknown id is dropped;
 * - grounding: every amount, percentage, year or other multi-digit number the report states must
 *   appear in the material it was given (a discovery's summary: in THAT claim). A summary that
 *   fails falls back to the verified claim text; a direct-answer sentence that fails is removed;
 *   other items that fail are dropped;
 * - next steps are never empty: generic steps are dropped and the list is topped up from open gaps.
 */
import { randomBytes } from "node:crypto";

import type { ReportRequest, ReportResponse } from "@/lib/contracts";
import { LIMITS } from "@/lib/contracts";
import { normalizeForMatch } from "@/lib/research/verify";
import type { Claim, Connection, Gap, Report } from "@/lib/types";

import { isGenericGap } from "./analyze";
import { callJSON } from "./client";
import { academicYear, REPORT_SYSTEM, reportUser } from "./prompts";
import { reportOutputSchema, type RawReport } from "./schemas";

export const REPORT = {
  maxDiscoveries: 8,
  maxUncertainties: 6,
  minNextSteps: 3,
  maxNextSteps: 7,
  /** Overall deadline for the strong-model call, including its one repair retry. */
  timeoutMs: 75_000,
} as const;

/** What the report may use: the route's filtering of a ReportRequest. */
export interface ReportInput {
  question: string;
  assumptions: string[];
  claims: Claim[];
  gaps: Gap[];
  connections: Connection[];
  /** Source domain by source id. */
  domains: Map<string, string>;
}

export interface ReportStats {
  claims: number;
  gaps: number;
  connections: number;
  modelMs: number;
  malformed: number;
  /** Why items were dropped or replaced, with counts. */
  changes: Record<string, number>;
}

export interface ReportRun {
  response: ReportResponse;
  stats: ReportStats;
}

/** Verified claims, open gaps, accepted connections (ReportRequestSchema's contract). */
export function selectReportInput(req: ReportRequest): ReportInput {
  const claims = req.claims.filter((c) => c.verified);
  const claimIds = new Set(claims.map((c) => c.id));
  return {
    question: req.question,
    assumptions: req.assumptions,
    claims,
    gaps: req.gaps.filter((g) => g.status === "open"),
    // A connection is only usable if both of its claims are still verified claims in the graph.
    connections: req.connections.filter((c) => c.accepted === true && claimIds.has(c.from) && claimIds.has(c.to)),
    domains: new Map(req.sources.map((s) => [s.id, s.domain])),
  };
}

// ---------------------------------------------------------------------------
// Grounding: numbers
// ---------------------------------------------------------------------------

const NUMBER_RE = /(\$\s?)?\d[\d,]*(?:\.\d+)?(\s?%)?/g;

/**
 * Significant numbers in a text, normalized ("$1,500" -> "1500", "50 %" -> "50"): anything with
 * a currency sign or percent, and any number with 2+ digits. Single bare digits are ignored
 * (too common in ordinary prose to check).
 */
export function numberTokens(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(NUMBER_RE)) {
    const raw = m[0];
    const digits = raw.replace(/[^\d.]/g, "").replace(/\.+$/, "");
    if (!digits) continue;
    const intPart = digits.split(".")[0];
    if (!raw.includes("$") && !raw.includes("%") && intPart.length < 2) continue;
    const n = Number(digits);
    if (Number.isFinite(n)) out.push(String(n));
  }
  return out;
}

/** Numbers a text supports, including both spellings of year ranges ("2027-28" <-> "2027-2028"). */
function supportedNumbers(texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const text of texts) {
    for (const n of numberTokens(text)) set.add(n);
    for (const m of text.matchAll(/\b((?:19|20)\d{2})\s?[-–/]\s?(\d{2}|\d{4})\b/g)) {
      const start = m[1];
      const end = m[2].length === 2 ? `${start.slice(0, 2)}${m[2]}` : m[2];
      set.add(String(Number(end)));
      set.add(String(Number(end.slice(2))));
    }
  }
  return set;
}

const unsupported = (text: string, allowed: Set<string>) => numberTokens(text).filter((n) => !allowed.has(n));

const claimTexts = (c: Claim) => [c.text, c.excerpt, c.dateMentioned ?? ""];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9$])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const textKey = (s: string) => normalizeForMatch(s).replace(/[^\p{L}\p{N} ]/gu, "");

// ---------------------------------------------------------------------------
// Post-processing (pure)
// ---------------------------------------------------------------------------

/** Steps built from open gaps, for when the model gives too few usable ones. */
function stepsFromGaps(gaps: Gap[], used: Set<string>): Report["nextSteps"] {
  return gaps
    .filter((g) => !used.has(g.id))
    .map((g) => ({
      step: `Resolve this open question before committing: ${g.question}`.slice(0, LIMITS.reportItemChars),
      reason: g.whyItMatters.slice(0, LIMITS.reportItemChars),
    }));
}

/** Turns the model's draft into a contract-valid Report, checking every id and every number. */
export function buildReport(raw: RawReport, input: ReportInput, today: Date = new Date()): ReportRun {
  const changes: Record<string, number> = {};
  const note = (reason: string) => {
    changes[reason] = (changes[reason] ?? 0) + 1;
  };

  const claimById = new Map(input.claims.map((c) => [c.id, c]));
  const gapById = new Map(input.gaps.map((g) => [g.id, g]));
  const connectionById = new Map(input.connections.map((c) => [c.id, c]));

  const corpus = supportedNumbers([
    input.question,
    ...input.assumptions,
    ...input.claims.flatMap(claimTexts),
    ...input.gaps.flatMap((g) => [g.question, g.whyItMatters, g.suggestedQuery ?? ""]),
    ...input.connections.map((c) => c.explanation),
    `${today.toISOString().slice(0, 10)} ${academicYear(today)}`,
  ]);

  // Key discoveries: verified claims only; a summary may only state numbers from its own claim.
  const keyDiscoveries: Report["keyDiscoveries"] = [];
  for (const d of raw.keyDiscoveries) {
    const claim = claimById.get(d.claimId);
    if (!claim) {
      note("discovery_unknown_claim");
      continue;
    }
    if (keyDiscoveries.some((k) => k.claimId === claim.id)) {
      note("discovery_duplicate");
      continue;
    }
    if (keyDiscoveries.length >= REPORT.maxDiscoveries) {
      note("discovery_over_cap");
      continue;
    }
    let summary = d.summary;
    if (unsupported(summary, supportedNumbers(claimTexts(claim))).length > 0) {
      note("discovery_summary_replaced_by_claim_text");
      summary = claim.text;
    }
    keyDiscoveries.push({ claimId: claim.id, summary: summary.slice(0, LIMITS.reportItemChars) });
  }

  // Plan-changing connections: accepted connections only, grounded in their two claims.
  const planChangingConnections: Report["planChangingConnections"] = [];
  for (const p of raw.planChangingConnections) {
    const conn = connectionById.get(p.connectionId);
    if (!conn) {
      note("connection_unknown_or_not_accepted");
      continue;
    }
    if (planChangingConnections.some((x) => x.connectionId === conn.id)) {
      note("connection_duplicate");
      continue;
    }
    const allowed = supportedNumbers([
      ...claimTexts(claimById.get(conn.from)!),
      ...claimTexts(claimById.get(conn.to)!),
      conn.explanation,
    ]);
    let text = p.text;
    if (unsupported(text, allowed).length > 0) {
      if (unsupported(conn.explanation, allowed).length > 0) {
        note("connection_unsupported_number");
        continue;
      }
      note("connection_text_replaced_by_explanation");
      text = conn.explanation;
    }
    planChangingConnections.push({ connectionId: conn.id, text: text.slice(0, LIMITS.reportItemChars) });
  }

  // Uncertainties: a cited gap must be an open gap; numbers must be in the material.
  const uncertainties: Report["uncertainties"] = [];
  const seenUncertainty = new Set<string>();
  for (const u of raw.uncertainties) {
    if (u.gapId && !gapById.has(u.gapId)) {
      note("uncertainty_unknown_gap");
      continue;
    }
    const key = u.gapId ?? textKey(u.text);
    if (seenUncertainty.has(key) || seenUncertainty.has(textKey(u.text))) {
      note("uncertainty_duplicate");
      continue;
    }
    if (unsupported(u.text, corpus).length > 0) {
      note("uncertainty_unsupported_number");
      continue;
    }
    if (uncertainties.length >= REPORT.maxUncertainties) {
      note("uncertainty_over_cap");
      continue;
    }
    seenUncertainty.add(key);
    seenUncertainty.add(textKey(u.text));
    uncertainties.push({ ...(u.gapId ? { gapId: u.gapId } : {}), text: u.text });
  }

  // Next steps: ids must exist, no generic steps, numbers must be in the material.
  const nextSteps: Report["nextSteps"] = [];
  const usedGaps = new Set<string>();
  const seenSteps = new Set<string>();
  for (const s of raw.nextSteps) {
    if (s.basedOn.some((id) => !claimById.has(id) && !gapById.has(id) && !connectionById.has(id))) {
      note("step_unknown_id");
      continue;
    }
    if (isGenericGap(s.step)) {
      note("step_generic");
      continue;
    }
    if (seenSteps.has(textKey(s.step))) {
      note("step_duplicate");
      continue;
    }
    if (unsupported(`${s.step} ${s.reason ?? ""}`, corpus).length > 0) {
      note("step_unsupported_number");
      continue;
    }
    if (nextSteps.length >= REPORT.maxNextSteps) {
      note("step_over_cap");
      continue;
    }
    seenSteps.add(textKey(s.step));
    for (const id of s.basedOn) if (gapById.has(id)) usedGaps.add(id);
    nextSteps.push({ step: s.step, ...(s.reason ? { reason: s.reason } : {}) });
  }
  if (nextSteps.length < REPORT.minNextSteps) {
    for (const step of stepsFromGaps(input.gaps, usedGaps)) {
      if (nextSteps.length >= REPORT.minNextSteps) break;
      note("step_added_from_gap");
      nextSteps.push(step);
    }
  }
  if (nextSteps.length === 0) {
    note("step_fallback");
    const top = keyDiscoveries[0] ? claimById.get(keyDiscoveries[0].claimId) : input.claims[0];
    const domain = top ? input.domains.get(top.sourceId) : undefined;
    nextSteps.push({
      step: domain
        ? `Confirm the key requirements in this report directly with ${domain}, the source of the main finding.`
        : "Rephrase the question or add a door with more specific search terms, then run the research again.",
    });
  }

  // Direct answer: remove sentences that state numbers the material does not contain.
  const sentences = splitSentences(raw.directAnswer);
  const kept = sentences.filter((s) => unsupported(s, corpus).length === 0);
  if (kept.length < sentences.length) note(`answer_sentences_removed_${sentences.length - kept.length}`);
  let directAnswer = kept.join(" ");
  if (!directAnswer) {
    note("answer_fallback");
    directAnswer = keyDiscoveries.length
      ? `Based only on the verified findings: ${keyDiscoveries
          .slice(0, 2)
          .map((d) => d.summary)
          .join(" ")} Some questions remain open; see what is still uncertain below.`
      : "Rabbit Hole did not find enough verified evidence to answer this question yet.";
  }

  return {
    response: {
      directAnswer: directAnswer.slice(0, LIMITS.directAnswerChars),
      keyDiscoveries,
      planChangingConnections,
      uncertainties,
      nextSteps,
    },
    stats: {
      claims: input.claims.length,
      gaps: input.gaps.length,
      connections: input.connections.length,
      modelMs: 0,
      malformed: raw.malformed,
      changes,
    },
  };
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

/** Writes the Golden Key report. Throws LLMError (invalid output after the retry -> 502 in the route). */
export async function writeReport(req: ReportRequest, opts: { signal?: AbortSignal } = {}): Promise<ReportRun> {
  const started = Date.now();
  const input = selectReportInput(req);

  if (input.claims.length === 0) {
    // Nothing verified to report: no model call, an honest report built from the open gaps.
    const run = buildReport(
      {
        directAnswer: `Rabbit Hole has no verified findings for this question yet, so it cannot give an evidence-backed answer.${
          input.gaps.length ? " The open questions below are what still needs to be found out." : ""
        }`,
        keyDiscoveries: [],
        planChangingConnections: [],
        uncertainties: input.gaps.map((g) => ({ gapId: g.id, text: g.question })),
        nextSteps: [],
        malformed: 0,
      },
      input,
    );
    console.info("[report] no verified claims; built a report without the model");
    return run;
  }

  const raw = await callJSON({
    label: "report",
    tier: "strong",
    system: REPORT_SYSTEM,
    user: reportUser(
      input.question,
      input.assumptions,
      input.claims.map((c) => ({
        id: c.id,
        text: c.text,
        excerpt: c.excerpt,
        evidenceStatus: c.evidenceStatus,
        ...(c.dateMentioned ? { dateMentioned: c.dateMentioned } : {}),
        ...(input.domains.has(c.sourceId) ? { domain: input.domains.get(c.sourceId) } : {}),
      })),
      input.gaps.map((g) => ({ id: g.id, kind: g.kind, question: g.question, whyItMatters: g.whyItMatters, claimIds: g.claimIds })),
      input.connections.map((c) => ({ id: c.id, from: c.from, to: c.to, relationship: c.relationship, explanation: c.explanation })),
      randomBytes(4).toString("hex"),
    ),
    schema: reportOutputSchema,
    signal: opts.signal,
    timeoutMs: REPORT.timeoutMs,
  });

  const run = buildReport(raw, input);
  run.stats.modelMs = Date.now() - started;
  const r = run.response;
  const changes = Object.entries(run.stats.changes)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ");
  console.info(
    `[report] ${input.claims.length} claims, ${input.gaps.length} open gaps, ${input.connections.length} accepted connections in ${(run.stats.modelMs / 1000).toFixed(1)}s` +
      ` -> ${r.keyDiscoveries.length} discoveries, ${r.planChangingConnections.length} connections, ${r.uncertainties.length} uncertainties, ${r.nextSteps.length} steps` +
      `${run.stats.malformed ? ` | ${run.stats.malformed} malformed` : ""}${changes ? ` | code changes: ${changes}` : ""}`,
  );
  return run;
}
