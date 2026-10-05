import { expect, test, type Locator, type Page } from "@playwright/test";

// Lead cabinet (owner decision 2026-10-03): a patient login that reaches only
// requests sees the request page, the account and the legal notice. Mocked
// API, synthetic data.

type Mode = "lead" | "patient";

const CONSENT_VERSION = "2026-10-03";

function leadRequest() {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-03T08:00:00Z",
    personal_data: {
      first_name: "Anna",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: null,
      legal_sex: null,
      citizenships: [] as string[],
      street_address: null,
      zip_code: null,
      city: null,
      country: null,
      phone: null,
      primary_language: null,
      has_insurance: null,
      insurance_type: null,
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    } as Record<string, unknown>,
    // Recomputed by `recompute` before the first response.
    progress: { filled: 2, total: 12, missing_for_submit: [] as string[] },
    // Who pays; null until the question is answered.
    payer: null as Record<string, unknown> | null,
    // The lead's own statements for the GwG identification: always an object.
    identification: {
      salutation: null,
      former_names: null,
      birth_place: null,
      birth_country: null,
      habitual_residence_country: null,
      contact_channels: [] as string[],
      id_document_type: null,
      id_document_number: null,
      id_issuing_authority: null,
      id_issuing_country: null,
      id_issued_on: null,
      id_valid_until: null,
      pep_self: null,
      pep_self_details: null,
      pep_related: null,
      pep_related_details: null,
      high_risk_country: null,
      high_risk_country_code: null,
      sanctions_links: null,
      sanctions_links_details: null,
      payment_background: null,
      declared_correct_at: null,
    } as Record<string, unknown>,
    // Copies of the identity document; never among `documents` (medical).
    identity_documents: [] as Record<string, unknown>[],
    minor: false,
    documents: [] as Record<string, unknown>[],
    max_documents: 30,
    consents: {
      health_data_processing: {
        type: "health_data_processing",
        version: CONSENT_VERSION,
        texts: { de: "Ich willige ein … (Art. 9 Abs. 2 lit. a DSGVO) …", ru: "Я даю согласие … (ст. 9) …" },
        given_at: null as string | null,
      },
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: CONSENT_VERSION,
        texts: {
          de: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden.",
          ru: "Я согласен(на), что мои данные обрабатываются для рассмотрения моего обращения.",
        },
        given_at: null as string | null,
      },
    } as Record<string, { type: string; version: string; texts: Record<string, string>; given_at: string | null }>,
    submitted_at: null as string | null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-17T08:00:00Z",
  };
}

async function setDatePickerValue(input: Locator, value: string) {
  const displayValue = value.split("-").reverse().join(".");
  await input.evaluate((node, nextValue) => {
    const nativeInput = node as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    valueSetter?.call(nativeInput, nextValue);
    nativeInput.dispatchEvent(new Event("input", { bubbles: true }));
    nativeInput.dispatchEvent(new Event("change", { bubbles: true }));
  }, displayValue);
  await expect(input).toHaveValue(displayValue);
}

const SUBMIT_FIELDS = ["date_of_birth", "legal_sex", "citizenships", "street_address", "zip_code", "city", "country"];

// The statements of the identification the request cannot be sent without.
const IDENTITY_SUBMIT_FIELDS = [
  "birth_place",
  "birth_country",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_valid_until",
];

// The legal questions and what a "yes" asks for.
const LEGAL_DETAILS: Record<string, string> = {
  pep_self: "pep_self_details",
  pep_related: "pep_related_details",
  high_risk_country: "high_risk_country_code",
  sanctions_links: "sanctions_links_details",
};

function recompute(request: ReturnType<typeof leadRequest>) {
  const data = request.personal_data;
  const filled = (field: string) => {
    const value = data[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };
  // Like the server: the answer, and for another person the name and the citizenships.
  const payer = request.payer;
  const payerMissing = !payer
    ? ["payer_kind"]
    : payer.payer_kind === "third_party"
      ? [
          ...(payer.first_name ? [] : ["payer_first_name"]),
          ...(payer.last_name ? [] : ["payer_last_name"]),
          ...(Array.isArray(payer.citizenships) && payer.citizenships.length > 0 ? [] : ["payer_citizenships"]),
        ]
      : [];
  const missing = [...SUBMIT_FIELDS.filter((field) => !filled(field)), ...payerMissing];
  // A server that knows the GwG statements (contract phase 1a) also needs them.
  const identification = request.identification as Record<string, unknown> | undefined;
  if (identification) {
    missing.push(...IDENTITY_SUBMIT_FIELDS.filter((field) => !identification[field]));
    if (request.identity_documents.length === 0) missing.push("id_document_upload");
    // The own economic interest: the answer and, for a "no", the named person.
    if (payer?.acts_on_own_account == null) missing.push("payer_own_account");
    else if (payer?.acts_on_own_account === false && !payer.beneficial_owner) missing.push("payer_beneficial_owner");
    for (const [question, details] of Object.entries(LEGAL_DETAILS)) {
      if (identification[question] == null) missing.push(question);
      else if (identification[question] === true && !identification[details]) missing.push(details);
    }
    if (payer?.payer_kind === "third_party" && !identification.payment_background) missing.push("payment_background");
  }
  request.progress.missing_for_submit = missing;
  request.progress.filled = [
    "first_name", "last_name", ...SUBMIT_FIELDS, "phone", "primary_language",
  ].filter(filled).length + (data.has_insurance == null ? 0 : 1);
}

/** A request with everything entered: only the consent and the confirmation are left. */
function completeRequest(request: ReturnType<typeof leadRequest>) {
  Object.assign(request.personal_data, {
    date_of_birth: "1988-05-01",
    legal_sex: "female",
    citizenships: ["UA"],
    street_address: "Musterstraße 1",
    zip_code: "10115",
    city: "Berlin",
    country: "DE",
    phone: "+49 30 1234567",
  });
  Object.assign(request.identification, {
    salutation: "ms",
    birth_place: "Kyiv",
    birth_country: "UA",
    contact_channels: ["email", "messenger"],
    id_document_type: "passport",
    id_document_number: "FE123456",
    id_issuing_authority: "8001",
    id_issuing_country: "UA",
    id_issued_on: "2021-03-04",
    id_valid_until: "2031-03-04",
    pep_self: false,
    pep_related: true,
    pep_related_details: "Viktor Zahler, Vater, Minister, Ukraine",
    high_risk_country: false,
    sanctions_links: false,
  });
  request.identity_documents.push({
    id: "id-doc-0",
    file_name: "reisepass.jpg",
    size_bytes: 4096,
    mime_type: "image/jpeg",
    uploaded_at: "2026-10-03T09:10:00Z",
    uploaded_by_me: true,
    reviewed: false,
    can_delete: true,
  });
  request.payer = {
    payer_kind: "self",
    first_name: null,
    last_name: null,
    date_of_birth: null,
    street: null,
    zip: null,
    city: null,
    country: null,
    citizenships: [],
    relationship: null,
    email: null,
    phone: null,
    acts_on_own_account: true,
    beneficial_owner: null,
  };
  request.consents.lead_inquiry_processing.given_at = "2026-10-03T09:15:00Z";
}

/** Picks an option of one of the cabinet's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  // The list fades out: the next select must not find this one's options.
  await expect(page.getByRole("option")).toHaveCount(0);
}

/**
 * How far anything inside a step reaches beyond the right edge of the screen.
 * The page scrolls in a container of its own, so the document width alone
 * does not show a field or a label that is too wide.
 */
function widestOverhang(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((step) => {
    const width = document.documentElement.clientWidth;
    return Math.max(0, ...Array.from(step.querySelectorAll("*"), (node) => node.getBoundingClientRect().right - width));
  });
}

async function setup(
  page: Page,
  mode: Mode,
  options: {
    leadRequests?: number;
    primaryLanguage?: string;
    accountLanguage?: "de" | "ru" | null;
    /** Changes the request before the page loads it (a parent's access, an older server, entered data). */
    prepare?: (request: ReturnType<typeof leadRequest>) => void;
  } = {},
) {
  const request = leadRequest();
  request.personal_data.primary_language = options.primaryLanguage ?? null;
  options.prepare?.(request);
  recompute(request);
  // The language saved on the account; a new lead login has none.
  const accountLanguage = options.accountLanguage === undefined ? "de" : options.accountLanguage;
  const calls = {
    personalData: [] as Record<string, unknown>[],
    payer: [] as Record<string, unknown>[],
    identification: [] as Record<string, unknown>[],
    consents: [] as string[],
    uploads: 0,
    identityUploads: 0,
    submits: 0,
    submitBodies: [] as unknown[],
    blocked: [] as string[],
  };
  const today = new Date().toISOString().slice(0, 10);

  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "lead-cabinet-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    const method = req.method();

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "lead-user",
          email: "anna.muster@example.com",
          name: "Anna Muster",
          role: "patient",
          capabilities: [],
          created_at: "2026-10-03T08:00:00Z",
          preferred_language: accountLanguage,
          password_change_required: false,
          portal_mode: mode,
          lead_portal: options.leadRequests ? { requests: options.leadRequests } : mode === "lead" ? { requests: 1 } : null,
        },
      });
    }
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [request] } });
    if (path === "/me/lead-requests/lead-1/personal-data" && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.personalData.push(patch);
      Object.assign(request.personal_data, patch);
      // Like the server: the answer is stored as a boolean, "no" is the self-payer.
      if ("has_insurance" in patch) {
        request.personal_data.has_insurance = patch.has_insurance === "yes" ? true : patch.has_insurance === "no" ? false : null;
      }
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/payer" && method === "POST") {
      const input = req.postDataJSON() as Record<string, unknown>;
      calls.payer.push(input);
      // The own economic interest: left out, the stored answer stays; the
      // named person is kept for a "no" only.
      const ownAccount = "acts_on_own_account" in input ? input.acts_on_own_account : request.payer?.acts_on_own_account ?? null;
      // The answer replaces the block: what is not sent is empty.
      request.payer = {
        first_name: null,
        last_name: null,
        date_of_birth: null,
        street: null,
        zip: null,
        city: null,
        country: null,
        citizenships: [],
        relationship: null,
        email: null,
        phone: null,
        ...input,
        acts_on_own_account: ownAccount,
        beneficial_owner: ownAccount === false ? input.beneficial_owner || null : null,
      };
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/identification" && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.identification.push(patch);
      const unknown = Object.keys(patch).find((key) => key === "declared_correct_at" || !(key in request.identification));
      if (unknown) {
        return route.fulfill({ status: 422, json: { code: "invalid_field", field: unknown, message: "Unknown field" } });
      }
      // Like the server: an expired document is refused as a whole patch.
      if (typeof patch.id_valid_until === "string" && patch.id_valid_until && patch.id_valid_until < today) {
        return route.fulfill({ status: 422, json: { code: "id_document_expired", field: "id_valid_until" } });
      }
      for (const [key, value] of Object.entries(patch)) request.identification[key] = value === "" ? null : value;
      // The details belong to a "yes" only.
      for (const [question, details] of Object.entries(LEGAL_DETAILS)) {
        if (request.identification[question] !== true) request.identification[details] = null;
      }
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/identity-document" && method === "POST") {
      if (!request.consents.lead_inquiry_processing.given_at) {
        return route.fulfill({ status: 403, json: { code: "inquiry_consent_required", message: "Consent required" } });
      }
      calls.identityUploads += 1;
      request.identity_documents.push({
        id: `id-doc-${calls.identityUploads}`,
        file_name: "reisepass.jpg",
        size_bytes: 4096,
        mime_type: "image/jpeg",
        uploaded_at: "2026-10-03T09:18:00Z",
        uploaded_by_me: true,
        reviewed: false,
        can_delete: true,
      });
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ status: 201, json: request });
    }
    if (path.startsWith("/me/lead-requests/lead-1/documents/") && method === "DELETE") {
      // One route withdraws either kind of upload.
      const id = path.split("/").at(-1);
      request.documents = request.documents.filter((document) => document.id !== id);
      request.identity_documents = request.identity_documents.filter((document) => document.id !== id);
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/consent" && method === "POST") {
      const body = req.postDataJSON() as { purpose: string; version: string };
      calls.consents.push(body.purpose);
      request.consents[body.purpose].given_at = "2026-10-03T09:15:00Z";
      return route.fulfill({ status: 201, json: { purpose: body.purpose, given_at: "2026-10-03T09:15:00Z", version: body.version } });
    }
    if (path === "/me/lead-requests/lead-1/documents" && method === "POST") {
      calls.uploads += 1;
      request.documents.push({
        id: `doc-${calls.uploads}`,
        file_name: "befund.pdf",
        size_bytes: 2048,
        mime_type: "application/pdf",
        uploaded_at: "2026-10-03T09:20:00Z",
        uploaded_by_me: true,
        reviewed: false,
        can_delete: true,
      });
      return route.fulfill({ status: 201, json: request });
    }
    if (path === "/me/lead-requests/lead-1/submit" && method === "POST") {
      const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : null;
      calls.submitBodies.push(body);
      // With the GwG statements the server sends nothing without the confirmation.
      if (request.identification) {
        if (body?.declared_correct !== true) {
          return route.fulfill({ status: 422, json: { code: "declaration_required", message: "Declaration required" } });
        }
        request.identification.declared_correct_at = "2026-10-03T09:30:00Z";
      }
      calls.submits += 1;
      request.submitted_at = "2026-10-03T09:30:00Z";
      request.changed_since_submit = false;
      return route.fulfill({ json: request });
    }
    if (path === "/me/profile") {
      return route.fulfill({ json: { id: "lead-user", email: "anna.muster@example.com", name: "Anna Muster", role: "patient", phone: null, preferred_language: accountLanguage } });
    }
    if (mode === "lead" && (path.startsWith("/me/") || path.startsWith("/notifications"))) {
      // The server closes the rest of the portal to a lead login.
      calls.blocked.push(path);
      return route.fulfill({ status: 403, json: { error: "Forbidden", code: "lead_portal_only", message: "Lead portal only" } });
    }
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: [] });
  });
  return { request, calls };
}

test.describe("lead cabinet", () => {
  test("a lead login sees only its request, the account and the legal notice", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByTestId("lead-request-deadline")).toContainText("Bitte bis 17.10.2026 ausfüllen.");
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Konto" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Meine Dokumente" })).toHaveCount(0);
    await expect(page.getByTitle("Benachrichtigungen")).toHaveCount(0);

    // Other portal pages lead back to the request page.
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    expect(calls.blocked).toEqual([]);
  });

  test("the patient enters the data, agrees, uploads and sends", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");

    await page.locator("#lead-request-city").fill("Berlin");
    await page.locator("#lead-request-zip_code").fill("10115");
    await page.locator("#lead-request-street_address").fill("Musterstraße 1");
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
    expect(calls.personalData.at(-1)).toMatchObject({ city: "Berlin", zip_code: "10115", street_address: "Musterstraße 1" });
    expect(Object.keys(calls.personalData.at(-1) ?? {})).not.toContain("first_name");

    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("lead-request-inquiry-consent")).toContainText("Zugestimmt am 03.10.2026");
    expect(calls.consents).toEqual(["lead_inquiry_processing"]);

    await page.getByRole("button", { name: "Weiter" }).click();
    const upload = page.getByRole("button", { name: "Dateien auswählen" });
    await expect(upload).toBeDisabled();
    await page.getByTestId("lead-request-health-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-health-consent").getByRole("checkbox")).toBeChecked();
    await expect(upload).toBeEnabled();
    await page.locator("#lead-request-files").setInputFiles({
      name: "befund.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await expect(page.getByTestId("lead-request-document-list")).toContainText("befund.pdf");

    await page.getByRole("button", { name: "Weiter" }).click();
    const send = page.getByTestId("lead-request-submit");
    const missing = page.getByTestId("lead-request-missing");
    // Date of birth, sex, citizenship and country are still missing, and so are
    // the statements for the identification.
    await expect(send).toBeDisabled();
    await expect(missing).toContainText("Geburtsdatum");
    await expect(missing).toContainText("Wer übernimmt die Kosten der Behandlung?");
    await expect(missing).toContainText("Geburtsort");
    await expect(missing).toContainText("Ausweisdokument: Art des Dokuments");
    await expect(missing).toContainText("Ausweisdokument: Foto oder Scan des Ausweises");
    await expect(missing).toContainText("Handeln Sie im eigenen wirtschaftlichen Interesse?");
    await expect(missing).toContainText("Gesetzliche Fragen: Öffentliches Amt");
    await expect(missing).toContainText("Gesetzliche Fragen: Sanktionen");

    await page.getByRole("button", { name: "Angaben ändern" }).click();
    await setDatePickerValue(page.locator("#lead-request-date_of_birth"), "1988-05-01");
    await expect.poll(() => calls.personalData.some((patch) => patch.date_of_birth === "1988-05-01")).toBe(true);
    await page.getByRole("combobox", { name: "Geschlecht laut Ausweis" }).click();
    await page.getByRole("option", { name: "Weiblich" }).click();
    await expect.poll(() => calls.personalData.some((patch) => patch.legal_sex === "female")).toBe(true);
    await page.getByRole("combobox", { name: "Wohnsitzland" }).click();
    await page.getByRole("option", { name: "Deutschland" }).first().click();
    await page.locator("#lead-request-citizenships").click();
    await page.getByRole("option", { name: "Deutschland" }).first().click();
    await expect.poll(() => calls.personalData.some((patch) => Array.isArray(patch.citizenships))).toBe(true);

    // The statements for the identification: place and country of birth, the
    // identity document with a copy of it.
    await page.locator("#lead-request-birth_place").fill("Kyiv");
    await choose(page, page.getByRole("combobox", { name: "Geburtsland" }), "Ukraine");
    const identity = page.getByTestId("lead-request-identity");
    await choose(page, identity.getByRole("combobox", { name: "Art des Dokuments" }), "Reisepass");
    await identity.getByRole("textbox", { name: "Dokumentnummer" }).fill("FE123456");
    await identity.getByRole("textbox", { name: "Ausstellende Behörde" }).fill("8001");
    await choose(page, identity.getByRole("combobox", { name: "Ausstellungsland" }), "Ukraine");
    await setDatePickerValue(page.locator("#lead-request-id_valid_until"), "2031-03-04");
    await page.locator("#lead-request-identity-files").setInputFiles({
      name: "reisepass.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("synthetic image"),
    });
    await expect(page.getByTestId("lead-request-identity-list")).toContainText("reisepass.jpg");
    await expect
      .poll(() => Object.assign({}, ...calls.identification))
      .toEqual({
        birth_place: "Kyiv",
        birth_country: "UA",
        id_document_type: "passport",
        id_document_number: "FE123456",
        id_issuing_authority: "8001",
        id_issuing_country: "UA",
        id_valid_until: "2031-03-04",
      });

    const payer = page.getByTestId("lead-request-payer");
    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await choose(page, payer.getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" }), "Ja");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: true });

    // The four legal questions are answered with yes or no.
    for (const question of ["pep_self", "pep_related", "high_risk_country", "sanctions_links"]) {
      await choose(page, page.getByTestId(`lead-request-legal-${question}`).getByRole("combobox"), "Nein");
    }
    await expect
      .poll(() => Object.assign({}, ...calls.identification))
      .toMatchObject({ pep_self: false, pep_related: false, high_risk_country: false, sanctions_links: false });
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");

    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect(missing).toHaveCount(0);
    // Complete, but not confirmed: nothing can be sent yet.
    await expect(send).toBeDisabled();
    await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("03.10.2026");
    expect(calls.submits).toBe(1);
    expect(calls.submitBodies).toEqual([{ declared_correct: true }]);

    // Sent: the page says what happens next and offers nothing to send. The
    // confirmation given with the sending is shown, not asked again.
    await expect(page.getByTestId("lead-request-next-steps")).toContainText("Ihre Ansprechperson prüft");
    await expect(page.getByRole("heading", { name: "Das haben wir erhalten" })).toBeVisible();
    await expect(send).toHaveCount(0);
    await expect(page.getByTestId("lead-request-changed")).toHaveCount(0);
    const declaration = page.getByTestId("lead-request-declaration");
    await expect(declaration.getByRole("checkbox")).toBeChecked();
    await expect(declaration.getByRole("checkbox")).toBeDisabled();
    await expect(declaration).toContainText("Bestätigt am 03.10.2026");

    // The insurance block of the staff wizard is the patient's to fill in. A
    // change after sending is what "send again" is for.
    await page.getByRole("button", { name: "Angaben ändern" }).click();
    const insurance = page.getByTestId("lead-request-insurance");
    await expect(insurance.getByRole("textbox", { name: "Versicherer" })).toHaveCount(0);
    await insurance.getByRole("combobox", { name: "Krankenversicherung vorhanden?" }).click();
    await page.getByRole("option", { name: "Ja", exact: true }).click();
    await insurance.getByRole("textbox", { name: "Versicherer" }).fill("Allianz Care");
    await expect
      .poll(() => calls.personalData.some((patch) => patch.has_insurance === "yes" && patch.insurance_provider === "Allianz Care"))
      .toBe(true);

    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-changed")).toContainText("nach dem Senden geändert");
    await expect(send).toHaveText("Erneut senden");
    // What changed is confirmed anew before it is sent again.
    await expect(send).toBeDisabled();
    await expect(declaration.getByRole("checkbox")).not.toBeChecked();
    await declaration.getByRole("checkbox").check();
    await send.click();
    await expect.poll(() => calls.submits).toBe(2);
    await expect(send).toHaveCount(0);
    await expect(page.getByTestId("lead-request-changed")).toHaveCount(0);
  });

  test("another person as payer is named with name and citizenship before sending", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const payer = page.getByTestId("lead-request-payer");
    const question = payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" });

    // Another person's fields exist only when another person pays.
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await question.click();
    await page.getByRole("option", { name: "Eine andere Person" }).click();
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "third_party" });
    await expect(payer).toContainText("Wir sind gesetzlich verpflichtet zu wissen, wer zahlt.");

    // The send step says what the manager still needs about that person.
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("Zahlende Person: Vorname");
    await expect(missing).toContainText("Zahlende Person: Nachname");
    await expect(missing).toContainText("Zahlende Person: Staatsangehörigkeit(en)");
    await expect(missing).toContainText("Zahlende Person: Warum zahlt diese Person?");

    await page.locator('[data-step="data"]').click();
    await expect(question).toContainText("Eine andere Person");
    await payer.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await payer.getByRole("textbox", { name: "Nachname" }).fill(" Zahler ");
    await page.locator("#lead-request-payer_citizenships").click();
    await page.getByRole("option", { name: "Ukraine" }).first().click();
    await payer.getByRole("textbox", { name: "Ort", exact: true }).fill("München");
    // The block is saved as a whole, trimmed, without the empty fields.
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({ payer_kind: "third_party", first_name: "Viktor", last_name: "Zahler", city: "München", citizenships: ["UA"] });
    // Why that person pays is one of the statements for the identification.
    await payer.getByRole("textbox", { name: "Warum zahlt diese Person?" }).fill("Mein Vater unterstützt mich.");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ payment_background: "Mein Vater unterstützt mich." });
    await page.locator('[data-step="send"]').click();
    await expect(missing).not.toContainText("Zahlende Person");
    // The summary names the person who pays.
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Eine andere Person");
    await expect(paying).toContainText("Viktor");
    await expect(paying).toContainText("Mein Vater unterstützt mich.");

    // "I pay myself" sends only the answer, hides the other person again and
    // takes back why that person pays.
    await page.locator('[data-step="data"]').click();
    await question.click();
    await page.getByRole("option", { name: "Ich selbst" }).click();
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await expect.poll(() => calls.identification.at(-1)).toEqual({ payment_background: "" });
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Warum zahlt diese Person?" })).toHaveCount(0);
  });

  test("the identity document is uploaded only after the request consent", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const upload = page.getByTestId("lead-request-identity-upload");
    const button = upload.getByRole("button", { name: "Foto oder Scan des Ausweises hochladen" });
    const list = page.getByTestId("lead-request-identity-list");

    // Like the health consent before the medical documents: no consent, no upload.
    await expect(button).toBeDisabled();
    await expect(page.locator("#lead-request-identity-files")).toBeDisabled();
    await expect(upload).toContainText("Zum Hochladen bitte zuerst oben der Verarbeitung Ihrer Angaben zustimmen.");
    await expect(list).toContainText("Noch kein Ausweis hochgeladen.");
    await expect(upload).toContainText("Eine Kopie allein reicht möglicherweise nicht aus");

    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(button).toBeEnabled();
    await expect(upload).toContainText("PDF, JPG oder PNG, bis 25 MB pro Datei.");
    await page.locator("#lead-request-identity-files").setInputFiles({
      name: "reisepass.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("synthetic image"),
    });
    await expect(list).toContainText("reisepass.jpg");
    // A copy of the identity document is not a medical document.
    expect(calls.identityUploads).toBe(1);
    expect(calls.uploads).toBe(0);
    await page.locator('[data-step="documents"]').click();
    await expect(page.getByTestId("lead-request-document-list")).toContainText("Noch keine Unterlagen hochgeladen.");
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-identity")).toContainText("reisepass.jpg");
    await expect(page.getByTestId("lead-request-missing")).not.toContainText("Foto oder Scan des Ausweises");

    // The own upload can be taken back.
    await page.locator('[data-step="data"]').click();
    await list.getByRole("button", { name: "Entfernen" }).click();
    await expect(list).toContainText("Noch kein Ausweis hochgeladen.");
  });

  test("an expired identity document is refused once and not sent again", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const validUntil = page.locator("#lead-request-id_valid_until");
    const error = page.locator("#lead-request-id_valid_until-error");
    const saveState = page.getByTestId("lead-request-save-state");

    await setDatePickerValue(validUntil, "2020-01-01");
    await expect(error).toHaveText("Das Dokument ist abgelaufen. Bitte geben Sie ein gültiges Dokument an.");
    await expect(saveState).toHaveText("Nicht gespeichert");
    expect(calls.identification).toEqual([{ id_valid_until: "2020-01-01" }]);

    // Another statement is saved on its own; the refused date stays out and stays marked.
    await page.locator("#lead-request-id_document_number").fill("FE123456");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ id_document_number: "FE123456" });
    await expect(error).toBeVisible();
    await expect(saveState).toHaveText("Nicht gespeichert");
    expect(calls.identification.filter((patch) => "id_valid_until" in patch)).toHaveLength(1);

    // A valid date goes through, and the message goes with the refused value.
    await setDatePickerValue(validUntil, "2031-03-04");
    await expect(error).toHaveCount(0);
    await expect.poll(() => calls.identification.at(-1)).toEqual({ id_valid_until: "2031-03-04" });
    await expect(saveState).toHaveText("Gespeichert");
  });

  test("acting for somebody else asks who that is", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const payer = page.getByTestId("lead-request-payer");
    const ownAccount = payer.getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" });
    const person = payer.getByRole("textbox", { name: "In wessen Interesse handeln Sie?" });

    // The question belongs to the answer "who pays" and is saved with it.
    await expect(ownAccount).toHaveCount(0);
    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await expect(person).toHaveCount(0);

    await choose(page, ownAccount, "Nein");
    await expect(person).toBeVisible();
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: false, beneficial_owner: "" });
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)");

    await page.locator('[data-step="data"]').click();
    await expect(ownAccount).toContainText("Nein");
    await person.fill("Viktor Zahler, 03.02.1960, Kyiv, Musterstraße 1, 10115 Berlin");
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({
        payer_kind: "self",
        acts_on_own_account: false,
        beneficial_owner: "Viktor Zahler, 03.02.1960, Kyiv, Musterstraße 1, 10115 Berlin",
      });
    await page.locator('[data-step="send"]').click();
    await expect(missing).not.toContainText("In wessen Interesse");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Viktor Zahler, 03.02.1960, Kyiv");

    // "Yes" names nobody.
    await page.locator('[data-step="data"]').click();
    await choose(page, ownAccount, "Ja");
    await expect(person).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: true });
  });

  test("a yes to a legal question asks for the details", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const pep = page.getByTestId("lead-request-legal-pep_self");
    const pepAnswer = pep.getByRole("combobox", { name: /Üben Sie ein hochrangiges öffentliches Amt aus/ });
    const pepDetails = pep.getByRole("textbox", { name: "Amt, Land und Zeitraum" });

    await expect(page.getByTestId("lead-request-data")).toContainText("Diese Fragen schreibt das Geldwäschegesetz vor.");
    await expect(pepDetails).toHaveCount(0);
    await choose(page, pepAnswer, "Ja");
    await expect(pepDetails).toBeVisible();
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: true });
    await pepDetails.fill("Ministerin, Ukraine, 2020–2024");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self_details: "Ministerin, Ukraine, 2020–2024" });

    // The high-risk question asks for the country.
    const risk = page.getByTestId("lead-request-legal-high_risk_country");
    await choose(page, risk.getByRole("combobox", { name: /Haben Sie oder eine beteiligte Person/ }), "Ja");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ high_risk_country: true });
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-missing")).toContainText("Gesetzliche Fragen: Land mit hohem Risiko – Welches Land?");
    await page.locator('[data-step="data"]').click();
    await choose(page, risk.getByRole("combobox", { name: "Welches Land?" }), "Iran");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ high_risk_country_code: "IR" });

    // "No" takes the details back.
    await choose(page, pepAnswer, "Nein");
    await expect(pepDetails).toHaveCount(0);
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: false, pep_self_details: "" });
  });

  test("the send step shows what will be sent and needs the confirmation", async ({ page }) => {
    const { calls } = await setup(page, "lead", { prepare: completeRequest });
    await page.goto("/");
    await page.locator('[data-step="send"]').click();
    const send = page.getByTestId("lead-request-submit");
    const declaration = page.getByTestId("lead-request-declaration");

    // Everything entered, grouped like the form, read-only.
    const summary = page.getByTestId("lead-request-summary");
    await expect(summary.getByRole("textbox")).toHaveCount(0);
    await expect(summary.getByRole("combobox")).toHaveCount(0);
    const person = page.getByTestId("lead-request-summary-person");
    await expect(person).toContainText("Frau");
    await expect(person).toContainText("Anna");
    await expect(person).toContainText("01.05.1988");
    await expect(person).toContainText("Kyiv");
    await expect(page.getByTestId("lead-request-summary-address")).toContainText("Musterstraße 1");
    await expect(page.getByTestId("lead-request-summary-address")).toContainText("Deutschland");
    await expect(page.getByTestId("lead-request-summary-contact")).toContainText("E-Mail, Messenger");
    const identity = page.getByTestId("lead-request-summary-identity");
    await expect(identity).toContainText("Reisepass");
    await expect(identity).toContainText("FE123456");
    await expect(identity).toContainText("04.03.2031");
    await expect(identity).toContainText("reisepass.jpg");
    await expect(page.getByTestId("lead-request-summary-insurance")).toContainText("Noch keine Angaben");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Ich selbst");
    const legal = page.getByTestId("lead-request-summary-legal");
    await expect(legal).toContainText("Üben Sie ein hochrangiges öffentliches Amt aus");
    await expect(legal).toContainText("Viktor Zahler, Vater, Minister, Ukraine");
    await expect(page.getByTestId("lead-request-summary-documents")).toContainText("Noch keine Unterlagen hochgeladen.");

    // Nothing is missing, yet nothing is sent without the confirmation.
    await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
    await expect(declaration).toContainText(
      "Ich bestätige, dass meine Angaben vollständig und wahrheitsgemäß sind und dass ich Änderungen mitteile.",
    );
    await expect(send).toBeDisabled();
    await declaration.getByRole("checkbox").check();
    await expect(send).toBeEnabled();
    await declaration.getByRole("checkbox").uncheck();
    await expect(send).toBeDisabled();
    expect(calls.submitBodies).toEqual([]);

    await declaration.getByRole("checkbox").check();
    await send.click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("03.10.2026");
    expect(calls.submitBodies).toEqual([{ declared_correct: true }]);
    await expect(declaration).toContainText("Bestätigt am 03.10.2026");
    // What was received stays readable.
    await expect(person).toContainText("Anna");
  });

  test("a parent reads the questions about the child, not about 'you'", async ({ page }) => {
    await setup(page, "lead", {
      prepare: (request) => {
        completeRequest(request);
        request.access_kind = "guardian";
      },
    });
    await page.goto("/");
    await expect(page.getByTestId("lead-request-legal-pep_self")).toContainText("Übt die Patientin / der Patient ein hochrangiges öffentliches Amt aus");
    await expect(page.getByTestId("lead-request-legal-sanctions_links")).toContainText("Bestehen Verbindungen zu Personen oder Unternehmen");
    await expect(
      page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?" }),
    ).toBeVisible();
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-legal")).toContainText("Übt die Patientin / der Patient");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Die Patientin / der Patient selbst");
  });

  test("a server without the identification shows the request as before", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        completeRequest(request);
        // An older server sends neither the statements nor the copies.
        const older = request as { identification?: unknown; identity_documents?: unknown };
        older.identification = undefined;
        older.identity_documents = undefined;
        request.payer = { payer_kind: "self" };
      },
    });
    await page.goto("/");
    await expect(page.locator("#lead-request-first_name")).toHaveValue("Anna");
    await expect(page.getByTestId("lead-request-identity")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-legal")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-contact-channels")).toHaveCount(0);
    await expect(page.locator("#lead-request-birth_place")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payer").getByRole("combobox")).toHaveCount(1);

    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-identity")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-declaration")).toHaveCount(0);
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("03.10.2026");
    expect(calls.submitBodies).toEqual([null]);
  });

  test("no insurance means self-payer and hides the details", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    const insurance = page.getByTestId("lead-request-insurance");
    await insurance.getByRole("combobox", { name: "Krankenversicherung vorhanden?" }).click();
    await page.getByRole("option", { name: "Nein", exact: true }).click();
    await expect.poll(() => calls.personalData.at(-1)).toMatchObject({ has_insurance: "no", insurance_type: "self_pay" });
    await expect(insurance.getByRole("combobox", { name: "Versicherungsart" })).toHaveCount(0);
    await expect(insurance.getByRole("textbox", { name: "Versicherungsnummer" })).toHaveCount(0);
  });

  test("the account of a lead offers no password change", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/account");
    await expect(page.getByTestId("account-page")).toBeVisible();
    // The lead keeps the password the manager issued (owner decision 2026-10-05).
    await expect(page.getByText("Passwort ändern")).toHaveCount(0);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });

  test("the legal notice opens inside the cabinet, not on the page that leads back to the login", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const menu = page.locator("nav");
    await menu.getByRole("link", { name: /Impressum/ }).click();
    await expect(page).toHaveURL(/\/legal$/);
    await expect(page.getByTestId("legal-notice")).toBeVisible();
    await expect(page.getByTestId("legal-privacy")).toBeVisible();
    await expect(menu.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByText("Zurück zur Anmeldung")).toHaveCount(0);
  });

  test("the lead switches the cabinet to Ukrainian or English and keeps the choice", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    await expect(languages.getByRole("radio", { name: "DE" })).toHaveAttribute("aria-checked", "true");

    await languages.getByRole("radio", { name: "UA" }).click();
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Документи/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Прізвище", exact: true })).toBeVisible();

    await languages.getByRole("radio", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();
  });

  test("the language button of the top bar and the cabinet switch agree", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    const portalLanguage = page.locator("header button:has(svg.lucide-globe)");
    const menu = page.locator("nav");

    // German and Russian are the portal's languages: both controls switch the menu and the cabinet.
    await portalLanguage.click();
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "RU" })).toHaveAttribute("aria-checked", "true");
    await expect(menu.getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await languages.getByRole("radio", { name: "DE" }).click();
    await expect(menu.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();

    // Ukrainian exists only in the cabinet: the top bar button changes the menu, the cabinet stays.
    await languages.getByRole("radio", { name: "UA" }).click();
    await portalLanguage.click();
    await expect(menu.getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "UA" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("textbox", { name: "Прізвище", exact: true })).toBeVisible();
  });

  test("a Russian request opens the whole portal in Russian once, then the person's choice counts", async ({ page }) => {
    await setup(page, "lead", { primaryLanguage: "ru", accountLanguage: null });
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "RU" })).toHaveAttribute("aria-checked", "true");

    await page.locator("header button:has(svg.lucide-globe)").click();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
  });

  test("a language saved on the account is not replaced by the language of the request", async ({ page }) => {
    await setup(page, "lead", { primaryLanguage: "ru", accountLanguage: "de" });
    await page.goto("/");
    await expect(page.getByTestId("lead-request")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByTestId("lead-cabinet-language").getByRole("radio", { name: "DE" })).toHaveAttribute("aria-checked", "true");
  });

  test("the calendar of the date of birth speaks the cabinet language", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    const openCalendar = page.getByTestId("lead-request-data").locator("[data-picker-anchor] button").first();
    const month = (locale: string) =>
      new RegExp(new Intl.DateTimeFormat(locale, { month: "long", timeZone: "Europe/Berlin" }).format(new Date()), "i");

    await languages.getByRole("radio", { name: "UA" }).click();
    await openCalendar.click();
    await expect(page.locator(".MuiPickersCalendarHeader-label")).toHaveText(month("uk"));
    await expect(page.locator(".MuiDayCalendar-weekDayLabel").first()).toHaveText("П");
    await page.keyboard.press("Escape");

    await languages.getByRole("radio", { name: "EN" }).click();
    await openCalendar.click();
    await expect(page.locator(".MuiPickersCalendarHeader-label")).toHaveText(month("en-GB"));
    // English weeks start on Monday here, as everywhere in the app.
    await expect(page.locator(".MuiDayCalendar-weekDayLabel").first()).toHaveText("M");
  });

  test("the step footer stays on screen while the form scrolls", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const next = page.getByTestId("lead-request-data").getByRole("button", { name: "Weiter" });
    // The form is longer than the screen; "Weiter" must not need scrolling.
    await expect(page.locator("#lead-request-first_name")).toBeInViewport();
    await expect(next).toBeInViewport();
    await next.click();
    await expect(page.getByTestId("lead-request-documents")).toBeVisible();
  });

  test("the last entry is saved when the step is left at once", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    // The page's timers are the test's from the start, so that they can be stopped below.
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator("#lead-request-city")).toBeVisible();
    // The clock stands still: the autosave delay never runs out, only leaving the step can save.
    await page.clock.pauseAt(Date.now() + 1000);
    await page.locator("#lead-request-city").fill("Berlin");
    await page.locator("#lead-request-birth_place").fill("Kyiv");
    expect(calls.personalData).toEqual([]);
    await page.getByTestId("lead-request-data").getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-documents")).toBeVisible();
    await expect.poll(() => calls.personalData).toEqual([{ city: "Berlin" }]);
    await expect.poll(() => calls.identification).toEqual([{ birth_place: "Kyiv" }]);

    // Back on the step the entries are there, and nothing is sent a second time.
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-address")).toContainText("Berlin");
    await expect(page.getByTestId("lead-request-summary-person")).toContainText("Kyiv");
    await page.locator('[data-step="data"]').click();
    await expect(page.locator("#lead-request-city")).toHaveValue("Berlin");
    await expect(page.locator("#lead-request-birth_place")).toHaveValue("Kyiv");
    await page.locator('[data-step="documents"]').click();
    await expect(page.getByTestId("lead-request-documents")).toBeVisible();
    expect(calls.personalData).toHaveLength(1);
    expect(calls.identification).toHaveLength(1);
  });

  test("the lead cabinet fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    // The long legal questions, their details and the upload button wrap instead of widening the page.
    await expect(page.getByTestId("lead-request-legal")).toBeVisible();
    await choose(page, page.getByTestId("lead-request-legal-pep_related").getByRole("combobox"), "Ja");
    await expect(page.getByTestId("lead-request-legal-pep_related").getByRole("textbox")).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-data")).toBeLessThanOrEqual(1);
  });

  test("the summary of a complete request fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead", {
      prepare: (request) => {
        completeRequest(request);
        request.identification.id_issuing_authority = "Staatlicher-Migrationsdienst-der-Ukraine-Stelle-8001";
      },
    });
    await page.goto("/");
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-legal")).toBeVisible();
    await expect(page.getByTestId("lead-request-declaration")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-send")).toBeLessThanOrEqual(1);
    // The send button stays reachable below the long summary.
    await expect(page.getByTestId("lead-request-submit")).toBeInViewport();
  });
});

test.describe("patient portal after conversion", () => {
  test("a patient login keeps the full portal and gets the request page when it fills one in", async ({ page }) => {
    await setup(page, "patient", { leadRequests: 1 });
    await page.goto("/");
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Meine Dokumente" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await nav.getByRole("link", { name: "Ihre Anfrage" }).click();
    await expect(page).toHaveURL(/\/request$/);
    await expect(page.getByTestId("lead-request")).toBeVisible();
  });
});
