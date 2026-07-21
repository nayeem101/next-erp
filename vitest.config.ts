import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    clearMocks: true,
    environment: "jsdom",
    exclude: [
      ...configDefaults.exclude,
      "e2e/**",
      "**/*.integration.test.{ts,tsx}",
    ],
    restoreMocks: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/features/**/*.{ts,tsx}"],
      exclude: [
        "src/features/**/__tests__/**",
        "src/features/**/*.test.{ts,tsx}",
        "src/features/**/*.integration.test.{ts,tsx}",
      ],
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
});
