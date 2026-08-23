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

interface MovementFixture {
  userId: string;
  productId: string;
  orderId?: string;
}

async function createMovementFixture(): Promise<MovementFixture> {
  const userRows = (await sql`
    insert into auth.users (id, email)
    values (gen_random_uuid(), ${`stock-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const userId = userRows[0]?.id;

  if (!userId) {
    throw new Error("auth identity insert returned no id");
  }

  const categoryRows = (await sql`
    insert into categories (name, slug, created_by, updated_by)
    values (${`Stock Cat ${crypto.randomUUID().slice(0, 8)}`}, ${`scat-${crypto.randomUUID().slice(0, 12)}`}, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = categoryRows[0]?.id;

  if (!categoryId) {
    throw new Error("category insert returned no id");
  }

  const productRows = (await sql`
    insert into products (category_id, sku, name, unit_price_cents, stock_on_hand, created_by, updated_by)
    values (${categoryId}::uuid, ${`STK-${crypto.randomUUID().slice(0, 10)}`}, 'Stock Test Product', 750, 50, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const productId = productRows[0]?.id;

  if (!productId) {
    throw new Error("product insert returned no id");
  }

  return { userId, productId };
}

async function createOrderFor(
  userId: string,
  productId: string,
): Promise<string> {
  const customerRows = (await sql`
    insert into customers (name, email, address_line_1, city, postal_code, country_code, created_by, updated_by)
    values (
      ${`Move Customer ${crypto.randomUUID().slice(0, 6)}`},
      ${`move-cust-${crypto.randomUUID().slice(0, 10)}@example.com`},
      '1 Main Street', 'Springfield', '12345', 'US',
      ${userId}::uuid, ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const customerId = customerRows[0]?.id;

  if (!customerId) {
    throw new Error("customer insert returned no id");
  }

  const orderRows = (await sql`
    insert into orders (customer_id, created_by, updated_by)
    values (${customerId}::uuid, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const orderId = orderRows[0]?.id;

  if (!orderId) {
    throw new Error("order insert returned no id");
  }

  await sql`
    insert into order_line_items (order_id, product_id, product_sku, product_name, quantity, unit_price_cents, line_total_cents)
    select ${orderId}::uuid, p.id, p.sku, p.name, 1, p.unit_price_cents, p.unit_price_cents
    from products p where p.id = ${productId}::uuid
  `;

  await sql`
    update orders
    set status = 'confirmed', confirmed_by = ${userId}::uuid, confirmed_at = now()
    where id = ${orderId}::uuid
  `;

  return orderId;
}

async function insertMovement(
  fixture: MovementFixture,
  type: string,
  quantityDelta: number,
  resultingStock = 50,
): Promise<void> {
  await sql`
    insert into stock_movements (product_id, order_id, type, quantity_delta, resulting_stock, reason, created_by)
    values (
      ${fixture.productId}::uuid,
      ${fixture.orderId ?? null}::uuid,
      ${type}::stock_movement_type,
      ${quantityDelta},
      ${resultingStock},
      ${`Reason ${crypto.randomUUID().slice(0, 6)}`},
      ${fixture.userId}::uuid
    )
  `;
}

d("stock_movements schema", () => {
  test("requires sale movements to reference an order", async () => {
    const fixture = await createMovementFixture();

    await expect(
      insertMovement({ ...fixture }, "sale", -5),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("forbids order references on opening and adjustment movements", async () => {
    const fixture = await createMovementFixture();
    const orderId = await createOrderFor(fixture.userId, fixture.productId);

    await expect(
      insertMovement({ ...fixture, orderId }, "adjustment", 10),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("accepts linked reversal movements and standalone adjustments", async () => {
    const fixture = await createMovementFixture();
    const orderId = await createOrderFor(fixture.userId, fixture.productId);

    await insertMovement({ ...fixture, orderId }, "sale", -3, 47);
    await insertMovement(fixture, "opening", 50, 100);
    await insertMovement(fixture, "adjustment", -2, 98);

    const rows = (await sql`
      select count(*) as movement_count
      from stock_movements
      where product_id = ${fixture.productId}::uuid
    `) as { movement_count: number | string }[];

    expect(Number(rows[0]?.movement_count)).toBe(3);
  });

  test("rejects zero deltas and negative resulting stock", async () => {
    const fixture = await createMovementFixture();

    await expect(insertMovement(fixture, "opening", 0)).rejects.toMatchObject({
      code: "23514",
    });

    await expect(
      insertMovement(fixture, "opening", 5, -1),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
