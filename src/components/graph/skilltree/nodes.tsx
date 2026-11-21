"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { DoorClosed, DoorOpen, KeyRound, Lock, LockOpen, Rabbit } from "lucide-react";

import { BrowserReadBadge } from "@/components/BrowserReadBadge";
import type { SkillNode, SkillNodeKind } from "@/lib/skilltree";
import { cn } from "@/lib/utils";
import { useInvestigationStore } from "@/stores/investigation";

import { regionVar } from "./colors";
import { useSkillTreeUi } from "./context";
import { NodeLabel } from "./NodeLabel";

export type SkillNodeData = SkillNode & { dimmed: boolean } & Record<string, unknown>;
export type SkillFlowNode = Node<SkillNodeData, SkillNodeKind>;

const SELECTED_RING = "0 0 0 2px var(--midnight), 0 0 0 4px var(--golden-key)";

function SkillShell({
  node,
  selected,
  dimmed,
  children,
  extra,
}: {
  node: SkillNode;
  selected: boolean;
  dimmed: boolean;
  children: (hot: boolean) => ReactNode;
  extra?: ReactNode;
}) {
  const { openNode, setHoveredId } = useSkillTreeUi();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const hot = hovered || focused;

  function point(nextHover: boolean, nextFocus: boolean) {
    setHovered(nextHover);
    setFocused(nextFocus);
    setHoveredId(nextHover || nextFocus ? node.id : null);
  }

  return (
    <div className={cn("skill-arrive relative size-full overflow-visible", dimmed && "opacity-25")}>
      <button
        id={`skill-node-${node.id}`}
        type="button"
        className="group nopan nodrag relative size-full cursor-pointer overflow-visible rounded-full border-0 bg-transparent p-0 focus-visible:ring-2 focus-visible:ring-golden focus-visible:ring-offset-2 focus-visible:ring-offset-midnight focus-visible:outline-none"
        aria-label={node.ariaLabel}
        aria-current={selected ? "true" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          openNode(node.id);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") event.stopPropagation();
        }}
        onMouseEnter={() => point(true, focused)}
        onMouseLeave={() => point(false, focused)}
        onFocus={() => point(hovered, true)}
        onBlur={() => point(hovered, false)}
      >
        {children(hot)}
        <NodeLabel node={node} revealed={hot} />
      </button>
      {extra}
    </div>
  );
}

function Orb({ hot, className, style, children }: { hot: boolean; className?: string; style?: CSSProperties; children?: ReactNode }) {
  return (
    <span className="skill-orb pointer-events-none absolute inset-0" style={{ transform: hot ? "scale(1.15)" : undefined }}>
      <span className={cn("absolute inset-0 rounded-full", className)} style={style} />
      <span className="relative z-[1] flex size-full items-center justify-center">{children}</span>
    </span>
  );
}

export function StartNode({ data, selected }: NodeProps<SkillFlowNode>) {
  const running = useInvestigationStore((state) => state.investigation?.branches.some((branch) => branch.status === "running") ?? false);
  if (data.kind !== "start") return null;

  return (
    <SkillShell node={data} selected={selected} dimmed={data.dimmed}>
      {(hot) => (
        <Orb
          hot={hot}
          className={cn("bg-paper ring-[2.5px] ring-golden", running && "skill-pulse")}
          style={{
            boxShadow: selected
              ? SELECTED_RING
              : running
                ? undefined
                : "0 0 22px color-mix(in srgb, var(--golden-key) 42%, transparent)",
          }}
        >
          <span className="flex flex-col items-center justify-center gap-0.5 text-midnight">
            <Rabbit className="size-4" aria-hidden />
            <span className="font-heading text-[13px] leading-none font-semibold">Start here</span>
          </span>
        </Orb>
      )}
    </SkillShell>
  );
}

export function DoorNode({ data, selected }: NodeProps<SkillFlowNode>) {
  if (data.kind !== "door") return null;
  const color = regionVar(data.color);
  const failed = data.status === "failed";
  const Icon = data.status === "done" ? DoorOpen : DoorClosed;

  return (
    <SkillShell node={data} selected={selected} dimmed={data.dimmed}>
      {(hot) => (
        <Orb
          hot={hot}
          style={{
            background: failed ? "color-mix(in srgb, var(--destructive) 40%, transparent)" : `color-mix(in srgb, ${color} 55%, transparent)`,
            border: failed ? "2.5px solid var(--destructive)" : `2.5px solid ${color}`,
            boxShadow: selected ? SELECTED_RING : undefined,
          }}
        >
          {data.status === "running" ? (
            <span className="skill-spin pointer-events-none absolute -inset-1 animate-spin rounded-full border-2 border-transparent border-t-paper" aria-hidden />
          ) : null}
          <Icon className="size-5 text-paper" aria-hidden />
        </Orb>
      )}
    </SkillShell>
  );
}

export function FindingNode({ data, selected }: NodeProps<SkillFlowNode>) {
  if (data.kind !== "finding") return null;
  const color = regionVar(data.color);
  const faded = data.evidenceStatus === "outdated" || data.evidenceStatus === "snippet_only";
  const conflicting = data.evidenceStatus === "conflicting";
  const gold = data.evidenceStatus === "corroborated" || data.keyDiscovery;
  const glow = [
    selected ? SELECTED_RING : "",
    data.keyDiscovery ? "0 0 12px 3px color-mix(in srgb, var(--golden-key) 75%, transparent)" : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <SkillShell
      node={data}
      selected={selected}
      dimmed={data.dimmed}
      extra={
        data.readByBrowser ? (
          <span className="absolute -top-1 -right-1 z-[3]">
            <BrowserReadBadge iconOnly />
          </span>
        ) : null
      }
    >
      {(hot) => (
        <Orb
          hot={hot}
          style={{
            background: faded ? `color-mix(in srgb, ${color} 38%, transparent)` : color,
            border: conflicting ? "1.5px dashed #fbbf24" : gold ? "2px solid var(--golden-key)" : `1.5px solid ${color}`,
            boxShadow: glow || undefined,
          }}
        >
          {data.keyDiscovery ? <KeyRound className="absolute right-0 bottom-0 size-2.5 text-golden" aria-hidden /> : null}
        </Orb>
      )}
    </SkillShell>
  );
}

export function GapNode({ data, selected }: NodeProps<SkillFlowNode>) {
  if (data.kind !== "gap") return null;
  const color = regionVar(data.color);
  const open = data.status === "open";
  const Icon = open ? Lock : LockOpen;

  return (
    <SkillShell node={data} selected={selected} dimmed={data.dimmed}>
      {(hot) => (
        <Orb
          hot={hot}
          className="bg-midnight"
          style={{
            border: `1.5px ${open ? "dashed" : "solid"} ${color}`,
            boxShadow: selected ? SELECTED_RING : undefined,
          }}
        >
          <Icon className="size-3" style={{ color }} aria-hidden />
        </Orb>
      )}
    </SkillShell>
  );
}
