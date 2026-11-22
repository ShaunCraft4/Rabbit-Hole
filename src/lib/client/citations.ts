/**
 * Citation formats for the Golden Key's evidence (web pages): MLA 9, APA 7, Chicago 17
 * (notes-bibliography, bibliography entries), Harvard (Cite Them Right) and IEEE.
 *
 * Pure and client-safe. Every citation is built from segments, so it can be copied both as plain
 * text and as HTML (keeping the italics each style requires).
 *
 * What a source gives us: a page title (often "Page | Site"), a URL, a domain and sometimes a
 * publication date. Web pages rarely name a person as author, so every style uses its no-author
 * rule: start with the title (MLA, APA, Chicago), or with the site / organization (Harvard).
 * The site name comes from the title's "| Site" part when there is one, else from the domain.
 * When a page has no date, each style's access/retrieval-date rule applies.
 */

export type CitationStyle = "mla" | "apa" | "chicago" | "harvard" | "ieee";

export const CITATION_STYLE_ORDER: CitationStyle[] = ["mla", "apa", "chicago", "harvard", "ieee"];

export const CITATION_STYLES: Record<
  CitationStyle,
  { label: string; edition: string; listTitle: string; rules: string }
> = {
  mla: {
    label: "MLA",
    edition: "MLA 9th edition",
    listTitle: "Works Cited",
    rules:
      "Alphabetical by title. Page titles in quotation marks, the website in italics, dates as day month year, URLs without https://. An access date is added when a page has no date.",
  },
  apa: {
    label: "APA",
    edition: "APA 7th edition",
    listTitle: "References",
    rules:
      "Alphabetical by title. With no author, the page title (in italics) moves to the author position, followed by the date; “n.d.” and a retrieval date when a page has no date.",
  },
  chicago: {
    label: "Chicago",
    edition: "Chicago 17th edition, notes and bibliography",
    listTitle: "Bibliography",
    rules:
      "Alphabetical by title. Page titles in quotation marks, then the website and the date; “Accessed” with the date when a page has no date.",
  },
  harvard: {
    label: "Harvard",
    edition: "Harvard (Cite Them Right)",
    listTitle: "Reference list",
    rules:
      "Alphabetical by the organization or website standing in for the author, then by year (2026a, 2026b for the same site and year). Titles in italics, with “Available at” and “Accessed”.",
  },
  ieee: {
    label: "IEEE",
    edition: "IEEE reference style",
    listTitle: "References",
    rules: "Numbered in the order the report cites them. Page titles in quotation marks, then the website, the access date and the URL.",
  },
};

export interface CitationSource {
  /** The report's source number ([1], [2]...). */
  number: number;
  title: string;
  /** A safe http(s) URL, or null when the page has none. */
  url: string | null;
  domain: string;
  publishedAt?: string;
}

export type Segment = { text: string; italic?: boolean };

export interface Citation {
  number: number;
  /** For rendering (italic segments as <i>), never as raw HTML. */
  segments: Segment[];
  /** Plain-text copy. */
  text: string;
  /** Rich copy (italics kept), escaped. */
  html: string;
}
type DateParts = { year: number; month?: number; day?: number };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** MLA abbreviates months longer than four letters. */
const MLA_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const IEEE_MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function validDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** "2026-10-27", "2026-10-27T18:43:30Z", "2026-10", "2026", "October 27, 2026", "27 October 2026". */
export function parseDate(value: string | undefined): DateParts | null {
  const s = value?.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (m) {
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDay(year, month, day) ? { year, month, day } : null;
  }
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { year: Number(m[1]), month: Number(m[2]) };
  m = /^(\d{4})$/.exec(s);
  if (m) return { year: Number(m[1]) };
  const monthIndex = (name: string) => MONTHS.findIndex((full) => full.toLowerCase().startsWith(name.toLowerCase().replace(/\.$/, "").slice(0, 3)));
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/.exec(s);
  if (m && monthIndex(m[1]) >= 0) {
    const [year, month, day] = [Number(m[3]), monthIndex(m[1]) + 1, Number(m[2])];
    return validDay(year, month, day) ? { year, month, day } : null;
  }
  m = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})$/.exec(s);
  if (m && monthIndex(m[2]) >= 0) {
    const [year, month, day] = [Number(m[3]), monthIndex(m[2]) + 1, Number(m[1])];
    return validDay(year, month, day) ? { year, month, day } : null;
  }
  return null;
}

const SITE_SEPARATORS = [" | ", " – ", " — ", " :: ", " · "];

/**
 * Splits "Page title | Site name" into its parts. A plain " - " only counts when it leaves two
 * parts and the last one is short (so "Step 1 - Apply for funding" stays whole).
 */
export function splitTitle(raw: string): { title: string; site: string | null } {
  const whole = raw.replace(/\s+/g, " ").trim();
  for (const sep of SITE_SEPARATORS) {
    if (!whole.includes(sep)) continue;
    const parts = whole.split(sep).map((p) => p.trim()).filter(Boolean);
    const site = parts.at(-1)!;
    const title = parts.slice(0, -1).join(sep).trim();
    if (parts.length >= 2 && site.length <= 60 && title.length >= 3) return { title, site };
  }
  const dash = whole.split(" - ");
  if (dash.length === 2 && dash[1].length <= 40 && dash[0].length >= 3 && /^[A-Z0-9]/.test(dash[1])) {
    return { title: dash[0].trim(), site: dash[1].trim() };
  }
  return { title: whole, site: null };
}

export function siteFromDomain(domain: string): string {
  return domain.trim().replace(/^www\./i, "");
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const endsWithMark = (s: string) => /[.?!]$/.test(s);
/** Text followed by `mark`, unless it already ends in . ? or ! (then no extra mark). */
const closeWith = (s: string, mark: string) => (endsWithMark(s) ? s : `${s}${mark}`);
const withoutProtocol = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

function mlaDate(d: DateParts): string {
  if (d.day && d.month) return `${d.day} ${MLA_MONTHS[d.month - 1]} ${d.year}`;
  if (d.month) return `${MLA_MONTHS[d.month - 1]} ${d.year}`;
  return String(d.year);
}
function apaDate(d: DateParts): string {
  if (d.day && d.month) return `${d.year}, ${MONTHS[d.month - 1]} ${d.day}`;
  if (d.month) return `${d.year}, ${MONTHS[d.month - 1]}`;
  return String(d.year);
}
function usDate(d: DateParts): string {
  if (d.day && d.month) return `${MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
  if (d.month) return `${MONTHS[d.month - 1]} ${d.year}`;
  return String(d.year);
}
function ieeeDate(d: DateParts): string {
  if (d.day && d.month) return `${IEEE_MONTHS[d.month - 1]} ${d.day}, ${d.year}`;
  if (d.month) return `${IEEE_MONTHS[d.month - 1]} ${d.year}`;
  return String(d.year);
}
function ukDate(d: DateParts): string {
  if (d.day && d.month) return `${d.day} ${MONTHS[d.month - 1]} ${d.year}`;
  if (d.month) return `${MONTHS[d.month - 1]} ${d.year}`;
  return String(d.year);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function render(number: number, segments: Segment[]): Citation {
  const parts = segments.filter((s) => s.text !== "");
  return {
    number,
    segments: parts,
    text: parts.map((s) => s.text).join(""),
    html: parts.map((s) => (s.italic ? `<i>${escapeHtml(s.text)}</i>` : escapeHtml(s.text))).join(""),
  };
}

/** Sort key: title without opening quotes or a leading article (A, An, The). */
function titleKey(title: string): string {
  return title
    .replace(/^[“"'‘]+/, "")
    .replace(/^(a|an|the)\s+/i, "")
    .toLowerCase();
}

interface Prepared {
  source: CitationSource;
  title: string;
  site: string;
  date: DateParts | null;
}

function prepare(source: CitationSource): Prepared {
  const split = splitTitle(source.title || "");
  const site = split.site ?? siteFromDomain(source.domain);
  const title = split.title || site;
  return { source, title, site, date: parseDate(source.publishedAt) };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/** MLA 9, web page with no author: “Title.” Website, Day Mon. Year, URL. [Accessed Day Mon. Year.] */
function mla(p: Prepared, accessed: DateParts): Citation {
  const segs: Segment[] = [{ text: `“${closeWith(p.title, ".")}” ` }, { text: p.site, italic: true }];
  if (p.date) segs.push({ text: `, ${mlaDate(p.date)}` });
  if (p.source.url) segs.push({ text: `, ${withoutProtocol(p.source.url)}` });
  segs.push({ text: "." });
  if (!p.date) segs.push({ text: ` Accessed ${mlaDate(accessed)}.` });
  return render(p.source.number, segs);
}

/**
 * APA 7, webpage with no author: Title in italics. (Year, Month Day). Site Name. URL
 * Undated: Title. (n.d.). Site Name. Retrieved Month Day, Year, from URL
 */
function apa(p: Prepared, accessed: DateParts): Citation {
  const segs: Segment[] = [{ text: closeWith(p.title, ""), italic: true }];
  if (!endsWithMark(p.title)) segs.push({ text: "." });
  segs.push({ text: ` (${p.date ? apaDate(p.date) : "n.d."}). ` });
  segs.push({ text: `${closeWith(p.site, ".")}` });
  if (p.source.url) {
    segs.push({ text: p.date ? ` ${p.source.url}` : ` Retrieved ${usDate(accessed)}, from ${p.source.url}` });
  }
  return render(p.source.number, segs);
}

/** Chicago 17 bibliography, web page with no author: “Title.” Website. Month Day, Year. URL. */
function chicago(p: Prepared, accessed: DateParts): Citation {
  const segs: Segment[] = [{ text: `“${closeWith(p.title, ".")}” ` }, { text: closeWith(p.site, ".") }];
  segs.push({ text: p.date ? ` ${usDate(p.date)}.` : ` Accessed ${usDate(accessed)}.` });
  if (p.source.url) segs.push({ text: ` ${p.source.url}.` });
  return render(p.source.number, segs);
}

/** Harvard (Cite Them Right): Site (Year) Title in italics. Available at: URL (Accessed: Day Month Year). */
function harvard(p: Prepared, accessed: DateParts, yearLabel: string): Citation {
  const segs: Segment[] = [{ text: `${p.site} (${yearLabel}) ` }, { text: closeWith(p.title, ""), italic: true }];
  if (!endsWithMark(p.title)) segs.push({ text: "." });
  if (p.source.url) segs.push({ text: ` Available at: ${p.source.url}` });
  segs.push({ text: ` (Accessed: ${ukDate(accessed)}).` });
  return render(p.source.number, segs);
}

/** IEEE, website: [n] “Title,” Website, Mon. Day, Year. Accessed: Mon. Day, Year. [Online]. Available: URL */
function ieee(p: Prepared, accessed: DateParts): Citation {
  const title = endsWithMark(p.title) ? `“${p.title}”` : `“${p.title},”`;
  const segs: Segment[] = [{ text: `[${p.source.number}] ${title} ` }, { text: p.site }];
  segs.push({ text: p.date ? `, ${ieeeDate(p.date)}. ` : ". " });
  segs.push({ text: `Accessed: ${ieeeDate(accessed)}.` });
  if (p.source.url) segs.push({ text: ` [Online]. Available: ${p.source.url}` });
  return render(p.source.number, segs);
}

/** The reference list for `style`, in that style's order. `accessed` is when the pages were read. */
export function formatCitations(style: CitationStyle, sources: CitationSource[], accessed: Date): Citation[] {
  const when: DateParts = { year: accessed.getFullYear(), month: accessed.getMonth() + 1, day: accessed.getDate() };
  const prepared = sources.map(prepare);
  const byTitle = (a: Prepared, b: Prepared) =>
    titleKey(a.title).localeCompare(titleKey(b.title)) || (a.date?.year ?? 0) - (b.date?.year ?? 0) || a.source.number - b.source.number;

  switch (style) {
    case "mla":
      return [...prepared].sort(byTitle).map((p) => mla(p, when));
    case "apa":
      return [...prepared].sort(byTitle).map((p) => apa(p, when));
    case "chicago":
      return [...prepared].sort(byTitle).map((p) => chicago(p, when));
    case "ieee":
      return [...prepared].sort((a, b) => a.source.number - b.source.number).map((p) => ieee(p, when));
    case "harvard": {
      const sorted = [...prepared].sort(
        (a, b) =>
          a.site.toLowerCase().localeCompare(b.site.toLowerCase()) ||
          (a.date?.year ?? -1) - (b.date?.year ?? -1) ||
          titleKey(a.title).localeCompare(titleKey(b.title)),
      );
      // Same site and year more than once: 2026a, 2026b (and "no date a", "no date b").
      const groups = new Map<string, Prepared[]>();
      for (const p of sorted) {
        const key = `${p.site.toLowerCase()}|${p.date?.year ?? "nd"}`;
        groups.set(key, [...(groups.get(key) ?? []), p]);
      }
      return sorted.map((p) => {
        const group = groups.get(`${p.site.toLowerCase()}|${p.date?.year ?? "nd"}`)!;
        const base = p.date ? String(p.date.year) : "no date";
        const suffix = group.length > 1 ? `${p.date ? "" : " "}${String.fromCharCode(97 + group.indexOf(p))}` : "";
        return harvard(p, when, `${base}${suffix}`);
      });
    }
  }
}
