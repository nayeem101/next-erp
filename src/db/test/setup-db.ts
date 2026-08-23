import { readFileSync } from "node:fs";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export function getIntegrationDatabaseUrl(): string {
  const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      "Set INTEGRATION_DATABASE_URL (or DATABASE_URL) to a disposable database for integration tests.",
    );
  }

  return url;
}

/**
 * Prepares the disposable integration database by applying the auth-schema
 * bootstrap and all committed Drizzle migrations. Safe to call repeatedly.
 */
export async function prepareIntegrationDatabase(): Promise<void> {
  const sql = postgres(getIntegrationDatabaseUrl(), { max: 1 });

  try {
    const bootstrapPath = path.resolve("src/db/test/bootstrap.sql");
    await sql.unsafe(readFileSync(bootstrapPath, "utf8"));

    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: path.resolve("src/db/migrations") });
  } finally {
    await sql.end();
  }
}
