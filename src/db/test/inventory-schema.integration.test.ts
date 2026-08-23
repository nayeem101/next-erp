import postgres from "postgres";
import { beforeAll, describe, expect, test } from "vitest";

import {
  getIntegrationDatabaseUrl,
  prepareIntegrationDatabase,
} from "@/db/test/setup-db";

const d =
  (process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL)
    ? describe
    : describe.skip;

let sql: postgres.Sql;

beforeAll(async () => {
  await prepareIntegrationDatabase();
  sql = postgres(getIntegrationDatabaseUrl(), { max: 1 });

  return async () => {
    await sql.end();
  };
});

async function createTestUser(): Promise<string> {
  const rows = (await sql`
    insert into auth.users (id, email)
    values (gen_random_uuid(), ${`catalog-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("auth identity insert returned no id");
  }

  return id;
}

async function createCategory(userId: string, name?: string): Promise<string> {
  const categoryName = name ?? `Category ${crypto.randomUUID().slice(0, 8)}`;
  const slug = `cat-${crypto.randomUUID().slice(0, 12)}`;

  const rows = (await sql`
    insert into categories (name, slug, created_by, updated_by)
    values (${categoryName}, ${slug}, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("category insert returned no id");
  }

  return id;
}

interface ProductOverrides {
  sku?: string;
  unitPriceCents?: number;
  stockOnHand?: number;
  reorderLevel?: number;
  categoryId?: string;
}

async function createProduct(
  userId: string,
  overrides: ProductOverrides = {},
): Promise<string> {
  const categoryId = overrides.categoryId ?? (await createCategory(userId));
  const sku = overrides.sku ?? `SKU-${crypto.randomUUID().slice(0, 10)}`;
  const price = overrides.unitPriceCents ?? 1999;
  const stock = overrides.stockOnHand ?? 0;
  const reorder = overrides.reorderLevel ?? 0;

  const rows = (await sql`
    insert into products (category_id, sku, name, unit_price_cents, stock_on_hand, reorder_level, created_by, updated_by)
    values (${categoryId}::uuid, ${sku}, ${`Product ${sku}`}, ${price}, ${stock}, ${reorder}, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("product insert returned no id");
  }

  return id;
}

d("categories/products schema", () => {
  test("uniquely identifies categories by case-normalized name", async () => {
    const userId = await createTestUser();
    const base = crypto.randomUUID().slice(0, 8);

    await createCategory(userId, `Beverages ${base}`);

    await expect(
      createCategory(userId, `beverages ${base}`),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("enforces slug uniqueness", async () => {
    const userId = await createTestUser();
    const slug = `dup-${crypto.randomUUID().slice(0, 12)}`;
    const firstName = `First ${crypto.randomUUID().slice(0, 6)}`;

    await sql`
      insert into categories (name, slug, created_by, updated_by)
      values (${firstName}, ${slug}, ${userId}::uuid, ${userId}::uuid)
    `;

    await expect(
      sql`
        insert into categories (name, slug, created_by, updated_by)
        values (${`Other ${crypto.randomUUID().slice(0, 6)}`}, ${slug}, ${userId}::uuid, ${userId}::uuid)
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("uniquely identifies products by case-normalized SKU", async () => {
    const userId = await createTestUser();
    const baseSku = crypto.randomUUID().slice(0, 10);

    await createProduct(userId, { sku: baseSku.toUpperCase() });

    await expect(
      createProduct(userId, { sku: baseSku.toLowerCase() }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("rejects non-positive prices and negative stock levels", async () => {
    const userId = await createTestUser();

    await expect(
      createProduct(userId, { unitPriceCents: 0 }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      createProduct(userId, { stockOnHand: -1 }),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      createProduct(userId, { reorderLevel: -5 }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("restricts deletion of categories referenced by products", async () => {
    const userId = await createTestUser();
    const categoryId = await createCategory(userId);

    await createProduct(userId, { categoryId });

    await expect(
      sql`delete from categories where id = ${categoryId}::uuid`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  test("defaults stock, reorder level, and active state", async () => {
    const userId = await createTestUser();
    const productId = await createProduct(userId);

    const rows = (await sql`
      select stock_on_hand, reorder_level, is_active
      from products
      where id = ${productId}::uuid
    `) as {
      stock_on_hand: number;
      reorder_level: number;
      is_active: boolean;
    }[];

    expect(rows[0]).toMatchObject({
      stock_on_hand: 0,
      reorder_level: 0,
      is_active: true,
    });
  });

  test("maintains the partial low-stock index on active products", async () => {
    const rows = (await sql`
      select indexdef
      from pg_indexes
      where indexname = 'products_low_stock_idx'
        and schemaname = 'public'
    `) as { indexdef: string }[];

    const definition = rows[0]?.indexdef ?? "";

    expect(definition).toContain("(stock_on_hand, reorder_level)");
    expect(definition).toContain("WHERE (is_active = true)");
  });
});
