/**
 * Live checks for the Solari cloud-browser fallback (A6). Reads .env.local itself.
 *
 *   npx tsx scripts/test-solari.ts <url> [url...]   read each page; print title, length, first 300 chars, time
 *   npx tsx scripts/test-solari.ts --parallel       5 reads at once: the 3-browser limit queues them (no 429s)
 *   npx tsx scripts/test-solari.ts --abort          give up while the browser is still launching: no leaked session
 *   npx tsx scripts/test-solari.ts --no-key         SOLARI_API_KEY unset: returns null at once, nothing launched
 *
 * Every mode ends by checking that no session this app opened is still active.
 */
import { closeSolari, countActiveSessions, isSolariEnabled, readWithBrowser } from "@/lib/research/solari";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const urls = args.filter((a) => !a.startsWith("--"));

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

try {
  process.loadEnvFile(".env.local");
} catch {
  console.warn("(no .env.local found; using the current environment)");
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function readOne(url: string) {
  const started = Date.now();
  const page = await readWithBrowser(url);
  const ms = Date.now() - started;
  console.log(`\n${url}`);
  if (!page) {
    console.log(`  not read (null) after ${sec(ms)}`);
    return { ok: false, ms };
  }
  console.log(`  title:   ${page.title}`);
  console.log(`  text:    ${page.text.length} characters in ${sec(ms)}`);
  console.log(`  first 300: ${page.text.slice(0, 300).replace(/\n+/g, " / ")}`);
  return { ok: page.text.length >= 500, ms };
}

async function expectNoLeaks() {
  // close() releases synchronously on the gateway, but give the list a moment to catch up.
  await new Promise((r) => setTimeout(r, 1500));
  const active = await countActiveSessions();
  check(active === 0, `no Solari session left active (${active ?? "unknown"})`);
}

async function main() {
  if (flag("--no-key")) {
    delete process.env.SOLARI_API_KEY;
    const started = Date.now();
    const page = await readWithBrowser("https://example.com");
    check(!isSolariEnabled() && page === null && Date.now() - started < 50, `without a key: null in ${Date.now() - started} ms, nothing launched`);
    return;
  }

  if (!isSolariEnabled()) {
    console.error("SOLARI_API_KEY is not set in .env.local");
    process.exitCode = 1;
    return;
  }

  if (flag("--abort")) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 300); // while the session is still being created
    const started = Date.now();
    const page = await readWithBrowser("https://asucr.ucr.edu/budget/org-funding", { signal: controller.signal });
    check(page === null && Date.now() - started < 1500, `aborted read returns null quickly (${Date.now() - started} ms)`);
    await new Promise((r) => setTimeout(r, 4000)); // let the late launch arrive and be closed
    await expectNoLeaks();
    return;
  }

  if (flag("--parallel")) {
    const pages = [
      "https://asucr.ucr.edu/budget/org-funding",
      "https://studentlife.ucr.edu",
      "https://www.ucr.edu/about",
      "https://highlanderlink.ucr.edu/organizations",
      "https://financialaid.ucr.edu",
    ];
    const started = Date.now();
    const results = await Promise.all(pages.map(readOne));
    console.log(`\n5 reads with 3 browser slots: ${sec(Date.now() - started)} total; each ${results.map((r) => sec(r.ms)).join(", ")}`);
    check(results.every((r) => r.ok), "all 5 reads succeeded (the limiter kept us under the 3-browser plan cap)");
    await expectNoLeaks();
    return;
  }

  const targets = urls.length ? urls : ["https://asucr.ucr.edu/budget/org-funding"];
  const results = [];
  for (const url of targets) results.push(await readOne(url));
  check(results.every((r) => r.ok), `every page read with at least 500 characters (${results.length})`);
  await expectNoLeaks();
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    failures++;
  })
  .finally(async () => {
    await closeSolari();
    console.log(failures ? `\n${failures} check(s) failed.` : "\nAll checks passed.");
    process.exitCode = failures ? 1 : 0;
  });
