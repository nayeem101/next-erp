import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resetPublicEnvCacheForTests } from "@/lib/env/public";
import { createProxyClient } from "@/lib/supabase/proxy";

import type { CookieMethodsServer } from "@supabase/ssr";

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

interface CapturedCookie {
  name: string;
  value: string;
}

function createProxyRequest(initialCookies: CapturedCookie[] = []) {
  const store = [...initialCookies];
  const setMock = vi.fn((name: string, value: string) => {
    const existingIndex = store.findIndex((cookie) => cookie.name === name);

    if (existingIndex >= 0) {
      store[existingIndex] = { name, value };
    } else {
      store.push({ name, value });
    }
  });

  return {
    cookies: store,
    request: {
      cookies: {
        getAll: () => [...store],
        set: setMock,
      },
    },
  };
}

function getCapturedCookieMethods() {
  const call = mocks.createServerClient.mock.calls.at(-1);

  if (!call) {
    throw new Error("createServerClient was not called");
  }

  const cookies = (call[2] as { cookies?: CookieMethodsServer } | undefined)
    ?.cookies;

  if (!cookies?.getAll || !cookies.setAll) {
    throw new Error("cookie adapter was not provided");
  }

  return { getAll: cookies.getAll, setAll: cookies.setAll };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = publicEnv.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  resetPublicEnvCacheForTests();
});

afterEach(() => {
  Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_URL");
  Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  resetPublicEnvCacheForTests();
});

describe("createProxyClient", () => {
  test("builds the client from public environment values", () => {
    createProxyClient(createProxyRequest().request as never);

    const call = mocks.createServerClient.mock.calls.at(-1) as
      [url: string, publishableKey: string] | undefined;

    if (!call) {
      throw new Error("createServerClient was not called");
    }

    const [url, publishableKey] = call;

    expect(url).toBe(publicEnv.NEXT_PUBLIC_SUPABASE_URL);
    expect(publishableKey).toBe(publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  });

  test("reads session cookies from the incoming request", () => {
    const { request, cookies } = createProxyRequest([
      { name: "sb-project-auth-token", value: "incoming-token" },
    ]);

    const client = createProxyClient(request as never);
    void client;

    expect(getCapturedCookieMethods().getAll()).toEqual([
      { name: "sb-project-auth-token", value: "incoming-token" },
    ]);
    expect(cookies).toHaveLength(1);
  });

  test("propagates refreshed auth cookies onto the outgoing response and request", async () => {
    const { request } = createProxyRequest([
      { name: "sb-project-auth-token", value: "stale-token" },
    ]);

    const { getResponse } = createProxyClient(request as never);

    await getCapturedCookieMethods().setAll(
      [
        {
          name: "sb-project-auth-token",
          value: "refreshed-token",
          options: { httpOnly: true, sameSite: "lax" as const, path: "/" },
        },
        {
          name: "sb-project-auth-token-refresh",
          value: "refreshed-refresh-token",
          options: { httpOnly: true, sameSite: "lax" as const, path: "/" },
        },
      ],
      {},
    );

    const response = getResponse();

    expect(response.cookies.get("sb-project-auth-token")?.value).toBe(
      "refreshed-token",
    );
    expect(response.cookies.get("sb-project-auth-token-refresh")?.value).toBe(
      "refreshed-refresh-token",
    );
    expect(getCapturedCookieMethods().getAll()).toEqual([
      { name: "sb-project-auth-token", value: "refreshed-token" },
      {
        name: "sb-project-auth-token-refresh",
        value: "refreshed-refresh-token",
      },
    ]);
  });

  test("sets cache-prevention headers required when auth cookies change", async () => {
    const { request } = createProxyRequest();

    const { getResponse } = createProxyClient(request as never);

    const cacheHeaders = {
      "Cache-Control": "private, no-cache, no-store, must-revalidate",
      Expires: "0",
      Pragma: "no-cache",
    };

    await getCapturedCookieMethods().setAll(
      [
        {
          name: "sb-project-auth-token",
          value: "refreshed-token",
          options: {},
        },
      ],
      cacheHeaders,
    );

    const response = getResponse();

    for (const [key, value] of Object.entries(cacheHeaders)) {
      expect(response.headers.get(key)).toBe(value);
    }
  });
});
