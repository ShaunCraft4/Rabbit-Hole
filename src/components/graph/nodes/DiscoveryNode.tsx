import type { NodeProps } from "@xyflow/react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ClaimFlowNode } from "@/lib/graph/build";
import type { EvidenceStatus } from "@/lib/types";

import { NodeHandles } from "./handles";

const EVIDENCE_CLASS: Record<EvidenceStatus, string> = {
  corroborated: "border-2 border-solid border-golden",
  single_source: "border border-paper/30",
  conflicting: "border-2 border-dashed border-amber-300",
  outdated: "border border-paper/20",
  snippet_only: "border border-paper/20",
};

const EVIDENCE_LABEL: Record<EvidenceStatus, string> = {
  corroborated: "Corroborated",
  single_source: "Single source",
  conflicting: "Conflict",
  outdated: "Outdated",
  snippet_only: "Snippet",
};

function evidenceIsBadge(status: EvidenceStatus): boolean {
  return status === "outdated" || status === "snippet_only" || status === "conflicting";
}

export function DiscoveryNode({ data, selected }: NodeProps<ClaimFlowNode>) {
  const label = EVIDENCE_LABEL[data.evidenceStatus];
  const muted = data.evidenceStatus === "outdated" || data.evidenceStatus === "snippet_only";

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-between rounded-xl bg-wonderland/90 px-3 py-2",
        EVIDENCE_CLASS[data.evidenceStatus],
        selected && "ring-2 ring-golden ring-offset-2 ring-offset-midnight",
        data.dimmed && "opacity-40",
      )}
    >
      <NodeHandles />
      <p className={cn("line-clamp-3 text-[13px] leading-5", muted ? "text-paper/70" : "text-paper")} title={data.text}>
        {data.text}
      </p>
      <div className="flex items-center justify-between gap-2">
        {evidenceIsBadge(data.evidenceStatus) ? (
          <span className="rounded-full border border-paper/30 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-paper/80 uppercase">
            {label}
          </span>
        ) : (
          <span className={cn("text-[10px] tracking-wide", data.evidenceStatus === "corroborated" ? "text-golden" : "sr-only")}>
            {label}
          </span>
        )}
        {data.verified ? (
          <span className="inline-flex items-center text-golden" title="Verified quote">
            <Check className="size-3.5" aria-hidden />
            <span className="sr-only">Verified quote</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
