import { useCallback, useEffect, useRef, useState } from "react";
import { ReaPrimeApi, ReaPrimeApiError } from "../api/reaprime";
import type { AppInfo } from "../api/types";
import type { AppUpdateState, FirmwareCatalog } from "../api/updateTypes";

type FirmwarePhase = "idle" | "starting" | "erasing" | "uploading" | "verifying" | "done" | "error" | "cancelled";
const activePhases: FirmwarePhase[] = ["starting", "erasing", "uploading", "verifying"];
export const MAX_FIRMWARE_BYTES = 16 * 1024 * 1024;
export function supportsDe1Firmware(model?: string): boolean {
  return ["de1", "de1plus", "de1cafe", "de1pro", "de1xl", "de1xxl", "de1xxxl"].includes((model ?? "").replace(/[^a-z0-9]/gi, "").toLowerCase());
}

export function updateError(error: unknown): string {
  if (error instanceof ReaPrimeApiError) {
    if ([404, 405, 501].includes(error.status)) return "This Decaid version does not support this update feature.";
    if (error.status === 409) return "Another update is already running. Wait for it to finish.";
    if (error.status === 422) return "Decaid rejected this firmware. Check that it is compatible with your machine.";
    if (error.status === 503) return "The machine is unavailable or busy. Check its connection and try again.";
    if (error.status === 413) return "The firmware file exceeds the 16 MB limit.";
    if ([401, 403].includes(error.status)) return "Decaid did not authorize this operation. Use its native update settings.";
    return "Decaid could not complete the update request. Check its connection and try again.";
  }
  if (error instanceof TypeError || (error instanceof Error && error.name === "AbortError")) {
    return "Connection to Decaid was lost. Check the machine before retrying.";
  }
  return error instanceof Error ? error.message : "The update request failed.";
}

function isAppState(value: unknown): value is AppUpdateState {
  const state = value as AppUpdateState | null;
  return !!state && ["idle", "checking", "available", "downloading", "installing", "error"].includes(state.phase) &&
    typeof state.currentVersion === "string" && typeof state.installable === "boolean";
}

export function useSoftwareUpdates(api: ReaPrimeApi) {
  const [enabled, setEnabled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [catalog, setCatalog] = useState<FirmwareCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogUnsupported, setCatalogUnsupported] = useState(false);
  const [machineInfo, setMachineInfo] = useState<{ model?: string; version?: string } | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [firmwarePhase, setFirmwarePhase] = useState<FirmwarePhase>("idle");
  const [firmwareProgress, setFirmwareProgress] = useState(0);
  const [firmwareError, setFirmwareError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [appState, setAppState] = useState<AppUpdateState | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [appConnected, setAppConnected] = useState(false);
  const [appChecked, setAppChecked] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<"check" | "install" | null>(null);
  const [socketGeneration, setSocketGeneration] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const firmwareLock = useRef(false);
  const appInstallLock = useRef(false);
  const cancelRequested = useRef(false);
  const refreshLock = useRef(false);
  const mounted = useRef(true);
  const seenChecking = useRef(false);
  const appRevision = useRef(0);
  const commandRef = useRef(pendingCommand);
  commandRef.current = pendingCommand;
  const firmwareBusy = activePhases.includes(firmwarePhase) || !!(catalog && catalog.operation.state !== "idle");
  const appBusy = pendingCommand === "install" || appState?.phase === "downloading" || appState?.phase === "installing";
  const busyRef = useRef({ firmware: firmwareBusy, app: appBusy });
  busyRef.current = { firmware: firmwareBusy, app: appBusy };

  const refresh = useCallback(async () => {
    if (refreshLock.current) return;
    refreshLock.current = true;
    const revision = appRevision.current;
    setRefreshing(true);
    const results = await Promise.allSettled([
      api.getFirmwareCatalog(), api.getFirmwareMachineInfo(), api.getAppUpdateState(), api.getAppInfo(8000)
    ]);
    if (mounted.current) {
      const [firmware, machine, app, info] = results;
      if (firmware.status === "fulfilled" && Array.isArray(firmware.value?.artifacts) && firmware.value.operation?.state) {
        setCatalog(firmware.value);
        setCatalogError(null);
        setCatalogUnsupported(false);
      } else {
        setCatalog((current) => current && current.operation.state !== "idle" ? current : null);
        const error = firmware.status === "rejected" ? firmware.reason : new Error("Decaid did not return a firmware catalog.");
        setCatalogError(updateError(error));
        setCatalogUnsupported(error instanceof ReaPrimeApiError && [404, 405, 501].includes(error.status));
      }
      setMachineInfo(machine.status === "fulfilled" ? machine.value : null);
      setAppInfo(info.status === "fulfilled" ? info.value : null);
      // Do not replace a newer live state with an older read snapshot.
      if (appRevision.current === revision) {
        if (app.status === "fulfilled" && isAppState(app.value)) {
          setAppState(app.value);
          setAppError(null);
          if (!commandRef.current && !["downloading", "installing"].includes(app.value.phase)) appInstallLock.current = false;
        } else {
          setAppState(null);
          setAppError(app.status === "rejected" ? updateError(app.reason) : "Decaid did not return its app update status.");
        }
      }
      if (!socketRef.current || socketRef.current.readyState === WebSocket.CLOSED) setSocketGeneration((value) => value + 1);
      setRefreshing(false);
    }
    refreshLock.current = false;
  }, [api]);

  const activate = useCallback(() => setEnabled(true), []);
  useEffect(() => { if (enabled) void refresh(); }, [enabled, refresh]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controllerRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const socket = new WebSocket(api.appUpdateSocketUrl());
    socketRef.current = socket;
    const connectTimeout = window.setTimeout(() => {
      if (!disposed && socket.readyState !== WebSocket.OPEN) {
        setAppError("Could not connect to Decaid's app updater. Refresh its status to try again.");
        socket.close();
      }
    }, 10000);
    socket.onopen = () => { window.clearTimeout(connectTimeout); if (!disposed) setAppConnected(true); };
    socket.onmessage = (message) => {
      if (disposed) return;
      try {
        const value: unknown = JSON.parse(String(message.data));
        if (isAppState(value)) {
          appRevision.current += 1;
          setAppState(value);
          setAppError(null);
          if (value.phase === "checking") seenChecking.current = true;
          if (seenChecking.current && ["idle", "available"].includes(value.phase)) {
            setAppChecked(true);
            setPendingCommand(null);
          }
          if (["downloading", "installing", "error", "available"].includes(value.phase)) setPendingCommand(null);
          if (!["downloading", "installing"].includes(value.phase)) appInstallLock.current = false;
        } else if (value && typeof (value as { error?: unknown }).error === "string") {
          appRevision.current += 1;
          setAppError((value as { error: string }).error);
          setPendingCommand(null);
          appInstallLock.current = false;
        }
      } catch { setAppError("Decaid returned an unreadable update status."); }
    };
    const disconnected = () => {
      if (disposed) return;
      setAppConnected(false);
      setPendingCommand(null);
      setAppError("The app update connection is unavailable. Refresh to reconnect; reopen Decaid if it has restarted.");
    };
    socket.onerror = disconnected;
    socket.onclose = disconnected;
    return () => {
      disposed = true;
      window.clearTimeout(connectTimeout);
      setAppConnected(false);
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [api, enabled, socketGeneration]);

  useEffect(() => {
    if (!pendingCommand) return;
    const timeout = window.setTimeout(() => {
      setPendingCommand(null);
      setAppError("Decaid has not confirmed this request yet. Refresh its status before trying again.");
    }, 45000);
    return () => window.clearTimeout(timeout);
  }, [pendingCommand]);

  useEffect(() => {
    if (!enabled || !firmwareBusy) return;
    let disposed = false;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void api.getFirmwareCatalog().then((value) => {
        if (!disposed && Array.isArray(value?.artifacts) && value.operation?.state) {
          setCatalog(value);
          if (value.operation.state === "verifying") setFirmwarePhase((phase) => phase === "uploading" ? "verifying" : phase);
        }
      }).catch(() => undefined).finally(() => { pending = false; });
    }, 2000);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("beforeunload", warn); };
  }, [api, enabled, firmwareBusy]);

  const startFirmware = useCallback(async (source: { artifactId: string } | { file: File }) => {
    if (firmwareLock.current || busyRef.current.firmware || busyRef.current.app || appInstallLock.current) return;
    firmwareLock.current = true;
    cancelRequested.current = false;
    setFirmwarePhase("starting");
    setFirmwareProgress(0);
    setFirmwareError(null);
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      if ("file" in source && (source.file.size === 0 || source.file.size > MAX_FIRMWARE_BYTES)) {
        throw new Error("Choose a non-empty firmware file no larger than 16 MB.");
      }
      const machine = await api.getMachineState(5000);
      const mode = machine?.state?.state?.toLowerCase();
      if (!machine || machine.connected === false || !["idle", "sleep", "sleeping"].includes(mode ?? "")) {
        throw new Error("Connect the machine and wait until it is idle or asleep before updating firmware.");
      }
      if ("artifactId" in source) {
        const latest = await api.getFirmwareCatalog();
        setCatalog(latest);
        const artifact = latest.artifacts.find((item) => item.id === source.artifactId);
        if (latest.operation.state !== "idle" || artifact?.eligibility.status !== "applicable") {
          throw new Error("This firmware update is no longer available for the connected machine. Check for updates again.");
        }
      } else {
        const info = await api.getFirmwareMachineInfo();
        if (!supportsDe1Firmware(info?.model)) throw new Error("Manual firmware upload is supported only for classic DE1 machines.");
      }
      if (cancelRequested.current || controller.signal.aborted || !mounted.current) throw new Error("Firmware update cancelled before starting.");
      await api.streamFirmwareUpdate(source, (event) => {
        if (!mounted.current) return;
        setFirmwareProgress(event.progress);
        setFirmwarePhase(event.status === "done" ? "done" : event.status === "uploading" && event.progress >= 1 ? "verifying" : event.status as FirmwarePhase);
      }, controller.signal);
    } catch (error) {
      if (mounted.current) {
        const cancelled = cancelRequested.current && /cancel/i.test(error instanceof Error ? error.message : "");
        setFirmwarePhase(cancelled ? "cancelled" : "error");
        setFirmwareError(cancelled ? null : updateError(error));
      }
    } finally {
      firmwareLock.current = false;
      controllerRef.current = null;
      if (mounted.current) { setCancelling(false); void refresh(); }
    }
  }, [api, refresh]);

  const cancelFirmware = useCallback(async () => {
    if (cancelling) return;
    cancelRequested.current = true;
    setCancelling(true);
    try {
      const result = await api.cancelFirmwareUpdate();
      setCatalog((current) => current ? { ...current, operation: result.operation } : null);
    } catch (error) {
      cancelRequested.current = false;
      setFirmwareError(`Could not cancel. ${updateError(error)}`);
    } finally { setCancelling(false); }
  }, [api, cancelling]);

  const commandApp = useCallback(async (command: "check" | "install") => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || commandRef.current || busyRef.current.app || appInstallLock.current) return;
    if (command === "install" && (firmwareLock.current || busyRef.current.firmware)) return;
    commandRef.current = command;
    setPendingCommand(command);
    setAppError(null);
    if (command === "check") setAppChecked(false);
    seenChecking.current = false;
    try {
      if (command === "install") {
        appInstallLock.current = true;
        const latest = await api.getAppUpdateState();
        if (latest.phase !== "available" || !latest.installable) throw new Error("Decaid cannot install an app update right now. Check for updates again.");
        if (!catalogUnsupported) {
          const firmware = await api.getFirmwareCatalog();
          if (firmware.operation.state !== "idle") throw new Error("Wait for the machine firmware update to finish before updating Decaid.");
        }
      }
      socket.send(JSON.stringify({ command }));
    } catch (error) {
      setAppError(updateError(error));
      setPendingCommand(null);
      commandRef.current = null;
      appInstallLock.current = false;
    }
  }, [api, catalogUnsupported]);

  return {
    activate, refresh, refreshing, catalog, catalogError, catalogUnsupported, machineInfo, appInfo,
    firmwarePhase, firmwareProgress, firmwareError, firmwareBusy, cancelling, startFirmware, cancelFirmware,
    appState, appError, appConnected, appChecked, appBusy, pendingCommand, commandApp
  };
}

export type SoftwareUpdates = ReturnType<typeof useSoftwareUpdates>;
