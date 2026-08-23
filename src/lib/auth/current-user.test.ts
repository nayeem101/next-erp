import { describe, expect, test } from "vitest";

import { ROLE_KEYS, type RoleKey } from "@/lib/auth/current-user";

describe("role keys", () => {
  test("matches the database enum exactly", () => {
    expect(ROLE_KEYS).toEqual(["admin", "sales", "inventory"]);
  });

  test("type covers every role for exhaustive switching", () => {
    const allRoles: RoleKey[] = [...ROLE_KEYS];

    expect(new Set(allRoles).size).toBe(3);
  });
});
