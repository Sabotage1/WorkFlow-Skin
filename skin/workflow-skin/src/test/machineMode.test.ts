import { describe, expect, it } from "vitest";
import { resolveMachineModeSnapshot, shouldPollMachineState } from "../lib/machineMode";

describe("shouldPollMachineState", () => {
  it("keeps polling when live telemetry still reports an active mode after the effective mode is idle", () => {
    expect(shouldPollMachineState({ currentMode: "idle", liveMode: "espresso", hasCompletedActivity: false })).toBe(true);
  });

  it("does not mix a fresh REST state with a stale live substate", () => {
    expect(
      resolveMachineModeSnapshot({
        fast: { state: "idle" },
        live: { state: "espresso", substate: "pouring" },
        liveConnected: true,
        fallback: { state: "idle", substate: "idle" }
      })
    ).toEqual({ state: "idle" });
  });

  it("falls back to REST status while the live stream is reconnecting after wake", () => {
    expect(
      resolveMachineModeSnapshot({
        live: { state: "espresso", substate: "pouring" },
        liveConnected: false,
        fallback: { state: "idle", substate: "idle" }
      })
    ).toEqual({ state: "idle", substate: "idle" });
  });
});
