import { Pause, Play, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SteamRecord } from "../api/types";
import { DEFAULT_STEAM_TIMERS, MAX_STEAM_TIMERS, type SteamTimers } from "../state/skinSettings";

const defaultTimerLabels: Record<string, string> = {
  small: "Small jug",
  medium: "Medium jug",
  large: "Large jug"
};

interface TimerEntry {
  key: string;
  label: string;
  seconds: number;
}

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function steamRecordTitle(record: SteamRecord): string {
  const date = new Date(record.timestamp);
  if (Number.isNaN(date.getTime())) return record.id;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function steamNotes(record: SteamRecord): string {
  const notes = record.annotations?.notes ?? record.annotations?.steamNotes ?? record.annotations?.milkNotes;
  return typeof notes === "string" && notes.trim() ? notes : "No notes";
}

function labelFromTimerKey(key: string): string {
  const defaultLabel = defaultTimerLabels[key];
  if (defaultLabel) return defaultLabel;
  const words = key.replace(/[-_]+/g, " ").trim();
  if (!words) return "Timer";
  return words.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function keyFromTimerLabel(label: string): string {
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return key || "timer";
}

function uniqueTimerKey(baseKey: string, existingKeys: Set<string>): string {
  let key = baseKey;
  let index = 2;
  while (existingKeys.has(key)) {
    key = `${baseKey}-${index}`;
    index += 1;
  }
  return key;
}

function normalizeTimerSeconds(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.round(value);
}

function timerEntriesFromTimers(timers: SteamTimers): TimerEntry[] {
  const sourceEntries = Object.entries(timers).slice(0, MAX_STEAM_TIMERS);
  const entries = sourceEntries
    .filter(([key]) => key.trim().length > 0)
    .map(([key, seconds]) => ({ key, label: labelFromTimerKey(key), seconds: normalizeTimerSeconds(seconds) }));
  return entries.length > 0 ? entries : timerEntriesFromTimers(DEFAULT_STEAM_TIMERS);
}

function timersFromEntries(entries: TimerEntry[]): SteamTimers {
  const timers: SteamTimers = {};
  for (const entry of entries.slice(0, MAX_STEAM_TIMERS)) {
    timers[entry.key] = normalizeTimerSeconds(entry.seconds);
  }
  return timers;
}

export function SteamPage({
  profileTitle,
  timers,
  onReview,
  onStartSteam,
  onStopSteam,
  onUpdateTimers,
  steamActive = false,
  steamHistory = []
}: {
  profileTitle: string;
  timers: SteamTimers;
  onReview: () => void;
  onStartSteam?: () => Promise<void> | void;
  onStopSteam?: () => Promise<void> | void;
  onUpdateTimers?: (timers: SteamTimers) => Promise<void> | void;
  steamActive?: boolean;
  steamHistory?: SteamRecord[];
}) {
  const [timerEntries, setTimerEntries] = useState<TimerEntry[]>(() => timerEntriesFromTimers(timers));
  const [selectedTimerKey, setSelectedTimerKey] = useState(() => (timers.medium ? "medium" : timerEntriesFromTimers(timers)[0]?.key ?? "medium"));
  const selectedEntry = timerEntries.find((entry) => entry.key === selectedTimerKey) ?? timerEntries[0];
  const selectedSeconds = selectedEntry?.seconds ?? DEFAULT_STEAM_TIMERS.medium;
  const [remaining, setRemaining] = useState(selectedSeconds);
  const [running, setRunning] = useState(false);
  const nativeSteamActiveRef = useRef(false);
  const onStopSteamRef = useRef(onStopSteam);

  useEffect(() => {
    onStopSteamRef.current = onStopSteam;
  }, [onStopSteam]);

  useEffect(() => {
    setTimerEntries(timerEntriesFromTimers(timers));
  }, [timers]);

  useEffect(() => {
    if (timerEntries.some((entry) => entry.key === selectedTimerKey)) return;
    setSelectedTimerKey(timerEntries[0]?.key ?? "medium");
  }, [selectedTimerKey, timerEntries]);

  useEffect(() => {
    setRemaining(selectedSeconds);
    if (!steamActive) setRunning(false);
  }, [selectedSeconds, steamActive]);

  useEffect(() => {
    const wasActive = nativeSteamActiveRef.current;
    nativeSteamActiveRef.current = steamActive;
    if (steamActive && !wasActive) {
      setRemaining(selectedSeconds);
      setRunning(true);
      return;
    }
    if (!steamActive && wasActive) setRunning(false);
  }, [selectedSeconds, steamActive]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setRemaining((current) => {
        if (current <= 1) {
          window.clearInterval(interval);
          setRunning(false);
          void onStopSteamRef.current?.();
          return 0;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [running]);

  const timerText = useMemo(() => formatSeconds(remaining), [remaining]);
  const applyTimerEntries = (nextEntries: TimerEntry[], nextSelectedKey = selectedTimerKey) => {
    const cappedEntries = nextEntries.slice(0, MAX_STEAM_TIMERS);
    setTimerEntries(cappedEntries);
    setSelectedTimerKey(cappedEntries.some((entry) => entry.key === nextSelectedKey) ? nextSelectedKey : cappedEntries[0]?.key ?? "medium");
    void onUpdateTimers?.(timersFromEntries(cappedEntries));
  };
  const updateTimerName = (timerKey: string, label: string) => {
    const existingKeys = new Set(timerEntries.filter((entry) => entry.key !== timerKey).map((entry) => entry.key));
    const nextKey = label.trim() ? uniqueTimerKey(keyFromTimerLabel(label), existingKeys) : timerKey;
    const nextEntries = timerEntries.map((entry) => (entry.key === timerKey ? { ...entry, key: nextKey, label } : entry));
    applyTimerEntries(nextEntries, selectedTimerKey === timerKey ? nextKey : selectedTimerKey);
  };
  const updateTimerSeconds = (timerKey: string, seconds: number) => {
    applyTimerEntries(timerEntries.map((entry) => (entry.key === timerKey ? { ...entry, seconds: normalizeTimerSeconds(seconds) } : entry)));
  };
  const addTimer = () => {
    if (timerEntries.length >= MAX_STEAM_TIMERS) return;
    const existingKeys = new Set(timerEntries.map((entry) => entry.key));
    const label = `Timer ${timerEntries.length + 1}`;
    const key = uniqueTimerKey(keyFromTimerLabel(label), existingKeys);
    applyTimerEntries([...timerEntries, { key, label, seconds: DEFAULT_STEAM_TIMERS.medium }], key);
  };
  const removeTimer = (timerKey: string) => {
    if (timerEntries.length <= 1) return;
    applyTimerEntries(timerEntries.filter((entry) => entry.key !== timerKey));
  };
  const toggleSteam = () => {
    if (running) {
      setRunning(false);
      void onStopSteam?.();
      return;
    }
    setRemaining((currentRemaining) => (currentRemaining <= 0 ? selectedSeconds : currentRemaining));
    setRunning(true);
    void onStartSteam?.();
  };

  return (
    <div className="workflow-grid">
      <section className="panel wide steam-panel">
        <div>
          <span className="eyebrow">Steam Workflow</span>
          <h2>{profileTitle}</h2>
        </div>
        <div className="steam-timer" aria-live="polite">
          {timerText}
        </div>
        <div className="jug-grid" aria-label="Steam timer presets">
          {timerEntries.map((timer) => (
            <button
              key={timer.key}
              type="button"
              className={selectedTimerKey === timer.key ? "jug-button active" : "jug-button"}
              onClick={() => setSelectedTimerKey(timer.key)}
            >
              <span>{timer.label || labelFromTimerKey(timer.key)}</span>
              <strong>{timer.seconds}s</strong>
            </button>
          ))}
        </div>
        <div className="steam-timer-editor" aria-label="Steam timers">
          {timerEntries.map((timer) => {
            const displayLabel = timer.label || labelFromTimerKey(timer.key);
            return (
              <div className="steam-timer-row" key={timer.key}>
                <label>
                  <span>Name</span>
                  <input
                    aria-label={`Timer name ${displayLabel}`}
                    value={timer.label}
                    onChange={(event) => updateTimerName(timer.key, event.target.value)}
                  />
                </label>
                <label>
                  <span>Seconds</span>
                  <input
                    aria-label={`Timer seconds ${displayLabel}`}
                    type="number"
                    min="1"
                    value={timer.seconds}
                    onChange={(event) => updateTimerSeconds(timer.key, Number(event.target.value))}
                  />
                </label>
                <button
                  type="button"
                  className="icon-button timer-remove-button"
                  aria-label={`Remove ${displayLabel} timer`}
                  title={`Remove ${displayLabel} timer`}
                  disabled={timerEntries.length <= 1}
                  onClick={() => removeTimer(timer.key)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            );
          })}
          <button type="button" className="ghost-button compact-button" disabled={timerEntries.length >= MAX_STEAM_TIMERS} onClick={addTimer}>
            <Plus size={17} />
            Add timer
          </button>
        </div>
        <div className="steam-actions">
          <button type="button" className="primary-button" onClick={toggleSteam}>
            {running ? <Pause size={18} /> : <Play size={18} />}
            {running ? "Pause" : "Start"}
          </button>
          <button type="button" className="ghost-button" onClick={() => setRemaining(selectedSeconds)}>
            <RotateCcw size={18} />
            Reset
          </button>
          <button type="button" className="ghost-button" onClick={onReview}>
            Shot Review
          </button>
        </div>
      </section>
      <section className="panel wide">
        <h2>Steam History</h2>
        {steamHistory.length === 0 ? (
          <p className="muted">No steam sessions recorded yet.</p>
        ) : (
          steamHistory.slice(0, 5).map((record) => {
            const sampleCount = record.measurements?.length ?? 0;
            return (
              <div className="list-row" key={record.id}>
                <strong>{steamRecordTitle(record)}</strong>
                <span>{steamNotes(record)}</span>
                <span>{sampleCount} samples</span>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
