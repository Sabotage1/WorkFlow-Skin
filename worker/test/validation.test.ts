import { describe, expect, it } from "vitest";
import { buildIndexItem, toPublicRecommendation, validateProfileJson, validateRecommendationInput } from "../src/validation";
import type { RecommendationInput } from "../src/types";

const validInput: RecommendationInput = {
  submittedBy: "Roy",
  bag: {
    id: "batch-1",
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
    fileName: "rec-1.json",
    installedTitle: "Blooming - Halo - Roy"
  },
  grinder: {
    id: "grinder-1",
    model: "ZP6",
    burrs: "MP",
    burrType: "flat",
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
  evidenceFileName: "rec-1.json"
};

describe("validateRecommendationInput", () => {
  it("accepts a complete recommendation", () => {
    expect(validateRecommendationInput(validInput)).toEqual({ ok: true, value: validInput });
  });

  it("rejects email-only submittedBy", () => {
    const result = validateRecommendationInput({ ...validInput, submittedBy: "person@example.com" });
    expect(result).toEqual({ ok: false, error: "Public display name is required; email addresses are not allowed." });
  });

  it("rejects embedded email addresses in submittedBy", () => {
    expect(validateRecommendationInput({ ...validInput, submittedBy: "Roy <person@example.com>" })).toEqual({
      ok: false,
      error: "Public display name is required; email addresses are not allowed."
    });
    expect(validateRecommendationInput({ ...validInput, submittedBy: "person@example.com / Roy" })).toEqual({
      ok: false,
      error: "Public display name is required; email addresses are not allowed."
    });
  });

  it("returns validation errors for malformed top-level and nested shapes", () => {
    expect(() => validateRecommendationInput(null)).not.toThrow();
    expect(validateRecommendationInput(null)).toEqual({ ok: false, error: "Recommendation must be an object." });

    expect(validateRecommendationInput({ ...validInput, bag: undefined })).toEqual({ ok: false, error: "Missing required fields: bag." });
    expect(validateRecommendationInput({ ...validInput, bag: [] })).toEqual({ ok: false, error: "Missing required fields: bag." });
    expect(validateRecommendationInput({ ...validInput, profile: undefined })).toEqual({ ok: false, error: "Missing required fields: profile." });
    expect(validateRecommendationInput({ ...validInput, grinder: undefined })).toEqual({ ok: false, error: "Missing required fields: grinder." });
    expect(validateRecommendationInput({ ...validInput, brew: undefined })).toEqual({ ok: false, error: "Missing required fields: brew." });
    expect(validateRecommendationInput({ ...validInput, brew: null })).toEqual({ ok: false, error: "Missing required fields: brew." });
  });

  it("requires existing bag fields and brew fields", () => {
    const result = validateRecommendationInput({
      ...validInput,
      bag: { ...validInput.bag, country: "" },
      brew: { ...validInput.brew, notes: "" }
    });
    expect(result).toEqual({ ok: false, error: "Missing required fields: bag.country, brew.notes." });
  });

  it("requires flat or conical grinder burrs type", () => {
    expect(validateRecommendationInput({ ...validInput, grinder: { ...validInput.grinder, burrType: "" } })).toEqual({
      ok: false,
      error: "Missing required fields: grinder.burrType."
    });
    expect(validateRecommendationInput({ ...validInput, grinder: { ...validInput.grinder, burrType: "hybrid" } })).toEqual({
      ok: false,
      error: "Invalid field types: grinder.burrType."
    });
  });

  it("rejects invalid visualizer URLs", () => {
    const result = validateRecommendationInput({ ...validInput, visualizerUrl: "ftp://visualizer.coffee/shots/abc" });
    expect(result).toEqual({ ok: false, error: "Visualizer URL must be a valid HTTP or HTTPS URL." });
  });

  it("rejects unsafe profile and evidence file names", () => {
    expect(validateRecommendationInput({ ...validInput, profile: { ...validInput.profile, fileName: "../x.json" } })).toEqual({
      ok: false,
      error: "File names must be safe JSON file names."
    });
    expect(validateRecommendationInput({ ...validInput, profile: { ...validInput.profile, fileName: "nested/file.json" } })).toEqual({
      ok: false,
      error: "File names must be safe JSON file names."
    });
    expect(validateRecommendationInput({ ...validInput, profile: { ...validInput.profile, fileName: "rec-1.txt" } })).toEqual({
      ok: false,
      error: "File names must be safe JSON file names."
    });
    expect(validateRecommendationInput({ ...validInput, evidenceFileName: "bad name.json" })).toEqual({
      ok: false,
      error: "File names must be safe JSON file names."
    });
  });

  it("normalizes non-critical optional metadata instead of rejecting uploads", () => {
    expect(validateRecommendationInput({ ...validInput, bag: { ...validInput.bag, region: 42, roastLevel: 2 }, grinder: { ...validInput.grinder, settingType: "stepless" } })).toEqual({
      ok: true,
      value: {
        ...validInput,
        bag: { ...validInput.bag, region: "42", roastLevel: "2" },
        grinder: {
          id: "grinder-1",
          model: "ZP6",
          burrs: "MP",
          burrType: "flat",
          notes: "zero at chirp"
        }
      }
    });
  });

  it("rejects invalid visualizer URL types", () => {
    expect(validateRecommendationInput({ ...validInput, visualizerUrl: 42 })).toEqual({
      ok: false,
      error: "Invalid field types: visualizerUrl."
    });
  });

  it("accepts seconds goal or range and rejects inverted ranges", () => {
    expect(validateRecommendationInput({ ...validInput, brew: { ...validInput.brew, secondsGoal: 31, secondsMin: undefined, secondsMax: undefined } })).toEqual({
      ok: true,
      value: {
        ...validInput,
        brew: {
          grindSetting: "4.2",
          beansWeight: 18,
          drinkWeight: 42,
          secondsGoal: 31,
          notes: "Gentle declining pressure after bloom"
        }
      }
    });
    expect(validateRecommendationInput(validInput)).toEqual({ ok: true, value: validInput });
    expect(validateRecommendationInput({ ...validInput, brew: { ...validInput.brew, secondsMin: 34, secondsMax: 28 } })).toEqual({
      ok: false,
      error: "Missing required fields: brew.secondsGoalOrRange."
    });
  });

  it("rejects invalid known optional timing field types", () => {
    expect(validateRecommendationInput({ ...validInput, brew: { ...validInput.brew, secondsGoal: "31", secondsMin: 28, secondsMax: 34 } })).toEqual({
      ok: false,
      error: "Invalid field types: brew.secondsGoal."
    });
    expect(validateRecommendationInput({ ...validInput, brew: { ...validInput.brew, secondsGoal: 31, secondsMin: "28", secondsMax: 34 } })).toEqual({
      ok: false,
      error: "Invalid field types: brew.secondsMin."
    });
    expect(validateRecommendationInput({ ...validInput, brew: { ...validInput.brew, secondsGoal: 31, secondsMin: 28, secondsMax: "34" } })).toEqual({
      ok: false,
      error: "Invalid field types: brew.secondsMax."
    });
  });

  it("normalizes strings and strips unknown fields", () => {
    const result = validateRecommendationInput({
      extra: "drop me",
      submittedBy: "  Roy  ",
      bag: {
        ...validInput.bag,
        id: "  batch-1  ",
        region: "  Yirgacheffe  ",
        roastLevel: "  Light  ",
        notes: "  floral  ",
        extra: "drop me"
      },
      profile: {
        ...validInput.profile,
        originalTitle: "  Blooming  ",
        extra: "drop me"
      },
      grinder: {
        ...validInput.grinder,
        burrType: "  flat  ",
        notes: "  zero at chirp  ",
        extra: "drop me"
      },
      brew: {
        ...validInput.brew,
        grindSetting: "  4.2  ",
        notes: "  Gentle declining pressure after bloom  ",
        extra: "drop me"
      },
      visualizerUrl: "  https://visualizer.coffee/shots/abc  ",
      evidenceFileName: "  rec-1.json  "
    });

    expect(result).toEqual({
      ok: true,
      value: {
        submittedBy: "Roy",
        bag: {
          id: "batch-1",
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
          fileName: "rec-1.json",
          installedTitle: "Blooming - Halo - Roy"
        },
        grinder: {
          id: "grinder-1",
          model: "ZP6",
          burrs: "MP",
          burrType: "flat",
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
        evidenceFileName: "rec-1.json"
      }
    });
  });
});

describe("validateProfileJson", () => {
  it("accepts sane profile objects", () => {
    const profileJson = { title: "Blooming", steps: [{ name: "bloom" }] };
    expect(validateProfileJson(profileJson)).toEqual({ ok: true, value: profileJson });
  });

  it("rejects malformed profile object shapes", () => {
    expect(validateProfileJson(null)).toEqual({ ok: false, error: "Profile JSON must be an object." });
    expect(validateProfileJson([])).toEqual({ ok: false, error: "Profile JSON must be an object." });
    expect(validateProfileJson({ title: 42 })).toEqual({ ok: false, error: "Profile title must be a string when present." });
    expect(validateProfileJson({ steps: "bloom" })).toEqual({ ok: false, error: "Profile steps must be an array when present." });
  });
});

describe("buildIndexItem", () => {
  it("indexes every searchable field", () => {
    const item = buildIndexItem({
      id: "rec-1",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      ownerHash: "hash",
      shotScore: 8,
      ...validInput
    });

    expect(item.searchText).toContain("pilot");
    expect(item.searchText).toContain("halo");
    expect(item.searchText).toContain("profile-1");
    expect(item.searchText).toContain("rec-1.json");
    expect(item.searchText).toContain("grinder-1");
    expect(item.searchText).toContain("zp6");
    expect(item.searchText).toContain("flat");
    expect(item.searchText).toContain("4.2");
    expect(item.searchText).toContain("gentle declining pressure");
    expect(item.searchText).toContain("8");
    expect(item.searchText).toContain("visualizer.coffee");
    expect(item.shotScore).toBe(8);
    expect(item.bag).toEqual(validInput.bag);
    expect(item.bag).not.toBe(validInput.bag);
    expect(item.profile).toEqual(validInput.profile);
    expect(item.profile).not.toBe(validInput.profile);
    expect(item.grinder).toEqual(validInput.grinder);
    expect(item.grinder).not.toBe(validInput.grinder);
    expect(item.brew).toEqual(validInput.brew);
    expect(item.brew).not.toBe(validInput.brew);
  });
});

describe("toPublicRecommendation", () => {
  it("omits ownerHash from public recommendation records", () => {
    const publicRecord = toPublicRecommendation({
      id: "rec-1",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      ownerHash: "secret-hash",
      shotScore: 8,
      ...validInput
    });

    expect(publicRecord).toEqual({
      id: "rec-1",
      createdAt: "2026-06-18T00:00:00.000Z",
      updatedAt: "2026-06-18T00:00:00.000Z",
      shotScore: 8,
      ...validInput
    });
    expect("ownerHash" in publicRecord).toBe(false);
  });
});
