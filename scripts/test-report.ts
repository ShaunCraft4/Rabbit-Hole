/**
 * Acceptance tests for the Golden Key report (A5).
 *
 *   npx tsx scripts/test-report.ts --offline      code-only rules of buildReport (no network)
 *   npx tsx scripts/test-report.ts --mock-retry   a local fake LLM returns invalid output: one retry, then 502
 *   npx tsx scripts/test-report.ts [--from dir] [question]
 *       live, in-process: a real investigation (plan -> research -> analyze -> the user accepts all
 *       connections but one -> report), audited and printed. --from dir re-uses a saved
 *       analyze-request-1.json (from test-analyze.ts --save) instead of re-running research.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { errorResponseFor } from "@/app/api/_lib/http";
import { analyzeInvestigation } from "@/lib/ai/analyze";
import { planQuestion } from "@/lib/ai/plan";
import { buildReport, numberTokens, selectReportInput, writeReport, type ReportRun } from "@/lib/ai/report";
import type { RawReport } from "@/lib/ai/schemas";
import {
  AnalyzeRequestSchema,
  ReportResponseSchema,
  type AnalyzeRequest,
  type PublicSource,
  type ReportRequest,
} from "@/lib/contracts";
import { researchBranch } from "@/lib/research/pipeline";
import type { Claim, Connection, Gap } from "@/lib/types";

import { startMockLLM } from "./mock-llm";

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
// Independent audits of a finished report
// ---------------------------------------------------------------------------

function corpusOf(req: ReportRequest): string {
  const input = selectReportInput(req);
  const today = new Date().toISOString().slice(0, 10);
  return [
    req.question,
    ...req.assumptions,
    ...input.claims.flatMap((c) => [c.text, c.excerpt, c.dateMentioned ?? ""]),
    ...input.gaps.flatMap((g) => [g.question, g.whyItMatters, g.suggestedQuery ?? ""]),
    ...input.connections.map((c) => c.explanation),
    ...req.sources.map((s) => s.domain),
    today,
  ].join("\n");
}

function reportTexts(r: ReportRun["response"]): string[] {
  return [
    r.directAnswer,
    ...r.keyDiscoveries.map((d) => d.summary),
    ...r.planChangingConnections.map((p) => p.text),
    ...r.uncertainties.map((u) => u.text),
    ...r.nextSteps.flatMap((s) => [s.step, s.reason ?? ""]),
  ];
}

/** Numbers in the report that do not occur in the supplied material (built independently here). */
function unsupportedNumbers(r: ReportRun["response"], corpus: string): string[] {
  const flat = corpus.replace(/(\d),(\d)/g, "$1$2");
  const known = new Set((flat.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
  for (const m of flat.matchAll(/\b(20\d{2})\s?[-–]\s?(\d{2})\b/g)) {
    known.add(`${m[1].slice(0, 2)}${m[2]}`);
  }
  return [...new Set(reportTexts(r).flatMap(numberTokens))].filter((n) => !known.has(n));
}

/** Acronyms and mid-sentence capitalized words in the report that the supplied material never uses. */
function unknownNames(r: ReportRun["response"], corpus: string): string[] {
  const corpusWords = new Set((corpus.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  const names = new Set<string>();
  for (const text of reportTexts(r)) {
    for (const sentence of text.split(/(?<=[.!?:])\s+/)) {
      const words = sentence.match(/[\p{L}\p{N}]+/gu) ?? [];
      words.forEach((w, i) => {
        const acronym = /^[A-Z]{2,}s?$/.test(w);
        const capitalized = i > 0 && /^[A-Z][a-z]/.test(w);
        if ((acronym || capitalized) && !corpusWords.has(w.toLowerCase()) && !corpusWords.has(w.toLowerCase().replace(/s$/, ""))) {
          names.add(w);
        }
      });
    }
  }
  return [...names];
}

function checkReport(label: string, req: ReportRequest, run: ReportRun) {
  const r = run.response;
  check(ReportResponseSchema.safeParse(JSON.parse(JSON.stringify(r))).success, `${label}: validates against ReportResponseSchema`);
  const input = selectReportInput(req);
  const claimIds = new Set(input.claims.map((c) => c.id));
  const connectionIds = new Set(input.connections.map((c) => c.id));
  const gapIds = new Set(input.gaps.map((g) => g.id));
  check(r.keyDiscoveries.every((d) => claimIds.has(d.claimId)), `${label}: every key discovery cites a verified claim`);
  check(
    r.planChangingConnections.every((p) => connectionIds.has(p.connectionId)),
    `${label}: every plan-changing connection is an ACCEPTED supplied connection`,
  );
  check(r.uncertainties.every((u) => !u.gapId || gapIds.has(u.gapId)), `${label}: every cited gap is an open supplied gap`);
  check(r.nextSteps.length >= 1 && r.nextSteps.length <= 7, `${label}: 1 to 7 next steps (${r.nextSteps.length})`);
  check(r.keyDiscoveries.length <= 8, `${label}: at most 8 key discoveries (${r.keyDiscoveries.length})`);
  const numbers = unsupportedNumbers(r, corpusOf(req));
  check(numbers.length === 0, `${label}: every number in the report occurs in the supplied material${numbers.length ? ` (not found: ${numbers.join(", ")})` : ""}`);
}

// ---------------------------------------------------------------------------
// --offline
// ---------------------------------------------------------------------------

function offline() {
  const claim = (id: string, text: string, extra: Partial<Claim> = {}): Claim => ({
    id,
    branchId: id.split("-c")[0],
    sourceId: "s1",
    text,
    excerpt: text,
    verified: true,
    evidenceStatus: "single_source",
    ...extra,
  });
  const gap = (id: string, question: string, status: Gap["status"] = "open"): Gap => ({
    id,
    question,
    whyItMatters: `If unknown, the plan for ${id} could fail.`,
    kind: "missing",
    claimIds: [],
    status,
  });
  const conn = (id: string, from: string, to: string, accepted: boolean, explanation: string): Connection => ({
    id,
    from,
    to,
    relationship: "depends_on",
    explanation,
    accepted,
  });
  const source: PublicSource = { id: "s1", url: "https://asucr.ucr.edu/x", domain: "asucr.ucr.edu", title: "ASUCR", retrievalStatus: "full_text" };
  const req: ReportRequest = {
    question: "How can my club fund a cultural night with food in 2026-27?",
    assumptions: ["Assuming the club is a registered student organization at UC Riverside."],
    sources: [source],
    claims: [
      claim("funding-c1", "ASUCR grants are limited to $1,500 per organization per academic year."),
      claim("funding-c2", "Up to $500 or 50% of an ASUCR grant may be used for food."),
      claim("rules-c1", "Food at events must come from UCR catering services."),
      claim("rules-c2", "Unverified claim with $9,999.", { verified: false }),
    ],
    gaps: [
      gap("gap-food-permit", "Does a cultural night open to all students need a Temporary Food Permit?"),
      gap("gap-deadline", "What is the ASUCR Organization Grant deadline for the 2026-27 year?"),
      gap("gap-dismissed", "Is this dismissed gap still relevant?", "dismissed"),
    ],
    connections: [
      conn("conn-accepted", "funding-c2", "rules-c1", true, "Food money can only be spent with UCR catering, so book catering within the $500 food limit."),
      conn("conn-pending", "funding-c1", "rules-c1", false, "Not accepted by the user, so the report must not use it."),
    ],
  };
  const input = selectReportInput(req);
  check(input.claims.length === 3 && input.gaps.length === 2 && input.connections.length === 1, "input keeps verified claims, open gaps, accepted connections");

  const raw: RawReport = {
    malformed: 0,
    directAnswer:
      "If your club is registered, you can request an ASUCR grant of up to $1,500 per year. Food can use up to $500 or 50% of it. Most clubs also get $2,000 from the dean. The grant deadline for 2026-2027 is not established yet.",
    keyDiscoveries: [
      { claimId: "funding-c1", summary: "ASUCR grants are capped at $1,500 per organization each academic year." },
      { claimId: "funding-c1", summary: "Duplicate of the first discovery." },
      { claimId: "funding-c2", summary: "Food can use up to $750 of the grant." },
      { claimId: "rules-c2", summary: "An unverified claim must not appear." },
      { claimId: "ghost", summary: "Unknown claim." },
    ],
    planChangingConnections: [
      { connectionId: "conn-accepted", text: "Since food must come from UCR catering, budget $900 for catering." },
      { connectionId: "conn-pending", text: "This connection was never accepted." },
    ],
    uncertainties: [
      { gapId: "gap-food-permit", text: "It is not established whether a Temporary Food Permit is needed." },
      { gapId: "gap-food-permit", text: "Same gap again." },
      { gapId: "gap-dismissed", text: "Dismissed gaps are not open." },
      { text: "The 2025 rules may have changed by 3,000 students voting." },
    ],
    nextSteps: [
      { step: "Do more research.", basedOn: [] },
      { step: "Submit the ASUCR Organization Grant request for up to $1,500.", reason: "It is the main funding source.", basedOn: ["funding-c1"] },
      { step: "Ask the made-up office.", basedOn: ["ghost-gap"] },
    ],
  };

  const run = buildReport(raw, input);
  const r = run.response;
  console.log("buildReport");
  check(
    r.directAnswer.includes("$1,500") && !r.directAnswer.includes("$2,000"),
    "direct answer: sentence with an unsupported amount ($2,000) removed, grounded ones kept",
  );
  check(r.directAnswer.includes("2026-2027"), "a 2026-2027 year range is grounded by 2026-27 in the material");
  check(JSON.stringify(r.keyDiscoveries.map((d) => d.claimId)) === JSON.stringify(["funding-c1", "funding-c2"]), "discoveries: duplicates, unverified and unknown claims dropped");
  check(r.keyDiscoveries[1]?.summary === input.claims[1].text, "discovery with a number not in its claim ($750) falls back to the claim text");
  check(r.planChangingConnections.length === 1 && r.planChangingConnections[0].connectionId === "conn-accepted", "only the accepted connection is used");
  check(r.planChangingConnections[0]?.text.includes("$500"), "connection text with an unsupported number ($900) falls back to the explanation");
  check(JSON.stringify(r.uncertainties.map((u) => u.gapId ?? "-")) === JSON.stringify(["gap-food-permit"]), "uncertainties: duplicate, dismissed-gap and unsupported-number items dropped");
  check(r.nextSteps[0]?.step.startsWith("Submit the ASUCR"), "generic and unknown-id steps dropped; the real step stays first");
  check(r.nextSteps.length === 3 && r.nextSteps.slice(1).every((s) => s.step.startsWith("Resolve this open question")), "steps topped up to 3 from open gaps");
  checkReport("offline", req, run);

  const empty = buildReport(
    { directAnswer: "It costs $123,456.", keyDiscoveries: [], planChangingConnections: [], uncertainties: [], nextSteps: [], malformed: 0 },
    { ...input, gaps: [] },
  );
  check(empty.response.nextSteps.length === 1 && empty.response.nextSteps[0].step.includes("asucr.ucr.edu"), "no usable steps and no gaps: one fallback step naming the source domain");
  check(!empty.response.directAnswer.includes("123"), "a direct answer with only unsupported numbers is replaced by a grounded fallback");
}

// ---------------------------------------------------------------------------
// --mock-retry
// ---------------------------------------------------------------------------

async function mockRetry() {
  loadEnv();
  const mock = await startMockLLM();
  const req: ReportRequest = {
    question: "How do I fund a club event?",
    assumptions: [],
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
    gaps: [],
    connections: [],
  };
  const good = JSON.stringify({
    directAnswer: "You can request a grant of up to $1,500 per year. The deadline is not established.",
    keyDiscoveries: [{ claimId: "funding-c1", summary: "Grants are capped at $1,500 per year." }],
    planChangingConnections: [],
    uncertainties: [],
    nextSteps: [{ step: "Prepare the grant request for up to $1,500.", basedOn: ["funding-c1"] }],
  });

  mock.replies.push("Here is your report: it went well.", good);
  mock.reset();
  const run = await writeReport(req);
  check(mock.calls() === 2, `invalid first reply is retried exactly once (${mock.calls()} calls)`);
  check(run.response.keyDiscoveries.length === 1, "the corrected reply is used");

  mock.replies.push("not json", JSON.stringify({ report: "wrong shape" }));
  mock.reset();
  let status = 0;
  let code = "";
  try {
    await writeReport(req);
  } catch (err) {
    const res = errorResponseFor(err, "report");
    status = res.status;
    code = ((await res.json()) as { error: { code: string } }).error.code;
  }
  check(mock.calls() === 2, `still invalid after the retry: gives up after 2 calls (${mock.calls()})`);
  check(status === 502 && code === "MODEL_OUTPUT_INVALID", `route answers a clean HTTP ${status} ${code}`);

  mock.reset();
  const noClaims = await writeReport({ ...req, claims: [] });
  check(mock.calls() === 0 && noClaims.response.nextSteps.length >= 1, "no verified claims: honest report without calling the model");
  await mock.close();
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

async function live() {
  loadEnv();
  const from = option("--from");
  const question =
    args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--from") ??
    "How can my student club at UC Riverside get funding for a cultural night event with food?";

  let analyzeReq: AnalyzeRequest;
  let assumptions: string[] = [];
  const started = Date.now();
  if (from) {
    analyzeReq = AnalyzeRequestSchema.parse(JSON.parse(readFileSync(join(from, "analyze-request-1.json"), "utf8")));
    console.log(`Re-using saved research: ${analyzeReq.claims.length} claims for "${analyzeReq.question}"`);
  } else {
    const plan = await planQuestion(question);
    assumptions = plan.assumptions;
    const runs = await Promise.all(plan.branches.map((branch) => researchBranch({ branch })));
    const sources = new Map<string, PublicSource>();
    for (const { response } of runs) for (const s of response.sources) if (!sources.has(s.id) || s.retrievalStatus !== "failed") sources.set(s.id, s);
    analyzeReq = AnalyzeRequestSchema.parse({
      question,
      branches: plan.branches.map(({ id, title, question: q }) => ({ id, title, question: q })),
      claims: runs.flatMap((r) => r.response.claims),
      sources: [...sources.values()],
    });
    console.log(`Plan + research: ${plan.branches.length} branches, ${analyzeReq.claims.length} claims in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const analysis = await analyzeInvestigation(analyzeReq);
  const updates = new Map(analysis.response.claimUpdates.map((u) => [u.claimId, u.evidenceStatus]));
  const claims = analyzeReq.claims.map((c) => ({ ...c, evidenceStatus: updates.get(c.id) ?? c.evidenceStatus }));
  // The user accepts every suggested connection except the last one.
  const connections = analysis.response.connections.map((c, i, all) => ({ ...c, accepted: all.length === 1 || i < all.length - 1 }));
  const notAccepted = connections.filter((c) => !c.accepted).map((c) => c.id);

  const reportReq: ReportRequest = {
    question: analyzeReq.question,
    assumptions,
    claims,
    sources: analyzeReq.sources,
    gaps: analysis.response.gaps,
    connections,
  };
  const run = await writeReport(reportReq);

  checkReport("live", reportReq, run);
  check(run.response.planChangingConnections.every((p) => !notAccepted.includes(p.connectionId)), "the connection the user did not accept is never used");
  const names = unknownNames(run.response, corpusOf(reportReq));
  console.log(`INFO  capitalized names in the report that the material never uses: ${names.length ? names.join(", ") : "none"}`);

  const claimById = new Map(claims.map((c) => [c.id, c]));
  const r = run.response;
  console.log(`\n=== GOLDEN KEY REPORT: ${reportReq.question}\n`);
  console.log(`DIRECT ANSWER\n${r.directAnswer}\n`);
  console.log("KEY DISCOVERIES");
  r.keyDiscoveries.forEach((d, i) => console.log(`${i + 1}. ${d.summary}  [${d.claimId}, ${claimById.get(d.claimId)?.evidenceStatus}]`));
  console.log("\nCONNECTIONS THAT CHANGE THE PLAN");
  if (!r.planChangingConnections.length) console.log("(none)");
  r.planChangingConnections.forEach((p) => console.log(`- ${p.text}  [${p.connectionId}]`));
  console.log("\nWHAT REMAINS UNCERTAIN");
  r.uncertainties.forEach((u) => console.log(`- ${u.text}${u.gapId ? `  [${u.gapId}]` : ""}`));
  console.log("\nNEXT STEPS");
  r.nextSteps.forEach((s, i) => console.log(`${i + 1}. ${s.step}${s.reason ? `\n   why: ${s.reason}` : ""}`));
  console.log(`\nCode changes to the model's draft: ${JSON.stringify(run.stats.changes)}; report took ${(run.stats.modelMs / 1000).toFixed(1)}s`);
}

async function main() {
  if (flag("--offline")) offline();
  else if (flag("--mock-retry")) await mockRetry();
  else await live();
  console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
  // Let Node exit on its own (process.exit during socket teardown trips a libuv assertion on Windows).
  process.exitCode = failures ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exitCode = 1;
});
