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

async function createTestUser(): Promise<string> {
  const rows = (await sql`
    insert into auth.users (id, email)
    values (gen_random_uuid(), ${`customer-owner-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("auth identity insert returned no id");
  }

  return id;
}

async function createCustomer(userId: string, email?: string): Promise<string> {
  const rows = (await sql`
    insert into customers (
      name, email, address_line_1, city, postal_code, country_code,
      created_by, updated_by
    )
    values (
      ${`Customer ${crypto.randomUUID().slice(0, 8)}`},
      ${email ?? `buyer-${crypto.randomUUID().slice(0, 10)}@example.com`},
      '1 Main Street', 'Springfield', '12345', 'US',
      ${userId}::uuid, ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("customer insert returned no id");
  }

  return id;
}

d("customers schema", () => {
  test("uniquely identifies customers by case-normalized email", async () => {
    const userId = await createTestUser();
    const base = crypto.randomUUID().slice(0, 8);

    await createCustomer(userId, `Buyer-${base}@example.com`);

    await expect(
      createCustomer(userId, `buyer-${base}@EXAMPLE.com`),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("requires the core postal address", async () => {
    const userId = await createTestUser();

    await expect(sql`
      insert into customers (name, email, city, postal_code, country_code, created_by, updated_by)
      values (${`No Address ${crypto.randomUUID().slice(0, 6)}`}, ${`missing-${crypto.randomUUID().slice(0, 6)}@example.com`}, 'Springfield', '12345', 'US', ${userId}::uuid, ${userId}::uuid)
    `).rejects.toMatchObject({ code: "23502" });
  });

  test("restricts deletion of users referenced by customers", async () => {
    const userId = await createTestUser();

    await createCustomer(userId);

    await expect(
      sql`delete from public.users where id = ${userId}::uuid`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  test("defaults customers to active with optional contact fields", async () => {
    const userId = await createTestUser();
    const customerId = await createCustomer(userId);

    const rows = (await sql`
      select is_active, phone, company_name, notes
      from customers
      where id = ${customerId}::uuid
    `) as {
      is_active: boolean;
      phone: string | null;
      company_name: string | null;
      notes: string | null;
    }[];

    expect(rows[0]).toMatchObject({
      is_active: true,
      phone: null,
      company_name: null,
      notes: null,
    });
  });

  test("maintains the name and active-state indexes", async () => {
    const rows = (await sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'customers'
        and indexname in ('customers_name_idx', 'customers_active_idx')
    `) as { indexname: string }[];

    expect(rows.map((row) => row.indexname).sort()).toEqual([
      "customers_active_idx",
      "customers_name_idx",
    ]);
  });
});
