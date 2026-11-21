import { toast } from "sonner";

import { ApiClientError, postAnalyze, postPlan, postReport, postResearch } from "@/lib/client/api";
import {
  AnalyzeRequestSchema,
  API_ERROR_CODES,
  LIMITS,
  PlanRequestSchema,
  ReportRequestSchema,
  ResearchRequestSchema,
} from "@/lib/contracts";
import type { AnalyzeResponse, PlanResponse, ReportResponse, ResearchResponse } from "@/lib/contracts";
import type { Branch, Source } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

function dedupe<T>(slot: { current: Promise<T> | null }, task: () => Promise<T>): Promise<T> {
  if (slot.current) return slot.current;
  const run = task().finally(() => {
    slot.current = null;
  });
  slot.current = run;
  return run;
}

const planSlot: { current: Promise<PlanResponse> | null } = { current: null };
const researchSlot: { current: Promise<void> | null } = { current: null };
const analyzeSlot: { current: Promise<AnalyzeResponse> | null } = { current: null };
const gapSlot: { current: Promise<ResearchResponse> | null } = { current: null };
const reportSlot: { current: Promise<ReportResponse> | null } = { current: null };
const branchSlots = new Map<string, Promise<void>>();

/** Page text never travels back to the server. */
function withoutText(source: Source): Omit<Source, "text"> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (key !== "text") rest[key] = value;
  }
  return rest as Omit<Source, "text">;
}

function requestError(error: { issues: { message: string }[] }): ApiClientError {
  const message = error.issues
    .slice(0, 3)
    .map((issue) => issue.message)
    .join(" ");
  return new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, message || "That request is not valid.", 400);
}

export function runPlan(question: string): Promise<PlanResponse> {
  return dedupe(planSlot, async () => {
    const parsed = PlanRequestSchema.safeParse({ question });
    if (!parsed.success) throw requestError(parsed.error);
    const plan = await postPlan(parsed.data);
    const store = useInvestigationStore.getState();
    store.startInvestigation(parsed.data.question);
    store.setPlan(plan);
    return plan;
  });
}

async function researchOne(branch: Branch): Promise<void> {
  try {
    const parsed = ResearchRequestSchema.safeParse({
      branch: {
        id: branch.id,
        title: branch.title,
        question: branch.question,
        queries: branch.queries,
      },
    });
    if (!parsed.success) throw requestError(parsed.error);
    const response = await postResearch(parsed.data);
    const store = useInvestigationStore.getState();
    store.mergeResearch(response);
    if (response.status === "failed") {
      const message = response.note || "This door did not open.";
      store.setBranchStatus(branch.id, "failed", message);
      toast.error(message, { id: `branch-${branch.id}` });
      return;
    }
    store.setBranchStatus(branch.id, "done");
    if (response.status === "partial" && response.note?.trim()) {
      toast.message(response.note, { id: `branch-${branch.id}` });
    }
  } catch (error) {
    const message = error instanceof ApiClientError ? error.message : "This door did not open.";
    useInvestigationStore.getState().setBranchStatus(branch.id, "failed", message);
    toast.error(message, { id: `branch-${branch.id}` });
  }
}

/**
 * Re-runs one failed door. Findings from the other doors stay.
 * Analysis runs again only after this door returns something.
 */
export function retryBranch(branchId: string): Promise<void> {
  const existing = branchSlots.get(branchId);
  if (existing) return existing;
  const run = retryBranchNow(branchId).finally(() => {
    branchSlots.delete(branchId);
  });
  branchSlots.set(branchId, run);
  return run;
}

async function retryBranchNow(branchId: string): Promise<void> {
  const branch = useInvestigationStore.getState().investigation?.branches.find((item) => item.id === branchId);
  if (!branch) {
    const message = "That door is not part of this dream.";
    toast.error(message, { id: `branch-${branchId}` });
    throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, message, 400);
  }
  useInvestigationStore.getState().setBranchStatus(branch.id, "running");
  await researchOne(branch);
  const status = useInvestigationStore.getState().investigation?.branches.find((item) => item.id === branchId)?.status;
  if (status === "failed") return;
  if (analyzeSlot.current) await analyzeSlot.current.catch(() => undefined);
  try {
    await runAnalyze();
  } catch (error) {
    const message =
      error instanceof ApiClientError
        ? error.message
        : "The new findings are saved. The analysis could not be updated.";
    toast.error(message, { id: "analyze" });
  }
}

/**
 * Opens every remaining door at once. Each branch is merged the moment it returns,
 * then analysis runs over whatever succeeded.
 */
export function runResearchAll(): Promise<void> {
  return dedupe(researchSlot, async () => {
    const investigation = useInvestigationStore.getState().investigation;
    if (!investigation) {
      throw new ApiClientError(
        API_ERROR_CODES.INVALID_REQUEST,
        "Start with a dream before opening the doors.",
        400,
      );
    }
    if (investigation.branches.length === 0) {
      throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, "Add at least one door before opening them.", 400);
    }

    const branches = investigation.branches;
    for (const branch of branches) {
      useInvestigationStore.getState().setBranchStatus(branch.id, "running");
    }

    await Promise.allSettled(branches.map((branch) => researchOne(branch)));
    await runAnalyze();
  });
}

export function runAnalyze(): Promise<AnalyzeResponse> {
  return dedupe(analyzeSlot, async () => {
    const investigation = useInvestigationStore.getState().investigation;
    if (!investigation || investigation.branches.length === 0) {
      throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, "There is nothing to analyze yet.", 400);
    }
    const parsed = AnalyzeRequestSchema.safeParse({
      question: investigation.question,
      branches: investigation.branches.map(({ id, title, question }) => ({ id, title, question })),
      claims: investigation.claims,
      sources: investigation.sources.map(withoutText),
    });
    if (!parsed.success) throw requestError(parsed.error);
    const response = await postAnalyze(parsed.data);
    useInvestigationStore.getState().applyAnalysis(response);
    return response;
  });
}

/**
 * Follows one gap without closing it. The user decides when a gap is resolved.
 */
export function investigateGap(gapId: string): Promise<ResearchResponse> {
  return dedupe(gapSlot, async () => {
    const investigation = useInvestigationStore.getState().investigation;
    const gap = investigation?.gaps.find((item) => item.id === gapId);
    if (!investigation || !gap) {
      throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, "That gap is not part of this dream.", 400);
    }

    const branchId = gap.branchId ?? "gap";
    const query = (gap.suggestedQuery?.trim() || gap.question).trim().slice(0, LIMITS.queryChars).trim();
    if (!query) {
      throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, "This gap has no question to investigate.", 400);
    }

    const exists = investigation.branches.some((branch) => branch.id === branchId);
    if (!exists && investigation.branches.length >= LIMITS.maxBranches) {
      throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, "There is no room for another door.", 400);
    }
    if (!exists) {
      useInvestigationStore.getState().addBranch({
        id: branchId,
        title: "Gap follow-up",
        question: gap.question,
        queries: [query],
      });
    }

    const parsed = ResearchRequestSchema.safeParse({
      branch: {
        id: branchId,
        title: "Gap follow-up",
        question: gap.question,
        queries: [query],
      },
      excludeSourceIds: investigation.sources.map((source) => source.id).slice(0, LIMITS.maxExcludeSourceIds),
      forGapId: gap.id,
    });
    if (!parsed.success) throw requestError(parsed.error);

    const response = await postResearch(parsed.data);
    useInvestigationStore.getState().mergeResearch(response);
    return response;
  });
}

export function runReport(): Promise<ReportResponse> {
  return dedupe(reportSlot, async () => {
    const investigation = useInvestigationStore.getState().investigation;
    if (!investigation) {
      throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, "There is no dream to report.", 400);
    }
    const parsed = ReportRequestSchema.safeParse({
      question: investigation.question,
      assumptions: investigation.assumptions,
      claims: investigation.claims,
      sources: investigation.sources.map(withoutText),
      gaps: investigation.gaps,
      connections: investigation.connections,
    });
    if (!parsed.success) throw requestError(parsed.error);
    const report = await postReport(parsed.data);
    useInvestigationStore.getState().setReport(report);
    return report;
  });
}
