import { describe, expect, it } from "vitest";
import { isPrimaryScaleCandidate, supportsEarlyScaleReconnect, usesNativeScaleRecovery } from "../lib/scaleConnection";

describe("native scale compatibility", () => {
  it.each(["0.8.8", "0.9.0-beta.1", "0.9.0-beta.2", "1.0.0", "v0.8.8+2123"])("uses native recovery on %s", (version) => {
    expect(usesNativeScaleRecovery(version)).toBe(true);
  });
  it.each([undefined, "unknown", "0.7.15", "0.8.5", "0.8.6", "0.8.7"])("preserves legacy recovery on %s", (version) => {
    expect(usesNativeScaleRecovery(version)).toBe(false);
  });
  it.each(["0.9.0-beta.2", "0.9.0-beta.3+2222", "0.9.0", "0.9.1", "0.10.0", "1.0.0"])("opts into safe early reconnect on %s", (version) => {
    expect(supportsEarlyScaleReconnect(version)).toBe(true);
  });
  it.each([undefined, "0.8.8", "0.9.0-beta.1"])("omits the new option on %s", (version) => {
    expect(supportsEarlyScaleReconnect(version)).toBe(false);
  });
  it("keeps auxiliary scales, grinders and R2 out of primary scale recovery", () => {
    expect(isPrimaryScaleCandidate({ id: "aux", type: "scale", connectionRole: "auxiliary" })).toBe(false);
    expect(isPrimaryScaleCandidate({ id: "grinder", type: "grinder", name: "Grinder with scale" })).toBe(false);
    expect(isPrimaryScaleCandidate({ id: "r2", name: "DiFluid R2", type: "sensor" })).toBe(false);
    expect(isPrimaryScaleCandidate({ id: "primary", type: "scale", name: "Plugin scale", connectionRole: "primary" })).toBe(true);
  });
});
