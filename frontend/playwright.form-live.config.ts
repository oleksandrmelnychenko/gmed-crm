import { defineConfig, devices } from "@playwright/test";

// A separately started, disposable server is required. Never default to DEV
// (the regular development proxy) or to the developer's local Docker stack.
const backend = process.env.FORM_LIVE_API_URL;
if (!backend || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(backend)) {
  throw new Error("FORM_LIVE_API_URL must name a disposable loopback API");
}
const port = Number(process.env.FORM_LIVE_PORT ?? 5193);

export default defineConfig({
  testDir: "./tests/e2e-live",
  testMatch: "cabinet-roundtrip.spec.ts",
  outputDir: "../.tmp/form-recheck/live-results",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/login`,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { VITE_PROXY_TARGET: backend },
  },
  projects: [{ name: "chromium", use: {
    ...devices["Desktop Chrome"],
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  } }],
});
