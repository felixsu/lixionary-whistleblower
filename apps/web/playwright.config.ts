import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "test",
  timeout: 120000,
  expect: { timeout: 15000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: process.env.BROWSER_BASE_URL ?? "http://localhost:9551",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-id", use: { ...devices["Pixel 7"] } },
  ],
});
