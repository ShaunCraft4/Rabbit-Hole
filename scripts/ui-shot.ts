/**
 * Screenshots the running app in a local Edge/Chrome (headless), for checking UI changes without
 * clicking through by hand. Uses patchright-core, which comes with the Solari SDK; no extra install.
 *
 *   npx tsx scripts/ui-shot.ts [--base http://localhost:3000] [--width 1600] [--height 1000]
 *
 * Flow: entrance -> "Load saved dream" -> /dream (map) -> /report (Golden Key, when the saved run
 * has a report). Writes PNGs to out/ui/ (gitignored).
 */
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const base = arg("base", "http://localhost:3000");
const width = Number(arg("width", "1600"));
const height = Number(arg("height", "1000"));

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

async function main() {
  const executablePath = BROWSERS.find((p) => existsSync(p));
  if (!executablePath) throw new Error("No local Edge or Chrome found.");
  const { chromium } = await import("patchright-core");
  mkdirSync("out/ui", { recursive: true });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    const shot = async (name: string) => {
      const path = resolve("out/ui", `${name}.png`);
      await page.screenshot({ path });
      console.log(`wrote ${path}`);
    };

    await page.goto(base, { waitUntil: "networkidle" });
    await shot("1-entrance");
    await page.getByRole("button", { name: /load saved dream/i }).click();
    await page.waitForURL(/\/dream/, { timeout: 30_000 });
    await page.waitForTimeout(2500);
    await shot("2-dream");

    const ask = page.getByRole("link", { name: /ask another question/i });
    console.log(`dream: "Ask another question" links visible: ${await ask.count()}`);
    const aside = page.locator("aside").first();
    const box = await aside.boundingBox();
    console.log(`dream: White Rabbit panel width ${box ? Math.round(box.width) : "?"} px`);

    // Client-side navigation back to the entrance: Next keeps visited pages alive (hidden) with
    // their state, so the entrance must not come back still faded out from its "fall" animation.
    const entranceVisible = async () => {
      await page.waitForTimeout(800);
      return page.evaluate(() => {
        const h1 = [...document.querySelectorAll("h1")].find((h) => /what dream are you chasing/i.test(h.textContent ?? ""));
        if (!h1) return "no heading";
        const main = h1.closest("main");
        const r = h1.getBoundingClientRect();
        const opacity = main ? getComputedStyle(main).opacity : "?";
        const onScreen = r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
        return onScreen && opacity === "1" ? "visible" : `NOT visible (opacity ${opacity}, top ${Math.round(r.top)})`;
      });
    };
    await ask.first().click();
    await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15_000 });
    console.log(`dream -> "Ask another question": entrance ${await entranceVisible()}`);
    await shot("3-ask-again");
    const box2 = page.getByRole("textbox", { name: /your dream/i });
    console.log(`entrance: question box ${(await box2.inputValue()) === "" ? "is empty" : "still holds the old text"}`);
    await page.getByRole("button", { name: /load saved dream/i }).click();
    await page.waitForURL(/\/dream/, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    console.log(`entrance -> map again: map ${(await page.locator(".react-flow__node").count()) > 0 ? "rendered" : "EMPTY"}`);

    await page.goto(`${base}/report`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    if (page.url().includes("/report")) {
      await shot("4-report");
      console.log(`report: "Ask another question" links visible: ${await page.getByRole("link", { name: /ask another question/i }).count()}`);
      await page.getByRole("link", { name: /ask another question/i }).first().click();
      await page.waitForURL((u) => new URL(u).pathname === "/", { timeout: 15_000 });
      console.log(`report -> "Ask another question": entrance ${await entranceVisible()}`);
      await shot("5-ask-again-from-report");
    } else {
      console.log("report: the saved run has no report; skipped");
    }
    console.log(errors.length ? `console errors:\n  ${errors.slice(0, 8).join("\n  ")}` : "no console errors");
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  console.log(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
