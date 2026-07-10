import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MachineState, ProfileRecord, ShotRecord, Workflow } from "../api/types";
import { runDrinkWorkflow, type DrinkWorkflowRunnerApi } from "../lib/drinkWorkflowRunner";
import type { DrinkWorkflow, DrinkWorkflowRunState } from "../lib/drinkWorkflows";

const profiles: ProfileRecord[] = [
  { id: "p1", profile: { title: "Classic", steps: [{ name: "Pour" }] } }
];

function runnerApi(modes: string[], shots: Array<ShotRecord | null> = []): DrinkWorkflowRunnerApi & {
  updateWorkflow: ReturnType<typeof vi.fn>;
  tareScale: ReturnType<typeof vi.fn>;
  requestMachineState: ReturnType<typeof vi.fn>;
} {
  let modeIndex = 0;
  let shotIndex = 0;
  const currentWorkflow: Workflow = { profile: profiles[0].profile, context: { extras: {} } };
  return {
    getWorkflow: vi.fn().mockResolvedValue(currentWorkflow),
    updateWorkflow: vi.fn(async (patch: Partial<Workflow>) => ({ ...currentWorkflow, ...patch })),
    getMachineState: vi.fn(async () => ({ connected: true, state: { state: modes[Math.min(modeIndex++, modes.length - 1)] } }) as MachineState),
    getLatestShot: vi.fn(async () => shots[Math.min(shotIndex++, Math.max(0, shots.length - 1))] ?? null),
    tareScale: vi.fn().mockResolvedValue(undefined),
    requestMachineState: vi.fn().mockResolvedValue(undefined)
  };
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("drink Work Flow runner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("brews, tares between actions, then dispenses configured hot water", async () => {
    const oldShot = { id: "old", timestamp: "2026-01-01", workflow: {} } as ShotRecord;
    const newShot = { id: "new", timestamp: "2026-01-02", workflow: {}, stopReason: "targetWeight" } as ShotRecord;
    const api = runnerApi(["idle", "espresso", "idle", "idle", "hotWater", "idle"], [oldShot, newShot]);
    const workflow: DrinkWorkflow = {
      id: "americano",
      name: "Americano",
      steps: [
        { id: "brew", type: "brew", profileId: "p1" },
        { id: "water", type: "hotWater", volumeMl: 120, temperatureC: 82 }
      ]
    };
    const states: DrinkWorkflowRunState[] = [];

    await settle(runDrinkWorkflow({ api, workflow, profiles, isCanceled: () => false, onState: (state) => states.push(state) }));

    expect(api.tareScale).toHaveBeenCalledTimes(2);
    expect(api.requestMachineState.mock.calls.map(([state]) => state)).toEqual(["espresso", "hotWater"]);
    expect(api.updateWorkflow).toHaveBeenCalledWith(expect.objectContaining({ profile: profiles[0].profile }));
    expect(api.updateWorkflow).toHaveBeenCalledWith({
      hotWaterData: { targetTemperature: 82, duration: 30, volume: 120, flow: 6 }
    });
    expect(states[states.length - 1]).toMatchObject({ phase: "completed", currentStepIndex: 2 });
  });

  it("supports hot water before coffee", async () => {
    const oldShot = { id: "old", timestamp: "2026-01-01", workflow: {} } as ShotRecord;
    const newShot = { id: "new", timestamp: "2026-01-02", workflow: {}, stopReason: "machineEnded" } as ShotRecord;
    const api = runnerApi(["idle", "hotWater", "idle", "idle", "espresso", "idle"], [oldShot, newShot]);
    const workflow: DrinkWorkflow = {
      id: "long-black",
      name: "Long Black",
      steps: [
        { id: "water", type: "hotWater", volumeMl: 100, temperatureC: 80 },
        { id: "brew", type: "brew", profileId: "p1" }
      ]
    };

    await settle(runDrinkWorkflow({ api, workflow, profiles, isCanceled: () => false, onState: vi.fn() }));

    expect(api.requestMachineState.mock.calls.map(([state]) => state)).toEqual(["hotWater", "espresso"]);
    expect(api.tareScale).toHaveBeenCalledTimes(2);
  });

  it("applies steam settings and runs steam without requiring a scale tare", async () => {
    const api = runnerApi(["idle", "steam", "idle"]);
    const workflow: DrinkWorkflow = {
      id: "milk",
      name: "Milk Drink",
      steps: [{ id: "steam", type: "steam", durationSeconds: 35, temperatureC: 155 }]
    };

    await settle(runDrinkWorkflow({ api, workflow, profiles, isCanceled: () => false, onState: vi.fn() }));

    expect(api.updateWorkflow).toHaveBeenCalledWith({
      steamSettings: { targetTemperature: 155, duration: 35, flow: 0.8, stopAtTemperature: 0 }
    });
    expect(api.requestMachineState).toHaveBeenCalledWith("steam");
    expect(api.tareScale).not.toHaveBeenCalled();
  });

  it("uses the tared live scale to stop hot water at the requested amount", async () => {
    const api = runnerApi(["idle", "hotWater", "hotWater", "hotWater", "idle"]);
    const timestamp = new Date(Date.now()).toISOString();
    const snapshots = [
      { timestamp, weight: 0, weightFlow: 0 },
      { timestamp, weight: 118, weightFlow: 10 }
    ];
    let snapshotIndex = 0;
    const workflow: DrinkWorkflow = {
      id: "water-by-weight",
      name: "Water by Weight",
      steps: [{ id: "water", type: "hotWater", volumeMl: 120, temperatureC: 82 }]
    };

    await settle(
      runDrinkWorkflow({
        api,
        workflow,
        profiles,
        isCanceled: () => false,
        onState: vi.fn(),
        getScaleSnapshot: () => snapshots[Math.min(snapshotIndex++, snapshots.length - 1)]
      })
    );

    expect(api.requestMachineState.mock.calls.map(([state]) => state)).toEqual(["hotWater", "idle"]);
  });

  it("does not start the next action after an explicitly canceled brew", async () => {
    const oldShot = { id: "old", timestamp: "2026-01-01", workflow: {} } as ShotRecord;
    const canceledShot = { id: "new", timestamp: "2026-01-02", workflow: {}, stopReason: "appStop" } as ShotRecord;
    const api = runnerApi(["idle", "espresso", "idle"], [oldShot, canceledShot]);
    const workflow: DrinkWorkflow = {
      id: "canceled",
      name: "Canceled",
      steps: [
        { id: "brew", type: "brew", profileId: "p1" },
        { id: "water", type: "hotWater", volumeMl: 120, temperatureC: 80 }
      ]
    };

    const result = runDrinkWorkflow({ api, workflow, profiles, isCanceled: () => false, onState: vi.fn() });
    const rejection = expect(result).rejects.toThrow("appStop");
    await vi.runAllTimersAsync();
    await rejection;
    expect(api.requestMachineState).toHaveBeenCalledTimes(1);
  });
});
