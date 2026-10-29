import { afterEach, describe, expect, it, vi } from "vitest";
import { executeR2Measurement, extractR2Tds, findDifluidR2Sensor } from "../api/sensors";
import type { SensorListItem } from "../api/types";

const pluginId = "plugin:difluid-r2.reaplugin:difluid-r2:F4:12:FA:FA:AC:E3";
const pending = { status: "error" as const, message: "DiFluid R2 has no completed reading" };
const completed = { status: "ok" as const, result: { reading: { tds: 9.7 } } };

afterEach(() => vi.useRealTimers());

describe("R2 measurement contracts", () => {
  it("keeps the native blocking measure command", async () => {
    const api = { executeSensor: vi.fn().mockResolvedValue(completed) };
    await expect(executeR2Measurement(api, "F4:12:FA:FA:AC:E3")).resolves.toEqual(completed);
    expect(api.executeSensor).toHaveBeenCalledExactlyOnceWith("F4:12:FA:FA:AC:E3", "measure", { timeout: 30 });
  });

  it("starts the plugin without parameters and waits beyond Decaid's invocation limit", async () => {
    vi.useFakeTimers();
    const api = { executeSensor: vi.fn().mockResolvedValue(pending) };
    api.executeSensor.mockResolvedValueOnce({ status: "ok", result: { started: true } });
    const measured = vi.fn();
    const reading = executeR2Measurement(api, pluginId).then(measured);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(measured).not.toHaveBeenCalled();
    expect(api.executeSensor).toHaveBeenNthCalledWith(1, pluginId, "measure", {});
    expect(api.executeSensor).toHaveBeenLastCalledWith(pluginId, "getReading", {});
    api.executeSensor.mockResolvedValue(completed);
    await vi.advanceTimersByTimeAsync(500);
    await reading;
    expect(measured).toHaveBeenCalledExactlyOnceWith(completed);
    expect(api.executeSensor.mock.calls.filter(([, command]) => command === "measure")).toHaveLength(1);
  });

  it("treats the host's HTTP 500 no-reading response as pending", async () => {
    vi.useFakeTimers();
    const api = { executeSensor: vi.fn()
      .mockResolvedValueOnce({ status: "ok", result: { started: true } })
      .mockRejectedValueOnce(new Error('POST failed: 500 {"status":"error","message":"DiFluid R2 has no completed reading"}'))
      .mockResolvedValue(completed) };
    const reading = executeR2Measurement(api, pluginId);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(reading).resolves.toEqual(completed);
  });

  it("propagates a failed start without polling for an older reading", async () => {
    const failed = { status: "error", message: "DiFluid R2 is busy" };
    const api = { executeSensor: vi.fn().mockResolvedValue(failed) };
    await expect(executeR2Measurement(api, pluginId)).resolves.toEqual(failed);
    expect(api.executeSensor).toHaveBeenCalledTimes(1);
  });

  it("propagates a disconnect during polling", async () => {
    vi.useFakeTimers();
    const api = { executeSensor: vi.fn()
      .mockResolvedValueOnce({ status: "ok", result: { started: true } })
      .mockRejectedValueOnce(new Error("DiFluid R2 disconnected")) };
    const reading = expect(executeR2Measurement(api, pluginId)).rejects.toThrow("disconnected");
    await vi.advanceTimersByTimeAsync(500);
    await reading;
  });

  it("stops waiting when the driver never provides a result", async () => {
    vi.useFakeTimers();
    const api = { executeSensor: vi.fn().mockResolvedValue(pending)
      .mockResolvedValueOnce({ status: "ok", result: { started: true } }) };
    const reading = expect(executeR2Measurement(api, pluginId)).rejects.toThrow("within 60 seconds");
    await vi.advanceTimersByTimeAsync(60_000);
    await reading;
    const count = api.executeSensor.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.executeSensor).toHaveBeenCalledTimes(count);
  });

  it("prefers the executable plugin when native metadata remains in the list", () => {
    const native: SensorListItem = { id: "native-r2", info: {
      vendor: "DiFluid", name: "R2", data: [{ key: "tds", type: "number" }], commands: [{ id: "measure" }]
    } };
    const plugin: SensorListItem = { id: pluginId, info: {
      vendor: "DiFluid", name: "R2", data: [{ key: "reading", type: "object" }], commands: [{ id: "measure" }, { id: "getReading" }]
    } };
    expect(findDifluidR2Sensor([native, plugin])).toEqual(plugin);
  });

  it("reads native and plugin results without inventing TDS from other channels", () => {
    expect(extractR2Tds({ reading: { tds: 0 } })).toBe(0);
    expect(extractR2Tds({ result: { reading: { tds: "9.7" } } })).toBe(9.7);
    expect(extractR2Tds({ data: [{ key: "tds", value: 8.5 }] })).toBe(8.5);
    expect(extractR2Tds({ reading: { tds: "" } })).toBeNull();
    expect(extractR2Tds({ data: [26, { reading: {} }] })).toBeNull();
    expect(extractR2Tds({ reading: { tds: Infinity } })).toBeNull();
  });
});
