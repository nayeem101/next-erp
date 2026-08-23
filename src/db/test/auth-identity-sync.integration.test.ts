import { randomUUID } from "node:crypto";

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

function emailFor(seed: string): string {
  return `sync-${seed}@example.com`;
}

async function insertAuthIdentity(
  input: {
    id?: string;
    email?: string;
    displayNameMetadata?: postgres.JSONValue;
  } = {},
): Promise<string> {
  const id = input.id ?? randomUUID();
  const email = input.email ?? emailFor(id.slice(0, 8));
  // sql.json binds a properly typed jsonb parameter; manually stringified
  // strings arrive double-encoded.
  const metadata =
    input.displayNameMetadata === undefined
      ? {}
      : { display_name: input.displayNameMetadata };

  await sql`
    insert into auth.users (id, email, raw_user_meta_data)
    values (${id}::uuid, ${email}, ${sql.json(metadata)})
  `;

  return id;
}

async function fetchPublicUser(id: string): Promise<
  | {
      email: string;
      displayName: string;
    }
  | undefined
> {
  const rows = (await sql`
    select email, display_name as "displayName"
    from public.users
    where id = ${id}::uuid
  `) as { email: string; displayName: string }[];

  const row = rows[0];

  if (!row) {
    return undefined;
  }

  return { email: row.email, displayName: row.displayName };
}

d("auth identity synchronization trigger", () => {
  test("mirrors new identities into public.users", async () => {
    const id = await insertAuthIdentity({
      displayNameMetadata: "  Ada   Lovelace ",
    });

    const user = await fetchPublicUser(id);

    expect(user?.email).toBe(`sync-${id.slice(0, 8)}@example.com`);
    expect(user?.displayName).toBe("Ada Lovelace");
  });

  test("never assigns a default role during synchronization", async () => {
    const id = await insertAuthIdentity();

    const rows = (await sql`
      select count(*) as role_count
      from public.user_roles
      where user_id = ${id}::uuid
    `) as { role_count: number | string }[];

    expect(Number(rows[0]?.role_count)).toBe(0);
  });

  test("ignores non-string metadata and falls back to the email prefix", async () => {
    for (const malicious of [42, null, ["Array"], { object: true }]) {
      const id = await insertAuthIdentity({ displayNameMetadata: malicious });

      const user = await fetchPublicUser(id);

      expect(user?.displayName).toBe(`sync-${id.slice(0, 8)}`);
    }
  });

  test("caps oversized display names at the database limit", async () => {
    const id = await insertAuthIdentity({
      displayNameMetadata: "A".repeat(500),
    });

    const user = await fetchPublicUser(id);

    expect(user?.displayName).toHaveLength(120);
  });

  test("rejects identities without a usable email", async () => {
    await expect(
      sql`
        insert into auth.users (id, email)
        values (${randomUUID()}::uuid, '   ')
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  test("blocks duplicate emails across different identities", async () => {
    const sharedSeed = randomUUID().slice(0, 8);
    const firstId = await insertAuthIdentity({
      email: `dupe-${sharedSeed}@example.com`,
    });

    await expect(
      insertAuthIdentity({ email: `dupe-${sharedSeed}@example.com` }),
    ).rejects.toMatchObject({ code: "23505" });

    const rows = (await sql`
      select count(*) as user_count
      from public.users
      where email = ${`dupe-${sharedSeed}@example.com`}
    `) as { user_count: number | string }[];

    expect(Number(rows[0]?.user_count)).toBe(1);
    void firstId;
  });

  test("synchronizes email changes back onto the application user", async () => {
    const id = await insertAuthIdentity();
    const nextEmail = `renamed-${id.slice(0, 8)}@example.com`;

    await sql`
      update auth.users
      set email = ${nextEmail}
      where id = ${id}::uuid
    `;

    const user = await fetchPublicUser(id);

    expect(user?.email).toBe(nextEmail);
  });

  test("synchronizes display-name changes from refreshed metadata", async () => {
    const id = await insertAuthIdentity();

    await sql`
      update auth.users
      set raw_user_meta_data = jsonb_build_object('display_name', 'Grace Hopper')
      where id = ${id}::uuid
    `;

    const user = await fetchPublicUser(id);

    expect(user?.displayName).toBe("Grace Hopper");
  });

  test("provisions restricted invokers through definer rights alone", async () => {
    await sql.unsafe(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'identity_sync_invoker') then
          create role identity_sync_invoker nologin;
        end if;
      end
      $$;
    `);

    await sql.unsafe("grant usage on schema auth to identity_sync_invoker");
    await sql.unsafe(
      "grant select, insert, update, delete on auth.users to identity_sync_invoker",
    );

    const privilegeRows = (await sql`
      select has_table_privilege(
        'identity_sync_invoker', 'public.users', 'insert'
      ) as can_insert_public_users
    `) as { can_insert_public_users: boolean }[];

    expect(privilegeRows[0]?.can_insert_public_users).toBe(false);

    const id = randomUUID();

    try {
      await sql.unsafe("set role identity_sync_invoker");
      await sql`
        insert into auth.users (id, email, raw_user_meta_data)
        values (${id}::uuid, ${emailFor(id.slice(0, 8))}, '{}'::jsonb)
      `;
    } finally {
      await sql.unsafe("reset role");
    }

    const user = await fetchPublicUser(id);

    expect(user).toBeDefined();
  });

  test("is security definer with an empty search path and no public execute", async () => {
    const rows = (await sql`
      select prosecdef, proconfig,
        has_function_privilege(
          'public',
          'public.sync_auth_user_to_public_users()',
          'execute'
        ) as public_can_execute
      from pg_proc
      where proname = 'sync_auth_user_to_public_users'
        and pronamespace = 'public'::regnamespace
    `) as {
      prosecdef: boolean;
      proconfig: string[] | null;
      public_can_execute: boolean;
    }[];

    const proc = rows[0];

    expect(proc?.prosecdef).toBe(true);

    const proconfig = proc?.proconfig ?? [];

    expect(proconfig.join(",")).toContain('search_path=""');
    expect(proc?.public_can_execute).toBe(false);
  });
});
