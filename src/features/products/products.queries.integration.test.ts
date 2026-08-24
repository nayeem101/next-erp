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
import {
  assignRole,
  createAuthUser,
  createCategory,
  createProduct,
} from "@/test/factories/factories";

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
    truncate table public.audit_log, public.products, public.categories cascade
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

function token(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

let actorId: string;

async function seedCategory(namePrefix: string) {
  return createCategory(actorId, {
    name: `${namePrefix} ${token()}`,
    slug: `cat-${token()}`,
  });
}

async function seedProduct(input: {
  categoryId: string;
  namePrefix: string;
  priceCents?: number;
  stock?: number;
  reorder?: number;
  isActive?: boolean;
}): Promise<{ id: string; sku: string; name: string }> {
  const sku = `SKU-${token()}`;
  const product = await createProduct(actorId, input.categoryId, { sku });

  await sql`
    update public.products set
      name = ${`${input.namePrefix} ${token()}`},
      unit_price_cents = ${String(BigInt(input.priceCents ?? 5000))}::bigint,
      stock_on_hand = ${input.stock ?? 50},
      reorder_level = ${input.reorder ?? 10},
      is_active = ${input.isActive ?? true}
    where id = ${product.id}::uuid
  `;

  const rows = (await sql`
    select id, sku, name from public.products where id = ${product.id}::uuid
  `) as { id: string; sku: string; name: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("product seed failed");
  }

  return row;
}

d("listProducts query", () => {
  let tools: { id: string };
  let garden: { id: string };

  let drill: { id: string; sku: string; name: string };
  let hammer: { id: string; sku: string; name: string };
  let hose: { id: string; sku: string; name: string };
  let archivedItem: { id: string; sku: string; name: string };

  beforeEach(async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    actorId = user.id;

    tools = await seedCategory("Aa Tools");
    garden = await seedCategory("Bb Garden");

    // Names carry sort prefixes; stocks exercise the low-stock projection.
    drill = await seedProduct({
      categoryId: tools.id,
      namePrefix: "Aa Drill",
      priceCents: 8999,
      stock: 40,
      reorder: 10,
    });
    hammer = await seedProduct({
      categoryId: tools.id,
      namePrefix: "Bb Hammer",
      priceCents: 1999,
      stock: 5,
      reorder: 10,
    });
    hose = await seedProduct({
      categoryId: garden.id,
      namePrefix: "Cc Hose",
      priceCents: 4500,
      stock: 0,
      reorder: 3,
    });
    archivedItem = await seedProduct({
      categoryId: garden.id,
      namePrefix: "Dd Retired",
      priceCents: 700,
      isActive: false,
    });
  });

  test("defaults to active products sorted by name with category names", async () => {
    const { listProducts } = await import("./queries");

    const page = await listProducts({});

    expect(page.total).toBe(3);
    expect(page.rows.map((row) => row.name)).toEqual([
      drill.name,
      hammer.name,
      hose.name,
    ]);
    expect(page.rows[0]?.categoryName).toMatch(/^Aa Tools /);
    expect(page.rows[0]?.unitPriceCents).toBe(8999);
  });

  test("low-stock projection returns only active items at or below reorder", async () => {
    const { listProducts } = await import("./queries");

    const page = await listProducts({ stockStatus: "low_stock" });

    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.name)).toEqual([hammer.name, hose.name]);
  });

  test("archived status isolates retired items", async () => {
    const { listProducts } = await import("./queries");

    const page = await listProducts({ stockStatus: "archived" });

    expect(page.total).toBe(1);
    expect(page.rows[0]?.name).toBe(archivedItem.name);
    expect(page.rows[0]?.isActive).toBe(false);
  });

  test("category scope filters across statuses only as requested", async () => {
    const { listProducts } = await import("./queries");

    const allInGarden = await listProducts({
      categoryId: garden.id,
      stockStatus: "all",
    });

    expect(allInGarden.total).toBe(2);

    const activeInTools = await listProducts({
      categoryId: tools.id,
      stockStatus: "active",
    });

    expect(activeInTools.total).toBe(2);
  });

  test("search matches SKU fragments case-insensitively", async () => {
    const lowerSku = hammer.sku.toLowerCase();

    const { listProducts } = await import("./queries");

    const page = await listProducts({ search: lowerSku.slice(4, 12) });

    expect(page.total).toBe(1);
    expect(page.rows[0]?.id).toBe(hammer.id);
  });

  test("sort allowlist covers price, stock, and newest orderings", async () => {
    const { listProducts } = await import("./queries");

    const byPriceDesc = await listProducts({ sort: "price_desc" });

    expect(byPriceDesc.rows.map((row) => row.unitPriceCents)).toEqual([
      8999, 4500, 1999,
    ]);

    const byStockAsc = await listProducts({ sort: "stock_asc" });

    expect(byStockAsc.rows.map((row) => row.stockOnHand)).toEqual([0, 5, 40]);

    const byNewest = await listProducts({ sort: "newest" });

    // All four rows share one insert burst; assert recency ordering holds.
    const times = byNewest.rows.map((row) => row.createdAt);

    expect([...times].sort().reverse()).toEqual(times);
  });

  test("paginates deterministically with server totals", async () => {
    const { listProducts } = await import("./queries");

    const extra = await seedProduct({
      categoryId: tools.id,
      namePrefix: "Ee Extra",
    });
    const extra2 = await seedProduct({
      categoryId: tools.id,
      namePrefix: "Ff Extra",
    });
    void extra;

    const shifted = await listProducts({
      stockStatus: "all",
      pageSize: 5,
    });

    expect(shifted.total).toBe(6);
    expect(shifted.totalPages).toBe(2);
    expect(shifted.rows).toHaveLength(5);

    const secondPage = await listProducts({
      stockStatus: "all",
      page: 2,
      pageSize: 5,
    });

    expect(secondPage.rows.map((row) => row.id)).toEqual([extra2.id]);
  });
});
