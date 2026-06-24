import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReaData } from "../state/useReaData";

function createApi() {
  return {
    listProfiles: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn().mockResolvedValue({}),
    listBeans: vi.fn().mockResolvedValue([]),
    listGrinders: vi.fn().mockResolvedValue([]),
    listShots: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
    getLatestShot: vi.fn().mockResolvedValue(null),
    listSteams: vi.fn().mockResolvedValue([]),
    getKv: vi.fn().mockResolvedValue(null),
    putKv: vi.fn().mockResolvedValue(undefined),
    listSensors: vi.fn().mockResolvedValue([]),
    listDevices: vi.fn().mockResolvedValue([]),
    getAppInfo: vi.fn().mockResolvedValue(null),
    getMachineState: vi.fn().mockResolvedValue(null),
    getDisplay: vi.fn().mockResolvedValue(null),
    getMachineSettings: vi.fn().mockResolvedValue(null),
    getAdvancedMachineSettings: vi.fn().mockResolvedValue(null),
    getMachineCalibration: vi.fn().mockResolvedValue(null),
    listPlugins: vi.fn().mockResolvedValue([]),
    listBatches: vi.fn().mockResolvedValue([])
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useReaData", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not run a full data refresh every five seconds", async () => {
    vi.useFakeTimers();
    const api = createApi();

    renderHook(() => useReaData(api as never));
    await flushPromises();

    expect(api.listProfiles).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.listProfiles).toHaveBeenCalledTimes(1);
  });

  it("keeps machine data available when shot history fails", async () => {
    const api = createApi();
    api.getMachineState.mockResolvedValue({ connected: true, state: { state: "idle" } });
    api.listShots.mockRejectedValue(new Error('GET /api/v1/shots failed: 500 {"error":"Invalid argument(s): Profile must have a non-empty \\"steps\\" array"}'));

    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();

    expect(result.current.loaded).toBe(true);
    expect(result.current.machineState).toEqual({ connected: true, state: { state: "idle" } });
    expect(result.current.shots).toEqual([]);
    expect(result.current.error).toContain("Shot history unavailable");
  });
});
