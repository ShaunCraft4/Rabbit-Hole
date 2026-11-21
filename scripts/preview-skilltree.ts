/**
 * Renders a saved investigation as a skill tree to a standalone HTML/SVG file (out/ is gitignored),
 * so the layout can be checked by eye without the app. Optionally screenshots it with a local
 * Edge or Chrome in headless mode.
 *
 *   npx tsx scripts/preview-skilltree.ts out/<slug>.json [--png] [--no-gaps]
 *
 * The colors here are placeholders for the preview only; the app's own styling lives in the UI.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { InvestigationSchema } from "@/lib/contracts";
import { buildSkillTree, type RegionColor, type SkillNode } from "@/lib/skilltree";

const PREVIEW_COLORS: Record<RegionColor, string> = {
  rose: "#e8879c",
  sky: "#7fb2f0",
  marigold: "#f2c14e",
  mint: "#79d2a6",
  violet: "#a98be8",
  coral: "#f08a6c",
  teal: "#5cc6c0",
  lilac: "#c9a3e6",
  peach: "#f4b183",
  lime: "#b5d96b",
};
const GOLD = "#d6b76b";
const PAPER = "#e5e1f0";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colorOf = (c: RegionColor | null) => (c ? PREVIEW_COLORS[c] : PAPER);

function arrowHead(x: number, y: number, angle: number, color: string, size = 6): string {
  return `<path d="M0 0 L${-size} ${-size * 0.55} L${-size} ${size * 0.55} Z" fill="${color}" transform="translate(${x} ${y}) rotate(${angle})"/>`;
}

function nodeSvg(n: SkillNode): string {
  const color = colorOf(n.color);
  const parts: string[] = [];
  if (n.kind === "start") {
    parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="#9be3b5" fill-opacity="0.85" stroke="${PAPER}" stroke-width="2"/>`);
  } else if (n.kind === "door") {
    parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${color}" fill-opacity="0.55" stroke="${color}" stroke-width="2.5"/>`);
  } else if (n.kind === "finding") {
    const stroke = n.evidenceStatus === "corroborated" || n.keyDiscovery ? GOLD : color;
    const dash = n.evidenceStatus === "conflicting" ? ` stroke-dasharray="4 3"` : "";
    const fade = n.evidenceStatus === "snippet_only" || n.evidenceStatus === "outdated" ? 0.25 : 0.5;
    parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${color}" fill-opacity="${fade}" stroke="${stroke}" stroke-width="${n.keyDiscovery ? 2.5 : 1.5}"${dash}/>`);
  } else {
    const open = n.status === "open";
    parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="#111323" stroke="${color}" stroke-width="1.5" stroke-dasharray="${open ? "3 3" : "0"}"/>`);
    parts.push(`<text x="${n.x}" y="${n.y + 4}" font-size="11" text-anchor="middle" fill="${color}">${open ? "?" : "✓"}</text>`);
  }
  const lh = n.kind === "door" ? 15 : 13;
  const size = n.kind === "door" ? 12.5 : n.kind === "start" ? 12 : 11;
  const weight = n.kind === "door" || n.kind === "start" ? 600 : 400;
  const fill = n.kind === "start" ? "#111323" : PAPER;
  n.labelLines.forEach((line, i) => {
    const y = n.labelBox.y + lh * (i + 0.78);
    parts.push(`<text x="${n.labelBox.x + n.labelBox.width / 2}" y="${y}" font-size="${size}" font-weight="${weight}" text-anchor="middle" fill="${fill}">${esc(line)}</text>`);
  });
  return parts.join("");
}

function render(file: string, showGaps: boolean): string {
  const investigation = InvestigationSchema.parse(JSON.parse(readFileSync(file, "utf8")));
  const t0 = performance.now();
  const tree = buildSkillTree(investigation, { showGaps });
  const ms = performance.now() - t0;
  const b = tree.bounds;
  const svg: string[] = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.width} ${b.height}" width="100%" height="100%" font-family="Inter, Segoe UI, sans-serif">`);
  svg.push(`<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" fill="#111323"/>`);
  for (const r of tree.regions) {
    const c = PREVIEW_COLORS[r.color];
    svg.push(`<path d="${r.hull}" fill="${c}" fill-opacity="0.07" stroke="${c}" stroke-opacity="0.25" stroke-width="1.2"/>`);
    r.titleLines.forEach((line, i) => {
      const y = r.labelAt.y + (i - (r.titleLines.length - 1) / 2) * 26 + 7;
      svg.push(`<text x="${r.labelAt.x}" y="${y}" font-size="20" font-weight="700" text-anchor="middle" fill="${c}" font-family="Georgia, serif">${esc(line)}</text>`);
    });
  }
  for (const t of tree.trails) {
    if (t.kind === "path") {
      const c = colorOf(t.color);
      svg.push(`<path d="${t.d}" fill="none" stroke="${c}" stroke-opacity="0.8" stroke-width="1.4"${t.locked ? ` stroke-dasharray="5 4"` : ""}/>`);
      for (const w of t.waypoints) svg.push(`<circle cx="${w.x}" cy="${w.y}" r="2.4" fill="#111323" stroke="${c}" stroke-width="1"/>`);
      svg.push(arrowHead(t.end.x, t.end.y, t.end.angle, c));
      for (const a of t.arrows) svg.push(arrowHead(a.x, a.y, a.angle, c, 5));
    } else if (t.kind === "link") {
      svg.push(`<path d="${t.d}" fill="none" stroke="${GOLD}" stroke-width="1.8"${t.accepted ? "" : ` stroke-dasharray="6 5"`}/>`);
      svg.push(arrowHead(t.end.x, t.end.y, t.end.angle, GOLD, 8));
      svg.push(`<text x="${t.labelAt.x}" y="${t.labelAt.y}" font-size="10" text-anchor="middle" fill="${GOLD}">${t.relationship.replace("_", " ")}</text>`);
    }
  }
  for (const n of tree.nodes) svg.push(nodeSvg(n));
  svg.push(`</svg>`);

  const counts = tree.nodes.reduce<Record<string, number>>((acc, n) => ((acc[n.kind] = (acc[n.kind] ?? 0) + 1), acc), {});
  console.log(
    `${basename(file)}: ${tree.nodes.length} nodes (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}), ` +
      `${tree.trails.length} trails, ${Math.round(b.width)}x${Math.round(b.height)} px, built in ${ms.toFixed(1)} ms`,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><title>Skill tree preview</title><style>html,body{margin:0;height:100%;background:#111323}</style></head><body>${svg.join("\n")}</body></html>`;
}

function findBrowser(): string | undefined {
  return [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => existsSync(p));
}

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.log("usage: npx tsx scripts/preview-skilltree.ts out/<slug>.json [--png] [--no-gaps]");
  process.exitCode = 1;
}
mkdirSync("out/preview", { recursive: true });
for (const file of files) {
  const html = render(file, !args.includes("--no-gaps"));
  const name = basename(file).replace(/\.json$/, "");
  const htmlPath = resolve("out/preview", `${name}.html`);
  writeFileSync(htmlPath, html);
  console.log(`  wrote ${htmlPath}`);
  if (args.includes("--png")) {
    const browser = findBrowser();
    if (!browser) {
      console.log("  no local Edge/Chrome found; skipping the screenshot");
      continue;
    }
    const pngPath = resolve("out/preview", `${name}.png`);
    execFileSync(browser, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--screenshot=${pngPath}`, "--window-size=1500,1500", pathToFileURL(htmlPath).href], { stdio: "ignore", timeout: 60_000 });
    console.log(`  wrote ${pngPath}`);
  }
}
