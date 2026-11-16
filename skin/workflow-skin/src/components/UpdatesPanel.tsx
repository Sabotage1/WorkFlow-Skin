import { useEffect, useRef, useState } from "react";
import { MAX_FIRMWARE_BYTES, supportsDe1Firmware, type SoftwareUpdates } from "../state/useSoftwareUpdates";

function firmwareSummary(updates: SoftwareUpdates): string {
  const catalog = updates.catalog;
  if (!catalog) return updates.refreshing ? "Checking firmware…" : "Firmware check unavailable";
  if (!catalog.machine) return "Connect a machine to check for firmware updates";
  if (catalog.artifacts.some((item) => item.id === catalog.recommendedArtifactId && item.eligibility.status === "applicable")) return "Firmware update available";
  if (catalog.updateAvailable === null || catalog.artifacts.some((item) => item.eligibility.status === "unknown")) return "Could not determine firmware availability";
  if (catalog.artifacts.some((item) => item.eligibility.reasons.includes("not_newer"))) return "No newer compatible firmware in Decaid";
  return "No compatible firmware available for this machine";
}

function releaseUrl(value?: string): string | null {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" ? url.href : null; } catch { return null; }
}

const firmwareLabels = {
  idle: "", starting: "Preparing firmware update…", erasing: "Preparing machine memory…",
  uploading: "Uploading firmware…", verifying: "Verifying firmware on the machine…",
  done: "Firmware update verified and complete.", error: "Firmware update not completed.", cancelled: "Firmware update cancelled."
};

export function UpdatesPanel({ updates }: { updates: SoftwareUpdates }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"firmware" | "file" | "app" | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => updates.activate(), [updates.activate]);
  useEffect(() => {
    if (!confirmation) return;
    opener.current = document.activeElement as HTMLElement;
    cancelButton.current?.focus();
    return () => opener.current?.focus();
  }, [confirmation]);

  const artifact = updates.catalog?.artifacts.find((item) => item.id === updates.catalog?.recommendedArtifactId && item.eligibility.status === "applicable");
  const connected = Boolean(updates.catalog?.machine || updates.machineInfo?.model);
  const manualSupported = supportsDe1Firmware(updates.catalog?.machine?.model ?? updates.machineInfo?.model);
  const busy = updates.firmwareBusy || updates.appBusy;
  const app = updates.appState;
  const appChecking = updates.pendingCommand === "check" || app?.phase === "checking";
  const appRelease = releaseUrl(app?.releaseUrl) ?? "https://github.com/decentespresso/decaid/releases";
  const firmwareState = updates.catalog?.operation.state;
  const firmwareMessage = updates.cancelling ? "Cancelling firmware update…" :
    updates.firmwarePhase === "idle" && firmwareState && firmwareState !== "idle" ? `Machine firmware update: ${firmwareState}…` :
    firmwareLabels[updates.firmwarePhase];
  const appMessage = updates.pendingCommand === "install" ? "Requesting Decaid update…" : appChecking ? "Checking for Decaid updates…" :
    app?.phase === "available" ? `Decaid ${app.latestVersion ?? "update"} is available` :
    app?.phase === "downloading" ? "Downloading Decaid…" : app?.phase === "installing" ? "Opening the app installer…" :
    app?.phase === "error" ? "Could not update Decaid" : updates.appChecked ? "Decaid is up to date" : "Check for a newer Decaid version";

  return (
    <div className="updates-panel">
      <div className="updates-heading">
        <div><h3>Updates</h3><p>Machine firmware and the Decaid app.</p></div>
        <button type="button" className="ghost-button" disabled={updates.refreshing} onClick={() => void updates.refresh()}>
          {updates.refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </div>

      <section className="update-card" aria-labelledby="firmware-heading">
        <div className="updates-heading">
          <div><p className="update-kicker">DE1</p><h3 id="firmware-heading">Machine firmware</h3></div>
          <span className="update-version">Build {updates.catalog?.machine?.build ?? updates.machineInfo?.version ?? "unknown"}</span>
        </div>
        <p className="update-machine">{updates.catalog?.machine?.model ?? updates.machineInfo?.model ?? "No machine connected"}</p>
        <p className="update-summary">{firmwareSummary(updates)}</p>
        {updates.catalogError && <p className="update-detail">{updates.catalogError}</p>}
        <div className="update-actions">
          <button type="button" className="ghost-button" disabled={updates.refreshing || busy} onClick={() => void updates.refresh()}>Check firmware</button>
          {artifact && (
            <button type="button" className="primary-button" disabled={busy} onClick={() => setConfirmation("firmware")}>
              Install firmware {artifact.versionLabel ?? artifact.build}
            </button>
          )}
        </div>
        {artifact?.releaseNotes && <details className="update-notes"><summary>Firmware release notes</summary><p>{artifact.releaseNotes}</p></details>}

        {firmwareMessage && <div className="update-progress" role="status" aria-live="polite">
          <strong>{firmwareMessage}</strong>
          {updates.firmwareBusy && <>
            <progress aria-label="Firmware update progress" max={1} value={updates.firmwarePhase === "uploading" ? updates.firmwareProgress : undefined} />
            {updates.firmwarePhase === "uploading" && <span>{Math.round(updates.firmwareProgress * 100)}% uploaded. Waiting for machine verification.</span>}
            <span>Keep the machine and tablet powered on. Keep Decaid open.</span>
          </>}
        </div>}
        {updates.firmwareError && <p className="update-error" role="alert">{updates.firmwareError}</p>}
        {updates.firmwareBusy && <button type="button" className="ghost-button" disabled={updates.cancelling || firmwareState === "cancelling"} onClick={() => void updates.cancelFirmware()}>
          {updates.cancelling || firmwareState === "cancelling" ? "Cancelling…" : "Cancel firmware update"}
        </button>}

        <details className="update-manual">
          <summary>Upload a firmware file</summary>
          <p>Use a firmware file from Decent for this machine model. You can upload a file when an automatic firmware check is unavailable.</p>
          {connected && !manualSupported && <p>Manual firmware upload is supported only for classic DE1 machines.</p>}
          <label className="settings-field">Firmware file
            <input type="file" aria-label="Firmware file" disabled={busy || !manualSupported} onChange={(event) => {
              const next = event.target.files?.[0] ?? null;
              const invalid = !!next && (next.size === 0 || next.size > MAX_FIRMWARE_BYTES);
              setFile(invalid ? null : next);
              setFileError(invalid ? "Choose a non-empty firmware file no larger than 16 MB." : null);
            }} />
          </label>
          {file && <p className="update-detail">{file.name} · {Math.ceil(file.size / 1024)} KB</p>}
          {fileError && <p className="update-error" role="alert">{fileError}</p>}
          <button type="button" className="ghost-button" disabled={!file || !connected || !manualSupported || busy} onClick={() => setConfirmation("file")}>Upload firmware</button>
        </details>
      </section>

      <section className="update-card" aria-labelledby="decaid-heading">
        <div className="updates-heading"><div><p className="update-kicker">APP</p><h3 id="decaid-heading">Decaid</h3></div>
          <span className="update-version">{app?.currentVersion ?? updates.appInfo?.version ?? "Version unknown"}</span>
        </div>
        <p className="update-summary" role="status">{appMessage}</p>
        {updates.appInfo?.buildNumber && <p className="update-detail">Build {updates.appInfo.buildNumber}{updates.appInfo.commitShort ? ` · ${updates.appInfo.commitShort}` : ""}</p>}
        {(updates.appError || app?.error) && <p className="update-error" role="alert">{updates.appError ?? app?.error}</p>}
        {updates.appInfo?.appStore && <p className="update-detail">This Decaid build is managed by its app store. Install app updates there.</p>}
        {app?.phase === "downloading" && <progress aria-label="Decaid download progress" max={1} value={typeof app.progress === "number" ? Math.min(1, Math.max(0, app.progress)) : undefined} />}
        <div className="update-actions">
          <button type="button" className="ghost-button" disabled={!updates.appConnected || appChecking || busy || updates.appInfo?.appStore === true} onClick={() => void updates.commandApp("check")}>
            {appChecking ? "Checking…" : "Check for Decaid updates"}
          </button>
          {app?.phase === "available" && app.installable && <button type="button" className="primary-button" disabled={!updates.appConnected || busy} onClick={() => setConfirmation("app")}>Update Decaid</button>}
          {appRelease && <a className="ghost-button update-link" href={appRelease} target="_blank" rel="noopener noreferrer">View Decaid releases</a>}
        </div>
        {app?.releaseNotes && <details className="update-notes"><summary>Decaid release notes</summary><p>{app.releaseNotes}</p></details>}
      </section>

      {confirmation && <div className="preset-editor" role="presentation" onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); setConfirmation(null); }
        if (event.key === "Tab") {
          const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="preset-editor-panel update-confirmation" role="dialog" aria-modal="true" aria-labelledby="update-confirmation-title" aria-describedby="update-confirmation-detail">
          <h3 id="update-confirmation-title">{confirmation === "app" ? "Update Decaid?" : "Install machine firmware?"}</h3>
          <p id="update-confirmation-detail">{confirmation === "app"
            ? `Install Decaid ${app?.latestVersion ?? "update"}? The system installer may close or restart the app.`
            : `Install ${confirmation === "file" ? file?.name : `firmware ${artifact?.versionLabel ?? artifact?.build}`} on ${updates.catalog?.machine?.model ?? updates.machineInfo?.model ?? "this machine"}? Keep the machine and tablet powered on until verification finishes. This cannot be undone from this screen.`}</p>
          <div className="update-actions">
            <button ref={cancelButton} type="button" className="ghost-button" onClick={() => setConfirmation(null)}>Go back</button>
            <button type="button" className="primary-button" disabled={busy} onClick={() => {
              if (confirmation === "app") void updates.commandApp("install");
              else if (confirmation === "file" && file) void updates.startFirmware({ file });
              else if (confirmation === "firmware" && artifact) void updates.startFirmware({ artifactId: artifact.id });
              setConfirmation(null);
            }}>Install update</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
