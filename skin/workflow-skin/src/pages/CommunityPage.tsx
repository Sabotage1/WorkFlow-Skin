import { Download, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Grinder, ProfileRecord, ShotRecord, ShotSnapshot } from "../api/types";
import { ShotGraph } from "../components/ShotGraph";
import { matchesCommunitySearch } from "../community/search";
import type { CommunityDownloadPayload, CommunityRecommendation, CommunityShotEvidence, DownloadedCommunityProfile, UploadedCommunityProfile } from "../community/types";
import type { Bag } from "../lib/bags";
import { shotTasteRating, tasteScoreLabel } from "../lib/shotTaste";

type CommunityTab = "recommendations" | "recommend" | "downloaded" | "uploaded";
type BurrTypeFilter = "flat" | "conical";
type RatingFilter = "" | "1" | "2" | "3" | "4" | "5";
type RecommendationSort = "" | "rank-count" | "uploader-rating" | "rank-count-uploader-rating";

export interface UploadDraft {
  bagId: string;
  profileId: string;
  grinderId: string;
  grindSetting: string;
  beansWeight: string;
  drinkWeight: string;
  secondsMin: string;
  secondsMax: string;
  rating: string;
  notes: string;
  visualizerUrl: string;
  shotId: string;
}

interface CommunityPageProps {
  recommendations: CommunityRecommendation[];
  loading: boolean;
  error: string | null;
  bags: Bag[];
  profiles: ProfileRecord[];
  grinders: Grinder[];
  shots: ShotRecord[];
  downloaded: DownloadedCommunityProfile[];
  uploaded: UploadedCommunityProfile[];
  userRatings?: Record<string, number>;
  submittedBy: string | null;
  submittedByLocked: boolean;
  manualDisplayName: string;
  onManualDisplayNameChange: (value: string) => void;
  onRefresh: () => Promise<void> | void;
  onLoadDetails?: (recommendation: CommunityRecommendation) => Promise<CommunityDownloadPayload> | CommunityDownloadPayload;
  onDownload: (recommendation: CommunityRecommendation) => Promise<void> | void;
  onRateRecommendation?: (recommendation: CommunityRecommendation, rating: number) => Promise<void> | void;
  onUpload: (draft: UploadDraft) => Promise<void> | void;
  onEditUpload: (recommendation: CommunityRecommendation, draft: UploadDraft) => Promise<void> | void;
  onDeleteUpload: (recommendation: CommunityRecommendation) => Promise<void> | void;
  initialDraft?: Partial<UploadDraft> | null;
  onInitialDraftApplied?: () => void;
}

const emptyDraft: UploadDraft = {
  bagId: "",
  profileId: "",
  grinderId: "",
  grindSetting: "",
  beansWeight: "",
  drinkWeight: "",
  secondsMin: "",
  secondsMax: "",
  rating: "5",
  notes: "",
  visualizerUrl: "",
  shotId: ""
};

const tabLabels: Array<{ id: CommunityTab; label: string }> = [
  { id: "recommendations", label: "Recommendations" },
  { id: "recommend", label: "Recommend Profile" },
  { id: "downloaded", label: "Downloaded Profiles" },
  { id: "uploaded", label: "Uploaded Profiles" }
];

function recommendationTitle(recommendation: CommunityRecommendation): string {
  return recommendation.profile.originalTitle.trim() || recommendation.profile.installedTitle.trim() || recommendation.id;
}

function bagTitle(bag: Bag): string {
  return bag.name?.trim() || [bag.roaster, bag.bean].filter(Boolean).join(" ") || bag.id;
}

function profileTitle(profile: ProfileRecord): string {
  return profile.profile.title?.trim() || profile.id;
}

function shotTitle(shot: ShotRecord): string {
  const profile = shot.workflow.profile?.title ?? shot.workflow.name;
  const date = formatDateOnly(shot.timestamp) ?? shot.id;
  const score = tasteScoreLabel(shotTasteRating(shot));
  return [date, profile, score].filter(Boolean).join(" - ");
}

function isBurrTypeFilter(value: unknown): value is BurrTypeFilter {
  return value === "flat" || value === "conical";
}

function burrTypeLabel(value: unknown): string | undefined {
  if (value === "flat") return "Flat burrs";
  if (value === "conical") return "Conical burrs";
  return undefined;
}

function formatDateOnly(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const isoDate = trimmed.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const date = new Date(trimmed);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : trimmed;
}

function scoreFromValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : null;
}

function shotScoreText(value: unknown): string | undefined {
  const score = scoreFromValue(value);
  return score === null ? undefined : `Shot score ${tasteScoreLabel(score)}`;
}

function recommendationRating(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function roundedStarRating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) return null;
  return Math.min(5, Math.ceil(value * 2) / 2);
}

function formatStarRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function ratingLabel(value: unknown): string | undefined {
  const rating = roundedStarRating(value);
  return rating === null ? undefined : `${formatStarRating(rating)} out of 5 stars`;
}

function StarRating({ value }: { value: unknown }) {
  const rating = roundedStarRating(value);
  if (rating === null) return null;
  const fullStars = Math.floor(rating);
  const hasHalfStar = rating % 1 === 0.5;
  return (
    <span className="community-star-rating" aria-label={`Recommendation rating ${formatStarRating(rating)} out of 5 stars`}>
      {Array.from({ length: fullStars }, (_, index) => (
        <span key={`full-${index}`} className="community-star-full" aria-hidden="true">
          ⭐
        </span>
      ))}
      {hasHalfStar && (
        <span className="community-star-half" aria-hidden="true">
          <span>⭐</span>
        </span>
      )}
    </span>
  );
}

function communityRankAverage(recommendation: CommunityRecommendation): number | null {
  return typeof recommendation.communityRatingAverage === "number" && Number.isFinite(recommendation.communityRatingAverage) && recommendation.communityRatingAverage >= 1 && recommendation.communityRatingAverage <= 5
    ? recommendation.communityRatingAverage
    : null;
}

function communityRankCount(recommendation: CommunityRecommendation): number {
  return typeof recommendation.communityRatingCount === "number" && Number.isInteger(recommendation.communityRatingCount) && recommendation.communityRatingCount > 0 ? recommendation.communityRatingCount : 0;
}

function formatRankAverage(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function communityRankText(recommendation: CommunityRecommendation): string {
  const average = communityRankAverage(recommendation);
  const count = communityRankCount(recommendation);
  return average === null || count === 0 ? "No community ranks yet" : `Community rank ${formatRankAverage(average)}/5 (${count})`;
}

function recommendationDisplayRating(recommendation: CommunityRecommendation): number | null {
  const average = communityRankAverage(recommendation);
  return roundedStarRating(average !== null && communityRankCount(recommendation) > 0 ? average : recommendation.rating);
}

function ratingFilterValue(recommendation: CommunityRecommendation): number | null {
  return recommendationDisplayRating(recommendation);
}

function uploaderRatingValue(recommendation: CommunityRecommendation): number {
  return recommendationRating(recommendation.rating) ?? 0;
}

function sortRecommendations(recommendations: CommunityRecommendation[], sort: RecommendationSort): CommunityRecommendation[] {
  if (!sort) return recommendations;
  return recommendations
    .map((recommendation, index) => ({ recommendation, index }))
    .sort((left, right) => {
      if (sort === "rank-count" || sort === "rank-count-uploader-rating") {
        const rankDifference = communityRankCount(right.recommendation) - communityRankCount(left.recommendation);
        if (rankDifference !== 0) return rankDifference;
      }

      if (sort === "uploader-rating" || sort === "rank-count-uploader-rating") {
        const ratingDifference = uploaderRatingValue(right.recommendation) - uploaderRatingValue(left.recommendation);
        if (ratingDifference !== 0) return ratingDifference;
      }

      return left.index - right.index;
    })
    .map(({ recommendation }) => recommendation);
}

function CommunityRankControl({
  title,
  value,
  pending,
  onChange
}: {
  title: string;
  value: number | undefined;
  pending: boolean;
  onChange: (rating: number) => void;
}) {
  return (
    <label className="community-rank-control">
      <span>{pending ? "Saving rank" : "Your rank"}</span>
      <select aria-label={`Your rank for ${title}`} value={value ? String(value) : ""} disabled={pending} onChange={(event) => onChange(Number(event.target.value))}>
        <option value="">Rank</option>
        <option value="5">5 stars</option>
        <option value="4">4 stars</option>
        <option value="3">3 stars</option>
        <option value="2">2 stars</option>
        <option value="1">1 star</option>
      </select>
    </label>
  );
}

function recommendationShotScore(recommendation: CommunityRecommendation, evidence?: CommunityShotEvidence): string | undefined {
  return shotScoreText(evidence?.enjoyment ?? recommendation.shotScore);
}

function recommendationUploadSummary(recommendation: CommunityRecommendation): string | undefined {
  const date = formatDateOnly(recommendation.createdAt);
  return [date ? `Uploaded ${date}` : undefined, recommendationShotScore(recommendation)].filter(Boolean).join(" - ") || undefined;
}

function localUploadSummary(item: UploadedCommunityProfile): string | undefined {
  const date = formatDateOnly(item.uploadedAt);
  return [date ? `Uploaded ${date}` : undefined, recommendationShotScore(item.recommendation, item.evidence)].filter(Boolean).join(" - ") || undefined;
}

function secondsSummary(recommendation: CommunityRecommendation): string | undefined {
  if (typeof recommendation.brew.secondsGoal === "number") return `${recommendation.brew.secondsGoal}s goal`;
  if (typeof recommendation.brew.secondsMin === "number" && typeof recommendation.brew.secondsMax === "number") {
    return `${recommendation.brew.secondsMin}-${recommendation.brew.secondsMax}s goal`;
  }
  return undefined;
}

function recommendationBagSummary(recommendation: CommunityRecommendation): string {
  return [
    recommendation.bag.roaster,
    recommendation.bag.name,
    recommendation.bag.bean,
    recommendation.bag.country,
    recommendation.bag.process,
    formatDateOnly(recommendation.bag.roastDate) ?? recommendation.bag.roastDate
  ]
    .filter(Boolean)
    .join(" - ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function evidenceMeasurements(evidence: CommunityShotEvidence | undefined): ShotSnapshot[] {
  if (!Array.isArray(evidence?.measurements)) return [];
  return evidence.measurements.filter(isRecord).map((measurement) => measurement as ShotSnapshot);
}

function GraphFullscreen({ measurements, onClose }: { measurements: ShotSnapshot[]; onClose: () => void }) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="community-graph-fullscreen" role="dialog" aria-modal="true" aria-label="Shot graph fullscreen">
      <div className="community-graph-fullscreen-header">
        <button type="button" className="community-graph-close" aria-label="Close shot graph fullscreen" onClick={onClose}>
          <X aria-hidden="true" size={24} />
        </button>
      </div>
      <div className="community-graph-fullscreen-frame">
        <ShotGraph measurements={measurements} />
      </div>
    </div>,
    document.body
  );
}

function detailValue(value: string | number | undefined, suffix = ""): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return `${value}${suffix}`;
  if (typeof value === "string" && value.trim()) return `${value.trim()}${suffix}`;
  return undefined;
}

function recommendationBrewSummary(recommendation: CommunityRecommendation): string {
  return [
    recommendation.grinder.model,
    recommendation.grinder.burrs,
    burrTypeLabel(recommendation.grinder.burrType),
    `Grind ${recommendation.brew.grindSetting}`,
    `${recommendation.brew.beansWeight}g in`,
    `${recommendation.brew.drinkWeight}g out`,
    `By ${recommendation.submittedBy}`
  ]
    .filter(Boolean)
    .join(" - ");
}

function grinderSearchText(recommendation: CommunityRecommendation): string {
  return [
    recommendation.grinder.id,
    recommendation.grinder.model,
    recommendation.grinder.burrType,
    burrTypeLabel(recommendation.grinder.burrType),
    recommendation.grinder.burrs,
    recommendation.grinder.settingType,
    recommendation.grinder.notes
  ]
    .map((value) => String(value ?? ""))
    .join(" ")
    .toLowerCase();
}

function matchesGrinderFilter(recommendation: CommunityRecommendation, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  return !normalizedQuery || grinderSearchText(recommendation).includes(normalizedQuery);
}

function matchesRatingFilter(recommendation: CommunityRecommendation, filter: RatingFilter): boolean {
  if (!filter) return true;
  const minimumRating = Number(filter);
  const rating = ratingFilterValue(recommendation);
  return rating !== null && rating >= minimumRating;
}

function hasText(value: string): boolean {
  return Boolean(value.trim());
}

function positiveFiniteNumber(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isValidDraft(draft: UploadDraft, displayName: string): boolean {
  const beansWeight = positiveFiniteNumber(draft.beansWeight);
  const drinkWeight = positiveFiniteNumber(draft.drinkWeight);
  const secondsMin = positiveFiniteNumber(draft.secondsMin);
  const secondsMax = positiveFiniteNumber(draft.secondsMax);
  const rating = recommendationRating(Number(draft.rating));
  return Boolean(
    draft.bagId &&
      draft.profileId &&
      draft.grinderId &&
      rating &&
      hasText(displayName) &&
      hasText(draft.grindSetting) &&
      beansWeight &&
      drinkWeight &&
      secondsMin &&
      secondsMax &&
      secondsMax >= secondsMin &&
      hasText(draft.notes)
  );
}

function draftNumber(value: number | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function uploadDraftFromRecommendation(recommendation: CommunityRecommendation, evidence?: CommunityShotEvidence): UploadDraft {
  const secondsMin = recommendation.brew.secondsMin ?? recommendation.brew.secondsGoal;
  const secondsMax = recommendation.brew.secondsMax ?? recommendation.brew.secondsGoal;
  const rating = recommendationRating(recommendation.rating) ?? 5;
  return {
    bagId: recommendation.bag.id,
    profileId: recommendation.profile.originalId,
    grinderId: recommendation.grinder.id,
    grindSetting: recommendation.brew.grindSetting,
    beansWeight: draftNumber(recommendation.brew.beansWeight),
    drinkWeight: draftNumber(recommendation.brew.drinkWeight),
    secondsMin: draftNumber(secondsMin),
    secondsMax: draftNumber(secondsMax),
    rating: String(rating),
    notes: recommendation.brew.notes,
    visualizerUrl: recommendation.visualizerUrl ?? "",
    shotId: evidence?.id ?? ""
  };
}

export function CommunityPage({
  recommendations,
  loading,
  error,
  bags,
  profiles,
  grinders,
  shots,
  downloaded,
  uploaded,
  userRatings = {},
  submittedBy,
  submittedByLocked,
  manualDisplayName,
  onManualDisplayNameChange,
  onRefresh,
  onLoadDetails,
  onDownload,
  onRateRecommendation,
  onUpload,
  onEditUpload,
  onDeleteUpload,
  initialDraft,
  onInitialDraftApplied
}: CommunityPageProps) {
  const [activeTab, setActiveTab] = useState<CommunityTab>("recommendations");
  const [query, setQuery] = useState("");
  const [grinderQuery, setGrinderQuery] = useState("");
  const [minimumRating, setMinimumRating] = useState<RatingFilter>("");
  const [recommendationSort, setRecommendationSort] = useState<RecommendationSort>("");
  const [draft, setDraft] = useState<UploadDraft>(emptyDraft);
  const [burrTypeFilters, setBurrTypeFilters] = useState<Record<BurrTypeFilter, boolean>>({ flat: false, conical: false });
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [pendingDownloadId, setPendingDownloadId] = useState<string | null>(null);
  const [pendingRankId, setPendingRankId] = useState<string | null>(null);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState<string | null>(null);
  const [editingUploadId, setEditingUploadId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<UploadDraft>(emptyDraft);
  const [graphFullscreen, setGraphFullscreen] = useState(false);
  const [detailPayloads, setDetailPayloads] = useState<Partial<Record<string, CommunityDownloadPayload>>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const recommendStatusRef = useRef<HTMLParagraphElement | null>(null);
  const displayName = submittedByLocked ? submittedBy ?? "" : manualDisplayName;
  const activeBurrTypes = useMemo(
    () => (Object.entries(burrTypeFilters) as Array<[BurrTypeFilter, boolean]>).filter(([, active]) => active).map(([type]) => type),
    [burrTypeFilters]
  );
  const filteredRecommendations = useMemo(
    () => {
      const matchingRecommendations = recommendations.filter(
        (recommendation) =>
          matchesCommunitySearch(recommendation, query) &&
          matchesGrinderFilter(recommendation, grinderQuery) &&
          matchesRatingFilter(recommendation, minimumRating) &&
          (activeBurrTypes.length === 0 || (isBurrTypeFilter(recommendation.grinder.burrType) && activeBurrTypes.includes(recommendation.grinder.burrType)))
      );
      return sortRecommendations(matchingRecommendations, recommendationSort);
    },
    [activeBurrTypes, grinderQuery, minimumRating, recommendationSort, recommendations, query]
  );
  const selectedRecommendation = selectedRecommendationId ? recommendations.find((recommendation) => recommendation.id === selectedRecommendationId) ?? null : null;
  const selectedDetailPayload = selectedRecommendation ? detailPayloads[selectedRecommendation.id] : undefined;
  const selectedLocalEvidence = selectedRecommendation
    ? downloaded.find((item) => item.recommendationId === selectedRecommendation.id)?.evidence ?? uploaded.find((item) => item.recommendationId === selectedRecommendation.id)?.evidence
    : undefined;
  const selectedEvidence = selectedDetailPayload?.evidence ?? selectedLocalEvidence;
  const selectedMeasurements = evidenceMeasurements(selectedEvidence);
  const editingUpload = editingUploadId ? uploaded.find((item) => item.recommendationId === editingUploadId) ?? null : null;
  const editingMeasurements = evidenceMeasurements(editingUpload?.evidence);

  useEffect(() => {
    if (!initialDraft) return;
    setDraft({ ...emptyDraft, ...initialDraft });
    setActiveTab("recommend");
    setStatus(null);
    onInitialDraftApplied?.();
  }, [initialDraft, onInitialDraftApplied]);

  useEffect(() => {
    if (activeTab !== "recommend" || !status) return;
    const statusElement = recommendStatusRef.current;
    if (typeof statusElement?.scrollIntoView !== "function") return;
    statusElement.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeTab, status]);

  const setDraftField = (field: keyof UploadDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setStatus(null);
  };

  const setEditDraftField = (field: keyof UploadDraft, value: string) => {
    setEditDraft((current) => ({ ...current, [field]: value }));
    setStatus(null);
  };

  const draftFields = (currentDraft: UploadDraft, updateField: (field: keyof UploadDraft, value: string) => void) => (
    <>
      <label className="settings-field">
        <span>Saved bag</span>
        <select aria-label="Saved bag" value={currentDraft.bagId} onChange={(event) => updateField("bagId", event.target.value)}>
          <option value="">Select saved bag</option>
          {bags.map((bag) => (
            <option key={bag.id} value={bag.id}>
              {bagTitle(bag)}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Profile</span>
        <select aria-label="Profile" value={currentDraft.profileId} onChange={(event) => updateField("profileId", event.target.value)}>
          <option value="">Select profile</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profileTitle(profile)}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Grinder</span>
        <select aria-label="Grinder" value={currentDraft.grinderId} onChange={(event) => updateField("grinderId", event.target.value)}>
          <option value="">Select grinder</option>
          {grinders.map((grinder) => (
            <option key={grinder.id} value={grinder.id}>
              {[grinder.model, burrTypeLabel(grinder.burrType)].filter(Boolean).join(" - ")}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        <span>Recommendation rating</span>
        <select aria-label="Recommendation rating" value={currentDraft.rating} onChange={(event) => updateField("rating", event.target.value)}>
          <option value="5">5 stars</option>
          <option value="4">4 stars</option>
          <option value="3">3 stars</option>
          <option value="2">2 stars</option>
          <option value="1">1 star</option>
        </select>
      </label>
      <label className="settings-field">
        <span>Grind setting</span>
        <input aria-label="Grind setting" value={currentDraft.grindSetting} onChange={(event) => updateField("grindSetting", event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Beans weight</span>
        <input aria-label="Beans weight" inputMode="decimal" value={currentDraft.beansWeight} onChange={(event) => updateField("beansWeight", event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Drink weight</span>
        <input aria-label="Drink weight" inputMode="decimal" value={currentDraft.drinkWeight} onChange={(event) => updateField("drinkWeight", event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Seconds min</span>
        <input aria-label="Seconds min" inputMode="decimal" value={currentDraft.secondsMin} onChange={(event) => updateField("secondsMin", event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Seconds max</span>
        <input aria-label="Seconds max" inputMode="decimal" value={currentDraft.secondsMax} onChange={(event) => updateField("secondsMax", event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Visualizer link</span>
        <input aria-label="Visualizer link" value={currentDraft.visualizerUrl} onChange={(event) => updateField("visualizerUrl", event.target.value)} />
      </label>
      <label className="settings-field">
        <span>Shot evidence</span>
        <select aria-label="Shot evidence" value={currentDraft.shotId} onChange={(event) => updateField("shotId", event.target.value)}>
          <option value="">No shot selected</option>
          {shots.map((shot) => (
            <option key={shot.id} value={shot.id}>
              {shotTitle(shot)}
            </option>
          ))}
        </select>
      </label>
    </>
  );

  const uploadDraft = async () => {
    if (!isValidDraft(draft, displayName)) {
      setStatus({
        type: "error",
        message: "Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes."
      });
      return;
    }

    try {
      await onUpload(draft);
      setDraft(emptyDraft);
      setStatus({ type: "success", message: "Recommendation uploaded." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const downloadRecommendation = async (recommendation: CommunityRecommendation) => {
    setPendingDownloadId(recommendation.id);
    setStatus(null);
    try {
      await onDownload(recommendation);
      setStatus({ type: "success", message: "Profile downloaded." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPendingDownloadId(null);
    }
  };

  const rankRecommendation = async (recommendation: CommunityRecommendation, rating: number) => {
    const validRating = recommendationRating(rating);
    if (validRating === null || !onRateRecommendation) return;
    setPendingRankId(recommendation.id);
    setStatus(null);
    try {
      await onRateRecommendation(recommendation, validRating);
      setStatus({ type: "success", message: "Rank saved." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPendingRankId(null);
    }
  };

  const openRecommendationDetails = async (recommendation: CommunityRecommendation) => {
    setSelectedRecommendationId(recommendation.id);
    setStatus(null);
    setDetailError(null);
    if (!onLoadDetails || detailPayloads[recommendation.id]) return;

    setDetailLoadingId(recommendation.id);
    try {
      const payload = await onLoadDetails(recommendation);
      setDetailPayloads((current) => ({ ...current, [recommendation.id]: payload }));
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoadingId(null);
    }
  };

  const startEditingUploadedRecommendation = (item: UploadedCommunityProfile) => {
    setEditingUploadId(item.recommendationId);
    setEditDraft(uploadDraftFromRecommendation(item.recommendation, item.evidence));
    setStatus(null);
  };

  const saveUploadedRecommendation = async (item: UploadedCommunityProfile) => {
    if (!isValidDraft(editDraft, item.recommendation.submittedBy)) {
      setStatus({
        type: "error",
        message: "Select a saved bag, profile, grinder, public display name, grind setting, weights, seconds, and notes."
      });
      return;
    }

    setPendingEditId(item.recommendation.id);
    setStatus(null);
    try {
      await onEditUpload(item.recommendation, editDraft);
      setStatus({ type: "success", message: "Recommendation updated." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPendingEditId(null);
    }
  };

  const deleteUploadedRecommendation = async (item: UploadedCommunityProfile) => {
    setPendingDeleteId(item.recommendation.id);
    setStatus(null);
    try {
      await onDeleteUpload(item.recommendation);
      setEditingUploadId(null);
      setStatus({ type: "success", message: "Recommendation deleted." });
    } catch (error) {
      setStatus({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setPendingDeleteId(null);
    }
  };

  return (
    <div className="community-page">
      <div className="page-title-row">
        <h1>Community</h1>
        <button type="button" className="ghost-button compact-button" onClick={() => void onRefresh()}>
          <RefreshCw aria-hidden="true" size={16} />
          Refresh
        </button>
      </div>

      <div className="settings-tabs community-tabs" role="tablist" aria-label="Community sections">
        {tabLabels.map((tab) => (
          <button
            key={tab.id}
            id={`community-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`community-panel-${tab.id}`}
            className={activeTab === tab.id ? "settings-tab active" : "settings-tab"}
            onClick={() => {
              setActiveTab(tab.id);
              setSelectedRecommendationId(null);
              setEditingUploadId(null);
              setGraphFullscreen(false);
              setStatus(null);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "recommendations" && (
        <section id="community-panel-recommendations" className="panel wide community-section" role="tabpanel" aria-labelledby="community-tab-recommendations">
          {selectedRecommendation ? (
            <div className="community-detail-view">
              <div className="community-detail-header">
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    setSelectedRecommendationId(null);
                    setGraphFullscreen(false);
                  }}
                >
                  Back
                </button>
                <div>
                  <span className="eyebrow">Recommended profile</span>
                  <h2>{recommendationTitle(selectedRecommendation)}</h2>
                </div>
                <button
                  type="button"
                  className="primary-button compact-button"
                  aria-label={`Download ${recommendationTitle(selectedRecommendation)}`}
                  disabled={pendingDownloadId === selectedRecommendation.id}
                  onClick={() => void downloadRecommendation(selectedRecommendation)}
                >
                  <Download aria-hidden="true" size={16} />
                  {pendingDownloadId === selectedRecommendation.id ? "Downloading" : "Download"}
                </button>
              </div>
              {status && (
                <p className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
                  {status.message}
                </p>
              )}
              {detailError && (
                <p className="status-message error" role="alert">
                  Could not load shot details: {detailError}
                </p>
              )}
              {detailLoadingId === selectedRecommendation.id && (
                <p className="muted" role="status">
                  Loading shot details.
                </p>
              )}
              <div className="community-detail-grid">
                <div className="community-detail-card">
                  <strong>Bag</strong>
                  <span>{recommendationBagSummary(selectedRecommendation)}</span>
                  {selectedRecommendation.bag.region && <span>Region {selectedRecommendation.bag.region}</span>}
                  {selectedRecommendation.bag.roastLevel && <span>Roast {selectedRecommendation.bag.roastLevel}</span>}
                  {selectedRecommendation.bag.notes && <p>{selectedRecommendation.bag.notes}</p>}
                </div>
                <div className="community-detail-card">
                  <strong>Grinder</strong>
                  <span>{[selectedRecommendation.grinder.model, selectedRecommendation.grinder.burrs, burrTypeLabel(selectedRecommendation.grinder.burrType)].filter(Boolean).join(" - ")}</span>
                  {selectedRecommendation.grinder.settingType && <span>Setting type {selectedRecommendation.grinder.settingType}</span>}
                  {selectedRecommendation.grinder.notes && <p>{selectedRecommendation.grinder.notes}</p>}
                </div>
                <div className="community-detail-card">
                  <strong>Brew</strong>
                  {ratingLabel(selectedRecommendation.rating) && <StarRating value={selectedRecommendation.rating} />}
                  <span>{[`Grind ${selectedRecommendation.brew.grindSetting}`, `${selectedRecommendation.brew.beansWeight}g in`, `${selectedRecommendation.brew.drinkWeight}g out`, secondsSummary(selectedRecommendation)].filter(Boolean).join(" - ")}</span>
                  <p>{selectedRecommendation.brew.notes}</p>
                </div>
                <div className="community-detail-card">
                  <strong>Community rank</strong>
                  <span>{communityRankText(selectedRecommendation)}</span>
                  <CommunityRankControl
                    title={recommendationTitle(selectedRecommendation)}
                    value={userRatings[selectedRecommendation.id]}
                    pending={pendingRankId === selectedRecommendation.id}
                    onChange={(rating) => void rankRecommendation(selectedRecommendation, rating)}
                  />
                </div>
                <div className="community-detail-card">
                  <strong>Shot</strong>
                  {recommendationShotScore(selectedRecommendation, selectedEvidence) && <span>{recommendationShotScore(selectedRecommendation, selectedEvidence)}</span>}
                  {selectedEvidence?.timestamp && <span>Shot date {formatDateOnly(selectedEvidence.timestamp)}</span>}
                  {[detailValue(selectedEvidence?.doseWeight, "g dose"), detailValue(selectedEvidence?.drinkWeight, "g drink")].filter(Boolean).length > 0 && (
                    <span>{[detailValue(selectedEvidence?.doseWeight, "g dose"), detailValue(selectedEvidence?.drinkWeight, "g drink")].filter(Boolean).join(" - ")}</span>
                  )}
                  {typeof selectedEvidence?.tds === "number" && <span>TDS {selectedEvidence.tds}</span>}
                  {typeof selectedEvidence?.ey === "number" && <span>EY {selectedEvidence.ey}%</span>}
                  {selectedEvidence?.notes && <p>{selectedEvidence.notes}</p>}
                  {selectedRecommendation.visualizerUrl && (
                    <a href={selectedRecommendation.visualizerUrl} target="_blank" rel="noreferrer">
                      Open Visualizer
                    </a>
                  )}
                </div>
              </div>
              <div className="community-detail-graph dark-graph-panel">
                <div className="review-graph-header">
                  <h3>Shot Graph</h3>
                  <span className="muted">{selectedMeasurements.length ? "Shared shot evidence" : "No shot graph shared"}</span>
                </div>
                {selectedMeasurements.length ? (
                  <button type="button" className="community-graph-open" aria-label="Open shot graph fullscreen" onClick={() => setGraphFullscreen(true)}>
                    <ShotGraph measurements={selectedMeasurements} />
                  </button>
                ) : (
                  <p className="muted">This recommendation does not include shared shot history.</p>
                )}
              </div>
              {graphFullscreen && selectedMeasurements.length > 0 && <GraphFullscreen measurements={selectedMeasurements} onClose={() => setGraphFullscreen(false)} />}
            </div>
          ) : (
            <>
              <div className="community-search-grid">
                <label className="settings-field">
                  <span>Search recommendations</span>
                  <input aria-label="Search recommendations" value={query} onChange={(event) => setQuery(event.target.value)} />
                </label>
                <label className="settings-field">
                  <span>Grinder</span>
                  <input aria-label="Grinder recommendation filter" value={grinderQuery} onChange={(event) => setGrinderQuery(event.target.value)} />
                </label>
                <label className="settings-field">
                  <span>Minimum stars</span>
                  <select aria-label="Minimum recommendation rating" value={minimumRating} onChange={(event) => setMinimumRating(event.target.value as RatingFilter)}>
                    <option value="">Any rating</option>
                    <option value="5">5 stars</option>
                    <option value="4">4+ stars</option>
                    <option value="3">3+ stars</option>
                    <option value="2">2+ stars</option>
                    <option value="1">1+ star</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>Sort by</span>
                  <select aria-label="Sort recommendations" value={recommendationSort} onChange={(event) => setRecommendationSort(event.target.value as RecommendationSort)}>
                    <option value="">Community order</option>
                    <option value="rank-count">Most ranks</option>
                    <option value="uploader-rating">Uploader score</option>
                    <option value="rank-count-uploader-rating">Most ranks, then uploader score</option>
                  </select>
                </label>
              </div>
              <div className="community-filter-row" role="group" aria-label="Burrs Type filters">
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={burrTypeFilters.flat}
                    onChange={(event) => setBurrTypeFilters((current) => ({ ...current, flat: event.target.checked }))}
                  />
                  Flat burrs
                </label>
                <label className="inline-toggle">
                  <input
                    type="checkbox"
                    checked={burrTypeFilters.conical}
                    onChange={(event) => setBurrTypeFilters((current) => ({ ...current, conical: event.target.checked }))}
                  />
                  Conical burrs
                </label>
              </div>
              {error && (
                <p className="status-message error" role="alert">
                  {error}
                </p>
              )}
              {status && (
                <p className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
                  {status.message}
                </p>
              )}
              {loading && <p className="muted">Loading community recommendations.</p>}
              {!loading && filteredRecommendations.length === 0 && <p className="muted">No recommendations found.</p>}
              {filteredRecommendations.map((recommendation) => {
                const title = recommendationTitle(recommendation);
                const downloadPending = pendingDownloadId === recommendation.id;
                return (
                  <div className="list-row community-row" key={recommendation.id}>
                    <button type="button" className="community-row-open" aria-label={`Open ${title} details`} onClick={() => void openRecommendationDetails(recommendation)}>
                      <div className="community-card-header">
                        <strong>{title}</strong>
                        <StarRating value={recommendationDisplayRating(recommendation)} />
                      </div>
                      <span>{communityRankText(recommendation)}</span>
                      {recommendationUploadSummary(recommendation) && <span>{recommendationUploadSummary(recommendation)}</span>}
                      <span>{recommendationBagSummary(recommendation)}</span>
                      <span>{recommendationBrewSummary(recommendation)}</span>
                      <p>{recommendation.brew.notes}</p>
                    </button>
                    <div className="row-actions community-row-actions">
                      <CommunityRankControl
                        title={title}
                        value={userRatings[recommendation.id]}
                        pending={pendingRankId === recommendation.id}
                        onChange={(rating) => void rankRecommendation(recommendation, rating)}
                      />
                      <button
                        type="button"
                        className="primary-button compact-button"
                        aria-label={`Download ${title}`}
                        disabled={downloadPending}
                        onClick={() => void downloadRecommendation(recommendation)}
                      >
                        <Download aria-hidden="true" size={16} />
                        {downloadPending ? "Downloading" : "Download"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </section>
      )}

      {activeTab === "recommend" && (
        <section id="community-panel-recommend" className="panel wide community-section" role="tabpanel" aria-labelledby="community-tab-recommend">
          <p className="mandatory-help">Shot history is optional, but highly recommended so people can understand the profile from a real graph and shot details.</p>
          {status && (
            <p ref={recommendStatusRef} className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
              {status.message}
            </p>
          )}
          <div className="form-grid">
            {submittedByLocked ? (
              <p className="muted">Uploading as Decent account {submittedBy ?? "connected user"}.</p>
            ) : (
              <label className="settings-field">
                <span>Public display name</span>
                <input aria-label="Public display name" value={manualDisplayName} onChange={(event) => onManualDisplayNameChange(event.target.value)} />
              </label>
            )}
            {draftFields(draft, setDraftField)}
          </div>
          <label className="settings-field notes-field">
            <span>Notes</span>
            <textarea aria-label="Notes" value={draft.notes} onChange={(event) => setDraftField("notes", event.target.value)} />
          </label>
          <div className="row-actions">
            <button type="button" className="primary-button" onClick={() => void uploadDraft()}>
              <Upload aria-hidden="true" size={16} />
              Upload recommendation
            </button>
          </div>
        </section>
      )}

      {activeTab === "downloaded" && (
        <section id="community-panel-downloaded" className="panel wide community-section" role="tabpanel" aria-labelledby="community-tab-downloaded">
          {downloaded.length === 0 && <p className="muted">No downloaded profiles yet.</p>}
          {downloaded.map((item) => (
            <div className="list-row community-row" key={`${item.recommendationId}-${item.localProfileId}`}>
              <div className="community-card-header">
                <strong>{item.localProfileTitle}</strong>
                <StarRating value={recommendationDisplayRating(item.recommendation)} />
              </div>
              <span>{communityRankText(item.recommendation)}</span>
              <p>{item.recommendation.brew.notes}</p>
              {(item.evidence || recommendationShotScore(item.recommendation)) && (
                <div className="community-evidence-summary">
                  {recommendationShotScore(item.recommendation, item.evidence) && <span>{recommendationShotScore(item.recommendation, item.evidence)}</span>}
                  {typeof item.evidence?.tds === "number" && <span>TDS {item.evidence.tds}</span>}
                  {typeof item.evidence?.ey === "number" && <span>EY {item.evidence.ey}</span>}
                  {item.evidence?.notes && <span>{item.evidence.notes}</span>}
                </div>
              )}
              <div className="row-actions community-row-actions">
                <CommunityRankControl
                  title={recommendationTitle(item.recommendation)}
                  value={userRatings[item.recommendation.id]}
                  pending={pendingRankId === item.recommendation.id}
                  onChange={(rating) => void rankRecommendation(item.recommendation, rating)}
                />
              </div>
            </div>
          ))}
        </section>
      )}

      {activeTab === "uploaded" && (
        <section id="community-panel-uploaded" className="panel wide community-section" role="tabpanel" aria-labelledby="community-tab-uploaded">
          {editingUpload ? (
            <div className="community-detail-view community-upload-edit-view">
              <div className="community-detail-header">
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    setEditingUploadId(null);
                    setGraphFullscreen(false);
                    setStatus(null);
                  }}
                >
                  Back
                </button>
                <div>
                  <span className="eyebrow">Uploaded profile</span>
                  <h2>Edit {recommendationTitle(editingUpload.recommendation)}</h2>
                </div>
                <button
                  type="button"
                  className="primary-button compact-button"
                  disabled={pendingEditId === editingUpload.recommendation.id}
                  onClick={() => void saveUploadedRecommendation(editingUpload)}
                >
                  {pendingEditId === editingUpload.recommendation.id ? "Saving" : "Save updated recommendation"}
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  aria-label={`Delete ${recommendationTitle(editingUpload.recommendation)}`}
                  disabled={pendingDeleteId === editingUpload.recommendation.id}
                  onClick={() => void deleteUploadedRecommendation(editingUpload)}
                >
                  <Trash2 aria-hidden="true" size={16} />
                  {pendingDeleteId === editingUpload.recommendation.id ? "Deleting" : "Delete"}
                </button>
              </div>
              {status && (
                <p className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
                  {status.message}
                </p>
              )}
              <div className="community-detail-grid">
                <div className="community-detail-card">
                  <strong>Current Bag</strong>
                  <span>{recommendationBagSummary(editingUpload.recommendation)}</span>
                </div>
                <div className="community-detail-card">
                  <strong>Current Grinder</strong>
                  <span>{[editingUpload.recommendation.grinder.model, editingUpload.recommendation.grinder.burrs, burrTypeLabel(editingUpload.recommendation.grinder.burrType)].filter(Boolean).join(" - ")}</span>
                </div>
                <div className="community-detail-card">
                  <strong>Current Brew</strong>
                  {ratingLabel(editingUpload.recommendation.rating) && <StarRating value={editingUpload.recommendation.rating} />}
                  <span>{[`Grind ${editingUpload.recommendation.brew.grindSetting}`, `${editingUpload.recommendation.brew.beansWeight}g in`, `${editingUpload.recommendation.brew.drinkWeight}g out`, secondsSummary(editingUpload.recommendation)].filter(Boolean).join(" - ")}</span>
                  <p>{editingUpload.recommendation.brew.notes}</p>
                </div>
                <div className="community-detail-card">
                  <strong>Shot</strong>
                  {recommendationShotScore(editingUpload.recommendation, editingUpload.evidence) && <span>{recommendationShotScore(editingUpload.recommendation, editingUpload.evidence)}</span>}
                  {editingUpload.evidence?.timestamp && <span>Shot date {formatDateOnly(editingUpload.evidence.timestamp)}</span>}
                  {[detailValue(editingUpload.evidence?.doseWeight, "g dose"), detailValue(editingUpload.evidence?.drinkWeight, "g drink")].filter(Boolean).length > 0 && (
                    <span>{[detailValue(editingUpload.evidence?.doseWeight, "g dose"), detailValue(editingUpload.evidence?.drinkWeight, "g drink")].filter(Boolean).join(" - ")}</span>
                  )}
                  {typeof editingUpload.evidence?.tds === "number" && <span>TDS {editingUpload.evidence.tds}</span>}
                  {typeof editingUpload.evidence?.ey === "number" && <span>EY {editingUpload.evidence.ey}%</span>}
                  {editingUpload.evidence?.notes && <p>{editingUpload.evidence.notes}</p>}
                </div>
              </div>
              <p className="mandatory-help">Shot history is optional, but highly recommended so people can understand the profile from a real graph and shot details.</p>
              <div className="form-grid">{draftFields(editDraft, setEditDraftField)}</div>
              <label className="settings-field notes-field">
                <span>Notes</span>
                <textarea aria-label="Notes" value={editDraft.notes} onChange={(event) => setEditDraftField("notes", event.target.value)} />
              </label>
              <div className="community-detail-graph dark-graph-panel">
                <div className="review-graph-header">
                  <h3>Shot Graph</h3>
                  <span className="muted">{editingMeasurements.length ? "Shared shot evidence" : "No shot graph shared"}</span>
                </div>
                {editingMeasurements.length ? (
                  <button type="button" className="community-graph-open" aria-label="Open shot graph fullscreen" onClick={() => setGraphFullscreen(true)}>
                    <ShotGraph measurements={editingMeasurements} />
                  </button>
                ) : (
                  <p className="muted">This recommendation does not include shared shot history.</p>
                )}
              </div>
              {graphFullscreen && editingMeasurements.length > 0 && <GraphFullscreen measurements={editingMeasurements} onClose={() => setGraphFullscreen(false)} />}
            </div>
          ) : (
            <>
              {status && (
                <p className={status.type === "error" ? "status-message error" : "status-message"} role={status.type === "error" ? "alert" : "status"}>
                  {status.message}
                </p>
              )}
              {uploaded.length === 0 && <p className="muted">No uploaded profiles yet.</p>}
              {uploaded.map((item) => {
                const title = recommendationTitle(item.recommendation);
                return (
                  <div className="list-row community-row" key={item.recommendationId}>
                    <div className="community-card-header">
                      <strong>{title}</strong>
                      <StarRating value={recommendationDisplayRating(item.recommendation)} />
                    </div>
                    {localUploadSummary(item) && <span>{localUploadSummary(item)}</span>}
                    <span>{recommendationBagSummary(item.recommendation)}</span>
                    <span>{recommendationBrewSummary(item.recommendation)}</span>
                    <p>{item.recommendation.brew.notes}</p>
                    {item.evidence && (
                      <div className="community-evidence-summary">
                        {typeof item.evidence.tds === "number" && <span>TDS {item.evidence.tds}</span>}
                        {typeof item.evidence.ey === "number" && <span>EY {item.evidence.ey}</span>}
                        {item.evidence.notes && <span>{item.evidence.notes}</span>}
                      </div>
                    )}
                    <div className="row-actions">
                      <button type="button" className="ghost-button compact-button" onClick={() => startEditingUploadedRecommendation(item)}>
                        Edit {title}
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        aria-label={`Delete ${title}`}
                        disabled={pendingDeleteId === item.recommendation.id}
                        onClick={() => void deleteUploadedRecommendation(item)}
                      >
                        <Trash2 aria-hidden="true" size={16} />
                        {pendingDeleteId === item.recommendation.id ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </section>
      )}
    </div>
  );
}
