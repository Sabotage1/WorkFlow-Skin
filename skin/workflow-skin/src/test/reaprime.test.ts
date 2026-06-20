import { afterEach, describe, expect, it, vi } from "vitest";
import { apiBaseUrl, ReaPrimeApi } from "../api/reaprime";

describe("apiBaseUrl", () => {
  it("uses the current hostname on ReaPrime port 8080", () => {
    expect(apiBaseUrl(new URL("http://192.168.1.20:3000/"))).toBe("http://192.168.1.20:8080");
  });

  it("uses localhost when no browser location is supplied", () => {
    expect(apiBaseUrl()).toBe("http://localhost:8080");
  });
});

describe("ReaPrimeApi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("loads profiles from ReaPrime", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ id: "p1", profile: { title: "Bloom" } }]), { status: 200 })
    );
    const api = new ReaPrimeApi("http://machine:8080");
    await expect(api.listProfiles()).resolves.toEqual([{ id: "p1", profile: { title: "Bloom" } }]);
    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/profiles", expect.objectContaining({ method: "GET" }));
  });

  it("loads Decent account status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ connected: true, username: "royack" }), { status: 200 }));
    const api = new ReaPrimeApi("http://machine:8080");
    await expect(api.getDecentAccount()).resolves.toEqual({ connected: true, username: "royack" });
    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/account/decent", expect.objectContaining({ method: "GET" }));
  });

  it("updates profiles through the ReaPrime profiles API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p1", profile: { title: "Bloom v2", author: "Roy" } }), { status: 200 })
    );
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.updateProfile("p1", { profile: { title: "Bloom v2", author: "Roy" } })).resolves.toEqual({
      id: "p1",
      profile: { title: "Bloom v2", author: "Roy" }
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/profiles/p1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ profile: { title: "Bloom v2", author: "Roy" } })
      })
    );
  });

  it("creates profiles through the ReaPrime profiles API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "p3", profile: { title: "Bloom copy" }, parentId: "p1" }), { status: 201 })
    );
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.createProfile({ profile: { title: "Bloom copy" }, parentId: "p1" })).resolves.toEqual({
      id: "p3",
      profile: { title: "Bloom copy" },
      parentId: "p1"
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/profiles",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ profile: { title: "Bloom copy" }, parentId: "p1" })
      })
    );
  });

  it("throws readable errors for non-2xx responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("bad", { status: 500 }));
    const api = new ReaPrimeApi("http://machine:8080");
    const request = api.getWorkflow();
    await expect(request).rejects.toThrow("GET /api/v1/workflow failed: 500 bad");
    await expect(request).rejects.toMatchObject({ status: 500 });
  });

  it("returns null for missing remote storage entries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("missing", { status: 404 }));
    const api = new ReaPrimeApi("http://machine:8080");
    await expect(api.getKv("workflow skin", "settings/key")).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/store/workflow%20skin/settings%2Fkey",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/kv/workflow%20skin/settings%2Fkey",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("loads saved settings from local storage when remote storage routes are absent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("Route not found", { status: 404 })));
    localStorage.setItem("reaprime-skin:workflow-skin:settings", JSON.stringify({ presetSlots: [{ label: "Light", profileId: "p1" }] }));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.getKv("workflow-skin", "settings")).resolves.toEqual({ presetSlots: [{ label: "Light", profileId: "p1" }] });
  });

  it("throws non-404 storage errors even when the response mentions 404", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("upstream mentioned 404", { status: 500 }));
    const api = new ReaPrimeApi("http://machine:8080");
    await expect(api.getKv("workflow-skin", "settings")).rejects.toThrow(
      "GET /api/v1/store/workflow-skin/settings failed: 500 upstream mentioned 404"
    );
  });

  it("creates beans through the ReaPrime bean API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "bean-1", roaster: "Pilot", name: "Halo" }), { status: 200 })
    );
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(
      api.createBean({
        roaster: "Pilot",
        name: "Halo",
        country: "Ethiopia",
        region: "Gedeb",
        processing: "Washed",
        notes: "Citrus",
        extras: { workflowSkin: true }
      })
    ).resolves.toEqual({ id: "bean-1", roaster: "Pilot", name: "Halo" });

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/beans",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roaster: "Pilot",
          name: "Halo",
          country: "Ethiopia",
          region: "Gedeb",
          processing: "Washed",
          notes: "Citrus",
          extras: { workflowSkin: true }
        })
      })
    );
  });

  it("creates batches for beans through the ReaPrime batch API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "batch-1", beanId: "bean/1", roastDate: "2026-06-01" }), { status: 200 })
    );
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(
      api.createBatch("bean/1", {
        roastDate: "2026-06-01",
        roastLevel: "Light",
        notes: "Rest 10 days",
        extras: { workflowSkin: { createdFromBagForm: true } }
      })
    ).resolves.toEqual({ id: "batch-1", beanId: "bean/1", roastDate: "2026-06-01" });

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/beans/bean%2F1/batches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roastDate: "2026-06-01",
          roastLevel: "Light",
          notes: "Rest 10 days",
          extras: { workflowSkin: { createdFromBagForm: true } }
        })
      })
    );
  });

  it("deletes beans through the ReaPrime bean API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.deleteBean("bean/1")).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/beans/bean%2F1",
      expect.objectContaining({
        method: "DELETE"
      })
    );
  });

  it("falls back to plugin settings when the KV route is absent", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (method === "POST" && url.pathname === "/api/v1/store/workflow-skin/settings") {
        return Promise.resolve(new Response("Route not found", { status: 404 }));
      }
      if (method === "PUT" && url.pathname === "/api/v1/kv/workflow-skin/settings") {
        return Promise.resolve(new Response("Route not found", { status: 404 }));
      }
      if (method === "POST" && url.pathname === "/api/v1/plugins/workflow-skin/settings") {
        return Promise.resolve(new Response(String(init.body), { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled ${method} ${url.pathname}`));
    });
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.putKv("workflow-skin", "settings", { presetSlots: [{ label: "Light", profileId: "p2" }] })).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/store/workflow-skin/settings", expect.objectContaining({ method: "POST" }));
    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/kv/workflow-skin/settings", expect.objectContaining({ method: "PUT" }));
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/plugins/workflow-skin/settings",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ presetSlots: [{ label: "Light", profileId: "p2" }] }) })
    );
  });

  it("falls back to local storage when remote settings storage is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("Route not found", { status: 404 })));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.putKv("workflow-skin", "settings", { presetSlots: [{ label: "Light", profileId: "p2" }] })).resolves.toBeUndefined();

    expect(localStorage.getItem("reaprime-skin:workflow-skin:settings")).toBe(JSON.stringify({ presetSlots: [{ label: "Light", profileId: "p2" }] }));
  });

  it("falls back to local storage when the settings route cannot be fetched", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.putKv("workflow-skin", "settings", { presetSlots: [{ label: "Light", profileId: "p2" }] })).resolves.toBeUndefined();

    expect(localStorage.getItem("reaprime-skin:workflow-skin:settings")).toBe(JSON.stringify({ presetSlots: [{ label: "Light", profileId: "p2" }] }));
  });

  it("requests machine sleep through the machine state API", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.sleepMachine()).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/machine/state/sleeping",
      expect.objectContaining({
        method: "PUT"
      })
    );
  });

  it("wraps app info and device connection APIs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method ?? "GET";
      if (method === "GET" && url.pathname === "/api/v1/info") {
        return Promise.resolve(new Response(JSON.stringify({ localIp: "10.0.0.200", version: "0.7.6" }), { status: 200 }));
      }
      if (method === "GET" && url.pathname === "/api/v1/devices") {
        return Promise.resolve(new Response(JSON.stringify([{ id: "scale-1", type: "scale", state: "disconnected" }]), { status: 200 }));
      }
      if (method === "GET" && url.pathname === "/api/v1/devices/scan") {
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (method === "PUT" && url.pathname === "/api/v1/devices/connect") {
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled ${method} ${url.pathname}${url.search}`));
    });
    const api = new ReaPrimeApi("http://machine:8080");

    await expect((api as any).getAppInfo()).resolves.toEqual({ localIp: "10.0.0.200", version: "0.7.6" });
    await expect((api as any).listDevices()).resolves.toEqual([{ id: "scale-1", type: "scale", state: "disconnected" }]);
    await expect((api as any).scanDevices({ connect: true, quick: true })).resolves.toEqual([]);
    await expect((api as any).connectDevice("scale-1")).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/info", expect.objectContaining({ method: "GET" }));
    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/devices", expect.objectContaining({ method: "GET" }));
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/devices/scan?connect=true&quick=true",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
    );
  });

  it("falls back to alternate device connection payloads", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init = {}) => {
      const url = new URL(String(input));
      const body = String(init.body ?? "");
      if (url.pathname === "/api/v1/devices/connect" && init.method === "PUT" && body === JSON.stringify({ deviceId: "scale-1" })) {
        return Promise.resolve(new Response("deviceId not accepted", { status: 404 }));
      }
      if (url.pathname === "/api/v1/devices/connect" && init.method === "PUT" && body === JSON.stringify({ id: "scale-1" })) {
        return Promise.resolve(new Response("", { status: 200 }));
      }
      return Promise.reject(new Error(`Unhandled ${init.method} ${url.pathname} ${body}`));
    });
    const api = new ReaPrimeApi("http://machine:8080");

    await expect((api as any).connectDevice("scale-1")).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ id: "scale-1" }) })
    );
  });

  it("controls native display brightness and wake-lock", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ brightness: 8, wakeLockOverride: false }), { status: 200 }))
    );
    const api = new ReaPrimeApi("http://machine:8080");

    await expect((api as any).setDisplayBrightness(8)).resolves.toEqual({ brightness: 8, wakeLockOverride: false });
    await expect((api as any).releaseWakeLock()).resolves.toEqual({ brightness: 8, wakeLockOverride: false });
    await expect((api as any).requestWakeLock()).resolves.toEqual({ brightness: 8, wakeLockOverride: false });

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/display/brightness",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ brightness: 8 }) })
    );
    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/display/wakelock", expect.objectContaining({ method: "DELETE" }));
    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/display/wakelock", expect.objectContaining({ method: "POST" }));
  });

  it("wraps steam history and entity editing APIs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "ok" }), { status: 200 })));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect((api as any).listSteams()).resolves.toEqual({ id: "ok" });
    await expect((api as any).updateBean("bean/1", { name: "Halo v2" })).resolves.toEqual({ id: "ok" });
    await expect((api as any).updateBatch("batch/1", { roastLevel: "Light" })).resolves.toEqual({ id: "ok" });
    await expect((api as any).createGrinder({ model: "ZP6", burrType: "flat", settingType: "numeric" })).resolves.toEqual({ id: "ok" });
    await expect((api as any).updateGrinder("grinder/1", { notes: "Seasoned" })).resolves.toEqual({ id: "ok" });

    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/steams", expect.objectContaining({ method: "GET" }));
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/beans/bean%2F1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ name: "Halo v2" }) })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/bean-batches/batch%2F1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ roastLevel: "Light" }) })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/grinders",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ model: "ZP6", burrType: "flat", settingType: "numeric" }) })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/grinders/grinder%2F1",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ notes: "Seasoned" }) })
    );
  });

  it("loads Visualizer plugin status and settings", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: "online" }), { status: 200 }))
    );
    const api = new ReaPrimeApi("http://machine:8080");

    await expect((api as any).listPlugins()).resolves.toEqual({ status: "online" });
    await expect((api as any).getPluginSettings("visualizer.reaplugin")).resolves.toEqual({ status: "online" });
    await expect((api as any).callPluginEndpoint("visualizer.reaplugin", "lastUpload")).resolves.toEqual({ status: "online" });

    expect(fetch).toHaveBeenCalledWith("http://machine:8080/api/v1/plugins", expect.objectContaining({ method: "GET" }));
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/plugins/visualizer.reaplugin/settings",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/plugins/visualizer.reaplugin/lastUpload",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("executes sensor commands with raw Bluetooth-style sensor ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok", result: { reading: { tds: 9.7 } } }), { status: 200 }));
    const api = new ReaPrimeApi("http://machine:8080");

    await expect(api.executeSensor("F4:12:FA:FA:AC:E3", "measure", { timeout: 30 })).resolves.toEqual({
      status: "ok",
      result: { reading: { tds: 9.7 } }
    });

    expect(fetch).toHaveBeenCalledWith(
      "http://machine:8080/api/v1/sensors/F4:12:FA:FA:AC:E3/execute",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ commandId: "measure", params: { timeout: 30 } }) })
    );
  });

});
