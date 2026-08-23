import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Default to the disposable docker-compose database (pnpm db:test:start).
// Override with INTEGRATION_DATABASE_URL for any other Postgres target.
process.env.INTEGRATION_DATABASE_URL ??=
  "postgresql://postgres:postgres@127.0.0.1:54329/nexterp_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    include: ["src/**/*.integration.test.{ts,tsx}"],
    passWithNoTests: true,
    restoreMocks: true,
  },
});
