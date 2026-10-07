import { expect, test, type Locator, type Page } from "@playwright/test";

// Lead cabinet, invoice recipient and payment route (owner spec
// "Patientenformular", sections 7 and 8; contract phase 2): where the invoice
// goes, and how the treatment is paid — asked of the patient or the paying
// parent, not of another payer. Mocked API that behaves like the contract,
// synthetic data.

type Billing = {
  invoice_to: string | null;
  invoice_name: string | null;
  invoice_street: string | null;
  invoice_zip: string | null;
  invoice_city: string | null;
  invoice_country: string | null;
  invoice_email: string | null;
  payer_declared: boolean;
  payment_route_by: "patient" | "guardian" | "payer";
  payment_method: string | null;
  payment_method_details: string | null;
  account_country: string | null;
  account_holder: string | null;
  bank_name: string | null;
  via_third_party: boolean | null;
  via_third_party_details: string | null;
  account_holder_suggestion: string | null;
};

type Payer = Record<string, unknown> & { payer_kind: "self" | "third_party" };

/** Opens a step of the cabinet by its tab. */
const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`).click();

const INVOICE_KEYS = ["invoice_to", "invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country", "invoice_email"];
const PAYMENT_ROUTE_KEYS = [
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
];
const INVOICE_ADDRESS_KEYS = ["invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country"];
const ACCOUNT_KEYS = ["account_country", "account_holder", "bank_name"];

function emptyBilling(): Billing {
  return {
    invoice_to: null,
    invoice_name: null,
    invoice_street: null,
    invoice_zip: null,
    invoice_city: null,
    invoice_country: null,
    invoice_email: null,
    payer_declared: false,
    payment_route_by: "patient",
    payment_method: null,
    payment_method_details: null,
    account_country: null,
    account_holder: null,
    bank_name: null,
    via_third_party: null,
    via_third_party_details: null,
    account_holder_suggestion: null,
  };
}

function selfPayer(): Payer {
  return {
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
    payer_type: null,
    organisation_name: null,
    relationship_kind: null,
    contact_consent_at: null,
  };
}

/** A third party who pays: a person with the consent to be contacted. */
function thirdParty(overrides: Record<string, unknown> = {}): Payer {
  return {
    ...selfPayer(),
    payer_kind: "third_party",
    payer_type: "person",
    first_name: "Viktor",
    last_name: "Zahler",
    citizenships: ["UA"],
    relationship_kind: "parent",
    contact_consent_at: "2026-10-05T09:16:00Z",
    ...overrides,
  };
}

/** A request with everything entered but invoice and payment: an adult's own, or a child's in a parent's login. */
function leadRequest(minor: boolean) {
  return {
    lead_id: "lead-1",
    access_kind: minor ? "guardian" : "self",
    created_at: "2026-10-05T08:00:00Z",
    personal_data: {
      first_name: minor ? "Mia" : "Anna",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: minor ? "2015-06-01" : "1988-05-01",
      legal_sex: "female",
      citizenships: ["DE"],
      street_address: "Musterstraße 1",
      zip_code: "10115",
      city: "Berlin",
      country: "DE",
      phone: null,
      primary_language: null,
      has_insurance: null,
      insurance_type: null,
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    } as Record<string, unknown>,
    // Recomputed before every response.
    progress: { filled: 9, total: 12, missing_for_submit: [] as string[] },
    payer: selfPayer() as Payer | null,
    // A parent's own data: on file for a parent's login.
    payer_self_template: minor
      ? { first_name: "Maria", last_name: "Muster", date_of_birth: "1985-04-12", email: "maria.muster@example.com", phone: null }
      : null,
    identification: {
      salutation: null,
      former_names: null,
      birth_place: "Berlin",
      birth_country: "DE",
      habitual_residence_country: null,
      contact_channels: ["email"],
      pep_self: false,
      pep_related: false,
      sanctions_links: false,
      payment_background: "Mein Vater unterstützt mich." as string | null,
      declared_correct_at: null as string | null,
    },
    identity_documents: [
      {
        id: "id-doc-0",
        file_name: "reisepass.jpg",
        size_bytes: 4096,
        mime_type: "image/jpeg",
        uploaded_at: "2026-10-05T09:20:00Z",
        uploaded_by_me: true,
        reviewed: false,
        can_delete: true,
      },
    ],
    // Who acts for the lead is answered; a minor's parents have a spec of their own.
    representation: minor
      ? undefined
      : { has_representative: false, under_guardianship: false, custody: null, custody_stated: false, representatives: [] },
    // A server before the trigger flow (no `follow_up`): both sections are asked with the base form.
    billing: emptyBilling() as Billing | undefined,
    minor,
    documents: [] as Record<string, unknown>[],
    max_documents: 30,
    consents: {
      health_data_processing: {
        type: "health_data_processing",
        version: "2026-10-03",
        texts: { de: "Ich willige ein …" },
        given_at: null as string | null,
      },
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: "2026-10-03",
        texts: { de: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden." },
        given_at: "2026-10-05T09:15:00Z" as string | null,
      },
    } as Record<string, { type: string; version: string; texts: Record<string, string>; given_at: string | null }>,
    submitted_at: null as string | null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-19T08:00:00Z",
  };
}

type Request = ReturnType<typeof leadRequest>;

/** What tells one payer from another: a change clears section 8 (contract D5). */
function payerKey(payer: Payer | null) {
  return payer
    ? JSON.stringify([payer.payer_kind, payer.payer_type ?? null, payer.organisation_name ?? null, payer.first_name ?? null, payer.last_name ?? null, payer.date_of_birth ?? null])
    : null;
}

/** Like the server: what does not belong to the chosen answers goes. */
function clearDependents(billing: Billing) {
  const put = (key: string, value: null) => {
    (billing as unknown as Record<string, unknown>)[key] = value;
  };
  if (billing.invoice_to !== "other") for (const key of INVOICE_ADDRESS_KEYS) put(key, null);
  if (billing.invoice_to === "payer") billing.invoice_email = null;
  if (billing.payment_method !== "other") billing.payment_method_details = null;
  if (billing.payment_method !== "bank_transfer" && billing.payment_method !== "card") for (const key of ACCOUNT_KEYS) put(key, null);
  if (billing.via_third_party !== true) billing.via_third_party_details = null;
}

/** Who answers section 8 (contract D6), whether "to the payer" is offered, and the name offered as holder. */
function recompute(request: Request) {
  const billing = request.billing;
  const payer = request.payer;
  const missing: string[] = [];
  if (!billing) {
    request.progress.missing_for_submit = missing;
    return;
  }
  const declared = payer?.payer_kind === "third_party";
  const template = request.payer_self_template;
  const parentPays =
    declared &&
    request.access_kind === "guardian" &&
    Boolean(template) &&
    payer?.relationship_kind === "parent" &&
    payer?.first_name === template?.first_name &&
    payer?.last_name === template?.last_name;
  billing.payer_declared = declared;
  billing.payment_route_by = !declared ? "patient" : parentPays ? "guardian" : "payer";
  billing.account_holder_suggestion =
    billing.payment_route_by === "payer"
      ? null
      : billing.payment_route_by === "guardian"
        ? `${template?.first_name} ${template?.last_name}`
        : `${request.personal_data.first_name} ${request.personal_data.last_name}`;
  if (!billing.invoice_to) missing.push("invoice_to");
  if (billing.invoice_to === "other") {
    for (const key of INVOICE_ADDRESS_KEYS) if (!(billing as unknown as Record<string, unknown>)[key]) missing.push(key);
  }
  if (billing.payment_route_by !== "payer") {
    const method = billing.payment_method;
    if (!method) missing.push("payment_method");
    if (method === "other" && !billing.payment_method_details) missing.push("payment_method_details");
    if (method === "bank_transfer" || method === "card") {
      if (!billing.account_country) missing.push("account_country");
      if (!billing.account_holder) missing.push("account_holder");
      if (method === "bank_transfer" && !billing.bank_name) missing.push("bank_name");
    }
    if (billing.via_third_party == null) missing.push("via_third_party");
    else if (billing.via_third_party && !billing.via_third_party_details) missing.push("via_third_party_details");
  }
  request.progress.missing_for_submit = missing;
}

/** Picks an option of one of the cabinet's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  // The list fades out: the next select must not find this one's options.
  await expect(page.getByRole("option")).toHaveCount(0);
}

/** How far anything inside a step reaches beyond the right edge of the screen. */
function widestOverhang(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((step) => {
    const width = document.documentElement.clientWidth;
    return Math.max(0, ...Array.from(step.querySelectorAll("*"), (node) => node.getBoundingClientRect().right - width));
  });
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** The answers to "where does the invoice go" as the form offers them (the labels of the radios). */
const answers = (billing: Locator) => billing.getByTestId("lead-request-invoice-to").locator("label");

async function setup(page: Page, options: { minor?: boolean; prepare?: (request: Request) => void } = {}) {
  const request = leadRequest(options.minor ?? false);
  options.prepare?.(request);
  const calls = {
    /** Bodies of `POST …/billing`. */
    billing: [] as Record<string, unknown>[],
    payer: [] as Record<string, unknown>[],
    loads: 0,
    submits: 0,
    /** Writes of the other parts of the form; none is expected here. */
    other: [] as string[],
    /**
     * The server's state moved on without the cabinet: the payer answers
     * section 8 now (somebody declared a third party in the meantime).
     */
    payerTookOver: false,
  };
  const changed = () => {
    if (request.submitted_at) request.changed_since_submit = true;
  };
  const answer = () => {
    if (calls.payerTookOver && request.payer?.payer_kind !== "third_party") {
      request.payer = thirdParty();
      if (request.billing) for (const key of PAYMENT_ROUTE_KEYS) (request.billing as unknown as Record<string, unknown>)[key] = null;
    }
    recompute(request);
    return request;
  };

  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "lead-cabinet-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    const method = req.method();
    const base = "/me/lead-requests/lead-1";

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "lead-user",
          email: "anna.muster@example.com",
          name: "Anna Muster",
          role: "patient",
          capabilities: [],
          created_at: "2026-10-05T08:00:00Z",
          preferred_language: "de",
          password_change_required: false,
          portal_mode: "lead",
          lead_portal: { requests: 1 },
        },
      });
    }
    if (path === "/me/lead-requests") {
      calls.loads += 1;
      return route.fulfill({ json: { requests: [answer()] } });
    }

    if (path === `${base}/billing` && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.billing.push(patch);
      const billing = request.billing;
      if (!billing) return route.fulfill({ status: 404, json: { error: "Not found" } });
      const refuse = (status: number, code: string, field?: string) =>
        route.fulfill({ status, json: { code, message: code, ...(field ? { field } : {}) } });
      const unknown = Object.keys(patch).find((key) => !INVOICE_KEYS.includes(key) && !PAYMENT_ROUTE_KEYS.includes(key));
      if (unknown) return refuse(422, "invalid_field", unknown);
      // The server's state, not the cabinet's, says who answers section 8.
      const current = answer().billing as Billing;
      if (current.payment_route_by === "payer" && Object.keys(patch).some((key) => PAYMENT_ROUTE_KEYS.includes(key))) {
        return refuse(409, "payment_route_by_payer");
      }
      if (patch.invoice_to === "payer" && !current.payer_declared) return refuse(422, "invalid_field", "invoice_to");
      if (typeof patch.invoice_email === "string" && patch.invoice_email && !patch.invoice_email.includes("@")) {
        return refuse(422, "invalid_field", "invoice_email");
      }
      for (const [key, value] of Object.entries(patch)) {
        (billing as unknown as Record<string, unknown>)[key] = value === "" ? null : value;
      }
      clearDependents(billing);
      changed();
      return route.fulfill({ json: answer() });
    }
    if (path === `${base}/payer` && method === "POST") {
      const input = req.postDataJSON() as Record<string, unknown>;
      calls.payer.push(input);
      const before = request.payer;
      const { contact_consent: consent, ...fields } = input;
      const kind = input.payer_kind === "third_party" ? "third_party" : "self";
      const stored: Payer =
        kind === "self"
          ? { ...selfPayer(), acts_on_own_account: before?.acts_on_own_account ?? null }
          : {
              ...selfPayer(),
              ...fields,
              payer_kind: "third_party",
              payer_type: input.payer_type ?? "person",
              acts_on_own_account: before?.acts_on_own_account ?? null,
              contact_consent_at: consent === true ? "2026-10-05T09:16:00Z" : consent === false ? null : before?.contact_consent_at ?? null,
            };
      request.payer = stored;
      const billing = request.billing;
      if (billing) {
        // Another payer: section 8 was that payer's answer; "to the payer" needs a third party (contract D5).
        if (payerKey(before) !== payerKey(stored)) {
          for (const key of PAYMENT_ROUTE_KEYS) (billing as unknown as Record<string, unknown>)[key] = null;
        }
        if (kind !== "third_party" && billing.invoice_to === "payer") billing.invoice_to = null;
      }
      changed();
      return route.fulfill({ json: answer() });
    }
    if (path === `${base}/submit` && method === "POST") {
      const body = req.postData() ? (req.postDataJSON() as Record<string, unknown>) : null;
      if (body?.declared_correct !== true) {
        return route.fulfill({ status: 422, json: { code: "declaration_required", message: "Declaration required" } });
      }
      recompute(request);
      if (request.progress.missing_for_submit.length > 0) {
        return route.fulfill({ status: 422, json: { code: "personal_data_incomplete", missing: request.progress.missing_for_submit } });
      }
      calls.submits += 1;
      request.identification.declared_correct_at = "2026-10-05T09:30:00Z";
      request.submitted_at = "2026-10-05T09:30:00Z";
      request.changed_since_submit = false;
      return route.fulfill({ json: answer() });
    }
    if (path.startsWith(`${base}/`) && method === "POST") {
      // Personal data, identification, representation: complete from the start, nothing of them is saved here.
      calls.other.push(path);
      return route.fulfill({ json: answer() });
    }
    if (path === "/me/profile") {
      return route.fulfill({ json: { id: "lead-user", email: "anna.muster@example.com", name: "Anna Muster", role: "patient", phone: null, preferred_language: "de" } });
    }
    if (path.startsWith("/me/") || path.startsWith("/notifications")) {
      return route.fulfill({ status: 403, json: { error: "Forbidden", code: "lead_portal_only", message: "Lead portal only" } });
    }
    return route.fulfill({ json: [] });
  });
  return { request, calls };
}

const INVOICE_QUESTION = "Wohin soll die Rechnung gehen?";
const METHOD_QUESTION = "Wie werden Sie bezahlen?";
const VIA_QUESTION = /Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister\?/;
const TO_PATIENT = "An die Patientin / den Patienten (bei Minderjährigen an die gesetzlichen Vertreter)";

test.describe("lead cabinet: invoice recipient and payment route", () => {
  test("an adult who pays himself answers both sections, and the request can be sent", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto("/");
    await step(page, "billing");
    const billing = page.getByTestId("lead-request-billing");
    const route = page.getByTestId("lead-request-payment-route");
    const missing = page.getByTestId("lead-request-missing");

    // The two sections follow the insurance in step "Versicherung & Rechnung" (a server
    // without the follow-up blocks still asks the payment route here).
    await expect(page.getByRole("heading", { name: "Rechnungsempfänger", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Zahlungsweg", exact: true })).toBeVisible();
    const order = await page
      .getByTestId("lead-request-step-billing")
      .locator("h3")
      .evaluateAll((titles) => titles.map((title) => title.textContent));
    expect(order).toEqual(["Versicherung", "Rechnungsempfänger", "Zahlungsweg"]);
    // Nobody else pays: the invoice goes to the patient or to another address.
    await expect(billing.getByRole("radio")).toHaveCount(2);
    await expect(billing.getByRole("radio", { name: "An mich", exact: true })).not.toBeChecked();
    await expect(billing.getByRole("radio", { name: "An eine andere Adresse" })).toBeVisible();
    await expect(billing.getByRole("textbox", { name: /E-Mail für Rechnungen/ })).toHaveCount(0);
    await expect(billing).toContainText("USt-IdNr. oder Steuernummer trägt GMED bei Bedarf ein.");
    await expect(route).toContainText("Den voraussichtlichen Gesamtbetrag trägt GMED ein.");
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toHaveCount(0);

    // Until the three questions are answered the request cannot be sent.
    await page.locator('[data-step="send"]').click();
    await expect(missing.getByRole("listitem")).toHaveText([
      INVOICE_QUESTION,
      METHOD_QUESTION,
      "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?",
    ]);
    await expect(page.getByTestId("lead-request-summary-billing")).toContainText("Noch keine Angaben");
    await expect(page.getByTestId("lead-request-submit")).toBeDisabled();

    // "To me" asks for an e-mail for invoices, which is optional.
    await step(page, "billing");
    await billing.getByRole("radio", { name: "An mich", exact: true }).check();
    await expect.poll(() => calls.billing).toEqual([{ invoice_to: "self" }]);
    const email = billing.getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" });
    await expect(email).toBeVisible();
    await expect(billing).toContainText("Wenn leer, verwenden wir Ihre Kontaktadresse.");
    await email.fill(" rechnung@example.com ");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ invoice_email: "rechnung@example.com" });

    // A bank transfer asks for the account; the holder is offered, the rest is typed.
    const method = route.getByRole("combobox", { name: METHOD_QUESTION });
    await method.click();
    await expect(page.getByRole("option")).toHaveText(["Auswählen", "Überweisung", "Karte", "Bar", "Kryptowährung", "Sonstiges"]);
    await page.getByRole("option", { name: "Überweisung" }).click();
    await expect(page.getByRole("option")).toHaveCount(0);
    const holder = route.getByRole("textbox", { name: "Kontoinhaber/in" });
    await expect(holder).toHaveValue("Anna Muster");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "bank_transfer", account_holder: "Anna Muster" });
    await choose(page, route.getByRole("combobox", { name: "Land des Kontos" }), "Deutschland");
    await route.getByRole("textbox", { name: "Name der Bank" }).fill("Musterbank");
    await expect
      .poll(() => Object.assign({}, ...calls.billing))
      .toEqual({
        invoice_to: "self",
        invoice_email: "rechnung@example.com",
        payment_method: "bank_transfer",
        account_holder: "Anna Muster",
        account_country: "DE",
        bank_name: "Musterbank",
      });
    await choose(page, route.getByRole("combobox", { name: VIA_QUESTION }), "Nein");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ via_third_party: false });
    await expect(route.getByRole("textbox", { name: "Bitte beschreiben (wer, welcher Dienst)" })).toHaveCount(0);
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");

    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    const summary = page.getByTestId("lead-request-summary-billing");
    await expect(summary).toContainText("Rechnung und Zahlung");
    await expect(summary.locator("dt")).toHaveText([
      INVOICE_QUESTION,
      "E-Mail für Rechnungen (optional)",
      METHOD_QUESTION,
      "Land des Kontos",
      "Kontoinhaber/in",
      "Name der Bank",
      "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?",
    ]);
    await expect(summary.locator("dd")).toHaveText(["An mich", "rechnung@example.com", "Überweisung", "Deutschland", "Anna Muster", "Musterbank", "Nein"]);
    await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("05.10.2026");
    expect(calls.submits).toBe(1);
    expect(calls.other).toEqual([]);
  });

  test("another address, another method and a payment through somebody else ask for the details", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto("/");
    await step(page, "billing");
    const billing = page.getByTestId("lead-request-billing");
    const route = page.getByTestId("lead-request-payment-route");
    const missing = page.getByTestId("lead-request-missing");
    const address = page.getByTestId("lead-request-invoice-address");

    // Another address: name and address, and the e-mail for invoices.
    await expect(address).toHaveCount(0);
    await billing.getByRole("radio", { name: "An eine andere Adresse" }).check();
    await expect(address).toBeVisible();
    await expect.poll(() => calls.billing.at(-1)).toEqual({ invoice_to: "other" });
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("Rechnungsempfänger: Name auf der Rechnung");
    await expect(missing).toContainText("Rechnungsempfänger: Straße und Hausnummer");
    await expect(missing).toContainText("Rechnungsempfänger: PLZ");
    await expect(missing).toContainText("Rechnungsempfänger: Ort");
    await expect(missing).toContainText("Rechnungsempfänger: Land");
    await step(page, "billing");
    await address.getByRole("textbox", { name: "Name auf der Rechnung" }).fill("Beispiel GmbH");
    await address.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Musterstraße 2");
    await address.getByRole("textbox", { name: "PLZ" }).fill("10115");
    await address.getByRole("textbox", { name: "Ort" }).fill("Berlin");
    await choose(page, address.getByRole("combobox", { name: "Land" }), "Deutschland");
    await expect
      .poll(() => Object.assign({}, ...calls.billing))
      .toEqual({
        invoice_to: "other",
        invoice_name: "Beispiel GmbH",
        invoice_street: "Musterstraße 2",
        invoice_zip: "10115",
        invoice_city: "Berlin",
        invoice_country: "DE",
      });
    await expect(billing.getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" })).toBeVisible();

    // "Other" as method says what it is; cash and cryptocurrency are flagged; a card needs no bank.
    const method = route.getByRole("combobox", { name: METHOD_QUESTION });
    const details = route.getByRole("textbox", { name: "Bitte beschreiben", exact: true });
    const note = page.getByTestId("lead-request-payment-method-note");
    await choose(page, method, "Sonstiges");
    await expect(details).toBeVisible();
    await expect(note).toHaveCount(0);
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "other" });
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("Zahlungsweg: Sonstiges – Bitte beschreiben");
    await step(page, "billing");
    await details.fill("Scheck");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method_details: "Scheck" });
    await choose(page, method, "Bar");
    await expect(details).toHaveCount(0);
    await expect(note).toContainText("Barzahlungen und Zahlungen in Kryptowährung prüft GMED gesondert (Geldwäschegesetz).");
    await expect(route.getByRole("textbox", { name: "Kontoinhaber/in" })).toHaveCount(0);
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "cash", payment_method_details: "" });
    await choose(page, method, "Kryptowährung");
    await expect(note).toBeVisible();
    await choose(page, method, "Karte");
    await expect(note).toHaveCount(0);
    await expect(route.getByRole("textbox", { name: "Kontoinhaber/in" })).toHaveValue("Anna Muster");
    await choose(page, route.getByRole("combobox", { name: "Land des Kontos" }), "Deutschland");
    await page.locator('[data-step="send"]').click();
    await expect(missing).not.toContainText("Name der Bank");
    await expect(missing).not.toContainText("Kontoinhaber/in");
    await expect(missing).toContainText("Erfolgt die Zahlung über eine dritte Person");

    // A "yes" asks who and which service; a "no" takes the details back.
    await step(page, "billing");
    const viaDetails = route.getByRole("textbox", { name: "Bitte beschreiben (wer, welcher Dienst)" });
    await choose(page, route.getByRole("combobox", { name: VIA_QUESTION }), "Ja");
    await expect(viaDetails).toBeVisible();
    await expect.poll(() => calls.billing.at(-1)).toEqual({ via_third_party: true });
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("Zahlungsweg: Bitte beschreiben (wer, welcher Dienst)");
    await step(page, "billing");
    await viaDetails.fill("Mein Bruder zahlt über PayPal.");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ via_third_party_details: "Mein Bruder zahlt über PayPal." });
    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    const summary = page.getByTestId("lead-request-summary-billing");
    await expect(summary).toContainText("An eine andere Adresse");
    await expect(summary).toContainText("Beispiel GmbH");
    await expect(summary).toContainText("Karte");
    await expect(summary).toContainText("Mein Bruder zahlt über PayPal.");
    await step(page, "billing");
    await choose(page, route.getByRole("combobox", { name: VIA_QUESTION }), "Nein");
    await expect(viaDetails).toHaveCount(0);
    await expect.poll(() => calls.billing.at(-1)).toEqual({ via_third_party: false, via_third_party_details: "" });
  });

  test("with another payer the invoice may go to that payer, and the payment route is the payer's to answer", async ({ page }) => {
    const { calls } = await setup(page, { prepare: (request) => (request.payer = thirdParty()) });
    await page.goto("/");
    await step(page, "billing");
    const billing = page.getByTestId("lead-request-billing");
    const missing = page.getByTestId("lead-request-missing");
    const toPayer = billing.getByRole("radio", { name: "An die zahlende Person / Organisation" });

    await expect(answers(billing)).toHaveText(["An mich", "An die zahlende Person / Organisation", "An eine andere Adresse"]);
    // Section 8 asks nothing: the payer says how the treatment is paid.
    await expect(page.getByTestId("lead-request-payment-route")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toHaveText(
      "Den Zahlungsweg gibt die zahlende Person / Organisation selbst an; GMED wendet sich dazu an sie.",
    );
    await page.locator('[data-step="send"]').click();
    await expect(missing.getByRole("listitem")).toHaveText([INVOICE_QUESTION]);
    await expect(page.getByTestId("lead-request-summary-billing").locator("dt")).toHaveText(["Zahlungsweg"]);
    await expect(page.getByTestId("lead-request-summary-billing").locator("dd")).toHaveText(["gibt die zahlende Person an"]);

    // To the payer: no e-mail for invoices (the payer's address is on file).
    await step(page, "billing");
    await toPayer.check();
    await expect.poll(() => calls.billing).toEqual([{ invoice_to: "payer" }]);
    await expect(billing.getByRole("textbox", { name: /E-Mail für Rechnungen/ })).toHaveCount(0);
    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary-billing").locator("dd")).toHaveText([
      "An die zahlende Person / Organisation",
      "gibt die zahlende Person an",
    ]);
    await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("05.10.2026");
    expect(calls.submits).toBe(1);

    // "I pay myself": the answer "to the payer" is taken back and the route is asked again, empty.
    await step(page, "payer");
    await choose(page, page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ payer_kind: "self" });
    await step(page, "billing");
    await expect(answers(billing)).toHaveText(["An mich", "An eine andere Adresse"]);
    await expect(billing.getByRole("radio", { name: "An mich", exact: true })).not.toBeChecked();
    const route = page.getByTestId("lead-request-payment-route");
    await expect(route).toBeVisible();
    await expect(route.getByRole("combobox", { name: METHOD_QUESTION })).toContainText("Auswählen");
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toHaveCount(0);
    // Nothing of the two sections was sent by the cabinet for that change.
    expect(calls.billing).toEqual([{ invoice_to: "payer" }]);
    await page.locator('[data-step="send"]').click();
    await expect(missing.getByRole("listitem")).toHaveText([
      INVOICE_QUESTION,
      METHOD_QUESTION,
      "Erfolgt die Zahlung über eine dritte Person oder einen Zahlungsdienstleister?",
    ]);
  });

  test("a parent who pays reads 'to me (I pay)' and answers the payment route with the own name offered", async ({ page }) => {
    const { calls } = await setup(page, {
      minor: true,
      prepare: (request) => {
        // The parent answered "I pay (as a parent)": a third party who is the parent on file.
        request.payer = thirdParty({ first_name: "Maria", last_name: "Muster", date_of_birth: "1985-04-12", citizenships: ["DE"] });
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const billing = page.getByTestId("lead-request-billing");
    const route = page.getByTestId("lead-request-payment-route");

    await expect(answers(billing)).toHaveText([TO_PATIENT, "An mich (ich zahle)", "An eine andere Adresse"]);
    await expect(route).toBeVisible();
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toHaveCount(0);
    await billing.getByRole("radio", { name: "An mich (ich zahle)" }).check();
    await expect.poll(() => calls.billing).toEqual([{ invoice_to: "payer" }]);
    await expect(billing.getByRole("textbox", { name: /E-Mail für Rechnungen/ })).toHaveCount(0);

    // The holder offered is the parent, who pays; the child's name is not.
    await choose(page, route.getByRole("combobox", { name: METHOD_QUESTION }), "Überweisung");
    await expect(route.getByRole("textbox", { name: "Kontoinhaber/in" })).toHaveValue("Maria Muster");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "bank_transfer", account_holder: "Maria Muster" });
    // The name offered once: cleared, it stays empty when the method changes.
    await route.getByRole("textbox", { name: "Kontoinhaber/in" }).fill("");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ account_holder: "" });
    await choose(page, route.getByRole("combobox", { name: METHOD_QUESTION }), "Karte");
    await expect(route.getByRole("textbox", { name: "Kontoinhaber/in" })).toHaveValue("");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "card" });

    await page.locator('[data-step="send"]').click();
    const summary = page.getByTestId("lead-request-summary-billing");
    await expect(summary).toContainText("An mich (ich zahle)");
    await expect(summary).toContainText("Karte");
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("Zahlungsweg: Land des Kontos");
    await expect(missing).toContainText("Zahlungsweg: Kontoinhaber/in");
    await expect(missing).not.toContainText("Name der Bank");
  });

  test("a parent whose other half pays reads the questions about the child and is not asked the payment route", async ({ page }) => {
    const { calls } = await setup(page, {
      minor: true,
      // The other parent pays: a third party who is not the parent with the login.
      prepare: (request) => (request.payer = thirdParty({ first_name: "Ben", last_name: "Muster", citizenships: ["DE"] })),
    });
    await page.goto("/");
    await step(page, "billing");
    const billing = page.getByTestId("lead-request-billing");
    const missing = page.getByTestId("lead-request-missing");

    await expect(answers(billing)).toHaveText([TO_PATIENT, "An die zahlende Person / Organisation", "An eine andere Adresse"]);
    await expect(page.getByTestId("lead-request-payment-route")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toBeVisible();
    await billing.getByRole("radio", { name: TO_PATIENT }).check();
    await expect.poll(() => calls.billing).toEqual([{ invoice_to: "self" }]);
    await expect(billing.getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" })).toBeVisible();

    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    const summary = page.getByTestId("lead-request-summary-billing");
    await expect(summary.locator("dd")).toHaveText([TO_PATIENT, "gibt die zahlende Person an"]);
    await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("05.10.2026");
  });

  test("a refused e-mail is marked, not sent again, and does not hold back the other fields", async ({ page }) => {
    const { calls } = await setup(page, { prepare: (request) => request.billing && (request.billing.invoice_to = "self") });
    await page.goto("/");
    await step(page, "billing");
    const billing = page.getByTestId("lead-request-billing");
    const email = billing.getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" });
    const error = page.locator("#lead-request-invoice_email-error");
    const saveState = page.getByTestId("lead-request-save-state");

    await email.fill("rechnung-at-example.com");
    await expect(error).toHaveText("Bitte prüfen Sie diese Angabe.");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(saveState).toHaveText("Nicht gespeichert");
    expect(calls.billing).toEqual([{ invoice_email: "rechnung-at-example.com" }]);

    // Another field is saved on its own; the refused address stays out and stays marked.
    await choose(page, page.getByTestId("lead-request-payment-route").getByRole("combobox", { name: METHOD_QUESTION }), "Bar");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "cash" });
    await expect(error).toBeVisible();
    await expect(saveState).toHaveText("Nicht gespeichert");
    expect(calls.billing.filter((patch) => "invoice_email" in patch)).toHaveLength(1);

    // A corrected address goes through, and the message goes with the refused value.
    await email.fill("rechnung@example.com");
    await expect(error).toHaveCount(0);
    await expect.poll(() => calls.billing.at(-1)).toEqual({ invoice_email: "rechnung@example.com" });
    await expect(saveState).toHaveText("Gespeichert");
  });

  test("when the payer answers the route meanwhile, the section goes and the request is loaded afresh", async ({ page }) => {
    const { calls } = await setup(page, { prepare: (request) => request.billing && (request.billing.invoice_to = "self") });
    await page.goto("/");
    await step(page, "billing");
    const route = page.getByTestId("lead-request-payment-route");
    const billing = page.getByTestId("lead-request-billing");
    await expect(route).toBeVisible();
    const loadsBefore = calls.loads;

    // Staff declared a third party in the meantime: the server refuses section 8 for the patient.
    calls.payerTookOver = true;
    await choose(page, route.getByRole("combobox", { name: METHOD_QUESTION }), "Überweisung");
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toBeVisible();
    await expect(route).toHaveCount(0);
    // The request was loaded afresh once.
    await expect.poll(() => calls.loads).toBe(loadsBefore + 1);
    expect(calls.billing).toEqual([{ payment_method: "bank_transfer", account_holder: "Anna Muster" }]);
    // The fresh request names the payer: "to the payer" is offered now, and the sections stay usable.
    await expect(billing.getByRole("radio", { name: "An die zahlende Person / Organisation" })).toBeVisible();
    await expect(billing.getByRole("radio", { name: "An mich", exact: true })).toBeChecked();
    await billing.getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" }).fill("rechnung@example.com");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ invoice_email: "rechnung@example.com" });
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
  });

  test("the two sections fit a wide screen and a phone", async ({ page }) => {
    const { calls } = await setup(page, {
      prepare: (request) =>
        Object.assign(request.billing ?? {}, {
          invoice_to: "other",
          invoice_name: "Gemeinnützige-Beispielstiftung-für-internationale-Patientenhilfe e. V.",
          invoice_street: "Musterstraße 2",
          invoice_zip: "10115",
          invoice_city: "Berlin",
          invoice_country: "DE",
          invoice_email: "rechnungsstelle.der.beispielstiftung@example.com",
          payment_method: "crypto",
          via_third_party: true,
          via_third_party_details: "Zahlungsdienstleister-der-Beispielstiftung-für-Patientenhilfe",
        }),
    });
    const billing = page.getByTestId("lead-request-billing");
    const route = page.getByTestId("lead-request-payment-route");

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await step(page, "billing");
      await expect(billing.getByRole("radio", { name: "An eine andere Adresse" })).toBeChecked();
      await expect(page.getByTestId("lead-request-payment-method-note")).toBeVisible();
      await expect(route.getByRole("textbox", { name: "Bitte beschreiben (wer, welcher Dienst)" })).toBeVisible();
      expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(1);
      expect(await widestOverhang(page, "lead-request-step-billing"), `${width}px`).toBeLessThanOrEqual(1);
      // The method list opens inside the screen.
      await route.getByRole("combobox", { name: METHOD_QUESTION }).click();
      const optionEdge = await page.getByRole("option", { name: "Kryptowährung" }).evaluate((node) => node.getBoundingClientRect().right);
      expect(optionEdge, `${width}px`).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("option")).toHaveCount(0);
      await page.locator('[data-step="send"]').click();
      await expect(page.getByTestId("lead-request-summary-billing")).toContainText("Gemeinnützige-Beispielstiftung");
      expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(1);
      expect(await widestOverhang(page, "lead-request-send"), `${width}px`).toBeLessThanOrEqual(1);
    }
    // On a phone the fields are stacked: each is as wide as the section.
    const width = async (locator: Locator) => Math.round((await locator.boundingBox())?.width ?? 0);
    await step(page, "billing");
    const sectionWidth = await width(billing);
    for (const field of ["invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_email", "via_third_party_details"]) {
      expect(await width(page.locator(`#lead-request-${field}`)), field).toBe(sectionWidth);
    }
    expect(calls.billing).toEqual([]);
  });
});

// The self-payer's source of funds is follow-up block A since the trigger flow
// (asked only when the server opens it): see lead-cabinet-follow-up.spec.ts.
