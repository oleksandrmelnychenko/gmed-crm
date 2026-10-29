import { expect, test, type Locator, type Page } from "@playwright/test";
import { E2E_NOW, startClockAt } from "./helpers";

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
    // A parent's own data for "I pay (as a parent)"; null without a linked trusted
    // contact. A server that does not know the payer type yet does not send the key.
    payer_self_template: null as Record<string, unknown> | null | undefined,
    // The lead's own statements for the GwG identification: always an object.
    // Since the trigger flow the identity document's data are staff's (no `id_*`),
    // the legal questions are yes/no only, and the follow-up blocks' keys are here.
    identification: {
      salutation: null,
      former_names: null,
      birth_place: null,
      birth_country: null,
      habitual_residence_country: null,
      contact_channels: [] as string[],
      pep_self: null,
      pep_related: null,
      sanctions_links: null,
      payment_background: null,
      relationship_since: null,
      residence_since: null,
      other_residences: null,
      former_citizenships: [] as string[],
      stay_reason: null,
      stay_reason_details: null,
      pep_office: null,
      pep_country: null,
      pep_period: null,
      pep_relationship: null,
      pep_wealth_origin: null,
      sanctions_link_name: null,
      sanctions_link_kind: null,
      sanctions_link_since_extent: null,
      request_reason: null,
      declared_correct_at: null,
    } as Record<string, unknown>,
    // Copies of the identity document; never among `documents` (medical).
    identity_documents: [] as Record<string, unknown>[],
    // Who acts for the lead: an adult answers two questions. A server that
    // does not know the block yet does not send the key. The persons and the
    // minor's block have a spec of their own (lead-cabinet-representation).
    representation: {
      has_representative: null,
      under_guardianship: null,
      custody: null,
      custody_stated: false,
      representatives: [],
    } as Record<string, unknown> | undefined,
    // Invoice recipient and payment route (contract phase 2): always an
    // object; `payer_declared`, `payment_route_by` and the suggestion are
    // recomputed from "who pays". A server that does not know the two
    // sections does not send the key. The sections have a spec of their own
    // (lead-cabinet-billing).
    billing: {
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
      account_holder_suggestion: "Anna Muster",
      via_third_party_kind: null,
      expected_total_eur: null,
    } as Record<string, unknown> | undefined,
    // The follow-up blocks (trigger flow): none open before the request is sent.
    // A server that does not know them does not send the key.
    follow_up: { required: false, blocks: [] as string[], missing: {}, answered_at: null } as Record<string, unknown> | undefined,
    review_notice: false,
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
          uk: "Я погоджуюся, що мої дані обробляються для розгляду мого звернення.",
          en: "I agree that my details are processed to handle my request.",
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

/** Opens a step of the cabinet by its tab. */
const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`).click();

// The owner's questions of 2026-10-11: who acts (the court appointment only after "yes"), who pays
// (part of step 3) and the insurance.
const ACTS = "Handelt jemand in Ihrem Namen?";
const APPOINTED = "Ist diese Person vom Gericht bestellt (rechtliche Betreuerin / rechtlicher Betreuer)?";
const WHO_PAYS = "Wer ist der Zahler?";
const HAS_INSURANCE = "Haben Sie eine Krankenversicherung?";

// The keys of the two billing sections the cabinet writes (contract phase 2, 3.2).
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

/** What tells one payer from another: a change clears section 8 (contract D5). */
function payerKey(payer: Record<string, unknown> | null) {
  return payer
    ? JSON.stringify([payer.payer_kind, payer.payer_type ?? null, payer.organisation_name ?? null, payer.first_name ?? null, payer.last_name ?? null, payer.date_of_birth ?? null])
    : null;
}

/** Like the server: what does not belong to the chosen answers goes. */
function clearBillingDependents(billing: Record<string, unknown>) {
  if (billing.invoice_to !== "other") {
    for (const key of ["invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country"]) billing[key] = null;
  }
  if (billing.invoice_to === "payer") billing.invoice_email = null;
  if (billing.payment_method !== "other") billing.payment_method_details = null;
  if (billing.payment_method !== "bank_transfer" && billing.payment_method !== "card") {
    for (const key of ["account_country", "account_holder", "bank_name"]) billing[key] = null;
  }
  if (billing.via_third_party !== true) billing.via_third_party_details = null;
}

/** Another payer: section 8 is that payer's answer and goes; "to the payer" goes with the third party. */
function billingAfterPayerChange(
  billing: Record<string, unknown>,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
) {
  if (payerKey(before) !== payerKey(after)) {
    for (const key of PAYMENT_ROUTE_KEYS) billing[key] = null;
  }
  if (after?.payer_kind !== "third_party" && billing.invoice_to === "payer") billing.invoice_to = null;
}

/** The keys of the two sections the request cannot be sent without (contract 3.3), in the server's order. */
function billingMissing(billing: Record<string, unknown>): string[] {
  const missing: string[] = [];
  if (!billing.invoice_to) missing.push("invoice_to");
  if (billing.invoice_to === "other") {
    for (const key of ["invoice_name", "invoice_street", "invoice_zip", "invoice_city", "invoice_country"]) {
      if (!billing[key]) missing.push(key);
    }
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
    else if (billing.via_third_party === true && !billing.via_third_party_details) missing.push("via_third_party_details");
  }
  return missing;
}

function recompute(request: ReturnType<typeof leadRequest>) {
  const data = request.personal_data;
  const filled = (field: string) => {
    const value = data[field];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  };
  // Like the server: the answer, and for a third party who that is — a person
  // with name and citizenships, or a company, organisation or insurer with its
  // name and the country of its seat — the relationship to the patient and the
  // consent to contact the payer. An older server knows only the person.
  const payer = request.payer;
  const typed = payer != null && "payer_type" in payer;
  const organisation = typed && payer.payer_type !== "person";
  // A parent who pays for the child in the own login: that parent is the payer.
  const template = request.payer_self_template;
  const parentPays =
    payer?.payer_kind === "third_party" &&
    request.access_kind === "guardian" &&
    Boolean(template) &&
    payer?.relationship_kind === "parent" &&
    payer?.first_name === template?.first_name &&
    payer?.last_name === template?.last_name;
  // The organisation mask, from a server that knows it (trigger flow).
  const mask = organisation && "organisation_legal_form" in payer;
  const payerMissing = !payer
    ? ["payer_kind"]
    : payer.payer_kind === "third_party"
      ? [
          ...(organisation
            ? [
                ...(payer.organisation_name ? [] : ["payer_organisation_name"]),
                ...(mask && !payer.organisation_legal_form ? ["payer_legal_form"] : []),
                ...(mask && !payer.organisation_contact_name ? ["payer_contact_name"] : []),
                // The e-mail is required (its own link goes there, QA 2026-10-11 A-35); the phone is not.
                ...(mask && !payer.email ? ["payer_email"] : []),
                ...(payer.country ? [] : ["payer_country"]),
              ]
            : [
                ...(payer.first_name ? [] : ["payer_first_name"]),
                ...(payer.last_name ? [] : ["payer_last_name"]),
                ...(Array.isArray(payer.citizenships) && payer.citizenships.length > 0 ? [] : ["payer_citizenships"]),
              ]),
          ...(typed
            ? [
                // An organisation says why the payment goes through it instead of a relationship (owner 2026-10-11).
                ...(organisation
                  ? request.identification && !(request.identification as Record<string, unknown>).payment_background
                    ? ["payer_payment_reason"]
                    : []
                  : [
                      ...(payer.relationship_kind ? [] : ["payer_relationship_kind"]),
                      ...(payer.relationship_kind === "other" && !payer.relationship ? ["payer_relationship"] : []),
                    ]),
                // Nobody agrees to be contacted oneself: a paying parent is not asked (BE5).
                ...(payer.contact_consent_at || parentPays ? [] : ["payer_contact_consent"]),
                // The consent to pass the cost estimate on (phase 3b, 11.2), from a server that knows it.
                ...("cost_estimate_consent_at" in payer && !payer.cost_estimate_consent_at && !parentPays
                  ? ["payer_cost_estimate_consent"]
                  : []),
              ]
            : []),
        ]
      : [];
  const missing = [...SUBMIT_FIELDS.filter((field) => !filled(field)), ...payerMissing];
  // A server that knows the GwG statements (contract phase 1a) also needs them.
  const identification = request.identification as Record<string, unknown> | undefined;
  // Since 2026-10-09 the birth data (block K), the legal questions and the own economic interest
  // (block L) are asked only with the enhanced check: the base form does not need them.
  if (identification) {
    if (request.identity_documents.length === 0) missing.push("id_document_upload");
    // The reason of the request (13.1) is optional since 2026-10-19 (owner).
  }
  // A server that knows the representation (contract phase 1b-2) needs the adult's answer; whether the
  // person who acts is court-appointed is asked only after "yes" (owner 2026-10-11).
  const representation = request.representation;
  if (representation) {
    if (representation.has_representative == null) missing.push("has_representative");
    if (representation.has_representative === true && representation.under_guardianship == null) missing.push("under_guardianship");
  }
  // A server that knows invoice and payment (contract phase 2): who answers
  // the payment route follows "who pays" — the patient, the paying parent
  // whose login this is, or the payer, who is not asked here.
  const billing = request.billing;
  if (billing) {
    const thirdParty = payer?.payer_kind === "third_party";
    billing.payer_declared = thirdParty;
    billing.payment_route_by = !thirdParty ? "patient" : parentPays ? "guardian" : "payer";
    billing.account_holder_suggestion =
      billing.payment_route_by === "payer"
        ? null
        : billing.payment_route_by === "guardian"
          ? [template?.first_name, template?.last_name].filter(Boolean).join(" ")
          : [data.first_name, data.last_name].filter(Boolean).join(" ");
    // Since the trigger flow the payment route is follow-up block C: the base
    // form asks only the invoice recipient. An older server still asks both.
    const asked = request.follow_up ? billingMissing({ ...billing, payment_route_by: "payer" }) : billingMissing(billing);
    missing.push(...asked);
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
    pep_self: false,
    pep_related: true,
    sanctions_links: false,
    request_reason: "Zweitmeinung zur Knie-OP",
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
    payer_type: null,
    organisation_name: null,
    relationship_kind: null,
    contact_consent_at: null,
  };
  // Nobody acts for the patient (the court appointment is asked only after "yes", owner 2026-10-11).
  if (request.representation) Object.assign(request.representation, { has_representative: false, under_guardianship: null });
  // The invoice goes to the patient, paid by bank transfer from the own account.
  if (request.billing) {
    Object.assign(request.billing, {
      invoice_to: "self",
      payment_method: "bank_transfer",
      account_country: "DE",
      account_holder: "Anna Muster",
      bank_name: "Musterbank",
      via_third_party: false,
    });
  }
  request.consents.lead_inquiry_processing.given_at = "2026-10-03T09:15:00Z";
}

/** A complete request whose payer is another person; `payer` changes what is stored about that payer. */
function completeRequestWithPayer(request: ReturnType<typeof leadRequest>, payer: Record<string, unknown> = {}) {
  completeRequest(request);
  request.payer = {
    ...request.payer,
    payer_kind: "third_party",
    payer_type: "person",
    first_name: "Viktor",
    last_name: "Zahler",
    citizenships: ["UA"],
    city: "Berlin",
    country: "DE",
    relationship_kind: "parent",
    contact_consent_at: "2026-10-03T09:16:00Z",
    ...payer,
  };
}

/**
 * A complete, sent request with follow-up blocks the server opened. Since 2026-10-09 the birth data
 * (block K), the legal questions and the own economic interest (block L) are asked only there.
 */
function sentWithBlocks(blocks: string[], missing: Record<string, string[]> = {}) {
  return (request: ReturnType<typeof leadRequest>) => {
    completeRequest(request);
    request.submitted_at = "2026-10-03T09:30:00Z";
    request.follow_up = { required: true, blocks, missing, answered_at: null };
  };
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
    /** The own login of a minor whose parents have access: no request, `own_access_closed` (A3-01). */
    ownAccessClosed?: boolean;
  } = {},
) {
  await startClockAt(page);
  const request = leadRequest();
  request.personal_data.primary_language = options.primaryLanguage ?? null;
  options.prepare?.(request);
  recompute(request);
  // The language saved on the account; a new lead login has none.
  const accountLanguage = options.accountLanguage === undefined ? "de" : options.accountLanguage;
  const calls = {
    personalData: [] as Record<string, unknown>[],
    payer: [] as Record<string, unknown>[],
    /** Bodies of POST …/payer/cost-estimate-consent (phase 3b, 11.2). */
    costEstimateConsent: [] as Record<string, unknown>[],
    identification: [] as Record<string, unknown>[],
    representation: [] as Record<string, unknown>[],
    billing: [] as Record<string, unknown>[],
    consents: [] as string[],
    /** Bodies of POST …/consent-choices (the consent form options, 2026-10-12). */
    consentChoices: [] as Record<string, unknown>[],
    uploads: 0,
    identityUploads: 0,
    submits: 0,
    submitBodies: [] as unknown[],
    blocked: [] as string[],
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
    if (path === "/me/lead-requests") {
      return route.fulfill({
        json: options.ownAccessClosed ? { requests: [], own_access_closed: true } : { requests: [request] },
      });
    }
    if (path === "/me/lead-requests/lead-1" && method === "GET") {
      return route.fulfill({ json: request });
    }
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
      // The payer answered on the own link: only GMED changes the payer now, nothing is saved.
      if (request.payer?.answered_by_payer === true) {
        return route.fulfill({ status: 409, json: { code: "payer_answered_by_payer", message: "The payer answered" } });
      }
      // Like the older server: a key it does not know is refused.
      if (
        request.payer_self_template === undefined &&
        ["payer_type", "organisation_name", "relationship_kind", "contact_consent"].some((key) => key in input)
      ) {
        return route.fulfill({ status: 422, json: { error: "Unprocessable", message: "Unknown field" } });
      }
      // The own economic interest: left out, the stored answer stays; the
      // named person is kept for a "no" only.
      const ownAccount = "acts_on_own_account" in input ? input.acts_on_own_account : request.payer?.acts_on_own_account ?? null;
      // The answer replaces the block: what is not sent is empty.
      const { contact_consent: consent, ...answer } = input;
      const stored: Record<string, unknown> = {
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
        ...answer,
        acts_on_own_account: ownAccount,
        beneficial_owner: ownAccount === false ? input.beneficial_owner || null : null,
      };
      if (request.payer_self_template !== undefined) {
        // A server that knows the payer type: a third party without one is a
        // person; an organisation has a name and no data of a natural person;
        // the relationship in words belongs to "other" (or to an older client
        // that sends no kind); the consent is recorded with `true`, removed
        // with `false` and kept when the key is left out.
        const thirdParty = input.payer_kind === "third_party";
        const type = thirdParty ? (input.payer_type ?? "person") : null;
        const kind = thirdParty ? (input.relationship_kind ?? null) : null;
        const consentBefore = thirdParty ? (request.payer?.contact_consent_at ?? null) : null;
        const organisation = Boolean(type && type !== "person");
        Object.assign(stored, {
          payer_type: type,
          organisation_name: organisation ? (input.organisation_name ?? null) : null,
          // The organisation mask (trigger flow): kept for an organisation only.
          organisation_legal_form: organisation ? (input.organisation_legal_form ?? null) : null,
          organisation_register_number: organisation ? (input.organisation_register_number ?? null) : null,
          organisation_contact_name: organisation ? (input.organisation_contact_name ?? null) : null,
          relationship_kind: kind,
          relationship: thirdParty && (kind === null || kind === "other") ? (input.relationship ?? null) : null,
          contact_consent_at:
            !thirdParty || consent === false ? null : consent === true ? (consentBefore ?? "2026-10-03T09:16:00Z") : consentBefore,
        });
        if (type && type !== "person") {
          Object.assign(stored, { first_name: null, last_name: null, date_of_birth: null, citizenships: [] });
        }
      }
      const before = request.payer;
      // A server that knows the consent to pass the cost estimate on keeps it for the same
      // third party and clears it with another payer (phase 3b, 11.1); the answer never sets it.
      if (before && "cost_estimate_consent_at" in before) {
        const samePayer = stored.payer_kind === "third_party" && payerKey(before) === payerKey(stored);
        stored.cost_estimate_consent_at = samePayer ? (before.cost_estimate_consent_at ?? null) : null;
      }
      request.payer = stored;
      if (request.billing) billingAfterPayerChange(request.billing, before, stored);
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/payer/cost-estimate-consent" && method === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.costEstimateConsent.push(body);
      if (request.payer?.payer_kind !== "third_party") {
        return route.fulfill({ status: 409, json: { code: "no_third_party_payer", message: "No third party pays" } });
      }
      // Like the server: `true` records it (the first time stays), `false` removes it; also once the payer answered.
      request.payer.cost_estimate_consent_at =
        body.consent === true ? (request.payer.cost_estimate_consent_at ?? "2026-10-03T09:17:00Z") : null;
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/billing" && method === "POST" && request.billing) {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.billing.push(patch);
      const unknown = Object.keys(patch).find((key) => !INVOICE_KEYS.includes(key) && !PAYMENT_ROUTE_KEYS.includes(key));
      if (unknown) {
        return route.fulfill({ status: 422, json: { code: "invalid_field", field: unknown, message: "Unknown field" } });
      }
      // Section 8 is the payer's answer: nothing is saved for anybody else.
      if (request.billing.payment_route_by === "payer" && Object.keys(patch).some((key) => PAYMENT_ROUTE_KEYS.includes(key))) {
        return route.fulfill({ status: 409, json: { code: "payment_route_by_payer", message: "The payer answers" } });
      }
      if (patch.invoice_to === "payer" && request.payer?.payer_kind !== "third_party") {
        return route.fulfill({ status: 422, json: { code: "invalid_field", field: "invoice_to", message: "No third party" } });
      }
      for (const [key, value] of Object.entries(patch)) request.billing[key] = value === "" ? null : value;
      clearBillingDependents(request.billing);
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
      for (const [key, value] of Object.entries(patch)) request.identification[key] = value === "" ? null : value;
      if (request.submitted_at) request.changed_since_submit = true;
      recompute(request);
      return route.fulfill({ json: request });
    }
    if (path === "/me/lead-requests/lead-1/representation" && method === "POST" && request.representation) {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.representation.push(patch);
      Object.assign(request.representation, patch);
      // Without "yes" nobody acts, and nobody court-appointed either (owner 2026-10-11).
      if (request.representation.has_representative !== true) request.representation.under_guardianship = null;
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
    if (path === "/me/lead-requests/lead-1/consent-choices" && method === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.consentChoices.push(body);
      const saved = { version: body.version, choices: body.choices, chosen_at: "2026-10-12T08:05:00Z" };
      Object.assign(request, { consent_form: saved });
      return route.fulfill({ status: 201, json: saved });
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
        // Like the server (owner 2026-10-26): added to a sent request, never removed by the lead.
        can_delete: !request.submitted_at,
        added_after_submit: Boolean(request.submitted_at),
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
  test("audit: concern waits for health consent and the combined upload limit applies", async ({ page }) => {
    const { request, calls } = await setup(page, "lead");
    Object.assign(request, { documents_used: 30 });
    await page.goto("/");
    await step(page, "documents");
    const reason = page.getByRole("textbox", { name: "Grund der Anfrage" });
    await expect(reason).toBeDisabled();
    await page.getByTestId("lead-request-health-consent").getByRole("checkbox").click();
    await expect(reason).toBeEnabled();
    await expect(page.locator("#lead-request-files")).toBeDisabled();
    await reason.fill("Synthetic concern");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ request_reason: "Synthetic concern" });
  });

  // Both parents edit at once (owner decision 2026-10-23): the request is read again on focus;
  // untouched fields follow the server, a field being typed in keeps the draft and says so.
  test("the cabinet takes over what was saved elsewhere and keeps what is being typed", async ({ page }) => {
    const { request, calls } = await setup(page, "lead");
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator("#lead-request-city")).toHaveValue("");
    await page.clock.pauseAt(Date.now() + 5000);
    await page.locator("#lead-request-city").fill("Hamburg");
    // Saved meanwhile elsewhere: another city and another postcode.
    request.personal_data.city = "München";
    request.personal_data.zip_code = "80331";
    // The other parent's save arrives as `lead.portal_updated` (the page's own realtime event bus;
    // the mocked socket of this suite is closed). The own events are not read again.
    const reads = { count: 0 };
    page.on("request", (sent) => {
      if (sent.method() === "GET" && new URL(sent.url()).pathname === "/api/v1/me/lead-requests/lead-1") reads.count += 1;
    });
    const realtime = (actor: string) =>
      page.evaluate((actorUserId) => window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
        detail: { id: `event-${actorUserId}`, type: "lead.portal_updated", entity_type: "lead", entity_id: "lead-1", actor_user_id: actorUserId, payload: { change: "personal_data" } },
      })), actor);
    await realtime("lead-user");
    await realtime("other-parent");
    await expect(page.locator("#lead-request-zip_code")).toHaveValue("80331");
    expect(reads.count).toBe(1);
    await expect(page.locator("#lead-request-city")).toHaveValue("Hamburg");
    await expect(page.getByTestId("lead-request-city-server-changed")).toHaveText(
      "Diese Angabe wurde inzwischen geändert – bitte prüfen Sie das Feld.",
    );
    // Nothing was written over the other change by the re-read itself.
    expect(calls.personalData).toEqual([]);
    // Typing on: the notice goes; the autosave sends the typed city only.
    await page.locator("#lead-request-city").fill("Hamburg-Altona");
    await expect(page.getByTestId("lead-request-city-server-changed")).toHaveCount(0);
    await page.clock.runFor(800);
    await expect.poll(() => calls.personalData.at(-1)).toEqual({ city: "Hamburg-Altona" });
    await expect(page.locator("#lead-request-zip_code")).toHaveValue("80331");
  });

  test("audit: autosave retries valid fields after multiple independent rejections", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    const attempts: Record<string, unknown>[] = [];
    await page.route("**/api/v1/me/lead-requests/lead-1/personal-data", async (route) => {
      const patch = route.request().postDataJSON();
      attempts.push(patch);
      const field = patch.first_name === "Refused" ? "first_name" : patch.city === "Invalid" ? "city" : null;
      if (field) return route.fulfill({ status: 422, json: { code: "invalid_field", field, message: "Synthetic validation error" } });
      await route.fallback();
    });
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator("#lead-request-first_name")).toBeVisible();
    await page.clock.pauseAt(Date.now() + 1000);
    await page.locator("#lead-request-first_name").fill("Refused");
    await page.locator("#lead-request-city").fill("Invalid");
    await page.locator("#lead-request-phone").fill("+4930123456");
    await page.clock.runFor(800);
    await expect.poll(() => attempts.length).toBe(3);
    expect(attempts[1]).not.toHaveProperty("first_name");
    expect(attempts[2]).toEqual({ phone: "+4930123456" });
    expect(calls.personalData.at(-1)).toEqual({ phone: "+4930123456" });
    await expect(page.locator("#lead-request-first_name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#lead-request-city")).toHaveAttribute("aria-invalid", "true");
  });

  test("audit: access closed during autosave reloads the guardian-only notice", async ({ page }) => {
    await setup(page, "lead");
    let closed = false;
    await page.route("**/api/v1/me/lead-requests", async (route) => {
      if (closed) return route.fulfill({ json: { requests: [], own_access_closed: true } });
      await route.fallback();
    });
    await page.route("**/api/v1/me/lead-requests/lead-1/personal-data", async (route) => {
      closed = true;
      await route.fulfill({ status: 403, json: { code: "lead_request_guardian_only", message: "Guardian only" } });
    });
    await page.goto("/");
    await page.locator("#lead-request-middle_name").fill("Maria");
    await expect(page.getByTestId("lead-request-step-person")).toHaveCount(0);
    await expect(page.getByText("Diese Anfrage füllen Ihre Eltern bzw. Ihr gesetzlicher Vertreter", { exact: false })).toBeVisible();
  });

  test("a parent whose child came of age during the edit reads that the access ended (QA 2026-10-23)", async ({ page }) => {
    await setup(page, "lead");
    let ended = false;
    await page.route("**/api/v1/me/lead-requests", async (route) => {
      if (ended) return route.fulfill({ json: { requests: [], own_access_closed: false, guardian_access_ended: true } });
      await route.fallback();
    });
    // The server no longer finds the request for this login: every write answers 404.
    await page.route("**/api/v1/me/lead-requests/lead-1/personal-data", async (route) => {
      ended = true;
      await route.fulfill({ status: 404, json: { error: "Not Found", message: "Request not found" } });
    });
    await page.goto("/");
    await page.locator("#lead-request-middle_name").fill("Maria");
    await expect(page.getByTestId("lead-request-step-person")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-guardian-access-ended")).toHaveText(
      "Die Person, für die Sie die Anfrage ausgefüllt haben, ist inzwischen volljährig. Ihr Zugang als Elternteil bzw. gesetzlicher Vertreter ist damit beendet. Bei Fragen wenden Sie sich bitte an GMED.",
    );
  });

  test("audit: hidden legacy requirements remain visible in the sending summary", async ({ page }) => {
    const { request } = await setup(page, "lead", { prepare: completeRequest });
    request.progress.missing_for_submit = ["pep_self", "birth_place"];
    await page.goto("/");
    await step(page, "send");
    const other = page.getByTestId("lead-request-missing-other");
    await expect(other).toContainText("Weitere Angaben");
    await expect(other.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByTestId("lead-request-send").getByRole("button", { name: "Anfrage senden", exact: true })).toBeDisabled();
  });

  test("a lead login keeps patient modules locked beside its request and utilities", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByTestId("lead-request-deadline")).toContainText("Bitte bis 17.10.2026 ausfüllen.");
    const nav = page.locator("nav");
    await expect(nav.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Konto" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Meine Dokumente" })).toHaveCount(0);
    await expect(page.getByTitle("Benachrichtigungen", { exact: true })).toHaveCount(0);
    // One entry for the portal to come, not ten locked ones (owner 2026-10-26, C1).
    await expect(nav.getByTestId("lead-portal-locked-after_request")).toHaveAttribute("aria-haspopup", "dialog");
    await expect(nav.getByTestId("lead-portal-locked-notifications")).toHaveCount(0);

    // Other portal pages lead back to the request page.
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    expect(calls.blocked).toEqual([]);
  });

  test("the patient enters the data, agrees, uploads and sends", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");

    // Step 1: the consent first, then the person.
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("lead-request-inquiry-consent")).toContainText("Zugestimmt am 03.10.2026");
    expect(calls.consents).toEqual(["lead_inquiry_processing"]);

    // "Weiter" with something missing first shows the yellow list and stays (owner 2026-10-09).
    const person = page.getByTestId("lead-request-step-person");
    await expect(person.getByTestId("lead-request-step-missing")).toHaveCount(0);
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "person");
    await expect(person.getByTestId("lead-request-step-missing")).toContainText("Geburtsdatum");

    // The address is part of the first step (owner 2026-10-09), saved on its own.
    await page.locator("#lead-request-city").fill("Berlin");
    await page.locator("#lead-request-zip_code").fill("10115");
    await page.locator("#lead-request-street_address").fill("Musterstraße 1");
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
    expect(calls.personalData.at(-1)).toMatchObject({ city: "Berlin", zip_code: "10115", street_address: "Musterstraße 1" });
    expect(Object.keys(calls.personalData.at(-1) ?? {})).not.toContain("first_name");

    // "Anliegen & Unterlagen": the medical documents after the Art. 9 consent.
    await step(page, "documents");
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

    // The reason of the request is optional (owner 2026-10-19): nothing is missing here, "Weiter" goes on.
    await expect(page.getByTestId("lead-request-documents").getByTestId("lead-request-step-missing")).toHaveCount(0);
    await page.getByRole("button", { name: "Weiter" }).click();
    const send = page.getByTestId("lead-request-submit");
    const missing = page.getByTestId("lead-request-missing");
    // What is still missing, by step: the person, the identity copy, who pays, the invoice.
    await expect(send).toBeDisabled();
    await expect(missing.getByTestId("lead-request-missing-person")).toContainText("Geburtsdatum");
    await expect(missing.getByTestId("lead-request-missing-person")).toContainText(ACTS);
    // Whether the person who acts is court-appointed is asked only after "yes" (owner 2026-10-11).
    await expect(missing.getByTestId("lead-request-missing-person")).not.toContainText(APPOINTED);
    // The birth data (block K) and the legal questions (block L) are not asked by the base form (owner 2026-10-09).
    await expect(missing).not.toContainText("Geburtsort");
    await expect(missing.getByTestId("lead-request-missing-declarations")).toHaveCount(0);
    await expect(missing).not.toContainText("Gesetzliche Fragen");
    await expect(missing).not.toContainText("wirtschaftlichen Interesse");
    await expect(missing.getByTestId("lead-request-missing-identity")).toContainText("Ausweisdokument: Foto oder Scan des Ausweises");
    // Who pays is part of step 3 since 2026-10-11.
    await expect(missing.getByTestId("lead-request-missing-payer")).toHaveCount(0);
    await expect(missing.getByTestId("lead-request-missing-billing")).toContainText(WHO_PAYS);
    await expect(missing.getByTestId("lead-request-missing-billing")).toContainText("Wer ist Rechnungsempfänger?");
    await expect(missing.getByTestId("lead-request-missing-documents")).toHaveCount(0);
    // The identity document's data are staff's; the payment route is asked later if at all.
    await expect(missing).not.toContainText("Art des Dokuments");
    await expect(missing).not.toContainText("Welche Zahlungsart für Rechnungen bevorzugen Sie?");

    // "Angaben ändern" opens the first step that misses something.
    await page.getByRole("button", { name: "Angaben ändern" }).click();
    await expect(page.getByTestId("lead-request-step-person")).toBeVisible();
    await setDatePickerValue(page.locator("#lead-request-date_of_birth"), "1988-05-01");
    await expect.poll(() => calls.personalData.some((patch) => patch.date_of_birth === "1988-05-01")).toBe(true);
    await page.getByRole("combobox", { name: "Geschlecht laut Ausweis" }).click();
    await page.getByRole("option", { name: "Weiblich" }).click();
    await expect.poll(() => calls.personalData.some((patch) => patch.legal_sex === "female")).toBe(true);
    await page.locator("#lead-request-citizenships").click();
    await page.getByRole("option", { name: "Deutschland" }).first().click();
    await expect.poll(() => calls.personalData.some((patch) => Array.isArray(patch.citizenships))).toBe(true);
    await page.keyboard.press("Escape");
    // Birth name, place and country of birth are follow-up block K (owner 2026-10-09).
    await expect(page.locator("#lead-request-birth_place")).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Geburtsland" })).toHaveCount(0);

    // Nobody acts for the patient: one "no", and nobody is asked for (owner 2026-10-11).
    const representation = page.getByTestId("lead-request-representation");
    await choose(page, representation.getByRole("combobox", { name: ACTS }), "Nein");
    await expect(representation.getByRole("combobox", { name: APPOINTED })).toHaveCount(0);
    await expect.poll(() => Object.assign({}, ...calls.representation)).toEqual({ has_representative: false });
    await expect(representation.getByRole("group")).toHaveCount(0);

    // The country of residence sits in the same first step; there is no tab "Kontakt" any more.
    await expect(page.locator('[data-step="contact"]')).toHaveCount(0);
    await page.getByRole("combobox", { name: "Wohnsitzland" }).click();
    await page.getByRole("option", { name: "Deutschland" }).first().click();
    await expect.poll(() => calls.personalData.some((patch) => patch.country === "DE")).toBe(true);

    // The identity document: a copy only.
    await step(page, "identity");
    await page.locator("#lead-request-identity-files").setInputFiles({
      name: "reisepass.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("synthetic image"),
    });
    await expect(page.getByTestId("lead-request-identity-list")).toContainText("reisepass.jpg");

    // Who pays is part of step 3 since 2026-10-11.
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    await choose(page, payer.getByRole("combobox", { name: WHO_PAYS }), "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    // The own economic interest is follow-up block L (owner 2026-10-09): not asked with who pays.
    await expect(payer.getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" })).toHaveCount(0);

    // The invoice goes to the patient; the payment route is no question of the base form any more.
    await page.getByTestId("lead-request-billing").getByRole("radio", { name: "Ich", exact: true }).check();
    await expect.poll(() => calls.billing.at(-1)).toEqual({ invoice_to: "self" });
    await expect(page.getByTestId("lead-request-payment-route")).toHaveCount(0);

    // The legal questions are follow-up block L (owner 2026-10-09): no step "Erklärungen".
    await expect(page.locator('[data-step="declarations"]')).toHaveCount(0);
    await expect(page.getByTestId("lead-request-legal")).toHaveCount(0);

    await step(page, "documents");
    await page.getByTestId("lead-request-health-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-health-consent").getByRole("checkbox")).toBeChecked();
    await page.getByRole("textbox", { name: "Grund der Anfrage" }).fill("Zweitmeinung zur Knie-OP");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ request_reason: "Zweitmeinung zur Knie-OP" });
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");

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

    // Sent (owner 2026-10-26): the form is read-only with one hint; documents are added
    // without sending again; «Abschließen und abmelden» signs out with a thank-you.
    await expect(page.getByTestId("lead-request-sent-locked")).toContainText(
      "Ihre Anfrage ist bei GMED. Möchten Sie etwas ändern? Schreiben Sie Ihrem Kontakt bei GMED oder rufen Sie an.",
    );
    await expect(page.getByRole("button", { name: "Angaben ändern" })).toHaveCount(0);
    await step(page, "billing");
    await expect(page.getByTestId("lead-request-sent-locked")).toBeVisible();
    await expect(page.getByTestId("lead-request-step-locked")).toBeVisible();
    await expect(page.getByTestId("lead-request-insurance").getByRole("combobox", { name: HAS_INSURANCE })).toBeDisabled();
    await step(page, "documents");
    await expect(page.getByRole("textbox", { name: "Grund der Anfrage" })).toBeDisabled();
    await expect(page.getByTestId("lead-request-add-documents")).toHaveText("Dokumente nachreichen");
    await expect(page.getByTestId("lead-request-add-documents-note")).toContainText("ein erneutes Senden ist nicht nötig");
    const uploadsBefore = calls.uploads;
    await page.locator("#lead-request-files").setInputFiles({
      name: "nachtrag.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic added finding"),
    });
    await expect.poll(() => calls.uploads).toBe(uploadsBefore + 1);
    const added = page.getByTestId("lead-request-document-list").getByRole("listitem").last();
    await expect(added).toContainText("Nachgereicht");
    await expect(added.getByRole("button")).toHaveCount(0);
    expect(calls.submits).toBe(1);
    await step(page, "send");
    await expect(send).toHaveCount(0);
    await expect(page.getByTestId("lead-request-go-add-documents")).toHaveText("Dokumente nachreichen");
    await page.getByTestId("lead-request-finish").click();
    await expect(page.getByTestId("login-sign-out-notice")).toHaveText("Vielen Dank – Ihre Anfrage ist bei GMED.");
  });

  test("the person chooses the consent form options themselves; nothing is ticked in advance", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => Object.assign(request, { consent_form: { version: "2026-10-12", choices: null, chosen_at: null } }),
    });
    await page.goto("/");
    await step(page, "documents");
    const block = page.getByTestId("lead-request-consent-form");
    // No document number in the title (labels audit 2026-10-26, B8).
    await expect(block).toContainText("Einwilligung zur Datenübermittlung");
    await expect(block).not.toContainText("Anlage 1");
    // The step-4 answer as one line with a jump back (owner 2026-10-26, C3).
    await expect(block.getByTestId("disclosure-saved-status")).toHaveText("Auskunft an Dritte: Nein");
    // Three core consents and three channels (no Threema since the owner polish 2026-10-29);
    // third-party disclosure is chosen on its own page.
    await expect(block.getByRole("checkbox")).toHaveCount(6);
    await expect(block.locator('[data-consent-option="channel_threema"]')).toHaveCount(0);
    await expect(block.getByTestId("lead-request-consent-recipients").getByRole("link")).toHaveAttribute("href", /step=disclosure/);
    for (const box of await block.getByRole("checkbox").all()) await expect(box).not.toBeChecked();
    await expect(block).not.toContainText("Noch keine Auswahl gespeichert.");
    const save = page.getByTestId("lead-request-consent-form-save");
    // An empty or partial choice is no consent (QA 2026-10-12, A2-02): saving waits for the three
    // consents the service runs on.
    await expect(save).toHaveCount(0);
    await expect(page.getByTestId("lead-request-consent-form-core-hint")).toBeVisible();
    await block.getByRole("checkbox", { name: /behandelnden Ärzte/ }).check();
    await block.getByRole("checkbox", { name: "WhatsApp", exact: true }).check();
    await expect(save).toHaveCount(0);
    await block.getByRole("checkbox", { name: /beauftragte Mitarbeitende/ }).check();
    await block.getByRole("checkbox", { name: /EDV-System/ }).check();
    await expect(page.getByTestId("lead-request-consent-form-core-hint")).toHaveCount(0);
    // Saved: the step's save indicator says so; no receipt sentence of its own (B8).
    await expect.poll(() => calls.consentChoices.length).toBe(1);
    await expect(block).not.toContainText("Ihre Auswahl vom 12.10.2026");
    expect(calls.consentChoices).toEqual([
      {
        version: "2026-10-12",
        language: "de",
        recipients: [],
        choices: {
          agency_processing: true,
          doctors_to_agency: true,
          data_system: true,
          named_recipients: false,
          channel_email: false,
          channel_threema: false,
          channel_whatsapp: true,
          channel_telegram: false,
        },
      },
    ]);
  });

  test("a whole date pasted into a segment of the date field fills the date (QA 2026-10-12, A2-03)", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    const field = page.locator(".MuiPickersInputBase-root", { has: page.locator("#lead-request-date_of_birth") });
    const paste = async (text: string) => {
      const day = field.getByRole("spinbutton").first();
      await day.click();
      await day.evaluate((node, value) => {
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", value);
        node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
      }, text);
    };
    await paste("05.06.1970");
    await expect(page.locator("#lead-request-date_of_birth")).toHaveValue("05.06.1970");
    await expect.poll(() => calls.personalData.some((patch) => patch.date_of_birth === "1970-06-05")).toBe(true);
    // The ISO spelling and a date without leading zeros work alike.
    await paste("1965-11-11");
    await expect(page.locator("#lead-request-date_of_birth")).toHaveValue("11.11.1965");
    await paste("3.2.1980");
    await expect(page.locator("#lead-request-date_of_birth")).toHaveValue("03.02.1980");
    await expect.poll(() => calls.personalData.some((patch) => patch.date_of_birth === "1980-02-03")).toBe(true);
  });

  test("a parent chooses the consent options for the child's data (QA 2026-10-12, A2-06)", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) =>
        Object.assign(request, {
          access_kind: "guardian",
          minor: true,
          consent_form: { version: "2026-10-12", choices: null, chosen_at: null },
        }),
    });
    await page.goto("/");
    await step(page, "documents");
    const block = page.getByTestId("lead-request-consent-form");
    await expect(block).toContainText("wozu Sie für Ihr Kind einwilligen");
    await expect(block).toContainText("Die Daten und Unterlagen meines Kindes dürfen");
    await expect(block).not.toContainText("meine personenbezogenen");
    for (const name of [/meines Kindes einholen/, /seine Behandlungsunterlagen/, /Unterlagen meines Kindes dürfen im EDV-System/]) {
      await block.getByRole("checkbox", { name }).check();
    }
    await block.getByRole("checkbox", { name: "E-Mail", exact: true }).check();
    await expect.poll(() => calls.consentChoices.length).toBe(1);
    expect(calls.consentChoices[0]?.choices).toMatchObject({
      agency_processing: true,
      doctors_to_agency: true,
      data_system: true,
      channel_email: true,
    });
  });

  test("a minor's own login sees only that the parents fill in the request (QA 2026-10-12, A3-01)", async ({ page }) => {
    await setup(page, "lead", { ownAccessClosed: true });
    await page.goto("/");
    const notice = page.getByTestId("lead-request-guardian-only");
    await expect(notice).toContainText("Diese Anfrage füllen Ihre Eltern bzw. Ihr gesetzlicher Vertreter");
    await expect(page.getByTestId("lead-request")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-steps")).toHaveCount(0);
  });

  test("a minor's own login chooses no consent options; the parents do (QA 2026-10-12, A3-01)", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) =>
        Object.assign(request, {
          access_kind: "self",
          minor: true,
          consent_form: { version: "2026-10-12", choices: null, chosen_at: null },
        }),
    });
    await page.goto("/");
    await step(page, "documents");
    const block = page.getByTestId("lead-request-consent-form");
    await expect(block.getByTestId("lead-request-consent-form-by-guardian")).toContainText(
      "Für Minderjährige wählen die Eltern bzw. der Vormund",
    );
    await expect(block.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-consent-form-save")).toHaveCount(0);
    expect(calls.consentChoices).toHaveLength(0);
  });

  test("another person as payer is named with name and citizenship before sending", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    // Who pays is part of step 3 since 2026-10-11: one question, a private person or an organisation.
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const question = payer.getByRole("combobox", { name: WHO_PAYS });

    // Another person's fields exist only when another person pays.
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await question.click();
    await expect(page.getByRole("option")).toHaveText(["Auswählen", "Ich selbst", "Eine Privatperson", "Eine Organisation"]);
    await page.getByRole("option", { name: "Eine Privatperson", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({ payer_kind: "third_party", payer_type: "person", messenger: "", contact_consent: false });
    // The question says what it asks: no filler sentence about the law (QA 2026-10-10).
    await expect(payer).not.toContainText("Wir sind gesetzlich verpflichtet zu wissen, wer zahlt.");
    // Why the person pays is no question of the base form (follow-up block B).
    await expect(payer.getByRole("textbox", { name: /Warum übernimmt/ })).toHaveCount(0);

    // The send step says what the manager still needs about that person.
    await step(page, "send");
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("Zahler: Vorname");
    await expect(missing).toContainText("Zahler: Nachname");
    await expect(missing).toContainText("Zahler: Staatsangehörigkeit(en)");
    await expect(missing).toContainText("Zahler: Beziehung zu Ihnen");
    await expect(missing).toContainText("Zahler: Einverständnis zur Kontaktaufnahme");

    await step(page, "billing");
    await expect(question).toContainText("Eine Privatperson");
    await payer.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await payer.getByRole("textbox", { name: "Nachname" }).fill(" Zahler ");
    await page.locator("#lead-request-payer_citizenships").click();
    await page.getByRole("option", { name: "Ukraine" }).first().click();
    await page.keyboard.press("Escape");
    await payer.getByRole("textbox", { name: "Ort", exact: true }).fill("München");
    await choose(page, payer.getByRole("combobox", { name: "Wohnsitzland" }), "Deutschland");
    // The block is saved as a whole, trimmed, without the empty fields.
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      city: "München",
      country: "DE",
      messenger: "",
      citizenships: ["UA"],
      contact_consent: false,
    });
    // The relationship is chosen from the list, and the payer may be contacted only with the consent.
    await choose(page, payer.getByRole("combobox", { name: "Beziehung zu Ihnen" }), "Elternteil");
    await payer.getByTestId("lead-request-payer-consent").getByRole("checkbox").check();
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ relationship_kind: "parent", contact_consent: true });
    await step(page, "send");
    await expect(missing).not.toContainText("Zahler:");
    // The summary names the person who pays.
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Eine andere Person oder Organisation");
    await expect(paying).toContainText("Privatperson");
    await expect(paying).toContainText("Viktor");
    await expect(paying).toContainText("Elternteil");

    // "I pay myself" sends only the answer and hides the other person again.
    await step(page, "billing");
    await choose(page, question, "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    // What was typed about the person comes back with the answer; the consent is asked again.
    await choose(page, question, "Eine Privatperson");
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveValue("Zahler");
    await expect(payer.getByTestId("lead-request-payer-consent").getByRole("checkbox")).not.toBeChecked();
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ payer_kind: "third_party", last_name: "Zahler", contact_consent: false });
  });

  test("an organisation as payer is named by its name, legal form, contact person, its seat and why it pays, not as a person", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    // Who pays is part of step 3 since 2026-10-11; a company is "an organisation" there.
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const type = payer.getByRole("combobox", { name: WHO_PAYS });
    const missing = page.getByTestId("lead-request-missing");
    const reason = payer.getByRole("textbox", { name: "Warum erfolgt die Zahlung über die Organisation?" });

    await choose(page, type, "Eine Privatperson");
    // No person was named yet: changing type may preserve the entered address.
    await payer.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Musterstraße 1");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ payer_type: "person", street: "Musterstraße 1" });
    await expect(reason).toHaveCount(0);

    // An organisation has the organisation mask and a seat; the fields of a natural person are gone, with what was typed in them.
    await choose(page, type, "Eine Organisation");
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await expect(page.locator("#lead-request-payer_date_of_birth")).toHaveCount(0);
    await expect(page.locator("#lead-request-payer_citizenships")).toHaveCount(0);
    // Why the payment goes through it, instead of a relationship to the patient (owner 2026-10-11).
    await expect(reason).toBeVisible();
    await expect(payer.getByRole("combobox", { name: "Beziehung zu Ihnen" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Name der Organisation" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Registernummer (falls vorhanden)" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Ansprechperson" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Sitz (Straße und Hausnummer)" })).toHaveValue("Musterstraße 1");
    // The address card of an organisation is its seat, not a residence (QA 2026-10-10).
    await expect(payer.getByRole("heading", { name: "Sitz", exact: true })).toBeVisible();
    await expect(payer.getByRole("heading", { name: "Wohnort", exact: true })).toHaveCount(0);
    await expect(payer).not.toContainText("Bitte sagen Sie dieser Person");
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "organisation",
      street: "Musterstraße 1",
      messenger: "",
      contact_consent: false,
    });
    // Without the name, the legal form, the contact person, a way to reach it, the country of the seat
    // and why it pays the request cannot be sent.
    await step(page, "send");
    await expect(missing).toContainText("Zahler: Name der Organisation");
    await expect(missing).toContainText("Zahler: Rechtsform");
    await expect(missing).toContainText("Zahler: Ansprechperson");
    await expect(missing).toContainText("Zahler: E-Mail");
    await expect(missing).toContainText("Zahler: Land des Sitzes");
    await expect(missing).toContainText("Warum erfolgt die Zahlung über die Organisation?");
    await expect(missing).not.toContainText("Beziehung zu Ihnen");
    await expect(missing).not.toContainText("Zahler: Vorname");
    await expect(missing).not.toContainText("Zahler: Staatsangehörigkeit(en)");

    await step(page, "billing");
    await expect(type).toContainText("Eine Organisation");
    await payer.getByRole("textbox", { name: "Name der Organisation" }).fill(" Beispiel GmbH ");
    await payer.getByRole("textbox", { name: "Rechtsform" }).fill("GmbH");
    await payer.getByRole("textbox", { name: "Ansprechperson" }).fill("Ben Muster");
    await payer.getByRole("textbox", { name: "E-Mail" }).fill("kontakt@example.com");
    await choose(page, payer.getByRole("combobox", { name: "Land des Sitzes" }), "Deutschland");
    await reason.fill("Der Arbeitgeber übernimmt die Kosten.");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ payment_background: "Der Arbeitgeber übernimmt die Kosten." });
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "organisation",
      organisation_name: "Beispiel GmbH",
      organisation_legal_form: "GmbH",
      organisation_contact_name: "Ben Muster",
      street: "Musterstraße 1",
      country: "DE",
      email: "kontakt@example.com",
      messenger: "",
      contact_consent: false,
    });
    await step(page, "send");
    await expect(missing).not.toContainText("Name der Organisation");
    await expect(missing).not.toContainText("Land des Sitzes");
    await expect(missing).not.toContainText("Zahler: E-Mail");
    await expect(missing).not.toContainText("Warum erfolgt die Zahlung");
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Beispiel GmbH");
    await expect(paying).toContainText("Ben Muster");
    await expect(paying).toContainText("Sitz (Straße und Hausnummer)");
    await expect(paying).not.toContainText("Vorname");

    // A private person has no organisation mask, and the reason of the organisation goes with it.
    await step(page, "billing");
    await choose(page, type, "Eine Privatperson");
    await expect(payer.getByRole("textbox", { name: "Name der Organisation" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toHaveCount(0);
    await expect(reason).toHaveCount(0);
    await expect.poll(() => calls.identification.at(-1)).toEqual({ payment_background: "" });
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveValue("");
    await expect(payer.getByRole("textbox", { name: "Straße und Hausnummer", exact: true })).toHaveValue("Musterstraße 1");
    // A named organisation remains stored until the replacement person is sufficiently identified.
    expect(calls.payer.at(-1)).toMatchObject({ payer_type: "organisation", organisation_name: "Beispiel GmbH" });
    await payer.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await payer.getByRole("textbox", { name: "Nachname" }).fill("Zahler");
    await payer.getByRole("textbox", { name: "Ort", exact: true }).fill("Berlin");
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      city: "Berlin",
      street: "Musterstraße 1",
      country: "DE",
      email: "kontakt@example.com",
      messenger: "",
      contact_consent: false,
    });
  });

  test("the relationship 'other' asks what it is", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const relationship = payer.getByRole("combobox", { name: "Beziehung zu Ihnen" });
    const inWords = payer.getByRole("textbox", { name: "In welcher Beziehung genau?" });
    const missing = page.getByTestId("lead-request-missing");

    await choose(page, payer.getByRole("combobox", { name: WHO_PAYS }), "Eine Privatperson");
    // The list of the owner's form, in its order.
    await relationship.click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Ehepartner/in",
      "Elternteil",
      "Kind",
      "Bruder / Schwester",
      "Großmutter / Großvater",
      "Anderer Verwandter",
      "Arbeitgeber",
      "Freund/in",
      "Geschäftspartner/in",
      "Sonstige",
    ]);
    await expect(inWords).toHaveCount(0);
    await page.getByRole("option", { name: "Sonstige", exact: true }).click();
    await expect(inWords).toBeVisible();
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      relationship_kind: "other",
      messenger: "",
      contact_consent: false,
    });
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("Zahler: Beziehung zu Ihnen – In welcher Beziehung genau?");

    await step(page, "billing");
    await expect(relationship).toContainText("Sonstige");
    await inWords.fill("Nachbar");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ relationship_kind: "other", relationship: "Nachbar" });
    await page.locator('[data-step="send"]').click();
    await expect(missing).not.toContainText("Beziehung zu Ihnen");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Nachbar");

    // A relationship of the list needs no words: the text goes with the answer.
    await step(page, "billing");
    await choose(page, relationship, "Freund/in");
    await expect(inWords).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      relationship_kind: "friend",
      messenger: "",
      contact_consent: false,
    });
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Freund/in");
    await expect(page.getByTestId("lead-request-summary-payer")).not.toContainText("Nachbar");
  });

  test("the payer may be contacted only with the consent, and the request needs it", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => completeRequestWithPayer(request, { contact_consent_at: null }),
    });
    await page.goto("/");
    await step(page, "billing");
    const consent = page.getByTestId("lead-request-payer-consent");
    const missing = page.getByTestId("lead-request-missing");
    const send = page.getByTestId("lead-request-submit");
    const declaration = page.getByTestId("lead-request-declaration").getByRole("checkbox");

    await expect(consent).toContainText(
      "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr meinen Namen mitteilt.",
    );
    // No hint line under the consent any more (QA 2026-10-10).
    await expect(consent.getByRole("checkbox")).not.toBeChecked();

    // Everything else is there: the consent alone keeps the request from being sent.
    await page.locator('[data-step="send"]').click();
    await expect(missing.getByRole("listitem")).toHaveText(["Zahler: Einverständnis zur Kontaktaufnahme"]);
    await expect(page.getByTestId("lead-request-summary-payer")).not.toContainText("Einverständnis zur Kontaktaufnahme");
    await declaration.check();
    await expect(send).toBeDisabled();

    await step(page, "billing");
    await consent.getByRole("checkbox").check();
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      relationship_kind: "parent",
      messenger: "",
      citizenships: ["UA"],
      city: "Berlin",
      country: "DE",
      contact_consent: true,
      acts_on_own_account: true,
    });
    await expect(consent).toContainText("Zugestimmt am 03.10.2026");

    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Einverständnis zur Kontaktaufnahme");
    await expect(paying).toContainText("Zugestimmt am 03.10.2026");
    await declaration.check();
    await send.click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("03.10.2026");

    // Sent: the form is read-only (owner 2026-10-26); GMED changes the payer.
    await step(page, "billing");
    await expect(consent.getByRole("checkbox")).toBeChecked();
    await expect(consent.getByRole("checkbox")).toBeDisabled();
    await expect(page.getByTestId("lead-request-sent-locked")).toBeVisible();
  });

  test("after the payer answered on the own link, 'who pays' is read-only and only GMED changes it", async ({ page }) => {
    const { request, calls } = await setup(page, "lead", {
      prepare: (prepared) => {
        completeRequestWithPayer(prepared, {
          date_of_birth: "1960-02-03",
          street: "Zahlerstraße 5",
          zip: "10117",
          city: "Berlin",
          email: "viktor.zahler@example.com",
        });
        // Not sent yet: a sent request is read-only in the cabinet (owner 2026-10-26).
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const street = payer.getByRole("textbox", { name: "Straße und Hausnummer" });
    await expect(street).toHaveValue("Zahlerstraße 5");

    // Meanwhile the payer answers on the own link: the server sends only what the lead named.
    Object.assign(request.payer!, {
      answered_by_payer: true,
      date_of_birth: null,
      street: null,
      zip: null,
      city: null,
      country: null,
      citizenships: [],
      email: null,
      phone: null,
    });
    await street.fill("Zahlerstraße 7");

    // The change is refused (409); the request is loaded afresh and the block is read-only.
    const note = page.getByTestId("lead-request-payer-answered");
    await expect(note).toHaveText("Die zahlende Person hat ihre Angaben selbst gemacht. Änderungen nur über GMED.");
    expect(calls.payer).toHaveLength(1);
    expect(calls.payer[0]).toMatchObject({ street: "Zahlerstraße 7" });
    const readOnly = page.getByTestId("lead-request-payer-readonly");
    await expect(readOnly).toContainText("Eine andere Person oder Organisation");
    await expect(readOnly).toContainText("Privatperson");
    await expect(readOnly).toContainText("Viktor");
    await expect(readOnly).toContainText("Zahler");
    await expect(readOnly).toContainText("Elternteil");
    await expect(readOnly).toContainText("Zugestimmt am 03.10.2026 11:16");
    await expect(payer).not.toContainText("Zahlerstraße");
    await expect(payer).not.toContainText("03.02.1960");
    // Nothing of the payer can be changed here.
    await expect(payer.getByRole("combobox")).toHaveCount(0);
    await expect(payer.getByRole("checkbox")).toHaveCount(0);
    await expect(payer.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");

    // The summary shows the same rows and says why.
    await page.locator('[data-step="send"]').click();
    const summary = page.getByTestId("lead-request-summary-payer");
    await expect(summary).toContainText("Viktor");
    await expect(summary).toContainText("Zugestimmt am 03.10.2026 11:16");
    await expect(summary).not.toContainText("Zahlerstraße");
    await expect(page.getByTestId("lead-request-summary-payer-note")).toHaveText(
      "Die zahlende Person hat ihre Angaben selbst gemacht. Änderungen nur über GMED.",
    );

    // Nothing more is sent from the block: not when the step is left, not after a reload.
    await step(page, "billing");
    await expect(note).toBeVisible();
    await page.reload();
    await step(page, "billing");
    await expect(note).toBeVisible();
    await page.locator('[data-step="send"]').click();
    await page.waitForTimeout(1000);
    expect(calls.payer).toHaveLength(1);
  });

  test("the payer gets the cost estimate only with the patient's own consent, given apart from the answer", async ({ page }) => {
    const { request, calls } = await setup(page, "lead", {
      prepare: (prepared) => completeRequestWithPayer(prepared, { cost_estimate_consent_at: null }),
    });
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const consent = page.getByTestId("lead-request-payer-cost-estimate-consent");
    const missing = page.getByTestId("lead-request-missing");

    // Below the consent to contact the payer, in the owner's words.
    await expect(consent).toContainText(
      "Ich willige ein, dass GMED der zahlenden Person den Kostenvoranschlag mit den voraussichtlichen Kosten übermittelt – nur Leistungsarten und Beträge, ohne Diagnosen und medizinische Einzelheiten.",
    );
    // Required, without the explanatory filler line (QA 2026-10-10).
    await expect(consent).not.toContainText("Ohne diese Einwilligung");
    const order = await payer
      .locator('[data-testid="lead-request-payer-consent"], [data-testid="lead-request-payer-cost-estimate-consent"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    expect(order).toEqual(["lead-request-payer-consent", "lead-request-payer-cost-estimate-consent"]);
    await expect(consent.getByRole("checkbox")).not.toBeChecked();

    // The request cannot be sent without it.
    await page.locator('[data-step="send"]').click();
    await expect(missing.getByRole("listitem")).toHaveText(["Zahler: Einwilligung zur Weitergabe des Kostenvoranschlags"]);
    await expect(page.getByTestId("lead-request-summary-payer")).not.toContainText("Einwilligung zur Weitergabe");

    // Saved at once on its own route, not with the answer "who pays".
    await step(page, "billing");
    await consent.getByRole("checkbox").check();
    await expect.poll(() => calls.costEstimateConsent).toEqual([{ consent: true }]);
    await expect(consent).toContainText("Zugestimmt am 03.10.2026 11:17");
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
    await page.locator('[data-step="send"]').click();
    await expect(missing).toHaveCount(0);
    const summary = page.getByTestId("lead-request-summary-payer");
    await expect(summary).toContainText("Einwilligung zur Weitergabe des Kostenvoranschlags");
    await expect(summary).toContainText("Zugestimmt am 03.10.2026 11:17");
    expect(calls.payer).toEqual([]);

    // Taken back: removed on the server and missing again.
    await step(page, "billing");
    await consent.getByRole("checkbox").uncheck();
    await expect.poll(() => calls.costEstimateConsent.at(-1)).toEqual({ consent: false });
    await expect(consent).not.toContainText("Zugestimmt am");
    expect(request.payer?.cost_estimate_consent_at).toBeNull();

    // Given again, then another person is named: the consent was for the payer before.
    await consent.getByRole("checkbox").check();
    await expect(consent).toContainText("Zugestimmt am");
    await payer.getByRole("textbox", { name: "Nachname" }).fill("Zahlerin");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ last_name: "Zahlerin" });
    expect(calls.payer.every((body) => !("cost_estimate_consent" in body) && !("consent" in body))).toBe(true);
    await expect(consent.getByRole("checkbox")).not.toBeChecked();
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("Zahler: Einwilligung zur Weitergabe des Kostenvoranschlags");
  });

  test("after the payer answered, the consent to pass the cost estimate on stays the patient's to give", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (prepared) => completeRequestWithPayer(prepared, { answered_by_payer: true, cost_estimate_consent_at: null }),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    await expect(page.getByTestId("lead-request-payer-answered")).toBeVisible();
    // Read-only but for the lead's own statements: why the payer pays, and this consent.
    await expect(payer.getByRole("combobox")).toHaveCount(0);
    const consent = payer.getByTestId("lead-request-payer-cost-estimate-consent");
    await expect(consent.getByRole("checkbox")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-billing")).toBeLessThanOrEqual(1);

    await consent.getByRole("checkbox").check();
    await expect.poll(() => calls.costEstimateConsent).toEqual([{ consent: true }]);
    await expect(page.getByTestId("lead-request-payer-readonly")).toContainText("Einwilligung zur Weitergabe des Kostenvoranschlags");
    await expect(consent).toContainText("Zugestimmt am 03.10.2026 11:17");
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Einwilligung zur Weitergabe des Kostenvoranschlags");
    expect(await widestOverhang(page, "lead-request-send")).toBeLessThanOrEqual(1);
    // Nothing of the payer itself was sent.
    expect(calls.payer).toEqual([]);
  });

  test("a parent may answer 'I pay' and finds the own data filled in", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        request.access_kind = "guardian";
        // The parent's login is linked to a trusted contact of the child's request.
        request.payer_self_template = {
          first_name: "Maria",
          last_name: "Muster",
          date_of_birth: "1985-04-12",
          email: "maria.muster@example.com",
          phone: "+49 30 7654321",
          // What the parent entered as the child's representative (BE6).
          citizenships: ["AT"],
          street: "Elternweg 3",
          zip: "10117",
          city: "Berlin",
          country: "DE",
        };
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const question = payer.getByRole("combobox", { name: WHO_PAYS });

    await question.click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Die Patientin / der Patient selbst",
      "Ich (als Elternteil)",
      "Eine Privatperson",
      "Eine Organisation",
    ]);
    await page.getByRole("option", { name: "Ich (als Elternteil)" }).click();

    // The parent's own data are there and stay editable; who the payer is and
    // how the payer is related to the patient is said by the answer.
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveValue("Maria");
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveValue("Muster");
    await expect(page.locator("#lead-request-payer_date_of_birth")).toHaveValue("12.04.1985");
    await expect(payer.getByRole("textbox", { name: "Telefon" })).toHaveValue("+49 30 7654321");
    await expect(payer.getByRole("textbox", { name: "E-Mail" })).toHaveValue("maria.muster@example.com");
    // Citizenship and address come from the parent's representative data: nothing is typed twice.
    await expect(payer.getByRole("textbox", { name: "Straße und Hausnummer" })).toHaveValue("Elternweg 3");
    await expect(payer.getByRole("textbox", { name: "Postleitzahl" })).toHaveValue("10117");
    await expect(payer.getByRole("textbox", { name: "Ort", exact: true })).toHaveValue("Berlin");
    await expect(payer.getByRole("combobox", { name: "Wohnsitzland" })).toContainText("Deutschland");
    await expect(payer.getByRole("combobox", { name: "Art des Zahlers" })).toHaveCount(0);
    await expect(payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" })).toHaveCount(0);
    await expect(payer).not.toContainText("Bitte sagen Sie dieser Person");
    // The parent is the payer: no consent to be contacted is asked, and none is sent.
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Maria",
      last_name: "Muster",
      date_of_birth: "1985-04-12",
      relationship_kind: "parent",
      street: "Elternweg 3",
      zip: "10117",
      city: "Berlin",
      country: "DE",
      phone: "+49 30 7654321",
      email: "maria.muster@example.com",
      messenger: "",
      citizenships: ["AT"],
    });

    await payer.getByRole("textbox", { name: "Telefon" }).fill("+49 30 1112223");
    await page.locator("#lead-request-payer_citizenships").click();
    await page.getByRole("option", { name: "Ukraine" }).first().click();
    await expect
      .poll(() => calls.payer.at(-1))
      .toMatchObject({ phone: "+49 30 1112223", citizenships: expect.arrayContaining(["AT", "UA"]) });
    await page.keyboard.press("Escape");
    await expect(question).toContainText("Ich (als Elternteil)");
    expect(calls.payer.some((body) => "contact_consent" in body)).toBe(false);

    // The answer is shown again after a reload, and in the summary.
    await page.reload();
    await step(page, "billing");
    await expect(question).toContainText("Ich (als Elternteil)");
    await expect(payer.getByRole("textbox", { name: "Telefon" })).toHaveValue("+49 30 1112223");
    await expect(payer.getByRole("combobox", { name: "Art des Zahlers" })).toHaveCount(0);
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    await page.locator('[data-step="send"]').click();
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Ich zahle (als Elternteil)");
    await expect(paying).toContainText("Maria");
    await expect(paying).toContainText("Elternteil");
    // The consent to contact oneself is never missing.
    await expect(page.getByText("Zahler: Einverständnis zur Kontaktaufnahme")).toHaveCount(0);

    // Another person or organisation is somebody else: the parent's data do not stay.
    await step(page, "billing");
    await choose(page, question, "Eine Privatperson");
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveValue("");
    await expect(payer.getByRole("textbox", { name: "Telefon" })).toHaveValue("");
    await expect(question).toContainText("Eine Privatperson");
    await expect(payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" })).toContainText("Auswählen");
    // The parent remains the stored payer while the replacement is still blank.
    expect(calls.payer.at(-1)).toMatchObject({ first_name: "Maria", relationship_kind: "parent" });
    await payer.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await payer.getByRole("textbox", { name: "Nachname" }).fill("Zahler");
    await payer.getByRole("textbox", { name: "Ort", exact: true }).fill("Berlin");
    await choose(page, payer.getByRole("combobox", { name: "Wohnsitzland" }), "Deutschland");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({
      payer_kind: "third_party", payer_type: "person", first_name: "Viktor", last_name: "Zahler", city: "Berlin", country: "DE", contact_consent: false,
    });
    expect(calls.payer.at(-1)).not.toHaveProperty("relationship_kind");
    // Somebody else pays: the consent to contact that person is asked.
    await expect(payer.getByTestId("lead-request-payer-consent")).toBeVisible();
  });

  test("a child does not pay: 'the patient pays' is not offered for a minor", async ({ page }) => {
    await setup(page, "lead", {
      prepare: (request) => {
        request.access_kind = "guardian";
        request.minor = true;
        request.payer_self_template = {
          first_name: "Maria",
          last_name: "Muster",
          date_of_birth: "1985-04-12",
          email: "maria.muster@example.com",
          phone: null,
        };
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const question = page.getByTestId("lead-request-payer").getByRole("combobox", { name: WHO_PAYS });
    await question.click();
    await expect(page.getByRole("option")).toHaveText(["Auswählen", "Ich (als Elternteil)", "Eine Privatperson", "Eine Organisation"]);
    await page.keyboard.press("Escape");
  });

  test("an older request of a minor keeps its stored answer 'the patient pays'", async ({ page }) => {
    await setup(page, "lead", {
      prepare: (request) => {
        request.access_kind = "guardian";
        request.minor = true;
        request.payer = { ...(request.payer ?? {}), payer_kind: "self" } as typeof request.payer;
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const question = page.getByTestId("lead-request-payer").getByRole("combobox", { name: WHO_PAYS });
    await expect(question).toContainText("Die Patientin / der Patient selbst");
  });

  test("a server without the payer type asks for a person as before", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        // An older server sends neither the template nor the new keys of the payer, and refuses them.
        request.payer_self_template = undefined;
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");

    await choose(page, payer.getByRole("combobox", { name: WHO_PAYS }), "Eine Privatperson");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "third_party" });
    await expect(payer.getByRole("combobox", { name: "Art des Zahlers" })).toHaveCount(0);
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    await payer.getByRole("textbox", { name: "Nachname" }).fill("Zahler");
    await payer.getByRole("textbox", { name: "Beziehung zu Ihnen" }).fill("Vater");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "third_party", last_name: "Zahler", relationship: "Vater" });
    await expect(page.getByTestId("lead-request-save-state")).toHaveText("Gespeichert");
    await page.locator('[data-step="send"]').click();
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("Zahler: Vorname");
    await expect(missing).not.toContainText("Einverständnis zur Kontaktaufnahme");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Vater");
    await expect(page.getByTestId("lead-request-summary-payer")).not.toContainText("Privatperson");
  });

  test("the identity document is uploaded only after the request consent, and only as a copy", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "identity");
    const upload = page.getByTestId("lead-request-identity-upload");
    const button = upload.getByRole("button", { name: "Foto oder Scan des Ausweises hochladen" });
    const list = page.getByTestId("lead-request-identity-list");

    // GMED enters the document's data: the step asks for the copy only.
    // No intro sentence above the upload (owner 2026-10-09): the button and its hint say what to do.
    await expect(page.getByTestId("lead-request-step-identity")).not.toContainText("Bitte laden Sie ein Foto oder einen Scan");
    await expect(page.locator("#lead-request-id_document_type")).toHaveCount(0);
    await expect(page.locator("#lead-request-id_valid_until")).toHaveCount(0);
    // Like the health consent before the medical documents: no consent, no upload.
    await expect(button).toBeDisabled();
    await expect(page.locator("#lead-request-identity-files")).toBeDisabled();
    await expect(upload).toContainText(
      "Zum Hochladen bitte zuerst im Schritt „Einwilligung & Person“ der Verarbeitung Ihrer Angaben zustimmen.",
    );
    await expect(list).toHaveText("");
    // No note about a copy not being enough (owner 2026-10-09).
    await expect(upload).not.toContainText("Eine Kopie allein reicht möglicherweise nicht aus");

    await step(page, "person");
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent")).toContainText("Zugestimmt am");
    await step(page, "identity");
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
    await step(page, "documents");
    await expect(page.getByTestId("lead-request-document-list")).toHaveText("");
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-identity")).toContainText("reisepass.jpg");
    await expect(page.getByTestId("lead-request-missing")).not.toContainText("Foto oder Scan des Ausweises");

    // The own upload can be taken back.
    await step(page, "identity");
    await list.getByRole("button", { name: "Entfernen" }).click();
    await expect(list).toHaveText("");
  });

  test("acting for somebody else asks who that is (follow-up block L)", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        sentWithBlocks(["L"])(request);
        if (request.payer) request.payer.acts_on_own_account = null;
      },
    });
    await page.goto("/");
    // The payer step no longer asks it (owner 2026-10-09): it is block L, only with the enhanced check.
    await step(page, "billing");
    await expect(
      page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" }),
    ).toHaveCount(0);

    await step(page, "follow_up");
    const block = page.getByTestId("lead-request-follow-up-L");
    const ownAccount = block.getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" });
    const person = block.getByRole("textbox", { name: "In wessen Interesse handeln Sie?" });
    await expect(person).toHaveCount(0);

    // The answer is saved with the answer "who pays".
    await choose(page, ownAccount, "Nein");
    await expect(person).toBeVisible();
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: false, beneficial_owner: "" });
    await person.fill("Viktor Zahler, 03.02.1960, Kyiv, Musterstraße 1, 10115 Berlin");
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({
        payer_kind: "self",
        acts_on_own_account: false,
        beneficial_owner: "Viktor Zahler, 03.02.1960, Kyiv, Musterstraße 1, 10115 Berlin",
      });
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Viktor Zahler, 03.02.1960, Kyiv");

    // "Yes" names nobody.
    await step(page, "follow_up");
    await expect(ownAccount).toContainText("Nein");
    await choose(page, ownAccount, "Ja");
    await expect(person).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: true });
  });

  test("the legal questions are follow-up block L, answered with yes or no only", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        sentWithBlocks(["L"], { L: ["sanctions_links"] })(request);
        Object.assign(request.identification, { pep_self: null, pep_related: null, sanctions_links: null });
      },
    });
    await page.goto("/");
    // No step "Erklärungen" any more (owner 2026-10-09).
    await expect(page.locator('[data-step="declarations"]')).toHaveCount(0);
    const block = page.getByTestId("lead-request-follow-up-L");
    const legal = block.getByTestId("lead-request-legal");
    const pepAnswer = legal.getByTestId("lead-request-legal-pep_self").getByRole("combobox", { name: /Üben Sie ein hochrangiges öffentliches Amt aus/ });

    await expect(block).not.toContainText("Diese Fragen schreibt das Geldwäschegesetz vor.");
    // Three questions; the high-risk country is no question of the lead any more.
    await expect(legal.getByRole("combobox")).toHaveCount(3);
    await expect(page.getByTestId("lead-request-legal-high_risk_country")).toHaveCount(0);
    await choose(page, pepAnswer, "Ja");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: true });
    // A "yes" asks no details here: GMED asks them later if it needs them.
    await expect(legal.getByRole("textbox")).toHaveCount(0);
    await choose(page, pepAnswer, "Nein");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: false });
    // What the block still misses shows after "Weiter".
    await expect(page.getByTestId("lead-request-follow-up-L-missing")).toHaveCount(0);
    await page.getByTestId("lead-request-follow-up").getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-follow-up-L-missing")).toContainText("Bestehen Verbindungen zu Personen oder Unternehmen");
  });

  test("the send step shows what will be sent and needs the confirmation", async ({ page }) => {
    const { calls } = await setup(page, "lead", { prepare: completeRequest });
    await page.goto("/");
    await step(page, "send");
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
    // The identity document: the copy only.
    const identity = page.getByTestId("lead-request-summary-identity");
    await expect(identity).toContainText("reisepass.jpg");
    await expect(identity).not.toContainText("Reisepass");
    const representation = page.getByTestId("lead-request-summary-representation");
    await expect(representation).toContainText(ACTS);
    await expect(representation.locator("dd")).toHaveText(["Nein"]);
    // A group without a statement is left out (QA 2026-10-10).
    await expect(page.getByTestId("lead-request-summary-insurance")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Ich selbst");
    const billing = page.getByTestId("lead-request-summary-billing");
    await expect(billing).toContainText("Rechnung und Zahlung");
    await expect(billing).toContainText("Ich");
    const legal = page.getByTestId("lead-request-summary-legal");
    await expect(legal).toContainText("Üben Sie ein hochrangiges öffentliches Amt aus");
    await expect(legal.locator("dd")).toHaveText(["Nein", "Ja", "Nein"]);
    await expect(page.getByTestId("lead-request-summary-request")).toContainText("Zweitmeinung zur Knie-OP");
    await expect(page.getByTestId("lead-request-summary-documents")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary")).not.toContainText("Noch keine Unterlagen hochgeladen.");

    // Nothing is missing, yet nothing is sent without the confirmation.
    await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
    await expect(declaration).toContainText(
      "Ich versichere, dass ich die vorstehenden Angaben nach bestem Wissen und Gewissen gemacht habe und dass sie richtig und vollständig sind. Ich bestätige, dass die für die Bezahlung verwendeten Mittel nicht aus strafbaren Handlungen stammen. Mir ist bekannt, dass GMED – Agentur für Patientenbetreuung berechtigt ist, die Zusammenarbeit abzulehnen oder zu beenden, wenn die Angaben nicht oder nur unzureichend gemacht werden.",
    );
    // No reporting duty is mentioned any more (owner 2026-10-22).
    await expect(declaration).not.toContainText("Meldepflicht");
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
    const { request } = await setup(page, "lead", {
      prepare: (request) => {
        // The legal questions and the own economic interest are follow-up block L (owner 2026-10-09).
        sentWithBlocks(["L"])(request);
        request.access_kind = "guardian";
      },
    });
    await page.goto("/");
    const block = page.getByTestId("lead-request-follow-up-L");
    // The questions name the child, not "you" and not "the patient" (owner 2026-10-27).
    await expect(block.getByTestId("lead-request-legal-pep_self")).toContainText("Übt Anna Muster ein hochrangiges öffentliches Amt aus");
    await expect(block.getByTestId("lead-request-legal-sanctions_links")).toContainText("Bestehen bei Anna Muster Verbindungen zu Personen oder Unternehmen");
    await expect(page.getByTestId("lead-request-follow-up-subject")).toContainText("Alle Angaben auf dieser Seite betreffen Anna Muster, nicht Sie.");
    await expect(
      block.getByRole("combobox", { name: "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?" }),
    ).toBeVisible();
    // The base form of a sent request is read-only (owner 2026-10-26): the payer options of a draft.
    request.submitted_at = null;
    await page.reload();
    await step(page, "billing");
    // Without the parent's own data on file "I (as a parent)" is not offered.
    await page.getByTestId("lead-request-payer").getByRole("combobox", { name: WHO_PAYS }).click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Die Patientin / der Patient selbst",
      "Eine Privatperson",
      "Eine Organisation",
    ]);
    await page.keyboard.press("Escape");
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-legal")).toContainText("Übt die Patientin / der Patient");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Die Patientin / der Patient selbst");
  });

  test("a server without the identification shows the request as before", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        completeRequest(request);
        // An older server sends neither the statements nor the copies, nothing
        // about who acts for the lead, nothing about invoice and payment, and no follow-up.
        const older = request as { identification?: unknown; identity_documents?: unknown };
        older.identification = undefined;
        older.identity_documents = undefined;
        request.representation = undefined;
        request.billing = undefined;
        request.follow_up = undefined;
        request.payer_self_template = undefined;
        request.payer = { payer_kind: "self" };
      },
    });
    await page.goto("/");
    await expect(page.locator("#lead-request-first_name")).toHaveValue("Anna");
    await expect(page.getByTestId("lead-request-representation")).toHaveCount(0);
    await expect(page.locator("#lead-request-birth_place")).toHaveCount(0);
    // The contact is part of the first step (owner 2026-10-09).
    await expect(page.locator("#lead-request-city")).toHaveValue("Berlin");
    await expect(page.getByTestId("lead-request-contact-channels")).toHaveCount(0);
    await step(page, "identity");
    await expect(page.getByTestId("lead-request-identity")).toHaveCount(0);
    await step(page, "billing");
    await expect(page.getByTestId("lead-request-payer").getByRole("combobox")).toHaveCount(1);
    await step(page, "billing");
    await expect(page.getByTestId("lead-request-billing")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payment-route")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toHaveCount(0);
    await expect(page.locator('[data-step="declarations"]')).toHaveCount(0);
    await expect(page.getByTestId("lead-request-legal")).toHaveCount(0);
    await step(page, "documents");
    await expect(page.getByTestId("lead-request-reason")).toHaveCount(0);

    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-identity")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary-billing")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-declaration")).toHaveCount(0);
    await page.getByTestId("lead-request-submit").click();
    await expect(page.getByTestId("lead-request-sent")).toContainText("03.10.2026");
    expect(calls.submitBodies).toEqual([null]);
  });

  test("a server without the follow-up still asks the payment route with the invoice", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => {
        // Such a server knows neither the blocks nor block C's extras.
        request.follow_up = undefined;
        delete request.billing?.via_third_party_kind;
        delete request.billing?.expected_total_eur;
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const paymentRoute = page.getByTestId("lead-request-payment-route");
    await choose(page, paymentRoute.getByRole("combobox", { name: "Welche Zahlungsart für Rechnungen bevorzugen Sie?" }), "Bar");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "cash" });
    // Its extras exist with the follow-up only.
    await expect(page.getByTestId("lead-request-payment-route-extras")).toHaveCount(0);
  });

  test("no insurance means self-payer and hides the details", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "billing");
    const insurance = page.getByTestId("lead-request-insurance");
    await insurance.getByRole("combobox", { name: HAS_INSURANCE }).click();
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
    await expect(page.getByRole("tab", { name: /Звернення й документи/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Прізвище", exact: true })).toBeVisible();

    await languages.getByRole("radio", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Review & send/ })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();
  });

  test("the cabinet has one language switch: the top bar shows no DE/RU button", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    const portalLanguage = page.locator("header button:has(svg.lucide-globe)");
    const menu = page.locator("nav");
    await expect(page.getByTestId("lead-request")).toBeVisible();
    // The portal's DE/RU toggle read "Русский" while the cabinet was Ukrainian or English (owner 2026-10-23).
    await expect(portalLanguage).toHaveCount(0);

    // German and Russian of the cabinet switch the menu too.
    await languages.getByRole("radio", { name: "RU" }).click();
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(menu.getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await languages.getByRole("radio", { name: "DE" }).click();
    await expect(menu.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();

    await languages.getByRole("radio", { name: "UA" }).click();
    await expect(page.getByRole("textbox", { name: "Прізвище", exact: true })).toBeVisible();
    await expect(portalLanguage).toHaveCount(0);
  });

  test("a Russian request opens the whole portal in Russian once, then the person's choice counts", async ({ page }) => {
    await setup(page, "lead", { primaryLanguage: "ru", accountLanguage: null });
    await page.goto("/");
    const languages = page.getByTestId("lead-cabinet-language");
    await expect(page.getByRole("heading", { name: "Ваша заявка" })).toBeVisible();
    await expect(page.locator("nav").getByRole("link", { name: "Ваша заявка" })).toBeVisible();
    await expect(languages.getByRole("radio", { name: "RU" })).toHaveAttribute("aria-checked", "true");

    await languages.getByRole("radio", { name: "DE" }).click();
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
    const openCalendar = page.getByTestId("lead-request-step-person").locator("[data-picker-anchor] button").first();
    const month = (locale: string) =>
      // The browser clock starts at E2E_NOW: the picker opens on its Berlin month.
      new RegExp(new Intl.DateTimeFormat(locale, { month: "long", timeZone: "Europe/Berlin" }).format(E2E_NOW), "i");

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
    const next = page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" });
    // The form is longer than the screen; "Weiter" must not need scrolling.
    await expect(page.locator("#lead-request-first_name")).toBeInViewport();
    await expect(next).toBeInViewport();
    // The first press shows what is missing and stays (owner 2026-10-09); without the consent
    // the second stays too and says so at the box (owner 2026-10-29); with it, it goes on.
    await next.click();
    await expect(page.getByTestId("lead-request-step-person").getByTestId("lead-request-step-missing")).toBeVisible();
    await expect(next).toBeInViewport();
    await next.click();
    await expect(page.getByTestId("lead-request-step-person")).toBeVisible();
    await expect(page.locator("#lead-request-inquiry-consent-error")).toBeVisible();
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox")).toBeChecked();
    await next.click();
    await expect(page.getByTestId("lead-request-step-identity")).toBeVisible();
  });

  test("every missing item leads straight to its step and field, whichever step is open (owner 2026-10-21)", async ({ page }) => {
    await setup(page, "lead");
    await page.goto("/");
    const current = page.getByTestId("lead-request-step");
    // From the first step straight to the summary, past every step between; nothing missing holds it.
    await step(page, "send");
    await expect(current).toHaveAttribute("data-current-step", "send");
    const missing = page.getByTestId("lead-request-missing");

    // An item of a step further on opens that step at its field.
    await missing.getByTestId("lead-request-missing-identity").getByTestId("lead-request-missing-item").first().click();
    await expect(current).toHaveAttribute("data-current-step", "identity");
    await expect(page.getByTestId("lead-request-identity-upload")).toBeInViewport();

    // An item of the first step puts the cursor into its field.
    await step(page, "send");
    await missing.getByTestId("lead-request-missing-person").getByRole("button", { name: "Ort", exact: true }).click();
    await expect(current).toHaveAttribute("data-current-step", "person");
    await expect(page.locator("#lead-request-city")).toBeFocused();
    await expect(page.locator("#lead-request-city")).toBeInViewport();

    // The step's own yellow list leads to its fields as well.
    await page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" }).click();
    const list = page.getByTestId("lead-request-step-person").getByTestId("lead-request-step-missing");
    await list.getByRole("button", { name: "Postleitzahl", exact: true }).click();
    await expect(current).toHaveAttribute("data-current-step", "person");
    await expect(page.locator("#lead-request-zip_code")).toBeFocused();

    // "Angaben ändern" in the summary: the first field still missing, in its step.
    await step(page, "send");
    await missing.getByRole("button", { name: "Angaben ändern" }).click();
    await expect(current).toHaveAttribute("data-current-step", "person");

    // The step name in the summary jumps over the steps between, too.
    await step(page, "send");
    await missing.getByTestId("lead-request-missing-billing").getByRole("button", { name: "Versicherung & Rechnung" }).click();
    await expect(current).toHaveAttribute("data-current-step", "billing");
  });

  test("the last entry is saved when the step is left at once", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    // The page's timers are the test's from the start, so that they can be stopped below.
    await page.clock.install();
    await page.goto("/");
    await expect(page.locator("#lead-request-middle_name")).toBeVisible();
    // The clock stands still: the autosave delay never runs out, only leaving the step can save.
    await page.clock.pauseAt(Date.now() + 1000);
    await page.locator("#lead-request-middle_name").fill("Maria");
    // A statement of the identification in the same step (the birth place is follow-up block K since 2026-10-09).
    const messenger = page.getByTestId("lead-request-contact-channels").getByRole("checkbox", { name: "Messenger" });
    await messenger.check();
    expect(calls.personalData).toEqual([]);
    const next = page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" });
    // The first press shows what is missing and stays; with the consent the second leaves the step.
    await next.click();
    await expect(page.getByTestId("lead-request-step-person").getByTestId("lead-request-step-missing")).toBeVisible();
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox")).toBeChecked();
    await next.click();
    await expect(page.getByTestId("lead-request-step-identity")).toBeVisible();
    await expect.poll(() => calls.personalData).toEqual([{ middle_name: "Maria" }]);
    await expect.poll(() => calls.identification).toEqual([{ contact_channels: ["messenger"] }]);

    // Back on the step the entries are there, and nothing is sent a second time.
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-person")).toContainText("Maria");
    await expect(page.getByTestId("lead-request-summary-contact")).toContainText("Messenger");
    await step(page, "person");
    await expect(page.locator("#lead-request-middle_name")).toHaveValue("Maria");
    await expect(messenger).toBeChecked();
    await step(page, "documents");
    await expect(page.getByTestId("lead-request-documents")).toBeVisible();
    expect(calls.personalData).toHaveLength(1);
    expect(calls.identification).toHaveLength(1);
  });

  test("a hidden page saves the last entry at once, and closing the tab before it is saved asks first", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.clock.install();
    await page.goto("/");
    const middleName = page.locator("#lead-request-middle_name");
    await expect(middleName).toBeVisible();
    // The clock stands still: the autosave delay never runs out by itself.
    await page.clock.pauseAt(Date.now() + 1000);
    await middleName.pressSequentially("Maria");
    // The phone puts the browser away (another app): the entry is saved without the delay.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => calls.personalData).toEqual([{ middle_name: "Maria" }]);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    });

    // A new entry still waiting for the delay: closing the tab asks first.
    await middleName.press("End");
    await middleName.pressSequentially("nne");
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toEqual(["beforeunload"]);
    expect(page.isClosed()).toBe(false);

    // Saved: the tab closes without a question.
    await page.clock.runFor(1000);
    await expect.poll(() => calls.personalData).toEqual([{ middle_name: "Maria" }, { middle_name: "Marianne" }]);
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(dialogs).toEqual(["beforeunload"]);
  });

  test("the lead cabinet fits a phone screen, one step at a time", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The legal questions are follow-up block L since 2026-10-09: a sent request with that block open.
    await setup(page, "lead", { prepare: sentWithBlocks(["L"]) });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    // The dots carry no names on a phone: the current step is named below them.
    await step(page, "person");
    // Disclosure is part of the request; the live follow-up adds a seventh step.
    await expect(page.getByTestId("lead-request-step-title")).toContainText("Schritt 1 von 7 · Einwilligung & Person");
    expect(await widestOverhang(page, "lead-request-step-person")).toBeLessThanOrEqual(1);
    // The long legal questions wrap instead of widening the page.
    await step(page, "follow_up");
    await expect(page.getByTestId("lead-request-step-title")).toContainText("Ergänzende Angaben");
    await choose(page, page.getByTestId("lead-request-legal-pep_related").getByRole("combobox"), "Ja");
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-follow-up")).toBeLessThanOrEqual(1);
  });

  test("the payer block fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead", {
      prepare: (request) => {
        completeRequestWithPayer(request, {
          payer_type: "organisation",
          organisation_name: "Gemeinnützige-Beispielstiftung-für-internationale-Patientenhilfe e. V.",
          organisation_legal_form: "eingetragener Verein",
          organisation_register_number: null,
          organisation_contact_name: "Ben Muster",
          first_name: null,
          last_name: null,
          citizenships: [],
          relationship_kind: null,
          relationship: null,
          street: "Musterstraße 1",
          country: "DE",
          email: "kontakt@beispielstiftung.example.com",
        });
        // Why the organisation pays, instead of a relationship (owner 2026-10-11).
        request.identification.payment_background = "Stipendiengeberin-der-Patientin-seit-dem-Studium";
      },
    });
    await page.goto("/");
    await step(page, "billing");
    const payer = page.getByTestId("lead-request-payer");
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    // An organisation with its long name, the mask, why it pays and the consent with its hint.
    await expect(payer.getByRole("textbox", { name: "Name der Organisation" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toHaveValue("eingetragener Verein");
    await expect(payer.getByRole("textbox", { name: "Warum erfolgt die Zahlung über die Organisation?" })).toHaveValue(
      "Stipendiengeberin-der-Patientin-seit-dem-Studium",
    );
    await expect(payer.getByTestId("lead-request-payer-consent")).toContainText("Zugestimmt am 03.10.2026");
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-billing")).toBeLessThanOrEqual(1);
    // The fields are stacked: each is as wide as its card (owner 2026-10-09: the payer step is split into
    // cards), none is squeezed beside another.
    const width = async (locator: Locator) => Math.round((await locator.boundingBox())?.width ?? 0);
    const blockWidth = await width(page.locator("#lead-request-payer_organisation_name"));
    // Only the card's border and padding are between the step and a field.
    expect(blockWidth).toBeGreaterThan((await width(payer)) - 40);
    for (const field of [
      "payer_organisation_name",
      "payer_legal_form",
      "payer_contact_name",
      "payer_street",
      "payer_zip",
      "payer_city",
      "payer_phone",
      "payer_email",
    ]) {
      expect(await width(page.locator(`#lead-request-${field}`)), field).toBe(blockWidth);
    }

    // A private person: more fields, the same width; the list of relationships opens inside the screen.
    await choose(page, payer.getByRole("combobox", { name: WHO_PAYS }), "Eine Privatperson");
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toBeVisible();
    await payer.getByRole("combobox", { name: "Beziehung zu Ihnen" }).click();
    const optionEdge = await page
      .getByRole("option", { name: "Anderer Verwandter" })
      .evaluate((node) => node.getBoundingClientRect().right);
    expect(optionEdge).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-billing")).toBeLessThanOrEqual(1);

    // The summary wraps the long name.
    await choose(page, payer.getByRole("combobox", { name: WHO_PAYS }), "Eine Organisation");
    await payer.getByRole("textbox", { name: "Name der Organisation" }).fill("Gemeinnützige-Beispielstiftung-für-internationale-Patientenhilfe e. V.");
    // Leaving the step saves the last entry.
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Gemeinnützige-Beispielstiftung");
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-send")).toBeLessThanOrEqual(1);
  });

  test("the summary of a complete request fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead", {
      prepare: (request) => {
        completeRequest(request);
        request.identification.request_reason =
          "Zweitmeinung-zur-Knie-Operation-nach-Kreuzbandriss-mit-Meniskusschaden-und-Knorpelschaden-links";
      },
    });
    await page.goto("/");
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-legal")).toBeVisible();
    await expect(page.getByTestId("lead-request-declaration")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-send")).toBeLessThanOrEqual(1);
    // The send button stays reachable below the long summary.
    await expect(page.getByTestId("lead-request-submit")).toBeInViewport();
  });

  // The longer languages on a phone (language QA 2026-10-23): every step of a patient's and of a
  // parent's request fits 390 px in Ukrainian and English. Only a box that scrolls on its own (the
  // step tabs) may hold wider content. CABINET_SHOTS_DIR keeps a screenshot of every step.
  for (const access of ["self", "guardian"] as const) {
    for (const language of ["UA", "EN"] as const) {
      test(`every step fits 390 px in ${language} (${access === "self" ? "own request" : "a parent's request"})`, async ({ page }) => {
        await setup(page, "lead", {
          prepare: (request) => {
            completeRequestWithPayer(request);
            request.access_kind = access;
            request.submitted_at = "2026-10-03T09:30:00Z";
            request.follow_up = { required: true, blocks: ["A", "K", "L"], missing: {}, answered_at: null };
          },
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        // The request card's own switch: the frame's top switch shows until the card claims it.
        await page.getByTestId("lead-request").getByTestId("lead-cabinet-language").getByRole("radio", { name: language }).click();
        await expect(page.getByRole("heading", { name: language === "UA" ? /Ваша заявка|Заявка для/ : /Your request|Request for/ }).first()).toBeVisible();
        const steps = await page.locator("[data-step]").evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-step") ?? ""));
        expect(steps.length).toBeGreaterThan(4);
        for (const id of steps) {
          await step(page, id);
          await expect(page.locator(`[data-step="${id}"]`)).toHaveAttribute("aria-selected", "true");
          const overhang = await page.evaluate(() => {
            const width = document.documentElement.clientWidth;
            const scrollsOnItsOwn = (node: Element) => {
              for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const { overflowX } = getComputedStyle(parent);
                if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden" || overflowX === "clip") return true;
              }
              return false;
            };
            return Array.from(document.body.querySelectorAll("*"))
              .filter((node) => node.getBoundingClientRect().width > 0 && !scrollsOnItsOwn(node))
              .map((node) => ({ over: node.getBoundingClientRect().right - width, text: (node.textContent ?? "").slice(0, 60) }))
              .filter((item) => item.over > 1);
          });
          expect(overhang, `${language} ${access} step ${id}`).toEqual([]);
          const shots = process.env.CABINET_SHOTS_DIR;
          if (shots) {
            // The form scrolls in its own box: a tall window shows the whole step.
            await page.setViewportSize({ width: 390, height: 4200 });
            for (let part = 0; part < 3; part += 1) {
              const clip = { x: 0, y: part * 1400, width: 390, height: 1400 };
              await page.screenshot({ path: `${shots}/cabinet-${access}-${language}-${id}-${part}.png`, clip });
            }
            await page.setViewportSize({ width: 390, height: 844 });
          }
        }
      });
    }
  }
});

test.describe("patient portal after conversion", () => {
  test("a patient without a subscription keeps basic records and can fill in a new request", async ({ page }) => {
    await setup(page, "patient", { leadRequests: 1 });
    await page.goto("/");
    const nav = page.getByRole("navigation").filter({ has: page.getByRole("link", { name: "Ihre Anfrage", exact: true }) });
    for (const name of ["Meine Dokumente", "Meine Rechnungen", "Datenschutz", "Konto"]) {
      await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(nav.getByRole("button", { name: "Dashboard — Gesperrt", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Chat — Gesperrt", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Ihre Anfrage" })).toBeVisible();
    await nav.getByRole("link", { name: "Ihre Anfrage" }).click();
    await expect(page).toHaveURL(/\/request$/);
    await expect(page.getByTestId("lead-request")).toBeVisible();
  });
});

// Staff fill in the client's form from the wizard (owner decision 2026-10-29): the same form,
// every entry saved as staff's; what the client consented to staff record with how it was given;
// the send stays the client's own.
test.describe("the client's form filled in by staff", () => {
  const signInAsStaff = (page: Page) => page.route("**/api/v1/me", (route) => route.fulfill({
    json: {
      id: "staff-user",
      email: "petra.manager@example.com",
      name: "Petra Manager",
      role: "patient_manager",
      capabilities: ["leads.view", "leads.edit"],
      created_at: "2026-10-01T08:00:00Z",
      preferred_language: "de",
      password_change_required: false,
      portal_mode: null,
      lead_portal: null,
    },
  }));

  test("opens for staff with a banner; staff record a consent with how it was given; no send", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await signInAsStaff(page);
    await page.goto("/leads/lead-1/client-form");
    await expect(page.getByTestId("lead-request-staff-mode")).toBeVisible();
    // Staff record the client's consent with how it was given (owner 2026-10-29).
    const consent = page.getByTestId("lead-request-inquiry-consent");
    await page.route("**/api/v1/me/lead-requests/lead-1/consent", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body).toMatchObject({ purpose: "lead_inquiry_processing", recorded_how: "phone" });
      await route.fallback();
    });
    await consent.getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent-record-save")).toBeDisabled();
    await page.getByTestId("lead-request-inquiry-consent-record-how").selectOption("phone");
    await page.getByTestId("lead-request-inquiry-consent-record-save").click();
    await expect.poll(() => calls.consents).toEqual(["lead_inquiry_processing"]);
    await expect(consent.getByRole("checkbox")).toBeChecked();
    await page.locator("#lead-request-middle_name").fill("Maria");
    await page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" }).click();
    await expect.poll(() => calls.personalData).toEqual([{ middle_name: "Maria" }]);
    await step(page, "send");
    await expect(page.getByTestId("lead-request-submit")).toHaveCount(0);
  });

  test("staff record the client's consent form options with how the client gave them", async ({ page }) => {
    const { calls } = await setup(page, "lead", {
      prepare: (request) => Object.assign(request, { consent_form: { version: "2026-10-12", choices: null, chosen_at: null } }),
    });
    await signInAsStaff(page);
    const bodies: Record<string, unknown>[] = [];
    await page.route("**/api/v1/me/lead-requests/lead-1/consent-choices", async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      bodies.push(body);
      expect(body).toMatchObject({ recorded_how: "in_person", recorded_note: "Beratung vor Ort" });
      await route.fallback();
    });
    await page.goto("/leads/lead-1/client-form");
    await expect(page.getByTestId("lead-request-staff-mode")).toBeVisible();
    await step(page, "documents");
    const block = page.getByTestId("lead-request-consent-form");
    // Editable for staff; nothing saves on its own before staff say how the client chose.
    for (const name of [/behandelnden Ärzte/, /beauftragte Mitarbeitende/, /EDV-System/]) {
      await block.getByRole("checkbox", { name }).check();
    }
    await block.getByRole("checkbox", { name: "WhatsApp", exact: true }).check();
    const save = page.getByTestId("lead-request-consent-form-record-save");
    await expect(save).toBeDisabled();
    await page.getByTestId("lead-request-consent-form-record-how").selectOption("in_person");
    await page.getByTestId("lead-request-consent-form-record-note").fill("Beratung vor Ort");
    expect(bodies).toHaveLength(0);
    await save.click();
    await expect.poll(() => calls.consentChoices.length).toBe(1);
    expect(calls.consentChoices[0]).toMatchObject({
      version: "2026-10-12",
      recorded_how: "in_person",
      recorded_note: "Beratung vor Ort",
      choices: { agency_processing: true, doctors_to_agency: true, data_system: true, channel_whatsapp: true },
    });
    await expect(page.getByTestId("lead-request-consent-form-record")).toHaveCount(0);
    expect(bodies).toHaveLength(1);
  });
});
