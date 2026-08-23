import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  jsonb,
  pgSequence,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { invoiceStatus } from "@/db/schema/enums";
import { orders } from "@/db/schema/orders";
import { users } from "@/db/schema/users";

export const invoiceNumberSequence = pgSequence("invoice_number_seq", {
  startWith: 1000,
});

export interface InvoicePartySnapshot {
  name: string;
  email: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  region?: string;
  postalCode: string;
  countryCode: string;
}

export interface BillToSnapshot extends InvoicePartySnapshot {
  companyName?: string;
  phone?: string;
}

const requiredSnapshotKeys = sql.raw(
  `?& ARRAY[
    'name', 'email', 'addressLine1', 'city', 'postalCode', 'countryCode'
  ]`,
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: varchar("invoice_number", { length: 24 })
      .default(
        sql`'INV-' || lpad(nextval('invoice_number_seq'::regclass)::text, 6, '0')`,
      )
      .notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    status: invoiceStatus("status").default("issued").notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .default("USD")
      .notNull(),
    sellerSnapshot: jsonb("seller_snapshot")
      .$type<InvoicePartySnapshot>()
      .notNull(),
    billToSnapshot: jsonb("bill_to_snapshot").$type<BillToSnapshot>().notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "bigint" }).notNull(),
    totalCents: bigint("total_cents", { mode: "bigint" }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("invoices_invoice_number_unique").on(table.invoiceNumber),
    unique("invoices_order_id_unique").on(table.orderId),
    index("invoices_status_issued_at_idx").on(table.status, table.issuedAt),
    check("invoices_subtotal_positive", sql`${table.subtotalCents} > 0`),
    check("invoices_total_positive", sql`${table.totalCents} > 0`),
    check(
      "invoices_total_matches_subtotal",
      sql`${table.totalCents} = ${table.subtotalCents}`,
    ),
    check("invoices_currency_usd", sql`${table.currencyCode} = 'USD'`),
    check(
      "invoices_seller_snapshot_shape",
      sql`jsonb_typeof(${table.sellerSnapshot}) = 'object'
        AND ${table.sellerSnapshot} ${requiredSnapshotKeys}`,
    ),
    check(
      "invoices_bill_to_snapshot_shape",
      sql`jsonb_typeof(${table.billToSnapshot}) = 'object'
        AND ${table.billToSnapshot} ${requiredSnapshotKeys}`,
    ),
  ],
);
