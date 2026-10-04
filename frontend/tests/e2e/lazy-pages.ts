import { expect, type Page } from "@playwright/test";

/**
 * Pages and workspaces load as lazy chunks. A cold Vite dev server compiles a
 * chunk on its first request, which takes longer than the default expect
 * timeout while the whole suite runs in parallel. The first assertion on a
 * freshly opened page waits this long; later ones keep the default.
 */
export const lazyPageLoad = { timeout: 45_000 } as const;

/**
 * Test timeout for flows that log in through the form and then open a heavy
 * workspace: when such a test is the first one of its worker, it also waits
 * for the cold compile of the app shell, login page and dashboard.
 */
export const coldStartTestTimeout = 120_000;

/**
 * Opens the work center and waits until its task manager has rendered. A CSS
 * locator: with `?task=` the modal detail dialog hides the page from the
 * accessibility tree.
 */
export async function openWorkCenter(page: Page, url = "/task-manager") {
  await page.goto(url);
  await expect(
    page.locator('section[aria-label="Менеджер задач"], section[aria-label="Aufgabenmanager"]'),
  ).toBeVisible(lazyPageLoad);
}
