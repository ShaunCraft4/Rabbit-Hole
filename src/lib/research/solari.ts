/**
 * Solari cloud-browser fallback reader (docs/BLUEPRINT.md section 30). Server-only.
 * When Keenable cannot read a page, a plain Solari browser opens it and returns its visible text.
 *
 * Verified against @solarisdk/browser 0.5.5 on 2026-11-21:
 * - `new Solari({ apiKey })`; `await client.launch(options)` returns a Playwright-shaped BrowserSession
 *   (newPage / goto / evaluate). `browser.close()` closes the browser AND releases the session
 *   (`sessions.get(id).status` is "released" right after).
 * - Every launch option is opt-in: no stealth, proxy, captcha or recording unless asked (the Free plan
 *   answers 402 to those). We pass none of them.
 * - The package is ESM-only (its exports map has only an "import" condition), so it is loaded with a
 *   dynamic import(). It is therefore never loaded at all when SOLARI_API_KEY is unset.
 * - `sessionTimeoutMs` (gateway minimum 60 s) auto-releases any session whose close was lost.
 * - The SDK's default HTTP timeout is 90 s per attempt, with retries; we allow one 10 s attempt.
 * - Launch about 0.5 s, navigation 0.6 to 3 s, close under 0.1 s: a read typically takes 2.5 to 5 s.
 */
import type { BrowserSession, Solari } from "@solarisdk/browser";
import pLimit from "p-limit";

import { redactSecrets } from "@/lib/ai/redact";

import { SOLARI } from "./budget";

export interface BrowserPage {
  title: string;
  /** Visible main text, whitespace collapsed (paragraph breaks kept), at most SOLARI.maxTextChars. */
  text: string;
}

const apiKey = () => process.env.SOLARI_API_KEY?.trim() || undefined;

let announced = false;

/** True when SOLARI_API_KEY is set. Logs one line, the first time, saying whether the fallback is on. */
export function isSolariEnabled(): boolean {
  const on = apiKey() !== undefined;
  if (!announced) {
    announced = true;
    console.info(
      on
        ? `[solari] browser fallback on (at most ${SOLARI.concurrency} browsers at once, ${SOLARI.maxPerBranch} per branch)`
        : "[solari] SOLARI_API_KEY not set: browser fallback off",
    );
  }
  return on;
}

const NOT_A_WEB_PAGE = /\.(pdf|docx?|pptx?|xlsx?|zip|png|jpe?g|gif|svg|mp3|mp4)$/i;

/** http(s) and not a PDF (or another obvious file download). */
export function isBrowserReadable(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && !NOT_A_WEB_PAGE.test(u.pathname);
  } catch {
    return false;
  }
}

// One client per process (it holds a connection pool), created on first use.
let clientPromise: Promise<Solari> | undefined;
let clientKey: string | undefined;

function getClient(key: string): Promise<Solari> {
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    const created = import("@solarisdk/browser").then(
      ({ Solari: SolariClient }) => new SolariClient({ apiKey: key, maxAttempts: 1, timeoutMs: SOLARI.apiTimeoutMs }),
    );
    clientPromise = created;
    created.catch(() => {
      if (clientPromise === created) clientPromise = undefined; // let a later call retry the import
    });
  }
  return clientPromise;
}

/** Waits for `promise` but gives up when `signal` aborts. The promise is never left unhandled. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => {});
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs inside the page. Sent as a string so no transpiler (tsx, Turbopack) can inject helpers into it.
 * Prefers <main> / <article> when they hold real text, falls back to <body>, drops navigation and
 * non-content elements, and keeps paragraph breaks (the relevance trimmer splits on them).
 */
const extractScript = (maxChars: number) => String.raw`(() => {
  let root = document.body;
  for (const selector of ["main", "article", "[role=main]"]) {
    const el = document.querySelector(selector);
    if (el && (el.innerText || "").trim().length >= 200) { root = el; break; }
  }
  if (!root) return "";
  root.querySelectorAll("nav, header, footer, script, style, noscript, template, svg").forEach((el) => el.remove());
  return (root.innerText || "")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, ${maxChars});
})()`;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "invalid-url";
  }
};

function describe(err: unknown, deadline: AbortSignal): string {
  if (deadline.aborted) return `timed out (${SOLARI.overallTimeoutMs / 1000}s limit)`;
  const e = err as { name?: string; code?: unknown; status?: number; message?: string };
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "stopped by the caller's time limit";
  // SolariError codes are strings, e.g. "ConcurrencyLimitExceeded" (429) or "FeatureRequiresPlan" (402).
  if (typeof e?.code === "string") return `${e.code}${e.status ? ` (HTTP ${e.status})` : ""}`;
  // Driver messages can contain the session's websocket URL, which is a credential.
  return redactSecrets(`${e?.name ?? "error"}: ${(e?.message ?? String(err)).split("\n")[0]}`).slice(0, 200);
}

/** One browser read, from launch to close. Never throws. */
async function readNow(url: string, outer?: AbortSignal): Promise<BrowserPage | null> {
  const key = apiKey();
  if (!key) return null;
  const started = Date.now();
  const host = hostOf(url);
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  const deadline = AbortSignal.timeout(SOLARI.overallTimeoutMs);
  const signal = outer ? AbortSignal.any([outer, deadline]) : deadline;

  let launching: Promise<BrowserSession> | undefined;
  let browser: BrowserSession | undefined;
  try {
    const client = await untilAborted(getClient(key), signal);
    // A PLAIN browser: no stealth, proxy, captcha or recording.
    launching = client.launch({ sessionTimeoutMs: SOLARI.sessionTimeoutMs, userMetadata: { purpose: "page-reader" } });
    browser = await untilAborted(launching, signal);
    const page = await untilAborted(browser.newPage(), signal);
    const response = await untilAborted(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: SOLARI.navigationTimeoutMs }),
      signal,
    );
    const status = response?.status() ?? 0;
    if (status >= 400) {
      console.info(`[solari] ${host}: HTTP ${status}, not used (${elapsed()})`);
      return null;
    }
    const type = response?.headers()["content-type"] ?? "";
    if (type && !/html|xml|text\/plain/i.test(type)) {
      console.info(`[solari] ${host}: not a web page (${type.split(";")[0]}), not used (${elapsed()})`);
      return null;
    }
    // Wait for the full load, but never past the overall limit, then let late rendering settle.
    const loadBudget = SOLARI.overallTimeoutMs - (Date.now() - started) - SOLARI.settleMs - 1_500;
    if (loadBudget > 250) {
      await untilAborted(page.waitForLoadState("load", { timeout: loadBudget }).catch(() => undefined), signal);
    }
    await untilAborted(page.waitForTimeout(SOLARI.settleMs), signal);
    const title = String((await untilAborted(page.title(), signal)) ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const text = String((await untilAborted(page.evaluate(extractScript(SOLARI.maxTextChars)), signal)) ?? "");
    console.info(`[solari] read ${host} in ${elapsed()}: ${text.length} chars`);
    return { title, text };
  } catch (err) {
    console.warn(`[solari] ${host} not read after ${elapsed()}: ${describe(err, deadline)}`);
    return null;
  } finally {
    if (browser) {
      // close() also releases the session; never wait more than a few seconds for it
      // (sessionTimeoutMs releases it server-side anyway).
      await Promise.race([browser.close().catch(() => {}), delay(5_000)]);
    } else if (launching) {
      // We stopped waiting while the launch was still in flight: close the session when it arrives.
      launching.then((late) => late.close()).catch(() => {});
    }
  }
}

/** Every call shares these slots: the Free plan allows 3 concurrent browsers. */
const slots = pLimit(SOLARI.concurrency);

/**
 * Reads a page with a plain Solari cloud browser. Returns null (never throws) when the key is not
 * set, the URL is not an http(s) web page, the page errors, or the 20-second limit is reached.
 * `signal` can stop the call early, including while it waits for a free browser slot.
 */
export async function readWithBrowser(url: string, opts: { signal?: AbortSignal } = {}): Promise<BrowserPage | null> {
  if (!isSolariEnabled() || !isBrowserReadable(url) || opts.signal?.aborted) return null;
  const queued = slots(() => (opts.signal?.aborted ? null : readNow(url, opts.signal)));
  try {
    return opts.signal ? await untilAborted(queued, opts.signal) : await queued;
  } catch {
    return null;
  }
}

/** Sessions this app opened that are still active (null when unknown). For leak checks in scripts. */
export async function countActiveSessions(): Promise<number | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const client = await getClient(key);
    let active = 0;
    let cursor: string | undefined;
    do {
      const page = await client.sessions.list({ limit: 100, metadata: { purpose: "page-reader" }, ...(cursor ? { cursor } : {}) });
      active += page.sessions.filter((s) => s.status === "active").length;
      cursor = page.nextCursor;
    } while (cursor);
    return active;
  } catch {
    return null;
  }
}

/** Releases the client's connection pool (scripts only; the server keeps one client for its lifetime). */
export async function closeSolari(): Promise<void> {
  const pending = clientPromise;
  clientPromise = undefined;
  if (pending) await pending.then((c) => c.close()).catch(() => {});
}
