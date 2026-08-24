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

async function seedCategory(actorId: string, isActive = true): Promise<string> {
  const rows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (
      ${"Cat " + token()},
      ${"cat-" + token()},
      ${isActive},
      ${actorId}::uuid,
      ${actorId}::uuid
    )
    returning id
  `) as { id: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("category seed failed");
  }

  return row.id;
}

async function loadActions(callerId: string) {
  vi.resetModules();

  const { createProductAction, adjustStockAction } = await import("./actions");

  mocks.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  });

  return { createProductAction, adjustStockAction };
}

function validInput(categoryId: string) {
  return {
    categoryId,
    sku: ` sku-${token()} `,
    name: "Cordless Drill",
    unitPrice: "89.99",
    reorderLevel: 10,
    openingStock: 25,
  };
}

d("createProductAction", () => {
  test("creates an active product with normalized SKU, price cents, and opening movement", async () => {
    const admin = await seedActor(["admin"]);
    const categoryId = await seedCategory(admin.id);
    const { createProductAction } = await loadActions(admin.id);

    const input = validInput(categoryId);

    const result = await createProductAction(input);

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    const rows = (await sql`
      select sku, name, unit_price_cents as "unitPriceCents", stock_on_hand as "stockOnHand",
             reorder_level as "reorderLevel", is_active as "isActive",
             created_by as "createdBy"
      from public.products where id = ${result.data.productId}::uuid
    `) as {
      sku: string;
      name: string;
      unitPriceCents: string;
      stockOnHand: number;
      reorderLevel: number;
      isActive: boolean;
      createdBy: string;
    }[];

    const row = rows[0];

    expect(row?.sku).toBe(input.sku.trim().toUpperCase());
    expect(row?.name).toBe("Cordless Drill");
    expect(BigInt(row?.unitPriceCents ?? "0")).toBe(8999n);
    expect(row?.stockOnHand).toBe(25);
    expect(row?.reorderLevel).toBe(10);
    expect(row?.isActive).toBe(true);
    expect(row?.createdBy).toBe(admin.id);

    const movements = (await sql`
      select type, quantity_delta as delta, resulting_stock as resulting, reason
      from public.stock_movements where product_id = ${result.data.productId}::uuid
    `) as {
      type: string;
      delta: number;
      resulting: number;
      reason: string;
    }[];

    expect(movements).toHaveLength(1);
    expect(movements[0]?.type).toBe("opening");
    expect(movements[0]?.delta).toBe(25);
    expect(movements[0]?.resulting).toBe(25);
    expect(movements[0]?.reason).toBe("Opening balance");

    const events = (await sql`
      select action from public.audit_log
      where entity_type = 'product' and entity_id = ${result.data.productId}::uuid
    `) as { action: string }[];

    expect(events.map((event) => event.action)).toEqual(["product.created"]);
  });

  test("zero openingStock creates no movement row", async () => {
    const admin = await seedActor(["inventory"]);
    const categoryId = await seedCategory(admin.id);
    const { createProductAction } = await loadActions(admin.id);

    const result = await createProductAction({
      ...validInput(categoryId),
      openingStock: 0,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    const movements = (await sql`
      select id from public.stock_movements where product_id = ${result.data.productId}::uuid
    `) as { id: string }[];

    expect(movements).toHaveLength(0);
  });

  test("rejects case-insensitive SKU duplicates with UNIQUE_CONFLICT", async () => {
    const admin = await seedActor(["admin"]);
    const categoryId = await seedCategory(admin.id);
    const { createProductAction } = await loadActions(admin.id);

    const first = await createProductAction(validInput(categoryId));

    expect(first.ok).toBe(true);

    if (!first.ok) {
      throw new Error(first.error.code);
    }

    const firstRow = (await sql`
      select sku from public.products where id = ${first.data.productId}::uuid
    `) as { sku: string }[];

    const second = await createProductAction({
      ...validInput(categoryId),
      name: "Different name",
      sku: firstRow[0]?.sku.toLowerCase() ?? "",
    });

    expect(second.ok).toBe(false);

    if (!second.ok) {
      expect(second.error.code).toBe("UNIQUE_CONFLICT");
    }
  });

  test("unknown category yields NOT_FOUND and inactive category yields CONFLICT", async () => {
    const admin = await seedActor(["admin"]);
    const { createProductAction } = await loadActions(admin.id);

    const missing = await createProductAction({
      ...validInput("00000000-0000-4000-8000-000000000000"),
    });

    expect(missing.ok).toBe(false);

    if (!missing.ok) {
      expect(missing.error.code).toBe("NOT_FOUND");
    }

    const inactiveId = await seedCategory(admin.id, false);
    const inactive = await createProductAction(validInput(inactiveId));

    expect(inactive.ok).toBe(false);

    if (!inactive.ok) {
      expect(inactive.error.code).toBe("CONFLICT");
    }
  });

  test("sales callers are rejected without writing rows", async () => {
    const seller = await seedActor(["sales"]);
    const categoryId = await seedCategory(seller.id);
    const { createProductAction } = await loadActions(seller.id);

    const before = (await sql`
      select count(*)::int as count from public.products
    `) as { count: number }[];

    const result = await createProductAction(validInput(categoryId));

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const after = (await sql`
      select count(*)::int as count from public.products
    `) as { count: number }[];

    expect(after[0]?.count).toBe(before[0]?.count);
  });
});

d("adjustStockAction", () => {
  let productId: string;

  beforeEach(async () => {
    const admin = await seedActor(["admin"]);
    const categoryId = await seedCategory(admin.id);
    const { createProductAction } = await loadActions(admin.id);

    const result = await createProductAction({
      ...validInput(categoryId),
      sku: ` adj-${token()}`,
      openingStock: 50,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    productId = result.data.productId;
  });

  test("positive adjustment updates balance atomically with a movement row", async () => {
    const admin = await seedActor(["admin"]);
    const { adjustStockAction } = await loadActions(admin.id);

    const result = await adjustStockAction({
      productId,
      quantityDelta: 5,
      reason: "Cycle count correction",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.data.stockOnHand).toBe(55);

    const movements = (await sql`
      select type, quantity_delta as delta, resulting_stock as resulting, reason
      from public.stock_movements where product_id = ${productId}::uuid
      order by created_at
    `) as {
      type: string;
      delta: number;
      resulting: number;
      reason: string;
    }[];

    expect(movements).toHaveLength(2);
    expect(movements[1]?.type).toBe("adjustment");
    expect(movements[1]?.delta).toBe(5);
    expect(movements[1]?.resulting).toBe(55);
    expect(movements[1]?.reason).toBe("Cycle count correction");
  });

  test("negative adjustment below zero fails with INSUFFICIENT_STOCK and writes nothing", async () => {
    const admin = await seedActor(["admin"]);
    const { adjustStockAction } = await loadActions(admin.id);

    const result = await adjustStockAction({
      productId,
      quantityDelta: -51,
      reason: "Shrinkage",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("INSUFFICIENT_STOCK");
    }

    const rows = (await sql`
      select stock_on_hand as stock from public.products where id = ${productId}::uuid
    `) as { stock: number }[];

    expect(rows[0]?.stock).toBe(50);

    const movements = (await sql`
      select id from public.stock_movements
      where product_id = ${productId}::uuid and type = 'adjustment'
    `) as { id: string }[];

    expect(movements).toHaveLength(0);
  });

  test("archived products reject adjustments with CONFLICT", async () => {
    await sql`
      update public.products set is_active = false where id = ${productId}::uuid
    `;

    const admin = await seedActor(["admin"]);
    const { adjustStockAction } = await loadActions(admin.id);

    const result = await adjustStockAction({
      productId,
      quantityDelta: 1,
      reason: "Should fail",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("CONFLICT");
    }
  });
});

d("setProductActive restore rules", () => {
  test("restore requires an active category", async () => {
    const admin = await seedActor(["admin"]);
    const categoryId = await seedCategory(admin.id);
    const { createProductAction } = await loadActions(admin.id);

    const created = await createProductAction({
      ...validInput(categoryId),
      sku: ` res-${token()}`,
      openingStock: 0,
    });

    expect(created.ok).toBe(true);

    if (!created.ok) {
      throw new Error(created.error.code);
    }

    vi.resetModules();
    const { setProductActiveAction } = await import("./actions");
    mocks.getUser.mockResolvedValue({
      data: { user: { id: admin.id } },
      error: null,
    });

    // Archive first while the category is still active.
    const archive = await setProductActiveAction({
      productId: created.data.productId,
      isActive: false,
    });

    expect(archive.ok).toBe(true);

    await sql`
      update public.categories set is_active = false where id = ${categoryId}::uuid
    `;

    const restore = await setProductActiveAction({
      productId: created.data.productId,
      isActive: true,
    });

    expect(restore.ok).toBe(false);

    if (!restore.ok) {
      expect(restore.error.code).toBe("CONFLICT");
    }

    // Reactivating the category unblocks the restore.
    await sql`
      update public.categories set is_active = true where id = ${categoryId}::uuid
    `;

    const retry = await setProductActiveAction({
      productId: created.data.productId,
      isActive: true,
    });

    expect(retry.ok).toBe(true);
  });
});
