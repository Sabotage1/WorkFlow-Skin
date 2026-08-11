import { describe, expect, it } from "vitest";
import { machineModeLabel, machineTemperature } from "../lib/machineState";

describe("machineModeLabel", () => {
  it("shows one heating status instead of combining it with shot preparation", () => {
    expect(
      machineModeLabel(
        { connected: true, state: { state: "heating", substate: "PreparingForShot" } },
        undefined
      )
    ).toBe("Heating");
  });

  it("uses the useful live brew phase as the single status", () => {
    expect(
      machineModeLabel(
        { connected: true, state: { state: "espresso", substate: "pouring" } },
        undefined
      )
    ).toBe("Pouring");
  });

  it("trusts an idle machine state instead of inferring heating from the cold head sensor", () => {
    const machineState = {
      connected: true,
      state: { state: "idle", substate: "idle" },
      groupTemperature: 64.9,
      targetGroupTemperature: 93
    };

    expect(machineModeLabel(machineState, undefined)).toBe("Idle");
    expect(machineTemperature(machineState, undefined)).toBe(93);
  });

  it("keeps showing the measured group temperature during a live brew", () => {
    const liveMachine = {
      state: { state: "espresso", substate: "pouring" },
      groupTemperature: 92.2,
      targetGroupTemperature: 93
    };

    expect(machineTemperature(null, liveMachine)).toBe(92.2);
  });
});
