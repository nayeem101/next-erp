/** @vitest-environment node */
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
});

afterEach(async () => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }

  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
});

d("demo order seed", () => {
  test("seeds lifecycle-varied orders with coherent side effects and is idempotent", async () => {
    const admin = await createAuthUser();
    await assignRole(admin.id, "admin");

    // Demo master data must exist for the orders to reference.
    const { seedDemoCustomers } =
      await import("@/features/customers/demo-seed");
    const { seedDemoInventoryCatalog } =
      await import("@/features/products/demo-seed");

    await seedDemoCustomers(admin.id);
    await seedDemoInventoryCatalog(admin.id);

    const { seedDemoOrders } = await import("./demo-seed");
    const result = await seedDemoOrders();

    expect(result.created).toBe(4);

    const statuses = (await sql`
      select notes, status, version from public.orders
      where notes like 'DEMO-%' order by created_at asc
    `) as unknown as {
      notes: string;
      status: string;
      version: number;
    }[];

    expect(statuses.map((row) => row.status)).toEqual([
      "draft", // untouched draft
      "confirmed",
      "fulfilled",
      "cancelled", // confirmed then reversed
    ]);

    // Coherent side effects: one issued invoice per non-cancelled sale.
    const invoices = (await sql`
      select i.status, o.notes from public.invoices i
      join public.orders o on o.id = i.order_id
      where o.notes like 'DEMO-%'
    `) as unknown as { status: string; notes: string }[];
    expect(invoices).toHaveLength(3);
    expect(invoices.filter((row) => row.status === "issued")).toHaveLength(2);
    expect(invoices.filter((row) => row.status === "void")).toHaveLength(1);

    // Movements: sales deducted stock; cancellations restored it.
    const movements = (await sql`
      select m.type, m.quantity_delta as delta from public.stock_movements m
      join public.orders o on o.id = m.order_id
      where o.notes like 'DEMO-%'
    `) as unknown as { type: string; delta: number }[];
    const sales = movements.filter((m) => m.type === "sale");
    const reversals = movements.filter((m) => m.type === "sale_reversal");
    expect(sales).toHaveLength(3); // confirmed + fulfilled + cancelled
    expect(reversals).toHaveLength(1);

    // Journals balance across every posted entry.
    const balances = (await sql`
      select sum(case when side = 'debit' then amount_cents else -amount_cents end)::text as net
      from public.ledger_entries
    `) as unknown as { net: string }[];
    expect(balances[0]?.net).toBe("0");

    // Audit trail covers order, invoice, and ledger actions.
    const auditActions = (await sql`
      select distinct action from public.audit_log
    `) as unknown as { action: string }[];
    const actions = auditActions.map((row) => row.action);

    for (const expected of [
      "order.draft_created",
      "order.confirmed",
      "order.fulfilled",
      "order.cancelled",
      "invoice.issued",
      "invoice.voided",
      "ledger.sale_posted",
      "ledger.sale_reversed",
    ]) {
      expect(actions).toContain(expected);
    }

    // Idempotent second run: nothing new appears.
    const secondRun = await seedDemoOrders();
    expect(secondRun.created).toBe(0);

    const orderCount = (await sql`
      select count(*)::int as n from public.orders where notes like 'DEMO-%'
    `) as unknown as { n: number }[];
    expect(orderCount[0]?.n).toBe(4);
  });

  test("does nothing when no admin user exists yet", async () => {
    const { seedDemoOrders } = await import("./demo-seed");
    const result = await seedDemoOrders();

    expect(result.created).toBe(0);
  });
});
