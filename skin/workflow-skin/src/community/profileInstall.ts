import type { Profile } from "../api/types";
import type { CreateProfilePayload } from "../api/reaprime";
import type { CommunityRecommendation } from "./types";

function displayPart(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

function cloneProfile(profileJson: Profile): Profile {
  return JSON.parse(JSON.stringify(profileJson)) as Profile;
}

export function shortRecommendationId(id: string): string {
  const trimmed = id.trim();
  return trimmed.split("-").slice(0, 2).join("-") || trimmed.slice(0, 12);
}

export function communityProfileTitle(recommendation: CommunityRecommendation): string {
  const originalTitle = displayPart(recommendation.profile.originalTitle, "Community Profile");
  const bagName = displayPart(recommendation.bag.name ?? recommendation.bag.bean, "Community Bag");
  const submittedBy = displayPart(recommendation.submittedBy, "Community");
  return `${originalTitle} - ${bagName} - ${submittedBy} - ${shortRecommendationId(recommendation.id)}`;
}

export function profilePayloadForCommunityInstall(recommendation: CommunityRecommendation, profileJson: Profile): CreateProfilePayload {
  const profile = cloneProfile(profileJson);
  const communityNote = `Community recommendation: ${recommendation.id}`;
  const existingNotes = profile.notes?.trim();

  profile.title = communityProfileTitle(recommendation);
  profile.author = recommendation.submittedBy;
  profile.notes = existingNotes ? `${existingNotes}\n\n${communityNote}` : communityNote;

  return {
    profile,
    metadata: {
      communityRecommendationId: recommendation.id,
      communityRecommendationUpdatedAt: recommendation.updatedAt,
      communitySubmittedBy: recommendation.submittedBy
    }
  };
}
