"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";

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
    <div className={styles.wake}>
      <ReportDocument investigation={investigation} report={report} />
    </div>
  );
}
