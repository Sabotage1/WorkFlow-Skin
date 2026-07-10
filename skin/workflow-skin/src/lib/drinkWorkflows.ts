import type { ProfileRecord, ShotRecord } from "../api/types";

export const MAX_DRINK_WORKFLOW_STEPS = 3;
export const MIN_HOT_WATER_VOLUME_ML = 10;
export const MAX_HOT_WATER_VOLUME_ML = 250;
export const MIN_HOT_WATER_TEMPERATURE_C = 50;
export const MAX_HOT_WATER_TEMPERATURE_C = 95;
export const MIN_STEAM_DURATION_SECONDS = 5;
export const MAX_STEAM_DURATION_SECONDS = 120;
export const MIN_STEAM_TEMPERATURE_C = 135;
export const MAX_STEAM_TEMPERATURE_C = 170;

export type DrinkWorkflowStepType = "brew" | "hotWater" | "steam";

interface DrinkWorkflowStepBase {
  id: string;
  type: DrinkWorkflowStepType;
}

export interface BrewWorkflowStep extends DrinkWorkflowStepBase {
  type: "brew";
  profileId: string;
  profileTitle?: string;
}

export interface HotWaterWorkflowStep extends DrinkWorkflowStepBase {
  type: "hotWater";
  volumeMl: number;
  temperatureC: number;
}

export interface SteamWorkflowStep extends DrinkWorkflowStepBase {
  type: "steam";
  durationSeconds: number;
  temperatureC: number;
}

export type DrinkWorkflowStep = BrewWorkflowStep | HotWaterWorkflowStep | SteamWorkflowStep;

export interface DrinkWorkflow {
  id: string;
  name: string;
  steps: DrinkWorkflowStep[];
}

export interface DrinkWorkflowShotDetails extends DrinkWorkflow {
  completedAt: string;
}

export type DrinkWorkflowRunPhase = "idle" | "preparing" | "starting" | "running" | "between" | "completed" | "canceled" | "error";

export interface DrinkWorkflowRunState {
  workflow: DrinkWorkflow | null;
  currentStepIndex: number;
  phase: DrinkWorkflowRunPhase;
  message?: string;
}

export const IDLE_DRINK_WORKFLOW_RUN: DrinkWorkflowRunState = {
  workflow: null,
  currentStepIndex: -1,
  phase: "idle"
};

export interface DrinkWorkflowValidationError {
  field: string;
  message: string;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clampInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 96) : "";
}

export function createDrinkWorkflowId(prefix = "flow"): string {
  const cryptoObject = typeof globalThis.crypto === "object" ? globalThis.crypto : undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") return `${prefix}-${cryptoObject.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDrinkWorkflowStep(type: DrinkWorkflowStepType, profileId = ""): DrinkWorkflowStep {
  if (type === "brew") return { id: createDrinkWorkflowId("step"), type, profileId };
  if (type === "hotWater") return { id: createDrinkWorkflowId("step"), type, volumeMl: 120, temperatureC: 80 };
  return { id: createDrinkWorkflowId("step"), type, durationSeconds: 30, temperatureC: 150 };
}

function normalizeDrinkWorkflowStep(value: unknown): DrinkWorkflowStep | null {
  if (!isPlainRecord(value)) return null;
  const id = cleanId(value.id) || createDrinkWorkflowId("step");
  if (value.type === "brew") {
    const profileId = cleanId(value.profileId);
    if (!profileId) return null;
    const profileTitle = typeof value.profileTitle === "string" ? value.profileTitle.trim().slice(0, 160) : "";
    return { id, type: "brew", profileId, ...(profileTitle ? { profileTitle } : {}) };
  }
  if (value.type === "hotWater") {
    return {
      id,
      type: "hotWater",
      volumeMl: clampInteger(value.volumeMl, MIN_HOT_WATER_VOLUME_ML, MAX_HOT_WATER_VOLUME_ML, 120),
      temperatureC: clampInteger(value.temperatureC, MIN_HOT_WATER_TEMPERATURE_C, MAX_HOT_WATER_TEMPERATURE_C, 80)
    };
  }
  if (value.type === "steam") {
    return {
      id,
      type: "steam",
      durationSeconds: clampInteger(value.durationSeconds, MIN_STEAM_DURATION_SECONDS, MAX_STEAM_DURATION_SECONDS, 30),
      temperatureC: clampInteger(value.temperatureC, MIN_STEAM_TEMPERATURE_C, MAX_STEAM_TEMPERATURE_C, 150)
    };
  }
  return null;
}

export function normalizeDrinkWorkflows(value: unknown): DrinkWorkflow[] {
  if (!Array.isArray(value)) return [];
  const workflows: DrinkWorkflow[] = [];
  const usedIds = new Set<string>();

  for (const item of value) {
    if (!isPlainRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 60) : "";
    if (!name || !Array.isArray(item.steps)) continue;
    const steps = item.steps.slice(0, MAX_DRINK_WORKFLOW_STEPS).map(normalizeDrinkWorkflowStep).filter((step): step is DrinkWorkflowStep => Boolean(step));
    if (steps.length === 0) continue;
    let id = cleanId(item.id) || createDrinkWorkflowId();
    if (usedIds.has(id)) id = createDrinkWorkflowId();
    usedIds.add(id);
    workflows.push({ id, name, steps });
  }

  return workflows;
}

export function validateDrinkWorkflow(workflow: DrinkWorkflow, availableProfileIds?: ReadonlySet<string>): DrinkWorkflowValidationError[] {
  const errors: DrinkWorkflowValidationError[] = [];
  if (!workflow.name.trim()) errors.push({ field: "name", message: "Enter a workflow name." });
  if (workflow.steps.length === 0) errors.push({ field: "steps", message: "Add at least one step." });
  if (workflow.steps.length > MAX_DRINK_WORKFLOW_STEPS) {
    errors.push({ field: "steps", message: `A workflow can contain up to ${MAX_DRINK_WORKFLOW_STEPS} steps.` });
  }

  workflow.steps.forEach((step, index) => {
    const field = `steps.${index}`;
    if (step.type === "brew") {
      if (!step.profileId || (availableProfileIds && !availableProfileIds.has(step.profileId))) {
        errors.push({ field, message: `Choose an available profile for step ${index + 1}.` });
      }
      return;
    }
    if (step.type === "hotWater") {
      if (step.volumeMl < MIN_HOT_WATER_VOLUME_ML || step.volumeMl > MAX_HOT_WATER_VOLUME_ML) {
        errors.push({ field, message: `Water volume must be ${MIN_HOT_WATER_VOLUME_ML}-${MAX_HOT_WATER_VOLUME_ML} ml.` });
      }
      if (step.temperatureC < MIN_HOT_WATER_TEMPERATURE_C || step.temperatureC > MAX_HOT_WATER_TEMPERATURE_C) {
        errors.push({ field, message: `Water temperature must be ${MIN_HOT_WATER_TEMPERATURE_C}-${MAX_HOT_WATER_TEMPERATURE_C} C.` });
      }
      return;
    }
    if (step.durationSeconds < MIN_STEAM_DURATION_SECONDS || step.durationSeconds > MAX_STEAM_DURATION_SECONDS) {
      errors.push({ field, message: `Steam duration must be ${MIN_STEAM_DURATION_SECONDS}-${MAX_STEAM_DURATION_SECONDS} seconds.` });
    }
    if (step.temperatureC < MIN_STEAM_TEMPERATURE_C || step.temperatureC > MAX_STEAM_TEMPERATURE_C) {
      errors.push({ field, message: `Steam temperature must be ${MIN_STEAM_TEMPERATURE_C}-${MAX_STEAM_TEMPERATURE_C} C.` });
    }
  });

  return errors;
}

export function hotWaterSafetyDurationSeconds(volumeMl: number): number {
  return Math.min(60, Math.max(15, Math.ceil(volumeMl / 6) + 10));
}

function workflowSkinExtras(shot: ShotRecord): Record<string, unknown> | null {
  const extras = shot.workflow?.context?.extras;
  if (!extras || typeof extras !== "object" || Array.isArray(extras)) return null;
  const workflowSkin = extras.workflowSkin;
  return workflowSkin && typeof workflowSkin === "object" && !Array.isArray(workflowSkin) ? (workflowSkin as Record<string, unknown>) : null;
}

export function drinkWorkflowDetailsFromShot(shot: ShotRecord): DrinkWorkflowShotDetails | null {
  const value = workflowSkinExtras(shot)?.drinkWorkflow;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const normalized = normalizeDrinkWorkflows([value])[0];
  const completedAt = (value as Record<string, unknown>).completedAt;
  if (!normalized || typeof completedAt !== "string" || !completedAt.trim()) return null;
  return { ...normalized, completedAt };
}

export function attachDrinkWorkflowToShot(
  shot: ShotRecord,
  drinkWorkflow: DrinkWorkflow,
  profiles: ProfileRecord[],
  completedAt: string
): ShotRecord {
  const context = shot.workflow.context ?? {};
  const extras = context.extras ?? {};
  const currentWorkflowSkin = extras.workflowSkin && typeof extras.workflowSkin === "object" && !Array.isArray(extras.workflowSkin) ? extras.workflowSkin : {};
  const steps = drinkWorkflow.steps.map((step) => {
    if (step.type !== "brew") return { ...step };
    const profileTitle = profiles.find((profile) => profile.id === step.profileId)?.profile.title?.trim() || step.profileTitle || shot.workflow.profile?.title?.trim();
    return { ...step, ...(profileTitle ? { profileTitle } : {}) };
  });

  return {
    ...shot,
    workflow: {
      ...shot.workflow,
      context: {
        ...context,
        extras: {
          ...extras,
          workflowSkin: {
            ...currentWorkflowSkin,
            drinkWorkflow: {
              id: drinkWorkflow.id,
              name: drinkWorkflow.name,
              steps,
              completedAt
            }
          }
        }
      }
    }
  };
}

export function drinkWorkflowStepLabel(step: DrinkWorkflowStep): string {
  if (step.type === "brew") return "Brew Profile";
  if (step.type === "hotWater") return "Hot Water";
  return "Steam Milk";
}

export function drinkWorkflowStepSummary(step: DrinkWorkflowStep): string {
  if (step.type === "brew") return step.profileTitle?.trim() || step.profileId;
  if (step.type === "hotWater") return `${step.volumeMl} ml at ${step.temperatureC} C`;
  return `${step.durationSeconds}s at ${step.temperatureC} C`;
}
