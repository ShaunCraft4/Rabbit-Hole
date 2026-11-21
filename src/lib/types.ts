/**
 * Rabbit Hole shared data types (docs/BLUEPRINT.md section 10).
 *
 * FROZEN CONTRACT. Do not edit without the CONTRACT protocol
 * (post "CONTRACT: <what> because <why>", the other person replies "ok",
 * then the Engine owner makes the change and pushes to main).
 *
 * Runtime validation for these types lives in src/lib/contracts.ts.
 */

export type NodeType = "root" | "branch" | "discovery" | "gap";

export type EvidenceStatus =
  | "single_source"
  | "corroborated"
  | "conflicting"
  | "outdated"
  | "snippet_only";

export type RetrievalStatus = "full_text" | "snippet_only" | "failed";

/** How a source's text was obtained: Keenable search/fetch, or the Solari cloud-browser fallback. */
export type RetrievedVia = "keenable" | "browser";

export interface Source {
  id: string;
  url: string;
  domain: string;
  title: string;
  retrievalStatus: RetrievalStatus;
  publishedAt?: string;
  /**
   * SERVER-ONLY. The retrieved page text used for extraction and quote verification.
   * It must never be sent to the client: every API response uses PublicSource
   * (src/lib/contracts.ts), which rejects this field.
   */
  text?: string;
  snippet?: string;
  retrievedVia?: RetrievedVia;
}

export interface Claim {
  id: string;
  branchId: string;
  text: string;
  excerpt: string;
  sourceId: string;
  /** Result of verifyExcerpt (the excerpt was found verbatim in the source text). */
  verified: boolean;
  evidenceStatus: EvidenceStatus;
  dateMentioned?: string;
}

export type GapKind = "missing" | "conflict" | "outdated" | "weak";

export type GapStatus = "open" | "resolved" | "dismissed";

export interface Gap {
  id: string;
  branchId?: string;
  question: string;
  whyItMatters: string;
  kind: GapKind;
  claimIds: string[];
  suggestedQuery?: string;
  status: GapStatus;
}

export type ConnectionRelationship =
  | "supports"
  | "contradicts"
  | "depends_on"
  | "related_to";

export interface Connection {
  id: string;
  /** Claim id. */
  from: string;
  /** Claim id. */
  to: string;
  relationship: ConnectionRelationship;
  explanation: string;
  accepted?: boolean;
}

export type BranchStatus = "idle" | "running" | "done" | "failed";

/** One item of Investigation.branches. */
export interface Branch {
  id: string;
  title: string;
  question: string;
  queries: string[];
  status: BranchStatus;
}

/** The Golden Key report (BLUEPRINT section 7). Every id must exist in the investigation. */
export type Report = {
  directAnswer: string;
  keyDiscoveries: { claimId: string; summary: string }[];
  planChangingConnections: { connectionId: string; text: string }[];
  uncertainties: { gapId?: string; text: string }[];
  nextSteps: { step: string; reason?: string }[];
};

export interface Investigation {
  id: string;
  question: string;
  assumptions: string[];
  branches: Branch[];
  sources: Source[];
  claims: Claim[];
  gaps: Gap[];
  connections: Connection[];
  report?: Report | undefined;
  rejectedClaims: number;
}
