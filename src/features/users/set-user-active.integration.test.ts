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

import type { SetUserActiveResult } from "./schemas";
import type postgres from "postgres";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({ data: { user: null }, error: null }),
        ),
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
  // Shares the global-invariant character of the role suite, so it starts
  // from the same empty identity universe.
  await sql`
    truncate table
      public.audit_log,
      public.user_roles,
      public.users,
      auth.users
    cascade
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

function uniqueToken(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

async function seedUser(input: {
  roles?: ("admin" | "sales" | "inventory")[];
  isActive?: boolean;
}): Promise<{ id: string; email: string }> {
  const scope = uniqueToken();
  const user = await createAuthUser({
    displayName: `User ${scope}`,
    email: `${input.roles?.join("-") ?? "plain"}.${scope}@example.com`,
  });

  if (input.isActive === false) {
    await sql`
      update public.users set is_active = false where id = ${user.id}::uuid
    `;
  }

  for (const role of input.roles ?? []) {
    await assignRole(user.id, role);
  }

  return { id: user.id, email: user.email };
}

async function isActive(userId: string): Promise<boolean> {
  const rows = (await sql`
    select is_active from public.users where id = ${userId}::uuid
  `) as { is_active: boolean }[];

  return rows[0]?.is_active === true;
}

async function loadService() {
  vi.resetModules();

  return import("./service");
}

async function loadActionWithCaller(callerId: string) {
  vi.resetModules();

  const { setUserActiveAction } = await import("./actions");
  const supabaseServer = await import("@/lib/supabase/server");

  vi.mocked(supabaseServer.createClient).mockImplementation(
    () =>
      Promise.resolve({
        auth: {
          getUser: () =>
            Promise.resolve({
              data: { user: { id: callerId } },
              error: null,
            }),
        },
      }) as never,
  );

  return setUserActiveAction;
}

async function latestAuditFor(entityId: string) {
  const rows = (await sql`
    select action, actor_user_id as "actorUserId", metadata
    from public.audit_log
    where entity_id = ${entityId}::uuid and action like 'user.%'
    order by created_at desc
    limit 1
  `) as {
    action: string;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
  }[];

  return rows[0];
}

d("setUserActive service", () => {
  test("disables a user and audits user.disabled with before/after", async () => {
    const actor = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: ["sales"] });

    const { setUserActive } = await loadService();
    const result = await setUserActive(
      { userId: target.id, isActive: false },
      actor.id,
      randomUUID(),
    );

    expect(result).toEqual({ userId: target.id, isActive: false });
    expect(await isActive(target.id)).toBe(false);

    const event = await latestAuditFor(target.id);

    expect(event?.action).toBe("user.disabled");
    expect(event?.actorUserId).toBe(actor.id);
    expect(event?.metadata.before).toEqual({ isActive: true });
    expect(event?.metadata.after).toEqual({ isActive: false });
  });

  test("re-enables a disabled user and audits user.enabled", async () => {
    const actor = await seedUser({ roles: ["admin"] });
    const target = await seedUser({
      roles: ["inventory"],
      isActive: false,
    });

    const { setUserActive } = await loadService();
    const result = await setUserActive(
      { userId: target.id, isActive: true },
      actor.id,
      randomUUID(),
    );

    expect(result.isActive).toBe(true);
    expect(await isActive(target.id)).toBe(true);

    const event = await latestAuditFor(target.id);

    expect(event?.action).toBe("user.enabled");
    expect(event?.metadata.before).toEqual({ isActive: false });
    expect(event?.metadata.after).toEqual({ isActive: true });
  });

  test("returns NOT_FOUND for an unknown user", async () => {
    const actor = await seedUser({ roles: ["admin"] });
    const { setUserActive } = await loadService();

    await expect(
      setUserActive(
        { userId: randomUUID(), isActive: false },
        actor.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("rejects disabling the last active Admin with LAST_ADMIN", async () => {
    const soleAdmin = await seedUser({ roles: ["admin"] });

    const { setUserActive } = await loadService();

    await expect(
      setUserActive(
        { userId: soleAdmin.id, isActive: false },
        soleAdmin.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });

    expect(await isActive(soleAdmin.id)).toBe(true);

    // The rejected attempt must not leave an audit event behind.
    const rows = (await sql`
      select count(*)::int as count from public.audit_log
      where entity_id = ${soleAdmin.id}::uuid
    `) as { count: number }[];

    expect(rows[0]?.count).toBe(0);
  });

  test("counts only active Admins as survivors", async () => {
    const inactiveAdmin = await seedUser({
      roles: ["admin"],
      isActive: false,
    });
    const lastActiveAdmin = await seedUser({ roles: ["admin"] });

    const { setUserActive } = await loadService();

    await expect(
      setUserActive(
        { userId: lastActiveAdmin.id, isActive: false },
        inactiveAdmin.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  test("allows disabling an Admin when another active Admin remains", async () => {
    const otherAdmin = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: ["admin"] });

    const { setUserActive } = await loadService();
    const result = await setUserActive(
      { userId: target.id, isActive: false },
      otherAdmin.id,
      randomUUID(),
    );

    expect(result.isActive).toBe(false);
    expect(await isActive(target.id)).toBe(false);
  });

  test("allows disabling non-Admin users regardless of admin counts", async () => {
    const admin = await seedUser({ roles: ["admin"] });
    const sales = await seedUser({ roles: ["sales"] });

    const { setUserActive } = await loadService();

    await setUserActive(
      { userId: sales.id, isActive: false },
      admin.id,
      randomUUID(),
    );

    expect(await isActive(sales.id)).toBe(false);
  });
});

describe("setUserActiveAction authorization", () => {
  test("rejects non-Admin callers with FORBIDDEN without mutating state", async () => {
    const sales = await seedUser({ roles: ["sales"] });
    const target = await seedUser({ roles: ["inventory"] });

    const action = await loadActionWithCaller(sales.id);
    const result = await action({ userId: target.id, isActive: false });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    expect(await isActive(target.id)).toBe(true);
  });

  test("performs the change for Admin callers", async () => {
    const admin = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: ["sales"] });

    const action = await loadActionWithCaller(admin.id);
    const result = await action({ userId: target.id, isActive: false });

    expect(result.ok).toBe(true);

    if (result.ok) {
      const data: SetUserActiveResult = result.data;

      expect(data.isActive).toBe(false);
    }
  });

  test("validates strict input before authorization", async () => {
    const admin = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: ["sales"] });

    const action = await loadActionWithCaller(admin.id);
    const result = await action({
      userId: target.id,
      isActive: false,
      extra: true,
    } as never);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
