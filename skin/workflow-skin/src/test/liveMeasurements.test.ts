import { describe, expect, it } from "vitest";
import type { ShotSnapshot } from "../api/types";
import { appendLiveMeasurement, shouldClearForShotStart } from "../lib/liveMeasurements";

describe("live measurement recording", () => {
  it("starts a fresh live graph when a new brew session begins", () => {
    const previous: ShotSnapshot[] = [
      { machine: { timestamp: "2026-06-15T08:00:00.000Z", pressure: 8 }, scale: { weight: 28 } },
      { machine: { timestamp: "2026-06-15T08:00:22.000Z", pressure: 7 }, scale: { weight: 39 } }
    ];
    const nextShotFirstSample: ShotSnapshot = {
      machine: { timestamp: "2026-06-15T08:03:00.000Z", pressure: 2, state: { state: "espresso" } },
      scale: { weight: 0 }
    };

    expect(appendLiveMeasurement(previous, nextShotFirstSample, true)).toEqual([nextShotFirstSample]);
  });

  it("clears an old graph when shot lifecycle arrives before the first espresso sample", () => {
    expect(
      shouldClearForShotStart(
        { shotId: "shot-2", state: "preheating" },
        "shot-1",
        false
      )
    ).toBe(true);
  });

  it("does not erase the first espresso sample when lifecycle arrives after machine telemetry", () => {
    expect(
      shouldClearForShotStart(
        { shotId: "shot-2", state: "preheating" },
        "shot-1",
        true
      )
    ).toBe(false);
  });

  it("keeps an entire 25 second high-frequency brew instead of a ten second sliding window", () => {
    const startedAt = Date.parse("2026-06-15T08:00:00.000Z");
    let measurements: ShotSnapshot[] = [];

    for (let index = 0; index <= 500; index += 1) {
      const next: ShotSnapshot = {
        machine: {
          timestamp: new Date(startedAt + index * 50).toISOString(),
          pressure: 8,
          state: { state: "espresso", substate: "pouring" }
        }
      };
      measurements = appendLiveMeasurement(measurements, next);
    }

    expect(measurements).toHaveLength(501);
    expect(measurements[0].machine?.timestamp).toBe("2026-06-15T08:00:00.000Z");
    expect(measurements[measurements.length - 1]?.machine?.timestamp).toBe("2026-06-15T08:00:25.000Z");
  });
});
