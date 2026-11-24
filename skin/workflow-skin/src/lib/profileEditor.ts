import type { JsonMap, Profile } from "../api/types";

// The DE1 upload uses frame 32 onward for per-step limiter data. The tail
// occupies the frame immediately after the last brew step.
export const MAX_PROFILE_STEPS = 31;
const MAX_PUMP_VALUE = 255 / 16;

export function profileObject(value: unknown): value is JsonMap {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function profileNumber(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function profileText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function profilePump(step: JsonMap): "pressure" | "flow" {
  return step.pump === "flow" || (step.pump == null && profileNumber(step.flow) !== undefined) ? "flow" : "pressure";
}

export function newProfileStep(temperature = 93): JsonMap {
  return {
    name: "New step",
    pump: "pressure",
    pressure: 6,
    transition: "fast",
    temperature,
    sensor: "coffee",
    seconds: 10,
    weight: 0,
    volume: 100,
    exit: null,
    limiter: null
  };
}

export function initialEditorProfile(profile?: Profile): Profile {
  const steps = profile?.steps?.length ? profile.steps : [
    { name: "Preinfusion", pump: "flow", flow: 2, seconds: 8,
      exit: { type: "pressure", condition: "over", value: 3 }, limiter: { value: 4, range: 0.6 } },
    { ...newProfileStep(), name: "Extraction", pressure: 8, seconds: 27, limiter: { value: 4, range: 0.6 } }
  ];
  return {
    version: "2",
    title: "",
    beverage_type: "espresso",
    target_weight: profile ? null : 36,
    target_volume_count_start: profile ? 0 : 1,
    tank_temperature: 0,
    ...profile,
    steps: steps.map((step) => {
      const pump = profilePump(step);
      const { pressure: _pressure, ...defaults } = newProfileStep();
      return {
        ...defaults,
        ...step,
        pump: step.pump ?? pump,
        [pump]: step[pump] ?? (pump === "pressure" ? 6 : 2)
      };
    })
  };
}

export function importEditorProfile(value: unknown): Profile {
  const candidate = profileObject(value) && profileObject(value.profile) ? value.profile : value;
  if (!profileObject(candidate) || !profileText(candidate.title).trim() ||
      !Array.isArray(candidate.steps) || !candidate.steps.length ||
      !candidate.steps.every(profileObject)) {
    throw new Error("Choose a Decaid profile JSON with a title and at least one step.");
  }
  return initialEditorProfile(candidate as Profile);
}

type ProfileIssue = { message: string; step?: number; details?: true };

export function validateEditorProfile(profile: Profile): ProfileIssue | null {
  if (!profileText(profile.title).trim()) return { message: "Enter a profile title.", details: true };
  if (!profile.steps?.length) return { message: "Add at least one brew step." };
  if (profile.steps.length > MAX_PROFILE_STEPS) return { message: `A profile can have up to ${MAX_PROFILE_STEPS} steps.` };
  const countStart = profileNumber(profile.target_volume_count_start);
  if (countStart === undefined || !Number.isInteger(countStart) || countStart < 0 || countStart >= profile.steps.length) {
    return { message: "Choose a step to start counting water volume.", details: true };
  }
  if (!nonnegative(profile.tank_temperature) ||
      [profile.target_weight, profile.target_volume].some((value) => value != null && !nonnegative(value))) {
    return { message: "Use valid, nonnegative recipe targets and tank temperature.", details: true };
  }

  for (const [index, step] of profile.steps.entries()) {
    const label = `Step ${index + 1}`;
    const { name, pump, transition, sensor, exit, limiter } = step;
    if (typeof name !== "string" || !name.trim()) return { message: `Give ${label.toLowerCase()} a name.`, step: index };
    if (pump !== "pressure" && pump !== "flow") return { message: `${label} needs a pressure or flow pump mode.`, step: index };
    if ((transition !== "fast" && transition !== "smooth") || (sensor !== "coffee" && sensor !== "water")) {
      return { message: `${label} needs a transition and temperature sensor.`, step: index };
    }
    if (![step[pump], step.seconds, step.volume, step.temperature].every(nonnegative) || (step.weight != null && !nonnegative(step.weight))) {
      return { message: `${label} needs valid, nonnegative targets, duration and limits.`, step: index };
    }
    if (!withinLimit(step[pump], MAX_PUMP_VALUE) || !withinLimit(step.seconds, 127) ||
        !withinLimit(step.volume, 1023) || !withinLimit(step.temperature, 127.5)) {
      return { message: `${label} exceeds a machine limit. Use up to 15.9375 bar or mL/s, 127 s, 1023 mL and 127.5 °C.`, step: index };
    }
    if (exit != null && (!profileObject(exit) || !["pressure", "flow"].includes(String(exit.type)) ||
        !["under", "over"].includes(String(exit.condition)) || !withinLimit(exit.value, MAX_PUMP_VALUE))) {
      return { message: `Check the early exit for ${label.toLowerCase()}.`, step: index };
    }
    if (limiter != null && (!profileObject(limiter) || !withinLimit(limiter.value, MAX_PUMP_VALUE) || !withinLimit(limiter.range, MAX_PUMP_VALUE))) {
      return { message: `Check the pump limiter for ${label.toLowerCase()}.`, step: index };
    }
  }
  return null;
}

function nonnegative(value: unknown): boolean {
  return withinLimit(value, Infinity);
}

function withinLimit(value: unknown, maximum: number): boolean {
  const number = profileNumber(value);
  return number !== undefined && number >= 0 && number <= maximum;
}

function stepForSave(step: JsonMap): JsonMap {
  const pump = profilePump(step);
  const next = { ...step };
  for (const key of ["seconds", "temperature", "volume", pump, "weight"]) {
    if (next[key] == null) continue;
    next[key] = profileNumber(next[key]) ?? next[key];
  }
  if (profileObject(step.exit)) next.exit = { ...step.exit, value: profileNumber(step.exit.value) ?? step.exit.value };
  if (profileObject(step.limiter)) {
    next.limiter = { ...step.limiter, value: profileNumber(step.limiter.value) ?? step.limiter.value,
      range: profileNumber(step.limiter.range) ?? step.limiter.range };
  }
  return next;
}

export function profileForSave(draft: Profile): Profile {
  return {
    ...draft,
    title: profileText(draft.title).trim(),
    author: profileText(draft.author).trim(),
    notes: profileText(draft.notes),
    steps: draft.steps?.map(stepForSave),
    target_weight: profileNumber(draft.target_weight) ?? null,
    target_volume: profileNumber(draft.target_volume) ?? null,
    target_volume_count_start: profileNumber(draft.target_volume_count_start),
    tank_temperature: profileNumber(draft.tank_temperature)
  };
}
