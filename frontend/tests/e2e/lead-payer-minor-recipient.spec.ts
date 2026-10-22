import { expect, test, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";

// "Кто платит" of a minor and the invoice recipient in the staff wizard
// (owner decisions 2026-10-19 / 2026-10-11, QA 2026-10-22): a minor never
// pays himself, a parent named as a third party of before is taken over as
// "the parent pays" in one click, the cabinet's "invoice to me" of a minor is
// the answering parent, and the recipient block says where the invoice goes
// without duplicate or empty rows. Mocked API, synthetic data.

const leadId = "00000000-0000-0000-0000-000000000222";
type Json = Record<string, unknown>;

const selfDeclaration: Json = {
  payer_kind: "self", payer_representative_id: null, acts_on_own_account: true, own_account_answered: true,
  beneficial_owner_name: null, beneficial_owner_note: null, source_of_funds: null, source_of_funds_description: null,
  source_of_funds_document_id: null, self_funds_source: null, self_funds_description: null, messenger: null,
  first_name: null, last_name: null, date_of_birth: null, place_of_birth: null, street: null, zip: null, city: null,
  country: null, citizenships: [], relationship: null, email: null, phone: null, payer_informed_at: null, payer_informed_by: null,
  payer_type: null, organisation_name: null, relationship_kind: null, contact_consent_at: null, cost_estimate_consent_at: null,
  invoice_to: "self", invoice_name: null, invoice_street: null, invoice_zip: null, invoice_city: null, invoice_country: null,
  invoice_email: null, invoice_vat_id: null, invoice_tax_number: null, payment_method: "bank_transfer", payment_method_details: null,
  account_country: null, account_holder: null, bank_name: null, via_third_party: null, via_third_party_details: null,
  updated_at: "2026-10-05T09:31:00Z",
};

/** Anna, the mother, stored as a third party before the rule of 2026-10-19. */
const annaAsThirdParty: Json = {
  ...selfDeclaration, payer_kind: "third_party", payer_type: "person", first_name: "Anna", last_name: "Muster",
  date_of_birth: "1985-02-01", street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE", citizenships: ["DE"],
  relationship_kind: "parent", email: "anna@example.com", invoice_to: "payer",
};

const parents = [
  { id: "rep-1", slot: "rep1", relation: "mother", guardian: false, name: "Anna Muster", first_name: "Anna", last_name: "Muster", date_of_birth: "1985-02-01", street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE", citizenships: ["DE"], email: "anna@example.com", phone: null },
  { id: "rep-2", slot: "rep2", relation: "father", guardian: false, name: "Ben Muster", first_name: "Ben", last_name: "Muster", date_of_birth: "1983-05-06", street: "Musterweg 1", zip: "10115", city: "Berlin", country: "DE", citizenships: ["DE", "UA"], email: null, phone: null },
];

function status(patch: Json = {}): Json {
  return {
    complete: false, missing: [], paying_parent: false, minor: true, representatives: parents, payer_representative: null,
    source_of_funds_required: false, contact_consent_required: true, cost_estimate_consent_required: true,
    cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
    order_id: null, order_number: null, client_signed_order: false, agency_signed_order: false, agency_may_sign: false,
    agency_blocking: [], aml_countries: [], payer_package: null, ...patch,
  };
}

type Setup = { lang: "ru" | "de"; declaration: Json; status?: Json; billing?: Json };

async function mount(page: Page, setup: Setup) {
  await startClockAt(page);
  const saves: Json[] = [];
  const state = { declaration: setup.declaration, status: status(setup.status) };
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-payer-minor-recipient-token");
  }, setup.lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "u", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = {
        id: leadId, first_name: "Mia", last_name: "Muster", email: "mia@example.com", primary_language: "ru", date_of_birth: "2014-04-04",
        qualification_status: "in_progress", intake_model: "patient_first", repeat_patient_id: null, wizard_state: {}, services: [], attachments: [],
        readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
      };
    } else if (path === `/leads/${leadId}/portal-intake`) {
      response = {
        lead_id: leadId, fill_mode: "patient", patient_fields: {}, patient_payer: null,
        progress: { filled: 12, total: 12, documents: 0, submitted_at: "2026-10-05T09:40:00Z" },
        submitted_at: "2026-10-05T09:40:00Z", consents: [], uploads: [], uploads_hidden: false,
        guardians: { links: [], candidates: [] }, minor: true, can_issue: true, can_review_uploads: true,
        identification: {}, identity_documents: [],
        ...(setup.billing ? { billing: setup.billing, billing_updated_at: "2026-10-05T09:35:00Z" } : {}),
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      if (request.method() === "POST") {
        const body = request.postDataJSON() as Json;
        saves.push(body);
        // Like the server: a named parent pays as the contracting party, the third party's data go.
        if (body.payer_kind === "representative") {
          const parent = parents.find((person) => person.id === body.payer_representative_id) ?? null;
          state.declaration = { ...selfDeclaration, payer_kind: "representative", payer_representative_id: body.payer_representative_id, invoice_to: "payer" };
          state.status = status({ complete: Boolean(parent), payer_representative: parent, contact_consent_required: false, cost_estimate_consent_required: false });
        }
      }
      response = { declaration: state.declaration, status: state.status };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-payer-minor-recipient-harness", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    // A cold dev server answers "504 Outdated Optimize Dep" on the first import; reload like Vite's client would.
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
  }));
  await page.goto("/lead-payer-minor-recipient-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: setup.lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: setup.lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  return { wizard, section: wizard.locator("#lead-wizard-payer-declaration"), saves };
}

test("a parent stored as a third party of before is taken over as 'the parent pays' in one click", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { section, saves } = await mount(page, {
    lang: "ru",
    declaration: annaAsThirdParty,
    status: { paying_parent: true, payer_representative: parents[0], contact_consent_required: false, cost_estimate_consent_required: false },
  });
  await expect(section.getByTestId("lead-payer-paying-parent")).toBeVisible();
  const convert = section.getByTestId("lead-payer-paying-parent-convert");
  await expect(convert).toHaveText("Записать как «Платит родитель»: Anna Muster");
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-parent-of-before-ru-desktop.png"), animations: "disabled" });

  await convert.click();
  await expect.poll(() => saves.at(-1)).toMatchObject({ payer_kind: "representative", payer_representative_id: "rep-1", first_name: null, street: null });
  await expect(section.getByRole("radio", { name: "Платит родитель / законный представитель" })).toBeChecked();
  await expect(section.getByTestId("lead-payer-representative-card")).toContainText("Anna Muster");
  await expect(section.getByTestId("lead-payer-paying-parent")).toHaveCount(0);
  await expect(section).not.toContainText("Плательщик (третье лицо)");
});

test("a minor's 'patient pays himself' of before asks for the paying parent; the cabinet's 'to me' is the parent", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { section } = await mount(page, {
    lang: "ru",
    declaration: selfDeclaration,
    billing: {
      invoice_recipient: "self", invoice_recipient_is_payer: true, recipient: null, invoice_to: "self",
      invoice_email: "anna@example.com", payment_route_by: "patient", payment_method: "bank_transfer", compliance_flags: [],
    },
  });
  await expect(section.getByRole("radio", { name: "Пациент платит сам" })).toBeChecked();
  await expect(section).toContainText("Ребёнок не платит сам: выберите родителя / законного представителя или третье лицо");
  const recipient = section.getByTestId("lead-payer-invoice-recipient");
  await expect(recipient.getByTestId("lead-payer-recipient-invoice_recipient")).toContainText("Родитель / законный представитель, заполнявший кабинет");
  await expect(recipient).not.toContainText("Пациент (сам");
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-minor-self-ru-desktop.png"), animations: "disabled" });

  // Choosing the parent clears the warning.
  await section.getByRole("radio", { name: "Платит родитель / законный представитель" }).check();
  await expect(section).not.toContainText("Ребёнок не платит сам");
});

test("without any parent on file only the banner says what to do; in German", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { wizard, section } = await mount(page, {
    lang: "de",
    declaration: { ...selfDeclaration, payer_kind: "representative", invoice_to: null },
    status: { representatives: [] },
  });
  await expect(section).toContainText("Bitte zuerst die Eltern / gesetzlichen Vertreter des Kindes im Vertreterblock erfassen.");
  await expect(section).not.toContainText("Zahlenden Elternteil / gesetzlichen Vertreter auswählen");
  // Nobody named a recipient yet: no recipient block with empty rows.
  await expect(section.getByTestId("lead-payer-invoice-recipient")).toHaveCount(0);
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-no-parents-de-mobile.png"), animations: "disabled" });
});

test("an invalid third-party phone is marked and not saved", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { section, saves } = await mount(page, {
    lang: "ru",
    declaration: { ...annaAsThirdParty, first_name: "Olga", relationship_kind: "grandparent", email: "olga@example.com", invoice_to: "payer" },
  });
  const phone = section.getByLabel(/^Телефон/);
  await phone.fill("12-34");
  await expect(section.getByTestId("lead-payer-phone-error")).toContainText("Телефон указан неверно, изменения не сохраняются");
  await page.waitForTimeout(1500);
  expect(saves.some((body) => body.phone === "12-34")).toBe(false);
  await phone.fill("+49 30 1234567");
  await expect(section.getByTestId("lead-payer-phone-error")).toHaveCount(0);
  await expect.poll(() => saves.at(-1)?.phone).toBe("+49 30 1234567");
});
