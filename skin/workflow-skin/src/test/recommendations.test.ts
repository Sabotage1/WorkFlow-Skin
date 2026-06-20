import { describe, expect, it } from "vitest";
import type { ProfileRecord, ShotRecord } from "../api/types";
import type { Bag } from "../lib/bags";
import { recommendProfiles } from "../lib/recommendations";

const bag: Bag = {
  id: "batch-1",
  beanId: "bean-1",
  roaster: "April",
  bean: "Ethiopia",
  country: "Ethiopia",
  process: "washed",
  roastDate: "2026-06-01T00:00:00Z",
  roastLevel: "light"
};

const profiles: ProfileRecord[] = [
  { id: "p1", profile: { title: "Blooming" } },
  { id: "p2", profile: { title: "Classic" } }
];

const shots: ShotRecord[] = [
  {
    id: "s1",
    timestamp: "2026-06-08T10:00:00Z",
    workflow: { profile: { title: "Blooming" }, context: { beanBatchId: "batch-1" } },
    annotations: { drinkEy: 21, enjoyment: 8 }
  },
  {
    id: "s2",
    timestamp: "2026-06-07T10:00:00Z",
    workflow: { profile: { title: "Classic" }, context: { beanBatchId: "other" } },
    annotations: { drinkEy: 17, enjoyment: 4 }
  }
];

describe("recommendProfiles", () => {
  it("ranks profiles with same-bag successful shots first and explains why", () => {
    const ranked = recommendProfiles({ profiles, shots, selectedBag: bag, bags: [bag], preferredEy: [19, 23] });
    expect(ranked[0].profile.id).toBe("p1");
    expect(ranked[0].reasons).toContain("1 previous shot on this bag");
    expect(ranked[0].reasons).toContain("average enjoyment 8.0");
  });

  it("does not let a failed same-bag shot outrank successful relevant history", () => {
    const relatedBag: Bag = { ...bag, id: "batch-2" };
    const ranked = recommendProfiles({
      profiles: [
        { id: "bad", profile: { title: "Bad Same Bag" } },
        { id: "good", profile: { title: "Good Related Bag" } }
      ],
      shots: [
        {
          id: "bad-shot",
          timestamp: "2026-06-09T10:00:00Z",
          workflow: { profile: { title: "Bad Same Bag" }, context: { beanBatchId: "batch-1" } },
          annotations: { drinkEy: 15, enjoyment: 2 }
        },
        {
          id: "good-shot",
          timestamp: "2026-06-09T11:00:00Z",
          workflow: { profile: { title: "Good Related Bag" }, context: { beanBatchId: "batch-2" } },
          annotations: { drinkEy: 21, enjoyment: 8 }
        }
      ],
      selectedBag: bag,
      bags: [bag, relatedBag],
      preferredEy: [19, 23]
    });

    expect(ranked[0].profile.id).toBe("good");
    expect(ranked.find((rec) => rec.profile.id === "bad")!.score).toBeLessThan(ranked.find((rec) => rec.profile.id === "good")!.score);
  });

  it("ignores history for duplicate profile titles", () => {
    const ranked = recommendProfiles({
      profiles: [
        { id: "dup-a", profile: { title: "Shared" } },
        { id: "dup-b", profile: { title: "Shared" } }
      ],
      shots: [
        {
          id: "ambiguous-shot",
          timestamp: "2026-06-09T10:00:00Z",
          workflow: { profile: { title: "Shared" }, context: { beanBatchId: "batch-1" } },
          annotations: { drinkEy: 21, enjoyment: 9 }
        }
      ],
      selectedBag: bag,
      bags: [bag],
      preferredEy: [19, 23]
    });

    expect(ranked.map((rec) => rec.score)).toEqual([0, 0]);
    expect(ranked.map((rec) => rec.reasons)).toEqual([
      ["available profile with no matching history"],
      ["available profile with no matching history"]
    ]);
  });

  it("does not crash when sorting untitled profiles", () => {
    const ranked = recommendProfiles({
      profiles: [
        { id: "named", profile: { title: "Named" } },
        { id: "untitled", profile: {} }
      ],
      shots: [],
      selectedBag: bag,
      bags: [bag],
      preferredEy: [19, 23]
    });

    expect(ranked.map((rec) => rec.profile.id)).toEqual(["named", "untitled"]);
  });
});
