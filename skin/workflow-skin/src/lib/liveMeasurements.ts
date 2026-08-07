import type { ShotSnapshot } from "../api/types";
import type { ShotLifecycle } from "./shotLifecycle";

// The machine and scale WebSockets can jointly deliver roughly 20 samples a
// second. Keep enough samples for a six-minute extraction instead of turning
// the live chart into a roughly ten-second sliding window.
export const MAX_LIVE_SAMPLES = 7200;

export function shouldClearForShotStart(
  lifecycle: Pick<ShotLifecycle, "shotId" | "state">,
  activeShotId: string | null,
  machineBrewing: boolean
): boolean {
  return (
    Boolean(lifecycle.shotId) &&
    lifecycle.shotId !== activeShotId &&
    lifecycle.state === "preheating" &&
    !machineBrewing
  );
}

export function appendLiveMeasurement(
  measurements: ShotSnapshot[],
  nextMeasurement: ShotSnapshot,
  resetForNewBrew = false,
  maxSamples = MAX_LIVE_SAMPLES
): ShotSnapshot[] {
  const base = resetForNewBrew ? [] : measurements;
  return [...base.slice(-(maxSamples - 1)), nextMeasurement];
}
