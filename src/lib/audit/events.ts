/**
 * Fixed audit event vocabulary from `API_SPEC.md`.
 *
 * Browser-safe constants: services reference these instead of free-form
 * strings so drift between writers and the documented vocabulary fails
 * typecheck, and tests can pin every action against one source of truth.
 */

export const AUDIT_ACTIONS = {
  authSignedIn: "auth.signed_in",
  categoryArchived: "category.archived",
  categoryCreated: "category.created",
  categoryRestored: "category.restored",
  categoryUpdated: "category.updated",
  customerArchived: "customer.archived",
  customerCreated: "customer.created",
  customerRestored: "customer.restored",
  customerUpdated: "customer.updated",
  invoiceIssued: "invoice.issued",
  invoiceVoided: "invoice.voided",
  ledgerSalePosted: "ledger.sale_posted",
  ledgerSaleReversed: "ledger.sale_reversed",
  orderCancelled: "order.cancelled",
  orderConfirmed: "order.confirmed",
  orderDraftCreated: "order.draft_created",
  orderDraftUpdated: "order.draft_updated",
  orderFulfilled: "order.fulfilled",
  productArchived: "product.archived",
  productCreated: "product.created",
  productRestored: "product.restored",
  productStockAdjusted: "product.stock_adjusted",
  productUpdated: "product.updated",
  userDisabled: "user.disabled",
  userEnabled: "user.enabled",
  userRolesChanged: "user.roles_changed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** The complete documented action vocabulary; tests iterate this list. */
export const AUDIT_ACTION_VALUES = Object.values(AUDIT_ACTIONS);

export const AUDIT_ENTITY_TYPES = [
  "auth_session",
  "category",
  "customer",
  "invoice",
  "ledger_journal",
  "order",
  "product",
  "user",
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** Keys that must never appear in persisted metadata, at any depth. */
const REDACTED_KEY_PATTERN =
  /password|secret|token|authorization|cookie|credential/i;

const REDACTED_PLACEHOLDER = "[redacted]";
const MAX_STRING_LENGTH = 500;
const MAX_DEPTH = 6;

function redactValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]`
      : value;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Map || value instanceof Set) {
    return JSON.stringify([...value]);
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(source)) {
    output[key] = REDACTED_KEY_PATTERN.test(key)
      ? REDACTED_PLACEHOLDER
      : redactValue(item, depth + 1);
  }

  return output;
}

/**
 * Recursively strips credential-shaped keys and caps oversized strings
 * before metadata reaches the append-only trail. Idempotent.
 */
export function redactAuditMetadata(metadata: object): Record<string, unknown> {
  return redactValue(metadata, 0) as Record<string, unknown>;
}
