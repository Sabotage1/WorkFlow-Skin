export interface BagSnapshot {
  id: string;
  beanId: string;
  roaster: string;
  name?: string;
  bean: string;
  country: string;
  region?: string;
  process: string;
  roastDate: string;
  roastLevel?: string;
  notes?: string;
}

export interface ProfileSnapshot {
  originalId: string;
  originalTitle: string;
  fileName: string;
  installedTitle: string;
}

export type BurrType = "flat" | "conical";

export interface GrinderSnapshot {
  id: string;
  model: string;
  burrType?: BurrType;
  burrs?: string;
  settingType?: "numeric" | "preset";
  notes?: string;
}

export interface BrewRecommendation {
  grindSetting: string;
  beansWeight: number;
  drinkWeight: number;
  secondsGoal?: number;
  secondsMin?: number;
  secondsMax?: number;
  notes: string;
}

export interface ShotEvidence {
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

export interface RecommendationInput {
  submittedBy: string;
  bag: BagSnapshot;
  profile: ProfileSnapshot;
  grinder: GrinderSnapshot;
  brew: BrewRecommendation;
  visualizerUrl?: string;
  evidenceFileName?: string;
}

export interface RecommendationRecord extends RecommendationInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  ownerHash: string;
}

export type PublicRecommendationRecord = Omit<RecommendationRecord, "ownerHash">;

export interface RecommendationIndexItem {
  id: string;
  updatedAt: string;
  submittedBy: string;
  bag: BagSnapshot;
  profile: ProfileSnapshot;
  grinder: GrinderSnapshot;
  brew: BrewRecommendation;
  visualizerUrl?: string;
  evidenceFileName?: string;
  searchText: string;
}

export interface RecommendationIndex {
  version: 1;
  updatedAt: string;
  items: RecommendationIndexItem[];
}

export interface CreateRecommendationRequest {
  ownerKey: string;
  recommendation: RecommendationInput;
  profileJson: unknown;
  evidence?: ShotEvidence;
}

export interface UpdateRecommendationRequest {
  ownerKey: string;
  recommendation: RecommendationInput;
  profileJson: unknown;
  evidence?: ShotEvidence;
}

export interface DownloadPayload {
  recommendation: PublicRecommendationRecord;
  profileJson: unknown;
  evidence?: ShotEvidence;
}

export interface ValidationOk<T> {
  ok: true;
  value: T;
}

export interface ValidationError {
  ok: false;
  error: string;
}

export type ValidationResult<T> = ValidationOk<T> | ValidationError;
