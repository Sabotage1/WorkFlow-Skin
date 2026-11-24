import { useState } from "react";
import { Atom65DoseEditor, type Atom65DoseIntegration } from "../components/Atom65DoseEditor";
import { ProfileEditor } from "../components/ProfileEditor";
import type { Profile, ProfileRecord } from "../api/types";
import { DEFAULT_STEAM_TIMERS, isProfileShown, profileWorkflowFor, type ProfileWorkflowSettings, type SkinSettings, type SteamTimers } from "../state/skinSettings";

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

export function ProfilesPage({
  profiles,
  settings,
  onToggleReview,
  onSetStartupProfile,
  onSetProfileShown,
  onUpdateProfileWorkflow,
  onSaveProfile,
  onCreateProfile,
  onLoadProfileVersions,
  grinderDose
}: {
  profiles: ProfileRecord[];
  settings: SkinSettings;
  onToggleReview: (profileId: string, enabled: boolean) => void;
  onSetStartupProfile: (profileId?: string) => void;
  onSetProfileShown: (profileId: string, shown: boolean) => void;
  onUpdateProfileWorkflow: (profileId: string, workflow: ProfileWorkflowSettings) => void;
  onSaveProfile: (profileId: string, profile: Profile) => Promise<void> | void;
  onCreateProfile?: (profile: Profile, parentId?: string) => Promise<void> | void;
  onLoadProfileVersions?: (profileId: string) => Promise<ProfileRecord[]>;
  grinderDose?: Atom65DoseIntegration;
}) {
  const [grinderProfileId, setGrinderProfileId] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ record: ProfileRecord | null } | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "pressure" | "flow">("all");
  const filteredProfiles = profiles.filter((profile) => {
    const matchesSearch = !search.trim() || profileSearchText(profile).includes(search.trim().toLowerCase());
    const matchesType = typeFilter === "all" || profileType(profile) === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="panel wide">
      <div className="recipe-library-header">
        <h2>Profiles</h2>
        {onCreateProfile && <button type="button" className="primary-button" onClick={() => setEditor({ record: null })}>New Profile</button>}
      </div>
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
              {grinderDose && <button type="button" className="ghost-button compact-button" aria-label={`${title} grinder dose`} aria-expanded={grinderProfileId === profile.id} onClick={() => setGrinderProfileId((current) => current === profile.id ? null : profile.id)}>Grinder dose</button>}
              <button
                type="button"
                className="ghost-button compact-button"
                aria-label={`Edit ${title}`}
                onClick={() => setEditor({ record: profile })}
              >
                Edit
              </button>
            </div>
            {grinderDose && grinderProfileId === profile.id && <Atom65DoseEditor key={profile.id} profile={profile.profile} integration={grinderDose} />}
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
          </div>
        );
      })}
      {editor && <ProfileEditor
        record={editor.record}
        onClose={() => setEditor(null)}
        onSave={onSaveProfile}
        onCreate={onCreateProfile}
        onLoadVersions={onLoadProfileVersions}
      />}
    </div>
  );
}
