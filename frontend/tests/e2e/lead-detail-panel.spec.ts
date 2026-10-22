import { expect, test, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";

// The side panel of the leads list (quick view of one lead): the tabs, the
// form «Данные для квалификации» and the closing of a lead. Mocked API,
// synthetic data. LEAD_QA_SHOTS=dir writes a screenshot per state.

const shots = process.env.LEAD_QA_SHOTS;
type Json = Record<string, unknown>;

const LEAD_ID = "00000000-0000-0000-0000-000000000d01";

function detail(overrides: Json = {}): Json {
  return {
    id: LEAD_ID,
    first_name: "Olga",
    last_name: "Beispiel",
    middle_name: null,
    suffix: null,
    email: "olga.beispiel@example.com",
    phone: "+49 30 123456",
    source: "manual",
    country: "DE",
    citizenships: ["DE"],
    intake_source: "manual",
    flow: null,
    lead_type: "console",
    console_promoted_at: "2026-10-05T12:00:00Z",
    qualification_status: "in_progress",
    compliance_status: "pending",
    status_changed_at: "2026-10-08T12:00:00Z",
    retention_deadline_at: "2026-10-19T12:00:00Z",
    created_at: "2026-10-05T12:00:00Z",
    updated_at: "2026-10-08T12:00:00Z",
    submitted_at: null,
    date_of_birth: "1980-02-03",
    legal_sex: "female",
    primary_language: "ru",
    needs_interpreter: false,
    street_address: "Musterweg 1",
    city: "Berlin",
    state: null,
    zip_code: "10115",
    services: [],
    attachments: [],
    trusted_contacts: [],
    requested_specialties: [],
    wizard_state: {},
    notes: null,
    consent_healthcare: false,
    consent_privacy_practices: false,
    consent_automated_contact: false,
    consent_opt_out: false,
    converted_patient_id: null,
    intake_model: "patient_first",
    prospect_patient_id: null,
    referrer_patient_id: null,
    referrer_patient_pid: null,
    referrer_patient_name: null,
    prospect_patient_lifecycle: null,
    prospect_case_id: null,
    failed_outcome: { status: "none", reason: null, note: null, processed_at: null },
    readiness: {
      qualification_ready: false,
      conversion_ready: false,
      qualification_reasons: [],
      blocking_reasons: ["Privacy practices consent is missing", "Healthcare consent is missing"],
      checks: [
        { key: "primary_contact_present", label: "Contact", passed: true, blocking_for: "qualification" },
        { key: "privacy_consent", label: "Privacy consent", passed: false, blocking_for: "qualification" },
      ],
      steps: [],
    },
    lifecycle: {
      current_stage: "in_progress",
      stage_entered_at: "2026-10-08T12:00:00Z",
      can_convert: false,
      can_resolve_failed: true,
      history: [
        { from_stage: null, to_stage: "new", transition_kind: "created", note: null, metadata: {}, changed_by: null, created_at: "2026-10-05T12:00:00Z" },
        { from_stage: "new", to_stage: "in_progress", transition_kind: "status_change", note: null, metadata: {}, changed_by: null, created_at: "2026-10-08T12:00:00Z" },
      ],
    },
    portal_account: null,
    // What only the website questionnaire fills: null for a manual lead.
    location: null,
    location_detailed: null,
    wants_membership: null,
    can_travel: null,
    has_medical_records: null,
    records_in_accepted_language: null,
    has_travel_documents: null,
    currently_in_treatment: null,
    has_health_risk_for_travel: null,
    primary_concern_text: null,
    additional_concerns: null,
    has_insurance: null,
    insurance_covers_germany: null,
    preferred_location: null,
    visit_timing: null,
    message: null,
    ...overrides,
  };
}

const STATES: Record<string, Json> = {
  new: { qualification_status: "new", lifecycle: { ...(detail().lifecycle as Json), current_stage: "new" } },
  in_progress: {},
  qualified: {
    qualification_status: "qualified",
    consent_privacy_practices: true,
    consent_healthcare: true,
    readiness: { ...(detail().readiness as Json), qualification_ready: true, blocking_reasons: [] },
  },
  converted: {
    qualification_status: "converted",
    converted_patient_id: "patient-1",
    wizard_state: { phase: "completed" },
    retention_deadline_at: null,
    readiness: { ...(detail().readiness as Json), qualification_ready: true, conversion_ready: true, blocking_reasons: [] },
  },
  archived: {
    qualification_status: "archived",
    retention_deadline_at: null,
    failed_outcome: { status: "archived", from_status: "in_progress", reason: "no_response", note: null, processed_at: "2026-10-09T12:00:00Z" },
  },
  minor: {
    first_name: "Mia",
    last_name: "Muster",
    email: null,
    phone: null,
    date_of_birth: "2015-06-01",
    trusted_contacts: [{ id: "11111111-1111-4111-8111-111111111111", related_patient_id: null, name: "Anna Muster", phone: "+49 170 1234567", email: "anna.muster@example.com", relation: "mother", birth_date: null, address: null }],
  },
  login: {
    portal_account: { user_id: "u-olga", is_active: true, password_change_pending: false, last_login_at: "2026-10-06T09:00:00Z" },
  },
};

type Mount = { lang: "ru" | "de"; lead: Json; role?: string; failUpdate?: Json };

async function mount(page: Page, mock: Mount) {
  await startClockAt(page);
  const updates: Json[] = [];
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-detail-panel-token");
  }, mock.lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const path = decodeURIComponent(new URL(request.url()).pathname.replace("/api/v1", ""));
    if (path === "/me") {
      return route.fulfill({ json: { id: "panel-user", email: "pm@example.com", name: "PM QA", role: mock.role ?? "ceo", created_at: "2026-01-01T00:00:00Z" } });
    }
    if (path === "/leads") {
      return route.fulfill({ json: [{ ...mock.lead, portal_intake: { filled: 3, total: 12, documents: 0, guardians: 0, submitted_at: null } }] });
    }
    if (path === `/leads/${LEAD_ID}`) return route.fulfill({ json: mock.lead });
    if (path === `/leads/${LEAD_ID}/update` && method === "POST") {
      updates.push(request.postDataJSON() as Json);
      if (mock.failUpdate) return route.fulfill({ status: 422, json: mock.failUpdate });
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: [] });
  });
  return updates;
}

async function openPanel(page: Page) {
  await page.goto(`/leads?lead=${LEAD_ID}`);
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function tab(page: Page, name: RegExp) {
  await page.getByRole("dialog").getByRole("button", { name }).first().click();
}

const TABS = [
  { key: "overview", name: /^(Обзор|Überblick)$/ },
  { key: "process", name: /^(Процесс|Prozess)$/ },
  { key: "qualification", name: /^(Квалификация|Qualifikation)$/ },
  { key: "details", name: /^(Детали|Details)$/ },
];

test.describe("lead side panel screenshots", () => {
  test.skip(!shots, "QA screenshots only on request (LEAD_QA_SHOTS)");
  for (const [state, overrides] of Object.entries(STATES)) {
    for (const lang of ["ru", "de"] as const) {
      for (const width of [1440, 390]) {
        test(`${state} ${lang} ${width}`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await mount(page, { lang, lead: detail(overrides) });
          await openPanel(page);
          for (const item of TABS) {
            const button = page.getByRole("dialog").getByRole("button", { name: item.name }).first();
            if (!(await button.isVisible().catch(() => false))) continue;
            await button.click();
            await page.screenshot({ path: `${shots}/${state}-${lang}-${width}-${item.key}.png`, fullPage: false });
            const scroller = page.getByRole("dialog").locator(".overflow-y-auto").first();
            await scroller.evaluate((node) => { node.scrollTop = node.scrollHeight; });
            await page.screenshot({ path: `${shots}/${state}-${lang}-${width}-${item.key}-end.png`, fullPage: false });
            await scroller.evaluate((node) => { node.scrollTop = 0; });
          }
        });
        test(`${state} ${lang} ${width} row`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await mount(page, { lang, lead: detail(overrides) });
          await page.goto("/leads");
          await page.getByTestId(`lead-expand-${LEAD_ID}`).first().click();
          await expect(page.getByTestId("lead-portal-access").first()).toBeVisible();
          await page.screenshot({ path: `${shots}/${state}-${lang}-${width}-row.png`, fullPage: true });
        });
      }
    }
  }
});

test("the qualification form refuses an unusable e-mail, phone and date at the field and keeps the lead in view", async ({ page }) => {
  const updates = await mount(page, { lang: "ru", lead: detail() });
  await openPanel(page);
  await tab(page, /^Квалификация$/);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Электронная почта").fill("olga@");
  await dialog.getByLabel("Телефон").fill("abc");
  await dialog.getByTestId("lead-gate-save").click();
  await expect(dialog.locator("#lead-gate-email-error")).toContainText("корректный адрес");
  await expect(dialog.locator("#lead-gate-phone-error")).toContainText("не менее 6 цифр");
  await expect(dialog.getByLabel("Электронная почта")).toBeFocused();
  // The lead stays in view: the error is at the field, not instead of the panel.
  await expect(dialog.getByText("Данные для квалификации").first()).toBeVisible();
  expect(updates).toHaveLength(0);
  // Typing clears the error of that field.
  await dialog.getByLabel("Электронная почта").fill("olga.neu@example.com");
  await expect(dialog.locator("#lead-gate-email-error")).toHaveCount(0);
});

test("a field the server refuses is shown at the field", async ({ page }) => {
  const updates = await mount(page, {
    lang: "de",
    lead: detail(),
    failUpdate: { error: "Unprocessable Entity", message: "date_of_birth cannot be in the future", field: "date_of_birth" },
  });
  await openPanel(page);
  await tab(page, /^Qualifikation$/);
  const dialog = page.getByRole("dialog");
  await dialog.getByTestId("lead-gate-save").click();
  await expect(dialog.locator("#lead-gate-date-of-birth-error")).toBeVisible();
  expect(updates).toHaveLength(1);
  // Country and language are pickers with names, as in the wizard.
  await expect(dialog.getByRole("combobox", { name: "Wohnsitzland" })).toContainText("Deutschland");
});

test("a converted lead offers its patient card as the one action and reads its data", async ({ page }) => {
  await mount(page, { lang: "ru", lead: detail(STATES.converted) });
  await openPanel(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("lead-open-patient")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Конвертировать/ })).toHaveCount(0);
  await tab(page, /^Квалификация$/);
  await expect(dialog.getByTestId("lead-gate-save")).toHaveCount(0);
  await expect(dialog.getByLabel("Электронная почта")).toHaveCount(0);
});

test("an open lead leads to the wizard; the conversion shows only once it is possible", async ({ page }) => {
  await mount(page, { lang: "ru", lead: detail() });
  await openPanel(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("lead-open-wizard")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Конвертировать/ })).toHaveCount(0);
});

test("an archived lead shows what was decided and offers no work on it", async ({ page }) => {
  await mount(page, { lang: "ru", lead: detail(STATES.archived) });
  await openPanel(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId("lead-open-wizard")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Конвертировать/ })).toHaveCount(0);
  await expect(dialog.getByText("В архиве").first()).toBeVisible();
  await tab(page, /^Квалификация$/);
  await expect(dialog.getByText("Лид закрыт")).toBeVisible();
  await expect(dialog.getByText("Закрыт на этапе")).toBeVisible();
});

test("a minor's panel names the parents with the roles of the wizard", async ({ page }) => {
  await mount(page, { lang: "ru", lead: detail(STATES.minor) });
  await openPanel(page);
  const contacts = page.getByTestId("lead-detail-contacts");
  await expect(contacts).toContainText("Родители и законные представители");
  await expect(contacts).toContainText("Anna Muster");
  await expect(contacts).toContainText("Мать");
  await expect(page.getByRole("dialog").getByText("Несовершеннолетний")).toBeVisible();
});
