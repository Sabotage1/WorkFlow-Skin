import { describe, expect, it } from "vitest";
import type { ProfileRecord, ShotRecord } from "../api/types";
import { postActivityPage, postShotPageForShot, selectedProfileIdFromWorkflow } from "../lib/workflowRouting";
import { defaultSkinSettings } from "../state/skinSettings";

const profiles: ProfileRecord[] = [
  { id: "espresso", profile: { title: "Straight Espresso" } },
  { id: "milk", profile: { title: "Flat White" } }
];

function shotWithProfile(profileId: string): ShotRecord {
  return {
    id: "shot-1",
    timestamp: "2026-06-10T09:00:00Z",
    workflow: {
      profile: profiles.find((profile) => profile.id === profileId)?.profile,
      context: { extras: { workflowSkin: { selectedProfileId: profileId } } }
    }
  };
}

describe("postShotPageForShot", () => {
  it("ignores stale selected profile metadata when the workflow profile title points to another saved profile", () => {
    expect(
      selectedProfileIdFromWorkflow(
        {
          profile: { title: "Flat White" },
          context: { extras: { workflowSkin: { selectedProfileId: "espresso" } } }
        },
        profiles
      )
    ).toBe("milk");
  });

  it("uses selected profile metadata when the workflow profile title is not a saved profile title", () => {
    expect(
      selectedProfileIdFromWorkflow(
        {
          profile: { title: "History espresso" },
          context: { extras: { workflowSkin: { selectedProfileId: "espresso" } } }
        },
        profiles
      )
    ).toBe("espresso");
  });

  it("routes milk profiles to review first when review is enabled", () => {
    const settings = {
      ...defaultSkinSettings,
      profileWorkflows: {
        milk: { milkBased: true, steamTimers: { small: 22, medium: 34, large: 48 } }
      }
    };

    expect(postShotPageForShot(shotWithProfile("milk"), settings, profiles)).toBe("review");
  });

  it("routes milk profiles to steam when review is disabled", () => {
    const settings = {
      ...defaultSkinSettings,
      profileWorkflows: {
        milk: { milkBased: true, steamTimers: { small: 22, medium: 34, large: 48 } }
      },
      reviewEnabledByProfile: { milk: false }
    };

    expect(postShotPageForShot(shotWithProfile("milk"), settings, profiles)).toBe("steam");
  });

  it("routes non-milk profiles to review when review is enabled", () => {
    expect(postShotPageForShot(shotWithProfile("espresso"), defaultSkinSettings, profiles)).toBe("review");
  });

  it("does not route non-milk brews to steam when review is disabled", () => {
    expect(postActivityPage("brew", "espresso", { ...defaultSkinSettings, defaultReviewEnabled: false })).toBeNull();
  });

  it("routes completed steam sessions back to review", () => {
    expect(postActivityPage("steam", "espresso", { ...defaultSkinSettings, defaultReviewEnabled: false })).toBe("review");
  });
});
