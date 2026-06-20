import { useEffect, useRef, useState } from "react";
import { apiWebSocketBaseUrl } from "../api/reaprime";
import type { ShotSnapshot, WaterLevels, WeightSnapshot } from "../api/types";
import { appendLiveMeasurement } from "../lib/liveMeasurements";

export interface LiveTelemetryOptions {
  recordIdle?: boolean;
}

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
  const [measurements, setMeasurements] = useState<ShotSnapshot[]>([]);
  const [scaleSnapshot, setScaleSnapshot] = useState<WeightSnapshot | null>(null);
  const [scaleConnected, setScaleConnected] = useState(false);
  const [waterLevels, setWaterLevels] = useState<WaterLevels | null>(null);
  const [machineMode, setMachineMode] = useState<{ state?: string; substate?: string } | null>(null);
  const lastMachineRef = useRef<ShotSnapshot["machine"] | null>(null);
  const lastScaleRef = useRef<WeightSnapshot | null>(null);
  const recordIdleRef = useRef(options.recordIdle ?? false);
  const brewingRef = useRef(false);

  useEffect(() => {
    recordIdleRef.current = options.recordIdle ?? false;
  }, [options.recordIdle]);

  useEffect(() => {
    if (isTestBrowser() || typeof WebSocket !== "function") return;

    const sockets: WebSocket[] = [];
    const connect = (path: string, onMessage: (data: unknown) => void) => {
      const socket = new WebSocket(`${baseUrl}${path}`);
      socket.addEventListener("message", (event) => onMessage(parseJson(event.data)));
      sockets.push(socket);
    };

    connect("/ws/v1/machine/snapshot", (data) => {
      const machine = parseMachineSnapshot(data);
      if (!machine) return;
      lastMachineRef.current = machine;
      const nextBrewing = isBrewingState(machine.state?.state);
      const startsNewBrew = nextBrewing && !brewingRef.current;
      brewingRef.current = nextBrewing;
      const nextMode = { state: machine.state?.state, substate: machine.state?.substate };
      setMachineMode((current) => (current?.state === nextMode.state && current?.substate === nextMode.substate ? current : nextMode));

      if (recordIdleRef.current || brewingRef.current) {
        setMeasurements((current) => appendLiveMeasurement(current, { machine, scale: lastScaleRef.current ?? undefined }, startsNewBrew));
      }
    });

    connect("/ws/v1/scale/snapshot", (data) => {
      if (isRecord(data) && typeof data.status === "string") {
        const connected = data.status === "connected";
        setScaleConnected((current) => (current === connected ? current : connected));
        return;
      }

      const scale = parseScaleSnapshot(data);
      if (!scale) return;
      lastScaleRef.current = scale;
      setScaleConnected((current) => (current ? current : true));
      if (recordIdleRef.current || brewingRef.current) setScaleSnapshot(scale);
      if ((recordIdleRef.current || brewingRef.current) && lastMachineRef.current) {
        setMeasurements((current) => appendLiveMeasurement(current, { machine: lastMachineRef.current ?? undefined, scale }));
      }
    });

    connect("/ws/v1/machine/waterLevels", (data) => {
      const levels = parseWaterLevels(data);
      if (levels) setWaterLevels(levels);
    });

    return () => {
      for (const socket of sockets) socket.close();
    };
  }, [baseUrl]);

  return { measurements, scaleSnapshot, scaleConnected, waterLevels, machineMode };
}
