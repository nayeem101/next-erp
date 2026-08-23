import { describe, expect, test } from "vitest";

import * as schema from "@/db/schema";
import * as tables from "@/db/schema/users";

describe("schema barrel", () => {
  test("exposes every application table object", () => {
    const expectedTables = [
      "roles",
      "users",
      "userRoles",
      "customers",
      "categories",
      "products",
      "orders",
      "orderLineItems",
      "invoices",
      "stockMovements",
      "ledgerEntries",
      "auditLog",
    ] as const;

    for (const table of expectedTables) {
      expect(schema, `missing export: ${table}`).toHaveProperty(table);
    }
  });

  test("exposes enums, sequences, and relation definitions", () => {
    expect(schema.orderStatus.enumValues).toEqual([
      "draft",
      "confirmed",
      "fulfilled",
      "cancelled",
    ]);
    expect(schema.roleKey.enumValues).toEqual(["admin", "sales", "inventory"]);
    expect(schema.invoiceNumberSequence).toBeDefined();
    expect(schema.usersRelations).toBeDefined();
    expect(schema.ordersRelations).toBeDefined();
  });

  test("re-exports the identity table module without drift", () => {
    expect(schema.users).toBe(tables.users);
  });
});
