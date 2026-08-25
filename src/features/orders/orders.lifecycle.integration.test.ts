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
  `) as unknown as { id: string }[];

  customerId = rows[0]?.id ?? "";
});

afterEach(async () => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }

  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
});

async function seedProduct(stockOnHand: number) {
  const categoryRows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as unknown as { id: string }[];

  const categoryId = categoryRows[0]?.id ?? "";
  const sku = `SKU-${token()}`;

  const rows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${"Product " + sku}, 1000::bigint,
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

/** Draft with one line; walks legal transitions to reach `status`. */
async function seedOrderAt(
  status: "draft" | "confirmed" | "fulfilled",
): Promise<{ orderId: string; productId: string; version: number }> {
  const product = await seedProduct(25);

  const orderRows = (await sql`
    insert into public.orders (
      customer_id, status, version, total_cents, created_by, updated_by
    ) values (
      ${customerId}::uuid, 'draft', 1, 4000::bigint,
      ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  const orderId = orderRows[0]?.id;

  if (!orderId) {
    throw new Error("order seed failed");
  }

  await sql`
    insert into public.order_line_items (
      order_id, product_id, product_sku, product_name,
      quantity, unit_price_cents, line_total_cents
    )
    select ${orderId}::uuid, p.id, p.sku, p.name,
           4, p.unit_price_cents, p.unit_price_cents * 4
    from public.products p where p.id = ${product.id}::uuid
  `;

  let version = 1;

  if (status !== "draft") {
    // Confirm through the real service so side effects exist.
    const { confirmOrder } = await import("./confirm");
    const confirmed = await confirmOrder(
      { orderId, version },
      actorId,
      randomUUID(),
    );
    version = confirmed.version;
  }

  if (status === "fulfilled") {
    const { fulfillOrder } = await import("./lifecycle");
    const fulfilled = await fulfillOrder(
      { orderId, version },
      actorId,
      randomUUID(),
    );
    version = fulfilled.version;
  }

  return { orderId, productId: product.id, version };
}

d("fulfillOrder", () => {
  test("moves confirmed to fulfilled with actor/time and audits once", async () => {
    const seeded = await seedOrderAt("confirmed");
    const { fulfillOrder } = await import("./lifecycle");

    const result = await fulfillOrder(
      { orderId: seeded.orderId, version: seeded.version },
      actorId,
      randomUUID(),
    );

    expect(result).toEqual({
      orderId: seeded.orderId,
      version: seeded.version + 1,
      status: "fulfilled",
    });

    const stored = (await sql`
      select status, fulfilled_by as "fulfilledBy", fulfilled_at as "fulfilledAt"
      from public.orders where id = ${seeded.orderId}::uuid
    `) as unknown as {
      status: string;
      fulfilledBy: string | null;
      fulfilledAt: Date | null;
    }[];

    expect(stored[0]).toMatchObject({
      status: "fulfilled",
      fulfilledBy: actorId,
    });
    expect(stored[0]?.fulfilledAt).not.toBeNull();

    const actions = (await sql`
      select action from public.audit_log where entity_id = ${seeded.orderId}::uuid
    `) as unknown as { action: string }[];
    expect(actions.map((row) => row.action)).toContain("order.fulfilled");

    // Fulfillment creates no additional stock or ledger movement.
    const counts = (await sql`
      select
        (select count(*)::int from public.ledger_entries) as legs
    `) as unknown as { legs: number }[];
    expect(counts[0]?.legs).toBe(2); // just the confirmation pair
  });

  test("drafts and stale versions cannot be fulfilled", async () => {
    const draft = await seedOrderAt("draft");
    const { fulfillOrder } = await import("./lifecycle");

    await expect(
      fulfillOrder(
        { orderId: draft.orderId, version: draft.version },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const confirmed = await seedOrderAt("confirmed");

    await expect(
      fulfillOrder(
        { orderId: confirmed.orderId, version: 99 },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

d("cancelOrder", () => {
  test("draft cancellation is clean: no restock, no void, no reversal", async () => {
    const product = await seedProduct(25);
    const draft = await seedOrderAt("draft");

    void product;
    const { cancelOrder } = await import("./lifecycle");

    const result = await cancelOrder(
      {
        orderId: draft.orderId,
        version: draft.version,
        reason: "Customer changed their mind.",
      },
      actorId,
      randomUUID(),
    );

    expect(result).toEqual({
      orderId: draft.orderId,
      version: draft.version + 1,
      status: "cancelled",
      reversed: false,
    });

    const counts = (await sql`
      select
        (select count(*)::int from public.stock_movements) as movements,
        (select count(*)::int from public.invoices) as invoices,
        (select count(*)::int from public.ledger_entries) as legs
    `) as unknown as {
      movements: number;
      invoices: number;
      legs: number;
    }[];

    expect(counts[0]).toEqual({ movements: 0, invoices: 0, legs: 0 });

    const stored = (await sql`
      select cancellation_reason as reason, cancelled_by as "cancelledBy"
      from public.orders where id = ${draft.orderId}::uuid
    `) as unknown as {
      reason: string | null;
      cancelledBy: string | null;
    }[];

    expect(stored[0]).toMatchObject({
      reason: "Customer changed their mind.",
      cancelledBy: actorId,
    });

    const actions = (await sql`
      select action from public.audit_log where entity_id = ${draft.orderId}::uuid
    `) as unknown as { action: string }[];
    expect(actions.map((row) => row.action)).toEqual(["order.cancelled"]);
  });

  test("confirmed cancellation restores stock, voids invoice, posts reversal journal", async () => {
    const seeded = await seedOrderAt("confirmed");
    const { cancelOrder } = await import("./lifecycle");

    const result = await cancelOrder(
      {
        orderId: seeded.orderId,
        version: seeded.version,
        reason: "Duplicate order entry.",
      },
      actorId,
      randomUUID(),
    );

    expect(result.reversed).toBe(true);

    // Stock went back to its original level.
    const stock = (await sql`
      select stock_on_hand as stock from public.products where id = ${seeded.productId}::uuid
    `) as unknown as { stock: number }[];
    expect(stock[0]?.stock).toBe(25);

    // Movements: -4 sale then +4 reversal with the cancellation reason.
    const movements = (await sql`
      select type, quantity_delta as delta, reason from public.stock_movements
      where order_id = ${seeded.orderId}::uuid order by created_at asc
    `) as unknown as { type: string; delta: number; reason: string }[];
    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({
      type: "sale_reversal",
      delta: 4,
      reason: /^SO-\d{6} cancellation$/,
    });

    // Invoice is void; books net to zero.
    const invoiceStatus = (await sql`
      select status from public.invoices where order_id = ${seeded.orderId}::uuid
    `) as unknown as { status: string }[];
    expect(invoiceStatus[0]).toMatchObject({ status: "void" });

    const balances = (await sql`
      select account, sum(case when side = 'debit' then amount_cents else -amount_cents end)::text as net
      from public.ledger_entries group by account order by account
    `) as unknown as { account: string; net: string }[];
    expect(balances).toEqual([
      { account: "accounts_receivable", net: "0" },
      { account: "sales_revenue", net: "0" },
    ]);

    const actions = (await sql`
      select action from public.audit_log order by created_at asc
    `) as unknown as { action: string }[];
    expect(actions.map((row) => row.action)).toEqual([
      "order.confirmed",
      "invoice.issued",
      "ledger.sale_posted",
      "invoice.voided",
      "ledger.sale_reversed",
      "order.cancelled",
    ]);
  });

  test("fulfilled orders are terminal and stale submissions fail without partial writes", async () => {
    const fulfilled = await seedOrderAt("fulfilled");
    const { cancelOrder } = await import("./lifecycle");

    await expect(
      cancelOrder(
        {
          orderId: fulfilled.orderId,
          version: fulfilled.version,
          reason: "Too late.",
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Stale version on a live confirmed order also fails closed.
    const confirmed = await seedOrderAt("confirmed");
    const before = (await sql`
      select
        (select stock_on_hand from public.products where id = ${confirmed.productId}::uuid) as stock,
        (select count(*)::int from public.audit_log) as audits
    `) as unknown as { stock: number; audits: number }[];

    await expect(
      cancelOrder(
        {
          orderId: confirmed.orderId,
          version: 999,
          reason: "Stale attempt.",
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const after = (await sql`
      select
        (select stock_on_hand from public.products where id = ${confirmed.productId}::uuid) as stock,
        (select count(*)::int from public.audit_log) as audits
    `) as unknown as { stock: number; audits: number }[];

    expect(after[0]).toEqual(before[0]);
  });
});
