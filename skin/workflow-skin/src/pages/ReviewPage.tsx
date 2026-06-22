import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Share2 } from "lucide-react";
import type { Grinder, SensorListItem, ShotAnnotations, ShotRecord } from "../api/types";
import { ShotGraph } from "../components/ShotGraph";
import { calculateEy, cleanNumber } from "../lib/ey";
import { tasteScoreLabel, tasteTone, tasteToneStyles } from "../lib/shotTaste";
import { grindSizeFromShot, previousFiveForBag, shotContext, shotStats } from "../lib/shotStats";
import { DEFAULT_R2_MEASURE_DELAY_SECONDS } from "../state/skinSettings";

function formatStat(value: number | null, unit: string): string {
  return value == null ? "—" : `${value}${unit}`;
}

function formatDecimalStat(value: number | null, unit: string, digits: number): string {
  return value == null ? "—" : `${value.toFixed(digits)}${unit}`;
}

function averageNumbers(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numbers.length === 0) return null;
  return Math.round((numbers.reduce((sum, value) => sum + value, 0) / numbers.length) * 100) / 100;
}

function shotTimestampLabel(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return date.toISOString().slice(0, 16).replace("T", " ");
}

function workflowSkinExtras(annotations: ShotAnnotations | undefined): Record<string, unknown> {
  const value = annotations?.extras?.workflowSkin;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function shotProfileTitle(shot: ShotRecord): string {
  return typeof shot.workflow?.profile?.title === "string" ? shot.workflow.profile.title.trim() : "";
}

function measurementSpanSeconds(measurements: ShotRecord["measurements"]): number {
  const timestamps = (measurements ?? [])
    .map((sample) => sample.machine?.timestamp ?? sample.scale?.timestamp)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  if (timestamps.length < 2) return 0;
  return Math.max(0, (timestamps[timestamps.length - 1] - timestamps[0]) / 1000);
}

function preferShotForGraph(existing: ShotRecord | undefined, candidate: ShotRecord): ShotRecord {
  if (!existing) return candidate;

  const existingMeasurements = existing.measurements ?? [];
  const candidateMeasurements = candidate.measurements ?? [];
  if (candidateMeasurements.length === 0 && existingMeasurements.length > 0) {
    return {
      ...candidate,
      annotations: { ...candidate.annotations, ...existing.annotations },
      measurements: existingMeasurements
    };
  }

  const candidateIsMoreComplete =
    measurementSpanSeconds(candidateMeasurements) > measurementSpanSeconds(existingMeasurements) ||
    candidateMeasurements.length > existingMeasurements.length;
  const primary = candidateIsMoreComplete ? candidate : existing;
  const secondary = candidateIsMoreComplete ? existing : candidate;

  return {
    ...secondary,
    ...primary,
    annotations: candidateIsMoreComplete
      ? { ...existing.annotations, ...candidate.annotations }
      : { ...candidate.annotations, ...existing.annotations },
    measurements: primary.measurements
  };
}

export function ReviewPage({
  shot,
  previousShots,
  onSaveAnnotations,
  onUploadVisualizer,
  r2Sensor,
  r2Available = Boolean(r2Sensor),
  onReadR2,
  autoReadR2 = false,
  autoReadR2DelaySeconds = DEFAULT_R2_MEASURE_DELAY_SECONDS,
  grinders = [],
  defaultGrinderId,
  onLoadShot,
  onRecommendShot
}: {
  shot: ShotRecord;
  previousShots: ShotRecord[];
  onSaveAnnotations: (shotId: string, annotations: ShotAnnotations) => Promise<void> | void;
  onUploadVisualizer: () => Promise<void> | void;
  r2Sensor: SensorListItem | null;
  r2Available?: boolean;
  onReadR2: () => Promise<number | null> | number | null;
  autoReadR2?: boolean;
  autoReadR2DelaySeconds?: number;
  grinders?: Grinder[];
  defaultGrinderId?: string;
  onLoadShot?: (shotId: string) => Promise<ShotRecord | null> | ShotRecord | null;
  onRecommendShot?: (shot: ShotRecord) => Promise<void> | void;
  onBackToGraph?: () => void;
}) {
  const stats = shotStats(shot);
  const context = shotContext(shot);
  const grinderById = useMemo(() => new Map(grinders.map((grinder) => [grinder.id, grinder])), [grinders]);
  const orderedGrinders = useMemo(() => {
    const defaultGrinder = defaultGrinderId ? grinderById.get(defaultGrinderId) : undefined;
    return defaultGrinder ? [defaultGrinder, ...grinders.filter((grinder) => grinder.id !== defaultGrinder.id)] : grinders;
  }, [defaultGrinderId, grinderById, grinders]);
  const savedWorkflowSkin = workflowSkinExtras(shot.annotations);
  const initialGrinderId =
    (typeof savedWorkflowSkin.grinderId === "string" ? savedWorkflowSkin.grinderId : undefined) ??
    context?.grinderId ??
    (defaultGrinderId && grinderById.has(defaultGrinderId) ? defaultGrinderId : undefined) ??
    "";
  const [selectedShotId, setSelectedShotId] = useState(shot.id);
  const [tdsText, setTdsText] = useState(String(shot.annotations?.drinkTds ?? ""));
  const [doseText, setDoseText] = useState(String(shot.annotations?.actualDoseWeight ?? context?.targetDoseWeight ?? ""));
  const [yieldText, setYieldText] = useState(String(shot.annotations?.actualYield ?? stats.finalYield ?? ""));
  const [grindSize, setGrindSize] = useState(grindSizeFromShot(shot) ?? "");
  const [selectedGrinderId, setSelectedGrinderId] = useState(initialGrinderId);
  const [tasteRating, setTasteRating] = useState(shot.annotations?.enjoyment ?? 7);
  const [notes, setNotes] = useState(shot.annotations?.espressoNotes ?? "");
  const [r2Busy, setR2Busy] = useState(false);
  const [r2Status, setR2Status] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [loadedShotsById, setLoadedShotsById] = useState<Record<string, ShotRecord>>({});
  const [loadingGraphShotIds, setLoadingGraphShotIds] = useState<Record<string, boolean>>({});
  const [failedGraphShotIds, setFailedGraphShotIds] = useState<Record<string, boolean>>({});
  const autoReadShotRef = useRef<string | null>(null);
  const readR2Ref = useRef<((options?: { allowUnavailable?: boolean }) => Promise<void>) | null>(null);
  const requestedShotIdsRef = useRef<Set<string>>(new Set());

  const ey = useMemo(
    () =>
      calculateEy({
        doseGrams: cleanNumber(doseText),
        yieldGrams: cleanNumber(yieldText),
        tdsPercent: cleanNumber(tdsText)
      }),
    [doseText, yieldText, tdsText]
  );

  const sameBagShots = context?.beanBatchId ? previousFiveForBag(previousShots, context.beanBatchId, shot.id) : [];
  const reviewShots = [shot, ...sameBagShots].map((item) => loadedShotsById[item.id] ?? item);
  const selectedShotIndex = Math.max(0, reviewShots.findIndex((item) => item.id === selectedShotId));
  const selectedShot = reviewShots[selectedShotIndex] ?? shot;
  const selectedShotIsLatest = selectedShot.id === shot.id;
  const selectedStats = shotStats(selectedShot);
  const selectedContext = selectedShotIsLatest ? context : shotContext(selectedShot);
  const selectedDose = selectedShotIsLatest ? cleanNumber(doseText) : selectedShot.annotations?.actualDoseWeight ?? selectedContext?.targetDoseWeight ?? null;
  const selectedYield = selectedShotIsLatest ? cleanNumber(yieldText) ?? selectedStats.finalYield : selectedStats.finalYield;
  const selectedTds = selectedShotIsLatest ? cleanNumber(tdsText) : selectedShot.annotations?.drinkTds ?? null;
  const selectedEy = selectedShotIsLatest ? ey : selectedShot.annotations?.drinkEy ?? null;
  const selectedGrindSize = selectedShotIsLatest ? grindSize : grindSizeFromShot(selectedShot) ?? "";
  const selectedShotLabel = selectedShotIsLatest ? "Latest shot" : shotTimestampLabel(selectedShot.timestamp);
  const selectedProfileTitle = shotProfileTitle(selectedShot);
  const selectedTasteTone = tasteTone(tasteRating);
  const selectedTasteToneStyle = tasteToneStyles[selectedTasteTone];
  const tasteFillPercent = ((tasteRating - 1) / 9) * 100;
  const tasteScore = tasteScoreLabel(tasteRating);
  const tasteStyle = {
    "--taste-color": selectedTasteToneStyle.color,
    "--taste-glow": selectedTasteToneStyle.glow,
    "--taste-rest": selectedTasteToneStyle.rest,
    "--taste-fill": `${tasteFillPercent}%`
  } as CSSProperties;
  const sameBagReviewShots = reviewShots.slice(1);
  const sameBagStats = sameBagReviewShots.map((item) => ({ shot: item, stats: shotStats(item), grindSize: grindSizeFromShot(item) }));
  const sameBagGrinds = sameBagStats.map((item) => item.grindSize).filter((value): value is string => Boolean(value));
  const sameBagAverages = {
    duration: averageNumbers(sameBagStats.map((item) => item.stats.durationSeconds)),
    yield: averageNumbers(sameBagStats.map((item) => item.stats.finalYield)),
    tds: averageNumbers(sameBagReviewShots.map((item) => item.annotations?.drinkTds)),
    ey: averageNumbers(sameBagReviewShots.map((item) => item.annotations?.drinkEy))
  };
  const selectedShotHasGraph = (selectedShot.measurements?.length ?? 0) > 0;
  const selectedGraphLoading =
    Boolean(loadingGraphShotIds[selectedShot.id]) ||
    Boolean(onLoadShot && selectedShot.id && !selectedShotHasGraph && !failedGraphShotIds[selectedShot.id]);
  const sourceShotsById = useMemo(() => new Map([shot, ...previousShots].map((item) => [item.id, item])), [previousShots, shot]);

  const loadShotGraph = useCallback(
    async (shotId: string, options: { force?: boolean; background?: boolean } = {}) => {
      if (!onLoadShot || !shotId) return null;
      if (!options.force && requestedShotIdsRef.current.has(shotId)) return null;

      requestedShotIdsRef.current.add(shotId);
      if (!options.background) setLoadingGraphShotIds((current) => ({ ...current, [shotId]: true }));
      setFailedGraphShotIds((current) => {
        if (!current[shotId]) return current;
        const next = { ...current };
        delete next[shotId];
        return next;
      });

      try {
        const fullShot = await Promise.resolve(onLoadShot(shotId));
        if (fullShot) {
          const fallbackShot = sourceShotsById.get(fullShot.id);
          const preferredShot = preferShotForGraph(fallbackShot, fullShot);
          setLoadedShotsById((current) => ({
            ...current,
            [fullShot.id]: preferShotForGraph(current[fullShot.id] ?? fallbackShot, fullShot)
          }));
          if ((preferredShot.measurements?.length ?? 0) === 0) {
            setFailedGraphShotIds((current) => ({ ...current, [shotId]: true }));
          }
          return preferredShot;
        }

        setFailedGraphShotIds((current) => ({ ...current, [shotId]: true }));
        return null;
      } catch {
        setFailedGraphShotIds((current) => ({ ...current, [shotId]: true }));
        return null;
      } finally {
        if (!options.background) setLoadingGraphShotIds((current) => ({ ...current, [shotId]: false }));
      }
    },
    [onLoadShot, sourceShotsById]
  );

  function reviewAnnotations(): ShotAnnotations {
    const workflowSkin = workflowSkinExtras(shot.annotations);
    const selectedGrinder = selectedGrinderId ? grinderById.get(selectedGrinderId) : undefined;
    const grinderExtras =
      selectedGrinderId.length > 0
        ? {
            grinderId: selectedGrinder?.id ?? selectedGrinderId,
            grinderModel: selectedGrinder?.model ?? (typeof workflowSkin.grinderModel === "string" ? workflowSkin.grinderModel : undefined)
          }
        : {};
    const goldenExtras = tasteRating === 10 ? { goldenShot: true } : {};

    return {
      ...shot.annotations,
      actualDoseWeight: cleanNumber(doseText) ?? undefined,
      actualYield: cleanNumber(yieldText) ?? undefined,
      drinkTds: cleanNumber(tdsText) ?? undefined,
      drinkEy: ey ?? undefined,
      enjoyment: tasteRating,
      espressoNotes: notes,
      extras: {
        ...shot.annotations?.extras,
        workflowSkin: {
          ...workflowSkin,
          grindSize,
          ...grinderExtras,
          ...goldenExtras
        }
      }
    };
  }

  async function save() {
    await onSaveAnnotations(shot.id, reviewAnnotations());
    await loadShotGraph(shot.id, { force: true });
  }

  async function recommendShot() {
    if (!onRecommendShot) return;
    if (!selectedShotIsLatest) {
      const fullShot = (selectedShot.measurements?.length ?? 0) > 0 ? selectedShot : (await loadShotGraph(selectedShot.id, { force: true })) ?? selectedShot;
      await onRecommendShot(fullShot);
      return;
    }

    const annotations = reviewAnnotations();
    await onSaveAnnotations(shot.id, annotations);
    const fullShot = (await loadShotGraph(shot.id, { force: true })) ?? shot;
    await onRecommendShot({ ...fullShot, annotations });
  }

  async function readR2(options: { allowUnavailable?: boolean } = {}) {
    if (!r2Available && !options.allowUnavailable) {
      setR2Status({ type: "error", message: "No DiFluid R2 sensor detected." });
      return;
    }

    setR2Busy(true);
    setR2Status({ type: "info", message: r2Available ? "Reading from R2..." : "Looking for R2..." });
    try {
      const value = await onReadR2();
      if (typeof value === "number") {
        setTdsText(String(value));
        setR2Status({ type: "success", message: `R2 TDS ${value} imported.` });
      } else {
        setR2Status({ type: "error", message: "R2 did not return a TDS reading." });
      }
    } catch (error) {
      setR2Status({ type: "error", message: error instanceof Error ? error.message : "Could not read R2." });
    } finally {
      setR2Busy(false);
    }
  }

  useEffect(() => {
    readR2Ref.current = readR2;
  });

  useEffect(() => {
    if (!autoReadR2 || autoReadShotRef.current === shot.id) return;
    autoReadShotRef.current = shot.id;
    const delayMs = Math.max(0, Math.round(autoReadR2DelaySeconds) * 1000);
    if (delayMs === 0) {
      void readR2Ref.current?.({ allowUnavailable: true });
      return;
    }

    const timer = window.setTimeout(() => {
      void readR2Ref.current?.({ allowUnavailable: true });
    }, delayMs);

    return () => {
      window.clearTimeout(timer);
      if (autoReadShotRef.current === shot.id) autoReadShotRef.current = null;
    };
  }, [autoReadR2, autoReadR2DelaySeconds, shot.id]);

  useEffect(() => {
    setSelectedShotId(shot.id);
    setLoadedShotsById({});
    setLoadingGraphShotIds({});
    setFailedGraphShotIds({});
    requestedShotIdsRef.current.clear();
  }, [shot.id]);

  useEffect(() => {
    if (!onLoadShot || !selectedShot.id) return;
    if (failedGraphShotIds[selectedShot.id]) return;
    if ((selectedShot.measurements?.length ?? 0) === 0) {
      void loadShotGraph(selectedShot.id);
      return;
    }
    if (selectedShotIsLatest && !requestedShotIdsRef.current.has(selectedShot.id)) {
      void loadShotGraph(selectedShot.id, { background: true });
    }
  }, [failedGraphShotIds, loadShotGraph, onLoadShot, selectedShot.id, selectedShot.measurements?.length, selectedShotIsLatest]);

  return (
    <div className="workflow-grid">
      <section className="panel wide">
        <div className="review-graph-header">
          <h2>Shot Review</h2>
          {selectedProfileTitle && (
            <strong className="review-profile-title" title={selectedProfileTitle}>
              {selectedProfileTitle}
            </strong>
          )}
          <span className="muted">{selectedShotIsLatest ? "Last shot graph" : "Selected shot graph"}</span>
        </div>
        <div className="shot-scrubber">
          <div className="shot-scrubber-heading">
            <strong>Selected shot: {selectedShotLabel}</strong>
            <span className="muted">
              {selectedShotIndex + 1} of {reviewShots.length}
            </span>
          </div>
          {reviewShots.length > 1 && (
            <input
              type="range"
              aria-label="Shot scrubber"
              min={0}
              max={reviewShots.length - 1}
              step={1}
              value={selectedShotIndex}
              onChange={(event) => {
                const nextIndex = Number(event.currentTarget.value);
                setSelectedShotId(reviewShots[nextIndex]?.id ?? shot.id);
              }}
            />
          )}
        </div>
        {selectedGraphLoading ? (
          <div className="shot-graph shot-graph-loading" role="status" aria-live="polite">
            <span>Loading Graph</span>
          </div>
        ) : (
          <ShotGraph measurements={selectedShot.measurements ?? []} />
        )}
      </section>
      <section className="panel">
        <h2>{selectedShotIsLatest ? "Last Shot Details" : "Selected Shot Details"}</h2>
        <p>Duration: {formatStat(selectedStats.durationSeconds, "s")}</p>
        <p>Dose: {formatStat(selectedDose, " g")}</p>
        <p>Yield: {formatStat(selectedYield, " g")}</p>
        <p>TDS: {formatStat(selectedTds, "%")}</p>
        <p>Current EY: {formatStat(selectedEy, "%")}</p>
        <p>Grind: {selectedGrindSize || "—"}</p>
        <p>Peak pressure: {formatDecimalStat(selectedStats.peakPressure, " bar", 2)}</p>
        <p>Average flow: {formatStat(selectedStats.averageFlow, " mL/s")}</p>
      </section>
      <section className="panel review-form">
        <h2>Extraction Yield</h2>
        <label>
          Dose
          <input value={doseText} onChange={(event) => setDoseText(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          Yield
          <input value={yieldText} onChange={(event) => setYieldText(event.target.value)} inputMode="decimal" />
        </label>
        <label>
          TDS
          <input aria-label="TDS" value={tdsText} onChange={(event) => setTdsText(event.target.value)} inputMode="decimal" />
        </label>
        <p>EY: {ey ?? "—"}%</p>
        <button type="button" className="ghost-button" disabled={r2Busy} onClick={() => void readR2()}>
          {r2Busy ? "Reading R2" : "Read from R2"}
        </button>
        {r2Status && (
          <p className={r2Status.type === "error" ? "inline-panel-status error" : "inline-panel-status"} role={r2Status.type === "error" ? "alert" : "status"}>
            {r2Status.message}
          </p>
        )}
      </section>
      <section className="panel wide review-comparison">
        <h2>Same Bag Comparison</h2>
        <p>Previous same-bag shots: {sameBagShots.length}</p>
        <div className="review-comparison-grid">
          <span>Avg duration: {formatStat(sameBagAverages.duration, "s")}</span>
          <span>Avg yield: {formatStat(sameBagAverages.yield, " g")}</span>
          <span>Avg TDS: {formatStat(sameBagAverages.tds, "%")}</span>
          <span>Avg EY: {formatStat(sameBagAverages.ey, "%")}</span>
        </div>
        <p>Grinds: {sameBagGrinds.join(", ") || "—"}</p>
        {sameBagStats.length > 0 ? (
          <div className="review-shot-list" aria-label="Previous same-bag shot details">
            {sameBagStats.map((item) => (
              <div className="review-shot-row" key={item.shot.id}>
                <strong>{shotTimestampLabel(item.shot.timestamp)}</strong>
                <span>Yield {formatStat(item.stats.finalYield, " g")}</span>
                <span>TDS {formatStat(item.shot.annotations?.drinkTds ?? null, "%")}</span>
                <span>EY {formatStat(item.shot.annotations?.drinkEy ?? null, "%")}</span>
                <span>Grind {item.grindSize || "—"}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No previous shots for this bag yet.</p>
        )}
      </section>
      <section className="panel review-form">
        <h2>Dial In</h2>
        {grinders.length > 0 && (
          <label>
            Grinder
            <select aria-label="Grinder" value={selectedGrinderId} onChange={(event) => setSelectedGrinderId(event.target.value)}>
              <option value="">No grinder selected</option>
              {orderedGrinders.map((grinder) => (
                <option key={grinder.id} value={grinder.id}>
                  {grinder.model}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Grind size
          <input value={grindSize} onChange={(event) => setGrindSize(event.target.value)} />
        </label>
        <p>Previous grind sizes: {sameBagShots.map(grindSizeFromShot).filter(Boolean).join(", ") || "—"}</p>
      </section>
      <section className="panel review-form taste-card">
        <h2>Taste</h2>
        <label className="taste-slider-field">
          <span>Taste rating</span>
          <div className={`taste-slider-shell ${selectedTasteTone}`} style={tasteStyle}>
            <input
              aria-label="Taste rating"
              className={`taste-slider ${selectedTasteTone}`}
              type="range"
              min={1}
              max={10}
              step={1}
              value={tasteRating}
              onChange={(event) => setTasteRating(Number(event.currentTarget.value))}
            />
          </div>
          <output className={`taste-score ${selectedTasteTone}`} aria-live="polite">
            {tasteScore}
          </output>
        </label>
      </section>
      <section className="panel wide">
        <h2>Tasting Notes</h2>
        <textarea aria-label="Tasting Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
        <div className="form-actions review-actions">
          <button type="button" className="ghost-button" onClick={onUploadVisualizer}>
            Upload to Visualizer
          </button>
          {onRecommendShot && (
            <button type="button" className="ghost-button" onClick={() => void recommendShot()}>
              <Share2 aria-hidden="true" size={16} />
              Share recommendation
            </button>
          )}
          <button type="button" className="primary-button" onClick={save}>
            Save Review
          </button>
        </div>
      </section>
    </div>
  );
}
