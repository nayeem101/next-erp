/** @vitest-environment node */
import { randomUUID } from "node:crypto";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  destroyTestDatabase,
  initializeTestDatabase,
} from "@/test/factories/db";
import { assignRole, createAuthUser } from "@/test/factories/factories";

import type postgres from "postgres";

// "use cache" is inert under vitest; neutralize the scope functions.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  DATABASE_URL:
    process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  SUPABASE_SECRET_KEY: "sb_secret_test_key",
  COMPANY_NAME: "NextERP Demo Company",
  COMPANY_EMAIL: "billing@example.com",
  COMPANY_ADDRESS_LINE_1: "100 Market Street",
  COMPANY_ADDRESS_LINE_2: "Suite 4",
  COMPANY_CITY: "San Francisco",
  COMPANY_REGION: "CA",
  COMPANY_POSTAL_CODE: "94105",
  COMPANY_COUNTRY_CODE: "US",
} as const;

const d = serverEnv.DATABASE_URL ? describe : describe.skip;

let sql: postgres.Sql;

beforeAll(async () => {
  sql = await initializeTestDatabase();
});

afterAll(async () => {
  await destroyTestDatabase();
});

function token(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

let actorId: string;
let customerId: string;

beforeEach(async () => {
  await sql`
    truncate table public.audit_log, public.order_line_items, public.orders,
      public.stock_movements, public.invoices, public.ledger_entries,
      public.customers, public.products, public.categories cascade
  `;

  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }

  const admin = await createAuthUser();
  await assignRole(admin.id, "admin");
  actorId = admin.id;

  const rows = (await sql`
    insert into public.customers (
      name, email, address_line_1, city, postal_code, country_code,
      is_active, created_by, updated_by
    ) values (
      ${"Buyer " + token()}, ${"b." + token() + "@example.com"},
      '1 Main St', 'Springfield', '62704', 'US',
      true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  customerId = rows[0]?.id ?? "";
});

afterEach(async () => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }

  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
});

async function seedProduct(
  stockOnHand: number,
  reorderLevel = 0,
): Promise<{ id: string; name: string; sku: string }> {
  const categoryRows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as unknown as { id: string }[];

  const categoryId = categoryRows[0]?.id ?? "";
  const sku = `SKU-${token()}`;
  const name = `Product ${token()}`;

  const rows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${name}, 1000::bigint,
      ${stockOnHand}, ${reorderLevel}, true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  return { id: rows[0]?.id ?? "", name, sku };
}

interface SeededOrder {
  orderId: string;
}

async function seedConfirmedOrder(
  product: { id: string },
  quantity: number,
): Promise<SeededOrder> {
  const orderRows = (await sql`
    insert into public.orders (
      customer_id, status, version, total_cents, created_by, updated_by
    ) values (
      ${customerId}::uuid, 'draft', 1,
      ${(quantity * 1000).toString()}::bigint,
      ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  const orderId = orderRows[0]?.id ?? "";

  await sql`
    insert into public.order_line_items (
      order_id, product_id, product_sku, product_name,
      quantity, unit_price_cents, line_total_cents
    )
    select ${orderId}::uuid, p.id, p.sku, p.name,
           ${quantity}, p.unit_price_cents, p.unit_price_cents * ${quantity}
    from public.products p where p.id = ${product.id}::uuid
  `;

  const { confirmOrder } = await import("@/features/orders/confirm");
  await confirmOrder({ orderId, version: 1 }, actorId, randomUUID());

  return { orderId };
}

d("dashboard aggregates", () => {
  test("revenue series nets reversals and buckets by range", async () => {
    const product = await seedProduct(50);
    await seedConfirmedOrder(product, 2); // +2000
    await seedConfirmedOrder(product, 3); // +3000

    // Reverse one confirmed order via cancelOrder.
    const orders = (await sql`
      select id from public.orders order by created_at asc limit 1
    `) as unknown as { id: string }[];
    const firstOrderId = orders[0]?.id ?? "";

    const { cancelOrder } = await import("@/features/orders/lifecycle");
    await cancelOrder(
      { orderId: firstOrderId, version: 2, reason: "reversal test" },
      actorId,
      randomUUID(),
    );

    const { getRevenueOverTime } = await import("./queries");

    const daily = await getRevenueOverTime("30d");
    expect(daily.granularity).toBe("daily");
    expect(daily.points).toHaveLength(30);

    // Net = +3000 (second order) - 2000 (reversed first).
    expect(daily.points.reduce((sum, p) => sum + p.revenueCents, 0)).toBe(3000);

    const monthly = await getRevenueOverTime("12m");
    expect(monthly.granularity).toBe("monthly");
    expect(monthly.points).toHaveLength(12);
    expect(monthly.points.reduce((sum, p) => sum + p.revenueCents, 0)).toBe(
      3000,
    );
  });

  test("top products rank positive net units with role-safe projections", async () => {
    const drill = await seedProduct(40);
    const hose = await seedProduct(40);

    await seedConfirmedOrder(drill, 5);
    await seedConfirmedOrder(hose, 3);
    await seedConfirmedOrder(drill, 1);

    const { getTopProducts } = await import("./queries");

    const sales = await getTopProducts("sales", "30d");
    expect(sales[0]?.productName).toBe(drill.name);
    expect(sales[0]?.netUnits).toBe(6);
    expect(sales[0]?.revenueCents).toBe(6000);
    expect(sales).toHaveLength(2);

    // Reversal reduces net units below the sale amount.
    const hoseOrders = (await sql`
      select id from public.orders where total_cents = 3000::bigint limit 1
    `) as unknown as { id: string }[];
    const { cancelOrder } = await import("@/features/orders/lifecycle");
    await cancelOrder(
      {
        orderId: hoseOrders[0]?.id ?? "",
        version: 2,
        reason: "top products reversal",
      },
      actorId,
      randomUUID(),
    );

    const afterReversal = await getTopProducts("sales", "30d");
    expect(afterReversal.find((row) => row.sku === hose.sku)).toBeUndefined();

    const units = await getTopProducts("units", "30d");
    for (const row of units) {
      expect(row.revenueCents).toBeNull();
    }
  });

  test("low stock surfaces active products at or below reorder level", async () => {
    const healthy = await seedProduct(50, 5);
    void healthy;
    // Distinct deficits keep the worst-first assertion deterministic.
    const low = await seedProduct(4, 5);
    const critical = await seedProduct(0, 5);

    const { getLowStock } = await import("./queries");

    const rows = await getLowStock();
    expect(rows.map((row) => row.productId)).toEqual([critical.id, low.id]);
  });

  test("recent orders expose money only in the sales projection", async () => {
    const product = await seedProduct(20);
    await seedConfirmedOrder(product, 2);
    await seedConfirmedOrder(product, 1);

    const { getRecentOrders } = await import("./queries");

    const sales = await getRecentOrders("sales");
    expect(sales).toHaveLength(2);
    expect(sales.every((row) => row.totalCents !== null)).toBe(true);

    const operations = await getRecentOrders("operations");
    expect(operations).toHaveLength(2);
    expect(operations.every((row) => row.totalCents === null)).toBe(true);
    expect(operations[0]?.orderNumber).toMatch(/^SO-\d{6}$/);
  });

  test("variant derivation maps roles to safe projections", async () => {
    const { dashboardVariantForRoles } = await import("./queries");

    expect(dashboardVariantForRoles(["admin"])).toBe("sales");
    expect(dashboardVariantForRoles(["sales"])).toBe("sales");
    expect(dashboardVariantForRoles(["admin", "inventory"])).toBe("sales");
    expect(dashboardVariantForRoles(["inventory"])).toBe("operations");
    expect(dashboardVariantForRoles([])).toBe("operations");
  });
});
