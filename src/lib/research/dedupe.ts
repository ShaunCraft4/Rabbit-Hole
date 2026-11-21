/**
 * URL normalization, stable source ids, de-duplication and source ranking.
 */
import { createHash } from "node:crypto";

/** Query parameters that only track clicks and never change the page. */
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "igshid", "mc_cid", "mc_eid", "mkt_tok", "_ga", "_gl", "_hsenc", "_hsmi", "hsctatracking",
  "ref", "ref_src", "ref_url", "referrer", "source", "spm", "si", "s_kwcid", "trk", "vero_id",
  "oly_anon_id", "oly_enc_id", "rb_clickid", "cmpid",
]);

const isTrackingParam = (key: string) => {
  const k = key.toLowerCase();
  return k.startsWith("utm_") || k.startsWith("pk_") || TRACKING_PARAMS.has(k);
};

/**
 * Canonical form of a URL: http(s) only, lowercase host, no default port, no fragment,
 * no tracking parameters, sorted query, no trailing slash. Returns null for anything
 * that is not a valid http(s) URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!url.hostname) return null;

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([a], [b]) => a.localeCompare(b));
  const search = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";

  const path = url.pathname.replace(/\/+$/, "");
  const port = url.port ? `:${url.port}` : ""; // URL already drops default ports
  return `${url.protocol}//${url.hostname.toLowerCase()}${port}${path}${search}`;
}

/** Host without a leading "www.", lowercase. Empty string for invalid URLs. */
export function domainOf(raw: string): string {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Key under which two URLs count as the same page (also ignores http vs https and www.). */
function dedupeKey(raw: string): string | null {
  const normalized = normalizeUrl(raw);
  if (!normalized) return null;
  return normalized.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/** Stable short id for a page, e.g. "src_3f9a1c2e0b". Same page, same id, in every branch. */
export function sourceIdFromUrl(raw: string): string {
  const key = dedupeKey(raw) ?? raw.trim().toLowerCase();
  return `src_${createHash("sha256").update(key).digest("hex").slice(0, 10)}`;
}

/** Removes duplicate pages (by normalized URL), keeping the first occurrence. Drops invalid URLs. */
export function dedupeHits<T extends { url: string }>(hits: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const hit of hits) {
    const key = dedupeKey(hit.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

const FORUM_AND_SOCIAL_DOMAINS = [
  "reddit.com", "quora.com", "facebook.com", "instagram.com", "tiktok.com", "x.com", "twitter.com",
  "threads.net", "linkedin.com", "pinterest.com", "youtube.com", "discord.com", "discord.gg",
  "tumblr.com", "snapchat.com", "collegeconfidential.com", "studentdoctor.net", "ratemyprofessors.com",
  "niche.com", "glassdoor.com", "fishbowlapp.com", "teamblind.com", "chegg.com", "coursehero.com",
  "answers.com", "answers.yahoo.com",
];

const BLOG_DOMAINS = ["medium.com", "substack.com", "blogspot.com", "wordpress.com", "tumblr.com"];

const matchesDomain = (domain: string, list: string[]) =>
  list.some((d) => domain === d || domain.endsWith(`.${d}`));

export type DomainKind = "official" | "organization" | "forum" | "blog" | "other";

/**
 * Rough trust class of a domain. Official = government, education, military or an
 * academic/government second-level domain (.ac.uk, .gov.au, .edu.au, ...).
 * Forums and social sites are experience, not proof.
 */
export function classifyDomain(rawDomainOrUrl: string): { kind: DomainKind; forumPath: boolean } {
  const domain = rawDomainOrUrl.includes("/") ? domainOf(rawDomainOrUrl) : rawDomainOrUrl.toLowerCase();
  let forumPath = false;
  if (rawDomainOrUrl.includes("/")) {
    try {
      const { pathname } = new URL(rawDomainOrUrl);
      forumPath = /\/(forum|forums|community|discussions?|threads?|t)\//i.test(pathname);
    } catch {
      forumPath = false;
    }
  }
  if (
    /\.(edu|gov|mil)$/.test(domain) ||
    /\.(gov|edu|ac|mil|gob|gouv)\.[a-z]{2}$/.test(domain) ||
    /(^|\.)(europa\.eu|int)$/.test(domain)
  ) {
    return { kind: "official", forumPath };
  }
  if (matchesDomain(domain, FORUM_AND_SOCIAL_DOMAINS) || /^(forum|forums|community|discuss)\./.test(domain)) {
    return { kind: "forum", forumPath };
  }
  if (matchesDomain(domain, BLOG_DOMAINS) || /^blog\./.test(domain)) return { kind: "blog", forumPath };
  if (/\.org$/.test(domain)) return { kind: "organization", forumPath };
  return { kind: "other", forumPath };
}

const KIND_SCORE: Record<DomainKind, number> = {
  official: 3,
  organization: 1,
  other: 0,
  blog: -1,
  forum: -3,
};

/**
 * Orders hits best-first: official domains first, forums and social sites last, and within a
 * class the search engine's own order (rank) wins. Stable for equal scores.
 * Hits may carry `rank` (0-based position in their query's results).
 */
export function rankHits<T extends { url: string; rank?: number }>(hits: T[]): T[] {
  return hits
    .map((hit, index) => {
      const { kind, forumPath } = classifyDomain(hit.url);
      const score = KIND_SCORE[kind] - (forumPath ? 2 : 0) - 0.25 * (hit.rank ?? 0);
      return { hit, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ hit }) => hit);
}
