import { useEffect, useRef } from "react";
import type { JsonMap } from "../api/types";
import { profileNumber, profilePump } from "../lib/profileEditor";

const HEIGHT = 228;
const LEFT = 67;
const RIGHT = 14;
const BAND_TOP = 14;
const BAND_HEIGHT = 51;
const BAND_GAP = 14;
const tracks = [
  { key: "pressure", label: "Pressure", unit: "bar", color: "var(--skin-accent)", maximum: 12 },
  { key: "flow", label: "Flow", unit: "mL/s", color: "#71aaff", maximum: 8 },
  { key: "temperature", label: "Temp", unit: "°C", color: "var(--skin-accent-alt)", maximum: 100 }
] as const;

function stepSpans(steps: JsonMap[]) {
  let seconds = 0;
  return steps.map((step) => {
    const start = seconds;
    seconds += Math.max(0, profileNumber(step.seconds) ?? 0);
    return { start, end: seconds };
  });
}

function drawPreview(canvas: HTMLCanvasElement, steps: JsonMap[], selected: number) {
  const context = canvas.getContext("2d");
  const width = canvas.clientWidth;
  if (!context || width <= LEFT + RIGHT) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(HEIGHT * ratio);
  context.scale(ratio, ratio);
  const theme = getComputedStyle(canvas);
  const muted = theme.getPropertyValue("--skin-muted").trim() || "#9daab4";
  const grid = theme.getPropertyValue("--skin-border").trim() || "#303a43";
  const accent = theme.getPropertyValue("--skin-accent").trim() || "#5bd179";
  const spans = stepSpans(steps);
  const duration = Math.max(1, spans[spans.length - 1]?.end ?? 0);
  const plotWidth = width - LEFT - RIGHT;
  const x = (seconds: number) => LEFT + seconds / duration * plotWidth;
  const focused = spans[selected];

  if (focused) {
    context.fillStyle = accent;
    context.globalAlpha = 0.1;
    context.fillRect(x(focused.start), BAND_TOP, Math.max(2, x(focused.end) - x(focused.start)), 181);
    context.globalAlpha = 1;
  }
  context.font = "12px system-ui, sans-serif";
  context.lineWidth = 1;
  context.strokeStyle = grid;
  for (const span of spans) {
    context.beginPath();
    context.moveTo(x(span.end), BAND_TOP);
    context.lineTo(x(span.end), 195);
    context.stroke();
  }

  tracks.forEach((track, lane) => {
    const top = BAND_TOP + lane * (BAND_HEIGHT + BAND_GAP);
    const bottom = top + BAND_HEIGHT;
    const values = steps.map((step) => track.key === "temperature" || profilePump(step) === track.key
      ? profileNumber(step[track.key]) : undefined);
    const numbers = values.filter((value): value is number => value !== undefined);
    const high = Math.max(track.maximum, ...numbers);
    const low = track.key === "temperature" && numbers.length ? Math.max(0, Math.floor((Math.min(...numbers) - 4) / 5) * 5) : 0;
    const range = Math.max(1, high - low);
    const y = (value: number) => bottom - (value - low) / range * BAND_HEIGHT;
    context.fillStyle = muted;
    context.textAlign = "left";
    context.fillText(track.label, 0, top + 13);
    context.font = "10px system-ui, sans-serif";
    context.fillText(`${low}–${high} ${track.unit}`, 0, top + 29);
    context.font = "12px system-ui, sans-serif";
    context.strokeStyle = grid;
    context.beginPath();
    context.moveTo(LEFT, bottom);
    context.lineTo(width - RIGHT, bottom);
    context.stroke();
    context.strokeStyle = track.color.startsWith("var(")
      ? theme.getPropertyValue(track.color.slice(4, -1)).trim() || accent : track.color;
    context.lineWidth = 2.5;
    context.beginPath();
    values.forEach((target, index) => {
      if (target === undefined) return;
      const { start, end } = spans[index];
      const previous = values[index - 1];
      const targetY = y(target);
      context.moveTo(x(start), previous === undefined ? targetY : y(previous));
      if (steps[index].transition !== "smooth") context.lineTo(x(start), targetY);
      context.lineTo(Math.max(x(start) + 1, x(end)), targetY);
    });
    context.stroke();
    context.lineWidth = 1;
  });

  context.fillStyle = muted;
  const ticks = plotWidth > 450 ? 6 : 3;
  for (let index = 0; index <= ticks; index += 1) {
    const seconds = duration * index / ticks;
    context.textAlign = index === 0 ? "left" : index === ticks ? "right" : "center";
    context.fillText(`${Number(seconds.toFixed(1))}s`, x(seconds), 219);
  }
}

export function ProfilePreview({
  steps,
  selected,
  onSelect
}: {
  steps: JsonMap[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof CanvasRenderingContext2D === "undefined") return;
    const render = () => drawPreview(canvas, steps, selected);
    render();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", render);
      return () => window.removeEventListener("resize", render);
    }
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [steps, selected]);

  return <canvas
    ref={canvasRef}
    className="recipe-chart"
    role="img"
    aria-label="Profile preview of programmed pressure, flow and temperature targets"
    onClick={(event) => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const spans = stepSpans(steps);
      const fraction = (event.clientX - bounds.left - LEFT) / (bounds.width - LEFT - RIGHT);
      const duration = Math.max(1, spans[spans.length - 1]?.end ?? 0);
      if (fraction < 0 || fraction > 1) return;
      const index = spans.findIndex((span) => fraction * duration < span.end);
      if (steps.length) onSelect(index < 0 ? steps.length - 1 : index);
    }}
  />;
}
