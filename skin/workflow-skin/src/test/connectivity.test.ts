import { describe, expect, it } from "vitest";
import type { MachineState, SensorListItem } from "../api/types";
import { buildConnectivityStatuses } from "../lib/connectivity";

const scaleSensor: SensorListItem = {
  id: "scale-1",
  info: {
    vendor: "DiFluid",
    name: "Microbalance",
    data: [{ key: "weight", type: "number", unit: "g" }]
  }
};

const r2Sensor: SensorListItem = {
  id: "r2-1",
  info: {
    vendor: "DiFluid",
    name: "R2",
    data: [{ key: "tds", type: "number", unit: "%" }],
    commands: [{ id: "measure" }]
  }
};

describe("buildConnectivityStatuses", () => {
  it("shows machine, wifi, and scale status with machine IP", () => {
    const machineState: MachineState = {
      connected: true,
      wifi: { connected: true, ipAddress: "192.168.1.88" }
    };

    expect(
      buildConnectivityStatuses({
        apiHost: "localhost",
        machineState,
        sensors: [scaleSensor],
        r2SensorId: undefined,
        r2Sensor: null
      })
    ).toEqual([
      { id: "machine", label: "Machine", detail: "Connected", connected: true },
      { id: "wifi", label: "WiFi", detail: "192.168.1.88", connected: true },
      { id: "scale", label: "Scale", detail: "Connected", connected: true },
      { id: "water", label: "Water", detail: "Unknown", connected: false }
    ]);
  });

  it("marks scale connected from live scale status and shows water level", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [],
      r2SensorId: undefined,
      r2Sensor: null,
      scaleConnected: true,
      waterLevels: { currentLevel: 42, refillLevel: 15 }
    });

    expect(statuses.find((status) => status.id === "scale")).toEqual({
      id: "scale",
      label: "Scale",
      detail: "Connected",
      connected: true
    });
    expect(statuses.find((status) => status.id === "water")).toEqual({
      id: "water",
      label: "Water",
      detail: "42mm · 70%",
      connected: true
    });
  });

  it("uses the app local IP instead of localhost and connected scale devices", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "localhost",
      appInfo: { localIp: "10.0.0.200" },
      machineState: { connected: true },
      sensors: [],
      devices: [{ id: "scale-1", name: "Acaia", type: "scale", state: "connected" }],
      r2SensorId: undefined,
      r2Sensor: null
    } as any);

    expect(statuses.find((status) => status.id === "wifi")).toEqual({
      id: "wifi",
      label: "WiFi",
      detail: "10.0.0.200",
      connected: true
    });
    expect(statuses.find((status) => status.id === "scale")).toEqual({
      id: "scale",
      label: "Scale",
      detail: "Connected",
      connected: true
    });
  });

  it("marks BooKoo and Decent scale sensors connected when native state is ready", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [],
      devices: [
        { id: "bookoo", name: "BooKoo Themis", type: "sensor", state: "ready" },
        { id: "decent", name: "Decent Scale", type: "sensor", state: "online" }
      ],
      r2SensorId: undefined,
      r2Sensor: null
    } as any);

    expect(statuses.find((status) => status.id === "scale")).toEqual({
      id: "scale",
      label: "Scale",
      detail: "Connected",
      connected: true
    });
  });

  it("marks scale disconnected when native device state is explicitly disconnected even if a scale sensor is listed", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [scaleSensor],
      devices: [{ id: "scale-1", name: "Acaia", type: "scale", state: "disconnected" }],
      r2SensorId: undefined,
      r2Sensor: null
    });

    expect(statuses.find((status) => status.id === "scale")).toEqual({
      id: "scale",
      label: "Scale",
      detail: "Not connected",
      connected: false
    });
  });

  it("does not treat a stale scale sensor as connected when native devices are available", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [scaleSensor],
      devices: [],
      r2SensorId: undefined,
      r2Sensor: null
    });

    expect(statuses.find((status) => status.id === "scale")).toEqual({
      id: "scale",
      label: "Scale",
      detail: "Not connected",
      connected: false
    });
  });

  it("marks water red when it is at or below the refill level", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [],
      r2SensorId: undefined,
      r2Sensor: null,
      waterLevels: { currentLevel: 12, refillLevel: 15 }
    });

    expect(statuses.find((status) => status.id === "water")).toEqual({
      id: "water",
      label: "Water",
      detail: "Low 12mm · 20%",
      connected: false
    });
  });

  it("hides R2 status until it is configured in settings", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [r2Sensor],
      r2SensorId: undefined,
      r2Sensor
    });

    expect(statuses.map((status) => status.id)).not.toContain("r2");
  });

  it("marks configured R2 red when the configured sensor is not detected", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [],
      r2SensorId: "r2-1",
      r2Sensor: null
    });

    expect(statuses.find((status) => status.id === "r2")).toEqual({
      id: "r2",
      label: "R2",
      detail: "Not connected",
      connected: false
    });
  });

  it("marks configured R2 connected from native ReaPrime device state when sensors are stale", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [],
      r2SensorId: "F4:12:FA:FA:AC:E3",
      r2Sensor: null,
      r2Connected: true
    });

    expect(statuses.find((status) => status.id === "r2")).toEqual({
      id: "r2",
      label: "R2",
      detail: "Connected",
      connected: true
    });
  });

  it("does not treat a stale configured R2 sensor as connected when native devices are available", () => {
    const statuses = buildConnectivityStatuses({
      apiHost: "192.168.1.88",
      machineState: { connected: true },
      sensors: [r2Sensor],
      devices: [],
      r2SensorId: "r2-1",
      r2Sensor
    });

    expect(statuses.find((status) => status.id === "r2")).toEqual({
      id: "r2",
      label: "R2",
      detail: "Not connected",
      connected: false
    });
  });
});
