/**
 * End-to-end smoke test of the four API routes against a running server, validating every
 * response with the zod contracts. Works for the stubs and for the real routes.
 *
 *   npm run dev            (in another terminal)
 *   npx tsx scripts/smoke-api.ts [baseUrl] [question]
 */
import { z } from "zod";

import {
  AnalyzeResponseSchema,
  ApiErrorSchema,
  API_ROUTES,
  InvestigationSchema,
  investigationIntegrityIssues,
  LIMITS,
  PlanResponseSchema,
  ReportResponseSchema,
  ResearchResponseSchema,
  type AnalyzeRequest,
  type PublicSource,
  type ReportRequest,
  type ResearchRequest,
} from "@/lib/contracts";
import type { Claim, Investigation } from "@/lib/types";

const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000";
const QUESTION =
  process.argv[3] ?? "How can I get funding for a student organization event at Example University?";

const failures: string[] = [];
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
}

async function post(path: string, body: unknown, rawBody?: string) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => undefined);
  return { status: res.status, json, ms: Date.now() - started, stub: res.headers.get("x-rabbit-hole-stub") === "1" };
}

function parseOk<S extends z.ZodType>(label: string, schema: S, res: Awaited<ReturnType<typeof post>>) {
  const parsed = schema.safeParse(res.json);
  check(
    res.status === 200 && parsed.success,
    `${label}: HTTP ${res.status}, contract-valid, ${res.ms} ms${res.stub ? " (stub)" : ""}`,
  );
  if (!parsed.success) {
    console.error(JSON.stringify(res.json, null, 2)?.slice(0, 2000));
    if (res.status === 200) console.error(parsed.error.issues);
    throw new Error(`${label} failed`);
  }
  return parsed.data as z.infer<S>;
}

async function expectError(label: string, status: number, path: string, body: unknown, rawBody?: string) {
  const res = await post(path, body, rawBody);
  const parsed = ApiErrorSchema.safeParse(res.json);
  check(
    res.status === status && parsed.success,
    `${label}: HTTP ${res.status} (want ${status}) with {error:{code,message}}${parsed.success ? ` code=${parsed.data.error.code}` : ""}`,
  );
}

async function main() {
  console.log(`Smoke-testing ${BASE}\n`);

  // 1. Plan
  const plan = parseOk("plan", PlanResponseSchema, await post(API_ROUTES.plan, { question: QUESTION }));

  // 2. Research every branch in parallel, like the client runner
  const research = await Promise.all(
    plan.branches.map(async (branch) => {
      const req: ResearchRequest = { branch };
      return parseOk(`research ${branch.id}`, ResearchResponseSchema, await post(API_ROUTES.research, req));
    }),
  );

  const sources = new Map<string, PublicSource>();
  const claims: Claim[] = [];
  let rejectedClaims = 0;
  for (const r of research) {
    for (const s of r.sources) sources.set(s.id, s);
    claims.push(...r.claims);
    rejectedClaims += r.rejectedClaims;
  }
  check(research.every((r, i) => r.branchId === plan.branches[i].id), "research echoes branchId");
  check(claims.every((c) => sources.has(c.sourceId)), "every claim cites a returned source");
  check(claims.length > 0, `research produced claims (${claims.length} kept, ${rejectedClaims} rejected)`);

  // 3. Analyze
  const analyzeReq: AnalyzeRequest = {
    question: QUESTION,
    branches: plan.branches.map(({ id, title, question }) => ({ id, title, question })),
    claims,
    sources: [...sources.values()],
  };
  const analysis = parseOk("analyze", AnalyzeResponseSchema, await post(API_ROUTES.analyze, analyzeReq));
  const claimIds = new Set(claims.map((c) => c.id));
  check(
    analysis.claimUpdates.every((u) => claimIds.has(u.claimId)) &&
      analysis.gaps.every((g) => g.claimIds.every((id) => claimIds.has(id))) &&
      analysis.connections.every((c) => claimIds.has(c.from) && claimIds.has(c.to)),
    `analyze only references known claims (${analysis.gaps.length} gaps, ${analysis.connections.length} connections, ${analysis.claimUpdates.length} updates)`,
  );
  const updates = new Map(analysis.claimUpdates.map((u) => [u.claimId, u.evidenceStatus]));
  const analyzedClaims = claims.map((c) => ({ ...c, evidenceStatus: updates.get(c.id) ?? c.evidenceStatus }));
  // Simulate the user accepting the first suggested connection.
  const connections = analysis.connections.map((c, i) => ({ ...c, accepted: i === 0 }));

  // 4. Gap follow-up ("investigate this gap")
  const gap = analysis.gaps[0];
  if (gap) {
    const followReq: ResearchRequest = {
      branch: {
        id: gap.branchId ?? "gap",
        title: "Gap follow-up",
        question: gap.question,
        queries: [gap.suggestedQuery ?? gap.question],
      },
      excludeSourceIds: [...sources.keys()],
      forGapId: gap.id,
    };
    const follow = parseOk("research (gap follow-up)", ResearchResponseSchema, await post(API_ROUTES.research, followReq));
    check(follow.forGapId === gap.id, "gap follow-up echoes forGapId");
    check(
      follow.sources.every((s) => !sources.has(s.id)),
      "gap follow-up respects excludeSourceIds",
    );
    for (const s of follow.sources) sources.set(s.id, s);
    analyzedClaims.push(...follow.claims);
  }

  // 5. Report
  const reportReq: ReportRequest = {
    question: QUESTION,
    assumptions: plan.assumptions,
    claims: analyzedClaims,
    sources: [...sources.values()],
    gaps: analysis.gaps,
    connections,
  };
  const report = parseOk("report", ReportResponseSchema, await post(API_ROUTES.report, reportReq));
  const connectionIds = new Set(connections.map((c) => c.id));
  const gapIds = new Set(analysis.gaps.map((g) => g.id));
  check(
    report.keyDiscoveries.every((d) => analyzedClaims.some((c) => c.id === d.claimId)) &&
      report.planChangingConnections.every((p) => connectionIds.has(p.connectionId)) &&
      report.uncertainties.every((u) => !u.gapId || gapIds.has(u.gapId)),
    "report only references known ids",
  );

  // 6. The assembled investigation validates as a whole
  const inv: Investigation = {
    id: "smoke-test",
    question: QUESTION,
    assumptions: plan.assumptions,
    branches: plan.branches.map((b) => ({ ...b, status: "done" })),
    sources: [...sources.values()],
    claims: analyzedClaims,
    gaps: analysis.gaps,
    connections,
    report,
    rejectedClaims,
  };
  const invParsed = InvestigationSchema.safeParse(inv);
  check(invParsed.success, "assembled Investigation validates against InvestigationSchema");
  const issues = invParsed.success ? investigationIntegrityIssues(invParsed.data) : [];
  check(issues.length === 0, `assembled Investigation has no broken references${issues.length ? `: ${issues.join("; ")}` : ""}`);

  // 7. Error shape
  console.log("");
  await expectError("plan: invalid JSON", 400, API_ROUTES.plan, undefined, "{not json");
  await expectError("plan: empty question", 400, API_ROUTES.plan, { question: "   " });
  await expectError("plan: question too long", 400, API_ROUTES.plan, { question: "x".repeat(LIMITS.questionChars + 1) });
  await expectError("plan: body too large", 413, API_ROUTES.plan, { question: "ok", pad: "x".repeat(20_000) });
  await expectError("research: missing branch", 400, API_ROUTES.research, {});
  await expectError("research: invalid id characters", 400, API_ROUTES.research, {
    branch: { id: "bad id!", title: "t", question: "q", queries: ["q"] },
  });
  await expectError("analyze: no branches", 400, API_ROUTES.analyze, { question: "q", branches: [], claims: [], sources: [] });
  await expectError("report: source with text is rejected", 400, API_ROUTES.report, {
    ...reportReq,
    sources: [{ ...reportReq.sources[0], text: "server-only page text" }],
  });
  if (process.env.SMOKE_SKIP_FAIL !== "1") {
    await expectError("research: #fail branch (dev-only test hook)", 502, API_ROUTES.research, {
      branch: { id: "fail-test", title: "Forced #fail", question: "q", queries: ["q"] },
    });
  }

  console.log(
    failures.length ? `\n${failures.length} check(s) failed.` : "\nAll smoke checks passed.",
  );
  process.exit(failures.length ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
