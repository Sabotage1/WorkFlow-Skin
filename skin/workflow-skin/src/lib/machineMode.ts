export type WorkflowMachineActivity = "brew" | "steam";

export interface MachineModeSnapshot {
  state?: string;
  substate?: string;
}

function normalizedSnapshot(snapshot: MachineModeSnapshot | null | undefined): MachineModeSnapshot | null {
  if (!snapshot || (!snapshot.state && !snapshot.substate)) return null;
  return {
    ...(snapshot.state ? { state: snapshot.state } : {}),
    ...(snapshot.substate ? { substate: snapshot.substate } : {})
  };
}

export function resolveMachineModeSnapshot({
  fast,
  live,
  liveConnected,
  fallback
}: {
  fast?: MachineModeSnapshot | null;
  live?: MachineModeSnapshot | null;
  liveConnected: boolean;
  fallback?: MachineModeSnapshot | null;
}): MachineModeSnapshot {
  return normalizedSnapshot(fast) ?? (liveConnected ? normalizedSnapshot(live) : null) ?? normalizedSnapshot(fallback) ?? {};
}

export function compactMachineMode(state: string | undefined): string {
  return state?.trim().toLowerCase().replace(/[^a-z]/g, "") ?? "";
}

export function isBrewingMode(state: string | undefined): boolean {
  const mode = compactMachineMode(state);
  return mode === "espresso" || mode === "brewing";
}

export function isSteamingMode(state: string | undefined): boolean {
  const mode = compactMachineMode(state);
  return mode === "steam" || mode === "steaming" || mode.includes("steam");
}

export function isIdleMode(state: string | undefined): boolean {
  return compactMachineMode(state) === "idle";
}

export function isSleepingMode(state: string | undefined): boolean {
  return compactMachineMode(state) === "sleeping";
}

export function workflowActivityForMode(state: string | undefined): WorkflowMachineActivity | null {
  if (isBrewingMode(state)) return "brew";
  if (isSteamingMode(state)) return "steam";
  return null;
}

export function shouldPollMachineState({
  currentMode,
  liveMode,
  hasCompletedActivity
}: {
  currentMode: string | undefined;
  liveMode?: string | undefined;
  hasCompletedActivity: boolean;
}): boolean {
  return Boolean(workflowActivityForMode(currentMode) || workflowActivityForMode(liveMode) || hasCompletedActivity);
}
