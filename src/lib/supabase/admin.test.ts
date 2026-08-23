import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";

const mocks = vi.hoisted(() => ({
  createSupabaseClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createSupabaseClient,
}));

const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  DATABASE_URL: "postgresql://postgres:password@127.0.0.1:5432/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_key",
  COMPANY_NAME: "NextERP Demo Company",
  COMPANY_EMAIL: "billing@example.com",
  COMPANY_ADDRESS_LINE_1: "100 Market Street",
  COMPANY_ADDRESS_LINE_2: "Suite 4",
  COMPANY_CITY: "San Francisco",
  COMPANY_REGION: "CA",
  COMPANY_POSTAL_CODE: "94105",
  COMPANY_COUNTRY_CODE: "US",
} as const;

beforeEach(() => {
  for (const [key, value] of Object.entries(serverEnv)) {
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }
});

describe("createAdminClient", () => {
  test("authenticates with the secret key and no session persistence", () => {
    createAdminClient();

    const call = mocks.createSupabaseClient.mock.calls.at(-1) as
      | [
          url: string,
          apiKey: string,
          options?: {
            auth?: { autoRefreshToken?: boolean; persistSession?: boolean };
          },
        ]
      | undefined;

    if (!call) {
      throw new Error("createClient was not called");
    }

    const [url, apiKey, options] = call;

    expect(url).toBe(serverEnv.NEXT_PUBLIC_SUPABASE_URL);
    expect(apiKey).toBe(serverEnv.SUPABASE_SECRET_KEY);
    expect(apiKey).not.toBe(serverEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
    expect(options?.auth).toMatchObject({
      autoRefreshToken: false,
      persistSession: false,
    });
  });
});
