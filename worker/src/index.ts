import { GitHubWriteConflictError, githubFromEnv, type GitHubJsonClient } from "./github";
import { corsHeaders, errorResponse, JsonBodyError, jsonResponse, readJsonBody } from "./json";
import { loadIndex, loadIndexWithSha, saveIndex } from "./indexer";
import { hashOwnerKey, ownerHashesMatch } from "./owner";
import type { CreateRecommendationRequest, DeleteRecommendationRequest, RecommendationRecord, ShotEvidence, UpdateRecommendationRequest } from "./types";
import type { RecommendationIndex } from "./types";
import { toPublicRecommendation, validateProfileJson, validateRecommendationInput } from "./validation";

const recommendationDirectory = "Profiles/recommendations";
const profileDirectory = "Profiles/profiles";
const evidenceDirectory = "Profiles/evidence";
const idPattern = /^rec-[a-z0-9-]+$/;
const safeJsonFileNamePattern = /^(?!.*\.\.)[A-Za-z0-9._-]{1,120}\.json$/;

class ServerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigurationError";
  }
}

function maxBodyBytes(env: Env): number {
  const parsed = Number(env.MAX_BODY_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 750_000;
}

function applyConfiguredCors(response: Response, env: Env): Response {
  response.headers.set("access-control-allow-origin", env.CORS_ALLOW_ORIGIN || "*");
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recommendationPath(id: string): string {
  return `${recommendationDirectory}/${id}.json`;
}

function profilePath(fileName: string): string {
  return `${profileDirectory}/${fileName}`;
}

function evidencePath(fileName: string): string {
  return `${evidenceDirectory}/${fileName}`;
}

function validId(id: string): boolean {
  return idPattern.test(id);
}

function generatedFileName(id: string): string {
  return `${id}.json`;
}

function safeJsonFileName(fileName: string): boolean {
  return safeJsonFileNamePattern.test(fileName);
}

function ownerSecret(env: Env): string {
  const secret = env.OWNER_KEY_SECRET?.trim();
  if (!secret) {
    throw new ServerConfigurationError("Owner key secret is not configured.");
  }
  return secret;
}

async function ownerProof(env: Env, ownerKey: string): Promise<string> {
  return hashOwnerKey(`${ownerSecret(env)}:${ownerKey}`);
}

async function ownerProofMatches(env: Env, storedProof: string, ownerKey: string): Promise<boolean> {
  return ownerHashesMatch(storedProof, `${ownerSecret(env)}:${ownerKey}`);
}

function requiredOwnerKey(body: unknown): string | Response {
  if (!isRecord(body) || typeof body.ownerKey !== "string" || !body.ownerKey.trim()) {
    return errorResponse("Owner key is required.", 400);
  }
  return body.ownerKey.trim();
}

function evidenceFromBody(body: unknown): ShotEvidence | undefined | Response {
  if (!isRecord(body) || body.evidence === undefined || body.evidence === null) return undefined;
  if (!isRecord(body.evidence)) return errorResponse("Evidence must be an object.", 400);
  if (typeof body.evidence.id !== "string" || !body.evidence.id.trim()) {
    return errorResponse("Evidence id is required.", 400);
  }
  return body.evidence as unknown as ShotEvidence;
}

function shotScoreFromEvidence(evidence: ShotEvidence | undefined): number | undefined {
  const value = evidence?.enjoyment;
  return typeof value === "number" && Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : undefined;
}

async function recordsFromIndex(github: GitHubJsonClient, index: RecommendationIndex): Promise<RecommendationRecord[]> {
  const records = await Promise.all(
    index.items.map((item) => github.readJson<RecommendationRecord | null>(recommendationPath(item.id), null))
  );
  return records.filter((record): record is RecommendationRecord => Boolean(record));
}

async function saveIndexWithRetry(github: GitHubJsonClient, currentRecord: RecommendationRecord, now: string): Promise<Awaited<ReturnType<typeof saveIndex>>> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loadedIndex = await loadIndexWithSha(github);
    const records = (await recordsFromIndex(github, loadedIndex.index)).filter((record) => record.id !== currentRecord.id);
    try {
      return await saveIndex(github, [...records, currentRecord], now, loadedIndex.sha);
    } catch (error) {
      if (!(error instanceof GitHubWriteConflictError) || error.path !== "Profiles/index.json" || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("Unable to save index.");
}

async function saveIndexAfterDeleteWithRetry(github: GitHubJsonClient, deletedId: string, now: string): Promise<Awaited<ReturnType<typeof saveIndex>>> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const loadedIndex = await loadIndexWithSha(github);
    const records = (await recordsFromIndex(github, loadedIndex.index)).filter((record) => record.id !== deletedId);
    try {
      return await saveIndex(github, records, now, loadedIndex.sha);
    } catch (error) {
      if (!(error instanceof GitHubWriteConflictError) || error.path !== "Profiles/index.json" || attempt === maxAttempts) {
        throw error;
      }
    }
  }
  throw new Error("Unable to save index.");
}

async function handleCreate(request: Request, env: Env, github: GitHubJsonClient): Promise<Response> {
  const body = await readJsonBody<CreateRecommendationRequest>(request, maxBodyBytes(env));
  const ownerKey = requiredOwnerKey(body);
  if (ownerKey instanceof Response) return ownerKey;

  const recommendationValidation = validateRecommendationInput(isRecord(body) ? body.recommendation : undefined);
  if (!recommendationValidation.ok) return errorResponse(recommendationValidation.error, 400);

  const profileValidation = validateProfileJson(isRecord(body) ? body.profileJson : undefined);
  if (!profileValidation.ok) return errorResponse(profileValidation.error, 400);

  const id = `rec-${crypto.randomUUID()}`;
  const fileName = generatedFileName(id);
  const now = new Date().toISOString();
  const evidence = evidenceFromBody(body);
  if (evidence instanceof Response) return evidence;
  const recommendation: RecommendationRecord = {
    ...recommendationValidation.value,
    id,
    createdAt: now,
    updatedAt: now,
    ownerHash: await ownerProof(env, ownerKey),
    profile: {
      ...recommendationValidation.value.profile,
      fileName
    },
    evidenceFileName: evidence ? fileName : undefined,
    shotScore: shotScoreFromEvidence(evidence)
  };

  await github.writeJson(recommendationPath(id), recommendation, `Create recommendation ${id}`);
  await github.writeJson(profilePath(fileName), profileValidation.value, `Create profile ${id}`);
  if (evidence) {
    await github.writeJson(evidencePath(fileName), evidence, `Create evidence ${id}`);
  }

  // GitHub Contents writes are not transactional; if bounded index retries are exhausted, these content files may remain unindexed.
  const index = await saveIndexWithRetry(github, recommendation, now);
  return jsonResponse({ recommendation: toPublicRecommendation(recommendation), index }, { status: 201 });
}

async function handleGetRecommendation(id: string, github: GitHubJsonClient): Promise<Response> {
  if (!validId(id)) return errorResponse("Invalid recommendation id.", 400);
  const recommendation = await github.readJson<RecommendationRecord | null>(recommendationPath(id), null);
  if (!recommendation) return errorResponse("Recommendation not found.", 404);
  return jsonResponse({ recommendation: toPublicRecommendation(recommendation) });
}

async function handleUpdate(request: Request, env: Env, github: GitHubJsonClient, id: string): Promise<Response> {
  if (!validId(id)) return errorResponse("Invalid recommendation id.", 400);

  const body = await readJsonBody<UpdateRecommendationRequest>(request, maxBodyBytes(env));
  const ownerKey = requiredOwnerKey(body);
  if (ownerKey instanceof Response) return ownerKey;

  const existing = await github.readJson<RecommendationRecord | null>(recommendationPath(id), null);
  if (!existing) return errorResponse("Recommendation not found.", 404);
  if (!(await ownerProofMatches(env, existing.ownerHash, ownerKey))) {
    return errorResponse("Owner key does not match this recommendation.", 403);
  }

  const recommendationValidation = validateRecommendationInput(isRecord(body) ? body.recommendation : undefined);
  if (!recommendationValidation.ok) return errorResponse(recommendationValidation.error, 400);

  const profileValidation = validateProfileJson(isRecord(body) ? body.profileJson : undefined);
  if (!profileValidation.ok) return errorResponse(profileValidation.error, 400);

  const fileName = generatedFileName(id);
  const now = new Date().toISOString();
  const evidence = evidenceFromBody(body);
  if (evidence instanceof Response) return evidence;
  const evidenceFileName = evidence ? fileName : existing.evidenceFileName;
  const shotScore = evidence ? shotScoreFromEvidence(evidence) : existing.shotScore;
  const recommendation: RecommendationRecord = {
    ...recommendationValidation.value,
    id,
    createdAt: existing.createdAt,
    updatedAt: now,
    ownerHash: existing.ownerHash,
    profile: {
      ...recommendationValidation.value.profile,
      fileName
    },
    evidenceFileName,
    shotScore
  };

  await github.writeJson(recommendationPath(id), recommendation, `Update recommendation ${id}`);
  await github.writeJson(profilePath(fileName), profileValidation.value, `Update profile ${id}`);
  if (evidence) {
    await github.writeJson(evidencePath(fileName), evidence, `Update evidence ${id}`);
  }

  // GitHub Contents writes are not transactional; if bounded index retries are exhausted, these content files may remain unindexed.
  const index = await saveIndexWithRetry(github, recommendation, now);
  return jsonResponse({ recommendation: toPublicRecommendation(recommendation), index });
}

async function handleDownload(id: string, github: GitHubJsonClient): Promise<Response> {
  if (!validId(id)) return errorResponse("Invalid recommendation id.", 400);
  const recommendation = await github.readJson<RecommendationRecord | null>(recommendationPath(id), null);
  if (!recommendation) return errorResponse("Recommendation not found.", 404);

  if (!safeJsonFileName(recommendation.profile.fileName) || (recommendation.evidenceFileName !== undefined && !safeJsonFileName(recommendation.evidenceFileName))) {
    return errorResponse("Stored recommendation has an unsafe file name.", 500);
  }

  const profileJson = await github.readJson<unknown | null>(profilePath(recommendation.profile.fileName), null);
  if (!profileJson) return errorResponse("Profile not found.", 404);

  const payload: Record<string, unknown> = {
    recommendation: toPublicRecommendation(recommendation),
    profileJson
  };
  if (recommendation.evidenceFileName) {
    const evidence = await github.readJson<ShotEvidence | null>(evidencePath(recommendation.evidenceFileName), null);
    if (evidence) payload.evidence = evidence;
  }

  return jsonResponse(payload);
}

async function handleDelete(request: Request, env: Env, github: GitHubJsonClient, id: string): Promise<Response> {
  if (!validId(id)) return errorResponse("Invalid recommendation id.", 400);

  const body = await readJsonBody<DeleteRecommendationRequest>(request, maxBodyBytes(env));
  const ownerKey = requiredOwnerKey(body);
  if (ownerKey instanceof Response) return ownerKey;

  const existing = await github.readJson<RecommendationRecord | null>(recommendationPath(id), null);
  if (!existing) return errorResponse("Recommendation not found.", 404);
  if (!(await ownerProofMatches(env, existing.ownerHash, ownerKey))) {
    return errorResponse("Owner key does not match this recommendation.", 403);
  }
  if (!safeJsonFileName(existing.profile.fileName) || (existing.evidenceFileName !== undefined && !safeJsonFileName(existing.evidenceFileName))) {
    return errorResponse("Stored recommendation has an unsafe file name.", 500);
  }

  await github.deleteJson(recommendationPath(id), `Delete recommendation ${id}`);
  await github.deleteJson(profilePath(existing.profile.fileName), `Delete profile ${id}`);
  if (existing.evidenceFileName) {
    await github.deleteJson(evidencePath(existing.evidenceFileName), `Delete evidence ${id}`);
  }

  // GitHub Contents deletes are not transactional; rebuilding from surviving records removes stale index entries.
  const index = await saveIndexAfterDeleteWithRetry(github, id, new Date().toISOString());
  return jsonResponse({ id, index });
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  const url = new URL(request.url);
  const github = githubFromEnv(env);
  const recommendationMatch = url.pathname.match(/^\/api\/recommendations\/([^/]+)$/);
  const downloadMatch = url.pathname.match(/^\/api\/download\/([^/]+)$/);

  if (url.pathname === "/api/recommendations" && request.method === "GET") {
    return jsonResponse(await loadIndex(github));
  }

  if (url.pathname === "/api/recommendations" && request.method === "POST") {
    return handleCreate(request, env, github);
  }

  if (recommendationMatch && request.method === "GET") {
    return handleGetRecommendation(recommendationMatch[1], github);
  }

  if (recommendationMatch && request.method === "PUT") {
    return handleUpdate(request, env, github, recommendationMatch[1]);
  }

  if (recommendationMatch && request.method === "DELETE") {
    return handleDelete(request, env, github, recommendationMatch[1]);
  }

  if (downloadMatch && request.method === "GET") {
    return handleDownload(downloadMatch[1], github);
  }

  return errorResponse("Not found", 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return applyConfiguredCors(await handleRequest(request, env), env);
    } catch (error) {
      if (error instanceof JsonBodyError) {
        return applyConfiguredCors(errorResponse(error.message, error.status), env);
      }
      if (error instanceof ServerConfigurationError) {
        console.error(error);
        return applyConfiguredCors(errorResponse("Internal server error.", 500), env);
      }
      console.error(error);
      return applyConfiguredCors(errorResponse("Internal server error.", 500), env);
    }
  }
} satisfies ExportedHandler<Env>;
