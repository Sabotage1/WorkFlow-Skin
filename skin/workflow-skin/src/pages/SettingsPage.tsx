import { useEffect, useState } from "react";
import type {
  De1AdvancedMachineSettings,
  De1MachineCalibration,
  De1MachineSettings,
  DisplayState,
  JsonMap,
  PluginManifest,
  SensorListItem,
  UpdateDe1MachineSettings,
  VisualizerStatus
} from "../api/types";
import {
  DEFAULT_COMMUNITY_API_BASE_URL,
  DEFAULT_SKIN_THEMES,
  DEFAULT_R2_MEASURE_DELAY_SECONDS,
  EDITABLE_SKIN_THEME_IDS,
  defaultPresetLabel,
  ensurePresetSlots,
  hiddenMainMenuItemIdsForSettings,
  mainMenuItemsForSettings,
  MAX_AUTO_SLEEP_MINUTES,
  MAX_PRESET_SLOT_COUNT,
  MAX_R2_MEASURE_DELAY_SECONDS,
  MAX_SKIN_FONT_SCALE,
  MIN_PRESET_SLOT_COUNT,
  MIN_SKIN_FONT_SCALE,
  TOP_STATUS_INDICATOR_LABELS,
  normalizeSkinSettings,
  skinThemesForSettings,
  type EditableSkinThemeId,
  type SkinSettings,
  type SkinThemePalette,
  type TopStatusIndicatorId,
  topStatusIndicatorIdsForSettings
} from "../state/skinSettings";

type SettingsSection = "machine" | "app" | "skin";

const themeColorFields: Array<{ key: keyof Omit<SkinThemePalette, "name">; label: string }> = [
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "panel", label: "Panel" },
  { key: "border", label: "Border" },
  { key: "text", label: "Text" },
  { key: "muted", label: "Muted" },
  { key: "accent", label: "Accent" },
  { key: "accentAlt", label: "Second accent" }
];

const defaultMachineSettings: Required<De1MachineSettings> = {
  usb: true,
  fan: 40,
  flushTemp: 90,
  flushFlow: 6,
  flushTimeout: 5,
  hotWaterFlow: 6,
  steamFlow: 1.2,
  tankTemp: 0,
  steamPurgeMode: 0
};

const defaultAdvancedMachineSettings: Required<De1AdvancedMachineSettings> = {
  heaterPh1Flow: 4,
  heaterPh2Flow: 4,
  heaterIdleTemp: 85,
  heaterPh2Timeout: 10,
  heaterVoltage: 230,
  refillKitSetting: 2
};

const defaultMachineCalibration: Required<De1MachineCalibration> = {
  flowMultiplier: 1
};

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeMachineSettingsDraft(settings: De1MachineSettings | null | undefined): Required<De1MachineSettings> {
  return {
    usb: typeof settings?.usb === "boolean" ? settings.usb : defaultMachineSettings.usb,
    fan: boundedNumber(settings?.fan, defaultMachineSettings.fan, 0, 100),
    flushTemp: boundedNumber(settings?.flushTemp, defaultMachineSettings.flushTemp, 0, 110),
    flushFlow: boundedNumber(settings?.flushFlow, defaultMachineSettings.flushFlow, 0, 20),
    flushTimeout: boundedNumber(settings?.flushTimeout, defaultMachineSettings.flushTimeout, 0, 120),
    hotWaterFlow: boundedNumber(settings?.hotWaterFlow, defaultMachineSettings.hotWaterFlow, 0, 20),
    steamFlow: boundedNumber(settings?.steamFlow, defaultMachineSettings.steamFlow, 0, 5),
    tankTemp: boundedNumber(settings?.tankTemp, defaultMachineSettings.tankTemp, 0, 99),
    steamPurgeMode: Math.round(boundedNumber(settings?.steamPurgeMode, defaultMachineSettings.steamPurgeMode, 0, 3))
  };
}

function normalizeAdvancedMachineSettingsDraft(settings: De1AdvancedMachineSettings | null | undefined): Required<De1AdvancedMachineSettings> {
  return {
    heaterPh1Flow: boundedNumber(settings?.heaterPh1Flow, defaultAdvancedMachineSettings.heaterPh1Flow, 0, 20),
    heaterPh2Flow: boundedNumber(settings?.heaterPh2Flow, defaultAdvancedMachineSettings.heaterPh2Flow, 0, 20),
    heaterIdleTemp: boundedNumber(settings?.heaterIdleTemp, defaultAdvancedMachineSettings.heaterIdleTemp, 0, 110),
    heaterPh2Timeout: boundedNumber(settings?.heaterPh2Timeout, defaultAdvancedMachineSettings.heaterPh2Timeout, 0, 120),
    heaterVoltage: boundedNumber(settings?.heaterVoltage, defaultAdvancedMachineSettings.heaterVoltage, 100, 260),
    refillKitSetting: Math.round(boundedNumber(settings?.refillKitSetting, defaultAdvancedMachineSettings.refillKitSetting, 0, 3))
  };
}

function normalizeMachineCalibrationDraft(settings: De1MachineCalibration | null | undefined): Required<De1MachineCalibration> {
  return {
    flowMultiplier: boundedNumber(settings?.flowMultiplier, defaultMachineCalibration.flowMultiplier, 0.1, 3)
  };
}

function pluginLine(plugin: PluginManifest | null | undefined): string {
  if (!plugin) return "Not installed";
  const loaded = plugin.loaded ? "Loaded" : "Disabled";
  const autoLoad = plugin.autoLoad ? "Auto-load on" : "Auto-load off";
  const version = plugin.version ? `v${plugin.version}` : "version unknown";
  return `${loaded} · ${autoLoad} · ${version}`;
}

function hasCredential(settings: JsonMap | null | undefined, key: string): boolean {
  const value = settings?.[key];
  return typeof value === "string" && value.trim().length > 0;
}

function visualizerSettingsLine(settings: JsonMap | null | undefined): string {
  const credentials = hasCredential(settings, "Username") && hasCredential(settings, "Password") ? "Credentials configured" : "Credentials missing";
  const autoUpload = settings?.AutoUpload === false ? "Auto upload off" : "Auto upload on";
  const backSync = settings?.BackSync ? "Back-sync on" : "Back-sync off";
  return `${credentials} · ${autoUpload} · ${backSync}`;
}

function statusString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function visualizerUploadLine(status: VisualizerStatus | null | undefined): string {
  const reaId = statusString(status?.lastUpload?.reaId);
  const visId = statusString(status?.lastUpload?.visId);
  if (reaId && visId) return `Last upload ${visId} from ${reaId}`;
  return "No upload recorded";
}

function visualizerSyncLine(status: VisualizerStatus | null | undefined): string {
  const backError = statusString(status?.backSyncStatus?.lastError);
  const forwardError = statusString(status?.forwardSyncStatus?.lastError);
  if (backError || forwardError) return `Sync issue: ${backError ?? forwardError}`;
  const backResult = statusString(status?.backSyncStatus?.lastResult);
  const forwardResult = statusString(status?.forwardSyncStatus?.lastResult);
  return [backResult, forwardResult].filter(Boolean).join(" · ") || "No sync activity";
}

function brightnessValue(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 8;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function autoSleepValue(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 30;
  return Math.min(MAX_AUTO_SLEEP_MINUTES, Math.max(0, Math.round(value)));
}

function r2MeasureDelayValue(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_R2_MEASURE_DELAY_SECONDS;
  return Math.min(MAX_R2_MEASURE_DELAY_SECONDS, Math.max(0, Math.round(value)));
}

function skinFontScaleValue(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.min(MAX_SKIN_FONT_SCALE, Math.max(MIN_SKIN_FONT_SCALE, Math.round(value)));
}

function numberInputValue(value: number | undefined): string | number {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function numberInputDraft(value: string): number {
  if (!value.trim()) return Number.NaN;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function normalizeDraftSettings(settings: SkinSettings): SkinSettings {
  const presetSlotCount = Math.min(MAX_PRESET_SLOT_COUNT, Math.max(MIN_PRESET_SLOT_COUNT, Math.round(settings.presetSlotCount || 4)));
  const next: SkinSettings = {
    ...settings,
    presetSlotCount,
    presetSlots: ensurePresetSlots(settings.presetSlots, presetSlotCount),
    skinTitle: settings.skinTitle.trim() || "WorkFlow",
    mainMenuItems: mainMenuItemsForSettings(settings),
    hiddenMainMenuItemIds: hiddenMainMenuItemIdsForSettings(settings),
    keepScreenAwake: settings.keepScreenAwake !== false,
    screensaverBrightness: brightnessValue(settings.screensaverBrightness),
    autoSleepMinutes: autoSleepValue(settings.autoSleepMinutes),
    r2MeasureDelaySeconds: r2MeasureDelayValue(settings.r2MeasureDelaySeconds),
    communityApiBaseUrl: settings.communityApiBaseUrl.trim() || DEFAULT_COMMUNITY_API_BASE_URL,
    skinFontScale: skinFontScaleValue(settings.skinFontScale),
    skinThemeId: settings.skinThemeId,
    customSkinThemes: settings.customSkinThemes,
    topStatusIndicatorIds: topStatusIndicatorIdsForSettings(settings)
  };

  if (!next.r2SensorId) delete next.r2SensorId;
  return normalizeSkinSettings(next);
}

export function SettingsPage({
  settings,
  r2Sensor,
  onUpdateSettings,
  displayState,
  visualizerPlugin,
  visualizerSettings,
  visualizerStatus,
  r2RefreshBusy = false,
  onRefreshR2,
  machineSettings,
  advancedMachineSettings,
  machineCalibration,
  onSaveMachineSettings,
  onResetMachineSettings
}: {
  settings: SkinSettings;
  r2Sensor: SensorListItem | null;
  onUpdateSettings: (settings: SkinSettings) => void;
  displayState?: DisplayState | null;
  machineSettings?: De1MachineSettings | null;
  advancedMachineSettings?: De1AdvancedMachineSettings | null;
  machineCalibration?: De1MachineCalibration | null;
  visualizerPlugin?: PluginManifest | null;
  visualizerSettings?: JsonMap | null;
  visualizerStatus?: VisualizerStatus | null;
  r2RefreshBusy?: boolean;
  onRefreshR2?: () => Promise<void> | void;
  onSaveMachineSettings?: (
    machineSettings: UpdateDe1MachineSettings,
    advancedMachineSettings: De1AdvancedMachineSettings,
    machineCalibration: De1MachineCalibration
  ) => Promise<void> | void;
  onResetMachineSettings?: () => Promise<void> | void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("machine");
  const [draftSettings, setDraftSettings] = useState(settings);
  const [acknowledgedSettings, setAcknowledgedSettings] = useState(settings);
  const [machineDraft, setMachineDraft] = useState(() => normalizeMachineSettingsDraft(machineSettings));
  const [advancedMachineDraft, setAdvancedMachineDraft] = useState(() => normalizeAdvancedMachineSettingsDraft(advancedMachineSettings));
  const [calibrationDraft, setCalibrationDraft] = useState(() => normalizeMachineCalibrationDraft(machineCalibration));
  const [advancedMachineAcknowledged, setAdvancedMachineAcknowledged] = useState(false);
  const savedSettings = normalizeDraftSettings(acknowledgedSettings);
  const nextSettings = normalizeDraftSettings(draftSettings);
  const settingsChanged = JSON.stringify(nextSettings) !== JSON.stringify(savedSettings);
  const r2Configured = Boolean(draftSettings.r2SensorId);
  const screensaverBrightness = brightnessValue(draftSettings.screensaverBrightness);
  const skinFontScale = skinFontScaleValue(draftSettings.skinFontScale);
  const skinThemes = skinThemesForSettings(draftSettings);

  useEffect(() => {
    setDraftSettings(settings);
    setAcknowledgedSettings(settings);
  }, [settings]);

  useEffect(() => {
    setMachineDraft(normalizeMachineSettingsDraft(machineSettings));
  }, [machineSettings]);

  useEffect(() => {
    setAdvancedMachineDraft(normalizeAdvancedMachineSettingsDraft(advancedMachineSettings));
  }, [advancedMachineSettings]);

  useEffect(() => {
    setCalibrationDraft(normalizeMachineCalibrationDraft(machineCalibration));
  }, [machineCalibration]);

  const updateDraftSettings = (patch: Partial<SkinSettings>) => {
    setDraftSettings((current) => ({ ...current, ...patch }));
  };

  const updateMachineDraft = (patch: Partial<Required<De1MachineSettings>>) => {
    setMachineDraft((current) => ({ ...current, ...patch }));
  };

  const updateAdvancedMachineDraft = (patch: Partial<Required<De1AdvancedMachineSettings>>) => {
    setAdvancedMachineDraft((current) => ({ ...current, ...patch }));
  };

  const updateCalibrationDraft = (patch: Partial<Required<De1MachineCalibration>>) => {
    setCalibrationDraft((current) => ({ ...current, ...patch }));
  };

  const updatePresetCount = (value: string) => {
    if (!value.trim()) {
      setDraftSettings((current) => ({ ...current, presetSlotCount: Number.NaN }));
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      setDraftSettings((current) => ({ ...current, presetSlotCount: Number.NaN }));
      return;
    }
    const presetSlotCount = Math.min(MAX_PRESET_SLOT_COUNT, Math.max(MIN_PRESET_SLOT_COUNT, Math.round(parsed)));
    setDraftSettings((current) => ({
      ...current,
      presetSlotCount,
      presetSlots: ensurePresetSlots(current.presetSlots, presetSlotCount)
    }));
  };

  const updatePresetTitle = (index: number, label: string) => {
    setDraftSettings((current) => {
      const slots = ensurePresetSlots(current.presetSlots, current.presetSlotCount);
      slots[index] = { ...slots[index], label };
      return { ...current, presetSlots: slots };
    });
  };

  const updateR2SensorId = (sensorId: string | undefined) => {
    setDraftSettings((current) => {
      if (sensorId) return { ...current, r2SensorId: sensorId };
      const next = { ...current };
      delete next.r2SensorId;
      return next;
    });
  };

  const updateCustomTheme = (themeId: EditableSkinThemeId, patch: Partial<SkinThemePalette>) => {
    setDraftSettings((current) => ({
      ...current,
      customSkinThemes: {
        ...current.customSkinThemes,
        [themeId]: {
          ...(current.customSkinThemes?.[themeId] ?? DEFAULT_SKIN_THEMES[themeId]),
          ...patch
        }
      }
    }));
  };

  const toggleTopStatusIndicator = (indicatorId: TopStatusIndicatorId, shown: boolean) => {
    setDraftSettings((current) => {
      const currentIds = topStatusIndicatorIdsForSettings(current);
      const nextIds = shown ? Array.from(new Set([...currentIds, indicatorId])) : currentIds.filter((id) => id !== indicatorId);
      return { ...current, topStatusIndicatorIds: nextIds };
    });
  };

  const saveSettings = () => {
    setAcknowledgedSettings(nextSettings);
    setDraftSettings(nextSettings);
    onUpdateSettings(nextSettings);
  };

  const saveMachineSettings = () => {
    void onSaveMachineSettings?.(
      normalizeMachineSettingsDraft(machineDraft),
      normalizeAdvancedMachineSettingsDraft(advancedMachineDraft),
      normalizeMachineCalibrationDraft(calibrationDraft)
    );
  };

  return (
    <div className="panel wide settings-panel">
      <h2>Settings</h2>
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {[
          ["machine", "Machine settings"],
          ["app", "App settings"],
          ["skin", "Skin settings"]
        ].map(([section, label]) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === section}
            className={activeSection === section ? "settings-tab active" : "settings-tab"}
            key={section}
            onClick={() => setActiveSection(section as SettingsSection)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeSection === "machine" && (
        <section className="settings-section" role="tabpanel" aria-label="Machine settings">
          <div className="list-row">
            <strong>Native display</strong>
            <span>Brightness {displayState?.brightness ?? displayState?.requestedBrightness ?? "unknown"}%</span>
            <span>{displayState?.wakeLockOverride ? "Wake-lock on" : "Wake-lock off"}</span>
            <label className="inline-toggle">
              <input
                type="checkbox"
                checked={draftSettings.keepScreenAwake !== false}
                onChange={(event) => updateDraftSettings({ keepScreenAwake: event.target.checked })}
              />
              Keep screen awake while the skin is open
            </label>
            <label className="settings-field">
              Auto sleep after last use
              <input
                aria-label="Auto sleep after last use"
                type="number"
                min={0}
                max={MAX_AUTO_SLEEP_MINUTES}
                step={1}
                value={numberInputValue(draftSettings.autoSleepMinutes)}
                onChange={(event) => updateDraftSettings({ autoSleepMinutes: numberInputDraft(event.target.value) })}
              />
            </label>
            <span>Set 0 to disable automatic sleep.</span>
            <label className="settings-field settings-slider-field">
              <span>Screensaver brightness</span>
              <span className="settings-slider-row">
                <input
                  aria-label="Screensaver brightness"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={screensaverBrightness}
                  onChange={(event) => updateDraftSettings({ screensaverBrightness: Number(event.target.value) })}
                />
                <strong className="settings-slider-value">{screensaverBrightness}%</strong>
              </span>
            </label>
          </div>
          <div className="list-row settings-machine-row">
            <strong>Machine outputs</strong>
            {!machineSettings && <span>Machine settings unavailable until the machine is connected.</span>}
            <div className="machine-settings-grid">
              <label className="settings-field">
                Tank preheat target
                <input
                  aria-label="Tank preheat target"
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  value={numberInputValue(machineDraft.tankTemp)}
                  onChange={(event) => updateMachineDraft({ tankTemp: numberInputDraft(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                Steam flow
                <input
                  aria-label="Steam flow"
                  type="number"
                  min={0}
                  max={5}
                  step={0.1}
                  value={numberInputValue(machineDraft.steamFlow)}
                  onChange={(event) => updateMachineDraft({ steamFlow: numberInputDraft(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                Steam purge mode
                <select
                  aria-label="Steam purge mode"
                  value={String(machineDraft.steamPurgeMode)}
                  onChange={(event) => updateMachineDraft({ steamPurgeMode: Number(event.target.value) })}
                >
                  <option value="0">Off</option>
                  <option value="1">Short purge</option>
                  <option value="2">Long purge</option>
                  <option value="3">Automatic</option>
                </select>
              </label>
              <label className="settings-field">
                Hot water flow
                <input
                  aria-label="Hot water flow"
                  type="number"
                  min={0}
                  max={20}
                  step={0.1}
                  value={numberInputValue(machineDraft.hotWaterFlow)}
                  onChange={(event) => updateMachineDraft({ hotWaterFlow: numberInputDraft(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                Flush temperature
                <input
                  aria-label="Flush temperature"
                  type="number"
                  min={0}
                  max={110}
                  step={1}
                  value={numberInputValue(machineDraft.flushTemp)}
                  onChange={(event) => updateMachineDraft({ flushTemp: numberInputDraft(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                Flush flow
                <input
                  aria-label="Flush flow"
                  type="number"
                  min={0}
                  max={20}
                  step={0.1}
                  value={numberInputValue(machineDraft.flushFlow)}
                  onChange={(event) => updateMachineDraft({ flushFlow: numberInputDraft(event.target.value) })}
                />
              </label>
              <label className="settings-field">
                Flush timeout
                <input
                  aria-label="Flush timeout"
                  type="number"
                  min={0}
                  max={120}
                  step={1}
                  value={numberInputValue(machineDraft.flushTimeout)}
                  onChange={(event) => updateMachineDraft({ flushTimeout: numberInputDraft(event.target.value) })}
                />
              </label>
            </div>
          </div>
          <div className="list-row settings-machine-row">
            <strong>Advanced machine settings</strong>
            <span>Advanced machine settings can change low-level machine behavior. Acknowledge the caution before editing them.</span>
            <label className="inline-toggle">
              <input type="checkbox" checked={advancedMachineAcknowledged} onChange={(event) => setAdvancedMachineAcknowledged(event.target.checked)} />
              I understand these advanced settings can affect machine safety and I should proceed with caution.
            </label>
            {advancedMachineAcknowledged && (
              <div className="machine-settings-grid">
                <label className="settings-field">
                  Fan threshold
                  <input
                    aria-label="Fan threshold"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={numberInputValue(machineDraft.fan)}
                    onChange={(event) => updateMachineDraft({ fan: numberInputDraft(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  Heater idle temperature
                  <input
                    aria-label="Heater idle temperature"
                    type="number"
                    min={0}
                    max={110}
                    step={1}
                    value={numberInputValue(advancedMachineDraft.heaterIdleTemp)}
                    onChange={(event) => updateAdvancedMachineDraft({ heaterIdleTemp: numberInputDraft(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  Heater phase 1 flow
                  <input
                    aria-label="Heater phase 1 flow"
                    type="number"
                    min={0}
                    max={20}
                    step={0.1}
                    value={numberInputValue(advancedMachineDraft.heaterPh1Flow)}
                    onChange={(event) => updateAdvancedMachineDraft({ heaterPh1Flow: numberInputDraft(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  Heater phase 2 flow
                  <input
                    aria-label="Heater phase 2 flow"
                    type="number"
                    min={0}
                    max={20}
                    step={0.1}
                    value={numberInputValue(advancedMachineDraft.heaterPh2Flow)}
                    onChange={(event) => updateAdvancedMachineDraft({ heaterPh2Flow: numberInputDraft(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  Heater phase 2 timeout
                  <input
                    aria-label="Heater phase 2 timeout"
                    type="number"
                    min={0}
                    max={120}
                    step={1}
                    value={numberInputValue(advancedMachineDraft.heaterPh2Timeout)}
                    onChange={(event) => updateAdvancedMachineDraft({ heaterPh2Timeout: numberInputDraft(event.target.value) })}
                  />
                </label>
                <label className="settings-field">
                  Mains voltage hint
                  <select
                    aria-label="Mains voltage hint"
                    value={String(advancedMachineDraft.heaterVoltage)}
                    onChange={(event) => updateAdvancedMachineDraft({ heaterVoltage: Number(event.target.value) })}
                  >
                    <option value="110">110 V</option>
                    <option value="120">120 V</option>
                    <option value="220">220 V</option>
                    <option value="230">230 V</option>
                    <option value="240">240 V</option>
                  </select>
                </label>
                <label className="settings-field">
                  Refill kit
                  <select
                    aria-label="Refill kit"
                    value={String(advancedMachineDraft.refillKitSetting)}
                    onChange={(event) => updateAdvancedMachineDraft({ refillKitSetting: Number(event.target.value) })}
                  >
                    <option value="0">Off</option>
                    <option value="1">Manual</option>
                    <option value="2">Automatic</option>
                    <option value="3">Always on</option>
                  </select>
                </label>
                <label className="settings-field">
                  Flow calibration
                  <input
                    aria-label="Flow calibration"
                    type="number"
                    min={0.1}
                    max={3}
                    step={0.01}
                    value={numberInputValue(calibrationDraft.flowMultiplier)}
                    onChange={(event) => updateCalibrationDraft({ flowMultiplier: numberInputDraft(event.target.value) })}
                  />
                </label>
                <label className="inline-toggle machine-usb-toggle">
                  <input type="checkbox" checked={machineDraft.usb} onChange={(event) => updateMachineDraft({ usb: event.target.checked })} />
                  USB charger output
                </label>
              </div>
            )}
          </div>
          <div className="profile-workflow-controls">
            <button type="button" className="primary-button" disabled={!onSaveMachineSettings} onClick={saveMachineSettings}>
              Save machine settings
            </button>
            <button type="button" className="ghost-button" disabled={!onResetMachineSettings} onClick={() => void onResetMachineSettings?.()}>
              Reset machine settings
            </button>
          </div>
        </section>
      )}

      {activeSection === "app" && (
        <section className="settings-section" role="tabpanel" aria-label="App settings">
          <div className="list-row">
            <strong>Visualizer</strong>
            <span>{visualizerPlugin?.name ?? "Visualizer plugin not installed"}</span>
            <span>{pluginLine(visualizerPlugin)}</span>
            <span>{visualizerSettingsLine(visualizerSettings)}</span>
            <span>{visualizerUploadLine(visualizerStatus)}</span>
            <span>{visualizerSyncLine(visualizerStatus)}</span>
          </div>
        </section>
      )}

      {activeSection === "skin" && (
        <section className="settings-section" role="tabpanel" aria-label="Skin settings">
          <div className="list-row settings-update-row">
            <strong>DiFluid R2 status</strong>
            <span>{r2Configured ? `Configured sensor: ${draftSettings.r2SensorId}` : "R2 status is hidden until setup."}</span>
            <label className="settings-field">
              Measure delay
              <input
                aria-label="Measure delay"
                type="number"
                min={0}
                max={MAX_R2_MEASURE_DELAY_SECONDS}
                step={1}
                value={numberInputValue(draftSettings.r2MeasureDelaySeconds)}
                onChange={(event) => updateDraftSettings({ r2MeasureDelaySeconds: numberInputDraft(event.target.value) })}
              />
            </label>
            <span>Delay is in seconds after the shot is done brewing and the skin moves to the Review page.</span>
            <div className="profile-workflow-controls">
              <button type="button" className="ghost-button" disabled={r2RefreshBusy || !onRefreshR2} onClick={() => void onRefreshR2?.()}>
                {r2RefreshBusy ? "Refreshing R2" : "Refresh R2"}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!r2Sensor || r2RefreshBusy}
                onClick={() => r2Sensor && updateR2SensorId(r2Sensor.id)}
              >
                {r2Sensor ? "Use detected R2" : "No R2 detected"}
              </button>
              {r2Configured && (
                <button type="button" className="ghost-button" onClick={() => updateR2SensorId(undefined)}>
                  Hide R2 status
                </button>
              )}
            </div>
          </div>
          <div className="list-row settings-update-row">
            <strong>Skin controls</strong>
            <label className="settings-field settings-slider-field">
              <span>Font size</span>
              <span className="settings-slider-row">
                <input
                  aria-label="Skin font size"
                  type="range"
                  min={MIN_SKIN_FONT_SCALE}
                  max={MAX_SKIN_FONT_SCALE}
                  step={1}
                  value={skinFontScale}
                  onChange={(event) => updateDraftSettings({ skinFontScale: Number(event.target.value) })}
                />
                <strong className="settings-slider-value">{skinFontScale}%</strong>
              </span>
            </label>
            <label className="settings-field">
              Theme
              <select
                aria-label="Skin theme"
                value={draftSettings.skinThemeId}
                onChange={(event) => updateDraftSettings({ skinThemeId: event.target.value as SkinSettings["skinThemeId"] })}
              >
                {Object.entries(skinThemes).map(([themeId, theme]) => (
                  <option key={themeId} value={themeId}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </label>
            <div
              className="theme-preview"
              style={{
                background: skinThemes[draftSettings.skinThemeId].surface,
                borderColor: skinThemes[draftSettings.skinThemeId].border,
                color: skinThemes[draftSettings.skinThemeId].text
              }}
            >
              <strong>{skinThemes[draftSettings.skinThemeId].name}</strong>
              <span style={{ color: skinThemes[draftSettings.skinThemeId].muted }}>Live theme preview</span>
              <span className="theme-preview-accent" style={{ background: skinThemes[draftSettings.skinThemeId].accent }} />
            </div>
            <div className="theme-editor-grid">
              {EDITABLE_SKIN_THEME_IDS.map((themeId) => {
                const defaultTheme = DEFAULT_SKIN_THEMES[themeId];
                const theme = draftSettings.customSkinThemes[themeId] ?? defaultTheme;
                return (
                  <fieldset className="theme-editor" key={themeId}>
                    <legend>{defaultTheme.name}</legend>
                    <label className="settings-field">
                      Theme name
                      <input
                        aria-label={`${defaultTheme.name} theme name`}
                        value={theme.name}
                        onChange={(event) => updateCustomTheme(themeId, { name: event.target.value })}
                      />
                    </label>
                    <div className="theme-color-grid">
                      {themeColorFields.map(({ key, label }) => (
                        <label className="settings-field theme-color-field" key={key}>
                          {label}
                          <input
                            aria-label={`${defaultTheme.name} ${label.toLowerCase()} color`}
                            type="color"
                            value={theme[key]}
                            onChange={(event) => updateCustomTheme(themeId, { [key]: event.target.value } as Partial<SkinThemePalette>)}
                          />
                        </label>
                      ))}
                    </div>
                    <div className="profile-workflow-controls">
                      <button type="button" className="ghost-button compact-button" onClick={() => updateCustomTheme(themeId, DEFAULT_SKIN_THEMES[themeId])}>
                        Reset {defaultTheme.name}
                      </button>
                      <button type="button" className="primary-button compact-button" onClick={() => updateDraftSettings({ skinThemeId: themeId })}>
                        Use {theme.name || defaultTheme.name}
                      </button>
                    </div>
                  </fieldset>
                );
              })}
            </div>
          </div>
          <div className="list-row settings-update-row">
            <strong>Top indicators</strong>
            <span>Select which machine and workflow indicators appear in the fixed top bar.</span>
            <div className="indicator-toggle-grid">
              {(Object.keys(TOP_STATUS_INDICATOR_LABELS) as TopStatusIndicatorId[]).map((indicatorId) => (
                <label className="inline-toggle" key={indicatorId}>
                  <input
                    type="checkbox"
                    checked={topStatusIndicatorIdsForSettings(draftSettings).includes(indicatorId)}
                    onChange={(event) => toggleTopStatusIndicator(indicatorId, event.target.checked)}
                  />
                  {TOP_STATUS_INDICATOR_LABELS[indicatorId]}
                </label>
              ))}
            </div>
          </div>
          <div className="list-row settings-update-row">
            <strong>Main page presets</strong>
            <label className="settings-field">
              Preset cards on main page
              <input
                aria-label="Preset cards on main page"
                type="number"
                min={MIN_PRESET_SLOT_COUNT}
                max={MAX_PRESET_SLOT_COUNT}
                value={numberInputValue(draftSettings.presetSlotCount)}
                onChange={(event) => updatePresetCount(event.target.value)}
              />
            </label>
            <div className="settings-preset-title-grid">
              {ensurePresetSlots(draftSettings.presetSlots, Number.isFinite(draftSettings.presetSlotCount) ? draftSettings.presetSlotCount : 0)
                .slice(0, Number.isFinite(draftSettings.presetSlotCount) ? draftSettings.presetSlotCount : 0)
                .map((slot, index) => (
                  <label className="settings-field" key={index}>
                    Preset {index + 1} title
                    <input
                      aria-label={`Preset ${index + 1} title`}
                      value={slot.label}
                      placeholder={defaultPresetLabel(index)}
                      onChange={(event) => updatePresetTitle(index, event.target.value)}
                    />
                  </label>
                ))}
            </div>
          </div>
          <div className="list-row settings-update-row">
            <strong>Community</strong>
            <span>Profile recommendations use the WorkFlow community service.</span>
            <label className="settings-field">
              Community API
              <input
                aria-label="Community API"
                value={draftSettings.communityApiBaseUrl}
                onChange={(event) => updateDraftSettings({ communityApiBaseUrl: event.target.value })}
              />
            </label>
          </div>
        </section>
      )}

      <div className="settings-save-actions">
        <button type="button" className="primary-button settings-save-button" disabled={!settingsChanged} onClick={saveSettings}>
          Save settings
        </button>
      </div>
    </div>
  );
}
