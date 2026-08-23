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

d("roles/users/user_roles schema", () => {
  test("creates the role_key enum with exactly the three role values", async () => {
    const rows = (await sql`
      select unnest(enum_range(null::role_key)) as value
    `) as { value: string }[];

    expect(rows.map((row) => row.value)).toEqual([
      "admin",
      "sales",
      "inventory",
    ]);
  });

  test("enforces one row per role key", async () => {
    const rows = await sql`
      select constraint_type
      from information_schema.table_constraints
      where table_schema = 'public'
        and table_name = 'roles'
        and constraint_name = 'roles_key_unique'
    `;

    expect(rows[0]?.constraint_type).toBe("UNIQUE");
  });

  test("requires role name and description", async () => {
    const rows = await sql`
      select column_name, is_nullable
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'roles'
        and column_name in ('name', 'description')
      order by column_name
    `;

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.is_nullable).toBe("NO");
    }
  });

  test("restricts deletion of the Supabase identity behind a user", async () => {
    const rows = await sql`
      select confdeltype::text as delete_rule
      from pg_constraint
      where conname = 'users_auth_user_fk'
    `;

    // r = RESTRICT
    expect(rows[0]?.delete_rule).toBe("r");
  });

  test("uniquely identifies users by case-normalized email", async () => {
    const rows = await sql`
      select indexdef
      from pg_indexes
      where indexname = 'users_email_lower_unique'
    `;

    expect(rows[0]?.indexdef).toContain("lower((email)::text)");
    expect(rows[0]?.indexdef).toContain("UNIQUE");
  });

  test("defaults users to active and requires display metadata", async () => {
    const rows = await sql`
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'users'
        and column_name in ('is_active', 'display_name', 'email')
      order by column_name
    `;

    const columns = new Map(rows.map((row) => [row.column_name, row]));

    expect(columns.get("email")?.is_nullable).toBe("NO");
    expect(columns.get("display_name")?.is_nullable).toBe("NO");

    const isActive = columns.get("is_active");

    expect(isActive?.is_nullable).toBe("NO");
    expect(String(isActive?.column_default)).toContain("true");
  });

  test("keys user_roles by user and role pair", async () => {
    const rows = (await sql`
      select a.attname as column_name
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where i.indrelid = 'user_roles'::regclass
        and i.indisprimary
      order by array_position(i.indkey, a.attnum)
    `) as { column_name: string }[];

    expect(rows.map((row) => row.column_name)).toEqual(["user_id", "role_id"]);
  });

  test("cascades user deletion but restricts role deletion", async () => {
    const rows = await sql`
      select conname, confdeltype::text as delete_rule
      from pg_constraint
      where conname in (
        'user_roles_user_id_users_id_fk',
        'user_roles_role_id_roles_id_fk'
      )
    `;

    const constraints = new Map(rows.map((row) => [row.conname, row]));

    // c = CASCADE, r = RESTRICT
    expect(constraints.get("user_roles_user_id_users_id_fk")?.delete_rule).toBe(
      "c",
    );
    expect(constraints.get("user_roles_role_id_roles_id_fk")?.delete_rule).toBe(
      "r",
    );
  });

  test("keeps the assigning admin reference when that admin disappears", async () => {
    const rows = await sql`
      select confdeltype::text as delete_rule
      from pg_constraint
      where conname = 'user_roles_assigned_by_users_id_fk'
    `;

    // n = SET NULL
    expect(rows[0]?.delete_rule).toBe("n");
  });
});
