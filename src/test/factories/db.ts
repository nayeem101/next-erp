import { randomUUID } from "node:crypto";

import postgres from "postgres";

/**
 * Shared integration-test database handle.
 *
 * Integration suites call `initializeTestDatabase()` once in `beforeAll` and
 * then use these helpers so every suite shares one prepared connection.
 */
let sharedSql: postgres.Sql | undefined;

export type Queryable = postgres.Sql | postgres.TransactionSql;

export function getSharedSql(): postgres.Sql {
  if (!sharedSql) {
    throw new Error("Call initializeTestDatabase() before using factories.");
  }

  return sharedSql;
}

export async function initializeTestDatabase(): Promise<postgres.Sql> {
  if (!sharedSql) {
    const { getIntegrationDatabaseUrl, prepareIntegrationDatabase } =
      await import("@/db/test/setup-db");

    await prepareIntegrationDatabase();

    sharedSql = postgres(getIntegrationDatabaseUrl(), { max: 10 });
  }

  return sharedSql;
}

export async function destroyTestDatabase(): Promise<void> {
  if (sharedSql) {
    await sharedSql.end();
    sharedSql = undefined;
  }
}

/**
 * Runs work on a reserved connection wrapped in an explicit transaction that
 * is always rolled back, leaving zero residue between tests.
 *
 * Note: deferred triggers (balanced journals) fire at COMMIT and are skipped
 * by rollback; commit-time assertions should drive real transactions instead.
 */
export async function withRolledBackTransaction(
  work: (db: Queryable) => Promise<void>,
): Promise<void> {
  const { getIntegrationDatabaseUrl } = await import("@/db/test/setup-db");

  const dedicated = postgres(getIntegrationDatabaseUrl(), { max: 1 });
  const reserved = await dedicated.reserve();
  const leased = reserved as unknown as postgres.Sql;

  try {
    await leased.unsafe("begin");
    await work(leased);
  } finally {
    await leased.unsafe("rollback").catch(() => undefined);
    reserved.release();
    await dedicated.end();
  }
}

/** Deterministic UUID generation hook (overridable for reproducible runs). */
let uuidFactory: () => string = randomUUID;

export function setUuidFactoryForTests(factory: () => string): void {
  uuidFactory = factory;
}

export function nextId(): string {
  return uuidFactory();
}

const TEST_EPOCH = Date.UTC(2026, 0, 15, 12, 0, 0);

/** Deterministic timestamp helper: days offset from a fixed test epoch. */
export function fixedDate(daysOffset = 0): Date {
  return new Date(TEST_EPOCH + daysOffset * 24 * 60 * 60 * 1000);
}
