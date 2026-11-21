/**
 * Web search via Keenable. Server-only.
 *
 * Real response (POST /v1/search[/public], verified 2026-11-21):
 *   { query, mode, results: [{ title, url, description, snippet, published_at?, acquired_at }] }
 * - `snippet` is markdown page text assembled from SEVERAL non-adjacent passages (no markers),
 *   often thousands of characters. `description` is empty. `published_at` is often missing.
 */
import { z } from "zod";

import { BUDGET, RETRIEVAL } from "./budget";
import { domainOf, normalizeUrl } from "./dedupe";
import { keenableRequest, KeenableError } from "./keenable";
import { cleanMarkdown, displaySnippet } from "./text";

export interface SearchHit {
  /** Normalized http(s) URL. */
  url: string;
  title: string;
  /** Short display snippet (plain text). */
  snippet: string;
  /**
   * Plain-text passages Keenable extracted for this query. Stitched from several places in the
   * page without markers, so it is NOT contiguous page text; retrieve.ts treats it as a fallback.
   */
  text?: string;
  /** ISO date when Keenable knows it. */
  publishedAt?: string;
  /** Host without "www.". */
  domain: string;
  /** The query that found this hit, and its 0-based position in that query's results. */
  query: string;
  rank: number;
}

export interface SearchOptions {
  maxResults?: number;
  /** "pro" (Keenable's default) or "realtime". */
  mode?: "pro" | "realtime";
  signal?: AbortSignal;
}

const SearchResultSchema = z.object({
  url: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  snippet: z.string().nullish(),
  published_at: z.string().nullish(),
});

const SearchResponseSchema = z.object({
  results: z.array(z.unknown()),
});

/**
 * Runs one Keenable search. Returns [] when there are no results.
 * Throws KeenableError when the search itself fails (the caller marks the branch failed).
 */
export async function searchWeb(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const maxResults = Math.min(Math.max(opts.maxResults ?? BUDGET.resultsPerQuery, 1), 50);

  const json = await keenableRequest({
    endpoint: "search",
    method: "POST",
    body: { query: q, max_results: maxResults, ...(opts.mode ? { mode: opts.mode } : {}) },
    signal: opts.signal,
  });

  const parsed = SearchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KeenableError("Keenable search response had no results list.", { code: "invalid_response" });
  }

  const hits: SearchHit[] = [];
  parsed.data.results.forEach((item, rank) => {
    const r = SearchResultSchema.safeParse(item);
    if (!r.success) return;
    const url = normalizeUrl(r.data.url);
    if (!url) return; // non-http(s) or malformed: never shown to users
    const domain = domainOf(url);
    const text = cleanMarkdown(r.data.snippet ?? "");
    const description = cleanMarkdown(r.data.description ?? "");
    const publishedAt = r.data.published_at?.trim() || undefined;
    hits.push({
      url,
      title: cleanMarkdown(r.data.title ?? "").replace(/\s+/g, " ").trim() || domain,
      snippet: displaySnippet(description || text, RETRIEVAL.displaySnippetChars),
      ...(text ? { text } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      domain,
      query: q,
      rank,
    });
  });
  return hits;
}
