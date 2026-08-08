import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScaleShotFallback, type ScaleShotFallbackApi, type ScaleShotFallbackOptions } from "../state/useScaleShotFallback";

function mockApi(): ScaleShotFallbackApi {
  return {
    tareScale: vi.fn().mockResolvedValue(undefined),
    startScaleTimer: vi.fn().mockResolvedValue(undefined),
    stopScaleTimer: vi.fn().mockResolvedValue(undefined),
    resetScaleTimer: vi.fn().mockResolvedValue(undefined),
    requestMachineState: vi.fn().mockResolvedValue(undefined)
  };
}

function options(api: ScaleShotFallbackApi, patch: Partial<ScaleShotFallbackOptions> = {}): ScaleShotFallbackOptions {
  return {
    api,
    brewing: true,
    machineSubstate: "preparingForShot",
    nativeSequencerActive: false,
    forceFallback: false,
    scaleConnected: true,
    scaleSnapshot: null,
    targetYield: 36,
    ...patch
  };
}

describe("useScaleShotFallback", () => {
  afterEach(() => vi.useRealTimers());

  it("takes guarded ownership when the machine brews without a native shot lifecycle", async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const idle = options(api, { brewing: false });
    const { result, rerender } = renderHook(({ value }) => useScaleShotFallback(value), { initialProps: { value: idle } });
    rerender({ value: options(api) });

    await act(async () => vi.advanceTimersByTimeAsync(300));

    expect(result.current).toBe(true);
    expect(api.tareScale).toHaveBeenCalledTimes(1);
    expect(api.resetScaleTimer).toHaveBeenCalledTimes(1);
    expect(api.startScaleTimer).not.toHaveBeenCalled();
  });

  it("leaves a healthy native sequencer fully in control", async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const { result, rerender } = renderHook(({ value }) => useScaleShotFallback(value), {
      initialProps: { value: options(api, { brewing: false, nativeSequencerActive: true }) }
    });
    rerender({ value: options(api, { nativeSequencerActive: true }) });

    await act(async () => vi.advanceTimersByTimeAsync(1000));

    expect(result.current).toBe(false);
    expect(api.tareScale).not.toHaveBeenCalled();
  });

  it("tares at the pour, starts the scale timer, and stops once target weight is reached", async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const initial = options(api);
    const { rerender } = renderHook(({ value }) => useScaleShotFallback(value), {
      initialProps: { value: { ...initial, brewing: false } }
    });
    rerender({ value: initial });

    await act(async () => vi.advanceTimersByTimeAsync(300));
    rerender({ value: { ...initial, machineSubstate: "preinfusion", scaleSnapshot: { weight: 0, weightFlow: 0 } } });
    await act(async () => Promise.resolve());

    expect(api.tareScale).toHaveBeenCalledTimes(2);
    expect(api.startScaleTimer).toHaveBeenCalledTimes(1);

    rerender({ value: { ...initial, machineSubstate: "pouring", scaleSnapshot: { weight: 35.7, weightFlow: 1.2 } } });
    await act(async () => Promise.resolve());

    expect(api.requestMachineState).toHaveBeenCalledTimes(1);
    expect(api.requestMachineState).toHaveBeenCalledWith("idle");
  });

  it("does not stop on an untared cup weight", async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const initial = options(api, { machineSubstate: "pouring" });
    const { rerender } = renderHook(({ value }) => useScaleShotFallback(value), {
      initialProps: { value: { ...initial, brewing: false } }
    });
    rerender({ value: initial });

    await act(async () => vi.advanceTimersByTimeAsync(300));
    await act(async () => Promise.resolve());
    rerender({ value: { ...initial, scaleSnapshot: { weight: 152, weightFlow: 0 } } });
    await act(async () => Promise.resolve());

    expect(api.requestMachineState).not.toHaveBeenCalled();
  });

  it("never activates late after a native lifecycle finishes during the same brew", async () => {
    vi.useFakeTimers();
    const api = mockApi();
    const idle = options(api, { brewing: false, nativeSequencerActive: true });
    const { rerender } = renderHook(({ value }) => useScaleShotFallback(value), { initialProps: { value: idle } });
    rerender({ value: options(api, { nativeSequencerActive: true }) });
    await act(async () => vi.advanceTimersByTimeAsync(25_000));

    rerender({ value: options(api, { nativeSequencerActive: false, machineSubstate: "pouring" }) });
    await act(async () => vi.advanceTimersByTimeAsync(1000));

    expect(api.tareScale).not.toHaveBeenCalled();
  });
});
