/**
 * Exports a saved harness run as the demo investigation fixture.
 *
 *   npx tsx scripts/export-demo.ts out/<slug>.json [src/fixtures/demo-investigation.json]
 *
 * Parses the run with InvestigationSchema (which drops the harness's `_run` block and would reject
 * page text), checks every cross-reference, refuses anything that looks like a secret, and writes
 * pretty JSON. Person B copies the result to public/demo-investigation.json (B owns public/).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { containsSecret } from "@/lib/ai/redact";
import { InvestigationSchema, investigationIntegrityIssues } from "@/lib/contracts";
import { buildSkillTree } from "@/lib/skilltree";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const [input, output = "src/fixtures/demo-investigation.json"] = process.argv.slice(2);
if (!input) {
  console.log("usage: npx tsx scripts/export-demo.ts out/<slug>.json [output.json]");
  process.exitCode = 1;
} else {
  const investigation = InvestigationSchema.parse(JSON.parse(readFileSync(input, "utf8")));
  const issues = investigationIntegrityIssues(investigation);
  const json = `${JSON.stringify(investigation, null, 2)}\n`;
  if (issues.length) {
    console.log(`Not exported: ${issues.length} broken reference(s), e.g. ${issues[0]}`);
    process.exitCode = 1;
  } else if (containsSecret(json) || /"text"\s*:/.test(JSON.stringify(investigation.sources))) {
    console.log("Not exported: the file contains a secret or page text.");
    process.exitCode = 1;
  } else {
    writeFileSync(output, json);
    const tree = buildSkillTree(investigation);
    const labelled = investigation.claims.filter((c) => c.label).length;
    console.log(
      `Wrote ${output}: "${investigation.question}"\n` +
        `  ${investigation.branches.length} branches, ${investigation.claims.length} claims (${labelled} with labels), ` +
        `${investigation.gaps.length} gaps, ${investigation.connections.length} connections, report: ${investigation.report ? "yes" : "no"}\n` +
        `  skill tree: ${tree.nodes.length} nodes, ${tree.trails.length} trails, ${Math.round(tree.bounds.width)}x${Math.round(tree.bounds.height)} px`,
    );
  }
}
