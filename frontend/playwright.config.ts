import { defineConfig, devices } from "@playwright/test";

// The specs mock the API. The dev server they run against must never reach a
// real backend: `.env.development` proxies to the shared DEV environment, so an
// unmocked call would read or even write DEV data. The e2e server therefore
// proxies to a closed port unless E2E_PROXY_TARGET names a disposable backend.
const port = Number(process.env.E2E_PORT ?? 5174);
const baseURL = `http://127.0.0.1:${port}`;
const proxyTarget = process.env.E2E_PROXY_TARGET ?? "http://127.0.0.1:9";
// E2E_CHANNEL=chrome runs the specs in the installed Google Chrome.
const channel = process.env.E2E_CHANNEL;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
      cwd: ".",
      url: `${baseURL}/login`,
      // A dev server started by hand proxies to DEV; reuse it only on request.
      reuseExistingServer: process.env.E2E_REUSE_SERVER === "true",
      timeout: 180_000,
      env: { VITE_PROXY_TARGET: proxyTarget },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
  ],
});
