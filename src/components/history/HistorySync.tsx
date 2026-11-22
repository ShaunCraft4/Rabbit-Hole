"use client";

import { useEffect } from "react";

import type { HistoryEntry } from "@/lib/client/history";
import { useHistoryStore } from "@/stores/history";
import { historySnapshot, useInvestigationStore, type InvestigationState } from "@/stores/investigation";

/** Wait this long after the last change before saving (live research changes the dream often). */
const SAVE_DELAY_MS = 600;

function saveDream(state: InvestigationState): void {
  const investigation = state.investigation;
  // Saved examples are not the user's dreams; an empty entrance has nothing to keep yet.
  if (!investigation || state.savedExample || state.phase === "entrance") return;
  useHistoryStore.getState().save(
    {
      id: investigation.id,
      question: investigation.question,
      phase: state.phase as HistoryEntry["phase"],
      findings: investigation.claims.filter((claim) => claim.verified).length,
      hasReport: Boolean(investigation.report),
    },
    historySnapshot(state),
  );
}

/**
 * Auto-save for the dream history: every change to the current dream is saved shortly after it
 * happens (and right away when the tab is hidden or closed). Mounted once, in AppChrome.
 */
export function HistorySync() {
  useEffect(() => {
    useHistoryStore.getState().hydrate();
    if (!useInvestigationStore.persist.hasHydrated()) void useInvestigationStore.persist.rehydrate();

    let timer: number | undefined;
    const flush = () => {
      window.clearTimeout(timer);
      timer = undefined;
      saveDream(useInvestigationStore.getState());
    };
    const unsubscribe = useInvestigationStore.subscribe((state, prev) => {
      const changed =
        state.investigation !== prev.investigation ||
        state.phase !== prev.phase ||
        state.branchErrors !== prev.branchErrors ||
        state.dismissReasons !== prev.dismissReasons ||
        state.collapsedBranchIds !== prev.collapsedBranchIds ||
        state.view !== prev.view;
      if (!changed) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(flush, SAVE_DELAY_MS);
    });
    const onHide = () => {
      if (timer !== undefined) flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribe();
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      onHide();
    };
  }, []);

  return null;
}
