/**
 * Server-safe schema barrel. Import from concrete modules in application
 * code when possible; this barrel exists for Drizzle configuration and
 * typed schema access. It must never be imported by client components.
 */

export { authSchema, authUsers } from "@/db/schema/auth";
export {
  invoiceStatus,
  journalType,
  ledgerAccount,
  ledgerSide,
  orderStatus,
  stockMovementType,
} from "@/db/schema/enums";
export * from "@/db/schema/relations";
export { createdAtOnly, timestamps } from "@/db/schema/shared";
export { stockMovements } from "@/db/schema/stock-movements";
export { auditLog, type AuditMetadata } from "@/db/schema/audit";
export { customers } from "@/db/schema/customers";
export { categories, products } from "@/db/schema/inventory";
export {
  invoiceNumberSequence,
  invoices,
  type BillToSnapshot,
  type InvoicePartySnapshot,
} from "@/db/schema/invoices";
export { ledgerEntries } from "@/db/schema/ledger";
export {
  orderLineItems,
  orderNumberSequence,
  orders,
} from "@/db/schema/orders";
export { roleKey, roles, userRoles, users } from "@/db/schema/users";
