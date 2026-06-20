import { Pencil } from "lucide-react";
import type { ProfileRecord } from "../api/types";
import type { PresetSlot } from "../state/skinSettings";

function profileTitle(profile: ProfileRecord | undefined): string {
  return profile?.profile.title?.trim() || "Choose profile";
}

export function ProfilePresetGrid({
  slots,
  profiles,
  selectedProfileId,
  onApply,
  onEditSlot
}: {
  slots: PresetSlot[];
  profiles: ProfileRecord[];
  selectedProfileId?: string;
  onApply: (profile: ProfileRecord) => void;
  onEditSlot: (index: number) => void;
}) {
  return (
    <div className="preset-grid">
      {slots.map((slot, index) => {
        const profile = profiles.find((item) => item.id === slot.profileId);
        const isSelected = Boolean(profile && selectedProfileId && slot.profileId === selectedProfileId);
        return (
          <div className={isSelected ? "preset-button selected" : "preset-button"} key={`${slot.label}-${index}`}>
            <button
              type="button"
              aria-label={`${slot.label} ${profileTitle(profile)}`}
              aria-current={isSelected ? "true" : undefined}
              disabled={!profile}
              onClick={() => profile && onApply(profile)}
            >
              <span>{slot.label}</span>
              <strong>{profileTitle(profile)}</strong>
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
