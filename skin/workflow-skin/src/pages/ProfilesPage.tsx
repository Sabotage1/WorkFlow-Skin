import { useState } from "react";
import type { JsonMap, Profile, ProfileRecord } from "../api/types";
import { DEFAULT_STEAM_TIMERS, isProfileShown, profileWorkflowFor, type ProfileWorkflowSettings, type SkinSettings, type SteamTimers } from "../state/skinSettings";

interface ProfileDraft {
  title: string;
  author: string;
  notes: string;
  beverageType: string;
  targetWeight: string;
  steps: JsonMap[];
}

function profileTitle(profile: ProfileRecord): string {
  return profile.profile.title?.trim() || profile.id;
}

function profileSearchText(profile: ProfileRecord): string {
  return [profile.id, profile.profile.title, profile.profile.author, profile.profile.beverage_type, profile.profile.notes].filter(Boolean).join(" ").toLowerCase();
}

function profileType(profile: ProfileRecord): "pressure" | "flow" | "other" {
  const serialized = JSON.stringify(profile.profile.steps ?? []).toLowerCase();
  if (serialized.includes("flow")) return "flow";
  if (serialized.includes("pressure")) return "pressure";
  return "other";
}

function draftFromProfile(profile: Profile): ProfileDraft {
  return {
    title: profile.title ?? "",
    author: profile.author ?? "",
    notes: profile.notes ?? "",
    beverageType: profile.beverage_type ?? "",
    targetWeight: typeof profile.target_weight === "number" ? String(profile.target_weight) : "",
    steps: (profile.steps ?? []).map((step) => ({ ...step }))
  };
}

function trimOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function draftToProfile(original: Profile, draft: ProfileDraft): Profile {
  const targetWeight = Number(draft.targetWeight);
  return {
    ...original,
    title: trimOptional(draft.title),
    author: trimOptional(draft.author),
    notes: trimOptional(draft.notes),
    beverage_type: trimOptional(draft.beverageType),
    target_weight: draft.targetWeight.trim() && Number.isFinite(targetWeight) ? targetWeight : undefined,
    steps: draft.steps.map((step) => ({ ...step }))
  };
}

function isJsonMap(value: unknown): value is JsonMap {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stepText(step: JsonMap, key: string): string {
  const value = step[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stepNumberText(step: JsonMap, key: string): string {
  const value = step[key];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function stepExit(step: JsonMap): JsonMap | null {
  return isJsonMap(step.exit) ? step.exit : null;
}

function stepLimiter(step: JsonMap): JsonMap | null {
  return isJsonMap(step.limiter) ? step.limiter : null;
}

function nestedNumberText(value: JsonMap | null, key: string): string {
  const item = value?.[key];
  return typeof item === "number" && Number.isFinite(item) ? String(item) : "";
}

function nestedText(value: JsonMap | null, key: string): string {
  const item = value?.[key];
  return typeof item === "string" ? item : "";
}

function numberFromInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function defaultStep(): JsonMap {
  return {
    name: "New step",
    pump: "pressure",
    transition: "fast",
    exit: null,
    volume: 0,
    seconds: 10,
    weight: 0,
    temperature: 93,
    sensor: "coffee",
    pressure: 0,
    limiter: null
  };
}

export function ProfilesPage({
  profiles,
  settings,
  onToggleReview,
  onSetStartupProfile,
  onSetProfileShown,
  onUpdateProfileWorkflow,
  onSaveProfile
}: {
  profiles: ProfileRecord[];
  settings: SkinSettings;
  onToggleReview: (profileId: string, enabled: boolean) => void;
  onSetStartupProfile: (profileId?: string) => void;
  onSetProfileShown: (profileId: string, shown: boolean) => void;
  onUpdateProfileWorkflow: (profileId: string, workflow: ProfileWorkflowSettings) => void;
  onSaveProfile: (profileId: string, profile: Profile) => Promise<void> | void;
}) {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "pressure" | "flow">("all");
  const filteredProfiles = profiles.filter((profile) => {
    const matchesSearch = !search.trim() || profileSearchText(profile).includes(search.trim().toLowerCase());
    const matchesType = typeFilter === "all" || profileType(profile) === typeFilter;
    return matchesSearch && matchesType;
  });

  const updateDraftStep = (index: number, updater: (step: JsonMap) => JsonMap) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        steps: current.steps.map((step, stepIndex) => (stepIndex === index ? updater({ ...step }) : step))
      };
    });
  };

  const updateStepText = (index: number, key: string, value: string) => {
    updateDraftStep(index, (step) => ({ ...step, [key]: value }));
  };

  const updateStepNumber = (index: number, key: string, value: string) => {
    updateDraftStep(index, (step) => {
      const parsed = numberFromInput(value);
      const next = { ...step };
      if (parsed === undefined) delete next[key];
      else next[key] = parsed;
      return next;
    });
  };

  const updateStepPump = (index: number, pump: string) => {
    updateDraftStep(index, (step) => {
      const next: JsonMap = { ...step, pump };
      if (pump === "flow") {
        if (typeof next.flow !== "number") next.flow = 0;
        delete next.pressure;
      } else {
        if (typeof next.pressure !== "number") next.pressure = 0;
        delete next.flow;
      }
      return next;
    });
  };

  const updateStepExit = (index: number, key: "type" | "condition" | "value", value: string) => {
    updateDraftStep(index, (step) => {
      if (key === "type" && value === "none") return { ...step, exit: null };
      const current = stepExit(step) ?? { type: "pressure", condition: "over", value: 0 };
      const nextExit = {
        ...current,
        [key]: key === "value" ? numberFromInput(value) ?? 0 : value
      };
      return { ...step, exit: nextExit };
    });
  };

  const updateStepLimiter = (index: number, key: "value" | "range", value: string) => {
    updateDraftStep(index, (step) => {
      const parsed = numberFromInput(value);
      const current = stepLimiter(step) ?? { value: 0, range: 0 };
      return { ...step, limiter: { ...current, [key]: parsed ?? 0 } };
    });
  };

  const addStep = () => {
    setDraft((current) => (current ? { ...current, steps: [...current.steps, defaultStep()] } : current));
  };

  const duplicateStep = (index: number) => {
    setDraft((current) => {
      if (!current) return current;
      const step = current.steps[index] ?? defaultStep();
      const steps = [...current.steps];
      steps.splice(index + 1, 0, { ...step, name: `${stepText(step, "name") || "Step"} copy` });
      return { ...current, steps };
    });
  };

  const removeStep = (index: number) => {
    setDraft((current) => (current ? { ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) } : current));
  };

  return (
    <div className="panel wide">
      <h2>Profiles</h2>
      <div className="profile-filter-bar">
        <label className="settings-field">
          Search profiles
          <input aria-label="Search profiles" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <label className="settings-field">
          Profile type
          <select aria-label="Profile type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)}>
            <option value="all">All profiles</option>
            <option value="pressure">Pressure based</option>
            <option value="flow">Flow based</option>
          </select>
        </label>
      </div>
      {filteredProfiles.map((profile) => {
        const enabled = settings.reviewEnabledByProfile[profile.id] ?? settings.defaultReviewEnabled;
        const title = profileTitle(profile);
        const workflow = profileWorkflowFor(settings, profile.id);
        const editing = editingProfileId === profile.id && draft;
        const updateTimer = (jug: keyof SteamTimers, seconds: number) => {
          onUpdateProfileWorkflow(profile.id, {
            ...workflow,
            steamTimers: { ...workflow.steamTimers, [jug]: seconds }
          });
        };

        return (
          <div className="list-row profile-workflow-row" role="group" aria-label={`${title} profile workflow`} key={profile.id}>
            <div className="profile-row-header">
              <strong>{title}</strong>
              <button
                type="button"
                className="ghost-button compact-button"
                aria-label={`Edit ${title}`}
                onClick={() => {
                  setError(null);
                  setEditingProfileId(profile.id);
                  setDraft(draftFromProfile(profile.profile));
                }}
              >
                Edit
              </button>
            </div>
            <div className="profile-workflow-controls">
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={isProfileShown(settings, profile.id)}
                  onChange={(event) => onSetProfileShown(profile.id, event.target.checked)}
                />
                Show in preset picker
              </label>
              <label className="inline-toggle">
                <input
                  type="radio"
                  name="startup-profile"
                  checked={settings.startupProfileId === profile.id}
                  onChange={() => onSetStartupProfile(profile.id)}
                />
                Use {title} at startup
              </label>
              <label className="inline-toggle">
                <input type="checkbox" checked={enabled} onChange={(event) => onToggleReview(profile.id, event.target.checked)} />
                Open review after brew
              </label>
              <label className="inline-toggle">
                <input
                  type="checkbox"
                  checked={workflow.milkBased}
                  onChange={(event) => onUpdateProfileWorkflow(profile.id, { ...workflow, milkBased: event.target.checked })}
                />
                Milk drink
              </label>
            </div>
            {workflow.milkBased && (
              <div className="timer-grid">
                <label>
                  Small jug seconds
                  <input
                    type="number"
                    min="1"
                    value={workflow.steamTimers.small ?? DEFAULT_STEAM_TIMERS.small}
                    onChange={(event) => updateTimer("small", Number(event.target.value))}
                  />
                </label>
                <label>
                  Medium jug seconds
                  <input
                    type="number"
                    min="1"
                    value={workflow.steamTimers.medium ?? DEFAULT_STEAM_TIMERS.medium}
                    onChange={(event) => updateTimer("medium", Number(event.target.value))}
                  />
                </label>
                <label>
                  Large jug seconds
                  <input
                    type="number"
                    min="1"
                    value={workflow.steamTimers.large ?? DEFAULT_STEAM_TIMERS.large}
                    onChange={(event) => updateTimer("large", Number(event.target.value))}
                  />
                </label>
              </div>
            )}
            {editing && (
              <form
                className="profile-edit-form"
                aria-label={`Edit ${title} profile`}
                onSubmit={(event) => {
                  event.preventDefault();
                  setError(null);
                  setSavingProfileId(profile.id);
                  Promise.resolve(onSaveProfile(profile.id, draftToProfile(profile.profile, draft)))
                    .then(() => {
                      setEditingProfileId(null);
                      setDraft(null);
                    })
                    .catch((saveError) => {
                      setError(saveError instanceof Error ? saveError.message : String(saveError));
                    })
                    .finally(() => setSavingProfileId(null));
                }}
              >
                {error && (
                  <p className="status-message error" role="alert">
                    Could not save profile: {error}
                  </p>
                )}
                <div className="form-grid compact-form-grid">
                  <label>
                    <span>Profile title</span>
                    <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                  </label>
                  <label>
                    <span>Author</span>
                    <input value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} />
                  </label>
                  <label>
                    <span>Beverage type</span>
                    <input value={draft.beverageType} onChange={(event) => setDraft({ ...draft, beverageType: event.target.value })} />
                  </label>
                  <label>
                    <span>Target weight</span>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={draft.targetWeight}
                      onChange={(event) => setDraft({ ...draft, targetWeight: event.target.value })}
                    />
                  </label>
                </div>
                <label className="notes-field">
                  <span>Notes</span>
                  <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
                </label>
                <div className="profile-steps-editor">
                  <div className="profile-steps-header">
                    <h3>Profile Steps</h3>
                    <button type="button" className="ghost-button compact-button" onClick={addStep}>
                      Add step
                    </button>
                  </div>
                  {draft.steps.length === 0 && <p className="muted">No profile steps yet.</p>}
                  {draft.steps.map((step, stepIndex) => {
                    const number = stepIndex + 1;
                    const pump = stepText(step, "pump") || "pressure";
                    const exit = stepExit(step);
                    const limiter = stepLimiter(step);
                    return (
                      <fieldset className="profile-step-card" key={stepIndex}>
                        <legend>Step {number}</legend>
                        <div className="profile-step-grid">
                          <label>
                            <span>Name</span>
                            <input aria-label={`Step ${number} name`} value={stepText(step, "name")} onChange={(event) => updateStepText(stepIndex, "name", event.target.value)} />
                          </label>
                          <label>
                            <span>Pump</span>
                            <select aria-label={`Step ${number} pump`} value={pump} onChange={(event) => updateStepPump(stepIndex, event.target.value)}>
                              <option value="pressure">Pressure</option>
                              <option value="flow">Flow</option>
                            </select>
                          </label>
                          <label>
                            <span>Transition</span>
                            <select
                              aria-label={`Step ${number} transition`}
                              value={stepText(step, "transition") || "fast"}
                              onChange={(event) => updateStepText(stepIndex, "transition", event.target.value)}
                            >
                              <option value="fast">Fast</option>
                              <option value="smooth">Smooth</option>
                            </select>
                          </label>
                          <label>
                            <span>Sensor</span>
                            <select
                              aria-label={`Step ${number} sensor`}
                              value={stepText(step, "sensor") || "coffee"}
                              onChange={(event) => updateStepText(stepIndex, "sensor", event.target.value)}
                            >
                              <option value="coffee">Coffee</option>
                              <option value="water">Water</option>
                            </select>
                          </label>
                          <label>
                            <span>Seconds</span>
                            <input
                              aria-label={`Step ${number} seconds`}
                              type="number"
                              step="0.1"
                              value={stepNumberText(step, "seconds")}
                              onChange={(event) => updateStepNumber(stepIndex, "seconds", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Temperature</span>
                            <input
                              aria-label={`Step ${number} temperature`}
                              type="number"
                              step="0.1"
                              value={stepNumberText(step, "temperature")}
                              onChange={(event) => updateStepNumber(stepIndex, "temperature", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Weight</span>
                            <input
                              aria-label={`Step ${number} weight goal`}
                              type="number"
                              step="0.1"
                              value={stepNumberText(step, "weight")}
                              onChange={(event) => updateStepNumber(stepIndex, "weight", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Volume</span>
                            <input
                              aria-label={`Step ${number} volume limit`}
                              type="number"
                              step="0.1"
                              value={stepNumberText(step, "volume")}
                              onChange={(event) => updateStepNumber(stepIndex, "volume", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>{pump === "flow" ? "Flow goal" : "Pressure goal"}</span>
                            <input
                              aria-label={`Step ${number} ${pump === "flow" ? "flow" : "pressure"} goal`}
                              type="number"
                              step="0.1"
                              value={stepNumberText(step, pump === "flow" ? "flow" : "pressure")}
                              onChange={(event) => updateStepNumber(stepIndex, pump === "flow" ? "flow" : "pressure", event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="profile-step-limits">
                          <label>
                            <span>Exit type</span>
                            <select aria-label={`Step ${number} exit type`} value={nestedText(exit, "type") || "none"} onChange={(event) => updateStepExit(stepIndex, "type", event.target.value)}>
                              <option value="none">No exit</option>
                              <option value="pressure">Pressure</option>
                              <option value="flow">Flow</option>
                              <option value="weight">Weight</option>
                            </select>
                          </label>
                          <label>
                            <span>Exit condition</span>
                            <select
                              aria-label={`Step ${number} exit condition`}
                              value={nestedText(exit, "condition") || "over"}
                              onChange={(event) => updateStepExit(stepIndex, "condition", event.target.value)}
                            >
                              <option value="over">Over</option>
                              <option value="under">Under</option>
                            </select>
                          </label>
                          <label>
                            <span>Exit value</span>
                            <input
                              aria-label={`Step ${number} exit value`}
                              type="number"
                              step="0.1"
                              value={nestedNumberText(exit, "value")}
                              onChange={(event) => updateStepExit(stepIndex, "value", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Limiter value</span>
                            <input
                              aria-label={`Step ${number} limiter value`}
                              type="number"
                              step="0.1"
                              value={nestedNumberText(limiter, "value")}
                              onChange={(event) => updateStepLimiter(stepIndex, "value", event.target.value)}
                            />
                          </label>
                          <label>
                            <span>Limiter range</span>
                            <input
                              aria-label={`Step ${number} limiter range`}
                              type="number"
                              step="0.1"
                              value={nestedNumberText(limiter, "range")}
                              onChange={(event) => updateStepLimiter(stepIndex, "range", event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="row-actions">
                          <button type="button" className="ghost-button compact-button" onClick={() => duplicateStep(stepIndex)}>
                            Duplicate
                          </button>
                          <button type="button" className="ghost-button compact-button" onClick={() => removeStep(stepIndex)}>
                            Remove
                          </button>
                        </div>
                      </fieldset>
                    );
                  })}
                </div>
                <div className="form-actions">
                  <button type="button" className="ghost-button" onClick={() => setEditingProfileId(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="primary-button" disabled={savingProfileId === profile.id}>
                    {savingProfileId === profile.id ? "Saving" : `Save ${title}`}
                  </button>
                </div>
              </form>
            )}
          </div>
        );
      })}
    </div>
  );
}
