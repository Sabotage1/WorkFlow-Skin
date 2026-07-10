import { Coffee, Droplets, Flame, Square } from "lucide-react";
import type { ProfileRecord } from "../api/types";
import type { DrinkWorkflowRunState, DrinkWorkflowStepType } from "../lib/drinkWorkflows";

function stepIcon(type: DrinkWorkflowStepType) {
  if (type === "brew") return <Coffee size={18} />;
  if (type === "hotWater") return <Droplets size={18} />;
  return <Flame size={18} />;
}

function stepLabel(type: DrinkWorkflowStepType): string {
  if (type === "brew") return "Brew Profile";
  if (type === "hotWater") return "Hot Water";
  return "Steam Milk";
}

function stepSummary(run: DrinkWorkflowRunState, index: number, profiles: ProfileRecord[]): string {
  const step = run.workflow?.steps[index];
  if (!step) return "";
  if (step.type === "brew") {
    return profiles.find((profile) => profile.id === step.profileId)?.profile.title?.trim() || step.profileTitle?.trim() || "Missing profile";
  }
  if (step.type === "hotWater") return `${step.volumeMl} ml at ${step.temperatureC} C`;
  return `${step.durationSeconds}s at ${step.temperatureC} C`;
}

function phaseLabel(run: DrinkWorkflowRunState): string {
  if (run.phase === "preparing") return "Preparing";
  if (run.phase === "starting") return "Starting";
  if (run.phase === "running") return "Running";
  if (run.phase === "between") return "Taring scale";
  if (run.phase === "completed") return "Complete";
  if (run.phase === "canceled") return "Canceled";
  if (run.phase === "error") return "Stopped";
  return "Ready";
}

function isBusy(run: DrinkWorkflowRunState): boolean {
  return run.phase === "preparing" || run.phase === "starting" || run.phase === "running" || run.phase === "between";
}

export function DrinkWorkflowRunCard({
  run,
  profiles,
  onCancel
}: {
  run: DrinkWorkflowRunState;
  profiles: ProfileRecord[];
  onCancel: () => Promise<void> | void;
}) {
  if (!run.workflow || run.phase === "idle") return null;
  const busy = isBusy(run);

  return (
    <section className={`panel wide workflow-run-panel ${run.phase}`} aria-live="polite" aria-label="Work Flow run">
      <div className="workflow-run-heading">
        <div>
          <span className="eyebrow">{phaseLabel(run)}</span>
          <h2>{run.workflow.name}</h2>
        </div>
        {busy && (
          <button type="button" className="danger-button compact-button" onClick={() => void onCancel()}>
            <Square size={17} />
            Stop
          </button>
        )}
      </div>
      <ol className="workflow-run-steps">
        {run.workflow.steps.map((step, index) => {
          const state = index < run.currentStepIndex ? "complete" : index === run.currentStepIndex ? "active" : "pending";
          return (
            <li className={state} key={step.id}>
              <span className="workflow-step-number">{index + 1}</span>
              <span className="workflow-step-icon">{stepIcon(step.type)}</span>
              <span>
                <strong>{stepLabel(step.type)}</strong>
                <small>{stepSummary(run, index, profiles)}</small>
              </span>
            </li>
          );
        })}
      </ol>
      {run.message && <p className={run.phase === "error" ? "status-message error" : "status-message"}>{run.message}</p>}
    </section>
  );
}
