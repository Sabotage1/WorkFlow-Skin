import { Star } from "lucide-react";
import { useState } from "react";
import type { BurrType, Grinder } from "../api/types";

interface GrinderDraft {
  id?: string;
  model: string;
  burrType: "" | BurrType;
  burrs: string;
  settingType: "numeric" | "preset";
  notes: string;
}

const emptyGrinder: GrinderDraft = { model: "", burrType: "", burrs: "", settingType: "numeric", notes: "" };

function isBurrType(value: unknown): value is BurrType {
  return value === "flat" || value === "conical";
}

function burrTypeLabel(value: unknown): string | undefined {
  if (value === "flat") return "Flat burrs";
  if (value === "conical") return "Conical burrs";
  return undefined;
}

function grinderDraftFrom(grinder: Grinder): GrinderDraft {
  return {
    id: grinder.id,
    model: grinder.model,
    burrType: isBurrType(grinder.burrType) ? grinder.burrType : "",
    burrs: grinder.burrs ?? "",
    settingType: grinder.settingType ?? "numeric",
    notes: grinder.notes ?? ""
  };
}

function grinderPayload(draft: GrinderDraft) {
  if (!isBurrType(draft.burrType)) throw new Error("Burrs Type is required.");
  return {
    model: draft.model.trim(),
    burrType: draft.burrType,
    burrs: draft.burrs.trim() || undefined,
    settingType: draft.settingType,
    notes: draft.notes.trim() || undefined
  };
}

export function GrindersPage({
  grinders,
  defaultGrinderId,
  onSetDefaultGrinder,
  onCreateGrinder,
  onUpdateGrinder,
  onArchiveGrinder
}: {
  grinders: Grinder[];
  defaultGrinderId?: string;
  onSetDefaultGrinder?: (grinderId: string) => Promise<void> | void;
  onCreateGrinder: (payload: ReturnType<typeof grinderPayload>) => Promise<void> | void;
  onUpdateGrinder: (id: string, payload: ReturnType<typeof grinderPayload>) => Promise<void> | void;
  onArchiveGrinder: (grinder: Grinder) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<GrinderDraft>(emptyGrinder);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const saveGrinder = async () => {
    if (!draft.model.trim()) {
      setStatus({ type: "error", message: "Grinder model is required." });
      return;
    }
    if (!isBurrType(draft.burrType)) {
      setStatus({ type: "error", message: "Burrs Type is required." });
      return;
    }

    try {
      const payload = grinderPayload(draft);
      if (draft.id) {
        await onUpdateGrinder(draft.id, payload);
      } else {
        await onCreateGrinder(payload);
      }
      setDraft(emptyGrinder);
      setStatus({ type: "success", message: draft.id ? "Grinder updated" : "Grinder saved" });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const archiveGrinder = async (grinder: Grinder) => {
    try {
      await onArchiveGrinder(grinder);
      setStatus({ type: "success", message: "Grinder archived" });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <div className="workflow-grid">
      <section className="panel">
        <h2>Configured Grinders</h2>
        {grinders.length === 0 && <p className="muted">No grinders configured.</p>}
        {grinders.map((grinder) => (
          <div className="list-row" key={grinder.id}>
            <strong>{grinder.model}</strong>
            <span>{[burrTypeLabel(grinder.burrType), grinder.burrs, grinder.settingType, grinder.notes].filter(Boolean).join(" · ")}</span>
            <div className="row-actions">
              <button
                type="button"
                className={defaultGrinderId === grinder.id ? "ghost-button compact-button grinder-star active" : "ghost-button compact-button grinder-star"}
                aria-pressed={defaultGrinderId === grinder.id}
                aria-label={defaultGrinderId === grinder.id ? `${grinder.model} is default grinder` : `Make ${grinder.model} default grinder`}
                onClick={() => void onSetDefaultGrinder?.(grinder.id)}
              >
                <Star size={16} fill={defaultGrinderId === grinder.id ? "currentColor" : "none"} />
                Default
              </button>
              <button type="button" className="ghost-button compact-button" onClick={() => setDraft(grinderDraftFrom(grinder))}>
                Edit {grinder.model}
              </button>
              <button type="button" className="ghost-button compact-button" onClick={() => void archiveGrinder(grinder)}>
                Archive
              </button>
            </div>
          </div>
        ))}
      </section>
      <section className="panel">
        <h2>{draft.id ? "Edit Grinder" : "Add Grinder"}</h2>
        <form
          className="profile-edit-form"
          aria-label={draft.id ? "Edit grinder" : "Add grinder"}
          onSubmit={(event) => {
            event.preventDefault();
            void saveGrinder();
          }}
        >
          <label>
            <span>Grinder model</span>
            <input aria-label="Grinder model" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </label>
          <label>
            <span>Burrs Type</span>
            <select aria-label="Burrs Type" value={draft.burrType} onChange={(event) => setDraft({ ...draft, burrType: event.target.value as GrinderDraft["burrType"] })}>
              <option value="">Choose Type</option>
              <option value="flat">Flat</option>
              <option value="conical">Conical</option>
            </select>
          </label>
          <label>
            <span>Burrs</span>
            <input aria-label="Burrs" value={draft.burrs} onChange={(event) => setDraft({ ...draft, burrs: event.target.value })} />
          </label>
          <label>
            <span>Setting type</span>
            <select
              aria-label="Setting type"
              value={draft.settingType}
              onChange={(event) => setDraft({ ...draft, settingType: event.target.value as GrinderDraft["settingType"] })}
            >
              <option value="numeric">Numeric</option>
              <option value="preset">Preset</option>
            </select>
          </label>
          <label>
            <span>Grinder notes</span>
            <input aria-label="Grinder notes" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </label>
          <div className="row-actions">
            <button type="submit" className="primary-button">
              Save grinder
            </button>
            <button type="button" className="ghost-button" onClick={() => setDraft(emptyGrinder)}>
              Add new grinder
            </button>
          </div>
        </form>
        {status && (
          <p className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
            {status.message}
          </p>
        )}
      </section>
    </div>
  );
}
