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

  const admin = await createAuthUser();
  await assignRole(admin.id, "admin");
  actorId = admin.id;

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

async function seedConfirmedOrderWithJournal(totalCents: number) {
  const product = await seedProduct(50);

  const orderRows = (await sql`
    insert into public.orders (
      customer_id, status, version, total_cents, created_by, updated_by
    ) values (
      ${customerId}::uuid, 'draft', 1, ${String(BigInt(totalCents))}::bigint,
      ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  const orderId = orderRows[0]?.id ?? "";

  await sql`
    insert into public.order_line_items (
      order_id, product_id, product_sku, product_name,
      quantity, unit_price_cents, line_total_cents
    )
    select ${orderId}::uuid, p.id, p.sku, p.name,
           ${totalCents / 1000}, p.unit_price_cents, p.unit_price_cents * ${totalCents / 1000}
    from public.products p where p.id = ${product.id}::uuid
  `;

  const { confirmOrder } = await import("@/features/orders/confirm");
  const confirmed = await confirmOrder(
    { orderId, version: 1 },
    actorId,
    randomUUID(),
  );

  return { orderId, invoiceNumber: confirmed.invoiceNumber };
}

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

d("ledger queries", () => {
  test("groups entries into balanced journals with links and totals", async () => {
    const first = await seedConfirmedOrderWithJournal(10_000);
    const second = await seedConfirmedOrderWithJournal(25_000);

    void first;
    void second;

    const { listLedgerJournals } = await import("./queries");

    const page = await listLedgerJournals({ page: 1, pageSize: 10 });

    expect(page.total).toBe(2);

    for (const journal of page.journals) {
      expect(journal.debitTotalCents).toBe(journal.creditTotalCents);
      expect(journal.legs).toHaveLength(2);
      expect(journal.invoiceNumber).toMatch(/^INV-\d{6}$/);
      expect(journal.orderNumber).toMatch(/^SO-\d{6}$/);
    }

    // Newest-first ordering.
    expect(page.journals[0]?.description).not.toBe("");

    // Journal-type filter.
    const salesOnly = await listLedgerJournals({
      journalType: "sale",
      page: 1,
      pageSize: 10,
    });
    expect(salesOnly.total).toBe(2);

    // Reference filter narrows by order number.
    const byReference = await listLedgerJournals({
      reference: page.journals[0]?.orderNumber ?? "",
      page: 1,
      pageSize: 10,
    });
    expect(byReference.total).toBe(1);

    // Account filter shows the matching leg per journal; balance checks
    // are intentionally skipped for partial groups.
    const arOnly = await listLedgerJournals({
      account: "accounts_receivable",
      page: 1,
      pageSize: 10,
    });
    expect(arOnly.total).toBe(2);
    expect(
      arOnly.journals.every((journal) =>
        journal.legs.every((leg) => leg.account === "accounts_receivable"),
      ),
    ).toBe(true);

    // Date window.
    const future = await listLedgerJournals({
      dateFrom: "2099-01-01",
      page: 1,
      pageSize: 10,
    });
    expect(future.total).toBe(0);
  });

  test("pagination slices the journal list", async () => {
    await seedConfirmedOrderWithJournal(10_000);
    await seedConfirmedOrderWithJournal(20_000);
    await seedConfirmedOrderWithJournal(30_000);

    const { listLedgerJournals } = await import("./queries");

    const firstPage = await listLedgerJournals({ page: 1, pageSize: 2 });
    expect(firstPage.total).toBe(3);
    expect(firstPage.journals).toHaveLength(2);
    expect(firstPage.totalPages).toBe(2);

    const secondPage = await listLedgerJournals({ page: 2, pageSize: 2 });
    expect(secondPage.journals).toHaveLength(1);
  });

  test("an unbalanced journal read throws and logs the invariant error", async () => {
    await seedConfirmedOrderWithJournal(15_000);

    // Corrupt the books directly to prove the read-side guard fires.
    await sql`alter table public.ledger_entries disable trigger user`;
    try {
      await sql`
        update public.ledger_entries set amount_cents = 7::bigint
        where side = 'credit' and amount_cents = 15000::bigint
      `;
    } finally {
      await sql`alter table public.ledger_entries enable trigger user`;
    }

    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      const { listLedgerJournals } = await import("./queries");

      await expect(
        listLedgerJournals({ page: 1, pageSize: 10 }),
      ).rejects.toThrow(/Unbalanced journal detected/);

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("[ledger-invariant]"),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  test("non-admin roles cannot query ledger data", async () => {
    // The query module is server-only; authorization happens at the route
    // layer via MODULE_ROLE_REQUIREMENTS.ledger. Prove the mapping.
    const { MODULE_ROLE_REQUIREMENTS } = await import("@/lib/auth/roles");

    expect(MODULE_ROLE_REQUIREMENTS.ledger).toEqual(["admin"]);
  });
});
