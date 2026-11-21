/**
 * Live Keenable check: search, dedupe + rank, retrieve the top 3, and sanity-check quote
 * verification against the retrieved text.
 *
 *   npx tsx scripts/test-search.ts "your query" [--realtime] [--show]
 *
 * Uses KEENABLE_API_KEY from .env.local when present, otherwise the keyless /public endpoints.
 */
import { BUDGET } from "@/lib/research/budget";
import { classifyDomain, dedupeHits, rankHits } from "@/lib/research/dedupe";
import { hasKeenableKey, KeenableError } from "@/lib/research/keenable";
import { retrieveSource } from "@/lib/research/retrieve";
import { searchWeb } from "@/lib/research/search";
import { PASSAGE_SEPARATOR, verifyExcerpt } from "@/lib/research/verify";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local: keyless mode
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

/** Picks a real sentence from the text and returns it with messy whitespace and curly quotes. */
function mangledSentenceFrom(text: string): { original: string; mangled: string } | undefined {
  const sentences = text
    .split(PASSAGE_SEPARATOR)
    .flatMap((part) => part.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 60 && s.length <= 220 && !s.includes("[…]"));
  const original = sentences[Math.floor(sentences.length / 2)];
  if (!original) return undefined;
  const mangled = original
    .replace(/ /g, (m, i: number) => (i % 3 === 0 ? "  \n " : m))
    .replace(/'/g, "’")
    .toUpperCase();
  return { original, mangled };
}

async function main() {
  const args = process.argv.slice(2);
  const show = args.includes("--show");
  const mode = args.includes("--realtime") ? ("realtime" as const) : undefined;
  const query = args.filter((a) => !a.startsWith("--")).join(" ").trim();
  if (!query) {
    console.error('Usage: npx tsx scripts/test-search.ts "query" [--realtime] [--show]');
    process.exit(1);
  }

  console.log(`Keenable: ${hasKeenableKey() ? "API key" : "keyless (/public endpoints)"}${mode ? `, mode=${mode}` : ""}`);
  console.log(`Query: ${query}\n`);

  const t0 = Date.now();
  const hits = await searchWeb(query, { maxResults: BUDGET.resultsPerQuery, mode });
  const searchMs = Date.now() - t0;
  const ranked = rankHits(dedupeHits(hits));
  console.log(`Search: ${hits.length} hits in ${searchMs} ms (${ranked.length} after dedupe). Ranked:`);
  ranked.forEach((h, i) => {
    const { kind } = classifyDomain(h.url);
    console.log(
      `  ${i + 1}. [${pad(kind, 12)}] ${pad(h.domain, 34)} ${pad(h.title, 48)} text=${h.text?.length ?? 0}${h.publishedAt ? ` published=${h.publishedAt.slice(0, 10)}` : ""}`,
    );
  });
  if (ranked.length === 0) {
    console.log("\nNo results.");
    return;
  }

  const top = ranked.slice(0, BUDGET.sourcesPerBranch);
  const t1 = Date.now();
  const retrieved = await Promise.all(
    top.map(async (hit) => {
      const started = Date.now();
      const r = await retrieveSource(hit, { focus: query });
      return { ...r, ms: Date.now() - started };
    }),
  );
  console.log(`\nRetrieved top ${top.length} in ${Date.now() - t1} ms (parallel):`);
  console.log(`  ${pad("title", 48)} ${pad("domain", 34)} ${pad("status", 13)} ${"text".padStart(5)}  ms`);
  for (const r of retrieved) {
    console.log(
      `  ${pad(r.source.title, 48)} ${pad(r.source.domain, 34)} ${pad(r.source.retrievalStatus, 13)} ${String(r.text.length).padStart(5)}  ${r.ms}${r.note ? `   (${r.note})` : ""}`,
    );
  }

  console.log("\nQuote verification against the retrieved text:");
  for (const r of retrieved) {
    if (!r.text) {
      console.log(`  ${pad(r.source.domain, 34)} (no text)`);
      continue;
    }
    const sample = mangledSentenceFrom(r.text);
    const real = sample ? verifyExcerpt(sample.mangled, r.text) : undefined;
    const fake = verifyExcerpt("Applications are always approved within 24 hours of submission.", r.text);
    console.log(
      `  ${pad(r.source.domain, 34)} real sentence (case/space/quote-mangled): ${real === undefined ? "n/a" : real ? "verified" : "NOT VERIFIED"} | invented sentence: ${fake ? "VERIFIED (bad)" : "rejected"}`,
    );
  }

  if (show) {
    for (const r of retrieved) {
      console.log(`\n----- ${r.source.title} (${r.source.retrievalStatus}) -----\n${r.text.slice(0, 900)}${r.text.length > 900 ? "\n…" : ""}`);
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof KeenableError) {
    console.error(`Keenable error: ${err.code}${err.status ? ` (HTTP ${err.status})` : ""}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
