import { useEffect, useMemo, useState } from "react";
import type { Grinder, ProfileRecord, ShotRecord, Workflow } from "../api/types";
import { MetricTile } from "../components/MetricTile";
import { ProfilePresetGrid } from "../components/ProfilePresetGrid";
import type { Bag } from "../lib/bags";
import { recommendProfiles } from "../lib/recommendations";
import { grindSizeFromShot, previousFiveForBag, shotContext, shotStats } from "../lib/shotStats";
import { selectedProfileIdFromWorkflow } from "../lib/workflowRouting";
import { isProfileShown, visiblePresetSlots, type SkinSettings } from "../state/skinSettings";

const DEFAULT_BREW_RATIO = 2;

function cleanNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function bagTitle(bag: Bag): string {
  return bag.name?.trim() || [bag.roaster, bag.bean].filter(Boolean).join(" ") || "Unnamed bag";
}

function formatRecipeValue(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatInputNumber(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatRatioValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return String(DEFAULT_BREW_RATIO);
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function recipeRatio(dose: number | undefined, targetYield: number | undefined): number {
  return dose && targetYield ? targetYield / dose : DEFAULT_BREW_RATIO;
}

function initialRecipe(workflow: Workflow): { dose: string; yield: string; ratio: string } {
  const contextDose = workflow.context?.targetDoseWeight;
  const contextYield = workflow.context?.targetYield ?? workflow.profile?.target_weight;
  const dose = typeof contextDose === "number" && Number.isFinite(contextDose) ? contextDose : undefined;
  const targetYield = typeof contextYield === "number" && Number.isFinite(contextYield) ? contextYield : undefined;
  const ratio = recipeRatio(dose, targetYield);
  return {
    dose: formatInputNumber(dose),
    yield: formatInputNumber(targetYield ?? (dose ? dose * ratio : undefined)),
    ratio: formatRatioValue(ratio)
  };
}

function bagGuidance(shots: ShotRecord[], bagId: string | undefined) {
  if (!bagId) return null;
  const previousShots = previousFiveForBag(shots, bagId);
  if (!previousShots.length) return null;
  const grind = previousShots.map(grindSizeFromShot).find((value): value is string => Boolean(value?.trim()));
  const doses = previousShots
    .map((shot) => shot.annotations?.actualDoseWeight ?? shotContext(shot)?.targetDoseWeight)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const yields = previousShots
    .map((shot) => shot.annotations?.actualYield ?? shotStats(shot).finalYield ?? shotContext(shot)?.targetYield)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    count: previousShots.length,
    grind,
    dose: average(doses),
    yield: average(yields)
  };
}

export function BrewPage({
  workflow,
  profiles,
  bags,
  shots,
  settings,
  onApplyProfile,
  onEditSlot,
  grinders = [],
  onUpdateRecipe,
  onSelectBag
}: {
  workflow: Workflow;
  profiles: ProfileRecord[];
  bags: Bag[];
  grinders?: Grinder[];
  shots: ShotRecord[];
  settings: SkinSettings;
  onApplyProfile: (profile: ProfileRecord) => void;
  onEditSlot: (index: number) => void;
  onUpdateRecipe?: (recipe: { dose?: number; yield?: number }) => void;
  onSelectBag?: (bagId: string) => void;
}) {
  const selectedBag = bags.find((bag) => bag.id === workflow.context?.beanBatchId);
  const selectedProfileId = selectedProfileIdFromWorkflow(workflow, profiles);
  const shownProfiles = profiles.filter((profile) => isProfileShown(settings, profile.id));
  const slots = visiblePresetSlots(settings);
  const guidance = useMemo(() => bagGuidance(shots, selectedBag?.id), [shots, selectedBag?.id]);
  const [doseText, setDoseText] = useState(() => initialRecipe(workflow).dose);
  const [yieldText, setYieldText] = useState(() => initialRecipe(workflow).yield);
  const [ratioText, setRatioText] = useState(() => initialRecipe(workflow).ratio);
  const recommendations = recommendProfiles({
    profiles: shownProfiles,
    shots,
    selectedBag,
    bags,
    preferredEy: [settings.preferredEyMin ?? 18, settings.preferredEyMax ?? 23]
  });

  useEffect(() => {
    const nextRecipe = initialRecipe(workflow);
    setDoseText(nextRecipe.dose);
    setYieldText(nextRecipe.yield);
    setRatioText(nextRecipe.ratio);
  }, [workflow.context?.targetDoseWeight, workflow.context?.targetYield, workflow.profile?.target_weight]);

  const updateDose = (value: string) => {
    setDoseText(value);
    const dose = cleanNumber(value);
    const ratio = cleanNumber(ratioText);
    if (dose !== undefined && ratio !== undefined) setYieldText(formatInputNumber(dose * ratio));
  };

  const updateRatio = (value: string) => {
    setRatioText(value);
    const dose = cleanNumber(doseText);
    const ratio = cleanNumber(value);
    if (dose !== undefined && ratio !== undefined) setYieldText(formatInputNumber(dose * ratio));
  };

  const updateYield = (value: string) => {
    setYieldText(value);
    const dose = cleanNumber(doseText);
    const targetYield = cleanNumber(value);
    if (dose && targetYield !== undefined) setRatioText(formatRatioValue(targetYield / dose));
  };

  return (
    <div className="workflow-grid">
      <section className="panel wide">
        <h2>Presets</h2>
        <ProfilePresetGrid
          slots={slots}
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          onApply={onApplyProfile}
          onEditSlot={onEditSlot}
        />
      </section>
      <section className="panel">
        <h2>Current Bag</h2>
        <label className="settings-field compact-field">
          Current bag
          <select value={selectedBag?.id ?? ""} onChange={(event) => onSelectBag?.(event.target.value)}>
            <option value="">No bag selected</option>
            {bags.map((bag) => (
              <option key={bag.id} value={bag.id}>
                {bagTitle(bag)}
              </option>
            ))}
          </select>
        </label>
        {selectedBag ? <p>{[selectedBag.roaster, selectedBag.bean, selectedBag.process].filter(Boolean).join(" · ")}</p> : <p>No bag selected</p>}
        <div className="bag-guidance">
          {guidance ? (
            <>
              <strong>Based on previous {guidance.count} shot{guidance.count === 1 ? "" : "s"}</strong>
              <span>Suggested grind: {guidance.grind ?? "—"}</span>
              <span>
                Suggested recipe: {formatRecipeValue(guidance.dose)}g in / {formatRecipeValue(guidance.yield)}g out
              </span>
            </>
          ) : (
            <span>No bag history yet.</span>
          )}
        </div>
      </section>
      <section className="panel">
        <div className="recipe-card-header">
          <h2>Recipe</h2>
          <label className="ratio-field">
            <span>Ratio</span>
            <span className="ratio-input-row">
              <strong aria-hidden="true">1:</strong>
              <input aria-label="Ratio" type="number" min={0.1} step={0.1} inputMode="decimal" value={ratioText} onChange={(event) => updateRatio(event.target.value)} />
            </span>
          </label>
        </div>
        <div className="recipe-edit-grid">
          <label>
            <span>Dose</span>
            <input aria-label="Dose" inputMode="decimal" value={doseText} onChange={(event) => updateDose(event.target.value)} />
          </label>
          <label>
            <span>Yield</span>
            <input aria-label="Yield" inputMode="decimal" value={yieldText} onChange={(event) => updateYield(event.target.value)} />
          </label>
        </div>
        {grinders.length > 0 && <MetricTile label="Grinders" value={`${grinders.length} configured`} />}
        <button type="button" className="ghost-button recipe-save-button" onClick={() => onUpdateRecipe?.({ dose: cleanNumber(doseText), yield: cleanNumber(yieldText) })}>
          Save recipe
        </button>
      </section>
      <section className="panel wide">
        <h2>Recommended Profiles</h2>
        {recommendations.slice(0, 4).map((item) => {
          const selected = selectedProfileId === item.profile.id;
          return (
            <button
              key={item.profile.id}
              type="button"
              className={selected ? "recommendation-row selected" : "recommendation-row"}
              aria-current={selected ? "true" : undefined}
              onClick={() => onApplyProfile(item.profile)}
            >
              <strong>{item.profile.profile.title ?? item.profile.id}</strong>
              <span>{item.reasons.join(" · ")}</span>
            </button>
          );
        })}
      </section>
    </div>
  );
}
