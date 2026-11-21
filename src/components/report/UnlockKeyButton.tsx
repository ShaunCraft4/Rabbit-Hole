"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ApiClientError } from "@/lib/client/api";
import { runReport } from "@/lib/client/runner";
import type { Branch, BranchStatus } from "@/lib/types";
import type { Phase } from "@/stores/investigation";
import { useInvestigationStore } from "@/stores/investigation";

const SETTLED: ReadonlySet<BranchStatus> = new Set(["done", "failed"]);

function lockMessage(branches: Branch[], phase: Phase): string | null {
  const settled = branches.length > 0 && branches.every((branch) => SETTLED.has(branch.status));
  const analyzed = phase === "analyzed" || phase === "reported";
  if (settled && analyzed) return null;
  if (!settled && !analyzed) {
    return "The Golden Key stays locked until every door has settled and the analysis is finished.";
  }
  if (!settled) return "The Golden Key stays locked until every door has finished searching.";
  return "The Golden Key stays locked until the analysis is finished.";
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "The Golden Key could not be written. Try again in a moment.";
}

export function UnlockKeyButton() {
  const router = useRouter();
  const investigation = useInvestigationStore((state) => state.investigation);
  const phase = useInvestigationStore((state) => state.phase);
  const [unlocking, setUnlocking] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (!investigation) return null;

  const locked = lockMessage(investigation.branches, phase);
  const disabled = Boolean(locked) || unlocking;

  async function onUnlock() {
    if (pending.current || locked) return;
    pending.current = true;
    setUnlocking(true);
    setError(null);
    setTooltipOpen(false);
    try {
      await runReport();
      router.push("/report");
    } catch (caught) {
      if (mounted.current) setError(errorMessage(caught));
    } finally {
      pending.current = false;
      if (mounted.current) setUnlocking(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Tooltip open={locked ? tooltipOpen : false} onOpenChange={setTooltipOpen}>
        <TooltipTrigger asChild>
          <span className={`flex w-full ${locked ? "cursor-not-allowed" : ""}`}>
            <Button
              type="button"
              size="lg"
              className="h-11 w-full cursor-pointer text-base shadow-[0_0_24px_rgb(214_183_107/0.35)]"
              disabled={disabled}
              aria-busy={unlocking}
              aria-describedby={locked ? "golden-key-lock" : undefined}
              onClick={() => void onUnlock()}
            >
              {unlocking ? "Unlocking the Golden Key…" : "Unlock the Golden Key"}
            </Button>
          </span>
        </TooltipTrigger>
        {locked ? (
          <TooltipContent side="top" sideOffset={8}>
            {locked}
          </TooltipContent>
        ) : null}
      </Tooltip>

      {unlocking ? (
        <p role="status" className="text-xs leading-5 text-paper/70">
          Writing the report from the verified findings. This usually takes a short while.
        </p>
      ) : locked ? (
        <p id="golden-key-lock" className="text-xs leading-5 text-paper/70">
          {locked}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
