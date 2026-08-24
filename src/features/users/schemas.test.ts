import { describe, expect, test } from "vitest";

import { userListQuerySchema } from "./schemas";

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
