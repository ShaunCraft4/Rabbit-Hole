"use client";

import { Button } from "@/components/ui/button";
import { useInvestigationStore } from "@/stores/investigation";

import { countPhrase, investigationCounts } from "./copy";

export function WorkspaceHeader() {
  const investigation = useInvestigationStore((state) => state.investigation);
  const view = useInvestigationStore((state) => state.view);
  const setView = useInvestigationStore((state) => state.setView);

  if (!investigation) return null;
  const counts = investigationCounts(investigation);

  const chips = [
    countPhrase(counts.sourcesRead, "source read", "sources read"),
    countPhrase(counts.verifiedClaims, "verified claim", "verified claims"),
    `${countPhrase(counts.rejectedClaims, "claim", "claims")} rejected: no verifiable evidence`,
    countPhrase(counts.openGaps, "open gap", "open gaps"),
  ];

  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-midnight/50 px-4 py-3">
      <ul className="flex flex-wrap gap-2" aria-label="Investigation totals">
        {chips.map((chip) => (
          <li key={chip}>
            <span className="inline-flex rounded-full border border-paper/25 px-2.5 py-1 text-xs leading-5 text-paper">
              {chip}
            </span>
          </li>
        ))}
      </ul>
      <div role="group" aria-label="Choose graph or list" className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={view === "graph" ? "default" : "outline"}
          className="cursor-pointer"
          aria-pressed={view === "graph"}
          onClick={() => setView("graph")}
        >
          Graph
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view === "list" ? "default" : "outline"}
          className="cursor-pointer"
          aria-pressed={view === "list"}
          onClick={() => setView("list")}
        >
          List
        </Button>
      </div>
    </header>
  );
}
