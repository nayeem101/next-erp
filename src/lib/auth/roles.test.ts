import { describe, expect, test } from "vitest";

import type { RoleKey } from "@/lib/auth/current-user";
import { hasAnyRole, MODULE_ROLE_REQUIREMENTS } from "@/lib/auth/roles";

/** Every subset of the three application roles. */
const ALL_ROLE_SUBSETS: { label: string; roles: RoleKey[] }[] = [
  { label: "none", roles: [] },
  { label: "admin", roles: ["admin"] },
  { label: "sales", roles: ["sales"] },
  { label: "inventory", roles: ["inventory"] },
  { label: "admin+sales", roles: ["admin", "sales"] },
  { label: "admin+inventory", roles: ["admin", "inventory"] },
  { label: "sales+inventory", roles: ["sales", "inventory"] },
  { label: "all", roles: ["admin", "sales", "inventory"] },
];

/**
 * Explicitly documented access tables from `ARCHITECTURE.md`. Each entry
 * lists every role subset that MUST be granted entry; all others must be
 * denied.
 */
const EXPECTED_ACCESS_TABLE: Record<string, readonly string[]> = {
  inventory: [
    "admin",
    "inventory",
    "admin+sales",
    "admin+inventory",
    "sales+inventory",
    "all",
  ],
  customers: [
    "admin",
    "sales",
    "admin+sales",
    "admin+inventory",
    "sales+inventory",
    "all",
  ],
  // The mixed-role operations queue still requires an authenticated,
  // role-bearing user.
  orders: ALL_ROLE_SUBSETS.map((subset) => subset.label).filter(
    (label) => label !== "none",
  ),
  // /sales/orders/new and edit routes exclude Inventory.
  orderAuthoring: [
    "admin",
    "sales",
    "admin+sales",
    "admin+inventory",
    "sales+inventory",
    "all",
  ],
  invoices: [
    "admin",
    "sales",
    "admin+sales",
    "admin+inventory",
    "sales+inventory",
    "all",
  ],
  ledger: ["admin", "admin+sales", "admin+inventory", "all"],
  administration: ["admin", "admin+sales", "admin+inventory", "all"],
};

describe("module role requirements matrix", () => {
  for (const [moduleKey, allowed] of Object.entries(MODULE_ROLE_REQUIREMENTS)) {
    const expectedGranted = EXPECTED_ACCESS_TABLE[moduleKey];

    if (!expectedGranted) {
      throw new Error(`No documented access table for module ${moduleKey}`);
    }

    const deniedLabels = ALL_ROLE_SUBSETS.map((subset) => subset.label).filter(
      (label) => !expectedGranted.includes(label),
    );

    test(`${moduleKey}: grants ${String(expectedGranted.length)} subsets, denies ${String(deniedLabels.length)}`, () => {
      for (const subset of ALL_ROLE_SUBSETS) {
        const granted = hasAnyRole(subset.roles, [...allowed]);
        const expectedToBeGranted = expectedGranted.includes(subset.label);

        expect(granted, `${moduleKey} / ${subset.label}`).toBe(
          expectedToBeGranted,
        );
      }

      expect(expectedGranted.length + deniedLabels.length).toBe(
        ALL_ROLE_SUBSETS.length,
      );
    });
  }

  test("documents an access table for every module", () => {
    expect(Object.keys(EXPECTED_ACCESS_TABLE).sort()).toEqual(
      Object.keys(MODULE_ROLE_REQUIREMENTS).sort(),
    );
  });

  test("never grants restricted modules to roleless users", () => {
    for (const [moduleKey, allowed] of Object.entries(
      MODULE_ROLE_REQUIREMENTS,
    )) {
      if (moduleKey === "orders") {
        continue;
      }

      expect(hasAnyRole([], [...allowed]), moduleKey).toBe(false);
    }
  });
});

describe("hasAnyRole edge cases", () => {
  test("empty requirement denies everyone", () => {
    for (const subset of ALL_ROLE_SUBSETS) {
      expect(hasAnyRole(subset.roles, [])).toBe(false);
    }
  });
});
