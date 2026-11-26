import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { JsonMap, Profile, ProfileRecord } from "../api/types";
import {
  importEditorProfile, initialEditorProfile, MAX_PROFILE_STEPS, newProfileStep, profileForSave,
  profileNumber, profileObject, profilePump, profileText, stepSummary, validateEditorProfile
} from "../lib/profileEditor";
import { ProfilePreview } from "./ProfilePreview";
import { ProfileStepList } from "./ProfileStepList";

const BEVERAGE_TYPES = ["espresso", "pourover", "manual", "cleaning", "calibrate"];
const VIEWS = ["Steps", "Summary", "Details"] as const;
type View = typeof VIEWS[number];

function NumberField({ label, name, value, onChange }: {
  label: string; name?: string; value: unknown; onChange: (value?: number) => void;
}) {
  return <label className="recipe-field">
    <span>{label}</span>
    <input type="number" inputMode="decimal" min={0} step="any" aria-label={name}
      value={profileNumber(value) ?? ""} onChange={(event) => onChange(profileNumber(event.target.value))} />
  </label>;
}

function SelectField({ label, name, value, onChange, children }: {
  label: string; name?: string; value: string; onChange: (value: string) => void; children: ReactNode;
}) {
  return <label className="recipe-field">
    <span>{label}</span>
    <select aria-label={name} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select>
  </label>;
}

function StepInspector({ step, index, onChange }: { step: JsonMap; index: number; onChange: (step: JsonMap) => void }) {
  const number = index + 1;
  const pump = profilePump(step);
  const otherPump = pump === "pressure" ? "flow" : "pressure";
  const exit = profileObject(step.exit) ? step.exit : null;
  const limiter = profileObject(step.limiter) ? step.limiter : null;
  const patch = (fields: JsonMap) => onChange({ ...step, ...fields });
  const field = (label: string, key: string, name: string) => (
    <NumberField label={label} name={`Step ${number} ${name}`} value={step[key]} onChange={(value) => patch({ [key]: value })} />
  );

  return <div className="recipe-inspector">
    <fieldset>
      <legend>Pump and temperature</legend>
      <div className="recipe-fields">
        <label className="recipe-field">
          <span>Step name</span>
          <input aria-label={`Step ${number} name`} value={profileText(step.name)} onChange={(event) => patch({ name: event.target.value })} />
        </label>
        <SelectField label="Pump mode" name={`Step ${number} pump`} value={profileText(step.pump)} onChange={(value) => {
          const next: JsonMap = { ...step, pump: value, [value]: profileNumber(step[value]) ?? (value === "flow" ? 2 : 6) };
          delete next[value === "flow" ? "pressure" : "flow"];
          // A limiter caps the opposite measurement, so its units change with the pump mode.
          if (value !== pump) next.limiter = null;
          onChange(next);
        }}>
          {step.pump !== "pressure" && step.pump !== "flow" && <option value={profileText(step.pump)}>Choose pump</option>}
          <option value="pressure">Pressure</option>
          <option value="flow">Flow</option>
        </SelectField>
        {field(pump === "pressure" ? "Pressure · bar" : "Flow · mL/s", pump, `${pump} goal`)}
        <SelectField label="Transition" name={`Step ${number} transition`} value={profileText(step.transition)} onChange={(value) => patch({ transition: value })}>
          {step.transition !== "fast" && step.transition !== "smooth" && <option value={profileText(step.transition)}>Choose transition</option>}
          <option value="fast">Fast</option>
          <option value="smooth">Smooth</option>
        </SelectField>
        {field("Temperature · °C", "temperature", "temperature")}
        <SelectField label="Temperature sensor" name={`Step ${number} sensor`} value={profileText(step.sensor)} onChange={(value) => patch({ sensor: value })}>
          {step.sensor !== "coffee" && step.sensor !== "water" && <option value={profileText(step.sensor)}>Choose sensor</option>}
          <option value="coffee">Coffee</option>
          <option value="water">Water</option>
        </SelectField>
      </div>
    </fieldset>

    <fieldset>
      <legend>Step limits</legend>
      <div className="recipe-fields">
        {field("Maximum time · s", "seconds", "seconds")}
        {field("Water volume · mL", "volume", "volume limit")}
        {field("Weight exit · g", "weight", "weight goal")}
      </div>
    </fieldset>

    <fieldset>
      <legend>Early exit</legend>
      <div className="recipe-fields">
        <SelectField label="Measurement" name={`Step ${number} exit type`} value={profileText(exit?.type) || "none"} onChange={(value) => patch({
          exit: value === "none" ? null : { ...exit, type: value, condition: exit?.condition ?? "over", value: exit?.value ?? 0 }
        })}>
          <option value="none">No early exit</option>
          <option value="pressure">Pressure</option>
          <option value="flow">Flow</option>
        </SelectField>
        {exit && <>
          <SelectField label="Condition" name={`Step ${number} exit condition`} value={profileText(exit.condition)} onChange={(value) => patch({ exit: { ...exit, condition: value } })}>
            <option value="over">Goes over</option>
            <option value="under">Goes under</option>
          </SelectField>
          <NumberField label={exit.type === "flow" ? "Threshold · mL/s" : "Threshold · bar"} name={`Step ${number} exit value`}
            value={exit.value} onChange={(value) => patch({ exit: { ...exit, value } })} />
        </>}
      </div>
    </fieldset>

    <fieldset>
      <legend>Pump limiter</legend>
      <label className="inline-toggle">
        <input type="checkbox" checked={limiter !== null}
          onChange={(event) => patch({ limiter: event.target.checked ? { value: pump === "pressure" ? 4 : 8, range: 0.6 } : null })} />
        Limit {otherPump}
      </label>
      {limiter && <div className="recipe-fields">
        <NumberField label={pump === "pressure" ? "Flow limit · mL/s" : "Pressure limit · bar"} name={`Step ${number} limiter value`}
          value={limiter.value} onChange={(value) => patch({ limiter: { ...limiter, value } })} />
        <NumberField label={pump === "pressure" ? "Control range · mL/s" : "Control range · bar"} name={`Step ${number} limiter range`}
          value={limiter.range} onChange={(value) => patch({ limiter: { ...limiter, range: value } })} />
      </div>}
    </fieldset>
  </div>;
}

function readProfileFile(file: File): Promise<Profile> {
  if (file.size > 1024 * 1024) return Promise.reject(new Error("Choose a profile JSON file under 1 MB."));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected file."));
    reader.onload = () => {
      try {
        resolve(importEditorProfile(JSON.parse(String(reader.result).replace(/^\uFEFF/, ""))));
      } catch (error) {
        reject(error instanceof SyntaxError ? new Error("The selected file is not valid JSON.") : error);
      }
    };
    reader.readAsText(file);
  });
}

export function ProfileEditor({ record, onClose, onSave, onCreate, onLoadVersions }: {
  record: ProfileRecord | null;
  onClose: () => void;
  onSave: (profileId: string, profile: Profile) => Promise<void> | void;
  onCreate?: (profile: Profile, parentId?: string) => Promise<void> | void;
  onLoadVersions?: (profileId: string) => Promise<ProfileRecord[]>;
}) {
  const [draft, setDraft] = useState(() => initialEditorProfile(record?.profile));
  const [baseline] = useState(() => JSON.stringify(draft));
  const [view, setView] = useState<View>("Steps");
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versions, setVersions] = useState<ProfileRecord[] | null>(null);
  const [error, setError] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const requestPending = useRef(false);
  const id = useId();
  const steps = draft.steps ?? [];
  const step = steps[selected];
  const dirty = JSON.stringify(draft) !== baseline;
  const totalSeconds = steps.reduce((total, item) => total + (profileNumber(item.seconds) ?? 0), 0);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (record) panelRef.current?.focus();
    else titleInput.current?.focus();
    return () => opener?.focus();
  }, [record]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const close = () => {
    if (!requestPending.current && (!dirty || window.confirm("Discard unsaved profile changes?"))) onClose();
  };

  const replaceSteps = (next: JsonMap[], active: number) => {
    const volumeStart = steps[profileNumber(draft.target_volume_count_start) ?? 0];
    const nextStart = next.indexOf(volumeStart);
    setSelected(active);
    setDraft((current) => ({
      ...current,
      steps: next,
      target_volume_count_start: nextStart < 0 ? Math.min(profileNumber(current.target_volume_count_start) ?? 0, next.length - 1) : nextStart
    }));
    setError("");
  };

  const reorder = (from: number, to: number) => {
    if (requestPending.current || from === to || !steps[from] || !steps[to]) return;
    const next = [...steps];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    replaceSteps(next, to);
  };

  const select = (index: number) => { setSelected(index); setView("Steps"); };

  const save = async (asCopy = false) => {
    if (requestPending.current) return;
    const payload = profileForSave(draft);
    const issue = validateEditorProfile(payload);
    if (issue) {
      setError(issue.message);
      setView(issue.details ? "Details" : "Steps");
      if (issue.step !== undefined) setSelected(issue.step);
      if (!payload.title) titleInput.current?.focus();
      return;
    }
    requestPending.current = true;
    setBusy(true);
    setError("");
    try {
      if (record && !asCopy) await onSave(record.id, payload);
      else if (onCreate) await onCreate(payload, record?.id);
      else return;
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Decaid could not save the profile.");
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  };

  const update = (fields: Partial<Profile>) => {
    setError("");
    setDraft((current) => ({ ...current, ...fields }));
  };

  const replaceDraft = (profile: Profile) => {
    setDraft(profile);
    setError("");
    setSelected(0);
    setView("Steps");
  };

  const exportDraft = () => {
    const payload = profileForSave(draft);
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    link.href = url;
    link.download = `${payload.title?.replace(/[\\/:*?"<>|]/g, "-") || "profile"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return createPortal(<div className="recipe-overlay">
    <div ref={panelRef} tabIndex={-1} className="recipe-editor" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.stopPropagation(); close(); }
        if (event.key !== "Tab") return;
        const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)") ?? [])
          .filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}>
      <header className="recipe-header">
        <div className="recipe-heading">
          <h2 id={`${id}-title`}>{record ? "Edit profile" : "New profile"}</h2>
          <input ref={titleInput} aria-label="Profile title" placeholder="Name your profile" disabled={busy}
            value={profileText(draft.title)} onChange={(event) => update({ title: event.target.value })} />
        </div>
        <div className="recipe-actions">
          <button type="button" className="ghost-button" disabled={busy} onClick={close}>Cancel</button>
          {record && !record.isDefault && onCreate && <button type="button" className="ghost-button" disabled={busy} onClick={() => void save(true)}>Save as copy</button>}
          <button type="button" className="primary-button" disabled={busy} onClick={() => void save(record?.isDefault === true)}>
            {busy ? "Saving…" : record?.isDefault ? "Save as copy" : record ? "Save changes" : "Create profile"}
          </button>
        </div>
      </header>

      <div className="recipe-tabs" role="tablist" aria-label="Profile editor views"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const current = VIEWS.indexOf(view);
          const next = event.key === "Home" ? 0 : event.key === "End" ? VIEWS.length - 1
            : (current + (event.key === "ArrowRight" ? 1 : -1) + VIEWS.length) % VIEWS.length;
          setView(VIEWS[next]);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
        }}>
        {VIEWS.map((tab) => <button key={tab} id={`${id}-${tab}`} type="button" role="tab" aria-controls={`${id}-view`}
          aria-selected={view === tab} tabIndex={view === tab ? 0 : -1} disabled={busy} onClick={() => setView(tab)}>{tab}</button>)}
      </div>
      {error && <p className="recipe-error status-message error" role="alert">{error}</p>}

      <div className="recipe-body" id={`${id}-view`} role="tabpanel" aria-labelledby={`${id}-${view}`} aria-busy={busy || undefined}>
        {view !== "Details" && <section className="recipe-preview">
          <div className="recipe-section-heading">
            <h3>Profile preview</h3>
            <span>{steps.length} steps · {Number(totalSeconds.toFixed(1))} s max</span>
          </div>
          <ProfilePreview steps={steps} selected={selected} disabled={busy} onSelect={select}
            onTargetChange={(index, key, value) => {
              setError("");
              setDraft((current) => ({
                ...current,
                steps: current.steps?.map((item, stepIndex) => stepIndex === index ? { ...item, [key]: value } : item)
              }));
            }} />
          <p>Drag a line up or down to change its target. Early exits can shorten steps.</p>
        </section>}

        {view === "Steps" && <div className="recipe-step-layout">
          <section className="recipe-step-list" aria-label="Profile steps">
            <div className="recipe-section-heading">
              <h3>Profile Steps</h3>
              <button type="button" className="ghost-button" disabled={busy || steps.length >= MAX_PROFILE_STEPS} onClick={() => {
                const next = [...steps];
                next.splice(selected + 1, 0, newProfileStep(profileNumber(step?.temperature)));
                replaceSteps(next, selected + 1);
              }}>Add step</button>
            </div>
            <ProfileStepList steps={steps} selected={selected} disabled={busy} onSelect={select} onReorder={reorder} />
          </section>
          {step && <section className="recipe-step-editor" aria-label={`Edit step ${selected + 1}`}>
            <div className="recipe-section-heading">
              <h3>Step {selected + 1}</h3>
              <div className="recipe-actions">
                <button type="button" className="ghost-button" disabled={busy || steps.length >= MAX_PROFILE_STEPS} onClick={() => {
                  const next = [...steps];
                  next.splice(selected + 1, 0, { ...step, name: `${profileText(step.name) || "Step"} copy` });
                  replaceSteps(next, selected + 1);
                }}>Duplicate</button>
                <button type="button" className="ghost-button" disabled={busy || steps.length <= 1} onClick={() =>
                  replaceSteps(steps.filter((_, index) => index !== selected), Math.min(selected, steps.length - 2))
                }>Remove</button>
              </div>
            </div>
            <fieldset className="recipe-inspector-shell" disabled={busy}>
              <StepInspector index={selected} step={step} onChange={(next) => update({
                steps: steps.map((item, index) => index === selected ? next : item)
              })} />
            </fieldset>
          </section>}
        </div>}

        {view === "Summary" && <section className="recipe-summary">
          <h3>Recipe summary</h3>
          <ol>{steps.map((item, index) => {
            const exit = profileObject(item.exit) ? item.exit : null;
            const limiter = profileObject(item.limiter) ? item.limiter : null;
            return <li key={index}>
              <button type="button" className="ghost-button" disabled={busy} onClick={() => select(index)}>
                {profileText(item.name) || `Step ${index + 1}`}
              </button>
              <p>{stepSummary(item)} · {profileText(item.transition)} transition · {profileText(item.sensor)} sensor</p>
              <div className="recipe-summary-conditions">
                {exit && <span>Exit when {profileText(exit.type)} goes {profileText(exit.condition)} {profileNumber(exit.value)} {exit.type === "flow" ? "mL/s" : "bar"}</span>}
                {limiter && <span>{profilePump(item) === "pressure" ? "Flow" : "Pressure"} cap {profileNumber(limiter.value)} {profilePump(item) === "pressure" ? "mL/s" : "bar"}</span>}
                {!!profileNumber(item.weight) && <span>Weight exit {profileNumber(item.weight)} g</span>}
                {!!profileNumber(item.volume) && <span>Volume limit {profileNumber(item.volume)} mL</span>}
              </div>
            </li>;
          })}</ol>
        </section>}

        {view === "Details" && <fieldset className="recipe-details" disabled={busy}>
          <legend>Profile details</legend>
          <div className="recipe-fields">
            <label className="recipe-field"><span>Author</span><input value={profileText(draft.author)} onChange={(event) => update({ author: event.target.value })} /></label>
            <SelectField label="Beverage type" value={draft.beverage_type || "espresso"} onChange={(value) => update({ beverage_type: value })}>
              {draft.beverage_type && !BEVERAGE_TYPES.includes(draft.beverage_type) && <option value={draft.beverage_type}>{draft.beverage_type}</option>}
              {BEVERAGE_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}
            </SelectField>
            <NumberField label="Target weight · g" name="Target weight" value={draft.target_weight} onChange={(value) => update({ target_weight: value ?? null })} />
            <NumberField label="Target water volume · mL" value={draft.target_volume} onChange={(value) => update({ target_volume: value ?? null })} />
            <NumberField label="Tank temperature · °C" value={draft.tank_temperature} onChange={(value) => update({ tank_temperature: value })} />
            <SelectField label="Count water volume from" value={String(draft.target_volume_count_start ?? 0)} onChange={(value) => update({ target_volume_count_start: Number(value) })}>
              {steps.map((item, index) => <option value={index} key={index}>{index + 1}. {profileText(item.name) || "Untitled step"}</option>)}
            </SelectField>
          </div>
          <label className="recipe-field"><span>Notes</span><textarea value={profileText(draft.notes)} onChange={(event) => update({ notes: event.target.value })} /></label>
          <div className="recipe-file-actions">
            <label className="recipe-field"><span>Import profile JSON</span><input type="file" accept=".json,application/json" onChange={async (event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (!file) return;
              if (dirty && !window.confirm("Replace this draft with the imported profile?")) return;
              requestPending.current = true;
              setBusy(true);
              try { replaceDraft(await readProfileFile(file)); }
              catch (importError) { setError(importError instanceof Error ? importError.message : "Could not import the profile."); }
              finally { requestPending.current = false; setBusy(false); }
            }} /></label>
            <button type="button" className="ghost-button" onClick={exportDraft}>Export JSON</button>
          </div>
          {record && onLoadVersions && <section className="recipe-versions">
            <button type="button" className="ghost-button" disabled={loadingVersions} onClick={async () => {
              setLoadingVersions(true);
              setError("");
              try { setVersions((await onLoadVersions(record.id)).filter((item) => item.id !== record.id)); }
              catch { setError("Decaid could not load profile versions."); }
              finally { setLoadingVersions(false); }
            }}>{loadingVersions ? "Loading versions…" : "Load version history"}</button>
            {versions?.length === 0 && <p>No other versions in Decaid.</p>}
            {versions?.map((item) => <div className="recipe-version-row" key={item.id}>
              <span>{item.profile.title || item.id}{item.updatedAt ? ` · ${item.updatedAt.slice(0, 10)}` : ""}</span>
              <button type="button" className="ghost-button" onClick={() => {
                if (!dirty || window.confirm("Replace this draft with the selected version?")) replaceDraft(initialEditorProfile(item.profile));
              }}>Open in editor</button>
            </div>)}
          </section>}
        </fieldset>}
      </div>
    </div>
  </div>, document.querySelector(".app-shell") ?? document.body);
}
