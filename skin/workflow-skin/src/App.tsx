import {
  Activity,
  Coffee,
  Flame,
  Gauge,
  History,
  Maximize2,
  Minimize2,
  Moon,
  NotebookPen,
  PackageOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Users
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import skinManifest from "../skin-manifest.json";
import { CommunityApi } from "./api/community";
import { apiBaseUrl, ReaPrimeApi, ReaPrimeApiError, type CreateGrinderPayload } from "./api/reaprime";
import { findDifluidR2Sensor } from "./api/sensors";
import type {
  BurrType,
  DecentAccountStatus,
  De1AdvancedMachineSettings,
  De1MachineCalibration,
  DeviceInfo,
  Grinder,
  MachineState,
  Profile,
  ProfileRecord,
  SensorListItem,
  ShotAnnotations,
  ShotRecord,
  ShotSnapshot,
  UpdateDe1MachineSettings,
  WaterLevels,
  Workflow
} from "./api/types";
import { uploadShotToVisualizer } from "./api/visualizer";
import { sanitizeShotEvidence } from "./community/evidence";
import { publicNameFromDecentAccount } from "./community/identity";
import { profilePayloadForCommunityInstall } from "./community/profileInstall";
import type { CommunityRecommendation, DownloadedCommunityProfile, UploadedCommunityProfile } from "./community/types";
import type { Bag } from "./lib/bags";
import { buildConnectivityStatuses } from "./lib/connectivity";
import type { ConnectivityStatus } from "./lib/connectivity";
import { trimLiveGraphWarmup } from "./lib/liveMeasurements";
import { machineModeLabel, machineTemperature } from "./lib/machineState";
import { isBrewingMode, isIdleMode, isSleepingMode, isSteamingMode, shouldPollMachineState, workflowActivityForMode } from "./lib/machineMode";
import { grindSizeFromShot, shotStats } from "./lib/shotStats";
import { selectedProfileIdFromWorkflow, type CompletedWorkflowActivity } from "./lib/workflowRouting";
import { BagsPage } from "./pages/BagsPage";
import { BrewPage } from "./pages/BrewPage";
import { CommunityPage, type UploadDraft } from "./pages/CommunityPage";
import { GrindersPage } from "./pages/GrindersPage";
import { HistoryPage } from "./pages/HistoryPage";
import { LivePage } from "./pages/LivePage";
import { ProfilesPage } from "./pages/ProfilesPage";
import { ReviewPage } from "./pages/ReviewPage";
import { ScreensaverPage } from "./pages/ScreensaverPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SteamPage } from "./pages/SteamPage";
import {
  MAIN_MENU_ITEM_LABELS,
  activeSkinTheme,
  topStatusIndicatorIdsForSettings,
  visibleMainMenuItems,
  isProfileShown,
  profileWorkflowFor,
  type MainMenuItemId,
  type ProfileWorkflowSettings,
  type SkinSettings,
  type TopStatusIndicatorId
} from "./state/skinSettings";
import {
  getOrCreateCommunityOwnerKey,
  loadCommunityDisplayName,
  loadCommunityRecommendationRatings,
  loadDownloadedCommunityProfiles,
  loadUploadedCommunityProfiles,
  saveCommunityDisplayName,
  saveCommunityRecommendationRatings,
  saveDownloadedCommunityProfiles,
  saveUploadedCommunityProfiles
} from "./state/communityStorage";
import { useLiveTelemetry } from "./state/useLiveTelemetry";
import { useReaData } from "./state/useReaData";

declare global {
  var __WORKFLOW_SKIN_ENABLE_TEST_LOGS__: boolean | undefined;
}

type Page = MainMenuItemId | "screensaver";
type CompletedActivityCapture = {
  activity: CompletedWorkflowActivity;
  profileId?: string;
  startLatestShotId?: string | null;
};

const POST_ACTIVITY_ROUTE_DELAY_MS = 1000;
const POST_ACTIVITY_RECAPTURE_COOLDOWN_MS = 3000;
const ACTIVE_MACHINE_STATE_POLL_MS = 500;
const SCALE_RECONNECT_COOLDOWN_MS = 30_000;
const WATER_REFILL_POPUP_DELAY_MS = 5000;
const DEVICE_DISCOVERY_SEQUENCE: readonly boolean[] = [true, false];
const CURRENT_SKIN_VERSION = typeof skinManifest.version === "string" ? skinManifest.version : "";
const SKIN_LOG_PREFIX = "[WorkFlow Skin]";

interface TopStatusIndicator {
  id: TopStatusIndicatorId;
  label: string;
  detail: string;
  connected: boolean;
}

const navById: Record<MainMenuItemId, { label: string; icon: React.ComponentType<{ className?: string; size?: number }> }> = {
  brew: { label: MAIN_MENU_ITEM_LABELS.brew, icon: Coffee },
  live: { label: MAIN_MENU_ITEM_LABELS.live, icon: Activity },
  review: { label: MAIN_MENU_ITEM_LABELS.review, icon: NotebookPen },
  steam: { label: MAIN_MENU_ITEM_LABELS.steam, icon: Flame },
  bags: { label: MAIN_MENU_ITEM_LABELS.bags, icon: PackageOpen },
  profiles: { label: MAIN_MENU_ITEM_LABELS.profiles, icon: SlidersHorizontal },
  grinders: { label: MAIN_MENU_ITEM_LABELS.grinders, icon: Gauge },
  community: { label: MAIN_MENU_ITEM_LABELS.community, icon: Users },
  history: { label: MAIN_MENU_ITEM_LABELS.history, icon: History },
  settings: { label: MAIN_MENU_ITEM_LABELS.settings, icon: Settings }
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleepFailureStatusMessage(error: unknown): string {
  const message = errorMessage(error).toLowerCase();
  if (message.includes("devicenotconnected") || message.includes("machine not connected") || message.includes("not connected")) {
    return "Screensaver is on. The machine was already disconnected, so the sleep command was skipped.";
  }
  return "Screensaver is on. The machine did not confirm sleep.";
}

function versionLabel(value: string | null | undefined): string {
  const clean = value?.trim().replace(/^v/i, "");
  return clean ? `v${clean}` : "Version unknown";
}

function dateOnlyToIsoDateTime(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00Z` : trimmed;
}

function skinLog(event: string, details: Record<string, unknown> = {}) {
  if (typeof process !== "undefined" && process.env.NODE_ENV === "test" && !globalThis.__WORKFLOW_SKIN_ENABLE_TEST_LOGS__) return;

  try {
    console.log(
      `${SKIN_LOG_PREFIX} ${JSON.stringify({
        event,
        version: CURRENT_SKIN_VERSION,
        timestamp: new Date().toISOString(),
        ...details
      })}`
    );
  } catch {
    console.log(`${SKIN_LOG_PREFIX} ${event}`);
  }
}

function compactStateName(value: string | undefined): string {
  return value?.replace(/[\s_-]/g, "").toLowerCase() ?? "";
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function waterLevelsNeedRefill(waterLevels: WaterLevels | null | undefined): boolean {
  return finiteNumber(waterLevels?.currentLevel) && finiteNumber(waterLevels?.refillLevel) && waterLevels.currentLevel <= waterLevels.refillLevel;
}

function waterRefillState(machineState: MachineState | null | undefined): boolean {
  const state = compactStateName(machineState?.state?.state);
  const substate = compactStateName(machineState?.state?.substate);
  return (
    state === "refillrequired" ||
    state === "refill" ||
    state.includes("lowwater") ||
    substate === "refillrequired" ||
    substate === "refill" ||
    substate.includes("lowwater")
  );
}

function waterRefillRequired(machineState: MachineState | null | undefined, liveWaterLevels: WaterLevels | null | undefined): boolean {
  const waterLevels = liveWaterLevels ?? machineState?.waterLevels;
  return waterLevelsNeedRefill(waterLevels) || waterRefillState(machineState);
}

function waterRefillMessage(machineState: MachineState | null | undefined, liveWaterLevels: WaterLevels | null | undefined): string {
  const waterLevels = liveWaterLevels ?? machineState?.waterLevels;
  if (finiteNumber(waterLevels?.currentLevel) && finiteNumber(waterLevels?.refillLevel)) {
    return `Water is at ${Math.round(waterLevels.currentLevel)}mm. Refill threshold is ${Math.round(waterLevels.refillLevel)}mm.`;
  }
  if (finiteNumber(waterLevels?.currentLevel)) return `Water is at ${Math.round(waterLevels.currentLevel)}mm.`;
  return "The machine is asking for a refill.";
}

function extractNumericTds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== "object") return null;
  if ("key" in value && String((value as { key?: unknown }).key).toLowerCase() === "tds") {
    const tds = extractNumericTds((value as { value?: unknown }).value);
    if (tds !== null) return tds;
  }
  if ("tds" in value) {
    const tds = extractNumericTds((value as { tds?: unknown }).tds);
    if (tds !== null) return tds;
  }
  if ("data" in value) {
    const tds = extractNumericTds((value as { data?: unknown }).data);
    if (tds !== null) return tds;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const tds = extractNumericTds(item);
      if (tds !== null) return tds;
    }
  }
  return null;
}

function extractR2Tds(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const result = (value as { result?: unknown }).result;
  if (result && typeof result === "object") {
    const tds = extractR2Tds(result);
    if (tds !== null) return tds;
  }
  const reading = (value as { reading?: unknown }).reading;
  if (reading && typeof reading === "object") {
    return extractNumericTds((reading as { tds?: unknown }).tds);
  }
  return extractNumericTds(value);
}

function replaceProfileIdInSettings(settings: SkinSettings, fromId: string, toId: string): SkinSettings {
  if (fromId === toId) return settings;

  const reviewEnabledByProfile = { ...settings.reviewEnabledByProfile };
  if (Object.prototype.hasOwnProperty.call(reviewEnabledByProfile, fromId)) {
    reviewEnabledByProfile[toId] = reviewEnabledByProfile[fromId];
    delete reviewEnabledByProfile[fromId];
  }

  const profileWorkflows = { ...settings.profileWorkflows };
  if (Object.prototype.hasOwnProperty.call(profileWorkflows, fromId)) {
    profileWorkflows[toId] = profileWorkflows[fromId];
    delete profileWorkflows[fromId];
  }

  return {
    ...settings,
    presetSlots: settings.presetSlots.map((slot) => (slot.profileId === fromId ? { ...slot, profileId: toId } : slot)),
    startupProfileId: settings.startupProfileId === fromId ? toId : settings.startupProfileId,
    shownProfileIds: Array.from(new Set(settings.shownProfileIds.map((id) => (id === fromId ? toId : id)))),
    reviewEnabledByProfile,
    profileWorkflows
  };
}

function statusPopoverTitle(status: Pick<TopStatusIndicator, "id" | "label">): string {
  if (status.id === "wifi") return "Machine IP address";
  if (status.id === "water") return "Current water level";
  return `${status.label} status`;
}

function deviceLabel(device: DeviceInfo): string {
  return `${device.type ?? ""} ${device.name ?? ""} ${device.id}`.toLowerCase();
}

function isScaleDeviceCandidate(device: DeviceInfo): boolean {
  const label = deviceLabel(device);
  return (
    device.type === "scale" ||
    label.includes("scale") ||
    label.includes("microbalance") ||
    label.includes("acaia") ||
    label.includes("hiroia") ||
    label.includes("lunar") ||
    label.includes("pearl") ||
    label.includes("felicita") ||
    label.includes("bookoo") ||
    label.includes("boo koo") ||
    label.includes("decent scale")
  );
}

function isConnectedDevice(device: DeviceInfo): boolean {
  return ["connected", "ready", "online"].includes(device.state?.trim().toLowerCase() ?? "");
}

function isMachineDeviceCandidate(device: DeviceInfo): boolean {
  const label = deviceLabel(device);
  return (
    device.type === "machine" ||
    (!isScaleDeviceCandidate(device) && !isR2Device(device) && (label.includes("machine") || label.includes("de1") || label.includes("decent espresso")))
  );
}

function hasConnectedScale(devices: DeviceInfo[]): boolean {
  return devices.some((device) => isScaleDeviceCandidate(device) && isConnectedDevice(device) && !isR2Device(device));
}

function disconnectedScaleDevices(devices: DeviceInfo[]): DeviceInfo[] {
  return devices.filter((device) => isScaleDeviceCandidate(device) && !isConnectedDevice(device) && !isR2Device(device));
}

function deviceIdSignature(devices: DeviceInfo[]): string {
  return devices
    .map((device) => device.id)
    .sort()
    .join("|");
}

function isConfiguredR2Device(device: DeviceInfo, configuredR2DeviceId: string | undefined): boolean {
  return Boolean(configuredR2DeviceId && device.id === configuredR2DeviceId);
}

function isConnectableStartupDevice(device: DeviceInfo, configuredR2DeviceId: string | undefined): boolean {
  const isScale = isScaleDeviceCandidate(device) && !isR2Device(device);
  const shouldConnectR2 = Boolean(configuredR2DeviceId && (isConfiguredR2Device(device, configuredR2DeviceId) || isR2Device(device)));
  return (isMachineDeviceCandidate(device) || isScale || shouldConnectR2) && !isConnectedDevice(device);
}

function uniqueDevices(devices: DeviceInfo[]): DeviceInfo[] {
  const byId = new Map<string, DeviceInfo>();
  for (const device of devices) {
    const current = byId.get(device.id);
    if (!current) {
      byId.set(device.id, device);
      continue;
    }
    byId.set(device.id, {
      ...current,
      ...device,
      state: isConnectedDevice(current) && !isConnectedDevice(device) ? current.state : device.state
    });
  }
  return Array.from(byId.values());
}

function isR2Device(device: DeviceInfo): boolean {
  const label = deviceLabel(device);
  return label.includes("difluid") || label.includes("r2");
}

function waitForNativeUpdate(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function findR2SensorWithRetry(api: ReaPrimeApi, fallbackSensors: SensorListItem[]): Promise<SensorListItem | null> {
  let latestSensors = fallbackSensors;
  for (const delay of [0, 450, 1200]) {
    if (delay > 0) await waitForNativeUpdate(delay);
    latestSensors = await api.listSensors().catch(() => latestSensors);
    const sensor = findDifluidR2Sensor(latestSensors);
    if (sensor) return sensor;
  }
  return findDifluidR2Sensor(latestSensors);
}

function r2MeasurementNeedsReconnect(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("flutterblueplus") ||
    normalized.includes("fbp-code") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout") ||
    normalized.includes("not connected") ||
    normalized.includes("disconnected") ||
    normalized.includes("connect failed")
  );
}

function isSleepingMachine(machineState: MachineState | null): boolean {
  return isSleepingMode(machineState?.state?.state);
}

function screensaverBrightnessValue(value: number | undefined): number {
  return Math.min(100, Math.max(0, Math.round(value ?? 8)));
}

async function wakeMachineIfNeeded(api: ReaPrimeApi, fallbackMachineState: MachineState | null): Promise<MachineState | null> {
  const latestState = await api.getMachineState().catch(() => fallbackMachineState);
  if (!isSleepingMachine(latestState)) return latestState;

  await api.wakeMachine().catch(() => undefined);

  let nextState: MachineState | null = latestState;
  for (const delay of [250, 750, 1500]) {
    await waitForNativeUpdate(delay);
    nextState = await api.getMachineState().catch(() => nextState);
    if (!isSleepingMachine(nextState)) return nextState;
  }

  return nextState;
}

function autoSleepCheckIntervalMs(idleLimitMs: number): number {
  return Math.min(30_000, Math.max(1_000, Math.floor(idleLimitMs / 4)));
}

function latestMachineSnapshot(measurements: ShotSnapshot[]): ShotSnapshot["machine"] | undefined {
  return measurements.length > 0 ? measurements[measurements.length - 1]?.machine : undefined;
}

function shotWithFallbackMeasurements(shot: ShotRecord, fallbackMeasurements: ShotSnapshot[]): ShotRecord {
  const trimmedFallbackMeasurements = trimLiveGraphWarmup(fallbackMeasurements);
  if ((shot.measurements?.length ?? 0) > 0 || trimmedFallbackMeasurements.length === 0) return shot;
  return { ...shot, measurements: trimmedFallbackMeasurements };
}

function mergeReviewShot(cachedShot: ShotRecord | null, refreshedShot: ShotRecord | undefined): ShotRecord | null {
  if (!cachedShot) return refreshedShot ?? null;
  if (!refreshedShot) return cachedShot;

  const cachedMeasurements = cachedShot.measurements ?? [];
  const refreshedMeasurements = refreshedShot.measurements ?? [];
  const preferRefreshed = refreshedMeasurements.length >= cachedMeasurements.length && (refreshedMeasurements.length > 0 || cachedMeasurements.length === 0);
  const primaryShot = preferRefreshed ? refreshedShot : cachedShot;
  const secondaryShot = preferRefreshed ? cachedShot : refreshedShot;
  return {
    ...secondaryShot,
    ...primaryShot,
    annotations: preferRefreshed
      ? { ...cachedShot.annotations, ...refreshedShot.annotations }
      : { ...refreshedShot.annotations, ...cachedShot.annotations },
    measurements: preferRefreshed ? refreshedMeasurements : cachedMeasurements
  };
}

function isBurrType(value: unknown): value is BurrType {
  return value === "flat" || value === "conical";
}

function positiveNumber(value: number | null | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function draftNumber(value: number | null | undefined): string {
  const positive = positiveNumber(value);
  return positive === undefined ? "" : String(Math.round(positive * 100) / 100);
}

function contextWorkflowSkinGrindSize(shot: ShotRecord): string | undefined {
  const workflowSkin = shot.workflow.context?.extras?.workflowSkin;
  if (!workflowSkin || typeof workflowSkin !== "object" || Array.isArray(workflowSkin)) return undefined;
  const grindSize = (workflowSkin as { grindSize?: unknown }).grindSize;
  return typeof grindSize === "string" && grindSize.trim() ? grindSize.trim() : undefined;
}

function workflowSkinExtraString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

function shotWorkflowSkinGrinderId(shot: ShotRecord): string | undefined {
  return (
    workflowSkinExtraString(shot.annotations?.extras?.workflowSkin, "grinderId") ??
    workflowSkinExtraString(shot.workflow.context?.extras?.workflowSkin, "grinderId")
  );
}

function selectedGrinderIdForCommunityDraft(shot: ShotRecord, settings: SkinSettings, grinders: Grinder[]): string {
  const grinderIds = new Set(grinders.map((grinder) => grinder.id));
  const candidates = [shotWorkflowSkinGrinderId(shot), settings.defaultGrinderId, settings.lastGrinderId, shot.workflow.context?.grinderId];
  return candidates.find((id) => Boolean(id) && (grinderIds.size === 0 || grinderIds.has(id as string))) ?? "";
}

function communityUploadDraftFromShot(shot: ShotRecord, profiles: ProfileRecord[], settings: SkinSettings, grinders: Grinder[]): UploadDraft {
  const context = shot.workflow.context;
  const stats = shotStats(shot);
  const seconds = positiveNumber(stats.durationSeconds);
  const dose = positiveNumber(shot.annotations?.actualDoseWeight) ?? positiveNumber(context?.targetDoseWeight);
  const drinkWeight = positiveNumber(shot.annotations?.actualYield) ?? positiveNumber(stats.finalYield) ?? positiveNumber(context?.targetYield) ?? positiveNumber(shot.workflow.profile?.target_weight);
  const notes = (shot.annotations?.espressoNotes ?? shot.shotNotes ?? "").trim();
  return {
    bagId: context?.beanBatchId ?? "",
    profileId: selectedProfileIdFromWorkflow(shot.workflow, profiles) ?? "",
    grinderId: selectedGrinderIdForCommunityDraft(shot, settings, grinders),
    grindSetting: grindSizeFromShot(shot) ?? contextWorkflowSkinGrindSize(shot) ?? "",
    beansWeight: draftNumber(dose),
    drinkWeight: draftNumber(drinkWeight),
    secondsMin: draftNumber(seconds),
    secondsMax: draftNumber(seconds),
    notes,
    rating: "5",
    visualizerUrl: "",
    shotId: shot.id
  };
}

function workflowForSelectedProfile(workflow: Workflow, profile: ProfileRecord): Workflow {
  const extras = workflow.context?.extras ?? {};
  const workflowSkin = extras.workflowSkin && typeof extras.workflowSkin === "object" && !Array.isArray(extras.workflowSkin) ? extras.workflowSkin : {};
  return {
    profile: profile.profile,
    context: {
      ...workflow.context,
      extras: {
        ...extras,
        workflowSkin: {
          ...workflowSkin,
          selectedProfileId: profile.id
        }
      }
    }
  };
}

function formatTopNumber(value: number | null | undefined, unit: string): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}${unit}` : "—";
}

function buildTopStatusIndicators({
  statuses,
  indicatorIds,
  machineState,
  liveMeasurements
}: {
  statuses: ConnectivityStatus[];
  indicatorIds: TopStatusIndicatorId[];
  machineState: MachineState | null;
  liveMeasurements: ShotSnapshot[];
}): TopStatusIndicator[] {
  const liveMachine = latestMachineSnapshot(liveMeasurements);
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const all: Record<TopStatusIndicatorId, TopStatusIndicator | null> = {
    machine: statusById.get("machine") ?? null,
    wifi: statusById.get("wifi") ?? null,
    scale: statusById.get("scale") ?? null,
    water: statusById.get("water") ?? null,
    r2: statusById.get("r2") ?? null,
    state: { id: "state", label: "State", detail: machineModeLabel(machineState, liveMachine), connected: machineState?.connected !== false },
    temperature: { id: "temperature", label: "Temp", detail: formatTopNumber(machineTemperature(machineState, liveMachine), "°C"), connected: true },
    pressure: { id: "pressure", label: "Bar", detail: formatTopNumber(liveMachine?.pressure ?? machineState?.pressure, " bar"), connected: true },
    flow: { id: "flow", label: "Flow", detail: formatTopNumber(liveMachine?.flow ?? machineState?.flow, " g/s"), connected: true }
  };

  return indicatorIds.map((id) => all[id]).filter((indicator): indicator is TopStatusIndicator => Boolean(indicator));
}

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentFullscreenElement(): Element | null {
  const fullscreenDocument = document as FullscreenDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
}

function requestAppFullscreen(): Promise<void> {
  const element = document.documentElement as FullscreenElement;
  if (element.requestFullscreen) return element.requestFullscreen();
  if (element.webkitRequestFullscreen) return Promise.resolve(element.webkitRequestFullscreen());
  return Promise.reject(new Error("Fullscreen is not supported on this device."));
}

function exitAppFullscreen(): Promise<void> {
  const fullscreenDocument = document as FullscreenDocument;
  if (document.exitFullscreen) return document.exitFullscreen();
  if (fullscreenDocument.webkitExitFullscreen) return Promise.resolve(fullscreenDocument.webkitExitFullscreen());
  return Promise.reject(new Error("Fullscreen is not supported on this device."));
}

function TopStatusBar({
  indicators,
  expandedStatusId,
  machineSummary,
  onStatusPress,
  children
}: {
  indicators: TopStatusIndicator[];
  expandedStatusId: TopStatusIndicatorId | null;
  machineSummary: string;
  onStatusPress: (status: TopStatusIndicator) => void;
  children: ReactNode;
}) {
  const expandedStatus = indicators.find((status) => status.id === expandedStatusId);

  return (
    <header className="top-status-bar" aria-label="Machine status bar">
      <div className="top-status-indicators" aria-label="Machine indicators">
        {indicators.map((status) => (
          <button
            type="button"
            className="top-status-chip"
            key={status.id}
            title={`${status.label}: ${status.detail}`}
            aria-label={status.label}
            aria-expanded={expandedStatusId === status.id}
            onClick={() => onStatusPress(status)}
          >
            <span className={status.connected ? "status-dot connected" : "status-dot disconnected"} aria-hidden="true" />
            <span>{status.label}</span>
          </button>
        ))}
        {expandedStatus && (
          <div className="top-status-popover status-popover" role="status">
            <span>{statusPopoverTitle(expandedStatus)}</span>
            <strong>{expandedStatus.detail}</strong>
          </div>
        )}
      </div>
      <div className="top-machine-status" aria-label="Machine current status">
        <span>Machine</span>
        <strong>{machineSummary}</strong>
      </div>
      <div className="top-status-actions">{children}</div>
    </header>
  );
}

function WaterRefillOverlay({ detail, onConfirm }: { detail: string; onConfirm: () => void }) {
  return (
    <div className="water-refill-overlay" role="dialog" aria-modal="true" aria-label="Water refill needed">
      <div className="water-refill-card">
        <img className="water-refill-image" src="/water-refill.svg" alt="Water pitcher filling the tank" />
        <div className="water-refill-copy">
          <p className="water-refill-kicker">Water level warning</p>
          <h2>Hi, I’m getting dry over here… Top me up would ya’?</h2>
          <p>{detail}</p>
        </div>
        <button type="button" className="primary-button water-refill-button" onClick={onConfirm}>
          OK
        </button>
      </div>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>("brew");
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [sleepPending, setSleepPending] = useState(false);
  const [expandedStatusId, setExpandedStatusId] = useState<TopStatusIndicatorId | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [lastUseAt, setLastUseAt] = useState(() => Date.now());
  const [startupApplyTick, setStartupApplyTick] = useState(0);
  const [startupProfileHoldId, setStartupProfileHoldId] = useState<string | null>(null);
  const [r2RefreshBusy, setR2RefreshBusy] = useState(false);
  const [lastCompletedProfileId, setLastCompletedProfileId] = useState<string | undefined>();
  const [fastMachineState, setFastMachineState] = useState<MachineState | null>(null);
  const [waterRefillAcknowledged, setWaterRefillAcknowledged] = useState(false);
  const [waterRefillVisible, setWaterRefillVisible] = useState(false);
  const [completedReviewShot, setCompletedReviewShot] = useState<ShotRecord | null>(null);
  const [communityRecommendations, setCommunityRecommendations] = useState<CommunityRecommendation[]>([]);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityDisplayName, setCommunityDisplayName] = useState("");
  const [communityUserRatings, setCommunityUserRatings] = useState<Record<string, number>>({});
  const [downloadedCommunityProfiles, setDownloadedCommunityProfiles] = useState<DownloadedCommunityProfile[]>([]);
  const [uploadedCommunityProfiles, setUploadedCommunityProfiles] = useState<UploadedCommunityProfile[]>([]);
  const [decentAccount, setDecentAccount] = useState<DecentAccountStatus | null>(null);
  const [communityInitialDraft, setCommunityInitialDraft] = useState<Partial<UploadDraft> | null>(null);
  const startupProfileApplyRef = useRef<{ profileId: string | null; attempts: number; pending: boolean; complete: boolean }>({
    profileId: null,
    attempts: 0,
    pending: false,
    complete: false
  });
  const manualProfileSelectionRef = useRef<{ version: number; profileId: string | null }>({ version: 0, profileId: null });
  const startupConnectRef = useRef(false);
  const startupRecoveryRef = useRef<Promise<void> | null>(null);
  const knownLatestShotIdRef = useRef<string | null | undefined>(undefined);
  const idleLatestShotIdRef = useRef<string | null | undefined>(undefined);
  const autoReadR2ShotIdRef = useRef<string | null>(null);
  const [autoReadR2ShotId, setAutoReadR2ShotId] = useState<string | null>(null);
  const sleepMachineRef = useRef<(() => Promise<void>) | null>(null);
  const lastUseAtRef = useRef(lastUseAt);
  const lastUseStateAtRef = useRef(lastUseAt);
  const autoSleepPendingRef = useRef(false);
  const completedActivityRef = useRef<CompletedActivityCapture | null>(null);
  const completedActivityRoutingRef = useRef(false);
  const completedActivityTimerRef = useRef<number | null>(null);
  const ignoreActiveActivityUntilAtRef = useRef(0);
  const readyLogRef = useRef(false);
  const lastLoggedPageRef = useRef<Page | null>(null);
  const lastLoggedMachineModeRef = useRef<string | null>(null);
  const wasSleepingRef = useRef<boolean | null>(null);
  const wakeScreenStartupResetUntilRef = useRef(0);
  const scaleReconnectRef = useRef<{ signature: string | null; lastAttemptAt: number; pending: boolean }>({
    signature: null,
    lastAttemptAt: 0,
    pending: false
  });
  const api = useMemo(() => new ReaPrimeApi(), []);
  const data = useReaData(api);
  const communityApi = useMemo(() => new CommunityApi(data.settings.communityApiBaseUrl), [data.settings.communityApiBaseUrl]);
  const liveTelemetry = useLiveTelemetry(undefined, { recordIdle: page === "live" });
  const latestShot = data.shots[0] ?? null;
  const nativeDevices = data.devices ?? [];
  const detectedR2Sensor = findDifluidR2Sensor(data.sensors);
  const configuredR2Sensor = data.settings.r2SensorId ? data.sensors.find((sensor) => sensor.id === data.settings.r2SensorId) ?? null : null;
  const r2Sensor = configuredR2Sensor ?? detectedR2Sensor;
  const connectedR2Device = nativeDevices.find(
    (device) => (isConfiguredR2Device(device, data.settings.r2SensorId) || isR2Device(device)) && isConnectedDevice(device)
  );
  const r2DeviceConnected = Boolean(connectedR2Device);
  const r2Available = Boolean(r2Sensor || data.settings.r2SensorId || connectedR2Device);
  const workflowSelectedProfileId = selectedProfileIdFromWorkflow(data.workflow, data.profiles);
  const selectedProfileId = startupProfileHoldId ?? workflowSelectedProfileId;
  const heldStartupProfile = startupProfileHoldId ? data.profiles.find((profile) => profile.id === startupProfileHoldId) : undefined;
  const displayWorkflow = heldStartupProfile ? workflowForSelectedProfile(data.workflow, heldStartupProfile) : data.workflow;
  const workflowPageProfileId = selectedProfileId ?? (page === "steam" || page === "review" ? lastCompletedProfileId : undefined);
  const activeProfile = data.profiles.find((profile) => profile.id === workflowPageProfileId);
  const refreshedCompletedReviewShot = completedReviewShot ? data.shots.find((shot) => shot.id === completedReviewShot.id) : undefined;
  const reviewShot = completedReviewShot ? mergeReviewShot(completedReviewShot, refreshedCompletedReviewShot) : latestShot;
  const activeProfileWorkflow = profileWorkflowFor(data.settings, workflowPageProfileId);
  const visualizerPlugin = data.plugins?.find((plugin) => plugin.id === "visualizer.reaplugin") ?? null;
  const topLiveMachine = latestMachineSnapshot(liveTelemetry.measurements);
  const liveMachineState = topLiveMachine?.state ?? liveTelemetry.machineMode;
  const machineStateForStatus: MachineState | null = fastMachineState
    ? ({ ...(data.machineState ?? {}), ...fastMachineState, waterLevels: fastMachineState.waterLevels ?? data.machineState?.waterLevels } as MachineState)
    : data.machineState ?? (liveMachineState ? { connected: true, state: liveMachineState } : null);
  const shownProfiles = useMemo(
    () => data.profiles.filter((profile) => isProfileShown(data.settings, profile.id)),
    [data.profiles, data.settings.shownProfileIds]
  );
  const presetPickerProfiles = useMemo(() => {
    if (editingSlotIndex === null) return shownProfiles;
    const assignedProfileIds = new Set(
      data.settings.presetSlots
        .map((slot, index) => (index === editingSlotIndex ? undefined : slot.profileId))
        .filter((profileId): profileId is string => Boolean(profileId))
    );
    return shownProfiles.filter((profile) => !assignedProfileIds.has(profile.id));
  }, [data.settings.presetSlots, editingSlotIndex, shownProfiles]);
  const machineConnected = Boolean(machineStateForStatus && machineStateForStatus.connected !== false);
  const machineStateForWater: MachineState | null = fastMachineState
    ? ({ ...(data.machineState ?? {}), ...fastMachineState, waterLevels: fastMachineState.waterLevels ?? data.machineState?.waterLevels } as MachineState)
    : data.machineState;
  const currentMachineMode = fastMachineState?.state?.state ?? liveTelemetry.machineMode?.state ?? data.machineState?.state?.state;
  const waterLow = waterRefillRequired(machineStateForWater, liveTelemetry.waterLevels);
  const waterLowDetail = waterRefillMessage(machineStateForWater, liveTelemetry.waterLevels);
  const machineSleeping = isSleepingMode(currentMachineMode) || isSleepingMachine(data.machineState);
  const brewingCoffee = isBrewingMode(currentMachineMode);
  const holdingCompletedBrewOnLivePage = page === "live" && !brewingCoffee && completedActivityRef.current?.activity === "brew";
  const showLivePage = page === "live" && (brewingCoffee || holdingCompletedBrewOnLivePage);
  const steamingMilk = isSteamingMode(currentMachineMode);
  const statuses = useMemo(
    () =>
      buildConnectivityStatuses({
        apiHost: new URL(apiBaseUrl()).hostname,
        appInfo: data.appInfo,
        machineState: machineStateForStatus,
        sensors: data.sensors,
        devices: nativeDevices,
        scaleConnected: liveTelemetry.scaleConnected,
        waterLevels: liveTelemetry.waterLevels,
        r2SensorId: data.settings.r2SensorId,
        r2Sensor,
        r2Connected: r2DeviceConnected
      }),
    [nativeDevices, machineStateForStatus, data.sensors, data.settings.r2SensorId, liveTelemetry.scaleConnected, liveTelemetry.waterLevels, r2DeviceConnected, r2Sensor]
  );
  const visibleMenuIds = useMemo(
    () => visibleMainMenuItems(data.settings).filter((itemId) => itemId !== "live" || brewingCoffee || holdingCompletedBrewOnLivePage),
    [brewingCoffee, data.settings.mainMenuItems, data.settings.hiddenMainMenuItemIds, holdingCompletedBrewOnLivePage]
  );
  const menuSkinVersion = CURRENT_SKIN_VERSION;
  const topStatusIndicators = useMemo(
    () =>
      buildTopStatusIndicators({
        statuses,
        indicatorIds: topStatusIndicatorIdsForSettings(data.settings),
        machineState: machineStateForStatus,
        liveMeasurements: liveTelemetry.measurements
      }),
    [statuses, data.settings.topStatusIndicatorIds, machineStateForStatus, liveTelemetry.measurements]
  );
  const topMachineStatus = machineModeLabel(machineStateForStatus, topLiveMachine);
  const topMachineTemperature = machineTemperature(machineStateForStatus, topLiveMachine);
  const topMachineSummary = `${topMachineStatus}${topMachineTemperature === null ? "" : ` · ${topMachineTemperature.toFixed(1)}°C`}`;

  const refreshCommunity = useCallback(async () => {
    setCommunityLoading(true);
    try {
      const [index, account, displayName, downloaded, uploaded, userRatings] = await Promise.all([
        communityApi.listRecommendations(),
        api.getDecentAccount().catch(() => null),
        loadCommunityDisplayName(api),
        loadDownloadedCommunityProfiles(api),
        loadUploadedCommunityProfiles(api),
        loadCommunityRecommendationRatings(api)
      ]);
      setCommunityRecommendations(index.items);
      setDecentAccount(account);
      setCommunityDisplayName(displayName ?? "");
      setDownloadedCommunityProfiles(downloaded);
      setUploadedCommunityProfiles(uploaded);
      setCommunityUserRatings(userRatings);
      setCommunityError(null);
    } catch (error) {
      setCommunityError(error instanceof Error ? error.message : String(error));
    } finally {
      setCommunityLoading(false);
    }
  }, [api, communityApi]);

  useEffect(() => {
    if (page === "community") void refreshCommunity();
  }, [page, refreshCommunity]);

  const downloadCommunityProfile = useCallback(
    async (recommendation: CommunityRecommendation) => {
      const downloadedBefore = await loadDownloadedCommunityProfiles(api);
      const payload = await communityApi.download(recommendation.id);
      const existing = downloadedBefore.find((item) => item.recommendationId === recommendation.id);
      const installPayload = profilePayloadForCommunityInstall(payload.recommendation, payload.profileJson);
      const savedProfile = existing ? await api.updateProfile(existing.localProfileId, installPayload) : await api.createProfile(installPayload);
      const record: DownloadedCommunityProfile = {
        recommendationId: recommendation.id,
        localProfileId: savedProfile.id,
        localProfileTitle: savedProfile.profile.title ?? payload.recommendation.profile.installedTitle,
        downloadedAt: existing?.downloadedAt ?? new Date().toISOString(),
        updatedAt: payload.recommendation.updatedAt,
        recommendation: payload.recommendation,
        evidence: payload.evidence
      };
      const downloadedAfter = await loadDownloadedCommunityProfiles(api);
      const next = [record, ...downloadedAfter.filter((item) => item.recommendationId !== recommendation.id)];
      await saveDownloadedCommunityProfiles(api, next);
      setDownloadedCommunityProfiles(next);
      await data.refresh();
    },
    [api, communityApi, data]
  );

  const loadCommunityRecommendationDetails = useCallback(
    async (recommendation: CommunityRecommendation) => {
      return communityApi.download(recommendation.id);
    },
    [communityApi]
  );

  const rateCommunityRecommendation = useCallback(
    async (recommendation: CommunityRecommendation, rating: number) => {
      const ownerKey = await getOrCreateCommunityOwnerKey(api);
      const result = await communityApi.rate(recommendation.id, { ownerKey, rating });
      const storedRatings = await loadCommunityRecommendationRatings(api);
      const nextRatings = { ...storedRatings, [recommendation.id]: rating };
      await saveCommunityRecommendationRatings(api, nextRatings);
      setCommunityUserRatings(nextRatings);
      setCommunityRecommendations(result.index.items);
      setDownloadedCommunityProfiles((current) =>
        current.map((item) =>
          item.recommendationId === recommendation.id
            ? {
                ...item,
                updatedAt: result.recommendation.updatedAt,
                recommendation: result.recommendation
              }
            : item
        )
      );
      setUploadedCommunityProfiles((current) =>
        current.map((item) =>
          item.recommendationId === recommendation.id
            ? {
                ...item,
                updatedAt: result.recommendation.updatedAt,
                recommendation: result.recommendation
              }
            : item
        )
      );
    },
    [api, communityApi]
  );

  const uploadCommunityProfile = useCallback(
    async (draft: UploadDraft) => {
      const bag = data.bags.find((item) => item.id === draft.bagId);
      const profile = data.profiles.find((item) => item.id === draft.profileId);
      const grinder = data.grinders.find((item) => item.id === draft.grinderId);
      const accountName = publicNameFromDecentAccount(decentAccount);
      const submittedBy = accountName ?? communityDisplayName.trim();
      if (!bag || !profile || !grinder || !submittedBy) throw new Error("Community upload is missing required local records.");
      if (!isBurrType(grinder.burrType)) throw new Error("Selected grinder is missing Burrs Type.");
      if (!accountName) await saveCommunityDisplayName(api, submittedBy);
      const ownerKey = await getOrCreateCommunityOwnerKey(api);
      const selectedShot = draft.shotId
        ? await api.getShot(draft.shotId).catch(() => data.shots.find((shot) => shot.id === draft.shotId))
        : undefined;
      const evidence = selectedShot ? sanitizeShotEvidence(selectedShot) : undefined;
      const result = await communityApi.create({
        ownerKey,
        recommendation: {
          submittedBy,
          bag: {
            id: bag.id,
            beanId: bag.beanId,
            roaster: bag.roaster ?? "",
            name: bag.name,
            bean: bag.bean ?? "",
            country: bag.country ?? "",
            region: bag.region,
            process: bag.process ?? "",
            roastDate: bag.roastDate ?? "",
            roastLevel: bag.roastLevel,
            notes: bag.notes
          },
          profile: {
            originalId: profile.id,
            originalTitle: profile.profile.title ?? profile.id,
            fileName: "pending.json",
            installedTitle: profile.profile.title ?? profile.id
          },
          grinder: {
            id: grinder.id,
            model: grinder.model,
            burrType: grinder.burrType,
            burrs: grinder.burrs,
            settingType: grinder.settingType,
            notes: grinder.notes
          },
          rating: Number(draft.rating),
          brew: {
            grindSetting: draft.grindSetting.trim(),
            beansWeight: Number(draft.beansWeight),
            drinkWeight: Number(draft.drinkWeight),
            secondsMin: Number(draft.secondsMin),
            secondsMax: Number(draft.secondsMax),
            notes: draft.notes.trim()
          },
          visualizerUrl: draft.visualizerUrl.trim() || undefined
        },
        profileJson: profile.profile,
        evidence
      });
      const record: UploadedCommunityProfile = {
        recommendationId: result.recommendation.id,
        uploadedAt: new Date().toISOString(),
        updatedAt: result.recommendation.updatedAt,
        recommendation: result.recommendation,
        evidence
      };
      const uploadedAfter = await loadUploadedCommunityProfiles(api);
      const next = [record, ...uploadedAfter.filter((item) => item.recommendationId !== record.recommendationId)];
      await saveUploadedCommunityProfiles(api, next);
      setUploadedCommunityProfiles(next);
      setCommunityRecommendations(result.index.items);
    },
    [api, communityApi, communityDisplayName, data.bags, data.grinders, data.profiles, data.shots, decentAccount]
  );

  const editCommunityUpload = useCallback(
    async (recommendation: CommunityRecommendation, draft: UploadDraft) => {
      const ownerKey = await getOrCreateCommunityOwnerKey(api);
      const latestUploads = await loadUploadedCommunityProfiles(api);
      const localUpload =
        latestUploads.find((item) => item.recommendationId === recommendation.id) ?? uploadedCommunityProfiles.find((item) => item.recommendationId === recommendation.id);
      if (!localUpload) throw new Error("This recommendation is not owned by this machine.");

      const bag = data.bags.find((item) => item.id === draft.bagId);
      const profile = data.profiles.find((item) => item.id === draft.profileId);
      const grinder = data.grinders.find((item) => item.id === draft.grinderId);
      if (!bag || !profile || !grinder) throw new Error("Updated recommendation is missing required local records.");
      if (!isBurrType(grinder.burrType)) throw new Error("Selected grinder is missing Burrs Type.");

      const selectedShot = draft.shotId
        ? await api.getShot(draft.shotId).catch(() => data.shots.find((shot) => shot.id === draft.shotId))
        : undefined;
      const refreshedEvidence = selectedShot ? sanitizeShotEvidence(selectedShot) : undefined;
      const result = await communityApi.update(recommendation.id, {
        ownerKey,
        recommendation: {
          submittedBy: recommendation.submittedBy,
          bag: {
            id: bag.id,
            beanId: bag.beanId,
            roaster: bag.roaster ?? "",
            name: bag.name,
            bean: bag.bean ?? "",
            country: bag.country ?? "",
            region: bag.region,
            process: bag.process ?? "",
            roastDate: bag.roastDate ?? "",
            roastLevel: bag.roastLevel,
            notes: bag.notes
          },
          profile: {
            originalId: profile.id,
            originalTitle: profile.profile.title ?? profile.id,
            fileName: recommendation.profile.fileName,
            installedTitle: recommendation.profile.installedTitle || profile.profile.title || profile.id
          },
          grinder: {
            id: grinder.id,
            model: grinder.model,
            burrType: grinder.burrType,
            burrs: grinder.burrs,
            settingType: grinder.settingType,
            notes: grinder.notes
          },
          rating: Number(draft.rating),
          brew: {
            grindSetting: draft.grindSetting.trim(),
            beansWeight: Number(draft.beansWeight),
            drinkWeight: Number(draft.drinkWeight),
            secondsMin: Number(draft.secondsMin),
            secondsMax: Number(draft.secondsMax),
            notes: draft.notes.trim()
          },
          visualizerUrl: draft.visualizerUrl.trim() || undefined
        },
        profileJson: profile.profile,
        evidence: refreshedEvidence
      });
      const sourceUploads = [localUpload, ...latestUploads.filter((item) => item.recommendationId !== recommendation.id)];
      const next = sourceUploads.map((item) =>
        item.recommendationId === recommendation.id
          ? { ...item, updatedAt: result.recommendation.updatedAt, recommendation: result.recommendation, evidence: refreshedEvidence }
          : item
      );
      await saveUploadedCommunityProfiles(api, next);
      setUploadedCommunityProfiles(next);
      setCommunityRecommendations(result.index.items);
    },
    [api, communityApi, data.bags, data.grinders, data.profiles, data.shots, uploadedCommunityProfiles]
  );

  const deleteCommunityUpload = useCallback(
    async (recommendation: CommunityRecommendation) => {
      const ownerKey = await getOrCreateCommunityOwnerKey(api);
      const latestUploads = await loadUploadedCommunityProfiles(api);
      const localUpload =
        latestUploads.find((item) => item.recommendationId === recommendation.id) ?? uploadedCommunityProfiles.find((item) => item.recommendationId === recommendation.id);
      if (!localUpload) throw new Error("This recommendation is not owned by this machine.");

      const result = await communityApi.delete(recommendation.id, { ownerKey });
      const next = latestUploads.filter((item) => item.recommendationId !== recommendation.id);
      await saveUploadedCommunityProfiles(api, next);
      setUploadedCommunityProfiles(next);
      setCommunityRecommendations(result.index.items);
    },
    [api, communityApi, uploadedCommunityProfiles]
  );

  const recommendHistoryShot = (shot: ShotRecord) => {
    setStatus(null);
    setCommunityInitialDraft(communityUploadDraftFromShot(shot, data.profiles, data.settings, data.grinders));
    setPage("community");
  };

  const clearCommunityInitialDraft = useCallback(() => {
    setCommunityInitialDraft(null);
  }, []);

  const reapplyManualProfileSelection = useCallback(async () => {
    const manualProfileId = manualProfileSelectionRef.current.profileId;
    if (!manualProfileId) return;

    const manualProfile = data.profiles.find((profile) => profile.id === manualProfileId);
    if (!manualProfile) return;

    setStartupProfileHoldId(null);
    const nextWorkflow = workflowForSelectedProfile(data.workflow, manualProfile);
    const updatedWorkflow = await api.updateWorkflow(nextWorkflow);
    data.setWorkflow(updatedWorkflow);
  }, [api, data.profiles, data.workflow, data.setWorkflow]);

  const applyProfile = async (
    profile: ProfileRecord,
    options: { optimistic?: boolean; commitIf?: () => boolean; onDiscardedUpdate?: () => Promise<void> | void } = {}
  ) => {
    const nextWorkflow = workflowForSelectedProfile(data.workflow, profile);
    const previousWorkflow = data.workflow;
    if (options.optimistic) data.setWorkflow(nextWorkflow);

    try {
      const updatedWorkflow = await api.updateWorkflow(nextWorkflow);
      if (options.commitIf && !options.commitIf()) {
        await options.onDiscardedUpdate?.();
        return;
      }
      data.setWorkflow(updatedWorkflow);
    } catch (error) {
      if (options.optimistic) data.setWorkflow(previousWorkflow);
      throw error;
    }
  };

  const resetStartupProfileApply = useCallback(() => {
    const startupProfileId = data.settings.startupProfileId;
    if (!startupProfileId) {
      setStartupProfileHoldId(null);
      return;
    }
    startupProfileApplyRef.current = { profileId: startupProfileId, attempts: 0, pending: false, complete: false };
    setStartupProfileHoldId(startupProfileId);
    setStartupApplyTick((tick) => tick + 1);
  }, [data.settings.startupProfileId]);

  const connectConfiguredStartupDevices = useCallback(async () => {
    const attemptedDeviceIds = new Set<string>();
    const connectStartupDevices = async (quick: boolean) => {
      const scannedDevices = await api.scanDevices({ connect: true, quick }).catch(() => [] as DeviceInfo[]);
      const listedDevices = await api.listDevices().catch(() => data.devices ?? []);
      const devices = uniqueDevices([...scannedDevices, ...listedDevices]);

      for (const device of devices.filter((item) => isConnectableStartupDevice(item, data.settings.r2SensorId))) {
        if (attemptedDeviceIds.has(device.id)) continue;
        attemptedDeviceIds.add(device.id);
        await api.connectDevice(device.id).catch(() => undefined);
      }
    };

    for (const quick of DEVICE_DISCOVERY_SEQUENCE) {
      await connectStartupDevices(quick);
    }
  }, [api, data.devices, data.settings.r2SensorId]);

  const runStartupRecovery = useCallback(
    (options: { resetStartupProfile?: boolean; manualSelectionVersion?: number } = {}) => {
      if (startupRecoveryRef.current) return startupRecoveryRef.current;
      const manualSelectionVersion = options.manualSelectionVersion ?? manualProfileSelectionRef.current.version;

      let recovery: Promise<void>;
      recovery = (async () => {
        await data.refresh();
        await connectConfiguredStartupDevices();
        await data.refresh();
        if (options.resetStartupProfile !== false && manualProfileSelectionRef.current.version === manualSelectionVersion) {
          resetStartupProfileApply();
        }
        window.setTimeout(() => {
          void data.refresh();
        }, 1500);
      })().finally(() => {
        if (startupRecoveryRef.current === recovery) startupRecoveryRef.current = null;
      });

      startupRecoveryRef.current = recovery;
      return recovery;
    },
    [connectConfiguredStartupDevices, data.refresh, resetStartupProfileApply]
  );

  useEffect(() => {
    const startupProfileId = data.settings.startupProfileId;
    if (!data.loaded || !startupProfileId) {
      startupProfileApplyRef.current = { profileId: null, attempts: 0, pending: false, complete: false };
      setStartupProfileHoldId(null);
      return;
    }

    if (startupProfileApplyRef.current.profileId !== startupProfileId) {
      startupProfileApplyRef.current = { profileId: startupProfileId, attempts: 0, pending: false, complete: false };
    }

    if (machineSleeping) return;

    if (startupProfileApplyRef.current.complete) return;

    if (workflowSelectedProfileId === startupProfileId) {
      startupProfileApplyRef.current.pending = false;
      startupProfileApplyRef.current.complete = true;
      if (Date.now() > wakeScreenStartupResetUntilRef.current) {
        setStartupProfileHoldId((current) => (current === startupProfileId ? null : current));
      }
      return;
    }

    if (startupProfileApplyRef.current.pending) return;
    if (startupProfileApplyRef.current.attempts >= 3) {
      startupProfileApplyRef.current.complete = true;
      setStartupProfileHoldId((current) => (current === startupProfileId ? null : current));
      return;
    }

    const startupProfile = data.profiles.find((profile) => profile.id === startupProfileId);
    if (!startupProfile) return;

    const selectionVersion = manualProfileSelectionRef.current.version;
    startupProfileApplyRef.current.attempts += 1;
    startupProfileApplyRef.current.pending = true;
    applyProfile(startupProfile, {
      optimistic: true,
      commitIf: () => manualProfileSelectionRef.current.version === selectionVersion,
      onDiscardedUpdate: reapplyManualProfileSelection
    })
      .catch((error) => {
        setStartupProfileHoldId((current) => (current === startupProfileId ? null : current));
        setStatus({ type: "error", message: `Could not apply startup profile: ${errorMessage(error)}` });
      })
      .finally(() => {
        startupProfileApplyRef.current.pending = false;
        setStartupApplyTick((tick) => tick + 1);
      });
  }, [data.loaded, data.settings.startupProfileId, data.profiles, machineSleeping, workflowSelectedProfileId, startupApplyTick, reapplyManualProfileSelection]);

  useEffect(() => {
    if (startupConnectRef.current || !data.loaded || machineSleeping) return;
    startupConnectRef.current = true;

    void runStartupRecovery();
  }, [data.loaded, machineSleeping, runStartupRecovery]);

  useEffect(() => {
    if (!data.loaded || page === "screensaver") return;

    const request = data.settings.keepScreenAwake !== false ? api.requestWakeLock() : api.releaseWakeLock();
    request.catch(() => {
      // Optional tablet display APIs are absent on some ReaPrime builds/platforms.
    });
  }, [api, data.loaded, data.settings.keepScreenAwake, page]);

  useEffect(() => {
    if (!data.loaded || readyLogRef.current) return;
    const machineMode = currentMachineMode ?? "unknown";
    readyLogRef.current = true;
    lastLoggedPageRef.current = page;
    lastLoggedMachineModeRef.current = machineMode;
    skinLog("skin_ready", { page, machineMode });
  }, [currentMachineMode, data.loaded, page]);

  useEffect(() => {
    if (!data.loaded || !readyLogRef.current || lastLoggedPageRef.current === page) return;
    lastLoggedPageRef.current = page;
    skinLog("page_changed", { page });
  }, [data.loaded, page]);

  useEffect(() => {
    if (!data.loaded || !readyLogRef.current) return;
    const machineMode = currentMachineMode ?? "unknown";
    if (lastLoggedMachineModeRef.current === machineMode) return;
    lastLoggedMachineModeRef.current = machineMode;
    skinLog("machine_mode_changed", { machineMode, page });
  }, [currentMachineMode, data.loaded, page]);

  useEffect(() => {
    if (!data.loaded || page === "live" || page === "screensaver") return;
    if (brewingCoffee) setPage("live");
  }, [brewingCoffee, data.loaded, page]);

  useEffect(() => {
    if (!data.loaded || page !== "live" || brewingCoffee) return;
    if (completedActivityRef.current?.activity === "brew" || completedActivityRoutingRef.current || completedActivityTimerRef.current !== null) return;
    if (latestShot) {
      const fallbackReviewShot = shotWithFallbackMeasurements(latestShot, liveTelemetry.measurements);
      setCompletedReviewShot(fallbackReviewShot);
      setLastCompletedProfileId(selectedProfileIdFromWorkflow(fallbackReviewShot.workflow, data.profiles));
      setPage("review");
      return;
    }
    setPage("brew");
  }, [brewingCoffee, data.loaded, data.profiles, latestShot, liveTelemetry.measurements, page]);

  useEffect(() => {
    if (!data.loaded) return;
    const shouldPoll = shouldPollMachineState({
      currentMode: currentMachineMode,
      liveMode: liveTelemetry.machineMode?.state,
      hasCompletedActivity: Boolean(completedActivityRef.current)
    });
    if (!shouldPoll) {
      setFastMachineState(null);
      return;
    }

    let cancelled = false;
    const pollMachineState = async () => {
      const nextState = await api.getMachineState().catch(() => null);
      if (!cancelled && nextState) setFastMachineState(nextState);
    };

    void pollMachineState();
    const interval = window.setInterval(() => {
      void pollMachineState();
    }, ACTIVE_MACHINE_STATE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [api, currentMachineMode, data.loaded, liveTelemetry.machineMode?.state, page]);

  const routeCompletedActivity = useCallback(
    async (completed: CompletedActivityCapture) => {
      if (completedActivityRoutingRef.current) return;
      completedActivityRoutingRef.current = true;
      try {
        if (completed.activity === "brew") setPage("review");
        await data.refresh();
        if (completed.activity === "brew") {
          const latestCompletedShot = await api.getLatestShot().catch(() => latestShot);
          if (!latestCompletedShot || (completed.startLatestShotId !== undefined && latestCompletedShot.id === completed.startLatestShotId)) {
            setCompletedReviewShot(null);
            setAutoReadR2ShotId(null);
            autoReadR2ShotIdRef.current = null;
            ignoreActiveActivityUntilAtRef.current = Date.now() + POST_ACTIVITY_RECAPTURE_COOLDOWN_MS;
            skinLog("brew_canceled", { startLatestShotId: completed.startLatestShotId ?? null });
            try {
              await api.tareScale();
              skinLog("scale_tare_after_canceled_brew", { ok: true });
            } catch (error) {
              skinLog("scale_tare_after_canceled_brew", { ok: false, error: errorMessage(error) });
              setStatus({ type: "error", message: `Shot canceled. Could not tare scale: ${errorMessage(error)}` });
            }
            await data.refresh();
            setPage("brew");
            return;
          }

          const completedShotForReview = latestCompletedShot ? shotWithFallbackMeasurements(latestCompletedShot, liveTelemetry.measurements) : null;
          if (completedShotForReview) setCompletedReviewShot(completedShotForReview);

          if (completedShotForReview && r2Available && autoReadR2ShotIdRef.current !== completedShotForReview.id) {
            autoReadR2ShotIdRef.current = completedShotForReview.id;
            setAutoReadR2ShotId(completedShotForReview.id);
          }

          const completedProfileId = completed.profileId ?? selectedProfileIdFromWorkflow(completedShotForReview?.workflow, data.profiles);
          setLastCompletedProfileId(completedProfileId);
          ignoreActiveActivityUntilAtRef.current = Date.now() + POST_ACTIVITY_RECAPTURE_COOLDOWN_MS;
          skinLog("brew_completed", { shotId: completedShotForReview?.id ?? null, profileId: completedProfileId ?? null });
          setPage("review");
          return;
        }

        ignoreActiveActivityUntilAtRef.current = Date.now() + POST_ACTIVITY_RECAPTURE_COOLDOWN_MS;
        setPage("review");
      } finally {
        completedActivityRoutingRef.current = false;
      }
    },
    [api, data.profiles, data.refresh, latestShot, liveTelemetry.measurements, r2Available]
  );

  useEffect(() => {
    if (!data.loaded) return;

    const activeActivity = workflowActivityForMode(currentMachineMode);
    if (activeActivity) {
      if (completedActivityRoutingRef.current) return;
      if (Date.now() < ignoreActiveActivityUntilAtRef.current) return;
      if (completedActivityRef.current?.activity !== activeActivity) {
        completedActivityRef.current = {
          activity: activeActivity,
          profileId: selectedProfileId,
          startLatestShotId: activeActivity === "brew" ? idleLatestShotIdRef.current : undefined
        };
      }
      if (completedActivityTimerRef.current !== null) {
        window.clearTimeout(completedActivityTimerRef.current);
        completedActivityTimerRef.current = null;
      }
      return;
    }

    if (!isIdleMode(currentMachineMode)) return;
    if (!completedActivityRef.current) return;

    const completed = completedActivityRef.current;
    if (completed.activity === "brew") {
      if (completedActivityRoutingRef.current) return;
      completedActivityRef.current = null;
      void routeCompletedActivity(completed);
      return;
    }

    if (completedActivityTimerRef.current !== null) return;
    completedActivityTimerRef.current = window.setTimeout(() => {
      completedActivityTimerRef.current = null;
      completedActivityRef.current = null;
      void routeCompletedActivity(completed);
    }, POST_ACTIVITY_ROUTE_DELAY_MS);
  }, [currentMachineMode, data.loaded, latestShot?.id, routeCompletedActivity, selectedProfileId]);

  useEffect(() => {
    return () => {
      if (completedActivityTimerRef.current !== null) {
        window.clearTimeout(completedActivityTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const updateFullscreenState = () => setFullscreen(Boolean(currentFullscreenElement()));
    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    document.addEventListener("webkitfullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
      document.removeEventListener("webkitfullscreenchange", updateFullscreenState);
    };
  }, []);

  useEffect(() => {
    if (!workflowActivityForMode(currentMachineMode)) return;
    const now = Date.now();
    autoSleepPendingRef.current = false;
    lastUseAtRef.current = now;
    lastUseStateAtRef.current = now;
    setLastUseAt(now);
  }, [currentMachineMode]);

  useEffect(() => {
    lastUseAtRef.current = lastUseAt;
    lastUseStateAtRef.current = lastUseAt;
  }, [lastUseAt]);

  useEffect(() => {
    const markUse = () => {
      const now = Date.now();
      autoSleepPendingRef.current = false;
      lastUseAtRef.current = now;
      if (now - lastUseStateAtRef.current >= 1000) {
        lastUseStateAtRef.current = now;
        setLastUseAt(now);
      }
    };
    const passiveOptions: AddEventListenerOptions = { passive: true };
    window.addEventListener("pointerdown", markUse, passiveOptions);
    window.addEventListener("keydown", markUse);
    window.addEventListener("touchstart", markUse, passiveOptions);
    return () => {
      window.removeEventListener("pointerdown", markUse, passiveOptions);
      window.removeEventListener("keydown", markUse);
      window.removeEventListener("touchstart", markUse, passiveOptions);
    };
  }, []);

  useEffect(() => {
    if (!waterLow) {
      setWaterRefillAcknowledged(false);
      setWaterRefillVisible(false);
      return;
    }

    if (waterRefillAcknowledged || waterRefillVisible) return;

    const timer = window.setTimeout(() => {
      setWaterRefillVisible(true);
    }, WATER_REFILL_POPUP_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [waterLow, waterRefillAcknowledged, waterRefillVisible]);

  const confirmWaterRefill = () => {
    setWaterRefillAcknowledged(true);
    setWaterRefillVisible(false);
  };

  useEffect(() => {
    if (!data.loaded) return;
    const latestShotId = latestShot?.id ?? null;
    if (knownLatestShotIdRef.current === undefined) {
      knownLatestShotIdRef.current = latestShotId;
      return;
    }
    if (knownLatestShotIdRef.current === latestShotId) return;
    knownLatestShotIdRef.current = latestShotId;
    if (!latestShot) return;

    if (r2Available && autoReadR2ShotIdRef.current !== latestShot.id) {
      autoReadR2ShotIdRef.current = latestShot.id;
      setAutoReadR2ShotId(latestShot.id);
    }
  }, [data.loaded, latestShot, r2Available]);

  useEffect(() => {
    if (!data.loaded || !isIdleMode(currentMachineMode)) return;
    idleLatestShotIdRef.current = latestShot?.id ?? null;
  }, [currentMachineMode, data.loaded, latestShot?.id]);

  const toggleReview = async (profileId: string, enabled: boolean) => {
    try {
      await data.persistSettings({
        ...data.settings,
        reviewEnabledByProfile: { ...data.settings.reviewEnabledByProfile, [profileId]: enabled }
      });
    } catch (error) {
      setStatus({ type: "error", message: `Could not save profile setting: ${errorMessage(error)}` });
    }
  };

  const persistSettings = async (next: SkinSettings, successMessage?: string) => {
    try {
      await data.persistSettings(next);
      if (successMessage) setStatus({ type: "success", message: successMessage });
    } catch (error) {
      setStatus({ type: "error", message: `Could not save setting: ${errorMessage(error)}` });
    }
  };

  const saveMachineSettings = async (
    machineSettings: UpdateDe1MachineSettings,
    advancedMachineSettings: De1AdvancedMachineSettings,
    machineCalibration: De1MachineCalibration
  ) => {
    try {
      await Promise.all([
        api.updateMachineSettings(machineSettings),
        api.updateAdvancedMachineSettings(advancedMachineSettings),
        api.updateMachineCalibration(machineCalibration)
      ]);
      await data.refresh();
      setStatus({ type: "success", message: "Machine settings saved." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not save machine settings: ${errorMessage(error)}` });
    }
  };

  const resetMachineSettings = async () => {
    try {
      await api.resetMachineSettings();
      await data.refresh();
      setStatus({ type: "success", message: "Machine settings reset." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not reset machine settings: ${errorMessage(error)}` });
    }
  };

  const setStartupProfile = async (profileId?: string) => {
    await persistSettings({ ...data.settings, startupProfileId: profileId }, "Startup profile saved.");
  };

  const updateProfileWorkflow = async (profileId: string, workflow: ProfileWorkflowSettings) => {
    await persistSettings({
      ...data.settings,
      profileWorkflows: { ...data.settings.profileWorkflows, [profileId]: workflow }
    });
  };

  const setProfileShown = async (profileId: string, shown: boolean) => {
    const shownProfileIds = shown
      ? Array.from(new Set([...data.settings.shownProfileIds, profileId]))
      : data.settings.shownProfileIds.filter((id) => id !== profileId);
    await persistSettings({ ...data.settings, shownProfileIds }, "Profile visibility saved.");
  };

  const refreshR2Sensor = async () => {
    setR2RefreshBusy(true);
    setStatus({ type: "success", message: "Looking for DiFluid R2." });
    try {
      await wakeMachineIfNeeded(api, data.machineState);
      await data.refresh();
      const collectR2Devices = async (knownDevices: DeviceInfo[] = []) => {
        let devices = knownDevices;
        for (const quick of DEVICE_DISCOVERY_SEQUENCE) {
          const scannedDevices = await api.scanDevices({ connect: true, quick }).catch(() => [] as DeviceInfo[]);
          const listedDevices = await api.listDevices().catch(() => data.devices ?? []);
          devices = uniqueDevices([...devices, ...scannedDevices, ...listedDevices]);
        }
        return devices.filter((item) => isR2Device(item) || isConfiguredR2Device(item, data.settings.r2SensorId));
      };
      const attemptedDeviceIds = new Set<string>();
      const connectR2Devices = async (devices: DeviceInfo[], retryAttempted = false) => {
        let attempted = false;
        for (const device of devices) {
          if (!retryAttempted && attemptedDeviceIds.has(device.id)) continue;
          attemptedDeviceIds.add(device.id);
          attempted = true;
          await api.connectDevice(device.id).catch(() => undefined);
        }
        return attempted;
      };

      let r2Devices = await collectR2Devices();
      const attemptedConnect = await connectR2Devices(r2Devices);
      if (attemptedConnect) {
        await waitForNativeUpdate(450);
        r2Devices = await collectR2Devices(r2Devices);
        await connectR2Devices(r2Devices, true);
      }

      const sensor = await findR2SensorWithRetry(api, data.sensors);
      const sensorId = sensor?.id ?? data.settings.r2SensorId ?? r2Devices[0]?.id;
      if (!sensorId) {
        await data.refresh();
        setStatus({ type: "error", message: "No DiFluid R2 detected after refresh." });
        return;
      }

      if (!r2Devices.some((device) => device.id === sensorId && isConnectedDevice(device))) {
        await api.connectDevice(sensorId).catch(() => undefined);
      }
      await data.persistSettings({ ...data.settings, r2SensorId: sensorId });
      await data.refresh();
      setStatus({ type: "success", message: `R2 connected through ReaPrime: ${sensorId}.` });
    } catch (error) {
      setStatus({ type: "error", message: `Could not refresh R2: ${errorMessage(error)}` });
    } finally {
      setR2RefreshBusy(false);
    }
  };

  const saveProfile = async (profileId: string, profile: Profile) => {
    try {
      const savedProfile = await api.updateProfile(profileId, { profile });
      if (savedProfile.id !== profileId) {
        await data.persistSettings(replaceProfileIdInSettings(data.settings, profileId, savedProfile.id));
      }
      await data.refresh();
      setStatus({ type: "success", message: "Profile saved." });
    } catch (error) {
      if (error instanceof ReaPrimeApiError && error.status === 400 && error.message.includes("Cannot modify default profile content")) {
        try {
          const createdProfile = await api.createProfile({ profile, parentId: profileId });
          await data.persistSettings({
            ...data.settings,
            shownProfileIds: Array.from(new Set([...data.settings.shownProfileIds, createdProfile.id]))
          });
          await data.refresh();
          setStatus({ type: "success", message: "Profile saved." });
          return;
        } catch (createError) {
          setStatus({ type: "error", message: `Could not save profile: ${errorMessage(createError)}` });
          throw createError;
        }
      }
      setStatus({ type: "error", message: `Could not save profile: ${errorMessage(error)}` });
      throw error;
    }
  };

  const assignPresetProfile = async (profile: ProfileRecord) => {
    if (editingSlotIndex === null) return;
    const slot = data.settings.presetSlots[editingSlotIndex];
    if (!slot) return;

    try {
      await data.persistSettings({
        ...data.settings,
        presetSlots: data.settings.presetSlots.map((item, index) => {
          if (index === editingSlotIndex) return { ...item, profileId: profile.id };
          if (item.profileId !== profile.id) return item;
          const { profileId: _profileId, ...rest } = item;
          return rest;
        })
      });
      setStatus({ type: "success", message: `Preset ${slot.label} set to ${profile.profile.title ?? profile.id}.` });
      setEditingSlotIndex(null);
    } catch (error) {
      setStatus({ type: "error", message: `Could not save preset: ${errorMessage(error)}` });
    }
  };

  const applyProfileForBrew = async (profile: ProfileRecord) => {
    manualProfileSelectionRef.current = { version: manualProfileSelectionRef.current.version + 1, profileId: profile.id };
    setStartupProfileHoldId(null);
    startupProfileApplyRef.current = { ...startupProfileApplyRef.current, pending: false, complete: true };
    await applyProfile(profile, { optimistic: true });
    setLastUseAt(Date.now());
  };

  const requestScaleConnection = useCallback(async (options: { quick?: boolean } = {}) => {
    await wakeMachineIfNeeded(api, data.machineState);
    const initialDevices = await api.listDevices().catch(() => data.devices ?? []);
    if (hasConnectedScale(initialDevices)) {
      await data.refresh();
      return { connected: true, requested: false, found: true, scanSawScale: true, firstError: null };
    }

    let requested = false;
    let found = false;
    let scanSawScale = false;
    let firstError: unknown = null;
    let refreshedDevices = initialDevices;
    const scanSequence = options.quick === undefined ? DEVICE_DISCOVERY_SEQUENCE : [options.quick];

    for (const quick of scanSequence) {
      const scannedDevices = await api.scanDevices({ connect: true, quick }).catch(() => [] as DeviceInfo[]);
      const listedDevices = await api.listDevices().catch(() => refreshedDevices);
      const devices = uniqueDevices([...refreshedDevices, ...scannedDevices, ...listedDevices]);
      const scanFoundScale = scannedDevices.some((device) => isScaleDeviceCandidate(device) && !isR2Device(device));
      scanSawScale = scanSawScale || scanFoundScale;

      if (hasConnectedScale(devices)) {
        await data.refresh();
        return { connected: true, requested, found: true, scanSawScale, firstError };
      }

      const scaleDevices = devices.filter((device) => isScaleDeviceCandidate(device) && !isConnectedDevice(device) && !isR2Device(device));
      found = found || scanFoundScale || scaleDevices.length > 0;
      for (const device of scaleDevices) {
        try {
          await api.connectDevice(device.id);
          requested = true;
        } catch (error) {
          firstError ??= error;
        }
      }

      refreshedDevices = devices;
      if (scaleDevices.length > 0 || scanFoundScale) {
        for (const delay of [250, 500]) {
          await waitForNativeUpdate(delay);
          refreshedDevices = uniqueDevices([...(await api.listDevices().catch(() => refreshedDevices)), ...scannedDevices]);
          if (hasConnectedScale(refreshedDevices)) {
            await data.refresh();
            return { connected: true, requested, found: true, scanSawScale, firstError };
          }
        }
      }
    }

    await data.refresh();
    return {
      connected: hasConnectedScale(refreshedDevices),
      requested,
      found,
      scanSawScale,
      firstError
    };
  }, [api, data.devices, data.machineState, data.refresh]);

  useEffect(() => {
    if (!data.loaded) return;
    const wasSleeping = wasSleepingRef.current;
    wasSleepingRef.current = machineSleeping;
    if (wasSleeping !== true || machineSleeping) return;

    if (Date.now() <= wakeScreenStartupResetUntilRef.current) {
      wakeScreenStartupResetUntilRef.current = 0;
      return;
    }

    void runStartupRecovery().catch(() => undefined);
  }, [data.loaded, machineSleeping, runStartupRecovery]);

  useEffect(() => {
    if (!data.loaded || page === "screensaver" || machineSleeping) return;
    const disconnectedScales = disconnectedScaleDevices(nativeDevices);
    if (disconnectedScales.length === 0 || hasConnectedScale(nativeDevices)) {
      scaleReconnectRef.current.signature = null;
      return;
    }

    const signature = deviceIdSignature(disconnectedScales);
    const now = Date.now();
    const reconnectState = scaleReconnectRef.current;
    if (reconnectState.pending) return;
    if (reconnectState.signature === signature && now - reconnectState.lastAttemptAt < SCALE_RECONNECT_COOLDOWN_MS) return;

    reconnectState.signature = signature;
    reconnectState.lastAttemptAt = now;
    reconnectState.pending = true;
    void requestScaleConnection()
      .catch(() => undefined)
      .finally(() => {
        scaleReconnectRef.current.pending = false;
      });
  }, [data.loaded, machineSleeping, nativeDevices, page, requestScaleConnection]);

  const saveBag = async (bag: Bag) => {
    const bean = await api.createBean({
      roaster: bag.roaster?.trim() ?? "",
      name: bag.bean?.trim() ?? "",
      country: bag.country?.trim() || undefined,
      region: bag.region?.trim() || undefined,
      processing: bag.process?.trim() || undefined,
      notes: bag.notes?.trim() || undefined
    });

    try {
      await api.createBatch(bean.id, {
        roastDate: dateOnlyToIsoDateTime(bag.roastDate),
        roastLevel: bag.roastLevel?.trim() || undefined,
        notes: bag.notes?.trim() || undefined,
        extras: { workflowSkin: { createdFromBagForm: true, name: bag.name?.trim() || undefined } }
      });
    } catch (error) {
      try {
        await api.deleteBean(bean.id);
      } catch {
        throw new Error(`Could not save bag: batch creation failed; cleanup also failed. ${errorMessage(error)}`);
      }
      throw new Error(`Could not save bag: batch creation failed. ${errorMessage(error)}`);
    }

    await data.refresh();
  };

  const updateBag = async (bag: Bag) => {
    await Promise.all([
      api.updateBean(bag.beanId, {
        roaster: bag.roaster?.trim() ?? "",
        name: bag.bean?.trim() ?? "",
        country: bag.country?.trim() || undefined,
        region: bag.region?.trim() || undefined,
        processing: bag.process?.trim() || undefined,
        notes: bag.notes?.trim() || undefined
      }),
      api.updateBatch(bag.id, {
        roastDate: dateOnlyToIsoDateTime(bag.roastDate),
        roastLevel: bag.roastLevel?.trim() || undefined,
        notes: bag.notes?.trim() || undefined,
        extras: { workflowSkin: { name: bag.name?.trim() || undefined } }
      })
    ]);
    await data.refresh();
  };

  const archiveBag = async (bag: Bag) => {
    await api.updateBatch(bag.id, { archived: true });
    await data.refresh();
  };

  const createGrinder = async (payload: CreateGrinderPayload) => {
    await api.createGrinder(payload);
    await data.refresh();
  };

  const updateGrinder = async (id: string, payload: Partial<CreateGrinderPayload>) => {
    await api.updateGrinder(id, payload);
    await data.refresh();
  };

  const archiveGrinder = async (grinder: Grinder) => {
    await api.updateGrinder(grinder.id, { archived: true });
    await data.refresh();
  };

  const setDefaultGrinder = async (grinderId: string) => {
    await persistSettings({ ...data.settings, defaultGrinderId: grinderId, lastGrinderId: grinderId }, "Default grinder saved.");
  };

  const saveReview = async (shotId: string, annotations: ShotAnnotations) => {
    try {
      await api.updateShot(shotId, { annotations });
      await data.refresh();
      setStatus({ type: "success", message: "Review saved." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not save review: ${errorMessage(error)}` });
    }
  };

  const openHistoryShotReview = async (shot: ShotRecord) => {
    setStatus(null);
    autoReadR2ShotIdRef.current = null;
    setAutoReadR2ShotId(null);

    let reviewShot = shot;

    if ((shot.measurements?.length ?? 0) === 0) {
      try {
        reviewShot = await api.getShot(shot.id);
      } catch (error) {
        setStatus({ type: "error", message: `Could not load shot: ${errorMessage(error)}` });
      }
    }

    setCompletedReviewShot(reviewShot);
    setLastCompletedProfileId(selectedProfileIdFromWorkflow(reviewShot.workflow, data.profiles));
    setPage("review");
  };

  const uploadReviewToVisualizer = async () => {
    if (!reviewShot) return;
    try {
      await uploadShotToVisualizer({ baseUrl: apiBaseUrl() }, await api.getShot(reviewShot.id));
      setStatus({ type: "success", message: "Shot uploaded to Visualizer." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not upload to Visualizer: ${errorMessage(error)}` });
    }
  };

  const startSteam = async () => {
    try {
      await api.requestMachineState("steam");
      setStatus({ type: "success", message: "Steam started." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not start steam: ${errorMessage(error)}` });
    }
  };

  const stopSteam = async () => {
    try {
      await api.requestMachineState("idle");
      setStatus({ type: "success", message: "Steam stopped." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not stop steam: ${errorMessage(error)}` });
    }
  };

  const reconnectR2ForMeasurement = async (sensorId: string): Promise<string> => {
    await wakeMachineIfNeeded(api, data.machineState);
    const scannedDevices = await api.scanDevices({ connect: true, quick: false }).catch(() => [] as DeviceInfo[]);
    const listedDevices = await api.listDevices().catch(() => data.devices ?? []);
    const r2Devices = uniqueDevices([...scannedDevices, ...listedDevices]).filter(
      (device) => isR2Device(device) || isConfiguredR2Device(device, sensorId) || isConfiguredR2Device(device, data.settings.r2SensorId)
    );
    const reconnectIds = new Set([sensorId, ...r2Devices.map((device) => device.id)]);
    for (const deviceId of reconnectIds) {
      await api.connectDevice(deviceId).catch(() => undefined);
    }

    await waitForNativeUpdate(750);
    const sensor = await findR2SensorWithRetry(api, data.sensors);
    const nextSensorId = sensor?.id ?? sensorId;
    if (sensor?.id && data.settings.r2SensorId !== sensor.id) {
      await Promise.resolve(data.persistSettings({ ...data.settings, r2SensorId: sensor.id })).catch(() => undefined);
    }
    await data.refresh();
    return nextSensorId;
  };

  const executeR2Measurement = async (sensorId: string) => {
    return api.executeSensor(sensorId, "measure", { timeout: 30 });
  };

  const readR2 = async () => {
    let sensorId = r2Sensor?.id ?? data.settings.r2SensorId ?? connectedR2Device?.id;
    if (!sensorId) {
      setStatus({ type: "error", message: "No DiFluid R2 sensor detected." });
      return null;
    }

    try {
      let result;
      try {
        result = await executeR2Measurement(sensorId);
      } catch (error) {
        if (!r2MeasurementNeedsReconnect(errorMessage(error))) throw error;
        sensorId = await reconnectR2ForMeasurement(sensorId);
        result = await executeR2Measurement(sensorId);
      }

      if (result.status === "error") {
        if (r2MeasurementNeedsReconnect(result.message ?? "")) {
          sensorId = await reconnectR2ForMeasurement(sensorId);
          result = await executeR2Measurement(sensorId);
        }
      }

      if (result.status === "error") {
        setStatus({ type: "error", message: `Could not read R2: ${result.message ?? "Measurement command failed."}` });
        return null;
      }

      const tds = extractR2Tds(result.result);
      if (tds === null) {
        setStatus({ type: "error", message: "R2 did not return a TDS reading." });
        return null;
      }
      const discoveredSensorId = r2Sensor?.id ?? connectedR2Device?.id;
      if (discoveredSensorId && data.settings.r2SensorId !== discoveredSensorId) {
        await Promise.resolve(data.persistSettings({ ...data.settings, r2SensorId: discoveredSensorId })).catch(() => undefined);
      }
      return tds;
    } catch (error) {
      setStatus({ type: "error", message: `Could not read R2: ${errorMessage(error)}` });
      return null;
    }
  };

  const applyScreensaverDisplay = useCallback(async () => {
    const brightness = screensaverBrightnessValue(data.settings.screensaverBrightness);
    await Promise.all([
      api.setDisplayBrightness(brightness).catch(() => undefined),
      api.releaseWakeLock().catch(() => undefined)
    ]);
  }, [api, data.settings.screensaverBrightness]);

  const sleepMachine = useCallback(async () => {
    setSleepPending(true);
    setPage("screensaver");
    try {
      await applyScreensaverDisplay();
      await api.sleepMachine();
      await data.refresh();
      await applyScreensaverDisplay();
      setStatus({ type: "success", message: "Machine sleep requested." });
    } catch (error) {
      skinLog("machine_sleep_request_failed", { error: errorMessage(error) });
      setStatus({ type: "success", message: sleepFailureStatusMessage(error) });
    } finally {
      setSleepPending(false);
    }
  }, [api, applyScreensaverDisplay, data.refresh]);

  useEffect(() => {
    sleepMachineRef.current = sleepMachine;
  }, [sleepMachine]);

  const wakeScreen = async () => {
    const now = Date.now();
    const manualSelectionVersion = manualProfileSelectionRef.current.version;
    autoSleepPendingRef.current = false;
    lastUseAtRef.current = now;
    lastUseStateAtRef.current = now;
    setLastUseAt(now);
    wakeScreenStartupResetUntilRef.current = now + 15_000;
    setPage("brew");
    await api.setDisplayBrightness(100).catch(() => undefined);
    if (data.settings.keepScreenAwake !== false) {
      await api.requestWakeLock().catch(() => undefined);
    }
    await wakeMachineIfNeeded(api, data.machineState);
    await runStartupRecovery({ manualSelectionVersion });
  };

  useEffect(() => {
    if (!data.loaded || page === "screensaver" || !machineConnected) return;
    if (isBrewingMode(currentMachineMode) || isSleepingMode(currentMachineMode)) return;

    const autoSleepMinutes = data.settings.autoSleepMinutes;
    if (!autoSleepMinutes) return;

    const idleLimitMs = autoSleepMinutes * 60_000;
    const checkIdle = () => {
      if (autoSleepPendingRef.current) return;
      if (Date.now() - lastUseAtRef.current >= idleLimitMs) {
        const sleep = sleepMachineRef.current;
        if (!sleep) return;
        autoSleepPendingRef.current = true;
        void sleep().finally(() => {
          autoSleepPendingRef.current = false;
        });
      }
    };

    checkIdle();
    const timer = window.setInterval(checkIdle, autoSleepCheckIntervalMs(idleLimitMs));
    return () => window.clearInterval(timer);
  }, [currentMachineMode, data.loaded, data.settings.autoSleepMinutes, machineConnected, page]);

  const forceScaleConnection = async () => {
    setStatus({ type: "success", message: "Scanning for scale." });
    try {
      const result = await requestScaleConnection();
      if (result.connected) {
        setStatus({ type: "success", message: "Scale connected." });
        return;
      }

      if (!result.found) {
        setStatus({ type: "error", message: "No scale found after scan." });
        return;
      }

      if (result.requested) {
        setStatus({ type: "success", message: "Scale connection requested." });
        return;
      }

      if (result.scanSawScale && result.firstError) {
        setStatus({ type: "success", message: "Scale scan requested. Wake the scale if it stays disconnected." });
        return;
      }

      if (result.firstError) throw result.firstError;
      setStatus({ type: "success", message: "Scale scan requested. Wake the scale if it stays disconnected." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not connect scale: ${errorMessage(error)}` });
    }
  };

  const tareScaleFromIndicator = async () => {
    setExpandedStatusId(null);
    setStatus({ type: "success", message: "Taring scale." });
    try {
      await api.tareScale();
      await data.refresh();
      setStatus({ type: "success", message: "Scale tared." });
    } catch (error) {
      skinLog("scale_tare_from_indicator_failed", { error: errorMessage(error) });
      try {
        const result = await requestScaleConnection();
        if (result.connected) {
          setStatus({ type: "success", message: "Scale connected. Tap Scale again to tare." });
          return;
        }
        if (result.requested || result.found) {
          setStatus({ type: "success", message: "Scale connection requested. Tap Scale again after it connects." });
          return;
        }
      } catch (connectError) {
        setStatus({ type: "error", message: `Could not tare or connect scale: ${errorMessage(connectError)}` });
        return;
      }
      setStatus({ type: "error", message: `Could not tare scale: ${errorMessage(error)}` });
    }
  };

  const toggleStatusPopover = (nextStatus: TopStatusIndicator) => {
    if (nextStatus.id === "scale") {
      setExpandedStatusId(null);
      if (nextStatus.connected) {
        void tareScaleFromIndicator();
      } else {
        void forceScaleConnection();
      }
      return;
    }
    if (nextStatus.id === "r2") {
      setExpandedStatusId(null);
      if (!r2RefreshBusy) void refreshR2Sensor();
      return;
    }
    setExpandedStatusId((current) => (current === nextStatus.id ? null : nextStatus.id));
  };

  const editingSlot = editingSlotIndex === null ? undefined : data.settings.presetSlots[editingSlotIndex];

  const toggleMenuCollapsed = async () => {
    await persistSettings({ ...data.settings, menuCollapsed: !data.settings.menuCollapsed });
  };

  const toggleFullscreen = async () => {
    try {
      if (currentFullscreenElement()) {
        await exitAppFullscreen();
      } else {
        await requestAppFullscreen();
      }
      setFullscreen(Boolean(currentFullscreenElement()));
    } catch (error) {
      setStatus({ type: "error", message: `Could not toggle fullscreen: ${errorMessage(error)}` });
    }
  };

  if (page === "screensaver") {
    return <ScreensaverPage title={data.settings.skinTitle} onWake={() => void wakeScreen()} />;
  }

  const navIconSize = 20;
  const theme = activeSkinTheme(data.settings);
  const shellStyle = {
    "--skin-bg": theme.background,
    "--skin-surface": theme.surface,
    "--skin-panel": theme.panel,
    "--skin-border": theme.border,
    "--skin-text": theme.text,
    "--skin-muted": theme.muted,
    "--skin-accent": theme.accent,
    "--skin-accent-alt": theme.accentAlt,
    fontSize: `${data.settings.skinFontScale}%`
  } as CSSProperties;

  return (
    <main className={data.settings.menuCollapsed ? "app-shell menu-collapsed" : "app-shell"} style={shellStyle}>
      {waterLow && waterRefillVisible && !waterRefillAcknowledged && <WaterRefillOverlay detail={waterLowDetail} onConfirm={confirmWaterRefill} />}
      <TopStatusBar
        indicators={topStatusIndicators}
        expandedStatusId={expandedStatusId}
        machineSummary={topMachineSummary}
        onStatusPress={toggleStatusPopover}
      >
        <button
          type="button"
          className="sleep-button"
          aria-label="Sleep machine"
          title={machineConnected ? "Sleep machine" : "Machine is not connected"}
          disabled={!machineConnected || sleepPending}
          onClick={() => void sleepMachine()}
        >
          <Moon size={17} />
          <span>{sleepPending ? "Sleeping" : "Sleep"}</span>
        </button>
        <button
          type="button"
          className="sleep-button fullscreen-button"
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </TopStatusBar>
      <nav className="side-nav" aria-label="Workflow navigation">
        <div className="menu-brand" aria-label="WorkFlow menu title">
          <span className="menu-brand-full">WorkFlow</span>
          <span className="menu-brand-short">WF</span>
        </div>
        <button
          type="button"
          className="nav-button menu-toggle-button"
          aria-label={data.settings.menuCollapsed ? "Expand menu" : "Collapse menu"}
          title={data.settings.menuCollapsed ? "Expand menu" : "Collapse menu"}
          onClick={() => void toggleMenuCollapsed()}
        >
          {data.settings.menuCollapsed ? <PanelLeftOpen className="nav-icon" size={navIconSize} /> : <PanelLeftClose className="nav-icon" size={navIconSize} />}
          <span>{data.settings.menuCollapsed ? "Expand" : "Minimize"}</span>
        </button>
        {visibleMenuIds.map((itemId) => {
          const item = navById[itemId];
          const Icon = item.icon;
          const isReview = itemId === "review";
          const className = [page === itemId ? "nav-button active" : "nav-button", isReview ? "review-nav-button" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={itemId}
              aria-current={page === itemId ? "page" : undefined}
              aria-label={item.label}
              className={className}
              onClick={() => setPage(itemId)}
            >
              <Icon className={isReview ? "nav-icon review-nav-icon" : "nav-icon"} size={navIconSize} />
              <span>{item.label}</span>
            </button>
          );
        })}
        {!data.settings.menuCollapsed && (
          <div className="menu-version-footer latest" aria-label="Skin version" title="Skin version">
            <span>{versionLabel(menuSkinVersion)}</span>
          </div>
        )}
      </nav>
      <section className="page-surface">
        {page !== "bags" && page !== "community" && <h1>{navById[page].label}</h1>}
        {data.error && (
          <p className="muted" role="alert" aria-live="assertive">
            {data.error}
          </p>
        )}
        {status && !editingSlot && (
          <p
            className={status.type === "error" ? "status-message error" : "status-message"}
            role={status.type === "error" ? "alert" : "status"}
            aria-live={status.type === "error" ? "assertive" : "polite"}
          >
            {status.message}
          </p>
        )}
        {page === "brew" && (
          <BrewPage
            workflow={displayWorkflow}
            profiles={data.profiles}
            bags={data.bags}
            shots={data.shots}
            settings={data.settings}
            onApplyProfile={(profile) => {
              void applyProfileForBrew(profile);
            }}
            onEditSlot={(index) => {
              setStatus(null);
              setEditingSlotIndex(index);
            }}
            grinders={data.grinders ?? []}
            onUpdateRecipe={async ({ dose, yield: targetYield }) => {
              await api.updateWorkflow({
                context: {
                  ...data.workflow.context,
                  targetDoseWeight: dose,
                  targetYield
                }
              });
              await data.refresh();
            }}
            onSelectBag={async (bagId) => {
              const bag = data.bags.find((item) => item.id === bagId);
              await api.updateWorkflow({
                context: {
                  ...data.workflow.context,
                  beanBatchId: bagId || undefined,
                  coffeeName: bag?.bean,
                  coffeeRoaster: bag?.roaster
                }
              });
              await data.refresh();
            }}
          />
        )}
        {showLivePage && (
          <LivePage
            workflow={data.workflow}
            activeProfile={activeProfile}
            latestShot={reviewShot ?? latestShot}
            liveMeasurements={liveTelemetry.measurements}
            scaleSnapshot={liveTelemetry.scaleSnapshot}
          />
        )}
        {page === "review" &&
          (reviewShot ? (
            <ReviewPage
              key={reviewShot.id}
              shot={reviewShot}
              previousShots={data.shots}
              onSaveAnnotations={saveReview}
              onUploadVisualizer={uploadReviewToVisualizer}
              r2Sensor={r2Sensor}
              r2Available={r2Available}
              onReadR2={readR2}
              autoReadR2={autoReadR2ShotId === reviewShot.id}
              autoReadR2DelaySeconds={data.settings.r2MeasureDelaySeconds}
              grinders={data.grinders ?? []}
              defaultGrinderId={data.settings.defaultGrinderId ?? data.settings.lastGrinderId}
              onLoadShot={(shotId) => api.getShot(shotId)}
              onRecommendShot={recommendHistoryShot}
            />
          ) : (
            <div className="panel wide">
              <h2>Shot Review</h2>
              <p className="muted">Pull a shot to unlock post-shot review.</p>
            </div>
          ))}
        {page === "steam" && (
          <SteamPage
            profileTitle={activeProfile?.profile.title ?? data.workflow.profile?.title ?? "Milk profile"}
            timers={activeProfileWorkflow.steamTimers}
            onReview={() => setPage("review")}
            onStartSteam={startSteam}
            onStopSteam={stopSteam}
            onUpdateTimers={(steamTimers) => {
              if (!workflowPageProfileId) return;
              void updateProfileWorkflow(workflowPageProfileId, { ...activeProfileWorkflow, steamTimers });
            }}
            steamActive={steamingMilk}
            steamHistory={data.steams ?? []}
          />
        )}
        {page === "bags" && (
          <BagsPage
            bags={data.bags}
            onSaveBag={saveBag}
            onUpdateBag={updateBag}
            onArchiveBag={archiveBag}
          />
        )}
        {page === "grinders" && (
          <GrindersPage
            grinders={data.grinders ?? []}
            defaultGrinderId={data.settings.defaultGrinderId ?? data.settings.lastGrinderId}
            onSetDefaultGrinder={setDefaultGrinder}
            onCreateGrinder={createGrinder}
            onUpdateGrinder={updateGrinder}
            onArchiveGrinder={archiveGrinder}
          />
        )}
        {page === "profiles" && (
          <ProfilesPage
            profiles={data.profiles}
            settings={data.settings}
            onToggleReview={toggleReview}
            onSetStartupProfile={setStartupProfile}
            onSetProfileShown={setProfileShown}
            onUpdateProfileWorkflow={updateProfileWorkflow}
            onSaveProfile={saveProfile}
          />
        )}
        {page === "history" && <HistoryPage shots={data.shots} bags={data.bags} onOpenShot={(shot) => void openHistoryShotReview(shot)} onRecommendShot={recommendHistoryShot} />}
        {page === "community" && (
          <CommunityPage
            recommendations={communityRecommendations}
            loading={communityLoading}
            error={communityError}
            bags={data.bags}
            profiles={data.profiles}
            grinders={data.grinders ?? []}
            shots={data.shots}
            downloaded={downloadedCommunityProfiles}
            uploaded={uploadedCommunityProfiles}
            userRatings={communityUserRatings}
            submittedBy={publicNameFromDecentAccount(decentAccount) ?? communityDisplayName}
            submittedByLocked={Boolean(publicNameFromDecentAccount(decentAccount))}
            manualDisplayName={communityDisplayName}
            onManualDisplayNameChange={setCommunityDisplayName}
            onRefresh={refreshCommunity}
            onLoadDetails={loadCommunityRecommendationDetails}
            onDownload={downloadCommunityProfile}
            onRateRecommendation={rateCommunityRecommendation}
            onUpload={uploadCommunityProfile}
            onEditUpload={editCommunityUpload}
            onDeleteUpload={deleteCommunityUpload}
            initialDraft={communityInitialDraft}
            onInitialDraftApplied={clearCommunityInitialDraft}
          />
        )}
        {page === "settings" && (
          <SettingsPage
            settings={data.settings}
            r2Sensor={r2Sensor}
            displayState={data.displayState}
            machineSettings={data.machineSettings}
            advancedMachineSettings={data.advancedMachineSettings}
            machineCalibration={data.machineCalibration}
            visualizerPlugin={visualizerPlugin}
            visualizerSettings={data.visualizerSettings}
            visualizerStatus={data.visualizerStatus}
            r2RefreshBusy={r2RefreshBusy}
            onRefreshR2={refreshR2Sensor}
            onSaveMachineSettings={saveMachineSettings}
            onResetMachineSettings={resetMachineSettings}
            onUpdateSettings={(next) => void persistSettings(next, "Settings saved.")}
          />
        )}
        {editingSlot && (
          <div className="preset-editor" role="dialog" aria-modal="true" aria-labelledby="preset-editor-title">
            <div className="preset-editor-panel">
              <div className="form-header">
                <div>
                  <span className="eyebrow">Preset Slot</span>
                  <h2 id="preset-editor-title">Edit {editingSlot.label} preset</h2>
                </div>
                <button type="button" className="ghost-button" onClick={() => setEditingSlotIndex(null)}>
                  Cancel
                </button>
              </div>
              {status && (
                <p
                  className={status.type === "error" ? "status-message error" : "status-message"}
                  role={status.type === "error" ? "alert" : "status"}
                  aria-live={status.type === "error" ? "assertive" : "polite"}
                >
                  {status.message}
                </p>
              )}
              <div className="profile-picker" aria-label={`Choose a profile for ${editingSlot.label}`}>
                {shownProfiles.length === 0 && <p className="muted">No profiles are shown. Enable profiles from the Profiles page.</p>}
                {shownProfiles.length > 0 && presetPickerProfiles.length === 0 && (
                  <p className="muted">All shown profiles are already assigned to other presets.</p>
                )}
                {presetPickerProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="list-row"
                    aria-label={`Use ${profile.profile.title ?? profile.id}`}
                    onClick={() => {
                      void assignPresetProfile(profile);
                    }}
                  >
                    <strong>{profile.profile.title ?? profile.id}</strong>
                    <span>{profile.id === editingSlot.profileId ? "Current profile" : "Use this profile"}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
