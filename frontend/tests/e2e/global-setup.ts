import { chromium, type FullConfig } from "@playwright/test";

/**
 * Warms the Vite dev server before the first spec: on a cold server the first
 * page load compiles the app shell for 30–40 s, which used to time out the
 * first test of a run. The API is not called for real (the e2e server proxies
 * to a closed port), so the login page is enough to compile the shell.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) return;
  const channel = config.projects[0]?.use.channel;
  const browser = await chromium.launch(channel ? { channel } : {});
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`, { waitUntil: "networkidle", timeout: 180_000 });
  } catch (error) {
    // A failed warm-up only makes the first spec slower; the specs report real problems.
    console.warn(`e2e warm-up skipped: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await browser.close();
  }
}
