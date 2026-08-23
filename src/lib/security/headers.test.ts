import { describe, expect, test } from "vitest";

import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
} from "@/lib/security/headers";

describe("buildSecurityHeaders", () => {
  test("emits the documented baseline headers", () => {
    const headers = Object.fromEntries(
      buildSecurityHeaders({
        supabaseUrl: "https://abc123.supabase.co",
        isDevelopment: false,
      }).map((header) => [header.key, header.value]),
    );

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toContain(
      "frame-ancestors 'none'",
    );
  });

  test("allows only self and the Supabase project for connect-src", () => {
    const csp = buildContentSecurityPolicy({
      supabaseUrl: "https://abc123.supabase.co",
      isDevelopment: false,
    });

    expect(csp).toContain("connect-src 'self' https://abc123.supabase.co");
    expect(csp).toContain("wss://abc123.supabase.co");
  });

  test("keeps production scripts free of unsafe-eval", () => {
    const productionCsp = buildContentSecurityPolicy({
      supabaseUrl: undefined,
      isDevelopment: false,
    });

    expect(productionCsp).not.toContain("'unsafe-eval'");
    expect(productionCsp).toContain("connect-src 'self'");
  });

  test("permits eval in development for React Refresh", () => {
    const developmentCsp = buildContentSecurityPolicy({
      supabaseUrl: undefined,
      isDevelopment: true,
    });

    expect(developmentCsp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });

  test("ignores invalid or non-https Supabase URLs", () => {
    const insecure = buildContentSecurityPolicy({
      supabaseUrl: "http://abc123.supabase.co",
      isDevelopment: false,
    });

    const malformed = buildContentSecurityPolicy({
      supabaseUrl: "::not a url::",
      isDevelopment: false,
    });

    for (const csp of [insecure, malformed]) {
      expect(csp).toContain("connect-src 'self'");
      expect(csp).not.toContain("abc123");
    }
  });
});
