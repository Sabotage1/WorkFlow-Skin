import type { ShotRecord, ShotSnapshot, WorkflowContext } from "../api/types";

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function shotContext(shot: ShotRecord): WorkflowContext | undefined {
  const workflow = (shot as { workflow?: { context?: WorkflowContext } | null }).workflow;
  if (!workflow || typeof workflow !== "object") return undefined;
  return workflow.context;
}

export function shotStats(shot: ShotRecord) {
  const measurements = shot.measurements ?? [];
  const timestamps = measurements
    .map((sample) => sample.machine?.timestamp)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const durationSeconds = timestamps.length >= 2 ? Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000) : null;
  const pressures = measurements.map((sample) => sample.machine?.pressure).filter((value): value is number => typeof value === "number");
  const flows = measurements.map((sample) => sample.machine?.flow).filter((value): value is number => typeof value === "number");
  const weights = measurements.map((sample) => sample.scale?.weight).filter((value): value is number => typeof value === "number" && value > 0);
  return {
    durationSeconds,
    peakPressure: pressures.length ? Math.max(...pressures) : null,
    averagePressure: average(pressures),
    peakFlow: flows.length ? Math.max(...flows) : null,
    averageFlow: average(flows),
    finalYield: shot.annotations?.actualYield ?? (weights.length ? weights[weights.length - 1] : null)
  };
}

export function previousFiveForBag(shots: ShotRecord[], beanBatchId: string, currentShotId?: string): ShotRecord[] {
  return shots
    .filter((shot) => shot.id !== currentShotId && shotContext(shot)?.beanBatchId === beanBatchId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);
}

export function grindSizeFromShot(shot: ShotRecord): string | undefined {
  const extras = shot.annotations?.extras;
  const workflowSkin = extras?.workflowSkin as { grindSize?: string } | undefined;
  return workflowSkin?.grindSize ?? shotContext(shot)?.grinderSetting;
}

export function graphSeries(measurements: ShotSnapshot[]) {
  return measurements.map((sample, index) => ({
    index,
    pressure: sample.machine?.pressure ?? 0,
    targetPressure: sample.machine?.targetPressure ?? 0,
    flow: sample.machine?.flow ?? 0,
    targetFlow: sample.machine?.targetFlow ?? 0,
    weight: sample.scale?.weight ?? 0
  }));
}
