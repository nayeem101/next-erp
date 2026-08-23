import { describe, expect, test } from "vitest";

import {
  isSameOriginRelativePath,
  sanitizeRedirectPath,
} from "@/lib/auth/safe-redirect";

describe("sanitizeRedirectPath", () => {
  test("accepts plain relative paths", () => {
    expect(sanitizeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/inventory/products?page=2")).toBe(
      "/inventory/products?page=2",
    );
  });

  test("allows nested query parameters on the target", () => {
    expect(sanitizeRedirectPath("/sales/orders?next=%2Fx")).toBe(
      "/sales/orders?next=%2Fx",
    );
  });

  test("falls back for empty and missing values", () => {
    expect(sanitizeRedirectPath(null)).toBe("/dashboard");
    expect(sanitizeRedirectPath(undefined)).toBe("/dashboard");
    expect(sanitizeRedirectPath("")).toBe("/dashboard");
    expect(sanitizeRedirectPath("   ")).toBe("/dashboard");
  });

  test("honors a custom fallback", () => {
    expect(sanitizeRedirectPath(null, "/login")).toBe("/login");
  });

  test("rejects absolute URLs", () => {
    expect(sanitizeRedirectPath("https://evil.example.com")).toBe("/dashboard");
    expect(sanitizeRedirectPath("http://evil.example.com/path")).toBe(
      "/dashboard",
    );
    expect(sanitizeRedirectPath("javascript:alert(1)")).toBe("/dashboard");
  });

  test("rejects scheme-relative hosts", () => {
    expect(sanitizeRedirectPath("//evil.example.com")).toBe("/dashboard");
  });

  test("rejects backslash tricks", () => {
    expect(sanitizeRedirectPath("/\\evil.example.com")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/safe\\..\\..\\win")).toBe("/dashboard");
  });

  test("rejects embedded control characters that could split headers", () => {
    expect(sanitizeRedirectPath("/dash\r\nSet-Cookie: x=y")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/dash\u0000hidden")).toBe("/dashboard");
  });

  test("trims harmless surrounding whitespace", () => {
    expect(sanitizeRedirectPath("  /dashboard  ")).toBe("/dashboard");
    expect(sanitizeRedirectPath("/dash\n")).toBe("/dash");
  });

  test("rejects values without a leading slash", () => {
    expect(sanitizeRedirectPath("dashboard")).toBe("/dashboard");
  });

  test("rejects oversized targets", () => {
    expect(sanitizeRedirectPath(`/${"a".repeat(2048)}`)).toBe("/dashboard");
  });
});

describe("isSameOriginRelativePath", () => {
  test("is true only for clean relative paths", () => {
    expect(isSameOriginRelativePath("/orders/123")).toBe(true);
    expect(isSameOriginRelativePath("//evil.example.com")).toBe(false);
    expect(isSameOriginRelativePath("https://x")).toBe(false);
    expect(isSameOriginRelativePath("")).toBe(false);
    expect(isSameOriginRelativePath(null)).toBe(false);
  });
});
