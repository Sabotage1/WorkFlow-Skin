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
  Users,
  Workflow as WorkflowIcon
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
import {
  DrinkWorkflowCanceledError,
  runDrinkWorkflow as executeDrinkWorkflow
} from "./lib/drinkWorkflowRunner";
import {
  IDLE_DRINK_WORKFLOW_RUN,
  attachDrinkWorkflowToShot,
  drinkWorkflowDetailsFromShot,
  drinkWorkflowStepLabel,
  validateDrinkWorkflow,
  type DrinkWorkflow,
  type DrinkWorkflowRunState
} from "./lib/drinkWorkflows";
import { machineModeLabel, machineTemperature } from "./lib/machineState";
import {
  isBrewingMode,
  isIdleMode,
  isSleepingMode,
  isSteamingMode,
  resolveMachineModeSnapshot,
  shouldPollMachineState,
  workflowActivityForMode
} from "./lib/machineMode";
import { isActiveShotLifecycle, isFinishedShotLifecycle } from "./lib/shotLifecycle";
import { grindSizeFromShot, shotStats } from "./lib/shotStats";
import { resolveDisplayedProfileId, selectedProfileIdFromWorkflow, type CompletedWorkflowActivity } from "./lib/workflowRouting";
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
import { WorkflowsPage } from "./pages/WorkflowsPage";
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
import { useScaleShotFallback } from "./state/useScaleShotFallback";

declare global {
  var __WORKFLOW_SKIN_ENABLE_TEST_LOGS__: boolean | undefined;
}

type Page = MainMenuItemId | "screensaver";
type CompletedActivityCapture = {
  activity: CompletedWorkflowActivity;
  profileId?: string;
  startLatestShotId?: string | null;
  shotId?: string;
};

const POST_ACTIVITY_ROUTE_DELAY_MS = 1000;
const POST_ACTIVITY_RECAPTURE_COOLDOWN_MS = 3000;
const ACTIVE_MACHINE_STATE_POLL_MS = 500;
const SCALE_RECONNECT_COOLDOWN_MS = 30_000;
const COMPLETED_SHOT_RETRY_DELAYS_MS: readonly number[] = [0, 150, 450, 900, 1500, 2500, 4000];
const WATER_REFILL_POPUP_DELAY_MS = 10_000;
const DEVICE_WAKE_RECOVERY_DELAYS_MS: readonly number[] = [0, 1500, 3500];
const FOREGROUND_DEVICE_RECOVERY_DELAYS_MS: readonly number[] = [0, 3000, 5000, 7000, 15_000];
const FOREGROUND_DEVICE_RECOVERY_COOLDOWN_MS = 5000;
const FOREGROUND_INTERACTION_IDLE_MS = 15_000;
const DEVICE_CONNECTION_VERIFY_DELAYS_MS: readonly number[] = [0, 350, 1000, 2000, 4000];
const MANUAL_DEVICE_DISCOVERY_ATTEMPTS = 3;
const DEVICE_DISCOVERY_RETRY_DELAY_MS = 750;
const DISPLAY_BRIGHTNESS_VERIFY_DELAYS_MS: readonly number[] = [0, 250, 750];
const CURRENT_SKIN_VERSION = typeof skinManifest.version === "string" ? skinManifest.version : "";
const SKIN_LOG_PREFIX = "[WorkFlow Skin]";
const MANAGED_SCALE_RECOVERY_MIN_VERSION = [0, 7, 13] as const;

interface TopStatusIndicator {
  id: TopStatusIndicatorId;
  label: string;
  detail: string;
  connected: boolean;
}

const navById: Record<MainMenuItemId, { label: string; icon: React.ComponentType<{ className?: string; size?: number }> }> = {
  brew: { label: MAIN_MENU_ITEM_LABELS.brew, icon: Coffee },
  workflows: { label: MAIN_MENU_ITEM_LABELS.workflows, icon: WorkflowIcon },
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

function appVersionAtLeast(version: string | null | undefined, minimum: readonly [number, number, number]): boolean {
  const match = version?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const current = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) return true;
    if (current[index] < minimum[index]) return false;
  }
  return true;
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

function isAvailableDevice(device: DeviceInfo): boolean {
  return device.available !== false;
}

function isMachineDeviceCandidate(device: DeviceInfo): boolean {
  const label = deviceLabel(device);
  return (
    device.type === "machine" ||
    (!isScaleDeviceCandidate(device) && !isR2Device(device) && (label.includes("machine") || label.includes("de1") || label.includes("decent espresso")))
  );
}

function hasConnectedScale(devices: DeviceInfo[]): boolean {
  return devices.some((device) => isAvailableDevice(device) && isScaleDeviceCandidate(device) && isConnectedDevice(device) && !isR2Device(device));
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

function uniqueDevices(devices: DeviceInfo[]): DeviceInfo[] {
  const byId = new Map<string, DeviceInfo>();
  for (const device of devices) {
    const current = byId.get(device.id);
    if (!current) {
      byId.set(device.id, device);
      continue;
    }
    const available = current.available === true || device.available === true ? true : device.available ?? current.available;
    byId.set(device.id, {
      ...current,
      ...device,
      state: isConnectedDevice(current) && !isConnectedDevice(device) ? current.state : device.state,
      available
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

async function discoverAvailableDevices(
  api: ReaPrimeApi,
  options: {
    fallbackDevices: DeviceInfo[];
    predicate: (device: DeviceInfo) => boolean;
    attempts?: number;
    onRetry?: (attempt: number) => void;
  }
): Promise<{ devices: DeviceInfo[]; firstError: unknown | null }> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 1));
  let devices = options.fallbackDevices;
  let firstError: unknown = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      options.onRetry?.(attempt + 1);
      await waitForNativeUpdate(DEVICE_DISCOVERY_RETRY_DELAY_MS);
    }

    let scanError: unknown = null;
    let listError: unknown = null;
    let scannedDevices: DeviceInfo[] = [];
    let listedDevices: DeviceInfo[] = [];
    try {
      // Discovery-only scans are not discarded by ConnectionManager when its
      // wake recovery is already connecting another device.
      scannedDevices = await api.scanDevices({ connect: false, quick: false });
    } catch (error) {
      scanError = error;
      firstError ??= error;
    }
    try {
      listedDevices = await api.listDevices();
    } catch (error) {
      listError = error;
      firstError ??= error;
    }

    const latestDevices = [
      ...(listError ? [] : listedDevices),
      ...(scanError ? [] : scannedDevices),
      ...(scanError && listError ? devices : [])
    ];
    devices = uniqueDevices(latestDevices).filter(isAvailableDevice);
    if (devices.some(options.predicate)) break;
  }

  return { devices, firstError };
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
  if ((shot.measurements?.length ?? 0) > 0 || fallbackMeasurements.length === 0) return shot;
  return { ...shot, measurements: fallbackMeasurements };
}

function pendingPersistenceStartShotId(shot: ShotRecord | null): string | null | undefined {
  if (!shot?.id.startsWith("workflow-pending-")) return undefined;
  const value = shot.metadata?.workflowSkinPendingStartShotId;
  return typeof value === "string" || value === null ? value : undefined;
}

async function loadCompletedShot(
  api: ReaPrimeApi,
  completed: CompletedActivityCapture,
  fallbackLatestShot: ShotRecord | null
): Promise<ShotRecord | null> {
  if (completed.shotId) {
    for (const delay of [0, 150, 450, 900, 1500, 2500]) {
      if (delay > 0) await waitForNativeUpdate(delay);
      const shot = await api.getShot(completed.shotId).catch(() => null);
      if (shot) return shot;
    }
    const latestShot = await api.getLatestShot().catch(() => null);
    return latestShot?.id === completed.shotId ? latestShot : null;
  }
  if (completed.startLatestShotId === undefined) {
    return api.getLatestShot().catch(() => fallbackLatestShot);
  }
  const startingShotId = completed.startLatestShotId;
  for (const delay of COMPLETED_SHOT_RETRY_DELAYS_MS) {
    if (delay > 0) await waitForNativeUpdate(delay);
    const latestShot = await api.getLatestShot().catch(() => null);
    if (latestShot && latestShot.id !== startingShotId) return latestShot;
  }
  return null;
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
  const [completedReviewLoading, setCompletedReviewLoading] = useState(false);
  const [nativeGatewayMode, setNativeGatewayMode] = useState<string | null | undefined>(undefined);
  const [nativePreferredScaleId, setNativePreferredScaleId] = useState<string | null | undefined>(undefined);
  const [communityRecommendations, setCommunityRecommendations] = useState<CommunityRecommendation[]>([]);
  const [communityError, setCommunityError] = useState<string | null>(null);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityDisplayName, setCommunityDisplayName] = useState("");
  const [communityUserRatings, setCommunityUserRatings] = useState<Record<string, number>>({});
  const [downloadedCommunityProfiles, setDownloadedCommunityProfiles] = useState<DownloadedCommunityProfile[]>([]);
  const [uploadedCommunityProfiles, setUploadedCommunityProfiles] = useState<UploadedCommunityProfile[]>([]);
  const [decentAccount, setDecentAccount] = useState<DecentAccountStatus | null>(null);
  const [communityInitialDraft, setCommunityInitialDraft] = useState<Partial<UploadDraft> | null>(null);
  const [drinkWorkflowRun, setDrinkWorkflowRun] = useState<DrinkWorkflowRunState>(IDLE_DRINK_WORKFLOW_RUN);
  const [selectedPresetWorkflowId, setSelectedPresetWorkflowId] = useState<string | undefined>();
  const [presetEditorMode, setPresetEditorMode] = useState<"profile" | "workflow">("profile");
  const startupProfileApplyRef = useRef<{ profileId: string | null; attempts: number; pending: boolean; complete: boolean }>({
    profileId: null,
    attempts: 0,
    pending: false,
    complete: false
  });
  const manualProfileSelectionRef = useRef<{ version: number; profileId: string | null }>({ version: 0, profileId: null });
  const startupConnectRef = useRef(false);
  const startupRecoveryRef = useRef<Promise<void> | null>(null);
  const deviceConnectionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const foregroundDeviceRecoveryRef = useRef<Promise<void> | null>(null);
  const foregroundDeviceRecoveryLastAtRef = useRef(0);
  const foregroundInteractionAtRef = useRef(Date.now());
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
  const lastHandledShotLifecycleIdRef = useRef<string | null>(null);
  const completedActivityTimerRef = useRef<number | null>(null);
  const ignoreActiveActivityUntilAtRef = useRef(0);
  const readyLogRef = useRef(false);
  const lastLoggedPageRef = useRef<Page | null>(null);
  const lastLoggedMachineModeRef = useRef<string | null>(null);
  const wasSleepingRef = useRef<boolean | null>(null);
  const wakeScreenStartupResetUntilRef = useRef(0);
  const drinkWorkflowRunTokenRef = useRef(0);
  const drinkWorkflowBusyRef = useRef(false);
  const scaleReconnectRef = useRef<{ signature: string | null; lastAttemptAt: number; pending: boolean }>({
    signature: null,
    lastAttemptAt: 0,
    pending: false
  });
  const gatewayModeCheckRef = useRef(false);
  const gatewayModeUpdateRef = useRef(false);
  const api = useMemo(() => new ReaPrimeApi(), []);
  const data = useReaData(api);
  const communityApi = useMemo(() => new CommunityApi(data.settings.communityApiBaseUrl), [data.settings.communityApiBaseUrl]);
  const liveTelemetry = useLiveTelemetry(undefined, { streamScale: page === "live" });
  const scaleLiveConnectedRef = useRef(liveTelemetry.scaleConnected);
  scaleLiveConnectedRef.current = liveTelemetry.scaleConnected;
  const latestShot = data.shots[0] ?? null;
  const nativeDevices = data.devices ?? [];
  const detectedR2Sensor = findDifluidR2Sensor(data.sensors);
  const configuredR2Sensor = data.settings.r2SensorId ? data.sensors.find((sensor) => sensor.id === data.settings.r2SensorId) ?? null : null;
  const r2Sensor = configuredR2Sensor ?? detectedR2Sensor;
  const connectedR2Device = nativeDevices.find(
    (device) => (isConfiguredR2Device(device, data.settings.r2SensorId) || isR2Device(device)) && isConnectedDevice(device)
  );
  const r2DeviceConnected = Boolean(connectedR2Device && r2Sensor);
  const r2Available = Boolean(r2Sensor || data.settings.r2SensorId || connectedR2Device);
  const workflowSelectedProfileId = selectedProfileIdFromWorkflow(data.workflow, data.profiles);
  const selectedProfileId = resolveDisplayedProfileId({
    workflowProfileId: workflowSelectedProfileId,
    startupProfileId: data.settings.startupProfileId,
    startupApplyPending: data.loaded && !startupProfileApplyRef.current.complete,
    startupProfileHoldId,
    manualProfileId: manualProfileSelectionRef.current.profileId
  });
  const displayedProfile = selectedProfileId ? data.profiles.find((profile) => profile.id === selectedProfileId) : undefined;
  const displayWorkflow = displayedProfile && selectedProfileId !== workflowSelectedProfileId
    ? workflowForSelectedProfile(data.workflow, displayedProfile)
    : data.workflow;
  const workflowPageProfileId = selectedProfileId ?? (page === "steam" || page === "review" ? lastCompletedProfileId : undefined);
  const activeProfile = data.profiles.find((profile) => profile.id === workflowPageProfileId);
  const refreshedCompletedReviewShot = completedReviewShot ? data.shots.find((shot) => shot.id === completedReviewShot.id) : undefined;
  const reviewShot = completedReviewLoading
    ? null
    : completedReviewShot
      ? mergeReviewShot(completedReviewShot, refreshedCompletedReviewShot)
      : latestShot;
  const activeProfileWorkflow = profileWorkflowFor(data.settings, workflowPageProfileId);
  const visualizerPlugin = data.plugins?.find((plugin) => plugin.id === "visualizer.reaplugin") ?? null;
  const topLiveMachine = latestMachineSnapshot(liveTelemetry.measurements);
  const liveMachineState = liveTelemetry.machineStreamConnected ? topLiveMachine?.state ?? liveTelemetry.machineMode : null;
  const resolvedMachineMode = resolveMachineModeSnapshot({
    fast: fastMachineState?.state,
    live: liveMachineState,
    liveConnected: liveTelemetry.machineStreamConnected,
    fallback: data.machineState?.state
  });
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
  const presetPickerDrinkWorkflows = useMemo(() => {
    if (editingSlotIndex === null) return data.settings.drinkWorkflows;
    const assignedWorkflowIds = new Set(
      data.settings.presetSlots
        .map((slot, index) => (index === editingSlotIndex ? undefined : slot.drinkWorkflowId))
        .filter((workflowId): workflowId is string => Boolean(workflowId))
    );
    return data.settings.drinkWorkflows.filter((workflow) => !assignedWorkflowIds.has(workflow.id));
  }, [data.settings.drinkWorkflows, data.settings.presetSlots, editingSlotIndex]);
  const machineConnected = Boolean(machineStateForStatus && machineStateForStatus.connected !== false);
  const machineStateForWater: MachineState | null = fastMachineState
    ? ({ ...(data.machineState ?? {}), ...fastMachineState, waterLevels: fastMachineState.waterLevels ?? data.machineState?.waterLevels } as MachineState)
    : data.machineState;
  const currentMachineMode = resolvedMachineMode.state;
  const drinkWorkflowBusy =
    drinkWorkflowRun.phase === "preparing" ||
    drinkWorkflowRun.phase === "starting" ||
    drinkWorkflowRun.phase === "running" ||
    drinkWorkflowRun.phase === "between";
  const waterLow = waterRefillRequired(machineStateForWater, liveTelemetry.waterLevels);
  const waterLowDetail = waterRefillMessage(machineStateForWater, liveTelemetry.waterLevels);
  const machineSleeping = isSleepingMode(currentMachineMode) || isSleepingMachine(data.machineState);
  const sequencedBrewActive = isActiveShotLifecycle(liveTelemetry.shotLifecycle);
  const finishedShotLifecycle = isFinishedShotLifecycle(liveTelemetry.shotLifecycle)
    ? liveTelemetry.shotLifecycle
    : liveTelemetry.latestFinishedShotLifecycle;
  const sequencedBrewFinished = Boolean(
    finishedShotLifecycle &&
    isFinishedShotLifecycle(finishedShotLifecycle) &&
    (finishedShotLifecycle.shotId
      ? finishedShotLifecycle.shotId !== lastHandledShotLifecycleIdRef.current
      : isFinishedShotLifecycle(liveTelemetry.shotLifecycle))
  );
  const brewingCoffee = isBrewingMode(currentMachineMode) || sequencedBrewActive;
  const currentMachineSubstate = resolvedMachineMode.substate;
  const scaleConnectedForShot = liveTelemetry.scaleVerificationActive
    ? liveTelemetry.scaleConnected
    : liveTelemetry.scaleConnected ||
      hasConnectedScale(nativeDevices) ||
      data.machineState?.scaleConnected === true ||
      data.machineState?.scale?.connected === true;
  const scaleShotFallbackActive = useScaleShotFallback({
    api,
    brewing: brewingCoffee,
    machineSubstate: currentMachineSubstate,
    nativeSequencerActive: sequencedBrewActive,
    forceFallback: nativeGatewayMode === "full",
    scaleConnected: scaleConnectedForShot,
    scaleSnapshot: liveTelemetry.scaleSnapshot,
    targetYield: positiveNumber(data.workflow.context?.targetYield)
  });
  const waterRefillAlertSuppressed = brewingCoffee || drinkWorkflowBusy;
  const holdingCompletedBrewOnLivePage = page === "live" && !brewingCoffee && completedActivityRef.current?.activity === "brew";
  const workflowLiveVisible = Boolean(drinkWorkflowRun.workflow && drinkWorkflowBusy);
  const showLivePage = page === "live" && (brewingCoffee || holdingCompletedBrewOnLivePage || workflowLiveVisible);
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
        requireLiveScaleConfirmation: liveTelemetry.scaleVerificationActive,
        waterLevels: liveTelemetry.waterLevels,
        r2SensorId: data.settings.r2SensorId,
        r2Sensor,
        r2Connected: r2DeviceConnected
      }),
    [nativeDevices, machineStateForStatus, data.sensors, data.settings.r2SensorId, liveTelemetry.scaleConnected, liveTelemetry.scaleVerificationActive, liveTelemetry.waterLevels, r2DeviceConnected, r2Sensor]
  );
  const visibleMenuIds = useMemo(
    () => visibleMainMenuItems(data.settings).filter((itemId) => itemId !== "live" || brewingCoffee || holdingCompletedBrewOnLivePage || workflowLiveVisible),
    [brewingCoffee, data.settings.mainMenuItems, data.settings.hiddenMainMenuItemIds, holdingCompletedBrewOnLivePage, workflowLiveVisible]
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

  const enqueueDeviceConnection = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    const result = deviceConnectionQueueRef.current.then(task, task);
    deviceConnectionQueueRef.current = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }, []);

  const connectConfiguredStartupDevices = useCallback(async (
    options: { recovery?: boolean; preferredScaleId?: string | null; singleAttempt?: boolean } = {}
  ) => {
    const recoveryDelays = options.recovery && !options.singleAttempt ? DEVICE_WAKE_RECOVERY_DELAYS_MS : [0];
    for (const delay of recoveryDelays) {
      if (delay > 0) await waitForNativeUpdate(delay);
      const ready = await enqueueDeviceConnection(async () => {
        const scannedDevices = await api.scanDevices({ connect: options.recovery !== true, quick: false }).catch((error) => {
          skinLog("startup_device_scan_failed", { recovery: options.recovery === true, error: errorMessage(error) });
          return [] as DeviceInfo[];
        });
        const listedDevices = await api.listDevices().catch(() => data.devices ?? []);
        const devices = uniqueDevices([...listedDevices, ...scannedDevices]).filter(isAvailableDevice);
        const knownScales = devices.filter((item) => isScaleDeviceCandidate(item) && !isR2Device(item));
        const requiresFreshScale = liveTelemetry.scaleVerificationActive && !scaleLiveConnectedRef.current;

        // Startup lets ReaPrime's connection policy take first choice. Wake
        // recovery is discovery-only and explicitly connects the remembered
        // Scale and R2 after the scan has fully released the native BLE guard.
        const disconnectedMachines = devices.filter((item) => !isConnectedDevice(item) && isMachineDeviceCandidate(item));
        const disconnectedScales = knownScales.filter((item) => !isConnectedDevice(item));
        const preferredScaleId = options.preferredScaleId ?? nativePreferredScaleId;
        const eligibleScales = requiresFreshScale ? knownScales : disconnectedScales;
        const preferredScales = preferredScaleId
          ? eligibleScales.filter((item) => item.id === preferredScaleId)
          : [];
        const scaleCandidates = preferredScales.length > 0
          ? preferredScales
          : eligibleScales.length === 1
            ? eligibleScales
            : [];
        const disconnectedR2 = devices.filter(
          (item) =>
            !isConnectedDevice(item) &&
            (isConfiguredR2Device(item, data.settings.r2SensorId) || (Boolean(data.settings.r2SensorId) && isR2Device(item)))
        );
        const startupCandidates = uniqueDevices([
          ...(options.recovery !== true && disconnectedMachines.length === 1 ? disconnectedMachines : []),
          ...scaleCandidates,
          ...disconnectedR2
        ]);
        for (const device of startupCandidates) {
          await api.connectDevice(device.id).catch((error) => {
            skinLog("startup_device_connect_failed", { deviceId: device.id, error: errorMessage(error) });
          });
        }

        const refreshedDevices = await api.listDevices().catch(() => devices);
        const scaleConfigured = Boolean(preferredScaleId) || knownScales.length > 0;
        const scaleReady =
          !scaleConfigured ||
          (requiresFreshScale ? scaleLiveConnectedRef.current : hasConnectedScale(refreshedDevices));
        const r2Ready =
          !data.settings.r2SensorId ||
          refreshedDevices.some(
            (device) =>
              isAvailableDevice(device) &&
              isConnectedDevice(device) &&
              (isConfiguredR2Device(device, data.settings.r2SensorId) || isR2Device(device))
          );
        return scaleReady && r2Ready;
      });
      if (ready) break;
    }
  }, [api, data.devices, data.settings.r2SensorId, enqueueDeviceConnection, liveTelemetry.scaleVerificationActive, nativePreferredScaleId]);

  const runStartupRecovery = useCallback(
    (options: { resetStartupProfile?: boolean; manualSelectionVersion?: number; recoverDevices?: boolean } = {}) => {
      if (startupRecoveryRef.current) return startupRecoveryRef.current;
      const manualSelectionVersion = options.manualSelectionVersion ?? manualProfileSelectionRef.current.version;

      let recovery: Promise<void>;
      recovery = (async () => {
        await Promise.all([data.refreshConnectivity(), data.refreshWorkflow()]);
        await connectConfiguredStartupDevices();
        await Promise.all([data.refreshConnectivity(), data.refreshWorkflow()]);
        if (options.resetStartupProfile !== false && manualProfileSelectionRef.current.version === manualSelectionVersion) {
          resetStartupProfileApply();
        }
        if (options.recoverDevices) {
          window.setTimeout(() => {
            void connectConfiguredStartupDevices({ recovery: true })
              .then(() => data.refreshConnectivity())
              .catch(() => undefined);
          }, 500);
        }
        window.setTimeout(() => {
          void data.refreshConnectivity();
        }, 1500);
      })().finally(() => {
        if (startupRecoveryRef.current === recovery) startupRecoveryRef.current = null;
      });

      startupRecoveryRef.current = recovery;
      return recovery;
    },
    [connectConfiguredStartupDevices, data.refreshConnectivity, data.refreshWorkflow, resetStartupProfileApply]
  );

  const recoverDevicesAfterForeground = useCallback(() => {
    const now = Date.now();
    if (foregroundDeviceRecoveryRef.current) return foregroundDeviceRecoveryRef.current;
    if (now - foregroundDeviceRecoveryLastAtRef.current < FOREGROUND_DEVICE_RECOVERY_COOLDOWN_MS) {
      return Promise.resolve();
    }
    foregroundDeviceRecoveryLastAtRef.current = now;
    liveTelemetry.reconnect();

    let recovery: Promise<void>;
    recovery = (async () => {
      const foregroundMachineState = await api.getMachineState().catch(() => null);
      if (foregroundMachineState) setFastMachineState(foregroundMachineState);
      await data.refreshConnectivity();

      const nativeSettings = await api.getSettings().catch(() => null);
      const preferredScaleId = nativeSettings?.preferredScaleId ?? nativePreferredScaleId ?? null;
      if (nativeSettings) {
        setNativeGatewayMode(nativeSettings.gatewayMode ?? null);
        setNativePreferredScaleId(preferredScaleId);
      }
      const configuredR2Id = data.settings.r2SensorId;
      const scaleRecoveryWanted =
        Boolean(preferredScaleId) ||
        data.devices.some((device) => isScaleDeviceCandidate(device) && !isR2Device(device)) ||
        data.sensors.some((sensor) => isScaleDeviceCandidate({ id: sensor.id, name: sensor.info?.name, type: "sensor" }));
      if (!scaleRecoveryWanted && !configuredR2Id) return;

      for (const delay of FOREGROUND_DEVICE_RECOVERY_DELAYS_MS) {
        if (delay > 0) await waitForNativeUpdate(delay);

        const latestMachineState = await api.getMachineState().catch(() => data.machineState);
        const latestMode = latestMachineState?.state?.state;
        if (isSleepingMode(latestMode)) continue;
        if (isBrewingMode(latestMode) || drinkWorkflowBusyRef.current) return;

        const [devices, sensors] = await Promise.all([
          api.listDevices().catch(() => data.devices ?? []),
          api.listSensors().catch(() => data.sensors)
        ]);
        const scaleReady =
          !scaleRecoveryWanted ||
          (liveTelemetry.scaleVerificationActive ? scaleLiveConnectedRef.current : hasConnectedScale(devices));
        const r2Ready =
          !configuredR2Id ||
          (Boolean(findDifluidR2Sensor(sensors)) &&
            devices.some(
              (device) =>
                isAvailableDevice(device) &&
                isConnectedDevice(device) &&
                (isConfiguredR2Device(device, configuredR2Id) || isR2Device(device))
            ));
        if (scaleReady && r2Ready) {
          await data.refreshConnectivity();
          return;
        }

        await connectConfiguredStartupDevices({
          recovery: true,
          preferredScaleId,
          singleAttempt: true
        });
        await data.refreshConnectivity();
      }
    })().finally(() => {
      if (foregroundDeviceRecoveryRef.current === recovery) foregroundDeviceRecoveryRef.current = null;
    });

    foregroundDeviceRecoveryRef.current = recovery;
    return recovery;
  }, [api, connectConfiguredStartupDevices, data.devices, data.machineState, data.refreshConnectivity, data.sensors, data.settings.r2SensorId, liveTelemetry.reconnect, liveTelemetry.scaleVerificationActive, nativePreferredScaleId]);

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

    if (machineSleeping || drinkWorkflowBusyRef.current) return;

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
    if (!data.loaded) return;

    const requestRecovery = () => {
      if (page === "screensaver" || document.visibilityState === "hidden") return;
      void recoverDevicesAfterForeground().catch((error) => {
        skinLog("foreground_device_recovery_failed", { error: errorMessage(error) });
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "hidden") requestRecovery();
    };
    const handleInteraction = () => {
      const now = Date.now();
      const idleFor = now - foregroundInteractionAtRef.current;
      foregroundInteractionAtRef.current = now;
      if (idleFor >= FOREGROUND_INTERACTION_IDLE_MS) requestRecovery();
    };

    window.addEventListener("focus", requestRecovery);
    window.addEventListener("pageshow", requestRecovery);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pointerdown", handleInteraction, { passive: true });
    window.addEventListener("touchstart", handleInteraction, { passive: true });
    return () => {
      window.removeEventListener("focus", requestRecovery);
      window.removeEventListener("pageshow", requestRecovery);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pointerdown", handleInteraction);
      window.removeEventListener("touchstart", handleInteraction);
    };
  }, [data.loaded, page, recoverDevicesAfterForeground]);

  useEffect(() => {
    if (!data.loaded || gatewayModeCheckRef.current) return;
    gatewayModeCheckRef.current = true;
    void api
      .getSettings()
      .then((settings) => {
        setNativeGatewayMode(settings.gatewayMode ?? null);
        setNativePreferredScaleId(settings.preferredScaleId ?? null);
      })
      .catch(() => {
        setNativeGatewayMode(null);
        setNativePreferredScaleId(null);
      });
  }, [api, data.loaded]);

  useEffect(() => {
    if (nativeGatewayMode !== "full" || gatewayModeUpdateRef.current || !isIdleMode(currentMachineMode)) return;
    gatewayModeUpdateRef.current = true;
    void api
      .updateSettings({ gatewayMode: "tracking" })
      .then(() => {
        setNativeGatewayMode("tracking");
        skinLog("gateway_mode_restored_for_scale_control", { previousMode: "full", mode: "tracking" });
      })
      .catch((error) => {
        skinLog("gateway_mode_restore_failed", { error: errorMessage(error) });
      });
  }, [api, currentMachineMode, nativeGatewayMode]);

  useEffect(() => {
    if (scaleShotFallbackActive) {
      skinLog("scale_shot_fallback_active", {
        gatewayMode: nativeGatewayMode ?? null,
        machineSubstate: currentMachineSubstate ?? null
      });
    }
  }, [currentMachineSubstate, nativeGatewayMode, scaleShotFallbackActive]);

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
    if (drinkWorkflowBusyRef.current) return;
    if (brewingCoffee) setPage("live");
  }, [brewingCoffee, data.loaded, page]);

  useEffect(() => {
    if (!data.loaded || page !== "live" || brewingCoffee) return;
    if (drinkWorkflowBusyRef.current) return;
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
      liveMode: liveTelemetry.machineStreamConnected ? liveTelemetry.machineMode?.state : undefined,
      hasCompletedActivity: Boolean(completedActivityRef.current) || sequencedBrewActive || sequencedBrewFinished
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
  }, [api, currentMachineMode, data.loaded, liveTelemetry.machineMode?.state, liveTelemetry.machineStreamConnected, page, sequencedBrewActive, sequencedBrewFinished]);

  const routeCompletedActivity = useCallback(
    async (completed: CompletedActivityCapture) => {
      if (completedActivityRoutingRef.current) return;
      completedActivityRoutingRef.current = true;
      if (completed.shotId) lastHandledShotLifecycleIdRef.current = completed.shotId;
      try {
        if (completed.activity === "brew") {
          setCompletedReviewLoading(true);
          setCompletedReviewShot(null);
          setPage("review");
        }
        await data.refresh();
        if (completed.activity === "brew") {
          const latestCompletedShot = await loadCompletedShot(api, completed, latestShot);
          if (!latestCompletedShot || (completed.startLatestShotId !== undefined && latestCompletedShot.id === completed.startLatestShotId)) {
            if (completed.shotId || liveTelemetry.measurements.length > 0) {
              const pendingShotId = completed.shotId ?? `workflow-pending-${Date.now()}`;
              const pendingShot: ShotRecord = {
                id: pendingShotId,
                timestamp: new Date().toISOString(),
                workflow: data.workflow,
                measurements: liveTelemetry.measurements,
                ...(completed.shotId
                  ? {}
                  : { metadata: { workflowSkinPendingStartShotId: completed.startLatestShotId ?? latestShot?.id ?? null } })
              };
              setCompletedReviewShot(pendingShot);
              setLastCompletedProfileId(completed.profileId ?? selectedProfileIdFromWorkflow(data.workflow, data.profiles));
              ignoreActiveActivityUntilAtRef.current = Date.now() + POST_ACTIVITY_RECAPTURE_COOLDOWN_MS;
              skinLog("brew_completed_pending_persistence", { shotId: completed.shotId ?? null, pendingShotId });
              setPage("review");
              return;
            }

            setCompletedReviewShot(null);
            setAutoReadR2ShotId(null);
            autoReadR2ShotIdRef.current = null;
            ignoreActiveActivityUntilAtRef.current = Date.now() + POST_ACTIVITY_RECAPTURE_COOLDOWN_MS;
            skinLog("brew_ended_without_saved_shot", { startLatestShotId: completed.startLatestShotId ?? null });
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
        setCompletedReviewLoading(false);
        completedActivityRoutingRef.current = false;
      }
    },
    [api, data.profiles, data.refresh, data.workflow, latestShot, liveTelemetry.measurements, r2Available]
  );

  useEffect(() => {
    const startingShotId = pendingPersistenceStartShotId(completedReviewShot);
    if (startingShotId === undefined || !latestShot || latestShot.id === startingShotId) return;
    const persistedShot = shotWithFallbackMeasurements(latestShot, completedReviewShot?.measurements ?? liveTelemetry.measurements);
    setCompletedReviewShot(persistedShot);
    setLastCompletedProfileId(selectedProfileIdFromWorkflow(persistedShot.workflow, data.profiles));
    skinLog("brew_pending_persistence_resolved", { shotId: persistedShot.id });
  }, [completedReviewShot, data.profiles, latestShot, liveTelemetry.measurements]);

  useEffect(() => {
    if (!data.loaded) return;

    if (drinkWorkflowBusyRef.current) {
      completedActivityRef.current = null;
      if (completedActivityTimerRef.current !== null) {
        window.clearTimeout(completedActivityTimerRef.current);
        completedActivityTimerRef.current = null;
      }
      return;
    }

    if (
      sequencedBrewFinished &&
      finishedShotLifecycle?.shotId &&
      !completedActivityRef.current &&
      Date.now() >= ignoreActiveActivityUntilAtRef.current
    ) {
      completedActivityRef.current = {
        activity: "brew",
        profileId: selectedProfileId,
        startLatestShotId: idleLatestShotIdRef.current,
        shotId: finishedShotLifecycle.shotId
      };
    }

    const completedByShotLifecycle = completedActivityRef.current?.activity === "brew" && sequencedBrewFinished;
    const modeActivity = workflowActivityForMode(currentMachineMode);
    const activeActivity = sequencedBrewActive ? "brew" : sequencedBrewFinished && modeActivity === "brew" ? null : modeActivity;
    if (activeActivity) {
      if (completedActivityRoutingRef.current) return;
      if (Date.now() < ignoreActiveActivityUntilAtRef.current) return;
      if (completedActivityRef.current?.activity !== activeActivity) {
        completedActivityRef.current = {
          activity: activeActivity,
          profileId: selectedProfileId,
          startLatestShotId: activeActivity === "brew" ? idleLatestShotIdRef.current : undefined,
          shotId: activeActivity === "brew" ? liveTelemetry.shotLifecycle?.shotId ?? undefined : undefined
        };
      } else if (activeActivity === "brew" && !completedActivityRef.current.shotId && liveTelemetry.shotLifecycle?.shotId) {
        completedActivityRef.current = { ...completedActivityRef.current, shotId: liveTelemetry.shotLifecycle.shotId };
      }
      if (completedActivityTimerRef.current !== null) {
        window.clearTimeout(completedActivityTimerRef.current);
        completedActivityTimerRef.current = null;
      }
      return;
    }

    if (!isIdleMode(currentMachineMode) && !completedByShotLifecycle) return;
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
  }, [
    currentMachineMode,
    data.loaded,
    latestShot?.id,
    liveTelemetry.shotLifecycle,
    finishedShotLifecycle,
    routeCompletedActivity,
    selectedProfileId,
    sequencedBrewActive,
    sequencedBrewFinished
  ]);

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

    if (waterRefillAlertSuppressed) {
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
  }, [waterLow, waterRefillAcknowledged, waterRefillAlertSuppressed, waterRefillVisible]);

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

  const saveDrinkWorkflow = async (workflow: DrinkWorkflow) => {
    const errors = validateDrinkWorkflow(workflow, new Set(data.profiles.map((profile) => profile.id)));
    if (errors.length > 0) throw new Error(errors[0].message);
    const exists = data.settings.drinkWorkflows.some((item) => item.id === workflow.id);
    const drinkWorkflows = exists
      ? data.settings.drinkWorkflows.map((item) => (item.id === workflow.id ? workflow : item))
      : [...data.settings.drinkWorkflows, workflow];
    try {
      await data.persistSettings({ ...data.settings, drinkWorkflows });
      setStatus({ type: "success", message: `${workflow.name} saved.` });
    } catch (error) {
      setStatus({ type: "error", message: `Could not save Work Flow: ${errorMessage(error)}` });
      throw error;
    }
  };

  const deleteDrinkWorkflow = async (workflowId: string) => {
    const workflow = data.settings.drinkWorkflows.find((item) => item.id === workflowId);
    try {
      await data.persistSettings({
        ...data.settings,
        drinkWorkflows: data.settings.drinkWorkflows.filter((item) => item.id !== workflowId),
        presetSlots: data.settings.presetSlots.map((slot) => {
          if (slot.drinkWorkflowId !== workflowId) return slot;
          const { drinkWorkflowId: _drinkWorkflowId, ...rest } = slot;
          return rest;
        })
      });
      setSelectedPresetWorkflowId((current) => (current === workflowId ? undefined : current));
      setStatus({ type: "success", message: `${workflow?.name ?? "Work Flow"} deleted.` });
    } catch (error) {
      setStatus({ type: "error", message: `Could not delete Work Flow: ${errorMessage(error)}` });
      throw error;
    }
  };

  const startDrinkWorkflow = async (workflow: DrinkWorkflow) => {
    if (drinkWorkflowBusyRef.current) return;
    const errors = validateDrinkWorkflow(workflow, new Set(data.profiles.map((profile) => profile.id)));
    if (errors.length > 0) {
      setStatus({ type: "error", message: errors[0].message });
      return;
    }
    if (!machineConnected) {
      setStatus({ type: "error", message: "Connect the machine before starting a Work Flow." });
      return;
    }
    if (waterLow) {
      setStatus({ type: "error", message: "Refill the water tank before starting a Work Flow." });
      return;
    }
    if (!isIdleMode(currentMachineMode)) {
      setStatus({ type: "error", message: "Wait for the machine to become idle before starting a Work Flow." });
      return;
    }

    const token = drinkWorkflowRunTokenRef.current + 1;
    drinkWorkflowRunTokenRef.current = token;
    drinkWorkflowBusyRef.current = true;
    completedActivityRef.current = null;
    completedActivityRoutingRef.current = false;
    if (completedActivityTimerRef.current !== null) {
      window.clearTimeout(completedActivityTimerRef.current);
      completedActivityTimerRef.current = null;
    }
    setStatus(null);
    setPage("live");
    setDrinkWorkflowRun({ workflow, currentStepIndex: 0, phase: "preparing", message: `Preparing ${workflow.name}.` });
    skinLog("drink_workflow_started", { workflowId: workflow.id, name: workflow.name, steps: workflow.steps.map((step) => step.type) });

    try {
      const result = await executeDrinkWorkflow({
        api,
        workflow,
        profiles: data.profiles,
        isCanceled: () => drinkWorkflowRunTokenRef.current !== token,
        onState: (next) => {
          if (drinkWorkflowRunTokenRef.current === token) setDrinkWorkflowRun(next);
        },
        onBrewProfileSelected: (profileId) => {
          manualProfileSelectionRef.current = { version: manualProfileSelectionRef.current.version + 1, profileId };
          startupProfileApplyRef.current = { ...startupProfileApplyRef.current, pending: false, complete: true };
          setStartupProfileHoldId(null);
        },
        onWorkflowUpdated: data.setWorkflow,
        getScaleSnapshot: liveTelemetry.getLatestScaleSnapshot
      });
      if (drinkWorkflowRunTokenRef.current === token) {
        const completedAt = new Date().toISOString();
        let reviewTarget: ShotRecord | null = null;
        let detailSaveFailures = 0;
        for (const runShot of result.brewShots) {
          const fullShot = await api.getShot(runShot.id).catch(() => runShot);
          const taggedShot = attachDrinkWorkflowToShot(fullShot, workflow, data.profiles, completedAt);
          try {
            const updatedShot = await api.updateShot(taggedShot.id, { workflow: taggedShot.workflow });
            reviewTarget = mergeReviewShot(taggedShot, updatedShot) ?? taggedShot;
          } catch (error) {
            detailSaveFailures += 1;
            reviewTarget = taggedShot;
            skinLog("drink_workflow_shot_details_save_failed", { workflowId: workflow.id, shotId: taggedShot.id, error: errorMessage(error) });
          }
        }

        skinLog("drink_workflow_completed", { workflowId: workflow.id, brewShotIds: result.brewShots.map((shot) => shot.id), detailSaveFailures });
        if (reviewTarget) {
          setCompletedReviewShot(reviewTarget);
          setLastCompletedProfileId(selectedProfileIdFromWorkflow(reviewTarget.workflow, data.profiles));
          if (r2Available) {
            autoReadR2ShotIdRef.current = reviewTarget.id;
            setAutoReadR2ShotId(reviewTarget.id);
          }
          setPage("review");
        }
        setStatus(
          detailSaveFailures > 0
            ? { type: "error", message: `${workflow.name} finished. Save the review to retry saving its Work Flow details.` }
            : { type: "success", message: `${workflow.name} complete.` }
        );
      }
    } catch (error) {
      if (error instanceof DrinkWorkflowCanceledError || drinkWorkflowRunTokenRef.current !== token) return;
      const message = errorMessage(error);
      setDrinkWorkflowRun((current) => ({ ...current, workflow, currentStepIndex: Math.max(0, current.currentStepIndex), phase: "error", message }));
      setStatus({ type: "error", message });
      setPage("workflows");
      skinLog("drink_workflow_failed", { workflowId: workflow.id, error: message });
      await api.requestMachineState("idle").catch(() => undefined);
    } finally {
      if (drinkWorkflowRunTokenRef.current === token) drinkWorkflowBusyRef.current = false;
      await data.refresh().catch(() => undefined);
    }
  };

  const cancelDrinkWorkflow = async () => {
    const workflow = drinkWorkflowRun.workflow;
    if (!workflow || !drinkWorkflowBusyRef.current) return;
    drinkWorkflowRunTokenRef.current += 1;
    drinkWorkflowBusyRef.current = false;
    setDrinkWorkflowRun((current) => ({ ...current, phase: "canceled", message: `${workflow.name} canceled.` }));
    setPage("workflows");
    skinLog("drink_workflow_canceled", { workflowId: workflow.id, currentStepIndex: drinkWorkflowRun.currentStepIndex });
    try {
      await api.requestMachineState("idle");
      setStatus({ type: "success", message: `${workflow.name} canceled.` });
    } catch (error) {
      setStatus({ type: "error", message: `Work Flow canceled, but the machine did not confirm idle: ${errorMessage(error)}` });
    }
    await data.refresh().catch(() => undefined);
  };

  const setProfileShown = async (profileId: string, shown: boolean) => {
    const shownProfileIds = shown
      ? Array.from(new Set([...data.settings.shownProfileIds, profileId]))
      : data.settings.shownProfileIds.filter((id) => id !== profileId);
    await persistSettings({ ...data.settings, shownProfileIds }, "Profile visibility saved.");
  };

  const refreshR2Sensor = async (options: { forceConfiguredConnect?: boolean } = {}) => {
    setR2RefreshBusy(true);
    setStatus({ type: "success", message: "Looking for DiFluid R2." });
    try {
      await enqueueDeviceConnection(async () => {
        await wakeMachineIfNeeded(api, data.machineState);
        const discovery = await discoverAvailableDevices(api, {
          fallbackDevices: data.devices ?? [],
          predicate: (device) => isR2Device(device) || isConfiguredR2Device(device, data.settings.r2SensorId),
          attempts: MANUAL_DEVICE_DISCOVERY_ATTEMPTS,
          onRetry: () => setStatus({ type: "success", message: "Still scanning for DiFluid R2." })
        });
        const r2Devices = discovery.devices
          .filter(
            (device) =>
              isAvailableDevice(device) &&
              (isR2Device(device) || isConfiguredR2Device(device, data.settings.r2SensorId))
          )
          .sort((left, right) => {
            const leftConfigured = isConfiguredR2Device(left, data.settings.r2SensorId) ? 1 : 0;
            const rightConfigured = isConfiguredR2Device(right, data.settings.r2SensorId) ? 1 : 0;
            return rightConfigured - leftConfigured;
          });

        if (r2Devices.length === 0) {
          await data.refreshConnectivity();
          if (discovery.firstError) throw discovery.firstError;
          skinLog("r2_manual_scan_not_found", { configuredDeviceId: data.settings.r2SensorId });
          setStatus({ type: "error", message: "No available DiFluid R2 was found. Keep it awake and tap R2 again." });
          return;
        }

        let firstConnectError: unknown = null;
        for (const device of r2Devices) {
          const sensorAlreadyUsable =
            data.sensors.some((sensor) => sensor.id === device.id) ||
            Boolean(findDifluidR2Sensor(data.sensors));
          if (!isConnectedDevice(device) || (options.forceConfiguredConnect === true && !sensorAlreadyUsable)) {
            try {
              await api.connectDevice(device.id);
            } catch (error) {
              firstConnectError ??= error;
              skinLog("r2_manual_connect_failed", { deviceId: device.id, error: errorMessage(error) });
              continue;
            }
          }

          for (const delay of DEVICE_CONNECTION_VERIFY_DELAYS_MS) {
            if (delay > 0) await waitForNativeUpdate(delay);
            const [verifiedDevices, sensors] = await Promise.all([
              api.listDevices().catch(() => [] as DeviceInfo[]),
              api.listSensors().catch(() => [] as SensorListItem[])
            ]);
            const connectedDevice = verifiedDevices.some(
              (item) => item.id === device.id && isAvailableDevice(item) && isConnectedDevice(item)
            );
            const connectedSensor = sensors.find((sensor) => sensor.id === device.id) ?? findDifluidR2Sensor(sensors);
            if (!connectedSensor) {
              if (connectedDevice) skinLog("r2_device_connected_sensor_pending", { deviceId: device.id });
              continue;
            }

            const sensorId = connectedSensor.id;
            await data.persistSettings({ ...data.settings, r2SensorId: sensorId });
            await data.refreshConnectivity();
            skinLog("r2_manual_connect_confirmed", { deviceId: sensorId, forced: options.forceConfiguredConnect === true });
            setStatus({ type: "success", message: "R2 connected." });
            return;
          }
        }

        await data.refreshConnectivity();
        if (firstConnectError) {
          throw firstConnectError;
        }
        setStatus({ type: "error", message: "R2 was found but did not report connected. Keep it awake and tap R2 again." });
      });
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
          if (index === editingSlotIndex) {
            const { drinkWorkflowId: _drinkWorkflowId, ...rest } = item;
            return { ...rest, profileId: profile.id };
          }
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

  const assignPresetDrinkWorkflow = async (drinkWorkflow: DrinkWorkflow) => {
    if (editingSlotIndex === null) return;
    const slot = data.settings.presetSlots[editingSlotIndex];
    if (!slot) return;

    try {
      await data.persistSettings({
        ...data.settings,
        presetSlots: data.settings.presetSlots.map((item, index) => {
          if (index === editingSlotIndex) {
            const { profileId: _profileId, ...rest } = item;
            return { ...rest, drinkWorkflowId: drinkWorkflow.id };
          }
          if (item.drinkWorkflowId !== drinkWorkflow.id) return item;
          const { drinkWorkflowId: _drinkWorkflowId, ...rest } = item;
          return rest;
        })
      });
      setSelectedPresetWorkflowId(drinkWorkflow.id);
      setStatus({ type: "success", message: `Preset ${slot.label} set to ${drinkWorkflow.name}.` });
      setEditingSlotIndex(null);
    } catch (error) {
      setStatus({ type: "error", message: `Could not save preset: ${errorMessage(error)}` });
    }
  };

  const applyProfileForBrew = async (profile: ProfileRecord) => {
    setSelectedPresetWorkflowId(undefined);
    manualProfileSelectionRef.current = { version: manualProfileSelectionRef.current.version + 1, profileId: profile.id };
    setStartupProfileHoldId(null);
    startupProfileApplyRef.current = { ...startupProfileApplyRef.current, pending: false, complete: true };
    await applyProfile(profile, { optimistic: true });
    setLastUseAt(Date.now());
  };

  const requestScaleConnection = useCallback(async (
    options: { discoveryAttempts?: number; onDiscoveryRetry?: (attempt: number) => void; forceDiscovery?: boolean } = {}
  ) => {
    return enqueueDeviceConnection(async () => {
      const scaleReady = (devices: DeviceInfo[]) =>
        hasConnectedScale(devices) &&
        (!liveTelemetry.scaleVerificationActive || scaleLiveConnectedRef.current);
      await wakeMachineIfNeeded(api, data.machineState);
      const initialDevices = (await api.listDevices().catch(() => data.devices ?? [])).filter(isAvailableDevice);
      if (scaleReady(initialDevices)) {
        await data.refreshConnectivity();
        return { connected: true, requested: false, found: true, firstError: null };
      }

      let requested = false;
      let firstError: unknown = null;
      let refreshedDevices = initialDevices;
      const managedRecovery = appVersionAtLeast(data.appInfo?.version, MANAGED_SCALE_RECOVERY_MIN_VERSION);
      if (managedRecovery && !options.forceDiscovery) {
        try {
          const scannedDevices = await api.scanDevices({ connect: true, quick: false });
          const listedDevices = await api.listDevices().catch(() => scannedDevices);
          refreshedDevices = uniqueDevices([...listedDevices, ...scannedDevices]).filter(isAvailableDevice);
          requested = true;
          if (scaleReady(refreshedDevices)) {
            await data.refreshConnectivity();
            skinLog("scale_managed_connect_confirmed", { appVersion: data.appInfo?.version ?? null });
            return { connected: true, requested, found: true, firstError };
          }
        } catch (error) {
          firstError = error;
          skinLog("scale_managed_connect_failed", { appVersion: data.appInfo?.version ?? null, error: errorMessage(error) });
        }
      }

      let scaleDevices = refreshedDevices.filter((device) => isScaleDeviceCandidate(device) && !isR2Device(device));
      if (options.forceDiscovery || !managedRecovery || scaleDevices.length === 0) {
        const discovery = await discoverAvailableDevices(api, {
          fallbackDevices: refreshedDevices,
          predicate: (device) => isScaleDeviceCandidate(device) && !isR2Device(device),
          attempts: options.discoveryAttempts,
          onRetry: options.onDiscoveryRetry
        });
        firstError ??= discovery.firstError;
        refreshedDevices = uniqueDevices([...refreshedDevices, ...discovery.devices]).filter(isAvailableDevice);
        scaleDevices = refreshedDevices.filter((device) => isScaleDeviceCandidate(device) && !isR2Device(device));
      }

      if (scaleReady(refreshedDevices)) {
        await data.refreshConnectivity();
        return { connected: true, requested, found: true, firstError };
      }

      for (const device of scaleDevices.filter((item) => !isConnectedDevice(item) || !scaleLiveConnectedRef.current)) {
        try {
          await api.connectDevice(device.id);
          requested = true;
        } catch (error) {
          firstError ??= error;
          skinLog("scale_manual_connect_failed", { deviceId: device.id, error: errorMessage(error) });
          continue;
        }

        for (const delay of DEVICE_CONNECTION_VERIFY_DELAYS_MS) {
          if (delay > 0) await waitForNativeUpdate(delay);
          refreshedDevices = (await api.listDevices().catch(() => refreshedDevices)).filter(isAvailableDevice);
          if (!scaleReady(refreshedDevices)) continue;

          await data.refreshConnectivity();
          skinLog("scale_manual_connect_confirmed", { deviceId: device.id });
          return { connected: true, requested, found: true, firstError };
        }
      }

      await data.refreshConnectivity();
      return {
        connected: scaleReady(refreshedDevices),
        requested,
        found: scaleDevices.length > 0,
        firstError
      };
    });
  }, [api, data.appInfo?.version, data.devices, data.machineState, data.refreshConnectivity, enqueueDeviceConnection, liveTelemetry.scaleVerificationActive]);

  useEffect(() => {
    if (!data.loaded) return;
    const wasSleeping = wasSleepingRef.current;
    wasSleepingRef.current = machineSleeping;
    if (wasSleeping !== true || machineSleeping) return;

    if (Date.now() <= wakeScreenStartupResetUntilRef.current) {
      wakeScreenStartupResetUntilRef.current = 0;
      return;
    }

    void runStartupRecovery({ recoverDevices: true }).catch(() => undefined);
  }, [data.loaded, machineSleeping, runStartupRecovery]);

  useEffect(() => {
    if (!data.loaded || page === "screensaver" || machineSleeping) return;
    if (!isIdleMode(currentMachineMode)) return;
    const disconnectedScales = disconnectedScaleDevices(nativeDevices);
    const knownScales = nativeDevices.filter((device) => isScaleDeviceCandidate(device) && !isR2Device(device));
    const missingFreshScale =
      liveTelemetry.scaleVerificationActive &&
      !liveTelemetry.scaleConnected &&
      knownScales.length > 0;
    if (!missingFreshScale && (disconnectedScales.length === 0 || hasConnectedScale(nativeDevices))) {
      scaleReconnectRef.current.signature = null;
      return;
    }

    const signature = deviceIdSignature(disconnectedScales.length > 0 ? disconnectedScales : knownScales);
    const now = Date.now();
    const reconnectState = scaleReconnectRef.current;
    if (reconnectState.pending) return;
    if (reconnectState.signature === signature && now - reconnectState.lastAttemptAt < SCALE_RECONNECT_COOLDOWN_MS) return;

    reconnectState.signature = signature;
    reconnectState.lastAttemptAt = now;
    reconnectState.pending = true;
    void requestScaleConnection({ discoveryAttempts: 1, forceDiscovery: true })
      .catch(() => undefined)
      .finally(() => {
        scaleReconnectRef.current.pending = false;
      });
  }, [currentMachineMode, data.loaded, liveTelemetry.scaleConnected, liveTelemetry.scaleVerificationActive, machineSleeping, nativeDevices, page, requestScaleConnection]);

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
      const currentShot =
        (completedReviewShot?.id === shotId ? completedReviewShot : undefined) ??
        (reviewShot?.id === shotId ? reviewShot : undefined) ??
        data.shots.find((shot) => shot.id === shotId);
      const workflow = currentShot && drinkWorkflowDetailsFromShot(currentShot) ? currentShot.workflow : undefined;
      const updatedShot = await api.updateShot(shotId, { annotations, ...(workflow ? { workflow } : {}) });
      if (completedReviewShot?.id === shotId) setCompletedReviewShot((current) => mergeReviewShot(current, updatedShot));
      await data.refresh();
      setStatus({ type: "success", message: workflow ? "Work Flow review saved." : "Review saved." });
    } catch (error) {
      setStatus({ type: "error", message: `Could not save review: ${errorMessage(error)}` });
    }
  };

  const saveReviewShotBag = async (shotId: string, bagId: string) => {
    try {
      const bag = data.bags.find((item) => item.id === bagId);
      const currentShot =
        (completedReviewShot?.id === shotId ? completedReviewShot : undefined) ??
        (reviewShot?.id === shotId ? reviewShot : undefined) ??
        data.shots.find((item) => item.id === shotId);
      const context = { ...(currentShot?.workflow.context ?? {}) };

      if (bagId) {
        context.beanBatchId = bagId;
        context.coffeeName = bag?.bean;
        context.coffeeRoaster = bag?.roaster;
      } else {
        delete context.beanBatchId;
        delete context.coffeeName;
        delete context.coffeeRoaster;
      }

      const workflow: Workflow = {
        ...(currentShot?.workflow ?? {}),
        context
      };
      const updatedShot = await api.updateShot(shotId, { workflow });
      setCompletedReviewShot((current) => (current?.id === shotId ? { ...current, workflow: updatedShot.workflow ?? workflow } : current));
      await data.refresh();
    } catch (error) {
      setStatus({ type: "error", message: `Could not save review bag: ${errorMessage(error)}` });
      throw error;
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
    return enqueueDeviceConnection(async () => {
      await wakeMachineIfNeeded(api, data.machineState);
      const scannedDevices = await api.scanDevices({ connect: false, quick: false }).catch(() => [] as DeviceInfo[]);
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
    });
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
    await api.releaseWakeLock().catch((error) => {
      skinLog("screensaver_wakelock_release_failed", { error: errorMessage(error) });
    });

    let lastError: unknown = null;
    for (const delay of DISPLAY_BRIGHTNESS_VERIFY_DELAYS_MS) {
      if (delay > 0) await waitForNativeUpdate(delay);
      try {
        const display = await api.setDisplayBrightness(brightness);
        const requestedBrightness = display.requestedBrightness ?? display.brightness;
        skinLog("screensaver_brightness_applied", {
          configuredBrightness: brightness,
          requestedBrightness,
          appliedBrightness: display.brightness,
          supported: display.platformSupported?.brightness
        });
        if (requestedBrightness === brightness || display.platformSupported?.brightness === false) return;
      } catch (error) {
        lastError = error;
      }
    }

    skinLog("screensaver_brightness_unconfirmed", {
      configuredBrightness: brightness,
      error: lastError ? errorMessage(lastError) : undefined
    });
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
    await runStartupRecovery({ manualSelectionVersion, recoverDevices: true });
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
      const result = await requestScaleConnection({
        discoveryAttempts: MANUAL_DEVICE_DISCOVERY_ATTEMPTS,
        onDiscoveryRetry: () => setStatus({ type: "success", message: "Still scanning for scale." }),
        forceDiscovery: true
      });
      if (result.connected) {
        setStatus({ type: "success", message: "Scale connected." });
        return;
      }

      if (!result.found) {
        if (result.firstError) throw result.firstError;
        setStatus({ type: "error", message: "No scale found after scan." });
        return;
      }

      if (result.firstError) throw result.firstError;
      setStatus({
        type: "error",
        message: result.requested
          ? "Scale was found but did not report connected. Keep it awake and tap Scale again."
          : "Scale was found but could not be connected. Keep it awake and tap Scale again."
      });
    } catch (error) {
      setStatus({ type: "error", message: `Could not connect scale: ${errorMessage(error)}` });
    }
  };

  const tareScaleFromIndicator = async () => {
    setExpandedStatusId(null);
    setStatus({ type: "success", message: "Taring scale." });
    try {
      await api.tareScale();
      await data.refreshConnectivity();
      setStatus({ type: "success", message: "Scale tared." });
    } catch (error) {
      skinLog("scale_tare_from_indicator_failed", { error: errorMessage(error) });
      try {
        const result = await requestScaleConnection({
          discoveryAttempts: MANUAL_DEVICE_DISCOVERY_ATTEMPTS,
          onDiscoveryRetry: () => setStatus({ type: "success", message: "Still scanning for scale." }),
          forceDiscovery: true
        });
        if (result.connected) {
          await api.tareScale();
          await data.refreshConnectivity();
          setStatus({ type: "success", message: "Scale connected and tared." });
          return;
        }
        if (result.requested || result.found) {
          setStatus({ type: "error", message: "Scale did not report connected. Keep it awake and tap Scale again." });
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
      if (!r2RefreshBusy) void refreshR2Sensor({ forceConfiguredConnect: true });
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
    return (
      <ScreensaverPage
        title={data.settings.skinTitle}
        brightness={screensaverBrightnessValue(data.settings.screensaverBrightness)}
        onWake={() => void wakeScreen()}
      />
    );
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
      {waterLow && waterRefillVisible && !waterRefillAcknowledged && !waterRefillAlertSuppressed && (
        <WaterRefillOverlay detail={waterLowDetail} onConfirm={confirmWaterRefill} />
      )}
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
          disabled={!machineConnected || sleepPending || drinkWorkflowBusyRef.current}
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
        {page === "brew" && !data.loaded && (
          <div className="panel wide brew-startup-loading" role="status" aria-live="polite">
            <strong>Loading presets…</strong>
            <span>Connecting to your saved workflow.</span>
          </div>
        )}
        {page === "brew" && data.loaded && (
          <BrewPage
            workflow={displayWorkflow}
            profiles={data.profiles}
            bags={data.bags}
            shots={data.shots}
            settings={data.settings}
            drinkWorkflows={data.settings.drinkWorkflows}
            selectedDrinkWorkflowId={selectedPresetWorkflowId}
            drinkWorkflowBusy={drinkWorkflowBusy}
            onApplyProfile={(profile) => {
              void applyProfileForBrew(profile);
            }}
            onSelectDrinkWorkflow={(workflow) => {
              setSelectedPresetWorkflowId(workflow.id);
              setStatus({ type: "success", message: `${workflow.name} selected.` });
            }}
            onActivateDrinkWorkflow={(workflow) => {
              void startDrinkWorkflow(workflow);
            }}
            onEditSlot={(index) => {
              setStatus(null);
              setPresetEditorMode(data.settings.presetSlots[index]?.drinkWorkflowId ? "workflow" : "profile");
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
        {page === "workflows" && (
          <WorkflowsPage
            workflows={data.settings.drinkWorkflows}
            profiles={data.profiles}
            run={drinkWorkflowRun}
            onSave={saveDrinkWorkflow}
            onDelete={deleteDrinkWorkflow}
            onStart={startDrinkWorkflow}
            onCancel={cancelDrinkWorkflow}
          />
        )}
        {showLivePage && (
          <LivePage
            workflow={data.workflow}
            activeProfile={activeProfile}
            latestShot={reviewShot ?? latestShot}
            liveMeasurements={liveTelemetry.measurements}
            scaleSnapshot={liveTelemetry.scaleSnapshot}
            drinkWorkflowRun={workflowLiveVisible ? drinkWorkflowRun : undefined}
            drinkWorkflowProfiles={data.profiles}
            onCancelDrinkWorkflow={cancelDrinkWorkflow}
          />
        )}
        {page === "review" &&
          (reviewShot ? (
            <ReviewPage
              key={reviewShot.id}
              shot={reviewShot}
              previousShots={data.shots}
              onSaveAnnotations={saveReview}
              onSaveShotBag={saveReviewShotBag}
              onUploadVisualizer={uploadReviewToVisualizer}
              r2Sensor={r2Sensor}
              r2Available={r2Available}
              onReadR2={readR2}
              autoReadR2={autoReadR2ShotId === reviewShot.id}
              autoReadR2DelaySeconds={data.settings.r2MeasureDelaySeconds}
              grinders={data.grinders ?? []}
              defaultGrinderId={data.settings.defaultGrinderId ?? data.settings.lastGrinderId}
              bags={data.bags}
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
              <div className="preset-source-tabs" role="tablist" aria-label="Preset type">
                <button
                  type="button"
                  role="tab"
                  aria-selected={presetEditorMode === "profile"}
                  className={presetEditorMode === "profile" ? "active" : ""}
                  onClick={() => setPresetEditorMode("profile")}
                >
                  Profile
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={presetEditorMode === "workflow"}
                  className={presetEditorMode === "workflow" ? "active" : ""}
                  onClick={() => setPresetEditorMode("workflow")}
                >
                  Work Flow
                </button>
              </div>
              {presetEditorMode === "profile" && (
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
              )}
              {presetEditorMode === "workflow" && (
                <div className="profile-picker" aria-label={`Choose a Work Flow for ${editingSlot.label}`}>
                  {data.settings.drinkWorkflows.length === 0 && <p className="muted">No saved Work Flows.</p>}
                  {data.settings.drinkWorkflows.length > 0 && presetPickerDrinkWorkflows.length === 0 && (
                    <p className="muted">All saved Work Flows are already assigned to other presets.</p>
                  )}
                  {presetPickerDrinkWorkflows.map((workflow) => (
                    <button
                      key={workflow.id}
                      type="button"
                      className="list-row"
                      aria-label={`Use Work Flow ${workflow.name}`}
                      onClick={() => {
                        void assignPresetDrinkWorkflow(workflow);
                      }}
                    >
                      <strong>{workflow.name}</strong>
                      <span>{workflow.id === editingSlot.drinkWorkflowId ? "Current Work Flow" : workflow.steps.map((step) => drinkWorkflowStepLabel(step)).join(" / ")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
