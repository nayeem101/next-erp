import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";

import { getDb } from "@/db";
import { invoices, ledgerEntries, orders } from "@/db/schema";

import { listLedgerQuerySchema } from "./schemas";

import type {
  LedgerJournalGroup,
  LedgerLeg,
  LedgerListPage,
  ListLedgerQuery,
  ListLedgerQueryInput,
} from "./schemas";

/**
 * Admin-only read models for the immutable ledger. Entries come back
 * grouped into journals with a balance projection; any journal that does
 * not balance to zero is logged loudly and flagged for the UI invariant.
 */

function buildConditions(query: ListLedgerQuery): SQL | undefined {
  const conditions: SQL[] = [];

  if (query.journalType !== "all") {
    conditions.push(eq(ledgerEntries.journalType, query.journalType));
  }

  if (query.account !== undefined) {
    conditions.push(eq(ledgerEntries.account, query.account));
  }

  if (query.dateFrom !== undefined) {
    conditions.push(gte(ledgerEntries.createdAt, sql`${query.dateFrom}::date`));
  }

  if (query.dateTo !== undefined) {
    conditions.push(
      lte(
        ledgerEntries.createdAt,
        sql`${query.dateTo}::date + interval '1 day'`,
      ),
    );
  }

  if (query.reference !== undefined && query.reference !== "") {
    conditions.push(ilike(orders.orderNumber, `%${query.reference}%`));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export async function listLedgerJournals(
  rawQuery: ListLedgerQueryInput,
): Promise<LedgerListPage> {
  const db = getDb();

  const query: ListLedgerQuery = listLedgerQuerySchema.parse(rawQuery);
  const where = buildConditions(query);

  const rows = await db
    .select({
      journalId: ledgerEntries.journalId,
      journalType: ledgerEntries.journalType,
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      invoiceNumber: invoices.invoiceNumber,
      description: ledgerEntries.description,
      postedAt: sql<string>`${ledgerEntries.createdAt}`,
      account: ledgerEntries.account,
      side: ledgerEntries.side,
      amountCents: sql<string>`${ledgerEntries.amountCents}`,
    })
    .from(ledgerEntries)
    .innerJoin(orders, eq(ledgerEntries.orderId, orders.id))
    .innerJoin(invoices, eq(ledgerEntries.invoiceId, invoices.id))
    .where(where)
    .orderBy(desc(ledgerEntries.createdAt), asc(ledgerEntries.journalId));

  // Group rows into journals preserving newest-first ordering.
  const grouped = new Map<string, LedgerJournalGroup>();
  const order: string[] = [];

  for (const row of rows) {
    let group = grouped.get(row.journalId);

    if (!group) {
      group = {
        journalId: row.journalId,
        journalType: row.journalType,
        orderId: row.orderId,
        orderNumber: row.orderNumber,
        invoiceNumber: row.invoiceNumber,
        description: row.description,
        postedAt: new Date(row.postedAt).toISOString(),
        legs: [],
        debitTotalCents: 0,
        creditTotalCents: 0,
      };
      grouped.set(row.journalId, group);
      order.push(row.journalId);
    }

    const leg: LedgerLeg = {
      account: row.account,
      side: row.side,
      amountCents: Number(row.amountCents),
    };
    group.legs.push(leg);

    if (leg.side === "debit") {
      group.debitTotalCents += leg.amountCents;
    } else {
      group.creditTotalCents += leg.amountCents;
    }
  }

  const journals = order.flatMap((journalId) => {
    const group = grouped.get(journalId);

    if (!group) {
      return [];
    }

    // Account filters can hide one leg of a pair; only groups with
    // visible legs count toward pagination when no account filter is set.
    return query.account === undefined || group.legs.length > 0 ? [group] : [];
  });

  const total = journals.length;
  const start = (query.page - 1) * query.pageSize;
  const paged = journals.slice(start, start + query.pageSize);

  if (query.account === undefined) {
    // Account filters intentionally show partial journals; only complete
    // groups are invariant-checked.
    for (const group of paged) {
      assertJournalBalanced(group);
    }
  }

  return {
    journals: paged,
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
  };
}

/**
 * Invariant guard. The database trigger makes unbalanced journals
 * impossible through normal writes; this catches corrupted data at read
 * time and logs it server-side so the UI can surface an error state.
 */
export function assertJournalBalanced(group: LedgerJournalGroup): void {
  if (group.debitTotalCents !== group.creditTotalCents) {
    console.error(
      `[ledger-invariant] Journal ${group.journalId} is unbalanced: ` +
        `${String(group.debitTotalCents)} debits vs ` +
        `${String(group.creditTotalCents)} credits`,
    );

    throw new Error(
      `Unbalanced journal detected: ${group.journalId}. Contact an administrator.`,
    );
  }
}
