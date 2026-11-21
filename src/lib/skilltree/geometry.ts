/**
 * Geometry helpers for the skill tree: seeded randomness (the layout never uses Math.random, so
 * the same investigation always gives the same picture), boxes, hulls and trail paths.
 */
import type { Arrow, Box, Point } from "./types";

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mixes integers into a seed (murmur3 finalizer per step). */
export function hashInts(seed: number, ...ints: number[]): number {
  let h = seed >>> 0;
  for (const n of ints) {
    h = (h ^ (n | 0)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h = (h ^ (h >>> 16)) >>> 0;
  }
  return h >>> 0;
}

/** A hash as a number in [0, 1). */
export const unit = (h: number): number => (h >>> 0) / 4294967296;

/** mulberry32: a small, fast seeded PRNG returning numbers in [0, 1). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Points and boxes
// ---------------------------------------------------------------------------

export const round1 = (n: number): number => Math.round(n * 10) / 10;

export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export const polar = (r: number, angle: number): Point => ({ x: r * Math.cos(angle), y: r * Math.sin(angle) });

export function degrees(from: Point, to: Point): number {
  return round1((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI);
}

export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  return (
    a.x < b.x + b.width + margin &&
    b.x < a.x + a.width + margin &&
    a.y < b.y + b.height + margin &&
    b.y < a.y + a.height + margin
  );
}

export function unionBoxes(boxes: Box[], pad = 0): Box {
  if (boxes.length === 0) return { x: -pad, y: -pad, width: 2 * pad, height: 2 * pad };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.width);
    y1 = Math.max(y1, b.y + b.height);
  }
  return { x: round1(x0 - pad), y: round1(y0 - pad), width: round1(x1 - x0 + 2 * pad), height: round1(y1 - y0 + 2 * pad) };
}

export const circleBox = (c: Point, r: number): Box => ({ x: c.x - r, y: c.y - r, width: 2 * r, height: 2 * r });

/** Whether the segment a-b passes through the box (Liang-Barsky clipping). */
export function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.width - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

export function boxCorners(b: Box): Point[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ];
}

// ---------------------------------------------------------------------------
// Region hulls
// ---------------------------------------------------------------------------

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** A closed, rounded SVG path through a polygon (quadratic curves through the edge midpoints). */
export function smoothClosedPath(poly: Point[]): string {
  if (poly.length < 3) return "";
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const n = poly.length;
  const start = mid(poly[n - 1], poly[0]);
  const parts = [`M${round1(start.x)} ${round1(start.y)}`];
  for (let i = 0; i < n; i++) {
    const m = mid(poly[i], poly[(i + 1) % n]);
    parts.push(`Q${round1(poly[i].x)} ${round1(poly[i].y)} ${round1(m.x)} ${round1(m.y)}`);
  }
  return `${parts.join(" ")}Z`;
}

/** Points on a circle, for building hulls around round nodes. */
export function ringPoints(c: Point, r: number, count = 10): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });
}

// ---------------------------------------------------------------------------
// Trails
// ---------------------------------------------------------------------------

export type Circle = { x: number; y: number; r: number };

const pathData = (points: Point[]): string =>
  points.map((p, i) => `${i === 0 ? "M" : "L"}${round1(p.x)} ${round1(p.y)}`).join(" ");

export interface Winding {
  points: Point[];
  waypoints: Point[];
  d: string;
  end: Arrow;
  arrows: Arrow[];
}

/** Distance from p to the segment a-b. */
function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** How many other nodes a polyline runs through (or grazes within `clearance` px). */
function polylineHits(points: Point[], others: Circle[], clearance: number): number {
  let hits = 0;
  for (const o of others) {
    for (let i = 0; i < points.length - 1; i++) {
      if (segmentDistance(o, points[i], points[i + 1]) < o.r + clearance) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

/**
 * A hand-drawn-looking trail between two round nodes: a polyline that zigzags around the straight
 * line, tapering to the rims, with a vertex every ~30px. If it would run through another node, the
 * zigzag is calmed and the trail bows to one side or the other until it clears; if nothing clears,
 * the attempt crossing the fewest nodes wins.
 */
export function windingTrail(a: Circle, b: Circle, seed: number, obstacles: Circle[]): Winding {
  const len = Math.max(1e-6, dist(a, b));
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const nx = -uy;
  const ny = ux;
  const start = { x: a.x + ux * (a.r + 4), y: a.y + uy * (a.r + 4) };
  const end = { x: b.x - ux * (b.r + 5), y: b.y - uy * (b.r + 5) };
  const span = dist(start, end);
  const segments = Math.max(2, Math.min(12, Math.round(span / 30)));
  const amplitude = Math.min(13, span * 0.11);
  const others = obstacles.filter((o) => !(o.x === a.x && o.y === a.y) && !(o.x === b.x && o.y === b.y));
  const attempts: { wiggle: number; bow: number }[] = [
    { wiggle: 1, bow: 0 },
    { wiggle: 0.5, bow: 0 },
    { wiggle: 0.4, bow: 1 },
    { wiggle: 0.4, bow: -1 },
    { wiggle: 0.3, bow: 2 },
    { wiggle: 0.3, bow: -2 },
    { wiggle: 0.2, bow: 3 },
    { wiggle: 0.2, bow: -3 },
    { wiggle: 0, bow: 0 },
  ];

  let points: Point[] = [start, end];
  let fewest = Infinity;
  for (const { wiggle, bow } of attempts) {
    const rand = seeded(seed);
    const pts: Point[] = [start];
    let side = rand() < 0.5 ? -1 : 1;
    for (let i = 1; i < segments; i++) {
      const t = (i + (rand() - 0.5) * 0.45) / segments;
      if (rand() < 0.72) side = -side;
      const taper = Math.sin(Math.PI * t);
      const offset = wiggle * amplitude * taper * side * (0.45 + 0.55 * rand()) + bow * 24 * taper;
      pts.push({ x: start.x + (end.x - start.x) * t + nx * offset, y: start.y + (end.y - start.y) * t + ny * offset });
    }
    pts.push(end);
    const hits = polylineHits(pts, others, 3);
    if (hits < fewest) {
      fewest = hits;
      points = pts;
    }
    if (hits === 0) break;
  }

  const last = points[points.length - 2];
  const arrows: Arrow[] = [];
  if (segments >= 6) {
    const i = Math.floor(segments / 2);
    const p = points[i];
    const q = points[i + 1];
    arrows.push({ x: round1((p.x + q.x) / 2), y: round1((p.y + q.y) / 2), angle: degrees(p, q) });
  }
  return {
    points: points.map((p) => ({ x: round1(p.x), y: round1(p.y) })),
    waypoints: points.slice(1, -1).map((p) => ({ x: round1(p.x), y: round1(p.y) })),
    d: pathData(points),
    end: { x: round1(end.x), y: round1(end.y), angle: degrees(last, end) },
    arrows,
  };
}

export interface Curve {
  d: string;
  end: Arrow;
  mid: Point;
}

/**
 * A quadratic curve between two nodes that bows away from `away` (the start node), so links between
 * regions arc around the middle of the map instead of crossing it.
 */
export function bowedCurve(a: Circle, b: Circle, away: Point, bendRatio = 0.22): Curve {
  const len = Math.max(1e-6, dist(a, b));
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let nx = -(b.y - a.y) / len;
  let ny = (b.x - a.x) / len;
  if ((m.x + nx - away.x) ** 2 + (m.y + ny - away.y) ** 2 < (m.x - nx - away.x) ** 2 + (m.y - ny - away.y) ** 2) {
    nx = -nx;
    ny = -ny;
  }
  const bend = Math.max(30, Math.min(220, len * bendRatio));
  const c = { x: m.x + nx * bend, y: m.y + ny * bend };
  const toward = (from: Circle, gap: number) => {
    const d = Math.max(1e-6, dist(from, c));
    return { x: from.x + ((c.x - from.x) / d) * (from.r + gap), y: from.y + ((c.y - from.y) / d) * (from.r + gap) };
  };
  const s = toward(a, 4);
  const e = toward(b, 6);
  const mid = { x: 0.25 * s.x + 0.5 * c.x + 0.25 * e.x, y: 0.25 * s.y + 0.5 * c.y + 0.25 * e.y };
  return {
    d: `M${round1(s.x)} ${round1(s.y)} Q${round1(c.x)} ${round1(c.y)} ${round1(e.x)} ${round1(e.y)}`,
    end: { x: round1(e.x), y: round1(e.y), angle: degrees(c, e) },
    mid: { x: round1(mid.x), y: round1(mid.y) },
  };
}

/** A straight trail between two node rims. */
export function straightTrail(a: Circle, b: Circle): { d: string; end: Arrow } {
  const len = Math.max(1e-6, dist(a, b));
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const s = { x: a.x + ux * (a.r + 4), y: a.y + uy * (a.r + 4) };
  const e = { x: b.x - ux * (b.r + 5), y: b.y - uy * (b.r + 5) };
  return { d: pathData([s, e]), end: { x: round1(e.x), y: round1(e.y), angle: degrees(s, e) } };
}
