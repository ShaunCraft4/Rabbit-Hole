import type { Metadata } from "next";
import { Suspense } from "react";

import { DreamScene } from "@/components/DreamScene";
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
      <DreamScene className="flex flex-1 flex-col">
        <DreamWorkspace goldenKey={<UnlockKeyButton />} />
      </DreamScene>
    </>
  );
}
