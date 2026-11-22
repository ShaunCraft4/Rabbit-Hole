"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { Button } from "@/components/ui/button";
import { buildNodePage, buildSkillTree, type SkillTree } from "@/lib/skilltree";
import { useInvestigationStore } from "@/stores/investigation";

import { SkillTreeUiProvider, type SkillTreeUi } from "./skilltree/context";
import { skillNodeTypes } from "./skilltree/node-types";
import type { SkillFlowNode } from "./skilltree/nodes";
import { NodePage } from "./skilltree/NodePage";
import { SkillBackdrop } from "./skilltree/SkillBackdrop";

function motionDuration(ms: number): number {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
}

function relatedIds(tree: SkillTree, selectedId: string | null): Set<string> | null {
  if (!selectedId || !tree.nodes.some((node) => node.id === selectedId)) return null;
  const related = new Set<string>([selectedId]);
  for (const trail of tree.trails) {
    if (trail.from === selectedId || trail.to === selectedId) {
      related.add(trail.from);
      related.add(trail.to);
    }
  }
  return related;
}

function GraphView() {
  const investigation = useInvestigationStore((state) => state.investigation);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const setSelected = useInvestigationStore((state) => state.setSelected);
  const [showGaps, setShowGaps] = useState(true);
  const [hoveredId, setHoveredIdState] = useState<string | null>(null);
  const [pageNodeId, setPageNodeId] = useState<string | null>(null);
  const [pageActive, setPageActive] = useState(false);
  const [fitTick, setFitTick] = useState(0);

  const flow = useReactFlow();
  const api = useRef(flow);
  const { zoom } = useViewport();
  const showMinorLabels = zoom >= 0.7;

  const tree = useMemo(() => {
    if (!investigation) return null;
    return buildSkillTree(investigation, { showGaps });
  }, [investigation, showGaps]);

  const treeRef = useRef(tree);
  const pageNodeIdRef = useRef(pageNodeId);
  const pageOpenRef = useRef(false);

  useLayoutEffect(() => {
    api.current = flow;
    treeRef.current = tree;
    pageNodeIdRef.current = pageNodeId;
  }, [flow, tree, pageNodeId]);
  const openedByUs = useRef<string | null>(null);
  const backRef = useRef<Viewport | null>(null);
  const cameraGen = useRef(0);
  const fitGen = useRef(0);
  const seenLayout = useRef<string | null>(null);
  const ready = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const savedViewport = useRef<Viewport | null>(null);

  const page = useMemo(() => {
    if (!investigation || !tree || !pageNodeId) return null;
    return buildNodePage(investigation, tree, pageNodeId);
  }, [investigation, tree, pageNodeId]);

  const related = pageActive && tree ? relatedIds(tree, selectedNodeId) : null;

  const flowNodes = useMemo((): SkillFlowNode[] => {
    if (!tree) return [];
    const hot = pageActive ? relatedIds(tree, selectedNodeId) : null;
    return tree.nodes.map((node) => ({
      id: node.id,
      type: node.kind,
      position: { x: node.x, y: node.y },
      data: { ...node, dimmed: hot !== null && !hot.has(node.id) } as SkillFlowNode["data"],
      width: node.r * 2,
      height: node.r * 2,
      style: { width: node.r * 2, height: node.r * 2 },
      draggable: false,
      connectable: false,
      selectable: true,
      focusable: false,
      selected: node.id === selectedNodeId,
      zIndex: 10,
    }));
  }, [tree, selectedNodeId, pageActive]);

  const openNode = useCallback(
    (id: string) => {
      const node = treeRef.current?.nodes.find((item) => item.id === id);
      if (!node) return;
      const gen = ++cameraGen.current;
      fitGen.current += 1;
      ready.current = true;
      openedByUs.current = id;
      if (!pageOpenRef.current) {
        backRef.current = api.current.getViewport();
      }
      pageOpenRef.current = true;
      setPageActive(true);
      setSelected(id);
      const duration = motionDuration(700);
      void api.current.setCenter(node.focus.x, node.focus.y, { zoom: node.focus.zoom, duration }).then(() => {
        if (cameraGen.current !== gen) return;
        pageNodeIdRef.current = id;
        setPageNodeId(id);
      });
    },
    [setSelected],
  );

  const closePage = useCallback(() => {
    if (!pageOpenRef.current && pageNodeIdRef.current === null) return;
    const gen = ++cameraGen.current;
    const id = openedByUs.current;
    pageNodeIdRef.current = null;
    setPageNodeId(null);
    setPageActive(false);
    const duration = motionDuration(600);
    const back = backRef.current;
    const current = treeRef.current;
    const finish = () => {
      if (cameraGen.current !== gen) return;
      pageOpenRef.current = false;
      if (id) document.getElementById(`skill-node-${id}`)?.focus({ preventScroll: true });
    };
    if (back) {
      void api.current.setViewport(back, { duration }).then(finish);
    } else if (current) {
      void api.current.fitBounds(current.bounds, { padding: 0.08, duration }).then(finish);
    } else {
      finish();
    }
  }, []);

  const onFit = useCallback(() => {
    const current = treeRef.current;
    if (!current) return;
    const gen = ++cameraGen.current;
    fitGen.current += 1;
    pageNodeIdRef.current = null;
    setPageNodeId(null);
    setPageActive(false);
    void api.current.fitBounds(current.bounds, { padding: 0.08, duration: motionDuration(450) }).then(() => {
      if (cameraGen.current !== gen) return;
      pageOpenRef.current = false;
      backRef.current = api.current.getViewport();
    });
  }, []);

  // Next hides this page (React Activity) when navigating away: effects clean up on hide and run
  // again on show, and React Flow's camera comes back at the default view. Remember the camera on
  // hide and put it back on show, once React Flow's pan-zoom is ready again. (Declared before the
  // fit effect, so a layout that changed while hidden is still re-fitted afterwards.)
  useEffect(() => {
    const saved = savedViewport.current;
    let cancel = false;
    let frame = 0;
    let tries = 0;
    const restore = () => {
      if (cancel || !saved) return;
      void api.current
        .setViewport(saved)
        .catch(() => false)
        .then((applied) => {
          if (!cancel && !applied && tries++ < 60) frame = requestAnimationFrame(restore);
        });
    };
    restore();
    return () => {
      cancel = true;
      cancelAnimationFrame(frame);
      if (ready.current) savedViewport.current = api.current.getViewport();
    };
  }, []);

  useEffect(() => {
    const current = treeRef.current;
    if (!current) return;
    if (seenLayout.current === current.layoutKey) return;
    if (pageOpenRef.current) {
      seenLayout.current = current.layoutKey;
      return;
    }
    const gen = ++fitGen.current;
    let cancel = false;
    let frame = 0;
    let tries = 0;
    // The layout counts as fitted only once a fit is applied. (React runs effects twice in
    // development, and the first run's fit is cancelled by its cleanup.) On first mount React
    // Flow's pan-zoom may not exist yet and fitBounds resolves false without moving the camera,
    // so retry each frame (about a second at most) until the canvas has a size and the fit lands.
    const attempt = () => {
      if (cancel || fitGen.current !== gen) return;
      const box = canvasRef.current;
      const sized = box !== null && box.clientWidth > 0 && box.clientHeight > 0;
      const run = sized
        ? api.current.fitBounds(current.bounds, { padding: 0.08, duration: motionDuration(450) })
        : Promise.resolve(false);
      void run
        .catch(() => false)
        .then((applied) => {
          if (cancel || fitGen.current !== gen) return;
          if (!applied && tries++ < 60) {
            frame = requestAnimationFrame(attempt);
            return;
          }
          seenLayout.current = current.layoutKey;
          ready.current = true;
          setFitTick((tick) => tick + 1);
        });
    };
    attempt();
    return () => {
      cancel = true;
      cancelAnimationFrame(frame);
    };
  }, [tree?.layoutKey]);

  useEffect(() => {
    if (!selectedNodeId) {
      openedByUs.current = null;
      return;
    }
    if (!ready.current) return;
    if (openedByUs.current === selectedNodeId) return;
    if (!treeRef.current?.nodes.some((node) => node.id === selectedNodeId)) return;
    openNode(selectedNodeId);
  }, [selectedNodeId, fitTick, openNode]);

  useEffect(() => {
    if (!pageNodeId || !tree) return;
    if (tree.nodes.some((node) => node.id === pageNodeId)) return;
    closePage();
  }, [pageNodeId, tree, closePage]);

  useEffect(() => {
    if (!pageActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePage();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageActive, closePage]);

  const setHoveredId = useCallback((id: string | null) => {
    setHoveredIdState((current) => (current === id ? current : id));
  }, []);

  const ui = useMemo<SkillTreeUi>(
    () => ({ openNode, setHoveredId, showMinorLabels }),
    [openNode, setHoveredId, showMinorLabels],
  );

  const onPaneClick = useCallback(() => {
    if (pageOpenRef.current) {
      closePage();
      return;
    }
    openedByUs.current = null;
    setSelected(null);
  }, [closePage, setSelected]);

  const gapCount = investigation?.gaps.filter((gap) => gap.status !== "dismissed").length ?? 0;
  const running = investigation?.branches.some((branch) => branch.status === "running") ?? false;
  const verifiedClaims = investigation?.claims.filter((claim) => claim.verified).length ?? 0;
  const doorsOpening = verifiedClaims === 0 && running;
  const settledQuiet =
    investigation !== null &&
    !running &&
    verifiedClaims === 0 &&
    investigation.branches.length > 0 &&
    investigation.branches.every((branch) => branch.status === "done" || branch.status === "failed");

  return (
    <section aria-label="Investigation map" className="relative flex h-full min-h-[50vh] w-full flex-col">
      <div className="flex flex-wrap gap-2 p-3" role="toolbar" aria-label="Graph tools">
        <Button type="button" size="sm" variant="outline" className="cursor-pointer bg-midnight/80" onClick={onFit}>
          Fit view
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="cursor-pointer bg-midnight/80"
          aria-pressed={showGaps}
          disabled={gapCount === 0}
          onClick={() => setShowGaps((current) => !current)}
        >
          {showGaps ? "Hide gaps" : "Show gaps"}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1">
        <SkillTreeUiProvider value={ui}>
          <div ref={canvasRef} className="absolute inset-0">
            <ReactFlow
              className="skill-flow h-full w-full"
              nodes={flowNodes}
              edges={[]}
              nodeTypes={skillNodeTypes}
              nodeOrigin={[0.5, 0.5]}
              onPaneClick={onPaneClick}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              elementsSelectable
              autoPanOnNodeFocus={false}
              edgesReconnectable={false}
              deleteKeyCode={null}
              selectionKeyCode={null}
              multiSelectionKeyCode={null}
              zoomOnDoubleClick={false}
              selectionOnDrag={false}
              minZoom={0.2}
              maxZoom={3}
              zIndexMode="manual"
              forceColorMode="dark"
              proOptions={{ hideAttribution: true }}
            >
              <Background bgColor="transparent" color="rgba(229, 225, 240, 0.16)" gap={26} size={1.1} />
              <Controls showInteractive={false} showFitView={false} aria-label="Zoom" />
              {tree ? <SkillBackdrop tree={tree} selectedId={selectedNodeId} hoveredId={hoveredId} related={related} /> : null}
            </ReactFlow>
          </div>
          {page ? <NodePage page={page} onOpen={openNode} onZoomOut={closePage} /> : null}
        </SkillTreeUiProvider>
      </div>

      {doorsOpening ? (
        <p className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 text-sm text-paper/70" aria-live="polite">
          The doors are opening…
        </p>
      ) : null}
      {settledQuiet ? (
        <p className="pointer-events-none absolute bottom-6 left-1/2 z-10 max-w-sm -translate-x-1/2 px-4 text-center text-sm text-paper/85">
          No verified findings yet. A door that failed can be retried on its own. Everything that succeeded stays.
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
