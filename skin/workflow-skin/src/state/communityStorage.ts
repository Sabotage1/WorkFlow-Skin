import type { DownloadedCommunityProfile, UploadedCommunityProfile } from "../community/types";
import { SKIN_NAMESPACE, type KvApi } from "./skinSettings";

export const COMMUNITY_OWNER_KEY = "community-owner-key";
export const COMMUNITY_DISPLAY_NAME_KEY = "community-display-name";
export const COMMUNITY_DOWNLOADED_KEY = "community-downloaded-profiles";
export const COMMUNITY_UPLOADED_KEY = "community-uploaded-profiles";
export const COMMUNITY_RECOMMENDATION_RATINGS_KEY = "community-recommendation-ratings";

export type CommunityRecommendationRatings = Record<string, number>;

function uuidFromBytes(bytes: Uint8Array): string {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function randomUuid(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();

  const bytes = new Uint8Array(16);
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
    return uuidFromBytes(bytes);
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
  return uuidFromBytes(bytes);
}

function ownerKey(): string {
  return `workflow-owner-${randomUuid()}`;
}

export async function getOrCreateCommunityOwnerKey(api: KvApi): Promise<string> {
  const existing = await api.getKv<unknown>(SKIN_NAMESPACE, COMMUNITY_OWNER_KEY);
  if (typeof existing === "string" && existing.trim()) return existing.trim();
  const next = ownerKey();
  await api.putKv(SKIN_NAMESPACE, COMMUNITY_OWNER_KEY, next);
  return next;
}

export async function loadCommunityDisplayName(api: KvApi): Promise<string | null> {
  const value = await api.getKv<unknown>(SKIN_NAMESPACE, COMMUNITY_DISPLAY_NAME_KEY);
  return typeof value === "string" ? value.trim() || null : null;
}

export async function saveCommunityDisplayName(api: KvApi, value: string): Promise<void> {
  await api.putKv(SKIN_NAMESPACE, COMMUNITY_DISPLAY_NAME_KEY, value.trim());
}

export async function loadDownloadedCommunityProfiles(api: KvApi): Promise<DownloadedCommunityProfile[]> {
  const value = await api.getKv<unknown>(SKIN_NAMESPACE, COMMUNITY_DOWNLOADED_KEY);
  return Array.isArray(value) ? (value as DownloadedCommunityProfile[]) : [];
}

export async function saveDownloadedCommunityProfiles(api: KvApi, value: DownloadedCommunityProfile[]): Promise<void> {
  await api.putKv(SKIN_NAMESPACE, COMMUNITY_DOWNLOADED_KEY, value);
}

export async function loadUploadedCommunityProfiles(api: KvApi): Promise<UploadedCommunityProfile[]> {
  const value = await api.getKv<unknown>(SKIN_NAMESPACE, COMMUNITY_UPLOADED_KEY);
  return Array.isArray(value) ? (value as UploadedCommunityProfile[]) : [];
}

export async function saveUploadedCommunityProfiles(api: KvApi, value: UploadedCommunityProfile[]): Promise<void> {
  await api.putKv(SKIN_NAMESPACE, COMMUNITY_UPLOADED_KEY, value);
}

export async function loadCommunityRecommendationRatings(api: KvApi): Promise<CommunityRecommendationRatings> {
  const value = await api.getKv<unknown>(SKIN_NAMESPACE, COMMUNITY_RECOMMENDATION_RATINGS_KEY);
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const ratings: CommunityRecommendationRatings = {};
  for (const [recommendationId, rating] of Object.entries(value)) {
    if (typeof rating === "number" && Number.isInteger(rating) && rating >= 1 && rating <= 5) {
      ratings[recommendationId] = rating;
    }
  }
  return ratings;
}

export async function saveCommunityRecommendationRatings(api: KvApi, value: CommunityRecommendationRatings): Promise<void> {
  await api.putKv(SKIN_NAMESPACE, COMMUNITY_RECOMMENDATION_RATINGS_KEY, value);
}
