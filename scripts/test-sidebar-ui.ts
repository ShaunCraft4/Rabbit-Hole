/**
 * Browser check for the dream-history sidebar, in a headless local Edge/Chrome against a running
 * app (default http://localhost:3000; set BASE to change it). Seeds three saved dreams, then checks
 * date groups, search, rename, delete, collapse (remembered across reloads), the icon rail,
 * reopening a dream, and the phone overlay. With --live it also asks one real question (one plan
 * call) to check auto-save and the planner-written title.
 *
 *   npx tsx scripts/test-sidebar-ui.ts [--live]
 */
import { readFileSync } from "node:fs";

import type { Page } from "patchright-core";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = process.env.BASE ?? "http://localhost:3000";
const DAY = 86_400_000;

function seed() {
  const demo = JSON.parse(readFileSync("src/fixtures/demo-investigation.json", "utf8"));
  const mock = JSON.parse(readFileSync("src/fixtures/mock-investigation.json", "utf8"));
  delete mock._mock;
  const now = Date.now();
  const dreams = [
    { inv: { ...demo, id: "seed-today" }, title: "Funding a UCR club cultural night", at: now - 60_000, phase: "reported" },
    { inv: { ...mock, id: "seed-week" }, title: "Club event funding basics", at: now - 3 * DAY, phase: "analyzed" },
    { inv: { ...demo, id: "seed-month", question: "How do I get funding to study abroad as a UCR undergraduate?" }, title: "Study abroad funding at UCR", at: now - 20 * DAY, phase: "reported" },
  ];
  const index = dreams.map((d) => ({
    id: d.inv.id,
    title: d.title,
    titleEdited: false,
    question: d.inv.question,
    createdAt: d.at,
    updatedAt: d.at,
    phase: d.phase,
    findings: d.inv.claims.length,
    hasReport: Boolean(d.inv.report),
  }));
  const items: Record<string, string> = { "rabbit-hole.history": JSON.stringify(index) };
  for (const d of dreams) {
    items[`rabbit-hole.history.${d.inv.id}`] = JSON.stringify({
      investigation: d.inv,
      phase: d.phase,
      selectedNodeId: null,
      collapsedBranchIds: [],
      branchErrors: {},
      dismissReasons: {},
      view: "graph",
      savedExample: false,
    });
  }
  return items;
}

async function width(page: Page) {
  return Math.round((await page.locator("nav#dream-history").boundingBox())?.width ?? -1);
}

async function main() {
  const { chromium } = await import("patchright-core");
  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const errors: string[] = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const items = seed();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    // Seed by writing storage on the real origin, then reloading (patchright's addInitScript
    // stops the dev page from hydrating).
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.evaluate((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, items);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("nav#dream-history[data-hydrated='true'] li", { timeout: 60_000 });
    await page.waitForTimeout(400);
    const nav = page.locator("nav#dream-history");
    console.log(`dev overlay issues: ${await page.getByText(/\d+ Issues?/).count()}`);
    console.log(`expanded width: ${await width(page)}px`);
    console.log(`groups: ${(await nav.locator("h3").allTextContents()).join(" | ")}`);
    console.log(`rows: ${(await nav.locator("li button[title]").evaluateAll((els) => els.map((e) => e.getAttribute("title")))).join(" | ")}`);
    await page.screenshot({ path: "out/ui/s1-expanded.png" });

    await nav.getByRole("searchbox", { name: /search dreams/i }).fill("abroad");
    await page.waitForTimeout(300);
    console.log(`search "abroad": ${(await nav.locator("li button[title]").allTextContents()).length} row(s)`);
    await nav.getByRole("searchbox", { name: /search dreams/i }).fill("");

    const row = nav.locator("li", { hasText: "Club event funding basics" });
    await row.hover();
    await row.getByRole("button", { name: /rename/i }).click();
    const box = nav.getByRole("textbox", { name: /rename/i });
    await box.fill("My club funding notes");
    await box.press("Enter");
    await page.waitForTimeout(300);
    console.log(`renamed: ${(await nav.locator("li button[title='My club funding notes']").count()) === 1}`);

    const target = nav.locator("li", { hasText: "Study abroad funding at UCR" });
    await target.hover();
    await target.getByRole("button", { name: /delete/i }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: "out/ui/s2-delete-dialog.png" });
    await page.getByRole("button", { name: /^delete$/i }).click();
    await page.waitForTimeout(400);
    console.log(`deleted: ${(await nav.locator("li", { hasText: "Study abroad funding at UCR" }).count()) === 0}`);

    await nav.getByRole("button", { name: /close the sidebar/i }).click();
    await page.waitForTimeout(700);
    console.log(`collapsed width: ${await width(page)}px`);
    await page.screenshot({ path: "out/ui/s3-rail.png" });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector("nav#dream-history[data-hydrated='true']", { timeout: 60_000 });
    const w1 = await width(page);
    await page.waitForTimeout(600);
    console.log(`after reload: ${w1}px right away, ${await width(page)}px settled (remembered: ${w1 < 80})`);
    console.log(`rename survived reload: ${(await page.evaluate(() => localStorage.getItem("rabbit-hole.history") ?? "")).includes("My club funding notes")}`);
    await nav.getByRole("button", { name: /search dreams/i }).click();
    await page.waitForTimeout(700);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
    console.log(`rail search -> expanded ${await width(page)}px, focus on "${focused}"`);

    await nav.locator("li button[title='Funding a UCR club cultural night']").click();
    await page.waitForURL(/\/dream/);
    await page.waitForTimeout(1500);
    const q = await page.locator("aside h1").first().textContent();
    console.log(`reopened on the map: ${q?.includes("cultural night") ?? false}`);
    await page.getByRole("link", { name: /ask another question/i }).first().click();
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await page.waitForTimeout(900);
    console.log(`current dream marked: ${(await nav.locator("li button[aria-current='page']").count()) === 1}`);

    // Auto-save + auto-title with one real plan call (only with --live).
    if (process.argv.includes("--live")) {
      const question = "How can a UC Riverside student find a hackathon team as a beginner?";
      await page.getByRole("textbox", { name: /your dream/i }).fill(question);
      await page.getByRole("button", { name: /fall down the rabbit hole/i }).click();
      await page.waitForURL(/\/dream/, { timeout: 60_000 });
      await page.getByRole("heading", { name: /the plan before the fall/i }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(1200);
      await page.getByRole("link", { name: /ask another question/i }).first().click();
      await page.waitForURL((u) => new URL(u).pathname === "/");
      await page.waitForTimeout(900);
      const top = nav.locator("section").first();
      console.log(`auto-saved: group "${await top.locator("h3").textContent()}", title "${await top.locator("li button[title]").first().getAttribute("title")}"`);
      await page.screenshot({ path: "out/ui/s4-after-new-dream.png" });
    }

    // Phone: overlay.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await phone.newPage();
    mobile.on("pageerror", (e) => errors.push(e.message));
    await mobile.goto(BASE, { waitUntil: "networkidle" });
    await mobile.evaluate((data: Record<string, string>) => {
      for (const [k, v] of Object.entries(data)) localStorage.setItem(k, v);
    }, items);
    await mobile.reload({ waitUntil: "networkidle" });
    await mobile.waitForSelector("nav#dream-history[data-hydrated='true']", { state: "attached", timeout: 60_000 });
    await mobile.waitForTimeout(300);
    console.log(`phone: desktop sidebar hidden ${!(await mobile.locator("nav#dream-history").isVisible())}`);
    await mobile.getByRole("button", { name: /open dream history/i }).click();
    await mobile.waitForTimeout(600);
    await mobile.screenshot({ path: "out/ui/s5-phone-overlay.png" });
    const sheet = mobile.getByRole("dialog");
    console.log(`phone overlay rows: ${await sheet.locator("li button[title]").count()}`);
    await sheet.locator("li button[title]").first().click();
    await mobile.waitForURL(/\/dream/);
    console.log(`phone: opening a dream goes to the map`);
  } finally {
    console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
    await browser.close();
  }
}

main().catch((e) => {
  console.log(String(e).slice(0, 600));
  process.exitCode = 1;
});
