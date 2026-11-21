import type { NodeProps } from "@xyflow/react";
import { Clock, Minus, Search, Split } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GapFlowNode } from "@/lib/graph/build";
import type { GapKind } from "@/lib/types";

import { NodeHandles } from "./handles";

const GAP_ICON: Record<GapKind, LucideIcon> = {
  missing: Search,
  conflict: Split,
  outdated: Clock,
  weak: Minus,
};

const GAP_LABEL: Record<GapKind, string> = {
  missing: "Missing",
  conflict: "Conflict",
  outdated: "Outdated",
  weak: "Weak",
};

export function GapNode({ data, selected }: NodeProps<GapFlowNode>) {
  const Icon = GAP_ICON[data.gapKind];
  const resolved = data.status === "resolved";

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-between rounded-xl border bg-wonderland/90 px-3 py-2",
        resolved
          ? "border-mystic/35 text-paper/70"
          : "border-mystic/80 shadow-[0_0_20px_color-mix(in_srgb,var(--mystic)_45%,transparent)]",
        selected && "ring-2 ring-golden ring-offset-2 ring-offset-midnight",
        data.dimmed && "opacity-40",
      )}
    >
      <NodeHandles />
      <p className={cn("flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] uppercase", resolved ? "text-mystic/70" : "text-mystic")}>
        <Icon className="size-3.5" aria-hidden />
        {GAP_LABEL[data.gapKind]}
        {resolved ? <span className="tracking-wide text-paper/60">· Resolved</span> : null}
      </p>
      <p className="truncate text-[13px] leading-5 text-paper" title={data.question}>
        {data.question}
      </p>
    </div>
  );
}
