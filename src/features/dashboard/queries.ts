import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { getDb } from "@/db";
import { hasAnyRole, type RoleKey } from "@/lib/auth/roles";
import { CACHE_LIFETIMES, CACHE_TAGS } from "@/lib/cache/tags";

import { DEFAULT_DASHBOARD_RANGE, dashboardRangeSchema } from "./schemas";

import type {
  DashboardRange,
  DashboardVariant,
  LowStockRow,
  RecentOrderRow,
  RevenueSeries,
  TopProductRow,
} from "./schemas";

/**
 * Streamed dashboard aggregates.
 *
 * Every exported read is a cached function whose arguments are limited to
 * serializable range/variant strings. The variant is derived server-side
 * from verified roles and baked into the cache key — browser input never
 * selects a projection. Family tags let single mutations invalidate all
 * role-safe variants at once.
 */

/**
 * Server-derived projection variant from verified roles.
 *
 * Admin/Sales see money (`sales`); Inventory alone gets the
 * money-free `operations`/`units` projections.
 */
export function dashboardVariantForRoles(
  roles: readonly RoleKey[],
): DashboardVariant {
  if (hasAnyRole(roles, ["admin", "sales"])) {
    return "sales";
  }

  return "operations";
}

/** Net Sales Revenue postings bucketed daily (30d/90d) or monthly (12m). */
export async function getRevenueOverTime(
  rawRange: DashboardRange = DEFAULT_DASHBOARD_RANGE,
): Promise<RevenueSeries> {
  "use cache";

  const range = dashboardRangeSchema.parse(rawRange);

  cacheTag(CACHE_TAGS.dashboard.revenue);
  cacheLife(CACHE_LIFETIMES.operationalLists);

  const db = getDb();
  const granularity = range === "12m" ? "monthly" : "daily";

  const rows = await db.execute(sql`
    with buckets as (
      select generate_series(
        case
          when ${range} = '12m'
            then date_trunc('month', now()) - interval '11 months'
          when ${range} = '90d'
            then date_trunc('day', now()) - interval '89 days'
          else date_trunc('day', now()) - interval '29 days'
        end,
        case
          when ${range} = '12m'
            then date_trunc('month', now())
          else date_trunc('day', now())
        end,
        case when ${range} = '12m'
          then interval '1 month'
          else interval '1 day'
        end
      ) as bucket
    )
    select
      b.bucket::text as bucket,
      coalesce(sum(
        case when le.side = 'credit' then le.amount_cents else -le.amount_cents end
      ), 0)::text as net_cents
    from buckets b
    left join ledger_entries le
      on le.account = 'sales_revenue'
      and date_trunc(
        ${granularity === "monthly" ? sql`'month'` : sql`'day'`},
        le.created_at
      ) = b.bucket
    group by b.bucket
    order by b.bucket asc
  `);

  return {
    range,
    granularity,
    points: (rows as unknown as { bucket: string; net_cents: string }[]).map(
      (row) => {
        const date = new Date(row.bucket);

        return {
          bucket: row.bucket,
          label:
            granularity === "monthly"
              ? date.toLocaleDateString("en-US", {
                  month: "short",
                  year: "2-digit",
                  timeZone: "UTC",
                })
              : date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  timeZone: "UTC",
                }),
          revenueCents: Number(row.net_cents),
        };
      },
    ),
  };
}

/**
 * Top products by positive net units sold (sales minus reversals).
 *
 * The `sales` variant adds period revenue from line-item prices; the
 * `units` projection carries no monetary fields at all.
 */
export async function getTopProducts(
  variant: Extract<DashboardVariant, "sales" | "units">,
  rawRange: DashboardRange = DEFAULT_DASHBOARD_RANGE,
): Promise<TopProductRow[]> {
  "use cache";

  dashboardRangeSchema.parse(rawRange);

  cacheTag(CACHE_TAGS.dashboard.topProducts);
  cacheLife(CACHE_LIFETIMES.operationalLists);

  const db = getDb();

  const rows = await db.execute(sql`
    select
      sm.product_id::text as product_id,
      oli.product_name as product_name,
      oli.product_sku as sku,
      (-sum(sm.quantity_delta))::int as net_units,
      ${
        variant === "sales"
          ? sql`(-sum(sm.quantity_delta * oli.unit_price_cents))::text as revenue_cents`
          : sql`null::text as revenue_cents`
      }
    from stock_movements sm
    join order_line_items oli
      on oli.order_id = sm.order_id
      and oli.product_id = sm.product_id
    where sm.type in ('sale', 'sale_reversal')
      and sm.created_at >= (
        case
          when ${rawRange} = '12m'
            then date_trunc('month', now()) - interval '11 months'
          when ${rawRange} = '90d'
            then date_trunc('day', now()) - interval '89 days'
          else date_trunc('day', now()) - interval '29 days'
        end
      )
    group by sm.product_id, oli.product_name, oli.product_sku
    having -sum(sm.quantity_delta) > 0
    order by net_units desc, oli.product_name asc
    limit 5
  `);

  return (
    rows as unknown as {
      product_id: string;
      product_name: string;
      sku: string;
      net_units: number;
      revenue_cents: string | null;
    }[]
  ).map((row) => ({
    productId: row.product_id,
    productName: row.product_name,
    sku: row.sku,
    netUnits: row.net_units,
    revenueCents: row.revenue_cents === null ? null : Number(row.revenue_cents),
  }));
}

/** Active products at or below their reorder level, worst first. */
export async function getLowStock(): Promise<LowStockRow[]> {
  "use cache";

  cacheTag(CACHE_TAGS.dashboard.lowStock);
  cacheLife(CACHE_LIFETIMES.operationalLists);

  const db = getDb();

  const rows = await db.execute(sql`
    select id::text, name, sku, stock_on_hand, reorder_level
    from products
    where is_active = true and stock_on_hand <= reorder_level
    order by (stock_on_hand - reorder_level) asc, name asc
    limit 5
  `);

  return (
    rows as unknown as {
      id: string;
      name: string;
      sku: string;
      stock_on_hand: number;
      reorder_level: number;
    }[]
  ).map((row) => ({
    productId: row.id,
    productName: row.name,
    sku: row.sku,
    stockOnHand: row.stock_on_hand,
    reorderLevel: row.reorder_level,
  }));
}

/**
 * Newest five orders. The `operations` projection omits money entirely so
 * Inventory-role cache entries never contain revenue figures.
 */
export async function getRecentOrders(
  variant: Extract<DashboardVariant, "sales" | "operations">,
): Promise<RecentOrderRow[]> {
  "use cache";

  cacheTag(CACHE_TAGS.dashboard.recentOrders);
  cacheLife(CACHE_LIFETIMES.volatile);

  const db = getDb();

  const rows = await db.execute(sql`
    select
      o.id::text,
      o.order_number,
      o.status::text,
      c.name as customer_name,
      o.created_at::text,
      ${
        variant === "sales" ? sql`o.total_cents::text` : sql`null::text`
      } as total_cents
    from orders o
    join customers c on c.id = o.customer_id
    order by o.created_at desc
    limit 5
  `);

  return (
    rows as unknown as {
      id: string;
      order_number: string;
      status: string;
      customer_name: string;
      created_at: string;
      total_cents: string | null;
    }[]
  ).map((row) => ({
    orderId: row.id,
    orderNumber: row.order_number,
    status: row.status,
    customerName: row.customer_name,
    createdAt: new Date(row.created_at).toISOString(),
    totalCents: row.total_cents === null ? null : Number(row.total_cents),
  }));
}
