"use client";

import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";

import "sonner/dist/styles.css";

import { HistorySync } from "./history/HistorySync";

export function AppChrome({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <HistorySync />
      {children}
      <Toaster
        theme="dark"
        position="bottom-center"
        closeButton
        toastOptions={{
          style: {
            background: "#2A1E4D",
            color: "#E5E1F0",
            border: "1px solid rgba(229, 225, 240, 0.28)",
          },
        }}
      />
    </MotionConfig>
  );
}
