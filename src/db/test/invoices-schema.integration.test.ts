import postgres from "postgres";
import { beforeAll, describe, expect, test } from "vitest";

import {
  getIntegrationDatabaseUrl,
  prepareIntegrationDatabase,
} from "@/db/test/setup-db";

const d =
  (process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL)
    ? describe
    : describe.skip;

let sql: postgres.Sql;

beforeAll(async () => {
  await prepareIntegrationDatabase();
  sql = postgres(getIntegrationDatabaseUrl(), { max: 1 });

  return async () => {
    await sql.end();
  };
});

interface SnapshotOverrides {
  subtotalCents?: number;
  seller?: postgres.JSONValue;
  billTo?: postgres.JSONValue;
}

function partySnapshot(
  label: string,
  overrides: Record<string, postgres.JSONValue> = {},
): Record<string, postgres.JSONValue> {
  const base: Record<string, postgres.JSONValue> = {
    name: `${label} Company`,
    email: `billing-${label.toLowerCase()}@example.com`,
    addressLine1: "100 Market Street",
    city: "San Francisco",
    postalCode: "94105",
    countryCode: "US",
  };

  return { ...base, ...overrides };
}

async function createConfirmedOrderFixture(): Promise<{
  userId: string;
  orderId: string;
}> {
  const userRows = (await sql`
    insert into auth.users (id, email)
    values (gen_random_uuid(), ${`invoice-owner-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const userId = userRows[0]?.id;

  if (!userId) {
    throw new Error("auth identity insert returned no id");
  }

  const customerRows = (await sql`
    insert into customers (name, email, address_line_1, city, postal_code, country_code, created_by, updated_by)
    values (
      ${`Invoice Customer ${crypto.randomUUID().slice(0, 6)}`},
      ${`invoice-cust-${crypto.randomUUID().slice(0, 10)}@example.com`},
      '1 Main Street', 'Springfield', '12345', 'US',
      ${userId}::uuid, ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const customerId = customerRows[0]?.id;

  if (!customerId) {
    throw new Error("customer insert returned no id");
  }

  const orderRows = (await sql`
    insert into orders (customer_id, status, confirmed_by, confirmed_at, created_by, updated_by)
    values (${customerId}::uuid, 'confirmed', ${userId}::uuid, now(), ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const orderId = orderRows[0]?.id;

  if (!orderId) {
    throw new Error("order insert returned no id");
  }

  return { userId, orderId };
}

async function createInvoice(
  orderId: string,
  userId: string,
  overrides: SnapshotOverrides = {},
): Promise<string> {
  const rows = (await sql`
    insert into invoices (
      order_id, seller_snapshot, bill_to_snapshot,
      subtotal_cents, total_cents, created_by
    )
    values (
      ${orderId}::uuid,
      ${sql.json(overrides.seller ?? partySnapshot("Seller"))},
      ${sql.json(overrides.billTo ?? partySnapshot("Buyer"))},
      ${overrides.subtotalCents ?? 2500},
      ${overrides.subtotalCents ?? 2500},
      ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("invoice insert returned no id");
  }

  return id;
}

d("invoices schema", () => {
  test("assigns sequential human-readable invoice numbers", async () => {
    const { userId, orderId } = await createConfirmedOrderFixture();
    await createInvoice(orderId, userId);

    const rows = (await sql`
      select invoice_number as "invoiceNumber"
      from invoices
      where order_id = ${orderId}::uuid
    `) as { invoiceNumber: string }[];

    expect(rows[0]?.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(Number(rows[0]?.invoiceNumber.slice(4))).toBeGreaterThanOrEqual(
      1000,
    );
  });

  test("allows at most one invoice per order", async () => {
    const { userId, orderId } = await createConfirmedOrderFixture();

    await createInvoice(orderId, userId);

    const other = await createConfirmedOrderFixture();

    await createInvoice(other.orderId, other.userId);

    await expect(createInvoice(orderId, other.userId)).rejects.toMatchObject({
      code: "23505",
    });
  });

  test("requires positive matching amounts", async () => {
    const zero = await createConfirmedOrderFixture();

    await expect(
      createInvoice(zero.orderId, zero.userId, { subtotalCents: 0 }),
    ).rejects.toMatchObject({ code: "23514" });

    const mismatch = await createConfirmedOrderFixture();

    await expect(sql`
      insert into invoices (
        order_id, seller_snapshot, bill_to_snapshot,
        subtotal_cents, total_cents, created_by
      ) values (
        ${mismatch.orderId}::uuid,
        ${sql.json(partySnapshot("Seller"))},
        ${sql.json(partySnapshot("Buyer"))},
        2500, 2400, ${mismatch.userId}::uuid
      )
    `).rejects.toMatchObject({ code: "23514" });
  });

  test("rejects snapshots missing required contact keys", async () => {
    const { userId, orderId } = await createConfirmedOrderFixture();
    const incompleteSeller = partySnapshot("Seller");

    delete (incompleteSeller as Record<string, unknown>).postalCode;

    await expect(
      createInvoice(orderId, userId, {
        seller: incompleteSeller,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("accepts optional snapshot fields and defaults to issued status", async () => {
    const { userId, orderId } = await createConfirmedOrderFixture();

    await createInvoice(orderId, userId, {
      billTo: partySnapshot("Buyer", {
        companyName: "Buyer LLC",
        phone: "+1 555 0100",
        addressLine2: "Suite 2",
        region: "CA",
      }),
    });

    const rows = (await sql`
      select status, voided_at as "voidedAt"
      from invoices
      where order_id = ${orderId}::uuid
    `) as { status: string; voidedAt: string | null }[];

    expect(rows[0]).toMatchObject({ status: "issued", voidedAt: null });
  });
});
