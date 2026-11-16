import { expect, test, type Page } from "@playwright/test";

async function updateApi(page: Page, options: { holdFirmware?: boolean; oldDecaid?: boolean } = {}) {
  const writes: Array<{ path: string; body: unknown }> = [];
  const commands: string[] = [];
  let cancelled = false;
  let finish: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { finish = resolve; });
  let app = { phase: "idle", currentVersion: "0.9.2", latestVersion: null as string | null, releaseUrl: "https://github.com/decentespresso/decaid/releases", installable: false };
  const catalog = {
    machine: { model: "DE1Pro", build: 1352 }, updateAvailable: true, recommendedArtifactId: "de1-1358", operation: { state: "idle" },
    artifacts: [{ id: "de1-1358", build: 1358, versionLabel: "1358", releaseNotes: "Machine firmware improvements.", eligibility: { status: "applicable", reasons: [] } }]
  };
  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    if (socket.url().endsWith("/machine/snapshot")) socket.send(JSON.stringify({ state: { state: "idle" }, groupTemperature: 93 }));
    if (socket.url().endsWith("/update")) {
      socket.send(JSON.stringify(app));
      socket.onMessage((message) => {
        const { command } = JSON.parse(String(message));
        commands.push(command);
        if (command === "check") {
          socket.send(JSON.stringify({ ...app, phase: "checking" }));
          app = { ...app, phase: "available", latestVersion: "0.9.3", installable: true };
          socket.send(JSON.stringify(app));
        } else if (command === "install") {
          socket.send(JSON.stringify({ ...app, phase: "downloading", progress: 0.4 }));
        }
      });
    }
  });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(), path = new URL(req.url()).pathname;
    let body: unknown = {};
    if (req.method() !== "GET") writes.push({ path, body: req.postData() });
    if (path === "/api/v1/machine/firmware" && req.method() === "DELETE") {
      cancelled = true; finish?.(); body = { operation: { state: "idle" } };
    } else if (path === "/api/v1/machine/firmware/apply") {
      expect(req.postDataJSON()).toEqual({ artifactId: "de1-1358", force: false });
      if (options.holdFirmware) await held;
      const events = cancelled ? [{ status: "error", progress: -1, error: "Firmware update cancelled" }] : [
        { status: "erasing", progress: 0 }, { status: "uploading", progress: 1 }, { status: "done", progress: 1 }
      ];
      await route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
      return;
    } else if (path === "/api/v1/machine/firmware") {
      if (options.oldDecaid) { await route.fulfill({ status: 404, json: { error: "Route not found" } }); return; }
      body = catalog;
    } else if (path === "/api/v1/machine/info") body = { model: "DE1Pro", version: "1352" };
    else if (path === "/api/v1/machine/state") body = { connected: true, state: { state: "idle" } };
    else if (path === "/api/v1/update") body = app;
    else if (path === "/api/v1/info") body = { version: "0.9.2", buildNumber: "92", appStore: false };
    else if (path === "/api/v1/devices") body = [{ id: "de1", name: "DE1Pro", type: "machine", state: "connected", available: true }];
    else if (path === "/api/v1/workflow") body = { context: { targetDoseWeight: 18, targetYield: 36 } };
    else if (path === "/api/v1/settings") body = { gatewayMode: "tracking" };
    else if (path === "/api/v1/shots") body = { items: [], total: 0 };
    else if (["/api/v1/profiles", "/api/v1/beans", "/api/v1/grinders", "/api/v1/steams", "/api/v1/plugins", "/api/v1/devices", "/api/v1/sensors"].includes(path)) body = [];
    else if (path.includes("/store/") || path.includes("/kv/")) body = null;
    await route.fulfill({ status: 200, json: body });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Updates", exact: true }).click();
  return { writes, commands };
}

test("updates show firmware and app versions, require confirmation, and report verified success", async ({ page }, testInfo) => {
  const api = await updateApi(page);
  await expect(page.getByText("Build 1352", { exact: true })).toBeVisible();
  await expect(page.getByText("Firmware update available", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check for Decaid updates" })).toBeEnabled();
  await page.getByRole("button", { name: "Check for Decaid updates" }).click();
  await expect(page.getByText("Decaid 0.9.3 is available")).toBeVisible();
  await expect(page.getByRole("button", { name: "Update Decaid", exact: true })).toBeEnabled();
  expect(api.commands).toEqual(["check"]);
  await page.locator(".page-surface").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("updates-available.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Install firmware 1358" }).click();
  await expect(page.getByRole("dialog")).toContainText("DE1Pro");
  expect(api.writes.some((write) => write.path.endsWith("/firmware/apply"))).toBe(false);
  await page.getByRole("button", { name: "Install update", exact: true }).click();
  await expect(page.getByText("Firmware update verified and complete.")).toBeVisible();
  expect(api.writes.filter((write) => write.path.endsWith("/firmware/apply"))).toHaveLength(1);
  await page.getByRole("button", { name: "Update Decaid", exact: true }).click();
  await page.getByRole("button", { name: "Install update", exact: true }).click();
  await expect(page.getByText("Downloading Decaid…", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Decaid download progress" })).toHaveAttribute("value", "0.4");
  await expect(page.getByRole("button", { name: "Install firmware 1358" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Refresh status" })).toBeEnabled();
  expect(api.commands).toEqual(["check", "install"]);
});

test("firmware progress survives navigation and prevents machine sleep until cancellation", async ({ page }) => {
  const api = await updateApi(page, { holdFirmware: true });
  await page.getByRole("button", { name: "Install firmware 1358" }).click();
  await page.getByRole("button", { name: "Install update", exact: true }).click();
  await expect.poll(() => api.writes.some((write) => write.path.endsWith("/firmware/apply"))).toBe(true);
  await expect(page.getByRole("button", { name: "Sleep machine" })).toBeDisabled();
  await page.getByRole("button", { name: "Brew", exact: true }).click();
  await expect(page.getByText("Machine firmware update in progress. Keep the machine and tablet powered on.")).toBeVisible();
  await page.getByRole("button", { name: "View update", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Updates", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Cancel firmware update" }).click();
  await expect(page.getByText("Firmware update cancelled.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sleep machine" })).toBeEnabled();
});

test("old Decaid shows unavailable firmware checks without claiming the machine is up to date", async ({ page }) => {
  await updateApi(page, { oldDecaid: true });
  await expect(page.getByText("This Decaid version does not support this update feature.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Install firmware 1358" })).toHaveCount(0);
  await page.getByText("Upload a firmware file", { exact: true }).click();
  await expect(page.getByLabel("Firmware file", { exact: true })).toBeVisible();
});
