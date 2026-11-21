/**
 * The fixed "Balanced" research budget (docs/BLUEPRINT.md section 5).
 * Tune these against real latency; everything in the pipeline reads them from here.
 */
export const BUDGET = {
  /** Branches the planner aims for, and the hard cap. */
  branches: 4,
  maxBranches: 5,
  /** Search queries per branch. */
  queriesPerBranch: 2,
  /** Results requested from Keenable per query (more than we keep, so ranking has a choice). */
  resultsPerQuery: 5,
  /** Sources retrieved and read per branch, after dedupe and ranking. */
  sourcesPerBranch: 3,
  /** Target number of unique sources across the whole investigation. */
  totalSources: 12,
  /** Characters of the most relevant passages passed to the model per source. */
  sourceTextChars: 6000,
  /** Claims kept per branch, and per source within a branch. */
  claimsPerBranch: 8,
  claimsPerSource: 4,
  /** Longest excerpt the extractor may quote. */
  excerptMaxChars: 300,
  /** Per-branch time limit for /api/research; after it, return partial results. */
  branchTimeLimitMs: 45_000,
  /** Concurrent searches within one branch. */
  searchConcurrency: 2,
} as const;

/**
 * How /api/research splits its BUDGET.branchTimeLimitMs between stages.
 * The route always answers before the limit, with whatever finished ("partial" if cut short).
 */
export const PIPELINE = {
  /** Kept free at the end of the limit to build and send the response. */
  replyMarginMs: 1_000,
  /** Longest the search stage may take (slow queries are abandoned; finished ones are kept). */
  searchMaxMs: 15_000,
  /**
   * Longest the retrieval stage may take, including backfill. Most fetches take under 2 s; a slow
   * page past this falls back to its search snippet (snippet_only) instead of holding up the branch.
   */
  retrieveMaxMs: 8_000,
  /** Time reserved for the extraction call when deciding how long retrieval may run. */
  extractReserveMs: 16_000,
  /** Skip extraction (and return "partial") when less than this remains. */
  minExtractMs: 4_000,
  /** Extra candidates retrieved to replace pages that failed, at most. */
  maxBackfill: 2,
  /** Only backfill if at least this much of the retrieval budget is left. */
  minBackfillMs: 2_500,
} as const;

/** Solari cloud-browser fallback (docs/BLUEPRINT.md section 30). */
export const SOLARI = {
  /** Browsers open at once across the whole server (the Free plan allows 3). */
  concurrency: 3,
  /** Browser fallbacks per branch, at most. */
  maxPerBranch: 2,
  /** A source with less text than this (or failed / snippet_only) is worth a browser attempt,
   *  and a browser read must return at least this much to be used. */
  minTextChars: 500,
  /** Hard limit for one browser read, from launch to close. */
  overallTimeoutMs: 20_000,
  /** page.goto navigation timeout. */
  navigationTimeoutMs: 15_000,
  /** Pause after the page has loaded, for late client-side rendering. */
  settleMs: 1_000,
  /** Raw page text kept from the browser, before relevance trimming. */
  maxTextChars: 20_000,
  /** Server-side auto-release for every session (the gateway minimum): a backstop if a close is ever lost. */
  sessionTimeoutMs: 60_000,
  /** Per-request HTTP timeout for the session-create call. */
  apiTimeoutMs: 10_000,
  /** Skip the browser stage when less than this is left of its budget. */
  minStageMs: 4_000,
} as const;

/** Keenable HTTP client limits. */
export const KEENABLE = {
  /** Per-request timeout. */
  timeoutMs: 15_000,
  /**
   * Minimum gap between request starts in this process. Keyless calls are limited to
   * 10 requests per second and 1,000 per hour per IP. With a key the limit is STILL 10 requests
   * per second per organization (verified 2026-11-21: a 12-request burst at 50 ms spacing got 429s),
   * so keyed calls are spaced just under that too.
   */
  minIntervalMsKeyless: 120,
  minIntervalMsKeyed: 110,
  /** Longest Retry-After we are willing to wait for the single 429 retry. */
  maxRetryWaitMs: 3_000,
  /** Characters requested from /v1/fetch (we trim to sourceTextChars afterwards). */
  fetchMaxChars: 60_000,
} as const;

/** Retrieval thresholds. */
export const RETRIEVAL = {
  /** A fetched page with less clean text than this is treated as unreadable (e.g. a JS shell). */
  minFullTextChars: 200,
  /** A search snippet shorter than this is not worth giving to the model. */
  minSnippetChars: 80,
  /** Length of the short display snippet stored on Source.snippet. */
  displaySnippetChars: 400,
} as const;
