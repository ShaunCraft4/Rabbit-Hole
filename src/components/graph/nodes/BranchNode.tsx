import type { NodeProps } from "@xyflow/react";
import { ChevronDown, ChevronRight, DoorOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import type { BranchFlowNode } from "@/lib/graph/build";
import type { BranchStatus } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

import { NodeHandles } from "./handles";

const STATUS_LABEL: Record<BranchStatus, string> = {
  idle: "Idle",
  running: "Searching",
  done: "Done",
  failed: "Failed",
};

const STATUS_RING: Record<BranchStatus, string> = {
  idle: "border-paper/40 bg-paper/15",
  running: "status-pulse border-mystic bg-mystic",
  done: "border-golden bg-golden",
  failed: "border-destructive bg-destructive",
};

export function BranchNode({ data, selected }: NodeProps<BranchFlowNode>) {
  const toggleCollapsed = useInvestigationStore((state) => state.toggleCollapsed);
  const findings = `${data.claimCount} ${data.claimCount === 1 ? "finding" : "findings"}`;

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-between rounded-xl border border-paper/20 bg-wonderland/90 px-3 py-2",
        selected && "ring-2 ring-golden ring-offset-2 ring-offset-midnight",
        data.dimmed && "opacity-40",
      )}
    >
      <NodeHandles />
      <div className="flex items-start gap-2">
        <DoorOpen className="mt-0.5 size-3.5 shrink-0 text-golden" aria-hidden />
        <p className="line-clamp-2 min-w-0 flex-1 font-heading text-base leading-5 text-paper">{data.title}</p>
        <button
          type="button"
          className="nodrag nopan inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-paper/80 hover:bg-paper/10 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
          aria-expanded={!data.collapsed}
          aria-label={data.collapsed ? `Expand ${data.title}` : `Collapse ${data.title}`}
          onClick={(event) => {
            event.stopPropagation();
            toggleCollapsed(data.branchId);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {data.collapsed ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
        </button>
      </div>
      <p className="flex items-center gap-2 text-[11px] text-paper/75">
        <span className={cn("size-2.5 shrink-0 rounded-full border-2", STATUS_RING[data.status])} aria-hidden />
        <span>{STATUS_LABEL[data.status]}</span>
        <span className="text-paper/35" aria-hidden>
          ·
        </span>
        <span>{findings}</span>
      </p>
    </div>
  );
}
