import type { NodeTypes } from "@xyflow/react";

import { BranchNode } from "./BranchNode";
import { DiscoveryNode } from "./DiscoveryNode";
import { GapNode } from "./GapNode";
import { RootNode } from "./RootNode";

/** Defined once so React Flow does not remount nodes on each render. */
export const nodeTypes = {
  root: RootNode,
  branch: BranchNode,
  claim: DiscoveryNode,
  gap: GapNode,
} satisfies NodeTypes;
