/**
 * Offline checks for the research utilities (no network).
 *   npx tsx scripts/test-verify.ts
 */
import { extractOutputSchema } from "@/lib/ai/schemas";
import { LIMITS } from "@/lib/contracts";
import { classifyDomain, dedupeHits, normalizeUrl, rankHits, sourceIdFromUrl } from "@/lib/research/dedupe";
import { buildVerifiedClaims, claimIdPrefix, selectCandidates, uniqueQueries } from "@/lib/research/pipeline";
import type { SearchHit } from "@/lib/research/search";
import { cleanMarkdown, selectPassages, selectStitchedPassages } from "@/lib/research/text";
import { PASSAGE_SEPARATOR, verifyExcerpt } from "@/lib/research/verify";

let failed = 0;
function expect(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      got:      ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`}`);
}

const page =
  "Student organizations may request up to $1,500 per event.\n\n" +
  "The fund’s “priority” deadline is October 10, 2026 for the Fall–Winter cycle.\n" +
  "Food is allowed only when incidental to the program.";

console.log("verifyExcerpt");
expect("exact match", verifyExcerpt("Student organizations may request up to $1,500 per event.", page), true);
expect("smart quotes on the page, straight in the excerpt", verifyExcerpt(`The fund's "priority" deadline is October 10, 2026`, page), true);
expect("straight quotes on the page, smart in the excerpt", verifyExcerpt("may request up to $1,500 per event", "They may request up to $1,500 per event"), true);
expect("extra spaces, tabs and newlines", verifyExcerpt("Student   organizations\n may\trequest up to   $1,500", page), true);
expect("different case", verifyExcerpt("STUDENT ORGANIZATIONS MAY REQUEST UP TO $1,500", page), true);
expect("non-breaking space on the page", verifyExcerpt("Food is allowed only when incidental", page), true);
expect("en dash on the page, hyphen in the excerpt", verifyExcerpt("for the Fall-Winter cycle", page), true);
expect("changed number is rejected", verifyExcerpt("Student organizations may request up to $2,500 per event.", page), false);
expect("paraphrase is rejected", verifyExcerpt("Organizations can ask for as much as $1,500 per event.", page), false);
expect("empty excerpt is rejected", verifyExcerpt("", page), false);
expect("too-short excerpt is rejected", verifyExcerpt("per event", page), false);

const stitched = `The application must include an agenda.${PASSAGE_SEPARATOR}Late requests will not be considered.`;
expect("excerpt spanning a passage gap is rejected", verifyExcerpt("must include an agenda. Late requests will not be considered", stitched), false);
expect("excerpt that includes the gap marker is rejected", verifyExcerpt("include an agenda. […] Late requests", stitched), false);
expect("each side of a gap still verifies", verifyExcerpt("Late requests will not be considered", stitched), true);

console.log("\ncleanMarkdown");
const md = "## Grant Application\n\nSubmit an **agenda** and a [detailed budget](https://x.edu/b?a=1).\n\n| Step | Who |\n|---|---|\n| Approval | Senate |\n\n* First item\n- Second _item_";
const clean = cleanMarkdown(md);
expect("flattens headings, bold, links, tables and bullets", clean, "Grant Application\n\nSubmit an agenda and a detailed budget.\n\nStep | Who\nApproval | Senate\n\n- First item\n- Second item");
expect("model quote of flattened text verifies", verifyExcerpt("Submit an agenda and a detailed budget.", clean), true);

console.log("\nselectPassages / selectStitchedPassages");
const longPage = Array.from({ length: 30 }, (_, i) =>
  i === 17 ? "Applications for the student event grant are due 21 days before the event." : `Filler paragraph number ${i} about campus life and unrelated topics in general.`,
).join("\n\n");
const picked = selectPassages(longPage, "student event grant deadline", 400);
expect("keeps the most relevant passage", picked.includes("due 21 days before the event"), true);
expect("stays within the budget", picked.length <= 400, true);
expect("marks gaps", picked.includes("[…]"), true);
expect("short text is returned unchanged", selectPassages("Short page.", "x", 6000), "Short page.");
const stitchedSnippet = selectStitchedPassages("Para one is here.\n\nPara two is here.", "para", 6000);
expect("stitched snippet marks every boundary", stitchedSnippet, `Para one is here.${PASSAGE_SEPARATOR}Para two is here.`);

console.log("\nnormalizeUrl / sourceIdFromUrl / dedupeHits");
expect(
  "strips tracking params, fragment, trailing slash; lowercases host; sorts query",
  normalizeUrl("https://WWW.Example.EDU/Funding/?utm_source=x&b=2&fbclid=abc&a=1#apply"),
  "https://www.example.edu/Funding?a=1&b=2",
);
expect("root URL has no trailing slash", normalizeUrl("https://example.edu/"), "https://example.edu");
expect("non-http URL is rejected", normalizeUrl("javascript:alert(1)"), null);
expect("garbage is rejected", normalizeUrl("not a url"), null);
expect(
  "same page, same id (www, http, slash, tracking)",
  sourceIdFromUrl("http://www.example.edu/funding/?utm_medium=email"),
  sourceIdFromUrl("https://example.edu/funding"),
);
expect("ids are contract-safe", /^src_[0-9a-f]{10}$/.test(sourceIdFromUrl("https://example.edu/x")), true);
expect(
  "dedupeHits keeps the first of each page",
  dedupeHits([{ url: "https://a.edu/x/" }, { url: "https://www.a.edu/x" }, { url: "https://a.edu/y" }, { url: "ftp://a.edu" }]).map((h) => h.url),
  ["https://a.edu/x/", "https://a.edu/y"],
);

console.log("\nclassifyDomain / rankHits");
expect("ucr.edu is official", classifyDomain("asucr.ucr.edu").kind, "official");
expect("ox.ac.uk is official", classifyDomain("www.ox.ac.uk").kind, "official");
expect("reddit is a forum", classifyDomain("old.reddit.com").kind, "forum");
expect(
  "official first, forums last, search order within a class",
  rankHits([
    { url: "https://www.reddit.com/r/ucr/comments/1", rank: 0 },
    { url: "https://blog.example.com/post", rank: 1 },
    { url: "https://example.org/guide", rank: 2 },
    { url: "https://asucr.ucr.edu/budget", rank: 3 },
    { url: "https://news.example.com/a", rank: 4 },
    { url: "https://www.ucr.edu/funding", rank: 0 },
  ]).map((h) => new URL(h.url).hostname),
  ["www.ucr.edu", "asucr.ucr.edu", "example.org", "news.example.com", "blog.example.com", "www.reddit.com"],
);

console.log("\nextractOutputSchema (model output for EXTRACT)");
const extracted = extractOutputSchema.safeParse({
  claims: [
    { sourceId: "src_a", excerpt: '"Student organizations may request up to $1,500 per event."', text: "Up to $1,500 per event.", claimType: "AMOUNT", dateMentioned: "N/A" },
    { sourceId: "src_a", excerpt: "...the fund’s “priority” deadline is October 10, 2026", text: "Priority deadline is October 10, 2026.", claimType: "timeline", dateMentioned: "October 10, 2026" },
    { sourceId: "src_a", text: "No excerpt here." },
  ],
});
expect("valid reply parses", extracted.success, true);
if (extracted.success) {
  const [a, b] = extracted.data.claims;
  expect("wrapping quotes are removed from an excerpt", a.excerpt, "Student organizations may request up to $1,500 per event.");
  expect("claimType is lowercased", a.claimType, "amount");
  expect('"N/A" dateMentioned is dropped', "dateMentioned" in a, false);
  expect("a leading ellipsis is removed", b.excerpt, "the fund’s “priority” deadline is October 10, 2026");
  expect("unknown claimType becomes other", b.claimType, "other");
  expect("item without an excerpt is counted as malformed", extracted.data.malformed, 1);
}
expect("a bare array is accepted as the claims list", extractOutputSchema.safeParse([]).success, true);
expect("a reply without a claims array fails (triggers the repair retry)", extractOutputSchema.safeParse({ facts: [] }).success, false);

console.log("\nbuildVerifiedClaims (code-only quote verification)");
const verifySources = new Map([
  ["src_a", { text: page, retrievalStatus: "full_text" as const }],
  ["src_b", { text: stitched, retrievalStatus: "snippet_only" as const }],
]);
const candidate = (sourceId: string, excerpt: string, text: string) => ({ sourceId, excerpt, text, claimType: "other" as const });
const built = buildVerifiedClaims(
  [
    candidate("src_a", "Student organizations may request up to $1,500 per event.", "Organizations may request up to $1,500 per event."),
    candidate("src_zzz", "Student organizations may request up to $1,500 per event.", "Cites a source that was never supplied."),
    candidate("src_b", "must include an agenda. Late requests will not be considered", "Spans a passage gap."),
    candidate("src_b", "Late requests will not be considered", "Late requests will not be considered."),
    candidate("src_a", "Food is allowed only when incidental to the program.", "organizations may request up to $1,500 per event."),
    candidate("src_a", `THE FUND'S "PRIORITY" DEADLINE IS OCTOBER 10, 2026`, "The priority deadline is October 10, 2026."),
    candidate("src_a", "Student organizations may request up to $2,500 per event.", "Altered number."),
  ],
  { branchId: "funding", idPrefix: "funding", sources: verifySources, maxPerSource: 4, maxTotal: 8 },
);
expect("kept claims (ids in order)", built.claims.map((c) => c.id), ["funding-c1", "funding-c2", "funding-c3"]);
expect(
  "rejections: unknown source, gap-spanning quote, altered number",
  built.rejections.map((r) => r.reason),
  ["unknown_source", "quote_not_found", "quote_not_found"],
);
expect("a repeated claim text is a duplicate, not a rejection", built.duplicates, 1);
expect("snippet-only source gives evidenceStatus snippet_only", built.claims[1].evidenceStatus, "snippet_only");
expect("full-text source gives single_source", built.claims[0].evidenceStatus, "single_source");
expect("every kept claim is verified and on the branch", built.claims.every((c) => c.verified && c.branchId === "funding"), true);
const capped = buildVerifiedClaims(
  [
    candidate("src_a", "Student organizations may request up to $1,500 per event.", "One."),
    candidate("src_a", "Food is allowed only when incidental to the program.", "Two."),
    candidate("src_b", "Late requests will not be considered", "Three."),
  ],
  { branchId: "b", idPrefix: "b", sources: verifySources, maxPerSource: 1, maxTotal: 8 },
);
expect("per-source cap keeps the first verified claim per source", capped.claims.map((c) => c.text), ["One.", "Three."]);
expect("over-cap claims are not counted as rejected", [capped.overCap, capped.rejections.length], [1, 0]);

console.log("\nclaim ids and selection");
expect("normal run: prefix is the branch id", claimIdPrefix("funding-sources", false), "funding-sources");
const tagA = claimIdPrefix("funding-sources", true);
const tagB = claimIdPrefix("funding-sources", true);
expect("gap follow-up: prefix gets a random tag", /^funding-sources-g[a-z0-9]{5}$/.test(tagA), true);
expect("gap follow-up: two runs get different prefixes", tagA !== tagB, true);
const longPrefix = claimIdPrefix("x".repeat(LIMITS.idChars), true);
expect("long branch ids still fit the 80-char id limit", `${longPrefix}-c${LIMITS.maxClaimsPerResearch}`.length <= LIMITS.idChars, true);
expect("uniqueQueries drops case-insensitive repeats", uniqueQueries(["UCR grants", " ucr  GRANTS ", "ASUCR funding"]), ["UCR grants", "ASUCR funding"]);

const hit = (url: string, rank: number, query: string): SearchHit => ({ url, rank, query, title: url, snippet: "", domain: new URL(url).hostname.replace(/^www\./, "") });
const selection = selectCandidates(
  [
    [hit("https://news.example.com/a", 0, "q1"), hit("https://www.ucr.edu/funding", 1, "q1"), hit("https://seen.example.org/x", 2, "q1")],
    [hit("https://ucr.edu/funding/", 3, "q2"), hit("https://www.reddit.com/r/ucr/comments/1", 0, "q2")],
  ],
  new Set([sourceIdFromUrl("https://seen.example.org/x")]),
);
expect(
  "selection: deduped, excluded, official first, forum last",
  selection.candidates.map((h) => h.url),
  ["https://www.ucr.edu/funding", "https://news.example.com/a", "https://www.reddit.com/r/ucr/comments/1"],
);
expect("selection counts", [selection.unique, selection.excluded], [4, 1]);

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
