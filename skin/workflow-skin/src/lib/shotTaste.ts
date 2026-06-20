import type { ShotAnnotations, ShotRecord } from "../api/types";

export type TasteTone = "red" | "yellow" | "green" | "gold";

export const tasteToneStyles = {
  red: { color: "#e05656", glow: "rgb(224 86 86 / 36%)", rest: "#362026" },
  yellow: { color: "#f0c36a", glow: "rgb(240 195 106 / 30%)", rest: "#352c18" },
  green: { color: "#5bd179", glow: "rgb(91 209 121 / 34%)", rest: "#1c3325" },
  gold: { color: "#ffd43b", glow: "rgb(255 156 28 / 48%)", rest: "#392a10" }
} satisfies Record<TasteTone, { color: string; glow: string; rest: string }>;

export function tasteTone(value: number): TasteTone {
  if (value >= 10) return "gold";
  if (value >= 7) return "green";
  if (value >= 4) return "yellow";
  return "red";
}

export function shotTasteRating(shot: ShotRecord): number | null {
  const value = shot.annotations?.enjoyment;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(10, Math.max(1, Math.round(value)));
}

export function tasteScoreLabel(value: number | null): string {
  return value === null ? "No score" : `${value}/10${value === 10 ? " 🔥" : ""}`;
}

function workflowSkinExtras(annotations: ShotAnnotations | undefined): Record<string, unknown> {
  const value = annotations?.extras?.workflowSkin;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function isGoldenShot(shot: ShotRecord): boolean {
  return workflowSkinExtras(shot.annotations).goldenShot === true || shotTasteRating(shot) === 10;
}
