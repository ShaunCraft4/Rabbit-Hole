/**
 * Hardening checks (A7). No real keys and no network: the route handlers are called directly, the
 * LLM is a local fake server (scripts/mock-llm.ts) and Keenable is a stubbed fetch.
 *
 *   npx tsx scripts/test-hardening.ts
 *
 * 1. Every route validates input with zod and enforces a body-size cap (also for streamed bodies).
 * 2. No secret and no Source.text ever reaches a response; logs never contain a secret.
 * 3. One back-off retry on 429 and transient errors, for the LLM and for Keenable; never more.
 * 4. A failing source never kills a branch; a branch whose searches all fail fails alone.
 */
import { MAX_BODY_BYTES, apiError, respondWith } from "@/app/api/_lib/http";
import { POST as analyzeRoute } from "@/app/api/analyze/route";
import { POST as planRoute } from "@/app/api/plan/route";
import { POST as reportRoute } from "@/app/api/report/route";
import { POST as researchRoute } from "@/app/api/research/route";
import { PlanResponseSchema, ResearchResponseSchema, type ResearchRequest } from "@/lib/contracts";
import { sourceIdFromUrl } from "@/lib/research/dedupe";
import { searchWeb } from "@/lib/research/search";

import { startMockLLM } from "./mock-llm";

// Fake secrets: the checks below prove these never leave the server.
const FAKE_LLM_KEY = "sk-test-LLMSECRET-1234567890abcdef";
const FAKE_KEENABLE_KEY = "keen_test_KEENSECRET_0987654321";
process.env.KEENABLE_API_KEY = FAKE_KEENABLE_KEY;
delete process.env.SOLARI_API_KEY; // the browser fallback stays off: no real Solari calls

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

// Capture every app log line (printed only on failure) to scan it for secrets.
const logLines: string[] = [];
for (const level of ["info", "warn", "error"] as const) {
  console[level] = (...args: unknown[]) => {
    logLines.push(args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  };
}

// Keenable is stubbed at the fetch level; everything else (the fake LLM) goes through.
const realFetch = globalThis.fetch;
type Handler = (url: URL) => Response | Promise<Response>;
let keenable: Handler | undefined;
let keenableCalls: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "api.keenable.ai") {
    keenableCalls.push(url.pathname);
    if (!keenable) throw new Error("unexpected Keenable call");
    return keenable(url);
  }
  return realFetch(input, init);
}) as typeof fetch;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Answers Keenable calls with the given responses in order (the last one repeats). */
function keenableSequence(...responses: (() => Response)[]): Handler {
  let i = 0;
  return () => responses[Math.min(i++, responses.length - 1)]();
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });

/** A body streamed in 8 KB chunks, with no Content-Length header. */
function streamed(bytes: number): Request {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      const n = Math.min(8192, bytes - sent);
      sent += n;
      controller.enqueue(new Uint8Array(n).fill(0x20));
    },
  });
  return new Request("http://localhost/api/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
}

async function read(res: Response) {
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as { error?: { code: string; message: string } } & Record<string, unknown> };
}

const VALID_PLAN = JSON.stringify({
  goal: "Fund a student club event.",
  assumptions: ["Assuming the club is at UC Riverside."],
  branches: [
    { title: "Funding sources", question: "Which funds exist?", queries: ["UCR club event funding sources", "ASUCR organization grant 2026"] },
    { title: "Eligibility rules", question: "Who qualifies?", queries: ["ASUCR grant eligibility registered organization", "UCR student organization funding rules"] },
    { title: "Deadlines", question: "When must it be filed?", queries: ["ASUCR grant deadline 2026-27", "UCR event funding request timeline"] },
  ],
});

async function main() {
  const mock = await startMockLLM({ apiKey: FAKE_LLM_KEY });
  const routes = { plan: planRoute, research: researchRoute, analyze: analyzeRoute, report: reportRoute } as const;

  // -------------------------------------------------------------------------
  console.log("1. Input validation and size caps (every route)");
  for (const [name, route] of Object.entries(routes)) {
    const cap = MAX_BODY_BYTES[name as keyof typeof MAX_BODY_BYTES];
    const bad = await read(await route(post("{not json")));
    const invalid = await read(await route(post(JSON.stringify({ unexpected: true }))));
    const declared = await read(await route(post("{}", { "content-length": String(cap + 1) })));
    const stream = await read(await route(streamed(cap + 1)));
    check(
      bad.status === 400 && bad.body.error?.code === "INVALID_JSON" &&
        invalid.status === 400 && invalid.body.error?.code === "INVALID_REQUEST" &&
        declared.status === 413 && stream.status === 413,
      `${name}: bad JSON 400, schema-invalid 400, declared and streamed bodies over ${cap} bytes 413`,
    );
  }
  check(mock.calls() === 0 && keenableCalls.length === 0, "rejected requests never reached the LLM or Keenable");

  // -------------------------------------------------------------------------
  console.log("\n2. Secrets and page text never reach a response");
  mock.reset();
  mock.replies.push(
    { status: 500, body: { error: { message: `internal failure for key ${FAKE_LLM_KEY}`, type: "server_error" } } },
    { status: 500, body: { error: { message: `still failing for ${FAKE_LLM_KEY}`, type: "server_error" } } },
  );
  const leaky = await read(await planRoute(post(JSON.stringify({ question: "How do I fund a club event?" }))));
  check(leaky.status === 502 && !leaky.text.includes(FAKE_LLM_KEY), `provider error echoing the key: HTTP ${leaky.status}, key not in the response`);

  const blocked = await read(respondWith(PlanResponseSchema, { goal: `Use ${FAKE_KEENABLE_KEY}`, assumptions: [], branches: [{ id: "a", title: "A", question: "Q", queries: ["q one"] }] }));
  check(blocked.status === 500 && !blocked.text.includes(FAKE_KEENABLE_KEY), "a response containing a secret value is blocked (500)");

  const withText = await read(
    respondWith(ResearchResponseSchema, {
      branchId: "b",
      status: "done",
      sources: [{ id: "s1", url: "https://a.edu/x", domain: "a.edu", title: "A", retrievalStatus: "full_text", text: "server-only page text" }],
      claims: [],
      rejectedClaims: 0,
    } as never),
  );
  check(withText.status === 500 && !withText.text.includes("server-only page text"), "a source carrying page text is rejected (500), text not sent");

  const errText = await read(apiError(502, "UPSTREAM_ERROR", `bad key ${FAKE_KEENABLE_KEY} and Bearer abcdefghijklmnop`));
  check(!errText.text.includes(FAKE_KEENABLE_KEY) && !errText.text.includes("abcdefghijklmnop"), "error messages are redacted");

  // -------------------------------------------------------------------------
  console.log("\n3. One back-off retry: LLM");
  const planOnce = async (...replies: Parameters<typeof mock.replies.push>) => {
    mock.reset();
    mock.replies.length = 0;
    mock.replies.push(...replies);
    const res = await read(await planRoute(post(JSON.stringify({ question: "How do I fund a club event?" }))));
    return { ...res, calls: mock.calls() };
  };
  const r429 = await planOnce({ status: 429, headers: { "retry-after": "0" } }, VALID_PLAN);
  check(r429.status === 200 && r429.calls === 2, `429 then OK: HTTP ${r429.status} after ${r429.calls} calls`);
  const r503 = await planOnce({ status: 503 }, VALID_PLAN);
  check(r503.status === 200 && r503.calls === 2, `503 then OK: HTTP ${r503.status} after ${r503.calls} calls`);
  const r529 = await planOnce({ status: 529 }, VALID_PLAN);
  check(r529.status === 200 && r529.calls === 2, `529 (overloaded) then OK: HTTP ${r529.status} after ${r529.calls} calls`);
  const r429x2 = await planOnce({ status: 429, headers: { "retry-after": "0" } }, { status: 429, headers: { "retry-after": "0" } }, VALID_PLAN);
  check(r429x2.status === 429 && r429x2.body.error?.code === "RATE_LIMITED" && r429x2.calls === 2, `429 twice: gives up after ${r429x2.calls} calls with HTTP ${r429x2.status} RATE_LIMITED`);
  const r401 = await planOnce({ status: 401 }, VALID_PLAN);
  check(r401.status === 500 && r401.calls === 1, `401 (bad key) is not retried: ${r401.calls} call, HTTP ${r401.status}`);

  console.log("\n3b. One back-off retry: Keenable");
  const hit = { title: "ASUCR grants", url: "https://asucr.ucr.edu/grants", description: "", snippet: "Grants are limited to $1,500 per organization per academic year. ".repeat(3) };
  const ok = () => json(200, { query: "q", results: [hit] });
  const kTry = async (handler: Handler) => {
    keenable = handler;
    keenableCalls = [];
    const started = Date.now();
    try {
      const hits = await searchWeb("ucr grants");
      return { ok: hits.length > 0, calls: keenableCalls.length, ms: Date.now() - started, code: "" };
    } catch (err) {
      return { ok: false, calls: keenableCalls.length, ms: Date.now() - started, code: (err as { code?: string; status?: number }).code ?? "" };
    }
  };
  const k503 = await kTry(keenableSequence(() => json(503, { error: "Service unavailable", retryable: true }), ok));
  check(k503.ok && k503.calls === 2 && k503.ms >= 450, `503 then OK: ${k503.calls} calls, backed off (${k503.ms} ms)`);
  const k429 = await kTry(keenableSequence(() => json(429, { error: "Rate limit", retry_after_seconds: 0.3 }, { "retry-after": "1" }), ok));
  check(k429.ok && k429.calls === 2, `429 then OK: ${k429.calls} calls (${k429.ms} ms)`);
  const k503x2 = await kTry(keenableSequence(() => json(503, { error: "Service unavailable" }), () => json(503, { error: "Service unavailable" }), ok));
  check(!k503x2.ok && k503x2.calls === 2, `503 twice: gives up after ${k503x2.calls} calls (${k503x2.code || "error"})`);
  const kTarget = await kTry(keenableSequence(() => json(502, { error: "Target unreachable", type: "target_error", code: "target_unreachable" }), ok));
  check(!kTarget.ok && kTarget.calls === 1, `page-level failure (target_error) is not retried: ${kTarget.calls} call`);

  // -------------------------------------------------------------------------
  console.log("\n4. Failures stay contained");
  const goodUrl = "https://asucr.ucr.edu/budget/org-funding";
  const deadUrl = "https://dead.example.edu/page";
  const page =
    "Student Organization Funding\n\nGrants are limited to $1,500 per organization per academic year. " +
    "Up to $500 or 50% of an event grant, whichever is less, may be used to fund food. ".repeat(4);
  keenable = (url) => {
    if (url.pathname.startsWith("/v1/search")) {
      return json(200, {
        results: [
          { title: "Dead page", url: deadUrl, description: "", snippet: "" },
          { title: "Org funding", url: goodUrl, description: "", snippet: "" },
        ],
      });
    }
    const target = url.searchParams.get("url") ?? "";
    if (target.startsWith(deadUrl)) return json(502, { error: "Target unreachable", type: "target_error", code: "target_unreachable" });
    return json(200, { url: target, title: "Student Organization Funding", content: page, truncated: false, total_chars: page.length });
  };
  mock.reset();
  mock.replies.length = 0;
  mock.replies.push(
    JSON.stringify({
      claims: [
        {
          sourceId: sourceIdFromUrl(goodUrl),
          excerpt: "Grants are limited to $1,500 per organization per academic year.",
          text: "ASUCR grants are limited to $1,500 per organization per academic year.",
          claimType: "amount",
        },
        { sourceId: sourceIdFromUrl(deadUrl), excerpt: "Made up text from a page that was never read.", text: "Invented.", claimType: "other" },
      ],
    }),
  );
  const branchReq: ResearchRequest = {
    branch: { id: "funding", title: "Funding", question: "How much can a club get?", queries: ["asucr grant amount"] },
  };
  const one = await read(await researchRoute(post(JSON.stringify(branchReq))));
  const sources = (one.body.sources as { id: string; retrievalStatus: string }[] | undefined) ?? [];
  const claims = (one.body.claims as { sourceId: string }[] | undefined) ?? [];
  check(
    one.status === 200 && sources.some((s) => s.retrievalStatus === "failed") && claims.length === 1 && claims[0].sourceId === sourceIdFromUrl(goodUrl),
    `one dead page: branch still 200 with ${claims.length} verified claim, dead page kept as failed`,
  );
  check(one.body.rejectedClaims === 1, "a claim citing the unread page is rejected, not shown");
  check(
    (one.body.sources as Record<string, unknown>[]).every((s) => !("text" in s)),
    "no source in the response carries its page text (only the short display snippet is sent)",
  );

  keenable = () => json(503, { error: "Service unavailable" });
  const allFail = await read(await researchRoute(post(JSON.stringify(branchReq))));
  check(allFail.status === 502 && allFail.body.error?.code === "UPSTREAM_ERROR", `every search failing fails only that branch: HTTP ${allFail.status} ${allFail.body.error?.code}`);

  // -------------------------------------------------------------------------
  console.log("\n5. Logs");
  const leaked = logLines.filter((l) => l.includes(FAKE_LLM_KEY) || l.includes(FAKE_KEENABLE_KEY));
  check(leaked.length === 0, `no log line contains a secret (${logLines.length} lines checked)`);
  const longest = Math.max(0, ...logLines.map((l) => l.length));
  check(longest <= 1500, `log lines stay concise (longest ${longest} characters)`);

  if (failures) console.log(`\nCaptured logs:\n${logLines.join("\n")}`);
  await mock.close();
}

main()
  .catch((err: unknown) => {
    console.log(err instanceof Error ? (err.stack ?? err.message) : String(err));
    failures++;
  })
  .finally(() => {
    console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
    process.exitCode = failures ? 1 : 0;
  });
