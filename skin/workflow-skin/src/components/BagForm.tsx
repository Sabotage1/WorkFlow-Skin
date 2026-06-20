import type { Bag } from "../lib/bags";

const fields: Array<{ key: keyof Bag; label: string; type?: string; mandatory?: boolean }> = [
  { key: "roaster", label: "Roaster", mandatory: true },
  { key: "name", label: "Bag Name" },
  { key: "bean", label: "Bean", mandatory: true },
  { key: "country", label: "Country", mandatory: true },
  { key: "region", label: "Region" },
  { key: "process", label: "Process", mandatory: true },
  { key: "roastDate", label: "Roast Date", type: "date", mandatory: true },
  { key: "roastLevel", label: "Roast Level" }
];

export function BagForm({
  value,
  onChange,
  onCancel,
  onSave,
  mode = "create"
}: {
  value: Bag;
  onChange: (value: Bag) => void;
  onCancel: () => void;
  onSave: () => void;
  mode?: "create" | "edit";
}) {
  const editing = mode === "edit";
  return (
    <form
      aria-label={editing ? "Edit a bag" : "Create a bag"}
      className="bag-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="form-header">
        <div>
          <span className="eyebrow">{editing ? "Bean Library" : "New Bean"}</span>
          <h2>{editing ? "Edit a bag" : "Create a bag"}</h2>
        </div>
        <div className="form-actions">
          <button type="button" className="ghost-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button">
            Save
          </button>
        </div>
      </div>
      <p className="mandatory-help">Mandatory for bag suggestions: roaster, bean, country, process, and roast date.</p>
      <div className="form-grid">
        {fields.map((field) => (
          <label key={field.key} className={field.mandatory ? "mandatory-field" : undefined}>
            <span>{field.mandatory ? `${field.label} *` : field.label}</span>
            <input
              aria-label={field.label}
              type={field.type ?? "text"}
              value={(value[field.key] as string | undefined) ?? ""}
              onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="notes-field">
        <span>Notes</span>
        <textarea value={value.notes ?? ""} onChange={(event) => onChange({ ...value, notes: event.target.value })} />
      </label>
    </form>
  );
}
