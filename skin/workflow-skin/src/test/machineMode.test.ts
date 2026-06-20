import { describe, expect, it } from "vitest";
import { shouldPollMachineState } from "../lib/machineMode";

describe("shouldPollMachineState", () => {
  it("keeps polling when live telemetry still reports an active mode after the effective mode is idle", () => {
    expect(shouldPollMachineState({ currentMode: "idle", liveMode: "espresso", hasCompletedActivity: false })).toBe(true);
  });
});
