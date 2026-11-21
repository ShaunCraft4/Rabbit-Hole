import { Position, type Edge, type Node } from "@xyflow/react";
import type { CSSProperties } from "react";

import type {
  ConnectionRelationship,
  EvidenceStatus,
  GapKind,
  GapStatus,
  Investigation,
} from "@/lib/types";

import { NODE_SIZE } from "./layout";

export const ROOT_NODE_ID = "root";

export function branchNodeId(branchId: string): string {
  return `branch:${branchId}`;
}

export function claimNodeId(claimId: string): string {
  return `claim:${claimId}`;
}

export function gapNodeId(gapId: string): string {
  return `gap:${gapId}`;
}

export type RootNodeData = {
  question: string;
  dimmed: boolean;
};

export type BranchNodeData = {
  branchId: string;
  title: string;
  status: Investigation["branches"][number]["status"];
  claimCount: number;
  collapsed: boolean;
  dimmed: boolean;
};

export type ClaimNodeData = {
  claimId: string;
  text: string;
  evidenceStatus: EvidenceStatus;
  verified: boolean;
  dimmed: boolean;
};

export type GapNodeData = {
  gapId: string;
  question: string;
  gapKind: GapKind;
  status: GapStatus;
  dimmed: boolean;
};

export type GraphEdgeData = {
  kind: "structure" | "connection" | "answers";
  relationship: string;
  accepted: boolean;
};

export type RootFlowNode = Node<RootNodeData, "root">;
export type BranchFlowNode = Node<BranchNodeData, "branch">;
export type ClaimFlowNode = Node<ClaimNodeData, "claim">;
export type GapFlowNode = Node<GapNodeData, "gap">;
export type GraphNode = RootFlowNode | BranchFlowNode | ClaimFlowNode | GapFlowNode;
export type GraphEdge = Edge<GraphEdgeData, "smoothstep">;

export type BuildGraphOptions = {
  collapsedBranchIds: readonly string[];
  selectedNodeId?: string | null;
  showGaps?: boolean;
};

const MOTION_CLASS =
  "transition-transform duration-500 ease-out motion-reduce:transition-none [&.dragging]:transition-none";

const STROKE = {
  subtle: "color-mix(in srgb, var(--paper) 42%, transparent)",
  solid: "color-mix(in srgb, var(--paper) 78%, transparent)",
  violet: "color-mix(in srgb, var(--mystic) 82%, transparent)",
  gold: "var(--golden-key)",
  dim: "color-mix(in srgb, var(--paper) 20%, transparent)",
} as const;

const LABEL_STYLE: CSSProperties = { fill: "var(--paper)", fontSize: 11, fontWeight: 500 };
const LABEL_STYLE_HOT: CSSProperties = { fill: "var(--golden-key)", fontSize: 11, fontWeight: 600 };
const LABEL_STYLE_DIM: CSSProperties = {
  fill: "color-mix(in srgb, var(--paper) 38%, transparent)",
  fontSize: 11,
  fontWeight: 500,
};
const LABEL_BG: CSSProperties = { fill: "var(--midnight)", fillOpacity: 0.92 };
const LABEL_PADDING: [number, number] = [6, 3];

const RELATIONSHIP_LABEL: Record<ConnectionRelationship, string> = {
  supports: "supports",
  contradicts: "contradicts",
  depends_on: "depends on",
  related_to: "related to",
};

type Tone = "normal" | "hot" | "dim";

function box(kind: keyof typeof NODE_SIZE): { width: number; height: number } {
  return NODE_SIZE[kind];
}

function shell(kind: keyof typeof NODE_SIZE, ariaLabel: string) {
  const size = box(kind);
  return {
    position: { x: 0, y: 0 },
    width: size.width,
    height: size.height,
    initialWidth: size.width,
    initialHeight: size.height,
    style: { width: size.width, height: size.height },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    ariaLabel,
    className: MOTION_CLASS,
    deletable: false,
    connectable: false,
    draggable: true,
    selectable: true,
  };
}

function relationshipLabel(relationship: string): string {
  if (relationship in RELATIONSHIP_LABEL) {
    return RELATIONSHIP_LABEL[relationship as ConnectionRelationship];
  }
  return relationship.replaceAll("_", " ");
}

function marker(color: string) {
  return { type: "arrowclosed" as const, width: 16, height: 16, color };
}

function paint(edge: GraphEdge, tone: Tone): GraphEdge {
  const data = edge.data ?? { kind: "structure" as const, relationship: "investigates", accepted: true };
  const { kind, relationship, accepted } = data;
  const hot = tone === "hot";
  const dim = tone === "dim";
  let stroke: string = STROKE.subtle;
  let width = 1.35;
  let dash: string | undefined;
  let label: string | undefined;
  let showMarker = false;

  if (kind === "connection") {
    stroke = hot ? STROKE.gold : dim ? STROKE.dim : accepted ? STROKE.solid : STROKE.subtle;
    width = hot ? 2.25 : 1.6;
    dash = accepted ? undefined : "6 5";
    label = relationshipLabel(relationship);
    showMarker = true;
  } else if (kind === "answers" || relationship === "gap") {
    stroke = hot ? STROKE.gold : dim ? STROKE.dim : STROKE.violet;
    width = hot ? 2.25 : 1.45;
    showMarker = kind === "answers";
  } else if (hot) {
    stroke = STROKE.gold;
    width = 2.15;
  } else if (dim) {
    stroke = STROKE.dim;
  }

  const style: CSSProperties = { stroke, strokeWidth: width };
  if (dash) style.strokeDasharray = dash;

  return {
    ...edge,
    style,
    label,
    labelStyle: hot ? LABEL_STYLE_HOT : dim ? LABEL_STYLE_DIM : LABEL_STYLE,
    labelShowBg: Boolean(label),
    labelBgStyle: LABEL_BG,
    labelBgPadding: LABEL_PADDING,
    labelBgBorderRadius: 4,
    markerEnd: showMarker ? marker(hot ? STROKE.gold : stroke) : undefined,
    zIndex: hot ? 5 : 0,
  };
}

function withSelection<T extends GraphNode>(node: T, dimmed: boolean, selected: boolean): T {
  if (node.data.dimmed === dimmed && node.selected === selected) return node;
  return { ...node, selected, zIndex: selected ? 20 : 1, data: { ...node.data, dimmed } } as T;
}

function decorate(nodes: GraphNode[], edges: GraphEdge[], selectedNodeId: string | null): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const visible = selectedNodeId != null && nodes.some((node) => node.id === selectedNodeId);
  const selected = visible ? selectedNodeId : null;
  const neighbors = new Set<string>();
  if (selected) {
    neighbors.add(selected);
    for (const edge of edges) {
      if (edge.source === selected || edge.target === selected) {
        neighbors.add(edge.source);
        neighbors.add(edge.target);
      }
    }
  }

  return {
    nodes: nodes.map((node) => withSelection(node, selected != null && !neighbors.has(node.id), node.id === selected)),
    edges: edges.map((edge) => {
      const hot = selected != null && (edge.source === selected || edge.target === selected);
      const tone: Tone = hot ? "hot" : selected != null ? "dim" : "normal";
      return paint(edge, tone);
    }),
  };
}

/** Turn an investigation into React Flow nodes and edges. Sources are never nodes. */
export function buildGraph(
  investigation: Investigation,
  options: BuildGraphOptions,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const collapsed = new Set(options.collapsedBranchIds);
  const branchIds = new Set(investigation.branches.map((branch) => branch.id));
  const verified = investigation.claims.filter((claim) => claim.verified);
  const showGaps = options.showGaps !== false && verified.length > 0;

  const claimCount = new Map<string, number>();
  for (const claim of verified) {
    claimCount.set(claim.branchId, (claimCount.get(claim.branchId) ?? 0) + 1);
  }

  const nodes: GraphNode[] = [
    {
      id: ROOT_NODE_ID,
      type: "root",
      data: { question: investigation.question, dimmed: false },
      ...shell("root", `White Rabbit. Question: ${investigation.question}`),
    },
  ];

  const edges: GraphEdge[] = [];

  for (const branch of investigation.branches) {
    const id = branchNodeId(branch.id);
    const count = claimCount.get(branch.id) ?? 0;
    const isCollapsed = collapsed.has(branch.id);
    const statusLabel =
      branch.status === "running" ? "Searching" : branch.status === "done" ? "Done" : branch.status === "failed" ? "Failed" : "Idle";
    nodes.push({
      id,
      type: "branch",
      data: {
        branchId: branch.id,
        title: branch.title,
        status: branch.status,
        claimCount: count,
        collapsed: isCollapsed,
        dimmed: false,
      },
      ...shell(
        "branch",
        `Door: ${branch.title}. ${statusLabel}. ${count} ${count === 1 ? "finding" : "findings"}. ${isCollapsed ? "Collapsed" : "Expanded"}.`,
      ),
    });
    edges.push({
      id: `struct:${ROOT_NODE_ID}:${id}`,
      type: "smoothstep",
      source: ROOT_NODE_ID,
      target: id,
      data: { kind: "structure", relationship: "investigates", accepted: true },
      ariaLabel: `Investigates ${branch.title}`,
    });
  }

  const visibleClaims = new Set<string>();
  for (const claim of verified) {
    if (!branchIds.has(claim.branchId) || collapsed.has(claim.branchId)) continue;
    const id = claimNodeId(claim.id);
    visibleClaims.add(id);
    nodes.push({
      id,
      type: "claim",
      data: {
        claimId: claim.id,
        text: claim.text,
        evidenceStatus: claim.evidenceStatus,
        verified: claim.verified,
        dimmed: false,
      },
      ...shell("claim", `Finding: ${claim.text}. Evidence: ${claim.evidenceStatus.replaceAll("_", " ")}. Verified quote.`),
    });
    const parent = branchNodeId(claim.branchId);
    edges.push({
      id: `struct:${parent}:${id}`,
      type: "smoothstep",
      source: parent,
      target: id,
      data: { kind: "structure", relationship: "investigates", accepted: true },
      ariaLabel: "Investigates this finding",
    });
  }

  const visibleGaps = new Set<string>();
  if (showGaps) {
    for (const gap of investigation.gaps) {
      if (gap.status === "dismissed") continue;
      const parentIsBranch = Boolean(gap.branchId && branchIds.has(gap.branchId));
      if (parentIsBranch && gap.branchId && collapsed.has(gap.branchId)) continue;
      const id = gapNodeId(gap.id);
      const parent = parentIsBranch && gap.branchId ? branchNodeId(gap.branchId) : ROOT_NODE_ID;
      visibleGaps.add(id);
      const stateLabel = gap.status === "resolved" ? "Resolved gap" : "Gap";
      nodes.push({
        id,
        type: "gap",
        data: {
          gapId: gap.id,
          question: gap.question,
          gapKind: gap.kind,
          status: gap.status,
          dimmed: false,
        },
        ...shell("gap", `${stateLabel}: ${gap.kind}. ${gap.question}`),
      });
      edges.push({
        id: `struct:${parent}:${id}`,
        type: "smoothstep",
        source: parent,
        target: id,
        data: { kind: "structure", relationship: "gap", accepted: true },
        ariaLabel: "Gap on this door",
      });
    }
  }

  for (const connection of investigation.connections) {
    const source = claimNodeId(connection.from);
    const target = claimNodeId(connection.to);
    if (source === target || !visibleClaims.has(source) || !visibleClaims.has(target)) continue;
    const accepted = connection.accepted === true;
    const label = relationshipLabel(connection.relationship);
    edges.push({
      id: `conn:${connection.id}`,
      type: "smoothstep",
      source,
      target,
      data: { kind: "connection", relationship: connection.relationship, accepted },
      ariaLabel: `${label}. ${connection.explanation}`,
    });
  }

  const selectedGapId = options.selectedNodeId?.startsWith("gap:") ? options.selectedNodeId.slice(4) : null;
  if (selectedGapId && visibleGaps.has(gapNodeId(selectedGapId))) {
    const gap = investigation.gaps.find((item) => item.id === selectedGapId);
    const source = gapNodeId(selectedGapId);
    for (const claimId of gap?.claimIds ?? []) {
      const target = claimNodeId(claimId);
      if (!visibleClaims.has(target)) continue;
      edges.push({
        id: `answers:${selectedGapId}:${claimId}`,
        type: "smoothstep",
        source,
        target,
        data: { kind: "answers", relationship: "answers", accepted: true },
        ariaLabel: "Gap linked to this finding",
      });
    }
  }

  return decorate(nodes, edges, options.selectedNodeId ?? null);
}
