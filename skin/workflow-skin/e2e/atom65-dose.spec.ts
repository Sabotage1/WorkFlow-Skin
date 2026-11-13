import { expect, test, type Page } from "@playwright/test";
import type { Workflow } from "../src/api/types";
import { createDefaultSkinSettings } from "../src/state/skinSettings";

const deviceId = "plugin:atom65.reaplugin:atom65:AA:BB:CC:DD:EE:FF";
const profiles = [
  { id: "espresso", profile: { title: "Morning espresso", steps: [{ pressure: 9 }] } },
  { id: "filter", profile: { title: "Filter coffee", steps: [{ flow: 4 }] } }
];

async function routeApi(page: Page) {
  const rules: Record<string, { mode: string; weight?: number }> = {};
  let workflow: Workflow = { profile: profiles[1].profile, context: { targetDoseWeight: 18.6, targetYield: 37.2, extras: { workflowSkin: { selectedProfileId: "filter" } } } };
  let settings = { ...createDefaultSkinSettings(), shownProfileIds: profiles.map((profile) => profile.id), presetSlots: [{ label: "Espresso", profileId: "espresso" }, { label: "Filter", profileId: "filter" }] };
  let refreshGate: Promise<void> | undefined;
  let refreshBlocked = false;
  const writes: string[] = [];
  let failSave = false;
  await page.routeWebSocket("**/ws/v1/**", (socket) => {
    if (socket.url().endsWith("/machine/snapshot")) socket.send(JSON.stringify({ state: { state: "idle" }, groupTemperature: 93, targetGroupTemperature: 93 }));
  });
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    let body: unknown = {};
    if (req.method() !== "GET") writes.push(path);
    if (path === "/api/v1/profiles") {
      if (refreshGate) { const gate = refreshGate; refreshGate = undefined; refreshBlocked = true; await gate; }
      body = profiles;
    }
    else if (path === "/api/v1/workflow") {
      if (req.method() === "PUT") { const patch = req.postDataJSON(); workflow = { ...workflow, ...patch }; }
      body = workflow;
    }
    else if (path === "/api/v1/plugins") body = [{ id: "atom65.reaplugin", version: "0.1.1", loaded: true, api: [{ id: "profile-settings", type: "http" }] }];
    else if (path === "/api/v1/devices") body = [{ id: deviceId, name: "Atom65", type: "grinder", state: "connected", available: true }];
    else if (path === "/api/v1/plugins/atom65.reaplugin/profile-settings") {
      expect(url.searchParams.get("deviceId")).toBe(deviceId);
      const data = req.postDataJSON();
      const key = data.profile.title;
      if (data.choice) {
        if (failSave) { await route.fulfill({ status: 502, body: '{"error":"storage_timeout"}' }); return; }
        expect(data.choice.profileKey).toBe(key);
        if (data.choice.mode === "leave") delete rules[key];
        else rules[key] = data.choice;
      }
      body = { deviceId, loaded: true, storageError: null, syncEnabled: true, maximumDose: 40, grinder: { minimum: 5, maximum: 1000 }, profile: { key, title: key }, rule: rules[key] ?? { mode: "leave" } };
    }
    else if (["/api/v1/beans", "/api/v1/grinders", "/api/v1/steams", "/api/v1/sensors", "/api/v1/devices/scan"].includes(path)) body = [];
    else if (path === "/api/v1/shots") body = { items: [], total: 0, limit: 100, offset: 0 };
    else if (path === "/api/v1/info") body = { version: "0.9.0", localIp: "127.0.0.1" };
    else if (path === "/api/v1/display") body = { brightness: 100, wakeLockOverride: true };
    else if (path === "/api/v1/settings") body = { gatewayMode: "tracking" };
    else if (path === "/api/v1/machine/state") body = { connected: true, state: { state: "idle" } };
    else if (/\/(store|kv)\/workflow-skin\/settings$/.test(path)) {
      if (req.method() !== "GET") settings = req.postDataJSON();
      body = settings;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return {
    rules, writes,
    get settings() { return settings; },
    get refreshBlocked() { return refreshBlocked; },
    holdRefresh() { let release!: () => void; refreshGate = new Promise<void>((resolve) => { release = resolve; }); return release; },
    failNextSave() { failSave = true; }
  };
}

test("profile grinder choices persist independently without selecting the recipe", async ({ page }, testInfo) => {
  const api = await routeApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Morning espresso grinder dose", exact: true }).click();
  const editor = page.getByRole("form", { name: "Morning espresso grinder dose" });
  const mode = editor.getByRole("combobox", { name: "When I choose this profile" });
  await expect(mode).toHaveValue("leave");
  await expect(mode).toBeEnabled();
  await mode.selectOption("fixed");
  const weight = editor.getByRole("spinbutton", { name: "Grind weight (g)" });
  await weight.fill("18.05");
  await expect(editor.getByRole("button", { name: "Save grinder choice" })).toBeDisabled();
  await weight.fill("20.5");
  await editor.getByRole("button", { name: "Save grinder choice" }).click();
  await expect(editor.getByRole("status")).toHaveText("Grinder choice saved.");
  expect(api.rules["Morning espresso"]).toMatchObject({ mode: "fixed", weight: 20.5 });
  expect(api.writes).not.toContain("/api/v1/workflow");
  const bounds = await editor.evaluate((element) => ({ right: element.getBoundingClientRect().right, viewport: innerWidth }));
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
  await page.screenshot({ path: testInfo.outputPath("atom65-fixed-dose.png"), fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Morning espresso grinder dose", exact: true }).click();
  await expect(page.getByRole("spinbutton", { name: "Grind weight (g)" })).toHaveValue("20.5");
  await page.getByRole("button", { name: "Filter coffee grinder dose", exact: true }).click();
  const filterMode = page.getByRole("combobox", { name: "When I choose this profile" });
  await expect(filterMode).toHaveValue("leave");
  await expect(filterMode).toBeEnabled();
  await filterMode.selectOption("workflow");
  await page.getByRole("button", { name: "Save grinder choice" }).click();
  await expect(page.getByText("Grinder choice saved.")).toBeVisible();
  await filterMode.selectOption("leave");
  await page.getByRole("button", { name: "Save grinder choice" }).click();
  await expect(page.getByText("Grinder choice saved.")).toBeVisible();
  expect(api.rules["Filter coffee"]).toBeUndefined();
  expect(api.rules["Morning espresso"].weight).toBe(20.5);
});

test("an unconfirmed driver save stays visibly unsaved", async ({ page }) => {
  const api = await routeApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "Morning espresso grinder dose", exact: true }).click();
  const mode = page.getByRole("combobox", { name: "When I choose this profile" });
  await expect(mode).toBeEnabled();
  await mode.selectOption("workflow");
  api.failNextSave();
  await page.getByRole("button", { name: "Save grinder choice" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not confirm");
  await expect(page.getByRole("button", { name: "Save grinder choice" })).toBeDisabled();
  await expect(page.getByText("Grinder choice saved.")).toBeHidden();
  expect(api.rules["Morning espresso"]).toBeUndefined();
});

test("saved Brew recipes survive profile switches, reloads, and an older refresh", async ({ page }, testInfo) => {
  const api = await routeApi(page);
  await page.goto("/");
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("18.6");
  await page.getByRole("button", { name: "Espresso Morning espresso", exact: true }).click();
  const releaseRefresh = api.holdRefresh();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => api.refreshBlocked).toBe(true);
  await page.getByLabel("Dose", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect(page.getByText("Recipe saved for this profile.", { exact: true })).toBeVisible();
  releaseRefresh();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("20");
  await page.getByRole("button", { name: "Filter Filter coffee", exact: true }).click();
  await page.getByLabel("Dose", { exact: true }).fill("18.6");
  await page.getByRole("button", { name: "Save recipe", exact: true }).click();
  await expect.poll(() => api.settings.profileWorkflows.filter?.brewRecipe?.dose).toBe(18.6);
  await page.getByRole("button", { name: "Espresso Morning espresso", exact: true }).click();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Yield", { exact: true })).toHaveValue("40");
  await page.reload();
  await page.getByRole("button", { name: "Filter Filter coffee", exact: true }).click();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("18.6");
  await page.getByRole("button", { name: "Espresso Morning espresso", exact: true }).click();
  await expect(page.getByLabel("Dose", { exact: true })).toHaveValue("20");
  await expect(page.getByLabel("Yield", { exact: true })).toHaveValue("40");
  expect(api.rules).toEqual({});
  expect(api.writes).not.toContain("/api/v1/plugins/atom65.reaplugin/profile-settings");
  await page.screenshot({ path: testInfo.outputPath("saved-brew-recipe.png"), fullPage: true });
});
