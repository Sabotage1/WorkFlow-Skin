export type ShotLifecycleState = "idle" | "preheating" | "pouring" | "stopping" | "finished";

export interface ShotLifecycle {
  event?: string;
  timestamp?: string;
  shotId?: string | null;
  state: ShotLifecycleState;
  machineState?: string | null;
  machineSubstate?: string | null;
  scaleConnected?: boolean;
  scaleLost?: boolean;
  machineHasAutonomousSAW?: boolean;
}

const SHOT_LIFECYCLE_STATES = new Set<ShotLifecycleState>(["idle", "preheating", "pouring", "stopping", "finished"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseShotLifecycle(value: unknown): ShotLifecycle | null {
  if (!isRecord(value) || typeof value.state !== "string" || !SHOT_LIFECYCLE_STATES.has(value.state as ShotLifecycleState)) {
    return null;
  }

  return {
    event: typeof value.event === "string" ? value.event : undefined,
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    shotId: typeof value.shotId === "string" || value.shotId === null ? value.shotId : undefined,
    state: value.state as ShotLifecycleState,
    machineState: typeof value.machineState === "string" || value.machineState === null ? value.machineState : undefined,
    machineSubstate: typeof value.machineSubstate === "string" || value.machineSubstate === null ? value.machineSubstate : undefined,
    scaleConnected: typeof value.scaleConnected === "boolean" ? value.scaleConnected : undefined,
    scaleLost: typeof value.scaleLost === "boolean" ? value.scaleLost : undefined,
    machineHasAutonomousSAW: typeof value.machineHasAutonomousSAW === "boolean" ? value.machineHasAutonomousSAW : undefined
  };
}

export function isActiveShotLifecycle(value: ShotLifecycle | null | undefined): boolean {
  return value?.state === "preheating" || value?.state === "pouring" || value?.state === "stopping";
}

export function isFinishedShotLifecycle(value: ShotLifecycle | null | undefined): boolean {
  return value?.state === "finished";
}

export function retainLatestFinishedShotLifecycle(
  current: ShotLifecycle | null,
  next: ShotLifecycle
): ShotLifecycle | null {
  return isFinishedShotLifecycle(next) ? next : current;
}
