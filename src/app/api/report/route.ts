/**
 * POST /api/report (STUB). Returns the fixture's Golden Key report, keeping only items whose
 * ids are in the request: verified claims, connections with accepted === true, open gaps.
 * Replaced by the real report prompt in step A5.
 */
import { MAX_BODY_BYTES, readJsonBody, respondWith, STUB_RESPONSE_INIT, stubDelay } from "@/app/api/_lib/http";
import { mockInvestigation } from "@/fixtures";
import { ReportRequestSchema, ReportResponseSchema, type ReportResponse } from "@/lib/contracts";

export async function POST(req: Request) {
  const body = await readJsonBody(req, ReportRequestSchema, MAX_BODY_BYTES.report);
  if (!body.ok) return body.response;
  const { claims, gaps, connections } = body.data;

  await stubDelay();

  const verifiedClaimIds = new Set(claims.filter((c) => c.verified).map((c) => c.id));
  const acceptedConnectionIds = new Set(connections.filter((c) => c.accepted === true).map((c) => c.id));
  const openGapIds = new Set(gaps.filter((g) => g.status === "open").map((g) => g.id));

  // The fixture always has a report; the fallback only satisfies the type checker.
  const fixture = mockInvestigation.report ?? {
    directAnswer: "No report is available in the mock data.",
    keyDiscoveries: [],
    planChangingConnections: [],
    uncertainties: [],
    nextSteps: [{ step: "Run the research again." }],
  };

  const report: ReportResponse = {
    directAnswer: fixture.directAnswer,
    keyDiscoveries: fixture.keyDiscoveries.filter((d) => verifiedClaimIds.has(d.claimId)),
    planChangingConnections: fixture.planChangingConnections.filter((p) =>
      acceptedConnectionIds.has(p.connectionId),
    ),
    uncertainties: fixture.uncertainties.filter((u) => !u.gapId || openGapIds.has(u.gapId)),
    nextSteps: fixture.nextSteps,
  };
  return respondWith(ReportResponseSchema, report, STUB_RESPONSE_INIT);
}
