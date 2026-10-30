import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { STATE_FILE, type ProcessState } from "./support/process-state";

// Staff fill in the client's own form (owner 2026-10-29): every request reaches
// a disposable API and PostgreSQL — the managed live stack, or the one named by
// FORM_LIVE_API_URL. The bootstrap endpoint is disabled in deployed systems.
let api = "";
let secret = "";
test.beforeAll(() => {
  const managed = process.env.FORM_LIVE_API_URL ? null
    : JSON.parse(readFileSync(STATE_FILE, "utf8")) as ProcessState;
  api = process.env.FORM_LIVE_API_URL ?? managed!.backendUrl;
  secret = managed?.secret ?? process.env.FORM_LIVE_E2E_SECRET ?? "gmed-form-recheck-test-only";
});

type Session = { access_token: string; refresh_token: string };

async function login(request: APIRequestContext, email: string, password: string): Promise<Session> {
  const response = await request.post(`${api}/api/v1/auth/login`, { data: { email, password } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function getJson(request: APIRequestContext, url: string, headers: Record<string, string>) {
  const response = await request.get(url, { headers });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function signIn(page: Page, session: Session) {
  await page.addInitScript(({ access, refresh }) => {
    localStorage.setItem("gmed_access_token", access);
    localStorage.setItem("gmed_refresh_token", refresh);
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_last_activity", String(Date.now()));
  }, { access: session.access_token, refresh: session.refresh_token });
}

/** A lead whose request staff complete over the phone; the client once ticked Threema. */
async function leadFilledInByStaff(request: APIRequestContext) {
  const bootstrap = await request.post(`${api}/api/v1/e2e/bootstrap/full-smoke`, { headers: { "x-e2e-secret": secret } });
  expect(bootstrap.ok(), await bootstrap.text()).toBe(true);
  const scenario = await bootstrap.json();
  const staff = await login(request, scenario.credentials.pm.email, scenario.credentials.password);
  const staffHeaders = { Authorization: `Bearer ${staff.access_token}` };
  const created = await request.post(`${api}/api/v1/leads`, {
    headers: staffHeaders,
    data: { first_name: "Greta", last_name: "Telefonfall", email: `staff-form-${randomUUID()}@gmx.de` },
  });
  expect(created.status(), await created.text()).toBe(201);
  const lead = await created.json();
  const base = `${api}/api/v1/me/lead-requests/${lead.id}`;
  const asStaff = async (part: string, data: unknown, status?: number) => {
    const response = await request.post(`${base}/${part}`, { headers: staffHeaders, data });
    if (status) expect(response.status(), `${part}: ${await response.text()}`).toBe(status);
    else expect(response.ok(), `${part}: ${await response.text()}`).toBe(true);
    return response.json();
  };
  const phone = { recorded_how: "phone", recorded_note: "Telefonat 30.10.2026" };
  // A consent staff record says how the client gave it.
  const refused = await asStaff("consent", { purpose: "lead_inquiry_processing", version: "2026-10-03", language: "de" }, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  await asStaff("consent", { purpose: "lead_inquiry_processing", version: "2026-10-03", language: "de", ...phone });
  await asStaff("consent", { purpose: "health_data_processing", version: "2026-10-13", language: "de", ...phone });
  await asStaff("personal-data", {
    date_of_birth: "1971-05-06", legal_sex: "female", citizenships: ["DE"],
    street_address: "Lindenstraße 4", zip_code: "10969", city: "Berlin", country: "DE",
    phone: "+49 30 7654321", has_insurance: "no",
  });
  await asStaff("payer", { payer_kind: "self", acts_on_own_account: true });
  await asStaff("billing", {
    invoice_recipient: "self", payment_method: "bank_transfer", account_country: "DE",
    account_holder: "Greta Telefonfall", bank_name: "Musterbank", via_third_party: false,
  });
  await asStaff("identification", {
    birth_place: "Hamburg", birth_country: "DE", pep_self: false, pep_related: false,
    sanctions_links: false, request_reason: "Synthetic request taken over the phone",
  });
  await asStaff("representation", { has_representative: false, under_guardianship: false });
  const upload = await request.post(`${base}/identity-document`, {
    headers: staffHeaders,
    multipart: { file: { name: "synthetic-id.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") } },
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  // Before the cabinet stopped offering Threema the client ticked it themselves.
  const patient = await login(request, lead.portal_account.email, lead.portal_account.one_time_password);
  const chosen = await request.post(`${base}/consent-choices`, {
    headers: { Authorization: `Bearer ${patient.access_token}` },
    data: {
      version: "2026-10-12", language: "de", recipients: [],
      choices: {
        agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false,
        channel_email: true, channel_threema: true, channel_whatsapp: false, channel_telegram: false,
      },
    },
  });
  expect(chosen.ok(), await chosen.text()).toBe(true);
  return { lead, base, staff, staffHeaders };
}

test("an old Threema tick is not shown; staff record the options and send the request for the client", async ({ page, request }) => {
  const { lead, base, staff, staffHeaders } = await leadFilledInByStaff(request);
  await signIn(page, staff);
  await page.goto(`/leads/${lead.id}/client-form`);
  await expect(page.getByTestId("lead-request-staff-mode")).toBeVisible();

  // Threema is gone from the form, even where the client once ticked it (owner 2026-10-30).
  await page.locator('[data-step="documents"]').click();
  const block = page.getByTestId("lead-request-consent-form");
  await expect(block.locator('[data-consent-option="channel_threema"]')).toHaveCount(0);
  await expect(block).not.toContainText("Threema");
  const email = block.locator('[data-consent-option="channel_email"]');
  await expect(email).toBeChecked();
  await email.uncheck();
  await page.getByTestId("lead-request-consent-form-record-how").selectOption("phone");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith(`/me/lead-requests/${lead.id}/consent-choices`) && response.request().method() === "POST");
  await page.getByTestId("lead-request-consent-form-record-save").click();
  expect((await saved).ok()).toBe(true);
  await expect(page.getByTestId("lead-request-consent-form-record")).toHaveCount(0);
  const afterChoice = await getJson(request, base, staffHeaders);
  expect(afterChoice.consent_form.choices).toMatchObject({ channel_email: false, data_system: true });

  // «Send for the client»: only with how the client confirmed; staff stay signed in.
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
  await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
  const send = page.getByTestId("lead-request-submit-record-save");
  await expect(send).toBeDisabled();
  await page.getByTestId("lead-request-submit-record-how").selectOption("in_person");
  await page.getByTestId("lead-request-submit-record-note").fill("Beratung vor Ort");
  await send.click();
  await expect(page.getByTestId("lead-request-sent")).toBeVisible();
  await expect(page.getByTestId("lead-request-finish")).toHaveCount(0);
  const sent = await getJson(request, base, staffHeaders);
  expect(sent.submitted_at).toBeTruthy();
  const intake = await getJson(request, `${api}/api/v1/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(intake.consent_form.choices.channel_email).toBe(false);
  // Staff see how the client gave each consent (owner 2026-10-29).
  expect(intake.consent_form).toMatchObject({ recorded_how: "phone" });
  expect(intake.consents.some((consent: { recorded_how?: string; recorded_note?: string }) =>
    consent.recorded_how === "phone" && consent.recorded_note === "Telefonat 30.10.2026")).toBe(true);
  // Still signed in as staff: the lead list opens.
  await page.goto("/leads");
  await expect(page).toHaveURL(/\/leads/);
  await expect(page.getByTestId("lead-wizard-client-form").or(page.getByRole("heading", { level: 1 })).first()).toBeVisible();
});

test("the wizard opens the client's form in a dialog and the entries reach the lead", async ({ page, request }) => {
  const { lead, staff, staffHeaders } = await leadFilledInByStaff(request);
  await signIn(page, staff);
  await page.goto(`/leads?lead=${lead.id}&view=wizard`);
  const open = page.getByTestId("lead-wizard-client-form");
  await expect(open).toBeVisible({ timeout: 30_000 });
  await open.click();
  const dialog = page.getByTestId("lead-client-form-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("lead-request-staff-mode")).toBeVisible();
  await dialog.locator("#lead-request-middle_name").fill("Maria");
  const intakeReloaded = page.waitForResponse((response) =>
    response.url().endsWith(`/leads/${lead.id}/portal-intake`) && response.request().method() === "GET");
  await page.getByTestId("lead-client-form-close").click();
  await expect(dialog).toHaveCount(0);
  expect((await intakeReloaded).ok()).toBe(true);
  const saved = await getJson(request, `${api}/api/v1/me/lead-requests/${lead.id}`, staffHeaders);
  expect(saved.personal_data.middle_name).toBe("Maria");
  // «Документы» shows how the client gave the consent staff recorded (owner 2026-10-29).
  await page.locator('.lead-wizard-step-tabs [data-step="documents"]').click();
  await expect(page.getByTestId("portal-inquiry-consent").getByTestId("portal-consent-recorded-by-staff"))
    .toHaveText("Записал сотрудник · по телефону · Telefonat 30.10.2026");
});
