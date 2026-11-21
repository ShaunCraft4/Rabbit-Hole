import type { NodeProps } from "@xyflow/react";
import { Rabbit } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RootFlowNode } from "@/lib/graph/build";

import { NodeHandles } from "./handles";

export function RootNode({ data, selected }: NodeProps<RootFlowNode>) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col justify-center gap-1 rounded-xl border-2 border-golden bg-wonderland/90 px-3 py-2 shadow-[0_0_22px_color-mix(in_srgb,var(--golden-key)_28%,transparent)]",
        selected && "ring-2 ring-golden ring-offset-2 ring-offset-midnight",
        data.dimmed && "opacity-40",
      )}
    >
      <NodeHandles />
      <p className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.16em] text-golden uppercase">
        <Rabbit className="size-3.5" aria-hidden />
        White Rabbit
      </p>
      <p className="line-clamp-2 text-[13px] leading-5 text-paper">{data.question}</p>
    </div>
  );
}
