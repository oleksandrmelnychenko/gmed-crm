import { expect, test, type Page } from "@playwright/test";

import { chooseComboboxOption } from "./helpers";

// «Новая заявка для этого человека» (owner 2026-10-25): a relation recorded on
// a patient (or a representative of an open lead) becomes a lead of their own,
// prefilled from the identity data GMED already holds. Mocked API, synthetic
// data: what the patient card offers, what `POST /leads` carries, what the
// wizard says it copied, and the 409 for a person who already is a patient.

type Json = Record<string, unknown>;

const PATIENT_ID = "00000000-0000-0000-0000-00000000c001";
const RELATION_ID = "00000000-0000-0000-0000-00000000c011";
const LINKED_RELATION_ID = "00000000-0000-0000-0000-00000000c012";
const LINKED_PATIENT_ID = "00000000-0000-0000-0000-00000000c002";
const NEW_LEAD_ID = "00000000-0000-0000-0000-00000000c101";
const OPEN_LEAD_ID = "00000000-0000-0000-0000-00000000c222";
const BEN_ID = "22222222-2222-4222-8222-222222222222";

const child: Json = {
  id: PATIENT_ID,
  patient_id: "P-2026-0001",
  first_name: "Mia",
  last_name: "Muster",
  birth_date: "2015-06-01",
  gender: "female",
  email: "mia.muster@example.com",
  phone_primary: "+49 30 100001",
  address_street: "Musterweg 1",
  address_city: "Berlin",
  address_zip: "10115",
  address_country: "DE",
  languages: ["de"],
  lifecycle_status: "active",
  is_active: true,
  created_at: "2026-10-01T08:00:00Z",
  updated_at: "2026-10-01T08:00:00Z",
};

const relations: Json[] = [
  {
    id: RELATION_ID,
    related_patient_id: null,
    related_patient_pid: null,
    related_name: "Anna Muster",
    relation_type: "mother",
    is_emergency_contact: true,
    phone: "+49 170 1234567",
    email: "anna.muster@example.com",
    address_street: "Musterweg 1",
    address_zip: "10115",
    address_city: "Berlin",
    address_country: "DE",
    notes: null,
    created_at: "2026-10-01T08:00:00Z",
  },
  {
    id: LINKED_RELATION_ID,
    related_patient_id: LINKED_PATIENT_ID,
    related_patient_pid: "P-2026-0002",
    related_name: "Ben Muster",
    relation_type: "father",
    is_emergency_contact: false,
    phone: null,
    email: null,
    notes: null,
    created_at: "2026-10-01T08:00:00Z",
  },
];

/** What the server holds after it merged the relation (and the ID data of the mother's representative row). */
const createdLead = (): Json => ({
  id: NEW_LEAD_ID,
  first_name: "Anna",
  last_name: "Muster",
  middle_name: null,
  email: "anna.muster@example.com",
  phone: "+49 170 1234567",
  date_of_birth: "1985-03-02",
  legal_sex: "female",
  street_address: "Musterweg 1",
  city: "Berlin",
  zip_code: "10115",
  country: "DE",
  citizenships: ["UA"],
  primary_language: "ru",
  source: "manual",
  qualification_status: "new",
  intake_model: "patient_first",
  repeat_patient_id: null,
  source_relation_id: RELATION_ID,
  source_contact_lead_id: null,
  source_contact_id: null,
  source_pep_hint: "yes",
  wizard_state: {},
  services: [],
  attachments: [],
  trusted_contacts: [],
  requested_specialties: [],
  created_at: "2026-10-25T08:00:00Z",
  updated_at: "2026-10-25T08:00:00Z",
  readiness: { conversion_ready: false, qualification_ready: false, qualification_reasons: [], blocking_reasons: [], steps: [], checks: [] },
});

/** A minor lead whose father is a trusted contact without an own record. */
const openLead: Json = {
  id: OPEN_LEAD_ID,
  first_name: "Mia",
  last_name: "Muster",
  email: "mia.muster@example.com",
  phone: null,
  date_of_birth: "2015-06-01",
  legal_sex: "female",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  wizard_state: {},
  services: [],
  attachments: [],
  trusted_contacts: [
    { id: BEN_ID, related_patient_id: null, name: "Ben Muster", phone: "+49 30 100002", email: null, relation: "father", birth_date: "1983-07-08", address: null },
  ],
  requested_specialties: [],
  created_at: "2026-10-20T08:00:00Z",
  updated_at: "2026-10-20T08:00:00Z",
  readiness: { conversion_ready: false, qualification_ready: true, qualification_reasons: [], blocking_reasons: [], steps: [], checks: [] },
};

type Mock = {
  /** `POST /leads` answers this instead of the created lead. */
  createStatus?: number;
  createBody?: Json;
};

async function mount(page: Page, mock: Mock = {}) {
  const calls: { method: string; path: string; body: Json | null }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-source-person-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = decodeURIComponent(url.pathname.replace("/api/v1", ""));
    const method = request.method();
    const body = method === "GET" ? null : (() => { try { return request.postDataJSON() as Json; } catch { return null; } })();
    calls.push({ method, path, body });
    let response: unknown = [];
    let status = 200;
    if (path === "/me") response = { id: "source-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    else if (path === "/sanctions/check") response = { status: "clear", list_version_date: "2026-10-01" };
    else if (path === `/patients/${PATIENT_ID}`) response = child;
    else if (path === `/patients/${PATIENT_ID}/relations`) response = relations;
    else if (path === "/leads" && method === "POST") {
      if (mock.createStatus) { status = mock.createStatus; response = mock.createBody ?? {}; }
      else response = {
        id: NEW_LEAD_ID,
        prefilled_from_source: {
          fields: ["date_of_birth", "citizenships", "birth_place", "id_document_type", "id_document_number", "id_valid_until"],
          hints: { pep_self: "yes", sanctions_links: null, identity_document_id: null },
        },
      };
    }
    else if (path === `/leads/${NEW_LEAD_ID}`) response = createdLead();
    else if (path === `/leads/${NEW_LEAD_ID}/update`) response = {};
    else if (path === `/leads/${OPEN_LEAD_ID}`) response = openLead;
    else if (path === `/leads/${OPEN_LEAD_ID}/update`) response = {};
    else if (path === "/orders" && method === "POST") response = { id: "order-1" };
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(response) });
  });
  return calls;
}

const wizardOf = (page: Page) => page.getByRole("dialog", { name: "Оформление обращения", exact: true });

async function fillBirthAndSex(page: Page) {
  await page.getByRole("group", { name: "Дата рождения" }).getByRole("spinbutton").first().click();
  await page.keyboard.type("02031985");
  await chooseComboboxOption(page, page.locator("#lead-wizard-legal-sex"), "Женский");
}

test("the patient card opens a request for the mother; the wizard sends the source and names what it copied", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const calls = await mount(page);
  await page.goto(`/patients/${PATIENT_ID}?tab=relations`);

  // A relation with an own record is opened as a patient; one without gets the new request.
  await expect(page.getByRole("button", { name: "Открыть пациента" })).toBeVisible();
  await page.getByRole("button", { name: "Новая заявка для этого человека: Anna Muster" }).click();

  await expect(page).toHaveURL(/\/leads/);
  const wizard = wizardOf(page);
  await expect(wizard).toBeVisible({ timeout: 45_000 });
  // The source parameters are consumed once: a reload must not reopen the wizard.
  await expect(page).not.toHaveURL(/source_patient/);
  // What the relation row holds seeds step 1 before the first save.
  await expect(wizard.locator("#lead-wizard-first-name")).toHaveValue("Anna");
  await expect(wizard.locator("#lead-wizard-last-name")).toHaveValue("Muster");
  await expect(wizard.locator("#lead-wizard-email")).toHaveValue("anna.muster@example.com");
  await expect(wizard.locator("#lead-wizard-phone")).toHaveValue("+49 170 1234567");

  await fillBirthAndSex(page);
  await wizard.getByRole("button", { name: "Далее", exact: true }).click();

  await expect.poll(() => calls.filter((call) => call.method === "POST" && call.path === "/leads").length).toBe(1);
  const create = calls.find((call) => call.method === "POST" && call.path === "/leads")!;
  expect(create.body).toMatchObject({
    first_name: "Anna",
    last_name: "Muster",
    email: "anna.muster@example.com",
    source_person: { patient_id: PATIENT_ID, relation_id: RELATION_ID },
  });

  // The notice names the child and the copied fields; the ID columns read as one.
  const notice = "Данные заполнены из записи Mia Muster: дата рождения, гражданство, место рождения, данные документа";
  await expect(page.getByText(notice).first()).toBeVisible();
  // «Далее» moved on; the notice stays with step 1 while the wizard is open.
  await wizard.getByRole("tab", { name: /Данные клиента/ }).click();
  await expect(wizard.getByTestId("lead-prefilled-from-source")).toContainText(notice);
  await expect(wizard.getByTestId("lead-source-pep-hint")).toContainText("В анкете ребёнка указан статус PEP — спросить снова");

  // The first update after creation keeps what the server filled (the draft had no citizenship).
  await expect.poll(() => calls.filter((call) => call.path === `/leads/${NEW_LEAD_ID}/update`).length).toBeGreaterThan(0);
  const update = calls.find((call) => call.path === `/leads/${NEW_LEAD_ID}/update`)!;
  expect(update.body).toMatchObject({ citizenships: ["UA"], email: "anna.muster@example.com" });
  await expect(wizard.locator("#lead-wizard-citizenships")).toHaveAttribute("title", "Украина");
});

test("a person who already is a patient: the 409 offers the patient record instead of a lead", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const calls = await mount(page, {
    createStatus: 409,
    createBody: {
      code: "existing_parent_patient_use_repeat_intake",
      message: "This person already has a patient record; use the repeat intake",
      existing_patient_id: LINKED_PATIENT_ID,
    },
  });
  await page.goto(`/patients/${PATIENT_ID}?tab=relations`);
  await page.getByRole("button", { name: "Новая заявка для этого человека: Anna Muster" }).click();
  const wizard = wizardOf(page);
  await expect(wizard.locator("#lead-wizard-first-name")).toHaveValue("Anna", { timeout: 45_000 });

  await fillBirthAndSex(page);
  await wizard.getByRole("button", { name: "Далее", exact: true }).click();

  await expect.poll(() => calls.filter((call) => call.method === "POST" && call.path === "/leads").length).toBe(1);
  const open = wizard.getByRole("link", { name: "Открыть пациента" });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", `/patients/${LINKED_PATIENT_ID}`);
  expect(calls.filter((call) => call.path.endsWith("/update"))).toHaveLength(0);
  await expect(wizard.getByTestId("lead-prefilled-from-source")).toHaveCount(0);
});

test("a representative of an open lead gets the same request from the staff wizard", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const calls = await mount(page);
  await page.goto(`/leads?lead=${OPEN_LEAD_ID}&view=wizard`);
  const wizard = wizardOf(page);
  await expect(wizard.getByRole("tab", { name: /Данные клиента/ })).toBeVisible({ timeout: 45_000 });
  await wizard.getByRole("tab", { name: /Документы/ }).click();
  await wizard.getByRole("button", { name: "Новая заявка для этого человека: Ben Muster" }).click();

  // A fresh create-mode wizard for the father, seeded from the contact row.
  await expect(wizard.locator("#lead-wizard-first-name")).toHaveValue("Ben", { timeout: 45_000 });
  await expect(wizard.locator("#lead-wizard-last-name")).toHaveValue("Muster");
  await expect(wizard.locator("#lead-wizard-phone")).toHaveValue("+49 30 100002");
  await expect(page).not.toHaveURL(/source_lead/);

  await chooseComboboxOption(page, page.locator("#lead-wizard-legal-sex"), "Мужской");
  // The contact row had no e-mail; the portal login needs one.
  await wizard.locator("#lead-wizard-email").fill("ben.muster@example.com");
  await wizard.getByRole("button", { name: "Далее", exact: true }).click();
  await expect.poll(() => calls.filter((call) => call.method === "POST" && call.path === "/leads").length).toBe(1);
  expect(calls.find((call) => call.method === "POST" && call.path === "/leads")!.body).toMatchObject({
    first_name: "Ben",
    date_of_birth: "1983-07-08",
    source_person: { lead_id: OPEN_LEAD_ID, contact_id: BEN_ID },
  });
});
