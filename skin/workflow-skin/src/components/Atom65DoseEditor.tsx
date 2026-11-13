import { useEffect, useRef, useState } from "react";
import type { ReaPrimeApi } from "../api/reaprime";
import type { DeviceInfo, Profile } from "../api/types";
import { skinLog } from "../lib/skinLog";

export const ATOM65_PLUGIN_ID = "atom65.reaplugin";

export interface Atom65ProfileSettings {
  deviceId: string;
  loaded: boolean;
  storageError: string | null;
  syncEnabled: boolean;
  maximumDose: number;
  grinder: { minimum: number; maximum: number } | null;
  profile: { key: string; title: string };
  rule: { mode: "leave" | "workflow" | "fixed"; weight?: number };
}

export interface Atom65DoseIntegration {
  api: Pick<ReaPrimeApi, "callPluginEndpoint">;
  devices: DeviceInfo[];
  supported: boolean;
}

export function Atom65DoseEditor({ profile, integration }: { profile: Profile; integration: Atom65DoseIntegration }) {
  const devices = integration.devices.filter((device) => device.id.startsWith(`plugin:${ATOM65_PLUGIN_ID}:atom65:`));
  const [chosenDeviceId, setChosenDeviceId] = useState("");
  const deviceId = devices.some((device) => device.id === chosenDeviceId) ? chosenDeviceId : devices[0]?.id ?? "";
  const [snapshot, setSnapshot] = useState<Atom65ProfileSettings | null>(null);
  const [mode, setMode] = useState<Atom65ProfileSettings["rule"]["mode"]>("leave");
  const [weight, setWeight] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const profileJson = JSON.stringify(profile);
  const { api } = integration;

  useEffect(() => {
    const current = ++generation.current;
    setSnapshot(null);
    setError(null);
    setSaved(false);
    if (!deviceId || !integration.supported) return;
    setBusy(true);
    api.callPluginEndpoint<Atom65ProfileSettings>(ATOM65_PLUGIN_ID, "profile-settings", { profile: JSON.parse(profileJson) }, "POST", { deviceId })
      .then((value) => {
        if (current !== generation.current) return;
        setSnapshot(value);
        setMode(value.rule.mode);
        setWeight(value.rule.weight === undefined ? "" : String(value.rule.weight));
      })
      .catch((reason) => {
        if (current !== generation.current) return;
        skinLog("atom65_profile_settings_failed", { deviceId, error: String(reason) });
        setError("Could not load grinder choices. Check the Atom65 connection and driver, then try again.");
      })
      .finally(() => { if (current === generation.current) setBusy(false); });
    return () => { generation.current++; };
  }, [api, deviceId, integration.supported, profileJson, reload]);

  if (!integration.supported) return <p className="muted">Install or update Atom65 Profile Sync to version 0.1.1 or later in Decaid to save per-profile grinder choices.</p>;
  if (!devices.length) return <p className="muted">Connect your Atom65 using Atom65 Profile Sync in Decaid to set this profile’s grinder dose. Profiles start with “Leave grinder unchanged”.</p>;

  const minimum = snapshot?.grinder?.minimum ?? 5;
  const maximum = Math.min(snapshot?.maximumDose ?? 40, snapshot?.grinder?.maximum ?? 1000);
  const validWeight = weight.trim() !== "" && Number.isFinite(Number(weight)) && Number(weight) >= minimum && Number(weight) <= maximum && Math.abs(Number(weight) * 10 - Math.round(Number(weight) * 10)) < 1e-7;
  const ready = snapshot?.loaded && !snapshot.storageError && !busy;

  return (
    <form className="atom65-dose-editor" aria-label={`${profile.title} grinder dose`} onSubmit={async (event) => {
      event.preventDefault();
      if (!ready || (mode === "fixed" && !validWeight)) return;
      const current = generation.current;
      setBusy(true); setError(null); setSaved(false);
      try {
        const value = await api.callPluginEndpoint<Atom65ProfileSettings>(ATOM65_PLUGIN_ID, "profile-settings", {
          profile: JSON.parse(profileJson),
          choice: { profileKey: snapshot.profile.key, mode, ...(mode === "fixed" ? { weight: Number(weight) } : {}) }
        }, "POST", { deviceId });
        if (current === generation.current) { setSnapshot(value); setSaved(true); }
      } catch (reason) {
        if (current === generation.current) {
          skinLog("atom65_profile_save_failed", { deviceId, error: String(reason) });
          setError("Could not confirm this choice was saved. Reload the saved choice before trying again.");
          setSnapshot(null);
        }
      } finally { if (current === generation.current) setBusy(false); }
    }}>
      {devices.length > 1 && <label className="atom65-device-field">Atom65 grinder
          <select value={deviceId} disabled={busy} onChange={(event) => setChosenDeviceId(event.target.value)}>
            {devices.map((device) => <option key={device.id} value={device.id}>{device.name ?? "Atom65"}{devices.length > 1 ? ` · ${device.id.split(":").slice(-6).join(":")}` : ""}</option>)}
          </select>
        </label>}
      <div className="atom65-dose-fields">
        <label>When I choose this profile
          <select value={mode} disabled={!ready} onChange={(event) => { setMode(event.target.value as typeof mode); setSaved(false); }}>
            <option value="leave">Leave grinder unchanged</option>
            <option value="workflow">Use Brew dose</option>
            <option value="fixed">Use a fixed grind weight</option>
          </select>
        </label>
        {mode === "fixed" && <label>Grind weight (g)
          <input type="number" min={minimum} max={maximum} step="0.1" required value={weight} disabled={!ready} onChange={(event) => { setWeight(event.target.value); setSaved(false); }} />
        </label>}
      </div>
      <p className="muted">{mode === "leave" ? "This profile leaves the grinder’s current preset and weight unchanged." : mode === "workflow" ? "Uses the coffee dose on Brew and follows dose edits while this profile is selected." : "Uses this saved grind weight whenever you select this profile. The Brew dose stays unchanged."}</p>
      <p className="muted">Choices are saved for {devices.find((device) => device.id === deviceId)?.name ?? "this grinder"}. Renaming or editing the recipe requires a fresh opt-in.</p>
      {snapshot && !snapshot.syncEnabled && <p className="muted">Syncing is paused in the Atom65 driver. Your choice can still be saved.</p>}
      {snapshot?.storageError && <p role="alert">Saved choices are unavailable. Reload the Atom65 driver in Decaid before saving.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="atom65-dose-actions">
        <button type="submit" className="primary-button compact-button" disabled={!ready || (mode === "fixed" && !validWeight)}>{busy ? "Please wait…" : "Save grinder choice"}</button>
        <button type="button" className="ghost-button compact-button" disabled={busy} onClick={() => setReload((value) => value + 1)}>Reload saved choice</button>
        {saved && <span role="status">Grinder choice saved.</span>}
      </div>
    </form>
  );
}
