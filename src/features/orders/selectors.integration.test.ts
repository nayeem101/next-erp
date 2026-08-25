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
    truncate table public.audit_log, public.orders, public.customers,
      public.products, public.categories cascade
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

d("wizard selectors", () => {
  beforeEach(async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    actorId = user.id;
  });

  test("lists only active customers sorted by name with contact preview", async () => {
    const { listActiveCustomerOptions } = await import("./selectors");

    await seedCustomer({ namePrefix: "Zeta" });
    const active = await seedCustomer({
      namePrefix: "Alpha",
      company: "Alpha Corp",
      phone: "+1 555-0199",
    });
    await seedCustomer({ namePrefix: "Archived", isActive: false });

    const options = await listActiveCustomerOptions();

    expect(options).toHaveLength(2);
    expect(options[0]?.name).toBe(active.name);
    expect(options[0]).toMatchObject({
      companyName: "Alpha Corp",
      phone: "+1 555-0199",
      countryCode: "US",
    });
    expect(options[0]?.email).toContain("@example.com");
  });

  test("lists only active products sorted by name with price and stock", async () => {
    const { listActiveProductOptions } = await import("./selectors");

    await seedProduct("ZZZ", 2500);
    const alpha = await seedProduct("ALPHA", 1299);
    await seedProduct("ARCHIVED", 100, false);

    const options = await listActiveProductOptions();

    expect(options).toHaveLength(2);
    expect(options[0]?.sku).toBe(alpha.sku);
    expect(options[0]).toMatchObject({
      unitPriceCents: 1299,
      stockOnHand: 100,
    });
  });
});

async function seedCustomer(input: {
  namePrefix: string;
  company?: string;
  phone?: string;
  isActive?: boolean;
}) {
  const rows = (await sql`
    insert into public.customers (
      name, email, phone, company_name,
      address_line_1, city, postal_code, country_code,
      is_active, created_by, updated_by
    ) values (
      ${`${input.namePrefix} ${token()}`},
      ${`sel.${token()}@example.com`},
      ${input.phone ?? null},
      ${input.company ?? null},
      '1 Main St', 'Springfield', '62704', 'US',
      ${input.isActive ?? true}, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, name
  `) as { id: string; name: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("customer seed failed");
  }

  return row;
}

async function seedProduct(
  skuPrefix: string,
  unitPriceCents: number,
  isActive = true,
) {
  const categoryRows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = categoryRows[0]?.id;

  if (!categoryId) {
    throw new Error("category seed failed");
  }

  const sku = `${skuPrefix}-${token()}`;

  const productRows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${"Product " + sku},
      ${String(BigInt(unitPriceCents))}::bigint,
      100, 5, ${isActive}, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, sku, name
  `) as { id: string; sku: string; name: string }[];

  const row = productRows[0];

  if (!row) {
    throw new Error("product seed failed");
  }

  return row;
}
