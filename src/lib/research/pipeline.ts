/**
 * The research pipeline for ONE branch (docs/BLUEPRINT.md section 5), behind /api/research.
 * Server-only.
 *
 *   search (Keenable, parallel) -> select (dedupe, exclude, rank) -> retrieve (parallel + backfill)
 *   -> extract (one fast-model call) -> verify every quote in code -> claims
 *
 * The whole run fits in BUDGET.branchTimeLimitMs: each stage gets a slice (PIPELINE in budget.ts),
 * and a hard deadline answers with whatever finished ("partial") even if a stage ignores its
 * abort signal. A failed page never fails the branch: it is kept with retrievalStatus "failed".
 */
import { customAlphabet } from "nanoid";
import pLimit from "p-limit";

import { LLMError } from "@/lib/ai/client";
import { extractClaims } from "@/lib/ai/extract";
import type { ExtractedClaim, ExtractOutput } from "@/lib/ai/schemas";
import {
  LIMITS,
  type PublicSource,
  type ResearchRequest,
  type ResearchResponse,
  type ResearchStatus,
} from "@/lib/contracts";
import type { Claim, Source } from "@/lib/types";

import { BUDGET, PIPELINE, SOLARI } from "./budget";
import { dedupeHits, rankHits, sourceIdFromUrl } from "./dedupe";
import { KeenableError } from "./keenable";
import {
  needsBrowserFallback,
  retrieveSource,
  retrieveWithBrowser,
  type RetrievedSource,
  type RetrieveOptions,
} from "./retrieve";
import { searchWeb, type SearchHit, type SearchOptions } from "./search";
import { normalizeForMatch, verifyExcerpt } from "./verify";

export type VerifiedClaim = Claim & { verified: true };
type ReadableStatus = "full_text" | "snippet_only";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Every search query failed, so there is nothing to keep. The route answers with an HTTP error. */
export class ResearchSearchError extends Error {
  readonly kind: "rate_limited" | "timeout" | "upstream";

  constructor(kind: ResearchSearchError["kind"], message: string) {
    super(message);
    this.name = "ResearchSearchError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Selection (pure)
// ---------------------------------------------------------------------------

/** Trimmed, case-insensitively unique queries, capped at the contract limit. */
export function uniqueQueries(queries: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const t = q.replace(/\s+/g, " ").trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.slice(0, LIMITS.maxQueriesPerBranch);
}

/**
 * Merges the hits of every query into one ranked candidate list:
 * best-ranked copy of each page wins the dedupe, pages found by 2+ queries get a small boost,
 * pages the client already has are dropped, then official domains go first (rankHits).
 */
export function selectCandidates(
  hitLists: SearchHit[][],
  excludeIds: ReadonlySet<string>,
): { candidates: SearchHit[]; unique: number; excluded: number } {
  const foundBy = new Map<string, number>();
  for (const list of hitLists) {
    for (const id of new Set(list.map((h) => sourceIdFromUrl(h.url)))) {
      foundBy.set(id, (foundBy.get(id) ?? 0) + 1);
    }
  }

  const byRank = hitLists
    .flat()
    .filter((h) => h.url.length <= LIMITS.urlChars)
    .sort((a, b) => a.rank - b.rank); // stable: ties keep query order
  const unique = dedupeHits(byRank);

  let excluded = 0;
  const fresh: SearchHit[] = [];
  for (const hit of unique) {
    const id = sourceIdFromUrl(hit.url);
    if (excludeIds.has(id)) {
      excluded++;
      continue;
    }
    fresh.push((foundBy.get(id) ?? 1) > 1 ? { ...hit, rank: Math.max(0, hit.rank - 1) } : hit);
  }
  return { candidates: rankHits(fresh), unique: unique.length, excluded };
}

// ---------------------------------------------------------------------------
// Verification and claim building (pure)
// ---------------------------------------------------------------------------

export type RejectReason = "unknown_source" | "quote_not_found";

export interface Rejection {
  reason: RejectReason;
  sourceId: string;
  excerpt: string;
}

export interface VerifyOptions {
  branchId: string;
  /** Claim ids are `${idPrefix}-c${n}`; see claimIdPrefix. */
  idPrefix: string;
  /** The readable sources given to the extractor, by id, with the exact text quotes must appear in. */
  sources: ReadonlyMap<string, { text: string; retrievalStatus: ReadableStatus }>;
  maxPerSource?: number;
  maxTotal?: number;
}

export interface VerifyResult {
  claims: VerifiedClaim[];
  /** Claims dropped for lack of evidence: these count toward rejectedClaims. */
  rejections: Rejection[];
  /** Verified, but repeated an earlier claim's text (not counted as rejected). */
  duplicates: number;
  /** Verified, but over the per-source or per-branch cap (not counted as rejected). */
  overCap: number;
}

/**
 * Keeps only claims whose excerpt appears verbatim (after normalization) in the text of the
 * source they cite. Claims citing a source that was not supplied are rejected too.
 * Verification happens before capping, so verified claims fill the budget.
 */
export function buildVerifiedClaims(extracted: ExtractedClaim[], opts: VerifyOptions): VerifyResult {
  const maxPerSource = opts.maxPerSource ?? BUDGET.claimsPerSource;
  const maxTotal = opts.maxTotal ?? BUDGET.claimsPerBranch;
  const claims: VerifiedClaim[] = [];
  const rejections: Rejection[] = [];
  const seenText = new Set<string>();
  const perSource = new Map<string, number>();
  let duplicates = 0;
  let overCap = 0;

  for (const c of extracted) {
    const source = opts.sources.get(c.sourceId);
    if (!source || !source.text) {
      rejections.push({ reason: "unknown_source", sourceId: c.sourceId, excerpt: c.excerpt });
      continue;
    }
    if (!verifyExcerpt(c.excerpt, source.text)) {
      rejections.push({ reason: "quote_not_found", sourceId: c.sourceId, excerpt: c.excerpt });
      continue;
    }
    const key = normalizeForMatch(c.text);
    if (seenText.has(key)) {
      duplicates++;
      continue;
    }
    const count = perSource.get(c.sourceId) ?? 0;
    if (count >= maxPerSource || claims.length >= maxTotal) {
      overCap++;
      continue;
    }
    seenText.add(key);
    perSource.set(c.sourceId, count + 1);
    claims.push({
      id: `${opts.idPrefix}-c${claims.length + 1}`,
      branchId: opts.branchId,
      text: c.text,
      excerpt: c.excerpt,
      sourceId: c.sourceId,
      verified: true,
      evidenceStatus: source.retrievalStatus === "snippet_only" ? "snippet_only" : "single_source",
      ...(c.dateMentioned ? { dateMentioned: c.dateMentioned } : {}),
    });
  }
  return { claims, rejections, duplicates, overCap };
}

const runTag = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 5);

/**
 * Prefix for claim ids. A normal run gives `${branchId}-c1`, `-c2`, ...
 * A gap follow-up re-uses an existing branch id, and the client drops claims whose id it already
 * has, so follow-up runs add a random tag (`${branchId}-gk3x9q-c1`) to stay unique.
 */
export function claimIdPrefix(branchId: string, followUp: boolean): string {
  const tag = followUp ? `-g${runTag()}` : "";
  const room = LIMITS.idChars - tag.length - `-c${LIMITS.maxClaimsPerResearch}`.length;
  return `${branchId.slice(0, room)}${tag}`;
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

export interface PipelineDeps {
  search: (query: string, opts: SearchOptions) => Promise<SearchHit[]>;
  retrieve: (hit: SearchHit, opts: RetrieveOptions) => Promise<RetrievedSource>;
  /** Browser fallback for a weak retrieved source (Solari). */
  browse: (prior: RetrievedSource, opts: RetrieveOptions) => Promise<RetrievedSource>;
  extract: typeof extractClaims;
}

const DEFAULT_DEPS: PipelineDeps = {
  search: searchWeb,
  retrieve: retrieveSource,
  browse: retrieveWithBrowser,
  extract: extractClaims,
};

/**
 * Test seam: the top-ranked page skips Keenable and comes back "failed", as if Keenable could not
 * read it, so the browser fallback has to read it. Used by the dev-only "#browser" hook and tests.
 */
export function skipKeenableForTopPage(note = "Keenable skipped on purpose (test)"): Pick<PipelineDeps, "retrieve"> {
  let skipped = false;
  return {
    retrieve: (hit, opts) => {
      if (skipped) return retrieveSource(hit, opts);
      skipped = true;
      return Promise.resolve({
        source: {
          id: sourceIdFromUrl(hit.url),
          url: hit.url,
          domain: hit.domain,
          title: hit.title || hit.domain,
          retrievalStatus: "failed",
          ...(hit.snippet ? { snippet: hit.snippet } : {}),
        },
        text: "",
        note,
      });
    },
  };
}

export interface ResearchOptions {
  /** Aborts the run (for example when the client disconnects). */
  signal?: AbortSignal;
  /** Test seams; default to the real search, retrieval and extraction. */
  deps?: Partial<PipelineDeps>;
  /** Defaults to BUDGET.branchTimeLimitMs. */
  timeLimitMs?: number;
}

type Stage = "search" | "retrieve" | "browser" | "extract" | "verify";

export interface ResearchStats {
  status: ResearchStatus;
  /** Stage that was running when the deadline hit, if it did. */
  stoppedAt?: Stage;
  totalMs: number;
  searchMs: number;
  retrieveMs: number;
  browserMs: number;
  /** Browser fallbacks attempted and how many turned a weak source into full text. */
  browser: { tried: number; read: number; skippedForTime: number };
  extractMs: number;
  queries: number;
  failedQueries: number;
  hits: number;
  unique: number;
  excluded: number;
  candidates: number;
  retrieved: { full: number; snippet: number; failed: number };
  /** Claims the model returned (well-formed) and items it got wrong. */
  extracted: number;
  malformed: number;
  kept: number;
  rejected: number;
  duplicates: number;
  overCap: number;
  rejections: Rejection[];
  /** Why each non-full page was not read in full, for the server log. */
  sourceNotes: { sourceId: string; domain: string; status: Source["retrievalStatus"]; note: string }[];
}

export interface ResearchRun {
  response: ResearchResponse;
  stats: ResearchStats;
}

interface RunContext {
  req: ResearchRequest;
  deps: PipelineDeps;
  /** Fires at the hard deadline or when the caller aborts. */
  signal: AbortSignal;
  callerSignal?: AbortSignal;
  started: number;
  limitMs: number;
  remaining: () => number;
  stage: Stage;
  sources: Source[];
  claims: VerifiedClaim[];
  rejected: number;
  warnings: string[];
  stats: ResearchStats;
}

const STAGE_LABEL: Record<Stage, string> = {
  search: "searching",
  retrieve: "reading pages",
  browser: "reading pages with a cloud browser",
  extract: "extracting claims",
  verify: "checking quotes",
};

/** Researches one branch. Never throws for a failed page or a model hiccup; see ResearchSearchError. */
export async function researchBranch(req: ResearchRequest, opts: ResearchOptions = {}): Promise<ResearchRun> {
  const started = Date.now();
  const limitMs = opts.timeLimitMs ?? BUDGET.branchTimeLimitMs;
  const deadlineAt = started + limitMs - PIPELINE.replyMarginMs;

  const hard = new AbortController();
  const timer = setTimeout(() => hard.abort(), Math.max(0, deadlineAt - started));
  const signal = opts.signal ? AbortSignal.any([opts.signal, hard.signal]) : hard.signal;

  const ctx: RunContext = {
    req,
    deps: { ...DEFAULT_DEPS, ...opts.deps },
    signal,
    callerSignal: opts.signal,
    started,
    limitMs,
    remaining: () => deadlineAt - Date.now(),
    stage: "search",
    sources: [],
    claims: [],
    rejected: 0,
    warnings: [],
    stats: emptyStats(),
  };

  const work = runStages(ctx);
  work.catch(() => {}); // the deadline may win the race below; never leave a rejection unhandled
  const deadline = new Promise<"deadline">((resolve) => {
    if (signal.aborted) resolve("deadline");
    signal.addEventListener("abort", () => resolve("deadline"), { once: true });
  });

  try {
    const outcome = await Promise.race([work, deadline]);
    const run = outcome === "deadline" ? finishAtDeadline(ctx) : outcome;
    logRun(ctx, run);
    return run;
  } finally {
    clearTimeout(timer);
  }
}

async function runStages(ctx: RunContext): Promise<ResearchRun> {
  const { req, deps, stats } = ctx;
  const { branch } = req;

  // 1. Search every query (concurrency-limited); keep whatever succeeds.
  ctx.stage = "search";
  let t = Date.now();
  const queries = uniqueQueries(branch.queries);
  const searchSignal = AbortSignal.any([ctx.signal, AbortSignal.timeout(clampMs(PIPELINE.searchMaxMs, ctx.remaining()))]);
  const limit = pLimit(BUDGET.searchConcurrency);
  const settled = await Promise.allSettled(
    queries.map((q) => limit(() => deps.search(q, { maxResults: BUDGET.resultsPerQuery, signal: searchSignal }))),
  );
  stats.searchMs = Date.now() - t;
  const lists = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  const errors = settled.flatMap((s) => (s.status === "rejected" ? [s.reason as unknown] : []));
  stats.queries = queries.length;
  stats.failedQueries = errors.length;
  stats.hits = lists.reduce((n, list) => n + list.length, 0);

  if (lists.length === 0) {
    if (ctx.signal.aborted) return finishAtDeadline(ctx);
    throw searchFailure(branch.id, errors, searchSignal.aborted);
  }
  if (errors.length > 0) ctx.warnings.push(`${errors.length} of ${queries.length} searches failed.`);

  // 2. Select: merge, dedupe, drop known sources, rank.
  const { candidates, unique, excluded } = selectCandidates(lists, new Set(req.excludeSourceIds ?? []));
  stats.unique = unique;
  stats.excluded = excluded;
  stats.candidates = candidates.length;
  if (candidates.length === 0) {
    return finish(
      ctx,
      "failed",
      excluded > 0
        ? "Every page these searches found is already in the investigation. Try different queries to find new sources."
        : "The searches found no pages. Try rewording this branch's queries.",
    );
  }

  // 3. Retrieve the top pages in parallel; replace failures with the next candidates if time allows.
  ctx.stage = "retrieve";
  t = Date.now();
  const focus = [branch.question, ...queries].join(" ");
  const retrieveEnds = Date.now() + clampMs(PIPELINE.retrieveMaxMs, ctx.remaining() - PIPELINE.extractReserveMs, 1_500);
  const retrieveSignal = AbortSignal.any([ctx.signal, AbortSignal.timeout(clampMs(retrieveEnds - Date.now()))]);
  const retrieved: RetrievedSource[] = [];

  const retrieveAll = async (hits: SearchHit[]) => {
    const results = await Promise.all(
      hits.map((hit) =>
        deps
          .retrieve(hit, { focus, maxChars: BUDGET.sourceTextChars, signal: retrieveSignal })
          .catch((err: unknown) => failedRetrieval(hit, err)),
      ),
    );
    retrieved.push(...results);
    ctx.sources = retrieved.map((r) => r.source);
    return results;
  };

  const first = candidates.slice(0, BUDGET.sourcesPerBranch);
  const firstResults = await retrieveAll(first);
  const failedCount = firstResults.filter((r) => r.source.retrievalStatus === "failed").length;
  const backfill = candidates.slice(first.length, first.length + Math.min(failedCount, PIPELINE.maxBackfill));
  if (backfill.length > 0 && !retrieveSignal.aborted && retrieveEnds - Date.now() >= PIPELINE.minBackfillMs) {
    await retrieveAll(backfill);
  }
  stats.retrieveMs = Date.now() - t;

  // 3b. Browser fallback (Solari): re-read at most SOLARI.maxPerBranch weak pages (failed, snippet-only
  //     or very short) with a cloud browser, best-ranked first. Skipped silently without SOLARI_API_KEY.
  const weak = retrieved
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => needsBrowserFallback(r))
    .slice(0, SOLARI.maxPerBranch);
  if (weak.length > 0) {
    const budget = Math.min(SOLARI.overallTimeoutMs, ctx.remaining() - PIPELINE.extractReserveMs);
    if (budget < SOLARI.minStageMs) {
      stats.browser.skippedForTime = weak.length;
    } else {
      ctx.stage = "browser";
      t = Date.now();
      const browserSignal = AbortSignal.any([ctx.signal, AbortSignal.timeout(budget)]);
      const reread = await Promise.all(
        weak.map(({ r }) =>
          deps.browse(r, { focus, maxChars: BUDGET.sourceTextChars, signal: browserSignal }).catch(() => r),
        ),
      );
      reread.forEach((r, k) => {
        retrieved[weak[k].i] = r;
      });
      ctx.sources = retrieved.map((r) => r.source);
      stats.browserMs = Date.now() - t;
      stats.browser.tried = weak.length;
      stats.browser.read = reread.filter((r) => r.source.retrievedVia === "browser").length;
    }
  }

  const texts = new Map<string, { text: string; retrievalStatus: ReadableStatus }>();
  for (const r of retrieved) {
    const status = r.source.retrievalStatus;
    if (status !== "failed" && r.text) texts.set(r.source.id, { text: r.text, retrievalStatus: status });
    if (status !== "full_text" || r.source.retrievedVia === "browser") {
      stats.sourceNotes.push({ sourceId: r.source.id, domain: r.source.domain, status, note: r.note ?? "" });
    }
  }
  stats.retrieved = countRetrieval(ctx.sources);

  const readable = ctx.sources.filter((s) => texts.has(s.id));
  if (readable.length === 0) {
    return finish(
      ctx,
      "failed",
      `None of the ${ctx.sources.length} pages found could be opened. Retry this branch or try different queries.`,
    );
  }

  // 4. One extraction call over the readable pages.
  ctx.stage = "extract";
  const extractBudget = ctx.remaining();
  if (extractBudget < PIPELINE.minExtractMs) return finishAtDeadline(ctx);
  t = Date.now();
  let output: ExtractOutput;
  try {
    output = await deps.extract({
      branch: { id: branch.id, title: branch.title, question: branch.question, queries },
      sources: readable.map((s) => {
        const entry = texts.get(s.id)!;
        return { id: s.id, title: s.title, domain: s.domain, retrievalStatus: entry.retrievalStatus, text: entry.text };
      }),
      signal: ctx.signal,
      timeoutMs: extractBudget,
    });
  } catch (err) {
    stats.extractMs = Date.now() - t;
    if (!(err instanceof LLMError) || err.code === "LLM_NOT_CONFIGURED") throw err;
    if (err.code === "LLM_TIMEOUT" || err.code === "LLM_ABORTED" || ctx.signal.aborted) return finishAtDeadline(ctx);
    console.warn(`[research] ${branch.id} extraction failed: ${err.code}: ${err.message}`);
    return finish(ctx, "failed", llmFailureNote(err));
  }
  stats.extractMs = Date.now() - t;
  stats.extracted = output.claims.length;
  stats.malformed = output.malformed;

  // 5. Verify every quote in code, then build the claims.
  ctx.stage = "verify";
  const verified = buildVerifiedClaims(output.claims, {
    branchId: branch.id,
    idPrefix: claimIdPrefix(branch.id, Boolean(req.forGapId)),
    sources: texts,
  });
  ctx.claims = verified.claims;
  ctx.rejected = verified.rejections.length + output.malformed;
  stats.rejections = verified.rejections;
  stats.duplicates = verified.duplicates;
  stats.overCap = verified.overCap;

  if (ctx.claims.length === 0) {
    return finish(
      ctx,
      "failed",
      ctx.rejected > 0
        ? `No claim survived quote verification (${ctx.rejected} rejected because their quotes were not found on the pages). Retry this branch or try different queries.`
        : "The pages read did not state anything specific about this branch's question. Try different queries.",
    );
  }
  return finish(ctx, "done", coverageNote(stats));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A positive timeout no longer than `max` and no longer than the time left (at least `floor`). */
function clampMs(max: number, left: number = max, floor = 1): number {
  return Math.max(floor, Math.min(max, left));
}

function emptyStats(): ResearchStats {
  return {
    status: "done",
    totalMs: 0,
    searchMs: 0,
    retrieveMs: 0,
    browserMs: 0,
    browser: { tried: 0, read: 0, skippedForTime: 0 },
    extractMs: 0,
    queries: 0,
    failedQueries: 0,
    hits: 0,
    unique: 0,
    excluded: 0,
    candidates: 0,
    retrieved: { full: 0, snippet: 0, failed: 0 },
    extracted: 0,
    malformed: 0,
    kept: 0,
    rejected: 0,
    duplicates: 0,
    overCap: 0,
    rejections: [],
    sourceNotes: [],
  };
}

function countRetrieval(sources: Source[]) {
  return {
    full: sources.filter((s) => s.retrievalStatus === "full_text").length,
    snippet: sources.filter((s) => s.retrievalStatus === "snippet_only").length,
    failed: sources.filter((s) => s.retrievalStatus === "failed").length,
  };
}

function failedRetrieval(hit: SearchHit, err: unknown): RetrievedSource {
  return {
    source: {
      id: sourceIdFromUrl(hit.url),
      url: hit.url,
      domain: hit.domain,
      title: hit.title || hit.domain,
      retrievalStatus: "failed",
    },
    text: "",
    note: `retrieval threw: ${(err as Error)?.message ?? String(err)}`,
  };
}

function searchFailure(branchId: string, errors: unknown[], stageTimedOut: boolean): ResearchSearchError {
  const codes = errors.map((e) => (e instanceof KeenableError ? `${e.code}${e.status ? `/${e.status}` : ""}` : "error"));
  console.warn(`[research] ${branchId} every search failed: ${codes.join(", ")}`);
  const keenable = errors.filter((e): e is KeenableError => e instanceof KeenableError);
  if (keenable.some((e) => e.code === "rate_limited")) {
    return new ResearchSearchError("rate_limited", "The search provider is rate limiting requests. Wait a moment and retry this branch.");
  }
  if (stageTimedOut || keenable.some((e) => e.code === "timeout" || e.code === "aborted")) {
    return new ResearchSearchError("timeout", "The search provider did not respond in time. Retry this branch.");
  }
  return new ResearchSearchError("upstream", "Search failed for every query in this branch. Retry it in a moment.");
}

function llmFailureNote(err: LLMError): string {
  switch (err.code) {
    case "LLM_RATE_LIMITED":
      return "The AI model is rate limiting requests, so these pages were not read yet. Wait a moment and retry this branch.";
    case "LLM_INVALID_OUTPUT":
      return "The AI model returned unusable output twice while reading these pages. Retry this branch.";
    default:
      return "The AI model provider failed while reading these pages. Retry this branch.";
  }
}

function coverageNote(stats: ResearchStats): string | undefined {
  const { full, snippet, failed } = stats.retrieved;
  const byBrowser = stats.browser.read;
  if (snippet === 0 && failed === 0 && byBrowser === 0) return undefined;
  const parts = [
    `Read ${full} of ${full + snippet + failed} pages in full${byBrowser ? ` (${byBrowser} with a cloud browser)` : ""}`,
  ];
  if (snippet) parts.push(`${snippet} only from search snippets`);
  if (failed) parts.push(`${failed} could not be opened`);
  return `${parts.join("; ")}.`;
}

/** A Source as it may leave the server: no `text`, every field within contract limits. */
function toPublicSource(s: Source): PublicSource {
  const domain = s.domain.slice(0, LIMITS.domainChars) || "unknown";
  const out: PublicSource = {
    id: s.id,
    url: s.url,
    domain,
    title: (s.title.trim() || domain).slice(0, LIMITS.sourceTitleChars),
    retrievalStatus: s.retrievalStatus,
  };
  if (s.publishedAt && s.publishedAt.length <= LIMITS.dateChars) out.publishedAt = s.publishedAt;
  if (s.snippet?.trim()) out.snippet = s.snippet.slice(0, LIMITS.snippetChars);
  if (s.retrievedVia) out.retrievedVia = s.retrievedVia;
  return out;
}

function finish(ctx: RunContext, status: ResearchStatus, note?: string): ResearchRun {
  const notes = [note, ...ctx.warnings].filter((n): n is string => Boolean(n));
  const stats = ctx.stats;
  stats.status = status;
  stats.totalMs = Date.now() - ctx.started;
  stats.retrieved = countRetrieval(ctx.sources);
  stats.kept = ctx.claims.length;
  stats.rejected = ctx.rejected;

  const response: ResearchResponse = {
    branchId: ctx.req.branch.id,
    ...(ctx.req.forGapId ? { forGapId: ctx.req.forGapId } : {}),
    status,
    ...(notes.length ? { note: notes.join(" ").slice(0, LIMITS.noteChars) } : {}),
    sources: ctx.sources.slice(0, LIMITS.maxSourcesPerResearch).map(toPublicSource),
    claims: ctx.claims.slice(0, LIMITS.maxClaimsPerResearch),
    rejectedClaims: Math.min(ctx.rejected, LIMITS.maxRejectedClaims),
  };
  return { response, stats };
}

function finishAtDeadline(ctx: RunContext): ResearchRun {
  ctx.stats.stoppedAt = ctx.stage;
  const what = STAGE_LABEL[ctx.stage];
  const note = ctx.callerSignal?.aborted
    ? `The request was cancelled while ${what}.`
    : `Stopped at the ${Math.round(ctx.limitMs / 1000)}-second limit while ${what}; showing what finished.`;
  return finish(ctx, "partial", note);
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function logRun(ctx: RunContext, run: ResearchRun): void {
  const s = run.stats;
  const gap = ctx.req.forGapId ? ` (gap ${ctx.req.forGapId})` : "";
  console.info(
    `[research] ${ctx.req.branch.id}${gap} ${s.status}${s.stoppedAt ? ` at ${s.stoppedAt}` : ""} in ${sec(s.totalMs)}` +
      ` | search ${sec(s.searchMs)}: ${s.queries} q${s.failedQueries ? ` (${s.failedQueries} failed)` : ""}, ${s.hits} hits, ${s.unique} unique, ${s.excluded} excluded` +
      ` | retrieve ${sec(s.retrieveMs)}: ${s.retrieved.full} full, ${s.retrieved.snippet} snippet, ${s.retrieved.failed} failed` +
      (s.browser.tried ? ` | browser ${sec(s.browserMs)}: ${s.browser.read} of ${s.browser.tried} read` : "") +
      (s.browser.skippedForTime ? ` | browser skipped (no time) for ${s.browser.skippedForTime}` : "") +
      ` | extract ${sec(s.extractMs)}: ${s.extracted} claims${s.malformed ? `, ${s.malformed} malformed` : ""}` +
      ` | verify: ${s.kept} kept, ${s.rejected} rejected${s.duplicates ? `, ${s.duplicates} duplicate` : ""}${s.overCap ? `, ${s.overCap} over cap` : ""}`,
  );
  for (const n of s.sourceNotes) console.info(`[research]   ${n.status} ${n.sourceId} (${n.domain}): ${n.note}`);
  for (const r of s.rejections) {
    const excerpt = r.excerpt.length > 80 ? `${r.excerpt.slice(0, 80)}…` : r.excerpt;
    console.info(`[research]   rejected (${r.reason}) ${r.sourceId}: "${excerpt}"`);
  }
}
