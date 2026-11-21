"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/client/api";
import { investigateGap } from "@/lib/client/runner";
import { claimNodeId } from "@/lib/graph/build";
import type { Claim, Gap } from "@/lib/types";
import { useInvestigationStore } from "@/stores/investigation";

import { useSelectNode } from "./use-select-node";

/** Investigate, resolve, and dismiss a gap. Shared by the list panel and the skill-tree page. */
export function GapFollowUp({ gap }: { gap: Gap }) {
  const dismissReason = useInvestigationStore((state) => state.dismissReasons[gap.id]);
  const setGapStatus = useInvestigationStore((state) => state.setGapStatus);
  const setBranchStatus = useInvestigationStore((state) => state.setBranchStatus);
  const selectNode = useSelectNode();
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const [followUpNote, setFollowUpNote] = useState<string | null>(null);
  const [added, setAdded] = useState<Claim[]>([]);
  const [followed, setFollowed] = useState(false);

  async function onInvestigate() {
    setRunning(true);
    setFollowUpError(null);
    setFollowUpNote(null);
    setAdded([]);
    setFollowed(false);
    const before = new Set(useInvestigationStore.getState().investigation?.claims.map((claim) => claim.id) ?? []);
    const branchId = gap.branchId ?? "gap";
    const existed = useInvestigationStore.getState().investigation?.branches.some((branch) => branch.id === branchId) ?? false;
    try {
      const response = await investigateGap(gap.id);
      const fresh = response.claims.filter((claim) => !before.has(claim.id));
      setAdded(fresh);
      setFollowUpNote(response.note?.trim() || null);
      setFollowed(true);
      const failed = response.status === "failed";
      if (!existed) {
        setBranchStatus(response.branchId, failed ? "failed" : "done", failed ? response.note : undefined);
      }
      if (failed && fresh.length === 0) {
        const message = response.note?.trim() || "This search did not return new findings.";
        setFollowUpError(message);
        toast.error(message);
      }
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "This gap could not be investigated.";
      setFollowUpError(message);
      toast.error(message);
      if (!existed) {
        const branch = useInvestigationStore.getState().investigation?.branches.find((item) => item.id === branchId);
        if (branch) setBranchStatus(branch.id, "failed", message);
      }
    } finally {
      setRunning(false);
    }
  }

  function onDismiss(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = reason.trim();
    if (!next) {
      setReasonError("Add a one-line reason.");
      return;
    }
    setGapStatus(gap.id, "dismissed", next);
    setDismissing(false);
    setReasonError(null);
  }

  return (
    <div className="flex flex-col gap-2">
      {gap.status === "dismissed" ? (
        <p className="text-sm leading-6 break-words text-paper/75">
          {dismissReason ? `Dismissed. ${dismissReason}` : "Dismissed."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <Button type="button" className="w-fit cursor-pointer" disabled={running} onClick={() => void onInvestigate()}>
            {running ? "Investigating…" : "Investigate this gap"}
          </Button>
          {running ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <div className="h-1 overflow-hidden rounded-full bg-paper/15" role="progressbar" aria-label="Investigating this gap">
                <div className="status-pulse h-full w-1/3 bg-golden" />
              </div>
              <p className="text-sm text-paper/75" aria-live="polite">
                Investigating this gap…
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {gap.status === "resolved" ? (
              <p className="text-sm text-paper/75">Marked resolved.</p>
            ) : (
              <Button type="button" size="sm" variant="outline" className="cursor-pointer" onClick={() => setGapStatus(gap.id, "resolved")}>
                Mark resolved
              </Button>
            )}
            {dismissing ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="cursor-pointer"
                onClick={() => {
                  setDismissing(true);
                  setReasonError(null);
                }}
              >
                Dismiss
              </Button>
            )}
          </div>
          {dismissing ? (
            <form className="flex flex-col gap-2" onSubmit={onDismiss}>
              <label htmlFor={`dismiss-${gap.id}`} className="text-sm text-paper/80">
                Why dismiss this gap?
              </label>
              <Input id={`dismiss-${gap.id}`} value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
              {reasonError ? (
                <p role="alert" className="text-sm text-destructive">
                  {reasonError}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="cursor-pointer">
                  Dismiss gap
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="cursor-pointer"
                  onClick={() => {
                    setDismissing(false);
                    setReasonError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      )}

      {followUpError ? (
        <p role="alert" className="text-sm leading-6 break-words text-destructive">
          {followUpError}
        </p>
      ) : null}
      {followed && !followUpError ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          {followUpNote ? <p className="text-sm leading-6 break-words text-paper/75">{followUpNote}</p> : null}
          {added.length > 0 ? (
            <>
              <h3 className="text-sm font-medium text-paper/80">New findings</h3>
              <ul className="flex flex-col gap-1.5">
                {added.map((claim) => (
                  <li key={claim.id}>
                    <button
                      type="button"
                      className="w-full cursor-pointer rounded-lg border border-paper/20 px-3 py-2 text-left text-sm leading-5 break-words text-paper hover:border-golden/60 focus-visible:ring-2 focus-visible:ring-golden focus-visible:outline-none"
                      onClick={() => selectNode(claimNodeId(claim.id))}
                    >
                      {claim.text}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm leading-6 text-paper/75">No new findings were added.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
