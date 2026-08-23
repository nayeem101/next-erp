import { readFileSync } from "node:fs";

import postgres from "postgres";

const url = process.env.INTEGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  console.error(
    "Set INTEGRATION_DATABASE_URL (or DATABASE_URL) to the disposable test database before bootstrapping.",
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

try {
  const bootstrapPath = new URL(
    "../src/db/test/bootstrap.sql",
    import.meta.url,
  );
  await sql.unsafe(readFileSync(bootstrapPath, "utf8"));
  console.log("Test database auth-schema bootstrap applied.");
} finally {
  await sql.end();
}
