import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { resetPublicEnvCacheForTests } from "@/lib/env/public";
import { createClient } from "@/lib/supabase/client";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

const publicEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
} as const;

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

describe("createClient (browser)", () => {
  test("builds the client from public environment values", () => {
    const client = createClient();
    void client;

    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  });

  test("returns the created Supabase browser client", () => {
    const stub = { auth: {} };

    mocks.createBrowserClient.mockReturnValue(stub);

    expect(createClient()).toBe(stub);
  });
});
