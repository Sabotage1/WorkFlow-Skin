import { afterEach, describe, expect, it, vi } from "vitest";
import type { SensorListItem } from "../api/types";
import { findDifluidR2Sensor } from "../api/sensors";
import { uploadShotToVisualizer } from "../api/visualizer";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("findDifluidR2Sensor", () => {
  it("matches a DiFluid R2 sensor by name and TDS channel", () => {
    const sensors: SensorListItem[] = [
      {
        id: "sensor-r2",
        info: {
          name: "DiFluid R2",
          vendor: "DiFluid",
          data: [{ key: "tds", type: "number", unit: "%" }],
          commands: [{ id: "measure" }]
        }
      }
    ];
    expect(findDifluidR2Sensor(sensors)?.id).toBe("sensor-r2");
  });

  it("matches a native DiFluid R2 sensor while ReaPrime metadata is still incomplete", () => {
    const sensors: SensorListItem[] = [
      {
        id: "sensor-r2",
        info: {
          name: "DiFluid R2",
          vendor: "DiFluid",
          data: [{ key: "tds", type: "number", unit: "%" }],
          commands: [{ id: "calibrate" }]
        }
      }
    ];
    expect(findDifluidR2Sensor(sensors)?.id).toBe("sensor-r2");
  });

  it("prefers the fully executable native R2 sensor when multiple R2 candidates exist", () => {
    const sensors: SensorListItem[] = [
      {
        id: "sensor-r2-starting",
        info: {
          name: "DiFluid R2",
          vendor: "DiFluid",
          data: [],
          commands: []
        }
      },
      {
        id: "sensor-r2-ready",
        info: {
          name: "DiFluid R2",
          vendor: "DiFluid",
          data: [{ key: "tds", type: "number", unit: "%" }],
          commands: [{ id: "measure" }]
        }
      }
    ];
    expect(findDifluidR2Sensor(sensors)?.id).toBe("sensor-r2-ready");
  });
});

describe("uploadShotToVisualizer", () => {
  it("posts to the bundled Visualizer plugin upload endpoint", async () => {
    const api = { baseUrl: "http://machine:8080" };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "vis-1" }), { status: 200 }));
    await expect(uploadShotToVisualizer(api, { id: "shot-1" })).resolves.toEqual({ id: "vis-1" });
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/plugins/visualizer.reaplugin/upload",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ shotId: "shot-1" }) })
    );
  });
});
