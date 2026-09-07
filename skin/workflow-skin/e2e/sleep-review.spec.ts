import { expect, test } from "@playwright/test";

test("confirms physical sleep and immediately reviews a scale-free shot while persistence is delayed", async ({ page }, testInfo) => {
  let mode = "idle";
  let sleepRequests = 0;
  let saved = false;
  let holdHistory = false;
  let releaseHistory!: () => void;
  const historyGate = new Promise<void>((resolve) => { releaseHistory = resolve; });
  let sampleTime = "2026-09-07T10:00:00Z";
  const profile = { title: "Morning espresso" };
  const workflow = { profile, context: { targetDoseWeight: 18, targetYield: 36 } };
  const shot = {
    id: "scale-free-shot", timestamp: sampleTime, workflow,
    measurements: [
      { machine: { timestamp: sampleTime, state: { state: "espresso", substate: "pouring" }, pressure: 2, flow: 1 } },
      { machine: { timestamp: "2026-09-07T10:00:25Z", state: { state: "espresso", substate: "pouring" }, pressure: 8, flow: 2 } }
    ]
  };
  let sendLifecycle: (state: string) => void = () => {};
  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    let timer: ReturnType<typeof setInterval> | undefined;
    if (socket.url().endsWith("/machine/snapshot")) {
      const send = () => socket.send(JSON.stringify({ timestamp: sampleTime, state: { state: mode, substate: mode === "espresso" ? "pouring" : "idle" }, groupTemperature: 93, pressure: 8, flow: 2 }));
      send();
      timer = setInterval(send, 100);
    } else if (socket.url().endsWith("/machine/shotState")) {
      sendLifecycle = (state) => socket.send(JSON.stringify({ state, shotId: shot.id, scaleConnected: false }));
    } else if (socket.url().endsWith("/scale/snapshot")) socket.send(JSON.stringify({ status: "disconnected" }));
    socket.onClose(() => { if (timer) clearInterval(timer); });
  });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    let body: unknown = {};
    if (path === "/api/v1/machine/state/sleeping") { sleepRequests++; if (sleepRequests > 1) mode = "sleeping"; }
    else if (path === "/api/v1/machine/state/idle") mode = "idle";
    else if (path === "/api/v1/machine/state") body = { connected: true, state: { state: mode, substate: "idle" } };
    else if (path === "/api/v1/profiles") body = [{ id: "p1", profile }];
    else if (path === "/api/v1/workflow") body = workflow;
    else if (path === "/api/v1/info") body = { version: "0.8.5" };
    else if (path === "/api/v1/settings") body = { gatewayMode: "tracking" };
    else if (path === "/api/v1/display/brightness") body = { brightness: req.postDataJSON().brightness };
    else if (path.startsWith("/api/v1/display")) body = { brightness: 100 };
    else if (path === "/api/v1/store/workflow-skin/settings") body = { autoSleepMinutes: 0, presetSlots: [{ label: "Morning", profileId: "p1" }], shownProfileIds: ["p1"] };
    else if (path.startsWith("/api/v1/store/")) body = null;
    else if (path === "/api/v1/devices") body = [{ id: "de1", type: "machine", state: "connected", available: true }];
    else if (["/api/v1/beans", "/api/v1/grinders", "/api/v1/steams", "/api/v1/sensors", "/api/v1/plugins", "/api/v1/devices/scan"].includes(path)) body = [];
    else if (path === "/api/v1/shots") { if (holdHistory) await historyGate; body = { items: saved ? [shot] : [], total: saved ? 1 : 0 }; }
    else if (path === "/api/v1/shots/latest") body = saved ? shot : null;
    else if (path === `/api/v1/shots/${shot.id}`) {
      if (!saved) { await route.fulfill({ status: 404, json: { error: "Saving in progress" } }); return; }
      body = shot;
    }
    await route.fulfill({ status: 200, json: body });
  });
  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Sleep machine" })).toBeEnabled();
    await page.getByRole("button", { name: "Sleep machine" }).click();
    await expect(page.getByText("Requesting machine sleep…", { exact: true })).toBeVisible();
    await expect(page.getByText("Machine sleeping", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Sleep not confirmed", { exact: true })).toBeVisible({ timeout: 10000 });
    expect(mode).toBe("idle");
    await page.screenshot({ path: testInfo.outputPath("sleep-not-confirmed.png"), fullPage: true });
    await page.getByRole("button", { name: "Retry machine sleep" }).click();
    await expect(page.getByText("Machine sleeping", { exact: true })).toBeVisible();
    expect(mode).toBe("sleeping");
    await page.getByRole("button", { name: "Tap the screen to wake" }).click();
    await expect.poll(() => mode).toBe("idle");
    await expect(page.getByRole("heading", { name: "Brew", exact: true })).toBeVisible();

    // A native preheating event with an idle machine must not finish the shot.
    sendLifecycle("preheating");
    await expect(page.getByRole("heading", { name: "Live Brew" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shot Review" })).toHaveCount(0);
    mode = "espresso";
    sendLifecycle("pouring");
    await expect(page.getByRole("button", { name: "State", exact: true })).toHaveAttribute("title", /Pouring/);
    sampleTime = "2026-09-07T10:00:25Z";
    await expect(page.locator(".shot-graph")).toContainText("25");
    holdHistory = true;
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    mode = "idle";
    sendLifecycle("stopping");
    await expect(page.getByRole("heading", { name: "Shot Review" })).toBeVisible({ timeout: 2500 });
    await expect(page.getByText(/Waiting for the app to save this shot/)).toBeVisible();
    await expect(page.getByText("Duration: 25s", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Yield", { exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Save Review" })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("review-pending-without-scale.png"), fullPage: true });
    saved = true;
    await expect(page.getByRole("button", { name: "Save Review" })).toBeEnabled({ timeout: 6500 });
    await expect(page.getByText(/Waiting for the app to save this shot/)).toHaveCount(0);
    await expect(page.getByLabel("Yield", { exact: true })).toHaveValue("");
    await expect(page.getByText("Duration: 25s", { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("review-saved-without-scale.png"), fullPage: true });
  } finally {
    releaseHistory();
  }
});
