"use client";

import { useInvestigationStore } from "@/stores/investigation";

/** TODO: B2 replaces this placeholder with the React Flow investigation graph. */
export function GraphCanvas() {
  const investigation = useInvestigationStore((state) => state.investigation);
  const selectedNodeId = useInvestigationStore((state) => state.selectedNodeId);
  const opening = investigation?.branches.some((branch) => branch.status === "running") ?? false;

  return (
    <section
      aria-label="Investigation map"
      className="flex h-full min-h-[50vh] flex-col items-center justify-center gap-3 bg-midnight/20 p-8 text-center"
    >
      <h2 className="font-heading text-4xl text-paper">The map is still dark</h2>
      <p className="max-w-md text-sm text-paper/75">
        TODO: the Wonderland graph will grow here as each door opens.
      </p>
      {opening ? <p className="text-sm text-golden">The doors are opening…</p> : null}
      <p className="font-mono text-xs tracking-wide text-paper/60">
        {investigation?.claims.length ?? 0} findings · {investigation?.gaps.length ?? 0} gaps ·{" "}
        {investigation?.connections.length ?? 0} connections
        {selectedNodeId ? ` · selected ${selectedNodeId}` : ""}
      </p>
    </section>
  );
}
