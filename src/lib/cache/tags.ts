/**
 * Central cache-tag vocabulary.
 *
 * Tags are the only sanctioned invalidation keys; free-form strings in
 * feature code invite drift between `cacheTag()` writes and `updateTag()`
 * invalidations. Composite builders keep entity-scoped tags consistent.
 */

export const CACHE_TAGS = {
  auditLog: "audit-log",
  categories: "categories",
  customers: "customers",
  invoices: "invoices",
  orders: "orders",
  products: "products",
  users: "users",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

/** Entity-composite tag, e.g. `user:<id>`, invalidated alongside the base tag. */
export function entityTag(base: CacheTag, id: string): string {
  return `${base}:${id}`;
}

/**
 * Named cache-lifetime configurations for `cacheLife`.
 *
 * Values are seconds. `stale` extends serve-stale windows, `revalidate` is
 * the background refresh cadence, `expire` bounds total freshness. These
 * mirror the built-in profile shapes so feature queries stay declarative
 * without hand-tuned literals at every call site.
 */
export const CACHE_LIFETIMES = {
  /** Slow-moving master data (categories, product catalog pages). */
  referenceData: {
    expire: 86_400,
    revalidate: 14_400,
    stale: 3_600,
  },
  /** Operational lists where minutes of staleness are acceptable. */
  operationalLists: {
    expire: 3_600,
    revalidate: 900,
    stale: 60,
  },
  /**
   * Per-request-ish data: effectively dynamic. Short-lived caches are
   * excluded from prerenders automatically.
   */
  volatile: {
    expire: 240,
    revalidate: 30,
    stale: 0,
  },
} as const;
