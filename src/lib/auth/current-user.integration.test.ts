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

import type { CurrentUserResult } from "@/lib/auth/current-user";
import {
  destroyTestDatabase,
  initializeTestDatabase,
} from "@/test/factories/db";
import { assignRole, createAuthUser } from "@/test/factories/factories";

import type postgres from "postgres";

const mocks = vi.hoisted(() => ({
  getUserResult: {
    data: { user: null as { id: string } | null },
    error: null as { message: string } | null,
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: () => Promise.resolve(mocks.getUserResult),
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

async function loadCurrentUser(): Promise<CurrentUserResult> {
  const { getCurrentUser } = await import("@/lib/auth/current-user");

  return getCurrentUser();
}

d("getCurrentUser", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(serverEnv)) {
      process.env[key] = value;
    }
    mocks.getUserResult = {
      data: { user: null },
      error: null,
    };
  });

  afterEach(async () => {
    await destroyTestDatabase();
    sql = await initializeTestDatabase();

    for (const key of Object.keys(serverEnv)) {
      Reflect.deleteProperty(process.env, key);
    }
  });

  test("reports unauthenticated without a session", async () => {
    const result = await loadCurrentUser();

    expect(result).toEqual({ status: "unauthenticated" });
  });

  test("reports unauthenticated when Auth verification fails", async () => {
    mocks.getUserResult = {
      data: { user: null },
      error: { message: "expired" },
    };

    const result = await loadCurrentUser();

    expect(result).toEqual({ status: "unauthenticated" });
  });

  test("reports unprovisioned when the identity has no application user", async () => {
    const authUser = await createAuthUser();

    // Simulate an identity provisioned before the sync trigger existed.
    await sql`delete from public.users where id = ${authUser.id}::uuid`;

    mocks.getUserResult = { data: { user: { id: authUser.id } }, error: null };

    const result = await loadCurrentUser();

    expect(result).toEqual({
      status: "unprovisioned",
      authUserId: authUser.id,
    });
  });

  test("reports inactive for disabled users", async () => {
    const authUser = await createAuthUser();

    await sql`
      update public.users set is_active = false where id = ${authUser.id}::uuid
    `;

    mocks.getUserResult = { data: { user: { id: authUser.id } }, error: null };

    const result = await loadCurrentUser();

    expect(result).toEqual({ status: "inactive" });
  });

  test("returns the verified profile with sorted unique roles", async () => {
    const admin = await createAuthUser({ displayName: "Ada Admin" });

    await assignRole(admin.id, "sales");
    await assignRole(admin.id, "admin");
    await assignRole(admin.id, "inventory");
    await assignRole(admin.id, "sales");

    mocks.getUserResult = { data: { user: { id: admin.id } }, error: null };

    const result = await loadCurrentUser();

    expect(result.status).toBe("authenticated");

    if (result.status === "authenticated") {
      expect(result.user.id).toBe(admin.id);
      expect(result.user.email).toBe(admin.email);
      expect(result.user.displayName).toBe("Ada Admin");
      // role_key sorts by enum declaration order in PostgreSQL.
      expect(result.user.roles).toEqual(["admin", "sales", "inventory"]);
    }
  });

  test("returns no roles until an admin grants membership", async () => {
    const memberless = await createAuthUser();

    mocks.getUserResult = {
      data: { user: { id: memberless.id } },
      error: null,
    };

    const result = await loadCurrentUser();

    expect(result.status).toBe("authenticated");

    if (result.status === "authenticated") {
      expect(result.user.roles).toEqual([]);
    }
  });
});
