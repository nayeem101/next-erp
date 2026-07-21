import { defineConfig, devices } from "@playwright/test";

import { readE2ETestEnvironment } from "./e2e/environment";

const environment = readE2ETestEnvironment();
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  ...(isCI ? { workers: 1 } : {}),
  use: {
    baseURL: environment.baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  ...(environment.externalServer
    ? {}
    : {
        webServer: {
          command: `pnpm dev --hostname 127.0.0.1 --port ${String(environment.port)}`,
          reuseExistingServer: !isCI,
          timeout: 120_000,
          url: environment.baseURL,
        },
      }),
});
