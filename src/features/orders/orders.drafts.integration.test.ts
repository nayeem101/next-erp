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

async function seedCustomer(isActive = true) {
  const rows = (await sql`
    insert into public.customers (
      name, email, address_line_1, city, postal_code, country_code,
      is_active, created_by, updated_by
    ) values (
      ${"Buyer " + token()}, ${"b." + token() + "@example.com"},
      '1 Main St', 'Springfield', '62704', 'US',
      ${isActive}, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as { id: string }[];

  const row = rows[0];

  if (!row) {
    throw new Error("customer seed failed");
  }

  return row;
}

async function seedProduct(unitPriceCents: number, isActive = true) {
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

  const productRows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    ) values (
      ${categoryId}::uuid, ${sku}, ${"Product " + sku},
      ${String(BigInt(unitPriceCents))}::bigint,
      50, 5, ${isActive}, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id, sku, name, stock_on_hand as stock
  `) as { id: string; sku: string; name: string; stock: number }[];

  const row = productRows[0];

  if (!row) {
    throw new Error("product seed failed");
  }

  return row;
}

async function auditActionsFor(entityId: string) {
  return (
    (await sql`
      select action from public.audit_log
      where entity_id = ${entityId}::uuid order by created_at asc
    `) as { action: string }[]
  ).map((row) => row.action);
}

d("createDraftOrder", () => {
  beforeEach(async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    actorId = user.id;
  });

  test("creates a version-1 draft with server snapshots and exact totals", async () => {
    const { createDraftOrder } = await import("./service");

    const buyer = await seedCustomer();
    const drill = await seedProduct(1299);
    const hose = await seedProduct(450);

    const result = await createDraftOrder(
      {
        customerId: buyer.id,
        lines: [
          { productId: drill.id, quantity: 2 },
          { productId: hose.id, quantity: 10 },
        ],
        notes: undefined,
      },
      actorId,
      randomUUID(),
    );

    expect(result.version).toBe(1);
    expect(result.totalCents).toBe(7098);
    expect(result.orderNumber).toMatch(/^SO-\d{6}$/);

    const lines = (await sql`
      select product_sku as sku, quantity,
             unit_price_cents as unit, line_total_cents as "lineTotal"
      from public.order_line_items where order_id = ${result.orderId}::uuid
    `) as { sku: string; quantity: number; unit: string; lineTotal: string }[];

    expect(lines).toHaveLength(2);

    // Line storage order is not part of the contract; look rows up by SKU.
    const bySku = new Map(lines.map((line) => [line.sku, line]));

    expect(bySku.get(drill.sku)).toMatchObject({
      quantity: 2,
      unit: "1299",
      lineTotal: "2598",
    });
    expect(bySku.get(hose.sku)).toMatchObject({
      quantity: 10,
      unit: "450",
      lineTotal: "4500",
    });

    expect(await auditActionsFor(result.orderId)).toEqual([
      "order.draft_created",
    ]);
  });

  test("rejects unknown or inactive customers and products precisely", async () => {
    const { createDraftOrder } = await import("./service");

    const activeBuyer = await seedCustomer();
    const archivedBuyer = await seedCustomer(false);
    const live = await seedProduct(500);
    const dead = await seedProduct(700, false);

    await expect(
      createDraftOrder(
        {
          customerId: randomUUID(),
          lines: [{ productId: live.id, quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      createDraftOrder(
        {
          customerId: archivedBuyer.id,
          lines: [{ productId: live.id, quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      createDraftOrder(
        {
          customerId: activeBuyer.id,
          lines: [{ productId: randomUUID(), quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    await expect(
      createDraftOrder(
        {
          customerId: activeBuyer.id,
          lines: [{ productId: dead.id, quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("draft writes never touch stock, movements, invoices, or ledger", async () => {
    const { createDraftOrder } = await import("./service");

    const buyer = await seedCustomer();
    const drill = await seedProduct(1299);
    const hose = await seedProduct(450);

    await createDraftOrder(
      {
        customerId: buyer.id,
        lines: [
          { productId: drill.id, quantity: 5 },
          { productId: hose.id, quantity: 4 },
        ],
        notes: undefined,
      },
      actorId,
      randomUUID(),
    );

    const stocks = (await sql`
      select sku, stock_on_hand as stock from public.products
      where id in (${drill.id}::uuid, ${hose.id}::uuid) order by sku
    `) as { sku: string; stock: number }[];
    expect(stocks.every((row) => row.stock === 50)).toBe(true);

    const counts = (await sql`
      select
        (select count(*)::int from public.stock_movements) as movements,
        (select count(*)::int from public.invoices) as invoices,
        (select count(*)::int from public.ledger_entries) as ledger
    `) as { movements: number; invoices: number; ledger: number }[];

    expect(counts[0]).toEqual({ movements: 0, invoices: 0, ledger: 0 });
  });
});

d("updateDraftOrder", () => {
  beforeEach(async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    actorId = user.id;
  });

  test("replaces lines with refreshed snapshots and bumps the version", async () => {
    const { createDraftOrder, updateDraftOrder } = await import("./service");

    const buyer = await seedCustomer();
    const drill = await seedProduct(1000);

    const created = await createDraftOrder(
      {
        customerId: buyer.id,
        lines: [{ productId: drill.id, quantity: 2 }],
        notes: undefined,
      },
      actorId,
      randomUUID(),
    );

    // Master data moves between save sessions.
    await sql`
      update public.products set unit_price_cents = 1250::bigint
      where id = ${drill.id}::uuid
    `;

    const hose = await seedProduct(450);

    const updated = await updateDraftOrder(
      {
        orderId: created.orderId,
        version: created.version,
        customerId: buyer.id,
        lines: [
          { productId: drill.id, quantity: 3 },
          { productId: hose.id, quantity: 1 },
        ],
        notes: undefined,
      },
      actorId,
      randomUUID(),
    );

    expect(updated).toEqual({
      orderId: created.orderId,
      version: 2,
      totalCents: 4200,
    });

    const lines = (await sql`
      select product_sku as sku, quantity, unit_price_cents as unit
      from public.order_line_items where order_id = ${created.orderId}::uuid
    `) as { sku: string; quantity: number; unit: string }[];

    expect(lines).toHaveLength(2);

    const bySku = new Map(lines.map((line) => [line.sku, line]));

    expect(bySku.get(drill.sku)).toMatchObject({ quantity: 3, unit: "1250" });
    expect(bySku.get(hose.sku)).toMatchObject({ quantity: 1, unit: "450" });

    void lines;

    expect(await auditActionsFor(created.orderId)).toEqual([
      "order.draft_created",
      "order.draft_updated",
    ]);
  });

  test("stale versions, non-draft orders, and missing orders fail closed", async () => {
    const { createDraftOrder, updateDraftOrder } = await import("./service");

    const buyer = await seedCustomer();
    const drill = await seedProduct(1000);

    const created = await createDraftOrder(
      {
        customerId: buyer.id,
        lines: [{ productId: drill.id, quantity: 1 }],
        notes: undefined,
      },
      actorId,
      randomUUID(),
    );

    await expect(
      updateDraftOrder(
        {
          orderId: created.orderId,
          version: 99,
          customerId: buyer.id,
          lines: [{ productId: drill.id, quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await sql`
      update public.orders set status = 'confirmed',
        confirmed_by = ${actorId}::uuid, confirmed_at = now(), version = version + 1
      where id = ${created.orderId}::uuid
    `;

    await expect(
      updateDraftOrder(
        {
          orderId: created.orderId,
          version: 2,
          customerId: buyer.id,
          lines: [{ productId: drill.id, quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(
      updateDraftOrder(
        {
          orderId: randomUUID(),
          version: 1,
          customerId: buyer.id,
          lines: [{ productId: drill.id, quantity: 1 }],
          notes: undefined,
        },
        actorId,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
