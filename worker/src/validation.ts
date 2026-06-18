import type { BurrType, PublicRecommendationRecord, RecommendationIndexItem, RecommendationInput, RecommendationRecord, ValidationResult } from "./types";

type UnknownRecord = Record<string, unknown>;

const requiredObjectFields = ["bag", "profile", "grinder", "brew"] as const;
const safeJsonFileNamePattern = /^(?!.*\.\.)[A-Za-z0-9._-]{1,120}\.json$/;

export function isEmailLike(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value.trim());
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeJsonFileName(value: string): boolean {
  return safeJsonFileNamePattern.test(value);
}

function requireString(record: UnknownRecord, field: string, missing: string[], path: string = field): string {
  const value = record[field];
  const trimmed = cleanText(value);
  if (!trimmed) missing.push(path);
  return trimmed;
}

function optionalString(record: UnknownRecord, field: string, invalid: string[], path: string = field): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    invalid.push(path);
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalText(record: UnknownRecord, field: string): string | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return undefined;
}

function requireBurrType(record: UnknownRecord, field: string, missing: string[], invalid: string[], path: string = field): BurrType | undefined {
  const trimmed = cleanText(record[field]).toLowerCase();
  if (!trimmed) {
    missing.push(path);
    return undefined;
  }
  if (trimmed !== "flat" && trimmed !== "conical") {
    invalid.push(path);
    return undefined;
  }
  return trimmed;
}

function requireNumber(record: UnknownRecord, field: string, missing: string[], path: string = field): number {
  const value = record[field];
  if (!validNumber(value)) missing.push(path);
  return typeof value === "number" ? value : 0;
}

function optionalNumber(record: UnknownRecord, field: string, invalid: string[], path: string = field): number | undefined {
  const value = record[field];
  if (value === undefined || value === null) return undefined;
  if (!validNumber(value)) {
    invalid.push(path);
    return undefined;
  }
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function validateRecommendationInput(input: unknown): ValidationResult<RecommendationInput> {
  if (!isRecord(input)) {
    return { ok: false, error: "Recommendation must be an object." };
  }

  const missing: string[] = [];

  for (const field of requiredObjectFields) {
    if (!isRecord(input[field])) missing.push(field);
  }

  if (missing.length > 0) {
    return { ok: false, error: `Missing required fields: ${missing.join(", ")}.` };
  }

  const bag = input.bag as UnknownRecord;
  const profile = input.profile as UnknownRecord;
  const grinder = input.grinder as UnknownRecord;
  const brew = input.brew as UnknownRecord;
  const invalid: string[] = [];
  const normalized: RecommendationInput = {
    submittedBy: requireString(input, "submittedBy", missing),
    bag: {
      id: requireString(bag, "id", missing, "bag.id"),
      beanId: requireString(bag, "beanId", missing, "bag.beanId"),
      roaster: requireString(bag, "roaster", missing, "bag.roaster"),
      bean: requireString(bag, "bean", missing, "bag.bean"),
      country: requireString(bag, "country", missing, "bag.country"),
      process: requireString(bag, "process", missing, "bag.process"),
      roastDate: requireString(bag, "roastDate", missing, "bag.roastDate")
    },
    profile: {
      originalId: requireString(profile, "originalId", missing, "profile.originalId"),
      originalTitle: requireString(profile, "originalTitle", missing, "profile.originalTitle"),
      fileName: requireString(profile, "fileName", missing, "profile.fileName"),
      installedTitle: requireString(profile, "installedTitle", missing, "profile.installedTitle")
    },
    grinder: {
      id: requireString(grinder, "id", missing, "grinder.id"),
      model: requireString(grinder, "model", missing, "grinder.model")
    },
    brew: {
      grindSetting: requireString(brew, "grindSetting", missing, "brew.grindSetting"),
      beansWeight: requireNumber(brew, "beansWeight", missing, "brew.beansWeight"),
      drinkWeight: requireNumber(brew, "drinkWeight", missing, "brew.drinkWeight"),
      notes: requireString(brew, "notes", missing, "brew.notes")
    }
  };

  const bagName = optionalText(bag, "name");
  if (bagName) normalized.bag.name = bagName;
  const bagRegion = optionalText(bag, "region");
  if (bagRegion) normalized.bag.region = bagRegion;
  const bagRoastLevel = optionalText(bag, "roastLevel");
  if (bagRoastLevel) normalized.bag.roastLevel = bagRoastLevel;
  const bagNotes = optionalText(bag, "notes");
  if (bagNotes) normalized.bag.notes = bagNotes;

  const grinderBurrs = optionalText(grinder, "burrs");
  if (grinderBurrs) normalized.grinder.burrs = grinderBurrs;
  const grinderBurrType = requireBurrType(grinder, "burrType", missing, invalid, "grinder.burrType");
  if (grinderBurrType) normalized.grinder.burrType = grinderBurrType;
  const grinderNotes = optionalText(grinder, "notes");
  if (grinderNotes) normalized.grinder.notes = grinderNotes;
  const settingType = grinder.settingType;
  if (settingType !== undefined && settingType !== null) {
    if (settingType === "numeric" || settingType === "preset") {
      normalized.grinder.settingType = settingType;
    }
  }

  const secondsGoal = optionalNumber(brew, "secondsGoal", invalid, "brew.secondsGoal");
  const secondsMin = optionalNumber(brew, "secondsMin", invalid, "brew.secondsMin");
  const secondsMax = optionalNumber(brew, "secondsMax", invalid, "brew.secondsMax");
  if (secondsGoal !== undefined) {
    normalized.brew.secondsGoal = secondsGoal;
  } else if (secondsMin !== undefined && secondsMax !== undefined && secondsMin <= secondsMax) {
    normalized.brew.secondsMin = secondsMin;
    normalized.brew.secondsMax = secondsMax;
  } else {
    missing.push("brew.secondsGoalOrRange");
  }

  const visualizerUrl = optionalString(input, "visualizerUrl", invalid);
  if (visualizerUrl) normalized.visualizerUrl = visualizerUrl;
  const evidenceFileName = optionalString(input, "evidenceFileName", invalid);
  if (evidenceFileName) normalized.evidenceFileName = evidenceFileName;

  if (missing.length > 0) {
    return { ok: false, error: `Missing required fields: ${missing.join(", ")}.` };
  }

  if (invalid.length > 0) {
    return { ok: false, error: `Invalid field types: ${invalid.join(", ")}.` };
  }

  if (isEmailLike(normalized.submittedBy)) {
    return { ok: false, error: "Public display name is required; email addresses are not allowed." };
  }

  if (!isSafeJsonFileName(normalized.profile.fileName) || (normalized.evidenceFileName !== undefined && !isSafeJsonFileName(normalized.evidenceFileName))) {
    return { ok: false, error: "File names must be safe JSON file names." };
  }

  if (normalized.visualizerUrl && !validHttpUrl(normalized.visualizerUrl)) {
    return { ok: false, error: "Visualizer URL must be a valid HTTP or HTTPS URL." };
  }

  return { ok: true, value: normalized };
}

export function validateProfileJson(profileJson: unknown): ValidationResult<unknown> {
  if (!profileJson || typeof profileJson !== "object" || Array.isArray(profileJson)) {
    return { ok: false, error: "Profile JSON must be an object." };
  }
  const profile = profileJson as { title?: unknown; steps?: unknown };
  if (profile.title !== undefined && typeof profile.title !== "string") {
    return { ok: false, error: "Profile title must be a string when present." };
  }
  if (profile.steps !== undefined && !Array.isArray(profile.steps)) {
    return { ok: false, error: "Profile steps must be an array when present." };
  }
  return { ok: true, value: profileJson };
}

export function buildSearchText(record: RecommendationInput & { shotScore?: number }): string {
  return [
    record.submittedBy,
    record.bag.id,
    record.bag.beanId,
    record.bag.roaster,
    record.bag.name,
    record.bag.bean,
    record.bag.country,
    record.bag.region,
    record.bag.process,
    record.bag.roastDate,
    record.bag.roastLevel,
    record.bag.notes,
    record.profile.originalId,
    record.profile.originalTitle,
    record.profile.fileName,
    record.profile.installedTitle,
    record.grinder.id,
    record.grinder.model,
    record.grinder.burrType,
    record.grinder.burrs,
    record.grinder.settingType,
    record.grinder.notes,
    record.brew.grindSetting,
    record.brew.beansWeight,
    record.brew.drinkWeight,
    record.brew.secondsGoal,
    record.brew.secondsMin,
    record.brew.secondsMax,
    record.brew.notes,
    record.visualizerUrl,
    record.evidenceFileName,
    record.shotScore
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim())
    .join(" ")
    .toLowerCase();
}

export function buildIndexItem(record: RecommendationRecord): RecommendationIndexItem {
  return {
    id: record.id,
    updatedAt: record.updatedAt,
    submittedBy: record.submittedBy,
    bag: { ...record.bag },
    profile: { ...record.profile },
    grinder: { ...record.grinder },
    brew: { ...record.brew },
    visualizerUrl: record.visualizerUrl,
    evidenceFileName: record.evidenceFileName,
    shotScore: record.shotScore,
    searchText: buildSearchText(record)
  };
}

export function toPublicRecommendation(record: RecommendationRecord): PublicRecommendationRecord {
  const { ownerHash: _ownerHash, ...publicRecord } = record;
  return {
    ...publicRecord,
    bag: { ...record.bag },
    profile: { ...record.profile },
    grinder: { ...record.grinder },
    brew: { ...record.brew }
  };
}
