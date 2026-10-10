import { expect, test, type Page } from "@playwright/test";

// The lead's own GwG statements in the documents step of the staff wizard:
// read-only, beside the GwG identification sheet. Mocked API, synthetic data.

// The lead the wizard harness opens through "Lead intake".
const leadId = "00000000-0000-0000-0000-000000000222";

const lead = {
  id: leadId,
  first_name: "Anna",
  last_name: "Muster",
  email: "anna.muster@example.com",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  wizard_state: {},
  services: [],
  attachments: [],
  readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
};

const statements = {
  identification: {
    salutation: "ms",
    former_names: "Anna Beispiel",
    birth_place: "Kyiv",
    birth_country: "UA",
    habitual_residence_country: null,
    contact_channels: ["email", "messenger"],
    id_document_type: "passport",
    id_document_number: "FA1234567",
    id_issuing_authority: "Passamt 8031",
    id_issuing_country: "UA",
    id_issued_on: "2015-05-01",
    // Expired long ago, whatever the day the spec runs on.
    id_valid_until: "2025-04-30",
    pep_self: true,
    pep_self_details: "Member of parliament, 2021–2024",
    pep_related: false,
    pep_related_details: null,
    high_risk_country: null,
    high_risk_country_code: null,
    sanctions_links: false,
    sanctions_links_details: null,
    payment_background: "My brother pays for the treatment",
    // 11:30 in Berlin.
    declared_correct_at: "2026-10-05T09:30:00Z",
  },
  // 11:20 in Berlin.
  identification_updated_at: "2026-10-05T09:20:00Z",
  identity_documents: [
    { id: "doc-pass-1", file_name: "pass-front.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: false },
  ],
};

const payerDeclaration = {
  declaration: {
    payer_kind: "third_party",
    acts_on_own_account: false,
    own_account_answered: true,
    beneficial_owner_name: "Viktor Zahler",
    beneficial_owner_note: "02.03.1970, Wien",
    source_of_funds: "savings",
    source_of_funds_description: null,
    source_of_funds_document_id: null,
    first_name: "Viktor",
    last_name: "Zahler",
    date_of_birth: "1970-03-02",
    place_of_birth: "Wien",
    street: "Musterweg 1",
    zip: "1010",
    city: "Wien",
    country: "AT",
    citizenships: ["AT"],
    relationship: "brother",
    email: "viktor.zahler@example.com",
    phone: null,
    payer_informed_at: "2026-10-05T09:00:00Z",
    payer_informed_by: null,
    updated_at: "2026-10-05T09:15:00Z",
  },
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

async function mount(page: Page, lang: "ru" | "de", portalStatements: Record<string, unknown>) {
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-gwg-statements-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "gwg-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = lead;
    } else if (path === `/leads/${leadId}/portal-intake`) {
      response = {
        lead_id: leadId,
        fill_mode: "patient",
        patient_fields: {},
        patient_payer: null,
        progress: { filled: 9, total: 12, documents: 0, submitted_at: null },
        submitted_at: null,
        submitted_by: null,
        consents: [],
        uploads: [],
        uploads_hidden: false,
        guardians: { links: [], candidates: [] },
        minor: false,
        can_issue: true,
        can_review_uploads: true,
        ...portalStatements,
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      response = payerDeclaration;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  // The wizard harness of the repeat-intake spec, under its own address.
  await page.route("**/lead-gwg-statements-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
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
    }),
  );
  await page.goto("/lead-gwg-statements-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  return { wizard, block: wizard.getByTestId("lead-gwg-statements") };
}

test("staff read the lead's GwG statements beside the identification sheet", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, block } = await mount(page, "ru", statements);

  await expect(block).toContainText("Данные от пациента");
  await expect(block.getByTestId("patient-field-badge")).toHaveText("от пациента · 05.10.2026 11:20");

  // Person and identity document; a country code reads as the country's name.
  for (const text of ["Госпожа", "Anna Beispiel", "Kyiv", "Украина", "E-mail, Мессенджер", "Паспорт", "FA1234567", "Passamt 8031", "01.05.2015"]) {
    await expect(block).toContainText(text);
  }
  const validUntil = block.getByTestId("lead-gwg-id-valid-until");
  await expect(validUntil).toContainText("30.04.2025 · срок истёк");
  await expect(validUntil).toHaveAttribute("data-warning", "true");
  await expect(block.getByTestId("lead-gwg-identity-documents")).toContainText("pass-front.pdf · 05.10.2026");

  // Own economic interest comes from the payer declaration.
  await expect(block.getByTestId("lead-gwg-own-account")).toContainText("Нет");
  await expect(block).toContainText("Viktor Zahler · 02.03.1970, Wien");
  await expect(block).toContainText("My brother pays for the treatment");

  // A "yes" stands out with its details; the other answers stay plain.
  const pep = block.getByTestId("lead-gwg-answer-pep_self");
  await expect(pep).toHaveAttribute("data-warning", "true");
  await expect(pep).toContainText("Member of parliament, 2021–2024");
  await expect(block.getByTestId("lead-gwg-answer-pep_related")).not.toHaveAttribute("data-warning", "true");
  // The cabinet no longer asks the high-risk-country question: unanswered, it is not listed (QA 2026-10-10).
  await expect(block.getByTestId("lead-gwg-answer-high_risk_country")).toHaveCount(0);
  await expect(block.getByTestId("lead-gwg-declared-correct")).toHaveText("Подтвердил правильность: 05.10.2026 11:30");

  // Read-only, inside the section of the sheet and above its explanation.
  await expect(block.locator("input, textarea, select, button")).toHaveCount(0);
  const explanation = wizard.getByText(/^Заполняется из заявки:/);
  const blockBox = await block.boundingBox();
  const explanationBox = await explanation.boundingBox();
  expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(explanationBox!.y);
  await expect(wizard.getByTestId("gwg-identification-actions")).toBeVisible();

  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-statements-ru-desktop.png"), animations: "disabled" });
  // On a phone the block must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await block.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-statements-ru-mobile.png"), animations: "disabled" });
});

test("a lead who entered nothing yet gets one line, in German too", async ({ page }) => {
  const { block } = await mount(page, "de", {
    identification: Object.fromEntries(
      Object.keys(statements.identification).map((key) => [key, key === "contact_channels" ? [] : null]),
    ),
    identification_updated_at: null,
    identity_documents: [],
  });
  await expect(block).toContainText("Angaben des Patienten");
  await expect(block.getByTestId("lead-gwg-statements-empty")).toHaveText(
    "Der Patient hat diese Angaben im Portal noch nicht gemacht",
  );
  await expect(block.locator("dl")).toHaveCount(0);
  await expect(block.getByTestId("patient-field-badge")).toHaveCount(0);
});

test("an older backend without the statements does not break the documents step", async ({ page }) => {
  const { wizard, block } = await mount(page, "ru", {});
  await expect(block.getByTestId("lead-gwg-statements-empty")).toHaveText("Пациент ещё не заполнил эти данные в кабинете");
  await expect(wizard.getByTestId("gwg-identification-actions")).toBeVisible();
  // Nothing about a representation or a payment route the server does not send.
  await expect(block.getByTestId("lead-gwg-representation")).toHaveCount(0);
  await expect(block.getByTestId("lead-gwg-billing")).toHaveCount(0);
});

test("an adult's answers about a representative stand after the identity document", async ({ page }) => {
  const { wizard, block } = await mount(page, "ru", {
    ...statements,
    representation: {
      has_representative: true,
      under_guardianship: false,
      custody: null,
      custody_stated: false,
      representatives: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          slot: "agent",
          role: "authorised_representative",
          relation: "representative",
          first_name: "Ben",
          last_name: "Muster",
          date_of_birth: "1984-01-15",
          street: "Musterweg 1",
          zip: "10115",
          city: "Berlin",
          country: "DE",
          id_document_type: "id_card",
          id_document_number: "L01X00T47",
          id_valid_until: "2032-01-31",
          identity_documents: [{ id: "doc-ben-id", file_name: "ben-ausweis.jpg", uploaded_at: "2026-10-05T09:30:00Z", reviewed: false }],
          authority_documents: [{ id: "doc-ben-poa", file_name: "vollmacht.pdf", uploaded_at: "2026-10-05T09:35:00Z", reviewed: true }],
          has_login: false,
          has_data: true,
          contact_origin: "portal",
        },
      ],
    },
    representation_updated_at: "2026-10-05T09:40:00Z",
  });

  const group = block.getByTestId("lead-gwg-representation");
  await expect(group).toContainText("Представительство");
  const acts = group.getByTestId("lead-gwg-has-representative");
  await expect(acts).toContainText("Да");
  await expect(acts).toHaveAttribute("data-warning", "true");
  await expect(group.getByTestId("lead-gwg-under-guardianship")).toContainText("Нет");
  await expect(group.getByTestId("lead-gwg-custody")).toHaveCount(0);
  const person = group.getByTestId("lead-gwg-representative-11111111-1111-4111-8111-111111111111");
  for (const text of [
    "Ben Muster",
    "Уполномоченный представитель",
    "15.01.1984",
    "Musterweg 1, 10115 Berlin, Германия",
    "Удостоверение личности",
    "31.01.2032",
    "ben-ausweis.jpg · 05.10.2026",
    "vollmacht.pdf · 05.10.2026 · просмотрен",
  ]) {
    await expect(person).toContainText(text);
  }
  // The representative of an adult is named on the lead's own sheet: the buttons stay as they are.
  const actions = wizard.getByTestId("gwg-identification-actions");
  await expect(actions.getByRole("button", { name: "Сформировать для пациента", exact: true })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "Для плательщика", exact: true })).toBeVisible();
  // The lead's own badge stays the only one.
  await expect(block.getByTestId("patient-field-badge")).toHaveText("от пациента · 05.10.2026 11:20");
});

test("the parents of a minor are named before anybody opens the cabinet, and a missing one is asked for", async ({ page }) => {
  const untouched = {
    identification: Object.fromEntries(
      Object.keys(statements.identification).map((key) => [key, key === "contact_channels" ? [] : null]),
    ),
    identification_updated_at: null,
    identity_documents: [],
    minor: true,
  };
  const mother = {
    id: "11111111-1111-4111-8111-111111111111",
    slot: "rep1",
    role: "legal_representative",
    relation: "parent",
    first_name: "Anna",
    last_name: "Muster",
    email: "anna.muster@example.com",
    has_login: false,
    has_data: false,
    contact_origin: "staff",
  };
  const { wizard, block } = await mount(page, "ru", {
    ...untouched,
    representation: { has_representative: null, under_guardianship: null, custody: "joint", custody_stated: false, representatives: [mother] },
    representation_updated_at: null,
  });

  await expect(block.getByTestId("lead-gwg-statements-empty")).toHaveText("Пациент ещё не заполнил эти данные в кабинете");
  const group = block.getByTestId("lead-gwg-representation");
  await expect(group).toContainText("Законные представители");
  await expect(group.getByTestId("lead-gwg-custody")).toContainText("не указано — оба родителя");
  const person = group.getByTestId(`lead-gwg-representative-${mother.id}`);
  await expect(person).toContainText("Anna Muster");
  await expect(person.getByTestId("lead-gwg-representative-no-data")).toHaveText("в кабинете ещё не заполнено");
  // Both parents represent the child, and only one is on file.
  const warning = group.getByTestId("lead-gwg-representation-warning");
  await expect(warning).toHaveAttribute("data-warning", "joint_custody_incomplete");
  await expect(warning).toContainText("Ребёнка представляют оба родителя, но указан только один");
  // The sheet is made for the parent, not for the child (this mock has no identification status).
  const actions = wizard.getByTestId("gwg-identification-actions");
  await expect(actions.getByRole("button", { name: "Сформировать для Anna Muster", exact: true })).toBeEnabled();
  await expect(actions.getByRole("button", { name: /пациента/ })).toHaveCount(0);
});

/** Sections 7–8: the invoice to another address, paid in cash through a third party — two compliance flags. */
const cashBilling = {
  billing: {
    invoice_to: "other",
    invoice_name: "Beispiel GmbH",
    invoice_street: "Beispielstraße 2",
    invoice_zip: "10117",
    invoice_city: "Berlin",
    invoice_country: "DE",
    invoice_email: "rechnung@example.com",
    invoice_vat_id: "DE123456789",
    invoice_tax_number: null,
    payment_route_by: "patient",
    payment_method: "cash",
    payment_method_details: null,
    account_country: null,
    account_holder: null,
    bank_name: null,
    via_third_party: true,
    via_third_party_details: "My brother brings the money",
    compliance_flags: ["cash_payment", "third_party_payment"],
  },
  // 11:40 in Berlin.
  billing_updated_at: "2026-10-05T09:40:00Z",
};

test("the invoice recipient and the payment route follow the economic interest; cash and a third party are flagged", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, block } = await mount(page, "ru", { ...statements, ...cashBilling });

  const group = block.getByTestId("lead-gwg-billing");
  await expect(group).toContainText("Счёт и оплата (разделы 7–8 анкеты)");
  await expect(group.getByTestId("patient-field-badge")).toHaveText("от пациента · 05.10.2026 11:40");
  // The lead's own badge stays beside it.
  await expect(block.getByTestId("patient-field-badge")).toHaveCount(2);
  // After the economic interest, before the legal questions.
  const ownAccountBox = await block.getByTestId("lead-gwg-own-account").boundingBox();
  const groupBox = await group.boundingBox();
  const legalBox = await block.getByTestId("lead-gwg-answer-pep_self").boundingBox();
  expect(ownAccountBox!.y).toBeLessThan(groupBox!.y);
  expect(groupBox!.y + groupBox!.height).toBeLessThanOrEqual(legalBox!.y);

  // Section 7: the other address with the country's name, the staff fields.
  await expect(group.getByTestId("lead-gwg-billing-invoice_to")).toContainText("по другому адресу");
  await expect(group.getByTestId("lead-gwg-billing-invoice_name")).toContainText("Beispiel GmbH");
  await expect(group.getByTestId("lead-gwg-billing-invoice_address")).toContainText("Beispielstraße 2, 10117 Berlin, Германия");
  await expect(group.getByTestId("lead-gwg-billing-invoice_email")).toContainText("rechnung@example.com");
  await expect(group.getByTestId("lead-gwg-billing-invoice_tax")).toContainText("USt-IdNr. DE123456789");
  // Section 8: cash and a payment through a third party stand out; no account for cash.
  const method = group.getByTestId("lead-gwg-billing-payment_method");
  await expect(method).toContainText("Наличные");
  await expect(method).toHaveAttribute("data-warning", "true");
  await expect(group.getByTestId("lead-gwg-billing-account_country")).toHaveCount(0);
  const third = group.getByTestId("lead-gwg-billing-via_third_party");
  await expect(third).toContainText("Да");
  await expect(third).toContainText("My brother brings the money");
  await expect(third).toHaveAttribute("data-warning", "true");
  const flag = group.getByTestId("lead-gwg-billing-flag");
  await expect(flag).toHaveText("Требуется проверка комплаенса: наличные, платёж через третье лицо");
  await expect(flag).toHaveClass(/text-amber-700/);
  await expect(group.getByTestId("lead-gwg-billing-by-payer")).toHaveCount(0);
  // Read-only: nothing forces the EDD sheet or blocks anything; staff decide.
  await expect(group.locator("input, textarea, select, button")).toHaveCount(0);
  await expect(wizard.getByTestId("gwg-identification-actions")).toBeVisible();

  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-billing-ru-desktop.png"), animations: "disabled" });
  // On a phone the group must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  expect(await group.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await group.scrollIntoViewIfNeeded();
  await expect(flag).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-billing-ru-mobile.png"), animations: "disabled" });
});

test("a third-party payer states the payment route himself: one note instead of section 8, in German", async ({ page }) => {
  const { block } = await mount(page, "de", {
    ...statements,
    billing: {
      ...cashBilling.billing,
      invoice_to: "payer",
      invoice_name: null,
      invoice_street: null,
      invoice_zip: null,
      invoice_city: null,
      invoice_country: null,
      invoice_email: null,
      invoice_vat_id: null,
      payment_route_by: "payer",
      payment_method: null,
      via_third_party: null,
      via_third_party_details: null,
      compliance_flags: [],
    },
    billing_updated_at: "2026-10-05T09:40:00Z",
  });
  const group = block.getByTestId("lead-gwg-billing");
  await expect(group).toContainText("Rechnung und Zahlung (Abschnitte 7–8)");
  await expect(group.getByTestId("lead-gwg-billing-invoice_to")).toContainText("an die zahlende Person / Organisation");
  await expect(group.getByTestId("lead-gwg-billing-invoice_name")).toHaveCount(0);
  await expect(group.getByTestId("lead-gwg-billing-invoice_tax")).toHaveCount(0);
  await expect(group.getByTestId("lead-gwg-billing-by-payer")).toHaveText(
    "Den Zahlungsweg gibt der Zahler selbst an (eigener Link folgt)",
  );
  for (const key of ["payment_method", "account_country", "account_holder", "bank_name", "via_third_party", "flag"]) {
    await expect(group.getByTestId(`lead-gwg-billing-${key}`)).toHaveCount(0);
  }
});

test("a minor without a parent on file: the block and the sheet ask for one", async ({ page }) => {
  const { wizard, block } = await mount(page, "ru", {
    ...statements,
    minor: true,
    representation: { has_representative: null, under_guardianship: null, custody: "joint", custody_stated: false, representatives: [] },
    representation_updated_at: null,
  });
  const group = block.getByTestId("lead-gwg-representation");
  const warning = group.getByTestId("lead-gwg-representation-warning");
  await expect(warning).toHaveAttribute("data-warning", "no_representative");
  await expect(warning).toHaveText("Добавьте родителя или законного представителя");
  await expect(group.locator("[data-testid^='lead-gwg-representative-']")).toHaveCount(0);
  // The child's own statements stay readable.
  await expect(block).toContainText("FA1234567");

  const actions = wizard.getByTestId("gwg-identification-actions");
  await expect(actions.getByTestId("gwg-identification-no-representative")).toHaveText(
    "Добавьте родителя или законного представителя",
  );
  // No sheet for the child; the third-party payer of this mock keeps the own one.
  await expect(actions.getByRole("button", { name: /пациента/ })).toHaveCount(0);
  await expect(actions.getByRole("button")).toHaveText("Для плательщика");
});
