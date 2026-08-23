/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resetPublicEnvCacheForTests } from "@/lib/env/public";
import { proxy } from "@/proxy";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
} as const;

interface CookieWrite {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

let claimsResult: {
  claims: Record<string, unknown> | null;
  error: Error | null;
};

let pendingCookieWrites: CookieWrite[];

function givenClaims(claims: Record<string, unknown> | null): void {
  claimsResult = { claims, error: null };
}

beforeEach(() => {
  for (const [key, value] of Object.entries(publicEnv)) {
    process.env[key] = value;
  }
  resetPublicEnvCacheForTests();

  pendingCookieWrites = [];
  claimsResult = { claims: null, error: null };

  mocks.createServerClient.mockImplementation(
    (
      _url: string,
      _key: string,
      options: {
        cookies: {
          getAll: () => { name: string; value: string }[];
          setAll: (
            cookies: CookieWrite[],
            headers?: Record<string, string>,
          ) => void;
        };
      },
    ) =>
      ({
        auth: {
          getClaims: () => {
            options.cookies.setAll(pendingCookieWrites);

            return Promise.resolve({
              data: {
                claims:
                  claimsResult.claims === null
                    ? null
                    : ({ sub: "u-1", ...claimsResult.claims } as never),
              },
              error: claimsResult.error,
            });
          },
        },
      }) as never,
  );
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_URL");
  Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  resetPublicEnvCacheForTests();
});

function makeRequest(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`);
}

describe("proxy route protection", () => {
  test("redirects unauthenticated protected requests to login with safe next", async () => {
    givenClaims(null);

    const response = await proxy(makeRequest("/inventory/products?page=2"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Finventory%2Fproducts%3Fpage%3D2",
    );
  });

  test("keeps scheme-relative hosts off the location header entirely", async () => {
    givenClaims(null);

    // A leading "//" path never matches a protected prefix, so the proxy
    // must not emit any redirect/Location for it.
    const response = await proxy(makeRequest("//evil.example.com/admin"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  test.each([
    "/dashboard",
    "/sales/orders",
    "/accounting/ledger",
    "/admin/users",
  ])("protects %s", async (path) => {
    givenClaims(null);

    const response = await proxy(makeRequest(path));

    expect(response.status).toBe(307);
    expect(
      response.headers
        .get("location")
        ?.startsWith("http://localhost:3000/login"),
    ).toBe(true);
  });

  test("allows unauthenticated access to the login page", async () => {
    givenClaims(null);

    const response = await proxy(makeRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  test("redirects the root by authentication state", async () => {
    givenClaims(null);

    const anonymous = await proxy(makeRequest("/"));

    expect(anonymous.status).toBe(307);
    expect(anonymous.headers.get("location")).toBe(
      "http://localhost:3000/login",
    );

    givenClaims({ sub: "u-1" });

    const known = await proxy(makeRequest("/"));

    expect(known.status).toBe(307);
    expect(known.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  test("sends authenticated users away from the login page", async () => {
    givenClaims({ sub: "u-1" });

    const response = await proxy(makeRequest("/login"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/dashboard",
    );
  });

  test("lets authenticated users reach protected paths without redirects", async () => {
    givenClaims({ sub: "u-1" });

    const response = await proxy(makeRequest("/customers"));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  test("propagates refreshed auth cookies onto redirects", async () => {
    givenClaims(null);
    pendingCookieWrites = [
      {
        name: "sb-project-auth-token",
        value: "refreshed",
        options: { httpOnly: true },
      },
    ];

    const response = await proxy(makeRequest("/dashboard"));

    expect(response.status).toBe(307);
    expect(response.cookies.get("sb-project-auth-token")?.value).toBe(
      "refreshed",
    );
  });

  test("stamps a correlation ID on passthrough responses", async () => {
    givenClaims(null);

    const response = await proxy(makeRequest("/health"));

    const correlationId = response.headers.get("x-correlation-id");

    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("reuses an incoming correlation ID when present", async () => {
    givenClaims(null);

    const request = new NextRequest("http://localhost:3000/health");
    request.headers.set("x-correlation-id", "incoming-id");

    const response = await proxy(request);

    expect(response.headers.get("x-correlation-id")).toBe("incoming-id");
  });
});
