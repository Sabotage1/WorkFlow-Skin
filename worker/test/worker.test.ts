import { SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { hashOwnerKey } from "../src/owner";
import type { RecommendationIndex, RecommendationInput, RecommendationRecord, ShotEvidence } from "../src/types";
import { buildIndexItem } from "../src/validation";

const githubApi = "https://api.github.com";
const contentsPrefix = "/repos/Sabotage1/WorkFlow-Skin/contents/";

const baseRecommendation: RecommendationInput = {
  submittedBy: "Roy",
  bag: {
    id: "bag-1",
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
    fileName: "submitted-name.json",
    installedTitle: "Blooming - Halo - Roy"
  },
  grinder: {
    id: "grinder-1",
    model: "ZP6",
    burrs: "MP",
    settingType: "numeric",
    notes: "zero at chirp"
  },
  brew: {
    grindSetting: "4.2",
    beansWeight: 18,
    drinkWeight: 42,
    secondsMin: 28,
    secondsMax: 34,
    notes: "Gentle declining pressure after bloom"
  },
  visualizerUrl: "https://visualizer.coffee/shots/abc",
  evidenceFileName: "submitted-evidence.json"
};

const profileJson = { title: "Blooming", steps: [{ name: "bloom", seconds: 10 }] };
const evidence: ShotEvidence = {
  id: "shot-1",
  timestamp: "2026-06-18T12:00:00.000Z",
  profileTitle: "Blooming",
  doseWeight: 18,
  drinkWeight: 42,
  tds: 9.2,
  ey: 21.5,
  enjoyment: 8,
  notes: "Sweet and floral"
};

function encodeJson(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeJsonContent(content: unknown): unknown {
  if (typeof content !== "string") return undefined;
  const binary = atob(content);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

interface MockGitHubOptions {
  indexWriteConflicts?: number;
  indexRace?: {
    value: RecommendationIndex;
  };
}

function mockGithubContents(initialFiles: Record<string, unknown> = {}, options: MockGitHubOptions = {}) {
  const files = new Map<string, { value: unknown; sha: string }>();
  const reads: string[] = [];
  const writes: Array<{ path: string; value: unknown; message: string; sha?: string }> = [];
  let indexWriteConflicts = options.indexWriteConflicts ?? 0;
  let indexReadCount = 0;
  let indexRaceApplied = false;
  let shaCounter = 1;

  for (const [path, value] of Object.entries(initialFiles)) {
    files.set(path, { value, sha: `sha-${shaCounter}` });
    shaCounter += 1;
  }

  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== githubApi || !url.pathname.startsWith(contentsPrefix)) {
      return Response.json({ message: `Unhandled request: ${request.method} ${request.url}` }, { status: 500 });
    }

    if (request.method === "GET") {
      const path = decodeURIComponent(url.pathname.slice(contentsPrefix.length));
      reads.push(path);
      if (path === "Profiles/index.json") {
        indexReadCount += 1;
        if (options.indexRace && indexReadCount > 1 && !indexRaceApplied) {
          files.set(path, { value: options.indexRace.value, sha: `sha-${shaCounter}` });
          shaCounter += 1;
          indexRaceApplied = true;
        }
      }
      const file = files.get(path);
      if (!file) {
        return Response.json({ message: "Not Found" }, { status: 404 });
      }
      return Response.json({
          type: "file",
          encoding: "base64",
          content: encodeJson(file.value),
          sha: file.sha
      });
    }

    if (request.method === "PUT") {
      const path = decodeURIComponent(url.pathname.slice(contentsPrefix.length));
      if (path === "Profiles/index.json" && indexWriteConflicts > 0) {
        indexWriteConflicts -= 1;
        return Response.json({ message: "Conflict" }, { status: 409 });
      }
      const body = JSON.parse(await request.text());
      if (path === "Profiles/index.json" && options.indexRace && !indexRaceApplied) {
        files.set(path, { value: options.indexRace.value, sha: `sha-${shaCounter}` });
        shaCounter += 1;
        indexRaceApplied = true;
      }
      const existing = files.get(path);
      if (existing && body.sha !== existing.sha) {
        return Response.json({ message: "Conflict" }, { status: 409 });
      }
      if (!existing && body.sha !== undefined) {
        return Response.json({ message: "Missing file" }, { status: 422 });
      }
      const value = decodeJsonContent(body.content);
      writes.push({ path, value, message: body.message, sha: body.sha });
      const sha = `sha-${shaCounter}`;
      shaCounter += 1;
      files.set(path, { value, sha });
      return Response.json({ content: { path, sha } });
    }

    return Response.json({ message: `Unhandled method: ${request.method}` }, { status: 500 });
  });

  return { files, reads, writes };
}

async function jsonFetch(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://example.com${path}`, init);
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    GITHUB_OWNER: "Sabotage1",
    GITHUB_REPO: "WorkFlow-Skin",
    GITHUB_BRANCH: "main",
    PUBLIC_BASE_URL: "https://github.com/Sabotage1/WorkFlow-Skin/tree/main/Profiles",
    CORS_ALLOW_ORIGIN: "*",
    MAX_BODY_BYTES: "750000",
    GITHUB_TOKEN: "test-token",
    OWNER_KEY_SECRET: "test-owner-secret",
    ...overrides
  };
}

async function directWorkerFetch(path: string, env: Env, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://example.com${path}`, init), env, {} as ExecutionContext);
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

function createBody(overrides: Partial<RecommendationInput> = {}) {
  return {
    ownerKey: "owner-key",
    recommendation: {
      ...baseRecommendation,
      ...overrides
    },
    profileJson,
    evidence
  };
}

function existingRecord(id: string, overrides: Partial<RecommendationRecord> = {}): RecommendationRecord {
  return {
    ...baseRecommendation,
    id,
    createdAt: "2026-06-18T12:00:00.000Z",
    updatedAt: "2026-06-18T12:30:00.000Z",
    ownerHash: "stored-owner-proof",
    profile: { ...baseRecommendation.profile, fileName: `${id}.json` },
    evidenceFileName: `${id}.json`,
    ...overrides
  };
}

describe("community Worker API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves an empty recommendation index when GitHub has no index yet", async () => {
    mockGithubContents();

    const response = await jsonFetch("/api/recommendations");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      version: 1,
      updatedAt: "1970-01-01T00:00:00.000Z",
      items: []
    });
  });

  it("uses configured CORS allow origin", async () => {
    mockGithubContents();

    const response = await directWorkerFetch("/api/recommendations", testEnv({ CORS_ALLOW_ORIGIN: "https://skin.example" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://skin.example");
  });

  it("sanitizes persisted index JSON before returning it publicly", async () => {
    mockGithubContents({
      "Profiles/index.json": {
        version: 1,
        updatedAt: "2026-06-18T12:00:00.000Z",
        ownerHash: "leaked-top-level",
        items: [
          {
            id: "rec-existing",
            updatedAt: "2026-06-18T12:00:00.000Z",
            submittedBy: "Roy",
            bag: baseRecommendation.bag,
            profile: baseRecommendation.profile,
            grinder: baseRecommendation.grinder,
            brew: baseRecommendation.brew,
            visualizerUrl: baseRecommendation.visualizerUrl,
            evidenceFileName: "rec-existing.json",
            searchText: "halo",
            ownerHash: "leaked-item",
            extraField: "drop me"
          },
          {
            id: "../../secret",
            updatedAt: "2026-06-18T12:00:00.000Z",
            submittedBy: "Polluted",
            bag: baseRecommendation.bag,
            profile: baseRecommendation.profile,
            grinder: baseRecommendation.grinder,
            brew: baseRecommendation.brew,
            searchText: "polluted"
          }
        ]
      }
    });

    const response = await jsonFetch("/api/recommendations");

    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body).toEqual({
      version: 1,
      updatedAt: "2026-06-18T12:00:00.000Z",
      items: [
        {
          id: "rec-existing",
          updatedAt: "2026-06-18T12:00:00.000Z",
          submittedBy: "Roy",
          bag: baseRecommendation.bag,
          profile: baseRecommendation.profile,
          grinder: baseRecommendation.grinder,
          brew: baseRecommendation.brew,
          visualizerUrl: baseRecommendation.visualizerUrl,
          evidenceFileName: "rec-existing.json",
          searchText: "halo"
        }
      ]
    });
    expect(JSON.stringify(body)).not.toContain("ownerHash");
    expect(JSON.stringify(body)).not.toContain("extraField");
    expect(JSON.stringify(body)).not.toContain("../../secret");
  });

  it("creates a recommendation without exposing ownerHash and stores server-generated filenames", async () => {
    const github = mockGithubContents();

    const response = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(201);
    const body = await responseJson(response);
    const recommendation = body.recommendation as Record<string, unknown>;
    expect(recommendation.id).toMatch(/^rec-[a-z0-9-]+$/);
    expect("ownerHash" in recommendation).toBe(false);
    expect((recommendation.profile as Record<string, unknown>).fileName).toBe(`${recommendation.id}.json`);
    expect(recommendation.evidenceFileName).toBe(`${recommendation.id}.json`);
    expect((body.index as RecommendationIndex).items).toHaveLength(1);

    const id = recommendation.id as string;
    expect(github.writes.map((write) => write.path)).toEqual([
      `Profiles/recommendations/${id}.json`,
      `Profiles/profiles/${id}.json`,
      `Profiles/evidence/${id}.json`,
      "Profiles/index.json"
    ]);
    expect(github.writes[0].value).toMatchObject({
      id,
      profile: { fileName: `${id}.json` },
      evidenceFileName: `${id}.json`
    });
    expect(github.writes[0].value).toHaveProperty("ownerHash");
    expect((github.writes[0].value as RecommendationRecord).ownerHash).not.toBe(await hashOwnerKey("owner-key"));
    expect(github.writes[1].value).toEqual(profileJson);
  });

  it("fails closed without writing when OWNER_KEY_SECRET is missing or blank", async () => {
    const github = mockGithubContents();

    const blankSecretResponse = await directWorkerFetch("/api/recommendations", testEnv({ OWNER_KEY_SECRET: "   " }), {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });
    const missingSecretEnv = testEnv();
    delete (missingSecretEnv as Partial<Env>).OWNER_KEY_SECRET;
    const missingSecretResponse = await directWorkerFetch("/api/recommendations", missingSecretEnv, {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(blankSecretResponse.status).toBe(500);
    expect(missingSecretResponse.status).toBe(500);
    const blankSecretBody = await responseJson(blankSecretResponse);
    const missingSecretBody = await responseJson(missingSecretResponse);
    expect(blankSecretBody).toMatchObject({ error: "server_error" });
    expect(missingSecretBody).toMatchObject({ error: "server_error" });
    expect(JSON.stringify(blankSecretBody)).not.toContain("OWNER_KEY_SECRET");
    expect(JSON.stringify(missingSecretBody)).not.toContain("OWNER_KEY_SECRET");
    expect(github.writes).toHaveLength(0);
  });

  it("still rejects a wrong owner key after creating a secret-peppered verifier", async () => {
    const github = mockGithubContents();

    const createResponse = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });
    const created = await responseJson(createResponse);
    const id = (created.recommendation as RecommendationRecord).id;

    const updateResponse = await jsonFetch(`/api/recommendations/${id}`, {
      method: "PUT",
      body: JSON.stringify({ ...createBody(), ownerKey: "wrong-owner-key" }),
      headers: { "content-type": "application/json" }
    });

    expect(updateResponse.status).toBe(403);
    expect(github.writes.filter((write) => write.path === `Profiles/recommendations/${id}.json`)).toHaveLength(1);
  });

  it("retries index writes after a GitHub conflict during create", async () => {
    const github = mockGithubContents({}, { indexWriteConflicts: 1 });

    const response = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(201);
    const indexWrites = github.writes.filter((write) => write.path === "Profiles/index.json");
    expect(indexWrites).toHaveLength(1);
    expect((indexWrites[0].value as RecommendationIndex).items).toHaveLength(1);
  });

  it("preserves a concurrent index item when the index changes between rebuild and PUT", async () => {
    const concurrent = existingRecord("rec-concurrent", { submittedBy: "Concurrent Roy" });
    const github = mockGithubContents(
      {
        "Profiles/index.json": {
          version: 1,
          updatedAt: "2026-06-18T12:00:00.000Z",
          items: []
        },
        "Profiles/recommendations/rec-concurrent.json": concurrent
      },
      {
        indexRace: {
          value: {
            version: 1,
            updatedAt: "2026-06-18T12:05:00.000Z",
            items: [buildIndexItem(concurrent)]
          }
        }
      }
    );

    const response = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(201);
    const body = await responseJson(response);
    const createdId = ((body.recommendation as Record<string, unknown>).id as string);
    const finalIndex = github.files.get("Profiles/index.json")?.value as RecommendationIndex;
    expect(finalIndex.items.map((item) => item.id).sort()).toEqual([createdId, "rec-concurrent"].sort());
  });

  it("does not read unsafe recommendation paths from a polluted index during create", async () => {
    const github = mockGithubContents({
      "Profiles/index.json": {
        version: 1,
        updatedAt: "2026-06-18T12:00:00.000Z",
        items: [
          {
            id: "../../secret",
            updatedAt: "2026-06-18T12:00:00.000Z",
            submittedBy: "Polluted",
            bag: baseRecommendation.bag,
            profile: baseRecommendation.profile,
            grinder: baseRecommendation.grinder,
            brew: baseRecommendation.brew,
            searchText: "polluted"
          }
        ]
      },
      "Profiles/recommendations/../../secret.json": existingRecord("rec-secret")
    });

    const response = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(201);
    expect(github.reads).not.toContain("Profiles/recommendations/../../secret.json");
    const finalIndex = github.files.get("Profiles/index.json")?.value as RecommendationIndex;
    expect(finalIndex.items.map((item) => item.id)).not.toContain("../../secret");
  });

  it("returns public recommendation detail without exposing ownerHash", async () => {
    const existing: RecommendationRecord = {
      ...baseRecommendation,
      id: "rec-existing",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:30:00.000Z",
      ownerHash: await hashOwnerKey("owner-key"),
      profile: { ...baseRecommendation.profile, fileName: "rec-existing.json" },
      evidenceFileName: "rec-existing.json"
    };
    mockGithubContents({
      "Profiles/recommendations/rec-existing.json": existing
    });

    const response = await jsonFetch("/api/recommendations/rec-existing");

    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.recommendation).toMatchObject({ id: "rec-existing" });
    expect("ownerHash" in (body.recommendation as Record<string, unknown>)).toBe(false);
  });

  it("rejects edits without an owner key", async () => {
    mockGithubContents();

    const response = await jsonFetch("/api/recommendations/rec-existing", {
      method: "PUT",
      body: JSON.stringify({ ...createBody(), ownerKey: "" }),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
  });

  it("rejects updates with the wrong owner key", async () => {
    const existing: RecommendationRecord = {
      ...baseRecommendation,
      id: "rec-existing",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:00:00.000Z",
      ownerHash: await hashOwnerKey("right-owner"),
      profile: { ...baseRecommendation.profile, fileName: "rec-existing.json" },
      evidenceFileName: "rec-existing.json"
    };
    mockGithubContents({
      "Profiles/recommendations/rec-existing.json": existing,
      "Profiles/profiles/rec-existing.json": profileJson
    });

    const response = await jsonFetch("/api/recommendations/rec-existing", {
      method: "PUT",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "forbidden" });
  });

  it("preserves existing evidence reference when update omits evidence", async () => {
    const github = mockGithubContents();
    const createResponse = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });
    const created = await responseJson(createResponse);
    const id = (created.recommendation as RecommendationRecord).id;
    const updateBody = createBody({ submittedBy: "Roy Updated" });
    delete (updateBody as { evidence?: ShotEvidence }).evidence;

    const updateResponse = await jsonFetch(`/api/recommendations/${id}`, {
      method: "PUT",
      body: JSON.stringify(updateBody),
      headers: { "content-type": "application/json" }
    });

    expect(updateResponse.status).toBe(200);
    const body = await responseJson(updateResponse);
    expect((body.recommendation as RecommendationRecord).evidenceFileName).toBe(`${id}.json`);
    const recommendationWrites = github.writes.filter((write) => write.path === `Profiles/recommendations/${id}.json`);
    expect((recommendationWrites.at(-1)?.value as RecommendationRecord).evidenceFileName).toBe(`${id}.json`);
    expect(github.writes.filter((write) => write.path === `Profiles/evidence/${id}.json`)).toHaveLength(1);
  });

  it("downloads public recommendation payloads with profile and evidence", async () => {
    const existing: RecommendationRecord = {
      ...baseRecommendation,
      id: "rec-existing",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:30:00.000Z",
      ownerHash: await hashOwnerKey("owner-key"),
      profile: { ...baseRecommendation.profile, fileName: "rec-existing.json" },
      evidenceFileName: "rec-existing.json"
    };
    mockGithubContents({
      "Profiles/recommendations/rec-existing.json": existing,
      "Profiles/profiles/rec-existing.json": profileJson,
      "Profiles/evidence/rec-existing.json": evidence
    });

    const response = await jsonFetch("/api/download/rec-existing");

    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.profileJson).toEqual(profileJson);
    expect(body.evidence).toEqual(evidence);
    expect(body.recommendation).toMatchObject({ id: "rec-existing" });
    expect("ownerHash" in (body.recommendation as Record<string, unknown>)).toBe(false);
  });

  it("downloads profile and evidence from stored safe legacy filenames", async () => {
    const existing: RecommendationRecord = {
      ...baseRecommendation,
      id: "rec-existing",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:30:00.000Z",
      ownerHash: await hashOwnerKey("owner-key"),
      profile: { ...baseRecommendation.profile, fileName: "legacy-profile.json" },
      evidenceFileName: "legacy-evidence.json"
    };
    const github = mockGithubContents({
      "Profiles/recommendations/rec-existing.json": existing,
      "Profiles/profiles/legacy-profile.json": profileJson,
      "Profiles/evidence/legacy-evidence.json": evidence
    });

    const response = await jsonFetch("/api/download/rec-existing");

    expect(response.status).toBe(200);
    const body = await responseJson(response);
    expect(body.profileJson).toEqual(profileJson);
    expect(body.evidence).toEqual(evidence);
    expect(github.reads).toContain("Profiles/profiles/legacy-profile.json");
    expect(github.reads).toContain("Profiles/evidence/legacy-evidence.json");
  });

  it("rejects unsafe stored download filenames without path traversal reads", async () => {
    const existing: RecommendationRecord = {
      ...baseRecommendation,
      id: "rec-existing",
      createdAt: "2026-06-18T12:00:00.000Z",
      updatedAt: "2026-06-18T12:30:00.000Z",
      ownerHash: await hashOwnerKey("owner-key"),
      profile: { ...baseRecommendation.profile, fileName: "../secret.json" },
      evidenceFileName: "legacy-evidence.json"
    };
    const github = mockGithubContents({
      "Profiles/recommendations/rec-existing.json": existing,
      "Profiles/profiles/../secret.json": { title: "secret" },
      "Profiles/evidence/legacy-evidence.json": evidence
    });

    const response = await jsonFetch("/api/download/rec-existing");

    expect(response.status).toBe(500);
    expect(github.reads).not.toContain("Profiles/profiles/../secret.json");
    expect(github.reads).not.toContain("Profiles/evidence/legacy-evidence.json");
  });

  it("returns 400 for invalid JSON bodies", async () => {
    mockGithubContents();

    const response = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: "{not-json",
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
  });

  it("returns 413 for oversized request bodies before GitHub writes", async () => {
    const github = mockGithubContents();

    const response = await directWorkerFetch("/api/recommendations", testEnv({ MAX_BODY_BYTES: "10" }), {
      method: "POST",
      body: JSON.stringify(createBody()),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
    expect(github.writes).toHaveLength(0);
  });

  it("returns 413 from oversized Content-Length before reading the body", async () => {
    const github = mockGithubContents();

    const response = await directWorkerFetch("/api/recommendations", testEnv({ MAX_BODY_BYTES: "10" }), {
      method: "POST",
      body: "{}",
      headers: {
        "content-type": "application/json",
        "content-length": "100"
      }
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
    expect(github.writes).toHaveLength(0);
  });

  it("returns 413 from a stream body as soon as accumulated bytes exceed the limit", async () => {
    const github = mockGithubContents();
    let pullCount = 0;
    const oversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount === 0) {
          pullCount += 1;
          controller.enqueue(new TextEncoder().encode("01234567890"));
          return;
        }
        throw new Error("Reader continued after the body exceeded the byte cap.");
      }
    });

    const response = await directWorkerFetch("/api/recommendations", testEnv({ MAX_BODY_BYTES: "10" }), {
      method: "POST",
      body: oversizedStream,
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
    expect(github.writes).toHaveLength(0);
  });

  it("returns 413 even if stream cancellation fails after exceeding the byte cap", async () => {
    const github = mockGithubContents();
    const oversizedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("01234567890"));
      },
      cancel() {
        throw new Error("cancel failed");
      }
    });

    const response = await directWorkerFetch("/api/recommendations", testEnv({ MAX_BODY_BYTES: "10" }), {
      method: "POST",
      body: oversizedStream,
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
    expect(github.writes).toHaveLength(0);
  });

  it("returns 400 for invalid recommendation payloads", async () => {
    mockGithubContents();

    const response = await jsonFetch("/api/recommendations", {
      method: "POST",
      body: JSON.stringify(createBody({ submittedBy: "person@example.com" })),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "bad_request" });
  });
});
