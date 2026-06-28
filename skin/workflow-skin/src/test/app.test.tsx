import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import skinManifest from "../../skin-manifest.json";
import { App } from "../App";
import type { AppInfo, Bean, BeanBatch, DecentAccountStatus, DeviceInfo, Grinder, MachineState, ProfileRecord, SensorListItem, ShotRecord } from "../api/types";
import type { CommunityDownloadPayload, CommunityRecommendation } from "../community/types";
import { defaultSkinSettings, type SkinSettings } from "../state/skinSettings";

let profiles: ProfileRecord[] = [
  { id: "p1", profile: { title: "Blooming" } },
  { id: "p2", profile: { title: "Classic" } }
];

type DeviceScanContext = { machineState: MachineState; quick: boolean; quickParam: boolean | undefined; scanCount: number; connectCount: number };
type DeviceScanRequest = { path: string; quick: boolean; connect: boolean };

const communityRecommendation: CommunityRecommendation = {
  id: "rec-12345678",
  createdAt: "2026-06-18T00:00:00.000Z",
  updatedAt: "2026-06-18T00:00:00.000Z",
  submittedBy: "Roy",
  shotScore: 8,
  bag: {
    id: "batch-1",
    beanId: "bean-1",
    roaster: "Pilot",
    name: "Halo",
    bean: "Ethiopia Halo",
    country: "Ethiopia",
    region: "Yirgacheffe",
    process: "Washed",
    roastDate: "2026-06-01",
    roastLevel: "Light",
    notes: "floral"
  },
  profile: {
    originalId: "p1",
    originalTitle: "Blooming",
    fileName: "rec-12345678.json",
    installedTitle: "Blooming - Halo - Roy"
  },
  grinder: { id: "g1", model: "ZP6", burrType: "flat", settingType: "numeric" },
  brew: {
    grindSetting: "4.2",
    beansWeight: 18,
    drinkWeight: 42,
    secondsMin: 28,
    secondsMax: 34,
    notes: "Gentle declining pressure"
  }
};

function responseJson(value: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(value), { status }));
}

function mockReaFetch(
  initialSettings: SkinSettings,
  options: {
    failSettingsPut?: boolean;
    failBatchCreate?: boolean;
    settingsStorageMissing?: boolean;
    rejectProfileUpdate?: boolean;
    updatedProfileId?: string;
    machineState?: MachineState;
    machineStateAfterWakeRequest?: MachineState;
    appInfo?: AppInfo;
    devices?: DeviceInfo[];
    devicesAfterScan?: DeviceInfo[] | ((context: DeviceScanContext) => DeviceInfo[]);
    scanDevicesResult?: DeviceInfo[] | ((context: DeviceScanContext) => DeviceInfo[]);
    sensors?: SensorListItem[];
    sensorsAfterScan?: SensorListItem[];
    shots?: ShotRecord[];
    shotsListStatus?: number;
    shotIds?: string[];
    workflow?: unknown;
    workflowUpdateDelay?: (count: number, nextWorkflow: unknown) => Promise<unknown> | undefined;
    workflowUpdateStaleCount?: number;
    sleepMachineDelay?: Promise<unknown>;
    sleepMachineStatus?: number;
    sleepMachineBody?: string;
    steams?: unknown[];
    plugins?: unknown[];
    pluginSettings?: unknown;
    visualizerStatus?: Record<string, unknown>;
    displayState?: Record<string, unknown>;
    communityStatus?: number;
    communityRecommendations?: CommunityRecommendation[];
    communityDownloadPayloads?: Record<string, CommunityDownloadPayload>;
    decentAccount?: DecentAccountStatus;
    connectDeviceStatus?: number;
    sensorExecuteResults?: Array<{ body: unknown; status?: number }>;
    shotDetailsById?: Record<string, ShotRecord>;
    beans?: Bean[];
    batchesByBeanId?: Record<string, BeanBatch[]>;
    grinders?: Grinder[];
    machineSettings?: Record<string, unknown>;
    advancedMachineSettings?: Record<string, unknown>;
    machineCalibration?: Record<string, unknown>;
  } = {}
) {
  let savedSettings = initialSettings;
  let workflow: unknown = options.workflow ?? { context: { targetDoseWeight: 18, targetYield: 36 } };
  let shots = options.shots ?? [];
  let machineSettings = options.machineSettings ?? {
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
  let advancedMachineSettings = options.advancedMachineSettings ?? {
    heaterPh1Flow: 4,
    heaterPh2Flow: 4,
    heaterIdleTemp: 85,
    heaterPh2Timeout: 10,
    heaterVoltage: 230,
    refillKitSetting: 2
  };
  let machineCalibration = options.machineCalibration ?? { flowMultiplier: 1 };
  let workflowUpdateCount = 0;
  let displayState = options.displayState ?? { brightness: 100, wakeLockOverride: true };
  let machineState = options.machineState ?? { connected: true, wifi: { connected: true, ipAddress: "192.168.1.20" } };
  let devices = options.devices ?? [];
  let sensors = options.sensors ?? [];
  let beans = options.beans ?? [];
  let grinders = options.grinders ?? [];
  let scanCount = 0;
  let connectCount = 0;
  const scanRequests: DeviceScanRequest[] = [];
  let sensorExecuteCount = 0;
  let scaleTareCount = 0;
  const communityDownloadIds: string[] = [];
  const communityCreatePayloads: unknown[] = [];
  const communityUpdatePayloads: unknown[] = [];
  const communityDeletePayloads: unknown[] = [];
  const communityRatePayloads: unknown[] = [];
  const createdProfilePayloads: unknown[] = [];
  const updatedProfilePayloads: unknown[] = [];
  const communityStore = new Map<string, unknown>([
    ["/api/v1/store/workflow-skin/community-display-name", ""],
    ["/api/v1/store/workflow-skin/community-downloaded-profiles", []],
    ["/api/v1/store/workflow-skin/community-uploaded-profiles", []],
    ["/api/v1/store/workflow-skin/community-recommendation-ratings", {}],
    ["/api/v1/store/workflow-skin/community-owner-key", "owner-key"]
  ]);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";

    if (url.hostname === "workflow-skin-community.sabotage1.workers.dev" && method === "GET" && url.pathname === "/api/recommendations") {
      if (options.communityStatus) return Promise.resolve(new Response("community unavailable", { status: options.communityStatus }));
      return responseJson({ version: 1, updatedAt: "2026-06-18T00:00:00.000Z", items: options.communityRecommendations ?? [] });
    }

    if (url.hostname === "workflow-skin-community.sabotage1.workers.dev" && method === "GET" && url.pathname.startsWith("/api/download/")) {
      const recommendationId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      communityDownloadIds.push(recommendationId);
      const payload = options.communityDownloadPayloads?.[recommendationId] ?? {
        recommendation: communityRecommendation,
        profileJson: { title: "Community source profile", notes: "Original notes", steps: [{ name: "bloom", pressure: 2 }] }
      };
      return responseJson(payload);
    }

    if (url.hostname === "workflow-skin-community.sabotage1.workers.dev" && method === "POST" && url.pathname === "/api/recommendations") {
      const body = JSON.parse(String(init.body));
      communityCreatePayloads.push(body);
      const recommendation = {
        id: "created-rec-1",
        createdAt: "2026-06-18T01:00:00.000Z",
        updatedAt: "2026-06-18T01:00:00.000Z",
        shotScore: typeof body.evidence?.enjoyment === "number" ? body.evidence.enjoyment : undefined,
        ...body.recommendation
      };
      return responseJson({
        recommendation,
        index: { version: 1, updatedAt: "2026-06-18T01:00:00.000Z", items: [recommendation] }
      });
    }

    if (url.hostname === "workflow-skin-community.sabotage1.workers.dev" && method === "PUT" && url.pathname.startsWith("/api/recommendations/")) {
      const body = JSON.parse(String(init.body));
      communityUpdatePayloads.push(body);
      const recommendationId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const previous = options.communityRecommendations?.find((item) => item.id === recommendationId) ?? communityRecommendation;
      const recommendation = {
        ...previous,
        ...body.recommendation,
        id: recommendationId,
        createdAt: previous.createdAt,
        shotScore: typeof body.evidence?.enjoyment === "number" ? body.evidence.enjoyment : previous.shotScore,
        updatedAt: "2026-06-18T02:00:00.000Z"
      };
      return responseJson({
        recommendation,
        index: { version: 1, updatedAt: "2026-06-18T02:00:00.000Z", items: [recommendation] }
      });
    }

    const ratingMatch = url.hostname === "workflow-skin-community.sabotage1.workers.dev" ? url.pathname.match(/^\/api\/recommendations\/([^/]+)\/rating$/) : null;
    if (ratingMatch && method === "POST") {
      const recommendationId = decodeURIComponent(ratingMatch[1]);
      const body = JSON.parse(String(init.body));
      communityRatePayloads.push({ id: recommendationId, ...body });
      const previous = options.communityRecommendations?.find((item) => item.id === recommendationId) ?? communityRecommendation;
      const recommendation = {
        ...previous,
        communityRatingAverage: body.rating,
        communityRatingCount: 1,
        updatedAt: "2026-06-18T04:00:00.000Z"
      };
      return responseJson({
        rating: body.rating,
        recommendation,
        index: { version: 1, updatedAt: "2026-06-18T04:00:00.000Z", items: [recommendation] }
      });
    }

    if (url.hostname === "workflow-skin-community.sabotage1.workers.dev" && method === "DELETE" && url.pathname.startsWith("/api/recommendations/")) {
      const recommendationId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const body = JSON.parse(String(init.body));
      communityDeletePayloads.push({ id: recommendationId, ...body });
      const items = (options.communityRecommendations ?? [communityRecommendation]).filter((item) => item.id !== recommendationId);
      return responseJson({
        id: recommendationId,
        index: { version: 1, updatedAt: "2026-06-18T03:00:00.000Z", items }
      });
    }

    if (method === "GET" && url.pathname === "/api/v1/account/decent") return responseJson(options.decentAccount ?? { connected: true, username: "royack" });

    if (method === "GET" && url.pathname === "/api/v1/profiles") return responseJson(profiles);
    if (method === "PUT" && url.pathname.startsWith("/api/v1/profiles/")) {
      const profileId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (options.rejectProfileUpdate) return Promise.resolve(new Response("Cannot modify default profile content", { status: 400 }));
      const body = JSON.parse(String(init.body)) as { profile?: (typeof profiles)[number]["profile"]; metadata?: Record<string, unknown> };
      updatedProfilePayloads.push({ id: profileId, ...body });
      const current = profiles.find((profile) => profile.id === profileId);
      const updated = { id: options.updatedProfileId ?? profileId, profile: body.profile ?? current?.profile ?? {}, metadata: body.metadata };
      profiles = profiles.map((profile) => (profile.id === profileId ? updated : profile));
      return responseJson(updated);
    }
    if (method === "POST" && url.pathname === "/api/v1/profiles") {
      const body = JSON.parse(String(init.body)) as { profile: (typeof profiles)[number]["profile"]; parentId?: string; metadata?: Record<string, unknown> };
      createdProfilePayloads.push(body);
      const created = { id: "p3", parentId: body.parentId, profile: body.profile, metadata: body.metadata };
      profiles = [...profiles, created];
      return responseJson(created, 201);
    }
    if (method === "GET" && url.pathname === "/api/v1/workflow") return responseJson(workflow);
    if (method === "PUT" && url.pathname === "/api/v1/workflow") {
      workflowUpdateCount += 1;
      const nextWorkflow = JSON.parse(String(init.body));
      const updateWorkflow = () => {
        if (workflowUpdateCount > (options.workflowUpdateStaleCount ?? 0)) workflow = nextWorkflow;
        return responseJson(workflow);
      };
      const delay = options.workflowUpdateDelay?.(workflowUpdateCount, nextWorkflow);
      return delay ? delay.then(updateWorkflow) : updateWorkflow();
    }
    if (method === "PUT" && url.pathname === "/api/v1/machine/state/sleeping") {
      if (options.sleepMachineStatus) {
        return Promise.resolve(new Response(options.sleepMachineBody ?? "sleep failed", { status: options.sleepMachineStatus }));
      }
      const sleep = () => {
        machineState = { ...machineState, connected: true, state: { state: "sleeping", substate: "idle" } };
        return Promise.resolve(new Response("", { status: 200 }));
      };
      return options.sleepMachineDelay ? options.sleepMachineDelay.then(sleep) : sleep();
    }
    if (method === "PUT" && url.pathname === "/api/v1/machine/state/idle") {
      machineState = options.machineStateAfterWakeRequest ?? { ...machineState, connected: true, state: { state: "idle" } };
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "PUT" && url.pathname === "/api/v1/machine/state/espresso") {
      machineState = { ...machineState, connected: true, state: { state: "espresso", substate: "preinfusion" } };
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "PUT" && url.pathname === "/api/v1/machine/state/steam") {
      machineState = { ...machineState, connected: true, state: { state: "steam", substate: "heating" } };
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/machine/state") {
      return responseJson(machineState);
    }
    if (method === "GET" && url.pathname === "/api/v1/machine/settings") return responseJson(machineSettings);
    if (method === "POST" && url.pathname === "/api/v1/machine/settings") {
      const body = JSON.parse(String(init.body));
      machineSettings = { ...machineSettings, ...body, usb: body.usb === "enable" ? true : body.usb === "disable" ? false : body.usb };
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/machine/settings/advanced") return responseJson(advancedMachineSettings);
    if (method === "POST" && url.pathname === "/api/v1/machine/settings/advanced") {
      advancedMachineSettings = { ...advancedMachineSettings, ...JSON.parse(String(init.body)) };
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "DELETE" && url.pathname === "/api/v1/machine/settings/reset") {
      machineSettings = {};
      advancedMachineSettings = {};
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/machine/calibration") return responseJson(machineCalibration);
    if (method === "POST" && url.pathname === "/api/v1/machine/calibration") {
      machineCalibration = { ...machineCalibration, ...JSON.parse(String(init.body)) };
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/info") return responseJson(options.appInfo ?? { localIp: "192.168.1.20", version: "0.7.6" });
    if (method === "GET" && url.pathname === "/api/v1/devices") return responseJson(devices);
    if (method === "GET" && url.pathname === "/api/v1/devices/scan") {
      const quickParam = url.searchParams.has("quick") ? url.searchParams.get("quick") === "true" : undefined;
      const quick = quickParam === true;
      scanRequests.push({ path: `${url.pathname}${url.search}`, quick, connect: url.searchParams.get("connect") === "true" });
      const context = { machineState, quick, quickParam, scanCount, connectCount };
      scanCount += 1;
      devices = typeof options.devicesAfterScan === "function" ? options.devicesAfterScan(context) : options.devicesAfterScan ?? devices;
      sensors = options.sensorsAfterScan ?? sensors;
      return responseJson(typeof options.scanDevicesResult === "function" ? options.scanDevicesResult(context) : options.scanDevicesResult ?? devices);
    }
    if ((method === "PUT" || method === "POST") && url.pathname === "/api/v1/devices/connect") {
      if (options.connectDeviceStatus) return Promise.resolve(new Response(`connect failed for ${String(init.body)}`, { status: options.connectDeviceStatus }));
      connectCount += 1;
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/display") return responseJson(displayState);
    if (method === "PUT" && url.pathname === "/api/v1/display/brightness") {
      displayState = { ...displayState, ...JSON.parse(String(init.body)) };
      return responseJson(displayState);
    }
    if (method === "POST" && url.pathname === "/api/v1/display/wakelock") {
      displayState = { ...displayState, wakeLockOverride: true };
      return responseJson(displayState);
    }
    if (method === "DELETE" && url.pathname === "/api/v1/display/wakelock") {
      displayState = { ...displayState, wakeLockOverride: false };
      return responseJson(displayState);
    }
    if (method === "GET" && url.pathname === "/api/v1/beans") return responseJson(beans);
    if (method === "GET" && url.pathname.startsWith("/api/v1/beans/") && url.pathname.endsWith("/batches")) {
      const beanId = decodeURIComponent(url.pathname.split("/")[4] ?? "");
      return responseJson(options.batchesByBeanId?.[beanId] ?? []);
    }
    if (method === "GET" && url.pathname === "/api/v1/grinders") return responseJson(grinders);
    if (method === "GET" && url.pathname === "/api/v1/shots") {
      if (options.shotsListStatus) {
        return Promise.resolve(
          new Response('{"error":"Invalid argument(s): Profile must have a non-empty \\"steps\\" array"}', { status: options.shotsListStatus })
        );
      }
      return responseJson({ items: shots, total: shots.length, limit: 100, offset: 0 });
    }
    if (method === "GET" && url.pathname === "/api/v1/shots/ids") return responseJson(options.shotIds ?? shots.map((shot) => shot.id));
    if (method === "GET" && url.pathname === "/api/v1/shots/latest") return responseJson(shots[0] ?? null);
    if (method === "GET" && url.pathname.startsWith("/api/v1/shots/")) {
      const shotId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      const shot = options.shotDetailsById?.[shotId] ?? shots.find((item) => item.id === shotId);
      return shot ? responseJson(shot) : Promise.resolve(new Response("Shot not found", { status: 404 }));
    }
    if (method === "PUT" && url.pathname === "/api/v1/scale/tare") {
      scaleTareCount += 1;
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/steams") return responseJson(options.steams ?? []);
    if (method === "GET" && url.pathname === "/api/v1/sensors") return responseJson(sensors);
    if (method === "POST" && url.pathname.startsWith("/api/v1/sensors/") && url.pathname.endsWith("/execute")) {
      const result = options.sensorExecuteResults?.[sensorExecuteCount] ?? { body: { status: "ok", result: { reading: { tds: 9.8 } } } };
      sensorExecuteCount += 1;
      return responseJson(result.body, result.status);
    }
    if (method === "GET" && url.pathname === "/api/v1/plugins") return responseJson(options.plugins ?? []);
    if (method === "GET" && url.pathname === "/api/v1/plugins/visualizer.reaplugin/settings") return responseJson(options.pluginSettings ?? {});
    if (method === "GET" && url.pathname.startsWith("/api/v1/plugins/visualizer.reaplugin/")) {
      const endpoint = url.pathname.split("/").pop() ?? "";
      return responseJson(options.visualizerStatus?.[endpoint] ?? {});
    }
    if (options.settingsStorageMissing && url.pathname === "/api/v1/store/workflow-skin/settings") {
      return Promise.resolve(new Response("Route not found", { status: 404 }));
    }
    if (options.settingsStorageMissing && url.pathname === "/api/v1/plugins/workflow-skin/settings") {
      return Promise.resolve(new Response("Route not found", { status: 404 }));
    }
    if (options.settingsStorageMissing && url.pathname === "/api/v1/kv/workflow-skin/settings") {
      return Promise.resolve(new Response("Route not found", { status: 404 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/store/workflow-skin/settings") return responseJson(savedSettings);
    if (method === "POST" && url.pathname === "/api/v1/store/workflow-skin/settings") {
      if (options.failSettingsPut) return Promise.resolve(new Response("store unavailable", { status: 500 }));
      savedSettings = JSON.parse(String(init.body)) as SkinSettings;
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname === "/api/v1/kv/workflow-skin/settings") return responseJson(savedSettings);
    if (method === "PUT" && url.pathname === "/api/v1/kv/workflow-skin/settings") {
      if (options.failSettingsPut) return Promise.resolve(new Response("kv unavailable", { status: 500 }));
      savedSettings = JSON.parse(String(init.body)) as SkinSettings;
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && communityStore.has(url.pathname)) return responseJson(communityStore.get(url.pathname));
    if (method === "POST" && communityStore.has(url.pathname)) {
      communityStore.set(url.pathname, JSON.parse(String(init.body)));
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "GET" && url.pathname.startsWith("/api/v1/kv/workflow-skin/community-")) {
      return responseJson(communityStore.get(url.pathname.replace("/api/v1/kv", "/api/v1/store")) ?? null);
    }
    if (method === "PUT" && url.pathname.startsWith("/api/v1/kv/workflow-skin/community-")) {
      communityStore.set(url.pathname.replace("/api/v1/kv", "/api/v1/store"), JSON.parse(String(init.body)));
      return Promise.resolve(new Response("", { status: 200 }));
    }
    if (method === "POST" && url.pathname === "/api/v1/beans") return responseJson({ id: "bean-1", roaster: "Pilot", name: "Halo" });
    if (method === "POST" && url.pathname === "/api/v1/beans/bean-1/batches") {
      if (options.failBatchCreate) return Promise.resolve(new Response("batch failed", { status: 500 }));
      return responseJson({ id: "batch-1", beanId: "bean-1" });
    }
    if (method === "DELETE" && url.pathname === "/api/v1/beans/bean-1") return Promise.resolve(new Response("", { status: 200 }));

    return Promise.reject(new Error(`Unhandled ${method} ${url.pathname}${url.search}`));
  });

  return {
    fetchMock,
    get savedSettings() {
      return savedSettings;
    },
    get workflow() {
      return workflow;
    },
    get workflowUpdateCount() {
      return workflowUpdateCount;
    },
    get scanCount() {
      return scanCount;
    },
    get scanRequests() {
      return scanRequests;
    },
    get connectCount() {
      return connectCount;
    },
    get sensorExecuteCount() {
      return sensorExecuteCount;
    },
    get scaleTareCount() {
      return scaleTareCount;
    },
    get communityDownloadIds() {
      return communityDownloadIds;
    },
    get communityCreatePayloads() {
      return communityCreatePayloads;
    },
    get communityUpdatePayloads() {
      return communityUpdatePayloads;
    },
    get communityDeletePayloads() {
      return communityDeletePayloads;
    },
    get communityRatePayloads() {
      return communityRatePayloads;
    },
    get createdProfilePayloads() {
      return createdProfilePayloads;
    },
    get updatedProfilePayloads() {
      return updatedProfilePayloads;
    },
    get communityStore() {
      return communityStore;
    },
    get displayState() {
      return displayState;
    },
    get machineSettings() {
      return machineSettings;
    },
    get advancedMachineSettings() {
      return advancedMachineSettings;
    },
    get machineCalibration() {
      return machineCalibration;
    },
    setMachineState(next: MachineState) {
      machineState = next;
    },
    setWorkflow(next: unknown) {
      workflow = next;
    },
    setShots(next: ShotRecord[]) {
      shots = next;
    },
    setDevices(next: DeviceInfo[]) {
      devices = next;
    }
  };
}

const initialSettings: SkinSettings = {
  ...defaultSkinSettings,
  presetSlots: [
    { label: "Light", profileId: "p1" },
    { label: "Sweet" },
    { label: "Turbo" },
    { label: "Classic" }
  ],
  defaultReviewEnabled: true,
  reviewEnabledByProfile: {},
  skinTitle: "WorkFlow",
  shownProfileIds: ["p1", "p2"],
  profileWorkflows: {}
};

const detectedR2Sensor: SensorListItem = {
  id: "F4:12:FA:FA:AC:E3",
  info: {
    name: "DiFluid R2",
    vendor: "DiFluid",
    data: [{ key: "tds", type: "number", unit: "%" }],
    commands: [{ id: "measure" }]
  }
};

const detectedScaleSensor: SensorListItem = {
  id: "scale-sensor-1",
  info: {
    name: "Acaia Lunar",
    vendor: "Acaia",
    data: [{ key: "weight", type: "number", unit: "g" }]
  }
};

describe("App shell", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    profiles = [
      { id: "p1", profile: { title: "Blooming" } },
      { id: "p2", profile: { title: "Classic" } }
    ];
  });

  afterEach(() => {
    delete globalThis.__WORKFLOW_SKIN_ENABLE_TEST_LOGS__;
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("starts on the brew page and switches navigation tabs", async () => {
    mockReaFetch(initialSettings);
    render(<App />);
    expect(screen.getByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Light Blooming" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Bags/i }));

    expect(screen.getByRole("heading", { name: "Bags" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bag Filters" })).toBeInTheDocument();
  });

  it("writes structured skin logs to the console for machine log capture", async () => {
    globalThis.__WORKFLOW_SKIN_ENABLE_TEST_LOGS__ = true;
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockReaFetch(initialSettings);

    render(<App />);

    await screen.findByRole("button", { name: "Light Blooming" });
    const readyLog = consoleLog.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.startsWith("[WorkFlow Skin] ") && line.includes('"event":"skin_ready"'));

    expect(readyLog).toEqual(expect.any(String));
    expect(readyLog ?? "").toContain(`"version":"${skinManifest.version}"`);
    expect(readyLog ?? "").toContain('"page":"brew"');
  });

  it("renders WorkFlow in the menu and machine status in the fixed top bar", async () => {
    mockReaFetch({
      ...initialSettings,
      menuCollapsed: false
    }, {
      machineState: { connected: true, state: { state: "heating" }, groupTemperature: 91.2, wifi: { connected: true, ipAddress: "192.168.1.20" } }
    });
    render(<App />);

    const topbar = await screen.findByRole("banner", { name: "Machine status bar" });
    const menuTitle = screen.getByLabelText("WorkFlow menu title");

    expect(menuTitle).toHaveTextContent("WorkFlow");
    expect(topbar).toHaveTextContent("Heating");
    expect(topbar).toHaveTextContent("91.2°C");
    expect(within(topbar).getByRole("button", { name: "WiFi" })).toBeInTheDocument();
    expect(screen.queryByLabelText("App title")).not.toBeInTheDocument();
  });

  it("does not show bulk shot history backend errors on the brew page", async () => {
    mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "idle" }, wifi: { connected: true, ipAddress: "192.168.1.20" } },
      shotsListStatus: 500,
      shotIds: []
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText(/Shot history unavailable/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Profile must have a non-empty/i)).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Machine" })).toHaveAttribute("title", "Machine: Connected");
  });

  it("shows the latest skin version at the bottom of the expanded menu", async () => {
    const currentSkinVersion = typeof skinManifest.version === "string" ? skinManifest.version : "0.0.0";
    mockReaFetch(
      {
        ...initialSettings,
        menuCollapsed: false
      }
    );
    render(<App />);

    const skinVersion = await screen.findByLabelText("Skin version");

    expect(skinVersion).toHaveTextContent(`v${currentSkinVersion}`);
    expect(skinVersion).toHaveClass("latest");
    expect(skinVersion).not.toHaveClass("update-available");
  });

  it("keeps the expanded menu skin version passive because updates are app-bundled", async () => {
    mockReaFetch(
      {
        ...initialSettings,
        menuCollapsed: false
      }
    );
    render(<App />);

    const skinVersion = await screen.findByLabelText("Skin version");

    expect(skinVersion).toHaveClass("latest");
    expect(skinVersion).not.toHaveClass("update-available");
    expect(skinVersion).not.toHaveTextContent("Update");
  });

  it("hides the skin version when the menu is minimized", async () => {
    mockReaFetch({ ...initialSettings, menuCollapsed: true });
    render(<App />);

    await screen.findByRole("navigation", { name: "Workflow navigation" });

    expect(screen.queryByLabelText("Skin version")).not.toBeInTheDocument();
  });

  it("shows PreparingForShot as Heating in the machine header", async () => {
    mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "PreparingForShot" }, groupTemperature: 88.3 }
    });
    render(<App />);

    const topbar = await screen.findByRole("banner", { name: "Machine status bar" });

    expect(topbar).toHaveTextContent("Heating");
    expect(topbar).not.toHaveTextContent("PreparingForShot");
  });

  it("shows spaced Preparing for shot as Heating when the machine is warming up", async () => {
    mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "Preparing for shot", substate: "heating" }, groupTemperature: 88.3, targetGroupTemperature: 93 }
    });
    render(<App />);

    const topbar = await screen.findByRole("banner", { name: "Machine status bar" });

    expect(topbar).toHaveTextContent("Heating");
    expect(topbar).not.toHaveTextContent("Preparing for shot");
  });

  it("renders on older WebViews without Array.prototype.at", async () => {
    const originalAtDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "at");
    Object.defineProperty(Array.prototype, "at", { configurable: true, value: undefined });
    try {
      mockReaFetch(initialSettings);
      render(<App />);

      expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();
      expect(screen.getByLabelText("WorkFlow menu title")).toHaveTextContent("WorkFlow");
    } finally {
      if (originalAtDescriptor) {
        Object.defineProperty(Array.prototype, "at", originalAtDescriptor);
      } else {
        delete (Array.prototype as unknown as Record<string, unknown>).at;
      }
    }
  });

  it("has a dedicated menu item for profiles", async () => {
    mockReaFetch(initialSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Profiles" }));

    expect(screen.getByRole("heading", { name: "Profiles", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Blooming profile workflow" })).toBeInTheDocument();
  });

  it("has a dedicated menu item for community recommendations", async () => {
    mockReaFetch(initialSettings);
    render(<App />);

    expect(await screen.findByRole("button", { name: "Community" })).toBeInTheDocument();
  });

  it("shows community offline state when the Worker cannot be reached", async () => {
    mockReaFetch(initialSettings, { communityStatus: 500 });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("GET /api/recommendations failed: 500");
  });

  it("downloads a community recommendation into local profiles and records it in storage", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      communityRecommendations: [communityRecommendation],
      communityDownloadPayloads: {
        [communityRecommendation.id]: {
          recommendation: communityRecommendation,
          profileJson: { title: "Source Blooming", notes: "Original notes", steps: [{ name: "Bloom", pressure: 2 }] }
        }
      }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));
    await userEvent.click(await screen.findByRole("button", { name: "Download Blooming" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Profile downloaded.");
    expect(fetchState.communityDownloadIds).toEqual([communityRecommendation.id]);
    expect(fetchState.createdProfilePayloads[0]).toEqual(
      expect.objectContaining({
        profile: expect.objectContaining({
          title: "Blooming - Halo - Roy - rec-12345678",
          author: "Roy",
          notes: expect.stringContaining("Community recommendation: rec-12345678")
        }),
        metadata: expect.objectContaining({
          communityRecommendationId: "rec-12345678",
          communityRecommendationUpdatedAt: communityRecommendation.updatedAt,
          communitySubmittedBy: "Roy"
        })
      })
    );
    const downloaded = fetchState.communityStore.get("/api/v1/store/workflow-skin/community-downloaded-profiles") as Array<Record<string, unknown>>;
    expect(downloaded).toEqual([
      expect.objectContaining({
        recommendationId: "rec-12345678",
        localProfileId: "p3",
        localProfileTitle: "Blooming - Halo - Roy - rec-12345678",
        updatedAt: communityRecommendation.updatedAt
      })
    ]);
  });

  it("ranks a community recommendation and saves the user's rank locally", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      communityRecommendations: [communityRecommendation]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));
    await userEvent.selectOptions(await screen.findByLabelText("Your rank for Blooming"), "4");

    expect(await screen.findByRole("status")).toHaveTextContent("Rank saved.");
    expect(fetchState.communityRatePayloads).toEqual([{ id: "rec-12345678", ownerKey: "owner-key", rating: 4 }]);
    expect(fetchState.communityStore.get("/api/v1/store/workflow-skin/community-recommendation-ratings")).toEqual({ "rec-12345678": 4 });
    expect(screen.getByText("Community rank 4/5 (1)")).toBeInTheDocument();
  });

  it("uploads a local bag profile and grinder as a community recommendation", async () => {
    profiles = [{ id: "p1", profile: { title: "Blooming", notes: "Profile notes", steps: [{ name: "Bloom", pressure: 2 }] } }];
    const fetchState = mockReaFetch(initialSettings, {
      decentAccount: { connected: true, username: "royack" },
      beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", region: "Yirgacheffe", processing: "Washed", notes: "floral" }],
      batchesByBeanId: {
        "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", roastLevel: "Light", notes: "batch notes", extras: { workflowSkin: { name: "Halo" } } }]
      },
      grinders: [{ id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP", notes: "travel grinder" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Recommend Profile" }));
    await userEvent.selectOptions(await screen.findByLabelText("Saved bag"), "batch-1");
    await userEvent.selectOptions(screen.getByLabelText("Profile"), "p1");
    await userEvent.selectOptions(screen.getByLabelText("Grinder"), "g1");
    await userEvent.type(screen.getByLabelText("Grind setting"), "4.2");
    await userEvent.type(screen.getByLabelText("Beans weight"), "18");
    await userEvent.type(screen.getByLabelText("Drink weight"), "42");
    await userEvent.type(screen.getByLabelText("Seconds min"), "28");
    await userEvent.type(screen.getByLabelText("Seconds max"), "34");
    await userEvent.type(screen.getByLabelText("Notes"), "Gentle declining pressure");
    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Recommendation uploaded.");
    expect(fetchState.communityCreatePayloads[0]).toEqual(
      expect.objectContaining({
        ownerKey: "owner-key",
        recommendation: expect.objectContaining({
          submittedBy: "royack",
          bag: expect.objectContaining({
            id: "batch-1",
            beanId: "bean-1",
            roaster: "Pilot",
            name: "Halo",
            bean: "Ethiopia Halo",
            country: "Ethiopia",
            process: "Washed",
            roastDate: "2026-06-01"
          }),
          profile: expect.objectContaining({
            originalId: "p1",
            originalTitle: "Blooming",
            installedTitle: "Blooming"
          }),
          grinder: expect.objectContaining({
            id: "g1",
            model: "ZP6",
            burrs: "MP",
            burrType: "flat",
            settingType: "numeric"
          }),
          rating: 5,
          brew: {
            grindSetting: "4.2",
            beansWeight: 18,
            drinkWeight: 42,
            secondsMin: 28,
            secondsMax: 34,
            notes: "Gentle declining pressure"
          }
        }),
        profileJson: expect.objectContaining({ title: "Blooming", notes: "Profile notes" })
      })
    );
    const uploaded = fetchState.communityStore.get("/api/v1/store/workflow-skin/community-uploaded-profiles") as Array<Record<string, unknown>>;
    expect(uploaded).toEqual([
      expect.objectContaining({
        recommendationId: "created-rec-1",
        updatedAt: "2026-06-18T01:00:00.000Z",
        recommendation: expect.objectContaining({ submittedBy: "royack" })
      })
    ]);
  });

  it("loads full shot measurements before uploading selected community shot evidence", async () => {
    profiles = [{ id: "p1", profile: { title: "Blooming", notes: "Profile notes", steps: [{ name: "Bloom", pressure: 2 }] } }];
    const listShot: ShotRecord = {
      id: "history-rec-shot",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: { profile: { title: "History espresso" }, context: { beanBatchId: "batch-1", grinderId: "g1" } },
      annotations: { actualDoseWeight: 18, actualYield: 42, enjoyment: 8, espressoNotes: "Sweet citrus" }
    };
    const fullShot: ShotRecord = {
      ...listShot,
      measurements: [
        { machine: { timestamp: "2026-06-18T08:00:00.000Z", pressure: 1, flow: 1 }, scale: { timestamp: "2026-06-18T08:00:00.000Z", weight: 0 } },
        { machine: { timestamp: "2026-06-18T08:00:31.000Z", pressure: 8, flow: 2 }, scale: { timestamp: "2026-06-18T08:00:31.000Z", weight: 42 } }
      ]
    };
    const fetchState = mockReaFetch(initialSettings, {
      decentAccount: { connected: true, username: "royack" },
      shots: [listShot],
      shotDetailsById: { "history-rec-shot": fullShot },
      beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", processing: "Washed" }],
      batchesByBeanId: {
        "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", extras: { workflowSkin: { name: "Halo" } } }]
      },
      grinders: [{ id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Recommend Profile" }));
    await userEvent.selectOptions(await screen.findByLabelText("Saved bag"), "batch-1");
    await userEvent.selectOptions(screen.getByLabelText("Profile"), "p1");
    await userEvent.selectOptions(screen.getByLabelText("Grinder"), "g1");
    await userEvent.type(screen.getByLabelText("Grind setting"), "4.2");
    await userEvent.type(screen.getByLabelText("Beans weight"), "18");
    await userEvent.type(screen.getByLabelText("Drink weight"), "42");
    await userEvent.type(screen.getByLabelText("Seconds min"), "28");
    await userEvent.type(screen.getByLabelText("Seconds max"), "34");
    await userEvent.selectOptions(screen.getByLabelText("Shot evidence"), "history-rec-shot");
    await userEvent.type(screen.getByLabelText("Notes"), "Gentle declining pressure");
    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Recommendation uploaded.");
    expect(fetchState.communityCreatePayloads[0]).toEqual(
      expect.objectContaining({
        evidence: expect.objectContaining({
          id: "history-rec-shot",
          measurements: expect.arrayContaining([expect.objectContaining({ machine: expect.objectContaining({ pressure: 8 }) })])
        })
      })
    );
  });

  it("updates an uploaded community recommendation with the local owner key and profile JSON", async () => {
    profiles = [{ id: "p1", profile: { title: "Blooming", notes: "Updated local profile notes", steps: [{ name: "Bloom", pressure: 2 }] } }];
    const fullShot: ShotRecord = {
      id: "history-rec-shot",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: { profile: { title: "History espresso" }, context: { beanBatchId: "batch-1", grinderId: "g1" } },
      annotations: { enjoyment: 8 },
      measurements: [{ machine: { timestamp: "2026-06-18T08:00:31.000Z", pressure: 8 } }]
    };
    const fetchState = mockReaFetch(initialSettings, {
      communityRecommendations: [communityRecommendation],
      shotDetailsById: { "history-rec-shot": fullShot },
      beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", region: "Yirgacheffe", processing: "Washed", notes: "floral" }],
      batchesByBeanId: {
        "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", roastLevel: "Light", notes: "batch notes", extras: { workflowSkin: { name: "Halo" } } }]
      },
      grinders: [{ id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP", notes: "travel grinder" }]
    });
    fetchState.communityStore.set("/api/v1/store/workflow-skin/community-uploaded-profiles", [
      {
        recommendationId: communityRecommendation.id,
        uploadedAt: "2026-06-18T00:00:00.000Z",
        updatedAt: communityRecommendation.updatedAt,
        recommendation: communityRecommendation,
        evidence: { id: "history-rec-shot" }
      }
    ]);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Uploaded Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));
    expect(await screen.findByRole("heading", { name: "Edit Blooming" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save updated recommendation" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Recommendation updated.");
    expect(fetchState.communityUpdatePayloads[0]).toEqual(
      expect.objectContaining({
        ownerKey: "owner-key",
        recommendation: expect.objectContaining({
          submittedBy: "Roy",
          bag: expect.objectContaining({ id: "batch-1", name: "Halo" }),
          profile: expect.objectContaining({ originalId: "p1", originalTitle: "Blooming" }),
          grinder: expect.objectContaining({ id: "g1", model: "ZP6", burrType: "flat" }),
          brew: expect.objectContaining({ grindSetting: "4.2", beansWeight: 18 })
        }),
        profileJson: expect.objectContaining({ title: "Blooming", notes: "Updated local profile notes" }),
        evidence: expect.objectContaining({
          id: "history-rec-shot",
          measurements: expect.arrayContaining([expect.objectContaining({ machine: expect.objectContaining({ pressure: 8 }) })])
        })
      })
    );
    const uploaded = fetchState.communityStore.get("/api/v1/store/workflow-skin/community-uploaded-profiles") as Array<Record<string, unknown>>;
    expect(uploaded).toEqual([
      expect.objectContaining({
        recommendationId: "rec-12345678",
        updatedAt: "2026-06-18T02:00:00.000Z",
        recommendation: expect.objectContaining({ updatedAt: "2026-06-18T02:00:00.000Z" }),
        evidence: expect.objectContaining({
          id: "history-rec-shot",
          measurements: expect.arrayContaining([expect.objectContaining({ machine: expect.objectContaining({ pressure: 8 }) })])
        })
      })
    ]);
  });

  it("deletes an uploaded community recommendation with the local owner key", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      communityRecommendations: [communityRecommendation],
      beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", processing: "Washed" }],
      batchesByBeanId: {
        "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", extras: { workflowSkin: { name: "Halo" } } }]
      },
      grinders: [{ id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP" }]
    });
    fetchState.communityStore.set("/api/v1/store/workflow-skin/community-uploaded-profiles", [
      {
        recommendationId: communityRecommendation.id,
        uploadedAt: "2026-06-18T00:00:00.000Z",
        updatedAt: communityRecommendation.updatedAt,
        recommendation: communityRecommendation
      }
    ]);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Community" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Uploaded Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Blooming" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Recommendation deleted.");
    expect(fetchState.communityDeletePayloads).toEqual([{ id: "rec-12345678", ownerKey: "owner-key" }]);
    expect(fetchState.communityStore.get("/api/v1/store/workflow-skin/community-uploaded-profiles")).toEqual([]);
  });

  it("orders grinders below profiles in the default main menu", async () => {
    mockReaFetch(initialSettings);
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Workflow navigation" });
    const labels = Array.from(navigation.querySelectorAll(".nav-button")).map((button) => button.getAttribute("aria-label"));

    expect(labels.indexOf("Profiles")).toBeGreaterThan(-1);
    expect(labels.indexOf("Grinders")).toBeGreaterThan(-1);
    expect(labels.indexOf("Profiles")).toBeLessThan(labels.indexOf("Grinders"));
    expect(labels.indexOf("Community")).toBe(labels.indexOf("Settings") - 1);
  });

  it("uses saved main menu visibility and order", async () => {
    mockReaFetch({
      ...initialSettings,
      mainMenuItems: ["brew", "profiles", "grinders", "history", "settings", "live", "review", "steam", "bags"],
      hiddenMainMenuItemIds: ["history", "steam"]
    });
    render(<App />);

    const navigation = await screen.findByRole("navigation", { name: "Workflow navigation" });
    const labels = Array.from(navigation.querySelectorAll(".nav-button")).map((button) => button.getAttribute("aria-label"));

    expect(labels).toEqual(["Collapse menu", "Brew", "Profiles", "Grinders", "Review", "Bags", "Community", "Settings"]);
    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Steam" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Live" })).not.toBeInTheDocument();
  });

  it("shows the live navigation item only while coffee is brewing", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "idle" } }
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Live" })).not.toBeInTheDocument();

    vi.useFakeTimers();
    fetchState.setMachineState({ connected: true, state: { state: "espresso", substate: "pouring" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    vi.useRealTimers();

    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live" })).toBeInTheDocument();
  });

  it("uses compact icons and a notepad edit icon in the collapsed menu", async () => {
    mockReaFetch({ ...initialSettings, menuCollapsed: true });
    render(<App />);

    const reviewButton = await screen.findByRole("button", { name: "Review" });
    const reviewIcon = reviewButton.querySelector("svg");
    const menuTitle = screen.getByLabelText("WorkFlow menu title");

    expect(menuTitle).toHaveTextContent("WF");
    expect(reviewButton).toHaveClass("review-nav-button");
    expect(reviewIcon).toHaveClass("review-nav-icon");
    expect(reviewIcon).toHaveAttribute("width", "20");
    expect(reviewIcon).toHaveAttribute("height", "20");
  });

  it("hides connection status indicators when the menu is collapsed", async () => {
    mockReaFetch({ ...initialSettings, menuCollapsed: true });
    render(<App />);

    await screen.findByRole("navigation", { name: "Workflow navigation" });

    expect(screen.queryByLabelText("Connection status")).not.toBeInTheDocument();
    expect(screen.getByRole("banner", { name: "Machine status bar" })).toBeInTheDocument();
  });

  it("has a dedicated menu item for grinders", async () => {
    mockReaFetch(initialSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Grinders" }));

    expect(screen.getByRole("heading", { name: "Grinders", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add grinder" })).toBeInTheDocument();
  });

  it("collapses the menu to icons and remembers the state", async () => {
    const fetchState = mockReaFetch(initialSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Collapse menu" }));

    expect(await screen.findByRole("button", { name: "Expand menu" })).toBeInTheDocument();
    expect(fetchState.savedSettings.menuCollapsed).toBe(true);
  });

  it("only lists shown profiles when choosing a preset profile", async () => {
    mockReaFetch({ ...initialSettings, shownProfileIds: ["p2"] });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Light" }));

    expect(screen.getByRole("button", { name: "Use Classic" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Blooming" })).not.toBeInTheDocument();
  });

  it("does not list profiles already assigned to another preset slot", async () => {
    mockReaFetch(initialSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Sweet" }));

    expect(screen.getByRole("dialog", { name: "Edit Sweet preset" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Blooming" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use Classic" })).toBeInTheDocument();
  });

  it("creates an editable copy when saving a default profile is rejected", async () => {
    const fetchState = mockReaFetch(initialSettings, { rejectProfileUpdate: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));
    await userEvent.clear(screen.getByLabelText("Profile title"));
    await userEvent.type(screen.getByLabelText("Profile title"), "Blooming Copy");
    await userEvent.click(screen.getByRole("button", { name: "Save Blooming" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/profiles/p1",
      expect.objectContaining({ method: "PUT" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/profiles",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"parentId":"p1"')
      })
    );
  });

  it("keeps skin settings attached when ReaPrime changes an edited profile id", async () => {
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        startupProfileId: "p1",
        reviewEnabledByProfile: { p1: false },
        profileWorkflows: { p1: { milkBased: true, steamTimers: { small: 25, medium: 35, large: 45 } } }
      },
      { updatedProfileId: "p1-copy" }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Profiles" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Blooming" }));
    await userEvent.clear(screen.getByLabelText("Profile title"));
    await userEvent.type(screen.getByLabelText("Profile title"), "Blooming Edited");
    await userEvent.click(screen.getByRole("button", { name: "Save Blooming" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
    expect(fetchState.savedSettings.startupProfileId).toBe("p1-copy");
    expect(fetchState.savedSettings.shownProfileIds).toContain("p1-copy");
    expect(fetchState.savedSettings.shownProfileIds).not.toContain("p1");
    expect(fetchState.savedSettings.presetSlots[0].profileId).toBe("p1-copy");
    expect(fetchState.savedSettings.reviewEnabledByProfile).toEqual({ "p1-copy": false });
    expect(fetchState.savedSettings.profileWorkflows["p1-copy"]).toEqual({ milkBased: true, steamTimers: { small: 25, medium: 35, large: 45 } });
  });

  it("persists preset slot assignment from the edit panel", async () => {
    const fetchState = mockReaFetch(initialSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Light" }));
    expect(screen.getByRole("dialog", { name: "Edit Light preset" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use Classic" }));

    expect(await screen.findByRole("button", { name: "Light Classic" })).toBeInTheDocument();
    expect(fetchState.savedSettings.presetSlots[0]).toEqual({ label: "Light", profileId: "p2" });
    expect(screen.queryByRole("dialog", { name: "Edit Light preset" })).not.toBeInTheDocument();
  });

  it("assigns a preset profile when only local settings storage is available", async () => {
    localStorage.setItem("reaprime-skin:workflow-skin:settings", JSON.stringify(initialSettings));
    mockReaFetch(initialSettings, { settingsStorageMissing: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Light" }));
    await userEvent.click(screen.getByRole("button", { name: "Use Classic" }));

    expect(await screen.findByRole("button", { name: "Light Classic" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Edit Light preset" })).not.toBeInTheDocument();
    expect(localStorage.getItem("reaprime-skin:workflow-skin:settings")).toContain('"profileId":"p2"');
  });

  it("applies the configured startup profile after loading", async () => {
    const fetchState = mockReaFetch({ ...initialSettings, startupProfileId: "p2" });
    render(<App />);

    await waitFor(() => {
      expect(fetchState.workflow).toEqual(
        expect.objectContaining({
          profile: profiles[1].profile,
          context: expect.objectContaining({
            extras: { workflowSkin: { selectedProfileId: "p2" } }
          })
        })
      );
    });
  });

  it("re-applies the startup profile when the first startup refresh does not confirm it", async () => {
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        startupProfileId: "p2",
        presetSlots: [
          { label: "Light", profileId: "p1" },
          { label: "Sweet", profileId: "p2" },
          { label: "Turbo" },
          { label: "Classic" }
        ]
      },
      {
        workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
        workflowUpdateStaleCount: 1
      }
    );
    render(<App />);

    await waitFor(() => expect(fetchState.workflowUpdateCount).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole("button", { name: "Sweet Classic" })).toHaveAttribute("aria-current", "true");
  });

  it("does not wake, scan, or apply startup profile while the machine is sleeping in the background", async () => {
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        startupProfileId: "p2",
        r2SensorId: "F4:12:FA:FA:AC:E3",
        presetSlots: [
          { label: "Light", profileId: "p1" },
          { label: "Sweet", profileId: "p2" },
          { label: "Turbo" },
          { label: "Classic" }
        ]
      },
      {
        workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
        machineState: { connected: true, state: { state: "sleeping", substate: "idle" } },
        devices: [{ id: "scale-1", name: "BooKoo", type: "scale", state: "disconnected" }]
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).not.toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/idle", expect.objectContaining({ method: "PUT" }));
    expect(fetchState.scanCount).toBe(0);
    expect(fetchState.connectCount).toBe(0);
    expect(fetchState.workflowUpdateCount).toBe(0);
  });

  it("starts a full scale scan while an explicit wake request is still settling", async () => {
    const scaleDevice = { id: "scale-1", name: "Acaia", type: "scale", state: "discovered" };
    const fetchState = mockReaFetch({ ...initialSettings, keepScreenAwake: true, screensaverBrightness: 8 } as SkinSettings, {
      machineState: { connected: true, state: { state: "idle" } },
      machineStateAfterWakeRequest: { connected: true, state: { state: "sleeping", substate: "waking" } },
      devices: [],
      scanDevicesResult: [scaleDevice]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sleep machine" }));
    expect(await screen.findByText("Tap the screen to wake")).toBeInTheDocument();

    await act(async () => {
      screen.getByRole("button", { name: "Tap the screen to wake" }).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/idle", expect.objectContaining({ method: "PUT" }));
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
    );
  });

  it("does not re-apply the startup profile after a manual preset change", async () => {
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        startupProfileId: "p2",
        presetSlots: [
          { label: "Light", profileId: "p1" },
          { label: "Sweet", profileId: "p2" },
          { label: "Turbo" },
          { label: "Classic" }
        ]
      },
      {
        workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p2" } } } }
      }
    );
    render(<App />);

    expect(await screen.findByRole("button", { name: "Sweet Classic" })).toHaveAttribute("aria-current", "true");

    await userEvent.click(screen.getByRole("button", { name: "Light Blooming" }));

    await waitFor(() => expect(fetchState.workflowUpdateCount).toBe(1));
    expect(await screen.findByRole("button", { name: "Light Blooming" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Sweet Classic" })).not.toHaveAttribute("aria-current");
  });

  it("does not let wake recovery overwrite a manual preset change with the startup profile", async () => {
    const scaleDevice: DeviceInfo = { id: "scale-1", name: "Acaia", type: "scale", state: "discovered" };
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        startupProfileId: "p2",
        keepScreenAwake: true,
        screensaverBrightness: 8,
        presetSlots: [
          { label: "Light", profileId: "p1" },
          { label: "Sweet", profileId: "p2" },
          { label: "Turbo" },
          { label: "Classic" }
        ]
      },
      {
        workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p2" } } } },
        machineState: { connected: true, state: { state: "idle" } },
        devices: [],
        scanDevicesResult: [scaleDevice]
      }
    );
    render(<App />);

    expect(await screen.findByRole("button", { name: "Sweet Classic" })).toHaveAttribute("aria-current", "true");

    await userEvent.click(screen.getByRole("button", { name: "Sleep machine" }));
    expect(await screen.findByText("Tap the screen to wake")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tap the screen to wake" }));
    await userEvent.click(await screen.findByRole("button", { name: "Light Blooming" }));
    await waitFor(() =>
      expect(fetchState.workflow).toEqual(
        expect.objectContaining({
          context: expect.objectContaining({ extras: { workflowSkin: { selectedProfileId: "p1" } } })
        })
      )
    );

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 750));
    });

    expect(screen.getByRole("button", { name: "Light Blooming" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Sweet Classic" })).not.toHaveAttribute("aria-current");
    expect(fetchState.workflow).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({ extras: { workflowSkin: { selectedProfileId: "p1" } } })
      })
    );
  });

  it("re-applies the startup profile and reconnects devices after waking from screensaver sleep", async () => {
    const fetchState = mockReaFetch({
      ...initialSettings,
      startupProfileId: "p2",
      r2SensorId: "F4:12:FA:FA:AC:E3",
      presetSlots: [
        { label: "Light", profileId: "p1" },
        { label: "Sweet", profileId: "p2" },
        { label: "Turbo" },
        { label: "Classic" }
      ]
    });
    render(<App />);

    await waitFor(() => expect(fetchState.workflowUpdateCount).toBe(1));

    await userEvent.click(await screen.findByRole("button", { name: "Sleep machine" }));
    expect(await screen.findByText("Machine sleeping")).toBeInTheDocument();
    fetchState.setWorkflow({ context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } });
    const scansBeforeWake = fetchState.scanCount;

    await userEvent.click(screen.getByRole("button", { name: "Tap the screen to wake" }));

    await waitFor(() => expect(fetchState.scanCount).toBeGreaterThan(scansBeforeWake));
    await waitFor(() => expect(fetchState.workflowUpdateCount).toBeGreaterThan(1));
    expect(fetchState.workflow).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          extras: { workflowSkin: { selectedProfileId: "p2" } }
        })
      })
    );
  });

  it("keeps the startup preset selected through stale wake refreshes", async () => {
    let resolveWorkflowUpdate: (() => void) | undefined;
    const blockedWorkflowUpdate = new Promise<void>((resolve) => {
      resolveWorkflowUpdate = resolve;
    });
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        startupProfileId: "p2",
        presetSlots: [
          { label: "Light", profileId: "p1" },
          { label: "Sweet", profileId: "p2" },
          { label: "Turbo" },
          { label: "Classic" }
        ]
      },
      {
        workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p2" } } } },
        workflowUpdateDelay: (count) => (count === 1 ? blockedWorkflowUpdate : undefined),
        machineState: { connected: true, state: { state: "idle" } },
        devices: []
      }
    );
    render(<App />);

    expect(await screen.findByRole("button", { name: "Sweet Classic" })).toHaveAttribute("aria-current", "true");

    await userEvent.click(screen.getByRole("button", { name: "Sleep machine" }));
    expect(await screen.findByText("Tap the screen to wake")).toBeInTheDocument();
    fetchState.setWorkflow({ context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } });

    await userEvent.click(screen.getByRole("button", { name: "Tap the screen to wake" }));
    await waitFor(() => expect(fetchState.workflowUpdateCount).toBe(1));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Sweet Classic" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Light Blooming" })).not.toHaveAttribute("aria-current");

    resolveWorkflowUpdate?.();
    await waitFor(() =>
      expect(fetchState.workflow).toEqual(
        expect.objectContaining({
          context: expect.objectContaining({ extras: { workflowSkin: { selectedProfileId: "p2" } } })
        })
      )
    );
  });

  it("auto-connects machine and scale devices on startup when the machine is already awake", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "idle" } },
      devices: [
        { id: "machine-1", name: "DE1", type: "machine", state: "disconnected" },
        { id: "scale-1", name: "Acaia", type: "scale", state: "discovered" }
      ]
    });
    render(<App />);

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/scan?connect=true&quick=true",
        expect.objectContaining({ method: "GET" })
      );
    });
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "machine-1" }) })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
    );
    expect(fetchState.fetchMock).not.toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/idle", expect.objectContaining({ method: "PUT" }));
  });

  it("auto-connects a configured R2 on startup using the full scan when needed", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        devices: [],
        scanDevicesResult: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]
      }
    );
    render(<App />);

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
        expect.objectContaining({ method: "GET" })
      );
    });
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
    );
  });

  it("uses the startup device recovery sequence after waking from sleep", async () => {
    vi.useFakeTimers();
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        machineState: { connected: true, state: { state: "sleeping", substate: "idle" } },
        devices: [],
        scanDevicesResult: ({ quick }) =>
          quick
            ? [{ id: "scale-1", name: "Acaia Lunar", type: "scale", state: "discovered" }]
            : [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchState.scanRequests).toEqual([]);

    fetchState.setMachineState({ connected: true, state: { state: "idle" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_300);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.scanRequests.map((request) => request.path)).toEqual([
      "/api/v1/devices/scan?connect=true&quick=true",
      "/api/v1/devices/scan?connect=true&quick=false"
    ]);
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
    );
  });

  it("keeps the brew page after a preset is pressed until brewing starts", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "idle" }, wifi: { connected: true, ipAddress: "192.168.1.20" } }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Light Blooming" }));

    expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Live Brew" })).not.toBeInTheDocument();
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/workflow",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("does not expose a main-page Start Brew button", async () => {
    const fetchState = mockReaFetch(initialSettings);
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Brew" })).not.toBeInTheDocument();

    expect(fetchState.fetchMock).not.toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/machine/state/espresso",
      expect.objectContaining({ method: "PUT" })
    );
  });

  it("opens live data when the machine is already brewing", async () => {
    mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "espresso", substate: "pouring" } }
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Live Brew" })).toBeInTheDocument();
  });

  it("opens review as soon as espresso returns idle without sending non-milk shots to steam", async () => {
    vi.useFakeTimers();
    const shot: ShotRecord = {
      id: "shot-idle-1",
      timestamp: "2026-06-12T10:00:00.000Z",
      workflow: {
        profile: profiles[0].profile,
        context: { extras: { workflowSkin: { selectedProfileId: "p1" } } }
      },
      measurements: []
    };
    const fetchState = mockReaFetch(
      { ...initialSettings, defaultReviewEnabled: false },
      {
        machineState: { connected: true, state: { state: "espresso", substate: "pouring" } },
        shots: [shot]
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();

    fetchState.setMachineState({ connected: true, state: { state: "idle" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Shot Review" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Live Brew" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brew" })).not.toBeInTheDocument();
    expect(screen.queryByText("Steam Workflow")).not.toBeInTheDocument();
  });

  it("reviews the completed latest shot with the captured live graph after brew returns idle", async () => {
    vi.useFakeTimers();
    const previousShot: ShotRecord = {
      id: "previous-shot",
      timestamp: "2026-06-12T09:30:00.000Z",
      workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
      measurements: [
        { machine: { timestamp: "2026-06-12T09:30:00.000Z", pressure: 1, flow: 1 }, scale: { weight: 2 } },
        { machine: { timestamp: "2026-06-12T09:30:20.000Z", pressure: 7, flow: 2 }, scale: { weight: 30 } }
      ]
    };
    const completedShot: ShotRecord = {
      id: "completed-shot",
      timestamp: "2026-06-12T10:00:00.000Z",
      workflow: {
        profile: profiles[0].profile,
        context: { extras: { workflowSkin: { selectedProfileId: "p1" } } }
      },
      measurements: [
        { machine: { timestamp: "2026-06-12T10:00:00.000Z", pressure: 2, flow: 1 }, scale: { weight: 5 } },
        { machine: { timestamp: "2026-06-12T10:00:28.000Z", pressure: 9, flow: 2 }, scale: { weight: 40 } }
      ]
    };
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "espresso", substate: "pouring" } },
      shots: [previousShot]
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fetchState.setShots([completedShot, previousShot]);
    fetchState.setMachineState({ connected: true, state: { state: "idle" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "Shot Review" })).toBeInTheDocument();
    expect(screen.getByText("Duration: 28s")).toBeInTheDocument();
    expect(screen.getByText("Yield: 40 g")).toBeInTheDocument();
    expect(screen.queryByText("Duration: 20s")).not.toBeInTheDocument();
    expect(fetchState.scaleTareCount).toBe(0);
  });

  it("tares the scale and stays on brew when espresso returns idle without a new shot", async () => {
    vi.useFakeTimers();
    const previousShot: ShotRecord = {
      id: "previous-shot",
      timestamp: "2026-06-12T09:30:00.000Z",
      workflow: { context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
      measurements: [
        { machine: { timestamp: "2026-06-12T09:30:00.000Z", pressure: 1, flow: 1 }, scale: { weight: 2 } },
        { machine: { timestamp: "2026-06-12T09:30:20.000Z", pressure: 7, flow: 2 }, scale: { weight: 30 } }
      ]
    };
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "idle" } },
      shots: [previousShot]
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Brew" })).toBeInTheDocument();

    fetchState.setMachineState({ connected: true, state: { state: "espresso", substate: "pouring" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();

    fetchState.setMachineState({ connected: true, state: { state: "idle" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Shot Review" })).not.toBeInTheDocument();
    expect(fetchState.scaleTareCount).toBe(1);
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/scale/tare", expect.objectContaining({ method: "PUT" }));
  });

  it("measures R2 twenty seconds after the shot reaches the review page", async () => {
    vi.useFakeTimers();
    const completedShot: ShotRecord = {
      id: "completed-shot-r2-auto",
      timestamp: "2026-06-17T08:00:00.000Z",
      workflow: {
        profile: profiles[0].profile,
        context: { extras: { workflowSkin: { selectedProfileId: "p1" } } }
      },
      measurements: []
    };
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        sensors: [detectedR2Sensor],
        devices: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "connected" }],
        machineState: { connected: true, state: { state: "espresso", substate: "pouring" } },
        shots: []
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();

    fetchState.setShots([completedShot]);
    fetchState.setMachineState({ connected: true, state: { state: "idle" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "Shot Review" })).toBeInTheDocument();
    expect(fetchState.sensorExecuteCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(19_999);
      await Promise.resolve();
    });
    expect(fetchState.sensorExecuteCount).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.sensorExecuteCount).toBe(1);
    expect(screen.getByText("R2 TDS 9.8 imported.")).toBeInTheDocument();
  });

  it("opens review as soon as espresso returns idle for milk profiles too", async () => {
    vi.useFakeTimers();
    const shot: ShotRecord = {
      id: "shot-milk-1",
      timestamp: "2026-06-12T10:00:00.000Z",
      workflow: {
        profile: profiles[0].profile,
        context: { extras: { workflowSkin: { selectedProfileId: "p1" } } }
      },
      measurements: []
    };
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        defaultReviewEnabled: false,
        profileWorkflows: { p1: { milkBased: true, steamTimers: { small: 20, medium: 30, large: 40 } } }
      },
      {
        machineState: { connected: true, state: { state: "espresso", substate: "pouring" } },
        shots: [shot]
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("heading", { name: "Live Brew" })).toBeInTheDocument();
    fetchState.setMachineState({ connected: true, state: { state: "idle" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("heading", { name: "Shot Review" })).toBeInTheDocument();
    expect(screen.queryByText("Steam Workflow")).not.toBeInTheDocument();
  });

  it("reconnects and retries R2 when the native measure command times out", async () => {
    const shot: ShotRecord = {
      id: "shot-r2-retry",
      timestamp: "2026-06-15T08:00:00.000Z",
      workflow: {
        profile: profiles[0].profile,
        context: { extras: { workflowSkin: { selectedProfileId: "p1" } } }
      },
      measurements: []
    };
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        sensors: [detectedR2Sensor],
        devices: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "connected" }],
        scanDevicesResult: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }],
        devicesAfterScan: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "connected" }],
        shots: [shot],
        sensorExecuteResults: [
          { status: 500, body: { error: "FlutterBluePlusException | connect | fbp-code: 1 | Timed out after 15s" } },
          { body: { status: "ok", result: { reading: { tds: 9.7 } } } }
        ]
      }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Review" }));
    await userEvent.click(await screen.findByRole("button", { name: "Read from R2" }));

    expect(await screen.findByText("R2 TDS 9.7 imported.")).toBeInTheDocument();
    expect(fetchState.sensorExecuteCount).toBe(2);
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
    );
  });

  it("starts native steaming and stops it when the selected steam timer ends", async () => {
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        profileWorkflows: { p1: { milkBased: true, steamTimers: { small: 2, medium: 30, large: 40 } } }
      },
      {
        workflow: { profile: profiles[0].profile, context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
        machineState: { connected: true, state: { state: "idle" } }
      }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Steam" }));
    fireEvent.click(within(screen.getByLabelText("Steam timer presets")).getByRole("button", { name: /Small jug/i }));

    vi.useFakeTimers();
    await act(async () => {
      screen.getByRole("button", { name: "Start" }).click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/steam", expect.objectContaining({ method: "PUT" }));

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/idle", expect.objectContaining({ method: "PUT" }));
  });

  it("persists steam timer edits from the steam page to the active profile workflow", async () => {
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        profileWorkflows: { p1: { milkBased: true, steamTimers: { small: 20, medium: 30, large: 40 } } }
      },
      {
        workflow: { profile: profiles[0].profile, context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
        machineState: { connected: true, state: { state: "idle" } }
      }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Steam" }));
    fireEvent.change(screen.getByLabelText("Timer seconds Medium jug"), { target: { value: "38" } });

    await waitFor(() => {
      expect(fetchState.savedSettings.profileWorkflows.p1.steamTimers).toEqual({ small: 20, medium: 38, large: 40 });
    });
  });

  it("starts the steam timer for GHC steam-like native state names", async () => {
    vi.useFakeTimers();
    const fetchState = mockReaFetch(
      {
        ...initialSettings,
        profileWorkflows: { p1: { milkBased: true, steamTimers: { small: 20, medium: 2, large: 40 } } }
      },
      {
        workflow: { profile: profiles[0].profile, context: { extras: { workflowSkin: { selectedProfileId: "p1" } } } },
        machineState: { connected: true, state: { state: "idle" } }
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Steam" }));
    expect(screen.getByText("0:02")).toBeInTheDocument();

    fetchState.fetchMock.mockClear();
    fetchState.setMachineState({ connected: true, state: { state: "steamRinse", substate: "steaming" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(screen.getByText("0:01")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/idle", expect.objectContaining({ method: "PUT" }));
  });

  it("auto sleeps the machine after the configured idle timer", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, autoSleepMinutes: 0.001, screensaverBrightness: 13 },
      {
        machineState: { connected: true, state: { state: "idle" }, wifi: { connected: true, ipAddress: "192.168.1.20" } }
      }
    );
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();

    await waitFor(
      () => {
        expect(fetchState.fetchMock).toHaveBeenCalledWith(
          "http://localhost:8080/api/v1/machine/state/sleeping",
          expect.objectContaining({ method: "PUT" })
        );
      },
      { timeout: 1500 }
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/display/brightness",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ brightness: 13 }) })
    );
    expect(fetchState.displayState).toEqual(expect.objectContaining({ brightness: 13, wakeLockOverride: false }));
    expect(await screen.findByText("Machine sleeping")).toBeInTheDocument();
  });

  it("auto sleeps from settings after the configured idle timer", async () => {
    vi.useFakeTimers();
    const fetchState = mockReaFetch(
      { ...initialSettings, autoSleepMinutes: 1, screensaverBrightness: 13 },
      {
        machineState: { connected: true, state: { state: "idle" }, wifi: { connected: true, ipAddress: "192.168.1.20" } }
      }
    );
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(fetchState.fetchMock).not.toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/machine/state/sleeping",
      expect.objectContaining({ method: "PUT" })
    );

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/machine/state/sleeping",
      expect.objectContaining({ method: "PUT" })
    );
    expect(screen.getByText("Machine sleeping")).toBeInTheDocument();
  });

  it("puts the machine to sleep and moves into screensaver mode", async () => {
    const fetchState = mockReaFetch({ ...initialSettings, keepScreenAwake: true, screensaverBrightness: 8 } as SkinSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sleep machine" }));

    expect(await screen.findByRole("heading", { name: "WorkFlow" })).toBeInTheDocument();
    expect(screen.getByText("Machine sleeping")).toBeInTheDocument();
    expect(screen.getByText("Tap the screen to wake")).toBeInTheDocument();
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/display/brightness",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ brightness: 8 }) })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/display/wakelock", expect.objectContaining({ method: "DELETE" }));
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/sleeping", expect.objectContaining({ method: "PUT" }));

    await userEvent.click(screen.getByRole("button", { name: "Tap the screen to wake" }));

    expect(await screen.findByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/display/brightness",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ brightness: 100 }) })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/display/wakelock", expect.objectContaining({ method: "POST" }));
  });

  it("shows the screensaver immediately while the native sleep request is still pending", async () => {
    let resolveSleep: (() => void) | undefined;
    const sleepPending = new Promise<void>((resolve) => {
      resolveSleep = resolve;
    });
    mockReaFetch({ ...initialSettings, keepScreenAwake: true, screensaverBrightness: 8 } as SkinSettings, {
      sleepMachineDelay: sleepPending
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sleep machine" }));

    expect(screen.getByText("Machine sleeping")).toBeInTheDocument();
    expect(screen.getByText("Tap the screen to wake")).toBeInTheDocument();

    resolveSleep?.();
  });

  it("keeps the screensaver visible when the native sleep request fails because the machine is disconnected", async () => {
    const fetchState = mockReaFetch({ ...initialSettings, keepScreenAwake: true, screensaverBrightness: 8 } as SkinSettings, {
      sleepMachineStatus: 500,
      sleepMachineBody:
        '{"error":"DeviceNotConnectedException: machine not connected\\n#0 De1Controller.connectedDe1 (package:reaprime/src/controllers/de1_controller.dart:230)"}'
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sleep machine" }));

    expect(await screen.findByText("Tap the screen to wake")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brew" })).not.toBeInTheDocument();
    expect(screen.queryByText(/De1Controller\.connectedDe1/i)).not.toBeInTheDocument();
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/display/brightness",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ brightness: 8 }) })
    );
  });

  it("does not loop auto sleep requests after the native sleep endpoint fails", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, autoSleepMinutes: 0.001, screensaverBrightness: 8 },
      {
        machineState: { connected: true, state: { state: "idle" }, wifi: { connected: true, ipAddress: "192.168.1.20" } },
        sleepMachineStatus: 500,
        sleepMachineBody: '{"error":"DeviceNotConnectedException: machine not connected"}'
      }
    );
    render(<App />);

    expect(await screen.findByText("Tap the screen to wake", {}, { timeout: 1500 })).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    const laterSleepCalls = fetchState.fetchMock.mock.calls.filter(
      ([input, init]) => String(input) === "http://localhost:8080/api/v1/machine/state/sleeping" && init?.method === "PUT"
    ).length;
    expect(laterSleepCalls).toBe(1);
    expect(screen.queryByRole("heading", { name: "Brew" })).not.toBeInTheDocument();
  });

  it("dismisses the screensaver immediately while wake polling is still pending", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, keepScreenAwake: true, screensaverBrightness: 8 } as SkinSettings,
      {
        machineState: { connected: true, state: { state: "idle" }, wifi: { connected: true, ipAddress: "192.168.1.20" } },
        machineStateAfterWakeRequest: { connected: true, state: { state: "sleeping", substate: "waking" } }
      }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Sleep machine" }));
    expect(await screen.findByText("Tap the screen to wake")).toBeInTheDocument();

    vi.useFakeTimers();
    await act(async () => {
      screen.getByRole("button", { name: "Tap the screen to wake" }).click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByText("Tap the screen to wake")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Brew" })).toBeInTheDocument();
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/machine/state/idle", expect.objectContaining({ method: "PUT" }));
  });

  it("shows a fullscreen button to the right of sleep and toggles native fullscreen", async () => {
    let fullscreenElement: Element | null = null;
    const requestFullscreen = vi.fn().mockImplementation(() => {
      fullscreenElement = document.documentElement;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const exitFullscreen = vi.fn().mockImplementation(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });

    mockReaFetch(initialSettings);
    const { container } = render(<App />);
    const actions = container.querySelector(".top-status-actions") as HTMLElement;

    expect(actions).toBeInTheDocument();
    expect(within(actions).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Sleep machine", "Enter fullscreen"]);

    await userEvent.click(await within(actions).findByRole("button", { name: "Enter fullscreen" }));

    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(await within(actions).findByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();

    await userEvent.click(within(actions).getByRole("button", { name: "Exit fullscreen" }));

    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it("keeps the machine status screen-level and top action buttons grouped", async () => {
    mockReaFetch(initialSettings);
    const { container } = render(<App />);

    await screen.findByRole("heading", { name: "Brew" });
    const shell = container.querySelector(".app-shell") as HTMLElement;
    const topbar = screen.getByRole("banner", { name: "Machine status bar" });
    const actions = container.querySelector(".top-status-actions") as HTMLElement;
    const machineStatus = screen.getByLabelText("Machine current status");

    expect(shell).toContainElement(topbar);
    expect(topbar).toContainElement(machineStatus);
    expect(topbar).toBeInTheDocument();
    expect(topbar).toContainElement(actions);
    expect(within(actions).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Sleep machine", "Enter fullscreen"]);
    expect(within(actions).getByRole("button", { name: "Enter fullscreen" })).not.toHaveTextContent(/Full|Exit/);
  });

  it("opens a history shot in review with full shot details", async () => {
    const listShot: ShotRecord = {
      id: "history-shot",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: {
        profile: { title: "History espresso" },
        context: { extras: { workflowSkin: { selectedProfileId: "p1" } }, targetDoseWeight: 18 }
      },
      annotations: { actualYield: 0, enjoyment: 8 }
    };
    const fullShot: ShotRecord = {
      ...listShot,
      annotations: { ...listShot.annotations, actualYield: 24 },
      measurements: [
        { machine: { timestamp: "2026-06-18T08:00:00.000Z", pressure: 1, flow: 1 }, scale: { weight: 0 } },
        { machine: { timestamp: "2026-06-18T08:00:12.000Z", pressure: 8, flow: 2 }, scale: { weight: 24 } }
      ]
    };
    mockReaFetch(initialSettings, {
      shots: [listShot],
      shotDetailsById: { "history-shot": fullShot }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open shot review for History espresso" }));

    expect(await screen.findByRole("heading", { name: "Shot Review" })).toBeInTheDocument();
    expect(screen.getByText("Duration: 12s")).toBeInTheDocument();
    expect(screen.getByText("Yield: 24 g")).toBeInTheDocument();
  });

  it("prefills a community recommendation from history shot data", async () => {
    profiles = [{ id: "p1", profile: { title: "Blooming", notes: "Profile notes", steps: [{ name: "Bloom", pressure: 2 }] } }];
    const shot: ShotRecord = {
      id: "history-rec-shot",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: {
        profile: { title: "History espresso" },
        context: {
          extras: { workflowSkin: { selectedProfileId: "p1", grindSize: "4.4" } },
          beanBatchId: "batch-1",
          grinderId: "g1",
          targetDoseWeight: 18,
          targetYield: 42
        }
      },
      annotations: { actualDoseWeight: 18.2, actualYield: 41.8, espressoNotes: "Sweet citrus", enjoyment: 8 },
      measurements: [
        { machine: { timestamp: "2026-06-18T08:00:00.000Z", pressure: 1 }, scale: { weight: 0 } },
        { machine: { timestamp: "2026-06-18T08:00:31.000Z", pressure: 8 }, scale: { weight: 41.8 } }
      ]
    };
    const fetchState = mockReaFetch(initialSettings, {
      decentAccount: { connected: true, username: "royack" },
      shots: [shot],
      beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", region: "Yirgacheffe", processing: "Washed", notes: "floral" }],
      batchesByBeanId: {
        "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", roastLevel: "Light", notes: "batch notes", extras: { workflowSkin: { name: "Halo" } } }]
      },
      grinders: [{ id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP", notes: "travel grinder" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: "Recommend profile from History espresso" }));

    expect(await screen.findByRole("heading", { name: "Community" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recommend Profile" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Saved bag")).toHaveValue("batch-1");
    expect(screen.getByLabelText("Profile")).toHaveValue("p1");
    expect(screen.getByLabelText("Grinder")).toHaveValue("g1");
    expect(screen.getByLabelText("Grind setting")).toHaveValue("4.4");
    expect(screen.getByLabelText("Beans weight")).toHaveValue("18.2");
    expect(screen.getByLabelText("Drink weight")).toHaveValue("41.8");
    expect(screen.getByLabelText("Seconds min")).toHaveValue("31");
    expect(screen.getByLabelText("Seconds max")).toHaveValue("31");
    expect(screen.getByLabelText("Shot evidence")).toHaveValue("history-rec-shot");
    expect(screen.getByRole("option", { name: /8\/10/ })).toBeInTheDocument();
    expect(screen.getByLabelText("Notes")).toHaveValue("Sweet citrus");

    await userEvent.click(screen.getByRole("button", { name: "Upload recommendation" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Recommendation uploaded.");
    expect(fetchState.communityCreatePayloads[0]).toEqual(
      expect.objectContaining({
        recommendation: expect.objectContaining({
          grinder: expect.objectContaining({ id: "g1", burrType: "flat" }),
          brew: expect.objectContaining({
            grindSetting: "4.4",
            beansWeight: 18.2,
            drinkWeight: 41.8,
            secondsMin: 31,
            secondsMax: 31,
            notes: "Sweet citrus"
          })
        }),
        evidence: expect.objectContaining({ id: "history-rec-shot", enjoyment: 8, grindSetting: "4.4", grinderId: "g1" })
      })
    );
    const uploaded = fetchState.communityStore.get("/api/v1/store/workflow-skin/community-uploaded-profiles") as Array<Record<string, unknown>>;
    expect(uploaded).toEqual([
      expect.objectContaining({
        recommendationId: "created-rec-1",
        evidence: expect.objectContaining({ id: "history-rec-shot", enjoyment: 8, grindSetting: "4.4", grinderId: "g1" })
      })
    ]);
  });

  it("prefills history recommendations with the saved shot grinder before falling back to the default grinder", async () => {
    profiles = [{ id: "p1", profile: { title: "Blooming", notes: "Profile notes", steps: [{ name: "Bloom", pressure: 2 }] } }];
    const baseShot: ShotRecord = {
      id: "history-rec-shot",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: {
        profile: { title: "History espresso" },
        context: {
          extras: { workflowSkin: { selectedProfileId: "p1", grindSize: "4.4" } },
          beanBatchId: "batch-1",
          targetDoseWeight: 18,
          targetYield: 42
        }
      },
      annotations: { actualDoseWeight: 18, actualYield: 42, espressoNotes: "Sweet citrus", extras: { workflowSkin: { grinderId: "g2" } } }
    };
    const fetchState = mockReaFetch(
      { ...initialSettings, defaultGrinderId: "g1" },
      {
        shots: [baseShot],
        beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", region: "Yirgacheffe", processing: "Washed" }],
        batchesByBeanId: {
          "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", roastLevel: "Light", extras: { workflowSkin: { name: "Halo" } } }]
        },
        grinders: [
          { id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP" },
          { id: "g2", model: "EK43", settingType: "numeric", burrType: "flat", burrs: "SSP HU" }
        ]
      }
    );
    const { unmount } = render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: "Recommend profile from History espresso" }));

    expect(await screen.findByLabelText("Grinder")).toHaveValue("g2");

    fetchState.fetchMock.mockRestore();
    unmount();
    profiles = [{ id: "p1", profile: { title: "Blooming", notes: "Profile notes", steps: [{ name: "Bloom", pressure: 2 }] } }];
    mockReaFetch(
      { ...initialSettings, defaultGrinderId: "g1" },
      {
        shots: [{ ...baseShot, annotations: { actualDoseWeight: 18, actualYield: 42, espressoNotes: "Sweet citrus" } }],
        beans: [{ id: "bean-1", roaster: "Pilot", name: "Ethiopia Halo", country: "Ethiopia", region: "Yirgacheffe", processing: "Washed" }],
        batchesByBeanId: {
          "bean-1": [{ id: "batch-1", beanId: "bean-1", roastDate: "2026-06-01", roastLevel: "Light", extras: { workflowSkin: { name: "Halo" } } }]
        },
        grinders: [
          { id: "g1", model: "ZP6", settingType: "numeric", burrType: "flat", burrs: "MP" },
          { id: "g2", model: "EK43", settingType: "numeric", burrType: "flat", burrs: "SSP HU" }
        ]
      }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "History" }));
    await userEvent.click(await screen.findByRole("button", { name: "Recommend profile from History espresso" }));

    expect(await screen.findByLabelText("Grinder")).toHaveValue("g1");
  });

  it("saves Beanie machine settings through native machine endpoints", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      machineSettings: {
        usb: true,
        fan: 40,
        flushTemp: 90,
        flushFlow: 6,
        flushTimeout: 5,
        hotWaterFlow: 6,
        steamFlow: 1.2,
        tankTemp: 0,
        steamPurgeMode: 0
      },
      advancedMachineSettings: {
        heaterPh1Flow: 4,
        heaterPh2Flow: 4,
        heaterIdleTemp: 85,
        heaterPh2Timeout: 10,
        heaterVoltage: 230,
        refillKitSetting: 2
      },
      machineCalibration: { flowMultiplier: 1 }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    fireEvent.change(await screen.findByLabelText("Steam flow"), { target: { value: "1.6" } });
    await userEvent.click(screen.getByRole("checkbox", { name: /I understand these advanced settings/i }));
    fireEvent.change(screen.getByLabelText("Flow calibration"), { target: { value: "1.08" } });
    await userEvent.click(screen.getByRole("button", { name: "Save machine settings" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/machine/settings",
        expect.objectContaining({ method: "POST", body: expect.stringContaining('"steamFlow":1.6') })
      );
    });
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/machine/settings/advanced",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"heaterPh1Flow":4') })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/machine/calibration",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"flowMultiplier":1.08') })
    );
  });

  it("refreshes and connects the R2 sensor from settings", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      sensors: [],
      sensorsAfterScan: [detectedR2Sensor],
      devicesAfterScan: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Skin settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Refresh R2" }));

    await waitFor(() => expect(fetchState.savedSettings.r2SensorId).toBe("F4:12:FA:FA:AC:E3"));
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
    );
  });

  it("connects an R2 device returned only by the scan response from settings refresh", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      sensors: [],
      sensorsAfterScan: [detectedR2Sensor],
      scanDevicesResult: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Skin settings" }));
    await userEvent.click(await screen.findByRole("button", { name: "Refresh R2" }));

    await waitFor(() => expect(fetchState.savedSettings.r2SensorId).toBe("F4:12:FA:FA:AC:E3"));
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
    );
  });

  it("refreshes the native R2 connection when the disconnected R2 status is pressed", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        sensors: [],
        sensorsAfterScan: [detectedR2Sensor],
        scanDevicesResult: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]
      }
    );
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "R2" }));

    await waitFor(() => expect(fetchState.savedSettings.r2SensorId).toBe("F4:12:FA:FA:AC:E3"));
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
    );
  });

  it("runs the startup discovery sequence when pressing R2 after it was powered on late", async () => {
    let poweredOn = false;
    let sawPoweredQuickScan = false;
    const r2Device: DeviceInfo = { id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" };
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        devices: [],
        sensorsAfterScan: [detectedR2Sensor],
        scanDevicesResult: ({ quickParam }) => {
          if (!poweredOn) return [];
          if (quickParam === true) {
            sawPoweredQuickScan = true;
            return [];
          }
          if (quickParam === false && sawPoweredQuickScan) return [r2Device];
          return [];
        }
      }
    );
    render(<App />);

    await waitFor(() => expect(fetchState.scanRequests.length).toBeGreaterThanOrEqual(2));
    poweredOn = true;
    const scansBeforePress = fetchState.scanRequests.length;

    await userEvent.click(await screen.findByRole("button", { name: "R2" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
      );
    });
    expect(fetchState.scanRequests.slice(scansBeforePress, scansBeforePress + 2).map((request) => request.path)).toEqual([
      "/api/v1/devices/scan?connect=true&quick=true",
      "/api/v1/devices/scan?connect=true&quick=false"
    ]);
  });

  it("refreshes R2 when pressing a stale connected R2 indicator after it was powered on late", async () => {
    let poweredOn = false;
    let sawPoweredQuickScan = false;
    const r2Device = (state: string): DeviceInfo => ({ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state });
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        devices: [r2Device("connected")],
        sensorsAfterScan: [detectedR2Sensor],
        scanDevicesResult: ({ quickParam }) => {
          if (!poweredOn) return [];
          if (quickParam === true) {
            sawPoweredQuickScan = true;
            return [];
          }
          if (quickParam === false && sawPoweredQuickScan) return [r2Device("discovered")];
          return [];
        }
      }
    );
    render(<App />);

    expect(await screen.findByRole("button", { name: "R2" })).toHaveAttribute("title", "R2: Connected");
    await waitFor(() => expect(fetchState.scanRequests.length).toBeGreaterThanOrEqual(2));
    poweredOn = true;
    const scansBeforePress = fetchState.scanRequests.length;

    await userEvent.click(screen.getByRole("button", { name: "R2" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
      );
    });
    expect(fetchState.scanRequests.slice(scansBeforePress, scansBeforePress + 2).map((request) => request.path)).toEqual([
      "/api/v1/devices/scan?connect=true&quick=true",
      "/api/v1/devices/scan?connect=true&quick=false"
    ]);
  });

  it("treats a stale configured R2 sensor as disconnected when the native device is disconnected", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        sensors: [detectedR2Sensor],
        devices: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "disconnected" }],
        scanDevicesResult: [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]
      }
    );
    render(<App />);

    expect(await screen.findByRole("button", { name: "R2" })).toHaveAttribute("title", "R2: Not connected");
    await userEvent.click(screen.getByRole("button", { name: "R2" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
      );
    });
  });

  it("refreshes R2 when pressing a configured R2 indicator backed only by stale sensor data", async () => {
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        sensors: [detectedR2Sensor],
        devices: [],
        scanDevicesResult: ({ scanCount }) => (scanCount < 2 ? [] : [{ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state: "discovered" }]),
        sensorsAfterScan: [detectedR2Sensor]
      }
    );
    render(<App />);

    expect(await screen.findByRole("button", { name: "R2" })).toHaveAttribute("title", "R2: Not connected");
    await userEvent.click(screen.getByRole("button", { name: "R2" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "F4:12:FA:FA:AC:E3" }) })
      );
    });
  });

  it("keeps refreshing R2 after the indicator connect until the native device shows connected", async () => {
    const r2Device = (state: string): DeviceInfo => ({ id: "F4:12:FA:FA:AC:E3", name: "DiFluid R2", type: "sensor", state });
    const fetchState = mockReaFetch(
      { ...initialSettings, r2SensorId: "F4:12:FA:FA:AC:E3" },
      {
        sensors: [],
        devices: [r2Device("disconnected")],
        devicesAfterScan: ({ scanCount }) => [r2Device(scanCount > 2 ? "connected" : "discovered")],
        scanDevicesResult: ({ scanCount }) => [r2Device(scanCount > 2 ? "connected" : "discovered")]
      }
    );
    render(<App />);

    await waitFor(() => expect(fetchState.scanCount).toBeGreaterThanOrEqual(2));
    expect(await screen.findByRole("button", { name: "R2" })).toHaveAttribute("title", "R2: Not connected");

    await userEvent.click(screen.getByRole("button", { name: "R2" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "R2" })).toHaveAttribute("title", "R2: Connected"), { timeout: 3500 });
    expect(fetchState.connectCount).toBeGreaterThan(0);
    expect(fetchState.scanCount).toBeGreaterThan(3);
  });

  it("reveals the machine IP when the WiFi status is pressed", async () => {
    mockReaFetch(initialSettings, {
      machineState: { connected: true, wifi: { connected: true, ipAddress: "10.0.0.25" } }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "WiFi" }));

    expect(screen.getByText("Machine IP address")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.25")).toBeInTheDocument();
  });

  it("uses ReaPrime localIp for the WiFi status when machine state has no IP", async () => {
    mockReaFetch(initialSettings, {
      appInfo: { localIp: "10.0.0.200", version: "0.7.6" },
      machineState: { connected: true, state: { state: "idle" } }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "WiFi" }));

    expect(screen.getByText("Machine IP address")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.200")).toBeInTheDocument();
    expect(screen.queryByText("localhost")).not.toBeInTheDocument();
  });

  it("tries to force scale connection when the disconnected Scale status is pressed", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      devices: [{ id: "scale-1", name: "Acaia", type: "scale", state: "disconnected" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Scale connection requested."), { timeout: 2500 });
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=true",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
    );
  });

  it("connects the scale when pressing a Scale indicator backed only by stale sensor data", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      sensors: [detectedScaleSensor],
      devices: [],
      scanDevicesResult: ({ scanCount }) => (scanCount < 1 ? [] : [{ id: "scale-1", name: "Acaia Lunar", type: "scale", state: "discovered" }])
    });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Scale" })).toHaveAttribute("title", "Scale: Not connected");
    await userEvent.click(screen.getByRole("button", { name: "Scale" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
      );
    });
    expect(fetchState.scaleTareCount).toBe(0);
  });

  it("runs the startup discovery sequence when pressing Scale after it was powered on late", async () => {
    let poweredOn = false;
    const scaleDevice: DeviceInfo = { id: "scale-1", name: "Acaia Lunar", type: "scale", state: "discovered" };
    const fetchState = mockReaFetch(initialSettings, {
      devices: [],
      scanDevicesResult: ({ quickParam }) => (poweredOn && quickParam === false ? [scaleDevice] : [])
    });
    render(<App />);

    await waitFor(() => expect(fetchState.scanRequests.length).toBeGreaterThanOrEqual(2));
    poweredOn = true;
    const scansBeforePress = fetchState.scanRequests.length;

    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "scale-1" }) })
      );
    });
    expect(fetchState.scanRequests.slice(scansBeforePress, scansBeforePress + 2).map((request) => request.path)).toEqual([
      "/api/v1/devices/scan?connect=true&quick=true",
      "/api/v1/devices/scan?connect=true&quick=false"
    ]);
    expect(fetchState.scaleTareCount).toBe(0);
  });

  it("tares the scale when the connected Scale status is pressed", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      devices: [{ id: "scale-1", name: "Acaia", type: "scale", state: "connected" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Scale tared."));
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/scale/tare", expect.objectContaining({ method: "PUT" }));
    expect(fetchState.scaleTareCount).toBe(1);
  });

  it("tares the scale from live scale status even when the native device list is stale", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "idle" }, scale: { connected: true } },
      devices: []
    });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Scale" })).toHaveAttribute("title", "Scale: Connected");
    await waitFor(() => expect(fetchState.scanCount).toBeGreaterThan(0));
    const scansBeforeTap = fetchState.scanCount;
    await userEvent.click(screen.getByRole("button", { name: "Scale" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Scale tared."));
    expect(fetchState.scaleTareCount).toBe(1);
    expect(fetchState.scanCount).toBe(scansBeforeTap);
  });

  it("connects a scale returned only by the scan response", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      devices: [],
      scanDevicesResult: [{ id: "acaia-lunar", name: "Acaia Lunar", type: "sensor", state: "discovered" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));

    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=true",
      expect.objectContaining({ method: "GET" })
    );
    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "acaia-lunar" }) })
      );
    });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Scale connection requested."), { timeout: 2500 });
  });

  it("keeps force scale connection usable when explicit connect returns 404 after scan", async () => {
    const fetchState = mockReaFetch(initialSettings, {
      devices: [],
      scanDevicesResult: [{ id: "D4:41:89:DB:21:2E", name: "Acaia Pearl", type: "scale", state: "discovered" }],
      connectDeviceStatus: 404
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Scale scan requested. Wake the scale if it stays disconnected."), {
      timeout: 2500
    });
    expect(screen.queryByText(/Could not connect scale/i)).not.toBeInTheDocument();
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=true",
      expect.objectContaining({ method: "GET" })
    );
  });

  it.each([
    ["BooKoo Themis", "bookoo-themis"],
    ["Decent Scale", "decent-scale"]
  ])("recognizes %s as a connectable scale", async (scaleName, scaleId) => {
    const fetchState = mockReaFetch(initialSettings, {
      devices: [],
      scanDevicesResult: [{ id: scaleId, name: scaleName, type: "sensor", state: "discovered" }]
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Scale" }));

    await waitFor(() => {
      expect(fetchState.fetchMock).toHaveBeenCalledWith(
        "http://localhost:8080/api/v1/devices/connect",
        expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: scaleId }) })
      );
    });
  });

  it("automatically reconnects a BooKoo scale after it later appears disconnected", async () => {
    vi.useFakeTimers();
    const fetchState = mockReaFetch(initialSettings, {
      devices: [{ id: "bookoo-themis", name: "BooKoo Themis", type: "sensor", state: "connected" }]
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Scale" })).toHaveAttribute("title", "Scale: Connected");
    expect(fetchState.connectCount).toBe(0);

    fetchState.setDevices([{ id: "bookoo-themis", name: "BooKoo Themis", type: "sensor", state: "disconnected" }]);
    await act(async () => {
      vi.advanceTimersByTime(30_300);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "bookoo-themis" }) })
    );
  });

  it("runs a full scale scan after the machine wakes when the quick startup scan misses the scale", async () => {
    vi.useFakeTimers();
    const fetchState = mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "sleeping", substate: "idle" } },
      devices: [],
      scanDevicesResult: ({ quick }) => (quick ? [] : [{ id: "acaia-lunar", name: "Acaia Lunar", type: "scale", state: "discovered" }])
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchState.scanCount).toBe(0);

    fetchState.setMachineState({ connected: true, state: { state: "idle" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_300);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/scan?connect=true&quick=false",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/devices/connect",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ deviceId: "acaia-lunar" }) })
    );
  });

  it("does not expose bundled skin update controls or call skin updater endpoints", async () => {
    const fetchState = mockReaFetch(initialSettings);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Settings" }));
    await userEvent.click(await screen.findByRole("tab", { name: "Skin settings" }));

    expect(screen.queryByText("Skin updates")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check for skin updates" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install/update from GitHub release" })).not.toBeInTheDocument();
    expect(fetchState.fetchMock).not.toHaveBeenCalledWith("http://localhost:8080/api/v1/webui/skins/update", expect.anything());
    expect(fetchState.fetchMock).not.toHaveBeenCalledWith("http://localhost:8080/api/v1/webui/skins/install/github-release", expect.anything());
    expect(fetchState.fetchMock).not.toHaveBeenCalledWith("http://localhost:8080/api/v1/webui/skins/install/url", expect.anything());
  });

  it("reveals the current water level when the Water status is pressed", async () => {
    mockReaFetch(initialSettings, {
      machineState: { connected: true, waterLevels: { currentLevel: 38, refillLevel: 15 } }
    });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Water" }));

    expect(screen.getByText("Current water level")).toBeInTheDocument();
    expect(screen.getByText("38mm · 63%")).toBeInTheDocument();
  });

  it("shows a refill screen when the tank is at the refill level", async () => {
    vi.useFakeTimers();
    mockReaFetch(initialSettings, {
      machineState: { connected: true, waterLevels: { currentLevel: 9, refillLevel: 15 } }
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute("title", "Water: Low 9mm · 15%");
    expect(screen.queryByRole("dialog", { name: "Water refill needed" })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(screen.queryByRole("dialog", { name: "Water refill needed" })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    const dialog = screen.getByRole("dialog", { name: "Water refill needed" });

    expect(within(dialog).getByText("Hi, I’m getting dry over here… Top me up would ya’?")).toBeInTheDocument();
    expect(within(dialog).getByRole("img", { name: "Water pitcher filling the tank" })).toBeInTheDocument();
    expect(within(dialog).getByText("Water is at 9mm. Refill threshold is 15mm.")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "OK" }));

    expect(screen.queryByRole("dialog", { name: "Water refill needed" })).not.toBeInTheDocument();
  });

  it("shows a refill screen when the machine reports refill required", async () => {
    vi.useFakeTimers();
    mockReaFetch(initialSettings, {
      machineState: { connected: true, state: { state: "RefillRequired" } }
    });
    render(<App />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "State" })).toHaveAttribute("title", "State: Refill");
    expect(screen.queryByRole("dialog", { name: "Water refill needed" })).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    const dialog = screen.getByRole("dialog", { name: "Water refill needed" });

    expect(within(dialog).getByText("The machine is asking for a refill.")).toBeInTheDocument();
  });

  it("registers touch activity passively so Android WebView can scroll immediately", async () => {
    const addListener = vi.spyOn(window, "addEventListener");
    mockReaFetch(initialSettings);
    render(<App />);

    await screen.findByRole("heading", { name: "Brew" });

    expect(addListener).toHaveBeenCalledWith("touchstart", expect.any(Function), expect.objectContaining({ passive: true }));
    expect(addListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), expect.objectContaining({ passive: true }));
  });

  it("keeps preset editing open when saving the slot fails", async () => {
    mockReaFetch(initialSettings, { failSettingsPut: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit Light" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Light preset" });
    await userEvent.click(screen.getByRole("button", { name: "Use Classic" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Could not save preset");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Light Blooming" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Light Classic" })).not.toBeInTheDocument();
  });

  it("compensates created beans when batch creation fails and keeps the bag form intact", async () => {
    const fetchState = mockReaFetch(initialSettings, { failBatchCreate: true });
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Bags/i }));
    await userEvent.click(screen.getByRole("button", { name: "Add Bag" }));
    const form = screen.getByRole("form", { name: /Create a bag/i });

    await userEvent.type(within(form).getByLabelText("Roaster"), "Pilot");
    await userEvent.type(within(form).getByLabelText("Bean"), "Halo");
    await userEvent.type(within(form).getByLabelText("Country"), "Ethiopia");
    await userEvent.type(within(form).getByLabelText("Process"), "Washed");
    await userEvent.type(within(form).getByLabelText("Roast Date"), "2026-06-01");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save bag: batch creation failed");
    expect(within(form).getByLabelText("Roaster")).toHaveValue("Pilot");
    expect(within(form).getByLabelText("Bean")).toHaveValue("Halo");
    expect(fetchState.fetchMock).toHaveBeenCalledWith("http://localhost:8080/api/v1/beans/bean-1", expect.objectContaining({ method: "DELETE" }));
    expect(fetchState.fetchMock).toHaveBeenCalledWith(
      "http://localhost:8080/api/v1/beans/bean-1/batches",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roastDate: "2026-06-01T00:00:00Z",
          roastLevel: undefined,
          notes: undefined,
          extras: { workflowSkin: { createdFromBagForm: true } }
        })
      })
    );
  });
});
