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

/** Keenable HTTP client limits. */
export const KEENABLE = {
  /** Per-request timeout. */
  timeoutMs: 15_000,
  /**
   * Minimum gap between request starts in this process. Keyless calls are limited to
   * 10 requests per second and 1,000 per hour per IP; a key raises the limits.
   */
  minIntervalMsKeyless: 120,
  minIntervalMsKeyed: 50,
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
