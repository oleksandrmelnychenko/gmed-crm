import { expect, test, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";

const scenarios = [
  { name: "medical", step: "documents", input: "lead-request-files", endpoint: "/documents" },
  { name: "identity", step: "identity", input: "lead-request-identity-files", endpoint: "/identity-document" },
  { name: "representative identity", step: "person", input: "lead-request-agent-identity-files", endpoint: "/representatives/11111111-1111-4111-8111-111111111111/identity-document" },
  { name: "representative authority", step: "person", input: "lead-request-agent-authority-files", endpoint: "/representatives/11111111-1111-4111-8111-111111111111/authority-document" },
  { name: "funds proof", step: "follow_up", input: "lead-request-funds-proof-files", endpoint: "/funds-proof" },
  { name: "relationship proof", step: "follow_up", input: "lead-request-relationship-proof-files", endpoint: "/relationship-proof" },
] as const;
type Scenario = (typeof scenarios)[number];

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup(page: Page, scenario: Scenario, failMiddle = false) {
  await startClockAt(page);
  const first = deferred();
  const last = deferred();
  const followUp = scenario.step === "follow_up";
  const documents: Record<string, unknown>[] = [];
  const request = {
    lead_id: "upload-batch-recheck", access_kind: "self", created_at: "2026-10-12T08:00:00Z",
    personal_data: {
      first_name: "Anna", middle_name: null, last_name: "Muster", date_of_birth: "1980-02-03",
      legal_sex: "female", citizenships: ["DE"], street_address: "Teststrasse 1", zip_code: "10115",
      city: "Berlin", country: "DE", phone: "+4915112345678", primary_language: "de",
      has_insurance: false, insurance_type: "self_pay", insurance_provider: null,
      insurance_number: null, insurance_covers_germany: null,
    },
    identification: { salutation: null, contact_channels: [], request_reason: "Synthetic concern" },
    progress: { filled: 12, total: 12, missing_for_submit: [] }, minor: false,
    documents: scenario.name === "medical" ? documents : [],
    identity_documents: scenario.name === "identity" ? documents : [],
    max_documents: 30,
    consents: Object.fromEntries(["lead_inquiry_processing", "health_data_processing"].map((type) => [type, {
      type, version: "2026-10-03", texts: { de: "Synthetic consent" }, given_at: "2026-10-12T08:00:00Z",
    }])),
    representation: {
      has_representative: scenario.name.startsWith("representative"), under_guardianship: false,
      custody: null, custody_stated: false,
      representatives: scenario.name.startsWith("representative") ? [{
        id: "11111111-1111-4111-8111-111111111111", slot: "agent", role: "authorised_representative",
        first_name: "Ben", last_name: "Muster", date_of_birth: "1980-01-02", city: "Berlin",
        street: "Teststrasse 2", zip: "10115", country: "DE", citizenships: ["DE"],
        phone: "+4915112345670", email: "agent@example.invalid", mine: false, email_locked: false,
        can_remove: true,
        identity_documents: scenario.name === "representative identity" ? documents : [],
        authority_documents: scenario.name === "representative authority" ? documents : [],
      }] : [],
    },
    payer: {
      payer_kind: scenario.name === "relationship proof" ? "third_party" : "self",
      relationship_kind: "spouse", payer_type: "person", citizenships: [],
    },
    follow_up: {
      required: followUp, blocks: followUp ? [scenario.name === "funds proof" ? "A" : "B"] : [],
      missing: scenario.name === "relationship proof" ? { B: ["relationship_proof_upload"] } : {},
      answered_at: null as string | null,
      answers: { occupation: "Engineer", sector: "Engineering", funds_source: "income", funds_description: "Salary" },
      funds_source_options: ["income", "savings"],
      funds_proof_documents: scenario.name === "funds proof" ? documents : [],
      relationship_proof_documents: scenario.name === "relationship proof" ? documents : [],
      identity_documents: [],
    },
    submitted_at: followUp ? "2026-10-12T08:00:00Z" : null,
    changed_since_submit: false, retention_deadline_at: null,
  };
  const calls = { uploads: 0, submits: 0, events: [] as string[], submittedCount: 0 };
  const base = "/me/lead-requests/upload-batch-recheck";
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "synthetic-upload-batch-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: {
      id: "synthetic-upload-user", email: "upload-batch@example.invalid", name: "Anna Muster",
      role: "patient", capabilities: [], created_at: "2026-10-12T08:00:00Z", preferred_language: "de",
      password_change_required: false, portal_mode: "lead", lead_portal: { requests: 1 },
    } });
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [request] } });
    if (path === `${base}${scenario.endpoint}` && route.request().method() === "POST") {
      const index = ++calls.uploads;
      if (index === 1) await first.promise;
      if (index === 3) await last.promise;
      calls.events.push(`upload-${index}`);
      if (index === 2 && failMiddle) return route.fulfill({ status: 503, json: { message: "Synthetic unavailable upload" } });
      documents.push({
        id: `synthetic-file-${index}`, file_name: `proof-${index}.pdf`, size_bytes: 18, mime_type: "application/pdf",
        uploaded_at: "2026-10-12T09:00:00Z", uploaded_by_me: true, reviewed: false, can_delete: true,
      });
      if (request.submitted_at) request.changed_since_submit = true;
      return route.fulfill({ json: request });
    }
    if (path === `${base}${followUp ? "/follow-up" : ""}/submit`) {
      calls.submits++;
      calls.events.push("submit");
      calls.submittedCount = documents.length;
      if (followUp) request.follow_up.answered_at = "2026-10-12T09:01:00Z";
      else request.submitted_at = "2026-10-12T09:01:00Z";
      request.changed_since_submit = false;
      return route.fulfill({ json: request });
    }
    if (path.startsWith(`${base}/`)) return route.fulfill({ json: request });
    return route.fulfill({ json: [] });
  });
  await page.goto("/my/request");
  await page.locator(`[data-step="${scenario.step}"]`).click();
  return { first, last, calls, request };
}

for (const scenario of scenarios) {
  test(`upload batch: ${scenario.name} completes before submit after navigation`, async ({ page }) => {
    const { first, last, calls } = await setup(page, scenario);
    await page.locator(`#${scenario.input}`).setInputFiles([1, 2, 3].map((index) => ({
      name: `proof-${index}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    })));
    await expect.poll(() => calls.uploads).toBe(1);
    if (scenario.step === "follow_up") {
      // The same submit remains reachable after leaving and remounting the upload field.
      await page.locator('[data-step="person"]').click();
      await page.locator('[data-step="follow_up"]').click();
      await page.getByTestId("lead-request-follow-up-submit").click();
    } else {
      await page.locator('[data-step="send"]').click();
      await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
      await page.getByTestId("lead-request-submit").click();
    }
    first.resolve();
    await expect.poll(() => calls.uploads).toBe(3);
    expect(calls.submits).toBe(0);
    last.resolve();
    await expect.poll(() => calls.submits).toBe(1);
    expect(calls.events).toEqual(["upload-1", "upload-2", "upload-3", "submit"]);
    expect(calls.submittedCount).toBe(3);
  });
}

test("upload batch: a failed medical file does not abandon later files or block submission", async ({ page }) => {
  const scenario = scenarios[0];
  const { first, last, calls } = await setup(page, scenario, true);
  await page.locator(`#${scenario.input}`).setInputFiles([1, 2, 3].map((index) => ({
    name: `proof-${index}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
  })));
  await expect.poll(() => calls.uploads).toBe(1);
  await page.locator('[data-step="send"]').click();
  await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
  await page.getByTestId("lead-request-submit").click();
  first.resolve();
  await expect.poll(() => calls.uploads).toBe(3);
  expect(calls.submits).toBe(0);
  last.resolve();
  await expect.poll(() => calls.submits).toBe(1);
  expect(calls.events).toEqual(["upload-1", "upload-2", "upload-3", "submit"]);
  expect(calls.submittedCount).toBe(2);
});
