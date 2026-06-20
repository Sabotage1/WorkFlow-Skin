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
    listSteams: vi.fn().mockResolvedValue([]),
    getKv: vi.fn().mockResolvedValue(null),
    putKv: vi.fn().mockResolvedValue(undefined),
    listSensors: vi.fn().mockResolvedValue([]),
    listDevices: vi.fn().mockResolvedValue([]),
    getAppInfo: vi.fn().mockResolvedValue(null),
    getMachineState: vi.fn().mockResolvedValue(null),
    getDisplay: vi.fn().mockResolvedValue(null),
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
});
