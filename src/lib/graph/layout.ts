import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

/** Fixed node boxes. Dagre places these; the custom nodes fill the same size. */
export const NODE_SIZE = {
  root: { width: 220, height: 90 },
  branch: { width: 200, height: 84 },
  claim: { width: 240, height: 112 },
  gap: { width: 220, height: 92 },
} as const;

export type GraphNodeKind = keyof typeof NODE_SIZE;

const LAYOUT = {
  rankdir: "LR",
  nodesep: 24,
  ranksep: 90,
  edgesep: 16,
  marginx: 16,
  marginy: 16,
} as const;

type Position = { x: number; y: number };

const positionCache = new Map<string, Map<string, Position>>();

/**
 * Selection and edge styling must not move nodes. The signature is node ids,
 * which branches are collapsed, and a reset counter.
 */
export function layoutSignature(
  nodeIds: readonly string[],
  collapsedBranchIds: readonly string[],
  epoch: number,
): string {
  const nodes = [...nodeIds].sort().join("\n");
  const collapsed = [...collapsedBranchIds].sort().join(",");
  return `${epoch}\n${collapsed}\n${nodes}`;
}

function sizeOf(node: Node): { width: number; height: number } {
  if (node.type && node.type in NODE_SIZE) {
    return NODE_SIZE[node.type as GraphNodeKind];
  }
  return {
    width: node.width ?? NODE_SIZE.claim.width,
    height: node.height ?? NODE_SIZE.claim.height,
  };
}

function isStructureEdge(edge: Edge): boolean {
  const kind = edge.data && typeof edge.data === "object" ? edge.data.kind : undefined;
  return kind === "structure";
}

function place(nodes: Node[], edges: Edge[]): Map<string, Position> {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ ...LAYOUT });

  for (const node of nodes) {
    const size = sizeOf(node);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }

  for (const edge of edges) {
    if (!isStructureEdge(edge)) continue;
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, Position>();
  for (const node of nodes) {
    const laidOut = graph.node(node.id);
    const size = sizeOf(node);
    const x = laidOut?.x;
    const y = laidOut?.y;
    if (typeof x !== "number" || typeof y !== "number") {
      positions.set(node.id, { x: 0, y: 0 });
      continue;
    }
    positions.set(node.id, { x: x - size.width / 2, y: y - size.height / 2 });
  }
  return positions;
}

/** Apply a cached left-to-right dagre layout. Selection-only updates reuse positions. */
export function layoutGraph<T extends Node>(nodes: T[], edges: Edge[], signature: string): T[] {
  let positions = positionCache.get(signature);
  if (!positions) {
    positions = place(nodes, edges);
    positionCache.set(signature, positions);
    if (positionCache.size > 8) {
      const oldest = positionCache.keys().next().value;
      if (oldest) positionCache.delete(oldest);
    }
  }

  return nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position || (node.position.x === position.x && node.position.y === position.y)) return node;
    return { ...node, position };
  });
}
