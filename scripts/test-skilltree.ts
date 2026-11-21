/**
 * Offline checks for the skill-tree backend (src/lib/skilltree) and the labels in the pipeline.
 * No keys, no network.
 *
 *   npx tsx scripts/test-skilltree.ts [more investigation files...]
 *
 * Runs on the committed fixture, any out/*.json saves, extra files given as arguments, and
 * synthetic investigations (tiny, empty, and a 10-branch stress case).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";

import { analyzeOutputSchema, extractOutputSchema } from "@/lib/ai/schemas";
import { InvestigationSchema, LIMITS } from "@/lib/contracts";
import { buildVerifiedClaims } from "@/lib/research/pipeline";
import {
  buildNodePage,
  buildSkillTree,
  cleanLabel,
  fallbackLabel,
  wrapLabel,
  type Box,
  type SkillNode,
  type SkillTree,
} from "@/lib/skilltree";
import type { Claim, Gap, Investigation } from "@/lib/types";

let failures = 0;
let passes = 0;
function check(ok: boolean, label: string) {
  if (ok) passes++;
  else {
    failures++;
    console.log(`FAIL  ${label}`);
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function labelChecks() {
  console.log("labels");
  check(cleanLabel('"ASUCR grant cap."', "ASUCR grants are capped.") === "ASUCR grant cap", "cleanLabel strips quotes and the full stop");
  check(cleanLabel("$2,000 cap", "Grants are up to $1,500 per year.") === undefined, "cleanLabel rejects a number that is not in the claim");
  check(cleanLabel("$1,500 cap", "Grants are up to $1,500 per year.") === "$1,500 cap", "cleanLabel keeps a grounded number");
  check(cleanLabel("2026-27 cycle", "Applications for the 2026-27 cycle open in May.") === "2026-27 cycle", "cleanLabel keeps a grounded academic year");
  check(cleanLabel("one two three four five six", "x") === undefined, "cleanLabel rejects more than 5 words");
  check(cleanLabel("x".repeat(60), "x") === undefined, "cleanLabel rejects an over-long label");
  check(cleanLabel("<b>Grant</b>", "Grant") === undefined, "cleanLabel rejects markup");
  check(cleanLabel("see https://evil.example", "x") === undefined, "cleanLabel rejects links");
  check(cleanLabel(42, "42") === undefined && cleanLabel(null, "") === undefined, "cleanLabel rejects non-strings");
  check(cleanLabel("food permit required", "A food permit is required.") === "Food permit required", "cleanLabel capitalizes");

  const fb1 = fallbackLabel("The Highlander Abroad Fund offers a $700 award for 2026-27.");
  check(fb1 === "Highlander Abroad Fund · $700", `fallbackLabel names + figure (${fb1})`);
  const fb2 = fallbackLabel("Funding requests must be submitted at least 14 days before the event date.");
  check(fb2 === "Funding requests · 14 days", `fallbackLabel topic + figure (${fb2})`);
  const fb3 = fallbackLabel("A registered student organization must hold current registration through Student Life.");
  check(fb3 === "Student Life", `fallbackLabel finds a mid-sentence name (${fb3})`);
  for (const t of ["", "   ", "a an the", "x".repeat(500)]) {
    const fb = fallbackLabel(t);
    check(fb.length > 0 && fb.length <= LIMITS.labelChars, `fallbackLabel is never empty or too long (${JSON.stringify(t.slice(0, 12))})`);
  }

  check(JSON.stringify(wrapLabel("SIP Grant · $9,000")) === JSON.stringify(["SIP Grant · $9,000"]), "wrapLabel keeps a short label on one line");
  const w = wrapLabel("FAFSA priority deadline · October 1");
  check(w.length <= 2 && !w.some((l) => l.endsWith("October")) && !w.some((l) => l.endsWith("·")), `wrapLabel keeps "October 1" and "· x" together (${w.join(" / ")})`);
  const long = wrapLabel("Chancellor's Research Fellowship application deadline window");
  check(long.length === 2 && long[1].endsWith("…"), `wrapLabel cuts to 2 lines with an ellipsis (${long.join(" / ")})`);

  // Labels through the model-output schemas and verification.
  const text = "Student organizations may request up to $1,500 per year from ASUCR.";
  const extracted = extractOutputSchema.parse({
    claims: [
      { sourceId: "src_a", excerpt: text, text, label: "ASUCR grant cap", claimType: "amount" },
      { sourceId: "src_a", excerpt: text, text: `${text} `, label: "$9,999 grant", claimType: "amount" },
      { sourceId: "src_a", excerpt: text, text, claimType: "amount" },
    ],
  });
  check(extracted.claims[0].label === "ASUCR grant cap", "extract keeps a valid model label");
  check(extracted.claims[1].label === undefined && extracted.claims.length === 3, "extract drops an ungrounded label but keeps the claim");
  const verified = buildVerifiedClaims(extracted.claims, {
    branchId: "b",
    idPrefix: "b",
    sources: new Map([["src_a", { text, retrievalStatus: "full_text" as const }]]),
  });
  check(verified.claims.every((c) => typeof c.label === "string" && c.label.length > 0), "verified claims always carry a label (model or fallback)");
  const analysis = analyzeOutputSchema.parse({
    gaps: [
      { kind: "missing", question: "Does the HUB require a food permit for events?", whyItMatters: "x y z w", claimIds: [], label: "HUB food permit" },
      { kind: "missing", question: "What is the deadline?", whyItMatters: "x y z w", claimIds: [], label: "Deadline 2031" },
    ],
  });
  check(analysis.gaps[0].label === "HUB food permit" && analysis.gaps[1].label === undefined, "analyze keeps a valid gap label and drops an ungrounded one");
}

// ---------------------------------------------------------------------------
// Synthetic investigations
// ---------------------------------------------------------------------------

const NAMES = ["ASUCR", "Highlander Union Board", "Student Life", "HUB Cultural Event Funds", "SIP Grant", "EH&S", "Gilman Program", "UCEAP", "Cal Grant", "FAFSA", "CHASS", "BCOE", "Procurement Department", "Dining Services", "Chancellor's Research Fellowship"];
const FIGURES = ["$500", "$1,500", "$3,000", "14 days", "30 days", "4 weeks", "October 1", "March 2", "2026-27", "12 units"];

function synthetic(branchCount: number, claimsPerBranch: number, gapCount: number, seed = 1): Investigation {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const branches = Array.from({ length: branchCount }, (_, i) => ({
    id: `branch-${i + 1}`,
    title: ["Funding sources", "Eligibility and approvals", "Deadlines and process", "Food and catering rules", "Venue booking", "Costs and limits", "Contacts", "Insurance", "Travel", "Reimbursement"][i % 10],
    question: `What does a club need to know about topic ${i + 1}?`,
    queries: [`topic ${i + 1} rules`, `topic ${i + 1} deadlines`],
    status: "done" as const,
  }));
  const sources = Array.from({ length: branchCount * 3 }, (_, i) => ({
    id: `src_${String(i).padStart(10, "0")}`,
    url: `https://example${i % 4}.edu/page-${i}`,
    domain: `example${i % 4}.edu`,
    title: `Page ${i}`,
    retrievalStatus: (i % 7 === 6 ? "snippet_only" : "full_text") as "snippet_only" | "full_text",
    ...(i % 5 === 0 ? { retrievedVia: "browser" as const } : {}),
  }));
  const statuses: Claim["evidenceStatus"][] = ["single_source", "single_source", "corroborated", "conflicting", "outdated", "snippet_only"];
  const claims: Claim[] = branches.flatMap((b, bi) =>
    Array.from({ length: claimsPerBranch }, (_, k) => {
      const name = pick(NAMES);
      const figure = pick(FIGURES);
      const text = `${name} requires ${figure} for student organization events in ${b.title.toLowerCase()}.`;
      return {
        id: `${b.id}-c${k + 1}`,
        branchId: b.id,
        text,
        excerpt: text,
        sourceId: sources[bi * 3 + (k % 3)].id,
        verified: true,
        evidenceStatus: pick(statuses),
        ...(k % 3 === 0 ? {} : { label: `${name.split(" ")[0]} · ${figure}` }),
      };
    }),
  );
  const gaps: Gap[] = Array.from({ length: gapCount }, (_, i) => {
    const homeless = i % 4 === 3;
    const branch = branches[i % branchCount];
    const cited = claims.filter((c) => c.branchId === branch.id).slice(0, i % 3);
    return {
      id: `gap-${i + 1}`,
      ...(homeless ? {} : { branchId: branch.id }),
      question: `Does ${pick(NAMES)} need a separate approval for item ${i + 1}?`,
      whyItMatters: "The event could be cancelled without it.",
      kind: (["missing", "conflict", "outdated", "weak"] as const)[i % 4],
      claimIds: homeless ? [] : cited.map((c) => c.id),
      status: (i % 7 === 5 ? "dismissed" : i % 7 === 6 ? "resolved" : "open") as Gap["status"],
    };
  });
  const connections = Array.from({ length: claims.length ? Math.min(LIMITS.maxConnections, branchCount * 2) : 0 }, (_, i) => {
    const a = claims[(i * 7) % claims.length];
    const b = claims[(i * 13 + claimsPerBranch) % claims.length];
    return {
      id: `conn-${i + 1}`,
      from: a.id,
      to: b.id,
      relationship: (["supports", "contradicts", "depends_on", "related_to"] as const)[i % 4],
      explanation: "One finding changes what the other one means for the plan.",
      ...(i % 2 ? { accepted: true } : {}),
    };
  }).filter((c) => c.from !== c.to);
  return {
    id: `synthetic-${branchCount}-${claimsPerBranch}`,
    question: "How can my student club fund a cultural night with food?",
    assumptions: ["Assuming the club is a registered student organization."],
    branches,
    sources,
    claims,
    gaps,
    connections,
    report: {
      directAnswer: "It depends.",
      keyDiscoveries: claims.slice(0, 3).map((c) => ({ claimId: c.id, summary: c.text })),
      planChangingConnections: connections.slice(0, 1).map((c) => ({ connectionId: c.id, text: c.explanation })),
      uncertainties: gaps.slice(0, 2).map((g) => ({ gapId: g.id, text: g.question })),
      nextSteps: [{ step: "Ask the office." }],
    },
    rejectedClaims: 3,
  };
}

// ---------------------------------------------------------------------------
// Tree checks
// ---------------------------------------------------------------------------

const circleBox = (n: SkillNode): Box => ({ x: n.x - n.r, y: n.y - n.r, width: 2 * n.r, height: 2 * n.r });
const overlap = (a: Box, b: Box, m = 0) => a.x < b.x + b.width + m && b.x < a.x + a.width + m && a.y < b.y + b.height + m && b.y < a.y + a.height + m;
const parts = (n: SkillNode): Box[] => (n.labelInside ? [circleBox(n)] : [circleBox(n), n.labelBox]);
const finite = (v: unknown): boolean =>
  typeof v === "number" ? Number.isFinite(v) : Array.isArray(v) ? v.every(finite) : v && typeof v === "object" ? Object.values(v).every(finite) : true;

function treeChecks(name: string, inv: Investigation) {
  const t0 = performance.now();
  const tree = buildSkillTree(inv);
  const ms = performance.now() - t0;
  const nodes = tree.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const branchIds = new Set(inv.branches.map((b) => b.id));
  const drawnClaims = inv.claims.filter((c) => c.verified && branchIds.has(c.branchId));
  const drawnGaps = inv.gaps.filter((g) => g.status !== "dismissed");

  // Node set and ids (the same ids as src/lib/graph/build.ts).
  const expected = ["root", ...inv.branches.map((b) => `branch:${b.id}`), ...drawnClaims.map((c) => `claim:${c.id}`), ...drawnGaps.map((g) => `gap:${g.id}`)];
  check(nodes.length === expected.length && expected.every((id) => byId.has(id)), `${name}: one node per start/branch/verified claim/non-dismissed gap`);
  check(byId.size === nodes.length, `${name}: node ids are unique`);
  check(finite(tree), `${name}: every coordinate is a finite number`);

  // Nothing overlaps: circles and labels of different nodes, region titles vs nodes.
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (parts(nodes[i]).some((a) => parts(nodes[j]).some((b) => overlap(a, b)))) {
        overlaps++;
        if (overlaps <= 3) console.log(`      overlap: ${nodes[i].id} / ${nodes[j].id}`);
      }
    }
  }
  check(overlaps === 0, `${name}: no node or label overlaps another (${overlaps} found)`);
  let crossRegion = 0;
  for (const a of nodes) {
    for (const b of nodes) {
      if (a.regionId && b.regionId && a.regionId < b.regionId && parts(a).some((x) => parts(b).some((y) => overlap(x, y, 24)))) crossRegion++;
    }
  }
  check(crossRegion === 0, `${name}: regions keep an empty lane between them (${crossRegion} close pairs)`);
  const titleHits = tree.regions.filter((r) => {
    const w = Math.max(...r.titleLines.map((l) => l.length)) * 11.5;
    const h = r.titleLines.length * 26;
    const box = { x: r.labelAt.x - w / 2, y: r.labelAt.y - h / 2, width: w, height: h };
    return nodes.some((n) => parts(n).some((p) => overlap(p, box)));
  });
  check(titleHits.length === 0, `${name}: region titles sit clear of every node`);

  // Tree structure.
  const orphans = nodes.filter((n) => n.id !== "root" && (!n.parentId || !byId.has(n.parentId)));
  check(orphans.length === 0, `${name}: every node except the start has a parent in the tree`);
  check(nodes.every((n) => !n.parentId || n.depth === byId.get(n.parentId)!.depth + 1), `${name}: depth = parent depth + 1`);
  check(nodes.every((n) => n.childIds.every((c) => byId.get(c)?.parentId === n.id)), `${name}: childIds match parentId`);
  const rooted = nodes.every((n) => {
    let cur: SkillNode | undefined = n;
    for (let k = 0; cur && k <= nodes.length; k++) {
      if (cur.id === "root") return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  });
  check(rooted, `${name}: every node's trail leads back to the start`);
  check(nodes.every((n) => n.kind !== "finding" || (n.regionId === byId.get(`claim:${n.claimId}`)?.regionId && n.regionId === n.branchId)), `${name}: findings sit in their branch's region`);

  // Trails.
  const paths = tree.trails.filter((t) => t.kind === "path");
  const links = tree.trails.filter((t) => t.kind === "link");
  const evidence = tree.trails.filter((t) => t.kind === "evidence");
  const drawnIds = new Set(drawnClaims.map((c) => c.id));
  const expectedLinks = inv.connections.filter((c) => drawnIds.has(c.from) && drawnIds.has(c.to) && c.from !== c.to).length;
  const drawnGapIds = new Set(drawnGaps.map((g) => g.id));
  const expectedEvidence = inv.gaps.filter((g) => drawnGapIds.has(g.id)).reduce((n, g) => n + g.claimIds.filter((id) => drawnIds.has(id)).length, 0);
  check(paths.length === nodes.length - 1, `${name}: one trail per parent-child pair (${paths.length})`);
  check(links.length === expectedLinks, `${name}: one link per drawable connection (${links.length}/${expectedLinks})`);
  check(evidence.length === expectedEvidence, `${name}: one evidence trail per gap-finding pair (${evidence.length})`);
  check(tree.trails.every((t) => byId.has(t.from) && byId.has(t.to)), `${name}: trails only join existing nodes`);
  check(tree.trails.every((t) => /^M-?[\d.]+ -?[\d.]+( [LQ]-?[\d.]+ -?[\d.]+( -?[\d.]+ -?[\d.]+)?)+$/.test(t.d)), `${name}: trail path data is well formed`);
  check(new Set(tree.trails.map((t) => t.id)).size === tree.trails.length, `${name}: trail ids are unique`);
  const segDist = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const through = paths.filter((p) =>
    nodes.some((n) => n.id !== p.from && n.id !== p.to && p.points.some((q, i) => i > 0 && segDist(n, p.points[i - 1], q) < n.r)),
  );
  // A trail may have to pass a node in a crowded spot; it must be rare.
  check(through.length <= Math.max(1, Math.floor(paths.length * 0.03)), `${name}: trails go around other nodes (${through.length} of ${paths.length} pass through one)`);
  if (through.length) console.log(`      through: ${through.map((p) => p.id).join(", ")}`);

  // Labels.
  const tooLong = nodes.filter((n) => !n.label || n.label.length > (n.kind === "door" ? LIMITS.branchTitleChars : LIMITS.labelChars));
  check(tooLong.length === 0, `${name}: finding and gap labels are 1-${LIMITS.labelChars} chars (${tooLong.map((n) => n.label).join(" | ")})`);
  check(nodes.every((n) => n.labelLines.length >= 1 && n.labelLines.length <= (n.kind === "door" ? 3 : 2)), `${name}: labels wrap to at most 2 lines (3 for doors)`);
  for (const r of tree.regions) {
    const labels = r.nodeIds.map((id) => byId.get(id)!.label.toLowerCase());
    check(new Set(labels).size === labels.length, `${name}: labels are unique within region ${r.id}`);
  }

  // Determinism and stability.
  const again = buildSkillTree(JSON.parse(JSON.stringify(inv)) as Investigation);
  check(JSON.stringify(again) === JSON.stringify(tree), `${name}: the same investigation gives the same tree`);
  const byBranch = new Map<string, Claim[]>();
  for (const c of drawnClaims) byBranch.set(c.branchId, [...(byBranch.get(c.branchId) ?? []), c]);
  const earlier = new Set([...byBranch.values()].flatMap((cs) => cs.slice(0, Math.ceil(cs.length / 2)).map((c) => c.id)));
  const partial = buildSkillTree({ ...inv, claims: inv.claims.filter((c) => earlier.has(c.id)), gaps: [], connections: [] });
  const moved = partial.nodes.filter((n) => n.kind === "finding" && (byId.get(n.id)?.x !== n.x || byId.get(n.id)?.y !== n.y));
  check(moved.length === 0, `${name}: findings already on the map do not move when more arrive (${moved.length} moved)`);

  // Node pages.
  const order: string[] = [];
  let pageProblems = 0;
  for (const n of nodes) {
    const page = buildNodePage(inv, tree, n.id);
    if (!page || page.kind !== n.kind || page.trail[0]?.id !== "root" || page.trail.at(-1)?.id !== n.id) pageProblems++;
    if (page && page.kind === "finding") {
      if (page.source && Object.keys(page.source).some((k) => !["id", "title", "domain", "url", "retrievalStatus", "retrievedVia", "publishedAt"].includes(k))) pageProblems++;
      if (page.links.some((l) => !byId.has(l.other.id))) pageProblems++;
    }
    if (page && page.kind === "door" && page.findings.length !== (byId.get(n.id) as Extract<SkillNode, { kind: "door" }>).findingCount) pageProblems++;
  }
  for (let cur = buildNodePage(inv, tree, "root"); cur && order.length <= nodes.length; cur = cur.next ? buildNodePage(inv, tree, cur.next.id) : null) order.push(cur.id);
  check(pageProblems === 0, `${name}: every node has a page with breadcrumbs from the start (${pageProblems} problems)`);
  check(order.length === nodes.length && new Set(order).size === nodes.length, `${name}: "next" walks every node exactly once`);
  check(buildNodePage(inv, tree, "claim:does-not-exist") === null, `${name}: an unknown node has no page`);

  console.log(
    `  ${name}: ${nodes.length} nodes, ${tree.regions.length} regions, ${paths.length} trails, ${links.length} links, ` +
      `${Math.round(tree.bounds.width)}x${Math.round(tree.bounds.height)} px, ${ms.toFixed(1)} ms`,
  );
  return tree;
}

function main() {
  labelChecks();

  console.log("\nskill tree");
  const files = ["src/fixtures/mock-investigation.json", "src/fixtures/demo-investigation.json", ...process.argv.slice(2)].filter((f) => existsSync(f));
  if (existsSync("out")) {
    for (const f of readdirSync("out")) if (f.endsWith(".json")) files.push(`out/${f}`);
  }
  for (const file of files) {
    const inv = InvestigationSchema.parse(JSON.parse(readFileSync(file, "utf8"))) as Investigation;
    treeChecks(file.replace(/^.*\//, ""), inv);
  }

  treeChecks("synthetic 1 branch", synthetic(1, 12, 4));
  treeChecks("synthetic 2 branches", synthetic(2, 9, 6, 7));
  treeChecks("synthetic 3 branches, no findings yet", { ...synthetic(3, 0, 0), claims: [], gaps: [], connections: [], report: undefined });
  const empty: Investigation = { ...synthetic(1, 0, 0), branches: [], claims: [], gaps: [], connections: [], report: undefined };
  const emptyTree: SkillTree = buildSkillTree(empty);
  check(emptyTree.nodes.length === 1 && emptyTree.trails.length === 0, "no branches: just the start node");
  const big = synthetic(LIMITS.maxBranches, 15, LIMITS.maxGaps, 3);
  treeChecks(`stress ${LIMITS.maxBranches} branches x 15 findings, ${LIMITS.maxGaps} gaps`, InvestigationSchema.parse(big) as Investigation);
  const noGaps = buildSkillTree(big, { showGaps: false });
  check(noGaps.nodes.every((n) => n.kind !== "gap") && noGaps.trails.every((t) => t.kind !== "evidence"), "showGaps: false hides gaps and their trails");

  const runs = 20;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) buildSkillTree(big);
  const avg = (performance.now() - t0) / runs;
  check(avg < 80, `stress layout is fast enough to run on every change (${avg.toFixed(1)} ms average)`);

  console.log(failures ? `\n${failures} check(s) failed, ${passes} passed.` : `\nAll ${passes} checks passed.`);
  process.exitCode = failures ? 1 : 0;
}

main();
