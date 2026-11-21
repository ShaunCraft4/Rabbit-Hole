"use client";

import { useCallback, type KeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Clock, Minus, Search, Split } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ROOT_NODE_ID, branchNodeId, claimNodeId, gapNodeId } from "@/lib/graph/build";
import { cn } from "@/lib/utils";
import type { Branch, Claim, Gap, GapKind } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

import { GAP_KIND_LABEL, evidenceBadge } from "@/components/panels/copy";
import { useSelectNode } from "@/components/panels/use-select-node";

const GAP_ICON: Record<GapKind, LucideIcon> = {
  missing: Search,
  conflict: Split,
  outdated: Clock,
  weak: Minus,
};

const BRANCH_STATUS: Record<Branch["status"], string> = {
  idle: "Idle",
  running: "Searching",
  done: "Done",
  failed: "Failed",
};

export function ListView() {
  const investigation = useInvestigationStore((state) => state.investigation);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const collapsedBranchIds = useInvestigationStore((state) => state.collapsedBranchIds);
  const branchErrors = useInvestigationStore((state) => state.branchErrors);
  const toggleCollapsed = useInvestigationStore((state) => state.toggleCollapsed);
  const selectNode = useSelectNode();

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-tree-item]")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next = index;
    if (event.key === "ArrowDown") next = Math.min(index + 1, items.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(index - 1, 0);
    else if (event.key === "Home") next = 0;
    else next = items.length - 1;
    if (next === index) return;
    event.preventDefault();
    const target = items[next];
    if (!target) return;
    target.focus();
    const nodeId = target.dataset.nodeId;
    if (nodeId) selectNode(nodeId);
  }, [selectNode]);

  if (!investigation) return null;

  const collapsed = new Set(collapsedBranchIds);
  const branchIds = new Set(investigation.branches.map((branch) => branch.id));
  const looseGaps = investigation.gaps.filter(
    (gap) => gap.status !== "dismissed" && (!gap.branchId || !branchIds.has(gap.branchId)),
  );

  return (
    <section aria-label="Investigation list" className="h-full min-h-[50vh] overflow-y-auto p-4" onKeyDown={onKeyDown}>
      <h2 className="sr-only">The dream as a list</h2>
      <ul className="flex flex-col gap-2">
        <li>
          <NodeButton
            nodeId={ROOT_NODE_ID}
            selected={selectedNodeId === ROOT_NODE_ID}
            onSelect={selectNode}
            kicker="The dream"
            label={investigation.question}
          />
        </li>
        {investigation.branches.map((branch) => {
          const nodeId = branchNodeId(branch.id);
          const isCollapsed = collapsed.has(branch.id);
          const claims = investigation.claims.filter((claim) => claim.verified && claim.branchId === branch.id);
          const gaps = investigation.gaps.filter((gap) => gap.status !== "dismissed" && gap.branchId === branch.id);
          return (
            <li key={branch.id} className="flex flex-col gap-1">
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  className="mt-1 shrink-0 cursor-pointer rounded-md p-1 text-paper/80 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Show" : "Hide"} findings for ${branch.title}`}
                  onClick={() => toggleCollapsed(branch.id)}
                >
                  {isCollapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                </button>
                <div className="min-w-0 flex-1">
                  <NodeButton
                    nodeId={nodeId}
                    selected={selectedNodeId === nodeId}
                    onSelect={selectNode}
                    kicker={`Door · ${BRANCH_STATUS[branch.status]} · ${claims.length === 1 ? "1 finding" : `${claims.length} findings`}`}
                    label={branch.title}
                  />
                  {branchErrors[branch.id] ? (
                    <p role="alert" className="px-3 pt-1 text-xs leading-5 break-words text-destructive">
                      {branchErrors[branch.id]}
                    </p>
                  ) : null}
                </div>
              </div>
              {isCollapsed ? null : (
                <ul className="ml-6 flex flex-col gap-1 border-l border-paper/15 pl-3">
                  {claims.map((claim) => (
                    <li key={claim.id}>
                      <ClaimRow claim={claim} selected={selectedNodeId === claimNodeId(claim.id)} onSelect={selectNode} />
                    </li>
                  ))}
                  {gaps.map((gap) => (
                    <li key={gap.id}>
                      <GapRow gap={gap} selected={selectedNodeId === gapNodeId(gap.id)} onSelect={selectNode} />
                    </li>
                  ))}
                  {claims.length === 0 && gaps.length === 0 ? (
                    <li className="px-3 py-1 text-sm text-paper/60">No findings yet.</li>
                  ) : null}
                </ul>
              )}
            </li>
          );
        })}
        {looseGaps.length > 0 ? (
          <li className="flex flex-col gap-1">
            <p className="px-3 pt-2 font-mono text-[10px] tracking-[0.14em] text-paper/60 uppercase">Outside the doors</p>
            <ul className="flex flex-col gap-1">
              {looseGaps.map((gap) => (
                <li key={gap.id}>
                  <GapRow gap={gap} selected={selectedNodeId === gapNodeId(gap.id)} onSelect={selectNode} />
                </li>
              ))}
            </ul>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function NodeButton({
  nodeId,
  selected,
  onSelect,
  kicker,
  label,
}: {
  nodeId: string;
  selected: boolean;
  onSelect: (nodeId: string) => void;
  kicker: string;
  label: string;
}) {
  return (
    <button
      type="button"
      data-tree-item=""
      data-node-id={nodeId}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none",
        selected ? "border-golden bg-wonderland/70" : "border-paper/15 bg-wonderland/30 hover:border-paper/30",
      )}
      onClick={() => onSelect(nodeId)}
    >
      <span className="font-mono text-[10px] tracking-[0.14em] text-golden uppercase">{kicker}</span>
      <span className="text-sm leading-5 break-words text-paper">{label}</span>
    </button>
  );
}

function ClaimRow({
  claim,
  selected,
  onSelect,
}: {
  claim: Claim;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <button
      type="button"
      data-tree-item=""
      data-node-id={claimNodeId(claim.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none",
        selected ? "border-golden bg-wonderland/70" : "border-transparent hover:border-paper/20 hover:bg-midnight/30",
      )}
      onClick={() => onSelect(claimNodeId(claim.id))}
    >
      <span className="font-mono text-[10px] tracking-[0.14em] text-paper/60 uppercase">
        Finding · {evidenceBadge(claim.evidenceStatus)}
      </span>
      <span className="text-sm leading-5 break-words text-paper">{claim.text}</span>
    </button>
  );
}

function GapRow({
  gap,
  selected,
  onSelect,
}: {
  gap: Gap;
  selected: boolean;
  onSelect: (nodeId: string) => void;
}) {
  const Icon = GAP_ICON[gap.kind];
  return (
    <button
      type="button"
      data-tree-item=""
      data-node-id={gapNodeId(gap.id)}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none",
        selected ? "border-golden bg-wonderland/70" : "border-transparent hover:border-paper/20 hover:bg-midnight/30",
      )}
      onClick={() => onSelect(gapNodeId(gap.id))}
    >
      <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-mystic uppercase">
        <Icon className="size-3.5" aria-hidden />
        {GAP_KIND_LABEL[gap.kind]}
        {gap.status === "resolved" ? <span className="text-paper/60">· Resolved</span> : null}
      </span>
      <span className="text-sm leading-5 break-words text-paper">{gap.question}</span>
    </button>
  );
}
