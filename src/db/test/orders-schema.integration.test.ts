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
    values (gen_random_uuid(), ${`order-owner-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("auth identity insert returned no id");
  }

  return id;
}

async function createCustomer(userId: string): Promise<string> {
  const rows = (await sql`
    insert into customers (name, email, address_line_1, city, postal_code, country_code, created_by, updated_by)
    values (
      ${`Order Customer ${crypto.randomUUID().slice(0, 6)}`},
      ${`order-cust-${crypto.randomUUID().slice(0, 10)}@example.com`},
      '1 Main Street', 'Springfield', '12345', 'US',
      ${userId}::uuid, ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("customer insert returned no id");
  }

  return id;
}

async function createProduct(userId: string): Promise<string> {
  const categoryRows = (await sql`
    insert into categories (name, slug, created_by, updated_by)
    values (${`Cat ${crypto.randomUUID().slice(0, 8)}`}, ${`cat-${crypto.randomUUID().slice(0, 12)}`}, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = categoryRows[0]?.id;

  if (!categoryId) {
    throw new Error("category insert returned no id");
  }

  const productRows = (await sql`
    insert into products (category_id, sku, name, unit_price_cents, stock_on_hand, created_by, updated_by)
    values (${categoryId}::uuid, ${`SKU-${crypto.randomUUID().slice(0, 10)}`}, 'Order Test Product', 500, 100, ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const productId = productRows[0]?.id;

  if (!productId) {
    throw new Error("product insert returned no id");
  }

  return productId;
}

async function createOrder(
  userId: string,
  customerId: string,
): Promise<string> {
  const rows = (await sql`
    insert into orders (customer_id, created_by, updated_by)
    values (${customerId}::uuid, ${userId}::uuid, ${userId}::uuid)
    returning id, order_number as "orderNumber"
  `) as { id: string; orderNumber: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("order insert returned no id");
  }

  void rows[0]?.orderNumber;

  return id;
}

async function addLineItem(input: {
  orderId: string;
  productId: string;
  quantity?: number;
  unitPriceCents?: number;
  lineTotalCents?: number;
}): Promise<void> {
  const quantity = input.quantity ?? 2;
  const unitPriceCents = input.unitPriceCents ?? 500;
  const lineTotalCents = input.lineTotalCents ?? quantity * unitPriceCents;

  await sql`
    insert into order_line_items (
      order_id, product_id, product_sku, product_name,
      quantity, unit_price_cents, line_total_cents
    )
    select ${input.orderId}::uuid, p.id, p.sku, p.name, ${quantity}, ${unitPriceCents}, ${lineTotalCents}
    from products p
    where p.id = ${input.productId}::uuid
  `;
}

d("orders/order_line_items schema", () => {
  test("assigns sequential human-readable order numbers", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);

    const first = (await sql`
      insert into orders (customer_id, created_by, updated_by)
      values (${customerId}::uuid, ${userId}::uuid, ${userId}::uuid)
      returning order_number
    `) as { order_number: string }[];

    const second = (await sql`
      insert into orders (customer_id, created_by, updated_by)
      values (${customerId}::uuid, ${userId}::uuid, ${userId}::uuid)
      returning order_number
    `) as { order_number: string }[];

    expect(first[0]?.order_number).toMatch(/^SO-\d{6}$/);
    expect(second[0]?.order_number).toMatch(/^SO-\d{6}$/);

    const firstValue = Number(first[0]?.order_number.slice(3));
    const secondValue = Number(second[0]?.order_number.slice(3));

    expect(secondValue).toBeGreaterThan(firstValue);
  });

  test("defaults drafts to version one and USD totals of zero", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);
    const orderId = await createOrder(userId, customerId);

    const rows = (await sql`
      select status, version, currency_code, total_cents
      from orders
      where id = ${orderId}::uuid
    `) as {
      status: string;
      version: number;
      currency_code: string;
      total_cents: string;
    }[];

    expect(rows[0]).toMatchObject({
      status: "draft",
      version: 1,
      currency_code: "USD",
      total_cents: "0",
    });
  });

  test("rejects non-positive versions, negative totals, and foreign currencies", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);

    await expect(sql`
      insert into orders (customer_id, version, created_by, updated_by)
      values (${customerId}::uuid, 0, ${userId}::uuid, ${userId}::uuid)
    `).rejects.toMatchObject({ code: "23514" });

    await expect(sql`
      insert into orders (customer_id, total_cents, created_by, updated_by)
      values (${customerId}::uuid, -1, ${userId}::uuid, ${userId}::uuid)
    `).rejects.toMatchObject({ code: "23514" });

    await expect(sql`
      insert into orders (customer_id, currency_code, created_by, updated_by)
      values (${customerId}::uuid, 'EUR', ${userId}::uuid, ${userId}::uuid)
    `).rejects.toMatchObject({ code: "23514" });
  });

  test("allows each product only once per order", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);
    const orderId = await createOrder(userId, customerId);
    const productId = await createProduct(userId);

    await addLineItem({ orderId, productId });

    await expect(addLineItem({ orderId, productId })).rejects.toMatchObject({
      code: "23505",
    });
  });

  test("enforces positive quantities and exact line totals", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);
    const orderId = await createOrder(userId, customerId);
    const productId = await createProduct(userId);

    await expect(
      addLineItem({ orderId, productId, quantity: 0 }),
    ).rejects.toMatchObject({ code: "23514" });

    await expect(
      addLineItem({
        orderId,
        productId,
        quantity: 3,
        unitPriceCents: 500,
        lineTotalCents: 999,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("cascades line items when a draft order is removed but restricts referenced products", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);
    const orderId = await createOrder(userId, customerId);
    const productId = await createProduct(userId);

    await addLineItem({ orderId, productId });

    await expect(
      sql`delete from products where id = ${productId}::uuid`,
    ).rejects.toMatchObject({ code: "23503" });

    const deleted = (await sql`
      delete from orders where id = ${orderId}::uuid returning id
    `) as { id: string }[];

    expect(deleted[0]?.id).toBe(orderId);

    const remainingLines = (await sql`
      select count(*) as line_count
      from order_line_items
      where order_id = ${orderId}::uuid
    `) as { line_count: number | string }[];

    expect(Number(remainingLines[0]?.line_count)).toBe(0);
  });
});
