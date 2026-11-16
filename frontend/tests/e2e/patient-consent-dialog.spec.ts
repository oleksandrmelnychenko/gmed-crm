import { expect, test, type Page } from "@playwright/test";

const SHOTS = process.env.FIX92_SHOTS;

const core = { agency_processing: true, doctors_to_agency: true, data_system: true };
const person = { name: "Eva Muster", relation: "spouse", phone: "+49 30 1234567", birth_date: "1970-01-02", citizenships: ["DE"], scope_codes: ["all"] };

const state = {
  patient_id: "patient-qa",
  version: "2026-10-12",
  max_recipients: 5,
  minor: false,
  can_edit: true,
  requested: {
    id: "c1",
    choices: { ...core, named_recipients: true, channel_email: true, channel_threema: false, channel_whatsapp: true, channel_telegram: false },
    recipients: [person],
    disclosure_consent_given: true,
  },
  effective: {
    choices: { ...core, named_recipients: true, channel_email: true, channel_threema: false, channel_whatsapp: true, channel_telegram: false },
    recipients: [person],
  },
  pending: { options: [], recipients: [false] },
  history: [],
  documents: [],
  disclosure_text: "Ich willige ausdrücklich ein …",
};

async function openDialog(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "consent-dialog-test");
  });
  const posts: unknown[] = [];
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/patients/patient-qa/consent-choices**", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ json: state });
      return;
    }
    await route.fulfill({ json: state });
  });
  await page.route("**/__patient-consent-dialog-qa**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/patient-consent-dialog.tsx');
    </script></html>`,
  }));
  await page.goto(`/__patient-consent-dialog-qa${theme === "dark" ? "?dark" : ""}`);
  await page.getByTestId("patient-consent-edit").click();
  const dialog = page.getByTestId("patient-consent-dialog");
  await expect(dialog).toBeVisible();
  return { dialog, posts };
}

test("staff consent dialog: card sections, short labels, footer actions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { dialog, posts } = await openDialog(page);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop.png`, animations: "disabled" });

  // Short staff labels; the cabinet's explanatory wording stays in the cabinet.
  await expect(dialog.getByText("Телефон", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Гражданство", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Кем приходится", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/если несколько/)).toHaveCount(0);

  // Отмена, then the primary action, in the sticky footer.
  const footer = dialog.getByTestId("patient-consent-footer");
  const buttons = footer.getByRole("button");
  await expect(buttons).toHaveText(["Отмена", "Сохранить"]);
  await expect(footer.getByRole("button", { name: "Сохранить" })).toBeDisabled();

  // A change without «Как клиент сообщил» is held at that field.
  await dialog.getByTestId("patient-consent-channel_telegram").check();
  await footer.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog.getByTestId("patient-consent-record-how-error")).toBeVisible();
  await expect(footer.getByTestId("patient-consent-error")).toBeVisible();
  expect(posts).toHaveLength(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/desktop-how-required.png`, animations: "disabled" });
  await dialog.getByTestId("patient-consent-given").check();
  await footer.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog.locator("#patient-consent-record-how")).toBeFocused();
  await expect(footer.getByTestId("patient-consent-error")).toHaveCount(0);
  expect(posts).toHaveLength(0);

  await dialog.locator("#patient-consent-record-how").click();
  await page.getByRole("option", { name: "Телефон" }).click();
  await footer.getByRole("button", { name: "Сохранить" }).click();
  await expect(dialog).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect((posts[0] as { recorded_how?: string }).recorded_how).toBe("phone");
});

test("staff consent dialog fits a phone in one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog } = await openDialog(page);
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await expect(dialog.getByTestId("patient-consent-footer").getByRole("button", { name: "Сохранить" })).toBeInViewport();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone.png`, animations: "disabled" });
});

test("staff consent dialog in dark mode", async ({ page }) => {
  test.skip(!SHOTS, "screenshot only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDialog(page, "dark");
  await page.screenshot({ path: `${SHOTS}/desktop-dark.png`, animations: "disabled" });
});
