import { describe, expect, it } from "vitest";
import { machineModeLabel } from "../lib/machineState";

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
});
