/**
 * Mock data for building and testing against the frozen contracts.
 * Owned by Engine. Read-only for everyone else: import it, never edit it.
 */
import { InvestigationSchema, investigationIntegrityIssues } from "@/lib/contracts";
import type { Investigation } from "@/lib/types";

import raw from "./mock-investigation.json";

function parseMockInvestigation(): Investigation {
  // Throws at import time if the fixture ever drifts from the contracts.
  const inv = InvestigationSchema.parse(raw);
  const issues = investigationIntegrityIssues(inv);
  if (issues.length > 0) {
    throw new Error(`mock-investigation.json has broken references: ${issues.join("; ")}`);
  }
  return inv;
}

/** A complete, fictional Investigation ("_mock" stripped), validated against InvestigationSchema. */
export const mockInvestigation: Investigation = parseMockInvestigation();
