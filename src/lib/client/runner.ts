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
import { useHistoryStore } from "@/stores/history";
import { useInvestigationStore } from "@/stores/investigation";

type Slot<T> = { current: { key: string; run: Promise<T> } | null };

/**
 * One run at a time per slot and key. Keys are investigation ids, so a run still in flight for an
 * earlier dream (after "Ask another question") never blocks or stands in for the new one.
 */
function dedupe<T>(slot: Slot<T>, key: string, task: () => Promise<T>): Promise<T> {
  if (slot.current?.key === key) return slot.current.run;
  const entry: { key: string; run: Promise<T> } = {
    key,
    run: task().finally(() => {
      if (slot.current === entry) slot.current = null;
    }),
  };
  slot.current = entry;
  return entry.run;
}

const planSlot: Slot<PlanResponse> = { current: null };
const researchSlot: Slot<void> = { current: null };
const analyzeSlot: Slot<AnalyzeResponse> = { current: null };
const gapSlot: Slot<ResearchResponse> = { current: null };
const reportSlot: Slot<ReportResponse> = { current: null };
const branchSlots = new Map<string, Promise<void>>();

function currentId(): string {
  return useInvestigationStore.getState().investigation?.id ?? "";
}

/** False once the user has started a different dream: late results from the old one are dropped. */
function isCurrent(investigationId: string): boolean {
  return investigationId !== "" && currentId() === investigationId;
}

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
  return dedupe(planSlot, "plan", async () => {
    const parsed = PlanRequestSchema.safeParse({ question });
    if (!parsed.success) throw requestError(parsed.error);
    const plan = await postPlan(parsed.data);
    const store = useInvestigationStore.getState();
    store.startInvestigation(parsed.data.question);
    store.setPlan(plan);
    // The planner's goal is a short title; it names this dream in the history sidebar.
    const id = useInvestigationStore.getState().investigation?.id;
    if (id) useHistoryStore.getState().nameDream(id, plan.goal);
    return plan;
  });
}

async function researchOne(branch: Branch): Promise<void> {
  const investigationId = currentId();
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
    if (!isCurrent(investigationId)) return;
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
    if (!isCurrent(investigationId)) return;
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
  const key = `${currentId()}:${branchId}`;
  const existing = branchSlots.get(key);
  if (existing) return existing;
  const run = retryBranchNow(branchId).finally(() => {
    branchSlots.delete(key);
  });
  branchSlots.set(key, run);
  return run;
}

async function retryBranchNow(branchId: string): Promise<void> {
  const branch = useInvestigationStore.getState().investigation?.branches.find((item) => item.id === branchId);
  if (!branch) {
    const message = "That door is not part of this dream.";
    toast.error(message, { id: `branch-${branchId}` });
    throw new ApiClientError(API_ERROR_CODES.INVALID_REQUEST, message, 400);
  }
  const investigationId = currentId();
  useInvestigationStore.getState().setBranchStatus(branch.id, "running");
  await researchOne(branch);
  if (!isCurrent(investigationId)) return;
  const status = useInvestigationStore.getState().investigation?.branches.find((item) => item.id === branchId)?.status;
  if (status === "failed") return;
  if (analyzeSlot.current?.key === investigationId) await analyzeSlot.current.run.catch(() => undefined);
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
  const investigationId = currentId();
  return dedupe(researchSlot, investigationId, async () => {
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
    if (!isCurrent(investigationId)) return;
    await runAnalyze();
  });
}

export function runAnalyze(): Promise<AnalyzeResponse> {
  const investigationId = currentId();
  return dedupe(analyzeSlot, investigationId, async () => {
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
    if (isCurrent(investigationId)) useInvestigationStore.getState().applyAnalysis(response);
    return response;
  });
}

/**
 * Follows one gap without closing it. The user decides when a gap is resolved.
 */
export function investigateGap(gapId: string): Promise<ResearchResponse> {
  const investigationId = currentId();
  return dedupe(gapSlot, investigationId, async () => {
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
    if (isCurrent(investigationId)) useInvestigationStore.getState().mergeResearch(response);
    return response;
  });
}

export function runReport(): Promise<ReportResponse> {
  const investigationId = currentId();
  return dedupe(reportSlot, investigationId, async () => {
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
    if (isCurrent(investigationId)) useInvestigationStore.getState().setReport(report);
    return report;
  });
}
