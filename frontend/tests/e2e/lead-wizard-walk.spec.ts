import { expect, test, type Page, type Route } from "@playwright/test";

import { chooseComboboxOption } from "./helpers";

// The staff lead wizard walked step by step as staff would (QA 2026-10-23):
// what each tab and the release checklist say about a step, where a blocker
// leads, and what reaches the server. Mocked API, synthetic data.

const leadId = "00000000-0000-0000-0000-000000000222";

type Json = Record<string, unknown>;

const STEP_KEYS = ["master_data", "medical", "service", "documents", "commercial", "release"];

const adultLead = (overrides: Json = {}): Json => ({
  id: leadId,
  first_name: "Olga",
  last_name: "Beispiel",
  middle_name: null,
  email: "olga.beispiel@example.com",
  phone: "+49 30 123456",
  date_of_birth: "1980-02-03",
  legal_sex: "female",
  street_address: "Musterweg 1",
  city: "Berlin",
  zip_code: "10115",
  country: "DE",
  citizenships: ["DE"],
  primary_language: "ru",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  consent_privacy_practices: true,
  consent_healthcare: true,
  wizard_state: {},
  services: [],
  attachments: [],
  trusted_contacts: [],
  requested_specialties: [],
  created_at: "2026-10-20T08:00:00Z",
  updated_at: "2026-10-20T08:00:00Z",
  readiness: {
    conversion_ready: false,
    qualification_ready: true,
    qualification_reasons: [],
    blocking_reasons: ["Requested specialty is missing"],
    // The server's "service" step is the specialties.
    steps: STEP_KEYS.map((key) => ({ key, label: key, ready: !["service", "documents", "commercial", "release"].includes(key) })),
    checks: [],
  },
  ...overrides,
});

type Handler = (route: Route, body: Json | null, url: URL) => unknown;

async function mount(page: Page, lead: Json, handlers: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: Json | null }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-wizard-walk-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const body = method === "GET" ? null : (() => { try { return request.postDataJSON() as Json; } catch { return null; } })();
    calls.push({ method, path, body });
    const handler = handlers[`${method} ${path}`] ?? handlers[path];
    let response: unknown = [];
    if (handler) response = handler(route, body, url);
    else if (path === "/me") response = { id: "walk-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    else if (path === "/sanctions/check") response = { status: "clear", list_version_date: "2026-10-01" };
    else if (path === `/leads/${leadId}`) response = lead;
    else if (path === "/orders" && method === "POST") response = { id: "order-1" };
    else if (path === `/leads/${leadId}/update`) response = {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-wizard-walk-harness", (route) =>
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
  await page.goto("/lead-wizard-walk-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Оформление обращения", exact: true });
  await expect(wizard.getByRole("tab", { name: /Данные клиента/ })).toBeVisible({ timeout: 45_000 });
  return { wizard, calls };
}

test("each commercial blocker of the release list leads to its own field", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const reasons: [string, string, string][] = [
    ["Order needs at least one valid service", "Добавьте в заказ хотя бы одну услугу", "lead-wizard-order-service-select"],
    ["Customer order signature is missing", "Получите подпись клиента на заказе", "lead-wizard-order-signatures"],
    ["Agency order signature is missing", "Подтвердите заказ со стороны агентства", "lead-wizard-order-signatures"],
    ["Quote is not accepted", "Подтвердите смету", "lead-wizard-quote"],
  ];
  const lead = adultLead({ requested_specialties: ["cardiology"] });
  (lead.readiness as { blocking_reasons: string[] }).blocking_reasons = reasons.map(([reason]) => reason);
  const { wizard } = await mount(page, lead);
  for (const [, label, fieldId] of reasons) {
    await wizard.getByRole("tab", { name: /Создание пациента/ }).click();
    await wizard.getByTestId("completion-blockers").getByRole("button", { name: label, exact: true }).click();
    await expect(wizard.getByRole("tab", { name: /Договор и смета/ })).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe(fieldId);
  }
});

test("a minor's release list asks for the parents' or guardian's identity documents", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const lead = adultLead({
    first_name: "Mia",
    date_of_birth: "2015-06-01",
    email: null,
    phone: null,
    trusted_contacts: [{ id: "11111111-1111-4111-8111-111111111111", related_patient_id: null, name: "Anna Muster", phone: "+49 30 100001", email: "anna@example.com", relation: "parent", birth_date: null, address: null }],
  });
  (lead.readiness as { blocking_reasons: string[] }).blocking_reasons = ["Identity document is not verified"];
  const { wizard } = await mount(page, lead);
  await wizard.getByRole("tab", { name: /Создание пациента/ }).click();
  const blockers = wizard.getByTestId("completion-blockers");
  await expect(blockers.getByRole("button", { name: "Подтвердите документы, удостоверяющие личность родителей или опекуна", exact: true })).toBeVisible();
  await expect(blockers.getByText("Подтвердите документ, удостоверяющий личность", { exact: true })).toHaveCount(0);
  // At 390 px the label wraps: as a block the bullet stays at its first line.
  const firstLine = blockers.getByRole("button", { name: "Подтвердите документы, удостоверяющие личность родителей или опекуна", exact: true });
  expect(await firstLine.evaluate((element) => getComputedStyle(element).display)).toBe("block");
});

test("switching to self-pay clears the stored insurance coverage on the server", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const lead = adultLead({
    has_insurance: true,
    insurance_type: "private",
    insurance_provider: "Allianz",
    insurance_number: "A123",
    insurance_covers_germany: "yes",
  });
  const { wizard, calls } = await mount(page, lead);
  await chooseComboboxOption(page, wizard.locator("#lead-wizard-has-insurance"), "Нет, самооплата");
  await expect.poll(() => calls.filter((call) => call.path === `/leads/${leadId}/update`).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const update = calls.filter((call) => call.path === `/leads/${leadId}/update`).at(-1)!.body!;
  expect(update).toMatchObject({
    has_insurance: false,
    insurance_type: "self_pay",
    insurance_provider: "",
    insurance_number: "",
    // Sent empty, so the server clears the "yes" it holds; left out, it stayed.
    insurance_covers_germany: "",
  });
});

test("clearing the insurance answers persists them as cleared (owner decision 2026-10-23)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const lead = adultLead({
    has_insurance: true,
    insurance_type: "private",
    insurance_covers_germany: "yes",
  });
  const { wizard, calls } = await mount(page, lead);
  await chooseComboboxOption(page, wizard.locator("#lead-wizard-has-insurance"), "Не указано");
  await chooseComboboxOption(page, wizard.locator("#lead-wizard-insurance-type"), "Выберите");
  await chooseComboboxOption(page, wizard.locator("#lead-wizard-insurance-covers-germany"), "Не указано");
  await expect
    .poll(() => calls.filter((call) => call.path === `/leads/${leadId}/update`).at(-1)?.body, { timeout: 15_000 })
    .toMatchObject({
      // Sent as cleared, so the server drops what it holds; left out, it stayed.
      has_insurance: null,
      insurance_type: null,
      insurance_covers_germany: "",
    });
  // The required date of birth and sex keep being sent as they are.
  const update = calls.filter((call) => call.path === `/leads/${leadId}/update`).at(-1)!.body!;
  expect(update).toMatchObject({ date_of_birth: "1980-02-03", legal_sex: "female" });
});

test("an autosave sends back every stored field as it was loaded", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const stored = adultLead({
    middle_name: "Petrovna",
    suffix: "Jr.",
    whatsapp_number: "+49 170 1234567",
    state: "Berlin",
    country: "UA",
    citizenships: ["UA", "DE"],
    primary_language: "uk",
    has_insurance: true,
    insurance_type: "foreign",
    insurance_provider: "Allianz",
    insurance_number: "A-1",
    insurance_covers_germany: "not_sure",
    primary_concern_text: "Knie",
    additional_concerns: "",
    services: ["interpreter_support"],
    needs_interpreter: true,
    notes: "Ruft abends an",
    requested_specialties: ["cardiology"],
    trusted_contacts: [{ id: "11111111-1111-4111-8111-111111111111", related_patient_id: null, name: "Anna Muster", phone: "+49 30 100001", email: "anna@example.com", relation: "sister", birth_date: "1985-03-02", address: "Musterweg 2" }],
    wizard_state: { program_date_from: "2026-11-02", program_date_to: "2026-11-06", passport_expiry: "2030-01-01", discovery_source: "online", cost_threshold: "700" },
  });
  const { wizard, calls } = await mount(page, stored);
  await wizard.locator("#lead-wizard-city").fill("Potsdam");
  await expect.poll(() => calls.filter((call) => call.path === `/leads/${leadId}/update`).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const update = calls.filter((call) => call.path === `/leads/${leadId}/update`).at(-1)!.body!;
  expect(update).toMatchObject({
    city: "Potsdam",
    first_name: "Olga",
    last_name: "Beispiel",
    middle_name: "Petrovna",
    suffix: "Jr.",
    email: "olga.beispiel@example.com",
    phone: "+49 30 123456",
    whatsapp_number: "+49 170 1234567",
    date_of_birth: "1980-02-03",
    legal_sex: "female",
    street_address: "Musterweg 1",
    zip_code: "10115",
    state: "Berlin",
    country: "UA",
    citizenships: ["UA", "DE"],
    primary_language: "uk",
    has_insurance: true,
    insurance_type: "foreign",
    insurance_provider: "Allianz",
    insurance_number: "A-1",
    insurance_covers_germany: "not_sure",
    primary_concern_text: "Knie",
    services: ["interpreter_support"],
    needs_interpreter: true,
    notes: "Ruft abends an",
    requested_specialties: ["cardiology"],
    consent_privacy_practices: true,
    consent_healthcare: true,
    wizard_state: expect.objectContaining({ program_date_from: "2026-11-02", program_date_to: "2026-11-06", discovery_source: "online", cost_threshold: "700" }),
  });
  // The wizard's old "valid until" key is only a fallback for the ID form and is
  // not written back: the document data from the scan are its one place (2026-10-24).
  expect(update.wizard_state).not.toHaveProperty("passport_expiry");
  // The contacts go out only when staff changed them (the cabinet may add one meanwhile).
  expect(update).not.toHaveProperty("trusted_contacts");
});

test("the service and order tabs and the release checklist follow what each step shows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard } = await mount(page, adultLead());

  // No specialty yet: that is the order step's gap, not the service step's
  // (which holds only the optional program period and wishes); without data the
  // service step is "optional, not filled", never "done" (QA 2026-10-25).
  await expect(wizard.getByRole("tab", { name: /Сервисная история — необязательно, не заполнено/ })).toBeVisible();
  await expect(wizard.getByRole("tab", { name: /Оформление заказа — не завершено/ })).toBeVisible();

  await wizard.getByRole("tab", { name: /Создание пациента/ }).click();
  const checklist = wizard.locator("section").filter({ has: page.getByText("Проверьте все этапы.", { exact: false }) }).first();
  await expect(checklist.getByRole("button", { name: /Сервисная история\s*Необязательно, не заполнено/ })).toBeVisible();
  // The empty optional medical step reads as the tab bar says it, not as done.
  await expect(wizard.getByRole("tab", { name: /Медицинская характеристика — необязательно, не заполнено/ })).toBeVisible();
  await expect(checklist.getByRole("button", { name: /Медицинская характеристика\s*Необязательно, не заполнено/ })).toBeVisible();
  // Every wizard step has its row, the order step included.
  await expect(checklist.getByRole("button", { name: /Оформление заказа\s*Не завершено/ })).toBeVisible();
  await checklist.getByRole("button", { name: /Оформление заказа\s*Не завершено/ }).click();
  await expect(wizard.getByRole("tab", { name: /Оформление заказа/ })).toHaveAttribute("aria-selected", "true");
});

// Staff fill in the client's form inside the wizard, without another browser
// tab (owner decision 2026-10-29); closing the dialog is the way back and the
// wizard reads the client's answers again.
test("the client's form opens in a dialog of the wizard and the wizard reloads the answers on closing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const request = {
    lead_id: leadId,
    access_kind: "self",
    created_at: "2026-10-20T08:00:00Z",
    personal_data: {
      first_name: "Olga", middle_name: null, last_name: "Beispiel", date_of_birth: "1980-02-03", legal_sex: "female",
      citizenships: ["DE"], street_address: "Musterweg 1", zip_code: "10115", city: "Berlin", country: "DE",
      phone: "+49 30 123456", primary_language: "ru",
    },
    progress: { filled: 10, total: 12, missing_for_submit: [] },
    identification: { salutation: null, contact_channels: [], declared_correct_at: null },
    identity_documents: [],
    follow_up: { required: false, blocks: [], missing: {}, answered_at: null },
    review_notice: false,
    minor: false,
    documents: [],
    max_documents: 30,
    consents: Object.fromEntries(["health_data_processing", "lead_inquiry_processing"].map((type) => [type, {
      type,
      version: "2026-10-03",
      texts: { de: "Ich willige ein.", ru: "Я согласен(на)." },
      given_at: null,
    }])),
    submitted_at: null,
    changed_since_submit: false,
    retention_deadline_at: null,
  };
  const { wizard, calls } = await mount(page, adultLead(), { [`/me/lead-requests/${leadId}`]: () => request });

  await wizard.getByTestId("lead-wizard-client-form").click();
  const dialog = page.getByTestId("lead-client-form-dialog");
  await expect(dialog.getByTestId("lead-request-staff-mode")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('[data-step="person"]')).toHaveAttribute("aria-selected", "true");
  // No link that leaves the wizard: closing the dialog is the way back.
  await expect(dialog.getByRole("button", { name: "Вернуться к лиду" })).toHaveCount(0);

  const before = calls.length;
  await dialog.getByTestId("lead-client-form-close").click();
  await expect(dialog).toHaveCount(0);
  await expect(wizard.getByTestId("lead-wizard-client-form")).toBeVisible();
  const readAgain = (path: string) => calls.slice(before).some((call) => call.method === "GET" && call.path === path);
  await expect.poll(() => readAgain(`/leads/${leadId}/portal-intake`)).toBe(true);
  await expect.poll(() => readAgain(`/leads/${leadId}`)).toBe(true);
});
