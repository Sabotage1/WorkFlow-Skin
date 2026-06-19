import { describe, expect, it } from "vitest";
import { isManagedCommunityContentPath } from "../src/github";

describe("GitHub managed content path allowlist", () => {
  it("allows only community profile and history data paths", () => {
    expect(isManagedCommunityContentPath("Profiles/index.json")).toBe(true);
    expect(isManagedCommunityContentPath("Profiles/recommendations/rec-1.json")).toBe(true);
    expect(isManagedCommunityContentPath("Profiles/profiles/rec-1.json")).toBe(true);
    expect(isManagedCommunityContentPath("Profiles/evidence/rec-1.json")).toBe(true);
    expect(isManagedCommunityContentPath("Profiles/history/shot-1.json")).toBe(true);
  });

  it("blocks skin, release, workflow, and repository metadata paths", () => {
    expect(isManagedCommunityContentPath("skin/workflow-skin/package.json")).toBe(false);
    expect(isManagedCommunityContentPath("skin/workflow-skin/workflow-skin.zip")).toBe(false);
    expect(isManagedCommunityContentPath(".github/workflows/release.yml")).toBe(false);
    expect(isManagedCommunityContentPath("README.md")).toBe(false);
    expect(isManagedCommunityContentPath("Profiles/../skin/workflow-skin/package.json")).toBe(false);
  });
});
