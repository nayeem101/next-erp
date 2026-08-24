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

import type { SetUserRolesResult } from "./schemas";
import type postgres from "postgres";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

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
  // Role administration asserts global invariants (sole active Admin,
  // audit trail), so this suite starts from an empty identity universe.
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

async function loadService() {
  vi.resetModules();

  return import("./service");
}

async function loadActionsWithCaller(callerId: string) {
  vi.resetModules();

  const { setUserRolesAction } = await import("./actions");
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

  return setUserRolesAction;
}

async function rolesOf(userId: string): Promise<string[]> {
  const rows = (await sql`
    select r.key
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = ${userId}::uuid
    order by r.key
  `) as { key: string }[];

  return rows.map((row) => row.key);
}

async function auditRowsFor(entityId: string) {
  return (await sql`
    select action, actor_user_id as "actorUserId", metadata
    from public.audit_log
    where entity_id = ${entityId}::uuid and action like 'user.%'
    order by created_at asc
  `) as {
    action: string;
    actorUserId: string | null;
    metadata: Record<string, unknown>;
  }[];
}

d("setUserRoles service", () => {
  test("replaces memberships, stamps assigned_by, and audits before/after", async () => {
    const actor = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: ["sales"] });

    const { setUserRoles } = await loadService();
    const result = await setUserRoles(
      {
        userId: target.id,
        roles: ["inventory", "admin"],
      },
      actor.id,
      randomUUID(),
    );

    expect(result).toEqual({
      userId: target.id,
      roles: ["admin", "inventory"],
    });
    expect(await rolesOf(target.id)).toEqual(["admin", "inventory"]);

    const assignedBy = (await sql`
      select distinct assigned_by from public.user_roles
      where user_id = ${target.id}::uuid
    `) as { assigned_by: string }[];

    expect(assignedBy.map((row) => row.assigned_by)).toEqual([actor.id]);

    const events = await auditRowsFor(target.id);

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("user.roles_changed");
    expect(events[0]?.actorUserId).toBe(actor.id);
    expect(events[0]?.metadata.before).toEqual({ roles: ["sales"] });
    expect(events[0]?.metadata.after).toEqual({
      roles: ["admin", "inventory"],
    });
  });

  test("returns NOT_FOUND for an unknown user", async () => {
    const actor = await seedUser({ roles: ["admin"] });
    const { setUserRoles } = await loadService();

    await expect(
      setUserRoles(
        { userId: randomUUID(), roles: ["sales"] },
        actor.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("rejects demoting the last active Admin with LAST_ADMIN", async () => {
    const soleAdmin = await seedUser({ roles: ["admin"] });

    const { setUserRoles } = await loadService();

    await expect(
      setUserRoles(
        { userId: soleAdmin.id, roles: ["sales"] },
        soleAdmin.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });

    // Rejected writes must leave memberships untouched.
    expect(await rolesOf(soleAdmin.id)).toEqual(["admin"]);
  });

  test("ignores inactive Admins when counting remaining administrators", async () => {
    // The only other Admin is disabled, so demoting the target would leave
    // zero ACTIVE administrators and must be rejected.
    const inactiveAdmin = await seedUser({
      roles: ["admin"],
      isActive: false,
    });
    const target = await seedUser({ roles: ["admin", "sales"] });

    const { setUserRoles } = await loadService();

    await expect(
      setUserRoles(
        { userId: target.id, roles: ["sales"] },
        inactiveAdmin.id,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
  });

  test("allows the change once another active Admin exists", async () => {
    const firstAdmin = await seedUser({ roles: ["admin"] });
    const secondAdmin = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: ["admin", "sales"] });

    const { setUserRoles } = await loadService();

    const result = await setUserRoles(
      { userId: target.id, roles: ["sales"] },
      secondAdmin.id,
      randomUUID(),
    );

    expect(result.roles).toEqual(["sales"]);
    expect(await rolesOf(firstAdmin.id)).toEqual(["admin"]);
  });

  test("serializes concurrent demotions so one active Admin always survives", async () => {
    const adminA = await seedUser({ roles: ["admin"] });
    const adminB = await seedUser({ roles: ["admin"] });

    const { setUserRoles } = await loadService();

    const outcomes = await Promise.allSettled([
      setUserRoles(
        { userId: adminA.id, roles: ["sales"] },
        adminB.id,
        randomUUID(),
      ),
      setUserRoles(
        { userId: adminB.id, roles: ["sales"] },
        adminA.id,
        randomUUID(),
      ),
    ]);

    const fulfilled = outcomes.filter(
      (outcome): outcome is PromiseFulfilledResult<SetUserRolesResult> =>
        outcome.status === "fulfilled",
    );
    const rejectedLastAdmin = outcomes.filter(
      (outcome) =>
        outcome.status === "rejected" &&
        (outcome.reason as { code?: string }).code === "LAST_ADMIN",
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejectedLastAdmin).toHaveLength(1);

    const remainingAdmins = (await sql`
      select count(*)::int as count
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.users u on u.id = ur.user_id
      where r.key = 'admin' and u.is_active
    `) as { count: number }[];

    expect(remainingAdmins[0]?.count).toBe(1);
  });
});

describe("setUserRolesAction authorization", () => {
  test("rejects non-Admin callers with FORBIDDEN without mutating state", async () => {
    const outsider = await seedUser({ roles: ["sales"] });
    const target = await seedUser({ roles: ["sales"] });

    const action = await loadActionsWithCaller(outsider.id);
    const result = await action({ userId: target.id, roles: ["admin"] });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    expect(await rolesOf(target.id)).toEqual(["sales"]);
  });

  test("performs the role change for Admin callers", async () => {
    const admin = await seedUser({ roles: ["admin"] });
    const target = await seedUser({ roles: [] });

    const action = await loadActionsWithCaller(admin.id);
    const result = await action({ userId: target.id, roles: ["inventory"] });

    expect(result.ok).toBe(true);
    expect(await rolesOf(target.id)).toEqual(["inventory"]);
  });
});
