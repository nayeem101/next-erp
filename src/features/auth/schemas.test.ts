import { describe, expect, test } from "vitest";

import { signInSchema } from "@/features/auth/schemas";

describe("signInSchema", () => {
  test("accepts credentials and normalizes email casing", () => {
    const parsed = signInSchema.parse({
      email: "  Ada@Example.COM ",
      password: "correct horse battery",
    });

    expect(parsed.email).toBe("ada@example.com");
    expect(parsed.password).toBe("correct horse battery");
    expect(parsed.next).toBeUndefined();
  });

  test("keeps an optional next parameter", () => {
    const parsed = signInSchema.safeParse({
      email: "ada@example.com",
      password: "correct horse battery",
      next: "/inventory/products",
    });

    expect(parsed.success).toBe(true);
  });

  test("rejects passwords outside the 8..128 boundary", () => {
    for (const password of ["", "short", "x".repeat(129)]) {
      const result = signInSchema.safeParse({
        email: "ada@example.com",
        password,
      });

      expect(result.success, `length ` + String(password.length)).toBe(false);
    }
  });

  test("rejects malformed emails", () => {
    for (const email of ["not-an-email", "a@b", "@example.com", "a b@c.com"]) {
      const result = signInSchema.safeParse({
        email,
        password: "correct horse battery",
      });

      expect(result.success, email).toBe(false);
    }
  });

  test("rejects unknown keys (strict boundary)", () => {
    const result = signInSchema.safeParse({
      email: "ada@example.com",
      password: "correct horse battery",
      isAdmin: true,
    });

    expect(result.success).toBe(false);
  });
});
