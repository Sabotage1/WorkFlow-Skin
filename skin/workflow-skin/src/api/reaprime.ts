import type {
  BurrType,
  AppInfo,
  Bean,
  BeanBatch,
  De1AdvancedMachineSettings,
  De1MachineCalibration,
  De1MachineSettings,
  DecentAccountStatus,
  DeviceInfo,
  DisplayState,
  Grinder,
  JsonMap,
  MachineState,
  PluginManifest,
  Profile,
  ProfileRecord,
  SensorListItem,
  ShotPage,
  ShotRecord,
  SteamRecord,
  UpdateDe1MachineSettings,
  Workflow
} from "./types";

export interface CreateBeanPayload {
  roaster: string;
  name: string;
  country?: string;
  region?: string;
  processing?: string;
  notes?: string;
  extras?: JsonMap;
}

export interface CreateBatchPayload {
  roastDate?: string;
  roastLevel?: string;
  notes?: string;
  extras?: JsonMap;
}

export interface UpdateBeanPayload extends Partial<CreateBeanPayload> {
  archived?: boolean;
}

export interface UpdateBatchPayload extends Partial<CreateBatchPayload> {
  archived?: boolean;
  openDate?: string;
  weight?: number;
  weightRemaining?: number;
}

export interface CreateGrinderPayload {
  model: string;
  burrType: BurrType;
  burrs?: string;
  settingType?: "numeric" | "preset";
  notes?: string;
  extras?: JsonMap;
}

export interface UpdateGrinderPayload extends Partial<CreateGrinderPayload> {
  archived?: boolean;
  burrs?: string;
  burrSize?: number;
  burrType?: BurrType;
  settingValues?: string[] | null;
  settingSmallStep?: number | null;
  settingBigStep?: number | null;
}

export interface UpdateProfilePayload {
  profile?: Profile;
  metadata?: JsonMap;
}

export interface CreateProfilePayload {
  profile: Profile;
  parentId?: string;
  metadata?: JsonMap;
}

export interface ScanDevicesOptions {
  connect?: boolean;
  quick?: boolean;
}

export function apiBaseUrl(locationUrl?: URL): string {
  if (!locationUrl && typeof window === "undefined") return "http://localhost:8080";
  const url = locationUrl ?? new URL(window.location.href);
  return `${url.protocol}//${url.hostname}:8080`;
}

export function apiWebSocketBaseUrl(locationUrl?: URL): string {
  const url = new URL(apiBaseUrl(locationUrl));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${url.protocol}//${url.hostname}:${url.port}`;
}

export class ReaPrimeApiError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = "ReaPrimeApiError";
  }
}

const SETTINGS_KEY = "settings";

function localSettingsKey(namespace: string, key: string): string {
  return `reaprime-skin:${namespace}:${key}`;
}

function storageFallbackAllowed(error: unknown): boolean {
  if (error instanceof ReaPrimeApiError) return error.status === 400 || error.status === 404 || error.status === 405;
  return error instanceof TypeError;
}

function readLocalSetting<T>(namespace: string, key: string): T | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const raw = storage.getItem(localSettingsKey(namespace, key));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeLocalSetting(namespace: string, key: string, value: unknown): boolean {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return false;
    storage.setItem(localSettingsKey(namespace, key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export class ReaPrimeApi {
  constructor(private readonly baseUrl = apiBaseUrl()) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const method = init.method ?? "GET";
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      throw new ReaPrimeApiError(`${method} ${path} failed: ${response.status} ${text}`, response.status);
    }
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  listProfiles() {
    return this.request<ProfileRecord[]>("/api/v1/profiles");
  }

  listDefaultProfiles() {
    return this.request<ProfileRecord[]>("/api/v1/profiles/defaults");
  }

  updateProfile(id: string, payload: UpdateProfilePayload) {
    return this.request<ProfileRecord>(`/api/v1/profiles/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  createProfile(payload: CreateProfilePayload) {
    return this.request<ProfileRecord>("/api/v1/profiles", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  getWorkflow() {
    return this.request<Workflow>("/api/v1/workflow");
  }

  updateWorkflow(patch: Partial<Workflow>) {
    return this.request<Workflow>("/api/v1/workflow", {
      method: "PUT",
      body: JSON.stringify(patch)
    });
  }

  listBeans() {
    return this.request<Bean[]>("/api/v1/beans?includeArchived=false");
  }

  createBean(payload: CreateBeanPayload) {
    return this.request<Bean>("/api/v1/beans", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  deleteBean(id: string) {
    return this.request<void>(`/api/v1/beans/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  updateBean(id: string, payload: UpdateBeanPayload) {
    return this.request<Bean>(`/api/v1/beans/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  listBatches(beanId: string) {
    return this.request<BeanBatch[]>(`/api/v1/beans/${encodeURIComponent(beanId)}/batches?includeArchived=false`);
  }

  createBatch(beanId: string, payload: CreateBatchPayload) {
    return this.request<BeanBatch>(`/api/v1/beans/${encodeURIComponent(beanId)}/batches`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updateBatch(id: string, payload: UpdateBatchPayload) {
    return this.request<BeanBatch>(`/api/v1/bean-batches/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  listGrinders() {
    return this.request<Grinder[]>("/api/v1/grinders?includeArchived=false");
  }

  createGrinder(payload: CreateGrinderPayload) {
    return this.request<Grinder>("/api/v1/grinders", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  updateGrinder(id: string, payload: UpdateGrinderPayload) {
    return this.request<Grinder>(`/api/v1/grinders/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
  }

  deleteGrinder(id: string) {
    return this.request<void>(`/api/v1/grinders/${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
  }

  listShots(params: Record<string, string | number | undefined> = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const query = search.toString();
    return this.request<ShotPage | ShotRecord[]>(`/api/v1/shots${query ? `?${query}` : ""}`);
  }

  getShot(id: string) {
    return this.request<ShotRecord>(`/api/v1/shots/${encodeURIComponent(id)}`);
  }

  getLatestShot() {
    return this.request<ShotRecord | null>("/api/v1/shots/latest");
  }

  updateShot(id: string, patch: Partial<ShotRecord>) {
    return this.request<ShotRecord>(`/api/v1/shots/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    });
  }

  listSteams() {
    return this.request<SteamRecord[]>("/api/v1/steams");
  }

  getSteam(id: string) {
    return this.request<SteamRecord>(`/api/v1/steams/${encodeURIComponent(id)}`);
  }

  async getKv<T>(namespace: string, key: string): Promise<T | null> {
    try {
      const value = await this.request<T>(`/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`);
      if (value !== null && value !== undefined) writeLocalSetting(namespace, key, value);
      return value;
    } catch (error) {
      if (!storageFallbackAllowed(error)) throw error;
    }

    try {
      const value = await this.request<T>(`/api/v1/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`);
      if (value !== null && value !== undefined) writeLocalSetting(namespace, key, value);
      return value;
    } catch (error) {
      if (!storageFallbackAllowed(error)) throw error;
    }

    if (key === SETTINGS_KEY) {
      try {
        const value = await this.request<T>(`/api/v1/plugins/${encodeURIComponent(namespace)}/settings`);
        if (value && typeof value === "object" && Object.keys(value as object).length > 0) {
          writeLocalSetting(namespace, key, value);
          return value;
        }
      } catch (error) {
        if (!storageFallbackAllowed(error)) throw error;
      }
    }

    return readLocalSetting<T>(namespace, key);
  }

  async putKv(namespace: string, key: string, value: unknown) {
    try {
      await this.request<void>(`/api/v1/store/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
        method: "POST",
        body: JSON.stringify(value)
      });
      writeLocalSetting(namespace, key, value);
      return;
    } catch (error) {
      if (!storageFallbackAllowed(error)) throw error;
    }

    try {
      await this.request<void>(`/api/v1/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify(value)
      });
      writeLocalSetting(namespace, key, value);
      return;
    } catch (error) {
      if (!storageFallbackAllowed(error)) throw error;
    }

    if (key === SETTINGS_KEY) {
      try {
        await this.request<void>(`/api/v1/plugins/${encodeURIComponent(namespace)}/settings`, {
          method: "POST",
          body: JSON.stringify(value)
        });
        writeLocalSetting(namespace, key, value);
        return;
      } catch (error) {
        if (!storageFallbackAllowed(error)) throw error;
      }
    }

    if (!writeLocalSetting(namespace, key, value)) {
      throw new Error(`Could not save ${namespace}/${key}: remote storage unavailable and local storage failed`);
    }
  }

  listSensors() {
    return this.request<SensorListItem[]>("/api/v1/sensors");
  }

  executeSensor(id: string, commandId: string, params?: Record<string, unknown>) {
    const sensorId = id.trim().replace(/^\/+|\/+$/g, "");
    return this.request<{ status: "ok" | "error"; result?: unknown; message?: string }>(
      `/api/v1/sensors/${sensorId}/execute`,
      {
        method: "POST",
        body: JSON.stringify({ commandId, params })
      }
    );
  }

  getMachineState() {
    return this.request<MachineState>("/api/v1/machine/state");
  }

  getAppInfo() {
    return this.request<AppInfo>("/api/v1/info");
  }

  getDecentAccount() {
    return this.request<DecentAccountStatus>("/api/v1/account/decent");
  }

  listDevices() {
    return this.request<DeviceInfo[]>("/api/v1/devices");
  }

  scanDevices(options: ScanDevicesOptions = {}) {
    const search = new URLSearchParams();
    if (options.connect !== undefined) search.set("connect", String(options.connect));
    if (options.quick !== undefined) search.set("quick", String(options.quick));
    const query = search.toString();
    return this.request<DeviceInfo[]>(`/api/v1/devices/scan${query ? `?${query}` : ""}`);
  }

  connectDevice(deviceId: string) {
    return this.request<void>("/api/v1/devices/connect", {
      method: "PUT",
      body: JSON.stringify({ deviceId })
    }).catch((primaryError) =>
      this.request<void>("/api/v1/devices/connect", {
        method: "PUT",
        body: JSON.stringify({ id: deviceId })
      }).catch(() =>
        this.request<void>("/api/v1/devices/connect", {
          method: "POST",
          body: JSON.stringify({ deviceId })
        }).catch(() => {
          throw primaryError;
        })
      )
    );
  }

  getDisplay() {
    return this.request<DisplayState>("/api/v1/display");
  }

  setDisplayBrightness(brightness: number) {
    return this.request<DisplayState>("/api/v1/display/brightness", {
      method: "PUT",
      body: JSON.stringify({ brightness })
    });
  }

  requestWakeLock() {
    return this.request<DisplayState>("/api/v1/display/wakelock", {
      method: "POST"
    });
  }

  releaseWakeLock() {
    return this.request<DisplayState>("/api/v1/display/wakelock", {
      method: "DELETE"
    });
  }

  getMachineSettings() {
    return this.request<De1MachineSettings>("/api/v1/machine/settings");
  }

  updateMachineSettings(payload: UpdateDe1MachineSettings) {
    const body = {
      ...payload,
      ...(typeof payload.usb === "boolean" ? { usb: payload.usb ? "enable" : "disable" } : {})
    };
    return this.request<void>("/api/v1/machine/settings", {
      method: "POST",
      body: JSON.stringify(body)
    });
  }

  getAdvancedMachineSettings() {
    return this.request<De1AdvancedMachineSettings>("/api/v1/machine/settings/advanced");
  }

  updateAdvancedMachineSettings(payload: De1AdvancedMachineSettings) {
    return this.request<void>("/api/v1/machine/settings/advanced", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  resetMachineSettings() {
    return this.request<void>("/api/v1/machine/settings/reset", {
      method: "DELETE"
    });
  }

  getMachineCalibration() {
    return this.request<De1MachineCalibration>("/api/v1/machine/calibration");
  }

  updateMachineCalibration(payload: De1MachineCalibration) {
    return this.request<void>("/api/v1/machine/calibration", {
      method: "POST",
      body: JSON.stringify(payload)
    });
  }

  listPlugins() {
    return this.request<PluginManifest[]>("/api/v1/plugins");
  }

  getPluginSettings<T = JsonMap>(pluginId: string) {
    return this.request<T>(`/api/v1/plugins/${encodeURIComponent(pluginId)}/settings`);
  }

  callPluginEndpoint<T = JsonMap>(pluginId: string, endpoint: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    return this.request<T>(`/api/v1/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(endpoint)}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }

  requestMachineState(state: string) {
    return this.request<void>(`/api/v1/machine/state/${encodeURIComponent(state)}`, {
      method: "PUT"
    });
  }

  sleepMachine() {
    return this.requestMachineState("sleeping");
  }

  wakeMachine() {
    return this.requestMachineState("idle");
  }
}
