import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";
import { getServerEnv } from "@/lib/env/server";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type Database = PostgresJsDatabase<typeof schema>;

let cachedDb: Database | undefined;
let cachedClient: postgres.Sql | undefined;

/**
 * Returns the process-wide server-only Drizzle instance.
 *
 * `prepare: false` is required because the Supabase Supavisor transaction-mode
 * pooler does not support prepared statements. The DATABASE_URL must hold
 * restricted runtime credentials (never the migration or secret-key role).
 */
export function getDb(): Database {
  if (!cachedDb) {
    const { DATABASE_URL } = getServerEnv();

    cachedClient = postgres(DATABASE_URL, {
      prepare: false,
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });

    cachedDb = drizzle(cachedClient, { schema });
  }

  return cachedDb;
}

export function resetDbCacheForTests(): void {
  void cachedClient?.end({ timeout: 1 });
  cachedDb = undefined;
  cachedClient = undefined;
}
