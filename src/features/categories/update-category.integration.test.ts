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

  const { updateCategoryAction } = await import("./actions");

  mocks.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  });

  return updateCategoryAction;
}

async function latestAudit(entityId: string) {
  const rows = (await sql`
    select action, metadata from public.audit_log
    where entity_id = ${entityId}::uuid and action = 'category.updated'
    order by created_at desc limit 1
  `) as { action: string; metadata: Record<string, unknown> }[];

  return rows[0];
}

d("updateCategoryAction", () => {
  test("renames with derived slug, restamps actor, and audits the diff", async () => {
    const admin = await seedActor(["admin"]);
    const category = await createCategory(admin.id, {
      name: `Old Name ${token()}`,
      slug: `old-name-${token()}`,
    });

    const action = await loadAction(admin.id);
    const newName = `Renamed Category ${token()}`;

    const result = await action({
      categoryId: category.id,
      name: newName,
      description: "Fresh description.",
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    const rows = (await sql`
      select slug, description, updated_by as "updatedBy" from public.categories
      where id = ${category.id}::uuid
    `) as { slug: string; description: string; updatedBy: string }[];

    expect(rows[0]?.slug).toMatch(/^renamed-category-/);
    expect(rows[0]?.description).toBe("Fresh description.");
    expect(rows[0]?.updatedBy).toBe(admin.id);

    const event = await latestAudit(category.id);

    expect(event?.metadata.before).toEqual({
      name: category.name,
      slug: category.slug,
      description: null,
    });
    expect(event?.metadata.after).toMatchObject({
      name: newName,
      description: "Fresh description.",
    });
  });

  test("resyncs the derived slug when the stored slug drifted", async () => {
    const admin = await seedActor(["admin"]);
    // Factory slugs are arbitrary; slugify(name) differs by design here.
    const category = await createCategory(admin.id, {
      name: `Stable Name ${token()}`,
      slug: `arbitrary-${token()}`,
    });

    const action = await loadAction(admin.id);

    const result = await action({
      categoryId: category.id,
      name: category.name,
      description: undefined,
    });

    expect(result.ok).toBe(true);

    const rows = (await sql`
      select slug from public.categories where id = ${category.id}::uuid
    `) as { slug: string }[];

    // slugify(name) with the same 10-char token suffix.
    expect(rows[0]?.slug).toBe(
      `stable-name-${category.name.slice(-10).toLowerCase()}`,
    );
  });

  test("returns NOT_FOUND for an unknown category", async () => {
    const admin = await seedActor(["admin"]);
    const action = await loadAction(admin.id);

    const result = await action({
      categoryId: randomUUID(),
      name: `Ghost ${token()}`,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  test("rejects renaming into another category's normalized name", async () => {
    const admin = await seedActor(["admin"]);
    const first = await createCategory(admin.id, {
      name: `Alpha ${token()}`,
      slug: `alpha-${token()}`,
    });
    const second = await createCategory(admin.id, {
      name: `Beta ${token()}`,
      slug: `beta-${token()}`,
    });

    const action = await loadAction(admin.id);

    const result = await action({
      categoryId: second.id,
      name: first.name.toLowerCase(),
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("UNIQUE_CONFLICT");
    }
  });

  test("allows re-submitting the category's own current name", async () => {
    const admin = await seedActor(["admin"]);
    const category = await createCategory(admin.id, {
      name: `Self Keep ${token()}`,
      slug: `self-keep-${token()}`,
    });

    const action = await loadAction(admin.id);

    const result = await action({
      categoryId: category.id,
      name: category.name.toUpperCase(),
    });

    expect(result.ok).toBe(true);
  });

  test("rejects sales callers without mutating", async () => {
    const admin = await seedActor(["admin"]);
    const seller = await seedActor(["sales"]);
    const category = await createCategory(admin.id, {
      name: `Locked ${token()}`,
      slug: `locked-${token()}`,
    });

    const action = await loadAction(seller.id);

    const result = await action({
      categoryId: category.id,
      name: `Hacked ${token()}`,
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }

    const rows = (await sql`
      select name from public.categories where id = ${category.id}::uuid
    `) as { name: string }[];

    expect(rows[0]?.name).toBe(category.name);
  });
});
