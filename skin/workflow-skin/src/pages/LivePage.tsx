import type { JsonMap, ProfileRecord, ShotRecord, ShotSnapshot, WeightSnapshot, Workflow } from "../api/types";
import { MetricTile } from "../components/MetricTile";
import { machineStateLabel } from "../lib/machineState";
import { ShotGraph } from "../components/ShotGraph";
import { trimLiveGraphWarmup } from "../lib/liveMeasurements";
import { shotStats } from "../lib/shotStats";
import { useEffect, useRef } from "react";

function formatSeconds(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "—";
}

function formatLiveNumber(value: number | null | undefined): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : null;
}

function latestMeasurement(measurements: ShotSnapshot[]): ShotSnapshot | undefined {
  return measurements.length ? measurements[measurements.length - 1] : undefined;
}

function scaleTimerSeconds(scaleSnapshot: WeightSnapshot | null): number | null {
  return typeof scaleSnapshot?.timerValue === "number" && Number.isFinite(scaleSnapshot.timerValue)
    ? Math.round(scaleSnapshot.timerValue / 1000)
    : null;
}

function liveWeight(measurements: ShotSnapshot[], scaleSnapshot: WeightSnapshot | null): number | null {
  if (typeof scaleSnapshot?.weight === "number" && Number.isFinite(scaleSnapshot.weight)) return scaleSnapshot.weight;
  const weight = latestMeasurement(measurements)?.scale?.weight;
  return typeof weight === "number" && Number.isFinite(weight) ? weight : null;
}

function liveFlow(measurements: ShotSnapshot[], scaleSnapshot: WeightSnapshot | null): number | null {
  if (typeof scaleSnapshot?.weightFlow === "number" && Number.isFinite(scaleSnapshot.weightFlow)) return scaleSnapshot.weightFlow;
  const flow = latestMeasurement(measurements)?.machine?.flow;
  return typeof flow === "number" && Number.isFinite(flow) ? flow : null;
}

function profileName(activeProfile: ProfileRecord | undefined, workflow: Workflow): string {
  return activeProfile?.profile.title ?? workflow.profile?.title ?? "Selected profile";
}

function numericStepValue(step: JsonMap | undefined, key: string): number | null {
  const value = step?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringStepValue(step: JsonMap | undefined, key: string): string | null {
  const value = step?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedStepMap(step: JsonMap, key: string): JsonMap | null {
  const value = step[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonMap) : null;
}

function nestedNumberValue(value: JsonMap | null, key: string): number | null {
  const item = value?.[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function nestedStringValue(value: JsonMap | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === "string" && item.trim() ? item.trim() : null;
}

function profileSteps(activeProfile: ProfileRecord | undefined, workflow: Workflow): JsonMap[] {
  return activeProfile?.profile.steps ?? workflow.profile?.steps ?? [];
}

function currentStepInfo(steps: JsonMap[], elapsedSeconds: number | null) {
  if (steps.length === 0) return null;
  const elapsed = elapsedSeconds ?? 0;
  let endAt = 0;

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    endAt += numericStepValue(step, "seconds") ?? 0;
    if (elapsed <= endAt || index === steps.length - 1) {
      const startsAt = endAt - (numericStepValue(step, "seconds") ?? 0);
      return { step, index, startsAt, endAt };
    }
  }

  return null;
}

function goalLine(step: JsonMap, time: number | null): string {
  const pump = stringStepValue(step, "pump");
  const pressure = numericStepValue(step, "pressure");
  const flow = numericStepValue(step, "flow");
  const temperature = numericStepValue(step, "temperature");
  const weight = numericStepValue(step, "weight");
  const exit = nestedStepMap(step, "exit");
  const exitType = nestedStringValue(exit, "type");
  const exitCondition = nestedStringValue(exit, "condition");
  const exitValue = nestedNumberValue(exit, "value");
  const limiter = nestedStepMap(step, "limiter");
  const limiterValue = nestedNumberValue(limiter, "value");
  const limiterRange = nestedNumberValue(limiter, "range");
  const goals = [
    pressure !== null ? `Pressure ${pressure.toFixed(2)} bar` : null,
    flow !== null ? `Flow ${flow.toFixed(2)} mL/s` : null,
    temperature !== null ? `Temp ${temperature.toFixed(2)} °C` : null,
    weight !== null && weight > 0 ? `Weight ${weight.toFixed(2)} g` : null,
    exitType && exitCondition && exitValue !== null ? `Exit ${exitType} ${exitCondition} ${exitValue.toFixed(2)}` : null,
    limiterValue !== null && limiterRange !== null ? `Limiter ${limiterValue.toFixed(2)} +/- ${limiterRange.toFixed(2)}` : null,
    time !== null ? `Ends at ${Math.round(time)}s` : null
  ].filter(Boolean);

  return [pump ? `${pump[0].toUpperCase()}${pump.slice(1)} pump` : null, ...goals].filter(Boolean).join(" · ");
}

export function LivePage({
  workflow,
  activeProfile,
  latestShot,
  liveMeasurements,
  scaleSnapshot
}: {
  workflow: Workflow;
  activeProfile?: ProfileRecord;
  latestShot: ShotRecord | null;
  liveMeasurements: ShotSnapshot[];
  scaleSnapshot: WeightSnapshot | null;
}) {
  const rawMeasurements = liveMeasurements.length ? liveMeasurements : latestShot?.measurements ?? [];
  const measurements = trimLiveGraphWarmup(rawMeasurements);
  const stats = latestShot ? shotStats({ ...latestShot, measurements }) : shotStats({ id: "live", timestamp: new Date().toISOString(), workflow, measurements });
  const latest = latestMeasurement(measurements);
  const weight = liveWeight(measurements, scaleSnapshot) ?? stats.finalYield;
  const time = stats.durationSeconds ?? scaleTimerSeconds(scaleSnapshot);
  const pressure = latest?.machine?.pressure ?? stats.averagePressure;
  const flow = liveFlow(measurements, scaleSnapshot) ?? stats.averageFlow;
  const waitingForData = measurements.length === 0 && !scaleSnapshot;
  const steps = profileSteps(activeProfile, workflow);
  const stepInfo = currentStepInfo(steps, time);
  const stepPanelRef = useRef<HTMLElement | null>(null);
  const focusedStepPanelRef = useRef(false);

  useEffect(() => {
    if (focusedStepPanelRef.current || !stepInfo || !stepPanelRef.current) return;
    focusedStepPanelRef.current = true;
    if (typeof stepPanelRef.current.scrollIntoView === "function") {
      stepPanelRef.current.scrollIntoView({ block: "start", inline: "nearest" });
    }
  }, [stepInfo]);

  return (
    <div className="live-grid">
      <section className="panel wide live-hero">
        <div>
          <span className="eyebrow">{profileName(activeProfile, workflow)}</span>
          <h2>Live Brew</h2>
          {waitingForData && <p className="muted live-waiting">Waiting for live espresso data</p>}
        </div>
        <div className="live-primary-stats">
          <MetricTile label="Weight" value={formatLiveNumber(weight)} unit="g" />
          <MetricTile label="Shot Timer" value={formatSeconds(time)} unit="s" />
        </div>
      </section>
      {stepInfo && (
        <section className="panel wide live-step-panel" ref={stepPanelRef}>
          <div className="live-step-heading">
            <div>
              <span className="eyebrow">Step {stepInfo.index + 1} of {steps.length}</span>
              <h2>Step</h2>
            </div>
            <strong>{stringStepValue(stepInfo.step, "name") ?? `Step ${stepInfo.index + 1}`}</strong>
          </div>
          <div className="live-step-goals" aria-label="Current step goals">
            {goalLine(stepInfo.step, stepInfo.endAt)
              .split(" · ")
              .map((goal) => (
                <span key={goal}>{goal}</span>
              ))}
          </div>
          <span className="muted">
            {stringStepValue(stepInfo.step, "transition") ?? "fast"} transition · {stringStepValue(stepInfo.step, "sensor") ?? "coffee"} sensor
          </span>
        </section>
      )}
      <section className="panel wide dark-graph-panel">
        <ShotGraph measurements={measurements} />
      </section>
      <section className="panel">
        <h2>Live Details</h2>
        <MetricTile label="Pressure" value={formatLiveNumber(pressure)} unit="bar" />
        <MetricTile label="Flow" value={formatLiveNumber(flow)} unit="g/s" />
        <MetricTile label="Target Dose" value={workflow.context?.targetDoseWeight ?? null} unit="g" />
        <MetricTile label="Target Yield" value={workflow.context?.targetYield ?? workflow.profile?.target_weight ?? null} unit="g" />
      </section>
      <section className="panel">
        <h2>Machine</h2>
        <MetricTile label="State" value={latest?.machine?.state?.state ? machineStateLabel(latest.machine.state.state, latest.machine.state.substate, latest.machine) : "Waiting"} />
        <MetricTile label="Substate" value={latest?.machine?.state?.substate ? machineStateLabel(latest.machine.state.substate) : "—"} />
        <MetricTile label="Group Temp" value={formatLiveNumber(latest?.machine?.groupTemperature)} unit="°C" />
        <MetricTile label="Mix Temp" value={formatLiveNumber(latest?.machine?.mixTemperature)} unit="°C" />
      </section>
    </div>
  );
}
