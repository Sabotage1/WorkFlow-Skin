import type { GitHubJsonClient } from "./github";
import type { BagSnapshot, BrewRecommendation, BurrType, GrinderSnapshot, ProfileSnapshot, RecommendationIndex, RecommendationIndexItem, RecommendationRecord } from "./types";
import { buildIndexItem } from "./validation";

const indexPath = "Profiles/index.json";
const recommendationIdPattern = /^rec-[a-z0-9-]+$/;

export interface LoadedRecommendationIndex {
  index: RecommendationIndex;
  sha?: string;
}

export const emptyIndex: RecommendationIndex = {
  version: 1,
  updatedAt: "1970-01-01T00:00:00.000Z",
  items: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pickString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field];
  return typeof value === "string" ? value : undefined;
}

function pickNumber(record: Record<string, unknown>, field: string): number | undefined {
  const value = record[field];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickBurrType(record: Record<string, unknown>, field: string): BurrType | undefined {
  const value = pickString(record, field)?.trim().toLowerCase();
  return value === "flat" || value === "conical" ? value : undefined;
}

function sanitizeBag(input: unknown): BagSnapshot {
  const record = isRecord(input) ? input : {};
  const bag: BagSnapshot = {
    id: pickString(record, "id") ?? "",
    beanId: pickString(record, "beanId") ?? "",
    roaster: pickString(record, "roaster") ?? "",
    bean: pickString(record, "bean") ?? "",
    country: pickString(record, "country") ?? "",
    process: pickString(record, "process") ?? "",
    roastDate: pickString(record, "roastDate") ?? ""
  };
  const name = pickString(record, "name");
  if (name !== undefined) bag.name = name;
  const region = pickString(record, "region");
  if (region !== undefined) bag.region = region;
  const roastLevel = pickString(record, "roastLevel");
  if (roastLevel !== undefined) bag.roastLevel = roastLevel;
  const notes = pickString(record, "notes");
  if (notes !== undefined) bag.notes = notes;
  return bag;
}

function sanitizeProfile(input: unknown): ProfileSnapshot {
  const record = isRecord(input) ? input : {};
  return {
    originalId: pickString(record, "originalId") ?? "",
    originalTitle: pickString(record, "originalTitle") ?? "",
    fileName: pickString(record, "fileName") ?? "",
    installedTitle: pickString(record, "installedTitle") ?? ""
  };
}

function sanitizeGrinder(input: unknown): GrinderSnapshot {
  const record = isRecord(input) ? input : {};
  const grinder: GrinderSnapshot = {
    id: pickString(record, "id") ?? "",
    model: pickString(record, "model") ?? ""
  };
  const burrType = pickBurrType(record, "burrType");
  if (burrType !== undefined) grinder.burrType = burrType;
  const burrs = pickString(record, "burrs");
  if (burrs !== undefined) grinder.burrs = burrs;
  const settingType = pickString(record, "settingType");
  if (settingType === "numeric" || settingType === "preset") grinder.settingType = settingType;
  const notes = pickString(record, "notes");
  if (notes !== undefined) grinder.notes = notes;
  return grinder;
}

function sanitizeBrew(input: unknown): BrewRecommendation {
  const record = isRecord(input) ? input : {};
  const brew: BrewRecommendation = {
    grindSetting: pickString(record, "grindSetting") ?? "",
    beansWeight: pickNumber(record, "beansWeight") ?? 0,
    drinkWeight: pickNumber(record, "drinkWeight") ?? 0,
    notes: pickString(record, "notes") ?? ""
  };
  const secondsGoal = pickNumber(record, "secondsGoal");
  if (secondsGoal !== undefined) brew.secondsGoal = secondsGoal;
  const secondsMin = pickNumber(record, "secondsMin");
  if (secondsMin !== undefined) brew.secondsMin = secondsMin;
  const secondsMax = pickNumber(record, "secondsMax");
  if (secondsMax !== undefined) brew.secondsMax = secondsMax;
  return brew;
}

function sanitizeIndexItem(input: unknown): RecommendationIndexItem | undefined {
  if (!isRecord(input)) return undefined;
  const id = pickString(input, "id");
  const updatedAt = pickString(input, "updatedAt");
  const submittedBy = pickString(input, "submittedBy");
  const searchText = pickString(input, "searchText");
  if (!id || !recommendationIdPattern.test(id) || !updatedAt || !submittedBy || searchText === undefined) return undefined;

  const item: RecommendationIndexItem = {
    id,
    updatedAt,
    submittedBy,
    bag: sanitizeBag(input.bag),
    profile: sanitizeProfile(input.profile),
    grinder: sanitizeGrinder(input.grinder),
    brew: sanitizeBrew(input.brew),
    searchText
  };
  const visualizerUrl = pickString(input, "visualizerUrl");
  if (visualizerUrl !== undefined) item.visualizerUrl = visualizerUrl;
  const evidenceFileName = pickString(input, "evidenceFileName");
  if (evidenceFileName !== undefined) item.evidenceFileName = evidenceFileName;
  const rating = pickNumber(input, "rating");
  if (rating !== undefined && Number.isInteger(rating) && rating >= 1 && rating <= 5) item.rating = rating;
  const shotScore = pickNumber(input, "shotScore");
  if (shotScore !== undefined) item.shotScore = shotScore;
  return item;
}

export function sanitizeIndex(input: unknown): RecommendationIndex {
  if (!isRecord(input)) return emptyIndex;
  return {
    version: 1,
    updatedAt: pickString(input, "updatedAt") ?? emptyIndex.updatedAt,
    items: Array.isArray(input.items) ? input.items.map(sanitizeIndexItem).filter((item): item is RecommendationIndexItem => Boolean(item)) : []
  };
}

export async function loadIndex(github: GitHubJsonClient): Promise<RecommendationIndex> {
  return sanitizeIndex(await github.readJson<unknown>(indexPath, emptyIndex));
}

export async function loadIndexWithSha(github: GitHubJsonClient): Promise<LoadedRecommendationIndex> {
  const loaded = await github.readJsonWithSha<unknown>(indexPath, emptyIndex);
  return {
    index: sanitizeIndex(loaded.value),
    sha: loaded.sha
  };
}

export async function saveIndex(github: GitHubJsonClient, records: RecommendationRecord[], now: string, expectedSha?: string): Promise<RecommendationIndex> {
  const index: RecommendationIndex = {
    version: 1,
    updatedAt: now,
    items: records.map(buildIndexItem).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  };

  await github.writeJsonWithSha(indexPath, index, "Rebuild recommendation index", expectedSha);
  return index;
}
