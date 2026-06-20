import { describe, expect, it, vi } from "vitest";
import {
  getOrCreateCommunityOwnerKey,
  loadCommunityRecommendationRatings,
  loadCommunityDisplayName,
  loadDownloadedCommunityProfiles,
  loadUploadedCommunityProfiles,
  saveCommunityRecommendationRatings,
  saveCommunityDisplayName,
  saveDownloadedCommunityProfiles,
  saveUploadedCommunityProfiles
} from "../state/communityStorage";

const downloadedProfile = {
  recommendationId: "rec-1",
  localProfileId: "profile-1",
  localProfileTitle: "Bloom",
  downloadedAt: "2026-06-18T10:00:00Z",
  updatedAt: "2026-06-18T10:00:00Z",
  recommendation: {
    id: "rec-1",
    createdAt: "2026-06-18T10:00:00Z",
    updatedAt: "2026-06-18T10:00:00Z",
    submittedBy: "Roy",
    bag: {
      id: "bag-1",
      beanId: "bean-1",
      roaster: "Pilot",
      bean: "Halo",
      country: "Ethiopia",
      process: "Washed",
      roastDate: "2026-06-01"
    },
    profile: {
      originalId: "profile-1",
      originalTitle: "Bloom",
      fileName: "bloom.json",
      installedTitle: "Bloom"
    },
    grinder: {
      id: "grinder-1",
      model: "Niche"
    },
    brew: {
      grindSetting: "12",
      beansWeight: 18,
      drinkWeight: 40,
      notes: "Sweet"
    }
  }
};

const uploadedProfile = {
  recommendationId: "rec-1",
  uploadedAt: "2026-06-18T10:00:00Z",
  updatedAt: "2026-06-18T10:00:00Z",
  recommendation: downloadedProfile.recommendation
};

describe("community storage", () => {
  it("creates and reuses an owner key", async () => {
    const api = { getKv: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("owner-key"), putKv: vi.fn().mockResolvedValue(undefined) };
    const first = await getOrCreateCommunityOwnerKey(api);
    const second = await getOrCreateCommunityOwnerKey(api);
    expect(first).toMatch(/^workflow-owner-/);
    expect(second).toBe("owner-key");
    expect(api.putKv).toHaveBeenCalledTimes(1);
  });

  it("creates an owner key in WebViews without crypto.randomUUID", async () => {
    const originalCrypto = globalThis.crypto;
    const cryptoWithoutRandomUUID = {
      getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto)
    } as Crypto;
    Object.defineProperty(cryptoWithoutRandomUUID, "randomUUID", { value: undefined, configurable: true });
    Object.defineProperty(globalThis, "crypto", { value: cryptoWithoutRandomUUID, configurable: true });
    const api = { getKv: vi.fn().mockResolvedValue(null), putKv: vi.fn().mockResolvedValue(undefined) };

    try {
      const key = await getOrCreateCommunityOwnerKey(api);
      expect(key).toMatch(/^workflow-owner-/);
      expect(api.putKv).toHaveBeenCalledWith("workflow-skin", "community-owner-key", key);
    } finally {
      Object.defineProperty(globalThis, "crypto", { value: originalCrypto, configurable: true });
    }
  });

  it("saves a manual display name locally", async () => {
    const api = { getKv: vi.fn().mockResolvedValue("Roy"), putKv: vi.fn().mockResolvedValue(undefined) };
    await saveCommunityDisplayName(api, " Roy ");
    expect(api.putKv).toHaveBeenCalledWith("workflow-skin", "community-display-name", "Roy");
    await expect(loadCommunityDisplayName(api)).resolves.toBe("Roy");
  });

  it("loads and saves downloaded profile arrays", async () => {
    const api = { getKv: vi.fn().mockResolvedValue([downloadedProfile]), putKv: vi.fn().mockResolvedValue(undefined) };
    await expect(loadDownloadedCommunityProfiles(api)).resolves.toEqual([downloadedProfile]);
    await saveDownloadedCommunityProfiles(api, [downloadedProfile]);
    expect(api.putKv).toHaveBeenCalledWith("workflow-skin", "community-downloaded-profiles", [downloadedProfile]);
  });

  it("loads and saves uploaded profile arrays", async () => {
    const api = { getKv: vi.fn().mockResolvedValue([uploadedProfile]), putKv: vi.fn().mockResolvedValue(undefined) };
    await expect(loadUploadedCommunityProfiles(api)).resolves.toEqual([uploadedProfile]);
    await saveUploadedCommunityProfiles(api, [uploadedProfile]);
    expect(api.putKv).toHaveBeenCalledWith("workflow-skin", "community-uploaded-profiles", [uploadedProfile]);
  });

  it("loads and saves local recommendation ranks", async () => {
    const api = { getKv: vi.fn().mockResolvedValue({ "rec-1": 4, bad: 9, text: "5" }), putKv: vi.fn().mockResolvedValue(undefined) };
    await expect(loadCommunityRecommendationRatings(api)).resolves.toEqual({ "rec-1": 4 });
    await saveCommunityRecommendationRatings(api, { "rec-1": 4, "rec-2": 5 });
    expect(api.putKv).toHaveBeenCalledWith("workflow-skin", "community-recommendation-ratings", { "rec-1": 4, "rec-2": 5 });
  });

  it("ignores malformed persisted values without throwing", async () => {
    const api = {
      getKv: vi.fn().mockResolvedValueOnce(42).mockResolvedValueOnce({ name: "Roy" }).mockResolvedValueOnce({ bad: true }).mockResolvedValueOnce("bad").mockResolvedValueOnce([]),
      putKv: vi.fn().mockResolvedValue(undefined)
    };

    await expect(getOrCreateCommunityOwnerKey(api)).resolves.toMatch(/^workflow-owner-/);
    await expect(loadCommunityDisplayName(api)).resolves.toBeNull();
    await expect(loadDownloadedCommunityProfiles(api)).resolves.toEqual([]);
    await expect(loadUploadedCommunityProfiles(api)).resolves.toEqual([]);
    await expect(loadCommunityRecommendationRatings(api)).resolves.toEqual({});
    expect(api.putKv).toHaveBeenCalledTimes(1);
  });
});
