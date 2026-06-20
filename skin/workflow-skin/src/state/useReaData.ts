import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReaPrimeApi } from "../api/reaprime";
import type {
  AppInfo,
  Bean,
  BeanBatch,
  De1AdvancedMachineSettings,
  De1MachineCalibration,
  De1MachineSettings,
  DeviceInfo,
  DisplayState,
  Grinder,
  JsonMap,
  MachineState,
  PluginManifest,
  ProfileRecord,
  SensorListItem,
  ShotRecord,
  SteamRecord,
  VisualizerStatus,
  Workflow
} from "../api/types";
import { buildBag, type Bag } from "../lib/bags";
import { defaultSkinSettings, loadSkinSettings, saveSkinSettings, type SkinSettings } from "./skinSettings";

const FULL_REFRESH_INTERVAL_MS = 30000;

export function useReaData(api: ReaPrimeApi) {
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [workflow, setWorkflow] = useState<Workflow>({});
  const [beans, setBeans] = useState<Bean[]>([]);
  const [batches, setBatches] = useState<BeanBatch[]>([]);
  const [grinders, setGrinders] = useState<Grinder[]>([]);
  const [sensors, setSensors] = useState<SensorListItem[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [visualizerSettings, setVisualizerSettings] = useState<JsonMap | null>(null);
  const [visualizerStatus, setVisualizerStatus] = useState<VisualizerStatus | null>(null);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  const [machineSettings, setMachineSettings] = useState<De1MachineSettings | null>(null);
  const [advancedMachineSettings, setAdvancedMachineSettings] = useState<De1AdvancedMachineSettings | null>(null);
  const [machineCalibration, setMachineCalibration] = useState<De1MachineCalibration | null>(null);
  const [machineState, setMachineState] = useState<MachineState | null>(null);
  const [shots, setShots] = useState<ShotRecord[]>([]);
  const [steams, setSteams] = useState<SteamRecord[]>([]);
  const [settings, setSettings] = useState<SkinSettings>(defaultSkinSettings);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [
        profileList,
        workflowData,
        beanList,
        grinderList,
        shotPage,
        steamList,
        savedSettings,
        sensorList,
        deviceList,
        info,
        state,
        display,
        de1Settings,
        de1AdvancedSettings,
        de1Calibration,
        pluginList
      ] = await Promise.all([
        api.listProfiles(),
        api.getWorkflow(),
        api.listBeans(),
        api.listGrinders(),
        api.listShots({ limit: 100, order: "desc" }),
        api.listSteams().catch(() => [] as SteamRecord[]),
        loadSkinSettings(api),
        api.listSensors().catch(() => [] as SensorListItem[]),
        api.listDevices().catch(() => [] as DeviceInfo[]),
        api.getAppInfo().catch(() => null as AppInfo | null),
        api.getMachineState().catch(() => null as MachineState | null),
        api.getDisplay().catch(() => null as DisplayState | null),
        api.getMachineSettings().catch(() => null as De1MachineSettings | null),
        api.getAdvancedMachineSettings().catch(() => null as De1AdvancedMachineSettings | null),
        api.getMachineCalibration().catch(() => null as De1MachineCalibration | null),
        api.listPlugins().catch(() => [] as PluginManifest[])
      ]);
      const batchLists = await Promise.all(beanList.map((bean) => api.listBatches(bean.id)));
      const visualizerPlugin = pluginList.find((plugin) => plugin.id === "visualizer.reaplugin");
      const [pluginSettings, status, lastUpload, backSyncStatus, forwardSyncStatus] = visualizerPlugin
        ? await Promise.all([
            api.getPluginSettings<JsonMap>("visualizer.reaplugin").catch(() => null),
            api.callPluginEndpoint<JsonMap>("visualizer.reaplugin", "status").catch(() => null),
            api.callPluginEndpoint<JsonMap>("visualizer.reaplugin", "lastUpload").catch(() => null),
            api.callPluginEndpoint<JsonMap>("visualizer.reaplugin", "backSyncStatus").catch(() => null),
            api.callPluginEndpoint<JsonMap>("visualizer.reaplugin", "forwardSyncStatus").catch(() => null)
          ])
        : [null, null, null, null, null];
      setProfiles(profileList);
      setWorkflow(workflowData);
      setBeans(beanList);
      setBatches(batchLists.flat());
      setGrinders(grinderList);
      setSensors(sensorList);
      setDevices(deviceList);
      setAppInfo(info);
      setPlugins(pluginList);
      setVisualizerSettings(pluginSettings);
      setVisualizerStatus(visualizerPlugin ? { status, lastUpload, backSyncStatus, forwardSyncStatus } : null);
      setDisplayState(display);
      setMachineSettings(de1Settings);
      setAdvancedMachineSettings(de1AdvancedSettings);
      setMachineCalibration(de1Calibration);
      setMachineState(state);
      setShots(Array.isArray(shotPage) ? shotPage : shotPage.items);
      setSteams(steamList);
      setSettings(savedSettings);
      setError(null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMachineState(null);
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refresh();
    }, FULL_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const bags = useMemo<Bag[]>(() => {
    const beanById = new Map(beans.map((bean) => [bean.id, bean]));
    return batches.flatMap((batch) => {
      const bean = beanById.get(batch.beanId);
      return bean ? [buildBag(bean, batch)] : [];
    });
  }, [beans, batches]);

  const persistSettings = useCallback(
    async (next: SkinSettings) => {
      await saveSkinSettings(api, next);
      setSettings(next);
    },
    [api]
  );

  const setWorkflowData = useCallback((next: Workflow) => {
    setWorkflow(next);
  }, []);

  return {
    api,
    profiles,
    workflow,
    beans,
    batches,
    bags,
    grinders,
    sensors,
    devices,
    appInfo,
    plugins,
    visualizerSettings,
    visualizerStatus,
    displayState,
    machineSettings,
    advancedMachineSettings,
    machineCalibration,
    machineState,
    shots,
    steams,
    settings,
    error,
    loaded,
    refresh,
    setWorkflow: setWorkflowData,
    persistSettings
  };
}
