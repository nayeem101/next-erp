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

import { AUDIT_ACTIONS } from "@/lib/audit/events";
import {
  destroyTestDatabase,
  initializeTestDatabase,
} from "@/test/factories/db";
import { assignRole, createAuthUser } from "@/test/factories/factories";

import type postgres from "postgres";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
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
let adminId: string;

beforeAll(async () => {
  sql = await initializeTestDatabase();
});

afterAll(async () => {
  await destroyTestDatabase();
});

beforeEach(async () => {
  await sql`truncate table public.audit_log, public.users cascade`;

  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }

  const admin = await createAuthUser();
  await assignRole(admin.id, "admin");
  adminId = admin.id;
});

afterEach(() => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }
});

async function seedEvent(overrides?: {
  action?: string;
  entityType?: string;
  actorUserId?: string | null;
  createdAt?: Date;
}): Promise<string> {
  const id = randomUUID();

  await sql`
    insert into public.audit_log (
      id, actor_user_id, action, entity_type, entity_id, metadata, correlation_id, created_at
    ) values (
      ${id}::uuid, ${overrides?.actorUserId ?? adminId}::uuid,
      ${overrides?.action ?? AUDIT_ACTIONS.categoryCreated},
      ${overrides?.entityType ?? "category"}, ${id}::uuid,
      '{"before":{},"after":{"name":"Cat"}}'::jsonb,
      ${randomUUID()}::uuid,
      ${overrides?.createdAt?.toISOString() ?? new Date().toISOString()}
    )
  `;

  return id;
}

d("audit queries", () => {
  test("lists newest-first with actor identity and pagination", async () => {
    const older = await seedEvent({
      createdAt: new Date(Date.now() - 60_000),
    });
    void older;
    const newer = await seedEvent({
      action: AUDIT_ACTIONS.productCreated,
      entityType: "product",
    });

    // A second actor to exercise the join.
    const second = await createAuthUser();
    await seedEvent({
      actorUserId: second.id,
      action: AUDIT_ACTIONS.userEnabled,
      entityType: "user",
    });

    const { listAuditEvents } = await import("./queries");
    const page = await listAuditEvents({ page: 1, pageSize: 2 });

    expect(page.total).toBe(3);
    expect(page.rows).toHaveLength(2);
    expect(page.totalPages).toBe(2);
    const firstCreatedAt = page.rows[0]?.createdAt ?? "";
    const secondCreatedAt = page.rows[1]?.createdAt ?? "";
    expect(firstCreatedAt >= secondCreatedAt).toBe(true);

    const userRow = page.rows.find((row) => row.entityType === "user");
    expect(userRow?.actorEmail).toContain("@example.com");

    void newer;
  });

  test("filters by action, entity type, actor, and date window", async () => {
    await seedEvent({
      action: AUDIT_ACTIONS.orderConfirmed,
      entityType: "order",
    });
    await seedEvent({
      action: AUDIT_ACTIONS.customerCreated,
      entityType: "customer",
    });
    await seedEvent({
      action: AUDIT_ACTIONS.ledgerSalePosted,
      entityType: "ledger_journal",
    });

    const { listAuditEvents } = await import("./queries");

    const byAction = await listAuditEvents({
      action: AUDIT_ACTIONS.orderConfirmed,
      page: 1,
      pageSize: 20,
    });
    expect(byAction.total).toBe(1);
    expect(byAction.rows[0]?.entityType).toBe("order");

    const byEntity = await listAuditEvents({
      entityType: "ledger_journal",
      page: 1,
      pageSize: 20,
    });
    expect(byEntity.total).toBe(1);

    const future = await listAuditEvents({
      dateFrom: "2099-01-01",
      page: 1,
      pageSize: 20,
    });
    expect(future.total).toBe(0);
  });

  test("detail returns sanitized metadata without credential-shaped keys", async () => {
    const id = randomUUID();

    await sql`
      insert into public.audit_log (
        id, actor_user_id, action, entity_type, entity_id, metadata, correlation_id
      ) values (
        ${id}::uuid, ${adminId}::uuid, ${AUDIT_ACTIONS.userRolesChanged}, 'user', ${adminId}::uuid,
        '{"before":{"roles":["sales"]},"after":{"roles":["admin"]},"context":{"apiToken":"leak","note":"safe"}}'::jsonb,
        ${randomUUID()}::uuid
      )
    `;

    const { getAuditEventDetail } = await import("./queries");
    const detail = await getAuditEventDetail(id);

    expect(detail?.action).toBe(AUDIT_ACTIONS.userRolesChanged);
    expect(JSON.stringify(detail?.metadata)).not.toContain("leak");
    expect((detail?.metadata.context as Record<string, unknown>).apiToken).toBe(
      "[redacted]",
    );
    expect(detail?.metadata.after).toEqual({ roles: ["admin"] });

    expect(await getAuditEventDetail(randomUUID())).toBeNull();
  });

  test("audit rows reject update and delete at the database level", async () => {
    const id = await seedEvent();

    // The runtime role holds SELECT/INSERT only; RLS denies the rest.
    await expect(
      sql`update public.audit_log set action = 'tampered' where id = ${id}::uuid`,
    ).rejects.toThrow();

    await expect(
      sql`delete from public.audit_log where id = ${id}::uuid`,
    ).rejects.toThrow();

    const rows = (await sql`
      select action from public.audit_log where id = ${id}::uuid
    `) as unknown as { action: string }[];
    expect(rows[0]?.action).not.toBe("tampered");
  });
});
