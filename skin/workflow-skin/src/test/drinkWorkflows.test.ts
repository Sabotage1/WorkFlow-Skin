import { describe, expect, it, vi } from "vitest";
import {
  MAX_DRINK_WORKFLOW_STEPS,
  createDrinkWorkflowId,
  createDrinkWorkflowStep,
  hotWaterSafetyDurationSeconds,
  normalizeDrinkWorkflows,
  validateDrinkWorkflow,
  type DrinkWorkflow
} from "../lib/drinkWorkflows";

describe("drink Work Flows", () => {
  it("creates ids on older WebViews without crypto.randomUUID", () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal("crypto", {});
    expect(createDrinkWorkflowId()).toMatch(/^flow-/);
    vi.stubGlobal("crypto", originalCrypto);
  });

  it("creates defaults for all supported action types", () => {
    expect(createDrinkWorkflowStep("brew", "profile-1")).toMatchObject({ type: "brew", profileId: "profile-1" });
    expect(createDrinkWorkflowStep("hotWater")).toMatchObject({ type: "hotWater", volumeMl: 120, temperatureC: 80 });
    expect(createDrinkWorkflowStep("steam")).toMatchObject({ type: "steam", durationSeconds: 30, temperatureC: 150 });
  });

  it("normalizes saved recipes and caps them at three steps", () => {
    const normalized = normalizeDrinkWorkflows([
      {
        id: "americano",
        name: " Americano ",
        steps: [
          { id: "one", type: "brew", profileId: "p1" },
          { id: "two", type: "hotWater", volumeMl: 999, temperatureC: 20 },
          { id: "three", type: "steam", durationSeconds: 500, temperatureC: 200 },
          { id: "four", type: "hotWater", volumeMl: 50, temperatureC: 70 }
        ]
      },
      { id: "bad", name: "", steps: [] }
    ]);

    expect(normalized).toHaveLength(1);
    expect(normalized[0].name).toBe("Americano");
    expect(normalized[0].steps).toHaveLength(MAX_DRINK_WORKFLOW_STEPS);
    expect(normalized[0].steps[1]).toMatchObject({ volumeMl: 250, temperatureC: 50 });
    expect(normalized[0].steps[2]).toMatchObject({ durationSeconds: 120, temperatureC: 170 });
  });

  it("rejects missing profiles and out-of-range machine values", () => {
    const workflow: DrinkWorkflow = {
      id: "invalid",
      name: "",
      steps: [
        { id: "one", type: "brew", profileId: "missing" },
        { id: "two", type: "hotWater", volumeMl: 1, temperatureC: 99 },
        { id: "three", type: "steam", durationSeconds: 1, temperatureC: 120 }
      ]
    };

    const errors = validateDrinkWorkflow(workflow, new Set(["p1"]));
    expect(errors.map((error) => error.field)).toEqual(["name", "steps.0", "steps.1", "steps.1", "steps.2", "steps.2"]);
  });

  it("derives a bounded native hot-water safety duration", () => {
    expect(hotWaterSafetyDurationSeconds(10)).toBe(15);
    expect(hotWaterSafetyDurationSeconds(120)).toBe(30);
    expect(hotWaterSafetyDurationSeconds(250)).toBe(52);
  });
});
