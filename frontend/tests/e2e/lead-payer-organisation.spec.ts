import { expect, test, type Page } from "@playwright/test";

// "Кто платит" in the documents step of the staff wizard: a third-party payer
// is a private person or a company, an organisation or an insurer; the
// relationship is chosen from a list; the lead's consent that GMED contacts
// the payer is shown read-only. Mocked API, synthetic data.

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

type Declaration = Record<string, unknown>;

/** A private person as an older server stores and answers it: no payer type. */
const olderPerson: Declaration = {
  payer_kind: "third_party",
  acts_on_own_account: true,
  own_account_answered: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
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
  // Typed by staff before the list of relationships existed.
  relationship: "brother",
  email: "viktor.zahler@example.com",
  phone: null,
  payer_informed_at: "2026-10-05T09:00:00Z",
  payer_informed_by: null,
  updated_at: "2026-10-05T09:15:00Z",
};

/** The same person on a server that stores the payer type. */
const person: Declaration = {
  ...olderPerson,
  payer_type: "person",
  organisation_name: null,
  relationship_kind: null,
  contact_consent_at: null,
};

const company: Declaration = {
  ...person,
  payer_type: "company",
  organisation_name: "Beispiel GmbH",
  first_name: null,
  last_name: null,
  date_of_birth: null,
  place_of_birth: null,
  citizenships: [],
  relationship_kind: "employer",
  relationship: null,
  email: "office@example.com",
  // 11:30 in Berlin.
  contact_consent_at: "2026-10-05T09:30:00Z",
};

/**
 * The same company on a server that stores sections 7–8 of the form: the
 * lead chose the invoice to the payer; nobody typed the staff fields yet.
 */
const billedCompany: Declaration = {
  ...company,
  invoice_to: "payer",
  invoice_name: null,
  invoice_street: null,
  invoice_zip: null,
  invoice_city: null,
  invoice_country: null,
  invoice_email: null,
  invoice_vat_id: null,
  invoice_tax_number: null,
  payment_method: null,
  payment_method_details: null,
  account_country: null,
  account_holder: null,
  bank_name: null,
  via_third_party: null,
  via_third_party_details: null,
};

/** The keys of sections 7–8 the lead answers: staff never send them. */
const LEAD_BILLING_KEYS = [
  "invoice_to", "invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country", "invoice_email",
  "payment_method", "payment_method_details", "account_country", "account_holder", "bank_name", "via_third_party", "via_third_party_details",
];

async function mount(page: Page, lang: "ru" | "de", declaration: Declaration) {
  const state = { declaration };
  const saves: Declaration[] = [];
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-payer-organisation-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "payer-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
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
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      if (request.method() === "POST") {
        // Like the server: the body replaces the declaration, the Art. 14
        // confirmation keeps its time, the lead's consent is not touched.
        const { payer_informed: informed, ...body } = request.postDataJSON() as Declaration;
        saves.push({ payer_informed: informed, ...body });
        state.declaration = {
          ...state.declaration,
          ...body,
          payer_informed_at: informed ? state.declaration.payer_informed_at ?? "2026-10-05T10:00:00Z" : null,
          updated_at: "2026-10-05T10:00:00Z",
        };
      }
      response = {
        declaration: state.declaration,
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
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  // The wizard harness of the repeat-intake spec, under its own address.
  await page.route("**/lead-payer-organisation-harness", (route) =>
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
  await page.goto("/lead-payer-organisation-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  return {
    wizard,
    section: wizard.locator("#lead-wizard-payer-declaration"),
    sheetActions: wizard.getByTestId("gwg-identification-actions"),
    saves,
  };
}

test("staff turn a private payer into a company: name and seat instead of the personal identity", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, section, sheetActions, saves } = await mount(page, "ru", person);

  // A person: the form as before, with the type and the relationship list.
  const type = section.getByRole("combobox", { name: "Тип плательщика", exact: true });
  await expect(type).toContainText("Частное лицо");
  await expect(section.getByLabel(/^Имя/)).toHaveValue("Viktor");
  await expect(section.getByLabel(/^Фамилия/)).toHaveValue("Zahler");
  await expect(section.getByLabel(/^Название/)).toHaveCount(0);
  await expect(section.getByRole("group", { name: "Юридический адрес" })).toHaveCount(0);
  // The relationship typed before the list existed stays visible.
  const relationship = section.getByRole("combobox", { name: "Кем приходится пациенту", exact: true });
  const relationshipText = section.getByLabel(/^Кем приходится — уточнение/);
  await expect(relationshipText).toHaveValue("brother");
  // Only the lead gives the consent: one read-only line, a warning while it is missing.
  const consent = section.getByTestId("lead-payer-contact-consent");
  await expect(consent).toHaveText("Согласие пациента на передачу контактов плательщику: ещё не дано");
  await expect(consent.locator("input, button")).toHaveCount(0);
  // The GwG sheet for natural persons can be created for this payer.
  await expect(sheetActions.getByRole("button", { name: "Для плательщика", exact: true })).toBeVisible();
  await expect(wizard.getByTestId("gwg-identification-payer-organisation")).toHaveCount(0);

  await type.click();
  for (const option of ["Частное лицо", "Компания", "Организация", "Страховая"]) {
    await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  }
  await page.getByRole("option", { name: "Компания", exact: true }).click();

  // The personal identity gives way to one name; the address is the seat.
  for (const label of [/^Имя/, /^Фамилия/, /^Дата рождения/, /^Место рождения/]) {
    await expect(section.getByLabel(label)).toHaveCount(0);
  }
  await expect(section.getByText("Гражданство")).toHaveCount(0);
  const seat = section.getByRole("group", { name: "Юридический адрес" });
  await expect(seat.getByLabel(/^Улица и дом/)).toHaveValue("Musterweg 1");
  await expect(seat.getByLabel(/^Почтовый индекс/)).toHaveValue("1010");
  await expect(seat.getByLabel(/^Город/)).toHaveValue("Wien");
  await expect(seat.getByRole("combobox", { name: "Страна юридического адреса плательщика" })).toContainText("Австрия");
  // What is missing is worded for an organisation.
  await expect(section).toContainText("Заполните данные плательщика: название и юридический адрес");
  await section.getByLabel(/^Название/).fill("Beispiel GmbH");
  await expect(section).not.toContainText("Заполните данные плательщика");

  // A kind from the list replaces the free text.
  await relationship.click();
  await expect(page.getByRole("option")).toHaveCount(9);
  await page.getByRole("option", { name: "Работодатель", exact: true }).click();
  await expect(relationshipText).toHaveCount(0);
  await relationship.click();
  await page.getByRole("option", { name: "Другое (уточните)", exact: true }).click();
  await expect(relationshipText).toHaveValue("brother");
  await relationship.click();
  await page.getByRole("option", { name: "Работодатель", exact: true }).click();

  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-company-ru-desktop.png"), animations: "disabled" });
  // On a phone the seat block must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await seat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-company-ru-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1100 });

  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Данные о плательщике сохранены");
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({
    payer_kind: "third_party",
    payer_type: "company",
    organisation_name: "Beispiel GmbH",
    relationship_kind: "employer",
    relationship: null,
    first_name: null,
    last_name: null,
    date_of_birth: null,
    place_of_birth: null,
    citizenships: [],
    street: "Musterweg 1",
    zip: "1010",
    city: "Wien",
    country: "AT",
    email: "viktor.zahler@example.com",
    payer_informed: true,
  });
  // The consent is the lead's: staff never send it. This server knows no
  // USt-IdNr. / Steuernummer either: the keys stay out of the body.
  expect(Object.keys(saves[0]).filter((key) => key.includes("consent"))).toEqual([]);
  expect(saves[0]).not.toHaveProperty("invoice_vat_id");
  expect(saves[0]).not.toHaveProperty("invoice_tax_number");

  // The saved company stays in the form; no sheet for natural persons for it.
  await expect(type).toContainText("Компания");
  await expect(section.getByLabel(/^Название/)).toHaveValue("Beispiel GmbH");
  await expect(relationship).toContainText("Работодатель");
  await expect(sheetActions.getByRole("button", { name: "Для плательщика", exact: true })).toHaveCount(0);
  await expect(wizard.getByTestId("gwg-identification-payer-organisation")).toHaveText(
    "Для организации лист для физических лиц не формируется",
  );
  await expect(sheetActions.getByRole("button", { name: "Сформировать для пациента", exact: true })).toBeEnabled();
  await sheetActions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-company-sheet-note-ru-desktop.png"), animations: "disabled" });
});

test("a stored company with the lead's consent, in German", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, section, sheetActions, saves } = await mount(page, "de", company);

  await expect(section.getByRole("combobox", { name: "Art des Zahlers", exact: true })).toContainText("Unternehmen");
  await expect(section.getByLabel(/^Name/)).toHaveValue("Beispiel GmbH");
  await expect(section.getByLabel(/^Vorname/)).toHaveCount(0);
  await expect(section.getByRole("combobox", { name: "Beziehung zum Patienten", exact: true })).toContainText("Arbeitgeber");
  await expect(section.getByLabel(/^Beziehung – nähere Angabe/)).toHaveCount(0);
  const seat = section.getByRole("group", { name: "Sitz" });
  await expect(seat.getByLabel(/^Straße und Hausnummer/)).toHaveValue("Musterweg 1");
  await expect(seat.getByRole("combobox", { name: "Sitzland des Kostenübernehmers" })).toContainText("Österreich");
  await expect(section.getByTestId("lead-payer-contact-consent")).toHaveText(
    "Einverständnis zur Weitergabe der Kontaktdaten an den Zahler: 05.10.2026 11:30",
  );
  await expect(wizard.getByTestId("gwg-identification-payer-organisation")).toHaveText(
    "Für Organisationen wird der Bogen für natürliche Personen nicht erstellt",
  );
  await expect(sheetActions.getByRole("button", { name: "Für Kostenübernehmer erstellen", exact: true })).toHaveCount(0);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-company-de-desktop.png"), animations: "disabled" });

  // An insurer is an organisation as well; the consent stays out of the body.
  await section.getByRole("combobox", { name: "Art des Zahlers", exact: true }).click();
  await page.getByRole("option", { name: "Versicherung", exact: true }).click();
  await section.getByLabel(/^Name/).fill("Beispiel Versicherung AG");
  await section.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Angaben zum Zahler gespeichert");
  expect(saves[0]).toMatchObject({
    payer_type: "insurance",
    organisation_name: "Beispiel Versicherung AG",
    relationship_kind: "employer",
    first_name: null,
    citizenships: [],
  });
  expect(Object.keys(saves[0]).filter((key) => key.includes("consent"))).toEqual([]);
  await expect(section.getByTestId("lead-payer-contact-consent")).toContainText("05.10.2026 11:30");
});

test("staff add USt-IdNr. and Steuernummer of the invoice recipient; where the invoice goes stays the lead's choice", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { section, saves } = await mount(page, "ru", billedCompany);

  // Section 7 as the lead chose it: read-only, with the note that it was chosen in the cabinet.
  const recipient = section.getByTestId("lead-payer-invoice-recipient");
  await expect(recipient).toContainText("Получатель счёта (раздел 7 анкеты)");
  await expect(recipient.getByTestId("lead-payer-invoice-to")).toHaveText(
    "Счёт направляется: плательщику · выбрал пациент в кабинете",
  );
  await expect(recipient.locator("select, [role=radio], [role=combobox]")).toHaveCount(0);
  // The two staff inputs, empty so far.
  const vatId = recipient.getByLabel(/^USt-IdNr\. получателя счёта/);
  const taxNumber = recipient.getByLabel(/^Steuernummer получателя счёта/);
  await expect(vatId).toHaveValue("");
  await expect(taxNumber).toHaveValue("");
  await expect(recipient.locator("input")).toHaveCount(2);

  await vatId.fill("DE123456789");
  await taxNumber.fill(" 30/123/45678 ");
  await recipient.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-invoice-tax-ru-desktop.png"), animations: "disabled" });
  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Данные о плательщике сохранены");
  expect(saves).toHaveLength(1);
  expect(saves[0]).toMatchObject({
    payer_kind: "third_party",
    payer_type: "company",
    organisation_name: "Beispiel GmbH",
    invoice_vat_id: "DE123456789",
    invoice_tax_number: "30/123/45678",
  });
  // The lead's answers of sections 7–8 and the consent are never in the body.
  for (const key of [...LEAD_BILLING_KEYS, "contact_consent_at"]) {
    expect(saves[0]).not.toHaveProperty(key);
  }
  // The saved values stay in the form; a cleared field is sent as null.
  await expect(vatId).toHaveValue("DE123456789");
  await expect(taxNumber).toHaveValue("30/123/45678");
  await taxNumber.fill("");
  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Данные о плательщике сохранены");
  expect(saves[1]).toMatchObject({ invoice_vat_id: "DE123456789", invoice_tax_number: null });
});

test("the lead's choice of another address is named, in German", async ({ page }) => {
  const { section } = await mount(page, "de", { ...billedCompany, invoice_to: "other", invoice_name: "Beispiel Stiftung", invoice_vat_id: "DE987654321" });
  const recipient = section.getByTestId("lead-payer-invoice-recipient");
  await expect(recipient).toContainText("Rechnungsempfänger (Abschnitt 7)");
  await expect(recipient.getByTestId("lead-payer-invoice-to")).toHaveText(
    "Rechnung geht an: an eine andere Adresse — Beispiel Stiftung · vom Patienten im Portal gewählt",
  );
  await expect(recipient.getByLabel(/^USt-IdNr\. des Rechnungsempfängers/)).toHaveValue("DE987654321");
  await expect(recipient.getByLabel(/^Steuernummer des Rechnungsempfängers/)).toHaveValue("");
});

test("a lead who has not chosen where the invoice goes yet", async ({ page }) => {
  const { section } = await mount(page, "de", { ...billedCompany, invoice_to: null });
  await expect(section.getByTestId("lead-payer-invoice-to")).toHaveText("Rechnung geht an: nicht angegeben · wählt der Patient im Portal");
  await expect(section.getByLabel(/^USt-IdNr\. des Rechnungsempfängers/)).toHaveValue("");
});

test("an older backend keeps the form of a private person and gets none of the new keys", async ({ page }) => {
  const { wizard, section, sheetActions, saves } = await mount(page, "ru", olderPerson);

  await expect(section.getByLabel(/^Имя/)).toHaveValue("Viktor");
  await expect(section.getByRole("combobox", { name: "Тип плательщика", exact: true })).toHaveCount(0);
  await expect(section.getByRole("combobox", { name: "Кем приходится пациенту", exact: true })).toHaveCount(0);
  await expect(section.getByTestId("lead-payer-contact-consent")).toHaveCount(0);
  // Neither the staff fields of section 7 nor the lead's choice: the server does not send `invoice_vat_id`.
  await expect(section.getByTestId("lead-payer-invoice-recipient")).toHaveCount(0);
  await expect(section.getByLabel(/USt-IdNr\./)).toHaveCount(0);
  await expect(section).not.toContainText("Счёт направляется");
  // The relationship is the free text it was.
  const relationship = section.getByLabel(/^Кем приходится пациенту/);
  await expect(relationship).toHaveValue("brother");
  await relationship.fill("Bruder");
  await section.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(section.getByRole("status")).toHaveText("Данные о плательщике сохранены");
  expect(saves[0]).toMatchObject({ payer_kind: "third_party", first_name: "Viktor", relationship: "Bruder", citizenships: ["AT"] });
  for (const key of ["payer_type", "organisation_name", "relationship_kind", "invoice_vat_id", "invoice_tax_number"]) {
    expect(saves[0]).not.toHaveProperty(key);
  }
  // The payer is a person there: the sheet can be created.
  await expect(sheetActions.getByRole("button", { name: "Для плательщика", exact: true })).toBeVisible();
  await expect(wizard.getByTestId("gwg-identification-payer-organisation")).toHaveCount(0);
});
