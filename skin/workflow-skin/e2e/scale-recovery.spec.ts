import { expect, test, type Page } from "@playwright/test";

async function nativeGateway(page: Page, version: string, preferred = true) {
  const state = { awake: false, connected: false, scanning: false, scans: [] as URLSearchParams[], explicitConnects: 0, tares: 0, wakeRequests: 0, mode: "idle", staleInventory: false, blockTare: false };
  const profile = { title: "Classic", steps: [{ name: "Pour", seconds: 25, pressure: 6, temperature: 93 }] };
  const workflow = { id: "morning", profile, context: { targetDoseWeight: 18, targetYield: 36 } };
  const devices = () => [
    { id: "de1", type: "machine", state: "connected", available: true },
    { id: "aux", type: "scale", name: "Plugin auxiliary", state: "connected", connectionRole: "auxiliary", available: true },
    ...(state.connected && !state.staleInventory ? [{ id: "primary", type: "scale", name: "Acaia Lunar", state: "connected", connectionRole: "primary", available: true }] : [])
  ];
  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    const send = () => {
      const path = new URL(socket.url()).pathname;
      if (path.endsWith("/machine/snapshot")) socket.send(JSON.stringify({ timestamp: new Date().toISOString(), state: { state: state.mode, substate: "idle" }, groupTemperature: 93 }));
      if (path.endsWith("/scale/snapshot")) socket.send(JSON.stringify(state.connected ? { weight: 12.3, battery: 75 } : { status: "disconnected" }));
      if (path.endsWith("/devices")) socket.send(JSON.stringify({ devices: devices(), scanning: state.scanning, connectionStatus: { phase: state.scanning ? "scanning" : "ready" } }));
    };
    send();
    const timer = setInterval(send, 100);
    socket.onClose(() => clearInterval(timer));
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    let body: unknown = {};
    if (path === "/api/v1/info") body = { version };
    else if (path === "/api/v1/settings") body = { gatewayMode: "tracking", ...(preferred ? { preferredScaleId: "primary" } : {}) };
    else if (path === "/api/v1/profiles") body = [{ id: "p1", profile }];
    else if (path === "/api/v1/workflow") body = workflow;
    else if (path === "/api/v1/machine/state") body = { connected: true, state: { state: state.mode, substate: "idle" } };
    else if (path === "/api/v1/machine/state/sleeping") { state.mode = "sleeping"; state.connected = false; }
    else if (path === "/api/v1/machine/state/idle") { state.wakeRequests++; state.mode = "idle"; }
    else if (path === "/api/v1/devices") body = devices();
    else if (path === "/api/v1/devices/scan") {
      state.scans.push(url.searchParams);
      state.scanning = true;
      // Emulate host-owned discovery/teardown/connection after the quick HTTP
      // acknowledgment. A discovery-only scan never adopts the scale.
      setTimeout(() => {
        state.scanning = false;
        if (state.awake && state.mode === "idle" && url.searchParams.get("connect") === "true") state.connected = true;
      }, 300);
      body = [];
    } else if (path === "/api/v1/devices/connect") {
      state.explicitConnects++;
      await route.fulfill({ status: 409, json: { error: "Host owns the primary scale slot" } });
      return;
    } else if (path === "/api/v1/scale/tare") {
      state.tares++;
      if (state.blockTare) {
        await route.fulfill({ status: 400, json: { type: "block_tare_during_shot", error: "Tare blocked during shot" } });
        return;
      }
    }
    else if (path === "/api/v1/store/workflow-skin/settings") body = { autoSleepMinutes: 0, presetSlots: [{ label: "Classic", profileId: "p1" }], shownProfileIds: ["p1"] };
    else if (path.startsWith("/api/v1/store/")) body = null;
    else if (path.startsWith("/api/v1/display")) body = { brightness: 100, wakeLockOverride: false };
    else if (path === "/api/v1/shots") body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === "/api/v1/shots/latest") body = null;
    else if (["/api/v1/beans", "/api/v1/grinders", "/api/v1/steams", "/api/v1/sensors", "/api/v1/plugins"].includes(path)) body = [];
    await route.fulfill({ json: body });
  });
  return state;
}

for (const version of ["0.8.8", "0.9.0-beta.2"]) {
  test(`Scale button connects through the host on ${version} and fresh primary telemetry wins over stale inventory`, async ({ page }, testInfo) => {
    const gateway = await nativeGateway(page, version, false);
    await page.goto("/");
    await expect.poll(() => gateway.scans.length).toBe(1);
    await expect.poll(() => gateway.scanning).toBe(false);
    await expect(page.getByRole("button", { name: "Scale", exact: true })).toHaveAttribute("title", "Scale: Not connected");
    // Let the host report that its first scan is finished before requesting a
    // new scan for a scale switched on later.
    await page.waitForTimeout(2100);
    gateway.awake = true;
    gateway.staleInventory = true;
    await page.getByRole("button", { name: "Scale", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Scale connected.");
    await expect(page.getByRole("button", { name: "Scale", exact: true })).toHaveAttribute("title", "Scale: Connected");
    await page.getByRole("button", { name: "Scale", exact: true }).click();
    await expect.poll(() => gateway.tares).toBe(1);
    expect(gateway.scans).toHaveLength(2);
    expect(gateway.explicitConnects).toBe(0);
    for (const scan of gateway.scans) {
      expect(scan.get("connect")).toBe("true");
      expect(scan.get("quick")).toBe("true");
      expect(scan.get("connectPreferredScaleEarly")).toBe(version === "0.9.0-beta.2" ? "true" : null);
    }
    await page.screenshot({ path: testInfo.outputPath("scale-connected.png"), fullPage: true });
  });
}

test("automatically retries a preferred scale absent from inventory while the skin stays open", async ({ page }) => {
  test.setTimeout(60_000);
  const gateway = await nativeGateway(page, "0.8.8");
  await page.goto("/");
  await expect.poll(() => gateway.scans.length).toBe(1);
  await expect.poll(() => gateway.scanning).toBe(false);
  expect(gateway.explicitConnects).toBe(0);
  gateway.awake = true;
  // Real browser time: no focus, click, navigation or simulated foreground
  // event is allowed to trigger the recovery being tested.
  await expect.poll(() => gateway.scans.length, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => gateway.connected).toBe(true);
  await expect(page.getByRole("button", { name: "Scale", exact: true })).toHaveAttribute("title", "Scale: Connected");
  expect(gateway.explicitConnects).toBe(0);
});

test("joins the native app's running scale recovery without restarting its scan", async ({ page }) => {
  const gateway = await nativeGateway(page, "0.8.8");
  gateway.scanning = true;
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Brew", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  // Only the host finishes its already-running connection work.
  gateway.scanning = false;
  gateway.connected = true;
  await expect(page.getByRole("status")).toHaveText("Scale connected.");
  expect(gateway.scans).toHaveLength(0);
  expect(gateway.explicitConnects).toBe(0);
  gateway.blockTare = true;
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Tare is disabled during the shot to preserve weight stop.");
  expect(gateway.tares).toBe(1);
  expect(gateway.scans).toHaveLength(0);
});

test("pending Scale recovery respects external sleep without waking the machine", async ({ page }) => {
  await page.clock.install();
  const gateway = await nativeGateway(page, "0.8.8");
  await page.goto("/");
  await expect.poll(() => gateway.scans.length).toBe(1);
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  gateway.mode = "sleeping";
  await page.clock.runFor(5500);
  await expect(page.getByRole("button", { name: "Tap the screen to wake" })).toBeVisible();
  const scansBefore = gateway.scans.length;
  await page.clock.fastForward(65_000);
  expect(gateway.mode).toBe("sleeping");
  expect(gateway.wakeRequests).toBe(0);
  expect(gateway.scans).toHaveLength(scansBefore);
  await expect(page.getByText(/Could not connect scale|No scale found/)).toHaveCount(0);
});

test("recovery stops scanning while sleeping or brewing and resumes after wake", async ({ page }) => {
  await page.clock.install();
  const gateway = await nativeGateway(page, "0.9.0-beta.2");
  await page.goto("/");
  await expect.poll(() => gateway.scans.length).toBe(1);
  await expect.poll(() => gateway.scanning).toBe(false);
  gateway.mode = "espresso";
  await expect(page.getByRole("heading", { name: "Live", exact: true })).toBeVisible();
  const before = gateway.scans.length;
  await page.clock.fastForward(65_000);
  expect(gateway.scans).toHaveLength(before);
  gateway.mode = "idle";
  await page.waitForTimeout(250);
  await page.clock.runFor(1500);
  await page.getByRole("button", { name: "Brew", exact: true }).click();
  await page.getByRole("button", { name: "Sleep machine" }).click();
  await expect(page.getByRole("button", { name: "Tap the screen to wake" })).toBeVisible();
  const beforeSleep = gateway.scans.length;
  await page.clock.fastForward(65_000);
  expect(gateway.scans).toHaveLength(beforeSleep);
  gateway.awake = true;
  await page.getByRole("button", { name: "Tap the screen to wake" }).click();
  await expect.poll(() => gateway.connected).toBe(true);
  await expect(page.getByRole("button", { name: "Scale", exact: true })).toHaveAttribute("title", "Scale: Connected");
  expect(gateway.explicitConnects).toBe(0);
});
