import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityApi, CommunityApiError, type CommunityWritePayload } from "../api/community";

const writePayload: CommunityWritePayload = {
  ownerKey: "owner-key",
  recommendation: {
    submittedBy: "Roy",
    bag: {
      id: "bag-1",
      beanId: "bean-1",
      roaster: "Pilot",
      bean: "Halo",
      country: "Ethiopia",
      process: "Washed",
      roastDate: "2026-06-01"
    },
    profile: {
      originalId: "profile-1",
      originalTitle: "Bloom",
      fileName: "bloom.json",
      installedTitle: "Bloom"
    },
    grinder: {
      id: "grinder-1",
      model: "Niche"
    },
    brew: {
      grindSetting: "12",
      beansWeight: 18,
      drinkWeight: 40,
      notes: "Sweet"
    }
  },
  profileJson: { title: "Bloom" }
};

describe("CommunityApi", () => {
  afterEach(() => vi.restoreAllMocks());

  it("lists recommendations from the Worker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ version: 1, updatedAt: "now", items: [] }), { status: 200 }));
    await expect(new CommunityApi("https://worker.example").listRecommendations()).resolves.toEqual({ version: 1, updatedAt: "now", items: [] });
    expect(fetch).toHaveBeenCalledWith("https://worker.example/api/recommendations", expect.objectContaining({ method: "GET" }));
  });

  it("throws readable errors from the Worker", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "bad upload" }), { status: 400 }));
    await expect(new CommunityApi("https://worker.example").listRecommendations()).rejects.toThrow("GET /api/recommendations failed: 400 bad upload");
  });

  it("prefers detailed Worker error messages over generic error codes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "bad_request", message: "Missing required fields: bag.process." }), { status: 400 })
    );

    await expect(new CommunityApi("https://worker.example").create(writePayload)).rejects.toThrow("POST /api/recommendations failed: 400 Missing required fields: bag.process.");
  });

  it("trims trailing base URL slashes and encodes recommendation ids", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "profile/one", submittedBy: "Roy" }), { status: 200 }));
    await new CommunityApi("https://worker.example///").getRecommendation("profile/one");
    expect(fetch).toHaveBeenCalledWith("https://worker.example/api/recommendations/profile%2Fone", expect.objectContaining({ method: "GET" }));
  });

  it("creates recommendations with a JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ recommendation: { id: "rec-1" }, index: { version: 1, updatedAt: "now", items: [] } }), { status: 200 })
    );

    await new CommunityApi("https://worker.example").create(writePayload);

    expect(fetch).toHaveBeenCalledWith(
      "https://worker.example/api/recommendations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(writePayload)
      })
    );
  });

  it("sets JSON content type through a Headers object", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ recommendation: { id: "rec-1" }, index: { version: 1, updatedAt: "now", items: [] } }), { status: 200 })
    );

    await new CommunityApi("https://worker.example").create(writePayload);

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init?.headers).toBeInstanceOf(Headers);
    expect((init?.headers as Headers).get("content-type")).toBe("application/json");
  });

  it("updates recommendations with an encoded id and JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ recommendation: { id: "rec/1" }, index: { version: 1, updatedAt: "now", items: [] } }), { status: 200 })
    );

    await new CommunityApi("https://worker.example").update("rec/1", writePayload);

    expect(fetch).toHaveBeenCalledWith(
      "https://worker.example/api/recommendations/rec%2F1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify(writePayload)
      })
    );
  });

  it("deletes recommendations with an encoded id and owner key body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "rec/1", index: { version: 1, updatedAt: "now", items: [] } }), { status: 200 })
    );

    await new CommunityApi("https://worker.example").delete("rec/1", { ownerKey: "owner-key" });

    expect(fetch).toHaveBeenCalledWith(
      "https://worker.example/api/recommendations/rec%2F1",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ ownerKey: "owner-key" })
      })
    );
  });

  it("ranks recommendations with an encoded id and owner key body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ recommendation: { id: "rec/1", communityRatingAverage: 4 }, rating: 4, index: { version: 1, updatedAt: "now", items: [] } }), { status: 200 })
    );

    await new CommunityApi("https://worker.example").rate("rec/1", { ownerKey: "owner-key", rating: 4 });

    expect(fetch).toHaveBeenCalledWith(
      "https://worker.example/api/recommendations/rec%2F1/rating",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ ownerKey: "owner-key", rating: 4 })
      })
    );
  });

  it("exposes response status on Worker errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    await expect(new CommunityApi("https://worker.example").download("missing")).rejects.toMatchObject({
      name: "CommunityApiError",
      status: 404
    } satisfies Partial<CommunityApiError>);
  });
});
