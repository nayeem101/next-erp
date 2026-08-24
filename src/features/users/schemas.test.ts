import { describe, expect, test } from "vitest";
import { z } from "zod";

import { setUserRolesSchema, userListQuerySchema } from "./schemas";

describe("userListQuerySchema", () => {
  test("applies pagination defaults", () => {
    const result = userListQuerySchema.parse({ search: "" });

    expect(result).toEqual({
      page: 1,
      pageSize: 20,
      role: undefined,
      search: undefined,
      status: undefined,
    });
  });

  test("trims search and drops empty values", () => {
    const padded = userListQuerySchema.parse({ search: "  ada  " });

    expect(padded.search).toBe("ada");

    const empty = userListQuerySchema.parse({ search: "   " });

    expect(empty.search).toBeUndefined();
  });

  test("coerces numeric strings from URL params", () => {
    const result = userListQuerySchema.parse({
      page: "3",
      pageSize: "50",
      role: "sales",
      status: "inactive",
    });

    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(50);
    expect(result.role).toBe("sales");
    expect(result.status).toBe("inactive");
  });

  test("rejects invalid role and status values", () => {
    expect(userListQuerySchema.safeParse({ role: "root" }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ status: "pending" }).success).toBe(
      false,
    );
  });

  test("enforces page and pageSize bounds", () => {
    expect(userListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ page: 1.5 }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ pageSize: 4 }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(
      false,
    );
    expect(userListQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
  });

  test("caps search length", () => {
    expect(
      userListQuerySchema.safeParse({ search: "a".repeat(101) }).success,
    ).toBe(false);
    expect(
      userListQuerySchema.safeParse({ search: "a".repeat(100) }).success,
    ).toBe(true);
  });
});

describe("setUserRolesSchema", () => {
  const userId = "0b8b3f6e-9c1d-4a2e-8f7a-1c2b3d4e5f60";

  test("accepts a valid role set", () => {
    const result = setUserRolesSchema.parse({
      userId,
      roles: ["sales", "inventory"],
    });

    expect(result.roles).toEqual(["sales", "inventory"]);
  });

  test("rejects duplicate roles", () => {
    const result = setUserRolesSchema.safeParse({
      userId,
      roles: ["admin", "admin"],
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const fieldErrors = z.flattenError(result.error).fieldErrors;

      expect(fieldErrors.roles).toContain("Roles must be unique");
    }
  });

  test("rejects empty role arrays and oversized sets", () => {
    expect(setUserRolesSchema.safeParse({ userId, roles: [] }).success).toBe(
      false,
    );
    expect(
      setUserRolesSchema.safeParse({
        userId,
        roles: ["admin", "sales", "inventory", "root"],
      }).success,
    ).toBe(false);
  });

  test("rejects unknown keys and malformed ids", () => {
    expect(
      setUserRolesSchema.safeParse({
        userId,
        roles: ["admin"],
        surprise: true,
      }).success,
    ).toBe(false);
    expect(
      setUserRolesSchema.safeParse({ userId: "not-a-uuid", roles: ["admin"] })
        .success,
    ).toBe(false);
  });
});
