import type { RoleKey } from "@/lib/auth/current-user";
import { hasAnyRole } from "@/lib/auth/roles";

/**
 * Role-aware primary navigation model.
 *
 * Pure data: the application shell renders these entries after filtering by
 * the verified user's roles. Icons are mapped at render time so this module
 * stays serializable and browser-safe.
 */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  allowedRoles: readonly RoleKey[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    allowedRoles: ["admin", "sales", "inventory"],
  },
  {
    key: "inventory",
    label: "Inventory",
    href: "/inventory/products",
    allowedRoles: ["admin", "inventory"],
  },
  {
    key: "customers",
    label: "Customers",
    href: "/customers",
    allowedRoles: ["admin", "sales"],
  },
  {
    key: "orders",
    label: "Orders",
    href: "/sales/orders",
    allowedRoles: ["admin", "sales", "inventory"],
  },
  {
    key: "invoices",
    label: "Invoices",
    href: "/accounting/invoices",
    allowedRoles: ["admin", "sales"],
  },
  {
    key: "ledger",
    label: "Ledger",
    href: "/accounting/ledger",
    allowedRoles: ["admin"],
  },
  {
    key: "administration",
    label: "Administration",
    href: "/admin/users",
    allowedRoles: ["admin"],
  },
];

/** Filters the primary navigation down to entries the roles may open. */
export function visibleNavItems(roles: readonly RoleKey[]): NavItem[] {
  return NAV_ITEMS.filter((item) => hasAnyRole(roles, item.allowedRoles));
}
