/**
 * Mock data for building and testing against the frozen contracts.
 * Owned by Engine. Read-only for everyone else: import it, never edit it.
 */
import { InvestigationSchema, investigationIntegrityIssues } from "@/lib/contracts";
import type { Investigation } from "@/lib/types";

import demoRaw from "./demo-investigation.json";
import raw from "./mock-investigation.json";

function parseInvestigation(data: unknown, file: string): Investigation {
  // Throws at import time if a fixture ever drifts from the contracts.
  const inv = InvestigationSchema.parse(data);
  const issues = investigationIntegrityIssues(inv);
  if (issues.length > 0) {
    throw new Error(`${file} has broken references: ${issues.join("; ")}`);
  }
  return inv;
}

/** A complete, fictional Investigation ("_mock" stripped), validated against InvestigationSchema. */
export const mockInvestigation: Investigation = parseInvestigation(raw, "mock-investigation.json");

/**
 * A real saved run (the UCR club cultural-night question) with model-written node labels: the
 * demo fallback. Copy the JSON file to public/demo-investigation.json; re-export another run with
 * `npx tsx scripts/export-demo.ts out/<slug>.json`.
 */
export const demoInvestigation: Investigation = parseInvestigation(demoRaw, "demo-investigation.json");
