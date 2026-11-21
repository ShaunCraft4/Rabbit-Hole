/**
 * Reads a search hit into a Source plus the text the extractor (and verifier) will use.
 * Server-only. Never throws.
 *
 * Order of preference, chosen after inspecting the live API on 2026-11-21:
 * 1. GET /v1/fetch: the real page as markdown (about 0.25 s for indexed pages) -> "full_text".
 *    Preferred even when the search hit already carries text, because the search snippet is
 *    stitched from non-adjacent passages without markers, so a quote "verified" against it
 *    could span words that never appear together on the page.
 * 2. The search hit's stitched text, with every passage boundary marked -> "snippet_only".
 * 3. Nothing readable -> "failed" (the source is kept, never claimed as read).
 *
 * Fetch response (verified): { url, title, content, description, published_at?, truncated, total_chars }.
 * Unreadable pages return a JSON error with type "target_error" (e.g. code "page_not_found").
 */
import { z } from "zod";

import type { Source } from "@/lib/types";

import { BUDGET, KEENABLE, RETRIEVAL } from "./budget";
import { domainOf, sourceIdFromUrl } from "./dedupe";
import { keenableRequest, KeenableError } from "./keenable";
import type { SearchHit } from "./search";
import { cleanMarkdown, displaySnippet, selectPassages, selectStitchedPassages } from "./text";

export interface RetrieveOptions {
  /** Text whose terms decide which passages to keep (branch question + queries). Defaults to hit.query. */
  focus?: string;
  /** Max characters of text returned. Defaults to BUDGET.sourceTextChars. */
  maxChars?: number;
  signal?: AbortSignal;
}

export interface RetrievedSource {
  /** Source WITHOUT `text`; the page text is returned separately below. */
  source: Source;
  /** Server-only plain text given to the extractor and used by verifyExcerpt. "" when failed. */
  text: string;
  /** Why fetch was not used, when it was not (for logs). */
  note?: string;
}

const FetchResponseSchema = z.object({
  url: z.string().nullish(),
  title: z.string().nullish(),
  content: z.string().nullish(),
  published_at: z.string().nullish(),
  truncated: z.boolean().nullish(),
  total_chars: z.number().nullish(),
});

export interface FetchedPage {
  title?: string;
  /** Plain text (markdown flattened). */
  text: string;
  publishedAt?: string;
  truncated: boolean;
}

/** GET /v1/fetch for one URL. Throws KeenableError on failure. */
export async function fetchPage(url: string, signal?: AbortSignal): Promise<FetchedPage> {
  const json = await keenableRequest({
    endpoint: "fetch",
    method: "GET",
    query: { url, max_chars: String(KEENABLE.fetchMaxChars) },
    signal,
  });
  const parsed = FetchResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new KeenableError("Keenable fetch response was malformed.", { code: "invalid_response" });
  }
  const title = cleanMarkdown(parsed.data.title ?? "").replace(/\s+/g, " ").trim();
  return {
    ...(title ? { title } : {}),
    text: cleanMarkdown(parsed.data.content ?? ""),
    ...(parsed.data.published_at?.trim() ? { publishedAt: parsed.data.published_at.trim() } : {}),
    truncated: parsed.data.truncated ?? false,
  };
}

const describe = (err: unknown) =>
  err instanceof KeenableError ? `${err.code}${err.status ? ` (HTTP ${err.status})` : ""}` : "unexpected error";

export async function retrieveSource(hit: SearchHit, opts: RetrieveOptions = {}): Promise<RetrievedSource> {
  const maxChars = opts.maxChars ?? BUDGET.sourceTextChars;
  const focus = opts.focus ?? hit.query;
  const domain = hit.domain || domainOf(hit.url);

  const base: Source = {
    id: sourceIdFromUrl(hit.url),
    url: hit.url,
    domain,
    title: hit.title || domain,
    retrievalStatus: "failed",
    ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
    ...(hit.snippet ? { snippet: hit.snippet } : {}),
  };

  try {
    // 1. Full page.
    let note: string | undefined;
    try {
      const page = await fetchPage(hit.url, opts.signal);
      if (page.text.length >= RETRIEVAL.minFullTextChars) {
        const publishedAt = page.publishedAt ?? base.publishedAt;
        return {
          source: {
            ...base,
            title: page.title || base.title,
            ...(publishedAt ? { publishedAt } : {}),
            snippet: base.snippet || displaySnippet(page.text, RETRIEVAL.displaySnippetChars),
            retrievalStatus: "full_text",
            retrievedVia: "keenable",
          },
          text: selectPassages(page.text, focus, maxChars),
        };
      }
      note = `fetch returned only ${page.text.length} characters`;
    } catch (err) {
      // A fetch cut off by the time limit still falls through to the snippet below:
      // that text is already in memory and needs no network.
      note = opts.signal?.aborted ? "fetch stopped at the time limit" : `fetch failed: ${describe(err)}`;
    }

    // 2. Search snippet (stitched passages): honest fallback, labeled snippet_only.
    const snippetText = hit.text ?? "";
    if (snippetText.length >= RETRIEVAL.minSnippetChars) {
      return {
        source: { ...base, retrievalStatus: "snippet_only", retrievedVia: "keenable" },
        text: selectStitchedPassages(snippetText, focus, maxChars),
        note,
      };
    }

    // 3. Nothing readable.
    return { source: base, text: "", note };
  } catch (err) {
    return { source: base, text: "", note: `unexpected: ${(err as Error).message}` };
  }
}
