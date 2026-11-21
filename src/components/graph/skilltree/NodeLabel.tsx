"use client";

import type { SkillNode } from "@/lib/skilltree";
import { cn } from "@/lib/utils";

import { regionVar } from "./colors";
import { useSkillTreeUi } from "./context";

export function NodeLabel({ node, revealed }: { node: SkillNode; revealed: boolean }) {
  const { showMinorLabels } = useSkillTreeUi();
  if (node.labelInside) return null;

  const minor = node.kind === "finding" || node.kind === "gap";
  const keep = node.kind === "finding" && node.keyDiscovery;
  if (minor && !keep && !revealed && !showMinorLabels) return null;

  const door = node.kind === "door";
  const left = node.labelBox.x - (node.x - node.r);
  const top = node.labelBox.y - (node.y - node.r);

  return (
    <span
      className="pointer-events-none absolute z-[2] flex items-center justify-center rounded-md bg-midnight text-center"
      style={{ left, top, width: node.labelBox.width, height: node.labelBox.height }}
    >
      <span
        className={cn(
          "block w-full text-paper",
          door ? "text-[12.5px] leading-[15px] font-semibold" : "text-[11px] leading-[13px]",
        )}
        style={door ? { color: regionVar(node.color) } : undefined}
      >
        {node.labelLines.map((line, index) => (
          <span key={index} className="block whitespace-nowrap">
            {line}
          </span>
        ))}
      </span>
    </span>
  );
}
