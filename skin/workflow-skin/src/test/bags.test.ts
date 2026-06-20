import { describe, expect, it } from "vitest";
import type { Bean, BeanBatch, ShotRecord } from "../api/types";
import { buildBag, filterShotsByBagFields, isValidBag, type Bag } from "../lib/bags";

const bean: Bean = {
  id: "bean-1",
  roaster: "April",
  name: "Ethiopia Anaerobic",
  country: "Ethiopia",
  region: "Sidama",
  processing: "anaerobic"
};

const batch: BeanBatch = {
  id: "batch-1",
  beanId: "bean-1",
  roastDate: "2026-06-01T00:00:00.000Z",
  roastLevel: "light"
};

describe("bag helpers", () => {
  it("requires roaster, bean, country, roast date, and process for valid bags", () => {
    expect(isValidBag(buildBag(bean, batch))).toBe(true);
    expect(isValidBag(buildBag({ ...bean, processing: undefined }, batch))).toBe(false);
  });

  it.each([
    ["roaster missing", { roaster: undefined }],
    ["roaster blank", { roaster: "   " }],
    ["bean missing", { bean: undefined }],
    ["bean blank", { bean: "   " }],
    ["country missing", { country: undefined }],
    ["country blank", { country: "   " }],
    ["roast date missing", { roastDate: undefined }],
    ["roast date blank", { roastDate: "   " }],
    ["process missing", { process: undefined }],
    ["process blank", { process: "   " }]
  ])("rejects invalid bags when %s", (_label, override) => {
    const invalidBag: Bag = { ...buildBag(bean, batch), ...override };
    expect(isValidBag(invalidBag)).toBe(false);
  });

  it("filters shots by joined bag fields", () => {
    const shots: ShotRecord[] = [
      { id: "s1", timestamp: "2026-06-09T10:00:00Z", workflow: { context: { beanBatchId: "batch-1" } } },
      { id: "s2", timestamp: "2026-06-09T11:00:00Z", workflow: { context: { beanBatchId: "batch-2" } } }
    ];
    const result = filterShotsByBagFields(shots, [buildBag(bean, batch)], { country: "Ethiopia", process: "anaerobic" });
    expect(result.map((shot) => shot.id)).toEqual(["s1"]);
  });

  it("filters bags and shots by optional bag name", () => {
    const namedBag = { ...buildBag(bean, batch), name: "Morning Dial" };
    const otherBag = { ...buildBag({ ...bean, id: "bean-2", name: "Kenya" }, { ...batch, id: "batch-2", beanId: "bean-2" }), name: "Evening" };
    const shots: ShotRecord[] = [
      { id: "s1", timestamp: "2026-06-09T10:00:00Z", workflow: { context: { beanBatchId: "batch-1" } } },
      { id: "s2", timestamp: "2026-06-09T11:00:00Z", workflow: { context: { beanBatchId: "batch-2" } } }
    ];

    const result = filterShotsByBagFields(shots, [namedBag, otherBag], { name: "morning" });

    expect(result.map((shot) => shot.id)).toEqual(["s1"]);
  });

  it("returns all shots unchanged when no bag filters are active", () => {
    const shots: ShotRecord[] = [
      { id: "s1", timestamp: "2026-06-09T10:00:00Z", workflow: { context: { beanBatchId: "batch-1" } } },
      { id: "s2", timestamp: "2026-06-09T11:00:00Z", workflow: { context: { beanBatchId: "batch-2" } } },
      { id: "s3", timestamp: "2026-06-09T12:00:00Z", workflow: { context: {} } }
    ];
    expect(filterShotsByBagFields(shots, [buildBag(bean, batch)], {})).toBe(shots);
    expect(filterShotsByBagFields(shots, [buildBag(bean, batch)], { country: "   " })).toBe(shots);
  });

  it("normalizes whitespace-padded filters before matching", () => {
    const shots: ShotRecord[] = [
      { id: "s1", timestamp: "2026-06-09T10:00:00Z", workflow: { context: { beanBatchId: "batch-1" } } },
      { id: "s2", timestamp: "2026-06-09T11:00:00Z", workflow: { context: { beanBatchId: "batch-2" } } }
    ];
    const result = filterShotsByBagFields(shots, [buildBag(bean, batch)], { country: " Ethiopia " });
    expect(result.map((shot) => shot.id)).toEqual(["s1"]);
  });
});
