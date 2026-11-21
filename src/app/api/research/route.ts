/**
 * POST /api/research (STUB). Researches one branch using fixture data.
 * Replaced by the real search -> retrieve -> extract -> verify pipeline in step A3.
 *
 * - A fixture branch id returns that branch's claims and sources, with the evidence
 *   status the real route would give BEFORE analysis (single_source or snippet_only).
 * - Any other branch id, or any request with forGapId, returns one canned follow-up claim.
 * - A branch whose title or question contains "#fail" returns a 502 error, so the UI's
 *   failure path can be tested.
 */
import { nanoid } from "nanoid";

import {
  apiError,
  MAX_BODY_BYTES,
  readJsonBody,
  respondWith,
  STUB_RESPONSE_INIT,
  stubDelay,
} from "@/app/api/_lib/http";
import { mockInvestigation } from "@/fixtures";
import {
  API_ERROR_CODES,
  ResearchRequestSchema,
  ResearchResponseSchema,
  type PublicSource,
  type ResearchResponse,
} from "@/lib/contracts";
import type { Claim, EvidenceStatus } from "@/lib/types";

/** Rejected-claim counts per fixture branch (they add up to the fixture's 3). */
const REJECTED_BY_BRANCH: Record<string, number> = {
  "funding-sources": 1,
  "eligibility-costs": 1,
  "deadlines-process": 1,
  "event-approval": 0,
};

/** Sources a branch "found" that produced no claims (e.g. the failed one). */
const EXTRA_SOURCES_BY_BRANCH: Record<string, string[]> = {
  "eligibility-costs": ["src_e0b7d3f5"],
};

const FOLLOW_UP_SOURCE: PublicSource = {
  id: "src_3a9c5f21",
  url: "https://asg.exampleu.example/funding/espf-faq",
  domain: "asg.exampleu.example",
  title: "ESPF Frequently Asked Questions",
  retrievalStatus: "full_text",
  publishedAt: "2026-08-15",
  snippet: "Off-campus venues may be funded only with prior written approval from the finance committee.",
  retrievedVia: "keenable",
};

export async function POST(req: Request) {
  const body = await readJsonBody(req, ResearchRequestSchema, MAX_BODY_BYTES.research);
  if (!body.ok) return body.response;
  const { branch, excludeSourceIds, forGapId } = body.data;

  await stubDelay();

  if (`${branch.title} ${branch.question}`.includes("#fail")) {
    return apiError(502, API_ERROR_CODES.UPSTREAM_ERROR, "Stub: forced failure because the branch contains #fail.");
  }

  const excluded = new Set(excludeSourceIds ?? []);
  const sourcesById = new Map(mockInvestigation.sources.map((s) => [s.id, s]));
  const isFixtureBranch = !forGapId && mockInvestigation.branches.some((b) => b.id === branch.id);

  let response: ResearchResponse;

  if (isFixtureBranch) {
    const claims = mockInvestigation.claims
      .filter((c) => c.branchId === branch.id && !excluded.has(c.sourceId))
      .map((c) => {
        const source = sourcesById.get(c.sourceId);
        const evidenceStatus: EvidenceStatus =
          source?.retrievalStatus === "snippet_only" ? "snippet_only" : "single_source";
        return { ...c, verified: true as const, evidenceStatus };
      });

    const sourceIds = new Set([
      ...claims.map((c) => c.sourceId),
      ...(EXTRA_SOURCES_BY_BRANCH[branch.id] ?? []),
    ]);
    const sources = mockInvestigation.sources.filter((s) => sourceIds.has(s.id) && !excluded.has(s.id));

    response = {
      branchId: branch.id,
      status: "done",
      sources,
      claims,
      rejectedClaims: REJECTED_BY_BRANCH[branch.id] ?? 0,
    };
  } else {
    const claim: Claim & { verified: true } = {
      id: `${branch.id}-c${nanoid(6)}`,
      branchId: branch.id,
      text: "The ESPF FAQ says off-campus venues can be funded only with prior written approval from the finance committee.",
      excerpt: "Off-campus venues may be funded only with prior written approval from the finance committee.",
      sourceId: FOLLOW_UP_SOURCE.id,
      verified: true,
      evidenceStatus: "single_source",
    };
    response = {
      branchId: branch.id,
      ...(forGapId ? { forGapId } : {}),
      status: "done",
      note: "Stub response: a canned follow-up result from the mock data.",
      sources: excluded.has(FOLLOW_UP_SOURCE.id) ? [] : [FOLLOW_UP_SOURCE],
      claims: [claim],
      rejectedClaims: 0,
    };
  }

  return respondWith(ResearchResponseSchema, response, STUB_RESPONSE_INIT);
}
