import { sql } from "drizzle-orm";
import { afterAll, describe, expect, test } from "vitest";

import { getDb, resetDbCacheForTests } from "@/db";

const databaseUrl =
  process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

const d = databaseUrl ? describe : describe.skip;

// getServerEnv validates the full server contract before the client may
// connect; integration runs only need to provide the disposable database URL.
const requiredServerEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_key",
  SUPABASE_SECRET_KEY: "sb_secret_test_key",
  COMPANY_NAME: "NextERP Demo Company",
  COMPANY_EMAIL: "billing@example.com",
  COMPANY_ADDRESS_LINE_1: "100 Market Street",
  COMPANY_CITY: "San Francisco",
  COMPANY_POSTAL_CODE: "94105",
  COMPANY_COUNTRY_CODE: "US",
} as const;

for (const [key, value] of Object.entries(requiredServerEnv)) {
  process.env[key] ??= value;
}

afterAll(() => {
  resetDbCacheForTests();
});

d("database connection smoke", () => {
  test("executes a query through Drizzle over the pooled client", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL was not configured");
    }

    process.env.DATABASE_URL = databaseUrl;
    resetDbCacheForTests();

    const db = getDb();

    try {
      const rows = await db.execute(sql`select 1 as one`);

      expect(rows[0]?.one).toBe(1);
    } finally {
      resetDbCacheForTests();
    }
  });

  test("runs queries inside a transaction", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL was not configured");
    }

    process.env.DATABASE_URL = databaseUrl;
    resetDbCacheForTests();

    const db = getDb();

    try {
      const result = await db.transaction(async (tx) => {
        const rows = await tx.execute(sql`select 2 as two`);

        return rows[0]?.two;
      });

      expect(result).toBe(2);
    } finally {
      resetDbCacheForTests();
    }
  });
});
