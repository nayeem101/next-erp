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
      public.customers, public.products, public.categories cascade
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

async function seedCustomer(namePrefix: string) {
  const rows = (await sql`
    insert into public.customers (
      name, email, address_line_1, city, postal_code, country_code,
      is_active, created_by, updated_by
    ) values (
      ${`${namePrefix} ${token()}`}, ${`c.${token()}@example.com`},
      '1 Main St', 'Springfield', '62704', 'US',
      true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, name, company_name as "companyName", email
  `) as {
    id: string;
    name: string;
    companyName: string | null;
    email: string;
  }[];

  const row = rows[0];

  if (!row) {
    throw new Error("customer seed failed");
  }

  return row;
}

async function seedProduct(skuPrefix: string, unitPriceCents: number) {
  const categoryRows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = categoryRows[0]?.id;

  if (!categoryId) {
    throw new Error("category seed failed");
  }

  const sku = `${skuPrefix.toUpperCase()}-${token()}`;

  const productRows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${"Product " + sku},
      ${String(BigInt(unitPriceCents))}::bigint,
      100, 5, true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, sku, name, unit_price_cents as cents
  `) as { id: string; sku: string; name: string; cents: string }[];

  const productRow = productRows[0];

  if (!productRow) {
    throw new Error("product seed failed");
  }

  return {
    id: productRow.id,
    sku: productRow.sku,
    name: productRow.name,
    unitPriceCents: Number(productRow.cents),
  };
}

async function seedOrder(input: {
  customerId: string;
  status: "draft" | "confirmed" | "fulfilled" | "cancelled";
  lines: { productId: string; quantity: number; unitPriceCents: number }[];
  createdAt?: Date;
  createdBy?: string;
  confirmedBy?: string;
  fulfilledBy?: string;
  cancelledBy?: string;
}) {
  const createdAt = input.createdAt ?? new Date();
  const totalCents = input.lines.reduce(
    (sum, line) => sum + line.quantity * line.unitPriceCents,
    0,
  );

  // Insert as draft first: line items are immutable once the order leaves
  // draft (enforced by trigger), so lines land before any transition.
  const orderRows = (await sql`
    insert into public.orders (
      customer_id, status, version, currency_code, total_cents,
      created_by, updated_by, created_at
    ) values (
      ${input.customerId}::uuid, 'draft', 1, 'USD',
      ${String(BigInt(totalCents))}::bigint,
      ${input.createdBy ?? actorId}::uuid, ${input.createdBy ?? actorId}::uuid,
      ${createdAt.toISOString()}::timestamptz
    )
    returning id, order_number as "orderNumber"
  `) as { id: string; orderNumber: string }[];

  const order = orderRows[0];

  if (!order) {
    throw new Error("order seed failed");
  }

  for (const line of input.lines) {
    await sql`
      insert into public.order_line_items (
        order_id, product_id, product_sku, product_name,
        quantity, unit_price_cents, line_total_cents
      )
      select ${order.id}::uuid, p.id, p.sku, p.name,
        ${line.quantity},
        p.unit_price_cents,
        ${String(BigInt(line.quantity))}::bigint * p.unit_price_cents
      from public.products p
      where p.id = ${line.productId}::uuid
    `;
  }

  // The transition trigger enforces the PRD graph, so walk legal steps.
  const steps: string[] =
    input.status === "fulfilled"
      ? ["confirmed", "fulfilled"]
      : input.status === "draft"
        ? []
        : [input.status];

  let version = 1;

  for (const step of steps) {
    await sql`
      update public.orders set
        status = ${step}::order_status,
        confirmed_at = case
          when ${step} in ('confirmed', 'fulfilled') and confirmed_at is null
            then ${createdAt.toISOString()}::timestamptz
          else confirmed_at
        end,
        confirmed_by = coalesce(confirmed_by, case
          when ${step} in ('confirmed', 'fulfilled') then ${input.confirmedBy ?? actorId}::uuid
          else confirmed_by
        end),
        fulfilled_at = case
          when ${step} = 'fulfilled' then ${createdAt.toISOString()}::timestamptz
          else fulfilled_at
        end,
        fulfilled_by = case
          when ${step} = 'fulfilled' then ${input.fulfilledBy ?? actorId}::uuid
          else fulfilled_by
        end,
        cancelled_at = case
          when ${step} = 'cancelled' then ${createdAt.toISOString()}::timestamptz
          else cancelled_at
        end,
        cancelled_by = case
          when ${step} = 'cancelled' then ${input.cancelledBy ?? actorId}::uuid
          else cancelled_by
        end,
        version = ${version + 1}
      where id = ${order.id}::uuid
    `;

    version += 1;
  }

  return order;
}

d("order queries", () => {
  beforeEach(async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    actorId = user.id;
  });

  test("listOrders paginates, joins customer and creator, projects totals", async () => {
    const { listOrders } = await import("./queries");

    const buyerA = await seedCustomer("Alpha");
    const buyerB = await seedCustomer("Beta");

    for (const buyer of [buyerA, buyerB]) {
      for (let index = 0; index < 3; index += 1) {
        await seedOrder({
          customerId: buyer.id,
          status: "draft",
          lines: [],
          createdAt: new Date(`2026-08-0${String(index + 1)}T10:00:00.000Z`),
        });
      }
    }

    const page1 = await listOrders(
      { page: 1, pageSize: 5 },
      { includeTotals: true },
    );
    const page2 = await listOrders(
      { page: 2, pageSize: 5 },
      { includeTotals: true },
    );

    expect(page1.total).toBe(6);
    expect(page1.totalPages).toBe(2);
    expect(page1.rows).toHaveLength(5);
    expect(page2.rows).toHaveLength(1);

    expect(page1.rows[0]?.status).toBeDefined();
    expect(page1.rows[0]?.customerName).toMatch(/^(Alpha|Beta) /);
    expect(typeof page1.rows[0]?.creatorName).toBe("string");
    expect(typeof page1.rows[0]?.totalCents).toBe("number");
  });

  test("listOrders filters by status, customer, creator, and date range", async () => {
    const { listOrders } = await import("./queries");

    const seller = await createAuthUser();

    const buyer = await seedCustomer("Gamma");
    const otherBuyer = await seedCustomer("Delta");

    await seedOrder({
      customerId: buyer.id,
      status: "draft",
      lines: [],
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "confirmed",
      lines: [],
      createdAt: new Date("2026-07-15T09:00:00.000Z"),
      confirmedBy: seller.id,
    });
    await seedOrder({
      customerId: otherBuyer.id,
      status: "draft",
      lines: [],
      createdAt: new Date("2026-08-20T09:00:00.000Z"),
      createdBy: seller.id,
    });

    const drafts = await listOrders(
      { status: "draft" },
      { includeTotals: true },
    );
    expect(drafts.total).toBe(2);

    const byCustomer = await listOrders(
      { customerId: buyer.id },
      { includeTotals: true },
    );
    expect(byCustomer.total).toBe(2);

    const byCreator = await listOrders(
      { createdBy: seller.id },
      { includeTotals: true },
    );
    expect(byCreator.total).toBe(1);

    const ranged = await listOrders(
      { dateFrom: "2026-07-10", dateTo: "2026-08-21" },
      { includeTotals: true },
    );
    expect(ranged.total).toBe(2);
  });

  test("listOrders sorts by total and hides money without the projection", async () => {
    const { listOrders } = await import("./queries");

    const buyer = await seedCustomer("Epsilon");
    const cheap = await seedProduct("CHEAP", 500);
    const pricey = await seedProduct("RICH", 9000);

    await seedOrder({
      customerId: buyer.id,
      status: "draft",
      lines: [
        {
          productId: cheap.id,
          quantity: 2,
          unitPriceCents: cheap.unitPriceCents,
        },
      ],
      createdAt: new Date("2026-07-01T09:00:00.000Z"),
    });
    await seedOrder({
      customerId: buyer.id,
      status: "draft",
      lines: [
        {
          productId: pricey.id,
          quantity: 3,
          unitPriceCents: pricey.unitPriceCents,
        },
      ],
      createdAt: new Date("2026-07-02T09:00:00.000Z"),
    });

    const desc = await listOrders(
      { sort: "total_desc" },
      { includeTotals: true },
    );
    expect(desc.rows.map((row) => row.totalCents)).toEqual([27000, 1000]);

    const restricted = await listOrders({}, { includeTotals: false });
    expect(restricted.rows).toHaveLength(2);
    for (const row of restricted.rows) {
      expect(row.totalCents).toBeNull();
    }
  });

  test("getOrder returns snapshot lines and actor projections or null", async () => {
    const { getOrder } = await import("./queries");

    const creator = await createAuthUser();
    const confirmer = await createAuthUser();
    const fulfiller = await createAuthUser();

    const buyer = await seedCustomer("Zeta");
    const drill = await seedProduct("DRILL", 1299);
    const hose = await seedProduct("HOSE", 450);

    const order = await seedOrder({
      customerId: buyer.id,
      status: "fulfilled",
      lines: [
        {
          productId: drill.id,
          quantity: 2,
          unitPriceCents: drill.unitPriceCents,
        },
        {
          productId: hose.id,
          quantity: 10,
          unitPriceCents: hose.unitPriceCents,
        },
      ],
      createdAt: new Date("2026-06-01T08:00:00.000Z"),
      createdBy: creator.id,
      confirmedBy: confirmer.id,
      fulfilledBy: fulfiller.id,
    });

    const detail = await getOrder(order.id, { includeTotals: true });

    expect(detail).not.toBeNull();
    expect(detail?.orderNumber).toBe(order.orderNumber);
    expect(detail?.customerEmail).toBe(buyer.email);
    expect(detail?.totalCents).toBe(7098);
    expect(detail?.creatorName).not.toBeNull();
    expect(detail?.confirmedByName).not.toBeNull();
    expect(detail?.fulfilledByName).not.toBeNull();
    expect(detail?.cancelledByName).toBeNull();
    expect(detail?.cancelledAt).toBeNull();
    expect(detail?.lines).toHaveLength(2);
    expect(detail?.lines[0]).toMatchObject({
      productSku: drill.sku,
      quantity: 2,
      unitPriceCents: 1299,
      lineTotalCents: 2598,
    });
    expect(detail?.lines[1]).toMatchObject({
      productSku: hose.sku,
      lineTotalCents: 4500,
    });

    const restricted = await getOrder(order.id, { includeTotals: false });
    expect(restricted?.totalCents).toBeNull();
    expect(restricted?.lines[0]?.unitPriceCents).toBe(1299);

    expect(await getOrder(randomUUID(), { includeTotals: true })).toBeNull();
  });
});
