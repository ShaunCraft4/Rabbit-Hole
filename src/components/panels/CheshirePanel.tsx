"use client";

import { ChevronDown, Clock, Minus, Search, Split } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { gapNodeId } from "@/lib/graph/build";
import { cn } from "@/lib/utils";
import type { GapKind } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

import { GAP_KIND_LABEL } from "./copy";
import { useSelectNode } from "./use-select-node";

const GAP_ICON: Record<GapKind, LucideIcon> = {
  missing: Search,
  conflict: Split,
  outdated: Clock,
  weak: Minus,
};

export function CheshirePanel() {
  const gaps = useInvestigationStore((state) => state.investigation?.gaps ?? []);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const selectNode = useSelectNode();
  const openGaps = gaps.filter((gap) => gap.status === "open");

  return (
    <Collapsible defaultOpen className="flex flex-col gap-2">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none">
        <h2 className="font-heading text-2xl leading-snug text-paper">The Cheshire Cat noticed something...</h2>
        <ChevronDown className="size-4 shrink-0 text-paper/70" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {openGaps.length === 0 ? (
          <p className="text-sm leading-6 text-paper/70">Nothing open right now.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {openGaps.map((gap) => {
              const nodeId = gapNodeId(gap.id);
              const selected = selectedNodeId === nodeId;
              const Icon = GAP_ICON[gap.kind];
              return (
                <li key={gap.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer flex-col gap-1 rounded-lg border px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none",
                      selected ? "border-golden bg-midnight/50" : "border-transparent hover:border-paper/20 hover:bg-midnight/30",
                    )}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => selectNode(nodeId)}
                  >
                    <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-mystic uppercase">
                      <Icon className="size-3.5" aria-hidden />
                      {GAP_KIND_LABEL[gap.kind]}
                    </span>
                    <span className="text-sm leading-5 break-words text-paper">{gap.question}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
