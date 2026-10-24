import { expect, test, type Page } from "@playwright/test";

// The GwG sheet for legal entities (owner decision 2026-10-22): a company,
// an organisation or an insurer that pays gets "Dokumentationsbogen –
// Identifizierung juristischer Personen" in the documents step of the staff
// wizard instead of a note; its "confirm signature" is refused while the
// organisation's data are incomplete, with the way to "who pays". Mocked
// API, synthetic data.

const leadId = "00000000-0000-0000-0000-000000000222";
const sheetName = "Dokumentationsbogen juristische Personen · Beispiel GmbH · 22.10.2026";

type Json = Record<string, unknown>;

const company: Json = {
  payer_kind: "third_party",
  payer_type: "company",
  organisation_name: "Beispiel GmbH",
  acts_on_own_account: true,
  own_account_answered: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
  source_of_funds: null,
  source_of_funds_description: null,
  source_of_funds_document_id: null,
  first_name: null,
  last_name: null,
  date_of_birth: null,
  place_of_birth: null,
  street: "Ringstr. 9",
  zip: "1010",
  city: "Wien",
  country: "AT",
  citizenships: [],
  relationship_kind: "employer",
  relationship: null,
  email: "office@example.com",
  phone: null,
  payer_informed_at: "2026-10-20T09:00:00Z",
  payer_informed_by: null,
  contact_consent_at: "2026-10-20T09:30:00Z",
  updated_at: "2026-10-20T09:15:00Z",
};

/** The stored sheet for legal entities of the company. */
const legalEntitySheet: Json = {
  id: "gwg-org-1",
  patient_id: null,
  lead_id: leadId,
  has_active_patient_portal_user: true,
  order_id: null,
  appointment_id: null,
  patient_pid: null,
  patient_name: null,
  order_number: null,
  appointment_title: null,
  document_number: "GWG-20261022-0001",
  auto_name: sheetName,
  original_filename: `${sheetName}.pdf`,
  art: "gwg_identification",
  category: "compliance_aml",
  status: "active",
  visibility: "internal",
  is_medical: false,
  mime_type: "application/pdf",
  file_size: 2048,
  has_stored_file: true,
  generated_template_id: "gwg_identification",
  generated_bindings: { gwg_identification: { subject: "payer", form: "legal_entity" } },
  signed_at: null,
  compliance_kind: null,
  version_root_document_id: "gwg-org-1",
  replaces_document_id: null,
  superseded_by_document_id: null,
  version_number: 1,
  version_count: 1,
  is_latest_version: true,
  file_deleted_at: null,
  created_at: "2026-10-22T08:00:00Z",
  updated_at: "2026-10-22T08:00:00Z",
  share_count: 0,
  shared_to_current: false,
  deletion_protected: false,
  data_sensitivity: "standard",
  needs_categorization: false,
  classification_suggestion: null,
};

/** What the server lists as missing for the company's sheet. */
const incomplete = {
  error: "Unprocessable Entity",
  code: "payer_details_incomplete",
  message: "Complete the paying organisation's details before confirming the signature",
  scope: "payer",
  missing: ["payer_statement_not_submitted", "payer_legal_form", "payer_representative_name", "payer_payment_reason"],
};

async function mount(page: Page, lang: "ru" | "de", documents: Json[]) {
  const calls: Array<{ path: string; body: unknown }> = [];
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-gwg-legal-entity-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    let response: unknown = [];
    if (method !== "GET") {
      calls.push({ path, body: request.postData() ? request.postDataJSON() : null });
    }
    if (path === "/me") {
      response = { id: "qa-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = {
        id: leadId,
        first_name: "Anna",
        last_name: "Muster",
        email: "anna.muster@example.com",
        date_of_birth: "1980-04-02",
        qualification_status: "in_progress",
        intake_model: "patient_first",
        repeat_patient_id: null,
        wizard_state: {},
        services: [],
        attachments: [],
        readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
      };
    } else if (path === `/leads/${leadId}/update` && method === "POST") {
      response = {};
    } else if (path === `/leads/${leadId}/enhanced-check`) {
      response = { required: false, reasons: [], countries: [] };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      response = {
        declaration: company,
        status: {
          complete: true,
          missing: [],
          cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
          order_id: null,
          order_number: null,
          client_signed_order: false,
          agency_signed_order: false,
          agency_may_sign: false,
          agency_blocking: [],
          aml_countries: ["AT"],
        },
      };
    } else if (path === "/documents/generate" && method === "POST") {
      response = {
        id: "gwg-org-new",
        document_number: "GWG-20261022-0002",
        auto_name: sheetName,
        original_filename: `${sheetName}.pdf`,
        mime_type: "application/pdf",
        file_size: 20,
      };
    } else if (path === "/documents" && url.searchParams.get("lead_id") === leadId) {
      // The new sheet is left out, so no preview opens over the wizard.
      response = documents;
    } else if (/^\/documents\/[^/]+\/download$/.test(path)) {
      await route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF\n" });
      return;
    } else if (/^\/documents\/[^/]+\/mark-signed$/.test(path)) {
      await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify(incomplete) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-gwg-legal-entity-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
    }),
  );
  await page.goto("/lead-gwg-legal-entity-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  return { wizard, calls, sheetActions: wizard.getByTestId("gwg-identification-actions") };
}

test("a paying company gets the sheet for legal entities instead of a note", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard, calls, sheetActions } = await mount(page, "ru", []);

  await expect(wizard.getByText("Листы идентификации по GwG", { exact: true })).toBeVisible();
  await expect(wizard.getByTestId("gwg-identification-payer-organisation")).toHaveCount(0);
  await expect(sheetActions.getByRole("button", { name: "Сформировать для плательщика", exact: true })).toHaveCount(0);
  const generate = sheetActions.getByRole("button", { name: "Сформировать для организации-плательщика", exact: true });
  await expect(generate).toBeEnabled();
  await sheetActions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-legal-entity-actions-ru.png"), animations: "disabled" });

  await generate.click();
  await expect.poll(() => calls.filter((call) => call.path === "/documents/generate").length).toBe(1);
  const body = calls.find((call) => call.path === "/documents/generate")?.body as Json;
  // The server picks the form from the payer; the wizard only says whose sheet.
  expect(body).toMatchObject({
    template_id: "gwg_identification",
    lead_id: leadId,
    language: "de",
    bindings: { gwg_identification: { subject: "payer" } },
  });
  expect(body).not.toHaveProperty("auto_name");
  expect(body).not.toHaveProperty("replace_document_id");
});

test("a refused confirmation names the organisation's missing data and leads to who pays", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard, calls, sheetActions } = await mount(page, "ru", [legalEntitySheet]);

  // The company has a sheet: the button updates it.
  await expect(sheetActions.getByRole("button", { name: "Обновить для организации-плательщика", exact: true })).toBeVisible();
  const row = wizard.getByRole("button", { name: `${sheetName}.pdf` }).locator("xpath=ancestor::div[contains(@class,'px-3')][1]");
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button", { name: "Подтвердить подпись" }).click();
  const refusal = wizard.locator('[data-document-row-error="gwg-org-1"]');
  await expect(refusal.locator("[data-document-row-error-text]")).toHaveText(
    "Подтвердить подпись нельзя: не хватает данных организации-плательщика: плательщик ещё не отправил ответы по своей ссылке, правовая форма, представитель организации, причина оплаты. Эти данные организация-плательщик вносит сама по своей ссылке — отправьте или повторите ссылку в разделе «Кто платит»; затем сформируйте лист заново.",
  );
  expect(calls.filter((call) => call.path === "/documents/gwg-org-1/mark-signed")).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-legal-entity-refused-ru.png"), animations: "disabled" });

  await refusal.getByRole("button", { name: "Перейти к плательщику" }).click();
  await expect(refusal).toHaveCount(0);
  await expect(wizard.locator("#lead-wizard-payer-declaration")).toBeFocused();
});

test("the preview names the refusal and leads to who pays, in German", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard, sheetActions } = await mount(page, "de", [legalEntitySheet]);

  await expect(wizard.getByText("Dokumentationsbögen (GwG)", { exact: true })).toBeVisible();
  await expect(sheetActions.getByRole("button", { name: "Für zahlende Organisation aktualisieren", exact: true })).toBeVisible();
  await wizard.getByRole("button", { name: `${sheetName}.pdf` }).click();
  const preview = page.getByRole("dialog", { name: `${sheetName}.pdf` });
  await preview.getByRole("button", { name: "Unterschrift bestätigen" }).click();
  await expect(preview.getByRole("alert")).toContainText(
    "Die Unterschrift kann nicht bestätigt werden: Es fehlen Angaben der zahlenden Organisation: Angaben des Kostenübernehmers über den eigenen Zugang fehlen, Rechtsform, vertretungsberechtigte Person, Zweck der Zahlung.",
  );
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-legal-entity-preview-refused-de.png"), animations: "disabled" });
  const jump = preview.getByTestId("lead-document-preview-jump");
  await expect(jump).toHaveText("Zum Kostenübernehmer");
  await jump.click();
  await expect(preview).toHaveCount(0);
  await expect(wizard.getByRole("tab", { name: "Unterlagen", exact: false })).toHaveAttribute("aria-selected", "true");
  // The step scrolls to "who pays"; closing the preview hands the focus back to its row.
  await expect(wizard.locator("#lead-wizard-payer-declaration")).toBeInViewport();
});
