/**
 * Short node names for the skill tree (Claim.label and Gap.label).
 *
 * Client-safe (no Node or server imports). The extract and analyze steps use cleanLabel to check
 * the label the model wrote; fallbackLabel builds one in code when the model's label is missing or
 * fails the check, and for investigations saved before labels existed.
 */

export const LABEL = {
  /** Longest label kept (contracts.ts allows 40; this leaves room for the " ·2" de-dupe suffix). */
  maxChars: 34,
  maxWords: 5,
  /** Characters per line when a label is wrapped under a node. */
  lineChars: 18,
  maxLines: 2,
} as const;

const QUOTES = `"'“”‘’«»\``;
const WRAPPED = new RegExp(`^[${QUOTES}]+|[${QUOTES}]+$`, "g");

/** Digit runs with thousands separators removed ("$1,500 in 2026-27" -> ["1500", "2026", "27"]). */
function digitRuns(text: string): string[] {
  return text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+/g) ?? [];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The model's label, tidied, or undefined when it is unusable: empty, too long, more than
 * LABEL.maxWords words, markup- or link-like, or containing a number that is not in `ground`
 * (the claim or gap text it names). A label may never introduce a figure of its own.
 */
export function cleanLabel(raw: unknown, ground: string): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(WRAPPED, "")
    .replace(/^[-–—•*\s]+/, "")
    .replace(/[\s.,;:!?]+$/, "")
    .trim();
  if (!s || s.length > LABEL.maxChars) return undefined;
  if (s.split(" ").length > LABEL.maxWords) return undefined;
  if (!/[A-Za-z]/.test(s) || /[<>{}[\]|\\]|https?:|www\./i.test(s)) return undefined;
  const allowed = new Set(digitRuns(ground));
  if (digitRuns(s).some((run) => !allowed.has(run))) return undefined;
  return capitalize(s);
}

// ---------------------------------------------------------------------------
// Fallback labels (code-made, from the claim's or gap's own words)
// ---------------------------------------------------------------------------

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";

/** Key figures, most telling first. Each is copied from the text as written. */
const FIGURES: RegExp[] = [
  /\$\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:million|billion|[kKmM]\b))?/,
  /\b\d+(?:\.\d+)?\s?%/,
  /\b\d\.\d{1,2}\s?GPA\b|\bGPA\s(?:of\s)?\d\.\d{1,2}\b/i,
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}\\b`),
  /\b\d+(?:[-–]\d+)?\s?(?:business |calendar |school |academic )?(?:days?|weeks?|months?|years?|hours?|quarters?|units?|credits?|semesters?)\b/i,
  /\b20\d{2}[-–]\d{2,4}\b/,
  /\b(?:Fall|Winter|Spring|Summer)\s20\d{2}\b/,
];

/** Capitalized words that never start a name (determiners, pronouns, question words, verbs). */
const OPENERS = new Set(
  "a an the this that these those each every all any some no it its they their there what when where which who whom whose why how is are can does do did will would should may might must if in on at to for of by from with as and or but you your".split(
    " ",
  ),
);

const CONNECTORS = new Set(["of", "for", "and", "&", "the", "de", "in", "on"]);
const MONTHS = new Set("january february march april may june july august september october november december jan feb mar apr jun jul aug sep sept oct nov dec monday tuesday wednesday thursday friday saturday sunday".split(" "));
const STOP = new Set(
  "a an the this that these those is are was were be been being can could may might must should will would shall do does did has have had to of for in on at by from with as and or but not no only also about into than then there their its it they them you your per each every any some all least most more up over under before after during within without between through how what when where which who whether if".split(
    " ",
  ),
);

/**
 * The most specific name in the text: the longest run of capitalized words / acronyms (with "of",
 * "for"... inside), at most 3 words, the earliest on a tie ("Temporary Food Permit" beats "UCR").
 */
function properName(text: string): string | undefined {
  const words = text.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  const clean = (w: string) => w.replace(/^[^A-Za-z0-9&]+|[^A-Za-z0-9&']+$/g, "");
  const trimConnectors = (run: string[]) => {
    const out = [...run];
    while (out.length && CONNECTORS.has(out[out.length - 1].toLowerCase())) out.pop();
    return out;
  };
  let best: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const first = clean(words[i]);
    if (!/^[A-Z]/.test(first) || MONTHS.has(first.toLowerCase())) continue;
    const acronym = /^[A-Z][A-Z0-9&]+$/.test(first);
    const next = clean(words[i + 1] ?? "");
    const opensSentence = i === 0 || /[.!?:]$/.test(words[i - 1]);
    if (OPENERS.has(first.toLowerCase())) continue;
    if (opensSentence && !acronym && !/^[A-Z]/.test(next)) continue;

    const run: string[] = [first];
    for (let j = i + 1; j < words.length && run.length < 6; j++) {
      const w = clean(words[j]);
      const endsClause = /[,.;:!?]$/.test(words[j - 1]);
      if (endsClause || !w) break;
      if (/^[A-Z]/.test(w) && !MONTHS.has(w.toLowerCase())) run.push(w);
      else if (CONNECTORS.has(w.toLowerCase()) && /^[A-Z]/.test(clean(words[j + 1] ?? ""))) run.push(w);
      else break;
    }
    const name = trimConnectors(trimConnectors(run).slice(0, 3))
      .join(" ")
      .replace(/['’]s$/, "");
    if (name && (!best || name.split(" ").length > best.split(" ").length)) best = name;
    i += run.length - 1;
  }
  return best;
}

/** The first few content words ("Funding requests must be submitted..." -> "Funding requests submitted"). */
function topicWords(text: string, count: number): string {
  return text
    .split(/\s+/)
    .map((w) => w.replace(/^[^A-Za-z0-9$]+|[^A-Za-z0-9%]+$/g, ""))
    .filter((w) => w && !STOP.has(w.toLowerCase()) && !/^\d/.test(w))
    .slice(0, count)
    .join(" ");
}

function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max + 1).replace(/\s+\S*$/, "");
  return cut || s.slice(0, max);
}

/**
 * A label built in code from the text: a name in the text plus its key figure
 * ("ASUCR · $1,500", "Highlander Abroad Fund · $700"), or its first content words.
 */
export function fallbackLabel(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  const figure = FIGURES.map((re) => t.match(re)?.[0]).find(Boolean)?.replace(/\s+/g, " ");
  const name = properName(t);
  let label: string;
  if (name && figure && `${name} · ${figure}`.length <= LABEL.maxChars) label = `${name} · ${figure}`;
  else if (name) label = name;
  else if (figure) {
    const topic = topicWords(t, 2);
    label = topic && `${topic} · ${figure}`.length <= LABEL.maxChars ? `${topic} · ${figure}` : figure;
  } else label = topicWords(t, 3);
  label = cutWords(label.trim(), LABEL.maxChars);
  return capitalize(label || cutWords(t, LABEL.maxChars) || "Finding");
}

/** A second code-made label, used when the first one repeats a label already in the region. */
export function alternateLabel(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return capitalize(cutWords(topicWords(t, 3), LABEL.maxChars) || cutWords(t, LABEL.maxChars) || "Finding");
}

/** Greedy word wrap to at most `maxLines` lines; the last line ends in "…" when text is cut. */
export function wrapLabel(label: string, lineChars: number = LABEL.lineChars, maxLines: number = LABEL.maxLines): string[] {
  // Keep "·" with the figure after it, and a short number with the word before it ("October 1").
  const words: string[] = [];
  for (const raw of label.split(/\s+/).filter(Boolean)) {
    const w = raw.length > lineChars + 4 ? `${raw.slice(0, lineChars)}…` : raw;
    const prev = words.at(-1);
    if (prev !== undefined && (prev === "·" || /^[\d$%.,–-]{1,3}$/.test(w))) words[words.length - 1] = `${prev} ${w}`;
    else words.push(w);
  }
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > lineChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.length >= lineChars ? `${last.slice(0, lineChars - 1).trimEnd()}…` : `${last}…`;
  return kept;
}
