import { expect, test } from "@playwright/test";

test("restores the startup profile after a sleeping Decaid 0.8.5 gateway reconnects", async ({ page }, testInfo) => {
  const profiles = ["Light", "Sweet"].map((title, index) => ({
    id: `p${index + 1}`,
    profile: { version: "2", title, notes: "", author: "", beverage_type: "espresso", tank_temperature: 0,
      target_volume_count_start: 0, steps: [{ name: "Pour", temperature: 93, sensor: "coffee", pump: "pressure", pressure: 6, transition: "fast", seconds: 25 }] }
  }));
  const contextFor = (id: string) => ({ targetDoseWeight: 18, targetYield: 36, extras: { workflowSkin: { selectedProfileId: id } } });
  let workflow = { id: "workflow", name: "Morning", profile: profiles[1].profile, context: contextFor("p2"),
    steamSettings: { targetTemperature: 150, duration: 60, flow: 1, stopAtTemperature: 0 } };
  let mode = "idle";
  let waking = false;
  let attempts = 0;
  const settings = { startupProfileId: "p2", presetSlots: [{ label: "Light", profileId: "p1" }, { label: "Sweet", profileId: "p2" }],
    shownProfileIds: ["p1", "p2"], defaultReviewEnabled: true, autoSleepMinutes: 0 };

  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (socket.url().endsWith("/machine/snapshot")) {
      const send = () => socket.send(JSON.stringify({ timestamp: new Date().toISOString(), state: { state: mode, substate: "idle" }, groupTemperature: 93 }));
      send();
      timer = setInterval(send, 250);
    } else if (socket.url().endsWith("/scale/snapshot")) socket.send(JSON.stringify({ status: "disconnected" }));
    socket.onClose(() => { if (timer) clearInterval(timer); });
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    let body: unknown = {};
    if (path === "/api/v1/profiles") body = profiles;
    else if (path === "/api/v1/workflow") {
      if (method === "PUT") {
        if (waking) {
          attempts++;
          if (attempts === 1) { await route.abort("failed"); return; }
          if (attempts === 2) { await route.fulfill({ status: 503, json: { error: "Machine unavailable" } }); return; }
        }
        const patch = request.postDataJSON();
        workflow = { ...workflow, ...patch, context: { ...workflow.context, ...patch.context } };
      }
      body = workflow;
    } else if (path === "/api/v1/machine/state/sleeping") mode = "sleeping";
    else if (path === "/api/v1/machine/state/idle") {
      mode = "idle";
      waking = true;
      workflow = { ...workflow, profile: profiles[0].profile, context: contextFor("p1") };
    } else if (path === "/api/v1/machine/state") body = { state: { state: mode, substate: "idle" }, groupTemperature: 93 };
    else if (path === "/api/v1/info") body = { version: "0.8.5", fullVersion: "0.8.5" };
    else if (path === "/api/v1/settings") body = { gatewayMode: "tracking" };
    else if (path === "/api/v1/display/brightness") body = { brightness: request.postDataJSON().brightness };
    else if (path.startsWith("/api/v1/display")) body = { brightness: 100, wakeLockOverride: false };
    else if (path === "/api/v1/store/workflow-skin/settings") body = settings;
    else if (path.startsWith("/api/v1/store/")) body = null;
    else if (path === "/api/v1/devices") body = [{ id: "de1", type: "machine", state: "connected", available: true }];
    else if (["/api/v1/beans", "/api/v1/grinders", "/api/v1/steams", "/api/v1/sensors", "/api/v1/plugins", "/api/v1/devices/scan"].includes(path)) body = [];
    else if (path === "/api/v1/shots") body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === "/api/v1/shots/latest") body = null;
    await route.fulfill({ status: 200, json: body });
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sweet Sweet", exact: true })).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Sleep machine" }).click();
  await expect(page.getByRole("button", { name: "Tap the screen to wake" })).toBeVisible();
  await expect.poll(() => mode).toBe("sleeping");
  await page.getByRole("button", { name: "Tap the screen to wake" }).click();
  await expect(page.getByRole("heading", { name: "Brew", exact: true })).toBeVisible();
  await expect.poll(() => attempts, { timeout: 15000 }).toBe(3);
  await expect.poll(() => workflow.context.extras.workflowSkin.selectedProfileId).toBe("p2");
  await expect(page.getByText(/Could not apply startup profile/)).toHaveCount(0);
  await expect(page.getByText("Machine sleep requested.", { exact: true })).toHaveCount(0);
  expect(workflow.context.targetYield).toBe(36);
  expect(workflow.steamSettings.targetTemperature).toBe(150);
  await page.screenshot({ path: testInfo.outputPath("wake-recovered.png"), fullPage: true });
});
