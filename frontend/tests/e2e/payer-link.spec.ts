import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { lazyPageLoad } from "./lazy-pages";

// The payer's own link (contract phase 3a, 5.1): a public page without an
// account, `/payer#<token>`, opened with a code mailed to the payer. The API
// is mocked as the contract describes it (section 3), with synthetic data.
// Every test also checks that the page never calls an authenticated route.

const TOKEN = "0123456789abcdef".repeat(4);
const OTHER_TOKEN = "fedcba9876543210".repeat(4);
const SESSION = "5e55".repeat(16);
const OTHER_SESSION = "0e55".repeat(16);
const CODE = "482915";
const TODAY = "2026-10-06";

type PayerType = "person" | "company" | "organisation" | "insurance";

type Owner = Record<string, string | number | null>;

type Doc = {
  id: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  uploaded_at: string;
  reviewed: boolean;
  can_delete: boolean;
};

type Answers = Record<string, unknown> & {
  citizenships: string[];
  funds_sources: string[];
  beneficial_owners: Owner[];
};

type Route8 = Record<string, unknown> & { asked: boolean };

type Questionnaire = {
  patient_name: string;
  source: "link";
  payer_type: PayerType;
  state: "draft" | "submitted";
  email: string;
  email_confirmed_at: string | null;
  privacy: { acknowledged_at: string | null; text_version: string; contact_channels: string[] };
  answers: Answers;
  payment_route: Route8;
  identity_documents: Doc[];
  funds_proof_documents: Doc[];
  funds_proof_required: boolean;
  /** The sources of funds of the payer type, as the server lists them. */
  funds_source_options: string[];
  missing_for_submit: string[];
  declared_correct_at: string | null;
  submitted_at: string | null;
};

const PERSON_FUNDS_SOURCES = ["employment", "business_income", "savings", "asset_sale", "inheritance_gift", "other"];
const ORGANISATION_FUNDS_SOURCES = ["business_revenue", "equity", "loan", "insurance_benefit", "donation", "other"];

const TEXT_KEYS = [
  "salutation",
  "first_name",
  "last_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "street",
  "zip",
  "city",
  "country",
  "habitual_residence_country",
  "phone",
  "language",
  "id_document_type",
  "id_document_number",
  "id_issuing_authority",
  "id_issuing_country",
  "id_issued_on",
  "id_valid_until",
  "organisation_name",
  "register_court",
  "register_number",
  "representative_first_name",
  "representative_last_name",
  "representative_role",
  "relationship_kind",
  "relationship",
  "occupation",
  "industry",
  "funds_description",
  "pep_self_details",
  "pep_related_details",
  "high_risk_country_code",
  "sanctions_links_details",
];
const BOOLEAN_KEYS = ["pep_self", "pep_related", "high_risk_country", "sanctions_links", "beneficial_owners_none"];
const ROUTE_KEYS = [
  "payment_method",
  "payment_method_details",
  "account_country",
  "account_holder",
  "bank_name",
  "via_third_party",
  "via_third_party_details",
];
const PERSON_ONLY = [
  "salutation",
  "first_name",
  "last_name",
  "former_names",
  "date_of_birth",
  "birth_place",
  "birth_country",
  "citizenships",
  "habitual_residence_country",
  "occupation",
];
const ORGANISATION_ONLY = [
  "organisation_name",
  "register_court",
  "register_number",
  "representative_first_name",
  "representative_last_name",
  "representative_role",
  "beneficial_owners",
  "beneficial_owners_none",
  "industry",
];
const ALL_ANSWER_KEYS = [...TEXT_KEYS, ...BOOLEAN_KEYS, "citizenships", "funds_sources", "beneficial_owners"];

function emptyAnswers(): Answers {
  const answers: Record<string, unknown> = {};
  for (const key of [...TEXT_KEYS, ...BOOLEAN_KEYS]) answers[key] = null;
  return { ...answers, citizenships: [], funds_sources: [], beneficial_owners: [] };
}

function emptyRoute(): Route8 {
  return {
    payment_method: null,
    payment_method_details: null,
    account_country: null,
    account_holder: null,
    bank_name: null,
    via_third_party: null,
    via_third_party_details: null,
    account_holder_suggestion: "Viktor Zahler",
    asked: true,
  };
}

/** The payer as the lead declared it: the effective values the questionnaire starts with (contract D2). */
function declaredPerson(): Partial<Answers> {
  return {
    first_name: "Viktor",
    last_name: "Zahler",
    date_of_birth: "1970-02-03",
    citizenships: ["AT"],
    street: "Musterweg 5",
    zip: "1010",
    city: "Wien",
    country: "AT",
  };
}

function declaredCompany(): Partial<Answers> {
  return { organisation_name: "Beispiel GmbH", street: "Musterstraße 1", zip: "10115", city: "Berlin", country: "DE" };
}

function document(id: string, name: string): Doc {
  return {
    id,
    file_name: name,
    size_bytes: 2048,
    mime_type: "application/pdf",
    uploaded_at: "2026-10-06T10:05:00Z",
    reviewed: false,
    can_delete: true,
  };
}

/** Everything a person or an organisation answers, complete, without the privacy acknowledgement. */
function completeAnswers(payerType: PayerType): Partial<Answers> {
  const shared = {
    id_document_type: "passport",
    id_document_number: "P1234567",
    id_issuing_authority: "BH Wien",
    id_issuing_country: "AT",
    id_valid_until: "2031-03-04",
    relationship_kind: "friend",
    funds_sources: ["savings"],
    pep_self: false,
    pep_related: false,
    high_risk_country: false,
    sanctions_links: false,
  };
  return payerType === "person"
    ? { ...declaredPerson(), birth_place: "Wien", birth_country: "AT", occupation: "Ingenieur", ...shared }
    : {
        ...declaredCompany(),
        register_court: "Amtsgericht Berlin-Charlottenburg",
        register_number: "HRB 12345",
        representative_first_name: "Ben",
        representative_last_name: "Muster",
        industry: "Handel",
        beneficial_owners_none: true,
        ...shared,
        relationship_kind: "employer",
        funds_sources: ["business_revenue"],
      };
}

function completeRoute(): Partial<Route8> {
  return {
    payment_method: "bank_transfer",
    account_country: "DE",
    account_holder: "Viktor Zahler",
    bank_name: "Musterbank",
    via_third_party: false,
  };
}

const empty = (value: unknown) => value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);

type Options = {
  payerType?: PayerType;
  linkStatus?: "active" | "revoked" | "expired" | "locked";
  language?: string;
  /** A code was mailed this long ago (the page then shows the code field at once). */
  codeSentSecondsAgo?: number;
  /** Five codes in the last hour: "send" is refused with 429. */
  hourlyCodeLimitReached?: boolean;
  /** Wrong codes in total before the link locks (contract: 10). */
  lockAfterWrong?: number;
  /**
   * The patient's side requires the enhanced check (owner rule 2026-10-07: a
   * black-list country or a confirmed sanctions match of the patient): check
   * level 2, whatever the payer answers.
   */
  enhancedCheckRequired?: boolean;
  /** Signed in already (a session from an earlier visit of this tab). */
  answers?: Partial<Answers>;
  route?: Partial<Route8>;
  acknowledged?: boolean;
  identityDocuments?: Doc[];
  /** `OTHER_TOKEN` is a second valid link for the same payer, with its own code and session. */
  secondLink?: boolean;
  /** The payer sent the details before (with `answers`, `route`, `identityDocuments` complete). */
  submitted?: boolean;
  /**
   * Phase 3b, 4.4: the documents for the payer's signature as the link's GET
   * names them; left out, the key is absent (an older server). Changeable
   * later through `signature.value`.
   */
  signaturePackage?: Record<string, unknown> | null;
  /** The link's GET names the package only with a valid session. */
  signaturePackageWithSession?: boolean;
};

type Call = {
  method: string;
  path: string;
  url: string;
  link: string | undefined;
  session: string | undefined;
  body: unknown;
};

async function setup(page: Page, options: Options = {}) {
  const payerType = options.payerType ?? "person";
  const q: Questionnaire = {
    patient_name: "Mia Muster",
    source: "link",
    payer_type: payerType,
    state: "draft",
    email: "viktor.zahler@example.com",
    email_confirmed_at: null,
    privacy: {
      acknowledged_at: options.acknowledged ? "2026-10-06T10:03:00Z" : null,
      text_version: "payer-privacy-2026-10-06",
      contact_channels: options.acknowledged ? ["email"] : [],
    },
    answers: { ...emptyAnswers(), ...(payerType === "person" ? declaredPerson() : declaredCompany()), ...options.answers } as Answers,
    payment_route: { ...emptyRoute(), ...options.route },
    identity_documents: options.identityDocuments ?? [],
    funds_proof_documents: [],
    funds_proof_required: false,
    funds_source_options: payerType === "person" ? PERSON_FUNDS_SOURCES : ORGANISATION_FUNDS_SOURCES,
    missing_for_submit: [],
    declared_correct_at: options.submitted ? "2026-10-06T10:30:00Z" : null,
    submitted_at: options.submitted ? "2026-10-06T10:30:00Z" : null,
  };
  if (options.submitted) q.state = "submitted";
  /** The signature package the server names; `undefined` leaves the key out. */
  const signature: { value: Record<string, unknown> | null | undefined } = { value: options.signaturePackage };
  const state = {
    status: options.linkStatus ?? "active",
    codeSentAt: options.codeSentSecondsAgo !== undefined ? Date.now() - options.codeSentSecondsAgo * 1000 : (null as number | null),
    attemptsLeft: 5,
    wrongTotal: 0,
    session: null as string | null,
    documents: 0,
  };
  /** The second link (`OTHER_TOKEN`), when the test has one: its own status, code and session. */
  const second: typeof state = { status: "active", codeSentAt: null, attemptsLeft: 5, wrongTotal: 0, session: null, documents: 0 };
  const calls = {
    payer: [] as Call[],
    /** Any other API call: none may happen on this page. */
    others: [] as string[],
    /** Bodies of POST …/questionnaire, in order. */
    patches: [] as Record<string, unknown>[],
    /** Keys of a patch whose value was already stored: the page sends changed keys only. */
    unchanged: [] as string[],
  };

  const recompute = () => {
    const a = q.answers;
    const r = q.payment_route;
    const organisation = payerType !== "person";
    // Like the server (owner rule 2026-10-07): only the black list and a
    // confirmed sanctions match require the enhanced check and so the proof
    // of funds; a PEP, the high-risk question, cash or crypto do not.
    const blacklisted = (code: unknown) => typeof code === "string" && ["KP", "IR", "MM"].includes(code);
    const level2 =
      options.enhancedCheckRequired ||
      blacklisted(a.country) ||
      blacklisted(a.habitual_residence_country) ||
      (!organisation && Array.isArray(a.citizenships) && a.citizenships.some(blacklisted));
    q.funds_proof_required = Boolean(level2);
    const missing: string[] = [];
    const need = (...keys: string[]) => {
      for (const key of keys) if (empty(a[key])) missing.push(key);
    };
    if (!q.privacy.acknowledged_at) missing.push("privacy_ack");
    if (organisation) {
      need("organisation_name", "street", "zip", "city", "country");
      if (payerType === "company") need("register_court", "register_number");
      need("representative_first_name", "representative_last_name");
    } else {
      need("first_name", "last_name", "date_of_birth", "birth_place", "birth_country", "citizenships", "street", "zip", "city", "country");
    }
    need("id_document_type", "id_document_number", "id_issuing_authority", "id_issuing_country", "id_valid_until");
    if (q.identity_documents.length === 0) missing.push("id_document_upload");
    if (payerType === "company" && a.beneficial_owners_none !== true && a.beneficial_owners.length === 0) missing.push("beneficial_owners");
    need("relationship_kind");
    if (a.relationship_kind === "other") need("relationship");
    need(organisation ? "industry" : "occupation");
    need("funds_sources");
    if (a.funds_sources.includes("other")) need("funds_description");
    if (level2 && q.funds_proof_documents.length === 0) missing.push("funds_proof_upload");
    if (r.asked) {
      if (empty(r.payment_method)) missing.push("payment_method");
      if (r.payment_method === "other" && empty(r.payment_method_details)) missing.push("payment_method_details");
      if (r.payment_method === "bank_transfer" || r.payment_method === "card") {
        if (empty(r.account_country)) missing.push("account_country");
        if (empty(r.account_holder)) missing.push("account_holder");
      }
      if (r.payment_method === "bank_transfer" && empty(r.bank_name)) missing.push("bank_name");
      if (r.via_third_party === null) missing.push("via_third_party");
      if (r.via_third_party === true && empty(r.via_third_party_details)) missing.push("via_third_party_details");
    }
    for (const [question, details] of [
      ["pep_self", "pep_self_details"],
      ["pep_related", "pep_related_details"],
      ["high_risk_country", "high_risk_country_code"],
      ["sanctions_links", "sanctions_links_details"],
    ]) {
      if (a[question] === null) missing.push(question);
      if (a[question] === true && empty(a[details])) missing.push(details);
    }
    q.missing_for_submit = missing;
  };
  recompute();

  /** What the server clears by itself (contract 3.4 and phase 2). */
  const clearDependents = () => {
    const a = q.answers;
    const r = q.payment_route;
    for (const [question, details] of [
      ["pep_self", "pep_self_details"],
      ["pep_related", "pep_related_details"],
      ["high_risk_country", "high_risk_country_code"],
      ["sanctions_links", "sanctions_links_details"],
    ]) {
      if (a[question] !== true) a[details] = null;
    }
    if (a.relationship_kind !== "other") a.relationship = null;
    if (a.habitual_residence_country && a.habitual_residence_country === a.country) a.habitual_residence_country = null;
    if (r.payment_method !== "other") r.payment_method_details = null;
    if (r.payment_method !== "bank_transfer" && r.payment_method !== "card") {
      r.account_country = null;
      r.account_holder = null;
      r.bank_name = null;
    }
    if (r.via_third_party !== true) r.via_third_party_details = null;
  };

  const view = () => JSON.parse(JSON.stringify(q)) as Questionnaire;
  const refuse = (route: Route, status: number, code: string, extra: Record<string, unknown> = {}) =>
    route.fulfill({ status, json: { error: "refused", code, message: code, ...extra } });

  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = req.method();
    if (!path.startsWith("/public/payer-link")) {
      calls.others.push(`${method} ${path}`);
      return route.fulfill({ status: 404, json: { error: "Not Found", code: "not_mocked" } });
    }
    const headers = req.headers();
    let body: unknown = null;
    const contentType = headers["content-type"] ?? "";
    if (contentType.includes("application/json")) body = req.postDataJSON();
    else if (contentType.includes("multipart/form-data")) {
      body = { file: /filename="([^"]+)"/.exec(req.postDataBuffer()?.toString("latin1") ?? "")?.[1] ?? null };
    }
    calls.payer.push({ method, path, url: req.url(), link: headers["x-payer-link"], session: headers["x-payer-session"], body });

    // The token on every call (contract 3).
    const link = headers["x-payer-link"] === TOKEN ? state : options.secondLink && headers["x-payer-link"] === OTHER_TOKEN ? second : null;
    if (!link) return refuse(route, 401, "link_invalid");
    if (link.status === "revoked") return refuse(route, 410, "link_revoked");
    if (link.status === "expired") return refuse(route, 410, "link_expired");
    if (link.status === "locked") return refuse(route, 423, "link_locked");

    const sessionValid = Boolean(link.session) && headers["x-payer-session"] === link.session;

    if (path === "/public/payer-link" && method === "GET") {
      return route.fulfill({
        json: {
          state: q.state === "submitted" ? "submitted" : sessionValid ? "active" : "code_required",
          patient_name: q.patient_name,
          payer_type: payerType,
          email_masked: "v***r@example.com",
          language: options.language ?? "de",
          expires_at: "2026-11-05T10:00:00Z",
          code_sent_at: link.codeSentAt ? new Date(link.codeSentAt).toISOString() : null,
          session_valid: sessionValid,
          ...(signature.value !== undefined && (sessionValid || !options.signaturePackageWithSession)
            ? { signature_package: signature.value }
            : {}),
        },
      });
    }
    if (path === "/public/payer-link/code" && method === "POST") {
      if (link.codeSentAt && Date.now() - link.codeSentAt < 60_000) {
        return refuse(route, 429, "code_rate_limited", { retry_after_seconds: Math.ceil((60_000 - (Date.now() - link.codeSentAt)) / 1000) });
      }
      if (options.hourlyCodeLimitReached) return refuse(route, 429, "code_rate_limited", { retry_after_seconds: 42 });
      link.codeSentAt = Date.now();
      link.attemptsLeft = 5;
      return route.fulfill({ status: 202, json: { sent_at: new Date(link.codeSentAt).toISOString(), resend_after_seconds: 60 } });
    }
    if (path === "/public/payer-link/verify" && method === "POST") {
      const code = (body as { code?: string } | null)?.code;
      // The server says why a code no longer works: used up by wrong entries, or expired.
      if (!link.codeSentAt) return refuse(route, 422, "code_expired", { reason: "expired" });
      if (link.attemptsLeft <= 0) return refuse(route, 422, "code_expired", { reason: "too_many_attempts" });
      if (code !== CODE) {
        link.wrongTotal += 1;
        link.attemptsLeft -= 1;
        if (link.wrongTotal >= (options.lockAfterWrong ?? 10)) {
          link.status = "locked";
          return refuse(route, 423, "link_locked");
        }
        if (link.attemptsLeft <= 0) return refuse(route, 422, "code_expired", { reason: "too_many_attempts" });
        return refuse(route, 422, "code_invalid", { attempts_left: link.attemptsLeft });
      }
      link.session = link === state ? SESSION : OTHER_SESSION;
      q.email_confirmed_at = "2026-10-06T10:02:00Z";
      return route.fulfill({ json: { session: link.session, session_expires_at: "2026-10-06T11:02:00Z", questionnaire: view() } });
    }

    // From here on the session is needed (3.4).
    if (!headers["x-payer-session"]) return refuse(route, 401, "session_required");
    if (!sessionValid) return refuse(route, 401, "session_expired");

    if (path === "/public/payer-link/questionnaire" && method === "GET") return route.fulfill({ json: view() });
    if (path === "/public/payer-link/consent" && method === "POST") {
      const input = body as { acknowledged?: boolean; contact_channels?: string[] };
      if (input.acknowledged !== true) return refuse(route, 422, "invalid_field", { field: "acknowledged" });
      q.privacy.acknowledged_at ??= "2026-10-06T10:03:00Z";
      q.privacy.contact_channels = input.contact_channels ?? [];
      recompute();
      return route.fulfill({ json: view() });
    }
    if (path === "/public/payer-link/questionnaire" && method === "POST") {
      const patch = body as Record<string, unknown>;
      calls.patches.push(patch);
      if (!q.privacy.acknowledged_at) return refuse(route, 403, "payer_consent_required");
      if (q.state === "submitted") return refuse(route, 409, "payer_submitted");
      const otherType = payerType === "person" ? ORGANISATION_ONLY : PERSON_ONLY;
      for (const key of Object.keys(patch)) {
        const known = ALL_ANSWER_KEYS.includes(key) || (ROUTE_KEYS.includes(key) && q.payment_route.asked);
        if (!known || otherType.includes(key)) return refuse(route, 422, "invalid_field", { field: key });
      }
      const validUntil = patch.id_valid_until;
      if (typeof validUntil === "string" && validUntil && validUntil < TODAY) {
        return refuse(route, 422, "id_document_expired", { field: "id_valid_until" });
      }
      for (const [key, value] of Object.entries(patch)) {
        const target = (ROUTE_KEYS.includes(key) ? q.payment_route : q.answers) as Record<string, unknown>;
        const stored = value === "" ? null : value;
        if (JSON.stringify(target[key] ?? null) === JSON.stringify(stored)) calls.unchanged.push(key);
        target[key] = stored;
      }
      clearDependents();
      recompute();
      return route.fulfill({ json: view() });
    }
    if ((path === "/public/payer-link/identity-document" || path === "/public/payer-link/funds-proof") && method === "POST") {
      if (!q.privacy.acknowledged_at) return refuse(route, 403, "payer_consent_required");
      state.documents += 1;
      const name = (body as { file?: string } | null)?.file ?? "file.pdf";
      const list = path.endsWith("identity-document") ? q.identity_documents : q.funds_proof_documents;
      list.push(document(`doc-${state.documents}`, name));
      recompute();
      return route.fulfill({ status: 201, json: view() });
    }
    const removal = /^\/public\/payer-link\/documents\/([^/]+)$/.exec(path);
    if (removal && method === "DELETE") {
      const id = decodeURIComponent(removal[1]);
      q.identity_documents = q.identity_documents.filter((item) => item.id !== id);
      q.funds_proof_documents = q.funds_proof_documents.filter((item) => item.id !== id);
      recompute();
      return route.fulfill({ json: view() });
    }
    if (path === "/public/payer-link/submit" && method === "POST") {
      recompute();
      if (q.missing_for_submit.length > 0) return refuse(route, 422, "questionnaire_incomplete", { missing: q.missing_for_submit });
      if ((body as { declared_correct?: boolean } | null)?.declared_correct !== true) return refuse(route, 422, "declaration_required");
      q.state = "submitted";
      q.declared_correct_at = "2026-10-06T10:30:00Z";
      q.submitted_at = "2026-10-06T10:30:00Z";
      return route.fulfill({ json: view() });
    }
    return refuse(route, 404, "not_found");
  });

  return { q, state, second, calls, signature };
}

/** Sets a date field (a date picker that takes "DD.MM.YYYY") like typing does. */
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

/** Picks an option of one of the page's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** How far anything on the page reaches beyond the right edge of the screen. */
function widestOverhang(page: Page) {
  return page.getByTestId("payer-link-page").evaluate((root) => {
    const width = document.documentElement.clientWidth;
    return Math.max(0, ...Array.from(root.querySelectorAll("*"), (node) => node.getBoundingClientRect().right - width));
  });
}

const stored = (page: Page, key: string) => page.evaluate((name) => sessionStorage.getItem(name), key);

/** Opens the link and confirms the mailed code. */
async function signIn(page: Page) {
  await page.goto(`/payer#${TOKEN}`);
  await page.getByTestId("payer-link-send-code").click(lazyPageLoad);
  await page.getByLabel("Bestätigungscode (6 Ziffern)").fill(CODE);
  await page.getByTestId("payer-link-verify").click();
  await expect(page.getByTestId("payer-link-form")).toBeVisible();
}

/** Acknowledges the privacy notice and leaves step 1. */
async function acknowledge(page: Page, channels: string[] = ["E-Mail"]) {
  const step = page.getByTestId("payer-link-step-privacy");
  for (const channel of channels) await step.getByRole("checkbox", { name: channel, exact: true }).check();
  await step.getByRole("checkbox", { name: /Ich habe die Datenschutzhinweise gelesen/ }).check();
  await expect(page.getByTestId("payer-link-next")).toBeEnabled();
  await page.getByTestId("payer-link-next").click();
}

const next = (page: Page) => page.getByTestId("payer-link-next").click();
const stepTitle = (page: Page) => page.getByTestId("payer-link-step-title");
const merged = (patches: Record<string, unknown>[]) => Object.assign({}, ...patches) as Record<string, unknown>;

test.describe("payer link", () => {
  // A payer in Germany: before the link names its language, the page follows the browser.
  test.use({ locale: "de-DE" });

  test("the token leaves the address at once, and the mailed code opens the questionnaire", async ({ page }) => {
    const { calls, state } = await setup(page);
    await page.goto(`/payer#${TOKEN}`);
    await expect(page.getByTestId("payer-link-code-step")).toBeVisible(lazyPageLoad);

    // Neither in the address bar nor in the history: only in this tab's storage.
    expect(new URL(page.url()).pathname).toBe("/payer");
    expect(page.url()).not.toContain(TOKEN);
    expect(await page.evaluate(() => window.location.hash)).toBe("");
    expect(await stored(page, "gmed-payer-link")).toBe(TOKEN);

    await expect(page.getByRole("heading", { name: "Angaben zur Kostenübernahme" })).toBeVisible();
    await expect(page.getByTestId("payer-link-named")).toHaveText("Mia Muster hat Sie als zahlende Person für eine Anfrage bei GMED benannt.");
    await expect(page.getByTestId("payer-link-code-target")).toHaveText("Wir senden einen Bestätigungscode an v***r@example.com.");
    await expect(page.getByText("Der Link ist gültig bis 05.11.2026.")).toBeVisible();
    // Nothing of the questionnaire before the code.
    await expect(page.getByTestId("payer-link-form")).toHaveCount(0);

    await page.getByRole("button", { name: "Code senden" }).click();
    await expect(page.getByTestId("payer-link-code-target")).toHaveText(
      "Wir haben einen Code an v***r@example.com gesendet. Er ist 15 Minuten gültig.",
    );
    const resend = page.getByTestId("payer-link-resend");
    await expect(resend).toHaveText(/^Code erneut senden \(in (60|59|58|57) s\)$/);
    await expect(resend).toBeDisabled();
    const code = page.getByLabel("Bestätigungscode (6 Ziffern)");
    await expect(code).toHaveAttribute("inputmode", "numeric");
    await expect(code).toHaveAttribute("autocomplete", "one-time-code");
    await expect(code).toBeFocused();

    // A wrong code says how many tries are left.
    await code.fill("000000");
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByTestId("payer-link-code-error")).toHaveText("Der Code ist nicht richtig. Sie haben noch 4 Versuche.");

    // Letters are dropped; the right code opens step 1.
    await code.fill(`${CODE.slice(0, 3)} ${CODE.slice(3)}`);
    await expect(code).toHaveValue(CODE);
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByTestId("payer-link-step-privacy")).toBeVisible();
    await expect(stepTitle(page)).toHaveText("Datenschutz");
    await expect(page.getByTestId("payer-link-step-of")).toHaveText("Schritt 1 von 7");
    expect(await stored(page, "gmed-payer-session")).toBe(SESSION);

    // Nothing else can be done before the acknowledgement.
    await expect(page.getByTestId("payer-link-next")).toBeDisabled();
    await expect(page.getByText("Bitte bestätigen Sie zuerst die Datenschutzhinweise.")).toBeVisible();
    await expect(page.getByTestId("payer-link-privacy-notice")).toContainText("§§ 10–12 GwG");
    await expect(page.getByRole("link", { name: "Vollständige Datenschutzhinweise" })).toHaveAttribute("href", "/legal#privacy");

    // A reload keeps the session of this tab: no new code.
    await page.reload();
    await expect(page.getByTestId("payer-link-form")).toBeVisible(lazyPageLoad);
    expect(new URL(page.url()).pathname).toBe("/payer");

    // The secrets travel in headers only; the code only in the body of "confirm".
    expect(calls.payer.length).toBeGreaterThan(4);
    for (const call of calls.payer) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.url).not.toContain(SESSION);
      expect(call.url).not.toContain(CODE);
      expect(call.link).toBe(TOKEN);
    }
    const verifies = calls.payer.filter((call) => call.path === "/public/payer-link/verify");
    expect(verifies.map((call) => call.body)).toEqual([{ code: "000000" }, { code: CODE }]);
    expect(calls.payer.filter((call) => call.path === "/public/payer-link/questionnaire").every((call) => call.session === SESSION)).toBe(true);

    // The session ends: back to the code, the link stays.
    state.session = "e".repeat(64);
    // A click, not `check()`: the refused save takes the page back to the
    // code before the box could be seen ticked.
    await page.getByTestId("payer-link-step-privacy").getByRole("checkbox", { name: /Ich habe die Datenschutzhinweise gelesen/ }).click();
    await expect(page.getByTestId("payer-link-code-step")).toBeVisible();
    await expect(page.getByTestId("payer-link-code-notice")).toHaveText(
      "Ihre Sitzung ist abgelaufen. Bitte fordern Sie einen neuen Code an. Ihre Angaben bleiben gespeichert.",
    );
    expect(await stored(page, "gmed-payer-link")).toBe(TOKEN);
    expect(await stored(page, "gmed-payer-session")).toBeNull();

    // No call of the staff app: no /me, no other route.
    expect(calls.others).toEqual([]);
  });

  test("the code waits for the server's cooldown, and too many wrong codes lock the link", async ({ page }) => {
    const { calls } = await setup(page, { codeSentSecondsAgo: 120, hourlyCodeLimitReached: true, lockAfterWrong: 2 });
    await page.goto(`/payer#${TOKEN}`);

    // A code was mailed before: it can be entered at once.
    const code = page.getByLabel("Bestätigungscode (6 Ziffern)");
    await expect(code).toBeVisible(lazyPageLoad);
    const resend = page.getByTestId("payer-link-resend");
    await expect(resend).toHaveText("Code erneut senden");
    await resend.click();
    await expect(page.getByTestId("payer-link-code-error")).toHaveText("Bitte warten Sie 42 s, bevor Sie einen neuen Code anfordern.");
    await expect(resend).toHaveText(/^Code erneut senden \(in (42|41|40) s\)$/);
    await expect(resend).toBeDisabled();

    // Five digits are not a code: nothing is sent.
    await code.fill("12345");
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByTestId("payer-link-code-error")).toHaveText("Bitte geben Sie die 6 Ziffern aus der E-Mail ein.");
    expect(calls.payer.filter((call) => call.path.endsWith("/verify"))).toHaveLength(0);

    await code.fill("111111");
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(page.getByTestId("payer-link-code-error")).toHaveText("Der Code ist nicht richtig. Sie haben noch 4 Versuche.");
    await code.fill("222222");
    await page.getByRole("button", { name: "Bestätigen" }).click();

    const fatal = page.getByTestId("payer-link-fatal");
    await expect(fatal).toContainText("Dieser Link wurde nach zu vielen falschen Codes gesperrt. Bitte wenden Sie sich an GMED.");
    await expect(page.getByTestId("payer-link-code-step")).toHaveCount(0);
    expect(calls.others).toEqual([]);
  });

  test("five wrong codes use the code up, and the message follows the language", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto(`/payer#${TOKEN}`);
    await page.getByTestId("payer-link-send-code").click(lazyPageLoad);
    // The field by its id: its label changes with the language below.
    const code = page.locator("#payer-link-code");
    const error = page.getByTestId("payer-link-code-error");
    const switcher = page.getByTestId("payer-link-language");

    await code.fill("100001");
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(error).toHaveText("Der Code ist nicht richtig. Sie haben noch 4 Versuche.");
    // The message is in the language shown, also after a switch.
    await switcher.getByRole("radio", { name: "EN" }).click();
    await expect(error).toHaveText("The code is not correct. You have 4 more attempts.");
    await switcher.getByRole("radio", { name: "DE" }).click();
    await expect(error).toHaveText("Der Code ist nicht richtig. Sie haben noch 4 Versuche.");

    for (const [wrong, message] of [
      ["100002", "Der Code ist nicht richtig. Sie haben noch 3 Versuche."],
      ["100003", "Der Code ist nicht richtig. Sie haben noch 2 Versuche."],
      ["100004", "Der Code ist nicht richtig. Sie haben noch einen Versuch."],
    ]) {
      await code.fill(wrong);
      await page.getByRole("button", { name: "Bestätigen" }).click();
      await expect(error).toHaveText(message);
    }
    // The fifth wrong code uses the code up: that is what the page says, not "expired".
    await code.fill("100005");
    await page.getByRole("button", { name: "Bestätigen" }).click();
    await expect(error).toHaveText("Zu viele Fehlversuche. Bitte fordern Sie einen neuen Code an.");
    await expect(code).toHaveValue("");
    await switcher.getByRole("radio", { name: "EN" }).click();
    await expect(error).toHaveText("Too many failed attempts. Please request a new code.");
    await switcher.getByRole("radio", { name: "RU" }).click();
    await expect(error).toHaveText("Слишком много неудачных попыток. Пожалуйста, запросите новый код.");
    // Even the right code does not work any more.
    await code.fill(CODE);
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(error).toHaveText("Слишком много неудачных попыток. Пожалуйста, запросите новый код.");
    await expect(page.getByTestId("payer-link-form")).toHaveCount(0);
    expect(calls.others).toEqual([]);
  });

  test("another link opened in the same tab is read at once: new token, no old session", async ({ page }) => {
    const { second, calls } = await setup(page, { secondLink: true });
    await signIn(page);
    expect(await stored(page, "gmed-payer-session")).toBe(SESSION);
    // Marks this document: a reload would lose it.
    await page.evaluate(() => {
      (window as unknown as { payerTabMark?: string }).payerTabMark = "same-document";
    });

    // The new link of the invitation e-mail, opened in this tab: only the fragment changes.
    const callsBefore = calls.payer.length;
    await page.goto(`/payer#${OTHER_TOKEN}`);
    await expect(page.getByTestId("payer-link-code-step")).toBeVisible();
    await expect(page.getByTestId("payer-link-form")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { payerTabMark?: string }).payerTabMark)).toBe("same-document");
    // The token leaves the address again and replaces the old one; the old session is gone.
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
    expect(new URL(page.url()).pathname).toBe("/payer");
    expect(page.url()).not.toContain(OTHER_TOKEN);
    expect(await stored(page, "gmed-payer-link")).toBe(OTHER_TOKEN);
    expect(await stored(page, "gmed-payer-session")).toBeNull();
    const fresh = calls.payer.slice(callsBefore);
    expect(fresh.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /public/payer-link"]);
    expect(fresh[0].link).toBe(OTHER_TOKEN);
    expect(fresh[0].session).toBeUndefined();

    // The new link asks for its own code and then opens the questionnaire.
    await page.getByTestId("payer-link-send-code").click();
    await page.getByLabel("Bestätigungscode (6 Ziffern)").fill(CODE);
    await page.getByTestId("payer-link-verify").click();
    await expect(page.getByTestId("payer-link-form")).toBeVisible();
    expect(second.session).toBe(OTHER_SESSION);
    expect(await stored(page, "gmed-payer-session")).toBe(OTHER_SESSION);
    expect(calls.payer.slice(callsBefore).every((call) => call.link === OTHER_TOKEN)).toBe(true);

    // A cut-off link in the same tab says so, and nothing of the link before is used.
    const callsCut = calls.payer.length;
    await page.goto("/payer#0123456789");
    await expect(page.getByTestId("payer-link-fatal")).toContainText("Dieser Link ist unvollständig.");
    expect(await stored(page, "gmed-payer-link")).toBeNull();
    expect(await stored(page, "gmed-payer-session")).toBeNull();
    expect(calls.payer.length).toBe(callsCut);
    expect(calls.others).toEqual([]);
  });

  for (const [status, message] of [
    ["revoked", "Dieser Link ist nicht mehr gültig. Bitte wenden Sie sich an GMED."],
    ["expired", "Dieser Link ist abgelaufen. Bitte wenden Sie sich an GMED, wenn Sie einen neuen Link benötigen."],
  ] as const) {
    test(`a ${status} link (410) shows one clear message and nothing else`, async ({ page }) => {
      const { calls } = await setup(page, { linkStatus: status });
      await page.goto(`/payer#${TOKEN}`);
      const fatal = page.getByTestId("payer-link-fatal");
      await expect(fatal).toBeVisible(lazyPageLoad);
      await expect(fatal.getByRole("alert")).toHaveText(message);
      await expect(page.getByRole("button", { name: "Code senden" })).toHaveCount(0);
      await expect(page.getByText("Mia Muster")).toHaveCount(0);
      expect(page.url()).not.toContain(TOKEN);
      expect(calls.payer.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /public/payer-link"]);
      expect(calls.others).toEqual([]);
    });
  }

  test("an unknown link and a cut-off link each say so", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto(`/payer#${OTHER_TOKEN}`);
    await expect(page.getByTestId("payer-link-fatal")).toContainText("Dieser Link ist nicht gültig. Bitte wenden Sie sich an GMED.", lazyPageLoad);
    expect(calls.payer.at(-1)?.link).toBe(OTHER_TOKEN);

    // A new tab with a link cut off in the mail program: no request at all.
    const fresh = await page.context().newPage();
    const freshCalls: string[] = [];
    fresh.on("request", (request) => {
      if (request.url().includes("/api/")) freshCalls.push(request.url());
    });
    await fresh.goto("/payer#0123456789");
    await expect(fresh.getByTestId("payer-link-fatal")).toContainText("Dieser Link ist unvollständig.", lazyPageLoad);
    expect(new URL(fresh.url()).pathname).toBe("/payer");
    expect(fresh.url()).not.toContain("#");
    expect(freshCalls).toEqual([]);
    expect(calls.others).toEqual([]);
  });

  test("a private person answers every step and sends the details", async ({ page }) => {
    const { q, calls } = await setup(page);
    await signIn(page);

    // 1 Privacy: the acknowledgement with the chosen channels.
    await acknowledge(page, ["E-Mail", "Telefon"]);
    expect(calls.payer.find((call) => call.path.endsWith("/consent"))?.body).toEqual({
      acknowledged: true,
      contact_channels: ["email", "phone"],
      language: "de",
    });

    // 2 Details: what the lead declared is there; the e-mail is the confirmed one.
    await expect(stepTitle(page)).toHaveText("Angaben zur Person");
    const details = page.getByTestId("payer-link-step-details");
    await expect(details.getByRole("textbox", { name: "Vorname" })).toHaveValue("Viktor");
    await expect(details.getByRole("textbox", { name: "Ort", exact: true })).toHaveValue("Wien");
    await expect(page.getByTestId("payer-link-email")).toHaveText(/viktor\.zahler@example\.com\s*bestätigt/);
    await expect(details.getByRole("textbox", { name: "E-Mail" })).toHaveCount(0);
    await choose(page, details.getByRole("combobox", { name: "Anrede" }), "Herr");
    await details.getByRole("textbox", { name: "Geburtsort" }).fill("Wien");
    await choose(page, details.getByRole("combobox", { name: "Geburtsland" }), "Österreich");
    await expect
      .poll(() => merged(calls.patches))
      .toEqual({ salutation: "mr", birth_place: "Wien", birth_country: "AT" });
    await expect(page.getByTestId("payer-link-save-state")).toHaveText("Gespeichert");
    await next(page);

    // 3 Identity document: an expired document is refused and named, a valid one is kept.
    await expect(stepTitle(page)).toHaveText("Ausweisdokument");
    const identity = page.getByTestId("payer-link-step-identity");
    await choose(page, identity.getByRole("combobox", { name: "Art des Dokuments" }), "Reisepass");
    await identity.getByRole("textbox", { name: "Dokumentnummer" }).fill("P1234567");
    await identity.getByRole("textbox", { name: "Ausstellende Behörde" }).fill("BH Wien");
    await choose(page, identity.getByRole("combobox", { name: "Ausstellungsland" }), "Österreich");
    await setDatePickerValue(page.locator("#payer-link-id_valid_until"), "2020-01-01");
    await expect(identity.getByText("Das Dokument ist abgelaufen. Bitte geben Sie ein gültiges Dokument an.")).toBeVisible();
    await expect(page.getByTestId("payer-link-save-state")).toHaveText("Nicht gespeichert");
    await setDatePickerValue(page.locator("#payer-link-id_valid_until"), "2031-03-04");
    await expect.poll(() => q.answers.id_valid_until).toBe("2031-03-04");
    await expect(identity.getByText("Das Dokument ist abgelaufen.")).toHaveCount(0);
    await page.locator("#payer-link-identity-files").setInputFiles({
      name: "pass.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic"),
    });
    await expect(page.getByTestId("payer-link-identity-upload")).toContainText("pass.pdf");
    expect(q.identity_documents.map((item) => item.file_name)).toEqual(["pass.pdf"]);
    await next(page);

    // 5 Relationship and funds (no step 4 for a person).
    await expect(stepTitle(page)).toHaveText("Beziehung und Herkunft der Mittel");
    const funds = page.getByTestId("payer-link-step-funds");
    await choose(page, funds.getByRole("combobox", { name: "Beziehung zur Patientin / zum Patienten" }), "Freund/in");
    await funds.getByRole("textbox", { name: "Beruf" }).fill("Ingenieur");
    await funds.getByRole("checkbox", { name: "Ersparnisse" }).check();
    await expect(page.getByTestId("payer-link-funds-upload-badge")).toHaveText("freiwillig");
    await expect(funds.getByRole("textbox", { name: "Branche" })).toHaveCount(0);
    await expect.poll(() => q.answers.funds_sources).toEqual(["savings"]);
    await next(page);

    // 6 Payment route: phase 2's fields, the holder offered.
    await expect(stepTitle(page)).toHaveText("Zahlungsweg");
    const payment = page.getByTestId("payer-link-step-payment");
    await choose(page, payment.getByRole("combobox", { name: "Wie werden Sie bezahlen?" }), "Überweisung");
    await expect(payment.getByRole("textbox", { name: "Kontoinhaber/in" })).toHaveValue("Viktor Zahler");
    await choose(page, payment.getByRole("combobox", { name: "Land des Kontos" }), "Österreich");
    await payment.getByRole("textbox", { name: "Name der Bank" }).fill("Musterbank");
    await choose(page, payment.getByRole("combobox", { name: /Erfolgt die Zahlung über eine dritte Person/ }), "Nein");
    await expect.poll(() => q.payment_route.via_third_party).toBe(false);
    await next(page);

    // 7 Declarations.
    await expect(stepTitle(page)).toHaveText("Erklärungen");
    const declarations = page.getByTestId("payer-link-step-declarations");
    for (const question of [/hochrangiges öffentliches Amt/, /politisch exponiert/, /Drittstaat mit hohem Risiko/, /Sanktionen unterliegen/]) {
      await choose(page, declarations.getByRole("combobox", { name: question }), "Nein");
    }
    await expect.poll(() => q.missing_for_submit).toEqual([]);
    await next(page);

    // 8 Summary: nothing missing, everything listed, sent after the confirmation.
    await expect(stepTitle(page)).toHaveText("Zusammenfassung");
    await expect(page.getByTestId("payer-link-complete")).toHaveText("Alle erforderlichen Angaben sind vorhanden.");
    const summary = page.getByTestId("payer-link-summary");
    await expect(summary).toContainText("03.02.1970");
    await expect(summary).toContainText("04.03.2031");
    await expect(summary).toContainText("Reisepass");
    await expect(summary).toContainText("pass.pdf");
    await expect(summary).toContainText("Musterbank");
    await expect(summary).toContainText("E-Mail, Telefon");
    const submit = page.getByTestId("payer-link-submit");
    await expect(submit).toBeDisabled();
    await page.getByTestId("payer-link-confirm").check();
    await submit.click();

    const thanks = page.getByTestId("payer-link-thanks");
    await expect(thanks).toContainText("Vielen Dank. Ihre Angaben sind bei GMED eingegangen.");
    await expect(thanks).toContainText("Gesendet am 06.10.2026");
    await expect(thanks.getByTestId("payer-link-summary")).toContainText("Ingenieur");
    await expect(thanks.getByRole("button", { name: "Ändern" })).toHaveCount(0);
    expect(calls.payer.find((call) => call.path.endsWith("/submit"))?.body).toEqual({ declared_correct: true });

    // Only changed keys, never a key of an organisation, a refused value not repeated.
    expect(calls.unchanged).toEqual([]);
    for (const patch of calls.patches) {
      expect(Object.keys(patch).length).toBeGreaterThan(0);
      for (const key of Object.keys(patch)) expect(ORGANISATION_ONLY).not.toContain(key);
    }
    expect(calls.patches.filter((patch) => patch.id_valid_until === "2020-01-01")).toHaveLength(1);
    expect(calls.others).toEqual([]);
  });

  test("a company names its register, its representative and its beneficial owners", async ({ page }) => {
    const { q, calls } = await setup(page, {
      payerType: "company",
      answers: { ...completeAnswers("company"), register_court: null, register_number: null, representative_first_name: null, representative_last_name: null, beneficial_owners_none: null },
      route: completeRoute(),
      identityDocuments: [document("doc-id", "ausweis-ben-muster.pdf")],
    });
    await signIn(page);
    await acknowledge(page);

    await expect(stepTitle(page)).toHaveText("Angaben zur Organisation");
    const details = page.getByTestId("payer-link-step-details");
    await expect(details.getByRole("textbox", { name: "Firma" })).toHaveValue("Beispiel GmbH");
    await expect(details.getByRole("textbox", { name: "Geburtsort" })).toHaveCount(0);
    await expect(details).toContainText("Sitz");
    await expect(details).toContainText("Gesetzliche/r Vertreter/in");
    await details.getByRole("textbox", { name: "Registergericht" }).fill("Amtsgericht Berlin-Charlottenburg");
    await details.getByRole("textbox", { name: "Registernummer" }).fill("HRB 12345");
    await details.getByRole("textbox", { name: "Vorname" }).fill("Ben");
    await details.getByRole("textbox", { name: "Nachname" }).fill("Muster");
    await details.getByRole("textbox", { name: "Funktion" }).fill("Geschäftsführer");
    await expect.poll(() => q.answers.representative_role).toBe("Geschäftsführer");
    await next(page);

    await expect(stepTitle(page)).toHaveText("Ausweisdokument der vertretungsberechtigten Person");
    await expect(page.getByTestId("payer-link-identity-upload")).toContainText("ausweis-ben-muster.pdf");
    await next(page);

    // 4 Beneficial owners: "nobody above 25 %" or a complete list.
    await expect(stepTitle(page)).toHaveText("Wirtschaftlich Berechtigte");
    const owners = page.getByTestId("payer-link-step-owners");
    const none = owners.getByRole("checkbox", { name: "Es gibt keine natürliche Person mit mehr als 25 %" });
    await none.check();
    await expect.poll(() => calls.patches.at(-1)).toEqual({ beneficial_owners_none: true });
    await expect.poll(() => q.missing_for_submit).not.toContain("beneficial_owners");
    await none.uncheck();
    await expect.poll(() => calls.patches.at(-1)).toEqual({ beneficial_owners_none: false });
    await expect.poll(() => q.missing_for_submit).toContain("beneficial_owners");

    await owners.getByRole("button", { name: "Person hinzufügen" }).click();
    const first = page.getByTestId("payer-link-owner-0");
    await first.getByRole("textbox", { name: "Vorname" }).fill("Anna");
    // An unfinished person is not sent.
    await expect(page.getByTestId("payer-link-owner-0-problem")).toHaveText(
      "Bitte Vorname und Nachname angeben; erst dann wird diese Person gespeichert.",
    );
    const patchesBefore = calls.patches.length;
    await first.getByRole("textbox", { name: "Nachname" }).fill("Muster");
    await setDatePickerValue(page.locator("#payer-link-owner-0-date_of_birth"), "1980-01-15");
    await first.getByRole("textbox", { name: "Geburtsort" }).fill("Hamburg");
    await first.getByRole("textbox", { name: "Ort", exact: true }).fill("Berlin");
    await first.getByRole("textbox", { name: "Anteil in %" }).fill("60");
    await expect
      .poll(() => q.answers.beneficial_owners)
      .toEqual([
        { first_name: "Anna", last_name: "Muster", date_of_birth: "1980-01-15", birth_place: "Hamburg", street: null, zip: null, city: "Berlin", country: null, share_percent: 60 },
      ]);
    expect(calls.patches.slice(patchesBefore).every((patch) => {
      const list = patch.beneficial_owners as Owner[] | undefined;
      return !list || list.every((owner) => owner.first_name && owner.last_name && owner.share_percent);
    })).toBe(true);

    // Together more than 100 %: nothing is sent until it is fixed.
    await owners.getByRole("button", { name: "Person hinzufügen" }).click();
    const second = page.getByTestId("payer-link-owner-1");
    await second.getByRole("textbox", { name: "Vorname" }).fill("Ben");
    await second.getByRole("textbox", { name: "Nachname" }).fill("Muster");
    await second.getByRole("textbox", { name: "Anteil in %" }).fill("50");
    await expect(page.getByTestId("payer-link-owners-total")).toHaveText("Die Anteile ergeben zusammen mehr als 100 %.");
    await page.waitForTimeout(1000);
    expect(q.answers.beneficial_owners).toHaveLength(1);
    await second.getByRole("textbox", { name: "Anteil in %" }).fill("40");
    await expect.poll(() => q.answers.beneficial_owners.map((owner) => owner.share_percent)).toEqual([60, 40]);
    await expect(page.getByTestId("payer-link-owners-total")).toHaveCount(0);
    await next(page);

    await expect(stepTitle(page)).toHaveText("Beziehung und Herkunft der Mittel");
    await expect(page.getByTestId("payer-link-step-funds").getByRole("textbox", { name: "Branche" })).toHaveValue("Handel");
    // A company chooses from the sources of an organisation, not from a person's (salary, inheritance).
    const sources = page.getByTestId("payer-link-funds-sources");
    await expect(sources.getByRole("checkbox")).toHaveCount(6);
    await expect(sources.getByRole("checkbox", { name: "Geschäftstätigkeit / Umsatz" })).toBeChecked();
    await expect(sources.getByRole("checkbox", { name: "Gehalt / nichtselbständige Arbeit" })).toHaveCount(0);
    await expect(sources.getByRole("checkbox", { name: "Erbschaft / Schenkung" })).toHaveCount(0);
    await sources.getByRole("checkbox", { name: "Darlehen / Kredit" }).check();
    await expect.poll(() => q.answers.funds_sources).toEqual(["business_revenue", "loan"]);
    await next(page);
    await expect(stepTitle(page)).toHaveText("Zahlungsweg");
    await expect(page.getByTestId("payer-link-step-payment").getByRole("combobox", { name: "Wie erfolgt die Zahlung?" })).toBeVisible();
    await next(page);
    // The declarations of an organisation are about its representatives and beneficial owners.
    await expect(stepTitle(page)).toHaveText("Erklärungen");
    const declarations = page.getByTestId("payer-link-step-declarations");
    await expect(declarations).toContainText(
      "Sie betreffen die Organisation, die vertretungsberechtigten Personen und die wirtschaftlich Berechtigten.",
    );
    await expect(
      declarations.getByRole("combobox", {
        name: "Üben die vertretungsberechtigten Personen oder wirtschaftlich Berechtigten ein hochrangiges öffentliches Amt aus",
      }),
    ).toBeVisible();
    await expect(declarations.getByRole("combobox", { name: /politisch exponiert/ })).toBeVisible();
    await expect(declarations.getByRole("combobox", { name: /Sitz oder Wohnsitz in einem Land/ })).toBeVisible();
    await expect(declarations.getByRole("combobox", { name: /Verbindungen zu Personen oder Unternehmen/ })).toBeVisible();
    await expect(declarations.getByText(/Üben Sie|Haben Sie oder|Ihnen nahestehende/)).toHaveCount(0);
    await next(page);

    await expect(page.getByTestId("payer-link-complete")).toBeVisible();
    const summary = page.getByTestId("payer-link-summary-owners");
    await expect(summary).toContainText("Anna Muster · 15.01.1980 · Hamburg · Berlin · 60 %");
    await expect(summary).toContainText("Ben Muster · 40 %");
    await expect(page.getByTestId("payer-link-summary-details")).toContainText("Sitz: Straße und Hausnummer");
    await page.getByTestId("payer-link-confirm").check();
    await page.getByTestId("payer-link-submit").click();
    await expect(page.getByTestId("payer-link-thanks")).toContainText("Vielen Dank. Ihre Angaben sind bei GMED eingegangen.");

    for (const patch of calls.patches) {
      for (const key of Object.keys(patch)) expect(PERSON_ONLY).not.toContain(key);
    }
    expect(calls.unchanged).toEqual([]);
    expect(calls.others).toEqual([]);
  });

  test("a public office alone leaves the proof of funds voluntary", async ({ page }) => {
    const { q, calls } = await setup(page, {
      acknowledged: true,
      answers: { ...completeAnswers("person"), pep_self: null },
      route: completeRoute(),
      identityDocuments: [document("doc-id", "pass.pdf")],
    });
    await signIn(page);

    // Only the declarations are open: the form starts there.
    await expect(stepTitle(page)).toHaveText("Erklärungen");
    const declarations = page.getByTestId("payer-link-step-declarations");
    await choose(page, declarations.getByRole("combobox", { name: /hochrangiges öffentliches Amt/ }), "Ja");
    await declarations.getByRole("textbox", { name: "Amt, Land und Zeitraum" }).fill("Bürgermeister, Österreich, 2020–2024");
    await expect.poll(() => q.answers.pep_self_details).toBe("Bürgermeister, Österreich, 2020–2024");
    expect(merged(calls.patches)).toMatchObject({ pep_self: true });
    // Owner rule 2026-10-07: a PEP is no trigger of the enhanced check.
    await expect.poll(() => q.funds_proof_required).toBe(false);
    await next(page);
    await expect(page.getByTestId("payer-link-complete")).toHaveText("Alle erforderlichen Angaben sind vorhanden.");
    await page.getByRole("button", { name: "Zurück" }).click();
    await page.getByRole("button", { name: "Zurück" }).click();
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(stepTitle(page)).toHaveText("Beziehung und Herkunft der Mittel");
    await expect(page.getByTestId("payer-link-funds-upload-badge")).toHaveText("freiwillig");
  });

  test("the enhanced check makes the proof of funds required before the details can be sent", async ({ page }) => {
    const { calls } = await setup(page, {
      acknowledged: true,
      answers: { ...completeAnswers("person"), pep_self: null },
      route: completeRoute(),
      identityDocuments: [document("doc-id", "pass.pdf")],
      enhancedCheckRequired: true,
    });
    await signIn(page);

    // The proof is asked from the start: the form opens at the funds.
    await expect(stepTitle(page)).toHaveText("Beziehung und Herkunft der Mittel");
    await expect(page.getByTestId("payer-link-funds-upload-badge")).toHaveText("erforderlich");
    for (let index = 0; index < 2; index += 1) await next(page);
    await expect(stepTitle(page)).toHaveText("Erklärungen");
    const declarations = page.getByTestId("payer-link-step-declarations");
    await choose(page, declarations.getByRole("combobox", { name: /hochrangiges öffentliches Amt/ }), "Nein");
    await expect.poll(() => merged(calls.patches)).toMatchObject({ pep_self: false });
    await next(page);

    // Level 2: the proof is missing, "send" waits for it; the page never says why.
    const missing = page.getByTestId("payer-link-missing");
    await expect(page.getByTestId("payer-link-page")).not.toContainText("Blacklist");
    await expect(missing).toContainText("Bitte noch ergänzen:");
    await expect(missing.locator("[data-missing-key]")).toHaveText(["Nachweis der Herkunft der Mittel"]);
    await page.getByTestId("payer-link-confirm").check();
    await expect(page.getByTestId("payer-link-submit")).toBeDisabled();
    await expect(page.getByText("Bitte ergänzen Sie zuerst die fehlenden Angaben.")).toBeVisible();

    await missing.getByRole("button", { name: "Ergänzen" }).click();
    await expect(stepTitle(page)).toHaveText("Beziehung und Herkunft der Mittel");
    await expect(page.getByTestId("payer-link-funds-upload-badge")).toHaveText("erforderlich");
    await page.locator("#payer-link-funds-files").setInputFiles({
      name: "kontoauszug.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic"),
    });
    await expect(page.getByTestId("payer-link-funds-upload")).toContainText("kontoauszug.pdf");
    expect(calls.payer.filter((call) => call.path.endsWith("/funds-proof")).map((call) => call.body)).toEqual([{ file: "kontoauszug.pdf" }]);

    for (let index = 0; index < 3; index += 1) await next(page);
    await expect(page.getByTestId("payer-link-complete")).toBeVisible();
    await page.getByTestId("payer-link-confirm").check();
    await page.getByTestId("payer-link-submit").click();
    await expect(page.getByTestId("payer-link-thanks")).toBeVisible();
    await expect(page.getByTestId("payer-link-summary-funds")).toContainText("kontoauszug.pdf");
    expect(calls.others).toEqual([]);
  });

  test("after the details were sent, the page says where the documents for signing stand", async ({ page }) => {
    const { calls, signature } = await setup(page, {
      acknowledged: true,
      answers: completeAnswers("person"),
      route: completeRoute(),
      identityDocuments: [document("doc-id", "pass.pdf")],
      submitted: true,
      signaturePackage: { status: "sent", sent_at: "2026-10-06T12:00:00Z", signed_at: null },
      // The link names the package only to the payer with the code.
      signaturePackageWithSession: true,
    });
    await page.goto(`/payer#${TOKEN}`);
    await expect(page.getByTestId("payer-link-submitted-note")).toBeVisible(lazyPageLoad);
    await expect(page.getByTestId("payer-link-signature")).toHaveCount(0);
    await page.getByTestId("payer-link-send-code").click();
    await page.getByLabel("Bestätigungscode (6 Ziffern)").fill(CODE);
    await page.getByTestId("payer-link-verify").click();

    // Sent: four documents through Skribble, with the day they went out.
    const thanks = page.getByTestId("payer-link-thanks");
    await expect(thanks).toContainText("Vielen Dank. Ihre Angaben sind bei GMED eingegangen.");
    const status = page.getByTestId("payer-link-signature");
    await expect(status).toHaveAttribute("data-status", "sent");
    await expect(status).toHaveText(
      "Unterlagen zur Unterschrift: Wir haben Ihnen am 06.10.2026 vier Dokumente zur qualifizierten elektronischen Signatur gesendet. Die Einladung kommt per E-Mail von unserem Partner Skribble; dort bestätigen Sie auch Ihre Identität.",
    );
    // Asked for once more with the session after the code; the secrets stay in the headers.
    const infos = calls.payer.filter((call) => call.method === "GET" && call.path === "/public/payer-link");
    expect(infos.at(-1)?.session).toBe(SESSION);
    for (const call of calls.payer) expect(call.url).not.toContain(SESSION);
    // In the language chosen.
    const switcher = page.getByTestId("payer-link-language");
    await switcher.getByRole("radio", { name: "EN" }).click();
    await expect(status).toHaveText(
      "Documents for signature: On 06.10.2026 we sent you four documents to sign with a qualified electronic signature. The invitation comes by e-mail from our partner Skribble; there you also confirm your identity.",
    );
    await switcher.getByRole("radio", { name: "RU" }).click();
    await expect(status).toContainText("Документы на подпись: 06.10.2026 мы отправили вам четыре документа");
    await switcher.getByRole("radio", { name: "DE" }).click();

    // Signed and back at GMED: the next visit says so (the session of this tab is kept).
    signature.value = { status: "signed", sent_at: "2026-10-06T12:00:00Z", signed_at: "2026-10-08T09:00:00Z" };
    await page.reload();
    await expect(status).toHaveAttribute("data-status", "signed", lazyPageLoad);
    await expect(status).toHaveText("Vielen Dank – die unterschriebenen Unterlagen sind am 08.10.2026 bei GMED eingegangen.");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(status).toBeVisible();
      expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(1);
      expect(await widestOverhang(page), `${width}px`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`payer-signature-${width}.png`), fullPage: true });
    }

    // No package (withdrawn, or another payer's) and an older server without the key: nothing is said.
    for (const value of [null, undefined]) {
      signature.value = value;
      await page.reload();
      await expect(page.getByTestId("payer-link-thanks")).toBeVisible(lazyPageLoad);
      await expect(page.getByTestId("payer-link-signature")).toHaveCount(0);
    }
    expect(calls.others).toEqual([]);
  });

  test("the page starts in the link's language and switches between DE, EN, UA and RU", async ({ page }) => {
    const { calls } = await setup(page, { language: "uk" });
    await page.goto(`/payer#${TOKEN}`);
    const switcher = page.getByTestId("payer-link-language");
    await expect(page.getByRole("heading", { name: "Відомості про оплату витрат" })).toBeVisible(lazyPageLoad);
    await expect(switcher.getByRole("radio", { name: "UA" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Надіслати код" })).toBeVisible();

    await switcher.getByRole("radio", { name: "EN" }).click();
    await expect(page.getByRole("heading", { name: "Details on covering the costs" })).toBeVisible();
    await expect(page.getByTestId("payer-link-named")).toHaveText("Mia Muster has named you as the paying person for a request at GMED.");
    await expect(page.getByTestId("payer-link-page")).toHaveAttribute("lang", "en");

    await switcher.getByRole("radio", { name: "RU" }).click();
    await expect(page.getByRole("heading", { name: "Сведения об оплате расходов" })).toBeVisible();
    await page.getByRole("button", { name: "Отправить код" }).click();
    await page.getByLabel("Код подтверждения (6 цифр)").fill("999999");
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(page.getByTestId("payer-link-code-error")).toHaveText("Код неверный. Осталось попыток: 4.");
    await page.getByLabel("Код подтверждения (6 цифр)").fill(CODE);
    await page.getByRole("button", { name: "Подтвердить" }).click();
    await expect(stepTitle(page)).toHaveText("Защита данных");

    await switcher.getByRole("radio", { name: "DE" }).click();
    await expect(stepTitle(page)).toHaveText("Datenschutz");
    await expect(page.getByText("Ich habe die Datenschutzhinweise gelesen.")).toBeVisible();
    expect(calls.others).toEqual([]);
  });

  test("every step fits a wide screen and a phone without scrolling sideways", async ({ page }) => {
    const long = "Gemeinnützige-Beispielstiftung-für-internationale-Kostenübernahme";
    await setup(page, {
      payerType: "company",
      acknowledged: true,
      answers: {
        ...completeAnswers("company"),
        organisation_name: `${long} e. V.`,
        register_court: null,
        beneficial_owners_none: null,
        beneficial_owners: [
          { first_name: "Anna", last_name: "Muster", date_of_birth: "1980-01-15", birth_place: "Hamburg", street: "Musterstraße 1", zip: "10115", city: "Berlin", country: "DE", share_percent: 60 },
        ],
        funds_description: `${long}-Rücklagen`,
      },
      route: { ...completeRoute(), payment_method: "crypto", account_country: null, account_holder: null, bank_name: null, via_third_party: true, via_third_party_details: long },
      identityDocuments: [document("doc-id", `${long}-Ausweis-des-Geschaeftsfuehrers.pdf`)],
    });

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      if (width === 390) {
        // A new visit of the tab without its session: the code step again (the code mailed before still works).
        await page.evaluate(() => sessionStorage.removeItem("gmed-payer-session"));
        await page.goto("about:blank");
      }
      await page.goto(`/payer#${TOKEN}`);
      await expect(page.getByTestId("payer-link-code-step")).toBeVisible(lazyPageLoad);
      expect(await overflow(page), `${width}px code`).toBeLessThanOrEqual(1);
      expect(await widestOverhang(page), `${width}px code`).toBeLessThanOrEqual(1);
      if (width === 1440) await page.getByTestId("payer-link-send-code").click();
      await page.getByLabel("Bestätigungscode (6 Ziffern)").fill(CODE);
      expect(await overflow(page), `${width}px code field`).toBeLessThanOrEqual(1);
      await page.screenshot({ path: test.info().outputPath(`payer-${width}-code.png`) });
      await page.getByTestId("payer-link-verify").click();
      await expect(page.getByTestId("payer-link-form")).toBeVisible();
      // The form opens at the first step with something missing; back to step 1, then through all of them.
      await expect(stepTitle(page)).toHaveText("Angaben zur Organisation");
      await page.getByRole("button", { name: "Zurück" }).click();
      await expect(stepTitle(page)).toHaveText("Datenschutz");
      const titles: string[] = [];
      for (let guard = 0; guard < 10; guard += 1) {
        const title = (await stepTitle(page).textContent()) ?? "";
        titles.push(title);
        expect(await overflow(page), `${width}px ${title}`).toBeLessThanOrEqual(1);
        expect(await widestOverhang(page), `${width}px ${title}`).toBeLessThanOrEqual(1);
        if (width === 390) await page.screenshot({ path: test.info().outputPath(`payer-${width}-${guard}.png`), fullPage: true });
        if ((await page.getByTestId("payer-link-next").count()) === 0) break;
        await next(page);
      }
      expect(titles).toEqual([
        "Datenschutz",
        "Angaben zur Organisation",
        "Ausweisdokument der vertretungsberechtigten Person",
        "Wirtschaftlich Berechtigte",
        "Beziehung und Herkunft der Mittel",
        "Zahlungsweg",
        "Erklärungen",
        "Zusammenfassung",
      ]);
      await expect(page.getByTestId("payer-link-summary-details")).toContainText(long);
      await expect(page.getByTestId("payer-link-missing")).toContainText("Registergericht");
      // A list opens inside the screen.
      await page.getByTestId("payer-link-summary-payment").getByRole("button", { name: "Ändern" }).click();
      await expect(stepTitle(page)).toHaveText("Zahlungsweg");
      await expect(page.getByTestId("payer-link-payment-method-note")).toBeVisible();
      // A company is asked how the payment is made.
      await page.getByRole("combobox", { name: "Wie erfolgt die Zahlung?" }).click();
      const edge = await page.getByRole("option", { name: "Kryptowährung" }).evaluate((node) => node.getBoundingClientRect().right);
      expect(edge, `${width}px`).toBeLessThanOrEqual(width);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("option")).toHaveCount(0);
      expect(await overflow(page), `${width}px payment`).toBeLessThanOrEqual(1);
    }
  });
});
