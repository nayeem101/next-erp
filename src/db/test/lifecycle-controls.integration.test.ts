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

interface OrderFixture {
  userId: string;
  orderId: string;
}

async function createDraftOrderFixture(withLine = true): Promise<OrderFixture> {
  const userRows = (await sql`
    insert into auth.users (id, email)
    values (gen_random_uuid(), ${`lifecycle-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const userId = userRows[0]?.id;

  if (!userId) {
    throw new Error("auth identity insert returned no id");
  }

  const customerRows = (await sql`
    insert into customers (name, email, address_line_1, city, postal_code, country_code, created_by, updated_by)
    values (
      ${`Lifecycle Customer ${crypto.randomUUID().slice(0, 6)}`},
      ${`lifecycle-cust-${crypto.randomUUID().slice(0, 10)}@example.com`},
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

  if (withLine) {
    const categoryRows = (await sql`
      insert into categories (name, slug, created_by, updated_by)
      values (${`LC Cat ${crypto.randomUUID().slice(0, 8)}`}, ${`lcat-${crypto.randomUUID().slice(0, 12)}`}, ${userId}::uuid, ${userId}::uuid)
      returning id
    `) as { id: string }[];

    const categoryId = categoryRows[0]?.id;

    if (!categoryId) {
      throw new Error("category insert returned no id");
    }

    const productRows = (await sql`
      insert into products (category_id, sku, name, unit_price_cents, stock_on_hand, created_by, updated_by)
      values (${categoryId}::uuid, ${`LC-${crypto.randomUUID().slice(0, 10)}`}, 'Lifecycle Product', 300, 10, ${userId}::uuid, ${userId}::uuid)
      returning id, sku, name
    `) as { id: string; sku: string; name: string }[];

    const product = productRows[0];

    if (!product) {
      throw new Error("product insert returned no row");
    }

    await sql`
      insert into order_line_items (order_id, product_id, product_sku, product_name, quantity, unit_price_cents, line_total_cents)
      values (${orderId}::uuid, ${product.id}::uuid, ${product.sku}, ${product.name}, 2, 300, 600)
    `;
  }

  return { userId, orderId };
}

async function confirmOrder(fixture: OrderFixture): Promise<void> {
  await sql`
    update orders
    set status = 'confirmed', confirmed_by = ${fixture.userId}::uuid,
        confirmed_at = now(), total_cents = 600
    where id = ${fixture.orderId}::uuid
  `;
}

d("order lifecycle controls", () => {
  test("refreshes updated_at automatically on mutation", async () => {
    const fixture = await createDraftOrderFixture(false);

    const before = (await sql`
      select created_at, updated_at from orders where id = ${fixture.orderId}::uuid
    `) as { created_at: Date; updated_at: Date }[];

    await new Promise((resolve) => setTimeout(resolve, 30));

    await sql`
      update orders set notes = 'touched' where id = ${fixture.orderId}::uuid
    `;

    const after = (await sql`
      select notes, updated_at from orders where id = ${fixture.orderId}::uuid
    `) as { notes: string | null; updated_at: Date }[];

    const beforeRow = before[0];
    const afterRow = after[0];

    if (!beforeRow || !afterRow) {
      throw new Error("order row missing");
    }

    expect(afterRow.notes).toBe("touched");
    expect(afterRow.updated_at.getTime()).toBeGreaterThan(
      beforeRow.updated_at.getTime(),
    );
  });

  test("permits the legal confirmation and fulfillment path", async () => {
    const fixture = await createDraftOrderFixture();

    await confirmOrder(fixture);

    await sql`
      update orders
      set status = 'fulfilled', fulfilled_by = ${fixture.userId}::uuid, fulfilled_at = now()
      where id = ${fixture.orderId}::uuid
    `;

    const rows = (await sql`
      select status from orders where id = ${fixture.orderId}::uuid
    `) as { status: string }[];

    expect(rows[0]?.status).toBe("fulfilled");
  });

  test("rejects skipping or reversing lifecycle states", async () => {
    const skip = await createDraftOrderFixture();

    await expect(sql`
      update orders
      set status = 'fulfilled', fulfilled_by = ${skip.userId}::uuid, fulfilled_at = now()
      where id = ${skip.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    const confirmed = await createDraftOrderFixture();
    await confirmOrder(confirmed);

    await expect(sql`
      update orders set status = 'draft' where id = ${confirmed.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    const cancelled = await createDraftOrderFixture();

    await sql`
      update orders
      set status = 'cancelled', cancelled_by = ${cancelled.userId}::uuid,
          cancelled_at = now(), cancellation_reason = 'test'
      where id = ${cancelled.orderId}::uuid
    `;

    // Cancelled is terminal: even a legal same-status transition cannot
    // change the status field itself.
    await expect(sql`
      update orders set status = 'confirmed' where id = ${cancelled.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });
  });

  test("requires actors, timestamps, and reasons for terminal transitions", async () => {
    const noActor = await createDraftOrderFixture();

    await expect(sql`
      update orders
      set status = 'confirmed', confirmed_at = now()
      where id = ${noActor.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    const noReason = await createDraftOrderFixture();

    await expect(sql`
      update orders
      set status = 'cancelled', cancelled_by = ${noReason.userId}::uuid,
          cancelled_at = now(), cancellation_reason = '   '
      where id = ${noReason.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });
  });

  test("freezes customer, currency, and totals once an order leaves draft", async () => {
    const fixture = await createDraftOrderFixture();
    await confirmOrder(fixture);

    await expect(sql`
      update orders set total_cents = 99999 where id = ${fixture.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    await expect(sql`
      update orders set currency_code = 'EUR' where id = ${fixture.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    // Non-snapshot fields remain writable after confirmation.
    await sql`
      update orders set notes = 'still allowed' where id = ${fixture.orderId}::uuid
    `;
  });

  test("locks order lines against any change once the order leaves draft", async () => {
    const fixture = await createDraftOrderFixture();
    await confirmOrder(fixture);

    const lineRows = (await sql`
      select id from order_line_items where order_id = ${fixture.orderId}::uuid limit 1
    `) as { id: string }[];

    const lineId = lineRows[0]?.id;

    if (!lineId) {
      throw new Error("line item missing");
    }

    await expect(sql`
      update order_line_items set quantity = 5 where id = ${lineId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    await expect(sql`
      delete from order_line_items where id = ${lineId}::uuid
    `).rejects.toMatchObject({ code: "23514" });

    await expect(sql`
      insert into order_line_items (order_id, product_id, product_sku, product_name, quantity, unit_price_cents, line_total_cents)
      select o.id, p.id, p.sku, p.name, 1, 300, 300
      from orders o
      join products p on p.id = (select product_id from order_line_items where id = ${lineId}::uuid)
      where o.id = ${fixture.orderId}::uuid
    `).rejects.toMatchObject({ code: "23514" });
  });

  test("rejects updates and deletes on append-only tables", async () => {
    const fixture = await createDraftOrderFixture(false);

    const categoryRows = (await sql`
      insert into categories (name, slug, created_by, updated_by)
      values (${`AO Cat ${crypto.randomUUID().slice(0, 8)}`}, ${`ao-${crypto.randomUUID().slice(0, 12)}`}, ${fixture.userId}::uuid, ${fixture.userId}::uuid)
      returning id
    `) as { id: string }[];

    const categoryId = categoryRows[0]?.id;

    if (!categoryId) {
      throw new Error("category missing");
    }

    const productRows = (await sql`
      insert into products (category_id, sku, name, unit_price_cents, stock_on_hand, created_by, updated_by)
      values (${categoryId}::uuid, ${`AO-${crypto.randomUUID().slice(0, 10)}`}, 'Append Only Product', 100, 5, ${fixture.userId}::uuid, ${fixture.userId}::uuid)
      returning id
    `) as { id: string }[];

    const productId = productRows[0]?.id;

    if (!productId) {
      throw new Error("product missing");
    }

    const movementRows = (await sql`
      insert into stock_movements (product_id, type, quantity_delta, resulting_stock, reason, created_by)
      values (${productId}::uuid, 'opening', 5, 10, 'Opening balance', ${fixture.userId}::uuid)
      returning id
    `) as { id: string }[];

    const movementId = movementRows[0]?.id;

    if (!movementId) {
      throw new Error("movement missing");
    }

    await expect(sql`
      update stock_movements set reason = 'tampered' where id = ${movementId}::uuid
    `).rejects.toMatchObject({ code: "55006" });

    await expect(sql`
      delete from stock_movements where id = ${movementId}::uuid
    `).rejects.toMatchObject({ code: "55006" });
  });
});
