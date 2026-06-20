export type JsonMap = Record<string, unknown>;
export type BurrType = "flat" | "conical";

export interface Profile {
  title?: string;
  author?: string;
  notes?: string;
  beverage_type?: string;
  target_weight?: number | null;
  steps?: Array<JsonMap>;
}

export interface ProfileRecord {
  id: string;
  profile: Profile;
  metadata?: JsonMap;
  visibility?: "visible" | "hidden";
}

export interface WorkflowContext {
  targetDoseWeight?: number;
  targetYield?: number;
  grinderId?: string;
  grinderModel?: string;
  grinderSetting?: string;
  beanBatchId?: string;
  coffeeName?: string;
  coffeeRoaster?: string;
  finalBeverageType?: string;
  baristaName?: string;
  drinkerName?: string;
  extras?: JsonMap;
}

export interface Workflow {
  id?: string;
  name?: string;
  description?: string;
  profile?: Profile;
  context?: WorkflowContext;
}

export interface Bean {
  id: string;
  roaster: string;
  name: string;
  species?: string | null;
  decaf?: boolean;
  decafProcess?: string | null;
  country?: string;
  region?: string;
  producer?: string;
  variety?: string[] | null;
  altitude?: number[] | null;
  processing?: string;
  notes?: string;
  archived?: boolean;
  extras?: JsonMap;
}

export interface BeanBatch {
  id: string;
  beanId: string;
  roastDate?: string;
  roastLevel?: string;
  harvestDate?: string;
  qualityScore?: number;
  price?: number;
  currency?: string;
  buyDate?: string;
  openDate?: string;
  bestBeforeDate?: string;
  freezeDate?: string;
  unfreezeDate?: string;
  frozen?: boolean;
  weight?: number;
  weightRemaining?: number;
  notes?: string;
  archived?: boolean;
  extras?: JsonMap;
}

export interface Grinder {
  id: string;
  manufacturer?: string;
  model: string;
  burrs?: string;
  burrSize?: number;
  burrType?: BurrType | string;
  settingType?: "numeric" | "preset";
  settingValues?: string[] | null;
  settingSmallStep?: number | null;
  settingBigStep?: number | null;
  rpmSmallStep?: number | null;
  rpmBigStep?: number | null;
  notes?: string;
  archived?: boolean;
  extras?: JsonMap;
}

export interface ShotAnnotations {
  actualDoseWeight?: number;
  actualYield?: number;
  drinkTds?: number;
  drinkEy?: number;
  enjoyment?: number;
  espressoNotes?: string;
  extras?: JsonMap;
}

export interface ShotSnapshot {
  machine?: {
    timestamp?: string;
    pressure?: number;
    targetPressure?: number;
    flow?: number;
    targetFlow?: number;
    mixTemperature?: number;
    groupTemperature?: number;
    targetMixTemperature?: number;
    targetGroupTemperature?: number;
    state?: { state?: string; substate?: string };
  };
  scale?: {
    timestamp?: string;
    weight?: number;
    weightFlow?: number;
    battery?: number | null;
    timerValue?: number | null;
  };
}

export interface WeightSnapshot {
  timestamp?: string;
  weight?: number;
  weightFlow?: number;
  battery?: number | null;
  timerValue?: number | null;
}

export interface WaterLevels {
  currentLevel?: number;
  refillLevel?: number;
}

export interface ShotRecord {
  id: string;
  timestamp: string;
  workflow: Workflow;
  measurements?: ShotSnapshot[];
  annotations?: ShotAnnotations;
  shotNotes?: string;
  metadata?: JsonMap;
}

export interface ShotPage {
  items: ShotRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface SteamSnapshot {
  timestamp?: string;
  steam?: {
    temperature?: number | null;
    flow?: number | null;
    pressure?: number | null;
  };
  machine?: {
    timestamp?: string;
    steamTemperature?: number | null;
    state?: { state?: string; substate?: string };
  };
}

export interface SteamRecord {
  id: string;
  timestamp: string;
  workflow?: Workflow;
  measurements?: SteamSnapshot[];
  annotations?: JsonMap | null;
}

export interface SensorListItem {
  id: string;
  info: {
    name: string;
    vendor: string;
    data: Array<{ key: string; type: string; unit?: string }>;
    commands?: Array<{ id: string; name?: string; description?: string }>;
  };
}

export interface DeviceInfo {
  id: string;
  name?: string;
  state?: "connected" | "disconnected" | "discovered" | string;
  type?: "machine" | "scale" | "sensor" | string;
}

export interface AppInfo {
  version?: string;
  fullVersion?: string;
  buildNumber?: string;
  commit?: string;
  commitShort?: string;
  branch?: string;
  buildTime?: string;
  appStore?: boolean;
  localIp?: string;
}

export interface DecentAccountStatus {
  connected?: boolean;
  username?: string;
  displayName?: string;
  name?: string;
  email?: string;
  account?: JsonMap;
}

export interface DisplayState {
  brightness?: number;
  requestedBrightness?: number;
  wakeLockEnabled?: boolean;
  wakeLockOverride?: boolean;
  platformSupported?: {
    brightness?: boolean;
    wakeLock?: boolean;
  };
  lowBatteryBrightnessLimitActive?: boolean;
}

export interface De1MachineSettings {
  usb?: boolean;
  fan?: number;
  flushTemp?: number;
  flushFlow?: number;
  flushTimeout?: number;
  hotWaterFlow?: number;
  steamFlow?: number;
  tankTemp?: number;
  steamPurgeMode?: number;
}

export interface UpdateDe1MachineSettings extends Partial<Omit<De1MachineSettings, "usb">> {
  usb?: boolean;
}

export interface De1AdvancedMachineSettings {
  heaterPh1Flow?: number;
  heaterPh2Flow?: number;
  heaterIdleTemp?: number;
  heaterPh2Timeout?: number;
  heaterVoltage?: number;
  refillKitSetting?: number;
}

export interface De1MachineCalibration {
  flowMultiplier?: number;
}

export interface PluginManifest {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  loaded?: boolean;
  autoLoad?: boolean;
  settings?: JsonMap;
  api?: Array<{ id: string; type: string; data?: JsonMap }>;
}

export interface VisualizerStatus {
  status?: JsonMap | null;
  lastUpload?: JsonMap | null;
  backSyncStatus?: JsonMap | null;
  forwardSyncStatus?: JsonMap | null;
}

export interface MachineState {
  connected?: boolean;
  timestamp?: string;
  ip?: string;
  ipAddress?: string;
  machineIp?: string;
  pressure?: number;
  targetPressure?: number;
  flow?: number;
  targetFlow?: number;
  mixTemperature?: number;
  groupTemperature?: number;
  targetMixTemperature?: number;
  targetGroupTemperature?: number;
  profileFrame?: number;
  steamTemperature?: number;
  state?: { state?: string; substate?: string };
  wifi?: {
    connected?: boolean;
    ip?: string;
    ipAddress?: string;
    ssid?: string;
  };
  network?: {
    connected?: boolean;
    ip?: string;
    ipAddress?: string;
  };
  scale?: {
    connected?: boolean;
    name?: string;
    status?: string;
    weight?: number;
    weightFlow?: number;
    battery?: number | null;
    timerValue?: number | null;
  };
  scaleConnected?: boolean;
  scaleStatus?: string;
  connectionStatus?: {
    phase?: string;
  };
  waterLevels?: WaterLevels;
}
