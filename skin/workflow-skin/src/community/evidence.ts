import type { ShotRecord, ShotSnapshot } from "../api/types";
import { grindSizeFromShot } from "../lib/shotStats";
import type { CommunityShotEvidence } from "./types";

function setDefined(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

function sanitizeMeasurement(measurement: ShotSnapshot): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  if (measurement.machine) {
    const machine: Record<string, unknown> = {};
    setDefined(machine, "timestamp", measurement.machine.timestamp);
    setDefined(machine, "pressure", measurement.machine.pressure);
    setDefined(machine, "targetPressure", measurement.machine.targetPressure);
    setDefined(machine, "flow", measurement.machine.flow);
    setDefined(machine, "targetFlow", measurement.machine.targetFlow);
    setDefined(machine, "mixTemperature", measurement.machine.mixTemperature);
    setDefined(machine, "groupTemperature", measurement.machine.groupTemperature);
    setDefined(machine, "targetMixTemperature", measurement.machine.targetMixTemperature);
    setDefined(machine, "targetGroupTemperature", measurement.machine.targetGroupTemperature);

    if (measurement.machine.state) {
      const state: Record<string, unknown> = {};
      setDefined(state, "state", measurement.machine.state.state);
      setDefined(state, "substate", measurement.machine.state.substate);
      if (Object.keys(state).length) machine.state = state;
    }

    if (Object.keys(machine).length) sanitized.machine = machine;
  }

  if (measurement.scale) {
    const scale: Record<string, unknown> = {};
    setDefined(scale, "timestamp", measurement.scale.timestamp);
    setDefined(scale, "weight", measurement.scale.weight);
    setDefined(scale, "weightFlow", measurement.scale.weightFlow);
    setDefined(scale, "battery", measurement.scale.battery);
    setDefined(scale, "timerValue", measurement.scale.timerValue);
    if (Object.keys(scale).length) sanitized.scale = scale;
  }

  return sanitized;
}

function contextWorkflowSkinGrindSize(shot: ShotRecord): string | undefined {
  const workflowSkin = shot.workflow.context?.extras?.workflowSkin;
  if (!workflowSkin || typeof workflowSkin !== "object" || Array.isArray(workflowSkin)) return undefined;
  const grindSize = (workflowSkin as { grindSize?: unknown }).grindSize;
  return typeof grindSize === "string" && grindSize.trim() ? grindSize.trim() : undefined;
}

export function sanitizeShotEvidence(shot: ShotRecord): CommunityShotEvidence {
  return {
    id: shot.id,
    timestamp: shot.timestamp,
    profileTitle: shot.workflow.profile?.title,
    doseWeight: shot.annotations?.actualDoseWeight,
    drinkWeight: shot.annotations?.actualYield,
    tds: shot.annotations?.drinkTds,
    ey: shot.annotations?.drinkEy,
    enjoyment: shot.annotations?.enjoyment,
    notes: shot.annotations?.espressoNotes ?? shot.shotNotes,
    grindSetting: grindSizeFromShot(shot) ?? contextWorkflowSkinGrindSize(shot),
    grinderId: shot.workflow.context?.grinderId,
    measurements: shot.measurements?.map(sanitizeMeasurement)
  };
}
