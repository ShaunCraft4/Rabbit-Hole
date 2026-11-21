"use client";

import { useState, type FormEvent } from "react";
import { Clock, Minus, Search, Split } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/client/api";
import { investigateGap } from "@/lib/client/runner";
import { ROOT_NODE_ID, branchNodeId, claimNodeId } from "@/lib/graph/build";
import type { Branch, Claim, EvidenceStatus, Gap, GapKind, Investigation, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useInvestigationStore } from "@/stores/investigation";

import { ConnectionsPanel } from "./ConnectionsPanel";
import {
  GAP_KIND_LABEL,
  countPhrase,
  evidenceBadge,
  evidenceExplanation,
  formatPublished,
  investigationCounts,
  retrievalLabel,
  safeHttpUrl,
} from "./copy";
import { useSelectNode } from "./use-select-node";

const GAP_ICON: Record<GapKind, LucideIcon> = {
  missing: Search,
  conflict: Split,
  outdated: Clock,
  weak: Minus,
};

const EVIDENCE_BADGE_CLASS: Record<EvidenceStatus, string> = {
  corroborated: "border-golden text-golden",
  conflicting: "border-amber-300 text-amber-100",
  outdated: "border-paper/30 text-paper/80",
  snippet_only: "border-paper/30 text-paper/80",
  single_source: "border-paper/30 text-paper",
};

const BRANCH_STATUS: Record<Branch["status"], string> = {
  idle: "Idle",
  running: "Searching",
  done: "Done",
  failed: "Failed",
};

type Selection =
  | { kind: "none" }
  | { kind: "root" }
  | { kind: "branch"; id: string }
  | { kind: "claim"; id: string }
  | { kind: "gap"; id: string }
  | { kind: "unknown" };

function parseSelection(nodeId: string | null): Selection {
  if (!nodeId) return { kind: "none" };
  if (nodeId === ROOT_NODE_ID) return { kind: "root" };
  if (nodeId.startsWith("branch:")) return { kind: "branch", id: nodeId.slice("branch:".length) };
  if (nodeId.startsWith("claim:")) return { kind: "claim", id: nodeId.slice("claim:".length) };
  if (nodeId.startsWith("gap:")) return { kind: "gap", id: nodeId.slice("gap:".length) };
  return { kind: "unknown" };
}

export function DiscoveryPanel() {
  const investigation = useInvestigationStore((state) => state.investigation);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const selectNode = useSelectNode();

  if (!investigation) return null;
  const selection = parseSelection(selectedNodeId);

  return (
    <section aria-label="Discovery" className="flex flex-col gap-6 p-5">
      {selection.kind === "root" ? <RootDetail investigation={investigation} /> : null}
      {selection.kind === "branch" ? <BranchDetail investigation={investigation} branchId={selection.id} /> : null}
      {selection.kind === "claim" ? <ClaimDetail investigation={investigation} claimId={selection.id} /> : null}
      {selection.kind === "gap" ? <GapDetail gapId={selection.id} /> : null}
      {selection.kind === "none" ? <EmptyDetail onShowRoot={() => selectNode(ROOT_NODE_ID)} /> : null}
      {selection.kind === "unknown" ? <MissingDetail /> : null}
      {selection.kind === "claim" ? null : <ConnectionsPanel hideWhenEmpty={selection.kind !== "root"} />}
    </section>
  );
}

function EmptyDetail({ onShowRoot }: { onShowRoot: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-heading text-3xl text-paper">Discovery</h2>
      <p className="text-sm leading-6 text-paper/75">Select a door, a finding, or a gap on the map or in the list.</p>
      <Button type="button" variant="outline" className="w-fit cursor-pointer" onClick={onShowRoot}>
        Show the whole dream
      </Button>
    </div>
  );
}

function MissingDetail() {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-heading text-3xl text-paper">Discovery</h2>
      <p className="text-sm leading-6 text-paper/75">That part of the map is no longer in this dream.</p>
    </div>
  );
}

function RootDetail({ investigation }: { investigation: Investigation }) {
  const counts = investigationCounts(investigation);

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs tracking-[0.18em] text-golden uppercase">The dream</p>
      <h2 className="font-heading text-3xl leading-snug break-words text-paper">{investigation.question}</h2>
      {investigation.assumptions.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {investigation.assumptions.map((assumption, index) => (
            <li key={index} className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/80">
              {assumption}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-paper/70">No assumptions were stated.</p>
      )}
      <dl className="grid grid-cols-2 gap-2">
        <Count label="Sources" value={countPhrase(counts.sources, "source", "sources")} />
        <Count label="Read in full" value={countPhrase(counts.sourcesRead, "source", "sources")} />
        <Count label="Verified claims" value={String(counts.verifiedClaims)} />
        <Count label="Rejected claims" value={String(counts.rejectedClaims)} />
        <Count label="Open gaps" value={String(counts.openGaps)} />
      </dl>
      <p className="text-sm leading-6 text-paper/75">
        Select a door, a finding, or a gap. Use the list when the map is crowded. Accept a connection to keep it, or
        dismiss it to take it off the map.
      </p>
    </div>
  );
}

function Count({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-paper/15 bg-midnight/30 px-3 py-2">
      <dt className="text-xs text-paper/60">{label}</dt>
      <dd className="text-sm text-paper">{value}</dd>
    </div>
  );
}

function BranchDetail({ investigation, branchId }: { investigation: Investigation; branchId: string }) {
  const branch = investigation.branches.find((item) => item.id === branchId);
  const error = useInvestigationStore((state) => state.branchErrors[branchId]);
  if (!branch) return <MissingDetail />;

  const findings = investigation.claims.filter((claim) => claim.verified && claim.branchId === branch.id).length;

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs tracking-[0.18em] text-golden uppercase">Door</p>
      <h2 className="font-heading text-3xl leading-snug break-words text-paper">{branch.title}</h2>
      <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/85">{branch.question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-paper/30 text-paper">
          {BRANCH_STATUS[branch.status]}
        </Badge>
        <p className="text-sm text-paper/75">{countPhrase(findings, "finding", "findings")}</p>
      </div>
      {branch.queries.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-paper/80">Search queries</h3>
          <ul className="flex flex-col gap-1">
            {branch.queries.map((query, index) => (
              <li key={index} className="font-mono text-xs leading-5 break-words text-paper/75">
                {query}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm leading-6 break-words text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ClaimDetail({ investigation, claimId }: { investigation: Investigation; claimId: string }) {
  const claim = investigation.claims.find((item) => item.id === claimId);
  if (!claim) return <MissingDetail />;
  const source = investigation.sources.find((item) => item.id === claim.sourceId);

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-xs tracking-[0.18em] text-golden uppercase">Finding</p>
      <h2 className="font-heading text-3xl leading-snug break-words text-paper">{claim.text}</h2>
      <div className="flex flex-col gap-1.5">
        <Badge variant="outline" className={cn("w-fit", EVIDENCE_BADGE_CLASS[claim.evidenceStatus])}>
          {evidenceBadge(claim.evidenceStatus)}
        </Badge>
        <p className="text-sm leading-6 text-paper/80">{evidenceExplanation(claim.evidenceStatus)}</p>
      </div>
      <div className="flex flex-col gap-2">
        {claim.verified ? (
          <Badge variant="outline" className="w-fit border-golden text-golden">
            Verified quote
          </Badge>
        ) : (
          <p className="text-sm text-paper/70">This quote was not verified against the page.</p>
        )}
        <blockquote className="border-l-2 border-golden bg-midnight/40 px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-paper">
          {claim.excerpt}
        </blockquote>
      </div>
      <SourcesList source={source} />
      <ConnectionsPanel claimId={claim.id} />
    </div>
  );
}

function SourcesList({ source }: { source: Source | undefined }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-paper/80">Sources</h3>
      {source ? (
        <ul className="flex flex-col gap-2">
          <li>
            <SourceCard source={source} />
          </li>
        </ul>
      ) : (
        <p className="text-sm leading-6 text-paper/70">The source for this finding is not in this dream.</p>
      )}
    </div>
  );
}

function SourceCard({ source }: { source: Source }) {
  const href = safeHttpUrl(source.url);
  const published = source.publishedAt?.trim() ? formatPublished(source.publishedAt) : "";
  const failed = source.retrievalStatus === "failed";

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-paper/15 bg-midnight/35 p-3">
      <h4 className="text-sm leading-5 break-words text-paper">{source.title}</h4>
      <p className="font-mono text-xs break-all text-paper/70">{source.domain}</p>
      {published ? <p className="text-xs text-paper/70">Published {published}</p> : null}
      <Badge variant="outline" className={cn("w-fit", failed ? "border-destructive text-destructive" : "border-paper/30 text-paper")}>
        {retrievalLabel(source.retrievalStatus)}
      </Badge>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit text-sm text-golden underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
        >
          Open source
          <span className="sr-only"> {source.title}</span>
        </a>
      ) : (
        <p className="text-xs text-paper/60">No page link is available.</p>
      )}
    </article>
  );
}

function GapDetail({ gapId }: { gapId: string }) {
  const gap = useInvestigationStore((state) => state.investigation?.gaps.find((item) => item.id === gapId));
  if (!gap) return <MissingDetail />;
  return <GapBody key={gap.id} gap={gap} />;
}

function GapBody({ gap }: { gap: Gap }) {
  const claims = useInvestigationStore((state) => state.investigation?.claims ?? []);
  const dismissReason = useInvestigationStore((state) => state.dismissReasons[gap.id]);
  const setGapStatus = useInvestigationStore((state) => state.setGapStatus);
  const setBranchStatus = useInvestigationStore((state) => state.setBranchStatus);
  const selectNode = useSelectNode();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Claim[]>([]);
  const [followed, setFollowed] = useState(false);

  const Icon = GAP_ICON[gap.kind];
  const involved = gap.claimIds
    .map((id) => claims.find((claim) => claim.id === id))
    .filter((claim): claim is Claim => Boolean(claim));

  async function onInvestigate() {
    setRunning(true);
    setFollowUpError(null);
    setFollowUpNote(null);
    setAdded([]);
    setFollowed(false);
    const before = new Set(useInvestigationStore.getState().investigation?.claims.map((claim) => claim.id) ?? []);
    const branchId = gap.branchId ?? "gap";
    const existed = useInvestigationStore.getState().investigation?.branches.some((branch) => branch.id === branchId) ?? false;
    try {
      const response = await investigateGap(gap.id);
      const fresh = response.claims.filter((claim) => !before.has(claim.id));
      setAdded(fresh);
      setFollowUpNote(response.note?.trim() || null);
      setFollowed(true);
      const failed = response.status === "failed";
      if (!existed) {
        setBranchStatus(response.branchId, failed ? "failed" : "done", failed ? response.note : undefined);
      }
      if (failed && fresh.length === 0) {
        setFollowUpError(response.note?.trim() || "This search did not return new findings.");
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "This gap could not be investigated.";
      setFollowUpError(message);
      if (!existed) {
        const branch = useInvestigationStore.getState().investigation?.branches.find((item) => item.id === branchId);
        if (branch) setBranchStatus(branch.id, "failed", message);
      }
    } finally {
      setRunning(false);
    }
  }

  function onDismiss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = reason.trim();
    if (!next) {
      setReasonError("Add a one-line reason.");
      return;
    }
    setGapStatus(gap.id, "dismissed", next);
    setDismissing(false);
    setReasonError(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="flex items-center gap-1.5 font-mono text-xs tracking-[0.14em] text-mystic uppercase">
        <Icon className="size-3.5" aria-hidden />
        {GAP_KIND_LABEL[gap.kind]}
        {gap.status === "resolved" ? <span className="text-paper/60">· Resolved</span> : null}
        {gap.status === "dismissed" ? <span className="text-paper/60">· Dismissed</span> : null}
      </p>
      <h2 className="font-heading text-3xl leading-snug break-words text-paper">{gap.question}</h2>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-paper/80">Why it matters</h3>
        <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/85">{gap.whyItMatters}</p>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-paper/80">Involved findings</h3>
        {involved.length === 0 ? (
          <p className="text-sm text-paper/70">No findings are linked to this gap.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {involved.map((claim) => (
              <li key={claim.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer rounded-full border border-paper/20 px-3 py-1.5 text-left text-sm leading-5 break-words text-paper hover:border-golden/60 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                  onClick={() => selectNode(claimNodeId(claim.id))}
                >
                  {claim.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {gap.suggestedQuery?.trim() ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-paper/80">Suggested query</h3>
          <p className="font-mono text-xs leading-5 break-words text-paper/75">{gap.suggestedQuery}</p>
        </div>
      ) : null}

      {gap.status === "dismissed" ? (
        <p className="text-sm leading-6 break-words text-paper/75">
          {dismissReason ? `Dismissed. ${dismissReason}` : "Dismissed."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" className="w-fit cursor-pointer" disabled={running} onClick={() => void onInvestigate()}>
            {running ? "Investigating…" : "Investigate this gap"}
          </Button>
          {running ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <div className="h-1 overflow-hidden rounded-full bg-paper/15" role="progressbar" aria-label="Investigating this gap">
                <div className="status-pulse h-full w-1/3 bg-golden" />
              </div>
              <p className="text-sm text-paper/75" aria-live="polite">
                Investigating this gap…
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {gap.status === "resolved" ? (
              <p className="text-sm text-paper/75">Marked resolved.</p>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="cursor-pointer"
                onClick={() => setGapStatus(gap.id, "resolved")}
              >
                Mark resolved
              </Button>
            )}
            {dismissing ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="cursor-pointer"
                onClick={() => {
                  setDismissing(true);
                  setReasonError(null);
                }}
              >
                Dismiss
              </Button>
            )}
          </div>
          {dismissing ? (
            <form className="flex flex-col gap-2" onSubmit={onDismiss}>
              <label htmlFor={`dismiss-${gap.id}`} className="text-sm text-paper/80">
                Why dismiss this gap?
              </label>
              <Input
                id={`dismiss-${gap.id}`}
                value={reason}
                maxLength={300}
                onChange={(event) => setReason(event.target.value)}
              />
              {reasonError ? (
                <p role="alert" className="text-sm text-destructive">
                  {reasonError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="cursor-pointer">
                  Dismiss gap
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => {
                    setDismissing(false);
                    setReasonError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}

      {followUpError ? (
        <p role="alert" className="text-sm leading-6 break-words text-destructive">
          {followUpError}
        </p>
      ) : null}
      {followed && !followUpError ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          {followUpNote ? <p className="text-sm leading-6 break-words text-paper/75">{followUpNote}</p> : null}
          {added.length > 0 ? (
            <>
              <h3 className="text-sm font-medium text-paper/80">New findings</h3>
              <ul className="flex flex-col gap-1.5">
                {added.map((claim) => (
                  <li key={claim.id}>
                    <button
                      type="button"
                      className="w-full cursor-pointer rounded-lg border border-paper/20 px-3 py-2 text-left text-sm leading-5 break-words text-paper hover:border-golden/60 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                      onClick={() => selectNode(claimNodeId(claim.id))}
                    >
                      {claim.text}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm leading-6 text-paper/75">No new findings were added.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
