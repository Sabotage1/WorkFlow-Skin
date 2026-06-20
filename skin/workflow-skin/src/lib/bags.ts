import type { Bean, BeanBatch, ShotRecord } from "../api/types";

export interface Bag {
  id: string;
  beanId: string;
  name?: string;
  roaster?: string;
  bean?: string;
  country?: string;
  region?: string;
  process?: string;
  roastDate?: string;
  roastLevel?: string;
  notes?: string;
}

export interface BagFilters {
  name?: string;
  roaster?: string;
  bean?: string;
  country?: string;
  region?: string;
  process?: string;
  roastLevel?: string;
}

const filterKeys = ["name", "roaster", "bean", "country", "region", "process", "roastLevel"] as const;

export function buildBag(bean: Bean, batch: BeanBatch): Bag {
  const workflowSkin = batch.extras?.workflowSkin as { name?: unknown } | undefined;
  return {
    id: batch.id,
    beanId: bean.id,
    name: typeof workflowSkin?.name === "string" ? workflowSkin.name : undefined,
    roaster: bean.roaster,
    bean: bean.name,
    country: bean.country,
    region: bean.region,
    process: bean.processing,
    roastDate: batch.roastDate,
    roastLevel: batch.roastLevel,
    notes: batch.notes ?? bean.notes
  };
}

export function isValidBag(bag: Bag): boolean {
  return Boolean(bag.roaster?.trim() && bag.bean?.trim() && bag.country?.trim() && bag.roastDate?.trim() && bag.process?.trim());
}

function normalizeFilter(filter: string | undefined): string | undefined {
  const normalized = filter?.trim();
  return normalized ? normalized : undefined;
}

function hasActiveFilters(filters: BagFilters): boolean {
  return filterKeys.some((key) => Boolean(normalizeFilter(filters[key])));
}

function matches(value: string | undefined, filter: string | undefined): boolean {
  const normalizedFilter = normalizeFilter(filter);
  if (!normalizedFilter) return true;
  return (value ?? "").toLowerCase().includes(normalizedFilter.toLowerCase());
}

export function filterBags(bags: Bag[], filters: BagFilters): Bag[] {
  return bags.filter((bag) =>
    matches(bag.name, filters.name) &&
    matches(bag.roaster, filters.roaster) &&
    matches(bag.bean, filters.bean) &&
    matches(bag.country, filters.country) &&
    matches(bag.region, filters.region) &&
    matches(bag.process, filters.process) &&
    matches(bag.roastLevel, filters.roastLevel)
  );
}

export function filterShotsByBagFields(shots: ShotRecord[], bags: Bag[], filters: BagFilters): ShotRecord[] {
  if (!hasActiveFilters(filters)) return shots;
  const matchingBatchIds = new Set(filterBags(bags, filters).map((bag) => bag.id));
  return shots.filter((shot) => {
    const batchId = shot.workflow.context?.beanBatchId;
    return batchId ? matchingBatchIds.has(batchId) : false;
  });
}
