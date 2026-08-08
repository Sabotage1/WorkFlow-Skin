import { useEffect, useRef, useState } from "react";
import type { WeightSnapshot } from "../api/types";

const FALLBACK_OWNERSHIP_DELAY_MS = 300;
const FALLBACK_START_WINDOW_MS = 5000;
const WEIGHT_LOOKAHEAD_SECONDS = 0.3;

export interface ScaleShotFallbackApi {
  tareScale(): Promise<void>;
  startScaleTimer(): Promise<void>;
  stopScaleTimer(): Promise<void>;
  resetScaleTimer(): Promise<void>;
  requestMachineState(state: string): Promise<void>;
}

export interface ScaleShotFallbackOptions {
  api: ScaleShotFallbackApi;
  brewing: boolean;
  machineSubstate?: string;
  nativeSequencerActive: boolean;
  forceFallback: boolean;
  scaleConnected: boolean;
  scaleSnapshot: WeightSnapshot | null;
  targetYield?: number;
}

interface FallbackState {
  active: boolean;
  timerStarted: boolean;
  zeroObserved: boolean;
  stopRequested: boolean;
  generation: number;
  preparePromise: Promise<void> | null;
}

function compact(value: string | undefined): string {
  return value?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
}

function pourHasStarted(substate: string | undefined): boolean {
  const value = compact(substate);
  return value === "preinfusion" || value === "pouring";
}

function freshState(generation: number): FallbackState {
  return { active: false, timerStarted: false, zeroObserved: false, stopRequested: false, generation, preparePromise: null };
}

/**
 * Owns scale commands only when Decaid's native shot sequencer failed to
 * enter an active lifecycle (or Full gateway mode explicitly bypassed it).
 * Healthy native sequencing always wins and this hook remains passive.
 */
export function useScaleShotFallback(options: ScaleShotFallbackOptions): boolean {
  const [active, setActive] = useState(false);
  const stateRef = useRef<FallbackState>(freshState(0));
  const observedIdleRef = useRef(false);
  const wasBrewingRef = useRef(false);
  const eligibleBrewStartRef = useRef(false);
  const brewStartedAtRef = useRef(0);

  useEffect(() => {
    if (!options.brewing) {
      observedIdleRef.current = true;
      wasBrewingRef.current = false;
      eligibleBrewStartRef.current = false;
      brewStartedAtRef.current = 0;
      return;
    }
    if (wasBrewingRef.current) return;
    wasBrewingRef.current = true;
    eligibleBrewStartRef.current = observedIdleRef.current;
    brewStartedAtRef.current = Date.now();
  }, [options.brewing]);

  useEffect(() => {
    const state = stateRef.current;
    if (!options.brewing) {
      const wasActive = state.active;
      stateRef.current = freshState(state.generation + 1);
      setActive(false);
      if (wasActive) void options.api.stopScaleTimer().catch(() => undefined);
      return;
    }

    if ((options.nativeSequencerActive && !options.forceFallback) || !options.scaleConnected) {
      stateRef.current = freshState(state.generation + 1);
      setActive(false);
      return;
    }
    if (state.active) return;
    if (!eligibleBrewStartRef.current || Date.now() - brewStartedAtRef.current > FALLBACK_START_WINDOW_MS) return;

    const generation = state.generation + 1;
    stateRef.current = freshState(generation);
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      if (current.generation !== generation) return;
      current.active = true;
      setActive(true);
      current.preparePromise = (async () => {
        try {
          await options.api.tareScale();
          if (stateRef.current.generation !== generation) return;
          await options.api.resetScaleTimer();
        } catch {
          // Weight-stop remains guarded by observing a near-zero post-tare
          // sample, so a failed command cannot stop on the cup's raw weight.
        }
      })();
    }, FALLBACK_OWNERSHIP_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [options.api, options.brewing, options.forceFallback, options.nativeSequencerActive, options.scaleConnected]);

  useEffect(() => {
    const state = stateRef.current;
    if (!active || !state.active || state.timerStarted || !pourHasStarted(options.machineSubstate)) return;
    const generation = state.generation;
    state.timerStarted = true;
    void (async () => {
      try {
        await state.preparePromise;
        if (stateRef.current.generation !== generation) return;
        await options.api.tareScale();
        if (stateRef.current.generation !== generation) return;
        await options.api.startScaleTimer();
      } catch {
        state.timerStarted = false;
      }
    })();
  }, [active, options.api, options.machineSubstate]);

  useEffect(() => {
    const state = stateRef.current;
    const target = options.targetYield;
    const snapshot = options.scaleSnapshot;
    if (!active || !state.active || !state.timerStarted || state.stopRequested || !snapshot) return;
    if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) return;
    if (typeof snapshot.weight !== "number" || !Number.isFinite(snapshot.weight)) return;

    const nearZeroThreshold = Math.max(2, Math.min(8, target * 0.2));
    if (Math.abs(snapshot.weight) <= nearZeroThreshold) state.zeroObserved = true;
    if (!state.zeroObserved) return;

    const weightFlow = typeof snapshot.weightFlow === "number" && Number.isFinite(snapshot.weightFlow) ? Math.max(0, snapshot.weightFlow) : 0;
    const projectedWeight = snapshot.weight + weightFlow * WEIGHT_LOOKAHEAD_SECONDS;
    if (projectedWeight < target) return;

    state.stopRequested = true;
    void options.api.requestMachineState("idle").catch(() => {
      state.stopRequested = false;
    });
  }, [active, options.api, options.scaleSnapshot, options.targetYield]);

  return active;
}
