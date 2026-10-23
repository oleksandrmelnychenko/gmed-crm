import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { STATE_FILE, type ProcessState } from "./support/process-state";

// Unlike the mocked cabinet suite, every request here reaches the disposable
// API and PostgreSQL. The bootstrap endpoint is disabled in deployed systems.
test("cabinet edits, upload, submission and staff data survive a real API round trip", async ({ page, request }) => {
  const managed = process.env.FORM_LIVE_API_URL ? null
    : JSON.parse(await readFile(STATE_FILE, "utf8")) as ProcessState;
  const api = process.env.FORM_LIVE_API_URL ?? managed!.backendUrl;
  const bootstrap = await request.post(`${api}/api/v1/e2e/bootstrap/full-smoke`, {
    headers: { "x-e2e-secret": managed?.secret ?? "gmed-form-recheck-test-only" },
  });
  expect(bootstrap.ok(), await bootstrap.text()).toBe(true);
  const scenario = await bootstrap.json();
  async function login(email: string, password: string) {
    const response = await request.post(`${api}/api/v1/auth/login`, { data: { email, password } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  const staff = await login(scenario.credentials.pm.email, scenario.credentials.password);
  const staffHeaders = { Authorization: `Bearer ${staff.access_token}` };
  const created = await request.post(`${api}/api/v1/leads`, {
    headers: staffHeaders,
    data: { first_name: "Anna", last_name: "Roundtrip", email: `form-${randomUUID()}@example.test` },
  });
  expect(created.status(), await created.text()).toBe(201);
  const lead = await created.json();
  const patient = await login(lead.portal_account.email, lead.portal_account.one_time_password);
  const patientHeaders = { Authorization: `Bearer ${patient.access_token}` };
  const base = `${api}/api/v1/me/lead-requests/${lead.id}`;
  async function post(part: string, data: unknown) {
    const response = await request.post(`${base}/${part}`, { headers: patientHeaders, data });
    expect(response.ok(), `${part}: ${await response.text()}`).toBe(true);
    return response.json();
  }
  // Seed prerequisites through public API; the browser changes these records,
  // uploads the document and submits the request below.
  await post("consent", { purpose: "lead_inquiry_processing", version: "2026-10-03", language: "de" });
  await post("consent", { purpose: "health_data_processing", version: "2026-10-13", language: "de" });
  await post("personal-data", {
    date_of_birth: "1979-02-03", legal_sex: "female", citizenships: ["DE"],
    street_address: "Musterstraße 1", zip_code: "10115", city: "Berlin", country: "DE",
    phone: "+49 30 1234567", has_insurance: "no",
  });
  await post("payer", { payer_kind: "self", acts_on_own_account: true });
  await post("billing", {
    invoice_recipient: "self", payment_method: "bank_transfer", account_country: "DE",
    account_holder: "Anna Roundtrip", bank_name: "Musterbank", via_third_party: false,
  });
  await post("identification", {
    birth_place: "Berlin", birth_country: "DE", pep_self: false, pep_related: false,
    sanctions_links: false, request_reason: "Synthetic consultation request",
  });
  await post("representation", { has_representative: false, under_guardianship: false });
  await page.addInitScript(({ access, refresh }) => {
    localStorage.setItem("gmed_access_token", access);
    localStorage.setItem("gmed_refresh_token", refresh);
    localStorage.setItem("gmed_lang", "de");
  }, { access: patient.access_token, refresh: patient.refresh_token });
  await page.goto("/");
  await expect(page.getByTestId("lead-cabinet")).toBeVisible();
  await page.locator('[data-step="person"]').click();
  await page.getByRole("textbox", { name: "Ort", exact: true }).fill("München");
  await page.getByRole("textbox", { name: "Telefon", exact: true }).fill("+49 89 1234567");
  // Leave before debounce: the old form must flush without overwriting the
  // next step or any values that a later response has already updated.
  await page.locator('[data-step="identity"]').click();
  const identity = page.getByTestId("lead-request-identity");
  await identity.locator('input[type="file"]').setInputFiles({
    name: "synthetic-identity.pdf", mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"),
  });
  await expect(identity).toContainText("synthetic-identity.pdf");
  await page.locator('[data-step="documents"]').click();
  await page.getByTestId("lead-request-reason").getByRole("textbox").fill("Synthetic consultation updated in browser");
  await page.locator('[data-step="send"]').click();
  await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
  await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
  await settleDisposableClock(lead.id);
  await page.getByRole("button", { name: "Anfrage senden", exact: true }).click();
  await expect(page.getByTestId("lead-request-sent")).toBeVisible();
  await page.reload();
  await page.locator('[data-step="person"]').click();
  await expect(page.getByRole("textbox", { name: "Ort", exact: true })).toHaveValue("München");
  await expect(page.getByRole("textbox", { name: "Telefon", exact: true })).toHaveValue("+49 89 1234567");
  const saved = await getJson(request, base, patientHeaders);
  expect(saved.personal_data.city).toBe("München");
  expect(saved.identification.request_reason).toBe("Synthetic consultation updated in browser");
  expect(saved.submitted_at).toBeTruthy();
  expect(saved.changed_since_submit).toBe(false);
  const staffData = await getJson(request, `${api}/api/v1/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(staffData.patient_request_reason.text).toBe(saved.identification.request_reason);
  expect(staffData.identity_documents.some((document: { file_name: string }) => document.file_name === "synthetic-identity.pdf")).toBe(true);
  // A choice saved after submission must offer resubmission immediately,
  // without a reload; the staff snapshot must include the new choice too.
  await page.locator('[data-step="documents"]').click();
  const consent = page.getByTestId("lead-request-consent-form");
  const core = consent.locator("label").filter({ has: page.locator("[data-consent-required]") });
  expect(await core.count()).toBe(3);
  await settleDisposableClock(lead.id);
  const consentSaved = page.waitForResponse((response) =>
    response.url().endsWith(`/me/lead-requests/${lead.id}/consent-choices`) &&
    response.request().method() === "POST",
  );
  for (const label of await core.all()) await label.getByRole("checkbox").check();
  await expect(page.getByTestId("lead-request-consent-form-save")).toHaveCount(0);
  // Next flushes the choices, including a click before the autosave debounce.
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  expect((await consentSaved).ok()).toBe(true);
  await expect(page.getByTestId("lead-request-changed")).toBeVisible();
  await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
  await settleDisposableClock(lead.id);
  await page.getByTestId("lead-request-submit").click();
  await expect(page.getByTestId("lead-request-changed")).toHaveCount(0);
  const final = await getJson(request, base, patientHeaders);
  expect(final.changed_since_submit).toBe(false);
  expect(final.consent_form.chosen_at).toBeTruthy();
  expect(final.consent_form.choices).toMatchObject({
    agency_processing: true, doctors_to_agency: true, data_system: true,
  });
  const reviewed = await getJson(request, `${api}/api/v1/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(reviewed.consent_form.choices).toEqual(final.consent_form.choices);
});

async function getJson(request: APIRequestContext, url: string, headers: Record<string, string>) {
  const response = await request.get(url, { headers });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

// Optional workaround for measured Docker Desktop VM clock backsteps. This
// reads the owned test DB only and leaves all timestamp assertions unchanged.
// Linux/CI uses no barrier. Never repair stored timestamps to make a test pass.
async function settleDisposableClock(leadId: string) {
  const container = process.env.FORM_LIVE_CLOCK_CONTAINER;
  if (!container) return;
  if (!container.startsWith("gmed-form-recheck-") || !/^[\da-f-]{36}$/.test(leadId)) {
    throw new Error("Clock barrier requires the owned form-recheck database");
  }
  const sql = `SELECT clock_timestamp() > GREATEST(
    l.portal_submitted_at,
    (SELECT max((f.value->>'at')::timestamptz) FROM jsonb_each(l.portal_field_updates) f),
    (SELECT max(GREATEST(created_at, withdrawn_at)) FROM lead_portal_uploads WHERE lead_id=l.id),
    (SELECT max(chosen_at) FROM consent_form_choices WHERE lead_id=l.id)
  ) + interval '3 seconds' FROM leads l WHERE l.id='${leadId}'`;
  await expect.poll(() => execFileSync(process.env.FORM_LIVE_DOCKER ?? "docker", [
    "exec", container, "psql", "-U", "gmed", "-d", "gmed_form_live", "-Atc", sql,
  ], { encoding: "utf8", windowsHide: true }).trim(), {
    timeout: 30_000, intervals: [250], message: "Disposable DB clock must pass its previous markers",
  }).toBe("t");
}
