/**
 * Validates src/fixtures/mock-investigation.json against the zod contracts and the
 * shape the team agreed on.  Run: npx tsx scripts/validate-fixture.ts
 */
import { InvestigationSchema, investigationIntegrityIssues } from "@/lib/contracts";

import raw from "../src/fixtures/mock-investigation.json";

function main() {
  const failures: string[] = [];
  const check = (ok: boolean, label: string) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  const parsed = InvestigationSchema.safeParse(raw);
  check(parsed.success, "validates against InvestigationSchema");
  if (!parsed.success) {
    console.error(parsed.error.issues);
    process.exit(1);
  }
  const inv = parsed.data;

  const issues = investigationIntegrityIssues(inv);
  check(issues.length === 0, `all cross-references resolve${issues.length ? `: ${issues.join("; ")}` : ""}`);

  check((raw as { _mock?: unknown })._mock === true, `"_mock": true at the top level`);
  check(inv.branches.length === 4, "4 branches");
  check(inv.claims.length >= 10 && inv.claims.length <= 14, `about 12 claims (${inv.claims.length})`);
  check(inv.claims.every((c) => c.verified), "every claim is verified");
  check(inv.sources.length >= 5 && inv.sources.length <= 7, `about 6 sources (${inv.sources.length})`);
  check(new Set(inv.sources.map((s) => s.domain)).size === inv.sources.length, "every source has a different domain");
  check(new Set(inv.sources.map((s) => s.retrievalStatus)).size === 3, "mixed retrievalStatus (full_text, snippet_only, failed)");
  check(inv.sources.filter((s) => s.retrievedVia === "browser").length === 1, `exactly one source with retrievedVia "browser"`);
  check(inv.sources.every((s) => !("text" in s)), "no source carries text");
  check(
    ["missing", "conflict", "outdated"].every((k) => inv.gaps.some((g) => g.kind === k)) && inv.gaps.length === 3,
    "3 gaps: missing, conflict, outdated",
  );
  check(
    inv.connections.length === 2 &&
      inv.connections.filter((c) => c.accepted === true).length === 1,
    "2 connections, exactly one accepted",
  );
  check(inv.rejectedClaims === 3, "rejectedClaims: 3");
  check(
    !!inv.report &&
      inv.report.keyDiscoveries.length > 0 &&
      inv.report.planChangingConnections.length > 0 &&
      inv.report.uncertainties.length > 0 &&
      inv.report.nextSteps.length > 0,
    "complete report",
  );
  const statuses = new Set(inv.claims.map((c) => c.evidenceStatus));
  check(statuses.size === 5, `claims use every evidence status (${[...statuses].join(", ")})`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nFixture OK.");
}

main();
