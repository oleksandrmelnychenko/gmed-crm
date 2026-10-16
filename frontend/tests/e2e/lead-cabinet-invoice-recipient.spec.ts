import { expect, test, type Locator, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";
import type { LeadRequestRepresentation } from "../../src/pages/patient-lead/lead-request-api";

// Lead cabinet, step 3 "Versicherung & Rechnung" (owner spec 2026-10-11): the
// invoice recipient comes first and absorbs "who pays". "Wer ist
// Rechnungsempfänger?" (ich / eine andere Person oder Organisation), the third
// party's data, the box "Der Rechnungsempfänger ist auch der Zahler" (ticked by
// default), and only unticked the payer: the patient or another person or
// organisation. Mocked API that behaves like the server
// (`routes/lead_invoice_recipient.rs`), synthetic data.

type Party = {
  representative_id: string | null;
  type: string | null;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  organisation_name: string | null;
  legal_form: string | null;
  contact_name: string | null;
  street: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  phone: string | null;
  relationship_kind: string | null;
  relationship: string | null;
  payment_reason: string | null;
};

type Payer = Record<string, unknown> & { payer_kind: "self" | "third_party" };

const PARTY_KEYS: (keyof Party)[] = [
  "representative_id",
  "type",
  "first_name",
  "last_name",
  "organisation_name",
  "legal_form",
  "contact_name",
  "street",
  "zip",
  "city",
  "country",
  "email",
  "phone",
  "relationship_kind",
  "relationship",
  "payment_reason",
];

function emptyParty(): Party {
  return Object.fromEntries([...PARTY_KEYS, "name"].map((key) => [key, null])) as Party;
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
    acts_on_own_account: null,
    beneficial_owner: null,
    payer_type: null,
    organisation_name: null,
    organisation_legal_form: null,
    organisation_register_number: null,
    organisation_contact_name: null,
    relationship_kind: null,
    contact_consent_at: null,
    cost_estimate_consent_at: null,
  };
}

function leadRequest(minor: boolean) {
  return {
    lead_id: "lead-1",
    access_kind: minor ? "guardian" : "self",
    created_at: "2026-10-11T08:00:00Z",
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
      has_insurance: false,
      insurance_type: "self_pay",
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    } as Record<string, unknown>,
    progress: { filled: 10, total: 12, missing_for_submit: [] as string[] },
    payer: null as Payer | null,
    payer_self_template: minor
      ? { first_name: "Maria", last_name: "Muster", date_of_birth: "1985-04-12", email: "maria.muster@example.com", phone: null }
      : null,
    identification: {
      salutation: null,
      former_names: null,
      birth_place: null,
      birth_country: null,
      habitual_residence_country: null,
      contact_channels: ["email"],
      pep_self: null,
      pep_related: null,
      sanctions_links: null,
      payment_background: null as string | null,
      request_reason: "Zweitmeinung",
      declared_correct_at: null as string | null,
    },
    identity_documents: [
      {
        id: "id-doc-0",
        file_name: "reisepass.jpg",
        size_bytes: 4096,
        mime_type: "image/jpeg",
        uploaded_at: "2026-10-11T09:20:00Z",
        uploaded_by_me: true,
        reviewed: false,
        can_delete: true,
      },
    ],
    representation: (minor
      ? undefined
      : { has_representative: false, under_guardianship: null, custody: null, custody_stated: false, representatives: [] }) as LeadRequestRepresentation | undefined,
    billing: {
      invoice_to: null as string | null,
      invoice_name: null as string | null,
      invoice_street: null as string | null,
      invoice_zip: null as string | null,
      invoice_city: null as string | null,
      invoice_country: null as string | null,
      invoice_email: null as string | null,
      payer_declared: false,
      payment_route_by: "patient" as "patient" | "guardian" | "payer",
      payment_method: null as string | null,
      payment_method_details: null,
      account_country: null,
      account_holder: null,
      bank_name: null,
      via_third_party: null,
      via_third_party_details: null,
      account_holder_suggestion: null as string | null,
      expected_total_eur: null,
      via_third_party_kind: null,
      invoice_recipient: null as string | null,
      invoice_recipient_is_payer: null as boolean | null,
      recipient: emptyParty(),
    },
    follow_up: { required: false, blocks: [] as string[], missing: {}, answered_at: null },
    review_notice: false,
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
        given_at: "2026-10-11T09:15:00Z" as string | null,
      },
    } as Record<string, { type: string; version: string; texts: Record<string, string>; given_at: string | null }>,
    submitted_at: null as string | null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-25T08:00:00Z",
  };
}

type Request = ReturnType<typeof leadRequest>;

const blank = (value: unknown) => value === null || value === undefined || (typeof value === "string" && !value.trim());

function payerName(payer: Payer): string {
  if (payer.payer_type && payer.payer_type !== "person") return String(payer.organisation_name ?? "").trim();
  return [payer.first_name, payer.last_name].filter((part) => !blank(part)).join(" ");
}

function recipientName(party: Party): string {
  if (party.type === "organisation") return party.organisation_name ?? "";
  return [party.first_name, party.last_name].filter((part) => !blank(part)).join(" ");
}

/** The paying parent: the parent's own data of a parent's login. */
function parentPays(request: Request): boolean {
  const payer = request.payer;
  const template = request.payer_self_template;
  return (
    request.access_kind === "guardian" &&
    Boolean(template) &&
    payer?.payer_kind === "third_party" &&
    payer.relationship_kind === "parent" &&
    payer.first_name === template?.first_name &&
    payer.last_name === template?.last_name
  );
}

/** The server's `payer_fits`. */
function payerFits(request: Request): boolean {
  const billing = request.billing;
  const payer = request.payer;
  if (!payer) return false;
  const third = payer.payer_kind === "third_party";
  const answer = billing.invoice_recipient;
  const pays = billing.invoice_recipient_is_payer;
  if (answer === "self" && billing.recipient.representative_id) {
    const parent = request.representation?.representatives.find((person) => person.id === billing.recipient.representative_id);
    const same = third && parent?.email === payer.email;
    return pays === true ? same : pays === false && third && !same;
  }
  if (answer === "self" && pays === true) return !third || parentPays(request);
  if (answer === "self" && pays === false) return third && !parentPays(request);
  if (answer === "third_party" && pays === true) return third && Boolean(billing.recipient.type) && payerName(payer).toLowerCase() === recipientName(billing.recipient).toLowerCase();
  if (answer === "third_party" && pays === false) {
    return !third || payerName(payer).toLowerCase() !== recipientName(billing.recipient).toLowerCase();
  }
  return false;
}

/** Section 7, the payer's state and what is still missing, as the server computes them. */
function recompute(request: Request) {
  const billing = request.billing;
  const payer = request.payer;
  const party = billing.recipient;
  const selectedParent = request.representation?.representatives.find((parent) => parent.id === party.representative_id);
  if (selectedParent) {
    Object.assign(party, { type: "person", first_name: selectedParent.first_name, last_name: selectedParent.last_name,
      street: selectedParent.street, zip: selectedParent.zip, city: selectedParent.city, country: selectedParent.country,
      email: party.email ?? selectedParent.email });
  }
  party.name = billing.invoice_recipient === "third_party" || selectedParent ? recipientName(party) || null : null;
  // Section 7 follows the answers once somebody is named as payer.
  if (payer) {
    const answer = billing.invoice_recipient;
    billing.invoice_to =
      selectedParent ? "other" : answer === "self"
        ? "self"
        : answer === "third_party" && billing.invoice_recipient_is_payer === true && payer.payer_kind === "third_party"
          ? "payer"
          : answer === "third_party" && billing.invoice_recipient_is_payer === false
            ? "other"
            : null;
    billing.invoice_name = billing.invoice_to === "other" ? party.name : null;
  }
  const declared = payer?.payer_kind === "third_party";
  billing.payer_declared = declared;
  billing.payment_route_by = !declared ? "patient" : parentPays(request) ? "guardian" : "payer";
  const missing: string[] = [];
  if (!billing.invoice_recipient) missing.push("invoice_recipient");
  else {
    if (billing.invoice_recipient === "third_party" && billing.invoice_recipient_is_payer !== true) {
      if (!party.type) missing.push("recipient_type");
      else if (party.type === "organisation") {
        if (blank(party.organisation_name)) missing.push("recipient_organisation_name");
      } else {
        if (blank(party.first_name)) missing.push("recipient_first_name");
        if (blank(party.last_name)) missing.push("recipient_last_name");
      }
      for (const key of ["street", "zip", "city", "country"] as const) if (blank(party[key])) missing.push(`recipient_${key}`);
      if (party.type === "organisation" && blank(party.payment_reason)) missing.push("recipient_payment_reason");
      if (party.type === "person" && !party.relationship_kind) missing.push("recipient_relationship_kind");
    }
    if (billing.invoice_recipient_is_payer === null) missing.push("invoice_recipient_is_payer");
  }
  const fits = payerFits(request);
  if (fits && payer) {
    if (payer.payer_kind === "third_party" && !parentPays(request)) {
      const organisation = payer.payer_type !== "person";
      if (organisation) {
        if (blank(payer.organisation_name)) missing.push("payer_organisation_name");
        if (blank(payer.country)) missing.push("payer_country");
      } else {
        if (blank(payer.first_name)) missing.push("payer_first_name");
        if (blank(payer.last_name)) missing.push("payer_last_name");
        if (!Array.isArray(payer.citizenships) || payer.citizenships.length === 0) missing.push("payer_citizenships");
        if (!payer.relationship_kind) missing.push("payer_relationship_kind");
      }
      if (!payer.contact_consent_at) missing.push("payer_contact_consent");
      if (!payer.cost_estimate_consent_at) missing.push("payer_cost_estimate_consent");
      if (organisation && blank(request.identification.payment_background)) missing.push("payer_payment_reason");
    }
    if (billing.payment_route_by !== "payer" && !billing.payment_method) missing.push("payment_method");
  } else if (billing.invoice_recipient && billing.invoice_recipient_is_payer !== null) {
    missing.push("payer_kind");
  }
  request.progress.missing_for_submit = missing;
}

/** Picks an option of one of the cabinet's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function setup(page: Page, options: {
  minor?: boolean;
  prepare?: (request: Request) => void;
  afterBillingWrite?: (request: Request, patch: Record<string, unknown>) => Promise<void> | void;
} = {}) {
  await startClockAt(page);
  const request = leadRequest(options.minor ?? false);
  options.prepare?.(request);
  const calls = {
    billing: [] as Record<string, unknown>[],
    payer: [] as Record<string, unknown>[],
    identification: [] as Record<string, unknown>[],
    costEstimate: [] as Record<string, unknown>[],
    submits: 0,
  };
  const answer = () => {
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
          created_at: "2026-10-11T08:00:00Z",
          preferred_language: "de",
          password_change_required: false,
          portal_mode: "lead",
          lead_portal: { requests: 1 },
        },
      });
    }
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [answer()] } });
    if (path === `${base}/billing` && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.billing.push(patch);
      const billing = request.billing;
      const party = billing.recipient;
      const before = billing.invoice_recipient;
      // Validation is atomic on the server: nothing in a rejected patch is stored.
      for (const [key, value] of Object.entries(patch)) {
        if (key === "recipient_email" && typeof value === "string" && value && !value.includes("@")) {
          return route.fulfill({ status: 422, json: { code: "invalid_field", field: key } });
        }
        if (key === "recipient_phone" && value === "invalid-phone") {
          return route.fulfill({ status: 422, json: { code: "invalid_field", field: key } });
        }
      }
      for (const [key, value] of Object.entries(patch)) {
        if (key === "invoice_recipient") billing.invoice_recipient = (value as string) || null;
        else if (key === "invoice_recipient_is_payer") billing.invoice_recipient_is_payer = value as boolean | null;
        else if (key.startsWith("recipient_")) {
          (party as Record<string, unknown>)[key.slice("recipient_".length)] = value === "" ? null : value;
        } else {
          if (!request.payer) return route.fulfill({ status: 409, json: { code: "payer_not_declared", message: "payer" } });
          (billing as Record<string, unknown>)[key] = value === "" ? null : value;
        }
      }
      // Like the server: a chosen recipient pays unless unticked; what belongs to another answer goes.
      if (!billing.invoice_recipient) billing.invoice_recipient_is_payer = null;
      else if (billing.invoice_recipient_is_payer === null) billing.invoice_recipient_is_payer = true;
      if (billing.invoice_recipient !== before && !("recipient_email" in patch)) party.email = null;
      if (billing.invoice_recipient !== "third_party") {
        for (const key of PARTY_KEYS) if (key !== "email" && key !== "representative_id") party[key] = null;
      }
      if (billing.invoice_recipient !== "self") party.representative_id = null;
      if (party.type === "organisation") {
        party.first_name = null;
        party.last_name = null;
        party.relationship_kind = null;
      } else if (party.type === "person") {
        party.organisation_name = null;
        party.legal_form = null;
        party.contact_name = null;
        party.payment_reason = null;
      }
      if (billing.invoice_recipient_is_payer === true) party.payment_reason = null;
      await options.afterBillingWrite?.(request, patch);
      return route.fulfill({ json: answer() });
    }
    if (path === `${base}/payer` && method === "POST") {
      const input = req.postDataJSON() as Record<string, unknown>;
      calls.payer.push(input);
      const before = request.payer;
      const { contact_consent: consent, ...fields } = input;
      request.payer =
        input.payer_kind === "third_party"
          ? {
              ...selfPayer(),
              ...fields,
              payer_kind: "third_party",
              payer_type: input.payer_type ?? "person",
              contact_consent_at: consent === true ? before?.contact_consent_at ?? "2026-10-11T09:16:00Z" : consent === false ? null : before?.contact_consent_at ?? null,
              cost_estimate_consent_at: before?.cost_estimate_consent_at ?? null,
            }
          : { ...selfPayer() };
      return route.fulfill({ json: answer() });
    }
    if (path === `${base}/payer/cost-estimate-consent` && method === "POST") {
      const input = req.postDataJSON() as Record<string, unknown>;
      calls.costEstimate.push(input);
      if (request.payer) request.payer.cost_estimate_consent_at = input.consent ? "2026-10-11T09:17:00Z" : null;
      return route.fulfill({ json: answer() });
    }
    if (path === `${base}/identification` && method === "POST") {
      const input = req.postDataJSON() as Record<string, unknown>;
      calls.identification.push(input);
      if ("payment_background" in input) request.identification.payment_background = (input.payment_background as string) || null;
      return route.fulfill({ json: answer() });
    }
    if (path === `${base}/submit` && method === "POST") {
      recompute(request);
      if (request.progress.missing_for_submit.length > 0) {
        return route.fulfill({ status: 422, json: { code: "personal_data_incomplete", missing: request.progress.missing_for_submit } });
      }
      calls.submits += 1;
      request.identification.declared_correct_at = "2026-10-11T09:30:00Z";
      request.submitted_at = "2026-10-11T09:30:00Z";
      return route.fulfill({ json: answer() });
    }
    if (path.startsWith(`${base}/`) && method === "POST") return route.fulfill({ json: answer() });
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

const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`).click();
const RECIPIENT = "Wer ist Rechnungsempfänger?";
const IS_PAYER = "Der Rechnungsempfänger ist auch der Zahler";
const WHO_PAYS = "Wer ist der Zahler?";
const PAYER_TYPE = "Zahler ist";
const PATIENT_PAYS = "Zahler ist die Patientin / der Patient";
const OTHER_PAYS = "Zahler ist eine andere Person oder Organisation";
const METHOD = "Welche Zahlungsart für Rechnungen bevorzugen Sie?";

test("Next saves the last billing answer before checking missing fields", async ({ page }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const { calls } = await setup(page, {
    prepare: (request) => {
      request.billing.invoice_recipient = "self";
      request.billing.invoice_recipient_is_payer = true;
      request.payer = selfPayer();
    },
    afterBillingWrite: async (_, patch) => {
      if (patch.payment_method === "bank_transfer") await pending;
    },
  });
  await page.goto("/");
  await step(page, "billing");
  await choose(page, page.getByRole("combobox", { name: METHOD }), "Überweisung");
  await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await expect.poll(() => calls.billing.length).toBe(1);
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "billing");
  release();
  await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "disclosure");
  await step(page, "billing");
  await expect(page.getByRole("combobox", { name: METHOD })).toContainText("Überweisung");
  expect(calls.billing).toEqual([{ payment_method: "bank_transfer" }]);
});

test("two parents: choose the named invoice parent, preserve it on reload and switch the payer deliberately", async ({ page }) => {
  const mother = "11111111-1111-4111-8111-111111111111";
  const father = "22222222-2222-4222-8222-222222222222";
  const { request, calls } = await setup(page, { minor: true, prepare: (request) => {
    request.representation = { document_stage: false, has_representative: null, under_guardianship: null,
      custody: "joint", custody_stated: true, representatives: [mother, father].map((id, index) => ({
        id, slot: index === 0 ? "rep1" : "rep2", role: "legal_representative", relation: "parent",
        mine: index === 0, email_locked: index === 0, can_remove: false,
        first_name: index === 0 ? "Maria" : "Ben", last_name: "Muster", date_of_birth: "1985-04-12",
        birth_place: null, birth_country: null, citizenships: ["DE"],
        street: index === 0 ? "Mutterweg 1" : "Vaterweg 2", zip: "10115", city: "Berlin", country: "DE",
        email: index === 0 ? "maria.muster@example.com" : "ben.muster@example.com", phone: "+4930000000",
        identity_documents: [], authority_documents: [],
      })) };
    request.billing.invoice_recipient = "self";
    request.billing.invoice_recipient_is_payer = true;
  } });
  await page.goto("/");
  await step(page, "billing");
  const parent = page.getByRole("combobox", { name: "Welcher Elternteil erhält die Rechnung?" });
  await expect(parent).toBeVisible();
  expect(calls.payer).toEqual([]);
  await choose(page, parent, "Ben Muster");
  await expect.poll(() => request.billing.recipient.representative_id).toBe(father);
  await expect.poll(() => request.payer?.email).toBe("ben.muster@example.com");
  expect(calls.billing.some((patch) => patch.recipient_representative_id === father)).toBe(true);
  expect(calls.payer.at(-1)).toMatchObject({ first_name: "Ben", last_name: "Muster", street: "Vaterweg 2", relationship_kind: "parent" });
  expect(request.billing.invoice_to).toBe("other");
  expect(request.billing.invoice_name).toBe("Ben Muster");
  await step(page, "send");
  await expect(page.getByTestId("lead-request-summary-billing")).toContainText("Ben Muster");
  await step(page, "billing");
  await page.getByRole("checkbox", { name: IS_PAYER }).uncheck();
  await choose(page, page.getByRole("combobox", { name: PAYER_TYPE }), "Ich (als Elternteil)");
  await expect.poll(() => request.payer?.email).toBe("maria.muster@example.com");
  expect(request.billing.invoice_name).toBe("Ben Muster");
  await page.getByRole("checkbox", { name: IS_PAYER }).check();
  await expect.poll(() => request.payer?.email).toBe("ben.muster@example.com");
  await expect.poll(() => request.billing.invoice_recipient_is_payer).toBe(true);
  await page.reload();
  await step(page, "billing");
  await expect(parent).toContainText("Ben Muster");
  await choose(page, parent, "Maria Muster");
  await expect.poll(() => request.billing.recipient.representative_id).toBe(mother);
  await expect.poll(() => request.payer?.email).toBe("maria.muster@example.com");
  expect(calls.payer.at(-1)).toMatchObject({ first_name: "Maria", street: "Mutterweg 1" });
  await expect(page.getByRole("combobox", { name: METHOD })).toBeVisible();
  await page.locator("#lead-request-recipient_email").fill("invoices@example.com");
  await expect.poll(() => request.billing.recipient.email).toBe("invoices@example.com");
  await expect(page.getByRole("combobox", { name: METHOD })).toBeVisible();
  await step(page, "send");
  await expect(page.getByTestId("lead-request-summary-billing")).toContainText("Maria Muster");
});

test.describe("lead cabinet: step 3, the invoice recipient first", () => {
  test("the steps: who pays is part of step 3, in the owner's words", async ({ page }) => {
    await setup(page);
    await page.goto("/");
    const tabs = page.getByTestId("lead-request-steps").getByRole("tab");
    await expect(tabs).toHaveText([/Einwilligung & Person/, /Ausweis/, /Versicherung & Rechnung/, /Auskunft an Dritte/, /Anliegen & Unterlagen/, /Prüfen & Senden/]);
    await expect(tabs.nth(2)).toHaveAttribute("data-step", "billing");
    await expect(page.locator('[data-step="payer"]')).toHaveCount(0);
    await step(page, "billing");
    const stepBox = page.getByTestId("lead-request-step-billing");
    await expect(stepBox.getByRole("combobox", { name: "Haben Sie eine Krankenversicherung?" })).toBeVisible();
    await expect(stepBox.locator("h3")).toHaveText(["Versicherung", "Rechnungsempfänger"]);
    await expect(stepBox.getByRole("radio")).toHaveCount(2);
    await expect(stepBox.getByText(RECIPIENT)).toBeVisible();
    await expect(stepBox).not.toContainText("Behandlung");
    // Before an answer nobody is asked who pays.
    await expect(stepBox.getByRole("checkbox", { name: IS_PAYER })).toHaveCount(0);
    await expect(stepBox.getByRole("combobox", { name: WHO_PAYS })).toHaveCount(0);
    // The owner's words (2026-10-11), never the old ones.
    await expect(stepBox).not.toContainText("Wohin soll die Rechnung");
    await expect(stepBox).not.toContainText("Wie werden Sie bezahlen");
  });

  test("an adult receives and pays the invoice: the box is ticked and the patient is the payer at once", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto("/");
    await step(page, "billing");
    const stepBox = page.getByTestId("lead-request-step-billing");
    await stepBox.getByRole("radio", { name: "Ich", exact: true }).check();
    // "The recipient is also the payer" is ticked by default and saved as an answer.
    await expect(stepBox.getByRole("checkbox", { name: IS_PAYER })).toBeChecked();
    await expect.poll(() => calls.billing).toEqual([{ invoice_recipient: "self", invoice_recipient_is_payer: true }]);
    await expect.poll(() => calls.payer).toEqual([{ payer_kind: "self" }]);
    // The e-mail for invoices is optional.
    await expect(stepBox.getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" })).toBeVisible();
    // Nobody else is asked about; the bare payment method follows.
    await expect(stepBox.getByRole("combobox", { name: WHO_PAYS })).toHaveCount(0);
    await expect(stepBox.getByTestId("lead-request-payer-party")).toHaveCount(0);
    const methodBox = page.getByTestId("lead-request-payment-method-base");
    await choose(page, methodBox.getByRole("combobox", { name: METHOD }), "Überweisung");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "bank_transfer" });
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
    await page.getByTestId("lead-request-declaration").getByRole("checkbox").check();
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toBeVisible();
    expect(calls.submits).toBe(1);
  });

  test("an organisation receives the invoice and the patient pays it", async ({ page }) => {
    const { calls, request } = await setup(page);
    await page.goto("/");
    await step(page, "billing");
    const stepBox = page.getByTestId("lead-request-step-billing");
    const party = page.getByTestId("lead-request-recipient-party");
    await stepBox.getByRole("radio", { name: "Eine andere Person oder Organisation" }).check();
    // Unticked: the organisation receives the invoice without paying it.
    const isPayer = stepBox.getByRole("checkbox", { name: IS_PAYER });
    await expect(isPayer).toBeChecked();
    await isPayer.uncheck();
    await expect.poll(() => request.billing.invoice_recipient_is_payer).toBe(false);
    const type = party.getByRole("combobox", { name: "Rechnungsempfänger ist" });
    await type.click();
    // Insurance is no answer of the cabinet.
    await expect(page.getByRole("option")).toHaveText(["Auswählen", "Eine Privatperson", "Eine Organisation"]);
    await page.getByRole("option", { name: "Eine Organisation", exact: true }).click();
    await party.getByRole("textbox", { name: "Name der Organisation" }).fill("Beispiel GmbH");
    await party.getByRole("textbox", { name: "Rechtsform" }).fill("GmbH");
    await party.getByRole("textbox", { name: "Ansprechperson" }).fill("Ben Muster");
    await party.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Hauptstraße 1");
    await party.getByRole("textbox", { name: "Postleitzahl" }).fill("10115");
    await party.getByRole("textbox", { name: "Ort" }).fill("Berlin");
    await choose(page, party.getByRole("combobox", { name: "Land" }), "Deutschland");
    await party.getByRole("textbox", { name: "Warum erfolgt die Zahlung über die Organisation?" }).fill("Der Arbeitgeber erhält die Rechnung.");
    await expect
      .poll(() => Object.assign({}, ...calls.billing))
      .toMatchObject({
        invoice_recipient: "third_party",
        recipient_type: "organisation",
        recipient_organisation_name: "Beispiel GmbH",
        recipient_legal_form: "GmbH",
        recipient_contact_name: "Ben Muster",
        recipient_street: "Hauptstraße 1",
        recipient_zip: "10115",
        recipient_city: "Berlin",
        recipient_country: "DE",
        recipient_payment_reason: "Der Arbeitgeber erhält die Rechnung.",
      });
    // Who pays: the patient, or another person or organisation.
    const parties = stepBox.getByTestId("lead-request-payer-party").getByRole("radio");
    await expect(parties).toHaveCount(2);
    await expect(stepBox.getByTestId("lead-request-payer-party")).toContainText(PATIENT_PAYS);
    await expect(stepBox.getByTestId("lead-request-payer-party")).toContainText(OTHER_PAYS);
    // "Another person or organisation" asks what the payer is, an insurer is no answer.
    await stepBox.getByRole("radio", { name: OTHER_PAYS }).check();
    await stepBox.getByRole("combobox", { name: PAYER_TYPE }).click();
    await expect(page.getByRole("option")).toHaveText(["Auswählen", "Eine Privatperson", "Eine Organisation"]);
    await page.keyboard.press("Escape");
    await stepBox.getByRole("radio", { name: PATIENT_PAYS }).check();
    await expect(stepBox.getByRole("combobox", { name: PAYER_TYPE })).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await expect.poll(() => request.billing.invoice_to).toBe("other");
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-missing")).toContainText(METHOD);
    const summary = page.getByTestId("lead-request-summary-billing");
    await expect(summary).toContainText("Eine andere Person oder Organisation");
    await expect(summary).toContainText("Beispiel GmbH");
    await expect(summary).toContainText("Der Arbeitgeber erhält die Rechnung.");
  });

  test("a person who receives and pays the invoice is the payer: citizenships and the consents follow", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto("/");
    await step(page, "billing");
    const stepBox = page.getByTestId("lead-request-step-billing");
    const party = page.getByTestId("lead-request-recipient-party");
    await stepBox.getByRole("radio", { name: "Eine andere Person oder Organisation" }).check();
    await choose(page, party.getByRole("combobox", { name: "Rechnungsempfänger ist" }), "Eine Privatperson");
    await party.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await party.getByRole("textbox", { name: "Nachname" }).fill("Zahler");
    await choose(page, party.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" }), "Freund/in");
    await party.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Ring 1");
    await party.getByRole("textbox", { name: "Postleitzahl" }).fill("1010");
    await party.getByRole("textbox", { name: "Ort" }).fill("Wien");
    await choose(page, party.getByRole("combobox", { name: "Land" }), "Österreich");
    await party.getByRole("textbox", { name: "E-Mail" }).fill("viktor.zahler@example.com");
    await party.getByRole("textbox", { name: "Telefon" }).fill("+43 1 234567");
    // Ticked by default: the payer is the recipient, saved with its data, nothing typed twice.
    await expect(stepBox.getByRole("checkbox", { name: IS_PAYER })).toBeChecked();
    await expect
      .poll(() => calls.payer.at(-1))
      .toMatchObject({
        payer_kind: "third_party",
        payer_type: "person",
        first_name: "Viktor",
        last_name: "Zahler",
        relationship_kind: "friend",
        street: "Ring 1",
        city: "Wien",
        country: "AT",
        email: "viktor.zahler@example.com",
        phone: "+43 1 234567",
      });
    await expect(stepBox.getByRole("combobox", { name: WHO_PAYS })).toHaveCount(0);
    const extras = page.getByTestId("lead-request-recipient-payer");
    await page.locator("#lead-request-payer_citizenships").click();
    await page.getByRole("option", { name: "Österreich" }).first().click();
    await page.keyboard.press("Escape");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ citizenships: ["AT"] });
    await extras.locator("#lead-request-payer_contact_consent").check();
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ contact_consent: true });
    const costConsent = page.getByTestId("lead-request-payer-cost-estimate-consent");
    await expect(costConsent).not.toContainText("Behandlung");
    await costConsent.getByRole("checkbox").check();
    await expect.poll(() => calls.costEstimate).toEqual([{ consent: true }]);
  });

  test("a parent receives and pays: the parent's own data name the payer", async ({ page }) => {
    const { calls } = await setup(page, { minor: true });
    await page.goto("/");
    await step(page, "billing");
    const stepBox = page.getByTestId("lead-request-step-billing");
    await expect(stepBox.getByRole("combobox", { name: "Hat die Patientin / der Patient eine Krankenversicherung?" })).toBeVisible();
    await stepBox.getByRole("radio", { name: "Ich (als Elternteil / gesetzliche Vertretung)" }).check();
    await expect(stepBox.getByRole("checkbox", { name: IS_PAYER })).toBeChecked();
    await expect
      .poll(() => calls.payer.at(-1))
      .toMatchObject({ payer_kind: "third_party", payer_type: "person", first_name: "Maria", last_name: "Muster", relationship_kind: "parent" });
    // Unticked with the patient side as recipient: only another person or organisation, at once.
    await stepBox.getByRole("checkbox", { name: IS_PAYER }).uncheck();
    await expect(stepBox.getByTestId("lead-request-payer-party")).toHaveCount(0);
    await expect(stepBox.getByTestId("lead-request-payer-party-other")).toHaveText(OTHER_PAYS);
    await stepBox.getByRole("combobox", { name: PAYER_TYPE }).click();
    await expect(page.getByRole("option")).toHaveText(["Auswählen", "Eine Privatperson", "Eine Organisation"]);
    await page.keyboard.press("Escape");
  });

  test("a parent names a third party as recipient and pays: 'I pay (as a parent)'", async ({ page }) => {
    const { calls, request } = await setup(page, { minor: true });
    await page.goto("/");
    await step(page, "billing");
    const stepBox = page.getByTestId("lead-request-step-billing");
    const party = page.getByTestId("lead-request-recipient-party");
    await stepBox.getByRole("radio", { name: "Eine andere Person oder Organisation" }).check();
    await stepBox.getByRole("checkbox", { name: IS_PAYER }).uncheck();
    await expect.poll(() => request.billing.invoice_recipient_is_payer).toBe(false);
    await choose(page, party.getByRole("combobox", { name: "Rechnungsempfänger ist" }), "Eine Privatperson");
    await party.getByRole("textbox", { name: "Vorname" }).fill("Ben");
    await party.getByRole("textbox", { name: "Nachname" }).fill("Muster");
    // A parent's login reads the patient's answer as the parent who pays.
    const parties = stepBox.getByTestId("lead-request-payer-party");
    await expect(parties.getByRole("radio")).toHaveCount(2);
    await expect(parties).not.toContainText(PATIENT_PAYS);
    await parties.getByRole("radio", { name: "Zahler bin ich (als Elternteil)" }).check();
    await expect
      .poll(() => calls.payer.at(-1))
      .toMatchObject({ payer_kind: "third_party", payer_type: "person", first_name: "Maria", last_name: "Muster", relationship_kind: "parent" });
    await expect(stepBox.getByRole("combobox", { name: PAYER_TYPE })).toHaveCount(0);
    // Back to "another person or organisation": the payer form starts empty.
    await parties.getByRole("radio", { name: OTHER_PAYS }).check();
    await expect(stepBox.getByRole("combobox", { name: PAYER_TYPE })).toBeVisible();
  });

  test("a refused e-mail of the recipient is marked and not sent again", async ({ page }) => {
    const { calls } = await setup(page, {
      prepare: (request) => {
        request.billing.invoice_recipient = "self";
        request.billing.invoice_recipient_is_payer = true;
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const email = page.getByTestId("lead-request-step-billing").getByRole("textbox", { name: "E-Mail für Rechnungen (optional)" });
    await email.fill("rechnung-at-example.com");
    await expect(page.locator("#lead-request-recipient_email-error")).toHaveText("Bitte prüfen Sie diese Angabe.");
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Nicht gespeichert");
    await email.fill("rechnung@example.com");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ recipient_email: "rechnung@example.com" });
    await expect(page.locator("#lead-request-recipient_email-error")).toHaveCount(0);
  });

  test("recipient recheck: invalid fields do not discard other changes or hide each other's errors", async ({ page }) => {
    const { request } = await setup(page, { prepare: (request) => {
      request.billing.invoice_recipient = "third_party";
      request.billing.invoice_recipient_is_payer = false;
      request.billing.recipient = { ...emptyParty(), type: "person", first_name: "Eva", last_name: "Muster" };
      request.payer = selfPayer();
    } });
    await page.goto("/");
    await step(page, "billing");
    await page.locator("#lead-request-recipient_email").fill("invalid-email");
    await page.locator("#lead-request-recipient_phone").fill("invalid-phone");
    await page.locator("#lead-request-recipient_city").fill("Hamburg");
    await expect.poll(() => request.billing.recipient.city).toBe("Hamburg");
    await expect(page.locator("#lead-request-recipient_email-error")).toBeVisible();
    await expect(page.locator("#lead-request-recipient_phone-error")).toBeVisible();
    await page.locator("#lead-request-recipient_email").fill("eva@example.com");
    await expect.poll(() => request.billing.recipient.email).toBe("eva@example.com");
    await expect(page.locator("#lead-request-recipient_email-error")).toHaveCount(0);
    await expect(page.locator("#lead-request-recipient_phone-error")).toBeVisible();
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Nicht gespeichert");
    await page.locator("#lead-request-recipient_phone").fill("+49123456789");
    await expect.poll(() => request.billing.recipient.phone).toBe("+49123456789");
    await expect(page.locator("#lead-request-recipient_phone-error")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
  });

  test("recipient recheck: a queued edit keeps the server's corrected untouched fields", async ({ page }) => {
    let release = () => {};
    const response = new Promise<void>((resolve) => { release = resolve; });
    const { request, calls } = await setup(page, {
      prepare: (request) => {
        request.billing.invoice_recipient = "third_party";
        request.billing.invoice_recipient_is_payer = false;
        request.billing.recipient = { ...emptyParty(), type: "person", first_name: "Eva", last_name: "Muster", city: "Berlin" };
        request.payer = selfPayer();
      },
      afterBillingWrite: async (request, patch) => {
        if (patch.recipient_email === "eva@example.com") {
          request.billing.recipient.city = "Hamburg";
          await response;
        }
      },
    });
    await page.goto("/");
    await step(page, "billing");
    await page.locator("#lead-request-recipient_email").fill("eva@example.com");
    await expect.poll(() => calls.billing.length).toBe(1);
    await page.locator("#lead-request-recipient_phone").fill("+49123456789");
    // Leaving the step queues the latest draft while the first response is pending.
    await step(page, "person");
    release();
    await expect.poll(() => request.billing.recipient.phone).toBe("+49123456789");
    expect(calls.billing[1]).toEqual({ recipient_phone: "+49123456789" });
    expect(request.billing.recipient.city).toBe("Hamburg");
    await step(page, "billing");
    await expect(page.locator("#lead-request-recipient_city")).toHaveValue("Hamburg");
  });

  test("billing recheck: a queued payment edit keeps the server's corrected account holder", async ({ page }) => {
    let release = () => {};
    const response = new Promise<void>((resolve) => { release = resolve; });
    const { request, calls } = await setup(page, {
      prepare: (request) => {
        request.billing.invoice_recipient = "self";
        request.billing.invoice_recipient_is_payer = true;
        request.payer = selfPayer();
        Object.assign(request.billing, { payment_method: "bank_transfer", account_holder: "Anna Muster", bank_name: "Old bank", via_third_party: true });
        request.submitted_at = "2026-10-11T12:00:00Z";
        request.follow_up = { required: true, blocks: ["C"], missing: {}, answered_at: null };
      },
      afterBillingWrite: async (request, patch) => {
        if (patch.bank_name === "New bank") {
          Object.assign(request.billing, { account_holder: "Anna Maria Muster" });
          await response;
        }
      },
    });
    await page.goto("/");
    await step(page, "follow_up");
    await page.locator("#lead-request-bank_name").fill("New bank");
    await expect.poll(() => calls.billing.length).toBe(1);
    await page.locator("#lead-request-via_third_party_details").fill("Mein Bruder");
    await step(page, "person");
    release();
    await expect.poll(() => (request.billing as Record<string, unknown>).via_third_party_details).toBe("Mein Bruder");
    expect(calls.billing[1]).toEqual({ via_third_party_details: "Mein Bruder" });
    expect(request.billing.account_holder).toBe("Anna Maria Muster");
    await step(page, "follow_up");
    await expect(page.locator("#lead-request-account_holder")).toHaveValue("Anna Maria Muster");
  });

  test("the step fits a phone", async ({ page }) => {
    await setup(page, {
      prepare: (request) => {
        request.billing.invoice_recipient = "third_party";
        request.billing.invoice_recipient_is_payer = false;
        Object.assign(request.billing.recipient, {
          type: "organisation",
          organisation_name: "Gemeinnützige-Beispielstiftung-für-internationale-Patientenhilfe e. V.",
          street: "Musterstraße 2",
          zip: "10115",
          city: "Berlin",
          country: "DE",
          payment_reason: "Die Stiftung erhält die Rechnung.",
        });
      },
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/");
    await step(page, "billing");
    await expect(page.getByTestId("lead-request-recipient-party")).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });

  for (const recipientPays of [true, false]) {
    test(`recipient recheck: country follows the answered-payer lock (recipient pays: ${recipientPays})`, async ({ page }) => {
      const { calls } = await setup(page, { prepare: (request) => {
        request.billing.invoice_recipient = "third_party";
        request.billing.invoice_recipient_is_payer = recipientPays;
        request.billing.recipient = { ...emptyParty(), type: "person", first_name: "Eva", last_name: "Muster", country: "DE" };
        request.payer = { ...selfPayer(), payer_kind: "third_party", payer_type: "person", first_name: "Eva", last_name: "Muster", country: "DE", answered_by_payer: true };
      } });
      await page.goto("/");
      await step(page, "billing");
      const country = page.getByTestId("lead-request-recipient-party").getByRole("combobox", { name: "Land", exact: true });
      if (recipientPays) {
        await expect(country).toBeDisabled();
        await expect(page.locator("#lead-request-recipient_first_name")).toBeDisabled();
        expect(calls.billing).toEqual([]);
      } else {
        await expect(country).toBeEnabled();
        await choose(page, country, "Österreich");
        await expect.poll(() => calls.billing.at(-1)).toEqual({ recipient_country: "AT" });
      }
    });
  }
});


test("changing the default checked recipient cannot replace an existing payer until complete and confirmed", async ({ page }) => {
  const { request, calls } = await setup(page, { prepare: (request) => {
    request.payer = { ...selfPayer(), payer_kind: "third_party", payer_type: "person", first_name: "Old", last_name: "Payer", date_of_birth: "1960-01-01", citizenships: ["DE"], contact_consent_at: "2026-10-11T09:00:00Z", cost_estimate_consent_at: "2026-10-11T09:00:00Z" };
  } });
  await page.goto("/");
  await step(page, "billing");
  const box = page.getByTestId("lead-request-step-billing");
  await box.getByRole("radio", { name: "Eine andere Person oder Organisation" }).check();
  const party = page.getByTestId("lead-request-recipient-party");
  await choose(page, party.getByRole("combobox", { name: "Rechnungsempfänger ist" }), "Eine Privatperson");
  await party.getByRole("textbox", { name: "Vorname" }).fill("A");
  await expect.poll(() => request.billing.recipient.first_name).toBe("A");
  expect(calls.payer).toEqual([]);
  const replacement = page.getByTestId("lead-request-payer-replacement");
  await expect(replacement.getByRole("button")).toBeDisabled();
  const extras = page.getByTestId("lead-request-recipient-payer");
  await expect(extras.locator("#lead-request-payer_contact_consent")).not.toBeChecked();
  await expect(page.getByTestId("lead-request-payer-cost-estimate-consent")).toHaveCount(0);
  await party.getByRole("textbox", { name: "Vorname" }).fill("Another");
  await party.getByRole("textbox", { name: "Nachname" }).fill("Recipient");
  await choose(page, party.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" }), "Freund/in");
  await party.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Testweg 1");
  await party.getByRole("textbox", { name: "Postleitzahl" }).fill("10115");
  await party.getByRole("textbox", { name: "Ort" }).fill("Berlin");
  await choose(page, party.getByRole("combobox", { name: "Land" }), "Deutschland");
  await party.getByRole("textbox", { name: "E-Mail" }).fill("another@example.com");
  await party.getByRole("textbox", { name: "Telefon" }).fill("+4915100000000");
  await expect.poll(() => request.billing.recipient.phone).toBe("+4915100000000");
  expect(calls.payer).toEqual([]);
  await expect(replacement.getByRole("button")).toBeEnabled();
  await replacement.getByRole("button").click();
  await expect.poll(() => calls.payer.at(-1)).toMatchObject({ first_name: "Another", last_name: "Recipient", contact_consent: false });
  expect(calls.payer.at(-1)).not.toHaveProperty("date_of_birth");
  expect(calls.payer.at(-1)).not.toHaveProperty("citizenships");
});

test("guardian does not overwrite a stored self payer simply by opening billing", async ({ page }) => {
  const { calls } = await setup(page, { minor: true, prepare: (request) => {
    request.payer = selfPayer();
    request.billing.invoice_recipient = "self";
    request.billing.invoice_recipient_is_payer = true;
    request.billing.payment_method = "bank_transfer";
  } });
  await page.goto("/");
  await step(page, "billing");
  const payer = page.getByTestId("lead-request-payer");
  await expect(payer).toBeVisible();
  expect(calls.payer).toEqual([]);
  const select = payer.getByRole("combobox").first();
  await select.click();
  await page.getByRole("option", { name: /als Elternteil/ }).click();
  await expect.poll(() => calls.payer.at(-1)).toMatchObject({ first_name: "Maria", last_name: "Muster", relationship_kind: "parent" });
});
