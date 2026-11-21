/**
 * POST /api/analyze (STUB). Returns the fixture's gaps, evidence-status updates and
 * suggested connections, restricted to the claims actually sent in the request.
 * Replaced by the real Cheshire Cat + Mad Hatter analysis in step A4.
 */
import { MAX_BODY_BYTES, readJsonBody, respondWith, STUB_RESPONSE_INIT, stubDelay } from "@/app/api/_lib/http";
import { mockInvestigation } from "@/fixtures";
import {
  AnalyzeRequestSchema,
  AnalyzeResponseSchema,
  type AnalyzeResponse,
  type ClaimUpdate,
} from "@/lib/contracts";
import type { Gap } from "@/lib/types";

export async function POST(req: Request) {
  const body = await readJsonBody(req, AnalyzeRequestSchema, MAX_BODY_BYTES.analyze);
  if (!body.ok) return body.response;
  const { branches, claims } = body.data;

  await stubDelay();

  const claimIds = new Set(claims.map((c) => c.id));
  const branchIds = new Set(branches.map((b) => b.id));
  const fixtureClaims = new Map(mockInvestigation.claims.map((c) => [c.id, c]));

  const claimUpdates: ClaimUpdate[] = claims.flatMap((c) => {
    const fixture = fixtureClaims.get(c.id);
    return fixture && fixture.evidenceStatus !== c.evidenceStatus
      ? [{ claimId: c.id, evidenceStatus: fixture.evidenceStatus }]
      : [];
  });

  const gaps: Gap[] = mockInvestigation.gaps
    .map((g) => {
      const { branchId, ...rest } = g;
      return {
        ...rest,
        ...(branchId && branchIds.has(branchId) ? { branchId } : {}),
        claimIds: g.claimIds.filter((id) => claimIds.has(id)),
        status: "open" as const,
      };
    })
    // A "missing" gap can stand alone; the other kinds need at least one involved claim.
    .filter((g) => g.kind === "missing" || g.claimIds.length > 0);

  const connections = mockInvestigation.connections
    .filter((c) => claimIds.has(c.from) && claimIds.has(c.to))
    .map((c) => ({ ...c, accepted: false }));

  const response: AnalyzeResponse = { gaps, claimUpdates, connections };
  return respondWith(AnalyzeResponseSchema, response, STUB_RESPONSE_INIT);
}
