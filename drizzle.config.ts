import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema",
  out: "./src/db/migrations",
  // Drizzle manages only the public schema; auth.users is Supabase-owned.
  schemaFilter: ["public"],
  dbCredentials: {
    // Runtime/migration target; falls back to the disposable test database.
    url: process.env.DATABASE_URL ?? process.env.INTEGRATION_DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
