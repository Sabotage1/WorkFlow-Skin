import { expect, test } from "@playwright/test";

test("automatically reads the dedicated R2 driver, reads again manually, and saves TDS/EY", async ({ page }, testInfo) => {
  const nativeId = "F4:12:FA:FA:AC:E3";
  const sensorId = `plugin:difluid-r2.reaplugin:difluid-r2:${nativeId}`;
  const profile = { title: "Morning espresso" };
  const workflow = { profile, context: { targetDoseWeight: 18, targetYield: 36 } };
  const shot = { id: "r2-shot", timestamp: "2026-10-29T08:00:00Z", workflow, annotations: { actualYield: 36 }, measurements: [] };
  let mode = "espresso";
  let saved = false;
  let measureCount = 0;
  let pendingCount = 0;
  let readyAt = 0;
  let settings: Record<string, unknown> = {
    autoSleepMinutes: 0, r2SensorId: nativeId, r2MeasureDelaySeconds: 1,
    presetSlots: [{ label: "Morning", profileId: "p1" }], shownProfileIds: ["p1"]
  };
  let savedAnnotations: Record<string, unknown> = {};
  let sendLifecycle: (state: string) => void = () => {};

  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (socket.url().endsWith("/machine/snapshot")) {
      const send = () => socket.send(JSON.stringify({ timestamp: shot.timestamp, state: { state: mode, substate: mode === "espresso" ? "pouring" : "idle" }, groupTemperature: 93 }));
      send();
      timer = setInterval(send, 100);
    } else if (socket.url().endsWith("/machine/shotState")) {
      sendLifecycle = (state) => socket.send(JSON.stringify({ state, shotId: shot.id, scaleConnected: false }));
    } else if (socket.url().endsWith("/scale/snapshot")) {
      socket.send(JSON.stringify({ status: "disconnected" }));
    }
    socket.onClose(() => { if (timer) clearInterval(timer); });
  });

  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let body: unknown = {};
    if (path.startsWith("/api/v1/sensors/") && path.endsWith("/execute")) {
      expect(decodeURIComponent(path.slice("/api/v1/sensors/".length, -"/execute".length))).toBe(sensorId);
      const command = req.postDataJSON();
      // The real driver rejects the native driver's timeout parameter.
      expect(command.params).toEqual({});
      if (command.commandId === "measure") {
        measureCount++;
        readyAt = Date.now() + 1200;
        body = { status: "ok", result: { started: true } };
      } else {
        expect(command.commandId).toBe("getReading");
        if (Date.now() < readyAt) {
          pendingCount++;
          await route.fulfill({ status: 500, json: { status: "error", message: "DiFluid R2 has no completed reading" } });
          return;
        }
        body = { status: "ok", result: { reading: { tds: measureCount === 1 ? 9.7 : 9.8, temperatureC: 26 } } };
      }
    } else if (path === "/api/v1/sensors") body = [{ id: sensorId, info: {
      name: "DiFluid R2", vendor: "DiFluid", data: [{ key: "reading", type: "object" }],
      commands: [{ id: "measure" }, { id: "getReading" }]
    } }];
    else if (path === "/api/v1/devices") body = [
      { id: "de1", type: "machine", state: "connected", available: true },
      { id: sensorId, name: "DiFluid R2", type: "sensor", state: "connected", available: true }
    ];
    else if (path === "/api/v1/machine/state") body = { connected: true, state: { state: mode, substate: "idle" } };
    else if (path === "/api/v1/profiles") body = [{ id: "p1", profile }];
    else if (path === "/api/v1/workflow") body = workflow;
    else if (path === "/api/v1/info") body = { version: "0.9.0" };
    else if (path === "/api/v1/settings") body = { gatewayMode: "tracking" };
    else if (path === "/api/v1/store/workflow-skin/settings") {
      if (req.method() !== "GET") settings = req.postDataJSON();
      body = settings;
    } else if (path.startsWith("/api/v1/store/")) body = null;
    else if (path === "/api/v1/shots") body = { items: saved ? [shot] : [], total: saved ? 1 : 0 };
    else if (path === "/api/v1/shots/latest") body = saved ? shot : null;
    else if (path === `/api/v1/shots/${shot.id}`) {
      if (req.method() === "PUT") savedAnnotations = req.postDataJSON().annotations;
      body = shot;
    } else if (["/api/v1/beans", "/api/v1/grinders", "/api/v1/steams", "/api/v1/plugins", "/api/v1/devices/scan"].includes(path)) body = [];
    await route.fulfill({ status: 200, json: body });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Live Brew" })).toBeVisible();
  saved = true;
  mode = "idle";
  sendLifecycle("stopping");
  await expect(page.getByRole("heading", { name: "Shot Review" })).toBeVisible();
  await expect(page.getByText("R2 TDS 9.7 imported.")).toBeVisible({ timeout: 10_000 });
  expect(measureCount).toBe(1);
  expect(pendingCount).toBeGreaterThan(0);
  expect(settings.r2SensorId).toBe(sensorId);

  await page.getByRole("button", { name: "Read from R2" }).click();
  await expect(page.getByRole("button", { name: "Reading R2" })).toBeDisabled();
  await expect(page.getByText("R2 TDS 9.8 imported.")).toBeVisible();
  expect(measureCount).toBe(2);
  await expect(page.getByLabel("TDS", { exact: true })).toHaveValue("9.8");
  await page.getByRole("button", { name: "Save Review" }).click();
  await expect.poll(() => savedAnnotations.drinkTds).toBe(9.8);
  expect(savedAnnotations.drinkEy).toBe(19.6);
  await page.screenshot({ path: testInfo.outputPath("r2-driver-review.png"), fullPage: true });
});
