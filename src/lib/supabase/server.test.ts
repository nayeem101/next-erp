import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resetPublicEnvCacheForTests } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/server";

import type { CookieMethodsServer } from "@supabase/ssr";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
} as const;

interface CapturedCookie {
  name: string;
  value: string;
}

function givenCookieStore(initialCookies: CapturedCookie[] = []) {
  const store = [...initialCookies];
  const setMock = vi.fn();

  mocks.cookies.mockResolvedValue({
    getAll: () => [...store],
    set: setMock,
  });

  return { store, setMock };
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

describe("createClient (server)", () => {
  test("builds the client from public environment values", async () => {
    await createClient();

    const call = mocks.createServerClient.mock.calls.at(-1) as
      [url: string, publishableKey: string] | undefined;

    if (!call) {
      throw new Error("createServerClient was not called");
    }

    const [url, publishableKey] = call;

    expect(url).toBe(publicEnv.NEXT_PUBLIC_SUPABASE_URL);
    expect(publishableKey).toBe(publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  });

  test("reads session cookies through the request cookie store", async () => {
    const { store } = givenCookieStore([
      { name: "sb-project-auth-token", value: "token-value" },
    ]);

    const client = await createClient();
    void client;

    expect(getCapturedCookieMethods().getAll()).toEqual([
      { name: "sb-project-auth-token", value: "token-value" },
    ]);
    expect(store).toHaveLength(1);
  });

  test("writes each refreshed auth cookie back to the request cookie store", async () => {
    const { setMock } = givenCookieStore();

    const client = await createClient();
    void client;

    expect(() =>
      getCapturedCookieMethods().setAll(
        [
          {
            name: "sb-project-auth-token",
            value: "access-token",
            options: { httpOnly: true, path: "/" },
          },
          {
            name: "sb-project-auth-token-refresh",
            value: "refresh-token",
            options: { httpOnly: true, path: "/" },
          },
        ],
        {},
      ),
    ).not.toThrow();

    expect(setMock).toHaveBeenCalledTimes(2);
    expect(setMock).toHaveBeenNthCalledWith(
      1,
      "sb-project-auth-token",
      "access-token",
      { httpOnly: true, path: "/" },
    );
    expect(setMock).toHaveBeenNthCalledWith(
      2,
      "sb-project-auth-token-refresh",
      "refresh-token",
      { httpOnly: true, path: "/" },
    );
  });

  test("swallows cookie write failures in read-only Server Component contexts", async () => {
    const { setMock } = givenCookieStore();
    setMock.mockImplementation(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });

    const client = await createClient();
    void client;

    expect(() =>
      getCapturedCookieMethods().setAll(
        [
          {
            name: "sb-project-auth-token",
            value: "access-token",
            options: {},
          },
        ],
        {},
      ),
    ).not.toThrow();
  });
});
