import {
  ArrowDown,
  ArrowUp,
  Coffee,
  Droplets,
  Flame,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
  Workflow as WorkflowIcon
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ProfileRecord } from "../api/types";
import { DrinkWorkflowRunCard } from "../components/DrinkWorkflowRunCard";
import {
  MAX_DRINK_WORKFLOW_STEPS,
  MAX_HOT_WATER_TEMPERATURE_C,
  MAX_HOT_WATER_VOLUME_ML,
  MAX_STEAM_DURATION_SECONDS,
  MAX_STEAM_TEMPERATURE_C,
  MIN_HOT_WATER_TEMPERATURE_C,
  MIN_HOT_WATER_VOLUME_ML,
  MIN_STEAM_DURATION_SECONDS,
  MIN_STEAM_TEMPERATURE_C,
  createDrinkWorkflowId,
  createDrinkWorkflowStep,
  validateDrinkWorkflow,
  type DrinkWorkflow,
  type DrinkWorkflowRunState,
  type DrinkWorkflowStep,
  type DrinkWorkflowStepType
} from "../lib/drinkWorkflows";

function cloneWorkflow(workflow: DrinkWorkflow): DrinkWorkflow {
  return { ...workflow, steps: workflow.steps.map((step) => ({ ...step })) };
}

function newWorkflow(profileId = ""): DrinkWorkflow {
  return {
    id: createDrinkWorkflowId(),
    name: "",
    steps: [createDrinkWorkflowStep("brew", profileId)]
  };
}

function stepIcon(type: DrinkWorkflowStepType, size = 18) {
  if (type === "brew") return <Coffee size={size} />;
  if (type === "hotWater") return <Droplets size={size} />;
  return <Flame size={size} />;
}

function stepLabel(type: DrinkWorkflowStepType): string {
  if (type === "brew") return "Brew Profile";
  if (type === "hotWater") return "Hot Water";
  return "Steam Milk";
}

function profileName(profileId: string, profiles: ProfileRecord[]): string {
  return profiles.find((profile) => profile.id === profileId)?.profile.title?.trim() || "Missing profile";
}

function stepSummary(step: DrinkWorkflowStep, profiles: ProfileRecord[]): string {
  if (step.type === "brew") return profileName(step.profileId, profiles);
  if (step.type === "hotWater") return `${step.volumeMl} ml at ${step.temperatureC} C`;
  return `${step.durationSeconds}s at ${step.temperatureC} C`;
}

function isRunBusy(run: DrinkWorkflowRunState): boolean {
  return run.phase === "preparing" || run.phase === "starting" || run.phase === "running" || run.phase === "between";
}

export function WorkflowsPage({
  workflows,
  profiles,
  run,
  onSave,
  onDelete,
  onStart,
  onCancel
}: {
  workflows: DrinkWorkflow[];
  profiles: ProfileRecord[];
  run: DrinkWorkflowRunState;
  onSave: (workflow: DrinkWorkflow) => Promise<void> | void;
  onDelete: (workflowId: string) => Promise<void> | void;
  onStart: (workflow: DrinkWorkflow) => Promise<void> | void;
  onCancel: () => Promise<void> | void;
}) {
  const firstProfileId = profiles[0]?.id ?? "";
  const [draft, setDraft] = useState<DrinkWorkflow>(() => cloneWorkflow(workflows[0] ?? newWorkflow(firstProfileId)));
  const [addType, setAddType] = useState<DrinkWorkflowStepType>("hotWater");
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const availableProfileIds = useMemo(() => new Set(profiles.map((profile) => profile.id)), [profiles]);
  const errors = validateDrinkWorkflow(draft, availableProfileIds);
  const nameError = errors.find((error) => error.field === "name")?.message;
  const stepErrors = new Map(errors.filter((error) => error.field.startsWith("steps.")).map((error) => [error.field, error.message]));
  const busy = isRunBusy(run);

  const setStep = (index: number, nextStep: DrinkWorkflowStep) => {
    setDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => (stepIndex === index ? nextStep : step)) }));
  };
  const moveStep = (index: number, direction: -1 | 1) => {
    setDraft((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      return { ...current, steps };
    });
  };
  const removeStep = (index: number) => {
    setDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index) }));
  };
  const addStep = () => {
    setDraft((current) => {
      if (current.steps.length >= MAX_DRINK_WORKFLOW_STEPS) return current;
      return { ...current, steps: [...current.steps, createDrinkWorkflowStep(addType, firstProfileId)] };
    });
  };
  const replaceStepType = (index: number, type: DrinkWorkflowStepType) => {
    setStep(index, createDrinkWorkflowStep(type, firstProfileId));
  };
  const editWorkflow = (workflow: DrinkWorkflow) => {
    setDraft(cloneWorkflow(workflow));
    setAttemptedSave(false);
  };
  const startNew = () => {
    setDraft(newWorkflow(firstProfileId));
    setAttemptedSave(false);
  };
  const save = async () => {
    setAttemptedSave(true);
    if (errors.length > 0) return;
    setSaving(true);
    try {
      await onSave(cloneWorkflow({ ...draft, name: draft.name.trim() }));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (workflow: DrinkWorkflow) => {
    if (!window.confirm(`Delete ${workflow.name}?`)) return;
    setDeleting(true);
    try {
      await onDelete(workflow.id);
      if (draft.id === workflow.id) startNew();
    } finally {
      setDeleting(false);
    }
  };
  const start = async (workflow: DrinkWorkflow) => {
    const workflowErrors = validateDrinkWorkflow(workflow, availableProfileIds);
    if (workflowErrors.length > 0) {
      editWorkflow(workflow);
      setAttemptedSave(true);
      return;
    }
    await onStart(cloneWorkflow(workflow));
  };

  return (
    <div className="drink-workflows-page">
      {run.workflow && run.phase !== "idle" && (
        <DrinkWorkflowRunCard run={run} profiles={profiles} onCancel={onCancel} />
      )}

      <div className="drink-workflows-layout">
        <section className="panel workflow-library-panel">
          <div className="section-heading-row">
            <h2>Saved Work Flows</h2>
            <button type="button" className="icon-button" aria-label="Create workflow" title="Create workflow" onClick={startNew}>
              <Plus size={18} />
            </button>
          </div>
          <div className="workflow-library-list">
            {workflows.length === 0 && <p className="muted">No saved Work Flows.</p>}
            {workflows.map((workflow) => (
              <article className={draft.id === workflow.id ? "workflow-library-item selected" : "workflow-library-item"} key={workflow.id}>
                <button type="button" className="workflow-library-main" onClick={() => editWorkflow(workflow)}>
                  <WorkflowIcon size={19} />
                  <span>
                    <strong>{workflow.name}</strong>
                    <small>{workflow.steps.map((step) => stepLabel(step.type)).join(" / ")}</small>
                  </span>
                </button>
                <div className="workflow-library-actions">
                  <button type="button" className="icon-button" aria-label={`Edit ${workflow.name}`} title={`Edit ${workflow.name}`} onClick={() => editWorkflow(workflow)}>
                    <Pencil size={17} />
                  </button>
                  <button type="button" className="icon-button" aria-label={`Delete ${workflow.name}`} title={`Delete ${workflow.name}`} disabled={busy || deleting} onClick={() => void remove(workflow)}>
                    <Trash2 size={17} />
                  </button>
                  <button type="button" className="primary-button compact-button" disabled={busy} onClick={() => void start(workflow)}>
                    <Play size={17} />
                    Start
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel workflow-builder-panel">
          <div className="section-heading-row">
            <h2>Builder</h2>
            <span className="workflow-step-count">{draft.steps.length}/{MAX_DRINK_WORKFLOW_STEPS}</span>
          </div>
          <label className="workflow-name-field">
            <span>Name</span>
            <input
              aria-invalid={attemptedSave && Boolean(nameError)}
              maxLength={60}
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          {attemptedSave && nameError && <p className="field-error">{nameError}</p>}

          <div className="workflow-builder-steps">
            {draft.steps.map((step, index) => {
              const error = stepErrors.get(`steps.${index}`);
              return (
                <fieldset className="workflow-builder-step" key={step.id}>
                  <legend>Step {index + 1}</legend>
                  <div className="workflow-step-toolbar">
                    <span className="workflow-step-type-icon">{stepIcon(step.type)}</span>
                    <label>
                      <span>Action</span>
                      <select value={step.type} onChange={(event) => replaceStepType(index, event.target.value as DrinkWorkflowStepType)}>
                        <option value="brew">Brew Profile</option>
                        <option value="hotWater">Hot Water</option>
                        <option value="steam">Steam Milk</option>
                      </select>
                    </label>
                    <div className="workflow-step-order-actions">
                      <button type="button" className="icon-button" aria-label={`Move step ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                        <ArrowUp size={17} />
                      </button>
                      <button type="button" className="icon-button" aria-label={`Move step ${index + 1} down`} title="Move down" disabled={index === draft.steps.length - 1} onClick={() => moveStep(index, 1)}>
                        <ArrowDown size={17} />
                      </button>
                      <button type="button" className="icon-button" aria-label={`Remove step ${index + 1}`} title="Remove step" disabled={draft.steps.length === 1} onClick={() => removeStep(index)}>
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>

                  {step.type === "brew" && (
                    <label>
                      <span>Profile</span>
                      <select value={step.profileId} onChange={(event) => setStep(index, { ...step, profileId: event.target.value })}>
                        <option value="">Choose profile</option>
                        {profiles.map((profile) => (
                          <option value={profile.id} key={profile.id}>
                            {profile.profile.title || profile.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {step.type === "hotWater" && (
                    <div className="workflow-step-fields">
                      <label>
                        <span>Water amount (ml)</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={MIN_HOT_WATER_VOLUME_ML}
                          max={MAX_HOT_WATER_VOLUME_ML}
                          value={step.volumeMl}
                          onChange={(event) => setStep(index, { ...step, volumeMl: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Water temperature (C)</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={MIN_HOT_WATER_TEMPERATURE_C}
                          max={MAX_HOT_WATER_TEMPERATURE_C}
                          value={step.temperatureC}
                          onChange={(event) => setStep(index, { ...step, temperatureC: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                  {step.type === "steam" && (
                    <div className="workflow-step-fields">
                      <label>
                        <span>Steam duration (seconds)</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={MIN_STEAM_DURATION_SECONDS}
                          max={MAX_STEAM_DURATION_SECONDS}
                          value={step.durationSeconds}
                          onChange={(event) => setStep(index, { ...step, durationSeconds: Number(event.target.value) })}
                        />
                      </label>
                      <label>
                        <span>Steam temperature (C)</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={MIN_STEAM_TEMPERATURE_C}
                          max={MAX_STEAM_TEMPERATURE_C}
                          value={step.temperatureC}
                          onChange={(event) => setStep(index, { ...step, temperatureC: Number(event.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                  {attemptedSave && error && <p className="field-error">{error}</p>}
                </fieldset>
              );
            })}
          </div>

          <div className="workflow-builder-add">
            <label>
              <span>Next action</span>
              <select value={addType} onChange={(event) => setAddType(event.target.value as DrinkWorkflowStepType)}>
                <option value="brew">Brew Profile</option>
                <option value="hotWater">Hot Water</option>
                <option value="steam">Steam Milk</option>
              </select>
            </label>
            <button type="button" className="ghost-button compact-button" disabled={draft.steps.length >= MAX_DRINK_WORKFLOW_STEPS} onClick={addStep}>
              <Plus size={17} />
              Add Step
            </button>
          </div>
          <div className="workflow-builder-actions">
            <button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>
              <Save size={18} />
              {saving ? "Saving" : "Save Work Flow"}
            </button>
            <button type="button" className="ghost-button" disabled={busy || errors.length > 0} onClick={() => void start(draft)}>
              <Play size={18} />
              Start
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
