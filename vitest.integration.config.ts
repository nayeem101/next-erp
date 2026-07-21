import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    environment: "node",
    include: ["src/**/*.integration.test.{ts,tsx}"],
    passWithNoTests: true,
    restoreMocks: true,
    // Integration suites target Postgres once Drizzle and disposable databases land.
  },
});
