/**
 * buildSkillTree: lays an investigation out as a skill tree.
 *
 *   - "Start here" (the question) sits at the center.
 *   - Each research branch is a colored REGION: a fan-shaped sector around the center with its door
 *     node at the inner tip. Regions are separated by empty lanes.
 *   - Findings (verified claims) fill each region outward from its door, packed so that no node or
 *     label overlaps another. Open gaps take the outer edge as locked nodes. Gaps that belong to no
 *     branch sit around the start node.
 *   - Every node hangs from a parent (the nearest node further in, preferring a finding quoted from
 *     the same page), and each parent-child pair is joined by a winding trail with waypoint dots.
 *     Mad Hatter connections are curves that bow around the middle of the map.
 *
 * Deterministic (seeded by ids, never Math.random) and stable while an investigation grows: a new
 * finding takes the next free spot in its region and never moves the findings already placed.
 * Pure and client-safe: call it in a useMemo on the investigation.
 */
import type { Claim, Gap, Investigation } from "@/lib/types";

import {
  boxCorners,
  boxesOverlap,
  bowedCurve,
  circleBox,
  convexHull,
  dist,
  hashInts,
  hashString,
  polar,
  ringPoints,
  round1,
  segmentHitsBox,
  smoothClosedPath,
  straightTrail,
  unionBoxes,
  unit,
  windingTrail,
  type Circle,
} from "./geometry";
import { alternateLabel, fallbackLabel, LABEL, wrapLabel } from "./labels";
import {
  REGION_COLORS,
  type Box,
  type DoorSkillNode,
  type EvidenceTrail,
  type FindingSkillNode,
  type GapSkillNode,
  type LinkTrail,
  type PathTrail,
  type Point,
  type RegionColor,
  type SkillNode,
  type SkillRegion,
  type SkillTree,
  type SkillTreeOptions,
  type StartSkillNode,
} from "./types";

// Node ids: identical to src/lib/graph/build.ts so selection and the panels keep working.
export const START_NODE_ID = "root";
export const doorNodeId = (branchId: string): string => `branch:${branchId}`;
export const findingNodeId = (claimId: string): string => `claim:${claimId}`;
export const gapNodeId = (gapId: string): string => `gap:${gapId}`;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const SKILL_TREE = {
  radius: { start: 40, door: 26, finding: 15, gap: 13 },
  /** Room reserved for an 11px label line (the UI should render labels at this size or smaller). */
  label: { charWidth: 6.3, lineHeight: 13, gap: 6, pad: 6 },
  /** Door labels are the branch title in 12-13px semibold. */
  doorLabel: { charWidth: 7.2, lineHeight: 15, lineChars: 20, maxLines: 3 },
  /** Empty space kept around every node-plus-label footprint. */
  margin: 12,
  /** Extra personal space (0 to this much, fixed per node) so the packing looks hand-placed. */
  jitterSpace: 12,
  /** Width of the empty lane between neighbouring regions. */
  gutter: 64,
  /** Spacing of the candidate spots each region is packed from. */
  lattice: 34,
  /** Distance from the start node to each door. */
  doorDistance: (regions: number) => clamp(110 + 35 * regions, 180, 400),
  /** Regions never fan wider than this either side of their axis (matters with 1 or 2 branches). */
  maxHalfAngle: (80 * Math.PI) / 180,
  /** Children per parent before the trail has to branch from somewhere else. */
  maxChildren: { door: 4, finding: 3 },
  /** A finding prefers to hang from one quoted from the same page if it is this much closer or better. */
  sameSourcePull: 0.7,
  /** Each label a parent-child trail would cut through makes that parent this much (x) dearer. */
  labelCrossingCost: 0.9,
  /** Suggested camera zoom when focusing each kind of node. */
  zoom: { start: 1.4, door: 1.7, finding: 2.4, gap: 2.4 },
  /** Room reserved for a region's big title (about 20px heading type, wrapped to 2 lines). */
  regionTitle: { charWidth: 11.5, lineHeight: 26, lineChars: 24 },
} as const;

function titleSize(lines: string[]): { w: number; h: number } {
  const t = SKILL_TREE.regionTitle;
  return { w: Math.max(1, ...lines.map((l) => l.length)) * t.charWidth, h: lines.length * t.lineHeight };
}

type Kind = SkillNode["kind"];

/** A node's footprint relative to its center: the circle plus its label. */
type Shape = { dx: number; dy: number; width: number; height: number };

function labelLinesFor(kind: Kind, label: string): string[] {
  if (kind === "start") return [label];
  if (kind === "door") return wrapLabel(label, SKILL_TREE.doorLabel.lineChars, SKILL_TREE.doorLabel.maxLines);
  return wrapLabel(label, LABEL.lineChars, LABEL.maxLines);
}

/**
 * The label box relative to the node center: under the node, or (`beside`) to its right. Doors on
 * an up/down axis put their title beside them, so the trail from the start node does not run
 * through it.
 */
function labelOffset(kind: Kind, r: number, lines: string[], beside = false): Shape {
  const longest = Math.max(1, ...lines.map((l) => l.length));
  if (kind === "start") {
    const width = r * 1.6;
    const height = lines.length * SKILL_TREE.label.lineHeight;
    return { dx: -width / 2, dy: -height / 2, width, height };
  }
  const m = kind === "door" ? SKILL_TREE.doorLabel : SKILL_TREE.label;
  const width = longest * m.charWidth + SKILL_TREE.label.pad;
  const height = lines.length * m.lineHeight;
  if (beside) return { dx: r + SKILL_TREE.label.gap + 2, dy: -height / 2, width, height };
  return { dx: -width / 2, dy: r + SKILL_TREE.label.gap, width, height };
}

function shapeOf(kind: Kind, r: number, lines: string[], beside = false): Shape {
  const circle = { dx: -r, dy: -r, width: 2 * r, height: 2 * r };
  if (kind === "start") return circle;
  const l = labelOffset(kind, r, lines, beside);
  const x0 = Math.min(circle.dx, l.dx);
  const y0 = Math.min(circle.dy, l.dy);
  const x1 = Math.max(circle.dx + circle.width, l.dx + l.width);
  const y1 = Math.max(circle.dy + circle.height, l.dy + l.height);
  return { dx: x0, dy: y0, width: x1 - x0, height: y1 - y0 };
}

const place = (s: Shape, c: Point): Box => ({ x: c.x + s.dx, y: c.y + s.dy, width: s.width, height: s.height });

/** Signed angle difference normalized to (-PI, PI]. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d;
}

/** Inside the region's sector, at least `clearance` px from both of its edges. */
function insideSector(p: Point, axis: number, half: number, clearance: number): boolean {
  const r = Math.hypot(p.x, p.y);
  if (r < 1) return false;
  const room = half - Math.abs(angleDiff(Math.atan2(p.y, p.x), axis));
  if (room <= 0) return false;
  return room >= Math.PI / 2 || r * Math.sin(room) >= clearance;
}

/** Candidate spots: a jittered lattice, filtered by `keep`, sorted by `score` (lowest first). */
function candidates(seed: number, extent: number, keep: (p: Point) => boolean, score: (p: Point, noise: number) => number): Point[] {
  const step = SKILL_TREE.lattice;
  const n = Math.ceil(extent / step);
  const out: { p: Point; s: number }[] = [];
  for (let ix = -n; ix <= n; ix++) {
    for (let iy = -n; iy <= n; iy++) {
      const h = hashInts(seed, ix, iy);
      const p = {
        x: ix * step + (unit(h) - 0.5) * step * 0.9,
        y: iy * step + (unit(hashInts(h, 1)) - 0.5) * step * 0.9,
      };
      if (!keep(p)) continue;
      out.push({ p, s: score(p, unit(hashInts(h, 2)) - 0.5) });
    }
  }
  out.sort((a, b) => a.s - b.s);
  return out.map((c) => c.p);
}

const EVIDENCE_WORDS: Record<Claim["evidenceStatus"], string> = {
  corroborated: "corroborated by two or more websites",
  single_source: "one source",
  conflicting: "conflicts with another finding",
  outdated: "may be outdated",
  snippet_only: "search snippet only",
};

const BRANCH_STATUS_WORDS: Record<Investigation["branches"][number]["status"], string> = {
  idle: "Not searched yet",
  running: "Searching",
  done: "Done",
  failed: "Failed",
};

interface Member {
  kind: "finding" | "gap";
  id: string;
  label: string;
  lines: string[];
  shape: Shape;
  r: number;
  claim?: Claim;
  gap?: Gap;
}

/** Lay the investigation out as a skill tree. */
export function buildSkillTree(investigation: Investigation, options: SkillTreeOptions = {}): SkillTree {
  const showGaps = options.showGaps !== false;
  const R = SKILL_TREE.radius;
  const branches = investigation.branches;
  const branchIndex = new Map(branches.map((b, i) => [b.id, i]));
  const sourceById = new Map(investigation.sources.map((s) => [s.id, s]));
  const keyDiscoveryIds = new Set(investigation.report?.keyDiscoveries.map((d) => d.claimId) ?? []);
  const claims = investigation.claims.filter((c) => c.verified && branchIndex.has(c.branchId));
  const drawnClaimIds = new Set(claims.map((c) => c.id));
  const gaps = showGaps ? investigation.gaps.filter((g) => g.status !== "dismissed") : [];
  const linkCount = new Map<string, number>();
  for (const c of investigation.connections) {
    if (!drawnClaimIds.has(c.from) || !drawnClaimIds.has(c.to) || c.from === c.to) continue;
    linkCount.set(c.from, (linkCount.get(c.from) ?? 0) + 1);
    linkCount.set(c.to, (linkCount.get(c.to) ?? 0) + 1);
  }

  const nodes: SkillNode[] = [];
  const nodeById = new Map<string, SkillNode>();
  const footprints: Box[] = [];
  const add = (node: SkillNode, footprint: Box) => {
    nodes.push(node);
    nodeById.set(node.id, node);
    footprints.push(footprint);
  };
  const focus = (kind: Kind, c: Point) => ({ x: round1(c.x), y: round1(c.y), zoom: SKILL_TREE.zoom[kind] });
  const labelBox = (kind: Kind, r: number, lines: string[], c: Point, beside = false): Box => {
    const b = place(labelOffset(kind, r, lines, beside), c);
    return { x: round1(b.x), y: round1(b.y), width: round1(b.width), height: round1(b.height) };
  };

  // 1. Start here.
  const origin = { x: 0, y: 0 };
  const startLines = labelLinesFor("start", "Start here");
  const start: StartSkillNode = {
    id: START_NODE_ID,
    kind: "start",
    regionId: null,
    color: null,
    x: 0,
    y: 0,
    r: R.start,
    label: "Start here",
    labelLines: startLines,
    labelBox: labelBox("start", R.start, startLines, origin),
    labelInside: true,
    parentId: null,
    childIds: [],
    depth: 0,
    focus: focus("start", origin),
    ariaLabel: `Start here. Question: ${investigation.question}`,
    question: investigation.question,
  };
  add(start, circleBox(origin, R.start + 10));

  // 2. Regions, each packed outward from its door.
  const n = branches.length;
  const sweep = n > 0 ? (2 * Math.PI) / n : 2 * Math.PI;
  const half = Math.min(sweep / 2, SKILL_TREE.maxHalfAngle);
  const doorDistance = SKILL_TREE.doorDistance(n);
  const regions: SkillRegion[] = [];

  const regionMembers = new Map<string, Member[]>(branches.map((b) => [b.id, []]));
  const homeless: Member[] = [];
  const memberOf = (kind: "finding" | "gap", id: string, label: string, extra: Partial<Member>): Member => {
    const r = kind === "finding" ? R.finding : R.gap;
    const lines = labelLinesFor(kind, label);
    return { kind, id, label, lines, r, shape: shapeOf(kind, r, lines), ...extra };
  };
  // Labels are unique within a region: a repeat falls back to code-made labels, then a counter.
  const usedLabels = new Map<string, Set<string>>();
  const uniqueLabel = (regionId: string, given: string | undefined, text: string): string => {
    const used = usedLabels.get(regionId) ?? new Set<string>();
    usedLabels.set(regionId, used);
    const options = [given?.trim(), fallbackLabel(text), alternateLabel(text)].filter((s): s is string => Boolean(s));
    let label = options.find((s) => !used.has(s.toLowerCase()));
    for (let k = 2; !label; k++) {
      const numbered = `${options[0].slice(0, LABEL.maxChars - 3)} ·${k}`;
      if (!used.has(numbered.toLowerCase())) label = numbered;
    }
    used.add(label.toLowerCase());
    return label;
  };
  for (const claim of claims) {
    const label = uniqueLabel(claim.branchId, claim.label, claim.text);
    regionMembers.get(claim.branchId)!.push(memberOf("finding", findingNodeId(claim.id), label, { claim }));
  }
  for (const gap of gaps) {
    const regionId = gap.branchId && branchIndex.has(gap.branchId) ? gap.branchId : null;
    const label = uniqueLabel(regionId ?? "", gap.label, gap.question);
    const member = memberOf("gap", gapNodeId(gap.id), label, { gap });
    if (regionId) regionMembers.get(regionId)!.push(member);
    else homeless.push(member);
  }

  type Placed = { id: string; c: Point; dDoor: number; depth: number; children: number; kind: "door" | "finding"; sourceId?: string };
  const parentOf = new Map<string, string>();

  branches.forEach((branch, i) => {
    const axis = -Math.PI / 2 + i * sweep;
    const color: RegionColor = REGION_COLORS[i % REGION_COLORS.length];
    const seed = hashString(`region:${branch.id}`);
    const doorC = polar(doorDistance, axis);
    const doorId = doorNodeId(branch.id);
    const members = regionMembers.get(branch.id)!;
    const findingCount = members.filter((m) => m.kind === "finding").length;
    const openGapCount = members.filter((m) => m.kind === "gap" && m.gap!.status === "open").length;

    const doorLines = labelLinesFor("door", branch.title);
    const beside = Math.abs(Math.sin(axis)) > 0.7;
    const door: DoorSkillNode = {
      id: doorId,
      kind: "door",
      regionId: branch.id,
      color,
      x: round1(doorC.x),
      y: round1(doorC.y),
      r: R.door,
      label: branch.title,
      labelLines: doorLines,
      labelBox: labelBox("door", R.door, doorLines, doorC, beside),
      labelInside: false,
      parentId: START_NODE_ID,
      childIds: [],
      depth: 1,
      focus: focus("door", doorC),
      ariaLabel: `Door: ${branch.title}. ${BRANCH_STATUS_WORDS[branch.status]}. ${findingCount} ${findingCount === 1 ? "finding" : "findings"}, ${openGapCount} open ${openGapCount === 1 ? "gap" : "gaps"}.`,
      branchId: branch.id,
      title: branch.title,
      status: branch.status,
      findingCount,
      openGapCount,
    };
    const doorFootprint = place(shapeOf("door", R.door, doorLines, beside), doorC);
    add(door, doorFootprint);
    parentOf.set(doorId, START_NODE_ID);
    const local: Box[] = [doorFootprint];
    const localLabels: Box[] = [door.labelBox];

    const extent = doorDistance + 140 + 150 * Math.sqrt(members.length + 1);
    const spots = candidates(
      seed,
      extent,
      (p) => {
        const r = Math.hypot(p.x, p.y);
        return r >= doorDistance + 24 && r <= extent && insideSector(p, axis, half, SKILL_TREE.gutter / 2);
      },
      (p, noise) => dist(p, doorC) + noise * 64,
    );
    const taken = new Uint8Array(spots.length);
    const placed: Placed[] = [{ id: doorId, c: doorC, dDoor: 0, depth: 1, children: 0, kind: "door" }];

    for (const m of members) {
      const space = SKILL_TREE.margin + unit(hashString(m.id)) * SKILL_TREE.jitterSpace;
      let c: Point | undefined;
      for (let k = 0; k < spots.length && !c; k++) {
        if (taken[k]) continue;
        const fp = place(m.shape, spots[k]);
        if (!boxCorners(fp).every((q) => insideSector(q, axis, half, SKILL_TREE.gutter / 2))) continue;
        if (local.some((b) => boxesOverlap(b, fp, space))) continue;
        taken[k] = 1;
        c = spots[k];
      }
      // Out of room (not expected: the extent grows with the member count): stack outward on the axis.
      if (!c) c = polar(extent + 90 * (local.length + 1), axis);
      const fp = place(m.shape, c);
      const ownLabel = labelBox(m.kind, m.r, m.lines, c);
      local.push(fp);
      localLabels.push(ownLabel);

      // Parent: the cheapest node further in that still has room for a child. Distance, made
      // cheaper by sharing a source page and dearer for every label the trail would cross.
      const dDoor = dist(c, doorC);
      const sourceId = m.claim?.sourceId;
      const cited = m.gap ? new Set(m.gap.claimIds.map(findingNodeId)) : null;
      const cost = (p: Placed) => {
        const crossings = localLabels.filter((b) => segmentHitsBox(p.c, c!, b)).length;
        return dist(p.c, c!) * (sourceId && p.sourceId === sourceId ? SKILL_TREE.sameSourcePull : 1) * (1 + SKILL_TREE.labelCrossingCost * crossings);
      };
      const pick = (pool: Placed[]) => pool.reduce<Placed | undefined>((best, p) => (!best || cost(p) < cost(best) ? p : best), undefined);
      const parent =
        (cited && pick(placed.filter((p) => cited.has(p.id)))) ||
        pick(placed.filter((p) => p.dDoor < dDoor && p.children < SKILL_TREE.maxChildren[p.kind])) ||
        pick(placed)!;
      parent.children++;
      parentOf.set(m.id, parent.id);
      const depth = parent.depth + 1;
      if (m.kind === "finding") placed.push({ id: m.id, c, dDoor, depth, children: 0, kind: "finding", sourceId });

      const base = {
        id: m.id,
        regionId: branch.id,
        color,
        x: round1(c.x),
        y: round1(c.y),
        r: m.r,
        label: m.label,
        labelLines: m.lines,
        labelBox: ownLabel,
        labelInside: false,
        parentId: parent.id,
        childIds: [],
        depth,
      };
      if (m.kind === "finding") {
        const claim = m.claim!;
        const key = keyDiscoveryIds.has(claim.id);
        const node: FindingSkillNode = {
          ...base,
          kind: "finding",
          focus: focus("finding", c),
          ariaLabel: `Finding: ${m.label}. ${claim.text} Evidence: ${EVIDENCE_WORDS[claim.evidenceStatus]}.${key ? " Key discovery." : ""}`,
          claimId: claim.id,
          branchId: claim.branchId,
          sourceId: claim.sourceId,
          evidenceStatus: claim.evidenceStatus,
          verified: claim.verified,
          keyDiscovery: key,
          readByBrowser: sourceById.get(claim.sourceId)?.retrievedVia === "browser",
          linkCount: linkCount.get(claim.id) ?? 0,
        };
        add(node, fp);
      } else {
        const gap = m.gap!;
        const node: GapSkillNode = {
          ...base,
          kind: "gap",
          focus: focus("gap", c),
          ariaLabel: `${gap.status === "open" ? "Locked gap" : "Resolved gap"} (${gap.kind}): ${gap.question}`,
          gapId: gap.id,
          gapKind: gap.kind,
          status: gap.status,
        };
        add(node, fp);
      }
    }

    const hullPoints: Point[] = [...ringPoints(doorC, R.door + 22)];
    for (const b of local) {
      const pad = 18;
      hullPoints.push(...boxCorners({ x: b.x - pad, y: b.y - pad, width: b.width + 2 * pad, height: b.height + 2 * pad }));
    }

    // Big region title: beyond the farthest node along the axis, clear of every footprint.
    const u = { x: Math.cos(axis), y: Math.sin(axis) };
    const reach = Math.max(...local.flatMap(boxCorners).map((q) => q.x * u.x + q.y * u.y));
    const titleLines = wrapLabel(branch.title, SKILL_TREE.regionTitle.lineChars, 2);
    const { w: titleW, h: titleH } = titleSize(titleLines);
    const clearance = 24 + Math.abs(u.x) * (titleW / 2) + Math.abs(u.y) * (titleH / 2);
    regions.push({
      id: branch.id,
      title: branch.title,
      color,
      status: branch.status,
      angle: round1((axis * 180) / Math.PI),
      doorId,
      nodeIds: [doorId, ...members.map((m) => m.id)],
      findingCount,
      openGapCount,
      hull: smoothClosedPath(convexHull(hullPoints)),
      bounds: unionBoxes(local, 22),
      labelAt: { x: round1(u.x * (reach + clearance)), y: round1(u.y * (reach + clearance)) },
      titleLines,
    });
  });

  // 3. Gaps that belong to no branch: around the start node, in the lanes between regions.
  if (homeless.length) {
    const seed = hashString("homeless-gaps");
    const reach = doorDistance + 260;
    const axisAngles = branches.map((_, i) => -Math.PI / 2 + i * sweep);
    const offAxis = (p: Point) =>
      axisAngles.length === 0 ? 1 : Math.min(...axisAngles.map((a) => Math.abs(angleDiff(Math.atan2(p.y, p.x), a)))) / (sweep / 2);
    const spots = candidates(
      seed,
      reach,
      (p) => {
        const r = Math.hypot(p.x, p.y);
        return r >= R.start + 70 && r <= reach;
      },
      (p, noise) => Math.hypot(p.x, p.y) + 140 * (1 - Math.min(1, offAxis(p))) + noise * 40,
    );
    const taken = new Uint8Array(spots.length);
    for (const m of homeless) {
      let c: Point | undefined;
      for (let k = 0; k < spots.length && !c; k++) {
        if (taken[k]) continue;
        const fp = place(m.shape, spots[k]);
        if (footprints.some((b) => boxesOverlap(b, fp, SKILL_TREE.margin))) continue;
        taken[k] = 1;
        c = spots[k];
      }
      if (!c) c = polar(reach + 90 * homeless.indexOf(m), Math.PI / 2);
      const gap = m.gap!;
      parentOf.set(m.id, START_NODE_ID);
      const node: GapSkillNode = {
        id: m.id,
        kind: "gap",
        regionId: null,
        color: null,
        x: round1(c.x),
        y: round1(c.y),
        r: m.r,
        label: m.label,
        labelLines: m.lines,
        labelBox: labelBox("gap", m.r, m.lines, c),
        labelInside: false,
        parentId: START_NODE_ID,
        childIds: [],
        depth: 1,
        focus: focus("gap", c),
        ariaLabel: `${gap.status === "open" ? "Locked gap" : "Resolved gap"} (${gap.kind}): ${gap.question}`,
        gapId: gap.id,
        gapKind: gap.kind,
        status: gap.status,
      };
      add(node, place(m.shape, c));
    }
  }

  for (const [child, parent] of parentOf) nodeById.get(parent)?.childIds.push(child);

  // 4. Trails.
  const circles: Circle[] = nodes.map((nd) => ({ x: nd.x, y: nd.y, r: nd.r }));
  const circleOf = (nd: SkillNode): Circle => ({ x: nd.x, y: nd.y, r: nd.r });
  const paths: PathTrail[] = [];
  for (const nd of nodes) {
    if (!nd.parentId) continue;
    const parent = nodeById.get(nd.parentId)!;
    const w = windingTrail(circleOf(parent), circleOf(nd), hashString(`trail:${nd.id}`), circles);
    paths.push({
      id: `trail:${parent.id}->${nd.id}`,
      kind: "path",
      from: parent.id,
      to: nd.id,
      regionId: nd.regionId,
      color: nd.color,
      d: w.d,
      end: w.end,
      points: w.points,
      waypoints: w.waypoints,
      arrows: w.arrows,
      locked: nd.kind === "gap" && nd.status === "open",
    });
  }

  const links: LinkTrail[] = [];
  const planChanging = new Set(investigation.report?.planChangingConnections.map((p) => p.connectionId) ?? []);
  for (const c of investigation.connections) {
    const from = nodeById.get(findingNodeId(c.from));
    const to = nodeById.get(findingNodeId(c.to));
    if (!from || !to || from === to) continue;
    const curve = bowedCurve(circleOf(from), circleOf(to), origin);
    links.push({
      id: `link:${c.id}`,
      kind: "link",
      from: from.id,
      to: to.id,
      regionId: from.regionId === to.regionId ? from.regionId : null,
      color: null,
      d: curve.d,
      end: curve.end,
      connectionId: c.id,
      relationship: c.relationship,
      accepted: c.accepted === true,
      explanation: c.explanation,
      planChanging: planChanging.has(c.id),
      labelAt: curve.mid,
    });
  }

  const evidence: EvidenceTrail[] = [];
  for (const nd of nodes) {
    if (nd.kind !== "gap") continue;
    const gap = gaps.find((g) => g.id === nd.gapId)!;
    for (const claimId of gap.claimIds) {
      const target = nodeById.get(findingNodeId(claimId));
      if (!target) continue;
      const s = straightTrail(circleOf(nd), circleOf(target));
      evidence.push({
        id: `evidence:${gap.id}:${claimId}`,
        kind: "evidence",
        from: nd.id,
        to: target.id,
        regionId: nd.regionId === target.regionId ? nd.regionId : null,
        color: nd.color,
        d: s.d,
        end: s.end,
        gapId: gap.id,
        claimId,
      });
    }
  }

  // 5. Bounds and the layout key.
  const titleBoxes = regions.map((r) => {
    const { w, h } = titleSize(r.titleLines);
    return { x: r.labelAt.x - w / 2, y: r.labelAt.y - h / 2, width: w, height: h };
  });
  const bounds = unionBoxes([...footprints, ...regions.map((r) => r.bounds), ...titleBoxes], 24);
  const layoutKey = hashString(nodes.map((nd) => `${nd.id}@${nd.x},${nd.y}`).join("|")).toString(36);

  return { nodes, regions, trails: [...paths, ...links, ...evidence], bounds, layoutKey };
}
