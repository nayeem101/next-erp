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

async function seedActor(): Promise<{ id: string }> {
  const user = await createAuthUser();

  await assignRole(user.id, "admin");

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

async function seedProduct(
  actorId: string,
  categoryId: string,
): Promise<{
  id: string;
}> {
  const rows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    )
    values (
      ${categoryId}::uuid,
      ${"SKU-" + token()},
      ${"Original Name"},
      5000::bigint,
      33,
      5,
      true,
      ${actorId}::uuid,
      ${actorId}::uuid
    )
    returning id
  `) as { id: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("product seed failed");
  }

  return { id: row.id };
}

d("updateProductAction", () => {
  let admin: { id: string };
  let categoryId: string;
  let productId: string;

  beforeEach(async () => {
    admin = await seedActor();
    categoryId = await seedCategory(admin.id);

    const product = await seedProduct(admin.id, categoryId);

    productId = product.id;

    vi.resetModules();

    // Prime the action modules so later dynamic imports share the mock.
    await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: admin.id } },
      error: null,
    });
  });

  test("updates master data with a diff-only audit and never touches stock", async () => {
    const { updateProductAction } = await import("./actions");

    const result = await updateProductAction({
      productId,
      categoryId,
      sku: ` RENAMED-${token()} `,
      name: "Renamed Product",
      description: "Fresh description",
      unitPrice: "61.25",
      reorderLevel: 9,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    const rows = (await sql`
      select sku, name, unit_price_cents as "cents", stock_on_hand as "stock",
             reorder_level as "reorder", description
      from public.products where id = ${productId}::uuid
    `) as {
      sku: string;
      name: string;
      cents: string;
      stock: number;
      reorder: number;
      description: string | null;
    }[];

    expect(rows[0]?.sku).toMatch(/^RENAMED-/);
    expect(rows[0]?.name).toBe("Renamed Product");
    expect(BigInt(rows[0]?.cents ?? "0")).toBe(6125n);
    expect(rows[0]?.stock).toBe(33);
    expect(rows[0]?.reorder).toBe(9);
    expect(rows[0]?.description).toBe("Fresh description");

    // No movement may appear from a pure metadata edit.
    const movements = (await sql`
      select id from public.stock_movements where product_id = ${productId}::uuid
    `) as { id: string }[];

    expect(movements).toHaveLength(0);

    const events = (await sql`
      select action, metadata from public.audit_log
      where entity_type = 'product' and entity_id = ${productId}::uuid
      order by created_at
    `) as { action: string; metadata: Record<string, unknown> }[];

    // Raw-SQL seeding writes no audit; only this edit appears.
    expect(events).toHaveLength(1);

    const updatedEvent = events[0];
    const metadata = updatedEvent?.metadata as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

    expect(updatedEvent?.action).toBe("product.updated");
    expect(Object.keys(metadata.before).sort()).toEqual([
      "description",
      "name",
      "reorderLevel",
      "sku",
      "unitPriceCents",
    ]);
    expect(metadata.before.name).toBe("Original Name");
    expect(metadata.after.name).toBe("Renamed Product");
    expect(metadata.before.unitPriceCents).toBe("5000");
    expect(metadata.after.unitPriceCents).toBe("6125");
  });

  test("rejects case-insensitive SKU collisions with UNIQUE_CONFLICT", async () => {
    const { updateProductAction } = await import("./actions");

    const siblingId = await seedCategory(admin.id);

    const siblingSkuRows = (await sql`
      insert into public.products (
        category_id, sku, name, unit_price_cents,
        stock_on_hand, reorder_level, is_active, created_by, updated_by
      )
      values (
        ${siblingId}::uuid,
        ${"COLLIDE-" + token()},
        ${"Sibling"},
        1000::bigint,
        1,
        1,
        true,
        ${admin.id}::uuid,
        ${admin.id}::uuid
      )
      returning sku
    `) as { sku: string }[];

    const conflictingSku = (siblingSkuRows[0]?.sku ?? "").toLowerCase();

    const result = await updateProductAction({
      productId,
      categoryId,
      sku: conflictingSku,
      name: "Whatever",
      unitPrice: "10.00",
      reorderLevel: 1,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("UNIQUE_CONFLICT");
    }
  });

  test("inactive or missing target category yields CONFLICT / NOT_FOUND", async () => {
    const { updateProductAction } = await import("./actions");

    const inactiveId = await seedCategory(admin.id, false);

    const inactive = await updateProductAction({
      productId,
      categoryId: inactiveId,
      sku: `OK-${token()}`,
      name: "Still Fine",
      unitPrice: "10.00",
      reorderLevel: 1,
    });

    expect(inactive.ok).toBe(false);

    if (!inactive.ok) {
      expect(inactive.error.code).toBe("CONFLICT");
    }

    const missing = await updateProductAction({
      productId,
      categoryId: "00000000-0000-4000-8000-00000000dead",
      sku: `OK-${token()}`,
      name: "Still Fine",
      unitPrice: "10.00",
      reorderLevel: 1,
    });

    expect(missing.ok).toBe(false);

    if (!missing.ok) {
      expect(missing.error.code).toBe("NOT_FOUND");
    }

    // Unknown products also 404 at the domain boundary.
    const unknownProduct = await updateProductAction({
      productId: "00000000-0000-4000-8000-00000000dead",
      categoryId,
      sku: `OK-${token()}`,
      name: "Ghost",
      unitPrice: "10.00",
      reorderLevel: 1,
    });

    if (!unknownProduct.ok) {
      expect(unknownProduct.error.code).toBe("NOT_FOUND");
    } else {
      throw new Error("expected NOT_FOUND for unknown product");
    }
  });
});
