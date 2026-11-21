"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { retryBranch } from "@/lib/client/runner";
import type { BranchStatus } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

/** Matches the server's per-branch time limit. The request is not cancelled. */
const SLOW_AFTER_MS = 45_000;

function useSearchIsSlow(status: BranchStatus): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (status !== "running") return;
    const id = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [status]);

  return slow;
}

export function doorEmptyCopy(status: BranchStatus): string {
  if (status === "failed") return "This door did not open. Everything else you found is still here.";
  if (status === "done") return "No verified findings on this door.";
  if (status === "idle") return "This door has not been opened yet.";
  return "Searching…";
}

function SearchingNote() {
  return (
    <p className="flex items-center gap-2 text-xs leading-5 text-paper" role="status">
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-paper/20" aria-hidden>
        <span className="search-glide absolute inset-y-0 left-0 w-1/2 rounded-full bg-mystic-ink" />
      </span>
      Searching…
    </p>
  );
}

function SlowSearchNote() {
  return (
    <p className="text-xs leading-5 text-paper" role="status">
      This door is taking longer than usual. Anything already found stays on the map.
    </p>
  );
}

function RetryDoorButton({ branchId, title }: { branchId: string; title: string }) {
  const [pending, setPending] = useState(false);

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="w-fit cursor-pointer"
      disabled={pending}
      aria-label={`Retry ${title}`}
      onClick={() => {
        setPending(true);
        void retryBranch(branchId).finally(() => setPending(false));
      }}
    >
      {pending ? "Searching…" : "Retry this door"}
    </Button>
  );
}

/** Searching, timeout, error, and retry for a single door. Other doors are left alone. */
export function BranchActivity({ branchId, title }: { branchId: string; title: string }) {
  const status = useInvestigationStore(
    (state) => state.investigation?.branches.find((branch) => branch.id === branchId)?.status ?? "idle",
  );
  return <BranchActivityBody key={status} branchId={branchId} title={title} status={status} />;
}

function BranchActivityBody({
  branchId,
  title,
  status,
}: {
  branchId: string;
  title: string;
  status: BranchStatus;
}) {
  const error = useInvestigationStore((state) => state.branchErrors[branchId]);
  const slow = useSearchIsSlow(status);

  if (status !== "running" && !slow && !error && status !== "failed") return null;

  return (
    <div className="flex flex-col gap-1.5">
      {status === "running" ? <SearchingNote /> : null}
      {slow ? <SlowSearchNote /> : null}
      {error ? (
        <p role="alert" className="text-xs leading-5 break-words text-destructive">
          {error}
        </p>
      ) : null}
      {status === "failed" ? <RetryDoorButton branchId={branchId} title={title} /> : null}
    </div>
  );
}
