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

import type postgres from "postgres";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: {
        getUser: mocks.getUser,
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

beforeEach(() => {
  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }

  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

afterEach(async () => {
  // Recreate the connection so React's cache() cannot leak identity state
  // between tests.
  await destroyTestDatabase();
  sql = await initializeTestDatabase();

  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }
});

/**
 * Every scenario tags its fixtures with a unique token embedded in the email
 * so searches scope the universe without truncating shared tables that other
 * integration suites may be reading concurrently. Tokens rotate per test to
 * keep reseeding collision-free against persisted rows from earlier tests.
 */
function uniqueToken(): string {
  return randomUUID().replaceAll("-", "").slice(0, 12);
}

interface SeededUser {
  email: string;
  id: string;
}

async function seedUser(input: {
  displayName: string;
  slug: string;
  token?: string;
  isActive?: boolean;
  roles?: ("admin" | "sales" | "inventory")[];
}): Promise<SeededUser> {
  const scope = input.token ?? uniqueToken();
  const email = `${input.slug}.${scope}@example.com`;
  const user = await createAuthUser({
    displayName: input.displayName,
    email,
  });

  if (input.isActive === false) {
    await sql`
      update public.users set is_active = false where id = ${user.id}::uuid
    `;
  }

  for (const role of input.roles ?? []) {
    await assignRole(user.id, role);
  }

  return { email, id: user.id };
}

async function listViaAction(
  callerId: string | null,
  input: Record<string, unknown>,
) {
  // Fresh module graph per call so getCurrentUser's request cache never
  // memoizes one caller's identity into the next test.
  vi.resetModules();

  const { listUsersAction } = await import("./actions");

  if (callerId === null) {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  } else {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: callerId } },
      error: null,
    });
  }

  return listUsersAction(input as never);
}

d("listUsers query", () => {
  let scope = "";
  let ada: SeededUser;
  let bob: SeededUser;
  let ivy: SeededUser;
  let sam: SeededUser;
  let zed: SeededUser;

  beforeEach(async () => {
    scope = uniqueToken();
    ada = await seedUser({
      displayName: `Ada Admin ${scope}`,
      slug: "ada.admin",
      token: scope,
      roles: ["admin"],
    });
    bob = await seedUser({
      displayName: `Bob Admin ${scope}`,
      slug: "bob.admin",
      token: scope,
      roles: ["admin", "sales"],
    });
    ivy = await seedUser({
      displayName: `Ivy Inventory ${scope}`,
      slug: "ivy.inventory",
      token: scope,
      roles: ["inventory"],
    });
    sam = await seedUser({
      displayName: `Sam Sales ${scope}`,
      slug: "sam.sales",
      token: scope,
      isActive: false,
      roles: ["sales"],
    });
    zed = await seedUser({
      displayName: `Zed NoRoles ${scope}`,
      slug: "zed.noroles",
      token: scope,
    });
  });

  test("returns the scoped directory sorted by case-insensitive email", async () => {
    const result = await listViaAction(ada.id, { search: scope });

    if (!result.ok) {
      throw new Error(`expected success, got ${result.error.code}`);
    }

    expect(result.data.total).toBe(5);
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(20);
    expect(result.data.totalPages).toBe(1);
    expect(result.data.rows.map((row) => row.email)).toEqual([
      ada.email,
      bob.email,
      ivy.email,
      sam.email,
      zed.email,
    ]);
  });

  test("groups roles in canonical order and flags roleless users", async () => {
    const result = await listViaAction(ada.id, { search: scope });

    if (!result.ok) {
      throw new Error(`expected success, got ${result.error.code}`);
    }

    const byEmail = new Map(result.data.rows.map((row) => [row.email, row]));

    expect(byEmail.get(bob.email)?.roles).toEqual(["admin", "sales"]);
    expect(byEmail.get(ada.email)?.roles).toEqual(["admin"]);
    expect(byEmail.get(zed.email)?.roles).toEqual([]);
    expect(byEmail.get(sam.email)?.isActive).toBe(false);
    expect(byEmail.get(ada.email)?.lastSignedInAt).toBeNull();
    expect(byEmail.get(ada.email)?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("filters by search across email and display name case-insensitively", async () => {
    const byEmailFragment = await listViaAction(ada.id, {
      search: `BOB.ADMIN.${scope.toUpperCase()}`,
    });

    if (!byEmailFragment.ok) {
      throw new Error(`expected success, got ${byEmailFragment.error.code}`);
    }

    expect(byEmailFragment.data.rows.map((row) => row.email)).toEqual([
      bob.email,
    ]);

    const byName = await listViaAction(ada.id, {
      search: `Ivy Inventory ${scope}`,
    });

    if (!byName.ok) {
      throw new Error(`expected success, got ${byName.error.code}`);
    }

    expect(byName.data.rows.map((row) => row.email)).toEqual([ivy.email]);
  });

  test("treats LIKE metacharacters literally", async () => {
    const percent = await seedUser({
      displayName: `Fifty Percent Off ${scope}`,
      slug: "fifty%off",
      token: scope,
    });

    const result = await listViaAction(ada.id, {
      search: `fifty%off.${scope}`,
    });

    if (!result.ok) {
      throw new Error(`expected success, got ${result.error.code}`);
    }

    expect(result.data.rows.map((row) => row.id)).toEqual([percent.id]);
  });

  test("filters by role, status, and their combination", async () => {
    const sales = await listViaAction(ada.id, { role: "sales", search: scope });

    if (!sales.ok) {
      throw new Error(`expected success, got ${sales.error.code}`);
    }

    expect(sales.data.rows.map((row) => row.email)).toEqual([
      bob.email,
      sam.email,
    ]);

    const inactive = await listViaAction(ada.id, {
      status: "inactive",
      search: scope,
    });

    if (!inactive.ok) {
      throw new Error(`expected success, got ${inactive.error.code}`);
    }

    expect(inactive.data.rows.map((row) => row.email)).toEqual([sam.email]);

    const activeSales = await listViaAction(ada.id, {
      role: "sales",
      status: "active",
      search: scope,
    });

    if (!activeSales.ok) {
      throw new Error(`expected success, got ${activeSales.error.code}`);
    }

    expect(activeSales.data.rows.map((row) => row.email)).toEqual([bob.email]);
  });

  test("paginates deterministically within the filtered universe", async () => {
    // An extra fixture pushes the scoped universe to six rows so a pageSize
    // of five produces a meaningful second page.
    await seedUser({
      displayName: `Paul Procurement ${scope}`,
      slug: "paul.proc",
      token: scope,
    });

    const page1 = await listViaAction(ada.id, {
      pageSize: 5,
      search: scope,
    });

    if (!page1.ok) {
      throw new Error(`expected success, got ${page1.error.code}`);
    }

    expect(page1.data.total).toBe(6);
    expect(page1.data.totalPages).toBe(2);
    expect(page1.data.rows).toHaveLength(5);

    const page2 = await listViaAction(ada.id, {
      page: 2,
      pageSize: 5,
      search: scope,
    });

    if (!page2.ok) {
      throw new Error(`expected success, got ${page2.error.code}`);
    }

    expect(page2.data.rows.map((row) => row.email)).toEqual([zed.email]);

    const beyond = await listViaAction(ada.id, {
      page: 9,
      pageSize: 5,
      search: scope,
    });

    if (!beyond.ok) {
      throw new Error(`expected success, got ${beyond.error.code}`);
    }

    expect(beyond.data.rows).toEqual([]);
    expect(beyond.data.total).toBe(6);
  });

  test("returns an empty page when nothing matches", async () => {
    const result = await listViaAction(ada.id, {
      search: `nobody-at-all-${scope}`,
    });

    if (!result.ok) {
      throw new Error(`expected success, got ${result.error.code}`);
    }

    expect(result.data).toMatchObject({ rows: [], total: 0, totalPages: 1 });
  });
});

describe("listUsersAction authorization", () => {
  test("rejects unauthenticated callers", async () => {
    const result = await listViaAction(null, {});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  test("rejects non-Admin callers with FORBIDDEN", async () => {
    const authScope = uniqueToken();
    const sam = await seedUser({
      displayName: `Sam Sales ${authScope}`,
      slug: "sam.sales",
      roles: ["sales"],
    });

    const result = await listViaAction(sam.id, {});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  test("allows Admin callers", async () => {
    const authScope = uniqueToken();
    const admin = await seedUser({
      displayName: `Ada Admin ${authScope}`,
      slug: "ada.admin",
      roles: ["admin"],
    });

    const result = await listViaAction(admin.id, { pageSize: 5 });

    expect(result.ok).toBe(true);
  });

  test("validates input before authorization", async () => {
    const authScope = uniqueToken();
    const admin = await seedUser({
      displayName: `Ada Admin ${authScope}`,
      slug: "ada.admin",
      roles: ["admin"],
    });

    const result = await listViaAction(admin.id, { role: "root" });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
