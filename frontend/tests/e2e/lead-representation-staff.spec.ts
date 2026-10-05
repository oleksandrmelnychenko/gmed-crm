import { expect, test, type Page } from "@playwright/test";

// Who acts for a minor lead, in the staff wizard: the legal representatives as
// the cabinet knows them (read-only), the identification per parent instead of
// the child, one GwG sheet per parent, the custody stated by staff, the GwG
// data of a contact, and a second parent the cabinet adds while the wizard is
// open. Mocked API, synthetic data.

// The lead the wizard harness opens through "Lead intake".
const leadId = "00000000-0000-0000-0000-000000000222";
const ANNA_ID = "11111111-1111-4111-8111-111111111111";
const BEN_ID = "22222222-2222-4222-8222-222222222222";
const ANNA = `representative:${ANNA_ID}`;
const BEN = `representative:${BEN_ID}`;

type Json = Record<string, unknown>;

const contact = (id: string, name: string, email: string | null): Json => ({
  id,
  related_patient_id: null,
  name,
  phone: null,
  email,
  relation: "parent",
  birth_date: null,
  address: null,
});

const annaContact = contact(ANNA_ID, "Anna Muster", "anna.muster@example.com");
const benContact = contact(BEN_ID, "Ben Muster", null);

/** A child: the parents act, sign and pay. */
const lead = {
  id: leadId,
  first_name: "Mia",
  last_name: "Muster",
  email: "mia.muster@example.com",
  date_of_birth: "2015-06-01",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  wizard_state: {},
  services: [],
  attachments: [],
  trusted_contacts: [annaContact, benContact],
  readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
};

/** The mother filled in everything in the cabinet and has the login. */
const annaPerson: Json = {
  id: ANNA_ID,
  slot: "rep1",
  role: "legal_representative",
  relation: "parent",
  first_name: "Anna",
  last_name: "Muster",
  date_of_birth: "1985-03-02",
  birth_place: "Kyiv",
  birth_country: "UA",
  citizenships: ["UA", "DE"],
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
  email: "anna.muster@example.com",
  phone: "+49 30 100001",
  id_document_type: "passport",
  id_document_number: "FA7654321",
  id_issuing_authority: "Passamt 8031",
  id_issuing_country: "UA",
  id_issued_on: "2015-05-01",
  // Expired long ago, whatever the day the spec runs on.
  id_valid_until: "2025-04-30",
  identity_documents: [{ id: "doc-anna-pass", file_name: "anna-pass.pdf", uploaded_at: "2026-10-05T09:10:00Z", reviewed: true }],
  authority_documents: [],
  has_login: true,
  has_data: true,
  contact_origin: "staff",
};

/** The father was added by the mother in the cabinet; no e-mail yet. */
const benPerson: Json = {
  id: BEN_ID,
  slot: "rep2",
  role: "legal_representative",
  relation: "parent",
  first_name: "Ben",
  last_name: "Muster",
  date_of_birth: "1984-01-15",
  birth_place: "Berlin",
  birth_country: "DE",
  citizenships: ["DE"],
  street: "Musterweg 1",
  zip: "10115",
  city: "Berlin",
  country: "DE",
  email: null,
  phone: "+49 30 100002",
  id_document_type: "id_card",
  id_document_number: "L01X00T47",
  id_issuing_authority: "Bürgeramt Mitte",
  id_issuing_country: "DE",
  id_issued_on: "2022-02-01",
  id_valid_until: "2032-01-31",
  identity_documents: [{ id: "doc-ben-id", file_name: "ben-ausweis.jpg", uploaded_at: "2026-10-05T09:30:00Z", reviewed: false }],
  authority_documents: [],
  has_login: false,
  has_data: true,
  contact_origin: "portal",
};

type Person = {
  qes: { signed_at: string; test_mode: boolean } | null;
  own_account_payment: { confirmed_at: string; confirmed_by_name: string | null; note: string | null } | null;
};
type Representative = Person & { id: string; subject: string; name: string; relation: string; has_email: boolean };
type Status = {
  contract_partner: Person;
  payer: (Person & { same_person_as: string | null }) | null;
  minor: boolean;
  representatives: Representative[];
};

// 11:20 in Berlin.
const SIGNED = { signed_at: "2026-10-05T09:20:00Z", test_mode: false };
// 12:00 in Berlin; the mocked server confirms as the signed-in user.
const CONFIRMED = { confirmed_at: "2026-10-05T10:00:00Z", confirmed_by_name: "Intake QA", note: null };
const NOTHING: Person = { qes: null, own_account_payment: null };

const annaStatus: Representative = { ...NOTHING, qes: SIGNED, id: ANNA_ID, subject: ANNA, name: "Anna Muster", relation: "parent", has_email: true };
const benStatus: Representative = { ...NOTHING, id: BEN_ID, subject: BEN, name: "Ben Muster", relation: "parent", has_email: false };

/** "I pay (as a parent)": the mother is stored as a private third-party payer. */
const motherPays = {
  declaration: {
    payer_kind: "third_party",
    payer_type: "person",
    organisation_name: null,
    relationship_kind: "parent",
    contact_consent_at: "2026-10-05T09:00:00Z",
    acts_on_own_account: true,
    own_account_answered: true,
    beneficial_owner_name: null,
    beneficial_owner_note: null,
    source_of_funds: "savings",
    source_of_funds_description: null,
    source_of_funds_document_id: null,
    first_name: "Anna",
    last_name: "Muster",
    date_of_birth: "1985-03-02",
    place_of_birth: "Kyiv",
    street: "Musterweg 1",
    zip: "10115",
    city: "Berlin",
    country: "DE",
    citizenships: ["UA", "DE"],
    relationship: null,
    email: "anna.muster@example.com",
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
    aml_countries: ["DE", "UA"],
  },
};

/** The father's sheet was made before; the mother has none yet. */
const benSheet = {
  id: "doc-ben-sheet",
  lead_id: leadId,
  document_number: "GWG-20261005-0001",
  auto_name: "Dokumentationsbogen natürliche Personen – Ben Muster",
  original_filename: "Dokumentationsbogen natuerliche Personen - Ben Muster.pdf",
  mime_type: "application/pdf",
  art: "gwg_identification",
  category: "administrative",
  status: "active",
  generated_template_id: "gwg_identification",
  generated_bindings: { gwg_identification: { subject: BEN } },
  has_stored_file: true,
  file_deleted_at: null,
  is_latest_version: true,
  created_at: "2026-10-05T08:00:00Z",
};

type Mock = {
  lang: "ru" | "de";
  /** The step the test works in; the wizard opens on the master data. */
  step?: "master" | "documents";
  /** Only the mother is on file when the wizard opens (the cabinet adds the father later). */
  motherOnly?: boolean;
  /** The server refuses to make a sheet for a representative. */
  refuseSheet?: boolean;
};

async function mount(page: Page, mock: Mock) {
  const state = {
    lead: { ...lead, trusted_contacts: mock.motherOnly ? [annaContact] : lead.trusted_contacts } as Json,
    representation: {
      has_representative: null,
      under_guardianship: null,
      custody: "joint",
      custody_stated: false,
      representatives: mock.motherOnly ? [annaPerson] : [annaPerson, benPerson],
    } as Json & { representatives: Json[] },
    status: {
      // The child neither signs nor pays.
      contract_partner: NOTHING,
      payer: { ...NOTHING, qes: annaStatus.qes, same_person_as: ANNA },
      minor: true,
      representatives: mock.motherOnly ? [annaStatus] : [annaStatus, benStatus],
    } as Status,
  };
  const calls = {
    /** Bodies of the wizard saves (`POST /leads/{id}/update`). */
    updates: [] as Json[],
    payments: [] as Array<{ subject: string; body: unknown }>,
    generated: [] as Json[],
    custody: [] as unknown[],
    removedData: [] as string[],
  };
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-representation-token");
  }, mock.lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = decodeURIComponent(new URL(request.url()).pathname.replace("/api/v1", ""));
    const payment = path.match(/^\/leads\/[^/]+\/identification-status\/([^/]+)\/own-account-payment$/);
    const removal = path.match(/^\/leads\/[^/]+\/representatives\/([^/]+)$/);
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "repr-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = state.lead;
    } else if (path === `/leads/${leadId}/update` && method === "POST") {
      calls.updates.push(request.postDataJSON() as Json);
      response = {};
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
        minor: true,
        can_issue: true,
        can_review_uploads: true,
        identification: { birth_place: "Berlin", birth_country: "DE", contact_channels: ["email"] },
        identification_updated_at: "2026-10-05T09:20:00Z",
        identity_documents: [],
        representation: state.representation,
        // 11:40 in Berlin.
        representation_updated_at: "2026-10-05T09:40:00Z",
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      response = motherPays;
    } else if (path === `/leads/${leadId}/identification-status`) {
      response = state.status;
    } else if (payment && method === "POST") {
      const subject = payment[1];
      const body = request.postDataJSON() as { confirmed?: boolean };
      calls.payments.push({ subject, body });
      const mark = body.confirmed ? CONFIRMED : null;
      const representatives = state.status.representatives.map((person) =>
        person.subject === subject ? { ...person, own_account_payment: mark } : person,
      );
      // A payer who is this representative carries that person's values.
      const payer = state.status.payer?.same_person_as === subject
        ? { ...state.status.payer, own_account_payment: mark }
        : state.status.payer;
      state.status = { ...state.status, representatives, payer };
      response = state.status;
    } else if (path === `/leads/${leadId}/representation` && method === "POST") {
      const body = request.postDataJSON() as { custody?: string };
      calls.custody.push(body);
      state.representation = { ...state.representation, custody: body.custody, custody_stated: true };
      response = { representation: state.representation };
    } else if (removal && method === "DELETE") {
      calls.removedData.push(removal[1]);
      // The row goes: the extras and the upload links; the contact stays.
      state.representation = {
        ...state.representation,
        representatives: state.representation.representatives.map((person) =>
          person.id === removal[1]
            ? {
                id: person.id,
                slot: person.slot,
                role: person.role,
                relation: person.relation,
                first_name: person.first_name,
                last_name: person.last_name,
                email: person.email,
                has_login: person.has_login,
                has_data: false,
                contact_origin: person.contact_origin,
              }
            : person,
        ),
      };
      response = { representation: state.representation };
    } else if (path === "/documents/generate" && method === "POST") {
      calls.generated.push(request.postDataJSON() as Json);
      if (mock.refuseSheet) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            error: "representative_sheet_not_available",
            code: "representative_sheet_not_available",
            message: "The person is not a legal representative of a minor",
          }),
        });
        return;
      }
      response = {
        id: "doc-new-sheet",
        document_number: "GWG-20261005-0002",
        auto_name: "Dokumentationsbogen natürliche Personen",
        original_filename: "Dokumentationsbogen natuerliche Personen.pdf",
        mime_type: "application/pdf",
        file_size: 20,
      };
    } else if (path === "/documents") {
      // The new sheet is left out, so no preview opens over the wizard.
      response = mock.motherOnly ? [] : [benSheet];
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  // The wizard harness of the repeat-intake spec, under its own address.
  await page.route("**/lead-representation-harness", (route) =>
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
  await page.goto("/lead-representation-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: mock.lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  const openDocuments = () =>
    wizard.getByRole("tab", { name: mock.lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  if ((mock.step ?? "documents") === "documents") await openDocuments();
  const identification = wizard.getByTestId("lead-identification-status");
  const row = (subject: string) => ({
    line: identification.getByTestId(`lead-identification-${subject}`),
    qes: identification.getByTestId(`lead-identification-qes-${subject}`),
    payment: identification.getByTestId(`lead-identification-payment-${subject}`),
  });
  return {
    wizard,
    openDocuments,
    statements: wizard.getByTestId("lead-gwg-statements"),
    identification,
    row,
    sheetActions: wizard.getByTestId("gwg-identification-actions"),
    calls,
    state,
  };
}

test("staff read who represents a minor, as the cabinet knows it", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, statements } = await mount(page, { lang: "ru" });

  const group = statements.getByTestId("lead-gwg-representation");
  await expect(group).toContainText("Законные представители");
  await expect(group.getByTestId("lead-gwg-representation-updated")).toHaveText("изменено в кабинете · 05.10.2026 11:40");
  // Nobody stated the custody: both parents represent the child, and both are on file.
  await expect(group.getByTestId("lead-gwg-custody")).toContainText("не указано — оба родителя");
  await expect(group.getByTestId("lead-gwg-representation-warning")).toHaveCount(0);

  const anna = group.getByTestId(`lead-gwg-representative-${ANNA_ID}`);
  for (const text of [
    "Anna Muster",
    "Родитель",
    "02.03.1985",
    "Kyiv, Украина",
    "Украина, Германия",
    "Musterweg 1, 10115 Berlin, Германия",
    "anna.muster@example.com",
    "+49 30 100001",
    "Паспорт",
    "FA7654321",
    "Passamt 8031, Украина",
    "01.05.2015",
    "anna-pass.pdf · 05.10.2026 · просмотрен",
  ]) {
    await expect(anna).toContainText(text);
  }
  await expect(anna.getByTestId("lead-gwg-representative-login")).toHaveText("есть доступ в кабинет");
  const validUntil = anna.getByTestId(`lead-gwg-representative-valid-until-${ANNA_ID}`);
  await expect(validUntil).toContainText("30.04.2025 · срок истёк");
  await expect(validUntil).toHaveAttribute("data-warning", "true");

  const ben = group.getByTestId(`lead-gwg-representative-${BEN_ID}`);
  await expect(ben).toContainText("Ben Muster");
  await expect(ben).toContainText("Удостоверение личности");
  await expect(ben).toContainText("ben-ausweis.jpg · 05.10.2026");
  await expect(ben.getByTestId("lead-gwg-representative-login")).toHaveCount(0);
  await expect(ben.getByTestId(`lead-gwg-representative-valid-until-${BEN_ID}`)).not.toHaveAttribute("data-warning", "true");
  await expect(ben.getByTestId(`lead-gwg-representative-authority-documents-${BEN_ID}`)).toContainText("—");

  // After the child's identity document, before the economic interest; nothing can be edited.
  const identityBox = await statements.getByTestId("lead-gwg-identity-documents").boundingBox();
  const groupBox = await group.boundingBox();
  const interestBox = await statements.getByTestId("lead-gwg-own-account").boundingBox();
  expect(identityBox!.y).toBeLessThan(groupBox!.y);
  expect(groupBox!.y + groupBox!.height).toBeLessThanOrEqual(interestBox!.y);
  await expect(statements.locator("input, textarea, select, button")).toHaveCount(0);

  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-statements-ru-desktop.png"), animations: "disabled" });
  // On a phone the group must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-statements-ru-mobile.png"), animations: "disabled" });
});

test("each parent is identified instead of the child, and a paying parent only once", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, identification, row, calls } = await mount(page, { lang: "ru" });

  await expect(identification).toContainText("Идентификация по квалифицированной подписи");
  await expect(identification.getByTestId("lead-identification-minor")).toContainText(
    "подписывают и платят законные представители",
  );
  // No line for the child.
  await expect(row("contract_partner").line).toHaveCount(0);
  await expect(identification.getByRole("listitem")).toHaveCount(3);

  const anna = row(ANNA);
  await expect(anna.line).toContainText("Anna Muster");
  await expect(anna.qes).toHaveText("Квалифицированная подпись · 05.10.2026");
  await expect(anna.payment).toHaveText("Ожидается платёж с собственного счёта");
  await expect(identification.getByTestId(`lead-identification-note-${ANNA}`)).toHaveCount(0);

  const ben = row(BEN);
  await expect(ben.line).toContainText("Ben Muster");
  await expect(ben.qes).toHaveText("Квалифицированной подписи ещё нет");
  // A signature is attributed by the signer's e-mail, and he has none.
  await expect(identification.getByTestId(`lead-identification-note-${BEN}`)).toHaveText(
    "нет e-mail — подпись не засчитается",
  );

  // The mother also pays: one person, the payer line repeats her labels and confirms nothing.
  const payer = row("payer");
  await expect(payer.line).toContainText("Плательщик — тот же человек, что и представитель Anna Muster");
  await expect(payer.qes).toHaveText("Квалифицированная подпись · 05.10.2026");
  await expect(payer.payment).toHaveText("Ожидается платёж с собственного счёта");
  await expect(payer.line.getByRole("button")).toHaveCount(0);

  await ben.line.getByRole("button", { name: "Подтвердить платёж" }).click();
  await expect(ben.payment).toHaveText("Платёж с собственного счёта подтверждён · 05.10.2026 · Intake QA");
  await expect(anna.payment).toHaveText("Ожидается платёж с собственного счёта");

  await anna.line.getByRole("button", { name: "Подтвердить платёж" }).click();
  await expect(anna.payment).toHaveText("Платёж с собственного счёта подтверждён · 05.10.2026 · Intake QA");
  // The same person: the payer line follows.
  await expect(payer.payment).toHaveText("Платёж с собственного счёта подтверждён · 05.10.2026 · Intake QA");
  await expect(payer.line.getByRole("button")).toHaveCount(0);
  await expect(anna.line.getByRole("button", { name: "Отменить" })).toBeVisible();
  // Each confirmation went to the representative, never to the child or the payer.
  expect(calls.payments).toEqual([
    { subject: BEN, body: { confirmed: true } },
    { subject: ANNA, body: { confirmed: true } },
  ]);
  await expect(identification.getByTestId("lead-identification-error")).toHaveCount(0);

  await identification.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-identification-ru-desktop.png"), animations: "disabled" });
  // On a phone the long caption wraps and does not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await identification.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-identification-ru-mobile.png"), animations: "disabled" });
});

test("one GwG sheet per parent, none for the child and none twice for a paying parent", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, sheetActions, calls } = await mount(page, { lang: "ru" });

  const forAnna = sheetActions.getByRole("button", { name: "Сформировать для Anna Muster", exact: true });
  // The father has a sheet already.
  const forBen = sheetActions.getByRole("button", { name: "Обновить для Ben Muster", exact: true });
  await expect(forAnna).toBeEnabled();
  await expect(forBen).toBeEnabled();
  await expect(sheetActions.getByRole("button")).toHaveCount(2);
  await expect(sheetActions.getByRole("button", { name: /пациента/ })).toHaveCount(0);
  await expect(sheetActions.getByRole("button", { name: /плательщика/ })).toHaveCount(0);
  await expect(sheetActions.getByTestId("gwg-identification-payer-same-person")).toHaveText(
    "отдельный лист не нужен: плательщик — представитель Anna Muster",
  );
  await sheetActions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-sheets-ru-desktop.png"), animations: "disabled" });

  await forAnna.click();
  await expect.poll(() => calls.generated.length).toBe(1);
  expect(calls.generated[0]).toMatchObject({
    template_id: "gwg_identification",
    lead_id: leadId,
    auto_name: "Dokumentationsbogen natürliche Personen – Anna Muster",
    bindings: { gwg_identification: { subject: ANNA } },
  });
  // Her first sheet replaces nothing.
  expect(calls.generated[0]).not.toHaveProperty("replace_document_id");
  await expect(forBen).toBeEnabled();

  await forBen.click();
  await expect.poll(() => calls.generated.length).toBe(2);
  expect(calls.generated[1]).toMatchObject({
    template_id: "gwg_identification",
    lead_id: leadId,
    replace_document_id: "doc-ben-sheet",
    auto_name: "Dokumentationsbogen natürliche Personen – Ben Muster",
    bindings: { gwg_identification: { subject: BEN } },
  });

  // The wizard is saved before each sheet; staff did not touch the contacts,
  // so the saves leave the parents on the server alone.
  expect(calls.updates.length).toBeGreaterThanOrEqual(2);
  for (const update of calls.updates) expect(update).not.toHaveProperty("trusted_contacts");
  await expect(wizard.getByText("Проверьте введённые данные")).toHaveCount(0);

  // On a phone the buttons wrap and do not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await sheetActions.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-sheets-ru-mobile.png"), animations: "disabled" });
});

test("a refused sheet says why, in German too", async ({ page }) => {
  const { wizard, sheetActions, row, calls } = await mount(page, { lang: "de", refuseSheet: true });

  await expect(row("payer").line).toContainText("Kostenträger — dieselbe Person wie Vertreter/in Anna Muster");
  await expect(row(BEN).line).toContainText("keine E-Mail – die Signatur wird nicht angerechnet");
  await expect(sheetActions.getByTestId("gwg-identification-payer-same-person")).toHaveText(
    "kein eigener Bogen nötig: Kostenträger ist Vertreter/in Anna Muster",
  );
  await expect(sheetActions.getByRole("button", { name: "Für Ben Muster aktualisieren", exact: true })).toBeVisible();
  await sheetActions.getByRole("button", { name: "Für Anna Muster erstellen", exact: true }).click();
  await expect(wizard).toContainText(
    "Für diese Person kann kein Bogen erstellt werden: Sie ist nicht als gesetzliche Vertretung eines Minderjährigen erfasst.",
  );
  expect(calls.generated).toHaveLength(1);
});

test("staff state who represents the child, and the block warns when it does not fit", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, openDocuments, statements, calls } = await mount(page, { lang: "ru", step: "master" });

  const custody = wizard.getByTestId("lead-custody");
  const select = custody.getByRole("combobox", { name: "Кто представляет ребёнка", exact: true });
  await expect(select).toContainText("Не указано — оба родителя");
  await custody.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-custody-ru-desktop.png"), animations: "disabled" });
  await select.click();
  for (const option of ["Оба родителя совместно", "Один родитель (единоличная опека)", "Опекун или попечитель"]) {
    await expect(page.getByRole("option", { name: option, exact: true })).toBeVisible();
  }
  await page.getByRole("option", { name: "Один родитель (единоличная опека)", exact: true }).click();
  await expect(select).toContainText("Один родитель (единоличная опека)");
  expect(calls.custody).toEqual([{ custody: "sole_parent" }]);
  await expect(custody.getByTestId("lead-custody-error")).toHaveCount(0);
  // Stated now: "not stated" is no longer offered, and the same answer is not sent again.
  await select.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.getByRole("option", { name: "Один родитель (единоличная опека)", exact: true }).click();
  await expect(select).toContainText("Один родитель (единоличная опека)");
  expect(calls.custody).toHaveLength(1);
  // The custody is saved at once and is no part of the wizard draft.
  expect(calls.updates).toEqual([]);

  // One parent alone, but two are on file.
  await openDocuments();
  const group = statements.getByTestId("lead-gwg-representation");
  await expect(group.getByTestId("lead-gwg-custody")).toContainText("Один родитель (единоличная опека)");
  const warning = group.getByTestId("lead-gwg-representation-warning");
  await expect(warning).toHaveAttribute("data-warning", "single_custody_several");
  await expect(warning).toContainText("Ребёнка представляет один человек, но указано несколько представителей");
});

test("the GwG data of a contact are removed before the contact itself", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, statements, calls } = await mount(page, { lang: "ru" });

  const contacts = wizard.getByRole("list", { name: "Доверенные контакты" });
  const anna = contacts.getByRole("listitem").filter({ hasText: "Anna Muster" });
  await expect(anna.getByTestId("trusted-contact-gwg-badge")).toHaveText("Представитель (GwG)");
  // The server keeps a contact with GwG data, so it has no remove button.
  await expect(anna.getByRole("button", { name: "Удалить контакт: Anna Muster" })).toHaveCount(0);
  const removeData = anna.getByRole("button", { name: "Убрать данные GwG: Anna Muster" });
  await expect(removeData).toBeVisible();
  await contacts.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-contacts-ru-desktop.png"), animations: "disabled" });
  // On a phone the wider action must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await contacts.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-contacts-ru-mobile.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 1100 });

  // Declined: nothing happens.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await removeData.click();
  expect(calls.removedData).toEqual([]);

  let question = "";
  page.once("dialog", (dialog) => {
    question = dialog.message();
    void dialog.accept();
  });
  await removeData.click();
  await expect(anna.getByTestId("trusted-contact-gwg-badge")).toHaveCount(0);
  expect(question).toContain("Убрать данные GwG у контакта «Anna Muster»?");
  expect(calls.removedData).toEqual([ANNA_ID]);
  // The contact stays and can now be removed as usual.
  await expect(anna.getByRole("button", { name: "Удалить контакт: Anna Muster" })).toBeVisible();
  await expect(removeData).toHaveCount(0);
  await expect(statements.getByTestId(`lead-gwg-representative-${ANNA_ID}`)).toContainText("в кабинете ещё не заполнено");
  // The father's data were not touched.
  const ben = contacts.getByRole("listitem").filter({ hasText: "Ben Muster" });
  await expect(ben.getByTestId("trusted-contact-gwg-badge")).toBeVisible();
  // Nothing of it went through a wizard save.
  expect(calls.updates).toEqual([]);
});

test("a second parent added in the cabinet appears in the open wizard and survives its saves", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, openDocuments, statements, sheetActions, calls, state } = await mount(page, {
    lang: "ru",
    step: "master",
    motherOnly: true,
  });

  // The section "Родитель или законный представитель" of the master data.
  const parents = wizard.locator("#lead-wizard-guardian");
  await expect(parents.getByRole("listitem")).toHaveCount(1);
  await expect(parents.getByRole("listitem")).toContainText("Anna Muster");
  expect(calls.updates).toEqual([]);

  // In the cabinet the mother corrects her name and adds the father.
  state.lead = {
    ...state.lead,
    trusted_contacts: [{ ...annaContact, name: "Anna Maria Muster" }, benContact],
  };
  state.representation = {
    ...state.representation,
    representatives: [{ ...annaPerson, first_name: "Anna Maria" }, benPerson],
  };
  state.status = {
    ...state.status,
    representatives: [{ ...annaStatus, name: "Anna Maria Muster" }, benStatus],
  };
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
      detail: {
        type: "lead.portal_updated",
        entity_type: "lead",
        entity_id: id,
        occurred_at: "2026-10-05T10:30:00Z",
        payload: { change: "representation", access_kind: "guardian" },
      },
    }));
  }, leadId);

  // The contacts staff did not edit are replaced by the fresh ones.
  await expect(wizard.getByTestId("patient-updated-banner")).toBeVisible();
  await expect(parents.getByRole("listitem")).toHaveCount(2);
  await expect(parents.getByRole("listitem").nth(0)).toContainText("Anna Maria Muster");
  await expect(parents.getByRole("listitem").nth(1)).toContainText("Ben Muster");

  // The draft changed, so the wizard saves — without the contacts: staff did not change them.
  await expect.poll(() => calls.updates.length).toBeGreaterThan(0);
  for (const update of calls.updates) expect(update).not.toHaveProperty("trusted_contacts");

  // Staff add the father's e-mail: now the contacts go out, both parents and the corrected name included.
  const savesBefore = calls.updates.length;
  await parents
    .getByRole("listitem")
    .filter({ hasText: "Ben Muster" })
    .getByRole("button", { name: "Редактировать представителя" })
    .click();
  const editor = page.locator("form").filter({ hasText: "Редактировать доверенный контакт" });
  await editor.getByLabel("E-Mail").fill("ben.muster@example.com");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => calls.updates.length).toBeGreaterThan(savesBefore);
  const sent = calls.updates.at(-1)?.trusted_contacts as Json[];
  expect(sent).toEqual([
    { ...annaContact, name: "Anna Maria Muster" },
    { ...benContact, email: "ben.muster@example.com" },
  ]);

  // The documents step knows both parents as well.
  await openDocuments();
  await expect(statements.getByTestId(`lead-gwg-representative-${BEN_ID}`)).toContainText("Ben Muster");
  await expect(sheetActions.getByRole("button", { name: "Сформировать для Anna Maria Muster", exact: true })).toBeVisible();
  await expect(sheetActions.getByRole("button", { name: "Сформировать для Ben Muster", exact: true })).toBeVisible();
});
