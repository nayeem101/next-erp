import { z } from "zod";

/**
 * Role-aware dashboard contracts.
 *
 * Ranges drive every aggregate window. Variants (`sales`, `operations`,
 * `units`) are SERVER-DERIVED projection keys baked into cache entries;
 * they are never accepted from the browser.
 */

export const DASHBOARD_RANGE_OPTIONS = ["30d", "90d", "12m"] as const;

export const dashboardRangeSchema = z.enum(DASHBOARD_RANGE_OPTIONS);

export type DashboardRange = z.infer<typeof dashboardRangeSchema>;

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = "30d";

/** Projection variant embedded in role-varying cache keys. */
export type DashboardVariant = "sales" | "operations" | "units";

/**
 * Canonicalizes a raw search-param bag into a dashboard range.
 *
 * Anything missing, hostile, or duplicated degrades to the default so
 * shared caches see a tiny, stable key domain.
 */
export function parseDashboardRange(
  raw: Record<string, string | string[] | undefined>,
): DashboardRange {
  const value = raw.range;
  const candidate = Array.isArray(value) ? value[0] : value;

  const parsed = dashboardRangeSchema.safeParse(candidate);

  return parsed.success ? parsed.data : DEFAULT_DASHBOARD_RANGE;
}

/** Canonical `/dashboard` href; the default range omits the parameter. */
export function dashboardRangeHref(range: DashboardRange): string {
  return range === DEFAULT_DASHBOARD_RANGE
    ? "/dashboard"
    : `/dashboard?range=${range}`;
}

export interface RevenuePoint {
  /** ISO bucket start (day or month). */
  bucket: string;
  label: string;
  revenueCents: number;
}

export interface RevenueSeries {
  range: DashboardRange;
  granularity: "daily" | "monthly";
  points: RevenuePoint[];
}

export interface TopProductRow {
  productId: string;
  productName: string;
  sku: string;
  netUnits: number;
  /** Present only in the `sales` projection; `units` sees no money. */
  revenueCents: number | null;
}

export interface LowStockRow {
  productId: string;
  productName: string;
  sku: string;
  stockOnHand: number;
  reorderLevel: number;
}

export interface RecentOrderRow {
  orderId: string;
  orderNumber: string;
  status: string;
  customerName: string;
  createdAt: string;
  /** Present only in the `sales` projection; operations sees no money. */
  totalCents: number | null;
}
