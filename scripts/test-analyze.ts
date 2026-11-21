/**
 * Acceptance tests for the analysis step (A4).
 *
 *   npx tsx scripts/test-analyze.ts --offline      code-only rules of buildAnalysis (no network)
 *   npx tsx scripts/test-analyze.ts --mock-retry   a local fake LLM returns invalid output: one retry, then 502
 *   npx tsx scripts/test-analyze.ts [--save dir] [--from dir]
 *       live, in-process: 2 real investigations (plan -> research every branch -> analyze),
 *       checked and printed. --save writes each analyze request to dir; --from re-analyzes saved
 *       requests without re-running research.
 *
 * Live and mock modes read .env.local themselves (mock mode then points the LLM at the fake server).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { errorResponseFor } from "@/app/api/_lib/http";
import { analyzeInvestigation, buildAnalysis, isGenericGap, type AnalysisRun } from "@/lib/ai/analyze";
import { planQuestion } from "@/lib/ai/plan";
import { analyzeOutputSchema, type AnalyzeModelOutput } from "@/lib/ai/schemas";
import {
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  type AnalyzeRequest,
  type PublicSource,
} from "@/lib/contracts";
import { researchBranch } from "@/lib/research/pipeline";
import type { Claim } from "@/lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

function loadEnv() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    console.warn("(no .env.local found; using the current environment)");
  }
}

// ---------------------------------------------------------------------------
// Checks shared by every mode
// ---------------------------------------------------------------------------

/** Every id in the response exists in the request; labels and defaults follow the rules. */
function checkAnalysis(label: string, req: AnalyzeRequest, run: AnalysisRun) {
  const parsed = AnalyzeResponseSchema.safeParse(JSON.parse(JSON.stringify(run.response)));
  check(parsed.success, `${label}: response validates against AnalyzeResponseSchema`);
  const r = run.response;
  const claimById = new Map(req.claims.map((c) => [c.id, c]));
  const branchIds = new Set(req.branches.map((b) => b.id));
  const domainOf = (id: string) => req.sources.find((s) => s.id === claimById.get(id)?.sourceId)?.domain;

  check(
    r.gaps.every((g) => g.claimIds.every((id) => claimById.has(id)) && (!g.branchId || branchIds.has(g.branchId))),
    `${label}: every gap cites existing claim and branch ids`,
  );
  check(r.claimUpdates.every((u) => claimById.has(u.claimId)), `${label}: every claim update targets an existing claim`);
  check(
    r.connections.every((c) => claimById.has(c.from) && claimById.has(c.to) && claimById.get(c.from)!.branchId !== claimById.get(c.to)!.branchId),
    `${label}: every connection joins existing claims from different branches`,
  );
  check(
    r.gaps.every((g) => g.status === "open") && r.connections.every((c) => c.accepted === false),
    `${label}: gaps are open, connections are not accepted`,
  );
  const ids = [...r.gaps.map((g) => g.id), ...r.connections.map((c) => c.id)];
  check(new Set(ids).size === ids.length, `${label}: generated ids are unique`);
  check(r.gaps.every((g) => !isGenericGap(g.question)), `${label}: no generic gaps`);
  check(r.gaps.length <= 5 && r.connections.length <= 4, `${label}: at most 5 gaps and 4 connections`);

  // Corroboration: every claim labeled corroborated sits in an applied group with 2+ domains,
  // recomputed here from the request's sources (not from the analysis' own report).
  const corroborated = r.claimUpdates.filter((u) => u.evidenceStatus === "corroborated").map((u) => u.claimId);
  const backed = corroborated.every((id) =>
    run.stats.groups.some(
      (g) =>
        g.applied &&
        g.status === "corroborated" &&
        g.claimIds.includes(id) &&
        new Set(g.claimIds.map(domainOf).filter(Boolean)).size >= 2,
    ),
  );
  check(backed, `${label}: corroboration only with 2+ distinct source domains (${corroborated.length} corroborated)`);
}

// ---------------------------------------------------------------------------
// --offline: the code-only rules
// ---------------------------------------------------------------------------

function offline() {
  const source = (id: string, domain: string, retrievalStatus: PublicSource["retrievalStatus"] = "full_text"): PublicSource => ({
    id,
    url: `https://${domain}/${id}`,
    domain,
    title: id,
    retrievalStatus,
  });
  const claim = (id: string, branchId: string, sourceId: string, extra: Partial<Claim> = {}): Claim => ({
    id,
    branchId,
    sourceId,
    text: `Claim ${id} text about the funding rules.`,
    excerpt: `Quote for claim ${id} from its page.`,
    verified: true,
    evidenceStatus: "single_source",
    ...extra,
  });
  const req: AnalyzeRequest = {
    question: "How can my student club get funding for a cultural night with food?",
    branches: [
      { id: "funding", title: "Funding", question: "Which funds exist?" },
      { id: "rules", title: "Rules", question: "What are the spending rules?" },
    ],
    sources: [
      source("s1", "asucr.ucr.edu"),
      source("s2", "asucr.ucr.edu"),
      source("s3", "sip.ucr.edu"),
      source("s4", "example.org", "snippet_only"),
    ],
    claims: [
      claim("funding-c1", "funding", "s1"),
      claim("funding-c2", "funding", "s2"), // same domain as c1
      claim("funding-c3", "funding", "s3"),
      claim("rules-c1", "rules", "s4", { evidenceStatus: "snippet_only" }),
      claim("rules-c2", "rules", "s1", { dateMentioned: "Spring 2024" }),
      claim("rules-c3", "rules", "s3"),
      claim("rules-c4", "rules", "s1", { evidenceStatus: "corroborated" }), // stale label from a previous analysis
    ],
  };

  const raw: AnalyzeModelOutput = {
    malformed: 0,
    claimGroups: [
      { status: "corroborated", claimIds: ["funding-c1", "funding-c2"] }, // one domain -> rejected
      { status: "corroborated", claimIds: ["funding-c1", "funding-c3"] }, // two domains -> applied
      { status: "corroborated", claimIds: ["rules-c3", "ghost-claim"] }, // unknown id -> dropped
      { status: "conflicting", claimIds: ["rules-c1", "rules-c3"], note: "different caps" },
    ],
    outdated: [
      { claimId: "rules-c2", reason: "Spring 2024 cycle" }, // has a date -> applied
      { claimId: "funding-c2", reason: "seems old" }, // no date anywhere -> dropped
      { claimId: "nope", reason: "unknown" },
    ],
    gaps: [
      { kind: "missing", question: "Does ASUCR grant funding cover food for a cultural night?", whyItMatters: "Food may be the largest cost.", claimIds: [], suggestedQuery: "ASUCR grant food policy 2026" },
      { kind: "missing", question: "Can ASUCR grant funding cover food for a cultural night event?", whyItMatters: "Duplicate wording.", claimIds: [] },
      { kind: "missing", question: "Is more research needed?", whyItMatters: "Generic.", claimIds: [] },
      { kind: "weak", question: "Is the example.org cap on event spending still current?", whyItMatters: "It is snippet-only.", claimIds: ["rules-c1"] },
      { kind: "conflict", question: "Which spending cap applies, the SIP cap or the example.org cap?", whyItMatters: "Budgets differ.", claimIds: ["rules-c1", "rules-c3"], branchId: "made-up-branch" },
      { kind: "outdated", question: "Has the venue approval rule changed since the old handbook?", whyItMatters: "Cites nothing.", claimIds: [] },
      { kind: "weak", question: "Does the travel reimbursement form need a receipt for every purchase?", whyItMatters: "Ghost.", claimIds: ["ghost"] },
    ],
    connections: [
      { from: "funding-c1", to: "rules-c3", relationship: "depends_on", explanation: "The grant can only be spent after the spending rules are met." },
      { from: "rules-c3", to: "funding-c1", relationship: "supports", explanation: "Same pair again, reversed, so it is a duplicate." },
      { from: "funding-c1", to: "funding-c3", relationship: "supports", explanation: "Both are in the funding branch, so this is not cross-branch." },
      { from: "funding-c2", to: "rules-c2", relationship: "related_to", explanation: "Related." },
      { from: "funding-c3", to: "ghost", relationship: "supports", explanation: "Points at a claim that does not exist." },
    ],
  };

  const run = buildAnalysis(raw, req);
  const r = run.response;
  const status = new Map(r.claimUpdates.map((u) => [u.claimId, u.evidenceStatus]));
  console.log("buildAnalysis");
  check(!status.has("funding-c2") || status.get("funding-c2") !== "corroborated", "same-domain group is NOT corroborated");
  check(status.get("funding-c1") === "corroborated" && status.get("funding-c3") === "corroborated", "two-domain group IS corroborated");
  check(r.claimUpdates.every((u) => u.claimId !== "ghost-claim"), "group with an unknown id is dropped");
  check(status.get("rules-c1") === "conflicting" && status.get("rules-c3") === "conflicting", "conflicting group applies to both claims");
  check(status.get("rules-c2") === "outdated", "outdated applies when the claim carries a date");
  check(status.get("funding-c2") === undefined, "outdated without any date is ignored (funding-c2 unchanged)");
  check(status.get("rules-c4") === "single_source", "a stale 'corroborated' label is reset by a fresh analysis");
  check(r.claimUpdates.length === new Set(r.claimUpdates.map((u) => u.claimId)).size, "one update per claim");
  check(
    JSON.stringify(r.gaps.map((g) => g.kind)) === JSON.stringify(["missing", "weak", "conflict"]),
    `gaps kept: missing, weak, conflict (got ${r.gaps.map((g) => g.kind).join(", ")})`,
  );
  check(
    (run.stats.dropped.gap_duplicate ?? 0) === 1 &&
      (run.stats.dropped.gap_generic ?? 0) === 1 &&
      (run.stats.dropped.gap_without_claims ?? 0) === 1 &&
      (run.stats.dropped.gap_unknown_id ?? 0) === 1,
    `dropped gaps: duplicate, generic, outdated-without-claims, unknown id (${JSON.stringify(run.stats.dropped)})`,
  );
  check(r.gaps[1]?.branchId === "rules", "a gap citing only one branch's claims is attached to that branch");
  check(r.gaps[2]?.branchId === "rules", "an unknown branchId is replaced by the inferred branch");
  check(r.gaps.every((g) => /^gap-[a-z0-9-]+$/.test(g.id) && g.status === "open"), "gap ids generated, status open");
  check(r.connections.length === 1 && r.connections[0].relationship === "depends_on", "only the valid cross-branch connection is kept");
  check(
    (run.stats.dropped.connection_duplicate ?? 0) === 1 &&
      (run.stats.dropped.connection_same_branch ?? 0) === 1 &&
      (run.stats.dropped.connection_no_explanation ?? 0) === 1 &&
      (run.stats.dropped.connection_unknown_id ?? 0) === 1,
    "dropped connections: duplicate, same branch, no explanation, unknown id",
  );
  const again = buildAnalysis(raw, req);
  check(again.response.connections[0].id === r.connections[0].id, "connection ids are stable across analyses");
  checkAnalysis("offline", req, run);

  console.log("\nanalyzeOutputSchema");
  const lenient = analyzeOutputSchema.safeParse({
    gaps: [
      { kind: "Contradiction", question: " Which deadline applies? ", whyItMatters: "Dates differ.", claimIds: ["a", "a", 3, "b"] },
      { kind: "banana", question: "x", whyItMatters: "y", claimIds: [] },
    ],
    groups: [{ status: "Same fact", claimIds: ["a", "b"] }],
    outdated: [{ claimId: "a" }],
    connections: [{ from: "a", to: "b", relationship: "Depends on", explanation: "A needs B first." }],
  });
  check(lenient.success, "lenient reply parses");
  if (lenient.success) {
    const d = lenient.data;
    check(d.gaps.length === 1 && d.gaps[0].kind === "conflict", "'Contradiction' maps to conflict; unknown kind is dropped");
    check(JSON.stringify(d.gaps[0].claimIds) === JSON.stringify(["a", "b"]), "claim ids are de-duplicated, non-strings dropped");
    check(d.claimGroups[0]?.status === "corroborated", "'groups' alias and 'Same fact' map to a corroborated group");
    check(d.connections[0]?.relationship === "depends_on", "'Depends on' maps to depends_on");
    check(d.malformed === 2, `bad items are counted (${d.malformed}: unknown gap kind, outdated without reason)`);
  }
  check(!analyzeOutputSchema.safeParse({ analysis: {} }).success, "a reply with none of the expected arrays fails (repair retry)");
  check(!analyzeOutputSchema.safeParse(["not", "an", "object"]).success, "a non-object reply fails (repair retry)");
}

// ---------------------------------------------------------------------------
// --mock-retry: invalid model output is retried once, then becomes a 502
// ---------------------------------------------------------------------------

async function mockRetry() {
  loadEnv();
  const replies: string[] = [];
  let calls = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      calls++;
      const content = replies.shift() ?? "still not json";
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `mock-${calls}`,
          object: "chat.completion",
          created: 0,
          model: "mock-model",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = "";
  process.env.LLM_MODEL_STRONG = "mock-model";
  process.env.LLM_MODEL_FAST = "mock-model";

  const req: AnalyzeRequest = {
    question: "How do I fund a club event?",
    branches: [{ id: "funding", title: "Funding", question: "Which funds exist?" }],
    sources: [{ id: "s1", url: "https://a.edu/x", domain: "a.edu", title: "A", retrievalStatus: "full_text" }],
    claims: [
      {
        id: "funding-c1",
        branchId: "funding",
        sourceId: "s1",
        text: "Grants are capped at $1,500 per year.",
        excerpt: "Grants are limited to $1,500 per organization per academic year.",
        verified: true,
        evidenceStatus: "single_source",
      },
    ],
  };

  // 1. Invalid, then valid: one retry, success.
  replies.push(
    "Sure! Here is my analysis: the gaps are about food.",
    JSON.stringify({
      gaps: [
        {
          kind: "missing",
          question: "Does the grant cover food at the event?",
          whyItMatters: "Food is often the biggest cost.",
          claimIds: [],
          suggestedQuery: "club grant food policy",
        },
      ],
      claimGroups: [],
      outdated: [],
      connections: [],
    }),
  );
  calls = 0;
  const run = await analyzeInvestigation(req);
  check(calls === 2, `invalid first reply is retried exactly once (${calls} calls)`);
  check(run.response.gaps.length === 1, "the corrected reply is used");

  // 2. Invalid twice: no third call, LLM_INVALID_OUTPUT -> HTTP 502 MODEL_OUTPUT_INVALID.
  replies.push("not json", JSON.stringify({ analysis: "still the wrong shape" }));
  calls = 0;
  let status = 0;
  let code = "";
  try {
    await analyzeInvestigation(req);
  } catch (err) {
    const res = errorResponseFor(err, "analyze");
    status = res.status;
    code = ((await res.json()) as { error: { code: string } }).error.code;
  }
  check(calls === 2, `still invalid after the retry: gives up after 2 calls (${calls})`);
  check(status === 502 && code === "MODEL_OUTPUT_INVALID", `route answers HTTP ${status} ${code}`);
  // Close keep-alive sockets and wait, or process.exit trips a libuv assertion on Windows.
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// Live: 2 real investigations
// ---------------------------------------------------------------------------

const QUESTIONS = [
  "How can my student club at UC Riverside get funding for a cultural night event with food?",
  "As a California community college student, what do I need to do to get the FAFSA and a Cal Grant for 2027-28?",
];

async function buildRequest(question: string): Promise<AnalyzeRequest> {
  const started = Date.now();
  const plan = await planQuestion(question);
  const runs = await Promise.all(plan.branches.map((branch) => researchBranch({ branch })));
  const sources = new Map<string, PublicSource>();
  const claims: Claim[] = [];
  for (const { response } of runs) {
    for (const s of response.sources) if (!sources.has(s.id) || s.retrievalStatus !== "failed") sources.set(s.id, s);
    claims.push(...response.claims);
  }
  console.log(`  plan + research: ${plan.branches.length} branches, ${claims.length} claims, ${sources.size} sources in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return AnalyzeRequestSchema.parse({
    question,
    branches: plan.branches.map(({ id, title, question: q }) => ({ id, title, question: q })),
    claims,
    sources: [...sources.values()],
  });
}

function printRun(req: AnalyzeRequest, run: AnalysisRun) {
  const claimById = new Map(req.claims.map((c) => [c.id, c]));
  const domainOf = (id: string) => req.sources.find((s) => s.id === claimById.get(id)?.sourceId)?.domain ?? "?";
  const r = run.response;
  console.log(`\n  GAPS (${r.gaps.length})`);
  r.gaps.forEach((g, i) => {
    console.log(`  ${i + 1}. [${g.kind}] ${g.question}`);
    console.log(`     why: ${g.whyItMatters}`);
    console.log(`     claims: ${g.claimIds.join(", ") || "none"} | branch: ${g.branchId ?? "-"} | follow-up search: ${g.suggestedQuery ?? "-"}`);
  });
  console.log(`\n  CONNECTIONS (${r.connections.length})`);
  r.connections.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.from} --${c.relationship}--> ${c.to}`);
    console.log(`     from: ${claimById.get(c.from)?.text}`);
    console.log(`     to:   ${claimById.get(c.to)?.text}`);
    console.log(`     why:  ${c.explanation}`);
  });
  console.log(`\n  EVIDENCE UPDATES (${r.claimUpdates.length})`);
  for (const u of r.claimUpdates) console.log(`  - ${u.claimId} -> ${u.evidenceStatus} (${domainOf(u.claimId)})`);
  const groups = run.stats.groups.map(
    (g) => `${g.status} [${g.claimIds.join(", ")}] domains=${g.domains.join("+") || "-"} ${g.applied ? "applied" : `dropped: ${g.reason}`}`,
  );
  if (groups.length) console.log(`\n  GROUPS PROPOSED\n  - ${groups.join("\n  - ")}`);
  console.log(`\n  dropped by code: ${JSON.stringify(run.stats.dropped)}; analysis took ${(run.stats.modelMs / 1000).toFixed(1)}s`);
}

async function live() {
  loadEnv();
  const from = option("--from");
  const save = option("--save");
  if (save) mkdirSync(save, { recursive: true });

  for (const [i, question] of QUESTIONS.entries()) {
    console.log(`\n=== Run ${i + 1}: ${question}`);
    const file = (dir: string) => join(dir, `analyze-request-${i + 1}.json`);
    const req = from
      ? AnalyzeRequestSchema.parse(JSON.parse(readFileSync(file(from), "utf8")))
      : await buildRequest(question);
    if (save) writeFileSync(file(save), JSON.stringify(req, null, 2));
    const run = await analyzeInvestigation(req);
    checkAnalysis(`run ${i + 1}`, req, run);
    printRun(req, run);
  }
}

async function main() {
  if (flag("--offline")) offline();
  else if (flag("--mock-retry")) await mockRetry();
  else await live();
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  // Let Node exit on its own: process.exit() while the HTTP client is still closing local
  // keep-alive sockets trips a libuv assertion on Windows.
  process.exitCode = failures ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
