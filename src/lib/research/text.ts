/**
 * Text cleanup and relevance trimming for retrieved pages.
 *
 * Keenable returns markdown. The model and the quote verifier must see the SAME plain text,
 * so markdown syntax is flattened before anything else (otherwise a model quoting
 * "an agenda" would fail against "an **agenda**").
 */
import { PASSAGE_SEPARATOR } from "./verify";

/** Flattens markdown to plain text while keeping line structure. */
export function cleanMarkdown(md: string): string {
  return (
    md
      .replace(/\r\n?/g, "\n")
      // images: drop entirely; links: keep the visible text
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
      // reference-style link definitions
      .replace(/^[ \t]*\[[^\]\n]+\]:[ \t]*\S+.*(\n|$)/gm, "")
      // raw HTML tags
      .replace(/<\/?[a-z][^>\n]*>/gi, "")
      // headings and blockquote markers
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]{0,3}>[ \t]?/gm, "")
      // table separator rows and horizontal rules (whole line, including its newline)
      .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*(\n|$)/gm, "")
      .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*(\n|$)/gm, "")
      // table cell pipes -> spaced separators
      .replace(/^\|[ \t]*/gm, "")
      .replace(/[ \t]*\|[ \t]*$/gm, "")
      .replace(/[ \t]*\|[ \t]*/g, " | ")
      // bold / italic / strike / inline code markers
      .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/(^|[\s(["'])[*_](?=\S)([^*_\n]*?\S)[*_](?=[\s).,;:!?"'\]]|$)/gm, "$1$2")
      .replace(/`+([^`\n]+)`+/g, "$1")
      // bullets: normalize "*"/"+" to "-"
      .replace(/^([ \t]*)[*+][ \t]+/gm, "$1- ")
      // markdown escapes
      .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, "$1")
      // whitespace
      .replace(/[ \t]+$/gm, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

const STOPWORDS = new Set(
  (
    "a an and are as at be by can do does for from has have how i if in into is it its me my of on or " +
    "our should so that the their them then there these they this to was we what when where which who " +
    "why will with you your about any get need want find out more most also than other some such use"
  ).split(" "),
);

/** Lowercase content words (3+ chars, not stopwords) from the focus text. */
export function focusTerms(focus: string): string[] {
  const words = focus.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)))];
}

/** Splits text into passages: paragraphs, with long paragraphs cut at sentence/line boundaries. */
function splitPassages(text: string, targetChars = 700): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    const p = para.trim();
    if (!p) continue;
    if (p.length <= targetChars * 1.4) {
      out.push(p);
      continue;
    }
    // Cut long paragraphs at sentence ends or line breaks into ~targetChars chunks.
    // Pieces keep their trailing whitespace, so concatenating them reproduces the text exactly.
    const pieces: string[] = [];
    let last = 0;
    for (const m of p.matchAll(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n/g)) {
      const end = (m.index ?? 0) + m[0].length;
      pieces.push(p.slice(last, end));
      last = end;
    }
    pieces.push(p.slice(last));
    let current = "";
    for (const piece of pieces) {
      if (current.length > 0 && current.length + piece.length > targetChars) {
        out.push(current.trim());
        current = "";
      }
      current += piece;
    }
    if (current.trim()) out.push(current.trim());
  }
  return out;
}

function scorePassage(passage: string, terms: string[], index: number): number {
  const lower = passage.toLowerCase();
  let matched = 0;
  let hits = 0;
  for (const term of terms) {
    let from = 0;
    let count = 0;
    while ((from = lower.indexOf(term, from)) !== -1 && count < 5) {
      count++;
      from += term.length;
    }
    if (count > 0) matched++;
    hits += count;
  }
  const coverage = terms.length > 0 ? matched / terms.length : 0;
  // Requirements, deadlines and amounts live in passages with numbers, dates and money.
  const specifics = /[$€£]\s?\d|\d{1,2}(st|nd|rd|th)?\b|\b(19|20)\d{2}\b|deadline|due|must|require|eligib/i.test(
    passage,
  )
    ? 0.5
    : 0;
  const lead = index === 0 ? 0.4 : index === 1 ? 0.2 : 0;
  return coverage * 4 + Math.min(hits, 12) * 0.15 + specifics + lead;
}

/**
 * Keeps the passages of a contiguous page that best match the focus terms, up to maxChars,
 * in original order. Non-adjacent passages are joined with PASSAGE_SEPARATOR so no quote can
 * span a gap. Text that already fits is returned unchanged.
 */
export function selectPassages(text: string, focus: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return pickPassages(splitPassages(text), focus, maxChars, true);
}

/**
 * Same as selectPassages for text that is NOT contiguous (Keenable's stitched search snippet):
 * every paragraph boundary is treated as a gap and marked with PASSAGE_SEPARATOR.
 */
export function selectStitchedPassages(text: string, focus: string, maxChars: number): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const joined = paragraphs.join(PASSAGE_SEPARATOR);
  if (joined.length <= maxChars) return joined;
  return pickPassages(paragraphs, focus, maxChars, false);
}

function pickPassages(passages: string[], focus: string, maxChars: number, contiguous: boolean): string {
  const terms = focusTerms(focus);

  const ranked = passages
    .map((p, i) => ({ i, p, score: scorePassage(p, terms, i) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const chosen: { i: number; p: string }[] = [];
  let used = 0;
  for (const cand of ranked) {
    const cost = cand.p.length + PASSAGE_SEPARATOR.length;
    if (used + cost > maxChars) {
      // Allow a trimmed final passage if there is meaningful room left.
      const room = maxChars - used - PASSAGE_SEPARATOR.length;
      if (room >= 300 && chosen.length > 0) {
        const cut = cand.p.slice(0, room);
        const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
        if (end > 150) chosen.push({ i: cand.i, p: cut.slice(0, end + 1).trim() });
      }
      if (chosen.length > 0) break;
      chosen.push({ i: cand.i, p: cand.p.slice(0, maxChars) });
      break;
    }
    chosen.push(cand);
    used += cost;
  }

  chosen.sort((a, b) => a.i - b.i);
  let out = "";
  for (let k = 0; k < chosen.length; k++) {
    if (k === 0) out = chosen[k].p;
    else {
      const adjacent = contiguous && chosen[k].i === chosen[k - 1].i + 1;
      out += (adjacent ? "\n\n" : PASSAGE_SEPARATOR) + chosen[k].p;
    }
  }
  if (contiguous && chosen.length > 0) {
    if (chosen[0].i !== 0) out = `[…]\n\n${out}`;
    if (chosen[chosen.length - 1].i !== passages.length - 1) out = `${out}\n\n[…]`;
  }
  return out;
}

/** First ~maxChars of text, cut at a word boundary, for display (Source.snippet). */
export function displaySnippet(text: string, maxChars: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxChars) return flat;
  const cut = flat.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trim()}…`;
}
