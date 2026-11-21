import type { Metadata } from "next";
import { Suspense } from "react";

import { UnlockKeyButton } from "@/components/report/UnlockKeyButton";

import { DreamWorkspace, SelectNodeFromUrl } from "./dream-client";

export const metadata: Metadata = {
  title: "The dream",
};

export default function DreamPage() {
  return (
    <>
      <Suspense fallback={null}>
        <SelectNodeFromUrl />
      </Suspense>
      <DreamWorkspace goldenKey={<UnlockKeyButton />} />
    </>
  );
}
