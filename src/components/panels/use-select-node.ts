"use client";

import { useCallback } from "react";

import { useInvestigationStore } from "@/stores/investigation";

/** Selects a graph node and opens its door when a finding or gap was collapsed. */
export function useSelectNode() {
  const setSelected = useInvestigationStore((state) => state.setSelected);
  const toggleCollapsed = useInvestigationStore((state) => state.toggleCollapsed);

  return useCallback(
    (nodeId: string) => {
      const state = useInvestigationStore.getState();
      const investigation = state.investigation;
      let branchId: string | undefined;
      if (nodeId.startsWith("claim:")) {
        const claimId = nodeId.slice("claim:".length);
        branchId = investigation?.claims.find((claim) => claim.id === claimId)?.branchId;
      } else if (nodeId.startsWith("gap:")) {
        const gapId = nodeId.slice("gap:".length);
        branchId = investigation?.gaps.find((gap) => gap.id === gapId)?.branchId;
      }
      if (branchId && state.collapsedBranchIds.includes(branchId)) {
        toggleCollapsed(branchId);
      }
      setSelected(nodeId);
    },
    [setSelected, toggleCollapsed],
  );
}
