import type { MachineState, ShotSnapshot } from "../api/types";

type MachineTelemetry = Pick<
  MachineState,
  "groupTemperature" | "mixTemperature" | "targetGroupTemperature" | "targetMixTemperature" | "steamTemperature"
>;

function compact(value: string | undefined): string {
  return value?.replace(/[\s_-]/g, "").toLowerCase() ?? "";
}

function firstTemperature(...values: Array<number | undefined>): number | null {
  return values.find((value) => typeof value === "number" && Number.isFinite(value) && value > 0) ?? null;
}

function titleCase(value: string): string {
  const spaced = value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "Idle";
  return spaced
    .split(/\s+/)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function isHeating(rawState: string | undefined, rawSubstate: string | undefined, _telemetry?: MachineTelemetry): boolean {
  const state = compact(rawState);
  const substate = compact(rawSubstate);
  return state.includes("heating") || state.includes("heatup") || substate.includes("heating") || substate.includes("heatup") || substate.includes("warm");
}

export function machineStateLabel(rawState: string | undefined, rawSubstate?: string, telemetry?: MachineTelemetry): string {
  const state = compact(rawState);
  if (!state) return "Idle";
  if (isHeating(rawState, rawSubstate, telemetry)) return "Heating";

  if (state === "preparingforshot") return "Heating";
  if (state === "espresso" || state === "brewing") return "Brew";
  if (state === "steam" || state === "steaming" || state.includes("steam")) return "Steam";
  if (state === "sleeping") return "Sleep";
  if (state === "refillrequired") return "Refill";
  if (state === "hotwater" || state === "hotwaterrinse") return "Water";
  if (state === "flush" || state === "flushing") return "Flush";

  return titleCase(rawState ?? "");
}

export function machineModeLabel(machineState: MachineState | null, liveMachine: ShotSnapshot["machine"] | undefined): string {
  const state = liveMachine?.state?.state ?? machineState?.state?.state;
  const substate = liveMachine?.state?.substate ?? machineState?.state?.substate;
  if (!state) return machineState?.connected === false ? "Disconnected" : "Idle";
  const stateLabel = machineStateLabel(state, substate, liveMachine ?? machineState ?? undefined);
  if (stateLabel === "Heating" || !substate || compact(state) === "preparingforshot") return stateLabel;
  const compactSubstate = compact(substate);
  if (!compactSubstate || compactSubstate === "idle" || compactSubstate === compact(state)) return stateLabel;
  return titleCase(substate);
}

export function machineTemperature(machineState: MachineState | null, liveMachine: ShotSnapshot["machine"] | undefined): number | null {
  const state = compact(liveMachine?.state?.state ?? machineState?.state?.state);
  if (state === "idle" || state === "ready" || state === "schedidle") {
    return firstTemperature(
      liveMachine?.targetGroupTemperature,
      machineState?.targetGroupTemperature,
      liveMachine?.targetMixTemperature,
      machineState?.targetMixTemperature,
      liveMachine?.groupTemperature,
      machineState?.groupTemperature,
      liveMachine?.mixTemperature,
      machineState?.mixTemperature,
      machineState?.steamTemperature
    );
  }
  return firstTemperature(
    liveMachine?.groupTemperature,
    machineState?.groupTemperature,
    liveMachine?.mixTemperature,
    machineState?.mixTemperature,
    machineState?.steamTemperature
  );
}
