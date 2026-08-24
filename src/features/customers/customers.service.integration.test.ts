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
    truncate table public.audit_log, public.orders, public.customers cascade
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

let actorId: string;

const validCreate = () => ({
  name: `Customer ${token()}`,
  email: `buyer.${token()}@example.com`,
  phone: "+1 555-0100",
  companyName: undefined,
  addressLine1: "1 Main St",
  addressLine2: undefined,
  city: "Springfield",
  region: undefined,
  postalCode: "62704",
  countryCode: "US",
  notes: undefined,
});

async function seedActor(
  roles: ("admin" | "sales" | "inventory")[],
): Promise<{ id: string }> {
  const user = await createAuthUser();

  for (const role of roles) {
    await assignRole(user.id, role);
  }

  return { id: user.id };
}

async function loadActions(callerId: string) {
  vi.resetModules();

  const actions = await import("./actions");

  mocks.getUser.mockResolvedValue({
    data: { user: { id: callerId } },
    error: null,
  });

  return actions;
}

async function auditEventsFor(entityId: string) {
  return (await sql`
    select action, entity_type as "entityType", metadata
    from public.audit_log
    where entity_id = ${entityId}::uuid
    order by created_at asc
  `) as {
    action: string;
    entityType: string;
    metadata: Record<string, unknown>;
  }[];
}

d("createCustomer", () => {
  beforeEach(async () => {
    const admin = await seedActor(["admin"]);
    actorId = admin.id;
  });

  test("creates an active customer and appends customer.created", async () => {
    const { createCustomer } = await import("./service");

    const payload = validCreate();
    const result = await createCustomer(payload, actorId, crypto.randomUUID());

    expect(result.customerId).toBeTruthy();

    const rows = (await sql`
      select name, email, country_code as "countryCode", is_active as "isActive"
      from public.customers where id = ${result.customerId}::uuid
    `) as {
      name: string;
      email: string;
      countryCode: string;
      isActive: boolean;
    }[];

    expect(rows[0]?.email).toBe(payload.email);
    expect(rows[0]?.countryCode).toBe("US");
    expect(rows[0]?.isActive).toBe(true);

    const events = await auditEventsFor(result.customerId);
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe("customer.created");
    expect(events[0]?.entityType).toBe("customer");
  });

  test("maps case-insensitive duplicate emails to UNIQUE_CONFLICT", async () => {
    const { createCustomer } = await import("./service");

    const first = await createCustomer(
      validCreate(),
      actorId,
      crypto.randomUUID(),
    );

    const existing = (await sql`
      select email from public.customers where id = ${first.customerId}::uuid
    `) as { email: string }[];

    await expect(
      createCustomer(
        { ...validCreate(), email: (existing[0]?.email ?? "").toUpperCase() },
        actorId,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "UNIQUE_CONFLICT" });
  });

  test("sales may create customers through the guarded action", async () => {
    const seller = await seedActor(["sales"]);
    const { createCustomerAction } = await loadActions(seller.id);

    const result = await createCustomerAction(validCreate());

    expect(result.ok).toBe(true);
  });

  test("invalid payloads fail validation without touching the database", async () => {
    const admin = await seedActor(["admin"]);
    const { createCustomerAction } = await loadActions(admin.id);

    const result = await createCustomerAction({
      ...validCreate(),
      email: "not-an-email",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

d("updateCustomer", () => {
  let customerId: string;

  beforeEach(async () => {
    const admin = await seedActor(["admin"]);
    actorId = admin.id;

    const rows = (await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code, country_code,
        is_active, created_by, updated_by
      ) values (
        ${"Orig " + token()}, ${`orig.${token()}@example.com`},
        '1 Main St', 'Springfield', '62704', 'US',
        true, ${actorId}::uuid, ${actorId}::uuid
      )
      returning id
    `) as { id: string }[];

    customerId = rows[0]?.id ?? "";
  });

  test("writes a diff-only customer.updated audit event", async () => {
    const { updateCustomer } = await import("./service");

    const current = (await sql`
      select name, email, city, region, notes from public.customers where id = ${customerId}::uuid
    `) as {
      name: string;
      email: string;
      city: string;
      region: string | null;
      notes: string | null;
    }[];

    await updateCustomer(
      {
        customerId,
        name: `${current[0]?.name ?? ""} Renamed`,
        email: current[0]?.email ?? "",
        phone: undefined,
        companyName: undefined,
        addressLine1: "1 Main St",
        addressLine2: undefined,
        city: current[0]?.city ?? "",
        region: "IL",
        postalCode: "62704",
        countryCode: "US",
        notes: undefined,
      },
      actorId,
      crypto.randomUUID(),
    );

    const events = await auditEventsFor(customerId);
    expect(events).toHaveLength(1);

    const metadata = events[0]?.metadata as {
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    };

    expect(Object.keys(metadata.before)).toEqual(["name", "region"]);
    expect(metadata.after.name).toContain("Renamed");
    expect(metadata.after.region).toBe("IL");

    // Stock-like fields never exist on customers, but confirm untouched
    // fields are absent from the diff.
    expect(metadata.before.city).toBeUndefined();
  });

  test("no-op updates skip the audit log entirely", async () => {
    const { updateCustomer } = await import("./service");

    const current = (await sql`
      select name, email from public.customers where id = ${customerId}::uuid
    `) as { name: string; email: string }[];

    await updateCustomer(
      {
        customerId,
        name: current[0]?.name ?? "",
        email: current[0]?.email ?? "",
        phone: undefined,
        companyName: undefined,
        addressLine1: "1 Main St",
        addressLine2: undefined,
        city: "Springfield",
        region: undefined,
        postalCode: "62704",
        countryCode: "US",
        notes: undefined,
      },
      actorId,
      crypto.randomUUID(),
    );

    expect(await auditEventsFor(customerId)).toHaveLength(0);
  });

  test("conflicts with a different customer's email case-insensitively", async () => {
    const other = await seedActor(["admin"]);

    const otherRows = (await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code, country_code,
        is_active, created_by, updated_by
      ) values (
        ${"Other " + token()}, ${`taken.${token()}@example.com`},
        '2 Oak St', 'Shelbyville', '55555', 'CA',
        true, ${other.id}::uuid, ${other.id}::uuid
      )
      returning email
    `) as { email: string }[];

    const { updateCustomer } = await import("./service");

    const current = (await sql`
      select name from public.customers where id = ${customerId}::uuid
    `) as { name: string }[];

    await expect(
      updateCustomer(
        {
          customerId,
          name: current[0]?.name ?? "",
          email: (otherRows[0]?.email ?? "").toUpperCase(),
          phone: undefined,
          companyName: undefined,
          addressLine1: "1 Main St",
          addressLine2: undefined,
          city: "Springfield",
          region: undefined,
          postalCode: "62704",
          countryCode: "US",
          notes: undefined,
        },
        actorId,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "UNIQUE_CONFLICT" });

    expect(await auditEventsFor(customerId)).toHaveLength(0);
  });

  test("unknown customers fail closed with NOT_FOUND", async () => {
    const { updateCustomer } = await import("./service");

    await expect(
      updateCustomer(
        { ...validCreate(), customerId: crypto.randomUUID() },
        actorId,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

d("setCustomerActive", () => {
  let customerId: string;

  beforeEach(async () => {
    const admin = await seedActor(["admin"]);
    actorId = admin.id;

    const rows = (await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code, country_code,
        is_active, created_by, updated_by
      ) values (
        ${"Toggle " + token()}, ${`toggle.${token()}@example.com`},
        '1 Main St', 'Springfield', '62704', 'US',
        true, ${actorId}::uuid, ${actorId}::uuid
      )
      returning id
    `) as { id: string }[];

    customerId = rows[0]?.id ?? "";
  });

  test("archives and restores with matching audit actions", async () => {
    const { setCustomerActive } = await import("./service");

    const archived = await setCustomerActive(
      { customerId, isActive: false },
      actorId,
      crypto.randomUUID(),
    );
    expect(archived.isActive).toBe(false);

    const restored = await setCustomerActive(
      { customerId, isActive: true },
      actorId,
      crypto.randomUUID(),
    );

    expect(restored.isActive).toBe(true);

    const events = await auditEventsFor(customerId);
    expect(events.map((event) => event.action)).toEqual([
      "customer.archived",
      "customer.restored",
    ]);
  });

  test("is idempotent when the state already matches", async () => {
    const { setCustomerActive } = await import("./service");

    const result = await setCustomerActive(
      { customerId, isActive: true },
      actorId,
      crypto.randomUUID(),
    );

    expect(result.isActive).toBe(true);
    expect(await auditEventsFor(customerId)).toHaveLength(0);
  });

  test("unknown customers fail closed with NOT_FOUND", async () => {
    const { setCustomerActive } = await import("./service");

    await expect(
      setCustomerActive(
        { customerId: crypto.randomUUID(), isActive: false },
        actorId,
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

d("customers module RBAC", () => {
  let customerId: string;

  beforeEach(async () => {
    const admin = await seedActor(["admin"]);
    actorId = admin.id;

    const rows = (await sql`
      insert into public.customers (
        name, email, address_line_1, city, postal_code, country_code,
        is_active, created_by, updated_by
      ) values (
        ${"Rbac " + token()}, ${`rbac.${token()}@example.com`},
        '1 Main St', 'Springfield', '62704', 'US',
        true, ${actorId}::uuid, ${actorId}::uuid
      )
      returning id
    `) as { id: string }[];

    customerId = rows[0]?.id ?? "";
  });

  test("inventory cannot browse or mutate customer administration", async () => {
    const worker = await seedActor(["inventory"]);
    const actions = await loadActions(worker.id);

    function expectForbidden(result: {
      ok: boolean;
      error?: { code?: string };
    }): void {
      expect(result.ok).toBe(false);

      if (!result.ok) {
        expect(result.error?.code).toBe("FORBIDDEN");
      }
    }

    expectForbidden(await actions.listCustomersAction({}));
    expectForbidden(await actions.listCustomerOrdersAction(customerId));
    expectForbidden(await actions.createCustomerAction(validCreate()));
    expectForbidden(
      await actions.updateCustomerAction({ customerId, ...validCreate() }),
    );
    expectForbidden(
      await actions.setCustomerActiveAction({ customerId, isActive: false }),
    );

    const remaining = (await sql`
      select count(*)::int as n from public.customers
    `) as { n: number }[];

    expect(remaining[0]?.n).toBe(1);
    expect(await auditEventsFor(customerId)).toHaveLength(0);
  });

  test("unauthenticated calls fail closed", async () => {
    vi.resetModules();

    const actions = await import("./actions");

    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await actions.listCustomersAction({});
    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error.code).toBe("UNAUTHENTICATED");
    }
  });

  test("sales can browse the directory", async () => {
    const seller = await seedActor(["sales"]);
    const { listCustomersAction } = await loadActions(seller.id);

    const result = await listCustomersAction({});
    expect(result.ok).toBe(true);
  });
});
