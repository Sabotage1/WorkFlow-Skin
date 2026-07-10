import type { MachineState, ProfileRecord, ShotRecord, WeightSnapshot, Workflow } from "../api/types";
import {
  hotWaterSafetyDurationSeconds,
  type DrinkWorkflow,
  type DrinkWorkflowRunState,
  type DrinkWorkflowStep
} from "./drinkWorkflows";

const STATE_POLL_INTERVAL_MS = 400;
const STATE_START_TIMEOUT_MS = 120_000;
const SHOT_PERSIST_TIMEOUT_MS = 8_000;
const TARE_SETTLE_MS = 600;
const BETWEEN_STEPS_SETTLE_MS = 900;
const HOT_WATER_SCALE_POLL_MS = 250;
const HOT_WATER_WEIGHT_LOOKAHEAD_SECONDS = 0.3;
const HOT_WATER_FLOW_ML_PER_SECOND = 6;
const STEAM_FLOW = 0.8;
const ABNORMAL_SHOT_STOP_REASONS = new Set(["apiStop", "appStop", "noScale", "error", "disconnected"]);

export interface DrinkWorkflowRunnerApi {
  getWorkflow(): Promise<Workflow>;
  updateWorkflow(patch: Partial<Workflow>): Promise<Workflow>;
  getMachineState(): Promise<MachineState>;
  getLatestShot(): Promise<ShotRecord | null>;
  tareScale(): Promise<void>;
  requestMachineState(state: string): Promise<void>;
}

export interface RunDrinkWorkflowOptions {
  api: DrinkWorkflowRunnerApi;
  workflow: DrinkWorkflow;
  profiles: ProfileRecord[];
  isCanceled: () => boolean;
  onState: (state: DrinkWorkflowRunState) => void;
  onBrewProfileSelected?: (profileId: string) => void;
  onWorkflowUpdated?: (workflow: Workflow) => void;
  getScaleSnapshot?: () => WeightSnapshot | null;
}

export interface DrinkWorkflowRunResult {
  brewShots: ShotRecord[];
}

export class DrinkWorkflowCanceledError extends Error {
  constructor() {
    super("Work Flow canceled.");
    this.name = "DrinkWorkflowCanceledError";
  }
}

interface BrewStartMarker {
  previousShotId: string | null;
  startedAt: number;
}

function compactMode(value: string | undefined): string {
  return value?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
}

function modeFromMachineState(state: MachineState): string {
  return compactMode(state.state?.state);
}

function isIdleMode(mode: string): boolean {
  return mode === "idle" || mode === "ready";
}

function activeModeForStep(step: DrinkWorkflowStep): string {
  if (step.type === "brew") return "espresso";
  if (step.type === "hotWater") return "hotwater";
  return "steam";
}

function matchesActiveMode(mode: string, expectedMode: string): boolean {
  if (expectedMode === "espresso") return mode === "espresso" || mode === "brewing";
  if (expectedMode === "steam") return mode === "steam" || mode === "steaming";
  return mode === expectedMode;
}

function stepName(step: DrinkWorkflowStep): string {
  if (step.type === "brew") return "Brew Profile";
  if (step.type === "hotWater") return "Hot Water";
  return "Steam Milk";
}

function completionTimeoutMs(step: DrinkWorkflowStep): number {
  if (step.type === "brew") return 10 * 60_000;
  if (step.type === "hotWater") return (hotWaterSafetyDurationSeconds(step.volumeMl) + 30) * 1000;
  return (step.durationSeconds + 20) * 1000;
}

function requiresScaleTare(step: DrinkWorkflowStep): boolean {
  return step.type === "brew" || step.type === "hotWater";
}

function assertNotCanceled(isCanceled: () => boolean): void {
  if (isCanceled()) throw new DrinkWorkflowCanceledError();
}

async function wait(milliseconds: number, isCanceled: () => boolean): Promise<void> {
  const endAt = Date.now() + milliseconds;
  while (Date.now() < endAt) {
    assertNotCanceled(isCanceled);
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, endAt - Date.now())));
  }
}

function assertMachineCanContinue(state: MachineState): void {
  if (state.connected === false) throw new Error("Machine disconnected during the Work Flow.");
  const mode = modeFromMachineState(state);
  if (mode === "needswater") throw new Error("Refill the water tank before continuing the Work Flow.");
  if (mode === "error") throw new Error("The machine entered an error state.");
  if (mode === "sleeping") throw new Error("The machine went to sleep during the Work Flow.");
}

async function waitForMode(
  api: DrinkWorkflowRunnerApi,
  predicate: (mode: string) => boolean,
  timeoutMs: number,
  isCanceled: () => boolean,
  timeoutMessage: string
): Promise<MachineState> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    assertNotCanceled(isCanceled);
    const state = await api.getMachineState();
    assertMachineCanContinue(state);
    if (predicate(modeFromMachineState(state))) return state;
    await wait(STATE_POLL_INTERVAL_MS, isCanceled);
  }
  throw new Error(timeoutMessage);
}

async function waitForSavedShot(
  api: DrinkWorkflowRunnerApi,
  marker: BrewStartMarker,
  isCanceled: () => boolean
): Promise<ShotRecord> {
  const deadline = Date.now() + SHOT_PERSIST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    assertNotCanceled(isCanceled);
    const latest = await api.getLatestShot().catch(() => null);
    const timestamp = latest ? Date.parse(latest.timestamp) : Number.NaN;
    const isNewId = Boolean(latest && latest.id !== marker.previousShotId);
    const isFreshFirstShot = marker.previousShotId !== null || (Number.isFinite(timestamp) && timestamp >= marker.startedAt - 2000);
    if (latest && isNewId && isFreshFirstShot) return latest;
    await wait(300, isCanceled);
  }
  throw new Error("The brew ended without a new saved shot. The remaining steps were not started.");
}

function scaleSnapshotIsFresh(snapshot: WeightSnapshot, tareRequestedAt: number): boolean {
  if (!snapshot.timestamp) return true;
  const timestamp = Date.parse(snapshot.timestamp);
  return !Number.isFinite(timestamp) || timestamp >= tareRequestedAt - 1000;
}

async function waitForHotWaterCompletion(
  api: DrinkWorkflowRunnerApi,
  step: Extract<DrinkWorkflowStep, { type: "hotWater" }>,
  tareRequestedAt: number,
  getScaleSnapshot: (() => WeightSnapshot | null) | undefined,
  isCanceled: () => boolean
): Promise<void> {
  if (!getScaleSnapshot) {
    await waitForMode(api, isIdleMode, completionTimeoutMs(step), isCanceled, "Hot Water did not finish in time.");
    return;
  }

  const deadline = Date.now() + completionTimeoutMs(step);
  let zeroObserved = false;
  let stopRequested = false;
  while (Date.now() < deadline) {
    assertNotCanceled(isCanceled);
    const state = await api.getMachineState();
    assertMachineCanContinue(state);
    if (isIdleMode(modeFromMachineState(state))) return;

    const snapshot = getScaleSnapshot();
    if (snapshot && scaleSnapshotIsFresh(snapshot, tareRequestedAt) && typeof snapshot.weight === "number") {
      if (Math.abs(snapshot.weight) <= 1.5) zeroObserved = true;
      const weightFlow = typeof snapshot.weightFlow === "number" ? Math.max(0, snapshot.weightFlow) : 0;
      const projectedWeight = snapshot.weight + weightFlow * HOT_WATER_WEIGHT_LOOKAHEAD_SECONDS;
      if (zeroObserved && !stopRequested && projectedWeight >= step.volumeMl) {
        stopRequested = true;
        await api.requestMachineState("idle");
      }
    }
    await wait(HOT_WATER_SCALE_POLL_MS, isCanceled);
  }
  throw new Error("Hot Water did not finish in time.");
}

async function prepareStep(
  api: DrinkWorkflowRunnerApi,
  step: DrinkWorkflowStep,
  profiles: ProfileRecord[],
  callbacks: Pick<RunDrinkWorkflowOptions, "onBrewProfileSelected" | "onWorkflowUpdated">
): Promise<BrewStartMarker | null> {
  if (step.type === "brew") {
    const profile = profiles.find((item) => item.id === step.profileId);
    if (!profile) throw new Error("The selected brew profile is no longer available.");
    const currentWorkflow = await api.getWorkflow();
    const extras = currentWorkflow.context?.extras ?? {};
    const workflowSkin = extras.workflowSkin && typeof extras.workflowSkin === "object" && !Array.isArray(extras.workflowSkin) ? extras.workflowSkin : {};
    callbacks.onBrewProfileSelected?.(profile.id);
    const updated = await api.updateWorkflow({
      profile: profile.profile,
      context: {
        ...currentWorkflow.context,
        extras: {
          ...extras,
          workflowSkin: { ...workflowSkin, selectedProfileId: profile.id }
        }
      }
    });
    callbacks.onWorkflowUpdated?.(updated);
    const startedAt = Date.now();
    const latest = await api.getLatestShot().catch(() => null);
    return { previousShotId: latest?.id ?? null, startedAt };
  }

  if (step.type === "hotWater") {
    const updated = await api.updateWorkflow({
      hotWaterData: {
        targetTemperature: step.temperatureC,
        duration: hotWaterSafetyDurationSeconds(step.volumeMl),
        volume: step.volumeMl,
        flow: HOT_WATER_FLOW_ML_PER_SECOND
      }
    });
    callbacks.onWorkflowUpdated?.(updated);
    return null;
  }

  const updated = await api.updateWorkflow({
    steamSettings: {
      targetTemperature: step.temperatureC,
      duration: step.durationSeconds,
      flow: STEAM_FLOW,
      stopAtTemperature: 0
    }
  });
  callbacks.onWorkflowUpdated?.(updated);
  return null;
}

export async function runDrinkWorkflow(options: RunDrinkWorkflowOptions): Promise<DrinkWorkflowRunResult> {
  const { api, workflow, profiles, isCanceled, onState } = options;
  const brewShots: ShotRecord[] = [];

  for (let index = 0; index < workflow.steps.length; index += 1) {
    const step = workflow.steps[index];
    assertNotCanceled(isCanceled);
    await waitForMode(api, isIdleMode, STATE_START_TIMEOUT_MS, isCanceled, "The machine did not become ready for the next step.");

    onState({ workflow, currentStepIndex: index, phase: "preparing", message: `Preparing ${stepName(step)}.` });
    const brewStartMarker = await prepareStep(api, step, profiles, options);

    let tareRequestedAt = 0;
    if (requiresScaleTare(step)) {
      onState({
        workflow,
        currentStepIndex: index,
        phase: index === 0 ? "preparing" : "between",
        message: `Taring scale for ${stepName(step)}.`
      });
      try {
        tareRequestedAt = Date.now();
        await api.tareScale();
      } catch {
        throw new Error(`Could not tare the scale before ${stepName(step)}. Connect the scale and start again.`);
      }
      await wait(TARE_SETTLE_MS, isCanceled);
    } else if (index > 0) {
      onState({ workflow, currentStepIndex: index, phase: "between", message: `Preparing ${stepName(step)}.` });
      await wait(BETWEEN_STEPS_SETTLE_MS, isCanceled);
    }

    const requestedMode = activeModeForStep(step);
    onState({ workflow, currentStepIndex: index, phase: "starting", message: `Starting ${stepName(step)}.` });
    await api.requestMachineState(requestedMode === "hotwater" ? "hotWater" : requestedMode);
    await waitForMode(
      api,
      (mode) => matchesActiveMode(mode, requestedMode),
      STATE_START_TIMEOUT_MS,
      isCanceled,
      `${stepName(step)} did not start.`
    );

    onState({ workflow, currentStepIndex: index, phase: "running", message: `${stepName(step)} is running.` });
    if (step.type === "hotWater") {
      await waitForHotWaterCompletion(api, step, tareRequestedAt, options.getScaleSnapshot, isCanceled);
    } else {
      await waitForMode(
        api,
        isIdleMode,
        completionTimeoutMs(step),
        isCanceled,
        `${stepName(step)} did not finish in time.`
      );
    }

    if (step.type === "brew") {
      if (!brewStartMarker) throw new Error("Could not track the brew start.");
      const shot = await waitForSavedShot(api, brewStartMarker, isCanceled);
      if (shot.stopReason && ABNORMAL_SHOT_STOP_REASONS.has(shot.stopReason)) {
        throw new Error(`The brew stopped (${shot.stopReason}). The remaining steps were not started.`);
      }
      brewShots.push(shot);
    }

    if (index < workflow.steps.length - 1) await wait(BETWEEN_STEPS_SETTLE_MS, isCanceled);
  }

  onState({ workflow, currentStepIndex: workflow.steps.length, phase: "completed", message: `${workflow.name} is ready.` });
  return { brewShots };
}
