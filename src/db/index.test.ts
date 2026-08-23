import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getDb, resetDbCacheForTests } from "@/db";

const mocks = vi.hoisted(() => ({
  postgres: vi.fn(),
  drizzle: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: mocks.postgres,
}));

vi.mock("drizzle-orm/postgres-js", () => ({
  drizzle: mocks.drizzle,
}));

const serverEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  DATABASE_URL:
    "postgresql://app_runtime:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
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

  mocks.postgres.mockImplementation(() => ({ end: vi.fn() }));
  mocks.drizzle.mockImplementation(() => ({ $client: {} }));
});

afterEach(() => {
  resetDbCacheForTests();

  for (const key of Object.keys(serverEnv)) {
    Reflect.deleteProperty(process.env, key);
  }
});

describe("getDb", () => {
  test("creates one Drizzle instance over a pooled postgres.js client", () => {
    const db = getDb();
    void db;

    expect(mocks.drizzle).toHaveBeenCalledTimes(1);

    const call = mocks.drizzle.mock.calls.at(-1) as
      [client: unknown] | undefined;

    if (!call) {
      throw new Error("drizzle was not called");
    }

    const [client] = call;

    expect(client).toBe(mocks.postgres.mock.results[0]?.value);
  });

  test("disables prepared statements for the transaction-mode pooler", () => {
    const db = getDb();
    void db;

    expect(mocks.postgres).toHaveBeenCalledWith(
      serverEnv.DATABASE_URL,
      expect.objectContaining({ prepare: false }),
    );

    const call = mocks.postgres.mock.calls.at(-1) as
      [url: string, options?: Record<string, unknown>] | undefined;

    if (!call) {
      throw new Error("postgres was not called");
    }

    const [url] = call;

    expect(url).toBe(serverEnv.DATABASE_URL);
  });

  test("caches the instance across calls", () => {
    const first = getDb();
    const second = getDb();

    expect(second).toBe(first);
    expect(mocks.drizzle).toHaveBeenCalledTimes(1);
  });

  test("rebuilds the client after the test cache reset", () => {
    const first = getDb();
    void first;

    resetDbCacheForTests();

    const second = getDb();

    expect(second).not.toBe(first);
    expect(mocks.drizzle).toHaveBeenCalledTimes(2);
  });
});
