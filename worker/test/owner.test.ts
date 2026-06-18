import { describe, expect, it } from "vitest";
import { hashOwnerKey, ownerHashesMatch } from "../src/owner";

describe("owner proof helpers", () => {
  it("hashes owner keys deterministically", async () => {
    await expect(hashOwnerKey("owner-key")).resolves.toBe(await hashOwnerKey("owner-key"));
    await expect(hashOwnerKey("owner-key")).resolves.not.toBe(await hashOwnerKey("other-key"));
  });

  it("compares hashes without accepting different values", async () => {
    const hash = await hashOwnerKey("owner-key");
    await expect(ownerHashesMatch(hash, "owner-key")).resolves.toBe(true);
    await expect(ownerHashesMatch(hash, "wrong-key")).resolves.toBe(false);
  });
});
