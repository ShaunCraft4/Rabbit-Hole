"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

import { DreamBackdrop } from "@/components/DreamBackdrop";
import { DreamScene } from "@/components/DreamScene";
import { ReportDocument } from "@/components/report/ReportDocument";
import { useInvestigationStore } from "@/stores/investigation";

import styles from "./wake.module.css";

let rehydrateStarted = false;

function subscribeHydration(onStoreChange: () => void): () => void {
  return useInvestigationStore.persist.onFinishHydration(onStoreChange);
}

function hydrationSnapshot(): boolean {
  return useInvestigationStore.persist.hasHydrated();
}

function hydrationServerSnapshot(): boolean {
  return false;
}

function useInvestigationHydrated(): boolean {
  const hydrated = useSyncExternalStore(subscribeHydration, hydrationSnapshot, hydrationServerSnapshot);

  useEffect(() => {
    if (useInvestigationStore.persist.hasHydrated() || rehydrateStarted) return;
    rehydrateStarted = true;
    void useInvestigationStore.persist.rehydrate();
  }, []);

  return hydrated;
}

export default function ReportPage() {
  const router = useRouter();
  const hydrated = useInvestigationHydrated();
  const investigation = useInvestigationStore((state) => state.investigation);
  const savedExample = useInvestigationStore((state) => state.savedExample);
  const report = investigation?.report;

  useEffect(() => {
    if (!hydrated) return;
    if (!report) router.replace("/dream");
  }, [hydrated, report, router]);

  if (!hydrated || !investigation || !report) {
    return (
      <div className="min-h-dvh" aria-busy="true">
        <p className="sr-only">Loading the Golden Key</p>
      </div>
    );
  }

  return (
    <>
    <DreamBackdrop />
    <DreamScene className="flex flex-1 flex-col">
    <div className={styles.wake}>
      <div className={`${styles.key} print:hidden`} aria-hidden>
        <svg width="54" height="54" viewBox="0 0 64 64" fill="none">
          <circle cx="24" cy="26" r="12" stroke="currentColor" strokeWidth="3" />
          <path d="M34 26h20M44 26v10M50 26v6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      </div>
      {savedExample ? (
        <p className="mx-auto w-full max-w-3xl px-5 pt-4 text-sm text-paper print:hidden">
          Saved example. This Golden Key was recorded earlier, not written just now.
        </p>
      ) : null}
      <ReportDocument investigation={investigation} report={report} />
    </div>
    </DreamScene>
    </>
  );
}
