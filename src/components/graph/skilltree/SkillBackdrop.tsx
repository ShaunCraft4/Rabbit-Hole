"use client";

import { useState } from "react";
import { ViewportPortal } from "@xyflow/react";

import { relationshipLabel } from "@/components/panels/copy";
import type { Arrow, EvidenceTrail, LinkTrail, PathTrail, RegionColor, SkillRegion, SkillTree } from "@/lib/skilltree";

import { regionVar } from "./colors";

function ArrowHead({ arrow, color, size = 6 }: { arrow: Arrow; color: string; size?: number }) {
  const tip = size * 0.55;
  return (
    <path
      d={`M0 0 L${-size} ${-tip} L${-size} ${tip} Z`}
      fill={color}
      transform={`translate(${arrow.x} ${arrow.y}) rotate(${arrow.angle})`}
    />
  );
}

function regionOpacity(region: SkillRegion, related: Set<string> | null): number {
  if (!related) return 1;
  return region.nodeIds.some((id) => related.has(id)) ? 1 : 0.25;
}

function trailOpacity(from: string, to: string, related: Set<string> | null): number {
  if (!related) return 1;
  return related.has(from) && related.has(to) ? 1 : 0.25;
}

function endpointHot(id: string | null, trail: { from: string; to: string }): boolean {
  return id != null && (trail.from === id || trail.to === id);
}

export function SkillBackdrop({
  tree,
  selectedId,
  hoveredId,
  related,
}: {
  tree: SkillTree;
  selectedId: string | null;
  hoveredId: string | null;
  related: Set<string> | null;
}) {
  const [hoverLink, setHoverLink] = useState<string | null>(null);
  const { bounds } = tree;

  return (
    <ViewportPortal>
      <svg
        aria-hidden
        width={bounds.width}
        height={bounds.height}
        style={{
          position: "absolute",
          left: bounds.x,
          top: bounds.y,
          overflow: "visible",
          pointerEvents: "none",
        }}
      >
        <g transform={`translate(${-bounds.x} ${-bounds.y})`}>
          {tree.regions.map((region) => (
            <RegionShape key={region.id} region={region} opacity={regionOpacity(region, related)} />
          ))}
          {tree.trails.map((trail) => {
            if (trail.kind !== "path") return null;
            return <PathShape key={trail.id} trail={trail} opacity={trailOpacity(trail.from, trail.to, related)} />;
          })}
          {tree.trails.map((trail) => {
            if (trail.kind !== "link") return null;
            const hot = hoverLink === trail.id || endpointHot(selectedId, trail) || endpointHot(hoveredId, trail);
            return (
              <LinkShape
                key={trail.id}
                trail={trail}
                hot={hot}
                opacity={trailOpacity(trail.from, trail.to, related)}
                onHover={setHoverLink}
              />
            );
          })}
          {tree.trails.map((trail) => {
            if (trail.kind !== "evidence") return null;
            if (!endpointHot(selectedId, trail) && !endpointHot(hoveredId, trail)) return null;
            return <EvidenceShape key={trail.id} trail={trail} />;
          })}
        </g>
      </svg>
    </ViewportPortal>
  );
}

function RegionShape({ region, opacity }: { region: SkillRegion; opacity: number }) {
  const color = regionVar(region.color);
  const lines = region.titleLines;
  const lineHeight = 26;
  const startY = region.labelAt.y - ((lines.length - 1) * lineHeight) / 2;

  return (
    <g opacity={opacity}>
      <path d={region.hull} fill={color} fillOpacity={0.07} stroke={color} strokeOpacity={0.25} strokeWidth={1.2} />
      <text
        x={region.labelAt.x}
        y={startY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill={color}
        stroke="var(--midnight)"
        strokeWidth={5}
        paintOrder="stroke"
        fontFamily="var(--font-heading), Georgia, serif"
        fontSize={20}
        fontWeight={600}
      >
        {lines.map((line, index) => (
          <tspan key={index} x={region.labelAt.x} dy={index === 0 ? 0 : lineHeight}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}

function PathShape({ trail, opacity }: { trail: PathTrail; opacity: number }) {
  const color = regionVar(trail.color as RegionColor | null);
  return (
    <g opacity={opacity}>
      <path
        d={trail.d}
        fill="none"
        stroke={color}
        strokeOpacity={0.85}
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={trail.locked ? "5 4" : undefined}
      />
      {trail.waypoints.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={2.4} fill="var(--midnight)" stroke={color} strokeWidth={1} />
      ))}
      <ArrowHead arrow={trail.end} color={color} />
      {trail.arrows.map((arrow, index) => (
        <ArrowHead key={index} arrow={arrow} color={color} size={5} />
      ))}
    </g>
  );
}

function LinkShape({
  trail,
  hot,
  opacity,
  onHover,
}: {
  trail: LinkTrail;
  hot: boolean;
  opacity: number;
  onHover: (id: string | null) => void;
}) {
  const label = relationshipLabel(trail.relationship);
  const width = Math.max(52, label.length * 6.2 + 14);

  return (
    <g opacity={opacity}>
      <path
        d={trail.d}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
        style={{ pointerEvents: "stroke" }}
        onMouseEnter={() => onHover(trail.id)}
        onMouseLeave={() => onHover(null)}
      />
      <path
        d={trail.d}
        fill="none"
        stroke="var(--golden-key)"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeDasharray={trail.accepted ? undefined : "6 5"}
      />
      <ArrowHead arrow={trail.end} color="var(--golden-key)" size={8} />
      {hot ? (
        <g transform={`translate(${trail.labelAt.x} ${trail.labelAt.y})`} style={{ pointerEvents: "none" }}>
          <rect x={-width / 2} y={-9} width={width} height={18} rx={6} fill="var(--midnight)" stroke="var(--golden-key)" strokeOpacity={0.7} />
          <text textAnchor="middle" dominantBaseline="middle" fill="var(--golden-key)" fontSize={11} fontFamily="var(--font-inter), sans-serif">
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
}

function EvidenceShape({ trail }: { trail: EvidenceTrail }) {
  const color = regionVar(trail.color);
  return (
    <g>
      <path
        d={trail.d}
        fill="none"
        stroke={color}
        strokeWidth={1.2}
        strokeDasharray="2 3"
        strokeLinecap="round"
        strokeOpacity={0.9}
      />
      <ArrowHead arrow={trail.end} color={color} size={5} />
    </g>
  );
}
