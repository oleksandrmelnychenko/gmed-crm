import { chromium, type FullConfig } from "@playwright/test";
import { warmUpDevServer } from "./dev-server-warm-up";

/** Compiles the app on the e2e dev server once, before the workers start. */
export default async function globalSetup(config: FullConfig) {
  const use = config.projects[0]?.use;
  if (!use?.baseURL) return;
  const browser = await chromium.launch(use.channel ? { channel: use.channel } : {});
  try {
    await warmUpDevServer(browser, use.baseURL);
  } finally {
    await browser.close();
  }
}
