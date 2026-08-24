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
import {
  assignRole,
  createAuthUser,
  createCategory,
  createProduct,
} from "@/test/factories/factories";

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

  const { setCategoryActiveAction } = await import("./actions");

  mocks.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  });

  return setCategoryActiveAction;
}

async function categoryState(id: string) {
  const rows = (await sql`
    select is_active as "isActive" from public.categories where id = ${id}::uuid
  `) as { isActive: boolean }[];

  return rows[0]?.isActive;
}

async function latestAudit(entityId: string) {
  const rows = (await sql`
    select action, metadata from public.audit_log
    where entity_id = ${entityId}::uuid and action like 'category.%'
    order by created_at desc limit 1
  `) as { action: string; metadata: Record<string, unknown> }[];

  return rows[0];
}

d("setCategoryActiveAction", () => {
  test("archives an empty category and audits category.archived", async () => {
    const admin = await seedActor(["admin"]);
    const category = await createCategory(admin.id, {});
    const action = await loadAction(admin.id);

    const result = await action({ categoryId: category.id, isActive: false });

    expect(result).toMatchObject({
      ok: true,
      data: { categoryId: category.id, isActive: false },
    });
    expect(await categoryState(category.id)).toBe(false);

    const event = await latestAudit(category.id);

    expect(event?.action).toBe("category.archived");
    expect(event?.metadata.before).toEqual({ isActive: true });
    expect(event?.metadata.after).toEqual({ isActive: false });
  });

  test("rejects archiving while active products belong to the category", async () => {
    const admin = await seedActor(["admin"]);
    const category = await createCategory(admin.id, {});

    await createProduct(admin.id, category.id, { sku: `SKU-${token()}` });

    const action = await loadAction(admin.id);
    const result = await action({ categoryId: category.id, isActive: false });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.message).toMatch(/active products/i);
    }

    expect(await categoryState(category.id)).toBe(true);

    // No audit event may be left behind by the rejected attempt.
    const events = (await sql`
      select count(*)::int as count from public.audit_log
      where entity_id = ${category.id}::uuid
    `) as { count: number }[];

    expect(events[0]?.count).toBe(0);
  });

  test("ignores archived products when deciding archivability", async () => {
    const admin = await seedActor(["admin"]);
    const category = await createCategory(admin.id, {});
    const product = await createProduct(admin.id, category.id, {
      sku: `SKU-${token()}`,
    });

    await sql`
      update public.products set is_active = false where id = ${product.id}::uuid
    `;

    const action = await loadAction(admin.id);
    const result = await action({ categoryId: category.id, isActive: false });

    expect(result.ok).toBe(true);
    expect(await categoryState(category.id)).toBe(false);
  });

  test("restores an archived category with category.restored audit", async () => {
    const admin = await seedActor(["admin"]);
    const category = await createCategory(admin.id, {});

    await sql`
      update public.categories set is_active = false where id = ${category.id}::uuid
    `;

    const action = await loadAction(admin.id);
    const result = await action({ categoryId: category.id, isActive: true });

    expect(result.ok).toBe(true);
    expect(await categoryState(category.id)).toBe(true);

    const event = await latestAudit(category.id);

    expect(event?.action).toBe("category.restored");
    expect(event?.metadata.before).toEqual({ isActive: false });
  });

  test("returns NOT_FOUND for an unknown category", async () => {
    const admin = await seedActor(["admin"]);
    const action = await loadAction(admin.id);

    const result = await action({
      categoryId: randomUUID(),
      isActive: false,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  test("rejects sales callers without mutating state or audit", async () => {
    const admin = await seedActor(["admin"]);
    const seller = await seedActor(["sales"]);
    const category = await createCategory(admin.id, {});

    const action = await loadAction(seller.id);
    const result = await action({ categoryId: category.id, isActive: false });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    expect(await categoryState(category.id)).toBe(true);

    const events = (await sql`
      select count(*)::int as count from public.audit_log
    `) as { count: number }[];

    expect(events[0]?.count).toBe(0);
  });
});
