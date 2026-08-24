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

function token(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function seedActor(
  roles: ("admin" | "sales" | "inventory")[],
): Promise<{ id: string }> {
  const user = await createAuthUser();

  for (const role of roles) {
    await assignRole(user.id, role);
  }

  return { id: user.id };
}

async function loadActions(callerId: string) {
  vi.resetModules();

  const actions = await import("./actions");

  mocks.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  });

  return actions;
}

d("inventory module RBAC", () => {
  let categoryId: string;
  let productId: string;

  beforeEach(async () => {
    const admin = await seedActor(["admin"]);

    const categoryRows = (await sql`
      insert into public.categories (name, slug, is_active, created_by, updated_by)
      values (${"Cat " + token()}, ${"cat-" + token()}, true, ${admin.id}::uuid, ${admin.id}::uuid)
      returning id
    `) as { id: string }[];

    categoryId = categoryRows[0]?.id ?? "";

    const productRows = (await sql`
      insert into public.products (
        category_id, sku, name, unit_price_cents,
        stock_on_hand, reorder_level, is_active, created_by, updated_by
      )
      values (
        ${categoryId}::uuid, ${"SKU-" + token()}, ${"Widget " + token()},
        1500::bigint, 10, 5, true, ${admin.id}::uuid, ${admin.id}::uuid
      )
      returning id
    `) as { id: string }[];

    productId = productRows[0]?.id ?? "";
  });

  test("sales cannot read the product catalog", async () => {
    const seller = await seedActor(["sales"]);
    const { listProductsAction } = await loadActions(seller.id);

    const result = await listProductsAction({});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  test("sales cannot create products", async () => {
    const seller = await seedActor(["sales"]);
    const { createProductAction } = await loadActions(seller.id);

    const before = (await sql`
      select count(*)::int as count from public.products
    `) as { count: number }[];

    const result = await createProductAction({
      categoryId,
      sku: `NEW-${token()}`,
      name: "Forbidden Product",
      unitPrice: "9.99",
      reorderLevel: 1,
      openingStock: 0,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const after = (await sql`
      select count(*)::int as count from public.products
    `) as { count: number }[];

    expect(after[0]?.count).toBe(before[0]?.count);
  });

  test("sales cannot update products", async () => {
    const seller = await seedActor(["sales"]);
    const { updateProductAction } = await loadActions(seller.id);

    const result = await updateProductAction({
      productId,
      categoryId,
      sku: "TAMPERED-SKU",
      name: "Tampered Name",
      unitPrice: "1.00",
      reorderLevel: 0,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const rows = (await sql`
      select name from public.products where id = ${productId}::uuid
    `) as { name: string }[];

    expect(rows[0]?.name).not.toBe("Tampered Name");
  });

  test("sales cannot archive or restore products", async () => {
    const seller = await seedActor(["sales"]);
    const { setProductActiveAction } = await loadActions(seller.id);

    const result = await setProductActiveAction({
      productId,
      isActive: false,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const rows = (await sql`
      select is_active as "isActive" from public.products where id = ${productId}::uuid
    `) as { isActive: boolean }[];

    expect(rows[0]?.isActive).toBe(true);
  });

  test("sales cannot adjust stock and no movement lands", async () => {
    const seller = await seedActor(["sales"]);
    const { adjustStockAction } = await loadActions(seller.id);

    const result = await adjustStockAction({
      productId,
      quantityDelta: -3,
      reason: "Unauthorized shrinkage",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const balances = (await sql`
      select stock_on_hand as stock from public.products where id = ${productId}::uuid
    `) as { stock: number }[];

    expect(balances[0]?.stock).toBe(10);

    const movements = (await sql`
      select id from public.stock_movements where product_id = ${productId}::uuid
    `) as { id: string }[];

    expect(movements).toHaveLength(0);
  });

  test("inventory retains full access while unauthenticated calls fail closed", async () => {
    const stocker = await seedActor(["inventory"]);
    const { listProductsAction } = await loadActions(stocker.id);

    const allowed = await listProductsAction({});

    expect(allowed.ok).toBe(true);

    // Missing session must fail closed rather than leak catalog data.
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const denied = await listProductsAction({});

    expect(denied.ok).toBe(false);

    if (!denied.ok) {
      expect(["UNAUTHENTICATED", "UNAUTHORIZED", "FORBIDDEN"]).toContain(
        denied.error.code,
      );
    }
  });
});
