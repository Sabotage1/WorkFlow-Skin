import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { Profile, ProfileRecord } from "../src/api/types";

const profiles = Array.from({ length: 28 }, (_, index) => ({
  id: `profile-${index + 1}`,
  profile: { title: `Long Profile ${index + 1}` }
}));

async function routeProfileEditorApi(page: Page) {
  let library: ProfileRecord[] = [...profiles];
  const created: Profile[] = [];
  const copyParents: Array<string | undefined> = [];
  let rejectNextCreate = false;
  let settings = {
    menuCollapsed: false,
    presetSlots: [{ label: "Light" }, { label: "Sweet" }, { label: "Turbo" }, { label: "Classic" }],
    defaultReviewEnabled: true,
    reviewEnabledByProfile: {},
    profileWorkflows: {},
    shownProfileIds: profiles.map((profile) => profile.id),
    skinTitle: "WorkFlow",
    screensaverBrightness: 24
  };

  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    let snapshotInterval: ReturnType<typeof setInterval> | undefined;
    if (socket.url().endsWith("/ws/v1/machine/snapshot")) {
      const sendSnapshot = () => {
        socket.send(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            state: { state: "idle", substate: "idle" },
            groupTemperature: 65,
            targetGroupTemperature: 93
          })
        );
      };
      sendSnapshot();
      snapshotInterval = setInterval(sendSnapshot, 250);
    } else if (socket.url().endsWith("/ws/v1/scale/snapshot")) {
      socket.send(JSON.stringify({ status: "disconnected" }));
    } else if (socket.url().endsWith("/ws/v1/machine/waterLevels")) {
      socket.send(JSON.stringify({ currentLevel: 40, refillLevel: 15 }));
    }
    socket.onClose(() => {
      if (snapshotInterval) clearInterval(snapshotInterval);
    });
  });

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: unknown = null;

    if (method === "GET" && url.pathname === "/api/v1/profiles") body = library;
    else if (method === "POST" && url.pathname === "/api/v1/profiles") {
      const { profile, parentId } = request.postDataJSON() as { profile: Profile; parentId?: string };
      if (rejectNextCreate) {
        rejectNextCreate = false;
        await route.fulfill({ status: 503, json: { error: "Library unavailable" } });
        return;
      }
      created.push(profile);
      copyParents.push(parentId);
      body = { id: `new-${created.length}`, profile };
      library = [...library, body as ProfileRecord];
    } else if (method === "PUT" && url.pathname.startsWith("/api/v1/profiles/")) {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const { profile } = request.postDataJSON() as { profile: Profile };
      const saved = { id, profile };
      library = library.map((record) => record.id === id ? saved : record);
      body = saved;
    }
    else if (method === "GET" && url.pathname === "/api/v1/workflow") body = { context: { targetDoseWeight: 18, targetYield: 36 } };
    else if (method === "GET" && url.pathname === "/api/v1/beans") body = [];
    else if (method === "GET" && url.pathname === "/api/v1/grinders") body = [];
    else if (method === "GET" && url.pathname === "/api/v1/shots") body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (method === "GET" && url.pathname === "/api/v1/steams") body = [];
    else if (method === "GET" && url.pathname === "/api/v1/sensors") body = [];
    else if (method === "GET" && url.pathname === "/api/v1/devices") body = [];
    else if (method === "GET" && url.pathname === "/api/v1/info") body = { localIp: "192.168.1.20", version: "0.7.6" };
    else if (method === "GET" && url.pathname === "/api/v1/display") body = { brightness: 100, wakeLockOverride: true };
    else if (method === "PUT" && url.pathname === "/api/v1/display/brightness") {
      const brightness = JSON.parse(request.postData() ?? "{}").brightness;
      body = { brightness, requestedBrightness: brightness, wakeLockOverride: false };
    }
    else if (method === "GET" && url.pathname === "/api/v1/plugins") body = [];
    else if (method === "GET" && url.pathname === "/api/v1/webui/skins") body = [{ id: "workflow-skin", name: "WorkFlow", version: "0.1.24" }];
    else if (method === "GET" && url.pathname === "/api/v1/webui/skins/default") body = { id: "workflow-skin", name: "WorkFlow", version: "0.1.24" };
    else if (method === "GET" && url.pathname === "/api/v1/devices/scan") body = [];
    else if ((method === "POST" || method === "DELETE") && url.pathname === "/api/v1/display/wakelock") body = {};
    else if (method === "GET" && url.pathname === "/api/v1/machine/state") body = { connected: true, wifi: { connected: true, ipAddress: "192.168.1.20" } };
    else if (method === "GET" && (url.pathname === "/api/v1/store/workflow-skin/settings" || url.pathname === "/api/v1/kv/workflow-skin/settings")) body = settings;
    else if ((method === "POST" || method === "PUT") && (url.pathname === "/api/v1/store/workflow-skin/settings" || url.pathname === "/api/v1/kv/workflow-skin/settings")) {
      settings = JSON.parse(request.postData() ?? "{}");
      await route.fulfill({ status: 200, body: "" });
      return;
    } else {
      body = {};
    }

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  return {
    created,
    copyParents,
    rejectNextCreate: () => { rejectNextCreate = true; },
    get settings() {
      return settings;
    }
  };
}

test("creates and reopens a profile in the visual editor with the saved step order and targets", async ({ page }, testInfo) => {
  const api = await routeProfileEditorApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "New Profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New profile" });
  await expect(editor.getByRole("img", { name: /Profile preview/ })).toBeVisible();
  await expect(editor.getByLabel("Profile title")).toBeFocused();
  await editor.getByRole("button", { name: "Create profile" }).click();
  await expect(editor.getByRole("alert")).toHaveText("Enter a profile title.");
  expect(api.created).toHaveLength(0);
  await editor.getByLabel("Profile title").fill("Quiet morning");
  await editor.getByRole("tab", { name: "Steps" }).click();
  const chart = editor.getByRole("img", { name: /Profile preview/ });
  const bounds = await chart.boundingBox();
  expect(bounds).toBeTruthy();
  await chart.click({ position: { x: bounds!.width * 0.8, y: 55 } });
  await expect(editor.getByRole("button", { name: /Extraction.*8 bar/ })).toHaveAttribute("aria-pressed", "true");
  await editor.getByLabel("Step 2 pressure goal").fill("7.5");
  await editor.getByRole("button", { name: "Duplicate", exact: true }).click();
  await editor.getByLabel("Step 3 name", { exact: true }).fill("Finish");
  await editor.getByLabel("Step 3 seconds").fill("5");
  await editor.getByLabel("Step 3 pressure goal").fill("5.5");
  await editor.getByRole("button", { name: "Move earlier", exact: true }).click();
  await expect(editor.getByLabel("Step 2 name", { exact: true })).toHaveValue("Finish");
  await editor.getByRole("tab", { name: "Summary" }).click();
  await expect(editor.getByRole("heading", { name: "Recipe summary" })).toBeVisible();
  await expect(editor.getByText("3 steps · 40 s max")).toBeVisible();
  await editor.getByRole("tab", { name: "Details" }).click();
  await editor.getByLabel("Target weight", { exact: true }).fill("38");
  await editor.getByLabel("Count water volume from").selectOption("2");
  await editor.getByRole("tab", { name: "Steps" }).click();
  await editor.locator(".recipe-body").evaluate((element) => { element.scrollTop = 0; });
  await page.screenshot({ path: testInfo.outputPath("visual-profile-editor.png") });

  api.rejectNextCreate();
  await editor.getByRole("button", { name: "Create profile" }).click();
  await expect(editor.getByRole("alert")).toContainText("Library unavailable");
  await expect(editor.getByLabel("Profile title")).toHaveValue("Quiet morning");
  await editor.getByRole("button", { name: "Create profile" }).click();
  await expect(editor).toHaveCount(0);
  expect(api.created).toHaveLength(1);
  expect(api.created[0]).toMatchObject({ title: "Quiet morning", target_weight: 38, target_volume_count_start: 2, tank_temperature: 0 });
  expect(api.created[0].steps?.map(({ name, pressure }) => [name, pressure])).toEqual([
    ["Preinfusion", undefined], ["Finish", 5.5], ["Extraction", 7.5]
  ]);
  await expect(page.getByRole("button", { name: "Edit Quiet morning" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Quiet morning", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit profile" });
  await expect(edit.getByLabel("Profile title")).toHaveValue("Quiet morning");
  await edit.getByRole("button", { name: /Finish.*5.5 bar/ }).click();
  await edit.getByLabel("Step 2 pressure goal").fill("5");
  await edit.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await page.getByRole("button", { name: "Edit Quiet morning", exact: true }).click();
  await edit.getByRole("button", { name: /Finish.*5 bar/ }).click();
  await expect(edit.getByLabel("Step 2 pressure goal")).toHaveValue("5");
});

test("loads JSON into the editor and retains its extra fields until the user saves", async ({ page }) => {
  const api = await routeProfileEditorApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "New Profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New profile" });
  await editor.getByRole("tab", { name: "Details" }).click();
  const json = {
    title: "Imported flow",
    tank_temperature: 0,
    target_volume_count_start: 0,
    customProfileField: "keep",
    steps: [{ name: "Extract", pump: "flow", flow: 3, temperature: 92, sensor: "water", transition: "smooth",
      seconds: 26, weight: 35, volume: 70, customStepField: "keep" }]
  };
  await editor.getByLabel("Import profile JSON").setInputFiles({ name: "import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(json)) });
  await expect(editor.getByLabel("Profile title")).toHaveValue("Imported flow");
  await expect(editor.getByLabel("Step 1 flow goal")).toHaveValue("3");
  expect(api.created).toHaveLength(0);
  await editor.getByRole("button", { name: "Create profile" }).click();
  await expect(editor).toHaveCount(0);
  expect(api.created[0]).toMatchObject(json);
});

test("opens a historical version as a draft, exports it, and saves it as a linked copy", async ({ page }) => {
  const api = await routeProfileEditorApi(page);
  const older: ProfileRecord = {
    id: "previous-1",
    profile: {
      title: "Earlier recipe",
      steps: [{ name: "Extract", pump: "pressure", pressure: 6, temperature: 93, sensor: "coffee", seconds: 25, transition: "fast" }]
    }
  };
  await page.route("**/api/v1/profiles/profile-1/lineage", (route) => route.fulfill({
    json: [profiles[0], older]
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Edit Long Profile 1", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit profile" });
  await editor.getByRole("tab", { name: "Details" }).click();
  await editor.getByRole("button", { name: "Load version history" }).click();
  await editor.getByRole("button", { name: "Open in editor", exact: true }).click();
  await expect(editor.getByLabel("Profile title")).toHaveValue("Earlier recipe");
  await editor.getByLabel("Profile title").fill("Earlier recipe variation");
  await editor.getByLabel("Step 1 pressure goal").fill("6.5");
  await editor.getByRole("tab", { name: "Details" }).click();
  const pendingDownload = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Export JSON" }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("Earlier recipe variation.json");
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  expect(exported).toMatchObject({ title: "Earlier recipe variation", steps: [{ pressure: 6.5 }] });
  expect(api.created).toHaveLength(0);
  await editor.getByRole("button", { name: "Save as copy", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(api.created).toEqual([exported]);
  expect(api.copyParents).toEqual(["profile-1"]);
  await expect(page.getByRole("button", { name: "Edit Long Profile 1", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit Earlier recipe variation", exact: true })).toBeVisible();
});

test("keeps editing usable on a narrow touch layout and protects an unsaved draft", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  const api = await routeProfileEditorApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "New Profile", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "New profile" });
  await editor.getByLabel("Profile title").fill("Small screen");
  const body = editor.locator(".recipe-body");
  const metrics = await body.evaluate((element) => ({
    overflow: element.scrollWidth - element.clientWidth,
    canScroll: element.scrollHeight > element.clientHeight
  }));
  expect(metrics.overflow).toBeLessThanOrEqual(1);
  expect(metrics.canScroll).toBe(true);
  await editor.getByRole("button", { name: /Extraction.*8 bar/ }).click();
  await editor.getByLabel("Step 2 pressure goal").fill("17");
  await editor.getByRole("button", { name: "Create profile" }).click();
  await expect(editor.getByRole("alert")).toContainText("exceeds a machine limit");
  expect(api.created).toHaveLength(0);
  page.once("dialog", (prompt) => prompt.dismiss());
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor.getByLabel("Profile title")).toHaveValue("Small screen");
  page.once("dialog", (prompt) => prompt.accept());
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New Profile", exact: true })).toBeFocused();
});

test("preset editor keeps long profile lists scrollable inside the dialog", async ({ page }) => {
  await routeProfileEditorApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Edit Light" }).click();

  const panel = page.locator(".preset-editor-panel");
  const picker = page.locator(".profile-picker");
  await expect(panel).toBeVisible();

  const metrics = await page.evaluate(() => {
    const panelElement = document.querySelector(".preset-editor-panel");
    const pickerElement = document.querySelector(".profile-picker");
    return {
      panelHeight: panelElement?.getBoundingClientRect().height ?? 0,
      viewportHeight: window.innerHeight,
      pickerClientHeight: pickerElement?.clientHeight ?? 0,
      pickerScrollHeight: pickerElement?.scrollHeight ?? 0
    };
  });

  expect(metrics.panelHeight).toBeLessThan(metrics.viewportHeight - 24);
  expect(metrics.pickerScrollHeight).toBeGreaterThan(metrics.pickerClientHeight);

  await picker.evaluate((element) => {
    element.scrollTop = 180;
  });
  await expect.poll(() => picker.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
});

test("screensaver uses the saved brightness and fills the viewport", async ({ page }) => {
  await routeProfileEditorApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Sleep machine" }).click();

  const screensaver = page.getByLabel("Screensaver mode");
  await expect(screensaver).toHaveAttribute("data-brightness", "24");
  const metrics = await screensaver.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const panel = element.querySelector(".screensaver-panel");
    return {
      top: box.top,
      left: box.left,
      width: box.width,
      height: box.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      panelFilter: panel ? getComputedStyle(panel).filter : ""
    };
  });

  expect(metrics.top).toBe(0);
  expect(metrics.left).toBe(0);
  expect(metrics.width).toBe(metrics.viewportWidth);
  expect(metrics.height).toBe(metrics.viewportHeight);
  expect(metrics.panelFilter).toBe("brightness(0.658)");
});

test("preset editor assigns a profile when a visible profile row is clicked", async ({ page }) => {
  const api = await routeProfileEditorApi(page);

  await page.goto("/");
  await page.getByRole("button", { name: "Edit Light" }).click();
  await page.getByRole("button", { name: "Use Long Profile 2", exact: true }).click();

  await expect(page.getByRole("dialog", { name: "Edit Light preset" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Light Long Profile 2" })).toBeVisible();
  expect(api.settings.presetSlots[0]).toEqual({ label: "Light", profileId: "profile-2" });
});

test("the WorkFlow logo toggles the menu across reload and on a narrow screen", async ({ page }) => {
  const api = await routeProfileEditorApi(page);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Workflow navigation" });
  const logo = nav.getByRole("button", { name: "WorkFlow menu", exact: true });
  await expect(logo.getByText("WorkFlow", { exact: true })).toBeVisible();
  await logo.click();
  await expect(logo).toHaveAttribute("aria-expanded", "false");
  await expect(logo.getByText("WF", { exact: true })).toBeVisible();
  await expect.poll(() => api.settings.menuCollapsed).toBe(true);
  await page.reload();
  await expect(logo).toHaveAttribute("aria-expanded", "false");
  await logo.press("Enter");
  await expect(logo).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => api.settings.menuCollapsed).toBe(false);

  await page.setViewportSize({ width: 390, height: 640 });
  await expect(logo.getByText("WF", { exact: true })).toBeVisible();
  await logo.click();
  await expect(logo).toHaveAttribute("aria-expanded", "false");
  await nav.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Settings", exact: true, level: 1 })).toBeVisible();
  await logo.click();
  await expect(logo).toHaveAttribute("aria-expanded", "true");
});

test("top machine status stays compact beside action buttons", async ({ page }) => {
  await routeProfileEditorApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Brew" })).toBeVisible();
  await expect(page.getByRole("button", { name: "WorkFlow menu", exact: true })).toContainText("WorkFlow");

  const metrics = await page.evaluate(() => {
    const bar = document.querySelector(".top-status-bar")?.getBoundingClientRect();
    const indicators = document.querySelector(".top-status-indicators")?.getBoundingClientRect();
    const title = document.querySelector(".top-machine-status")?.getBoundingClientRect();
    const titleStyle = document.querySelector(".top-machine-status")
      ? getComputedStyle(document.querySelector(".top-machine-status") as Element)
      : null;
    const actions = document.querySelector(".top-status-actions")?.getBoundingClientRect();
    const buttons = Array.from(document.querySelectorAll(".top-status-actions .sleep-button")).map((button) => button.getBoundingClientRect());
    return {
      bar: bar ? { top: bar.top, bottom: bar.bottom } : null,
      indicators: indicators ? { left: indicators.left, right: indicators.right, top: indicators.top, bottom: indicators.bottom } : null,
      title: title ? { left: title.left, right: title.right, top: title.top, bottom: title.bottom } : null,
      titleStyle: titleStyle ? { borderTopWidth: titleStyle.borderTopWidth, backgroundColor: titleStyle.backgroundColor, textAlign: titleStyle.textAlign } : null,
      actions: actions ? { left: actions.left, right: actions.right, top: actions.top, bottom: actions.bottom } : null,
      buttons: buttons.map((button) => ({ left: button.left, right: button.right })),
      viewportCenter: window.innerWidth / 2
    };
  });

  expect(metrics.bar).not.toBeNull();
  expect(metrics.bar!.top).toBe(0);
  expect(metrics.indicators).not.toBeNull();
  expect(metrics.title).not.toBeNull();
  expect(metrics.titleStyle).not.toBeNull();
  expect(metrics.actions).not.toBeNull();
  expect(metrics.indicators!.right).toBeLessThanOrEqual(metrics.title!.left - 8);
  expect(metrics.title!.right).toBeLessThanOrEqual(metrics.actions!.left);
  expect(metrics.actions!.left - metrics.title!.right).toBeLessThanOrEqual(10);
  expect(metrics.title!.right).toBeGreaterThan(metrics.viewportCenter);
  expect(metrics.title!.right - metrics.title!.left).toBeLessThanOrEqual(170);
  expect(metrics.titleStyle!.borderTopWidth).toBe("0px");
  expect(metrics.titleStyle!.textAlign).toBe("center");
  expect(metrics.buttons).toHaveLength(2);
  expect(metrics.buttons[0].right).toBeLessThanOrEqual(metrics.buttons[1].left - 8);
});
