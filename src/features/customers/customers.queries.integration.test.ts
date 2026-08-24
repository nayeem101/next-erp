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
    truncate table public.audit_log, public.orders, public.customers cascade
  `;

  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }
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

interface SeedCustomerInput {
  namePrefix: string;
  email?: string;
  company?: string;
  isActive?: boolean;
}

async function seedCustomer(input: SeedCustomerInput) {
  const suffix = token();
  const rows = (await sql`
    insert into public.customers (
      name, email, phone, company_name,
      address_line_1, city, postal_code, country_code,
      is_active, created_by, updated_by
    ) values (
      ${`${input.namePrefix} ${suffix}`},
      ${input.email ?? `${input.namePrefix.toLowerCase().replaceAll(/\s+/g, ".")}.${suffix}@example.com`},
      null,
      ${input.company ?? null},
      '1 Main St', 'Springfield', '62704', 'US',
      ${input.isActive ?? true}, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, name, email, company_name as "companyName"
  `) as {
    id: string;
    name: string;
    email: string;
    companyName: string | null;
  }[];

  const row = rows[0];

  if (!row) {
    throw new Error("customer seed failed");
  }

  return row;
}

async function seedOrder(input: {
  customerId: string;
  status: "draft" | "confirmed" | "fulfilled" | "cancelled";
  totalCents: number;
  createdAt?: Date;
}) {
  const createdAt = input.createdAt ?? new Date();
  const confirmedAt = ["confirmed", "fulfilled"].includes(input.status)
    ? createdAt
    : null;
  const rows = (await sql`
    insert into public.orders (
      customer_id, status, version, currency_code, total_cents,
      created_by, updated_by, created_at, confirmed_at, confirmed_by
    ) values (
      ${input.customerId}::uuid, ${input.status}, 1, 'USD',
      ${String(BigInt(input.totalCents))}::bigint,
      ${actorId}::uuid, ${actorId}::uuid,
      ${createdAt.toISOString()}::timestamptz,
      ${confirmedAt ? confirmedAt.toISOString() : null}::timestamptz,
      ${confirmedAt ? actorId : null}::uuid
    )
    returning id, order_number as "orderNumber"
  `) as { id: string; orderNumber: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("order seed failed");
  }

  return row;
}

d("customer queries", () => {
  beforeEach(async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    actorId = user.id;
  });

  test("listCustomers paginates and sorts by case-insensitive name", async () => {
    const { listCustomers } = await import("./queries");

    await seedCustomer({ namePrefix: "Zeta" });
    const alpha = await seedCustomer({ namePrefix: "alpha" });
    await seedCustomer({ namePrefix: "Beta" });
    for (const prefix of ["Delta", "Echo", "Foxtrot"]) {
      await seedCustomer({ namePrefix: prefix });
    }

    const page1 = await listCustomers({ page: 1, pageSize: 5 });
    const page2 = await listCustomers({ page: 2, pageSize: 5 });

    expect(page1.total).toBe(6);
    expect(page1.totalPages).toBe(2);
    expect(page1.rows[0]?.name).toBe(alpha.name);
    expect(page1.rows).toHaveLength(5);
    expect(page2.rows).toHaveLength(1);
  });

  test("listCustomers searches name, email, and company with escaping", async () => {
    const { listCustomers } = await import("./queries");

    const tag = token();
    const target = await seedCustomer({
      namePrefix: "Gamma",
      email: `buyer.100%_${tag}@gamma.io`,
      company: "Gamma Traders",
    });
    await seedCustomer({ namePrefix: "Delta", company: "Other Co" });

    // Plain substrings match across name/email/company.
    const byEmail = await listCustomers({ search: tag });
    expect(byEmail.rows.map((row) => row.id)).toContain(target.id);

    const byCompany = await listCustomers({ search: "gamma trad" });
    expect(byCompany.rows).toHaveLength(1);
    expect(byCompany.rows[0]?.id).toBe(target.id);

    // Wildcard characters match literally: an unescaped `_` would match
    // every row (single-char wildcard), the escaped form matches only the
    // one customer whose address contains an underscore.
    const wildcardUnderscore = await listCustomers({ search: "_" });
    expect(wildcardUnderscore.rows.map((row) => row.id)).toEqual([target.id]);
  });

  test("listCustomers filters by lifecycle status and projects order aggregates", async () => {
    const { listCustomers } = await import("./queries");

    const buyer = await seedCustomer({ namePrefix: "Buyer" });
    const gone = await seedCustomer({
      namePrefix: "Gone",
      isActive: false,
    });

    await seedOrder({
      customerId: buyer.id,
      status: "draft",
      totalCents: 1000,
    });
    await seedOrder({
      customerId: buyer.id,
      status: "cancelled",
      totalCents: 999_00,
    });
    await seedOrder({
      customerId: buyer.id,
      status: "confirmed",
      totalCents: 5000,
    });
    await seedOrder({
      customerId: buyer.id,
      status: "fulfilled",
      totalCents: 2500,
    });

    const all = await listCustomers({ status: "all" });
    expect(all.rows).toHaveLength(2);

    const archived = await listCustomers({ status: "archived" });
    expect(archived.rows.map((row) => row.id)).toEqual([gone.id]);

    const active = await listCustomers({ status: "active" });
    const projected = active.rows.find((row) => row.id === buyer.id);

    expect(projected).toBeDefined();
    expect(projected?.orderCount).toBe(4);
    expect(projected?.confirmedSalesCents).toBe(7500);
  });

  test("getCustomer returns full record with KPIs or null when missing", async () => {
    const { getCustomer } = await import("./queries");

    const buyer = await seedCustomer({
      namePrefix: "Detail",
      company: "Detail Corp",
    });
    await seedOrder({
      customerId: buyer.id,
      status: "draft",
      totalCents: 700,
      createdAt: new Date("2026-08-01T10:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "fulfilled",
      totalCents: 1200,
      createdAt: new Date("2026-08-20T10:00:00.000Z"),
    });

    const detail = await getCustomer(buyer.id);

    expect(detail).toMatchObject({
      id: buyer.id,
      companyName: "Detail Corp",
      countryCode: "US",
      openDraftCount: 1,
      orderCount: 2,
      confirmedSalesCents: 1200,
    });
    expect(detail?.lastOrderAt).toBe(
      new Date("2026-08-20T10:00:00.000Z").toISOString(),
    );
    expect(detail?.addressLine1).toBe("1 Main St");

    expect(await getCustomer(crypto.randomUUID())).toBeNull();
  });

  test("listCustomerOrders sorts, filters by status, and paginates", async () => {
    const { listCustomerOrders } = await import("./queries");

    const buyer = await seedCustomer({ namePrefix: "History" });

    const oldConfirmed = await seedOrder({
      customerId: buyer.id,
      status: "confirmed",
      totalCents: 3000,
      createdAt: new Date("2026-06-01T09:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "fulfilled",
      totalCents: 9000,
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "draft",
      totalCents: 500,
      createdAt: new Date("2026-08-01T09:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "cancelled",
      totalCents: 10,
      createdAt: new Date("2026-08-02T09:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "cancelled",
      totalCents: 20,
      createdAt: new Date("2026-08-03T09:00:00.000Z"),
    });

    const newest = await listCustomerOrders(buyer.id, {});
    expect(newest.total).toBe(5);
    expect(newest.rows[0]?.totalCents).toBe(20);

    const oldest = await listCustomerOrders(buyer.id, { sort: "oldest" });
    expect(oldest.rows[0]?.id).toBe(oldConfirmed.id);

    const totalsDesc = await listCustomerOrders(buyer.id, {
      sort: "total_desc",
    });
    expect(totalsDesc.rows.map((row) => row.totalCents)).toEqual([
      9000, 3000, 500, 20, 10,
    ]);

    const draftsOnly = await listCustomerOrders(buyer.id, {
      status: "draft",
    });
    expect(draftsOnly.total).toBe(1);
    expect(draftsOnly.rows[0]?.status).toBe("draft");
    expect(draftsOnly.rows[0]?.confirmedAt).toBeNull();

    const paged = await listCustomerOrders(buyer.id, {
      page: 2,
      pageSize: 4,
    });
    expect(paged.rows).toHaveLength(1);
    expect(paged.page).toBe(2);
  });

  test("order history survives customer archival and stays reachable", async () => {
    const { listCustomerOrders } = await import("./queries");
    const { getCustomer } = await import("./queries");

    const buyer = await seedCustomer({ namePrefix: "Archived" });
    const order = await seedOrder({
      customerId: buyer.id,
      status: "fulfilled",
      totalCents: 4200,
    });

    await sql`
      update public.customers set is_active = false where id = ${buyer.id}::uuid
    `;

    const history = await listCustomerOrders(buyer.id, { status: "fulfilled" });
    expect(history.total).toBe(1);
    expect(history.rows[0]?.id).toBe(order.id);

    const detail = await getCustomer(buyer.id);
    expect(detail?.isActive).toBe(false);
    expect(detail?.confirmedSalesCents).toBe(4200);
  });
});
