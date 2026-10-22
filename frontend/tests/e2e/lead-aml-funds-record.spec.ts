import { expect, test, type Page } from "@playwright/test";

// One source of the source of funds per person (owner decision 2026-10-23):
// the AML form of the staff wizard edits the patient's own record — the
// lead's answer of the cabinet — and marks it as entered by staff; it keeps
// no copy of its own. Mocked API, synthetic data.

const leadId = "00000000-0000-0000-0000-000000000222";

type Json = Record<string, unknown>;

const declaration = (patch: Json = {}): Json => ({
  payer_kind: "self",
  acts_on_own_account: true,
  own_account_answered: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
  source_of_funds: null,
  source_of_funds_description: null,
  source_of_funds_document_id: null,
  self_funds_source: "income",
  self_funds_description: "Gehalt",
  self_funds_entered_by: "lead",
  payer_type: null,
  first_name: null,
  last_name: null,
  date_of_birth: null,
  place_of_birth: null,
  street: null,
  zip: null,
  city: null,
  country: null,
  citizenships: [],
  relationship: null,
  email: null,
  phone: null,
  payer_informed_at: null,
  payer_informed_by: null,
  updated_at: "2026-10-23T08:00:00Z",
  ...patch,
});

const funds = (description: string, enteredBy: "lead" | "staff"): Json => ({
  payer_pays: false,
  relevant: "patient",
  patient: {
    person: "patient",
    sources: ["income"],
    description,
    entered_by: enteredBy,
    stated: true,
    text: `Einkommen: ${description}`,
    proof_documents: [],
  },
  payer: null,
  payer_stated_by_patient: null,
});

const status = {
  complete: true,
  missing: [],
  source_of_funds_required: true,
  cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
  order_id: null,
  order_number: null,
  client_signed_order: false,
  agency_signed_order: false,
  agency_may_sign: false,
  agency_blocking: [],
  aml_countries: [],
};

async function mount(page: Page) {
  const saves: Json[] = [];
  let stored = { declaration: declaration(), status, funds: funds("Gehalt", "lead") };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-aml-funds-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let response: unknown = [];
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
    } else if (path === `/leads/${leadId}/enhanced-check`) {
      response = { required: true, reasons: ["risk_assessment"], countries: [] };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as Json;
        saves.push(body);
        // The server writes the patient's one record and marks it as staff's.
        const description = typeof body.self_funds_description === "string" ? body.self_funds_description : "Gehalt";
        stored = {
          declaration: declaration({ self_funds_description: description, self_funds_entered_by: "staff", updated_at: "2026-10-23T08:05:00Z" }),
          status,
          funds: funds(description, "staff"),
        };
      }
      response = stored;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-aml-funds-harness", (route) =>
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
  await page.goto("/lead-aml-funds-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Оформление обращения", exact: true });
  await wizard.getByRole("tab", { name: "Документы", exact: false }).click();
  return { wizard, saves };
}

test("the AML form edits the lead's own record of the funds and marks it as staff's", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard, saves } = await mount(page);
  const section = wizard.getByTestId("lead-wizard-enhanced-check-section");
  await section.getByRole("button", { name: "Заполнить проверку" }).click();
  const sheet = page.getByRole("dialog", { name: "Усиленная AML-проверка (ориентир § 15 GwG)" });
  const own = sheet.getByTestId("lead-payer-own-funds");

  // The lead's answer is the record; there is no second field of staff's own.
  await expect(own.getByTestId("lead-payer-own-funds-author")).toHaveText("Указал пациент в кабинете");
  await expect(own.getByRole("combobox", { name: "Источник средств пациента" })).toContainText("Доход");
  const words = own.getByRole("textbox", { name: "Описание источника средств пациента" });
  await expect(words).toHaveValue("Gehalt");
  await expect(sheet.getByRole("combobox", { name: "Источник средств", exact: true })).toHaveCount(0);

  // Staff correct the words: the same record is saved, marked as staff's.
  await words.fill("Gehalt als Lehrerin");
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  const body = saves[saves.length - 1];
  expect(body).toMatchObject({
    payer_kind: "self",
    self_funds_source: "income",
    self_funds_description: "Gehalt als Lehrerin",
    source_of_funds: null,
  });
  await expect(own.getByTestId("lead-payer-own-funds-author")).toHaveText("Внесено сотрудником");

  await sheet.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-aml-funds-record-ru.png"), animations: "disabled" });
});
