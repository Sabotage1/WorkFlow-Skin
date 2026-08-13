import { useCallback, useEffect, useRef, useState } from "react";
import { apiWebSocketBaseUrl } from "../api/reaprime";
import type { ShotSnapshot, WaterLevels, WeightSnapshot } from "../api/types";
import { appendLiveMeasurement, shouldClearForShotStart } from "../lib/liveMeasurements";
import { parseShotLifecycle, retainLatestFinishedShotLifecycle, type ShotLifecycle } from "../lib/shotLifecycle";

export interface LiveTelemetryOptions {
  streamScale?: boolean;
}

const SCALE_STATUS_READING_TIMEOUT_MS = 5000;
export const MACHINE_SNAPSHOT_STALE_TIMEOUT_MS = 3000;
const MACHINE_SNAPSHOT_UI_INTERVAL_MS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJson(value: MessageEvent["data"]): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseScaleSnapshot(value: unknown): WeightSnapshot | null {
  if (!isRecord(value)) return null;
  const weight = numberValue(value.weight);
  const weightFlow = numberValue(value.weightFlow);
  const timerValue = numberValue(value.timerValue);
  const battery = numberValue(value.battery);
  if (weight === undefined && weightFlow === undefined && timerValue === undefined && battery === undefined) return null;
  return {
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    weight,
    weightFlow,
    timerValue,
    battery: battery ?? null
  };
}

function parseMachineSnapshot(value: unknown): ShotSnapshot["machine"] | null {
  if (!isRecord(value)) return null;
  return {
    timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined,
    pressure: numberValue(value.pressure),
    targetPressure: numberValue(value.targetPressure),
    flow: numberValue(value.flow),
    targetFlow: numberValue(value.targetFlow),
    mixTemperature: numberValue(value.mixTemperature),
    groupTemperature: numberValue(value.groupTemperature),
    targetMixTemperature: numberValue(value.targetMixTemperature),
    targetGroupTemperature: numberValue(value.targetGroupTemperature),
    state: isRecord(value.state)
      ? {
          state: typeof value.state.state === "string" ? value.state.state : undefined,
          substate: typeof value.state.substate === "string" ? value.state.substate : undefined
        }
      : undefined
  };
}

function parseWaterLevels(value: unknown): WaterLevels | null {
  if (!isRecord(value)) return null;
  const currentLevel = numberValue(value.currentLevel);
  const refillLevel = numberValue(value.refillLevel);
  if (currentLevel === undefined && refillLevel === undefined) return null;
  return { currentLevel, refillLevel };
}

function isTestBrowser(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.toLowerCase().includes("jsdom");
}

function compactMode(value: string | undefined): string {
  return value?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
}

function isBrewingState(value: string | undefined): boolean {
  const state = compactMode(value);
  return state === "espresso" || state === "brewing";
}

export function useLiveTelemetry(baseUrl = apiWebSocketBaseUrl(), options: LiveTelemetryOptions = {}) {
  const liveVerificationActive = !isTestBrowser() && typeof WebSocket === "function";
  const scaleVerificationActive = liveVerificationActive;
  const machineVerificationActive = liveVerificationActive;
  const [measurements, setMeasurements] = useState<ShotSnapshot[]>([]);
  const [scaleSnapshot, setScaleSnapshot] = useState<WeightSnapshot | null>(null);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [waterLevels, setWaterLevels] = useState<WaterLevels | null>(null);
  const [machineSnapshot, setMachineSnapshot] = useState<ShotSnapshot["machine"] | null>(null);
  const [machineMode, setMachineMode] = useState<{ state?: string; substate?: string } | null>(null);
  const [machineStreamConnected, setMachineStreamConnected] = useState(false);
  const [shotLifecycle, setShotLifecycle] = useState<ShotLifecycle | null>(null);
  const [latestFinishedShotLifecycle, setLatestFinishedShotLifecycle] = useState<ShotLifecycle | null>(null);
  const [connectionGeneration, setConnectionGeneration] = useState(0);
  const lastMachineRef = useRef<ShotSnapshot["machine"] | null>(null);
  const lastScaleRef = useRef<WeightSnapshot | null>(null);
  const streamScaleRef = useRef(options.streamScale ?? false);
  const brewingRef = useRef(false);
  const activeShotIdRef = useRef<string | null>(null);
  const getLatestScaleSnapshot = useCallback(() => lastScaleRef.current, []);
  const reconnect = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    setConnectionGeneration((current) => current + 1);
  }, []);

  useEffect(() => {
    streamScaleRef.current = options.streamScale ?? false;
  }, [options.streamScale]);

  useEffect(() => {
    if (isTestBrowser() || typeof WebSocket !== "function") return;
    const onVisibilityChange = () => {
      if (document.visibilityState !== "hidden") reconnect();
    };
    window.addEventListener("focus", reconnect);
    window.addEventListener("pageshow", reconnect);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("pageshow", reconnect);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [reconnect]);

  useEffect(() => {
    if (isTestBrowser() || typeof WebSocket !== "function") return;

    let disposed = false;
    let reconnectTimer: number | null = null;
    let scaleStatusTimer: number | null = null;
    let machineSnapshotTimer: number | null = null;
    let lastPublishedMachineSnapshotAt = 0;
    const sockets: WebSocket[] = [];
    const clearScaleStatusTimer = () => {
      if (scaleStatusTimer === null) return;
      window.clearTimeout(scaleStatusTimer);
      scaleStatusTimer = null;
    };
    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (!disposed && document.visibilityState !== "hidden") {
          setConnectionGeneration((current) => current + 1);
        }
      }, 1000);
    };
    const clearMachineSnapshotTimer = () => {
      if (machineSnapshotTimer === null) return;
      window.clearTimeout(machineSnapshotTimer);
      machineSnapshotTimer = null;
    };
    const connect = (
      path: string,
      onMessage: (data: unknown) => void,
      handlers: { onOpen?: () => void; onClose?: () => void; reconnectOnClose?: boolean } = {}
    ) => {
      const socket = new WebSocket(`${baseUrl}${path}`);
      socket.addEventListener("open", () => handlers.onOpen?.());
      socket.addEventListener("message", (event) => onMessage(parseJson(event.data)));
      socket.addEventListener("close", () => {
        handlers.onClose?.();
        if (handlers.reconnectOnClose !== false) scheduleReconnect();
      });
      socket.addEventListener("error", () => socket.close());
      sockets.push(socket);
      return socket;
    };

    lastMachineRef.current = null;
    lastScaleRef.current = null;
    brewingRef.current = false;
    activeShotIdRef.current = null;
    setMachineMode(null);
    setMachineSnapshot(null);
    setMachineStreamConnected(false);
    setScaleConnected(false);
    setShotLifecycle(null);

    let machineSocket: WebSocket | null = null;
    const markMachineStreamStale = () => {
      clearMachineSnapshotTimer();
      lastMachineRef.current = null;
      brewingRef.current = false;
      setMachineMode(null);
      setMachineSnapshot(null);
      setMachineStreamConnected(false);
      machineSocket?.close();
    };
    const armMachineSnapshotTimer = () => {
      clearMachineSnapshotTimer();
      machineSnapshotTimer = window.setTimeout(markMachineStreamStale, MACHINE_SNAPSHOT_STALE_TIMEOUT_MS);
    };

    machineSocket = connect("/ws/v1/machine/snapshot", (data) => {
      const machine = parseMachineSnapshot(data);
      if (!machine) return;
      armMachineSnapshotTimer();
      setMachineStreamConnected(true);
      const previousMachine = lastMachineRef.current;
      const machineModeChanged =
        previousMachine?.state?.state !== machine.state?.state || previousMachine?.state?.substate !== machine.state?.substate;
      const now = Date.now();
      if (machineModeChanged || now - lastPublishedMachineSnapshotAt >= MACHINE_SNAPSHOT_UI_INTERVAL_MS) {
        lastPublishedMachineSnapshotAt = now;
        setMachineSnapshot(machine);
      }
      lastMachineRef.current = machine;
      const nextBrewing = isBrewingState(machine.state?.state);
      const startsNewBrew = nextBrewing && !brewingRef.current;
      brewingRef.current = nextBrewing;
      const nextMode = { state: machine.state?.state, substate: machine.state?.substate };
      setMachineMode((current) => (current?.state === nextMode.state && current?.substate === nextMode.substate ? current : nextMode));

      if (brewingRef.current) {
        setMeasurements((current) => appendLiveMeasurement(current, { machine, scale: lastScaleRef.current ?? undefined }, startsNewBrew));
      }
    }, {
      // An open socket is not proof that the physical machine is still
      // reporting. It becomes live only after the first current snapshot.
      onOpen: armMachineSnapshotTimer,
      onClose: () => {
        clearMachineSnapshotTimer();
        lastMachineRef.current = null;
        brewingRef.current = false;
        setMachineMode(null);
        setMachineSnapshot(null);
        setMachineStreamConnected(false);
      }
    });

    connect("/ws/v1/scale/snapshot", (data) => {
      if (isRecord(data) && typeof data.status === "string") {
        if (data.status === "connected") {
          setScaleConnected(true);
          clearScaleStatusTimer();
          if (!lastScaleRef.current) {
            scaleStatusTimer = window.setTimeout(() => {
              scaleStatusTimer = null;
              if (!lastScaleRef.current) setScaleConnected(false);
            }, SCALE_STATUS_READING_TIMEOUT_MS);
          }
        } else if (data.status === "disconnected") {
          clearScaleStatusTimer();
          lastScaleRef.current = null;
          setScaleConnected(false);
        }
        return;
      }

      const scale = parseScaleSnapshot(data);
      if (!scale) return;
      clearScaleStatusTimer();
      lastScaleRef.current = scale;
      setScaleConnected((current) => (current ? current : true));
      if (streamScaleRef.current || brewingRef.current) setScaleSnapshot(scale);
      if (brewingRef.current && lastMachineRef.current) {
        setMeasurements((current) => appendLiveMeasurement(current, { machine: lastMachineRef.current ?? undefined, scale }));
      }
    }, {
      onClose: () => {
        clearScaleStatusTimer();
        lastScaleRef.current = null;
        setScaleConnected(false);
      }
    });

    connect("/ws/v1/machine/waterLevels", (data) => {
      const levels = parseWaterLevels(data);
      if (levels) setWaterLevels(levels);
    });

    connect("/ws/v1/machine/shotState", (data) => {
      const lifecycle = parseShotLifecycle(data);
      if (!lifecycle) return;
      if (shouldClearForShotStart(lifecycle, activeShotIdRef.current, brewingRef.current)) {
        setMeasurements([]);
      }
      if (lifecycle.shotId && lifecycle.state !== "idle") activeShotIdRef.current = lifecycle.shotId;
      if (lifecycle.state === "idle") activeShotIdRef.current = null;
      if (lifecycle.scaleConnected === false) setScaleConnected(false);
      setShotLifecycle(lifecycle);
      setLatestFinishedShotLifecycle((current) => retainLatestFinishedShotLifecycle(current, lifecycle));
    }, {
      onClose: () => setShotLifecycle(null),
      // Older Decaid builds do not expose this optional endpoint. Its failure
      // must not tear down the healthy machine, scale, and water streams.
      reconnectOnClose: false
    });

    return () => {
      disposed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearMachineSnapshotTimer();
      clearScaleStatusTimer();
      for (const socket of sockets) socket.close();
    };
  }, [baseUrl, connectionGeneration]);

  return {
    measurements,
    scaleSnapshot,
    scaleConnected,
    scaleVerificationActive,
    machineVerificationActive,
    waterLevels,
    machineSnapshot,
    machineMode,
    machineStreamConnected,
    shotLifecycle,
    latestFinishedShotLifecycle,
    getLatestScaleSnapshot,
    reconnect
  };
}
