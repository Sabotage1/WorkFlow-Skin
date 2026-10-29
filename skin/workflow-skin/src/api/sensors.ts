import type { SensorListItem } from "./types";
import type { ReaPrimeApi } from "./reaprime";

export interface R2Reading {
  tds?: number;
  temperature?: number;
  refractiveIndex?: number;
  status?: string;
  error?: string;
}

function sensorSearchText(sensor: SensorListItem): string {
  return [sensor.id, sensor.info.vendor, sensor.info.name].filter(Boolean).join(" ").toLowerCase();
}

function hasTdsChannel(sensor: SensorListItem): boolean {
  return sensor.info.data.some((channel) => {
    const key = channel.key.toLowerCase();
    return key === "tds" || key.includes("tds") || key.includes("dissolved");
  });
}

function hasMeasureCommand(sensor: SensorListItem): boolean {
  return (
    sensor.info.commands?.some((command) => {
      const label = `${command.id} ${command.name ?? ""}`.toLowerCase();
      return label.includes("measure") || label.includes("read");
    }) ?? false
  );
}

function isDifluidR2Candidate(sensor: SensorListItem): boolean {
  const label = sensorSearchText(sensor);
  return (label.includes("difluid") && label.includes("r2")) || (label.includes("r2") && (hasTdsChannel(sensor) || hasMeasureCommand(sensor)));
}

export function findDifluidR2Sensor(sensors: SensorListItem[]): SensorListItem | null {
  const candidates = sensors.filter(isDifluidR2Candidate);
  return (
    candidates.find((sensor) => isPluginR2Sensor(sensor.id) && hasMeasureCommand(sensor)) ??
    candidates.find((sensor) => hasTdsChannel(sensor) && hasMeasureCommand(sensor)) ??
    candidates.find(hasMeasureCommand) ??
    candidates.find(hasTdsChannel) ??
    candidates[0] ??
    null
  );
}

export function isPluginR2Sensor(sensorId: string): boolean {
  return sensorId.startsWith("plugin:difluid-r2.reaplugin:difluid-r2:");
}

function numericTds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractR2Tds(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const tds = extractR2Tds(item);
      if (tds !== null) return tds;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  const direct = numericTds(record.tds);
  if (direct !== null) return direct;
  if (String(record.key).toLowerCase() === "tds") return numericTds(record.value);
  for (const key of ["result", "reading", "data"]) {
    const tds = extractR2Tds(record[key]);
    if (tds !== null) return tds;
  }
  return null;
}

function readingPending(message: string): boolean {
  return /no_reading|DiFluid R2 has no completed reading/i.test(message);
}

export async function executeR2Measurement(api: Pick<ReaPrimeApi, "executeSensor">, sensorId: string) {
  const result = await api.executeSensor(sensorId, "measure", isPluginR2Sensor(sensorId) ? {} : { timeout: 30 });
  if (result.status === "error" || extractR2Tds(result.result) !== null) return result;
  const started = (result.result as { started?: unknown } | undefined)?.started === true;
  if (!started) return result;

  // Plugin invocations are limited to 10 seconds; the measurement itself is
  // asynchronous. getReading is cleared by measure, so it cannot reuse an old test.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    try {
      const reading = await api.executeSensor(sensorId, "getReading", {});
      if (reading.status === "error") {
        if (readingPending(reading.message ?? "")) continue;
        return reading;
      }
      if (extractR2Tds(reading.result) !== null) return reading;
    } catch (error) {
      if (!(error instanceof Error) || !readingPending(error.message)) throw error;
    }
  }
  throw new Error("R2 did not return a completed TDS reading within 60 seconds.");
}

export function r2SocketUrl(apiBase: string, sensorId: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/v1/sensors/${encodeURIComponent(sensorId)}/snapshot`;
  return url.toString();
}
