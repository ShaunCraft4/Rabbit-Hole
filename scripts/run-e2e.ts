/**
 * End-to-end harness (A7): one whole investigation through the HTTP API, the way the frontend does
 * it (src/lib/client/runner.ts): plan -> research every branch in parallel (Promise.allSettled, a
 * failed branch stays failed and the rest continue) -> analyze -> report.
 *
 *   npm run dev                                   (in another terminal)
 *   npx tsx scripts/run-e2e.ts "<question>" [--base http://localhost:3000] [--no-accept] [--chaos]
 *   npx tsx scripts/run-e2e.ts --compare out/a.json out/b.json ...
 *
 * Writes out/<slug>.json: a full Investigation (validated with InvestigationSchema and the integrity
 * check, then re-loaded from disk and validated again), plus a "_run" block with timings and the
 * verdict, which InvestigationSchema strips on parse. This file is what becomes
 * public/demo-investigation.json.
 *
 * --no-accept  leave suggested connections un-accepted (by default they are accepted, as the presenter
 *              would do in the demo, so the report can use them)
 * --chaos      add a branch that fails on purpose (dev "#fail" hook) to show the rest still completes
 * --compare    load saved runs, validate them, and print a comparison table
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { slugId } from "@/lib/ai/plan";
import {
  AnalyzeResponseSchema,
  ApiErrorSchema,
  API_ROUTES,
  InvestigationSchema,
  investigationIntegrityIssues,
  PlanResponseSchema,
  ReportResponseSchema,
  ResearchResponseSchema,
  type PublicSource,
} from "@/lib/contracts";
import { classifyDomain } from "@/lib/research/dedupe";
import type { Branch, Claim, Connection, EvidenceStatus, Gap, Investigation, Report } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = option("--base") ?? process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "out";

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

interface RunMeta {
  question: string;
  startedAt: string;
  baseUrl: string;
  timingsMs: { total: number; plan: number; research: number; analyze: number; report: number };
  failedBranches: string[];
  errors: string[];
  connectionsAccepted: boolean;
  verdict: string;
}

type SavedRun = Investigation & { _run?: RunMeta };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** POST like src/lib/client/api.ts: JSON in, response parsed with the contract schema. */
async function post<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(json);
    throw new HttpError(res.status, err.success ? `${err.data.error.code}: ${err.data.error.message}` : `HTTP ${res.status}`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new Error(`${path} returned a response that breaks the contract`);
  return parsed.data;
}

const RETRIEVAL_RANK: Record<PublicSource["retrievalStatus"], number> = { full_text: 2, snippet_only: 1, failed: 0 };

// ---------------------------------------------------------------------------
// Metrics and verdict (shared by a fresh run and --compare)
// ---------------------------------------------------------------------------

interface Metrics {
  sources: number;
  official: number;
  full: number;
  snippet: number;
  failed: number;
  browser: number;
  kept: number;
  rejected: number;
  labels: Record<EvidenceStatus, number>;
  gapsByKind: Record<Gap["kind"], number>;
  connections: number;
  accepted: number;
  warnings: number;
  branches: number;
  failedBranches: number;
  discoveries: number;
  nextSteps: number;
}

function metricsOf(inv: Investigation): Metrics {
  const labels: Record<EvidenceStatus, number> = { single_source: 0, corroborated: 0, conflicting: 0, outdated: 0, snippet_only: 0 };
  for (const c of inv.claims) labels[c.evidenceStatus]++;
  const gapsByKind: Record<Gap["kind"], number> = { missing: 0, conflict: 0, outdated: 0, weak: 0 };
  for (const g of inv.gaps) gapsByKind[g.kind]++;
  return {
    sources: inv.sources.length,
    official: inv.sources.filter((s) => classifyDomain(s.domain).kind === "official").length,
    full: inv.sources.filter((s) => s.retrievalStatus === "full_text").length,
    snippet: inv.sources.filter((s) => s.retrievalStatus === "snippet_only").length,
    failed: inv.sources.filter((s) => s.retrievalStatus === "failed").length,
    browser: inv.sources.filter((s) => s.retrievedVia === "browser").length,
    kept: inv.claims.length,
    rejected: inv.rejectedClaims,
    labels,
    gapsByKind,
    connections: inv.connections.length,
    accepted: inv.connections.filter((c) => c.accepted).length,
    warnings: gapsByKind.conflict + gapsByKind.outdated + labels.conflicting + labels.outdated,
    branches: inv.branches.length,
    failedBranches: inv.branches.filter((b) => b.status === "failed").length,
    discoveries: inv.report?.keyDiscoveries.length ?? 0,
    nextSteps: inv.report?.nextSteps.length ?? 0,
  };
}

/** One line: is this question a good live demo? (official sources, a missing requirement, ideally a conflict/outdated warning) */
function verdictOf(m: Metrics, hasReport: boolean): string {
  const share = m.sources ? m.official / m.sources : 0;
  const facts = `${m.official}/${m.sources} official sources, ${m.gapsByKind.missing} missing-requirement gap(s), ${m.warnings} conflict/outdated warning(s), ${m.kept} claims`;
  const problems: string[] = [];
  if (share < 0.5) problems.push("too few official sources");
  if (m.gapsByKind.missing === 0) problems.push("no missing-requirement gap");
  if (m.kept < 12) problems.push("a thin graph");
  if (m.failedBranches > 0) problems.push(`${m.failedBranches} failed branch(es)`);
  if (!hasReport) problems.push("no report");
  if (problems.length === 0 && m.warnings > 0 && share >= 0.6) return `STRONG: ${facts}.`;
  if (problems.length === 0) return `GOOD: ${facts}; no conflict or outdated warning this run.`;
  return `WEAK: ${facts}; ${problems.join(", ")}.`;
}

function printSummary(inv: Investigation, meta: RunMeta, file: string) {
  const m = metricsOf(inv);
  const t = meta.timingsMs;
  const pct = m.kept + m.rejected ? Math.round((100 * m.kept) / (m.kept + m.rejected)) : 0;
  const nonzero = (r: Record<string, number>) =>
    Object.entries(r)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ") || "none";
  console.log(`\n=== ${inv.question}`);
  console.log(`Total time   ${sec(t.total)} (plan ${sec(t.plan)}, research ${sec(t.research)}, analyze ${sec(t.analyze)}, report ${sec(t.report)})`);
  console.log(`Branches     ${m.branches} (${m.branches - m.failedBranches} done, ${m.failedBranches} failed${meta.failedBranches.length ? `: ${meta.failedBranches.join(", ")}` : ""})`);
  console.log(`Sources      ${m.sources}, ${m.official} official (.edu/.gov); ${m.full} full text, ${m.snippet} snippet only, ${m.failed} failed; ${m.browser} read with a cloud browser`);
  console.log(`Claims       ${m.kept} kept, ${m.rejected} rejected (${pct}% verified); labels: ${nonzero(m.labels)}`);
  console.log(`Gaps         ${inv.gaps.length}: ${nonzero(m.gapsByKind)}`);
  console.log(`Connections  ${m.connections} (${m.accepted} accepted)`);
  console.log(`Report       ${inv.report ? `${m.discoveries} key discoveries, ${m.nextSteps} next steps` : "none"}`);
  const missing = inv.gaps.find((g) => g.kind === "missing");
  const warning = inv.gaps.find((g) => g.kind === "conflict" || g.kind === "outdated");
  const link = inv.connections[0];
  if (missing) console.log(`  missing:    ${missing.question}`);
  if (warning) console.log(`  ${warning.kind.padEnd(10)}  ${warning.question}`);
  if (link) console.log(`  connection: ${link.explanation}`);
  if (meta.errors.length) console.log(`Errors       ${meta.errors.join(" | ")}`);
  console.log(`Verdict      ${meta.verdict}`);
  console.log(`Saved        ${file}`);
}

// ---------------------------------------------------------------------------
// A fresh run
// ---------------------------------------------------------------------------

async function run(question: string) {
  const started = Date.now();
  const timings = { total: 0, plan: 0, research: 0, analyze: 0, report: 0 };
  const errors: string[] = [];

  try {
    await fetch(BASE, { method: "HEAD" });
  } catch {
    throw new Error(`No server at ${BASE}. Start it with "npm run dev" first.`);
  }

  // 1. Plan
  let t = Date.now();
  const plan = await post(API_ROUTES.plan, { question }, PlanResponseSchema);
  timings.plan = Date.now() - t;
  const slug = slugId(question, new Set(), "investigation");
  const branches: Branch[] = plan.branches.map((b) => ({ ...b, status: "idle" }));
  if (flag("--chaos")) {
    branches.push({ id: "chaos-test", title: "Forced failure #fail", question: "This branch fails on purpose.", queries: ["forced failure"], status: "idle" });
  }
  console.log(`Plan (${sec(timings.plan)}): ${branches.map((b) => b.title).join(" | ")}`);

  // 2. Research every branch in parallel; each result is merged the moment it arrives.
  t = Date.now();
  const sources = new Map<string, PublicSource>();
  const claims: Claim[] = [];
  const seenClaims = new Set<string>();
  let rejectedClaims = 0;
  await Promise.allSettled(
    branches.map(async (branch) => {
      branch.status = "running";
      const b0 = Date.now();
      try {
        const res = await post(
          API_ROUTES.research,
          { branch: { id: branch.id, title: branch.title, question: branch.question, queries: branch.queries } },
          ResearchResponseSchema,
        );
        for (const s of res.sources) {
          const prev = sources.get(s.id);
          // Keep the best-read copy of a page that several branches found.
          if (!prev || RETRIEVAL_RANK[s.retrievalStatus] >= RETRIEVAL_RANK[prev.retrievalStatus]) sources.set(s.id, s);
        }
        for (const c of res.claims) {
          if (seenClaims.has(c.id)) continue;
          seenClaims.add(c.id);
          claims.push(c);
        }
        rejectedClaims += res.rejectedClaims;
        branch.status = res.status === "failed" ? "failed" : "done";
        if (res.status !== "done") errors.push(`${branch.id}: ${res.status}${res.note ? ` (${res.note})` : ""}`);
        console.log(`  ${branch.id}: ${res.status} in ${sec(Date.now() - b0)}, ${res.claims.length} claims, ${res.sources.length} sources`);
      } catch (err) {
        branch.status = "failed";
        errors.push(`${branch.id}: ${(err as Error).message}`);
        console.log(`  ${branch.id}: FAILED in ${sec(Date.now() - b0)} (${(err as Error).message})`);
      }
    }),
  );
  timings.research = Date.now() - t;

  // 3. Analyze (a failure keeps everything researched so far)
  let gaps: Gap[] = [];
  let connections: Connection[] = [];
  t = Date.now();
  if (claims.length > 0) {
    try {
      const analysis = await post(
        API_ROUTES.analyze,
        { question, branches: branches.map(({ id, title, question: q }) => ({ id, title, question: q })), claims, sources: [...sources.values()] },
        AnalyzeResponseSchema,
      );
      const updates = new Map(analysis.claimUpdates.map((u) => [u.claimId, u.evidenceStatus]));
      for (const c of claims) c.evidenceStatus = updates.get(c.id) ?? c.evidenceStatus;
      gaps = analysis.gaps;
      // The presenter accepts the suggested links during the demo (unless --no-accept).
      connections = analysis.connections.map((c) => ({ ...c, accepted: !flag("--no-accept") }));
    } catch (err) {
      errors.push(`analyze: ${(err as Error).message}`);
    }
  }
  timings.analyze = Date.now() - t;

  // 4. Report
  let report: Report | undefined;
  t = Date.now();
  try {
    report = await post(
      API_ROUTES.report,
      { question, assumptions: plan.assumptions, claims, sources: [...sources.values()], gaps, connections },
      ReportResponseSchema,
    );
  } catch (err) {
    errors.push(`report: ${(err as Error).message}`);
  }
  timings.report = Date.now() - t;
  timings.total = Date.now() - started;

  // 5. Assemble, validate, save, reload, validate again.
  const investigation: Investigation = {
    id: `saved-${slug}`.slice(0, 80),
    question,
    assumptions: plan.assumptions,
    branches,
    sources: [...sources.values()],
    claims,
    gaps,
    connections,
    ...(report ? { report } : {}),
    rejectedClaims,
  };
  const parsed = InvestigationSchema.parse(investigation);
  const issues = investigationIntegrityIssues(parsed);
  if (issues.length) throw new Error(`The investigation has broken references: ${issues.join("; ")}`);

  const meta: RunMeta = {
    question,
    startedAt: new Date(started).toISOString(),
    baseUrl: BASE,
    timingsMs: timings,
    failedBranches: branches.filter((b) => b.status === "failed").map((b) => b.id),
    errors,
    connectionsAccepted: !flag("--no-accept"),
    verdict: verdictOf(metricsOf(parsed), Boolean(report)),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, `${slug}${flag("--chaos") ? ".chaos" : ""}.json`);
  const saved: SavedRun = { ...parsed, _run: meta };
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);

  const reloaded = InvestigationSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!reloaded.success || investigationIntegrityIssues(reloaded.data).length) {
    throw new Error(`${file} does not load back against InvestigationSchema`);
  }
  printSummary(reloaded.data, meta, file);
  console.log(`Validated    ${file} loads against InvestigationSchema with no broken references`);
}

// ---------------------------------------------------------------------------
// --compare
// ---------------------------------------------------------------------------

function compare(files: string[]) {
  const rows: string[] = [];
  const notes: string[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as SavedRun;
    const parsed = InvestigationSchema.safeParse(raw);
    if (!parsed.success) {
      rows.push(`| ${file} | invalid: does not load against InvestigationSchema | | | | | | |`);
      continue;
    }
    const inv = parsed.data;
    const issues = investigationIntegrityIssues(inv);
    const m = metricsOf(inv);
    const meta = raw._run;
    const gaps = Object.entries(m.gapsByKind)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${k}`)
      .join(", ");
    rows.push(
      `| ${inv.question.slice(0, 70)} | ${meta ? sec(meta.timingsMs.total) : "?"} | ${m.official}/${m.sources} | ${m.kept} / ${m.rejected} | ${gaps || "none"} | ${m.warnings} | ${m.connections} | ${issues.length ? "BROKEN REFS" : (meta?.verdict ?? verdictOf(m, Boolean(inv.report))).split(":")[0]} |`,
    );
    notes.push(`- ${file}: ${meta?.verdict ?? verdictOf(m, Boolean(inv.report))}`);
  }
  console.log("| Question | Time | Official sources | Claims kept / rejected | Gaps | Conflict/outdated warnings | Connections | Verdict |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
  console.log(rows.join("\n"));
  console.log(`\n${notes.join("\n")}`);
}

async function main() {
  if (flag("--compare")) {
    compare(args.filter((a) => a.endsWith(".json")));
    return;
  }
  const question = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--base");
  if (!question) throw new Error('Usage: npx tsx scripts/run-e2e.ts "<question>" [--base url] [--no-accept] [--chaos]');
  await run(question);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
