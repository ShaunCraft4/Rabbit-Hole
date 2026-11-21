import type { RegionColor } from "@/lib/skilltree";

/** CSS variable for a region color. Gaps with no region use paper. */
export function regionVar(color: RegionColor | null): string {
  return color ? `var(--region-${color})` : "var(--paper)";
}
