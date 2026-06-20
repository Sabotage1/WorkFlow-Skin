import type { ShotSnapshot } from "../api/types";

export const LIVE_GRAPH_WARMUP_MS = 3000;
export const MAX_LIVE_SAMPLES = 180;

function snapshotTimestampMs(snapshot: ShotSnapshot): number | null {
  const timestamp = snapshot.machine?.timestamp ?? snapshot.scale?.timestamp;
  if (!timestamp) return null;

  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

export function trimLiveGraphWarmup(measurements: ShotSnapshot[]): ShotSnapshot[] {
  const startTimestamp = measurements.map(snapshotTimestampMs).find((timestamp): timestamp is number => timestamp !== null);

  if (startTimestamp === undefined) return measurements;

  return measurements.filter((snapshot) => {
    const timestamp = snapshotTimestampMs(snapshot);
    return timestamp === null || timestamp - startTimestamp >= LIVE_GRAPH_WARMUP_MS;
  });
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
