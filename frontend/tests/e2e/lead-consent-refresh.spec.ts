import { expect, test, type Page } from "@playwright/test";
async function open(page: Page) {
  await page.route("**/api/**", route => route.abort());
  await page.route("**/__consent-refresh-qa", route => route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true; await import('/tests/e2e/fixtures/consent-refresh.tsx');</script>` }));
  await page.goto("/__consent-refresh-qa");
}
test("clean consent draft adopts other parent's new choices and recipients", async ({ page }) => {
  await open(page);
  const recipient = page.getByTestId("trusted-persons-list");
  await expect(recipient).toContainText("First Recipient");
  await expect(page.getByTestId("lead-request-consent-form-save")).toBeDisabled();
  await page.getByRole("button", { name: "Refresh other parent" }).click();
  await expect(recipient).toContainText("Second Recipient");
  await expect(page.locator('[data-consent-option="channel_email"]')).toBeChecked();
  await expect(page.getByTestId("lead-request-consent-form-save")).toBeEnabled();
});
test("locally edited consent draft survives a newer server choice", async ({ page }) => {
  await open(page);
  const recipient = page.getByTestId("trusted-persons-list");
  await page.locator('[data-consent-option="channel_threema"]').check();
  await page.getByRole("button", { name: "Refresh other parent" }).click();
  await expect(recipient).toContainText("Second Recipient");
  await expect(page.locator('[data-consent-option="channel_threema"]')).toBeChecked();
  await expect(page.locator('[data-consent-option="channel_email"]')).not.toBeChecked();
  await expect(page.getByTestId("lead-request-consent-form-save")).toBeEnabled();
});
