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

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mocks.getUser,
      },
    }),
  ),
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

beforeEach(async () => {
  await sql`
    truncate table public.audit_log, public.stock_movements, public.products, public.categories cascade
  `;

  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }
});

async function seedAdmin(): Promise<string> {
  const user = await createAuthUser();

  await assignRole(user.id, "admin");

  return user.id;
}

d("seedDemoInventoryCatalog", () => {
  test("creates four categories and twenty products with opening movements", async () => {
    const adminId = await seedAdmin();

    const { seedDemoInventoryCatalog } = await import("./demo-seed");

    const result = await seedDemoInventoryCatalog(adminId);

    expect(result.categoriesCreated).toBe(4);
    expect(result.productsCreated).toBe(20);
    expect(result.productIdsBySku.size).toBe(20);

    const counts = (await sql`
      select
        (select count(*)::int from public.categories) as categories,
        (select count(*)::int from public.products) as products,
        (select count(*)::int from public.stock_movements where type = 'opening') as openings
    `) as { categories: number; products: number; openings: number }[];

    // Every product carries a positive opening balance except the
    // deliberately zero-stock row.
    expect(counts[0]?.categories).toBe(4);
    expect(counts[0]?.products).toBe(20);
    expect(counts[0]?.openings).toBe(19);

    const lowStock = (await sql`
      select count(*)::int as count from public.products
      where stock_on_hand <= reorder_level
    `) as { count: number }[];

    // Varied mix must include low-stock rows for grid treatments.
    expect(lowStock[0]?.count ?? 0).toBeGreaterThan(0);

    const events = (await sql`
      select action, count(*)::int as count from public.audit_log
      group by action
      order by action
    `) as { action: string; count: number }[];

    const byAction = new Map(events.map((row) => [row.action, row.count]));

    expect(byAction.get("category.created")).toBe(4);
    expect(byAction.get("product.created")).toBe(20);
    // Openings record themselves as movement rows, not adjustment audits.
    expect(byAction.get("product.stock_adjusted") ?? 0).toBe(0);
  });

  test("a second run is a complete no-op", async () => {
    const adminId = await seedAdmin();

    const { seedDemoInventoryCatalog } = await import("./demo-seed");

    const first = await seedDemoInventoryCatalog(adminId);
    const second = await seedDemoInventoryCatalog(adminId);

    expect(second.categoriesCreated).toBe(0);
    expect(second.productsCreated).toBe(0);
    expect(second.productIdsBySku.size).toBe(20);

    // Identical identity mapping across runs.
    for (const [sku, id] of first.productIdsBySku) {
      expect(second.productIdsBySku.get(sku)).toBe(id);
    }

    const counts = (await sql`
      select
        (select count(*)::int from public.categories) as categories,
        (select count(*)::int from public.products) as products,
        (select count(*)::int from public.stock_movements) as movements,
        (select count(*)::int from public.audit_log) as audits
    `) as {
      categories: number;
      products: number;
      movements: number;
      audits: number;
    }[];

    expect(counts[0]?.categories).toBe(4);
    expect(counts[0]?.products).toBe(20);
    expect(counts[0]?.movements).toBe(19);
    expect(counts[0]?.audits).toBe(24);
  });

  test("tolerates a pre-existing subset without duplicating it", async () => {
    const adminId = await seedAdmin();
    const actorRows = (await sql`
      select display_name as name from public.users where id = ${adminId}::uuid
    `) as { name: string }[];

    void actorRows;

    const { createCategory } = await import("@/features/categories/service");
    const { createProduct } = await import("./service");

    const categoryResult = await createCategory(
      { name: "Power Tools", description: undefined },
      adminId,
      randomUUID(),
    );

    await createProduct(
      {
        categoryId: categoryResult.categoryId,
        sku: "DEMO-DRILL-18V",
        name: "Cordless Drill",
        description: undefined,
        unitPrice: "129.99",
        reorderLevel: 10,
        openingStock: 40,
      },
      adminId,
      randomUUID(),
    );

    const { seedDemoInventoryCatalog } = await import("./demo-seed");

    const result = await seedDemoInventoryCatalog(adminId);

    expect(result.categoriesCreated).toBe(3);
    expect(result.productsCreated).toBe(19);

    const counts = (await sql`
      select
        (select count(*)::int from public.categories) as categories,
        (select count(*)::int from public.products) as products
    `) as { categories: number; products: number }[];

    expect(counts[0]?.categories).toBe(4);
    expect(counts[0]?.products).toBe(20);
  });
});
