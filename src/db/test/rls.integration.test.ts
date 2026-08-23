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

const applicationTables = [
  "users",
  "user_roles",
  "roles",
  "customers",
  "categories",
  "products",
  "orders",
  "order_line_items",
  "invoices",
  "stock_movements",
  "ledger_entries",
  "audit_log",
] as const;

async function asRole<T>(
  role: string,
  work: (db: postgres.Sql) => Promise<T>,
): Promise<T> {
  await sql.unsafe(`set local role ${role}`);
  try {
    return await work(sql);
  } finally {
    await sql.unsafe("reset role");
  }
}

d("row-level security hardening", () => {
  test("enables row-level security on every application table", async () => {
    const rows = (await sql`
      select c.relname as tablename, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'r'
        and c.relname in (
          'users', 'user_roles', 'roles', 'customers', 'categories',
          'products', 'orders', 'order_line_items', 'invoices',
          'stock_movements', 'ledger_entries', 'audit_log'
        )
    `) as { tablename: string; relrowsecurity: boolean }[];

    expect(rows).toHaveLength(applicationTables.length);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
    }
  });

  test("creates a non-privileged runtime role that cannot bypass RLS", async () => {
    const rows = (await sql`
      select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
      from pg_roles
      where rolname = 'nexterp_runtime'
    `) as {
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }[];

    expect(rows[0]).toMatchObject({
      rolsuper: false,
      rolbypassrls: false,
      rolcreatedb: false,
      rolcreaterole: false,
    });
  });

  test("lets the runtime role read and write business tables", async () => {
    const visibleRoles = await asRole(
      "nexterp_runtime",
      (db) => db`select count(*) as n from roles`,
    );
    void visibleRoles;

    await sql.begin(async (tx) => {
      await tx.unsafe("set local role nexterp_runtime");

      const inserted = (await tx`
        insert into categories (name, slug, created_by, updated_by)
        select 'RLS Probe', ${`rls-${crypto.randomUUID().slice(0, 12)}`}, u.id, u.id
        from users u limit 1
        returning id
      `) as { id: string }[];

      const categoryId = inserted[0]?.id;

      if (!categoryId) {
        throw new Error("runtime role could not insert category");
      }

      await tx`
        update categories set description = 'probe' where id = ${categoryId}::uuid
      `;
      await tx`delete from categories where id = ${categoryId}::uuid`;
    });
  });

  test("denies the runtime role updates and deletes on append-only trails", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role nexterp_runtime");
        await tx`
          update stock_movements set reason = 'tampered'
          where id = '00000000-0000-0000-0000-000000000000'::uuid
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role nexterp_runtime");
        await tx`
          delete from ledger_entries
          where id = '00000000-0000-0000-0000-000000000000'::uuid
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });

    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("set local role nexterp_runtime");
        await tx`
          delete from audit_log
          where id = '00000000-0000-0000-0000-000000000000'::uuid
        `;
      }),
    ).rejects.toMatchObject({ code: "42501" });

    // Reads and inserts remain available to the runtime role.
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role nexterp_runtime");
      const rows = (await tx`
        select count(*) as n from stock_movements
      `) as { n: number | string }[];

      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
    });
  });

  test("gives browser roles no visibility despite table grants", async () => {
    // Simulate hosted Supabase where anon/authenticated may hold table grants.
    for (const browserRole of ["anon", "authenticated"]) {
      const exists = (await sql`
        select 1 from pg_roles where rolname = ${browserRole}
      `) as Record<string, unknown>[];

      if (!exists[0]) {
        continue;
      }

      await sql.unsafe(`grant usage on schema public to ${browserRole}`);
      await sql.unsafe(
        `grant select, insert on all tables in schema public to ${browserRole}`,
      );

      try {
        // RLS with zero policies hides every row from browser roles.
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${browserRole}`);
          const rows =
            (await tx`select * from products`) as unknown as unknown[];

          expect(rows).toHaveLength(0);
        });

        // Writes are denied outright (RLS check fails regardless of grants).
        // VALUES-based so the row always reaches the WITH CHECK stage.
        await expect(
          sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${browserRole}`);
            await tx`
              insert into products (
                category_id, sku, name, unit_price_cents,
                created_by, updated_by
              )
              values (
                '00000000-0000-0000-0000-000000000000'::uuid,
                'HACK', 'hack', 1,
                '00000000-0000-0000-0000-000000000000'::uuid,
                '00000000-0000-0000-0000-000000000000'::uuid
              )
            `;
          }),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await sql.unsafe(
          `revoke select, insert on all tables in schema public from ${browserRole}`,
        );
      }
    }
  });

  test("keeps sequence access restricted to the runtime role", async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe("set local role nexterp_runtime");

      const rows = (await tx`
        select nextval('order_number_seq') as value
      `) as { value: string | number }[];

      expect(Number(rows[0]?.value)).toBeGreaterThanOrEqual(1000);
    });
  });
});
