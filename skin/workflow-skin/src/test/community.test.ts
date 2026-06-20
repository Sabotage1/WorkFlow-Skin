import { describe, expect, it } from "vitest";
import type { Profile, ShotRecord } from "../api/types";
import type { CommunityRecommendation } from "../community/types";
import { publicNameFromDecentAccount } from "../community/identity";
import { communityProfileTitle, profilePayloadForCommunityInstall, shortRecommendationId } from "../community/profileInstall";
import { matchesCommunitySearch } from "../community/search";
import { sanitizeShotEvidence } from "../community/evidence";

const recommendation: CommunityRecommendation = {
  id: "rec-12345678",
  createdAt: "2026-06-18T00:00:00.000Z",
  updatedAt: "2026-06-18T00:00:00.000Z",
  submittedBy: "Roy",
  bag: {
    id: "batch-1",
    beanId: "bean-1",
    roaster: "Pilot",
    name: "Halo",
    bean: "Ethiopia Halo",
    country: "Ethiopia",
    region: "Yirgacheffe",
    process: "Washed",
    roastDate: "2026-06-01",
    roastLevel: "Light",
    notes: "floral"
  },
  profile: {
    originalId: "profile-1",
    originalTitle: "Blooming",
    fileName: "rec-12345678.json",
    installedTitle: "Blooming - Halo - Roy"
  },
  grinder: { id: "grinder-1", model: "ZP6", burrType: "flat", settingType: "numeric" },
  brew: {
    grindSetting: "4.2",
    beansWeight: 18,
    drinkWeight: 42,
    secondsMin: 28,
    secondsMax: 34,
    notes: "Gentle declining pressure"
  },
  visualizerUrl: "https://visualizer.coffee/shots/abc",
  evidenceFileName: "rec-12345678.json"
};

describe("community identity helpers", () => {
  it("uses connected non-email Decent display names and usernames", () => {
    expect(publicNameFromDecentAccount({ connected: true, displayName: "  Roy  ", username: "roy@example.com" })).toBe("Roy");
    expect(publicNameFromDecentAccount({ connected: true, username: "royackerman" })).toBe("royackerman");
  });

  it("rejects email-only usernames and embedded email candidates", () => {
    expect(publicNameFromDecentAccount({ connected: true, username: "roy@example.com" })).toBeNull();
    expect(publicNameFromDecentAccount({ connected: true, displayName: "Roy <roy@example.com>", username: "roy@example.com" })).toBeNull();
  });

  it("returns null when the Decent account is disconnected", () => {
    expect(publicNameFromDecentAccount({ connected: false, displayName: "Roy" })).toBeNull();
    expect(publicNameFromDecentAccount(undefined)).toBeNull();
  });
});

describe("community profile installation helpers", () => {
  it("returns a recognizable duplicate-safe community profile title", () => {
    expect(communityProfileTitle(recommendation)).toBe("Blooming - Halo - Roy - rec-12345678");
  });

  it("shortens hyphenated recommendation ids using the first two segments", () => {
    expect(shortRecommendationId("rec-12345678")).toBe("rec-12345678");
    expect(shortRecommendationId("123e4567-e89b-12d3-a456-426614174000")).toBe("123e4567-e89b");
  });

  it("builds a create-profile payload with renamed profile and community metadata", () => {
    const profileJson: Profile = {
      title: "Blooming",
      author: "Original Author",
      notes: "Existing notes",
      beverage_type: "espresso",
      steps: [{ name: "bloom", pressure: 2 }]
    };

    const payload = profilePayloadForCommunityInstall(recommendation, profileJson);

    expect(payload).toEqual({
      profile: {
        title: "Blooming - Halo - Roy - rec-12345678",
        author: "Roy",
        notes: "Existing notes\n\nCommunity recommendation: rec-12345678",
        beverage_type: "espresso",
        steps: [{ name: "bloom", pressure: 2 }]
      },
      metadata: {
        communityRecommendationId: "rec-12345678",
        communityRecommendationUpdatedAt: "2026-06-18T00:00:00.000Z",
        communitySubmittedBy: "Roy"
      }
    });
    expect(profileJson.title).toBe("Blooming");
  });
});

describe("community search helpers", () => {
  it("matches across bag, recommendation, grinder, and brew fields", () => {
    expect(matchesCommunitySearch(recommendation, "yirgacheffe")).toBe(true);
    expect(matchesCommunitySearch(recommendation, "zp6")).toBe(true);
    expect(matchesCommunitySearch(recommendation, "flat")).toBe(true);
    expect(matchesCommunitySearch(recommendation, "gentle declining")).toBe(true);
    expect(matchesCommunitySearch(recommendation, "declining pressure")).toBe(true);
    expect(matchesCommunitySearch(recommendation, "rec-12345678")).toBe(true);
    expect(matchesCommunitySearch(recommendation, "not-here")).toBe(false);
    expect(matchesCommunitySearch(recommendation, "missing text")).toBe(false);
  });
});

describe("community evidence helpers", () => {
  it("keeps safe shot graph and review data while omitting private metadata", () => {
    const shot: ShotRecord = {
      id: "shot-1",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: {
        profile: { title: "Blooming" },
        context: {
          grinderId: "grinder-1",
          grinderModel: "ZP6",
          grinderSetting: "4.2",
          drinkerName: "Private Drinker",
          extras: { privateToken: "secret" }
        }
      },
      annotations: {
        actualDoseWeight: 18,
        actualYield: 42,
        drinkTds: 9.8,
        drinkEy: 22.9,
        enjoyment: 8,
        espressoNotes: "sweet florals",
        extras: { privateCalibration: "secret" }
      },
      measurements: [
        {
          machine: { timestamp: "2026-06-18T08:00:01.000Z", pressure: 2, flow: 3 },
          scale: { timestamp: "2026-06-18T08:00:01.000Z", weight: 1.2, weightFlow: 0.5 }
        }
      ],
      metadata: { ownerHash: "private", accountEmail: "roy@example.com" }
    };

    expect(sanitizeShotEvidence(shot)).toEqual({
      id: "shot-1",
      timestamp: "2026-06-18T08:00:00.000Z",
      profileTitle: "Blooming",
      doseWeight: 18,
      drinkWeight: 42,
      tds: 9.8,
      ey: 22.9,
      enjoyment: 8,
      notes: "sweet florals",
      grindSetting: "4.2",
      grinderId: "grinder-1",
      measurements: [
        {
          machine: { timestamp: "2026-06-18T08:00:01.000Z", pressure: 2, flow: 3 },
          scale: { timestamp: "2026-06-18T08:00:01.000Z", weight: 1.2, weightFlow: 0.5 }
        }
      ]
    });
  });

  it("drops private nested measurement fields from public evidence", () => {
    const shot: ShotRecord = {
      id: "shot-private-measurements",
      timestamp: "2026-06-18T08:00:00.000Z",
      workflow: { profile: { title: "Blooming" }, context: {} },
      measurements: [
        {
          machine: {
            timestamp: "2026-06-18T08:00:01.000Z",
            pressure: 2,
            targetPressure: 3,
            flow: 1.1,
            targetFlow: 1.2,
            mixTemperature: 92,
            groupTemperature: 91,
            targetMixTemperature: 93,
            targetGroupTemperature: 92,
            state: { state: "espresso", substate: "pour", privateState: "secret" },
            firmwareSecret: "private"
          },
          scale: {
            timestamp: "2026-06-18T08:00:01.000Z",
            weight: 12,
            weightFlow: 0.6,
            battery: 80,
            timerValue: 12.5,
            bluetoothAddress: "private"
          },
          rawPacket: "private"
        } as unknown as NonNullable<ShotRecord["measurements"]>[number]
      ]
    };

    expect(sanitizeShotEvidence(shot).measurements).toEqual([
      {
        machine: {
          timestamp: "2026-06-18T08:00:01.000Z",
          pressure: 2,
          targetPressure: 3,
          flow: 1.1,
          targetFlow: 1.2,
          mixTemperature: 92,
          groupTemperature: 91,
          targetMixTemperature: 93,
          targetGroupTemperature: 92,
          state: { state: "espresso", substate: "pour" }
        },
        scale: {
          timestamp: "2026-06-18T08:00:01.000Z",
          weight: 12,
          weightFlow: 0.6,
          battery: 80,
          timerValue: 12.5
        }
      }
    ]);
  });
});
