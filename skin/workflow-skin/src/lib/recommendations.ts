import type { ProfileRecord, ShotRecord } from "../api/types";
import type { Bag } from "./bags";

export interface Recommendation {
  profile: ProfileRecord;
  score: number;
  reasons: string[];
}

function validTitle(title: string | undefined): string | undefined {
  return title?.trim() ? title : undefined;
}

function displayTitle(profile: ProfileRecord): string {
  return validTitle(profile.profile.title) ?? profile.id;
}

function isPreferredEy(ey: number | undefined, preferredEy: [number, number]): boolean {
  return typeof ey === "number" && ey >= preferredEy[0] && ey <= preferredEy[1];
}

function isSuccessfulShot(shot: ShotRecord, preferredEy: [number, number]): boolean {
  return (shot.annotations?.enjoyment ?? 0) >= 7 || isPreferredEy(shot.annotations?.drinkEy, preferredEy);
}

export function recommendProfiles(input: {
  profiles: ProfileRecord[];
  shots: ShotRecord[];
  selectedBag?: Bag;
  bags: Bag[];
  preferredEy: [number, number];
}): Recommendation[] {
  const titleCounts = new Map<string, number>();
  for (const profile of input.profiles) {
    const title = validTitle(profile.profile.title);
    if (title) titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
  }
  const titleToProfile = new Map(
    input.profiles
      .map((profile): [string, ProfileRecord] | undefined => {
        const title = validTitle(profile.profile.title);
        return title && titleCounts.get(title) === 1 ? [title, profile] : undefined;
      })
      .filter((value): value is [string, ProfileRecord] => Boolean(value))
  );
  const bagById = new Map(input.bags.map((bag) => [bag.id, bag]));
  const scores = new Map<string, Recommendation>();
  const matchedShotsByProfileId = new Map<string, ShotRecord[]>();

  for (const profile of input.profiles) {
    scores.set(profile.id, { profile, score: 0, reasons: [] });
  }

  for (const shot of input.shots) {
    const shotTitle = validTitle(shot.workflow.profile?.title);
    const profile = shotTitle ? titleToProfile.get(shotTitle) : undefined;
    if (!profile) continue;
    const rec = scores.get(profile.id);
    if (!rec) continue;
    matchedShotsByProfileId.set(profile.id, [...(matchedShotsByProfileId.get(profile.id) ?? []), shot]);
    const shotBagId = shot.workflow.context?.beanBatchId;
    const shotBag = shotBagId ? bagById.get(shotBagId) : undefined;
    const sameBag = input.selectedBag?.id && shotBagId === input.selectedBag.id;
    const sameProcess = input.selectedBag?.process && shotBag?.process === input.selectedBag.process;
    const sameCountry = input.selectedBag?.country && shotBag?.country === input.selectedBag.country;
    const ey = shot.annotations?.drinkEy;
    const enjoyment = shot.annotations?.enjoyment;
    const preferredEy = isPreferredEy(ey, input.preferredEy);
    const successfulShot = isSuccessfulShot(shot, input.preferredEy);

    if (sameBag && successfulShot) rec.score += 50;
    if (sameProcess) rec.score += 12;
    if (sameCountry) rec.score += 6;
    if (typeof enjoyment === "number") rec.score += enjoyment * 3;
    if (preferredEy) rec.score += 15;
  }

  for (const rec of scores.values()) {
    const matchingShots = matchedShotsByProfileId.get(rec.profile.id) ?? [];
    const sameBagShots = matchingShots.filter((shot) => shot.workflow.context?.beanBatchId === input.selectedBag?.id);
    const enjoymentValues = matchingShots.map((shot) => shot.annotations?.enjoyment).filter((value): value is number => typeof value === "number");
    if (sameBagShots.length) rec.reasons.push(`${sameBagShots.length} previous shot${sameBagShots.length === 1 ? "" : "s"} on this bag`);
    if (enjoymentValues.length) {
      const avg = enjoymentValues.reduce((sum, value) => sum + value, 0) / enjoymentValues.length;
      rec.reasons.push(`average enjoyment ${avg.toFixed(1)}`);
    }
    if (rec.reasons.length === 0) rec.reasons.push("available profile with no matching history");
  }

  return [...scores.values()].sort((a, b) => b.score - a.score || displayTitle(a.profile).localeCompare(displayTitle(b.profile)) || a.profile.id.localeCompare(b.profile.id));
}
