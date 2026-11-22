import type { ConnectionRelationship, EvidenceStatus, GapKind, Investigation, RetrievalStatus } from "@/lib/types";

/** Only http(s) URLs may become links. Everything else is omitted. */
export function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url.href;
}

export const BROWSER_READ_LABEL = "Read with a live browser";

export const BROWSER_READ_TOOLTIP =
  "The search tool could not read this page, so a cloud browser (Solari) opened it. Quotes are still verified against the page text.";

export function investigationCounts(investigation: Investigation) {
  return {
    sources: investigation.sources.length,
    sourcesRead: investigation.sources.filter((source) => source.retrievalStatus === "full_text").length,
    browserSources: investigation.sources.filter((source) => source.retrievedVia === "browser").length,
    verifiedClaims: investigation.claims.filter((claim) => claim.verified).length,
    rejectedClaims: investigation.rejectedClaims,
    openGaps: investigation.gaps.filter((gap) => gap.status === "open").length,
  };
}

export function countPhrase(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const EVIDENCE_BADGE: Record<EvidenceStatus, string> = {
  corroborated: "Corroborated",
  conflicting: "Conflicting",
  outdated: "Outdated",
  snippet_only: "Snippet only",
  single_source: "Single source",
};

const EVIDENCE_EXPLANATION: Record<EvidenceStatus, string> = {
  corroborated: "Corroborated by at least 2 independent sources",
  conflicting: "Conflicting evidence",
  outdated: "May describe a past cycle",
  snippet_only: "Only a search snippet was read",
  single_source: "Supported by one source",
};

export function evidenceBadge(status: EvidenceStatus): string {
  return EVIDENCE_BADGE[status];
}

export function evidenceExplanation(status: EvidenceStatus): string {
  return EVIDENCE_EXPLANATION[status];
}

const RETRIEVAL_LABEL: Record<RetrievalStatus, string> = {
  full_text: "Full text",
  snippet_only: "Snippet only",
  failed: "Failed",
};

export function retrievalLabel(status: RetrievalStatus): string {
  return RETRIEVAL_LABEL[status];
}

export const GAP_KIND_LABEL: Record<GapKind, string> = {
  missing: "Missing",
  conflict: "Conflict",
  outdated: "Outdated",
  weak: "Weak",
};

export const RELATIONSHIP_LABEL: Record<ConnectionRelationship, string> = {
  supports: "supports",
  contradicts: "contradicts",
  depends_on: "depends on",
  related_to: "related to",
};

export function relationshipLabel(relationship: string): string {
  if (relationship in RELATIONSHIP_LABEL) {
    return RELATIONSHIP_LABEL[relationship as ConnectionRelationship];
  }
  return relationship.replaceAll("_", " ");
}

/**
 * "2026-10-27" or a timestamp like "2026-10-27T18:43:30Z" -> "Oct 27, 2026" (the calendar day as
 * written, ignoring the time). Anything else is shown as entered.
 */
export function formatPublished(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(trimmed);
  if (!match) return trimmed;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return trimmed;
  }
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}
