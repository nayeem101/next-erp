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
    truncate table public.audit_log, public.stock_movements, public.products, public.categories cascade
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

interface SeededMovement {
  id: string;
  productId: string;
  type: string;
  delta: number;
  actorId: string;
}

async function seedActor(): Promise<{ id: string; name: string }> {
  const user = await createAuthUser();
  await assignRole(user.id, "admin");

  const rows = (await sql`
    select display_name as name from public.users where id = ${user.id}::uuid
  `) as { name: string }[];

  return { id: user.id, name: rows[0]?.name ?? "" };
}

async function seedProduct(actorId: string): Promise<string> {
  const rows = (await sql`
    insert into public.categories (name, slug, is_active, created_by, updated_by)
    values (${"Cat " + token()}, ${"cat-" + token()}, true, ${actorId}::uuid, ${actorId}::uuid)
    returning id
  `) as { id: string }[];

  const categoryId = rows[0]?.id;

  if (!categoryId) {
    throw new Error("category seed failed");
  }

  const productRows = (await sql`
    insert into public.products (
      category_id, sku, name, unit_price_cents,
      stock_on_hand, reorder_level, is_active, created_by, updated_by
    )
    values (
      ${categoryId}::uuid, ${"SKU-" + token()}, ${"Widget " + token()},
      1500::bigint, 0, 5, true, ${actorId}::uuid, ${actorId}::uuid
    )
    returning id
  `) as { id: string }[];

  const productId = productRows[0]?.id;

  if (!productId) {
    throw new Error("product seed failed");
  }

  return productId;
}

async function seedMovement(input: {
  productId: string;
  actorId: string;
  type: "opening" | "adjustment" | "sale" | "sale_reversal";
  delta: number;
  resultingStock: number;
  orderId?: string | null;
  daysAgo?: number;
  reason?: string;
}): Promise<SeededMovement> {
  const rows = (await sql`
    insert into public.stock_movements (
      product_id, order_id, type, quantity_delta,
      resulting_stock, reason, created_by, created_at
    )
    values (
      ${input.productId}::uuid,
      ${input.orderId ?? null}::uuid,
      ${input.type}::stock_movement_type,
      ${input.delta},
      ${input.resultingStock},
      ${input.reason ?? "Seed movement"},
      ${input.actorId}::uuid,
      now() - (${input.daysAgo ?? 0} || ' days')::interval
    )
    returning id, product_id as "productId", type,
              quantity_delta as delta, created_by as "actorId"
  `) as SeededMovement[];

  const row = rows[0];

  if (!row) {
    throw new Error("movement seed failed");
  }

  return row;
}

d("listStockMovements", () => {
  let admin: { id: string; name: string };
  let clerk: { id: string; name: string };
  let drillId: string;
  let widgetId: string;

  beforeEach(async () => {
    admin = await seedActor();
    clerk = await seedActor();

    drillId = await seedProduct(admin.id);
    widgetId = await seedProduct(clerk.id);

    // Drill: opening then two adjustments across dates and actors.
    await seedMovement({
      productId: drillId,
      actorId: admin.id,
      type: "opening",
      delta: 40,
      resultingStock: 40,
      daysAgo: 3,
      reason: "Opening balance",
    });
    await seedMovement({
      productId: drillId,
      actorId: clerk.id,
      type: "adjustment",
      delta: -5,
      resultingStock: 35,
      daysAgo: 2,
      reason: "Damaged in transit",
    });
    await seedMovement({
      productId: drillId,
      actorId: admin.id,
      type: "adjustment",
      delta: 10,
      resultingStock: 45,
      daysAgo: 1,
      reason: "Cycle count correction",
    });

    // Widget: opening plus two adjustments.
    await seedMovement({
      productId: widgetId,
      actorId: clerk.id,
      type: "opening",
      delta: 7,
      resultingStock: 7,
      daysAgo: 2,
      reason: "Opening balance",
    });
    await seedMovement({
      productId: widgetId,
      actorId: admin.id,
      type: "adjustment",
      delta: -1,
      resultingStock: 6,
      daysAgo: 1,
      reason: "Damage write-off",
    });
    await seedMovement({
      productId: widgetId,
      actorId: admin.id,
      type: "adjustment",
      delta: 3,
      resultingStock: 9,
      reason: "Found in returns",
    });
  });

  test("returns newest-first history with product and actor names joined", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    const page = await listStockMovements({ productId: drillId });

    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(1);
    expect(page.rows.map((row) => row.quantityDelta)).toEqual([10, -5, 40]);
    expect(page.rows.every((row) => row.productSku.startsWith("SKU-"))).toBe(
      true,
    );
    expect(page.rows[0]?.reason).toBe("Cycle count correction");
    expect(page.rows[1]?.actorName).toBe(clerk.name);
    expect(page.rows[0]?.orderNumber).toBeNull();
  });

  test("type filter isolates openings from adjustments", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    const openings = await listStockMovements({ type: "opening" });

    expect(openings.total).toBe(2);

    const adjustments = await listStockMovements({ type: "adjustment" });

    expect(adjustments.total).toBe(4);
    expect(adjustments.rows.every((row) => row.type === "adjustment")).toBe(
      true,
    );
  });

  test("actor filter scopes to the acting user across products", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    const byClerk = await listStockMovements({ actorId: clerk.id });

    expect(byClerk.total).toBe(2);
    expect(byClerk.rows.every((row) => row.actorId === clerk.id)).toBe(true);
  });

  test("date range is inclusive on both ends", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    const today = new Date();
    const isoDaysAgo = (days: number) => {
      const date = new Date(today);

      date.setDate(date.getDate() - days);

      return date.toISOString().slice(0, 10);
    };

    const window = await listStockMovements({
      from: isoDaysAgo(2),
      to: isoDaysAgo(1),
    });

    expect(window.total).toBe(4);
    expect(
      window.rows.every(
        (row) => row.type === "adjustment" || row.type === "opening",
      ),
    ).toBe(true);
    expect(window.rows.some((row) => row.reason === "Damaged in transit")).toBe(
      true,
    );
    expect(
      window.rows.some((row) => row.reason === "Cycle count correction"),
    ).toBe(true);
    expect(
      window.rows.some(
        (row) => row.reason === "Opening balance" && row.productId === drillId,
      ),
    ).toBe(false);
  });

  test("order-number filter matches case-insensitively through the join", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    // Attach an order to a sale movement.
    const customerRows = (await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code,
        country_code, is_active, created_by, updated_by
      )
      values (
        ${"Cust " + token()},
        ${token() + "@example.com"},
        ${"1 Main St"},
        ${"Springfield"},
        ${"00000"},
        ${"US"},
        true,
        ${admin.id}::uuid,
        ${admin.id}::uuid
      )
      returning id
    `) as { id: string }[];

    const customerId = customerRows[0]?.id;

    if (!customerId) {
      throw new Error("customer seed failed");
    }

    const orderRows = (await sql`
      insert into public.orders (customer_id, status, created_by, updated_by)
      values (${customerId}::uuid, 'draft', ${admin.id}::uuid, ${admin.id}::uuid)
      returning id, order_number as "orderNumber"
    `) as { id: string; orderNumber: string }[];

    const orderId = orderRows[0]?.id;
    const orderNumber = orderRows[0]?.orderNumber;

    if (!orderId || !orderNumber) {
      throw new Error("order seed failed");
    }

    await seedMovement({
      productId: widgetId,
      actorId: clerk.id,
      type: "sale",
      delta: -2,
      resultingStock: 5,
      orderId,
      reason: "Sale",
    });

    const byOrderLower = await listStockMovements({
      orderNumber: orderNumber.toLowerCase(),
    });

    expect(byOrderLower.total).toBe(1);
    expect(byOrderLower.rows[0]?.orderNumber).toBe(orderNumber);
    expect(byOrderLower.rows[0]?.type).toBe("sale");
  });

  test("delta sorting allowlist orders ascending and descending", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    const allAsc = await listStockMovements({ sort: "delta_asc" });
    const deltas = allAsc.rows.map((row) => row.quantityDelta);

    expect([...deltas].sort((a, b) => a - b)).toEqual(deltas);

    const desc = await listStockMovements({ sort: "delta_desc" });
    const descDeltas = desc.rows.map((row) => row.quantityDelta);

    expect([...descDeltas].sort((a, b) => b - a)).toEqual(descDeltas);
  });

  test("paginates deterministically with server totals", async () => {
    const { listStockMovements } = await import("./stock-movement-queries");

    const firstPage = await listStockMovements({ pageSize: 5 });

    expect(firstPage.total).toBe(6);
    expect(firstPage.totalPages).toBe(2);
    expect(firstPage.rows).toHaveLength(5);

    const secondPage = await listStockMovements({ page: 2, pageSize: 5 });

    expect(secondPage.rows).toHaveLength(1);
    expect(
      secondPage.rows.some((row) =>
        firstPage.rows.every((first) => first.id !== row.id),
      ),
    ).toBe(true);
  });
});
