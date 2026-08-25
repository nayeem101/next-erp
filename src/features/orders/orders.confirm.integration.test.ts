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

  const user = await createAuthUser();
  await assignRole(user.id, "admin");
  actorId = user.id;

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
  `) as { id: string }[];

  customerId = rows[0]?.id ?? "";
});

afterEach(async () => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }

  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
});

async function seedProduct(stockOnHand: number, priceCents = 1000) {
  const categoryRows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = categoryRows[0]?.id ?? "";

  const sku = `SKU-${token()}`;

  const rows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${"Product " + sku},
      ${String(BigInt(priceCents))}::bigint,
      ${stockOnHand}, 0, true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("product seed failed");
  }

  return row;
}

interface SeedDraftLine {
  productId: string;
  quantity: number;
}

async function seedDraft(lines: SeedDraftLine[]) {
  const total = lines.reduce((sum, line) => sum + line.quantity * 1000, 0);

  const orderRows = (await sql`
    insert into public.orders (
      customer_id, status, version, total_cents, created_by, updated_by
    ) values (
      ${customerId}::uuid, 'draft', 1, ${String(BigInt(total))}::bigint,
      ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, order_number as number
  `) as unknown as { id: string; number: string }[];

  const order = orderRows[0];

  if (!order) {
    throw new Error("order seed failed");
  }

  for (const line of lines) {
    await sql`
      insert into public.order_line_items (
        order_id, product_id, product_sku, product_name,
        quantity, unit_price_cents, line_total_cents
      ) values (
        ${order.id}::uuid, ${line.productId}::uuid,
        ${"SKU-SNAP-" + token()}, ${"Snapshot " + token()},
        ${line.quantity}, 1000::bigint,
        ${String(BigInt(line.quantity * 1000))}::bigint
      )
    `;
  }

  return order;
}

d("confirmOrder", () => {
  test("multi-line confirmation deducts stock, issues one invoice, posts a balanced journal, and audits three events", async () => {
    const drill = await seedProduct(50, 1299);
    const hose = await seedProduct(40, 455);

    // Draft totals must match snapshot math: 2x1299 + 10x455.
    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (
        ${customerId}::uuid, 'draft', 3, 7148::bigint,
        ${actorId}::uuid, ${actorId}::uuid
      )
      returning id, order_number as number
    `) as unknown as { id: string; number: string }[];

    const order = orderRows[0];

    if (!order) {
      throw new Error("order seed failed");
    }

    for (const [productId, quantity] of [
      [drill.id, 2],
      [hose.id, 10],
    ] as const) {
      await sql`
        insert into public.order_line_items (
          order_id, product_id, product_sku, product_name,
          quantity, unit_price_cents, line_total_cents
        )
        select ${order.id}::uuid, p.id, p.sku, p.name,
               ${quantity},
               p.unit_price_cents,
               p.unit_price_cents * ${quantity}
        from public.products p where p.id = ${productId}::uuid
      `;
    }

    const { confirmOrder } = await import("./confirm");

    const result = await confirmOrder(
      { orderId: order.id, version: 3 },
      actorId,
      randomUUID(),
    );

    expect(result).toMatchObject({
      orderId: order.id,
      orderNumber: order.number,
      version: 4,
      totalCents: 7148,
    });
    expect(result.invoiceNumber).toMatch(/^INV-\d{6}$/);

    // Stock deducted per line; movements carry the order-number reason.
    const stocks = (await sql`
      select id, stock_on_hand as stock from public.products
      where id in (${drill.id}::uuid, ${hose.id}::uuid)
    `) as unknown as { id: string; stock: number }[];

    const stockByProduct = new Map(stocks.map((row) => [row.id, row.stock]));
    expect(stockByProduct.get(drill.id)).toBe(48);
    expect(stockByProduct.get(hose.id)).toBe(30);

    const movements = (await sql`
      select reason, quantity_delta as delta from public.stock_movements
      where order_id = ${order.id}::uuid order by quantity_delta asc
    `) as unknown as { reason: string; delta: number }[];
    expect(movements).toHaveLength(2);
    expect(
      movements.every((m) => m.reason === `${order.number} confirmation`),
    ).toBe(true);
    expect(movements[0]?.delta).toBe(-10);
    expect(movements[1]?.delta).toBe(-2);

    // Invoice: bill-to snapshotted from current customer data.
    const invoices = (await sql`
      select id, status, total_cents as total, bill_to_snapshot as "billTo"
      from public.invoices where order_id = ${order.id}::uuid
    `) as unknown as {
      id: string;
      status: string;
      total: string;
      billTo: Record<string, string>;
    }[];
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: "issued", total: "7148" });
    expect(invoices[0]?.billTo.name).toContain("Buyer");
    expect(result.invoiceId).toBe(invoices[0]?.id);

    // Journal: two legs, AR debit equals revenue credit equals total.
    const legs = (await sql`
      select account, side, amount_cents as amount
      from public.ledger_entries where order_id = ${order.id}::uuid
      order by account asc
    `) as unknown as {
      account: string;
      side: string;
      amount: string;
    }[];
    expect(legs).toEqual([
      { account: "accounts_receivable", side: "debit", amount: "7148" },
      { account: "sales_revenue", side: "credit", amount: "7148" },
    ]);

    // Exactly three audit events on the right entities.
    const audits = (await sql`
      select action, entity_type as entityType from public.audit_log
      where correlation_id in (
        select correlation_id from public.audit_log
        where entity_id = ${order.id}::uuid
      )
      order by created_at asc
    `) as unknown as { action: string; entityType: string }[];
    expect(audits.map((a) => a.action)).toEqual([
      "order.confirmed",
      "invoice.issued",
      "ledger.sale_posted",
    ]);
  });

  test("stale versions, non-drafts, inactive customers, and archived products fail closed", async () => {
    const { confirmOrder } = await import("./confirm");

    const product = await seedProduct(10);
    const order = await seedDraft([{ productId: product.id, quantity: 1 }]);

    await expect(
      confirmOrder({ orderId: order.id, version: 99 }, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await sql`
      update public.orders set status = 'confirmed', confirmed_by = ${actorId}::uuid, confirmed_at = now(), version = version + 1
      where id = ${order.id}::uuid
    `;

    await expect(
      confirmOrder({ orderId: order.id, version: 2 }, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Inactive customer blocks confirmation of a fresh draft.
    await sql`update public.customers set is_active = false where id = ${customerId}::uuid`;
    const second = await seedDraft([{ productId: product.id, quantity: 1 }]);

    await expect(
      confirmOrder({ orderId: second.id, version: 1 }, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Archived product blocks confirmation too.
    await sql`update public.customers set is_active = true where id = ${customerId}::uuid`;
    await sql`update public.products set is_active = false where id = ${product.id}::uuid`;
    const third = await seedDraft([{ productId: product.id, quantity: 1 }]);

    await expect(
      confirmOrder({ orderId: third.id, version: 1 }, actorId, randomUUID()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("insufficient stock rolls back every order, stock, movement, invoice, ledger, and audit effect", async () => {
    const plentiful = await seedProduct(100);
    const scarce = await seedProduct(2);

    // Sorted-ID order decides which deduction hits the wall first; both
    // must be untouched afterwards.
    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (
        ${customerId}::uuid, 'draft', 1, 30000::bigint,
        ${actorId}::uuid, ${actorId}::uuid
      )
      returning id
    `) as unknown as { id: string }[];

    const seededOrder = orderRows[0];

    if (!seededOrder) {
      throw new Error("order seed failed");
    }

    const orderId = seededOrder.id;

    for (const [productId, quantity] of [
      [plentiful.id, 10],
      [scarce.id, 5],
    ] as const) {
      await sql`
        insert into public.order_line_items (
          order_id, product_id, product_sku, product_name,
          quantity, unit_price_cents, line_total_cents
        )
        select ${orderId}::uuid, p.id, p.sku, p.name,
               ${quantity}, p.unit_price_cents, p.unit_price_cents * ${quantity}
        from public.products p where p.id = ${productId}::uuid
      `;
    }

    const { confirmOrder } = await import("./confirm");
    const { InsufficientStockError } = await import("./stock");

    await expect(
      confirmOrder({ orderId, version: 1 }, actorId, randomUUID()),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    const counts = (await sql`
      select
        (select count(*)::int from public.stock_movements) as movements,
        (select count(*)::int from public.invoices) as invoices,
        (select count(*)::int from public.ledger_entries) as ledger,
        (select count(*)::int from public.audit_log) as audits
    `) as unknown as {
      movements: number;
      invoices: number;
      ledger: number;
      audits: number;
    }[];

    expect(counts[0]).toEqual({
      movements: 0,
      invoices: 0,
      ledger: 0,
      audits: 0,
    });

    const order = (await sql`
      select status, version from public.orders where id = ${orderId}::uuid
    `) as unknown as { status: string; version: number }[];
    expect(order[0]).toMatchObject({ status: "draft", version: 1 });

    const stocks = (await sql`
      select stock_on_hand as stock from public.products
      where id in (${plentiful.id}::uuid, ${scarce.id}::uuid)
    `) as unknown as { stock: number }[];
    expect(stocks.map((row) => row.stock).sort((a, b) => a - b)).toEqual([
      2, 100,
    ]);
  });

  test("competing confirmations cannot oversell limited stock", async () => {
    const scarce = await seedProduct(5);

    async function seedCompetitor(): Promise<{ id: string }> {
      const rows = (await sql`
        insert into public.orders (
          customer_id, status, version, total_cents, created_by, updated_by
        ) values (
          ${customerId}::uuid, 'draft', 1, 5000::bigint,
          ${actorId}::uuid, ${actorId}::uuid
        )
        returning id
      `) as unknown as { id: string }[];

      const order = rows[0];

      if (!order) {
        throw new Error("order seed failed");
      }

      await sql`
        insert into public.order_line_items (
          order_id, product_id, product_sku, product_name,
          quantity, unit_price_cents, line_total_cents
        )
        select ${order.id}::uuid, p.id, p.sku, p.name,
               5, p.unit_price_cents, p.unit_price_cents * 5
        from public.products p where p.id = ${scarce.id}::uuid
      `;

      return order;
    }

    const firstOrder = await seedCompetitor();
    const secondOrder = await seedCompetitor();

    const { confirmOrder } = await import("./confirm");

    const outcomes = await Promise.allSettled([
      confirmOrder(
        { orderId: firstOrder.id, version: 1 },
        actorId,
        randomUUID(),
      ),
      confirmOrder(
        { orderId: secondOrder.id, version: 1 },
        actorId,
        randomUUID(),
      ),
    ]);

    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === "fulfilled",
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === "rejected",
    );

    // Exactly one wins; the loser sees INSUFFICIENT_STOCK.
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (rejected[0]?.status === "rejected") {
      expect(rejected[0].reason).toBeInstanceOf(Object);
      expect((rejected[0].reason as { code?: string }).code).toBe(
        "INSUFFICIENT_STOCK",
      );
    }

    // Final stock is zero — never negative.
    const stock = (await sql`
      select stock_on_hand as stock from public.products where id = ${scarce.id}::uuid
    `) as unknown as { stock: number }[];
    expect(stock[0]?.stock).toBe(0);

    // Only one invoice/journal exists across both orders.
    const counts = (await sql`
      select
        (select count(*)::int from public.invoices) as invoices,
        (select count(*)::int from public.ledger_entries) as legs
    `) as unknown as { invoices: number; legs: number }[];
    expect(counts[0]).toEqual({ invoices: 1, legs: 2 });

    // The losing order remains an untouched draft.
    const statuses = (await sql`
      select status from public.orders order by created_at asc
    `) as unknown as { status: string }[];
    expect(statuses.map((row) => row.status).sort()).toEqual([
      "confirmed",
      "draft",
    ]);
  });
});
