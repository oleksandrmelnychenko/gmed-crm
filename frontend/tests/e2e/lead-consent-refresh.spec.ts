import { expect, test, type Page } from "@playwright/test";
async function open(page: Page) {
  await page.route("**/api/**", route => route.abort());
  await page.route("**/__consent-refresh-qa", route => route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true; await import('/tests/e2e/fixtures/consent-refresh.tsx');</script>` }));
  await page.goto("/__consent-refresh-qa");
}
test("clean consent draft adopts other parent's new choices and recipients", async ({ page }) => {
  await open(page);
  // The step-4 answer as one line, the people are listed on step 4 only (owner 2026-10-26, C3).
  await expect(page.getByTestId("trusted-persons-list")).toHaveCount(0);
  await expect(page.locator('[data-consent-option="named_recipients"]')).toHaveCount(0);
  await expect(page.getByTestId("disclosure-saved-status")).toHaveText("Information for third parties: Yes, 1 person");
  await expect(page.getByTestId("lead-request-consent-form-save")).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh other parent" }).click();
  await expect(page.getByTestId("lead-request-consent-form-state")).toContainText("was saved by the other parent or representative");
  await expect(page.locator('[data-consent-option="channel_email"]')).toBeChecked();
  await expect(page.getByTestId("lead-request-consent-form-save")).toHaveCount(0);
});

test("saving channels keeps disclosure read-only and asks the server for canonical scoped people", async ({ page }) => {
  await open(page);
  let body: Record<string, unknown> | undefined;
  const bodies: Record<string, unknown>[] = [];
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/**/consent-choices", async route => {
    body = route.request().postDataJSON();
    bodies.push(body!);
    if (bodies.length === 1) await pending;
    return route.fulfill({ json: {} });
  });
  await page.route("**/api/**/lead-requests/synthetic-lead", route => route.fulfill({ json: {
    lead_id: "synthetic-lead", access_kind: "guardian", minor: true,
    trusted_persons: [{ name: "First Recipient", relation: "other", scope: "Invoices only" }],
    disclosure: { allow_disclosure: true, consent_given: true, version: "2026-10-14", language: "en", chosen_at: "2026-10-14T08:00:00Z", chosen_by: "guardian-a", access_kind: "guardian", company_name: "Example Clinic" },
    consent_form: { version: "v1", chosen_at: "2026-10-14T09:00:00Z", choices: body?.choices },
  } }));
  // The cabinet no longer offers Threema (owner polish 2026-10-29); Telegram stands in.
  await page.locator('[data-consent-option="channel_telegram"]').check();
  await expect.poll(() => bodies.length).toBe(1);
  await page.locator('[data-consent-option="channel_email"]').check();
  release();
  await expect.poll(() => bodies.length).toBe(2);
  // The own saved choice has no receipt sentence of its own (labels audit 2026-10-26, B8).
  await expect(page.getByTestId("lead-request-consent-form-state")).not.toContainText("Your choice of");
  await expect(page.getByTestId("lead-request-consent-form-save")).toHaveCount(0);
  expect(body).toMatchObject({ choices: { named_recipients: true, channel_telegram: true, channel_email: true }, recipients: [] });
  await expect(page.locator('[data-consent-option="channel_email"]')).toBeChecked();
  await expect(page.getByTestId("disclosure-saved-status")).toHaveText("Information for third parties: Yes, 1 person");
});
test("locally edited consent draft survives a newer server choice", async ({ page }) => {
  await open(page);
  await page.locator('[data-consent-option="channel_telegram"]').check();
  await page.getByRole("button", { name: "Refresh other parent" }).click();
  await expect(page.getByTestId("lead-request-consent-form-state")).toContainText(/not saved yet|was saved by the other parent/);
  await expect(page.locator('[data-consent-option="channel_telegram"]')).toBeChecked();
  await expect(page.locator('[data-consent-option="channel_email"]')).not.toBeChecked();
  await expect(page.getByTestId("lead-request-consent-form-save")).toHaveCount(0);
});
