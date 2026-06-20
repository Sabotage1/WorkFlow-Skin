export interface PresetSlot {
  label: string;
  profileId?: string;
}

export type SteamTimers = Record<string, number>;

export interface ProfileWorkflowSettings {
  milkBased: boolean;
  steamTimers: SteamTimers;
}

export type SkinThemeId = "default" | "slate" | "ruby";
export type EditableSkinThemeId = Exclude<SkinThemeId, "default">;
export type TopStatusIndicatorId = "machine" | "wifi" | "scale" | "water" | "r2" | "state" | "temperature" | "pressure" | "flow";

export interface SkinThemePalette {
  name: string;
  background: string;
  surface: string;
  panel: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentAlt: string;
}

export const DEFAULT_MAIN_MENU_ITEMS = ["brew", "live", "review", "steam", "bags", "profiles", "grinders", "history", "community", "settings"] as const;
export type MainMenuItemId = (typeof DEFAULT_MAIN_MENU_ITEMS)[number];

export const MAIN_MENU_ITEM_LABELS: Record<MainMenuItemId, string> = {
  brew: "Brew",
  live: "Live",
  review: "Review",
  steam: "Steam",
  bags: "Bags",
  profiles: "Profiles",
  grinders: "Grinders",
  community: "Community",
  history: "History",
  settings: "Settings"
};

export interface SkinSettings {
  presetSlots: PresetSlot[];
  presetSlotCount: number;
  defaultReviewEnabled: boolean;
  reviewEnabledByProfile: Record<string, boolean>;
  skinTitle: string;
  menuCollapsed: boolean;
  mainMenuItems: MainMenuItemId[];
  hiddenMainMenuItemIds: MainMenuItemId[];
  startupProfileId?: string;
  r2SensorId?: string;
  shownProfileIds: string[];
  profileWorkflows: Record<string, ProfileWorkflowSettings>;
  lastBeanBatchId?: string;
  lastGrinderId?: string;
  defaultGrinderId?: string;
  preferredEyMin?: number;
  preferredEyMax?: number;
  keepScreenAwake?: boolean;
  screensaverBrightness?: number;
  autoSleepMinutes: number;
  r2MeasureDelaySeconds: number;
  communityApiBaseUrl: string;
  skinFontScale: number;
  skinThemeId: SkinThemeId;
  customSkinThemes: Record<EditableSkinThemeId, SkinThemePalette>;
  topStatusIndicatorIds: TopStatusIndicatorId[];
}

export const SKIN_NAMESPACE = "workflow-skin";
export const SETTINGS_KEY = "settings";
export const DEFAULT_COMMUNITY_API_BASE_URL = "https://workflow-skin-community.sabotage1.workers.dev";
export const MIN_PRESET_SLOT_COUNT = 1;
export const MAX_PRESET_SLOT_COUNT = 8;
export const DEFAULT_AUTO_SLEEP_MINUTES = 30;
export const MAX_AUTO_SLEEP_MINUTES = 240;
export const DEFAULT_R2_MEASURE_DELAY_SECONDS = 20;
export const MAX_R2_MEASURE_DELAY_SECONDS = 3600;
export const MAX_STEAM_TIMERS = 4;
export const MIN_SKIN_FONT_SCALE = 85;
export const MAX_SKIN_FONT_SCALE = 125;
export const EDITABLE_SKIN_THEME_IDS = ["slate", "ruby"] as const satisfies readonly EditableSkinThemeId[];
export const DEFAULT_TOP_STATUS_INDICATORS: TopStatusIndicatorId[] = ["machine", "wifi", "scale", "water", "r2", "state", "temperature"];
export const TOP_STATUS_INDICATOR_LABELS: Record<TopStatusIndicatorId, string> = {
  machine: "Machine",
  wifi: "WiFi",
  scale: "Scale",
  water: "Water",
  r2: "R2",
  state: "State",
  temperature: "Temperature",
  pressure: "Pressure",
  flow: "Flow"
};

export const DEFAULT_SKIN_THEMES: Record<SkinThemeId, SkinThemePalette> = {
  default: {
    name: "WorkFlow Dark",
    background: "#11171c",
    surface: "#12191f",
    panel: "#151c22",
    border: "#303a43",
    text: "#f5f7f8",
    muted: "#9daab4",
    accent: "#5bd179",
    accentAlt: "#f0c36a"
  },
  slate: {
    name: "Slate Citrus",
    background: "#101417",
    surface: "#151d20",
    panel: "#1a2327",
    border: "#34404a",
    text: "#f7f4ee",
    muted: "#aeb7bd",
    accent: "#5fb8d1",
    accentAlt: "#efb75e"
  },
  ruby: {
    name: "Ruby Mint",
    background: "#171315",
    surface: "#201719",
    panel: "#261d20",
    border: "#47343a",
    text: "#f9f3f5",
    muted: "#b8a8ae",
    accent: "#82d9b0",
    accentAlt: "#f09a7a"
  }
};

const DEFAULT_PRESET_SLOTS: PresetSlot[] = [
  { label: "Light" },
  { label: "Sweet" },
  { label: "Turbo" },
  { label: "Classic" }
];

export const DEFAULT_STEAM_TIMERS: SteamTimers = { small: 20, medium: 30, large: 40 };

function clonePresetSlots(slots: PresetSlot[]): PresetSlot[] {
  return slots.map((slot) => ({ ...slot }));
}

function cloneSteamTimers(timers: SteamTimers): SteamTimers {
  return { ...timers };
}

export function createDefaultSkinSettings(): SkinSettings {
  return {
    presetSlots: clonePresetSlots(DEFAULT_PRESET_SLOTS),
    presetSlotCount: DEFAULT_PRESET_SLOTS.length,
    defaultReviewEnabled: true,
    reviewEnabledByProfile: {},
    skinTitle: "WorkFlow",
    menuCollapsed: false,
    mainMenuItems: [...DEFAULT_MAIN_MENU_ITEMS],
    hiddenMainMenuItemIds: [],
    keepScreenAwake: true,
    screensaverBrightness: 8,
    autoSleepMinutes: DEFAULT_AUTO_SLEEP_MINUTES,
    r2MeasureDelaySeconds: DEFAULT_R2_MEASURE_DELAY_SECONDS,
    communityApiBaseUrl: DEFAULT_COMMUNITY_API_BASE_URL,
    skinFontScale: 100,
    skinThemeId: "default",
    customSkinThemes: {
      slate: { ...DEFAULT_SKIN_THEMES.slate },
      ruby: { ...DEFAULT_SKIN_THEMES.ruby }
    },
    topStatusIndicatorIds: [...DEFAULT_TOP_STATUS_INDICATORS],
    shownProfileIds: [],
    profileWorkflows: {}
  };
}

export const defaultSkinSettings: SkinSettings = createDefaultSkinSettings();

export interface KvApi {
  getKv<T>(namespace: string, key: string): Promise<T | null>;
  putKv(namespace: string, key: string, value: unknown): Promise<unknown>;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizePresetSlots(value: unknown): PresetSlot[] {
  if (!Array.isArray(value)) return clonePresetSlots(DEFAULT_PRESET_SLOTS);

  const slots: PresetSlot[] = [];
  for (const slot of value) {
    if (!isPlainRecord(slot) || typeof slot.label !== "string") return clonePresetSlots(DEFAULT_PRESET_SLOTS);
    if (slot.profileId !== undefined && typeof slot.profileId !== "string") return clonePresetSlots(DEFAULT_PRESET_SLOTS);
    slots.push(typeof slot.profileId === "string" ? { label: slot.label, profileId: slot.profileId } : { label: slot.label });
  }

  return slots;
}

function normalizeReviewEnabledByProfile(value: unknown): Record<string, boolean> {
  if (!isPlainRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, enabled]) => typeof enabled === "boolean")) as Record<string, boolean>;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())));
}

function isMainMenuItemId(value: string): value is MainMenuItemId {
  return (DEFAULT_MAIN_MENU_ITEMS as readonly string[]).includes(value);
}

export function mainMenuItemsForSettings(settings: Pick<SkinSettings, "mainMenuItems"> | { mainMenuItems?: unknown }): MainMenuItemId[] {
  if (!Array.isArray(settings.mainMenuItems)) return [...DEFAULT_MAIN_MENU_ITEMS];

  const ordered: MainMenuItemId[] = [];
  for (const item of settings.mainMenuItems) {
    if (typeof item !== "string" || !isMainMenuItemId(item) || ordered.includes(item)) continue;
    ordered.push(item);
  }

  for (const item of DEFAULT_MAIN_MENU_ITEMS) {
    if (!ordered.includes(item)) ordered.push(item);
  }

  const pinned = ordered.filter((item) => item !== "community" && item !== "settings");
  return [...pinned, "community", "settings"];
}

export function hiddenMainMenuItemIdsForSettings(settings: Pick<SkinSettings, "hiddenMainMenuItemIds"> | { hiddenMainMenuItemIds?: unknown }): MainMenuItemId[] {
  const hidden = normalizeStringList(settings.hiddenMainMenuItemIds).filter(
    (item): item is MainMenuItemId => isMainMenuItemId(item) && item !== "settings"
  );
  return Array.from(new Set(hidden));
}

export function visibleMainMenuItems(settings: Pick<SkinSettings, "mainMenuItems" | "hiddenMainMenuItemIds">): MainMenuItemId[] {
  const hidden = new Set(hiddenMainMenuItemIdsForSettings(settings));
  return mainMenuItemsForSettings(settings).filter((item) => item === "settings" || !hidden.has(item));
}

function normalizePresetSlotCount(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_PRESET_SLOT_COUNT, Math.max(MIN_PRESET_SLOT_COUNT, Math.round(value)));
}

export function defaultPresetLabel(index: number): string {
  return DEFAULT_PRESET_SLOTS[index]?.label ?? `Preset ${index + 1}`;
}

export function ensurePresetSlots(slots: PresetSlot[], count: number): PresetSlot[] {
  const next = clonePresetSlots(slots);
  while (next.length < count) {
    next.push({ label: defaultPresetLabel(next.length) });
  }
  return next.map((slot, index) => ({ ...slot, label: slot.label.trim() || defaultPresetLabel(index) }));
}

export function visiblePresetSlots(settings: SkinSettings): PresetSlot[] {
  return ensurePresetSlots(settings.presetSlots, settings.presetSlotCount).slice(0, settings.presetSlotCount);
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeRequiredString(value: unknown, fallback: string): string {
  const normalized = normalizeString(value, fallback);
  return normalized || fallback;
}

function normalizeSteamTimer(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return fallback;
  return Math.round(value);
}

function normalizeSteamTimerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function normalizeAutoSleepMinutes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_AUTO_SLEEP_MINUTES;
  return Math.min(MAX_AUTO_SLEEP_MINUTES, Math.max(0, value));
}

function normalizeR2MeasureDelaySeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_R2_MEASURE_DELAY_SECONDS;
  return Math.min(MAX_R2_MEASURE_DELAY_SECONDS, Math.max(0, Math.round(value)));
}

function normalizeSkinFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.min(MAX_SKIN_FONT_SCALE, Math.max(MIN_SKIN_FONT_SCALE, Math.round(value)));
}

function normalizeSkinThemeId(value: unknown): SkinThemeId {
  return value === "slate" || value === "ruby" || value === "default" ? value : "default";
}

function isTopStatusIndicatorId(value: string): value is TopStatusIndicatorId {
  return Object.prototype.hasOwnProperty.call(TOP_STATUS_INDICATOR_LABELS, value);
}

export function topStatusIndicatorIdsForSettings(settings: Pick<SkinSettings, "topStatusIndicatorIds"> | { topStatusIndicatorIds?: unknown }): TopStatusIndicatorId[] {
  if (!Array.isArray(settings.topStatusIndicatorIds)) return [...DEFAULT_TOP_STATUS_INDICATORS];
  const indicators = settings.topStatusIndicatorIds.filter((item): item is TopStatusIndicatorId => typeof item === "string" && isTopStatusIndicatorId(item));
  return Array.from(new Set(indicators));
}

function normalizeColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(clean) ? clean : fallback;
}

function normalizeSkinThemePalette(value: unknown, fallback: SkinThemePalette): SkinThemePalette {
  if (!isPlainRecord(value)) return { ...fallback };
  return {
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : fallback.name,
    background: normalizeColor(value.background, fallback.background),
    surface: normalizeColor(value.surface, fallback.surface),
    panel: normalizeColor(value.panel, fallback.panel),
    border: normalizeColor(value.border, fallback.border),
    text: normalizeColor(value.text, fallback.text),
    muted: normalizeColor(value.muted, fallback.muted),
    accent: normalizeColor(value.accent, fallback.accent),
    accentAlt: normalizeColor(value.accentAlt, fallback.accentAlt)
  };
}

function normalizeCustomSkinThemes(value: unknown): Record<EditableSkinThemeId, SkinThemePalette> {
  return {
    slate: normalizeSkinThemePalette(isPlainRecord(value) ? value.slate : undefined, DEFAULT_SKIN_THEMES.slate),
    ruby: normalizeSkinThemePalette(isPlainRecord(value) ? value.ruby : undefined, DEFAULT_SKIN_THEMES.ruby)
  };
}

function normalizeSteamTimers(value: unknown): SteamTimers {
  if (!isPlainRecord(value)) return cloneSteamTimers(DEFAULT_STEAM_TIMERS);
  const timers: SteamTimers = {};
  for (const [key, timer] of Object.entries(value)) {
    const cleanKey = normalizeSteamTimerKey(key);
    if (!cleanKey || Object.prototype.hasOwnProperty.call(timers, cleanKey)) continue;
    timers[cleanKey] = normalizeSteamTimer(timer, DEFAULT_STEAM_TIMERS[cleanKey] ?? DEFAULT_STEAM_TIMERS.medium);
    if (Object.keys(timers).length >= MAX_STEAM_TIMERS) break;
  }
  return Object.keys(timers).length > 0 ? timers : cloneSteamTimers(DEFAULT_STEAM_TIMERS);
}

function normalizeProfileWorkflows(value: unknown): Record<string, ProfileWorkflowSettings> {
  if (!isPlainRecord(value)) return {};

  const workflows: Record<string, ProfileWorkflowSettings> = {};
  for (const [profileId, workflow] of Object.entries(value)) {
    if (!isPlainRecord(workflow) || typeof workflow.milkBased !== "boolean") continue;
    workflows[profileId] = {
      milkBased: workflow.milkBased,
      steamTimers: normalizeSteamTimers(workflow.steamTimers)
    };
  }

  return workflows;
}

export function normalizeSkinSettings(value: unknown): SkinSettings {
  if (!isPlainRecord(value)) return createDefaultSkinSettings();

  const settings: SkinSettings = {
    presetSlots: normalizePresetSlots(value.presetSlots),
    presetSlotCount: normalizePresetSlotCount(value.presetSlotCount, DEFAULT_PRESET_SLOTS.length),
    defaultReviewEnabled: typeof value.defaultReviewEnabled === "boolean" ? value.defaultReviewEnabled : true,
    reviewEnabledByProfile: normalizeReviewEnabledByProfile(value.reviewEnabledByProfile),
    skinTitle: typeof value.skinTitle === "string" && value.skinTitle.trim() ? value.skinTitle.trim() : "WorkFlow",
    menuCollapsed: typeof value.menuCollapsed === "boolean" ? value.menuCollapsed : false,
    mainMenuItems: mainMenuItemsForSettings({ mainMenuItems: value.mainMenuItems }),
    hiddenMainMenuItemIds: hiddenMainMenuItemIdsForSettings({ hiddenMainMenuItemIds: value.hiddenMainMenuItemIds }),
    keepScreenAwake: typeof value.keepScreenAwake === "boolean" ? value.keepScreenAwake : true,
    screensaverBrightness:
      typeof value.screensaverBrightness === "number" && Number.isFinite(value.screensaverBrightness)
        ? Math.min(100, Math.max(0, Math.round(value.screensaverBrightness)))
        : 8,
    autoSleepMinutes: normalizeAutoSleepMinutes(value.autoSleepMinutes),
    r2MeasureDelaySeconds: normalizeR2MeasureDelaySeconds(value.r2MeasureDelaySeconds),
    communityApiBaseUrl: normalizeRequiredString(value.communityApiBaseUrl, DEFAULT_COMMUNITY_API_BASE_URL),
    skinFontScale: normalizeSkinFontScale(value.skinFontScale),
    skinThemeId: normalizeSkinThemeId(value.skinThemeId),
    customSkinThemes: normalizeCustomSkinThemes(value.customSkinThemes),
    topStatusIndicatorIds: topStatusIndicatorIdsForSettings({ topStatusIndicatorIds: value.topStatusIndicatorIds }),
    shownProfileIds: normalizeStringList(value.shownProfileIds),
    profileWorkflows: normalizeProfileWorkflows(value.profileWorkflows)
  };

  if (typeof value.startupProfileId === "string") settings.startupProfileId = value.startupProfileId;
  if (typeof value.r2SensorId === "string") settings.r2SensorId = value.r2SensorId;
  if (typeof value.lastBeanBatchId === "string") settings.lastBeanBatchId = value.lastBeanBatchId;
  if (typeof value.lastGrinderId === "string") settings.lastGrinderId = value.lastGrinderId;
  if (typeof value.defaultGrinderId === "string") settings.defaultGrinderId = value.defaultGrinderId;
  if (typeof value.preferredEyMin === "number" && Number.isFinite(value.preferredEyMin)) settings.preferredEyMin = value.preferredEyMin;
  if (typeof value.preferredEyMax === "number" && Number.isFinite(value.preferredEyMax)) settings.preferredEyMax = value.preferredEyMax;

  return settings;
}

export async function loadSkinSettings(api: KvApi): Promise<SkinSettings> {
  const saved = await api.getKv<unknown>(SKIN_NAMESPACE, SETTINGS_KEY);
  return normalizeSkinSettings(saved);
}

export async function saveSkinSettings(api: KvApi, settings: SkinSettings): Promise<void> {
  await api.putKv(SKIN_NAMESPACE, SETTINGS_KEY, settings);
}

export function isReviewEnabled(settings: SkinSettings, profileId?: string): boolean {
  const defaultEnabled = typeof settings.defaultReviewEnabled === "boolean" ? settings.defaultReviewEnabled : true;
  if (!profileId) return defaultEnabled;
  return normalizeReviewEnabledByProfile(settings.reviewEnabledByProfile)[profileId] ?? defaultEnabled;
}

export function profileWorkflowFor(settings: SkinSettings, profileId?: string): ProfileWorkflowSettings {
  if (!profileId) return { milkBased: false, steamTimers: cloneSteamTimers(DEFAULT_STEAM_TIMERS) };
  const workflow = settings.profileWorkflows[profileId];
  return workflow
    ? { milkBased: workflow.milkBased, steamTimers: cloneSteamTimers(workflow.steamTimers) }
    : { milkBased: false, steamTimers: cloneSteamTimers(DEFAULT_STEAM_TIMERS) };
}

export function isProfileShown(settings: SkinSettings, profileId?: string): boolean {
  return Boolean(profileId && settings.shownProfileIds.includes(profileId));
}

export function isMilkProfile(settings: SkinSettings, profileId?: string): boolean {
  return profileWorkflowFor(settings, profileId).milkBased;
}

export function skinThemesForSettings(settings: Pick<SkinSettings, "customSkinThemes">): Record<SkinThemeId, SkinThemePalette> {
  return {
    default: DEFAULT_SKIN_THEMES.default,
    slate: settings.customSkinThemes?.slate ?? DEFAULT_SKIN_THEMES.slate,
    ruby: settings.customSkinThemes?.ruby ?? DEFAULT_SKIN_THEMES.ruby
  };
}

export function activeSkinTheme(settings: Pick<SkinSettings, "customSkinThemes" | "skinThemeId">): SkinThemePalette {
  return skinThemesForSettings(settings)[settings.skinThemeId] ?? DEFAULT_SKIN_THEMES.default;
}
