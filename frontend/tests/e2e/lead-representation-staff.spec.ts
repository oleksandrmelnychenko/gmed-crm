import { expect, test, type Page } from "@playwright/test";

import { chooseComboboxOption } from "./helpers";

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
  /** When the lead (here: a parent) sent the request in the cabinet; not sent by default. */
  requestSentAt?: string;
  requestChanged?: boolean;
  /** Wizard step 1: who fills the data in; the patient by default here. */
  fillMode?: "staff" | "patient";
  /** The server's rule for the patient form (owner decision 2026-10-23): required for a new patient, optional for a repeat order. */
  selfDisclosureRequired?: boolean;
  refuseContactRemoval?: boolean;
  /** Ben's document as on DEV 2026-10-22: only the type and the dates stored. */
  benPartialId?: boolean;
  /** How long the mocked server takes for a document data save. */
  idSaveDelayMs?: number;
  /** The portal state asked right after the first document save answers this late. */
  staleIntakeMs?: number;
  /** The patient's stored document data (the portal state's identification). */
  patientId?: Json;
};

async function mount(page: Page, mock: Mock) {
  const state = {
    lead: {
      ...lead,
      trusted_contacts: mock.motherOnly ? [annaContact] : lead.trusted_contacts,
      readiness: mock.selfDisclosureRequired === undefined
        ? lead.readiness
        : {
            ...lead.readiness,
            checks: [{
              key: "self_disclosure_signed",
              label: "Patient form signed (first onboarding of a new patient)",
              passed: !mock.selfDisclosureRequired,
              required: mock.selfDisclosureRequired,
              blocking_for: "conversion",
              stage: "documents",
            }],
          },
    } as Json,
    representation: {
      has_representative: null,
      under_guardianship: null,
      custody: "joint",
      custody_stated: false,
      representatives: mock.motherOnly
        ? [annaPerson]
        : [
            annaPerson,
            mock.benPartialId
              ? {
                  ...benPerson,
                  id_document_type: "passport",
                  id_document_number: null,
                  id_issuing_authority: null,
                  id_issuing_country: null,
                  id_issued_on: "2026-10-01",
                  id_valid_until: "2031-10-31",
                  id_data_entered_by_name: "Intake QA",
                  id_data_entered_at: "2026-10-12T08:00:00Z",
                }
              : benPerson,
          ],
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
    removedContacts: [] as string[],
    /** Bodies of the document data saves of a representative. */
    idSaves: [] as Array<{ id: string; body: Json }>,
    /** Bodies of the document data saves of the patient. */
    patientIdSaves: [] as Json[],
    /** Bodies of the staff saves of a representative's address and birth data. */
    detailSaves: [] as Array<{ id: string; body: { values: Json; base: Json } }>,
  };
  let patientIdentification: Json = { birth_place: "Berlin", birth_country: "DE", contact_channels: ["email"], ...mock.patientId };
  let lateIntakeSent = false;
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
    const contactRemoval = path.match(/^\/leads\/[^/]+\/trusted-contacts\/([^/]+)$/);
    const idData = path.match(/^\/leads\/[^/]+\/representatives\/([^/]+)\/identity-document-data$/);
    let response: unknown = [];
    if (path === `/leads/${leadId}/identity-document-data` && method === "PUT") {
      const body = request.postDataJSON() as Json;
      calls.patientIdSaves.push(body);
      if (mock.idSaveDelayMs) await new Promise((resolve) => setTimeout(resolve, mock.idSaveDelayMs));
      patientIdentification = { ...patientIdentification, ...body, id_data_entered_by_name: "Intake QA", id_data_entered_at: new Date().toISOString() };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(patientIdentification) });
      return;
    }
    const details = path.match(/^\/leads\/[^/]+\/representatives\/([^/]+)\/details$/);
    if (details && method === "PUT") {
      const body = request.postDataJSON() as { values: Json; base: Json };
      calls.detailSaves.push({ id: details[1], body });
      // The server's merge: only what staff changed since loading is written.
      state.representation = {
        ...state.representation,
        representatives: state.representation.representatives.map((person) => {
          if (person.id !== details[1]) return person;
          const changed = Object.fromEntries(Object.entries(body.values).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(body.base[key])));
          return { ...person, ...changed };
        }),
      };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ representation: state.representation }) });
      return;
    }
    if (idData && method === "PUT") {
      const body = request.postDataJSON() as Json;
      calls.idSaves.push({ id: idData[1], body });
      if (mock.idSaveDelayMs) await new Promise((resolve) => setTimeout(resolve, mock.idSaveDelayMs));
      let stored: Json = {};
      state.representation = {
        ...state.representation,
        representatives: state.representation.representatives.map((person) => {
          if (person.id !== idData[1]) return person;
          stored = { ...person, ...body, id_data_entered_by_name: "Intake QA", id_data_entered_at: new Date().toISOString() };
          return stored;
        }),
      };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(stored) });
      return;
    }
    if (path === "/me") {
      response = { id: "repr-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = state.lead;
    } else if (path === `/leads/${leadId}/update` && method === "POST") {
      const body = request.postDataJSON() as Json;
      calls.updates.push(body);
      if (body.trusted_contacts) state.lead.trusted_contacts = body.trusted_contacts;
      response = {};
    } else if (contactRemoval && method === "DELETE") {
      calls.removedContacts.push(contactRemoval[1]);
      if (mock.refuseContactRemoval) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "The lead is converted", code: "lead_converted" }) });
        return;
      }
      state.lead.trusted_contacts = (state.lead.trusted_contacts as Json[]).filter((item) => item.id !== contactRemoval[1]);
      state.representation = {
        ...state.representation,
        representatives: state.representation.representatives.filter((item) => item.id !== contactRemoval[1]),
      };
      response = { representation: state.representation };
    } else if (path === `/leads/${leadId}/portal-intake`) {
      // The reload after the first document save answers late, with what was
      // stored when it was asked (a reload that overtakes a later save).
      const representation = JSON.parse(JSON.stringify(state.representation)) as Json;
      if (mock.staleIntakeMs && calls.idSaves.length === 1 && !lateIntakeSent) {
        lateIntakeSent = true;
        await new Promise((resolve) => setTimeout(resolve, mock.staleIntakeMs));
      }
      response = {
        lead_id: leadId,
        fill_mode: mock.fillMode ?? "patient",
        patient_fields: {},
        patient_payer: null,
        progress: { filled: 9, total: 12, documents: 0, submitted_at: mock.requestSentAt ?? null },
        submitted_at: mock.requestSentAt ?? null,
        changed_since_submit: mock.requestChanged ?? false,
        submitted_by: mock.requestSentAt ? "guardian" : null,
        consents: [],
        uploads: [],
        uploads_hidden: false,
        guardians: { links: [], candidates: [] },
        minor: true,
        can_issue: true,
        can_review_uploads: true,
        identification: patientIdentification,
        identification_updated_at: "2026-10-05T09:20:00Z",
        identity_documents: [],
        representation,
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

  // Desktop cards use four columns; the data stays read-only below the disclosure control.
  const grid = statements.getByTestId("lead-gwg-statements-grid");
  await expect.poll(() => grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(4);
  const content = statements.getByTestId("lead-gwg-statements-content");
  // The only control is "move to slot" next to a not yet accepted cabinet upload (2026-10-24).
  await expect(content.locator("input, textarea, select:not([data-testid^='lead-upload-move-']), button")).toHaveCount(0);
  await statements.getByRole("button", { name: "Свернуть данные пациента" }).click();
  await expect(content).toBeHidden();
  await statements.getByRole("button", { name: "Развернуть данные пациента" }).click();
  await expect(group).toBeVisible();

  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-statements-ru-desktop.png"), animations: "disabled" });
  // On a phone the group must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => grid.evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(1);
  // The single-column mobile layout preserves the identity, representation, interest order.
  const identityBox = await statements.getByTestId("lead-gwg-identity-documents").boundingBox();
  const groupBox = await group.boundingBox();
  const interestBox = await statements.getByTestId("lead-gwg-own-account").boundingBox();
  expect(identityBox!.y).toBeLessThan(groupBox!.y);
  expect(groupBox!.y + groupBox!.height).toBeLessThanOrEqual(interestBox!.y);
  expect(await wizard.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-representation-statements-ru-mobile.png"), animations: "disabled" });
});

test("each parent is identified instead of the child, and a paying parent only once", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, identification, row, calls } = await mount(page, { lang: "ru" });

  await expect(identification).toContainText("Идентификация по квалифицированной подписи");
  await expect(identification.getByTestId("lead-identification-minor")).toContainText(
    "платёж подтверждается только у того, кто платит",
  );
  // No line for the child, and none of its own for the paying mother.
  await expect(row("contract_partner").line).toHaveCount(0);
  await expect(identification.getByRole("listitem")).toHaveCount(2);

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

  // The mother also pays: her own line says so; no second payer line
  // (DEV 2026-10-22). The father does not pay: he only signs.
  await expect(row("payer").line).toHaveCount(0);
  await expect(anna.line).toContainText("родитель · плательщик");
  await expect(ben.payment).toHaveText("Платёж с собственного счёта не ожидается");
  await expect(ben.line.getByRole("button")).toHaveCount(0);

  await anna.line.getByRole("button", { name: "Подтвердить платёж" }).click();
  await expect(anna.payment).toHaveText("Платёж с собственного счёта подтверждён · 05.10.2026 · Intake QA");
  await expect(anna.line.getByRole("button", { name: "Отменить" })).toBeVisible();
  // The confirmation went to the paying representative, never to the child or the payer.
  expect(calls.payments).toEqual([{ subject: ANNA, body: { confirmed: true } }]);
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
    bindings: { gwg_identification: { subject: ANNA } },
  });
  // Her first sheet replaces nothing; the server names it after her.
  expect(calls.generated[0]).not.toHaveProperty("replace_document_id");
  expect(calls.generated[0]).not.toHaveProperty("auto_name");
  await expect(forBen).toBeEnabled();

  await forBen.click();
  await expect.poll(() => calls.generated.length).toBe(2);
  expect(calls.generated[1]).toMatchObject({
    template_id: "gwg_identification",
    lead_id: leadId,
    replace_document_id: "doc-ben-sheet",
    bindings: { gwg_identification: { subject: BEN } },
  });
  expect(calls.generated[1]).not.toHaveProperty("auto_name");

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

  await expect(row(ANNA).line).toContainText("Elternteil · Zahler");
  await expect(row("payer").line).toHaveCount(0);
  await expect(row(BEN).line).toContainText("keine E-Mail – die Signatur wird nicht angerechnet");
  await expect(sheetActions.getByTestId("gwg-identification-payer-same-person")).toHaveText(
    "kein eigener Bogen nötig: Zahler ist Vertreter/in Anna Muster",
  );
  await expect(sheetActions.getByRole("button", { name: "Für Ben Muster aktualisieren", exact: true })).toBeVisible();
  await sheetActions.getByRole("button", { name: "Für Anna Muster erstellen", exact: true }).click();
  await expect(wizard).toContainText(
    "Für diese Person kann kein Bogen erstellt werden: Sie ist nicht als gesetzliche Vertretung eines Minderjährigen erfasst.",
  );
  expect(calls.generated).toHaveLength(1);
});

test("the patient form waits until the request was sent", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "de", selfDisclosureRequired: true });

  const section = wizard.getByTestId("lead-wizard-self-disclosure-section");
  await expect(section).toHaveAttribute("data-available", "false");
  await expect(section.getByRole("heading", { name: "Patientenformular", exact: true })).toBeVisible();
  // Owner decision 2026-10-23: a new patient's first onboarding needs it.
  await expect(section).toHaveAttribute("data-requirement", "required");
  await expect(section.getByTestId("lead-wizard-self-disclosure-requirement")).toHaveText(
    "Pflicht: Erstaufnahme eines neuen Patienten",
  );
  await expect(section.getByRole("button", { name: "Dokument erstellen", exact: true })).toBeDisabled();
  // It says why the form cannot be made yet: it comes from the cabinet data.
  await expect(section.getByTestId("lead-wizard-self-disclosure-hint")).toHaveText(
    "Das Formular wird aus den Angaben im Kundenkabinett erstellt. Der Patient hat die Anfrage noch nicht gesendet – danach kann das Formular erstellt werden. Erfassen Sie die Angaben selbst, wählen Sie in Schritt 1 „Ich fülle aus“: Das Formular wird dann aus Ihren Angaben erstellt.",
  );
  await expect(section.getByTestId("lead-wizard-self-disclosure-hint")).toHaveClass(/bg-amber-50/);
  await expect(section).not.toContainText("Dokument wurde noch nicht erstellt");
  expect(calls.generated).toHaveLength(0);
});

test("staff who fill the data in create the patient form from the data they recorded (owner decision 2026-10-23)", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", fillMode: "staff", selfDisclosureRequired: true });

  const section = wizard.getByTestId("lead-wizard-self-disclosure-section");
  await expect(section).toHaveAttribute("data-available", "true");
  // The readiness rule stays: a new patient's first onboarding needs it.
  await expect(section).toHaveAttribute("data-requirement", "required");
  await expect(section.getByTestId("lead-wizard-self-disclosure-hint")).toHaveCount(0);
  await expect(section).not.toContainText("Пациент ещё не отправил заявку");
  await expect(section.getByTestId("lead-wizard-self-disclosure-source")).toContainText("«Angaben aufgenommen durch GMED»");
  await expect(section.getByTestId("lead-wizard-self-disclosure-source")).toContainText("на бумаге или КЭП");
  await section.getByRole("button", { name: "Создать документ", exact: true }).click();
  await expect.poll(() => calls.generated.length).toBe(1);
  expect(calls.generated[0]).toMatchObject({ template_id: "lead_self_disclosure", lead_id: leadId });
});

test("after the request was sent staff create the patient form from the server's data", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", requestSentAt: "2026-10-07T08:30:00Z", selfDisclosureRequired: false });

  const section = wizard.getByTestId("lead-wizard-self-disclosure-section");
  await expect(section).toHaveAttribute("data-available", "true");
  await expect(section.getByTestId("lead-wizard-self-disclosure-hint")).toHaveCount(0);
  // A repeat order may go without it.
  await expect(section).toHaveAttribute("data-requirement", "optional");
  await expect(section.getByTestId("lead-wizard-self-disclosure-requirement")).toHaveText("Необязательно: повторный заказ");
  await section.getByRole("button", { name: "Создать документ", exact: true }).click();
  await expect.poll(() => calls.generated.length).toBe(1);
  expect(calls.generated[0]).toMatchObject({
    template_id: "lead_self_disclosure",
    lead_id: leadId,
    language: "de",
    status: "active",
  });
  // The first form replaces nothing; the GwG sheets stay where they are.
  expect(calls.generated[0]).not.toHaveProperty("replace_document_id");
  await expect(wizard.getByTestId("gwg-identification-actions")).toBeVisible();
});

test("the patient form waits for resubmission after the lead edits the answers", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "de", requestSentAt: "2026-10-07T08:30:00Z", requestChanged: true });
  const section = wizard.getByTestId("lead-wizard-self-disclosure-section");
  await expect(section).toHaveAttribute("data-available", "false");
  await expect(section.getByRole("button", { name: "Dokument erstellen", exact: true })).toBeDisabled();
  await expect(section.getByTestId("lead-wizard-self-disclosure-hint")).toContainText("nach dem erneuten Senden erstellt werden");
  // Without the server's rule the wizard shows no requirement label.
  await expect(section.getByTestId("lead-wizard-self-disclosure-requirement")).toHaveCount(0);
  expect(calls.generated).toHaveLength(0);
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

  const contacts = wizard.getByRole("list", { name: "Контакты и представители" });
  const anna = contacts.getByRole("listitem").filter({ hasText: "Anna Muster" });
  await expect(anna.getByTestId("trusted-contact-gwg-badge")).toHaveText("Представитель (GwG)");
  // Staff may now remove the whole contact directly, or clear only its GwG data.
  await expect(anna.getByRole("button", { name: "Удалить контакт: Anna Muster" })).toBeVisible();
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

  // The app's own dialog asks (no browser confirm(), which a browser may suppress).
  let nativeDialogs = 0;
  page.on("dialog", (dialog) => {
    nativeDialogs += 1;
    void dialog.dismiss();
  });
  // Declined: nothing happens, the wizard stays open.
  await removeData.click();
  const question = page.getByTestId("lead-gwg-data-remove-dialog");
  await expect(question).toBeVisible();
  await expect(question).toContainText("Убрать данные GwG у контакта «Anna Muster»?");
  await expect(question).toContainText("Сам контакт и документы останутся.");
  await question.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(wizard).toBeVisible();
  expect(calls.removedData).toEqual([]);

  await removeData.click();
  await question.getByRole("button", { name: "Убрать данные GwG", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(anna.getByTestId("trusted-contact-gwg-badge")).toHaveCount(0);
  expect(calls.removedData).toEqual([ANNA_ID]);
  expect(nativeDialogs).toBe(0);
  // Staff see that it worked.
  await expect(page.getByText("Данные GwG у контакта «Anna Muster» удалены")).toBeVisible();
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

for (const lang of ["ru", "de"] as const) {
  test(`staff remove an added parent directly from the first step (${lang})`, async ({ page }) => {
    const { wizard, calls, state } = await mount(page, { lang, step: "master" });
    const parents = wizard.locator("#lead-wizard-guardian");
    const remove = parents.getByRole("button", { name: `${lang === "ru" ? "Удалить представителя" : "Vertreter entfernen"}: Anna Muster`, exact: true });
    await remove.click();
    const question = page.getByTestId("lead-contact-remove-dialog");
    await expect(question).toBeVisible();
    await question.getByRole("button", { name: lang === "ru" ? "Отмена" : "Abbrechen", exact: true }).click();
    await expect(parents.getByRole("listitem")).toHaveCount(2);
    expect(calls.removedContacts).toEqual([]);

    await remove.click();
    await question.getByRole("button", { name: lang === "ru" ? "Удалить" : "Entfernen", exact: true }).click();
    await expect(question).toBeHidden();
    await expect(parents.getByRole("listitem")).toHaveCount(1);
    await expect(parents.getByRole("listitem")).toContainText("Ben Muster");
    expect(calls.removedContacts).toEqual([ANNA_ID]);
    // Wait past the autosave debounce: no stale snapshot restores the mother.
    await page.waitForTimeout(1200);
    expect(state.lead.trusted_contacts).toEqual([benContact]);
    await page.reload();
    await page.getByRole("button", { name: "Lead intake", exact: true }).click();
    await expect(parents.getByRole("listitem")).toHaveCount(1);
    await expect(parents.getByRole("listitem")).toContainText("Ben Muster");
  });
}

test("staff explicitly choose the parent's role and linking a patient preserves it", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", step: "master" });
  const linkedId = "44444444-4444-4444-8444-444444444444";
  await page.route("**/api/v1/leads/guardian-candidates**", (route) => route.fulfill({ json: [{ id: linkedId, source: "patient", patient_record_id: linkedId, display_id: "P-SYNTHETIC", address: "Testweg 1", first_name: "Existing", last_name: "Mother", birth_date: "1985-05-01", email: "existing.mother@example.test", phone: "+49 30 100009" }] }));
  const parents = wizard.locator("#lead-wizard-guardian");
  await parents.getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
  const editor = page.locator("form").filter({ hasText: "Редактировать родителя или законного представителя" });
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editor).toContainText("Укажите, кто представляет ребёнка: мать, отец или опекун");
  expect(calls.updates).toEqual([]);
  await editor.getByLabel("Кем приходится ребёнку").click();
  await page.getByRole("option", { name: "Мать (родитель)", exact: true }).click();
  await editor.getByLabel("Выбрать из пациентов или лидов").click();
  await page.getByRole("option", { name: /Existing Mother/ }).click();
  await expect(editor.getByLabel("Кем приходится ребёнку")).toContainText("Мать");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => (calls.updates.at(-1)?.trusted_contacts as Json[] | undefined)?.find((contact) => contact.id === ANNA_ID)?.relation).toBe("mother");
  const written = (calls.updates.at(-1)?.trusted_contacts as Json[]).find((contact) => contact.id === ANNA_ID)!;
  expect(written.related_patient_id).toBe(linkedId);
  await expect(parents.getByRole("listitem").filter({ hasText: "Existing Mother" })).toContainText("Мать");
});

test("Sales links a patient seen by name and number only and keeps the contact data typed", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", step: "master" });
  const linkedId = "55555555-5555-4555-8555-555555555555";
  // Owner 2026-10-23: without patients.view the server sends name + number only.
  await page.route("**/api/v1/leads/guardian-candidates**", (route) => route.fulfill({ json: [{ id: linkedId, source: "patient", patient_record_id: linkedId, display_id: "P-HIDDEN", first_name: "Hidden", last_name: "Mother", birth_date: null, email: null, phone: null, address: null, contact_hidden: true }] }));
  const parents = wizard.locator("#lead-wizard-guardian");
  await parents.getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
  const editor = page.locator("form").filter({ hasText: "Редактировать родителя или законного представителя" });
  await editor.getByLabel("Кем приходится ребёнку").click();
  await page.getByRole("option", { name: "Мать (родитель)", exact: true }).click();
  await editor.getByLabel("Выбрать из пациентов или лидов").click();
  await page.getByRole("option", { name: /P-HIDDEN · Hidden Mother/ }).click();
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => (calls.updates.at(-1)?.trusted_contacts as Json[] | undefined)?.find((contact) => contact.id === ANNA_ID)?.related_patient_id).toBe(linkedId);
  const written = (calls.updates.at(-1)?.trusted_contacts as Json[]).find((contact) => contact.id === ANNA_ID)!;
  expect(written.name).toBe("Hidden Mother");
  expect(written.email).toBe("anna.muster@example.com");
});

test("a new parent's role has no default and an explicit father stays in the parents list", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", step: "master", motherOnly: true });
  const parents = wizard.locator("#lead-wizard-guardian");
  await wizard.getByRole("button", { name: "Добавить", exact: true }).click();
  const editor = page.locator("form").filter({ hasText: "Добавить родителя или законного представителя" });
  await editor.getByLabel("Имя и фамилия").fill("New Father");
  await editor.getByLabel("Телефон").fill("+49 30 100004");
  await editor.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(editor).toContainText("Укажите, кто представляет ребёнка: мать, отец или опекун");
  await editor.getByLabel("Кем приходится ребёнку").click();
  await page.getByRole("option", { name: "Отец (родитель)", exact: true }).click();
  await editor.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect.poll(() => (calls.updates.at(-1)?.trusted_contacts as Json[] | undefined)?.find((contact) => contact.name === "New Father")?.relation).toBe("father");
  await expect(parents.getByRole("listitem").filter({ hasText: "New Father" })).toContainText("Отец");
});

test("a failed removal keeps the parent on the first step", async ({ page }) => {
  const { wizard, state } = await mount(page, { lang: "ru", step: "master", refuseContactRemoval: true });
  const parents = wizard.locator("#lead-wizard-guardian");
  await parents.getByRole("button", { name: "Удалить представителя: Anna Muster", exact: true }).click();
  await page.getByTestId("lead-contact-remove-dialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(parents.getByRole("listitem")).toHaveCount(2);
  expect(state.lead.trusted_contacts).toEqual([annaContact, benContact]);
  await expect(wizard.getByRole("button", { name: "Удалить представителя: Anna Muster", exact: true })).toBeEnabled();
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
  // Opened from the parents' block: the editor is titled for a parent (QA 2026-10-10).
  const editor = page.locator("form").filter({ hasText: "Редактировать родителя или законного представителя" });
  await editor.getByLabel("E-Mail").fill("ben.muster@example.com");
  await editor.getByLabel("Кем приходится ребёнку").click();
  await page.getByRole("option", { name: "Отец (родитель)", exact: true }).click();
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => calls.updates.length).toBeGreaterThan(savesBefore);
  const sent = calls.updates.at(-1)?.trusted_contacts as Json[];
  expect(sent).toEqual([
    { ...annaContact, name: "Anna Maria Muster" },
    { ...benContact, email: "ben.muster@example.com", relation: "father" },
  ]);

  // The documents step knows both parents as well.
  await openDocuments();
  await expect(statements.getByTestId(`lead-gwg-representative-${BEN_ID}`)).toContainText("Ben Muster");
  await expect(sheetActions.getByRole("button", { name: "Сформировать для Anna Maria Muster", exact: true })).toBeVisible();
  await expect(sheetActions.getByRole("button", { name: "Сформировать для Ben Muster", exact: true })).toBeVisible();
});

for (const width of [1440, 390]) {
  test(`parent editor is a centered modal with guarded dismissal at ${width}px`, async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width, height: 900 });
    const { wizard, calls } = await mount(page, { lang: "ru", step: "master" });
    await wizard.locator("#lead-wizard-guardian").getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
    const editor = page.getByTestId("trusted-contact-editor");
    await expect(editor).toBeVisible();
    const box = await editor.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(Math.min(720, width - 16));
    expect(Math.abs(box!.x + box!.width / 2 - width / 2)).toBeLessThan(2);
    expect(box!.height).toBeLessThanOrEqual(884);
    await page.screenshot({ path: testInfo.outputPath("parent-editor.png") });
    await editor.getByLabel("Имя и фамилия").fill("Unsaved Parent");
    await page.keyboard.press("Escape");
    await expect(editor).toBeVisible();
    expect(calls.updates).toEqual([]);
    await expect(page.getByRole("alertdialog", { name: "Закрыть без сохранения?" })).toBeVisible();
    await expect(editor.getByLabel("Имя и фамилия")).toHaveValue("Unsaved Parent");
  });
}

test("a parent's address from the cabinet is shown read-only, as the GwG sheet prints it", async ({ page }) => {
  // Field parity 2026-10-24: staff changed the one-line address of a parent here,
  // while the GwG sheet and the consent form kept printing the cabinet's parts.
  const { wizard } = await mount(page, { lang: "ru", step: "master" });
  await wizard.locator("#lead-wizard-guardian").getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
  const editor = page.getByTestId("trusted-contact-editor");
  const address = editor.getByRole("textbox", { name: /^Адрес/ });
  await expect(address).toHaveValue("Musterweg 1, 10115 Berlin, Германия");
  await expect(address).toHaveAttribute("readonly", "");
  await expect(editor.getByTestId("trusted-contact-address-cabinet")).toContainText("Из кабинета");
});

test("staff correct a parent's address and birth data for the GwG sheet (owner 2026-10-24)", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", step: "master" });
  await wizard.locator("#lead-wizard-guardian").getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
  const editor = page.getByTestId("trusted-contact-editor");
  const form = editor.getByTestId(`lead-representative-details-${ANNA_ID}`);
  await expect(form.locator('input[name="street"]')).toHaveValue("Musterweg 1");
  const save = form.getByRole("button", { name: "Сохранить адрес и данные" });
  await expect(save).toBeDisabled();
  await form.locator('input[name="street"]').fill("Neue Straße 5");
  await form.locator('input[name="birth_place"]').fill("Lviv");
  await save.click();
  await expect.poll(() => calls.detailSaves.length).toBe(1);
  // What the form loaded goes along, so the server keeps a cabinet change made meanwhile.
  expect(calls.detailSaves[0]).toMatchObject({
    id: ANNA_ID,
    body: {
      values: { street: "Neue Straße 5", birth_place: "Lviv", city: "Berlin", zip: "10115", country: "DE", citizenships: ["UA", "DE"] },
      base: { street: "Musterweg 1", birth_place: "Kyiv", city: "Berlin" },
    },
  });
  await expect(form.getByTestId(`lead-representative-details-${ANNA_ID}-saved`)).toBeVisible();
  // The one-line address shows the parts the GwG sheet prints.
  await expect(editor.getByRole("textbox", { name: /^Адрес/ })).toHaveValue("Neue Straße 5, 10115 Berlin, Германия");
  // A city too long for the shared rule is refused before saving.
  await form.locator('input[name="city"]').evaluate((input: HTMLInputElement) => input.removeAttribute("maxlength"));
  await form.locator('input[name="city"]').fill("y".repeat(121));
  await expect(form.getByText("Слишком длинное значение")).toBeVisible();
  await expect(save).toBeDisabled();
});

test("a parent born less than 18 years ago is refused in the contact editor", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", step: "master" });
  await wizard.locator("#lead-wizard-guardian").getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
  const editor = page.getByTestId("trusted-contact-editor");
  await editor.getByLabel("Кем приходится ребёнку").click();
  await page.getByRole("option", { name: "Мать (родитель)", exact: true }).click();
  // Typed like staff type it: day, month, year.
  await editor.getByRole("group", { name: "Дата рождения" }).getByRole("spinbutton").first().click();
  await page.keyboard.type("02032015");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(editor.getByText("Родитель или представитель должен быть совершеннолетним (18+)")).toBeVisible();
  expect(calls.updates).toEqual([]);
});

test("staff reuse a mother who is still a lead without creating a patient link", async ({ page }) => {
  const { wizard, calls } = await mount(page, { lang: "ru", step: "master", motherOnly: true });
  await page.route("**/api/v1/leads/guardian-candidates**", route => route.fulfill({ json: [{
    id: "55555555-5555-4555-8555-555555555555", source: "lead", patient_record_id: null, display_id: null,
    first_name: "Existing", last_name: "Leadmother", birth_date: "1985-05-01",
    email: "existing.leadmother@example.test", phone: null, address: "Testweg 2, Berlin",
  }] }));
  const parents = wizard.locator("#lead-wizard-guardian");
  await parents.getByRole("listitem").filter({ hasText: "Anna Muster" }).getByRole("button", { name: "Редактировать представителя" }).click();
  const editor = page.locator("form").filter({ hasText: "Редактировать родителя или законного представителя" });
  await editor.getByLabel("Кем приходится ребёнку").click();
  await page.getByRole("option", { name: "Мать (родитель)", exact: true }).click();
  await editor.getByLabel("Выбрать из пациентов или лидов").click();
  await page.getByRole("option", { name: /Existing Leadmother/ }).click();
  await expect(editor.getByLabel("E-Mail", { exact: true })).toHaveValue("existing.leadmother@example.test");
  await editor.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => (calls.updates.at(-1)?.trusted_contacts as Json[] | undefined)?.find(c => c.id === ANNA_ID)?.name).toBe("Existing Leadmother");
  const written = (calls.updates.at(-1)?.trusted_contacts as Json[]).find(c => c.id === ANNA_ID)!;
  expect(written).toMatchObject({ relation: "mother", email: "existing.leadmother@example.test", birth_date: "1985-05-01" });
  expect(written.related_patient_id ?? null).toBeNull();
});

test("a parent's typed document data are saved whole and stay in the form", async ({ page }) => {
  // DEV 2026-10-22: the number, the authority and the country of a parent's
  // passport were typed, "Сохранить данные документа" was pressed, and the
  // form fell back to the stored type and dates; the server kept them empty.
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, calls } = await mount(page, { lang: "ru", benPartialId: true, idSaveDelayMs: 300, staleIntakeMs: 2500 });
  const form = wizard.getByTestId(`lead-representative-id-data-${BEN_ID}`);
  const card = form.locator("xpath=ancestor::details[1]");
  if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open))) {
    await card.locator("summary").click();
  }
  await expect(form).toBeVisible();
  const outside = wizard.getByTestId("lead-identity-document-data").locator("h4").first();
  // The number first, then staff leave the form: stored at once.
  await form.locator('input[name="id_document_number"]').fill("c01x00t47");
  await outside.click();
  await expect.poll(() => calls.idSaves.length).toBe(1);
  expect(calls.idSaves[0].body).toMatchObject({ id_document_number: "C01X00T47", id_issuing_country: null });
  // The authority and the country from the list are stored by themselves.
  await form.locator('input[name="id_issuing_authority"]').fill("Bürgeramt Mitte");
  await chooseComboboxOption(page, form.getByRole("combobox", { name: "Страна выдачи" }), /^Германия$/);
  await expect.poll(() => calls.idSaves.at(-1)?.body.id_issuing_country).toBe("DE");
  await expect(form.getByTestId(`lead-representative-id-data-${BEN_ID}-saved`)).toBeVisible();
  // The late reload of the first save (only the number) must not reset the form.
  await page.waitForTimeout(3000);
  // Whatever was sent last is what the server keeps.
  expect(calls.idSaves.at(-1)?.body).toEqual({
    id_document_type: "passport",
    id_document_number: "C01X00T47",
    id_issuing_authority: "Bürgeramt Mitte",
    id_issuing_country: "DE",
    id_issued_on: "2026-10-01",
    id_valid_until: "2031-10-31",
    id_document_unreadable: false,
  });
  await expect(form.locator('input[name="id_document_number"]')).toHaveValue("C01X00T47");
  await expect(form.locator('input[name="id_issuing_authority"]')).toHaveValue("Bürgeramt Mitte");
  await expect(form.getByRole("combobox", { name: "Страна выдачи" })).toContainText("Германия");
  await expect(form.getByTestId(`lead-representative-id-data-${BEN_ID}-unsaved`)).toHaveCount(0);
  // Leaving the form after the save sends nothing stale.
  const count = calls.idSaves.length;
  await form.locator('input[name="id_issuing_authority"]').click();
  await outside.click();
  await page.waitForTimeout(800);
  expect(calls.idSaves.slice(count).every((call) => call.body.id_document_number === "C01X00T47")).toBe(true);
  await expect(form.locator('input[name="id_document_number"]')).toHaveValue("C01X00T47");
  await expect(form.getByTestId(`lead-representative-id-data-${BEN_ID}-status`)).toHaveText(
    "Данные заполнены · действителен до 31.10.2031",
  );

  // A number that breaks the rules is named at the field and never sent.
  const saves = calls.idSaves.length;
  await form.locator('input[name="id_document_number"]').fill("ab/1");
  await outside.click();  await expect(form.getByText("Только латинские буквы A–Z, цифры, пробел, «-» и «<»")).toBeVisible();
  await expect(form.getByTestId(`lead-representative-id-data-${BEN_ID}-unsaved`)).toBeVisible();
  await page.waitForTimeout(500);
  expect(calls.idSaves).toHaveLength(saves);
});

// DEV 2026-10-22 (lead "Linda Testova"): the type was stored alone and every
// later edit of the patient's and the parent's document data never reached
// the server. Staff fill the form as people do — the type from the list, the
// number and the authority typed key by key, the country from the list, the
// dates from the calendar and typed as DD.MM.YYYY — and then leave in one of
// the usual ways. Whatever was typed last is what the server keeps.
const FULL_DOCUMENT = {
  id_document_type: "id_card",
  id_document_number: "C01X00T47",
  id_issuing_authority: "Bürgeramt Mitte",
  id_issuing_country: "DE",
  id_issued_on: "2021-10-01",
  id_valid_until: "2031-10-31",
  id_document_unreadable: false,
};

async function typeDate(page: Page, group: ReturnType<Page["getByRole"]>, value: string) {
  await group.getByRole("spinbutton", { name: /^(День|Tag)$/ }).focus();
  await page.keyboard.type(value.replaceAll(".", ""), { delay: 15 });
}

async function fillLikeStaff(page: Page, form: ReturnType<Page["getByTestId"]>) {
  await chooseComboboxOption(page, form.getByRole("combobox", { name: "Вид документа" }), /^Удостоверение личности$/);
  const number = form.locator('input[name="id_document_number"]');
  await number.click();
  await number.pressSequentially("c01x00t47", { delay: 15 });
  await chooseComboboxOption(page, form.getByRole("combobox", { name: "Страна выдачи" }), /^Германия$/);
  const authority = form.locator('input[name="id_issuing_authority"]');
  await authority.click();
  await authority.pressSequentially("Bürgeramt Mitte", { delay: 15 });
  await typeDate(page, form.getByRole("group", { name: "Дата выдачи" }), "01.10.2021");
  // "Valid until" first from the calendar, then corrected by typing.
  const validUntil = form.getByRole("group", { name: "Действителен до" });
  await validUntil.locator("..").getByRole("button").click();
  await page.getByRole("grid").last().getByRole("gridcell", { name: "20", exact: true }).first().click();
  await expect(validUntil).toContainText("20");
  await typeDate(page, validUntil, "31.10.2031");
  await expect(validUntil).toContainText("31.10.2031");
}

async function expectFormShows(form: ReturnType<Page["getByTestId"]>) {
  await expect(form.getByRole("combobox", { name: "Вид документа" })).toContainText("Удостоверение личности");
  await expect(form.locator('input[name="id_document_number"]')).toHaveValue("C01X00T47");
  await expect(form.locator('input[name="id_issuing_authority"]')).toHaveValue("Bürgeramt Mitte");
  await expect(form.getByRole("combobox", { name: "Страна выдачи" })).toContainText("Германия");
  await expect(form.getByRole("group", { name: "Дата выдачи" })).toContainText("01.10.2021");
  await expect(form.getByRole("group", { name: "Действителен до" })).toContainText("31.10.2031");
}

const ID_FORMS = {
  patient: { testId: "lead-id-data", saves: (calls: { patientIdSaves: Json[] }) => calls.patientIdSaves },
  parent: {
    testId: `lead-representative-id-data-${BEN_ID}`,
    saves: (calls: { idSaves: Array<{ id: string; body: Json }> }) => calls.idSaves.filter((call) => call.id === BEN_ID).map((call) => call.body),
  },
} as const;

type IdExit = "stay" | "outside" | "collapse" | "step" | "close";
const ID_EXITS: Array<[keyof typeof ID_FORMS, IdExit]> = [
  ["patient", "stay"],
  ["patient", "outside"],
  ["patient", "step"],
  ["patient", "close"],
  ["parent", "stay"],
  ["parent", "outside"],
  ["parent", "collapse"],
  ["parent", "step"],
  ["parent", "close"],
];

for (const [who, exit] of ID_EXITS) {
  test(`the ${who}'s document data typed like staff do reach the server (${exit})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    const { wizard, calls, openDocuments } = await mount(page, {
      lang: "ru",
      idSaveDelayMs: 250,
      // As on DEV: Ben's passport with the dates only.
      benPartialId: true,
    });
    const target = ID_FORMS[who];
    const saves = () => target.saves(calls);
    const formOf = () => wizard.getByTestId(target.testId);
    const form = formOf();
    if (who === "parent") {
      const card = form.locator("xpath=ancestor::details[1]");
      if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open))) await card.locator("summary").click();
    }
    await expect(form).toBeVisible();
    await fillLikeStaff(page, form);
    const status = (suffix: string) => form.getByTestId(`${target.testId}-${suffix}`);

    if (exit === "stay") {
      // Nobody leaves: the form stores the edits by itself after a pause.
      await expect.poll(saves, { timeout: 5_000 }).toContainEqual(FULL_DOCUMENT);
      await expect(status("saved")).toBeVisible();
      await expect(status("unsaved")).toHaveCount(0);
    } else if (exit === "outside") {
      await wizard.getByTestId("lead-identity-document-data").locator("h4").first().click();
      await expect(status("saved")).toBeVisible();
      await expect(status("unsaved")).toHaveCount(0);
    } else if (exit === "collapse") {
      await form.locator("xpath=ancestor::details[1]").locator("summary").click();
      await expect(form).toBeHidden();
    } else if (exit === "step") {
      await wizard.locator('[role="tab"][data-step="master_data"]').click();
      await expect(wizard.locator('[role="tab"][data-step="master_data"]')).toHaveAttribute("aria-selected", "true");
    } else {
      await wizard.getByRole("button", { name: /^(Закрыть|Schließen|Close)$/ }).first().click();
      await expect(wizard).toBeHidden();
    }
    await expect.poll(() => saves().at(-1), { timeout: 5_000 }).toEqual(FULL_DOCUMENT);
    // Nothing older is sent after the full document.
    await page.waitForTimeout(1_200);
    expect(saves().at(-1)).toEqual(FULL_DOCUMENT);

    // Back in the form, the stored values are shown.
    if (exit === "close") {
      await page.getByRole("button", { name: "Lead intake", exact: true }).click();
      await openDocuments();
    } else if (exit === "step") {
      await openDocuments();
    }
    const again = formOf();
    if (who === "parent") {
      const card = again.locator("xpath=ancestor::details[1]");
      if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open))) await card.locator("summary").click();
    }
    await expectFormShows(again);
    await expect(again.getByTestId(`${target.testId}-unsaved`)).toHaveCount(0);
  });
}

test("one wrong field never holds back the other document data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, calls } = await mount(page, { lang: "ru", benPartialId: true });
  const testId = `lead-representative-id-data-${BEN_ID}`;
  const form = wizard.getByTestId(testId);
  const card = form.locator("xpath=ancestor::details[1]");
  if (!(await card.evaluate((node) => (node as HTMLDetailsElement).open))) await card.locator("summary").click();
  const saves = () => calls.idSaves.filter((call) => call.id === BEN_ID).map((call) => call.body);
  // A Cyrillic number (typed in the wrong keyboard layout) next to good data.
  const number = form.locator('input[name="id_document_number"]');
  await number.click();
  await number.pressSequentially("АВ123456", { delay: 15 });
  const authority = form.locator('input[name="id_issuing_authority"]');
  await authority.click();
  await authority.pressSequentially("Bürgeramt Mitte", { delay: 15 });
  await chooseComboboxOption(page, form.getByRole("combobox", { name: "Страна выдачи" }), /^Германия$/);
  await wizard.getByTestId("lead-identity-document-data").locator("h4").first().click();
  // The good fields are stored; the wrong number is not sent, stays typed and says why.
  await expect.poll(() => saves().at(-1)).toMatchObject({
    id_document_number: null,
    id_issuing_authority: "Bürgeramt Mitte",
    id_issuing_country: "DE",
  });
  expect(saves().every((body) => body.id_document_number === null)).toBe(true);
  await expect(number).toHaveValue("АВ123456");
  await expect(form.getByText("Только латинские буквы A–Z, цифры, пробел, «-» и «<»")).toBeVisible();
  await expect(form.getByTestId(`${testId}-unsaved`)).toContainText("исправьте поля");
  await expect(form.getByTestId(`${testId}-saved`)).toHaveCount(0);
  // Corrected, it is stored by itself.
  await number.fill("");
  await number.pressSequentially("AB123456", { delay: 15 });
  await expect.poll(() => saves().at(-1)?.id_document_number).toBe("AB123456");
  await expect(form.getByTestId(`${testId}-saved`)).toBeVisible();
  await expect(form.getByTestId(`${testId}-unsaved`)).toHaveCount(0);
});
