import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReaData } from "../state/useReaData";

function createApi() {
  return {
    listProfiles: vi.fn().mockResolvedValue([]),
    getWorkflow: vi.fn().mockResolvedValue({}),
    listBeans: vi.fn().mockResolvedValue([]),
    listGrinders: vi.fn().mockResolvedValue([]),
    listShots: vi.fn().mockResolvedValue({ items: [], total: 0, limit: 100, offset: 0 }),
    listShotIds: vi.fn().mockResolvedValue([]),
    getShot: vi.fn(),
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

  it("retries a WebView reload while the native API is resuming", async () => {
    vi.useFakeTimers();
    const api = createApi();
    api.listProfiles.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();
    expect(result.current.error).toBe("Failed to fetch");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(api.listProfiles).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it("refreshes saved data once for a burst of foreground and online events", async () => {
    const api = createApi();
    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();
    api.listProfiles.mockResolvedValue([{ id: "new", profile: { title: "Updated in Decaid" } }]);
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("online"));
    });
    await flushPromises();
    expect(api.listProfiles).toHaveBeenCalledTimes(2);
    expect(result.current.profiles[0].id).toBe("new");
  });

  it("makes profiles and presets available before slow history data finishes loading", async () => {
    const api = createApi();
    let releaseBeans: (() => void) | undefined;
    api.listProfiles.mockResolvedValue([{ id: "p1", profile: { title: "Blooming" } }]);
    api.listBeans.mockImplementation(
      () =>
        new Promise<never[]>((resolve) => {
          releaseBeans = () => resolve([]);
        })
    );

    const { result } = renderHook(() => useReaData(api as never));

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.profiles).toEqual([{ id: "p1", profile: { title: "Blooming" } }]);
    expect(api.listBeans).toHaveBeenCalledTimes(1);

    await act(async () => releaseBeans?.());
  });

  it("loads the boot workflow without waiting for optional display information", async () => {
    const api = createApi();
    let releaseDisplay!: () => void;
    api.getDisplay.mockImplementation(() => new Promise((resolve) => { releaseDisplay = () => resolve(null); }));
    api.getMachineState.mockResolvedValue({ connected: true, state: { state: "idle" } });
    const { result } = renderHook(() => useReaData(api as never));
    try {
      await waitFor(() => expect(result.current.loaded).toBe(true));
      expect(result.current.machineState).toMatchObject({ state: { state: "idle" } });
    } finally {
      await act(async () => { releaseDisplay(); });
    }
  });

  it("does not replace a confirmed preset with an older workflow refresh response", async () => {
    const api = createApi();
    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();
    let releaseWorkflow!: () => void;
    api.getWorkflow.mockImplementation(() => new Promise((resolve) => { releaseWorkflow = () => resolve({ profile: { title: "Old preset" } }); }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refreshWorkflow(); });
    act(() => { result.current.setWorkflow({ profile: { title: "Startup preset" } }); });
    await act(async () => { releaseWorkflow(); await refresh; });
    expect(result.current.workflow).toMatchObject({ profile: { title: "Startup preset" } });
  });

  it("publishes a new machine connection while display refresh is still pending", async () => {
    const api = createApi();
    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();
    let releaseDisplay!: () => void;
    api.getDisplay.mockImplementation(() => new Promise((resolve) => { releaseDisplay = () => resolve(null); }));
    api.getMachineState.mockResolvedValue({ connected: true, state: { state: "idle" } });
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refreshConnectivity(); });
    try {
      await waitFor(() => expect(result.current.machineState).toMatchObject({ connected: true }));
    } finally {
      await act(async () => { releaseDisplay(); await refresh; });
    }
  });

  it("keeps the confirmed workflow when an earlier full history refresh finishes later", async () => {
    const api = createApi();
    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();
    let releaseBeans!: () => void;
    api.getWorkflow.mockResolvedValue({ profile: { title: "Old preset" } });
    api.listBeans.mockImplementation(() => new Promise((resolve) => { releaseBeans = () => resolve([]); }));
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refresh(); });
    await flushPromises();
    act(() => result.current.setWorkflow({ profile: { title: "Startup preset" } }));
    await act(async () => { releaseBeans(); await refresh; });
    expect(result.current.workflow).toMatchObject({ profile: { title: "Startup preset" } });
  });

  it("keeps machine data available without a visible error when shot history fails", async () => {
    const api = createApi();
    api.getMachineState.mockResolvedValue({ connected: true, state: { state: "idle" } });
    api.listShots.mockRejectedValue(new Error('GET /api/v1/shots failed: 500 {"error":"Invalid argument(s): Profile must have a non-empty \\"steps\\" array"}'));

    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();

    expect(result.current.loaded).toBe(true);
    expect(result.current.machineState).toEqual({ connected: true, state: { state: "idle" } });
    expect(result.current.shots).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads valid shots one by one when the bulk shot history endpoint fails", async () => {
    const api = createApi();
    const olderShot = { id: "older", timestamp: "2026-06-22T08:00:00.000Z", workflow: {} };
    const newerShot = { id: "newer", timestamp: "2026-06-23T08:00:00.000Z", workflow: {} };
    api.listShots.mockRejectedValue(new Error("bulk shot endpoint failed"));
    api.listShotIds.mockResolvedValue(["bad", "older", "newer"]);
    api.getShot.mockImplementation((id: string) => {
      if (id === "bad") return Promise.reject(new Error("bad shot"));
      return Promise.resolve(id === "older" ? olderShot : newerShot);
    });

    const { result } = renderHook(() => useReaData(api as never));
    await flushPromises();

    expect(result.current.shots.map((shot) => shot.id)).toEqual(["newer", "older"]);
    expect(result.current.error).toBeNull();
  });
});
