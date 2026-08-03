import { describe, expect, it } from "vitest";
import {
  isActiveShotLifecycle,
  isFinishedShotLifecycle,
  parseShotLifecycle,
  retainLatestFinishedShotLifecycle
} from "../lib/shotLifecycle";

describe("shot lifecycle compatibility", () => {
  it("accepts Decaid shot-state frames and identifies active and finished shots", () => {
    const pouring = parseShotLifecycle({
      event: "state",
      timestamp: "2026-08-03T08:00:00.000Z",
      shotId: "shot-1",
      state: "pouring",
      machineState: "espresso",
      scaleConnected: true,
      scaleLost: false,
      machineHasAutonomousSAW: false
    });
    const finished = parseShotLifecycle({
      event: "state",
      timestamp: "2026-08-03T08:00:30.000Z",
      shotId: "shot-1",
      state: "finished",
      machineState: "idle",
      scaleConnected: true,
      scaleLost: false,
      machineHasAutonomousSAW: false
    });

    expect(pouring).toMatchObject({ shotId: "shot-1", state: "pouring" });
    expect(isActiveShotLifecycle(pouring)).toBe(true);
    expect(isFinishedShotLifecycle(pouring)).toBe(false);
    expect(isActiveShotLifecycle(finished)).toBe(false);
    expect(isFinishedShotLifecycle(finished)).toBe(true);

    const idle = parseShotLifecycle({ event: "state", shotId: null, state: "idle" });
    expect(idle).not.toBeNull();
    expect(retainLatestFinishedShotLifecycle(finished, idle!)).toBe(finished);
  });

  it("ignores malformed or future frames without a usable lifecycle state", () => {
    expect(parseShotLifecycle({ event: "state", timestamp: "now" })).toBeNull();
    expect(parseShotLifecycle("finished")).toBeNull();
  });
});
