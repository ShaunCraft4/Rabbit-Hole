import { ViewTransition, type ReactNode } from "react";

/**
 * Dream transitions between pages. A navigation names one of these types (on <Link
 * transitionTypes> or router.push({ transitionTypes })); the page being left plays the matching
 * exit (CSS in globals.css), while the page arriving plays its own CSS entrance.
 *
 *   sink     deeper into the dream (entrance -> map, Golden Key -> map): the old page floats up
 *            and blurs away as you fall.
 *   surface  back up to the entrance ("Ask another question"): the dream sinks into mist.
 *   wake     into the Golden Key: the map melts into golden light.
 */
export const DREAM = {
  sink: "dream-sink",
  surface: "dream-surface",
  wake: "dream-wake",
} as const;

const EXIT = {
  [DREAM.sink]: DREAM.sink,
  [DREAM.surface]: DREAM.surface,
  [DREAM.wake]: DREAM.wake,
  default: "none",
};

/** Wraps a page so it dissolves dreamily when a typed navigation leaves it. */
export function DreamScene({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ViewTransition exit={EXIT} enter="none" default="none">
      <div className={className}>{children}</div>
    </ViewTransition>
  );
}
