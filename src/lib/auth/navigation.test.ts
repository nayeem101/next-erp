import { describe, expect, test } from "vitest";

import type { RoleKey } from "@/lib/auth/current-user";
import { NAV_ITEMS, visibleNavItems } from "@/lib/auth/navigation";

const ROLE_SUBSETS: { label: string; roles: RoleKey[] }[] = [
  { label: "none", roles: [] },
  { label: "admin", roles: ["admin"] },
  { label: "sales", roles: ["sales"] },
  { label: "inventory", roles: ["inventory"] },
  { label: "admin+sales", roles: ["admin", "sales"] },
  { label: "admin+inventory", roles: ["admin", "inventory"] },
  { label: "sales+inventory", roles: ["sales", "inventory"] },
  { label: "all", roles: ["admin", "sales", "inventory"] },
];

/** Expected nav keys per role subset, mirroring module access rules. */
const EXPECTED_NAV: Record<string, readonly string[]> = {
  none: [],
  admin: [
    "dashboard",
    "inventory",
    "customers",
    "orders",
    "invoices",
    "ledger",
    "administration",
  ],
  sales: ["dashboard", "customers", "orders", "invoices"],
  inventory: ["dashboard", "inventory", "orders"],
  "admin+sales": [
    "dashboard",
    "inventory",
    "customers",
    "orders",
    "invoices",
    "ledger",
    "administration",
  ],
  "admin+inventory": [
    "dashboard",
    "inventory",
    "customers",
    "orders",
    "invoices",
    "ledger",
    "administration",
  ],
  "sales+inventory": [
    "dashboard",
    "inventory",
    "customers",
    "orders",
    "invoices",
  ],
  all: NAV_ITEMS.map((item) => item.key),
};

describe("role-aware navigation model", () => {
  for (const subset of ROLE_SUBSETS) {
    test(`${subset.label} sees: ${(EXPECTED_NAV[subset.label] ?? []).join(", ") || "nothing"}`, () => {
      const keys = visibleNavItems(subset.roles).map((item) => item.key);

      expect(keys).toEqual(EXPECTED_NAV[subset.label]);
    });
  }

  test("nav hrefs always point at protected modules", () => {
    const protectedPrefixes = [
      "/dashboard",
      "/inventory",
      "/customers",
      "/sales",
      "/accounting",
      "/admin",
    ];

    for (const item of NAV_ITEMS) {
      expect(
        protectedPrefixes.some((prefix) => item.href.startsWith(prefix)),
        item.href,
      ).toBe(true);
    }
  });

  test("every nav entry has a unique key and nonempty label", () => {
    const keys = NAV_ITEMS.map((item) => item.key);

    expect(new Set(keys).size).toBe(NAV_ITEMS.length);

    for (const item of NAV_ITEMS) {
      expect(item.label.length).toBeGreaterThan(0);
    }
  });
});
