import type { JsonMap, Profile } from "../api/types";

export type CommunityBurrType = "flat" | "conical";

export interface DecentAccountStatus {
  connected?: boolean;
  username?: string;
  displayName?: string;
  name?: string;
  email?: string;
  account?: JsonMap;
}

export interface CommunityBagSnapshot {
  id: string;
  beanId: string;
  roaster: string;
  name?: string;
  bean: string;
  country?: string;
  region?: string;
  process?: string;
  roastDate?: string;
  roastLevel?: string;
  notes?: string;
}

export interface CommunityProfileSnapshot {
  originalId: string;
  originalTitle: string;
  fileName: string;
  installedTitle: string;
}

export interface CommunityGrinderSnapshot {
  id: string;
  model: string;
  burrType?: CommunityBurrType;
  burrs?: string;
  settingType?: "numeric" | "preset";
  notes?: string;
}

export interface CommunityBrewRecommendation {
  grindSetting: string;
  beansWeight: number;
  drinkWeight: number;
  secondsGoal?: number;
  secondsMin?: number;
  secondsMax?: number;
  notes: string;
}

export interface CommunityShotEvidence {
  id: string;
  timestamp?: string;
  profileTitle?: string;
  doseWeight?: number;
  drinkWeight?: number;
  tds?: number;
  ey?: number;
  enjoyment?: number;
  notes?: string;
  grindSetting?: string;
  grinderId?: string;
  measurements?: unknown[];
}

export interface CommunityRecommendation {
  id: string;
  createdAt: string;
  updatedAt: string;
  submittedBy: string;
  bag: CommunityBagSnapshot;
  profile: CommunityProfileSnapshot;
  grinder: CommunityGrinderSnapshot;
  brew: CommunityBrewRecommendation;
  rating?: number;
  visualizerUrl?: string;
  evidenceFileName?: string;
  shotScore?: number;
  communityRatingAverage?: number;
  communityRatingCount?: number;
  searchText?: string;
}

export interface CommunityIndex {
  version: 1;
  updatedAt: string;
  items: CommunityRecommendation[];
}

export interface CommunityDownloadPayload {
  recommendation: CommunityRecommendation;
  profileJson: Profile;
  evidence?: CommunityShotEvidence;
}

export interface DownloadedCommunityProfile {
  recommendationId: string;
  localProfileId: string;
  localProfileTitle: string;
  downloadedAt: string;
  updatedAt: string;
  recommendation: CommunityRecommendation;
  evidence?: CommunityShotEvidence;
}

export interface UploadedCommunityProfile {
  recommendationId: string;
  uploadedAt: string;
  updatedAt: string;
  recommendation: CommunityRecommendation;
  evidence?: CommunityShotEvidence;
}
