import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { BagForm } from "../components/BagForm";
import { filterBags, isValidBag, type Bag, type BagFilters } from "../lib/bags";

const emptyBag: Bag = {
  id: "draft",
  beanId: "draft",
  name: "",
  roaster: "",
  bean: "",
  country: "",
  region: "",
  process: "",
  roastDate: "",
  roastLevel: "",
  notes: ""
};

function bagTitle(bag: Bag): string {
  return bag.name?.trim() || [bag.roaster, bag.bean].filter(Boolean).join(" ") || "Unnamed bag";
}

export function BagsPage({
  bags,
  onSaveBag,
  onUpdateBag,
  onArchiveBag
}: {
  bags: Bag[];
  onSaveBag: (bag: Bag) => Promise<void> | void;
  onUpdateBag?: (bag: Bag) => Promise<void> | void;
  onArchiveBag?: (bag: Bag) => Promise<void> | void;
}) {
  const [filters, setFilters] = useState<BagFilters>({});
  const [draft, setDraft] = useState<Bag>(emptyBag);
  const [editingBagId, setEditingBagId] = useState<string | null>(null);
  const [showBagForm, setShowBagForm] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const visibleBags = useMemo(() => filterBags(bags, filters), [bags, filters]);
  const editingBag = editingBagId ? bags.find((bag) => bag.id === editingBagId) : undefined;
  const formOpen = showBagForm || Boolean(editingBag);

  const openCreateForm = () => {
    setDraft(emptyBag);
    setEditingBagId(null);
    setShowBagForm(true);
    setStatus(null);
  };

  const saveDraft = async () => {
    if (!isValidBag(draft)) {
      setStatus({ type: "error", message: "to consider this a bag for suggestions and future features fill all mandatory fields" });
      return;
    }

    try {
      if (editingBag && onUpdateBag) {
        await onUpdateBag(draft);
      } else {
        await onSaveBag(draft);
      }
      setDraft(emptyBag);
      setEditingBagId(null);
      setShowBagForm(false);
      setStatus({ type: "success", message: editingBag ? "Bag updated" : "Bag saved" });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const archiveBag = async (bag: Bag) => {
    if (!onArchiveBag) return;
    try {
      await onArchiveBag(bag);
      setStatus({ type: "success", message: "Bag archived" });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  return (
    <>
      <div className="page-title-row">
        <h1>Bags</h1>
        <button type="button" className="primary-button compact-button" onClick={openCreateForm}>
          <Plus aria-hidden="true" size={16} />
          Add Bag
        </button>
      </div>
      <div className="workflow-grid">
        {formOpen && (
          <section className="wide">
            <BagForm
              value={draft}
              onChange={setDraft}
              mode={editingBag ? "edit" : "create"}
              onCancel={() => {
                setDraft(emptyBag);
                setEditingBagId(null);
                setShowBagForm(false);
                setStatus(null);
              }}
              onSave={saveDraft}
            />
          </section>
        )}
        {status && (
          <section className="wide">
            <p className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
              {status.message}
            </p>
          </section>
        )}
      <section className="panel wide">
        <h2>Bag Filters</h2>
        <div className="form-grid">
          <label>
            Roaster
            <input value={filters.roaster ?? ""} onChange={(event) => setFilters({ ...filters, roaster: event.target.value })} />
          </label>
          <label>
            Bag Name
            <input value={filters.name ?? ""} onChange={(event) => setFilters({ ...filters, name: event.target.value })} />
          </label>
          <label>
            Bean
            <input value={filters.bean ?? ""} onChange={(event) => setFilters({ ...filters, bean: event.target.value })} />
          </label>
          <label>
            Country
            <input value={filters.country ?? ""} onChange={(event) => setFilters({ ...filters, country: event.target.value })} />
          </label>
          <label>
            Process
            <input value={filters.process ?? ""} onChange={(event) => setFilters({ ...filters, process: event.target.value })} />
          </label>
          <label>
            Roast Level
            <input value={filters.roastLevel ?? ""} onChange={(event) => setFilters({ ...filters, roastLevel: event.target.value })} />
          </label>
        </div>
      </section>
      <section className="panel">
        <h2>History</h2>
        {visibleBags.map((bag) => (
          <div className="list-row" key={bag.id}>
            <strong>{bagTitle(bag)}</strong>
            <span>{[bag.country, bag.process, bag.roastLevel].filter(Boolean).join(" · ")}</span>
            <div className="row-actions">
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => {
                  setDraft(bag);
                  setEditingBagId(bag.id);
                  setShowBagForm(true);
                  setStatus(null);
                }}
              >
                Edit {bagTitle(bag)}
              </button>
              {onArchiveBag && (
                <button type="button" className="ghost-button compact-button" onClick={() => void archiveBag(bag)}>
                  Archive
                </button>
              )}
            </div>
          </div>
        ))}
      </section>
      </div>
    </>
  );
}
