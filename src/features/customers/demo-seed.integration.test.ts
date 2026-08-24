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

d("demo customer seed", () => {
  test("creates the demo directory through the production service", async () => {
    const admin = await createAuthUser();
    await assignRole(admin.id, "admin");

    const { seedDemoCustomers } = await import("./demo-seed");
    const result = await seedDemoCustomers(admin.id);

    expect(result.created).toBe(5);

    const rows = (await sql`
      select count(*)::int as n from public.customers where is_active
    `) as { n: number }[];
    expect(rows[0]?.n).toBe(5);

    const events = (await sql`
      select count(*)::int as n from public.audit_log where action = 'customer.created'
    `) as { n: number }[];
    expect(events[0]?.n).toBe(5);
  });

  test("reruns are no-ops with no duplicate emails or audit noise", async () => {
    const admin = await createAuthUser();
    await assignRole(admin.id, "admin");

    const { seedDemoCustomers } = await import("./demo-seed");

    const first = await seedDemoCustomers(admin.id);
    const second = await seedDemoCustomers(admin.id);
    const third = await seedDemoCustomers(admin.id);

    expect(first.created).toBe(5);
    expect(second.created).toBe(0);
    expect(third.created).toBe(0);

    const rows = (await sql`
      select count(*)::int as n from public.customers
    `) as { n: number }[];
    expect(rows[0]?.n).toBe(5);

    const events = (await sql`
      select count(*)::int as n from public.audit_log where action = 'customer.created'
    `) as { n: number }[];
    expect(events[0]?.n).toBe(5);
  });

  test("absorbs a pre-seeded subset without duplicating it", async () => {
    const admin = await createAuthUser();
    await assignRole(admin.id, "admin");

    const actorId = admin.id;

    await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code, country_code,
        is_active, created_by, updated_by
      ) values (
        ${"Acme Retail Group"}, ${"buying@acmeretail.example"},
        ${"100 Commerce Way (edited)"}, ${"Springfield"}, ${"62704"},
        ${"US"}, true, ${actorId}::uuid, ${actorId}::uuid
      )
    `;

    const { seedDemoCustomers } = await import("./demo-seed");
    const result = await seedDemoCustomers(actorId);

    // The existing row keeps its data; the remaining four are added.
    expect(result.created).toBe(4);

    const acme = (await sql`
      select address_line_1 as address, count(*) over () as total
      from public.customers where email = ${"buying@acmeretail.example"}
    `) as { address: string; total: number }[];

    expect(acme[0]?.address).toBe("100 Commerce Way (edited)");
    expect(Number(acme[0]?.total)).toBe(1);
  });
});
