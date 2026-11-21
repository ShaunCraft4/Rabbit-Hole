"use client";

import { useInvestigationStore } from "@/stores/investigation";

/** TODO: B3 replaces this placeholder with findings, quotes, sources, and gaps. */
export function DiscoveryPanel() {
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);

  return (
    <section aria-label="Discovery" className="flex h-full flex-col gap-3 p-5">
      <h2 className="font-heading text-3xl text-paper">Discovery</h2>
      <p className="text-sm leading-6 text-paper/75">
        TODO: the selected finding, its verified quote, and its sources will appear here.
      </p>
      <p className="font-mono text-xs text-paper/60">
        {selectedNodeId ? `Selected ${selectedNodeId}` : "Nothing selected yet"}
      </p>
    </section>
  );
}
