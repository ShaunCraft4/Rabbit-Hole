import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

import { IdSchema, InvestigationSchema, LIMITS } from "@/lib/contracts";
import type { AnalyzeResponse, PlanResponse, ResearchResponse } from "@/lib/contracts";
import type { BranchStatus, GapStatus, Investigation, Report } from "@/lib/types";

export type Phase = "entrance" | "planning" | "researching" | "analyzed" | "reported";
export type InvestigationView = "graph" | "list";

const STORAGE_KEY = "rabbit-hole.investigation";
const PHASES: readonly Phase[] = ["entrance", "planning", "researching", "analyzed", "reported"];
const VIEWS: readonly InvestigationView[] = ["graph", "list"];

export interface AddBranchInput {
  title: string;
  question: string;
  queries?: string[];
  /** Use a known id (gap follow-up). Omitted ids are generated. */
  id?: string;
}

interface PersistedSlice {
  investigation: Investigation | null;
  phase: Phase;
  selectedNodeId: string | null;
  collapsedBranchIds: string[];
  branchErrors: Record<string, string>;
  dismissReasons: Record<string, string>;
  view: InvestigationView;
}

interface InvestigationActions {
  startInvestigation: (question: string) => void;
  setPlan: (plan: PlanResponse) => void;
  deleteBranch: (branchId: string) => void;
  editBranch: (branchId: string, question: string) => void;
  addBranch: (input: AddBranchInput) => void;
  setBranchStatus: (branchId: string, status: BranchStatus, error?: string) => void;
  mergeResearch: (response: ResearchResponse) => void;
  applyAnalysis: (response: AnalyzeResponse) => void;
  acceptConnection: (connectionId: string) => void;
  dismissConnection: (connectionId: string) => void;
  setGapStatus: (gapId: string, status: GapStatus, reason?: string) => void;
  setReport: (report: Report) => void;
  setSelected: (nodeId: string | null) => void;
  toggleCollapsed: (branchId: string) => void;
  setView: (view: InvestigationView) => void;
  loadInvestigation: (investigation: Investigation) => void;
  reset: () => void;
}

export type InvestigationState = PersistedSlice & InvestigationActions;

const initialSlice: PersistedSlice = {
  investigation: null,
  phase: "entrance",
  selectedNodeId: null,
  collapsedBranchIds: [],
  branchErrors: {},
  dismissReasons: {},
  view: "graph",
};

function createSafeStorage(): StateStorage {
  if (typeof window === "undefined") {
    return {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
  return {
    getItem: (name) => {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        window.localStorage.setItem(name, value);
      } catch {
        // Private mode or a full quota: this session still works.
      }
    },
    removeItem: (name) => {
      try {
        window.localStorage.removeItem(name);
      } catch {
        // Ignore storage failures.
      }
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripSourceText(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.sources)) return value;
  return {
    ...value,
    sources: value.sources.map((source) => {
      if (!isRecord(source) || !("text" in source)) return source;
      const rest: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(source)) {
        if (key !== "text") rest[key] = entry;
      }
      return rest;
    }),
  };
}

function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && PHASES.includes(value as Phase);
}

function isView(value: unknown): value is InvestigationView {
  return typeof value === "string" && VIEWS.includes(value as InvestigationView);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && IdSchema.safeParse(key).success) {
      out[key] = entry.slice(0, 500);
    }
  }
  return out;
}

function nodeId(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) return null;
  return /^[A-Za-z0-9_:-]+$/.test(value) ? value : null;
}

/** A refresh kills in-flight requests. Don't leave doors stuck on "searching". */
function settleInterrupted(investigation: Investigation): {
  investigation: Investigation;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const branches = investigation.branches.map((branch) => {
    if (branch.status !== "running") return branch;
    errors[branch.id] = "This search stopped when the page refreshed.";
    return { ...branch, status: "failed" as const };
  });
  return { investigation: { ...investigation, branches }, errors };
}

function revive(persisted: unknown): PersistedSlice | null {
  if (persisted == null) return null;
  if (!isRecord(persisted)) return initialSlice;
  const parsed = InvestigationSchema.safeParse(stripSourceText(persisted.investigation));
  if (!parsed.success) return initialSlice;

  const settled = settleInterrupted(parsed.data);
  const phase = isPhase(persisted.phase) ? persisted.phase : "planning";
  return {
    investigation: settled.investigation,
    phase: phase === "entrance" ? "planning" : phase,
    selectedNodeId: nodeId(persisted.selectedNodeId),
    collapsedBranchIds: Array.isArray(persisted.collapsedBranchIds)
      ? persisted.collapsedBranchIds.filter(
          (id): id is string => typeof id === "string" && IdSchema.safeParse(id).success,
        )
      : [],
    branchErrors: { ...stringRecord(persisted.branchErrors), ...settled.errors },
    dismissReasons: stringRecord(persisted.dismissReasons),
    view: isView(persisted.view) ? persisted.view : "graph",
  };
}

function phaseForLoaded(investigation: Investigation): Phase {
  if (investigation.report) return "reported";
  if (investigation.claims.length > 0 || investigation.gaps.length > 0) return "analyzed";
  if (investigation.branches.length > 0) return "planning";
  return "entrance";
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export const useInvestigationStore = create<InvestigationState>()(
  persist(
    (set) => ({
      ...initialSlice,

      startInvestigation: (question) => {
        const dream = question.trim();
        if (!dream || dream.length > LIMITS.questionChars) return;
        set({
          ...initialSlice,
          phase: "planning",
          investigation: {
            id: nanoid(12),
            question: dream,
            assumptions: [],
            branches: [],
            sources: [],
            claims: [],
            gaps: [],
            connections: [],
            rejectedClaims: 0,
          },
        });
      },

      setPlan: (plan) =>
        set((state) => {
          if (!state.investigation) return state;
          return {
            phase: "planning",
            branchErrors: {},
            collapsedBranchIds: [],
            selectedNodeId: null,
            investigation: {
              ...state.investigation,
              assumptions: plan.assumptions,
              branches: plan.branches.map((branch) => ({
                id: branch.id,
                title: branch.title,
                question: branch.question,
                queries: branch.queries,
                status: "idle" as const,
              })),
              sources: [],
              claims: [],
              gaps: [],
              connections: [],
              report: undefined,
              rejectedClaims: 0,
            },
          };
        }),

      deleteBranch: (branchId) =>
        set((state) => {
          if (!state.investigation) return state;
          return {
            collapsedBranchIds: state.collapsedBranchIds.filter((id) => id !== branchId),
            branchErrors: withoutKey(state.branchErrors, branchId),
            selectedNodeId:
              state.selectedNodeId === branchId || state.selectedNodeId === `branch:${branchId}`
                ? null
                : state.selectedNodeId,
            investigation: {
              ...state.investigation,
              branches: state.investigation.branches.filter((branch) => branch.id !== branchId),
            },
          };
        }),

      editBranch: (branchId, question) => {
        const nextQuestion = question.trim();
        if (!nextQuestion || nextQuestion.length > LIMITS.branchQuestionChars) return;
        set((state) => {
          if (!state.investigation) return state;
          return {
            investigation: {
              ...state.investigation,
              branches: state.investigation.branches.map((branch) => {
                if (branch.id !== branchId) return branch;
                const queries =
                  branch.queries.length === 1 && branch.queries[0] === branch.question
                    ? [nextQuestion.slice(0, LIMITS.queryChars)]
                    : branch.queries;
                return { ...branch, question: nextQuestion, queries };
              }),
            },
          };
        });
      },

      addBranch: (input) => {
        const title = input.title.trim();
        const question = input.question.trim();
        if (!title || !question) return;
        if (title.length > LIMITS.branchTitleChars || question.length > LIMITS.branchQuestionChars) return;
        const requestedId = input.id && IdSchema.safeParse(input.id).success ? input.id : null;
        set((state) => {
          if (!state.investigation) return state;
          if (state.investigation.branches.length >= LIMITS.maxBranches) return state;
          if (requestedId && state.investigation.branches.some((branch) => branch.id === requestedId)) {
            return state;
          }
          const queries = (input.queries?.length ? input.queries : [question])
            .map((query) => query.trim().slice(0, LIMITS.queryChars))
            .filter((query) => query.length > 0)
            .slice(0, LIMITS.maxQueriesPerBranch);
          if (queries.length === 0) return state;
          return {
            investigation: {
              ...state.investigation,
              branches: [
                ...state.investigation.branches,
                {
                  id: requestedId ?? nanoid(10),
                  title,
                  question,
                  queries,
                  status: "idle",
                },
              ],
            },
          };
        });
      },

      setBranchStatus: (branchId, status, error) =>
        set((state) => {
          if (!state.investigation) return state;
          if (!state.investigation.branches.some((branch) => branch.id === branchId)) return state;
          const promote =
            status === "running" && (state.phase === "planning" || state.phase === "entrance");
          let branchErrors = state.branchErrors;
          if (status === "failed") {
            branchErrors = { ...branchErrors, [branchId]: error?.trim() || "This door did not open." };
          } else if (branchId in branchErrors) {
            branchErrors = withoutKey(branchErrors, branchId);
          }
          return {
            phase: promote ? "researching" : state.phase,
            branchErrors,
            investigation: {
              ...state.investigation,
              branches: state.investigation.branches.map((branch) =>
                branch.id === branchId ? { ...branch, status } : branch,
              ),
            },
          };
        }),

      mergeResearch: (response) =>
        set((state) => {
          if (!state.investigation) return state;
          const sources = new Map(state.investigation.sources.map((source) => [source.id, source]));
          for (const source of response.sources) sources.set(source.id, source);
          const seen = new Set(state.investigation.claims.map((claim) => claim.id));
          const claims = [...state.investigation.claims];
          for (const claim of response.claims) {
            if (seen.has(claim.id)) continue;
            seen.add(claim.id);
            claims.push(claim);
          }
          return {
            investigation: {
              ...state.investigation,
              sources: [...sources.values()].slice(0, LIMITS.maxSources),
              claims: claims.slice(0, LIMITS.maxClaims),
              rejectedClaims: Math.min(
                LIMITS.maxRejectedClaims,
                state.investigation.rejectedClaims + response.rejectedClaims,
              ),
            },
          };
        }),

      applyAnalysis: (response) =>
        set((state) => {
          if (!state.investigation) return state;
          const updates = new Map(response.claimUpdates.map((update) => [update.claimId, update.evidenceStatus]));
          return {
            phase: "analyzed",
            investigation: {
              ...state.investigation,
              claims: state.investigation.claims.map((claim) => {
                const evidenceStatus = updates.get(claim.id);
                return evidenceStatus ? { ...claim, evidenceStatus } : claim;
              }),
              gaps: response.gaps,
              connections: response.connections,
            },
          };
        }),

      acceptConnection: (connectionId) =>
        set((state) => {
          if (!state.investigation) return state;
          return {
            investigation: {
              ...state.investigation,
              connections: state.investigation.connections.map((connection) =>
                connection.id === connectionId ? { ...connection, accepted: true } : connection,
              ),
            },
          };
        }),

      dismissConnection: (connectionId) =>
        set((state) => {
          if (!state.investigation) return state;
          return {
            investigation: {
              ...state.investigation,
              connections: state.investigation.connections.filter((connection) => connection.id !== connectionId),
            },
          };
        }),

      setGapStatus: (gapId, status, reason) =>
        set((state) => {
          if (!state.investigation) return state;
          if (!state.investigation.gaps.some((gap) => gap.id === gapId)) return state;
          const trimmed = reason?.trim();
          let dismissReasons = state.dismissReasons;
          if (status === "dismissed" && trimmed) {
            dismissReasons = { ...dismissReasons, [gapId]: trimmed.slice(0, 300) };
          } else if (status === "open") {
            dismissReasons = withoutKey(dismissReasons, gapId);
          }
          return {
            dismissReasons,
            investigation: {
              ...state.investigation,
              gaps: state.investigation.gaps.map((gap) => (gap.id === gapId ? { ...gap, status } : gap)),
            },
          };
        }),

      setReport: (report) =>
        set((state) => {
          if (!state.investigation) return state;
          return {
            phase: "reported",
            investigation: { ...state.investigation, report },
          };
        }),

      setSelected: (nodeId) => set({ selectedNodeId: nodeId }),

      toggleCollapsed: (branchId) =>
        set((state) => ({
          collapsedBranchIds: state.collapsedBranchIds.includes(branchId)
            ? state.collapsedBranchIds.filter((id) => id !== branchId)
            : [...state.collapsedBranchIds, branchId],
        })),

      setView: (view) => set({ view }),

      loadInvestigation: (investigation) => {
        const parsed = InvestigationSchema.parse(stripSourceText(investigation));
        set({
          investigation: parsed,
          phase: phaseForLoaded(parsed),
          selectedNodeId: null,
          collapsedBranchIds: [],
          branchErrors: {},
          dismissReasons: {},
          view: "graph",
        });
      },

      reset: () => set({ ...initialSlice }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(createSafeStorage),
      skipHydration: true,
      partialize: (state) => ({
        investigation: state.investigation,
        phase: state.phase,
        selectedNodeId: state.selectedNodeId,
        collapsedBranchIds: state.collapsedBranchIds,
        branchErrors: state.branchErrors,
        dismissReasons: state.dismissReasons,
        view: state.view,
      }),
      merge: (persisted, current) => {
        const revived = revive(persisted);
        return revived ? { ...current, ...revived } : current;
      },
    },
  ),
);
