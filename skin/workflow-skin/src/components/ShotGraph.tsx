import type { ShotSnapshot } from "../api/types";

type SeriesKey = "pressure" | "flow" | "targetPressure" | "targetFlow" | "groupTemperature" | "targetTemperature" | "weightFlow";

interface SeriesDefinition {
  key: SeriesKey;
  label: string;
  color: string;
  dashArray?: string;
  value: (measurement: ShotSnapshot) => number | null;
  scale?: (value: number) => number;
}

interface ChartPoint {
  time: number;
  value: number;
}

interface ChartSeries extends SeriesDefinition {
  points: ChartPoint[];
}

const SERIES_DEFINITIONS: SeriesDefinition[] = [
  {
    key: "pressure",
    label: "Pressure",
    color: "#76d99b",
    value: (measurement) => numeric(measurement.machine?.pressure)
  },
  {
    key: "flow",
    label: "Flow",
    color: "#8fb7ff",
    value: (measurement) => numeric(measurement.machine?.flow)
  },
  {
    key: "targetPressure",
    label: "Target pressure",
    color: "#b2e9c5",
    dashArray: "6 5",
    value: (measurement) => numeric(measurement.machine?.targetPressure)
  },
  {
    key: "targetFlow",
    label: "Target flow",
    color: "#c3d8ff",
    dashArray: "6 5",
    value: (measurement) => numeric(measurement.machine?.targetFlow)
  },
  {
    key: "groupTemperature",
    label: "Temp / 10",
    color: "#f0a46c",
    value: (measurement) => numeric(measurement.machine?.groupTemperature) ?? numeric(measurement.machine?.mixTemperature),
    scale: (value) => value / 10
  },
  {
    key: "targetTemperature",
    label: "Target temp",
    color: "#ffd2a8",
    dashArray: "6 5",
    value: (measurement) => numeric(measurement.machine?.targetGroupTemperature) ?? numeric(measurement.machine?.targetMixTemperature),
    scale: (value) => value / 10
  },
  {
    key: "weightFlow",
    label: "Weight flow",
    color: "#d8c16b",
    value: (measurement) => numeric(measurement.scale?.weightFlow)
  }
];

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timestampMs(measurement: ShotSnapshot): number | null {
  const timestamp = measurement.machine?.timestamp ?? measurement.scale?.timestamp;
  if (!timestamp) return null;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) ? time : null;
}

function timerValue(measurement: ShotSnapshot): number | null {
  const value = measurement.scale?.timerValue;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function timerElapsedSeconds(value: number, timerValuesAreMilliseconds: boolean): number {
  return timerValuesAreMilliseconds ? value / 1000 : value;
}

function timestampTimeline(measurements: ShotSnapshot[]): Array<number | null> {
  const timestamps = measurements.map(timestampMs).filter((value): value is number => value !== null);
  const startTime = timestamps.length ? timestamps[0] : null;
  return measurements.map((measurement, index) => elapsedSecondsFromTimestamp(measurements, measurement, index, startTime));
}

function scaleTimerTimeline(measurements: ShotSnapshot[], timerValues: number[]): Array<number | null> {
  const timerValuesAreMilliseconds = timerValues.some((value) => value > 120);
  let lastTimer: number | null = null;
  return measurements.map((measurement) => {
    const timer = timerValue(measurement);
    if (timer !== null) lastTimer = timerElapsedSeconds(timer, timerValuesAreMilliseconds);
    return lastTimer;
  });
}

function activeBrewSample(measurement: ShotSnapshot): boolean {
  const pressure = numeric(measurement.machine?.pressure) ?? 0;
  const flow = numeric(measurement.machine?.flow) ?? 0;
  const weightFlow = numeric(measurement.scale?.weightFlow) ?? 0;
  return pressure > 1.5 || flow > 0.2 || Math.abs(weightFlow) > 0.2;
}

function timelineMax(timeline: Array<number | null>): number {
  return Math.max(0, ...timeline.filter((value): value is number => value !== null));
}

function timerStopsBeforeActiveBrewEnds(measurements: ShotSnapshot[], timerTimeline: Array<number | null>, timestampTimelineValues: Array<number | null>): boolean {
  const timerMax = timelineMax(timerTimeline);
  const timestampMax = timelineMax(timestampTimelineValues);
  if (timestampMax <= timerMax + 2) return false;

  return measurements.some((measurement, index) => {
    const timestampSeconds = timestampTimelineValues[index];
    if (timestampSeconds === null || timestampSeconds <= timerMax + 1) return false;
    return activeBrewSample(measurement);
  });
}

function elapsedTimeline(measurements: ShotSnapshot[]): Array<number | null> {
  const timerValues = measurements.map(timerValue).filter((value): value is number => value !== null);
  if (timerValues.length) {
    const timerTimeline = scaleTimerTimeline(measurements, timerValues);
    const timestampTimelineValues = timestampTimeline(measurements);
    return timerStopsBeforeActiveBrewEnds(measurements, timerTimeline, timestampTimelineValues) ? timestampTimelineValues : timerTimeline;
  }

  return timestampTimeline(measurements);
}

function elapsedSecondsFromTimestamp(measurements: ShotSnapshot[], measurement: ShotSnapshot, index: number, startTime: number | null): number {
  const time = timestampMs(measurement);
  if (time !== null && startTime !== null) return Math.max(0, (time - startTime) / 1000);
  return measurements.length <= 1 ? 0 : index;
}

function chartSeries(measurements: ShotSnapshot[]): ChartSeries[] {
  const elapsedTimes = elapsedTimeline(measurements);

  return SERIES_DEFINITIONS.map((definition) => {
    const points = measurements.flatMap((measurement, index) => {
      const value = definition.value(measurement);
      const time = elapsedTimes[index];
      if (value === null || time === null) return [];
      return [
        {
          time,
          value: definition.scale ? definition.scale(value) : value
        }
      ];
    });

    return { ...definition, points };
  }).filter((series) => series.points.length > 0);
}

function ticks(max: number): number[] {
  const safeMax = Math.max(1, max);
  const step = safeMax / 4;
  return [0, step, step * 2, step * 3, safeMax];
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function pathForSeries(series: ChartSeries, maxTime: number, maxY: number, plot: { x: number; y: number; width: number; height: number }): string {
  const points = series.points.map((point) => {
    const x = plot.x + (maxTime <= 0 ? 0 : point.time / maxTime) * plot.width;
    const y = plot.y + plot.height - (maxY <= 0 ? 0 : point.value / maxY) * plot.height;
    return { x, y };
  });

  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} h 0.1`;
  if (points.length === 2 || series.dashArray) {
    return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  }

  const [first, ...rest] = points;
  let path = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let index = 0; index < rest.length - 1; index += 1) {
    const current = rest[index];
    const next = rest[index + 1];
    const midX = (current.x + next.x) / 2;
    const midY = (current.y + next.y) / 2;
    path += ` Q ${current.x.toFixed(1)} ${current.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = rest[rest.length - 1];
  path += ` T ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return path;
}

export function ShotGraph({ measurements }: { measurements: ShotSnapshot[] }) {
  const width = 640;
  const height = 270;
  const plot = { x: 42, y: 18, width: 574, height: 176 };
  const series = chartSeries(measurements);
  const maxTime = Math.max(1, ...series.flatMap((item) => item.points.map((point) => point.time)));
  const maxY = Math.max(12, Math.ceil(Math.max(0, ...series.flatMap((item) => item.points.map((point) => point.value)))));

  return (
    <svg className="shot-graph" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Shot pressure graph">
      <rect width={width} height={height} rx="8" fill="#0d141a" />
      {series.length ? (
        <>
          <rect className="shot-graph-plot" x={plot.x} y={plot.y} width={plot.width} height={plot.height} rx="4" />
          {ticks(maxTime).map((tick) => {
            const x = plot.x + (tick / maxTime) * plot.width;
            return (
              <g key={`x-${tick}`}>
                <line className="shot-graph-grid" x1={x} y1={plot.y} x2={x} y2={plot.y + plot.height} />
                <text className="shot-graph-axis-label" x={x} y={plot.y + plot.height + 18} textAnchor="middle">
                  {formatTick(tick)}s
                </text>
              </g>
            );
          })}
          {ticks(maxY).map((tick) => {
            const y = plot.y + plot.height - (tick / maxY) * plot.height;
            return (
              <g key={`y-${tick}`}>
                <line className="shot-graph-grid" x1={plot.x} y1={y} x2={plot.x + plot.width} y2={y} />
                <text className="shot-graph-axis-label" x={plot.x - 10} y={y + 4} textAnchor="end">
                  {formatTick(tick)}
                </text>
              </g>
            );
          })}
          {series.map((item) => (
            <path
              key={item.key}
              className={`shot-graph-series ${item.key}`}
              d={pathForSeries(item, maxTime, maxY, plot)}
              fill="none"
              stroke={item.color}
              strokeWidth={item.dashArray ? 1.8 : 3}
              strokeLinecap={item.dashArray ? "butt" : "round"}
              strokeLinejoin="round"
              strokeDasharray={item.dashArray}
            />
          ))}
          <g className="shot-graph-legend">
            {series.map((item, index) => {
              const column = index % 4;
              const row = Math.floor(index / 4);
              const x = plot.x + column * 142;
              const y = 228 + row * 18;
              return (
                <g key={`legend-${item.key}`}>
                  <line x1={x} y1={y} x2={x + 24} y2={y} stroke={item.color} strokeWidth="2" strokeDasharray={item.dashArray} />
                  <text x={x + 31} y={y + 4}>
                    {item.label}
                  </text>
                </g>
              );
            })}
          </g>
        </>
      ) : (
        <>
          <line x1="32" y1={height - 46} x2={width - 32} y2="40" stroke="#2a343c" strokeWidth="2" strokeDasharray="10 10" />
          <text x={width / 2} y={height / 2} fill="#7f8b94" fontSize="18" fontWeight="800" textAnchor="middle">
            Waiting for live data
          </text>
        </>
      )}
    </svg>
  );
}
