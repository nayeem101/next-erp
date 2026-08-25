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
    truncate table public.audit_log, public.order_line_items, public.orders,
      public.stock_movements, public.invoices, public.ledger_entries,
      public.customers, public.products, public.categories cascade
  `;

  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }

  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
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

beforeEach(async () => {
  const user = await createAuthUser();
  await assignRole(user.id, "admin");
  actorId = user.id;
});

let customerId: string;

beforeEach(async () => {
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

  const row = rows[0];

  if (!row) {
    throw new Error("customer seed failed");
  }

  customerId = row.id;
});

async function seedProduct(stockOnHand: number) {
  const categoryRows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = categoryRows[0]?.id;

  if (!categoryId) {
    throw new Error("category seed failed");
  }

  const sku = `SKU-${token()}`;

  const rows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${"Product " + sku},
      1000::bigint, ${stockOnHand}, 0, true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as { id: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("product seed failed");
  }

  return row;
}

const billTo = {
  name: "Acme Retail",
  email: "buyer@acme.com",
  addressLine1: "1 Main St",
  city: "Springfield",
  postalCode: "62704",
  countryCode: "US",
};

d("invoice repository", () => {
  test("issues exactly one invoice per order with snapshots and fixed amount", async () => {
    const { getDb } = await import("@/db");
    const { createIssuedInvoice } = await import("./invoices");

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'confirmed', 2, 50000::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id
    `) as { id: string }[];

    const orderId = orderRows[0]?.id;

    if (!orderId) {
      throw new Error("order seed failed");
    }

    const db = getDb();

    const ref = await db.transaction(async (tx) =>
      createIssuedInvoice(tx, {
        orderId,
        subtotalCents: 50_000n,
        billToSnapshot: billTo,
        actorUserId: actorId,
        correlationId: randomUUID(),
      }),
    );

    expect(ref.invoiceNumber).toMatch(/^INV-\d{6}$/);

    const stored = (await sql`
      select status, currency_code as currency, total_cents as total,
             subtotal_cents as subtotal, seller_snapshot as seller,
             bill_to_snapshot as "billTo"
      from public.invoices where id = ${ref.invoiceId}::uuid
    `) as {
      status: string;
      currency: string;
      total: string;
      subtotal: string;
      seller: Record<string, string>;
      billTo: Record<string, string>;
    }[];

    const invoice = stored[0];

    if (!invoice) {
      throw new Error("expected an issued invoice");
    }

    expect(invoice.status).toBe("issued");
    expect(invoice.currency).toBe("USD");
    expect(invoice.total).toBe("50000");
    // Seller identity comes from validated env configuration.
    expect(invoice.seller.name).toBe("NextERP Demo Company");
    expect(invoice.seller.addressLine2).toBe("Suite 4");
    expect(invoice.billTo.name).toBe("Acme Retail");

    // Second issuance for the same order is rejected inside the tx.
    await expect(
      db.transaction(async (tx) =>
        createIssuedInvoice(tx, {
          orderId,
          subtotalCents: 50_000n,
          billToSnapshot: billTo,
          actorUserId: actorId,
          correlationId: randomUUID(),
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const count = (await sql`
      select count(*)::int as n from public.invoices where order_id = ${orderId}::uuid
    `) as { n: number }[];
    expect(count[0]?.n).toBe(1);
  });

  test("voiding marks status once and never mutates captured amounts", async () => {
    const { getDb } = await import("@/db");
    const { createIssuedInvoice, voidIssuedInvoice } =
      await import("./invoices");

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'confirmed', 2, 7500::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id
    `) as { id: string }[];

    const orderId = orderRows[0]?.id;

    if (!orderId) {
      throw new Error("order seed failed");
    }

    const db = getDb();

    const ref = await db.transaction(async (tx) =>
      createIssuedInvoice(tx, {
        orderId,
        subtotalCents: 7_500n,
        billToSnapshot: billTo,
        actorUserId: actorId,
        correlationId: randomUUID(),
      }),
    );

    const voided = await db.transaction(async (tx) =>
      voidIssuedInvoice(tx, { orderId, actorUserId: actorId }),
    );
    expect(voided.invoiceId).toBe(ref.invoiceId);

    // Double void conflicts: only issued invoices can be voided.
    await expect(
      db.transaction(async (tx) =>
        voidIssuedInvoice(tx, { orderId, actorUserId: actorId }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const stored = (await sql`
      select status, total_cents as total, voided_at as voidedAt
      from public.invoices where id = ${ref.invoiceId}::uuid
    `) as { status: string; total: string; voidedAt: Date | null }[];

    expect(stored[0]).toMatchObject({ status: "void", total: "7500" });
    expect(stored[0]?.voidedAt).not.toBeNull();
  });
});

d("ledger journal writer", () => {
  test("posts balanced sale journals with one AR leg and one revenue leg", async () => {
    const { getDb } = await import("@/db");
    const { assertJournalsBalanced, loadJournalLegs, postSaleJournal } =
      await import("./ledger");

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'confirmed', 2, 12345::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id
    `) as { id: string }[];

    const orderId = orderRows[0]?.id;

    if (!orderId) {
      throw new Error("order seed failed");
    }

    const sellerSnapshot = {
      name: "Seller",
      email: "s@e.com",
      addressLine1: "a",
      city: "c",
      postalCode: "p",
      countryCode: "US",
    };

    const invoiceRows = (await sql`
      insert into public.invoices (
        order_id, status, seller_snapshot, bill_to_snapshot,
        subtotal_cents, total_cents, created_by
      ) values (
        ${orderId}::uuid, 'issued',
        ${sql.json(sellerSnapshot)}::jsonb,
        ${sql.json(billTo)}::jsonb,
        12345::bigint, 12345::bigint, ${actorId}::uuid
      )
      returning id
    `) as unknown as { id: string }[];

    const invoiceId = invoiceRows[0]?.id;

    if (!invoiceId) {
      throw new Error("invoice seed failed");
    }

    const db = getDb();

    const posted = await db.transaction(async (tx) =>
      postSaleJournal(tx, {
        orderId,
        invoiceId,
        amountCents: 12_345n,
        postedBy: actorId,
        description: "Sale for SO-000001",
      }),
    );

    const legs = await loadJournalLegs(db, posted.journalId);
    expect(legs).toHaveLength(2);
    expect(legs).toEqual([
      { account: "accounts_receivable", side: "debit", amountCents: 12_345n },
      { account: "sales_revenue", side: "credit", amountCents: 12_345n },
    ]);

    // All books balance after the posting.
    await expect(assertJournalsBalanced(db)).resolves.toBeUndefined();
  });

  test("reversal journals mirror sides and unbalanced data trips the invariant", async () => {
    const { getDb } = await import("@/db");
    const { assertJournalsBalanced, loadJournalLegs, postSaleReversalJournal } =
      await import("./ledger");

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'cancelled', 3, 9999::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id
    `) as { id: string }[];

    const orderId = orderRows[0]?.id;

    if (!orderId) {
      throw new Error("order seed failed");
    }

    const voidedSellerSnapshot = {
      name: "Seller",
      email: "s@e.com",
      addressLine1: "a",
      city: "c",
      postalCode: "p",
      countryCode: "US",
    };

    const invoiceRows = (await sql`
      insert into public.invoices (
        order_id, status, seller_snapshot, bill_to_snapshot,
        subtotal_cents, total_cents, created_by
      ) values (
        ${orderId}::uuid, 'void',
        ${sql.json(voidedSellerSnapshot)}::jsonb,
        ${sql.json(billTo)}::jsonb,
        9999::bigint, 9999::bigint, ${actorId}::uuid
      )
      returning id
    `) as unknown as { id: string }[];

    const invoiceId = invoiceRows[0]?.id;

    if (!invoiceId) {
      throw new Error("invoice seed failed");
    }

    const db = getDb();

    const posted = await db.transaction(async (tx) =>
      postSaleReversalJournal(tx, {
        orderId,
        invoiceId,
        amountCents: 9_999n,
        postedBy: actorId,
        description: "Reversal for SO-000002",
      }),
    );

    const legs = await loadJournalLegs(db, posted.journalId);
    expect(legs).toEqual([
      { account: "accounts_receivable", side: "credit", amountCents: 9_999n },
      { account: "sales_revenue", side: "debit", amountCents: 9_999n },
    ]);

    // Simulate corrupted books: bypass the append-only and balance
    // triggers to land a single unpaired leg, then prove the read-side
    // invariant still fires.
    await sql`alter table public.ledger_entries disable trigger user`;
    try {
      await sql`
        insert into public.ledger_entries (
          journal_id, journal_type, order_id, invoice_id,
          account, side, amount_cents, description, posted_by
        ) values (
          ${randomUUID()}::uuid, 'sale', ${orderId}::uuid, ${invoiceId}::uuid,
          'accounts_receivable', 'debit', 500::bigint, 'orphan leg', ${actorId}::uuid
        )
      `;
    } finally {
      await sql`alter table public.ledger_entries enable trigger user`;
    }

    await expect(assertJournalsBalanced(db)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
    });
  });
});

d("confirm stock mechanics", () => {
  test("deducts in stable product-ID order and writes sale movements", async () => {
    const { getDb } = await import("@/db");
    const { deductSaleStock } = await import("./stock");

    const first = await seedProduct(30);
    const second = await seedProduct(40);

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'draft', 1, 2000::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id, order_number as number
    `) as { id: string; number: string }[];

    const order = orderRows[0];

    if (!order) {
      throw new Error("order seed failed");
    }

    const db = getDb();

    const applied = await db.transaction(async (tx) =>
      deductSaleStock(tx, {
        orderId: order.id,
        lines: [
          { productId: second.id, quantity: 4 },
          { productId: first.id, quantity: 10 },
        ],
        reason: `${order.number} confirmation`,
        actorUserId: actorId,
      }),
    );

    // Deterministic lock/deduct order regardless of request order:
    // product IDs ascending.
    const expectedOrder = [first.id, second.id].sort((a, b) =>
      a.localeCompare(b),
    );
    expect(applied.map((movement) => movement.productId)).toEqual(
      expectedOrder,
    );

    const stocks = (await sql`
      select id, stock_on_hand as stock from public.products
      where id in (${first.id}::uuid, ${second.id}::uuid)
    `) as { id: string; stock: number }[];
    const byId = new Map(stocks.map((row) => [row.id, row.stock]));
    expect(byId.get(first.id)).toBe(20);
    expect(byId.get(second.id)).toBe(36);

    const movements = (await sql`
      select type, quantity_delta as delta, resulting_stock as result
      from public.stock_movements where order_id = ${order.id}::uuid
      order by quantity_delta asc
    `) as { type: string; delta: number; result: number }[];
    expect(movements).toHaveLength(2);
    expect(movements.every((movement) => movement.type === "sale")).toBe(true);
    expect(movements.every((movement) => movement.delta < 0)).toBe(true);
  });

  test("insufficient stock raises typed details and rolls back the whole deduction", async () => {
    const { getDb } = await import("@/db");
    const { InsufficientStockError, deductSaleStock } = await import("./stock");

    const plentiful = await seedProduct(100);
    const scarce = await seedProduct(2);

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'draft', 1, 2000::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id
    `) as { id: string }[];

    const orderId = orderRows[0]?.id;

    if (!orderId) {
      throw new Error("order seed failed");
    }

    const db = getDb();

    // Sorted by ID: whichever sorts first succeeds, then scarcity aborts.
    await expect(
      db.transaction(async (tx) =>
        deductSaleStock(tx, {
          orderId,
          lines: [
            { productId: scarce.id, quantity: 5 },
            { productId: plentiful.id, quantity: 10 },
          ],
          reason: "SO-000003 confirmation",
          actorUserId: actorId,
        }),
      ),
    ).rejects.toBeInstanceOf(InsufficientStockError);

    // Atomicity: neither product's stock moved, no movements persisted.
    const stocks = (await sql`
      select id, stock_on_hand as stock from public.products
      where id in (${plentiful.id}::uuid, ${scarce.id}::uuid)
    `) as { id: string; stock: number }[];
    expect(stocks.every((row) => row.stock === 100 || row.stock === 2)).toBe(
      true,
    );

    const movements = (await sql`
      select count(*)::int as n from public.stock_movements where order_id = ${orderId}::uuid
    `) as { n: number }[];
    expect(movements[0]?.n).toBe(0);
  });

  test("restore writes positive reversal movements and returns stock", async () => {
    const { getDb } = await import("@/db");
    const { restoreSaleStock } = await import("./stock");

    const product = await seedProduct(8);

    const orderRows = (await sql`
      insert into public.orders (
        customer_id, status, version, total_cents, created_by, updated_by
      ) values (${customerId}::uuid, 'confirmed', 2, 2000::bigint, ${actorId}::uuid, ${actorId}::uuid)
      returning id, order_number as number
    `) as { id: string; number: string }[];

    const order = orderRows[0];

    if (!order) {
      throw new Error("order seed failed");
    }

    const db = getDb();

    const applied = await db.transaction(async (tx) =>
      restoreSaleStock(tx, {
        orderId: order.id,
        lines: [{ productId: product.id, quantity: 6 }],
        reason: `${order.number} cancellation`,
        actorUserId: actorId,
      }),
    );

    expect(applied[0]).toMatchObject({
      productId: product.id,
      quantityDelta: 6,
      resultingStock: 14,
    });

    const movements = (await sql`
      select type, quantity_delta as delta from public.stock_movements
      where order_id = ${order.id}::uuid
    `) as { type: string; delta: number }[];
    expect(movements[0]).toMatchObject({ type: "sale_reversal", delta: 6 });
  });
});
