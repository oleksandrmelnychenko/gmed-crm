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

// The statements of the identification the request cannot be sent without
// (the identity document's data are staff's since the trigger flow).
const IDENTITY_SUBMIT_FIELDS = ["birth_place", "birth_country"];

// The legal questions: yes or no only.
const LEGAL_QUESTIONS = ["pep_self", "pep_related", "sanctions_links"];

/** Opens a step of the cabinet by its tab. */
const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`).click();

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
                ...(mask && !payer.email && !payer.phone ? ["payer_email_or_phone"] : []),
                ...(payer.country ? [] : ["payer_country"]),
              ]
            : [
                ...(payer.first_name ? [] : ["payer_first_name"]),
                ...(payer.last_name ? [] : ["payer_last_name"]),
                ...(Array.isArray(payer.citizenships) && payer.citizenships.length > 0 ? [] : ["payer_citizenships"]),
              ]),
          ...(typed
            ? [
                ...(payer.relationship_kind ? [] : ["payer_relationship_kind"]),
                ...(payer.relationship_kind === "other" && !payer.relationship ? ["payer_relationship"] : []),
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
  if (identification) {
    missing.push(...IDENTITY_SUBMIT_FIELDS.filter((field) => !identification[field]));
    if (request.identity_documents.length === 0) missing.push("id_document_upload");
    // The own economic interest: the answer and, for a "no", the named person.
    if (payer?.acts_on_own_account == null) missing.push("payer_own_account");
    else if (payer?.acts_on_own_account === false && !payer.beneficial_owner) missing.push("payer_beneficial_owner");
    for (const question of LEGAL_QUESTIONS) {
      if (identification[question] == null) missing.push(question);
    }
    // The reason of the request (13.1), from a server that knows it.
    if ("request_reason" in identification && !identification.request_reason) missing.push("request_reason");
  }
  // A server that knows the representation (contract phase 1b-2) needs both answers of an adult.
  const representation = request.representation;
  if (representation) {
    if (representation.has_representative == null) missing.push("has_representative");
    if (representation.under_guardianship == null) missing.push("under_guardianship");
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
  // Nobody acts for the patient.
  if (request.representation) Object.assign(request.representation, { has_representative: false, under_guardianship: false });
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
    relationship_kind: "parent",
    contact_consent_at: "2026-10-03T09:16:00Z",
    ...payer,
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
    /** Bodies of POST …/payer/cost-estimate-consent (phase 3b, 11.2). */
    costEstimateConsent: [] as Record<string, unknown>[],
    identification: [] as Record<string, unknown>[],
    representation: [] as Record<string, unknown>[],
    billing: [] as Record<string, unknown>[],
    consents: [] as string[],
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

    // Step 1: the consent first, then the person.
    await page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox").click();
    await expect(page.getByTestId("lead-request-inquiry-consent").getByRole("checkbox")).toBeChecked();
    await expect(page.getByTestId("lead-request-inquiry-consent")).toContainText("Zugestimmt am 03.10.2026");
    expect(calls.consents).toEqual(["lead_inquiry_processing"]);

    // Step 2: the address, saved on its own.
    await page.getByRole("button", { name: "Weiter" }).click();
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

    await page.getByRole("button", { name: "Weiter" }).click();
    const send = page.getByTestId("lead-request-submit");
    const missing = page.getByTestId("lead-request-missing");
    // What is still missing, by step: the person, the identity copy, who pays, the invoice, the declarations, the reason.
    await expect(send).toBeDisabled();
    await expect(missing.getByTestId("lead-request-missing-person")).toContainText("Geburtsdatum");
    await expect(missing.getByTestId("lead-request-missing-person")).toContainText("Geburtsort");
    await expect(missing.getByTestId("lead-request-missing-person")).toContainText(
      "Handelt jemand für Sie (Vertreter/in, Bote/Botin, bevollmächtigte Person)?",
    );
    await expect(missing.getByTestId("lead-request-missing-person")).toContainText("Stehen Sie unter rechtlicher Betreuung?");
    await expect(missing.getByTestId("lead-request-missing-identity")).toContainText("Ausweisdokument: Foto oder Scan des Ausweises");
    await expect(missing.getByTestId("lead-request-missing-payer")).toContainText("Wer übernimmt die Kosten der Behandlung?");
    await expect(missing.getByTestId("lead-request-missing-billing")).toContainText("Wohin soll die Rechnung gehen?");
    await expect(missing.getByTestId("lead-request-missing-declarations")).toContainText("Gesetzliche Fragen: Öffentliches Amt");
    await expect(missing.getByTestId("lead-request-missing-declarations")).toContainText("Gesetzliche Fragen: Sanktionen");
    await expect(missing.getByTestId("lead-request-missing-documents")).toContainText("Grund der Anfrage");
    // The identity document's data are staff's; the payment route is asked later if at all.
    await expect(missing).not.toContainText("Art des Dokuments");
    await expect(missing).not.toContainText("Wie werden Sie bezahlen?");

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
    await page.locator("#lead-request-birth_place").fill("Kyiv");
    await choose(page, page.getByRole("combobox", { name: "Geburtsland" }), "Ukraine");
    await expect.poll(() => Object.assign({}, ...calls.identification)).toEqual({ birth_place: "Kyiv", birth_country: "UA" });

    // Nobody acts for the patient: both questions are answered with "no", and nobody is asked for.
    const representation = page.getByTestId("lead-request-representation");
    await choose(page, representation.getByRole("combobox", { name: /Handelt jemand für Sie/ }), "Nein");
    await choose(page, representation.getByRole("combobox", { name: "Stehen Sie unter rechtlicher Betreuung?" }), "Nein");
    await expect
      .poll(() => Object.assign({}, ...calls.representation))
      .toEqual({ has_representative: false, under_guardianship: false });
    await expect(representation.getByRole("group")).toHaveCount(0);

    await step(page, "contact");
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

    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await choose(page, payer.getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" }), "Ja");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: true });

    // The invoice goes to the patient; the payment route is no question of the base form any more.
    await step(page, "billing");
    await page.getByTestId("lead-request-billing").getByRole("radio", { name: "An mich", exact: true }).check();
    await expect.poll(() => calls.billing.at(-1)).toEqual({ invoice_to: "self" });
    await expect(page.getByTestId("lead-request-payment-route")).toHaveCount(0);

    // The three legal questions are answered with yes or no.
    await step(page, "declarations");
    for (const question of ["pep_self", "pep_related", "sanctions_links"]) {
      await choose(page, page.getByTestId(`lead-request-legal-${question}`).getByRole("combobox"), "Nein");
    }
    await expect
      .poll(() => Object.assign({}, ...calls.identification))
      .toMatchObject({ pep_self: false, pep_related: false, sanctions_links: false });

    await step(page, "documents");
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

    // The insurance block of the staff wizard is the patient's to fill in. A
    // change after sending is what "send again" is for.
    await step(page, "billing");
    const insurance = page.getByTestId("lead-request-insurance");
    await expect(insurance.getByRole("textbox", { name: "Versicherer" })).toHaveCount(0);
    await insurance.getByRole("combobox", { name: "Krankenversicherung vorhanden?" }).click();
    await page.getByRole("option", { name: "Ja", exact: true }).click();
    await insurance.getByRole("textbox", { name: "Versicherer" }).fill("Allianz Care");
    await expect
      .poll(() => calls.personalData.some((patch) => patch.has_insurance === "yes" && patch.insurance_provider === "Allianz Care"))
      .toBe(true);

    await step(page, "send");
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
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    const question = payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" });

    // Another person's fields exist only when another person pays.
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await expect(payer.getByRole("combobox", { name: "Wer ist der Zahler?" })).toHaveCount(0);
    await choose(page, question, "Eine andere Person oder Organisation");
    // A third party is a private person unless the patient says otherwise.
    await expect(payer.getByRole("combobox", { name: "Wer ist der Zahler?" })).toContainText("Privatperson");
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({ payer_kind: "third_party", payer_type: "person", messenger: "", contact_consent: false });
    await expect(payer).toContainText("Wir sind gesetzlich verpflichtet zu wissen, wer zahlt.");
    // Why the person pays is no question of the base form (follow-up block B).
    await expect(payer.getByRole("textbox", { name: /Warum übernimmt/ })).toHaveCount(0);

    // The send step says what the manager still needs about that person.
    await step(page, "send");
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("Zahler: Vorname");
    await expect(missing).toContainText("Zahler: Nachname");
    await expect(missing).toContainText("Zahler: Staatsangehörigkeit(en)");
    await expect(missing).toContainText("Zahler: Beziehung zur Patientin / zum Patienten");
    await expect(missing).toContainText("Zahler: Einverständnis zur Kontaktaufnahme");

    await step(page, "payer");
    await expect(question).toContainText("Eine andere Person oder Organisation");
    await payer.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await payer.getByRole("textbox", { name: "Nachname" }).fill(" Zahler ");
    await page.locator("#lead-request-payer_citizenships").click();
    await page.getByRole("option", { name: "Ukraine" }).first().click();
    await page.keyboard.press("Escape");
    await payer.getByRole("textbox", { name: "Ort", exact: true }).fill("München");
    // The block is saved as a whole, trimmed, without the empty fields.
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      city: "München",
      messenger: "",
      citizenships: ["UA"],
      contact_consent: false,
    });
    // The relationship is chosen from the list, and the payer may be contacted only with the consent.
    await choose(page, payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" }), "Elternteil");
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
    await step(page, "payer");
    await choose(page, question, "Ich selbst");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self" });
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    // What was typed about the person comes back with the answer; the consent is asked again.
    await choose(page, question, "Eine andere Person oder Organisation");
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveValue("Zahler");
    await expect(payer.getByTestId("lead-request-payer-consent").getByRole("checkbox")).not.toBeChecked();
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ payer_kind: "third_party", last_name: "Zahler", contact_consent: false });
  });

  test("a company as payer is named by its name, legal form, contact person and its seat, not as a person", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    const type = payer.getByRole("combobox", { name: "Wer ist der Zahler?" });
    const missing = page.getByTestId("lead-request-missing");

    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Eine andere Person oder Organisation");
    await payer.getByRole("textbox", { name: "Vorname" }).fill("Viktor");
    await payer.getByRole("textbox", { name: "Straße und Hausnummer" }).fill("Musterstraße 1");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ payer_type: "person", first_name: "Viktor" });

    // A company has the organisation mask and a seat; the fields of a natural person are gone, with what was typed in them.
    await choose(page, type, "Unternehmen");
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toHaveCount(0);
    await expect(page.locator("#lead-request-payer_date_of_birth")).toHaveCount(0);
    await expect(page.locator("#lead-request-payer_citizenships")).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Name des Unternehmens" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Registernummer (falls vorhanden)" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Ansprechperson" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Sitz (Straße und Hausnummer)" })).toHaveValue("Musterstraße 1");
    await expect(payer).not.toContainText("Bitte sagen Sie dieser Person");
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "company",
      street: "Musterstraße 1",
      messenger: "",
      contact_consent: false,
    });
    // Without the name, the legal form, the contact person, a way to reach it and the country of the seat
    // the request cannot be sent.
    await step(page, "send");
    await expect(missing).toContainText("Zahler: Name des Unternehmens");
    await expect(missing).toContainText("Zahler: Rechtsform");
    await expect(missing).toContainText("Zahler: Ansprechperson");
    await expect(missing).toContainText("Zahler: E-Mail oder Telefon");
    await expect(missing).toContainText("Zahler: Land des Sitzes");
    await expect(missing).toContainText("Zahler: Beziehung zur Patientin / zum Patienten");
    await expect(missing).not.toContainText("Zahler: Vorname");
    await expect(missing).not.toContainText("Zahler: Staatsangehörigkeit(en)");

    await step(page, "payer");
    await expect(type).toContainText("Unternehmen");
    await payer.getByRole("textbox", { name: "Name des Unternehmens" }).fill(" Beispiel GmbH ");
    await payer.getByRole("textbox", { name: "Rechtsform" }).fill("GmbH");
    await payer.getByRole("textbox", { name: "Ansprechperson" }).fill("Ben Muster");
    await payer.getByRole("textbox", { name: "E-Mail" }).fill("kontakt@example.com");
    await choose(page, payer.getByRole("combobox", { name: "Land des Sitzes" }), "Deutschland");
    await choose(page, payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" }), "Arbeitgeber");
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "company",
      organisation_name: "Beispiel GmbH",
      organisation_legal_form: "GmbH",
      organisation_contact_name: "Ben Muster",
      relationship_kind: "employer",
      street: "Musterstraße 1",
      country: "DE",
      email: "kontakt@example.com",
      messenger: "",
      contact_consent: false,
    });
    await step(page, "send");
    await expect(missing).not.toContainText("Name des Unternehmens");
    await expect(missing).not.toContainText("Land des Sitzes");
    await expect(missing).not.toContainText("E-Mail oder Telefon");
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Unternehmen");
    await expect(paying).toContainText("Beispiel GmbH");
    await expect(paying).toContainText("Ben Muster");
    await expect(paying).toContainText("Arbeitgeber");
    await expect(paying).toContainText("Sitz (Straße und Hausnummer)");
    await expect(paying).not.toContainText("Vorname");

    // An insurer is named the same way; a private person has no organisation mask.
    await step(page, "payer");
    await choose(page, type, "Versicherung");
    await expect(payer.getByRole("textbox", { name: "Name der Versicherung" })).toHaveValue("Beispiel GmbH");
    await choose(page, type, "Privatperson");
    await expect(payer.getByRole("textbox", { name: "Name der Versicherung" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toHaveCount(0);
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveValue("");
    await expect(payer.getByRole("textbox", { name: "Straße und Hausnummer", exact: true })).toHaveValue("Musterstraße 1");
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      relationship_kind: "employer",
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
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    const relationship = payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" });
    const inWords = payer.getByRole("textbox", { name: "Bitte angeben" });
    const missing = page.getByTestId("lead-request-missing");

    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Eine andere Person oder Organisation");
    // The list of the owner's form, in its order.
    await relationship.click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Ehepartner/in",
      "Elternteil",
      "Kind",
      "Bruder / Schwester",
      "Großmutter / Großvater",
      "anderer Verwandter",
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
    await expect(missing).toContainText("Zahler: Beziehung zur Patientin / zum Patienten – Bitte angeben");

    await step(page, "payer");
    await expect(relationship).toContainText("Sonstige");
    await inWords.fill("Nachbar");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ relationship_kind: "other", relationship: "Nachbar" });
    await page.locator('[data-step="send"]').click();
    await expect(missing).not.toContainText("Beziehung zur Patientin / zum Patienten");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Nachbar");

    // A relationship of the list needs no words: the text goes with the answer.
    await step(page, "payer");
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
    await step(page, "payer");
    const consent = page.getByTestId("lead-request-payer-consent");
    const missing = page.getByTestId("lead-request-missing");
    const send = page.getByTestId("lead-request-submit");
    const declaration = page.getByTestId("lead-request-declaration").getByRole("checkbox");

    await expect(consent).toContainText(
      "Ich bin einverstanden, dass GMED diese Person bzw. Organisation wegen der Kostenübernahme kontaktiert und ihr meinen Namen mitteilt.",
    );
    await expect(consent).toContainText("Ohne dieses Einverständnis dürfen wir den Zahler nicht ansprechen.");
    await expect(consent.getByRole("checkbox")).not.toBeChecked();

    // Everything else is there: the consent alone keeps the request from being sent.
    await page.locator('[data-step="send"]').click();
    await expect(missing.getByRole("listitem")).toHaveText(["Zahler: Einverständnis zur Kontaktaufnahme"]);
    await expect(page.getByTestId("lead-request-summary-payer")).not.toContainText("Einverständnis zur Kontaktaufnahme");
    await declaration.check();
    await expect(send).toBeDisabled();

    await step(page, "payer");
    await consent.getByRole("checkbox").check();
    await expect.poll(() => calls.payer.at(-1)).toEqual({
      payer_kind: "third_party",
      payer_type: "person",
      first_name: "Viktor",
      last_name: "Zahler",
      relationship_kind: "parent",
      messenger: "",
      citizenships: ["UA"],
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

    // Taken back, the consent is removed on the server and missing again.
    await step(page, "payer");
    await expect(consent.getByRole("checkbox")).toBeChecked();
    await consent.getByRole("checkbox").uncheck();
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({ contact_consent: false });
    await expect(consent).not.toContainText("Zugestimmt am");
    await page.locator('[data-step="send"]').click();
    await expect(missing).toContainText("Zahler: Einverständnis zur Kontaktaufnahme");
    await expect(page.getByTestId("lead-request-changed")).toBeVisible();
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
        prepared.submitted_at = "2026-10-03T09:30:00Z";
        prepared.identification.declared_correct_at = "2026-10-03T09:30:00Z";
      },
    });
    await page.goto("/");
    await step(page, "payer");
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
    await step(page, "payer");
    await expect(note).toBeVisible();
    await page.reload();
    await step(page, "payer");
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
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    const consent = page.getByTestId("lead-request-payer-cost-estimate-consent");
    const missing = page.getByTestId("lead-request-missing");

    // Below the consent to contact the payer, in the owner's words.
    await expect(consent).toContainText(
      "Ich willige ein, dass GMED der zahlenden Person den Kostenvoranschlag mit den voraussichtlichen Kosten übermittelt – nur Leistungsarten und Beträge, ohne Diagnosen und Behandlungsnamen.",
    );
    await expect(consent).toContainText(
      "Ohne diese Einwilligung können wir der zahlenden Person die Unterlagen zur Kostenübernahme nicht zur Unterschrift senden.",
    );
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
    await step(page, "payer");
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
    await step(page, "payer");
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
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    await expect(page.getByTestId("lead-request-payer-answered")).toBeVisible();
    // Read-only but for the lead's own statements: why the payer pays, and this consent.
    await expect(payer.getByRole("combobox")).toHaveCount(0);
    const consent = payer.getByTestId("lead-request-payer-cost-estimate-consent");
    await expect(consent.getByRole("checkbox")).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-payer")).toBeLessThanOrEqual(1);

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
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    const question = payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" });

    await question.click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Die Patientin / der Patient selbst",
      "Ich zahle (als Elternteil)",
      "Eine andere Person oder Organisation",
    ]);
    await page.getByRole("option", { name: "Ich zahle (als Elternteil)" }).click();

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
    await expect(payer.getByRole("combobox", { name: "Wer ist der Zahler?" })).toHaveCount(0);
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
    await expect(question).toContainText("Ich zahle (als Elternteil)");
    expect(calls.payer.some((body) => "contact_consent" in body)).toBe(false);

    // The answer is shown again after a reload, and in the summary.
    await page.reload();
    await step(page, "payer");
    await expect(question).toContainText("Ich zahle (als Elternteil)");
    await expect(payer.getByRole("textbox", { name: "Telefon" })).toHaveValue("+49 30 1112223");
    await expect(payer.getByRole("combobox", { name: "Wer ist der Zahler?" })).toHaveCount(0);
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    await page.locator('[data-step="send"]').click();
    const paying = page.getByTestId("lead-request-summary-payer");
    await expect(paying).toContainText("Ich zahle (als Elternteil)");
    await expect(paying).toContainText("Maria");
    await expect(paying).toContainText("Elternteil");
    // The consent to contact oneself is never missing.
    await expect(page.getByText("Zahler: Einverständnis zur Kontaktaufnahme")).toHaveCount(0);

    // Another person or organisation is somebody else: the parent's data do not stay.
    await step(page, "payer");
    await choose(page, question, "Eine andere Person oder Organisation");
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveValue("");
    await expect(payer.getByRole("textbox", { name: "Telefon" })).toHaveValue("");
    await expect(payer.getByRole("combobox", { name: "Wer ist der Zahler?" })).toContainText("Privatperson");
    await expect(payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" })).toContainText("Auswählen");
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({ payer_kind: "third_party", payer_type: "person", messenger: "", contact_consent: false });
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
    await step(page, "payer");
    const question = page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" });
    await question.click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Ich zahle (als Elternteil)",
      "Eine andere Person oder Organisation",
    ]);
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
    await step(page, "payer");
    const question = page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" });
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
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");

    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Eine andere Person oder Organisation");
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "third_party" });
    await expect(payer.getByRole("combobox", { name: "Wer ist der Zahler?" })).toHaveCount(0);
    await expect(payer.getByTestId("lead-request-payer-consent")).toHaveCount(0);
    await payer.getByRole("textbox", { name: "Nachname" }).fill("Zahler");
    await payer.getByRole("textbox", { name: "Beziehung zur Patientin / zum Patienten" }).fill("Vater");
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
    await expect(page.getByTestId("lead-request-step-identity")).toContainText("Die Angaben aus dem Dokument trägt GMED ein.");
    await expect(page.locator("#lead-request-id_document_type")).toHaveCount(0);
    await expect(page.locator("#lead-request-id_valid_until")).toHaveCount(0);
    // Like the health consent before the medical documents: no consent, no upload.
    await expect(button).toBeDisabled();
    await expect(page.locator("#lead-request-identity-files")).toBeDisabled();
    await expect(upload).toContainText(
      "Zum Hochladen bitte zuerst im Schritt „Einwilligung & Person“ der Verarbeitung Ihrer Angaben zustimmen.",
    );
    await expect(list).toContainText("Noch kein Ausweis hochgeladen.");
    await expect(upload).toContainText("Eine Kopie allein reicht möglicherweise nicht aus");

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
    await expect(page.getByTestId("lead-request-document-list")).toContainText("Noch keine Unterlagen hochgeladen.");
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-identity")).toContainText("reisepass.jpg");
    await expect(page.getByTestId("lead-request-missing")).not.toContainText("Foto oder Scan des Ausweises");

    // The own upload can be taken back.
    await step(page, "identity");
    await list.getByRole("button", { name: "Entfernen" }).click();
    await expect(list).toContainText("Noch kein Ausweis hochgeladen.");
  });

  test("acting for somebody else asks who that is", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "payer");
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
    await step(page, "send");
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing).toContainText("In wessen Interesse handeln Sie? (Name, Geburtsdatum, Geburtsort, Anschrift)");

    await step(page, "payer");
    await expect(ownAccount).toContainText("Nein");
    await person.fill("Viktor Zahler, 03.02.1960, Kyiv, Musterstraße 1, 10115 Berlin");
    await expect
      .poll(() => calls.payer.at(-1))
      .toEqual({
        payer_kind: "self",
        acts_on_own_account: false,
        beneficial_owner: "Viktor Zahler, 03.02.1960, Kyiv, Musterstraße 1, 10115 Berlin",
      });
    await step(page, "send");
    await expect(missing).not.toContainText("In wessen Interesse");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Viktor Zahler, 03.02.1960, Kyiv");

    // "Yes" names nobody.
    await step(page, "payer");
    await choose(page, ownAccount, "Ja");
    await expect(person).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).toEqual({ payer_kind: "self", acts_on_own_account: true });
  });

  test("the declarations are answered with yes or no only", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "declarations");
    const declarations = page.getByTestId("lead-request-step-declarations");
    const pepAnswer = page.getByTestId("lead-request-legal-pep_self").getByRole("combobox", { name: /Üben Sie ein hochrangiges öffentliches Amt aus/ });

    await expect(declarations).toContainText("Diese Fragen schreibt das Geldwäschegesetz vor.");
    // Three questions; the high-risk country is no question of the lead any more.
    await expect(page.getByTestId("lead-request-legal").getByRole("combobox")).toHaveCount(3);
    await expect(page.getByTestId("lead-request-legal-high_risk_country")).toHaveCount(0);
    await choose(page, pepAnswer, "Ja");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: true });
    // A "yes" asks no details here: GMED asks them later if it needs them.
    await expect(declarations.getByRole("textbox")).toHaveCount(0);
    await choose(page, pepAnswer, "Nein");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: false });
    await expect(page.getByTestId("lead-request-step-missing")).toContainText("Gesetzliche Fragen: Sanktionen");
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
    await expect(representation).toContainText("Handelt jemand für Sie");
    await expect(representation.locator("dd")).toHaveText(["Nein", "Nein"]);
    await expect(page.getByTestId("lead-request-summary-insurance")).toContainText("Noch keine Angaben");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Ich selbst");
    const billing = page.getByTestId("lead-request-summary-billing");
    await expect(billing).toContainText("Rechnung und Zahlung");
    await expect(billing).toContainText("An mich");
    const legal = page.getByTestId("lead-request-summary-legal");
    await expect(legal).toContainText("Üben Sie ein hochrangiges öffentliches Amt aus");
    await expect(legal.locator("dd")).toHaveText(["Nein", "Ja", "Nein"]);
    await expect(page.getByTestId("lead-request-summary-request")).toContainText("Zweitmeinung zur Knie-OP");
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
    await step(page, "declarations");
    await expect(page.getByTestId("lead-request-legal-pep_self")).toContainText("Übt die Patientin / der Patient ein hochrangiges öffentliches Amt aus");
    await expect(page.getByTestId("lead-request-legal-sanctions_links")).toContainText("Bestehen Verbindungen zu Personen oder Unternehmen");
    await step(page, "payer");
    await expect(
      page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Handelt die Patientin / der Patient im eigenen wirtschaftlichen Interesse?" }),
    ).toBeVisible();
    // Without the parent's own data on file the two usual answers are offered.
    await page.getByTestId("lead-request-payer").getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }).click();
    await expect(page.getByRole("option")).toHaveText([
      "Auswählen",
      "Die Patientin / der Patient selbst",
      "Eine andere Person oder Organisation",
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
    await step(page, "contact");
    await expect(page.getByTestId("lead-request-contact-channels")).toHaveCount(0);
    await step(page, "identity");
    await expect(page.getByTestId("lead-request-identity")).toHaveCount(0);
    await step(page, "payer");
    await expect(page.getByTestId("lead-request-payer").getByRole("combobox")).toHaveCount(1);
    await step(page, "billing");
    await expect(page.getByTestId("lead-request-billing")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payment-route")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toHaveCount(0);
    await step(page, "declarations");
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
    await choose(page, paymentRoute.getByRole("combobox", { name: "Wie werden Sie bezahlen?" }), "Bar");
    await expect.poll(() => calls.billing.at(-1)).toEqual({ payment_method: "cash" });
    // Its extras exist with the follow-up only.
    await expect(page.getByTestId("lead-request-payment-route-extras")).toHaveCount(0);
  });

  test("no insurance means self-payer and hides the details", async ({ page }) => {
    const { calls } = await setup(page, "lead");
    await page.goto("/");
    await step(page, "billing");
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
    await expect(page.getByRole("tab", { name: /Звернення й документи/ })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Прізвище", exact: true })).toBeVisible();

    await languages.getByRole("radio", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Review & send/ })).toBeVisible();

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
    const openCalendar = page.getByTestId("lead-request-step-person").locator("[data-picker-anchor] button").first();
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
    const next = page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" });
    // The form is longer than the screen; "Weiter" must not need scrolling.
    await expect(page.locator("#lead-request-first_name")).toBeInViewport();
    await expect(next).toBeInViewport();
    await next.click();
    await expect(page.getByTestId("lead-request-step-contact")).toBeVisible();
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
    await page.locator("#lead-request-birth_place").fill("Kyiv");
    expect(calls.personalData).toEqual([]);
    await page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-step-contact")).toBeVisible();
    await expect.poll(() => calls.personalData).toEqual([{ middle_name: "Maria" }]);
    await expect.poll(() => calls.identification).toEqual([{ birth_place: "Kyiv" }]);

    // Back on the step the entries are there, and nothing is sent a second time.
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-person")).toContainText("Maria");
    await expect(page.getByTestId("lead-request-summary-person")).toContainText("Kyiv");
    await step(page, "person");
    await expect(page.locator("#lead-request-middle_name")).toHaveValue("Maria");
    await expect(page.locator("#lead-request-birth_place")).toHaveValue("Kyiv");
    await step(page, "documents");
    await expect(page.getByTestId("lead-request-documents")).toBeVisible();
    expect(calls.personalData).toHaveLength(1);
    expect(calls.identification).toHaveLength(1);
  });

  test("the lead cabinet fits a phone screen, one step at a time", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead");
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Ihre Anfrage" })).toBeVisible();
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(1);
    // The dots carry no names on a phone: the current step is named below them.
    await expect(page.getByTestId("lead-request-step-title")).toContainText("Schritt 1 von 8 · Einwilligung & Person");
    expect(await widestOverhang(page, "lead-request-step-person")).toBeLessThanOrEqual(1);
    // The long legal questions wrap instead of widening the page.
    await step(page, "declarations");
    await expect(page.getByTestId("lead-request-step-title")).toContainText("Erklärungen");
    await choose(page, page.getByTestId("lead-request-legal-pep_related").getByRole("combobox"), "Ja");
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-declarations")).toBeLessThanOrEqual(1);
  });

  test("the payer block fits a phone screen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setup(page, "lead", {
      prepare: (request) =>
        completeRequestWithPayer(request, {
          payer_type: "organisation",
          organisation_name: "Gemeinnützige-Beispielstiftung-für-internationale-Patientenhilfe e. V.",
          organisation_legal_form: "eingetragener Verein",
          organisation_register_number: null,
          organisation_contact_name: "Ben Muster",
          first_name: null,
          last_name: null,
          citizenships: [],
          relationship_kind: "other",
          relationship: "Stipendiengeberin-der-Patientin-seit-dem-Studium",
          street: "Musterstraße 1",
          country: "DE",
          email: "kontakt@beispielstiftung.example.com",
        }),
    });
    await page.goto("/");
    await step(page, "payer");
    const payer = page.getByTestId("lead-request-payer");
    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    // An organisation with its long name, the mask, the relationship in words and the consent with its hint.
    await expect(payer.getByRole("textbox", { name: "Name der Organisation" })).toBeVisible();
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toHaveValue("eingetragener Verein");
    await expect(payer.getByRole("textbox", { name: "Bitte angeben" })).toBeVisible();
    await expect(payer.getByTestId("lead-request-payer-consent")).toContainText("Zugestimmt am 03.10.2026");
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-payer")).toBeLessThanOrEqual(1);
    // The fields are stacked: each is as wide as the block, none is squeezed beside another.
    const width = async (locator: Locator) => Math.round((await locator.boundingBox())?.width ?? 0);
    const blockWidth = await width(payer);
    for (const field of [
      "payer_organisation_name",
      "payer_legal_form",
      "payer_contact_name",
      "payer_relationship",
      "payer_street",
      "payer_zip",
      "payer_city",
      "payer_phone",
      "payer_email",
    ]) {
      expect(await width(page.locator(`#lead-request-${field}`)), field).toBe(blockWidth);
    }
    // The list of relationships opens inside the screen.
    await payer.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" }).click();
    const optionEdge = await page
      .getByRole("option", { name: "anderer Verwandter" })
      .evaluate((node) => node.getBoundingClientRect().right);
    expect(optionEdge).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option")).toHaveCount(0);
    expect(await overflow()).toBeLessThanOrEqual(1);

    // A private person: more fields, the same width.
    await choose(page, payer.getByRole("combobox", { name: "Wer ist der Zahler?" }), "Privatperson");
    await expect(payer.getByRole("textbox", { name: "Nachname" })).toBeVisible();
    expect(await overflow()).toBeLessThanOrEqual(1);
    expect(await widestOverhang(page, "lead-request-step-payer")).toBeLessThanOrEqual(1);

    // The summary wraps the long name and the long relationship.
    await choose(page, payer.getByRole("combobox", { name: "Wer ist der Zahler?" }), "Organisation");
    await payer.getByRole("textbox", { name: "Name der Organisation" }).fill("Gemeinnützige-Beispielstiftung-für-internationale-Patientenhilfe e. V.");
    // Leaving the step saves the last entry.
    await step(page, "send");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Gemeinnützige-Beispielstiftung");
    await expect(page.getByTestId("lead-request-summary-payer")).toContainText("Stipendiengeberin");
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
