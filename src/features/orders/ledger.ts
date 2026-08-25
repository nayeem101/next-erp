import "server-only";

import { eq } from "drizzle-orm";

import type { Database } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { DomainError } from "@/lib/errors/action-result";

/**
 * Internal double-entry journal writer. Journals are append-only: exactly
 * one AR row and one revenue row per journal, equal and opposite. Rows are
 * never updated or deleted — cancellation posts a separate reversal
 * journal that references the same order/invoice.
 */

export interface PostedJournal {
  journalId: string;
}

export interface SaleJournalInput {
  orderId: string;
  invoiceId: string;
  /** Positive sale amount in cents; both legs use this magnitude. */
  amountCents: bigint;
  postedBy: string;
  description: string;
}

function assertPositiveAmount(amountCents: bigint): void {
  if (amountCents <= 0n) {
    throw new DomainError(
      "INTERNAL_ERROR",
      "Journal amounts must be positive cents.",
    );
  }
}

/** Posts the balanced sale journal: AR debit / Sales Revenue credit. */
export async function postSaleJournal(
  tx: Database,
  input: SaleJournalInput,
): Promise<PostedJournal> {
  assertPositiveAmount(input.amountCents);

  const journalId = crypto.randomUUID();

  await tx.insert(ledgerEntries).values([
    {
      journalId,
      journalType: "sale",
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      account: "accounts_receivable",
      side: "debit",
      amountCents: input.amountCents,
      description: input.description,
      postedBy: input.postedBy,
    },
    {
      journalId,
      journalType: "sale",
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      account: "sales_revenue",
      side: "credit",
      amountCents: input.amountCents,
      description: input.description,
      postedBy: input.postedBy,
    },
  ]);

  return { journalId };
}

/** Posts the balanced reversal: AR credit / Sales Revenue debit. */
export async function postSaleReversalJournal(
  tx: Database,
  input: SaleJournalInput,
): Promise<PostedJournal> {
  assertPositiveAmount(input.amountCents);

  const journalId = crypto.randomUUID();

  await tx.insert(ledgerEntries).values([
    {
      journalId,
      journalType: "sale_reversal",
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      account: "accounts_receivable",
      side: "credit",
      amountCents: input.amountCents,
      description: input.description,
      postedBy: input.postedBy,
    },
    {
      journalId,
      journalType: "sale_reversal",
      orderId: input.orderId,
      invoiceId: input.invoiceId,
      account: "sales_revenue",
      side: "debit",
      amountCents: input.amountCents,
      description: input.description,
      postedBy: input.postedBy,
    },
  ]);

  return { journalId };
}

/**
 * Read-side invariant check for tests and the ledger UI: every returned
 * journal must balance to zero. Throws rather than rendering bad books.
 */
export async function assertJournalsBalanced(
  db: Database,
  journalId?: string,
): Promise<void> {
  const { sql } = await import("drizzle-orm");

  const rows = (await db.execute(sql`
    select journal_id as "journalId",
           sum(case when side = 'debit' then amount_cents else 0 end)::text as debits,
           sum(case when side = 'credit' then amount_cents else 0 end)::text as credits
    from public.ledger_entries
    ${journalId ? sql`where journal_id = ${journalId}::uuid` : sql``}
    group by journal_id
  `)) as unknown as {
    journalId: string;
    debits: string;
    credits: string;
  }[];

  for (const row of rows) {
    if (BigInt(row.debits) !== BigInt(row.credits)) {
      throw new DomainError(
        "INTERNAL_ERROR",
        `Unbalanced journal detected: ${row.journalId}`,
      );
    }
  }
}

/** Loads both legs of a journal ordered by account for display/tests. */
export async function loadJournalLegs(db: Database, journalId: string) {
  const rows = await db
    .select({
      account: ledgerEntries.account,
      side: ledgerEntries.side,
      amountCents: ledgerEntries.amountCents,
    })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.journalId, journalId));

  return rows.sort((a, b) => a.account.localeCompare(b.account));
}
