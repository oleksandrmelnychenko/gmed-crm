import { expect, test } from "@playwright/test";

// fix-98 (owner 2026-11-16): the document table shows one row per document,
// opens the earlier versions under it, marks a version not yet sent for
// signature, and «Изменить согласия» on the Einverständniserklärung row opens
// the patient card's consent dialog.

const core = { agency_processing: true, doctors_to_agency: true, data_system: true };
const person = { name: "Eva Muster", relation: "spouse", phone: "+49 30 1234567", birth_date: "1970-01-02", citizenships: ["DE"], scope_codes: ["all"] };
const choices = { ...core, named_recipients: true, channel_email: true, channel_threema: false, channel_whatsapp: true, channel_telegram: false };
const state = {
  patient_id: "patient-qa",
  version: "2026-10-12",
  max_recipients: 5,
  minor: false,
  can_edit: true,
  requested: { id: "c1", choices, recipients: [person], disclosure_consent_given: true },
  effective: { choices, recipients: [person] },
  pending: { options: [], recipients: [false] },
  history: [],
  documents: [],
  disclosure_text: "Ich willige ausdrücklich ein …",
};

test("document table: earlier versions, signature state and «Изменить согласия»", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "document-versions-test");
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/patients/patient-qa/consent-choices**", (route) => route.fulfill({ json: state }));
  await page.route("**/__document-versions-qa**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/document-versions-table.tsx');
    </script></html>`,
  }));
  await page.goto("/__document-versions-qa");
  // The table rows (the phone card list renders the same cells hidden).
  const inRows = (testId: string) => page.getByRole("row").getByTestId(testId);

  // One row per document; the new version is marked as not sent.
  await expect(inRows("signature-not-sent-ew-3")).toHaveText("Не отправлено на подпись");
  await expect(inRows("version-signed-ew-2")).toHaveCount(0);
  await expect(inRows("document-versions-ew-3")).toContainText("v3 · 3");

  // The toggle opens the earlier versions as sub-rows.
  await inRows("document-versions-toggle-ew-3").click();
  await expect(inRows("version-signed-ew-2")).toHaveText("Подписан 14.11.2026");
  await expect(inRows("version-replaced-ew-1")).toHaveText("Заменён");

  // The action is on the Einverständniserklärung row only, and opens the dialog.
  await expect(inRows("document-row-change-consents")).toHaveCount(1);
  await inRows("document-row-change-consents").click();
  const dialog = page.getByTestId("patient-consent-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("patient-consent-footer").getByRole("button", { name: "Сохранить" })).toBeVisible();
});
