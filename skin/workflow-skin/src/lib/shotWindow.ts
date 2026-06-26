import type { ShotSnapshot } from "../api/types";

const BREW_SUBSTATES = new Set(["preinfusion", "pouring"]);

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseTimestampMs(timestamp: string | undefined): number | null {
  if (!timestamp) return null;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : null;
}

export function machineTimestampMs(measurement: ShotSnapshot): number | null {
  return parseTimestampMs(measurement.machine?.timestamp);
}

export function scaleTimestampMs(measurement: ShotSnapshot): number | null {
  return parseTimestampMs(measurement.scale?.timestamp);
}

export function preferredTimestampMs(measurement: ShotSnapshot): number | null {
  return machineTimestampMs(measurement) ?? scaleTimestampMs(measurement);
}

function brewSubstate(measurement: ShotSnapshot): string | null {
  const value = measurement.machine?.state?.substate;
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function activeBrewSample(measurement: ShotSnapshot): boolean {
  const pressure = numeric(measurement.machine?.pressure) ?? 0;
  const flow = numeric(measurement.machine?.flow) ?? 0;
  const weightFlow = numeric(measurement.scale?.weightFlow) ?? 0;
  return pressure > 1.5 || flow > 0.2 || Math.abs(weightFlow) > 0.2;
}

export function shotGraphMeasurements(measurements: ShotSnapshot[]): ShotSnapshot[] {
  const brewingSamples = measurements.filter((measurement) => {
    const substate = brewSubstate(measurement);
    return substate !== null && BREW_SUBSTATES.has(substate);
  });
  if (brewingSamples.length > 0) return brewingSamples;

  const activeSamples = measurements.filter(activeBrewSample);
  return activeSamples.length > 1 ? activeSamples : measurements;
}

export function shotWindowDurationSeconds(measurements: ShotSnapshot[]): number | null {
  const timestamps = shotGraphMeasurements(measurements)
    .map(preferredTimestampMs)
    .filter((value): value is number => value !== null);
  if (timestamps.length < 2) return null;
  return Math.round(((timestamps[timestamps.length - 1] - timestamps[0]) / 1000) * 10) / 10;
}
