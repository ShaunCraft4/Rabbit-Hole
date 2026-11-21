import type { NodeTypes } from "@xyflow/react";

import { DoorNode, FindingNode, GapNode, StartNode } from "./nodes";

/** Defined once so React Flow does not remount nodes on each render. */
export const skillNodeTypes = {
  start: StartNode,
  door: DoorNode,
  finding: FindingNode,
  gap: GapNode,
} satisfies NodeTypes;
