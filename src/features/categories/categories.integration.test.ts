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
  // Serialized integration files make a clean universe per test both safe
  // and the simplest way to assert totals and ordering.
  await sql`
    truncate table public.audit_log, public.products, public.categories cascade
  `;

  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  // Identity isolation comes from vi.resetModules() inside each action
  // import; no connection churn (it re-runs bootstrap.sql mid-suite).
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

interface Seeded {
  id: string;
  name: string;
}

async function seedCategory(input: {
  actorId: string;
  namePrefix: string;
  isActive?: boolean;
}): Promise<Seeded> {
  const scope = token();
  const record = await createCategory(input.actorId, {
    name: `${input.namePrefix} ${scope}`,
    slug: `${input.namePrefix.toLowerCase()}-${scope}`,
  });

  if (input.isActive === false) {
    await sql`
      update public.categories set is_active = false where id = ${record.id}::uuid
    `;
  }

  return { id: record.id, name: record.name };
}

d("listCategories query", () => {
  let actor: { id: string };
  let alpha: Seeded;
  let beta: Seeded;
  let gamma: Seeded;
  let archived: Seeded;

  beforeEach(async () => {
    actor = await seedActor(["admin"]);
    // Name prefixes force a deterministic sort independent of insert order.
    alpha = await seedCategory({ actorId: actor.id, namePrefix: "Aa Tools" });
    beta = await seedCategory({
      actorId: actor.id,
      namePrefix: "Bb Fasteners",
    });
    gamma = await seedCategory({
      actorId: actor.id,
      namePrefix: "Cc Electrical",
    });
    archived = await seedCategory({
      actorId: actor.id,
      namePrefix: "Dd Legacy",
      isActive: false,
    });

    // Product counts: alpha=2 active +1 archived, beta=0, gamma=1.
    const mkProduct = async (
      categoryId: string,
      skuSuffix: string,
      productActive: boolean,
    ) => {
      const product = await createProduct(actor.id, categoryId, {
        sku: `SKU-${token()}-${skuSuffix}`,
      });

      if (!productActive) {
        await sql`
          update public.products set is_active = false where id = ${product.id}::uuid
        `;
      }
    };

    await mkProduct(alpha.id, "a", true);
    await mkProduct(alpha.id, "b", true);
    await mkProduct(alpha.id, "c", false);
    await mkProduct(gamma.id, "g", true);
  });

  test("defaults to active-only sorted by case-insensitive name with counts", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const result = await listCategoriesAction({});

    if (!result.ok) {
      throw new Error(`expected success, got ${result.error.code}`);
    }

    expect(result.data.total).toBe(3);
    expect(result.data.rows.map((row) => row.name)).toEqual([
      alpha.name,
      beta.name,
      gamma.name,
    ]);
    expect(
      result.data.rows.find((row) => row.id === alpha.id)?.activeProductCount,
    ).toBe(2);
    expect(
      result.data.rows.find((row) => row.id === beta.id)?.activeProductCount,
    ).toBe(0);
    expect(result.data.rows.every((row) => row.isActive)).toBe(true);
  });

  test("archived and all filters change the visible universe", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const archivedOnly = await listCategoriesAction({ status: "archived" });

    if (!archivedOnly.ok) {
      throw new Error(archivedOnly.error.code);
    }

    expect(archivedOnly.data.rows.map((row) => row.id)).toEqual([archived.id]);

    const all = await listCategoriesAction({ status: "all" });

    if (!all.ok) {
      throw new Error(all.error.code);
    }

    expect(all.data.total).toBe(4);
    expect(all.data.rows.map((row) => row.id)).toEqual([
      alpha.id,
      beta.id,
      gamma.id,
      archived.id,
    ]);
  });

  test("search filters by escaped case-insensitive name fragment", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const byFragment = await listCategoriesAction({
      search: `FASTENERS`,
      status: "all",
    });

    if (!byFragment.ok) {
      throw new Error(byFragment.error.code);
    }

    expect(byFragment.data.rows.map((row) => row.id)).toEqual([beta.id]);
  });

  test("sorts by name_desc", async () => {
    const sort = "name_desc" as const;
    const expectedKeys = ["gamma", "beta", "alpha"] as const;
    const { listCategoriesAction } = await import("./actions");
    const byId = new Map([
      ["alpha", alpha],
      ["beta", beta],
      ["gamma", gamma],
    ]);

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const result = await listCategoriesAction({ sort, status: "active" });

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.data.rows.map((row) => row.id)).toEqual(
      expectedKeys.map((key) => byId.get(key)?.id),
    );
  });

  test("most_products ranks by active count then name", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const result = await listCategoriesAction({
      sort: "most_products",
      status: "active",
    });

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.data.rows.map((row) => row.activeProductCount)).toEqual([
      2, 1, 0,
    ]);
  });

  test("paginates deterministically", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const page1 = await listCategoriesAction({
      status: "all",
      pageSize: 5,
    });

    const page2 = await listCategoriesAction({
      status: "all",
      page: 2,
      pageSize: 5,
    });

    if (!page1.ok || !page2.ok) {
      throw new Error("pagination setup failed");
    }

    expect(page1.data.total).toBe(4);
    expect(page1.data.totalPages).toBe(1);

    // A second seeded page beyond the first proves offset behavior.
    await seedCategory({
      actorId: actor.id,
      namePrefix: "Ee Extra",
    });
    const extra2 = await seedCategory({
      actorId: actor.id,
      namePrefix: "Ff Extra",
    });
    const extra3 = await seedCategory({
      actorId: actor.id,
      namePrefix: "Gg Extra",
    });

    const shiftedPage1 = await listCategoriesAction({
      status: "all",
      pageSize: 5,
    });

    if (!shiftedPage1.ok) {
      throw new Error(shiftedPage1.error.code);
    }

    expect(shiftedPage1.data.totalPages).toBe(2);
    expect(shiftedPage1.data.rows).toHaveLength(5);

    const last = await listCategoriesAction({
      status: "all",
      page: 2,
      pageSize: 5,
    });

    if (!last.ok) {
      throw new Error(last.error.code);
    }

    expect(last.data.rows.map((row) => row.id)).toEqual([extra2.id, extra3.id]);
  });

  test("treats LIKE metacharacters literally in search", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: actor.id } },
      error: null,
    });

    const weird = await seedCategory({
      actorId: actor.id,
      namePrefix: "Weird%Name_x",
    });

    // Raw fragment containing metacharacters: must match literally.
    const fragment = weird.name.slice(0, 11);

    const result = await listCategoriesAction({
      search: fragment,
      status: "all",
    });

    if (!result.ok) {
      throw new Error(result.error.code);
    }

    expect(result.data.total).toBe(1);
    expect(result.data.rows[0]?.id).toBe(weird.id);

    // A bare percent typed by a user is text, matching only names that
    // literally contain one (unescaped, it would have matched everything).
    const wildcard = await listCategoriesAction({ search: "%", status: "all" });

    if (!wildcard.ok) {
      throw new Error(wildcard.error.code);
    }

    expect(wildcard.data.total).toBe(1);
    expect(wildcard.data.rows[0]?.id).toBe(weird.id);

    const caret = await listCategoriesAction({ search: "^", status: "all" });

    if (!caret.ok) {
      throw new Error(caret.error.code);
    }

    expect(caret.data.total).toBe(0);
  });
});

describe("listCategoriesAction authorization", () => {
  test("rejects unauthenticated callers", async () => {
    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await listCategoriesAction({});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  test("rejects sales callers with FORBIDDEN", async () => {
    const seller = await seedActor(["sales"]);

    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: seller.id } },
      error: null,
    });

    const result = await listCategoriesAction({});

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("FORBIDDEN");
    }
  });

  test("allows inventory callers without admin", async () => {
    const stocker = await seedActor(["inventory"]);

    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: stocker.id } },
      error: null,
    });

    const result = await listCategoriesAction({});

    expect(result.ok).toBe(true);
  });

  test("validates the sort allowlist before authorization", async () => {
    const stocker = await seedActor(["inventory"]);

    const { listCategoriesAction } = await import("./actions");

    mocks.getUser.mockResolvedValue({
      data: { user: { id: stocker.id } },
      error: null,
    });

    const result = await listCategoriesAction({ sort: "cheapest" as never });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});
