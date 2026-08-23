import { pgEnum } from "drizzle-orm/pg-core";

export const orderStatus = pgEnum("order_status", [
  "draft",
  "confirmed",
  "fulfilled",
  "cancelled",
]);

export const invoiceStatus = pgEnum("invoice_status", ["issued", "void"]);

export const stockMovementType = pgEnum("stock_movement_type", [
  "opening",
  "adjustment",
  "sale",
  "sale_reversal",
]);

export const ledgerAccount = pgEnum("ledger_account", [
  "accounts_receivable",
  "sales_revenue",
]);

export const ledgerSide = pgEnum("ledger_side", ["debit", "credit"]);

export const journalType = pgEnum("journal_type", ["sale", "sale_reversal"]);
