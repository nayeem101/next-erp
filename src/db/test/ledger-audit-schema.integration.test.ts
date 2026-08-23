import postgres from "postgres";
import { beforeAll, describe, expect, test } from "vitest";

import {
  getIntegrationDatabaseUrl,
  prepareIntegrationDatabase,
} from "@/db/test/setup-db";

const d =
  (process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL)
    ? describe
    : describe.skip;

let sql: postgres.Sql;

beforeAll(async () => {
  await prepareIntegrationDatabase();
  sql = postgres(getIntegrationDatabaseUrl(), { max: 1 });

  return async () => {
    await sql.end();
  };
});

async function createTestUser(): Promise<string> {
  const rows = (await sql`
    insert into auth.users (id, email)
    values (gen_random_uuid(), ${`ledger-${crypto.randomUUID().slice(0, 8)}@example.com`})
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("auth identity insert returned no id");
  }

  return id;
}

interface LedgerOrderFixture {
  userId: string;
  orderId: string;
  invoiceId: string;
}

async function createLedgerOrderFixture(): Promise<LedgerOrderFixture> {
  const userId = await createTestUser();

  const customerRows = (await sql`
    insert into customers (name, email, address_line_1, city, postal_code, country_code, created_by, updated_by)
    values (
      ${`Ledger Customer ${crypto.randomUUID().slice(0, 6)}`},
      ${`ledger-cust-${crypto.randomUUID().slice(0, 10)}@example.com`},
      '1 Main Street', 'Springfield', '12345', 'US',
      ${userId}::uuid, ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const customerId = customerRows[0]?.id;

  if (!customerId) {
    throw new Error("customer insert returned no id");
  }

  const orderRows = (await sql`
    insert into orders (customer_id, status, confirmed_by, confirmed_at, created_by, updated_by)
    values (${customerId}::uuid, 'confirmed', ${userId}::uuid, now(), ${userId}::uuid, ${userId}::uuid)
    returning id
  `) as { id: string }[];

  const orderId = orderRows[0]?.id;

  if (!orderId) {
    throw new Error("order insert returned no id");
  }

  const invoiceRows = (await sql`
    insert into invoices (order_id, seller_snapshot, bill_to_snapshot, subtotal_cents, total_cents, created_by)
    values (
      ${orderId}::uuid,
      ${sql.json({
        name: "Seller",
        email: "seller@example.com",
        addressLine1: "100 Market Street",
        city: "San Francisco",
        postalCode: "94105",
        countryCode: "US",
      })},
      ${sql.json({
        name: "Buyer",
        email: "buyer@example.com",
        addressLine1: "1 Main Street",
        city: "Springfield",
        postalCode: "12345",
        countryCode: "US",
      })},
      1200, 1200, ${userId}::uuid
    )
    returning id
  `) as { id: string }[];

  const invoiceId = invoiceRows[0]?.id;

  if (!invoiceId) {
    throw new Error("invoice insert returned no id");
  }

  return { userId, orderId, invoiceId };
}

type Queryable = postgres.Sql | postgres.TransactionSql;

async function postLedgerEntry(
  db: Queryable,
  input: {
    fixture: LedgerOrderFixture;
    journalId?: string;
    journalType?: string;
    account?: string;
    side?: string;
    amountCents?: number;
  },
): Promise<void> {
  await db`
    insert into ledger_entries (
      journal_id, journal_type, order_id, invoice_id,
      account, side, amount_cents, description, posted_by
    )
    values (
      ${input.journalId ?? crypto.randomUUID()}::uuid,
      ${input.journalType ?? "sale"}::journal_type,
      ${input.fixture.orderId}::uuid,
      ${input.fixture.invoiceId}::uuid,
      ${input.account ?? "accounts_receivable"}::ledger_account,
      ${input.side ?? "debit"}::ledger_side,
      ${input.amountCents ?? 1200},
      'Sale posting',
      ${input.fixture.userId}::uuid
    )
  `;
}

d("ledger_entries schema", () => {
  test("enforces normal-side accounting rules per journal type", async () => {
    const fixture = await createLedgerOrderFixture();
    const journalId = crypto.randomUUID();

    // A balanced sale journal posts AR debit and revenue credit.
    await sql.begin(async (tx) => {
      await postLedgerEntry(tx, {
        fixture,
        journalId,
        account: "accounts_receivable",
        side: "debit",
      });
      await postLedgerEntry(tx, {
        fixture,
        journalId,
        account: "sales_revenue",
        side: "credit",
      });
    });

    // Wrong-side combinations are rejected by the table check itself; the
    // balancing counterpart proves it is not the deferred balance trigger
    // rejecting the transaction.
    const reversed = await createLedgerOrderFixture();
    const wrongJournalId = crypto.randomUUID();

    await expect(
      sql.begin(async (tx) => {
        await tx`
          insert into ledger_entries (
            journal_id, journal_type, order_id, invoice_id,
            account, side, amount_cents, description, posted_by
          )
          values (
            ${wrongJournalId}::uuid, 'sale'::journal_type,
            ${reversed.orderId}::uuid, ${reversed.invoiceId}::uuid,
            'accounts_receivable'::ledger_account, 'credit'::ledger_side,
            800, 'Wrong side', ${reversed.userId}::uuid
          )
        `;
        await tx`
          insert into ledger_entries (
            journal_id, journal_type, order_id, invoice_id,
            account, side, amount_cents, description, posted_by
          )
          values (
            ${wrongJournalId}::uuid, 'sale'::journal_type,
            ${reversed.orderId}::uuid, ${reversed.invoiceId}::uuid,
            'sales_revenue'::ledger_account, 'debit'::ledger_side,
            800, 'Wrong side', ${reversed.userId}::uuid
          )
        `;
      }),
    ).rejects.toMatchObject({ code: "23514" });

    // Reversal journals mirror the sides and commit when balanced.
    const reversalFixture = await createLedgerOrderFixture();
    const reversalJournalId = crypto.randomUUID();

    await sql.begin(async (tx) => {
      await postLedgerEntry(tx, {
        fixture: reversalFixture,
        journalId: reversalJournalId,
        journalType: "sale_reversal",
        account: "accounts_receivable",
        side: "credit",
      });
      await postLedgerEntry(tx, {
        fixture: reversalFixture,
        journalId: reversalJournalId,
        journalType: "sale_reversal",
        account: "sales_revenue",
        side: "debit",
      });
    });
  });

  test("requires positive amounts and one entry per account per journal", async () => {
    const fixture = await createLedgerOrderFixture();

    await expect(
      postLedgerEntry(sql, { fixture, amountCents: 0 }),
    ).rejects.toMatchObject({ code: "23514" });

    const journalId = crypto.randomUUID();

    await sql.begin(async (tx) => {
      await postLedgerEntry(tx, { fixture, journalId, amountCents: 500 });
      await postLedgerEntry(tx, {
        fixture,
        journalId,
        account: "sales_revenue",
        side: "credit",
        amountCents: 500,
      });
    });

    await expect(
      sql.begin(async (tx) => {
        await postLedgerEntry(tx, { fixture, journalId, amountCents: 700 });
        await postLedgerEntry(tx, {
          fixture,
          journalId,
          account: "sales_revenue",
          side: "credit",
          amountCents: 700,
        });
      }),
    ).rejects.toMatchObject({ code: "23505" });
  });

  test("rejects unbalanced or incomplete journals at commit time", async () => {
    const unbalanced = await createLedgerOrderFixture();
    const unbalancedJournalId = crypto.randomUUID();

    await expect(
      sql.begin(async (tx) => {
        await postLedgerEntry(tx, {
          fixture: unbalanced,
          journalId: unbalancedJournalId,
          amountCents: 500,
        });
        await postLedgerEntry(tx, {
          fixture: unbalanced,
          journalId: unbalancedJournalId,
          account: "sales_revenue",
          side: "credit",
          amountCents: 400,
        });
      }),
    ).rejects.toMatchObject({ code: "23514" });

    const single = await createLedgerOrderFixture();

    await expect(
      sql.begin(async (tx) => {
        await postLedgerEntry(tx, { fixture: single, amountCents: 900 });
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

async function insertAuditRow(input: {
  actorUserId?: string;
  withMetadata?: postgres.JSONValue;
}): Promise<string> {
  const rows = (await sql`
    insert into audit_log (actor_user_id, action, entity_type, entity_id, metadata, correlation_id)
    values (
      ${input.actorUserId ?? null}::uuid,
      'order.created',
      'order',
      gen_random_uuid(),
      ${sql.json(input.withMetadata ?? {})},
      gen_random_uuid()
    )
    returning id
  `) as { id: string }[];

  const id = rows[0]?.id;

  if (!id) {
    throw new Error("audit insert returned no id");
  }

  return id;
}

d("audit_log schema", () => {
  test("records structured audit events without an entity foreign key", async () => {
    const userId = await createTestUser();
    const auditId = await insertAuditRow({
      actorUserId: userId,
      withMetadata: {
        before: { status: "draft" },
        after: { status: "confirmed" },
        context: { ip: "127.0.0.1" },
      },
    });

    const rows = (await sql`
      select action, entity_type, metadata ? 'after' as has_after
      from audit_log
      where id = ${auditId}::uuid
    `) as {
      action: string;
      entity_type: string;
      has_after: boolean;
    }[];

    expect(rows[0]).toMatchObject({
      action: "order.created",
      entity_type: "order",
      has_after: true,
    });
  });

  test("defaults empty metadata and allows anonymous system actors", async () => {
    const auditId = await insertAuditRow({});

    const rows = (await sql`
      select metadata, actor_user_id
      from audit_log
      where id = ${auditId}::uuid
    `) as {
      metadata: Record<string, never>;
      actor_user_id: string | null;
    }[];

    expect(rows[0]?.metadata).toEqual({});
    expect(rows[0]?.actor_user_id).toBeNull();
  });

  test("keeps the audit trail when the actor identity disappears", async () => {
    const userId = await createTestUser();
    const auditId = await insertAuditRow({ actorUserId: userId });

    await sql`delete from public.users where id = ${userId}::uuid`;

    const rows = (await sql`
      select actor_user_id
      from audit_log
      where id = ${auditId}::uuid
    `) as { actor_user_id: string | null }[];

    expect(rows[0]?.actor_user_id).toBeNull();
  });

  test("maintains query indexes for recent-first grids", async () => {
    const rows = (await sql`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and tablename = 'audit_log'
        and indexname in (
          'audit_log_created_at_idx',
          'audit_log_actor_created_at_idx',
          'audit_log_entity_idx',
          'audit_log_action_idx'
        )
    `) as { indexname: string }[];

    expect(rows).toHaveLength(4);
  });
});
