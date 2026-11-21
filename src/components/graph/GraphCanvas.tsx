"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeChangeset,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { buildGraph, type GraphEdge, type GraphNode } from "@/lib/graph/build";
import { layoutGraph, layoutSignature } from "@/lib/graph/layout";
import { useInvestigationStore } from "@/stores/investigation";

import { nodeTypes } from "./nodes/node-types";

type Point = { x: number; y: number };
type DragState = { key: string; positions: Map<string, Point> };

const FIT_PADDING = { top: "20px", right: "24px", bottom: "28px", left: "16px" } as const;
const EMPTY_DRAGS = new Map<string, Point>();

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function GraphView() {
  const investigation = useInvestigationStore((state) => state.investigation);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const collapsedBranchIds = useInvestigationStore((state) => state.collapsedBranchIds);
  const setSelected = useInvestigationStore((state) => state.setSelected);
  const toggleCollapsed = useInvestigationStore((state) => state.toggleCollapsed);
  const [showGaps, setShowGaps] = useState(true);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [dragState, setDragState] = useState<DragState>({ key: "", positions: new Map() });
  const fittedCount = useRef<number | null>(null);
  const { fitView } = useReactFlow();

  const model = useMemo(() => {
    if (!investigation) {
      return {
        nodes: [] as GraphNode[],
        edges: [] as GraphEdge[],
        key: "empty",
        verifiedClaims: 0,
        running: false,
        gapCount: 0,
      };
    }
    const built = buildGraph(investigation, {
      collapsedBranchIds,
      selectedNodeId,
      showGaps,
    });
    const key = layoutSignature(
      built.nodes.map((node) => node.id),
      collapsedBranchIds,
      layoutEpoch,
    );
    return {
      nodes: layoutGraph(built.nodes, built.edges, key),
      edges: built.edges,
      key,
      verifiedClaims: investigation.claims.filter((claim) => claim.verified).length,
      running: investigation.branches.some((branch) => branch.status === "running"),
      gapCount: investigation.gaps.filter((gap) => gap.status !== "dismissed").length,
    };
  }, [investigation, collapsedBranchIds, selectedNodeId, showGaps, layoutEpoch]);

  const dragPositions = dragState.key === model.key ? dragState.positions : EMPTY_DRAGS;

  const nodes = useMemo(() => {
    if (dragPositions.size === 0) return model.nodes;
    return model.nodes.map((node) => {
      const position = dragPositions.get(node.id);
      return position ? { ...node, position } : node;
    });
  }, [model.nodes, dragPositions]);

  const nodeCount = nodes.length;

  useEffect(() => {
    if (nodeCount === 0 || fittedCount.current === nodeCount) return;
    fittedCount.current = nodeCount;
    const duration = prefersReducedMotion() ? 0 : 450;
    const timer = window.setTimeout(() => {
      void fitView({ padding: FIT_PADDING, duration });
    }, 40);
    return () => window.clearTimeout(timer);
  }, [nodeCount, fitView]);

  const onNodesChange = useCallback(
    (changes: NodeChangeset<GraphNode>) => {
      const updates = changes.getByType("position");
      if (updates.length === 0) return;
      setDragState((current) => {
        const base = current.key === model.key ? new Map(current.positions) : new Map<string, Point>();
        let changed = false;
        for (const update of updates) {
          if (!update.position) continue;
          const previous = base.get(update.id);
          if (previous && previous.x === update.position.x && previous.y === update.position.y) continue;
          base.set(update.id, update.position);
          changed = true;
        }
        if (!changed && current.key === model.key) return current;
        return { key: model.key, positions: base };
      });
    },
    [model.key],
  );

  const onNodeClick = useCallback(
    (_event: MouseEvent, node: GraphNode) => {
      setSelected(node.id);
    },
    [setSelected],
  );

  const onNodeDoubleClick = useCallback(
    (_event: MouseEvent, node: GraphNode) => {
      if (node.type !== "branch") return;
      toggleCollapsed(node.data.branchId);
    },
    [toggleCollapsed],
  );

  const onPaneClick = useCallback(() => {
    setSelected(null);
  }, [setSelected]);

  const onFit = useCallback(() => {
    void fitView({ padding: FIT_PADDING, duration: prefersReducedMotion() ? 0 : 400 });
  }, [fitView]);

  const onReset = useCallback(() => {
    setLayoutEpoch((epoch) => epoch + 1);
  }, []);

  const onToggleGaps = useCallback(() => {
    setShowGaps((current) => !current);
  }, []);

  const doorsOpening = model.verifiedClaims === 0 && model.running;
  const gapsDisabled = model.gapCount === 0 || model.verifiedClaims === 0;

  return (
    <section aria-label="Investigation map" className="relative flex h-full min-h-[50vh] w-full flex-col">
      <div className="flex flex-wrap gap-2 p-3" role="toolbar" aria-label="Graph tools">
        <Button type="button" size="sm" variant="outline" className="cursor-pointer bg-midnight/80" onClick={onFit}>
          Fit view
        </Button>
        <Button type="button" size="sm" variant="outline" className="cursor-pointer bg-midnight/80" onClick={onReset}>
          Reset layout
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="cursor-pointer bg-midnight/80"
          aria-pressed={showGaps}
          disabled={gapsDisabled}
          onClick={onToggleGaps}
        >
          {showGaps ? "Hide gaps" : "Show gaps"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0">
          <ReactFlow
            className="h-full w-full"
            nodes={nodes}
            edges={model.edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            nodesConnectable={false}
            edgesReconnectable={false}
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            zoomOnDoubleClick={false}
            minZoom={0.25}
            maxZoom={1.75}
            forceColorMode="dark"
          >
            <Background bgColor="transparent" color="rgba(229, 225, 240, 0.16)" gap={26} size={1.1} />
            <Controls showInteractive={false} showFitView={false} aria-label="Zoom" />
          </ReactFlow>
        </div>
      </div>

      {doorsOpening ? (
        <p
          className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-sm text-paper/70"
          aria-live="polite"
        >
          The doors are opening…
        </p>
      ) : null}
    </section>
  );
}

export function GraphCanvas() {
  return (
    <ReactFlowProvider>
      <GraphView />
    </ReactFlowProvider>
  );
}
