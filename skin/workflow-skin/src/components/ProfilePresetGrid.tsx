import { Pencil } from "lucide-react";
import type { ProfileRecord } from "../api/types";
import type { DrinkWorkflow } from "../lib/drinkWorkflows";
import type { PresetSlot } from "../state/skinSettings";

function profileTitle(profile: ProfileRecord | undefined): string {
  return profile?.profile.title?.trim() || "Choose profile";
}

export function ProfilePresetGrid({
  slots,
  profiles,
  drinkWorkflows = [],
  selectedProfileId,
  selectedDrinkWorkflowId,
  onApply,
  onSelectDrinkWorkflow = () => undefined,
  onEditSlot
}: {
  slots: PresetSlot[];
  profiles: ProfileRecord[];
  drinkWorkflows?: DrinkWorkflow[];
  selectedProfileId?: string;
  selectedDrinkWorkflowId?: string;
  onApply: (profile: ProfileRecord) => void;
  onSelectDrinkWorkflow?: (workflow: DrinkWorkflow) => void;
  onEditSlot: (index: number) => void;
}) {
  return (
    <div className="preset-grid">
      {slots.map((slot, index) => {
        const profile = profiles.find((item) => item.id === slot.profileId);
        const drinkWorkflow = drinkWorkflows.find((item) => item.id === slot.drinkWorkflowId);
        const title = drinkWorkflow?.name ?? profileTitle(profile);
        const isSelected = drinkWorkflow
          ? selectedDrinkWorkflowId === drinkWorkflow.id
          : Boolean(profile && selectedProfileId && slot.profileId === selectedProfileId && !selectedDrinkWorkflowId);
        const enabled = Boolean(profile || drinkWorkflow);
        return (
          <div className={["preset-button", drinkWorkflow ? "workflow-preset" : "", isSelected ? "selected" : ""].filter(Boolean).join(" ")} key={`${slot.label}-${index}`}>
            <button
              type="button"
              aria-label={`${slot.label} ${title}`}
              aria-current={isSelected ? "true" : undefined}
              disabled={!enabled}
              onClick={() => {
                if (drinkWorkflow) onSelectDrinkWorkflow(drinkWorkflow);
                else if (profile) onApply(profile);
              }}
            >
              <span>{slot.label}</span>
              <strong>{title}</strong>
              {drinkWorkflow && <small>Work Flow</small>}
            </button>
            <button type="button" className="icon-button" aria-label={`Edit ${slot.label}`} onClick={() => onEditSlot(index)}>
              <Pencil size={18} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
