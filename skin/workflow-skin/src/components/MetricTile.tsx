export function MetricTile({
  label,
  value,
  unit
}: {
  label: string;
  value: string | number | null | undefined;
  unit?: string;
}) {
  const displayValue = `${value ?? "—"}${unit ? ` ${unit}` : ""}`;
  return (
    <div className="metric-tile" aria-label={`${label}: ${displayValue}`}>
      <span>{label}</span>
      <strong>{displayValue}</strong>
    </div>
  );
}
