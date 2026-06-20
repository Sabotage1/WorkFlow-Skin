import type { SensorListItem } from "./types";

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
    candidates.find((sensor) => hasTdsChannel(sensor) && hasMeasureCommand(sensor)) ??
    candidates.find(hasMeasureCommand) ??
    candidates.find(hasTdsChannel) ??
    candidates[0] ??
    null
  );
}

export function r2SocketUrl(apiBase: string, sensorId: string): string {
  const url = new URL(apiBase);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/v1/sensors/${encodeURIComponent(sensorId)}/snapshot`;
  return url.toString();
}
