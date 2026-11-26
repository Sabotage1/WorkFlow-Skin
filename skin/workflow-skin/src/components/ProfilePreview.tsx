import { useLayoutEffect, useId, useRef, useState, type PointerEvent } from "react";
import type { JsonMap } from "../api/types";
import { MAX_PUMP_VALUE, MAX_STEP_TEMPERATURE, profileNumber, profilePump } from "../lib/profileEditor";

const HEIGHT = 228;
const LEFT = 67;
const RIGHT = 14;
const BAND_TOP = 14;
const BAND_HEIGHT = 51;
const BAND_GAP = 14;
const TRACKS = [
  { key: "pressure", label: "Pressure", unit: "bar", color: "var(--skin-accent)", scaleTop: 12, limit: MAX_PUMP_VALUE },
  { key: "flow", label: "Flow", unit: "mL/s", color: "#71aaff", scaleTop: 8, limit: MAX_PUMP_VALUE },
  { key: "temperature", label: "Temp", unit: "°C", color: "var(--skin-accent-alt)", scaleTop: 100, limit: MAX_STEP_TEMPERATURE }
] as const;

type Target = typeof TRACKS[number]["key"];
type Scale = { low: number; high: number };
type Drag = {
  pointerId: number;
  index: number;
  target: Target;
  startY: number;
  fraction: number;
  original: number;
  originalField: unknown;
  scale: Scale;
  limit: number;
  changed: boolean;
  lastField: unknown;
};

function stepSpans(steps: JsonMap[]) {
  let seconds = 0;
  return steps.map((step) => {
    const start = seconds;
    seconds += Math.max(0, profileNumber(step.seconds) ?? 0);
    return { start, end: seconds };
  });
}

function DragValue({ x, y, value, width }: { x: number; y: number; value: string; width: number }) {
  const labelWidth = 16 + value.length * 8;
  const labelHeight = 23;
  const labelOnRight = x + 22 + labelWidth <= width - 2;
  const labelBelow = y < 34;
  const labelX = labelOnRight ? x + 22 : Math.max(2, x - labelWidth - 22);
  const labelY = labelBelow ? y + 8 : y - labelHeight - 8;
  const nearEdge = labelOnRight ? labelX + 4 : labelX + labelWidth - 4;

  return <g className="recipe-chart-value" pointerEvents="none">
    <line x1={x} y1={y} x2={nearEdge} y2={labelBelow ? labelY + 4 : labelY + labelHeight - 4} stroke="currentColor" />
    <rect x={labelX} y={labelY} width={labelWidth} height={labelHeight} rx={6} />
    <text x={labelX + labelWidth / 2} y={labelY + 16} textAnchor="middle">{value}</text>
  </g>;
}

export function ProfilePreview({ steps, selected, disabled, onSelect, onTargetChange }: {
  steps: JsonMap[];
  selected: number;
  disabled: boolean;
  onSelect: (index: number) => void;
  onTargetChange: (index: number, target: Target, value: unknown) => void;
}) {
  const chartRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(0);
  const [activeDrag, setActiveDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const id = useId();
  const spans = stepSpans(steps);
  const duration = Math.max(1, spans[spans.length - 1]?.end ?? 0);
  const plotWidth = Math.max(0, width - LEFT - RIGHT);
  const x = (seconds: number) => LEFT + seconds / duration * plotWidth;
  const focused = spans[selected];
  const ticks = plotWidth > 450 ? 6 : 3;

  useLayoutEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const measure = () => setWidth(chart.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);

  function moveTarget(event: PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (disabled || !drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.startY - event.clientY;
    if (!drag.changed && Math.abs(delta) < 3) return;

    const value = drag.original + delta / BAND_HEIGHT * (drag.scale.high - drag.scale.low);
    const nextField = Math.abs(delta) < 0.5 ? drag.originalField
      : Math.min(drag.limit, Math.max(0, Math.round(value * 10) / 10));
    if (Object.is(nextField, drag.lastField)) return;
    drag.changed = true;
    drag.lastField = nextField;
    onTargetChange(drag.index, drag.target, nextField);
  }

  function endDrag(event: PointerEvent<SVGSVGElement>, cancelled: boolean) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (cancelled && drag.changed && !disabled) onTargetChange(drag.index, drag.target, drag.originalField);
    if (!cancelled) moveTarget(event);
    dragRef.current = null;
    setActiveDrag(null);
  }

  const lanes = TRACKS.map((track, lane) => {
    const top = BAND_TOP + lane * (BAND_HEIGHT + BAND_GAP);
    const bottom = top + BAND_HEIGHT;
    const values = steps.map((step) => track.key === "temperature" || profilePump(step) === track.key
      ? profileNumber(step[track.key]) : undefined);
    const numbers = values.filter((value): value is number => value !== undefined);
    const drag = activeDrag?.target === track.key ? activeDrag : null;
    const low = drag ? Math.min(drag.scale.low, ...numbers)
      : track.key === "temperature" && numbers.length ? Math.max(0, Math.floor((Math.min(...numbers) - 4) / 5) * 5) : 0;
    const high = Math.max(drag?.scale.high ?? track.scaleTop, ...numbers);
    const y = (value: number) => bottom - (value - low) / Math.max(1, high - low) * BAND_HEIGHT;
    const segments = values.flatMap((value, index) => {
      if (value === undefined) return [];
      const { start, end } = spans[index];
      const startX = x(start);
      const endX = Math.max(startX + 1, x(end));
      const previous = values[index - 1] ?? value;
      const smooth = steps[index].transition === "smooth" && previous !== value;
      const targetY = y(value);
      const fraction = drag?.index === index ? drag.fraction : 0.5;
      return [{
        index, value, startX, endX, targetY,
        dotX: smooth ? endX : startX + (endX - startX) * fraction,
        path: `M ${startX} ${smooth ? y(previous) : targetY} L ${endX} ${targetY}`,
        jump: !smooth && previous !== value ? `M ${startX} ${y(previous)} V ${targetY}` : undefined
      }];
    });
    return { track, top, bottom, low, high, segments };
  });
  const activeLane = lanes.find(({ track }) => track.key === activeDrag?.target);
  const activeSegment = activeLane?.segments.find(({ index }) => index === activeDrag?.index);

  return <div
    className="recipe-chart-frame"
    role="img"
    aria-label="Profile preview of programmed pressure, flow and temperature targets"
    onClick={(event) => {
      if (disabled || !plotWidth || dragRef.current) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const fraction = (event.clientX - bounds.left - LEFT) / plotWidth;
      if (fraction < 0 || fraction > 1 || !spans.length) return;
      const index = spans.findIndex((span) => fraction * duration < span.end);
      onSelect(index < 0 ? spans.length - 1 : index);
    }}
  >
    <svg
      ref={chartRef}
      className="recipe-chart"
      viewBox={`0 0 ${Math.max(1, width)} ${HEIGHT}`}
      aria-hidden="true"
      onPointerMove={moveTarget}
      onPointerUp={(event) => endDrag(event, false)}
      onPointerCancel={(event) => endDrag(event, true)}
      onLostPointerCapture={(event) => endDrag(event, true)}
    >
      {plotWidth > 0 && <>
        {focused && <rect className="recipe-chart-selection" x={x(focused.start)} y={BAND_TOP}
          width={Math.max(2, x(focused.end) - x(focused.start))} height={181} />}
        {spans.map((span, index) => <line key={index} className="recipe-chart-grid" x1={x(span.end)} x2={x(span.end)} y1={BAND_TOP} y2={195} />)}
        {lanes.map(({ track, top, bottom, low, high, segments }) => {
          const clipId = `${id}-${track.key}`;
          return <g key={track.key} style={{ color: track.color }}>
            <clipPath id={clipId}>
              <rect x={LEFT} y={top - BAND_GAP / 2} width={plotWidth} height={BAND_HEIGHT + BAND_GAP} />
            </clipPath>
            <text x={0} y={top + 13}>{track.label}</text>
            <text className="recipe-chart-scale" x={0} y={top + 29}>{low}–{Number(high.toFixed(2))} {track.unit}</text>
            <line className="recipe-chart-grid" x1={LEFT} x2={width - RIGHT} y1={bottom} y2={bottom} />
            {segments.map(({ index, value, startX, endX, targetY, dotX, path, jump }) => <g key={index}>
              {jump && <path className="recipe-chart-line" d={jump} />}
              <path className="recipe-chart-line" d={path} />
              {index === selected && !disabled && <circle cx={dotX} cy={targetY} r={4} fill="currentColor" pointerEvents="none" />}
              <path className="recipe-chart-target" d={path} clipPath={`url(#${clipId})`}
                style={{ pointerEvents: disabled ? "none" : undefined }}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                  const bounds = chartRef.current?.getBoundingClientRect();
                  if (disabled || !bounds || event.button !== 0 || !event.isPrimary || dragRef.current) return;
                  event.preventDefault();
                  const originalField = steps[index][track.key];
                  const nextDrag: Drag = {
                    pointerId: event.pointerId, index, target: track.key, startY: event.clientY,
                    fraction: Math.min(1, Math.max(0, (event.clientX - bounds.left - startX) / (endX - startX))),
                    original: value, originalField, scale: { low, high }, limit: track.limit,
                    changed: false, lastField: originalField
                  };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragRef.current = nextDrag;
                  setActiveDrag(nextDrag);
                  onSelect(index);
                }} />
            </g>)}
          </g>;
        })}
        {Array.from({ length: ticks + 1 }, (_, index) => {
          const seconds = duration * index / ticks;
          return <text key={index} x={x(seconds)} y={219} textAnchor={index === 0 ? "start" : index === ticks ? "end" : "middle"}>
            {Number(seconds.toFixed(1))}s
          </text>;
        })}
        {!disabled && activeLane && activeSegment && <g style={{ color: activeLane.track.color }}>
          <DragValue x={activeSegment.dotX} y={activeSegment.targetY}
            value={`${activeSegment.value} ${activeLane.track.unit}`} width={width} />
        </g>}
      </>}
    </svg>
  </div>;
}
