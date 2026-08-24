/** Canonical role vocabulary, browser-safe for schemas and UI gating. */
export const ROLE_KEYS = ["admin", "sales", "inventory"] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

/**
 * Pure role-membership checks shared by action guards and UI gating.
 *
 * Browser-safe by design: no database, environment, or server imports.
 */

export function hasAnyRole(
  roles: readonly RoleKey[],
  allowed: readonly RoleKey[],
): boolean {
  return allowed.some((role) => roles.includes(role));
}

/** Module access requirements from `ARCHITECTURE.md`. */
export const MODULE_ROLE_REQUIREMENTS = {
  inventory: ["admin", "inventory"],
  customers: ["admin", "sales"],
  orders: ["admin", "sales", "inventory"],
  orderAuthoring: ["admin", "sales"],
  invoices: ["admin", "sales"],
  ledger: ["admin"],
  administration: ["admin"],
} as const satisfies Record<string, readonly RoleKey[]>;
