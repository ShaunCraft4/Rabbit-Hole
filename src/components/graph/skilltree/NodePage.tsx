"use client";

import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

import { BrowserReadBadge } from "@/components/BrowserReadBadge";
import { BranchActivity, doorEmptyCopy } from "@/components/panels/BranchActivity";
import { GapFollowUp } from "@/components/panels/GapFollowUp";
import {
  evidenceBadge,
  formatPublished,
  relationshipLabel,
  retrievalLabel,
  safeHttpUrl,
} from "@/components/panels/copy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NodePage as SkillNodePage, NodeRef, SourceRef } from "@/lib/skilltree";
import type { BranchStatus, EvidenceStatus, GapKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useInvestigationStore } from "@/stores/investigation";

import { regionVar } from "./colors";

const KIND_LABEL: Record<SkillNodePage["kind"], string> = {
  start: "The dream",
  door: "Door",
  finding: "Finding",
  gap: "Gap",
};

const BRANCH_STATUS: Record<BranchStatus, string> = {
  idle: "Idle",
  running: "Searching",
  done: "Done",
  failed: "Failed",
};

const EVIDENCE_ORDER: EvidenceStatus[] = ["corroborated", "single_source", "conflicting", "outdated", "snippet_only"];

const GAP_KIND_LABEL: Record<GapKind, string> = {
  missing: "Missing",
  conflict: "Conflict",
  outdated: "Outdated",
  weak: "Weak",
};

export function NodePage({
  page,
  onOpen,
  onZoomOut,
}: {
  page: SkillNodePage;
  onOpen: (id: string) => void;
  onZoomOut: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [page.id]);

  const accent = page.color ? regionVar(page.color) : "var(--golden-key)";

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="skill-node-page-title"
      className="dream-page-in absolute z-30 flex flex-col overflow-hidden border border-paper/15 bg-wonderland text-paper shadow-2xl max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[40%] max-md:rounded-t-2xl max-md:border-b-0 md:inset-y-3 md:right-3 md:w-[min(24rem,calc(100%-1.5rem))] md:rounded-2xl"
    >
      <div className="h-1 shrink-0" style={{ background: accent }} />
      <span className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-paper/30 md:hidden" aria-hidden />
      <header className="flex shrink-0 flex-col gap-3 px-4 pt-3 pb-3">
        <Button type="button" size="lg" className="h-11 w-full cursor-pointer text-base" onClick={onZoomOut}>
          <ArrowLeft aria-hidden />
          Zoom out
        </Button>
        <Breadcrumbs page={page} onOpen={onOpen} />
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: accent }}>
            {KIND_LABEL[page.kind]}
          </p>
          <h2
            key={page.id}
            id="skill-node-page-title"
            ref={headingRef}
            tabIndex={-1}
            className="dream-swap font-heading text-2xl leading-snug break-words text-paper outline-none"
          >
            {page.label}
          </h2>
        </div>
      </header>
      <div key={page.id} className="dream-swap flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pt-1 pb-5">
        {page.kind === "start" ? <StartBody page={page} onOpen={onOpen} /> : null}
        {page.kind === "door" ? <DoorBody page={page} onOpen={onOpen} /> : null}
        {page.kind === "finding" ? <FindingBody page={page} onOpen={onOpen} /> : null}
        {page.kind === "gap" ? <GapBody page={page} onOpen={onOpen} /> : null}
        <PageFooter page={page} onOpen={onOpen} />
      </div>
    </aside>
  );
}

function Breadcrumbs({ page, onOpen }: { page: SkillNodePage; onOpen: (id: string) => void }) {
  return (
    <nav aria-label="Trail">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {page.trail.map((crumb, index) => {
          const last = index === page.trail.length - 1;
          return (
            <li key={`${crumb.id}-${index}`} className="flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <span aria-hidden className="text-paper/40">
                  /
                </span>
              ) : null}
              {last ? (
                <span aria-current="page" className="text-xs break-words text-paper">
                  {crumb.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="cursor-pointer text-xs break-words text-paper/70 underline-offset-2 hover:text-golden hover:underline focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                  onClick={() => onOpen(crumb.id)}
                >
                  {crumb.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StartBody({ page, onOpen }: { page: Extract<SkillNodePage, { kind: "start" }>; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/90">{page.question}</p>
      {page.assumptions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-paper/80">Assumptions</h3>
          <ul className="flex flex-col gap-1.5">
            {page.assumptions.map((assumption, index) => (
              <li key={index} className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/80">
                {assumption}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-paper/70">No assumptions were stated.</p>
      )}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-paper/80">Doors</h3>
        {page.regions.length === 0 ? (
          <p className="text-sm text-paper/70">No doors yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {page.regions.map((region) => (
              <li key={region.id}>
                <button
                  type="button"
                  className="flex w-full cursor-pointer flex-col gap-0.5 rounded-xl border border-paper/15 px-3 py-2 text-left hover:border-golden/50 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                  onClick={() => onOpen(region.id)}
                >
                  <span className="flex items-center gap-2 text-sm break-words text-paper">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: regionVar(region.color) }} aria-hidden />
                    {region.title}
                  </span>
                  <span className="pl-4 text-xs text-paper/70">
                    {BRANCH_STATUS[region.status]} · {region.findingCount} {region.findingCount === 1 ? "finding" : "findings"} ·{" "}
                    {region.openGapCount} open {region.openGapCount === 1 ? "gap" : "gaps"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {page.directAnswer ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-golden/40 bg-midnight/40 px-3 py-2">
          <h3 className="font-mono text-[10px] tracking-[0.16em] text-golden uppercase">The Golden Key</h3>
          <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper">{page.directAnswer}</p>
        </div>
      ) : null}
      <dl className="grid grid-cols-2 gap-2">
        <Stat label="Findings" value={String(page.stats.findings)} />
        <Stat label="Sources" value={String(page.stats.sources)} />
        <Stat label="Open gaps" value={String(page.stats.openGaps)} />
        <Stat label="Links" value={String(page.stats.links)} />
        <Stat label="Rejected claims" value={String(page.stats.rejectedClaims)} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-paper/15 bg-midnight/30 px-3 py-2">
      <dt className="text-xs text-paper/75">{label}</dt>
      <dd className="text-sm text-paper">{value}</dd>
    </div>
  );
}

function DoorBody({ page, onOpen }: { page: Extract<SkillNodePage, { kind: "door" }>; onOpen: (id: string) => void }) {
  const evidence = EVIDENCE_ORDER.filter((status) => page.evidence[status] > 0);

  return (
    <div className="flex flex-col gap-4">
      {page.title !== page.label ? <p className="text-sm leading-6 break-words text-paper">{page.title}</p> : null}
      <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/90">{page.question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={cn("border-paper/30 text-paper", page.status === "failed" && "border-destructive text-destructive")}>
          {BRANCH_STATUS[page.status]}
        </Badge>
      </div>
      <BranchActivity branchId={page.branchId} title={page.title} />
      {page.queries.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-paper/80">Search queries</h3>
          <ul className="flex flex-col gap-1">
            {page.queries.map((query, index) => (
              <li key={index} className="font-mono text-xs leading-5 break-words text-paper/75">
                {query}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {evidence.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-paper/80">Evidence</h3>
          <ul className="flex flex-wrap gap-1.5">
            {evidence.map((status) => (
              <li key={status}>
                <Badge variant="outline" className="border-paper/30 text-paper">
                  {page.evidence[status]} {evidenceBadge(status)}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <NodeList title="Findings" nodes={page.findings} empty={doorEmptyCopy(page.status)} onOpen={onOpen} />
      <NodeList title="Gaps" nodes={page.gaps} empty="No gaps on this door." onOpen={onOpen} />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-paper/80">Sources</h3>
        {page.sources.length === 0 ? (
          <p className="text-sm text-paper/70">No sources yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.sources.map((source) => (
              <li key={source.id}>
                <SourceCard source={source} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FindingBody({ page, onOpen }: { page: Extract<SkillNodePage, { kind: "finding" }>; onOpen: (id: string) => void }) {
  const acceptConnection = useInvestigationStore((state) => state.acceptConnection);
  const dismissConnection = useInvestigationStore((state) => state.dismissConnection);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper">{page.text}</p>
      <div className="flex flex-col gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            "w-fit",
            page.evidenceStatus === "corroborated" && "border-golden text-golden",
            page.evidenceStatus === "conflicting" && "border-amber-300 text-amber-100",
          )}
        >
          {evidenceBadge(page.evidenceStatus)}
        </Badge>
        <p className="text-sm leading-6 text-paper/80">{page.evidenceNote}</p>
        {page.dateMentioned ? <p className="text-xs text-paper/70">Date mentioned: {page.dateMentioned}</p> : null}
      </div>
      <div className="flex flex-col gap-2">
        {page.verified ? (
          <Badge variant="outline" className="w-fit border-golden text-golden">
            Verified quote
          </Badge>
        ) : (
          <p className="text-sm text-paper/70">This quote was not verified against the page.</p>
        )}
        <blockquote className="border-l-2 border-golden bg-midnight/40 px-3 py-2 text-sm leading-6 break-words whitespace-pre-wrap text-paper">
          {page.excerpt}
        </blockquote>
      </div>
      {page.source ? <SourceCard source={page.source} /> : <p className="text-sm text-paper/70">The source for this finding is not in this dream.</p>}
      {page.keyDiscovery ? (
        <div className="flex flex-col gap-1.5 rounded-xl border border-golden/40 bg-midnight/40 px-3 py-2">
          <h3 className="font-mono text-[10px] tracking-[0.16em] text-golden uppercase">Key discovery</h3>
          <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper">{page.keyDiscovery}</p>
        </div>
      ) : null}
      <NodeList title="Same page" nodes={page.samePage} empty="" onOpen={onOpen} hideEmpty />
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-paper/80">Links</h3>
        {page.links.length === 0 ? (
          <p className="text-sm text-paper/70">No connection touches this finding yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {page.links.map((link) => (
              <li key={link.connectionId} className="flex flex-col gap-2 rounded-xl border border-paper/15 bg-midnight/35 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="border-golden/50 text-golden">
                    {relationshipLabel(link.relationship)}
                  </Badge>
                  {link.accepted ? (
                    <Badge variant="outline" className="border-golden text-golden">
                      Accepted
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-paper/30 text-paper/75">
                      Suggested
                    </Badge>
                  )}
                  {link.planChanging ? (
                    <Badge variant="outline" className="border-golden text-golden">
                      Plan-changing
                    </Badge>
                  ) : null}
                </div>
                <p className="text-sm leading-6 break-words text-paper/85">
                  {link.direction === "out" ? "This finding " : null}
                  {link.direction === "out" ? relationshipLabel(link.relationship) : null}{" "}
                  <button
                    type="button"
                    className="cursor-pointer text-left text-golden underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                    onClick={() => onOpen(link.other.id)}
                  >
                    {link.other.label}
                  </button>
                  {link.direction === "in" ? ` ${relationshipLabel(link.relationship)} this finding` : null}
                </p>
                <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/75">{link.explanation}</p>
                {link.planChanging ? <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/80">{link.planChanging}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {link.accepted ? null : (
                    <Button type="button" size="sm" className="cursor-pointer" onClick={() => acceptConnection(link.connectionId)}>
                      Accept
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="cursor-pointer" onClick={() => dismissConnection(link.connectionId)}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {page.gaps.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-paper/80">Gaps about this finding</h3>
          <ul className="flex flex-col gap-1.5">
            {page.gaps.map((gap) => (
              <li key={gap.id}>
                <button
                  type="button"
                  className="w-full cursor-pointer rounded-xl border border-paper/15 px-3 py-2 text-left hover:border-golden/50 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                  onClick={() => onOpen(gap.id)}
                >
                  <span className="block font-mono text-[10px] tracking-[0.14em] text-mystic-ink uppercase">{GAP_KIND_LABEL[gap.gapKind]}</span>
                  <span className="block text-sm leading-5 break-words text-paper">{gap.question}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function GapBody({ page, onOpen }: { page: Extract<SkillNodePage, { kind: "gap" }>; onOpen: (id: string) => void }) {
  const gap = useInvestigationStore((state) => state.investigation?.gaps.find((item) => item.id === page.gapId));

  return (
    <div className="flex flex-col gap-4">
      <p className="font-mono text-[10px] tracking-[0.14em] text-mystic-ink uppercase">
        {GAP_KIND_LABEL[page.gapKind]}
        {page.status === "resolved" ? <span className="text-paper/60"> · Resolved</span> : null}
      </p>
      <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper">{page.question}</p>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-paper/80">Why it matters</h3>
        <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/85">{page.whyItMatters}</p>
      </div>
      <p className="text-sm leading-6 text-paper/75">{page.gapKindNote}</p>
      {page.suggestedQuery ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-paper/80">Suggested query</h3>
          <p className="font-mono text-xs leading-5 break-words text-paper/75">{page.suggestedQuery}</p>
        </div>
      ) : null}
      <NodeList title="About" nodes={page.about} empty="No findings are linked to this gap." onOpen={onOpen} />
      {page.uncertainty ? (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-paper/80">Uncertainty</h3>
          <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/80">{page.uncertainty}</p>
        </div>
      ) : null}
      {gap ? <GapFollowUp key={gap.id} gap={gap} /> : null}
    </div>
  );
}

function PageFooter({ page, onOpen }: { page: SkillNodePage; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3 border-t border-paper/10 pt-3">
      {page.prev || page.next ? (
        <div className="flex items-start justify-between gap-3">
          {page.prev ? (
            <button
              type="button"
              className="max-w-[48%] cursor-pointer text-left text-sm break-words text-paper hover:text-golden focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
              aria-label={`Previous: ${page.prev.label}`}
              onClick={() => onOpen(page.prev!.id)}
            >
              ← {page.prev.label}
            </button>
          ) : (
            <span />
          )}
          {page.next ? (
            <button
              type="button"
              className="max-w-[48%] cursor-pointer text-right text-sm break-words text-paper hover:text-golden focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
              aria-label={`Next: ${page.next.label}`}
              onClick={() => onOpen(page.next!.id)}
            >
              {page.next.label} →
            </button>
          ) : null}
        </div>
      ) : null}
      {page.children.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium text-paper/80">Next on this trail</h3>
          <ul className="flex flex-wrap gap-1.5">
            {page.children.map((child) => (
              <li key={child.id}>
                <NodeChip node={child} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function NodeList({
  title,
  nodes,
  empty,
  onOpen,
  hideEmpty = false,
}: {
  title: string;
  nodes: NodeRef[];
  empty: string;
  onOpen: (id: string) => void;
  hideEmpty?: boolean;
}) {
  if (nodes.length === 0 && hideEmpty) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-sm font-medium text-paper/80">{title}</h3>
      {nodes.length === 0 ? (
        <p className="text-sm text-paper/70">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {nodes.map((node) => (
            <li key={node.id}>
              <NodeChip node={node} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NodeChip({ node, onOpen }: { node: NodeRef; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      className="max-w-full cursor-pointer rounded-full border border-paper/20 px-2.5 py-1 text-left text-xs leading-4 break-words text-paper hover:border-golden/70 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
      style={node.color ? { borderColor: `color-mix(in srgb, ${regionVar(node.color)} 70%, transparent)` } : undefined}
      onClick={() => onOpen(node.id)}
    >
      {node.label}
    </button>
  );
}

function SourceCard({ source }: { source: SourceRef }) {
  const snippet = useInvestigationStore((state) => state.investigation?.sources.find((item) => item.id === source.id)?.snippet);
  const href = safeHttpUrl(source.url);
  const published = source.publishedAt?.trim() ? formatPublished(source.publishedAt) : "";
  const failed = source.retrievalStatus === "failed";
  const text = snippet?.trim();

  return (
    <article className="flex flex-col gap-2 rounded-xl border border-paper/15 bg-midnight/35 p-3">
      <h4 className="text-sm leading-5 break-words text-paper">{source.title}</h4>
      <p className="font-mono text-xs break-all text-paper/70">{source.domain}</p>
      {published ? <p className="text-xs text-paper/70">Published {published}</p> : null}
      <Badge variant="outline" className={cn("w-fit", failed ? "border-destructive text-destructive" : "border-paper/30 text-paper")}>
        {retrievalLabel(source.retrievalStatus)}
      </Badge>
      {source.retrievedVia === "browser" ? <BrowserReadBadge /> : null}
      {text ? <p className="text-sm leading-6 break-words whitespace-pre-wrap text-paper/75">{text}</p> : null}
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
        <p className="text-xs text-paper/75">No page link is available.</p>
      )}
    </article>
  );
}
