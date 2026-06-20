import type { CommunityRecommendation } from "./types";

function collectSearchParts(value: unknown, parts: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectSearchParts(item, parts));
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((item) => collectSearchParts(item, parts));
  }
}

export function communitySearchText(recommendation: CommunityRecommendation): string {
  const parts: string[] = [];
  collectSearchParts(recommendation, parts);
  return parts.join(" ").toLowerCase();
}

export function matchesCommunitySearch(recommendation: CommunityRecommendation, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return communitySearchText(recommendation).includes(normalizedQuery);
}
