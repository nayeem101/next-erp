/** @vitest-environment node */
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
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        signInWithPassword: mocks.signInWithPassword,
        signOut: mocks.signOut,
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

function givenSupabaseSignIn(
  userId: string | null,
  errorMessage?: string,
): void {
  mocks.signInWithPassword.mockReset();
  mocks.signInWithPassword.mockResolvedValue({
    data:
      userId === null
        ? { user: null }
        : { user: { id: userId, email: "ada@example.com" } },
    error: errorMessage ? { message: errorMessage, status: 400 } : null,
  });

  mocks.signOut.mockReset();
  mocks.signOut.mockResolvedValue({ error: null });
}

interface SignInActionResult {
  ok: boolean;
  error?: undefined | { code: string; message: string };
  data?: { redirectTo: string };
}

async function runSignIn(input: {
  email: string;
  password: string;
  next?: string;
}): Promise<SignInActionResult> {
  const { signIn } = await import("@/features/auth/actions");

  return signIn(input);
}

d("signIn action", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(serverEnv)) {
      process.env[key] = value;
    }

    givenSupabaseSignIn(null);
  });

  afterEach(async () => {
    await destroyTestDatabase();
    sql = await initializeTestDatabase();

    for (const key of Object.keys(serverEnv)) {
      Reflect.deleteProperty(process.env, key);
    }
  });

  test("returns the sanitized redirect target on success", async () => {
    const user = await createAuthUser({ displayName: "Ada Admin" });
    await assignRole(user.id, "admin");
    givenSupabaseSignIn(user.id);

    const result = await runSignIn({
      email: user.email,
      password: "correct horse battery",
    });

    expect(result).toEqual({ ok: true, data: { redirectTo: "/dashboard" } });
  });

  test("keeps a safe caller-supplied next path", async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "sales");
    givenSupabaseSignIn(user.id);

    const result = await runSignIn({
      email: user.email,
      password: "correct horse battery",
      next: "/inventory/products?page=2",
    });

    expect(result).toEqual({
      ok: true,
      data: { redirectTo: "/inventory/products?page=2" },
    });
  });

  test("stamps last_signed_in_at and writes the auth.signed_in audit event", async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "inventory");
    givenSupabaseSignIn(user.id);

    await runSignIn({ email: user.email, password: "correct horse battery" });

    const profileRows = (await sql`
      select last_signed_in_at as "lastSignedInAt"
      from public.users where id = ${user.id}::uuid
    `) as { lastSignedInAt: Date | null }[];

    expect(profileRows[0]?.lastSignedInAt).not.toBeNull();

    const auditRows = (await sql`
      select action, actor_user_id as "actorUserId", entity_type as "entityType"
      from public.audit_log
      where actor_user_id = ${user.id}::uuid
    `) as {
      action: string;
      actorUserId: string;
      entityType: string;
    }[];

    expect(auditRows[0]).toMatchObject({
      action: "auth.signed_in",
      actorUserId: user.id,
      entityType: "user",
    });
  });

  test("maps invalid credentials to a generic UNAUTHENTICATED failure", async () => {
    givenSupabaseSignIn(null, "Invalid login credentials");

    const result = await runSignIn({
      email: "nobody@example.com",
      password: "wrong-password-123",
    });

    expect(result.ok).toBe(false);

    if (!result.ok && result.error) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
      expect(result.error.message).toBe(
        "Incorrect email or password. Please try again.",
      );
      // Supabase's raw message must never leak.
      expect(result.error.message).not.toContain("Invalid login credentials");
    }

    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  test("rejects and signs out disabled accounts", async () => {
    const user = await createAuthUser();
    await assignRole(user.id, "admin");
    await sql`update public.users set is_active = false where id = ${user.id}::uuid`;
    givenSupabaseSignIn(user.id);

    const result = await runSignIn({
      email: user.email,
      password: "correct horse battery",
    });

    expect(result.ok).toBe(false);

    if (!result.ok && result.error) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  test("rejects and signs out identities without any role", async () => {
    const roleless = await createAuthUser();
    givenSupabaseSignIn(roleless.id);

    const result = await runSignIn({
      email: roleless.email,
      password: "correct horse battery",
    });

    expect(result.ok).toBe(false);

    if (!result.ok && result.error) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  test("rejects and signs out unprovisioned identities", async () => {
    const ghost = await createAuthUser();

    // Identity exists in Auth but the application row was removed.
    await sql`delete from public.users where id = ${ghost.id}::uuid`;
    givenSupabaseSignIn(ghost.id);

    const result = await runSignIn({
      email: ghost.email,
      password: "correct horse battery",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  test("validation failures never reach Supabase", async () => {
    const result = await runSignIn({
      email: "not-an-email",
      password: "short",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});
