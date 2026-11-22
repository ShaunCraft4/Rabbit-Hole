/**
 * Offline checks for the Golden Key's citation formats (src/lib/client/citations.ts):
 * exact MLA 9, APA 7, Chicago 17, Harvard and IEEE strings for dated and undated web pages,
 * site names split from titles, list order, Harvard's same-year letters, and safe HTML.
 *
 *   npx tsx scripts/test-citations.ts
 */
import { formatCitations, parseDate, splitTitle, type CitationSource } from "@/lib/client/citations";

let failures = 0;
let passes = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passes++;
  else {
    failures++;
    console.log(`FAIL  ${label}\n      got:      ${JSON.stringify(actual)}\n      expected: ${JSON.stringify(expected)}`);
  }
}

const accessed = new Date(2026, 10, 21); // 21 November 2026
const dated: CitationSource = {
  number: 1,
  title: "Student Organization Funding | ASUCR",
  url: "https://asucr.ucr.edu/funding",
  domain: "asucr.ucr.edu",
  publishedAt: "2026-10-27T18:43:30Z",
};
const undated: CitationSource = {
  number: 2,
  title: "Food Permit Process",
  url: "https://campusreturn.ucr.edu/food-permit",
  domain: "www.campusreturn.ucr.edu",
};
const one = (style: Parameters<typeof formatCitations>[0], source: CitationSource) => formatCitations(style, [source], accessed)[0];

// Parsing.
eq(parseDate("2026-10-27T18:43:30Z"), { year: 2026, month: 10, day: 27 }, "timestamp -> day");
eq(parseDate("2026-02-30"), null, "impossible date rejected");
eq(parseDate("2026-04"), { year: 2026, month: 4 }, "year-month");
eq(parseDate("October 5, 2025"), { year: 2025, month: 10, day: 5 }, "US written date");
eq(parseDate("5 Oct 2025"), { year: 2025, month: 10, day: 5 }, "UK written date");
eq(parseDate("Spring 2026"), null, "a season is not a date");
eq(splitTitle("Student Organization Funding | ASUCR"), { title: "Student Organization Funding", site: "ASUCR" }, "'Title | Site' splits");
eq(splitTitle("Step 1 - apply early"), { title: "Step 1 - apply early", site: null }, "a dash inside a title stays");
eq(splitTitle("Financial Aid - UCR Education Abroad"), { title: "Financial Aid", site: "UCR Education Abroad" }, "'Title - Site' splits");

// MLA 9.
eq(one("mla", dated).text, "“Student Organization Funding.” ASUCR, 27 Oct. 2026, asucr.ucr.edu/funding.", "MLA dated");
eq(one("mla", dated).html, "“Student Organization Funding.” <i>ASUCR</i>, 27 Oct. 2026, asucr.ucr.edu/funding.", "MLA italicizes the website");
eq(
  one("mla", undated).text,
  "“Food Permit Process.” campusreturn.ucr.edu, campusreturn.ucr.edu/food-permit. Accessed 21 Nov. 2026.",
  "MLA undated adds the access date (domain without www. as the site)",
);
eq(one("mla", { ...dated, publishedAt: "2026-06-03" }).text.includes("3 June 2026"), true, "MLA spells out June and July");
eq(one("mla", { ...dated, publishedAt: "2026-09-03" }).text.includes("3 Sept. 2026"), true, "MLA abbreviates September as Sept.");

// APA 7.
eq(one("apa", dated).text, "Student Organization Funding. (2026, October 27). ASUCR. https://asucr.ucr.edu/funding", "APA dated");
eq(one("apa", dated).html, "<i>Student Organization Funding</i>. (2026, October 27). ASUCR. https://asucr.ucr.edu/funding", "APA italicizes the title, not the period");
eq(
  one("apa", undated).text,
  "Food Permit Process. (n.d.). campusreturn.ucr.edu. Retrieved November 21, 2026, from https://campusreturn.ucr.edu/food-permit",
  "APA undated: n.d. and a retrieval date",
);
eq(one("apa", { ...undated, title: "Do I need a permit?" }).text.startsWith("Do I need a permit? (n.d.)."), true, "APA adds no period after a question mark");

// Chicago 17 bibliography.
eq(one("chicago", dated).text, "“Student Organization Funding.” ASUCR. October 27, 2026. https://asucr.ucr.edu/funding.", "Chicago dated");
eq(
  one("chicago", undated).text,
  "“Food Permit Process.” campusreturn.ucr.edu. Accessed November 21, 2026. https://campusreturn.ucr.edu/food-permit.",
  "Chicago undated: Accessed",
);

// Harvard (Cite Them Right).
eq(
  one("harvard", dated).text,
  "ASUCR (2026) Student Organization Funding. Available at: https://asucr.ucr.edu/funding (Accessed: 21 November 2026).",
  "Harvard dated",
);
eq(one("harvard", dated).html.includes("<i>Student Organization Funding</i>."), true, "Harvard italicizes the title");
eq(one("harvard", undated).text.startsWith("campusreturn.ucr.edu (no date) "), true, "Harvard undated: (no date)");
const twins = formatCitations(
  "harvard",
  [
    { ...dated, number: 1, title: "Organization Grants | ASUCR" },
    { ...dated, number: 2, title: "Budget Requests | ASUCR" },
  ],
  accessed,
).map((c) => c.text.slice(0, 13));
eq(twins, ["ASUCR (2026a)", "ASUCR (2026b)"], "Harvard: same site and year get a, b in title order");

// IEEE.
eq(
  one("ieee", dated).text,
  "[1] “Student Organization Funding,” ASUCR, Oct. 27, 2026. Accessed: Nov. 21, 2026. [Online]. Available: https://asucr.ucr.edu/funding",
  "IEEE dated",
);
eq(
  one("ieee", undated).text,
  "[2] “Food Permit Process,” campusreturn.ucr.edu. Accessed: Nov. 21, 2026. [Online]. Available: https://campusreturn.ucr.edu/food-permit",
  "IEEE undated",
);

// Order.
const list = [
  { ...undated, number: 1, title: "The Zebra Fund" },
  { ...undated, number: 2, title: "Apple Grants" },
  { ...undated, number: 3, title: "A Mango Scholarship" },
];
eq(formatCitations("mla", list, accessed).map((c) => c.number), [2, 3, 1], "MLA sorts by title, ignoring A/An/The");
eq(formatCitations("ieee", list, accessed).map((c) => c.number), [1, 2, 3], "IEEE keeps the report's numbering");

// Safety and missing URLs.
const hostile = formatCitations("mla", [{ ...undated, title: "<script>alert(1)</script> & co" }], accessed)[0];
eq(hostile.html.includes("<script>"), false, "titles are escaped in HTML");
eq(formatCitations("apa", [{ ...dated, url: null }], accessed)[0].text, "Student Organization Funding. (2026, October 27). ASUCR.", "no URL: nothing dangling");

console.log(failures ? `\n${failures} check(s) failed, ${passes} passed.` : `\nAll ${passes} checks passed.`);
process.exitCode = failures ? 1 : 0;
