import postgres from "postgres";
import { beforeAll, describe, expect, test } from "vitest";

import { seedDevelopmentData } from "@/db/seed.mts";
import {
  getIntegrationDatabaseUrl,
  prepareIntegrationDatabase,
} from "@/db/test/setup-db";

const d =
  (process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL)
    ? describe
    : describe.skip;

let sql: postgres.Sql;

const adminId = crypto.randomUUID();
const salesId = crypto.randomUUID();
const inventoryId = crypto.randomUUID();

const adminEmail = `demo-admin-${adminId.slice(0, 8)}@example.com`;
const salesEmail = `demo-sales-${salesId.slice(0, 8)}@example.com`;
const inventoryEmail = `demo-inventory-${inventoryId.slice(0, 8)}@example.com`;

beforeAll(async () => {
  await prepareIntegrationDatabase();
  sql = postgres(getIntegrationDatabaseUrl(), { max: 1 });

  // Pre-provision the three demo identities as Supabase Auth would.
  for (const [id, email] of [
    [adminId, adminEmail],
    [salesId, salesEmail],
    [inventoryId, inventoryEmail],
  ] as const) {
    await sql`
      insert into auth.users (id, email, raw_user_meta_data)
      values (${id}::uuid, ${email}, ${sql.json({ display_name: email.split("@")[0] })})
      on conflict (id) do nothing
    `;
  }

  return async () => {
    await sql.end();
  };
});

d("phase 1 seed", () => {
  test("creates exactly three fixed role rows", async () => {
    await seedDevelopmentData(sql, {
      adminId,
      salesId,
      inventoryId,
    });

    const rows = (await sql`
      select key from public.roles order by key
    `) as { key: string }[];

    expect(rows.map((row) => row.key)).toEqual(["admin", "sales", "inventory"]);
  });

  test("maps provisioned identities with the multi-role admin", async () => {
    await seedDevelopmentData(sql, {
      adminId,
      salesId,
      inventoryId,
    });

    const rows = (await sql`
      select u.email, array_agg(r.key) as roles
      from public.users u
      join public.user_roles ur on ur.user_id = u.id
      join public.roles r on r.id = ur.role_id
      where u.id = any(${[adminId, salesId, inventoryId]}::uuid[])
      group by u.email
      order by u.email
    `) as { email: string; roles: string[] }[];

    const byEmail = new Map(rows.map((row) => [row.email, row.roles]));

    expect(byEmail.get(adminEmail)?.sort()).toEqual([
      "admin",
      "inventory",
      "sales",
    ]);
    expect(byEmail.get(inventoryEmail)).toEqual(["inventory"]);
    expect(byEmail.get(salesEmail)).toEqual(["sales"]);
  });

  test("is idempotent across repeated runs", async () => {
    for (let run = 0; run < 3; run += 1) {
      await seedDevelopmentData(sql, {
        adminId,
        salesId,
        inventoryId,
      });
    }

    const roleRows = (await sql`
      select count(*) as n from public.roles
    `) as { n: number | string }[];

    const membershipRows = (await sql`
      select count(*) as n from public.user_roles where user_id in (${adminId}::uuid, ${salesId}::uuid, ${inventoryId}::uuid)
    `) as { n: number | string }[];

    expect(Number(roleRows[0]?.n)).toBe(3);
    expect(Number(membershipRows[0]?.n)).toBe(5);
  });

  test("rejects seed runs without provisioned identity mappings", async () => {
    const missing = crypto.randomUUID();

    await expect(
      seedDevelopmentData(sql, {
        adminId: missing,
        salesId,
        inventoryId,
      }),
    ).rejects.toThrow(/SEED_DEMO_ADMIN_ID/);

    const rows = (await sql`
      select count(*) as n from public.user_roles where user_id = ${missing}::uuid
    `) as { n: number | string }[];

    // The unmapped identity gains no access; existing assignments untouched.
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
