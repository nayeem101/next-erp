import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { journalType, ledgerAccount, ledgerSide } from "@/db/schema/enums";
import { invoices } from "@/db/schema/invoices";
import { orders } from "@/db/schema/orders";
import { createdAtOnly } from "@/db/schema/shared";
import { users } from "@/db/schema/users";

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    journalId: uuid("journal_id").notNull(),
    journalType: journalType("journal_type").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    account: ledgerAccount("account").notNull(),
    side: ledgerSide("side").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    description: varchar("description", { length: 240 }).notNull(),
    postedBy: uuid("posted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...createdAtOnly,
  },
  (table) => [
    index("ledger_entries_journal_id_idx").on(table.journalId),
    index("ledger_entries_order_id_idx").on(table.orderId),
    index("ledger_entries_invoice_id_idx").on(table.invoiceId),
    index("ledger_entries_created_at_idx").on(table.createdAt),
    check("ledger_entries_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "ledger_entries_account_normal_side",
      sql`(
        (${table.journalType} = 'sale'
          AND (
            (${table.account} = 'accounts_receivable' AND ${table.side} = 'debit')
            OR (${table.account} = 'sales_revenue' AND ${table.side} = 'credit')
          ))
        OR
        (${table.journalType} = 'sale_reversal'
          AND (
            (${table.account} = 'accounts_receivable' AND ${table.side} = 'credit')
            OR (${table.account} = 'sales_revenue' AND ${table.side} = 'debit')
          ))
      )`,
    ),
    unique("ledger_entries_journal_account_unique").on(
      table.journalId,
      table.account,
    ),
  ],
);
