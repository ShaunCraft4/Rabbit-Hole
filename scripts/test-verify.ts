/**
 * Offline checks for the research utilities (no network).
 *   npx tsx scripts/test-verify.ts
 */
import { classifyDomain, dedupeHits, normalizeUrl, rankHits, sourceIdFromUrl } from "@/lib/research/dedupe";
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

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
