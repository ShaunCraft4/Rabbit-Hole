/**
 * Programmatic quote verification (docs/BLUEPRINT.md section 5).
 * A claim survives only if its excerpt appears verbatim in the text the model was given,
 * after normalizing case, whitespace and typography. Code only, no model.
 */

/**
 * Inserted between non-adjacent passages when retrieval trims or stitches a page.
 * An excerpt that spans this marker is NOT a contiguous quote, so it never verifies.
 */
export const PASSAGE_SEPARATOR = "\n\n[…]\n\n";

/** Excerpts shorter than this (after normalization) prove nothing and are rejected. */
export const MIN_EXCERPT_CHARS = 20;

/** Normalizes text for comparison: compatibility forms, case, quotes, dashes, whitespace. */
export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC") // ligatures, full-width forms, "…" -> "...", NBSP -> space
    .replace(/[​-‍⁠﻿­]/g, "") // zero-width chars and soft hyphens
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-") // hyphen, en dash, em dash, minus -> "-"
    .replace(/\s+/g, " ")
    .trim();
}

const NORMALIZED_SEPARATOR = normalizeForMatch(PASSAGE_SEPARATOR);

/** True when `excerpt` appears verbatim (modulo normalization) inside `pageText`. */
export function verifyExcerpt(excerpt: string, pageText: string): boolean {
  const e = normalizeForMatch(excerpt);
  if (e.length < MIN_EXCERPT_CHARS) return false;
  if (e.includes(NORMALIZED_SEPARATOR)) return false;
  return normalizeForMatch(pageText).includes(e);
}
