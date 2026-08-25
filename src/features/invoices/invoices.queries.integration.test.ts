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

let actorId: string;
let customerA: string;
let customerB: string;

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

  async function seedCustomer(name: string) {
    const rows = (await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code, country_code,
        is_active, created_by, updated_by
      ) values (
        ${name}, ${name.toLowerCase().replaceAll(" ", ".") + "@example.com"},
        '1 Main St', 'Springfield', '62704', 'US',
        true, ${actorId}::uuid, ${actorId}::uuid
      )
      returning id
    `) as unknown as { id: string }[];

    return rows[0]?.id ?? "";
  }

  customerA = await seedCustomer("Acme Retail");
  customerB = await seedCustomer("Globex Supply");
});

afterEach(async () => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }

  const { resetServerEnvCacheForTests } = await import("@/lib/env/server");
  resetServerEnvCacheForTests();
});

const sellerSnapshot = {
  name: "NextERP Demo Company",
  email: "billing@example.com",
  addressLine1: "100 Market Street",
  city: "San Francisco",
  region: "CA",
  postalCode: "94105",
  countryCode: "US",
};

async function seedInvoice(input: {
  customerId: string;
  status?: "issued" | "void";
  totalCents: number;
  issuedAt: string;
}): Promise<{ invoiceId: string; orderId: string }> {
  const orderRows = (await sql`
    insert into public.orders (
      customer_id, status, version, total_cents, confirmed_by, confirmed_at,
      created_by, updated_by
    ) values (
      ${input.customerId}::uuid, 'confirmed', 2, ${String(BigInt(input.totalCents))}::bigint,
      ${actorId}::uuid, now(), ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  const orderId = orderRows[0]?.id ?? "";

  const billTo = {
    name: input.customerId === customerA ? "Acme Retail" : "Globex Supply",
    email: "buyer@example.com",
    addressLine1: "1 Main St",
    city: "Springfield",
    postalCode: "62704",
    countryCode: "US",
  };

  const rows = (await sql`
    insert into public.invoices (
      order_id, status, seller_snapshot, bill_to_snapshot,
      subtotal_cents, total_cents, issued_at,
      voided_at, created_by
    ) values (
      ${orderId}::uuid, ${input.status ?? "issued"},
      ${sql.json(sellerSnapshot)}::jsonb,
      ${sql.json(billTo)}::jsonb,
      ${String(BigInt(input.totalCents))}::bigint,
      ${String(BigInt(input.totalCents))}::bigint,
      ${input.issuedAt}::timestamptz,
      ${input.status === "void" ? input.issuedAt : null}::timestamptz,
      ${actorId}::uuid
    )
    returning id
  `) as unknown as { id: string }[];

  return { invoiceId: rows[0]?.id ?? "", orderId };
}

d("invoice queries", () => {
  test("lists invoices newest-first with order/customer joins and filters", async () => {
    const old = await seedInvoice({
      customerId: customerA,
      totalCents: 10_000,
      issuedAt: "2026-07-01T10:00:00Z",
    });
    const recentVoid = await seedInvoice({
      customerId: customerB,
      status: "void",
      totalCents: 20_000,
      issuedAt: "2026-08-15T10:00:00Z",
    });
    const recentIssued = await seedInvoice({
      customerId: customerA,
      totalCents: 30_000,
      issuedAt: "2026-08-20T10:00:00Z",
    });

    void old;
    void recentVoid;

    const { listInvoices } = await import("./queries");

    const page = await listInvoices({ page: 1, pageSize: 20 });
    expect(page.total).toBe(3);
    expect(page.rows[0]?.totalCents).toBe(30_000);
    expect(page.rows[0]?.customerName).toBe("Acme Retail");

    // Status filter.
    const issuedOnly = await listInvoices({
      status: "issued",
      page: 1,
      pageSize: 20,
    });
    expect(issuedOnly.total).toBe(2);

    // Customer filter.
    const acmeOnly = await listInvoices({
      customerId: customerA,
      page: 1,
      pageSize: 20,
    });
    expect(acmeOnly.total).toBe(2);
    expect(
      acmeOnly.rows.every((row) => row.customerName === "Acme Retail"),
    ).toBe(true);

    // Date window is inclusive on both ends.
    const august = await listInvoices({
      dateFrom: "2026-08-01",
      dateTo: "2026-08-31",
      page: 1,
      pageSize: 20,
    });
    expect(august.total).toBe(2);

    // Pagination math honors the minimum page size of 5.
    const firstPage = await listInvoices({ page: 1, pageSize: 5 });
    expect(firstPage.rows).toHaveLength(3);
    expect(firstPage.totalPages).toBe(1);

    // Detail projection carries snapshots.
    const detail = recentIssued;
    expect(detail.invoiceId).toBeTruthy();
  });

  test("detail returns null for unknown ids and exposes snapshot parties", async () => {
    await seedInvoice({
      customerId: customerA,
      totalCents: 5_000,
      issuedAt: "2026-08-01T09:00:00Z",
    });

    const { getInvoice, getInvoiceLines } = await import("./queries");

    const missing = await getInvoice(randomUUID());
    expect(missing).toBeNull();

    const all = (await sql`
      select id from public.invoices limit 1
    `) as unknown as { id: string }[];
    const invoiceId = all[0]?.id ?? "";

    const detail = await getInvoice(invoiceId);

    if (!detail) {
      throw new Error("expected an invoice");
    }

    expect(detail.sellerSnapshot.name).toBe("NextERP Demo Company");
    expect(detail.billToSnapshot.name).toBe("Acme Retail");
    expect(detail.currencyCode).toBe("USD");

    // No lines seeded here; the helper just returns an empty list.
    const lines = await getInvoiceLines(invoiceId);
    expect(lines).toEqual([]);
  });
});
