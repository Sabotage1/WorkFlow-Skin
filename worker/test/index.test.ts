import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("community Worker scaffold", () => {
  it("returns JSON 404 for unknown routes", async () => {
    const response = await SELF.fetch("https://example.com/unknown");

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "Not found"
    });
  });
});
