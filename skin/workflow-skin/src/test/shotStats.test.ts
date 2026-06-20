import { describe, expect, it } from "vitest";
import type { ShotRecord, ShotSnapshot } from "../api/types";
import { graphSeries, grindSizeFromShot, previousFiveForBag, shotStats } from "../lib/shotStats";

describe("shotStats", () => {
  it("summarizes duration, pressure, flow, and final yield", () => {
    const shot: ShotRecord = {
      id: "s1",
      timestamp: "2026-06-09T10:00:00Z",
      workflow: {},
      measurements: [
        { machine: { timestamp: "2026-06-09T10:00:00.000Z", pressure: 1, flow: 1 }, scale: { weight: 2 } },
        { machine: { timestamp: "2026-06-09T10:00:10.000Z", pressure: 9, flow: 2 }, scale: { weight: 36 } }
      ]
    };
    expect(shotStats(shot)).toMatchObject({ durationSeconds: 10, peakPressure: 9, averageFlow: 1.5, finalYield: 36 });
  });

  it("ignores invalid timestamps when calculating duration", () => {
    const shot: ShotRecord = {
      id: "s1",
      timestamp: "2026-06-09T10:00:00Z",
      workflow: {},
      measurements: [
        { machine: { timestamp: "not-a-date", pressure: 1 } },
        { machine: { timestamp: "2026-06-09T10:00:10.000Z", pressure: 9 } }
      ]
    };

    expect(shotStats(shot).durationSeconds).toBeNull();
  });
});

describe("previousFiveForBag", () => {
  it("returns the five most recent shots for a batch excluding the current shot", () => {
    const shots = Array.from({ length: 7 }, (_, index): ShotRecord => ({
      id: `s${index}`,
      timestamp: `2026-06-0${index + 1}T10:00:00Z`,
      workflow: { context: { beanBatchId: "batch-1" } }
    }));
    expect(previousFiveForBag(shots, "batch-1", "s6").map((shot) => shot.id)).toEqual(["s5", "s4", "s3", "s2", "s1"]);
  });
});

describe("grindSizeFromShot", () => {
  it("prefers workflow skin grind size and falls back to grinder setting", () => {
    expect(
      grindSizeFromShot({
        id: "s1",
        timestamp: "2026-06-09T10:00:00Z",
        workflow: { context: { grinderSetting: "22" } },
        annotations: { extras: { workflowSkin: { grindSize: "18.5" } } }
      })
    ).toBe("18.5");
    expect(
      grindSizeFromShot({
        id: "s2",
        timestamp: "2026-06-09T10:00:00Z",
        workflow: { context: { grinderSetting: "22" } }
      })
    ).toBe("22");
  });
});

describe("graphSeries", () => {
  it("maps shot snapshots into graph-ready samples with defaults", () => {
    const measurements: ShotSnapshot[] = [
      {
        machine: { pressure: 8, targetPressure: 9, flow: 2, targetFlow: 2.5 },
        scale: { weight: 20 }
      },
      {}
    ];

    expect(graphSeries(measurements)).toEqual([
      { index: 0, pressure: 8, targetPressure: 9, flow: 2, targetFlow: 2.5, weight: 20 },
      { index: 1, pressure: 0, targetPressure: 0, flow: 0, targetFlow: 0, weight: 0 }
    ]);
  });
});
