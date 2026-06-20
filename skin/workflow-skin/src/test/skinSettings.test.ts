import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COMMUNITY_API_BASE_URL,
  DEFAULT_MAIN_MENU_ITEMS,
  DEFAULT_STEAM_TIMERS,
  MAX_STEAM_TIMERS,
  defaultSkinSettings,
  isMilkProfile,
  isProfileShown,
  isReviewEnabled,
  loadSkinSettings,
  mainMenuItemsForSettings,
  profileWorkflowFor,
  saveSkinSettings,
  visibleMainMenuItems
} from "../state/skinSettings";

describe("skin settings", () => {
  it("has post-shot review enabled by default", () => {
    expect(defaultSkinSettings.reviewEnabledByProfile).toEqual({});
    expect(defaultSkinSettings.defaultReviewEnabled).toBe(true);
    expect(defaultSkinSettings.profileWorkflows).toEqual({});
    expect(defaultSkinSettings.skinTitle).toBe("WorkFlow");
    expect(defaultSkinSettings.startupProfileId).toBeUndefined();
    expect(defaultSkinSettings.r2SensorId).toBeUndefined();
    expect(defaultSkinSettings.shownProfileIds).toEqual([]);
    expect((defaultSkinSettings as { communityApiBaseUrl?: string }).communityApiBaseUrl).toBe("https://workflow-skin-community.sabotage1.workers.dev");
    expect(defaultSkinSettings.autoSleepMinutes).toBe(30);
    expect(defaultSkinSettings.r2MeasureDelaySeconds).toBe(20);
    expect(defaultSkinSettings.presetSlotCount).toBe(4);
    expect(defaultSkinSettings.menuCollapsed).toBe(false);
    expect(defaultSkinSettings.mainMenuItems).toEqual(DEFAULT_MAIN_MENU_ITEMS);
    expect(defaultSkinSettings.mainMenuItems).toContain("community");
    expect(defaultSkinSettings.mainMenuItems[defaultSkinSettings.mainMenuItems.length - 2]).toBe("community");
    expect(defaultSkinSettings.mainMenuItems[defaultSkinSettings.mainMenuItems.length - 1]).toBe("settings");
    expect(defaultSkinSettings.hiddenMainMenuItemIds).toEqual([]);
    expect(defaultSkinSettings.topStatusIndicatorIds).toEqual(["machine", "wifi", "scale", "water", "r2", "state", "temperature"]);
    expect(mainMenuItemsForSettings(defaultSkinSettings).indexOf("profiles")).toBeLessThan(mainMenuItemsForSettings(defaultSkinSettings).indexOf("grinders"));
  });

  it("loads default settings when KV is missing", async () => {
    const api = { getKv: vi.fn().mockResolvedValue(null), putKv: vi.fn() };
    const settings = await loadSkinSettings(api);
    expect(settings).toEqual(defaultSkinSettings);
    expect(settings.presetSlots).not.toBe(defaultSkinSettings.presetSlots);
    expect(settings.presetSlots[0]).not.toBe(defaultSkinSettings.presetSlots[0]);
    expect(settings.reviewEnabledByProfile).not.toBe(defaultSkinSettings.reviewEnabledByProfile);
  });

  it("normalizes stale KV settings", async () => {
    const api = {
      getKv: vi.fn().mockResolvedValue({
        presetSlots: [{ label: "Valid" }, { label: 7 }],
        defaultReviewEnabled: "yes",
        reviewEnabledByProfile: { p1: false, p2: true, stale: "no" },
        skinTitle: "Roy's Decent",
        startupProfileId: "p2",
        r2SensorId: "sensor-r2",
        communityApiBaseUrl: " https://example.com/community ",
        autoSleepMinutes: 999,
        r2MeasureDelaySeconds: 44.7,
        presetSlotCount: 12,
        menuCollapsed: true,
        mainMenuItems: ["settings", "profiles", "missing", "brew", "profiles"],
        hiddenMainMenuItemIds: ["history", "settings", "bad"],
        topStatusIndicatorIds: ["wifi", "pressure", "bad", "wifi"],
        shownProfileIds: ["p1", 42, "p2"],
        profileWorkflows: {
          p2: { milkBased: true, steamTimers: { small: 18, medium: 28, large: 42, cortado: 24, overflow: 99 } },
          bad: { milkBased: "yes", steamTimers: { small: "soon" } }
        },
        lastBeanBatchId: 12,
        lastGrinderId: "g1",
        defaultGrinderId: "g2",
        preferredEyMin: 18.5,
        preferredEyMax: Number.POSITIVE_INFINITY
      }),
      putKv: vi.fn()
    };

    const settings = await loadSkinSettings(api);

    expect(settings.presetSlots).toEqual(defaultSkinSettings.presetSlots);
    expect(settings.presetSlots).not.toBe(defaultSkinSettings.presetSlots);
    expect(settings.defaultReviewEnabled).toBe(true);
    expect(settings.reviewEnabledByProfile).toEqual({ p1: false, p2: true });
    expect(settings.skinTitle).toBe("Roy's Decent");
    expect(settings.startupProfileId).toBe("p2");
    expect(settings.r2SensorId).toBe("sensor-r2");
    expect((settings as { communityApiBaseUrl?: string }).communityApiBaseUrl).toBe("https://example.com/community");
    expect(settings.autoSleepMinutes).toBe(240);
    expect(settings.r2MeasureDelaySeconds).toBe(45);
    expect(settings.presetSlotCount).toBe(8);
    expect(settings.menuCollapsed).toBe(true);
    expect(settings.mainMenuItems.slice(0, 2)).toEqual(["profiles", "brew"]);
    expect(settings.mainMenuItems[settings.mainMenuItems.length - 2]).toBe("community");
    expect(settings.mainMenuItems[settings.mainMenuItems.length - 1]).toBe("settings");
    expect(settings.mainMenuItems).toEqual(expect.arrayContaining([...DEFAULT_MAIN_MENU_ITEMS]));
    expect(settings.hiddenMainMenuItemIds).toEqual(["history"]);
    expect(settings.topStatusIndicatorIds).toEqual(["wifi", "pressure"]);
    expect(visibleMainMenuItems(settings)).not.toContain("history");
    expect(visibleMainMenuItems(settings)).toContain("settings");
    expect(settings.shownProfileIds).toEqual(["p1", "p2"]);
    expect(settings.profileWorkflows).toEqual({
      p2: { milkBased: true, steamTimers: { small: 18, medium: 28, large: 42, cortado: 24 } }
    });
    expect(Object.keys(settings.profileWorkflows.p2.steamTimers)).toHaveLength(MAX_STEAM_TIMERS);
    expect(settings.lastBeanBatchId).toBeUndefined();
    expect(settings.lastGrinderId).toBe("g1");
    expect(settings.defaultGrinderId).toBe("g2");
    expect(settings.preferredEyMin).toBe(18.5);
    expect(settings.preferredEyMax).toBeUndefined();
  });

  it("normalizes a blank community API URL to the default Worker", async () => {
    const api = {
      getKv: vi.fn().mockResolvedValue({ communityApiBaseUrl: "   " }),
      putKv: vi.fn()
    };

    const settings = await loadSkinSettings(api);

    expect(settings.communityApiBaseUrl).toBe(DEFAULT_COMMUNITY_API_BASE_URL);
  });

  it("loads corrupt review overrides as an empty record", async () => {
    const api = {
      getKv: vi.fn().mockResolvedValue({ defaultReviewEnabled: false, reviewEnabledByProfile: null }),
      putKv: vi.fn()
    };

    const settings = await loadSkinSettings(api);

    expect(settings.reviewEnabledByProfile).toEqual({});
    expect(isReviewEnabled(settings, "p1")).toBe(false);
  });

  it("saves settings to workflow-skin namespace", async () => {
    const api = { getKv: vi.fn(), putKv: vi.fn().mockResolvedValue(undefined) };
    await saveSkinSettings(api, { ...defaultSkinSettings, presetSlots: [{ label: "Light", profileId: "p1" }], shownProfileIds: ["p1"] });
    expect(api.putKv).toHaveBeenCalledWith(
      "workflow-skin",
      "settings",
      expect.objectContaining({ presetSlots: [{ label: "Light", profileId: "p1" }], shownProfileIds: ["p1"] })
    );
  });

  it("hides all profiles from the skin by default", () => {
    expect(isProfileShown(defaultSkinSettings, "p1")).toBe(false);
    expect(isProfileShown({ ...defaultSkinSettings, shownProfileIds: ["p1"] }, "p1")).toBe(true);
  });

  it("uses the default review setting for unknown profiles", () => {
    expect(isReviewEnabled({ ...defaultSkinSettings, defaultReviewEnabled: true }, "missing")).toBe(true);
    expect(isReviewEnabled({ ...defaultSkinSettings, defaultReviewEnabled: false }, "missing")).toBe(false);
  });

  it("uses false review overrides", () => {
    expect(isReviewEnabled({ ...defaultSkinSettings, reviewEnabledByProfile: { p1: false } }, "p1")).toBe(false);
  });

  it("uses true review overrides", () => {
    expect(isReviewEnabled({ ...defaultSkinSettings, defaultReviewEnabled: false, reviewEnabledByProfile: { p1: true } }, "p1")).toBe(true);
  });

  it("uses the default review setting when profileId is missing", () => {
    expect(isReviewEnabled({ ...defaultSkinSettings, defaultReviewEnabled: false })).toBe(false);
    expect(isReviewEnabled({ ...defaultSkinSettings, defaultReviewEnabled: true })).toBe(true);
  });

  it("returns default steam workflow for profiles without milk settings", () => {
    expect(profileWorkflowFor(defaultSkinSettings, "p1")).toEqual({ milkBased: false, steamTimers: DEFAULT_STEAM_TIMERS });
    expect(isMilkProfile(defaultSkinSettings, "p1")).toBe(false);
  });

  it("returns profile-specific milk workflow settings", () => {
    const settings = {
      ...defaultSkinSettings,
      profileWorkflows: {
        p1: { milkBased: true, steamTimers: { small: 22, medium: 32, large: 46 } }
      }
    };

    expect(profileWorkflowFor(settings, "p1")).toEqual({ milkBased: true, steamTimers: { small: 22, medium: 32, large: 46 } });
    expect(isMilkProfile(settings, "p1")).toBe(true);
  });
});
