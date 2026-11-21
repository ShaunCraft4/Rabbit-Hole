"use client";

import { createContext, useContext } from "react";

export type SkillTreeUi = {
  openNode: (id: string) => void;
  setHoveredId: (id: string | null) => void;
  /** Finding and gap labels stay visible at this zoom. Key discoveries always do. */
  showMinorLabels: boolean;
};

const SkillTreeUiContext = createContext<SkillTreeUi | null>(null);

export const SkillTreeUiProvider = SkillTreeUiContext.Provider;

export function useSkillTreeUi(): SkillTreeUi {
  const value = useContext(SkillTreeUiContext);
  if (!value) {
    throw new Error("Skill tree controls are only available on the map");
  }
  return value;
}
