/**
 * The skill-tree model: everything the UI needs to draw the investigation as a skill tree
 * (small round nodes in colored regions around a "Start here" node, joined by winding trails).
 *
 * All coordinates are React Flow "flow" coordinates in px at zoom 1, with nodes given by their
 * CENTER (render with nodeOrigin={[0.5, 0.5]}). The model is pure data: no React, no DOM.
 */
import type {
  BranchStatus,
  ConnectionRelationship,
  EvidenceStatus,
  GapKind,
  GapStatus,
  RetrievalStatus,
  RetrievedVia,
} from "@/lib/types";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };

/** Region colors, in the order regions receive them. The UI maps each key to a CSS color. */
export const REGION_COLORS = ["rose", "sky", "marigold", "mint", "violet", "coral", "teal", "lilac", "peach", "lime"] as const;
export type RegionColor = (typeof REGION_COLORS)[number];

export type SkillNodeKind = "start" | "door" | "finding" | "gap";

/** Camera target for "zoom into this node": pass to React Flow's setCenter(x, y, { zoom }). */
export type Focus = { x: number; y: number; zoom: number };

interface SkillNodeBase {
  /**
   * The same ids as src/lib/graph/build.ts ("root", "branch:<id>", "claim:<id>", "gap:<id>"),
   * so the store's selectedNodeId, the side panels and the list view keep working unchanged.
   */
  id: string;
  kind: SkillNodeKind;
  /** Branch id of the node's region; null for the start node and for gaps that belong to no branch. */
  regionId: string | null;
  color: RegionColor | null;
  /** Center. */
  x: number;
  y: number;
  /** Radius at zoom 1. */
  r: number;
  /** Short name (Claim.label / Gap.label / branch title; a code-made fallback for older saves). */
  label: string;
  /** `label` wrapped for display (1 or 2 lines). */
  labelLines: string[];
  /** Where the label goes: under the node, or inside it when `labelInside` is true. */
  labelBox: Box;
  labelInside: boolean;
  /** The node this one hangs from on its trail; null for the start node. */
  parentId: string | null;
  /** Ids of the nodes that hang from this one. */
  childIds: string[];
  /** Hops from the start node (start 0, door 1, ...). */
  depth: number;
  focus: Focus;
  /** Screen-reader text. */
  ariaLabel: string;
}

export interface StartSkillNode extends SkillNodeBase {
  kind: "start";
  question: string;
}

export interface DoorSkillNode extends SkillNodeBase {
  kind: "door";
  branchId: string;
  title: string;
  status: BranchStatus;
  findingCount: number;
  openGapCount: number;
}

export interface FindingSkillNode extends SkillNodeBase {
  kind: "finding";
  claimId: string;
  branchId: string;
  sourceId: string;
  evidenceStatus: EvidenceStatus;
  verified: boolean;
  /** Listed in the Golden Key report's key discoveries. */
  keyDiscovery: boolean;
  /** The page was read by the Solari cloud browser. */
  readByBrowser: boolean;
  /** Connections (Mad Hatter links) touching this finding. */
  linkCount: number;
}

export interface GapSkillNode extends SkillNodeBase {
  kind: "gap";
  gapId: string;
  gapKind: GapKind;
  /** "open" = a locked node (still unknown); "resolved" = unlocked. Dismissed gaps are not drawn. */
  status: GapStatus;
}

export type SkillNode = StartSkillNode | DoorSkillNode | FindingSkillNode | GapSkillNode;

/** An arrowhead: `angle` in degrees, 0 = pointing right, clockwise on screen (SVG rotate()). */
export type Arrow = { x: number; y: number; angle: number };

interface TrailBase {
  id: string;
  /** Node ids. */
  from: string;
  to: string;
  regionId: string | null;
  color: RegionColor | null;
  /** SVG path data in flow coordinates; starts and ends on the node rims. */
  d: string;
  /** The arrowhead where the trail enters `to`. */
  end: Arrow;
}

/** A trail of the tree (start -> door -> finding -> ...): a winding path dotted with waypoints. */
export interface PathTrail extends TrailBase {
  kind: "path";
  /** Every vertex of the path, rims included. */
  points: Point[];
  /** The little circles along the path (the interior vertices). */
  waypoints: Point[];
  /** Extra arrowheads along long trails (the end arrow is `end`). */
  arrows: Arrow[];
  /** The trail leads to an open gap (draw it dashed / faded). */
  locked: boolean;
}

/** A Mad Hatter connection between two findings, usually across regions: a curve that bows outward. */
export interface LinkTrail extends TrailBase {
  kind: "link";
  connectionId: string;
  relationship: ConnectionRelationship;
  accepted: boolean;
  explanation: string;
  /** Named in the report's plan-changing connections. */
  planChanging: boolean;
  /** Where a relationship label fits (the curve's midpoint). */
  labelAt: Point;
}

/** A gap pointing at a finding it is about. Meant to be shown only while that gap or finding is in focus. */
export interface EvidenceTrail extends TrailBase {
  kind: "evidence";
  gapId: string;
  claimId: string;
}

export type SkillTrail = PathTrail | LinkTrail | EvidenceTrail;

export interface SkillRegion {
  /** Branch id. */
  id: string;
  title: string;
  color: RegionColor;
  status: BranchStatus;
  /** Direction from the start node, degrees (0 = right, 90 = down). */
  angle: number;
  doorId: string;
  /** Door first, then findings and gaps in trail order. */
  nodeIds: string[];
  findingCount: number;
  openGapCount: number;
  /** A soft blob around the region's nodes (SVG path data) for a tinted background. */
  hull: string;
  /** Bounding box of the region's nodes and labels; fitBounds(bounds) zooms to the region. */
  bounds: Box;
  /** Where the region's big title goes (centered on this point, outside its nodes). */
  labelAt: Point;
  /** The title wrapped for the big region heading (1 or 2 lines, centered on labelAt). */
  titleLines: string[];
}

export interface SkillTree {
  nodes: SkillNode[];
  regions: SkillRegion[];
  /** Paths first, then links, then evidence trails. */
  trails: SkillTrail[];
  /** Everything (nodes, labels, hulls, region titles). */
  bounds: Box;
  /** Changes only when a node is added, removed or moved; use it to decide when to re-fit the view. */
  layoutKey: string;
}

export interface SkillTreeOptions {
  /** Draw gaps as locked nodes (default true). */
  showGaps?: boolean;
}

// ---------------------------------------------------------------------------
// Node pages (what the UI shows after zooming into a node)
// ---------------------------------------------------------------------------

export interface NodeRef {
  id: string;
  kind: SkillNodeKind;
  label: string;
  color: RegionColor | null;
}

export interface SourceRef {
  id: string;
  title: string;
  domain: string;
  /** Always http(s) (validated by PublicSourceSchema). */
  url: string;
  retrievalStatus: RetrievalStatus;
  retrievedVia?: RetrievedVia;
  publishedAt?: string;
}

export interface LinkRef {
  connectionId: string;
  relationship: ConnectionRelationship;
  /** "out": this finding is the connection's `from`; "in": it is the `to`. */
  direction: "out" | "in";
  other: NodeRef;
  explanation: string;
  accepted: boolean;
  /** The report's sentence about this link, when it is plan-changing. */
  planChanging?: string;
}

interface NodePageBase {
  id: string;
  kind: SkillNodeKind;
  label: string;
  color: RegionColor | null;
  /** Breadcrumbs from "Start here" to this node, both included. */
  trail: NodeRef[];
  parent: NodeRef | null;
  children: NodeRef[];
  /** Previous / next node in reading order (start, then each region's door, findings and gaps). */
  prev: NodeRef | null;
  next: NodeRef | null;
}

export interface StartPage extends NodePageBase {
  kind: "start";
  question: string;
  assumptions: string[];
  regions: (NodeRef & { title: string; status: BranchStatus; findingCount: number; openGapCount: number })[];
  /** The Golden Key report's direct answer, once written. */
  directAnswer?: string;
  stats: { findings: number; sources: number; openGaps: number; links: number; rejectedClaims: number };
}

export interface DoorPage extends NodePageBase {
  kind: "door";
  branchId: string;
  title: string;
  question: string;
  queries: string[];
  status: BranchStatus;
  findings: NodeRef[];
  gaps: NodeRef[];
  /** Sources cited by this region's findings, most-cited first. */
  sources: SourceRef[];
  evidence: Record<EvidenceStatus, number>;
}

export interface FindingPage extends NodePageBase {
  kind: "finding";
  claimId: string;
  text: string;
  /** The verified quote. */
  excerpt: string;
  verified: boolean;
  evidenceStatus: EvidenceStatus;
  /** One plain sentence explaining the evidence status. */
  evidenceNote: string;
  dateMentioned?: string;
  source: SourceRef | null;
  /** The report's summary when this is a key discovery. */
  keyDiscovery?: string;
  /** Other findings quoted from the same page. */
  samePage: NodeRef[];
  links: LinkRef[];
  /** Gaps that are about this finding. */
  gaps: (NodeRef & { question: string; gapKind: GapKind })[];
}

export interface GapPage extends NodePageBase {
  kind: "gap";
  gapId: string;
  question: string;
  whyItMatters: string;
  gapKind: GapKind;
  /** One plain sentence explaining the gap kind. */
  gapKindNote: string;
  status: GapStatus;
  suggestedQuery?: string;
  /** Findings the gap is about. */
  about: NodeRef[];
  /** The report's sentence about this gap, when it lists it as an uncertainty. */
  uncertainty?: string;
}

export type NodePage = StartPage | DoorPage | FindingPage | GapPage;
