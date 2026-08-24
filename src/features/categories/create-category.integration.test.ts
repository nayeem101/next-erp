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

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
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

beforeEach(async () => {
  await sql`
    truncate table public.audit_log, public.products, public.categories cascade
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

function token(): string {
  return randomUUID().replaceAll("-", "").slice(0, 10);
}

async function seedActor(
  roles: ("admin" | "sales" | "inventory")[],
): Promise<{ id: string }> {
  const user = await createAuthUser();

  for (const role of roles) {
    await assignRole(user.id, role);
  }

  return { id: user.id };
}

async function loadAction(callerId: string) {
  vi.resetModules();

  const { createCategoryAction } = await import("./actions");

  mocks.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  });

  return createCategoryAction;
}

d("createCategoryAction", () => {
  test("creates a category with derived slug, actor stamps, and audit event", async () => {
    const admin = await seedActor(["admin"]);
    const action = await loadAction(admin.id);

    const result = await action({
      name: `Power Tools ${token()}`,
      description: "Everything with a plug.",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    const rows = (await sql`
      select slug, description, is_active as "isActive",
             created_by as "createdBy", updated_by as "updatedBy"
      from public.categories where id = ${result.data.categoryId}::uuid
    `) as {
      slug: string;
      description: string | null;
      isActive: boolean;
      createdBy: string;
      updatedBy: string;
    }[];

    const row = rows[0];

    expect(row?.slug).toBe(result.data.slug);
    expect(row?.slug).toMatch(/^power-tools-/);
    expect(row?.description).toBe("Everything with a plug.");
    expect(row?.isActive).toBe(true);
    expect(row?.createdBy).toBe(admin.id);
    expect(row?.updatedBy).toBe(admin.id);

    const events = (await sql`
      select action, metadata from public.audit_log
      where entity_type = 'category' and entity_id = ${result.data.categoryId}::uuid
    `) as { action: string; metadata: Record<string, unknown> }[];

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("category.created");
    expect(events[0]?.metadata.after).toMatchObject({ slug: row?.slug });
  });

  test("rejects case-insensitive duplicate names with UNIQUE_CONFLICT", async () => {
    const admin = await seedActor(["admin"]);
    const action = await loadAction(admin.id);

    const first = await action({ name: `Garden ${token()}` });

    expect(first.ok).toBe(true);

    if (!first.ok) {
      throw new Error(first.error.code);
    }

    // Same words, different casing and padding -> normalized collision.
    const secondName = first.data.slug.replace(/-/g, " ").toUpperCase();

    const second = await action({ name: `  ${secondName} ` });

    expect(second.ok).toBe(false);

    if (!second.ok) {
      expect(second.error.code).toBe("UNIQUE_CONFLICT");
      expect(second.error.message).toMatch(/already exists/i);
    }
  });

  test("rejects distinct names whose slugs collide", async () => {
    const admin = await seedActor(["admin"]);
    const action = await loadAction(admin.id);

    const base = `Slug Test ${token()}`;

    const first = await action({ name: `${base}!` });
    const second = await action({ name: `${base}?` });

    expect(first.ok).toBe(true);

    // "X!" and "X?" strip to the same slug; the second must be rejected.
    expect(second.ok).toBe(false);

    if (!second.ok) {
      expect(second.error.code).toBe("UNIQUE_CONFLICT");
    }
  });

  test("rejects sales callers without touching the table", async () => {
    const seller = await seedActor(["sales"]);
    const action = await loadAction(seller.id);

    const before = (await sql`
      select count(*)::int as count from public.categories
    `) as { count: number }[];

    const result = await action({ name: `Forbidden ${token()}` });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const after = (await sql`
      select count(*)::int as count from public.categories
    `) as { count: number }[];

    expect(after[0]?.count).toBe(before[0]?.count);
  });

  test("allows inventory callers without admin", async () => {
    const stocker = await seedActor(["inventory"]);
    const action = await loadAction(stocker.id);

    const result = await action({ name: `Inventory Made ${token()}` });

    expect(result.ok).toBe(true);
  });

  test("validates strict input before authorization", async () => {
    const seller = await seedActor(["sales"]);
    const action = await loadAction(seller.id);

    const result = await action({
      name: "Whatever",
      surprise: true,
    } as never);

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
