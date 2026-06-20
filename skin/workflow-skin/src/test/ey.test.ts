import { describe, expect, it } from "vitest";
import { calculateEy, cleanNumber } from "../lib/ey";

describe("calculateEy", () => {
  it("calculates EY from yield, TDS percent, and dose", () => {
    expect(calculateEy({ yieldGrams: 40, tdsPercent: 9.5, doseGrams: 18 })).toBe(21.11);
  });

  it("returns null when dose is not positive", () => {
    expect(calculateEy({ yieldGrams: 40, tdsPercent: 9.5, doseGrams: 0 })).toBeNull();
  });
});

describe("cleanNumber", () => {
  it("parses finite text numbers and rejects blanks", () => {
    expect(cleanNumber(" 9.5 ")).toBe(9.5);
    expect(cleanNumber("")).toBeNull();
    expect(cleanNumber("   ")).toBeNull();
    expect(cleanNumber("abc")).toBeNull();
  });
});
