import { describe, expect, it } from "vitest";
import type { ShotSnapshot } from "../api/types";
import { appendLiveMeasurement, trimLiveGraphWarmup } from "../lib/liveMeasurements";

describe("live measurement trimming", () => {
  it("removes the first three seconds of live graph samples", () => {
    const measurements: ShotSnapshot[] = [
      { machine: { timestamp: "2026-06-14T10:00:00.000Z", pressure: 9 } },
      { machine: { timestamp: "2026-06-14T10:00:00.900Z", pressure: 11 } },
      { machine: { timestamp: "2026-06-14T10:00:02.000Z", pressure: 5 } },
      { machine: { timestamp: "2026-06-14T10:00:03.000Z", pressure: 7 } }
    ];

    expect(trimLiveGraphWarmup(measurements).map((sample) => sample.machine?.pressure)).toEqual([7]);
  });

  it("leaves untimed samples unchanged because their first second cannot be identified", () => {
    const measurements: ShotSnapshot[] = [{ machine: { pressure: 9 } }, { machine: { pressure: 7 } }];

    expect(trimLiveGraphWarmup(measurements)).toBe(measurements);
  });

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
});
