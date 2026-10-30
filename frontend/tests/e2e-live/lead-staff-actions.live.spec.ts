import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { E2E_SUPPORT_SECRET, STATE_FILE, type ProcessState } from "./support/process-state";

// What staff do for the client since 2026-10-28/29, against the real API and
// PostgreSQL — no mocks: the client's cabinet filled in by staff, consents
// recorded with how the client gave them, corrected trusted persons, the
// payer's cost-estimate consent, the prepared payer invitation, the services
// step and the relation link suggestion. Every test creates its own records
// with unique synthetic e-mail addresses and depends on no other test.
//
// Run against a separately started, disposable stack:
//   FORM_LIVE_API_URL=http://127.0.0.1:3360 FORM_LIVE_PORT=5195 E2E_CHANNEL=chrome \
//     npx playwright test -c playwright.form-live.config.ts lead-staff-actions
// The e-mail and SQL checks use the WSL QA stack (`~/gmed-qa-lm-stack.sh`
// `mail-to` / read-only `sql`); FORM_LIVE_WSL_STACK=off skips them.
// Defects this suite found on 2026-10-30 are fixed; `fixedBug` keeps them fixed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- live API payloads are untyped JSON checked field by field
type Json = Record<string, any>;
type Headers = Record<string, string>;

const CONSENT_FORM_VERSION = "2026-10-12";
const DISCLOSURE_VERSION = "2026-10-14";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
const wslStack = (process.env.FORM_LIVE_WSL_STACK ?? (process.env.FORM_LIVE_API_URL ? "on" : "off")) !== "off";

let api = "";
let staffHeaders: Headers = {};

test.beforeAll(async ({ playwright }) => {
  const managed = process.env.FORM_LIVE_API_URL ? null
    : JSON.parse(await readFile(STATE_FILE, "utf8")) as ProcessState;
  api = process.env.FORM_LIVE_API_URL ?? managed!.backendUrl;
  const request = await playwright.request.newContext();
  const bootstrap = await request.post(`${api}/api/v1/e2e/bootstrap/full-smoke`, {
    headers: { "x-e2e-secret": process.env.FORM_LIVE_E2E_SECRET ?? managed?.secret ?? E2E_SUPPORT_SECRET },
  });
  expect(bootstrap.ok(), await bootstrap.text()).toBe(true);
  const scenario = await bootstrap.json();
  const login = await request.post(`${api}/api/v1/auth/login`, {
    data: { email: scenario.credentials.pm.email, password: scenario.credentials.password },
  });
  expect(login.ok(), await login.text()).toBe(true);
  staffHeaders = { Authorization: `Bearer ${(await login.json()).access_token}` };
  await request.dispose();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A defect this suite found on 2026-10-30, fixed since: it must not come back. */
function fixedBug(ok: boolean, description: string) {
  expect(ok, description).toBe(true);
}

function uniqueEmail(tag: string) {
  return `lsa-${tag}-${randomUUID().slice(0, 12)}@gmx.de`;
}

async function body(response: APIResponse): Promise<Json> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

/** A JSON request whose status must be `status` (2xx when omitted). */
async function call(
  request: APIRequestContext,
  method: "GET" | "POST" | "DELETE",
  path: string,
  headers: Headers,
  data?: unknown,
  status?: number,
): Promise<Json> {
  const response = await request.fetch(`${api}/api/v1${path}`, {
    method, headers, ...(data === undefined ? {} : { data }),
  });
  const parsed = await body(response);
  const label = `${method} ${path} -> ${response.status()} ${JSON.stringify(parsed).slice(0, 800)}`;
  if (status === undefined) expect(response.ok(), label).toBe(true);
  else expect(response.status(), label).toBe(status);
  return parsed;
}

type Lead = { id: string; email: string; patientHeaders: Headers };

/** A new lead with the client's own cabinet login. */
async function newLead(request: APIRequestContext, tag: string): Promise<Lead> {
  const email = uniqueEmail(tag);
  const created = await call(request, "POST", "/leads", staffHeaders, {
    first_name: "Greta", last_name: `Staffform${tag[0].toUpperCase()}${tag.slice(1)}`, email,
  }, 201);
  expect(created.portal_account?.one_time_password, JSON.stringify(created.portal_account)).toBeTruthy();
  const login = await call(request, "POST", "/auth/login", {}, {
    email: created.portal_account.email, password: created.portal_account.one_time_password,
  });
  return { id: created.id, email, patientHeaders: { Authorization: `Bearer ${login.access_token}` } };
}

const cabinet = (leadId: string, part = "") => `/me/lead-requests/${leadId}${part ? `/${part}` : ""}`;

const personalData = {
  date_of_birth: "1980-04-05", legal_sex: "female", citizenships: ["DE"],
  street_address: "Musterstraße 7", zip_code: "10115", city: "Berlin", country: "DE",
  phone: "+49 30 1234567", has_insurance: "no",
};

const trustedPerson = {
  name: "Hans Vertraut", relation: "relative", phone: "+49 30 7654321",
  birth_date: "1955-06-07", scope_codes: ["medical"],
};

function thirdPartyPayer(email: string) {
  return {
    payer_kind: "third_party", payer_type: "person", first_name: "Viktor", last_name: "Zahlerlive",
    date_of_birth: "1970-05-01", citizenships: ["AT"], relationship_kind: "friend",
    email, country: "AT", contact_consent: true,
  };
}

/** The consent texts' current versions as the cabinet offers them. */
async function consentVersions(request: APIRequestContext, leadId: string, headers: Headers) {
  const payload = await call(request, "GET", cabinet(leadId), headers);
  const versions: Record<string, string> = {};
  for (const consent of Object.values<Json>(payload.consents ?? {})) versions[consent.type] = consent.version;
  expect(Object.keys(versions).sort()).toEqual(["health_data_processing", "lead_inquiry_processing"]);
  return versions;
}

/** Both consents of the cabinet; staff say how the client gave them. */
async function giveConsents(request: APIRequestContext, leadId: string, headers: Headers, staff: boolean) {
  const versions = await consentVersions(request, leadId, headers);
  for (const purpose of ["lead_inquiry_processing", "health_data_processing"]) {
    await call(request, "POST", cabinet(leadId, "consent"), headers, {
      purpose, version: versions[purpose], language: "de",
      ...(staff ? { recorded_how: "phone", recorded_note: "Synthetic call" } : {}),
    });
  }
}

/** Fills the base form of the cabinet as `headers` (client or staff). */
async function fillBaseForm(request: APIRequestContext, leadId: string, headers: Headers, payer: Json) {
  await call(request, "POST", cabinet(leadId, "personal-data"), headers, personalData);
  await call(request, "POST", cabinet(leadId, "payer"), headers, payer);
  // A third party states the payment route itself (409 `payment_route_by_payer`).
  await call(request, "POST", cabinet(leadId, "billing"), headers, payer.payer_kind === "third_party"
    ? { invoice_recipient: "self", invoice_recipient_is_payer: false }
    : {
      invoice_recipient: "self", payment_method: "bank_transfer", account_country: "DE",
      account_holder: "Greta Staffform", bank_name: "Musterbank", via_third_party: false,
    });
  await call(request, "POST", cabinet(leadId, "identification"), headers, {
    birth_place: "Berlin", birth_country: "DE", pep_self: false, pep_related: false,
    sanctions_links: false, request_reason: "Synthetic second opinion request",
  });
  await call(request, "POST", cabinet(leadId, "representation"), headers, {
    has_representative: false, under_guardianship: false,
  });
}

async function uploadIdentity(request: APIRequestContext, leadId: string, headers: Headers) {
  const response = await request.post(`${api}/api/v1${cabinet(leadId, "identity-document")}`, {
    headers,
    multipart: { file: { name: "synthetic-passport.pdf", mimeType: "application/pdf", buffer: PDF } },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

/** Runs a command of the WSL QA stack (`~/gmed-qa-lm-stack.sh`). */
function stack(args: string, allowFailure = false): string {
  // Through stdin: wsl.exe would mangle `$` and quotes in its arguments.
  return execFileSync("wsl.exe", ["-d", "Ubuntu-24.04", "--", "bash", "-s"], {
    input: `bash ~/gmed-qa-lm-stack.sh ${args}${allowFailure ? " || true" : ""}\n`, encoding: "utf8",
  });
}

/** The e-mails the local mail sink received for `address`, oldest first. */
function mailsTo(address: string): string[] {
  if (!/^[\w.+-]+@[\w.-]+$/.test(address)) throw new Error(`unexpected address ${address}`);
  // `mail-to` exits non-zero when nothing matches.
  return stack(`mail-to '${address}' 20`, true).split(/^={70}$/m).map((part) => part.trim()).filter(Boolean);
}

/** One value of a read-only SQL query (`psql` aligned output, first data row). */
function sqlValue(query: string): string {
  if (query.includes("'\"") || query.includes("\n")) throw new Error("keep the query on one line");
  const lines = stack(`sql "${query}"`).split("\n").map((line) => line.trim());
  const separator = lines.findIndex((line) => /^-+(\+-+)*$/.test(line));
  return lines[separator + 1] ?? "";
}

/** Today's date in Berlin (`YYYY-MM-DD`), the app's day. */
function berlinDate(offsetDays = 0) {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(date);
}

// ---------------------------------------------------------------------------
// 1. Staff fill in the client's cabinet
// ---------------------------------------------------------------------------

test("staff fill in the client's cabinet; consents and the send need how the client gave them", async ({ request }) => {
  const lead = await newLead(request, "cabinet");
  const opened = await call(request, "GET", cabinet(lead.id), staffHeaders);
  expect(opened.access_kind).toBe("staff");
  // The staff dialog shows the consent text the client agrees to.
  fixedBug(Object.keys(opened.consents.health_data_processing.texts ?? {}).length > 0,
    "GET /me/lead-requests/{id} as staff returns empty consent `texts` (request_payload passes AccessKind::Staff to ConsentPurpose::text, which has no staff wording)");
  const versions = await consentVersions(request, lead.id, staffHeaders);

  // A consent: never without how the client gave it.
  const inquiry = { purpose: "lead_inquiry_processing", version: versions.lead_inquiry_processing, language: "de" };
  let refused = await call(request, "POST", cabinet(lead.id, "consent"), staffHeaders, inquiry, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  refused = await call(request, "POST", cabinet(lead.id, "consent"), staffHeaders, { ...inquiry, recorded_how: "fax" }, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  refused = await call(request, "POST", cabinet(lead.id, "consent"), staffHeaders,
    { ...inquiry, recorded_how: "phone", recorded_note: "x".repeat(501) }, 422);
  expect(refused.code).toBe("invalid_field");
  const given = await call(request, "POST", cabinet(lead.id, "consent"), staffHeaders,
    { ...inquiry, recorded_how: "phone", recorded_note: "Synthetic call on 30.10." });
  expect(given.given_at).toBeTruthy();
  await call(request, "POST", cabinet(lead.id, "consent"), staffHeaders, {
    purpose: "health_data_processing", version: versions.health_data_processing, language: "de",
    recorded_how: "paper", recorded_note: "Signed sheet in the file",
  });
  // The staff record counts for the client's own login too.
  const asPatient = await call(request, "GET", cabinet(lead.id), lead.patientHeaders);
  expect(asPatient.access_kind).toBe("self");
  expect(asPatient.consents.lead_inquiry_processing.given_at).toBeTruthy();
  expect(asPatient.consents.health_data_processing.given_at).toBeTruthy();
  if (wslStack) {
    expect(sqlValue(`SELECT string_agg(context->'recorded_by_staff'->>'how', ',' ORDER BY consent_type) FROM consent_records WHERE lead_id = '${lead.id}'`))
      .toBe("paper,phone");
  }

  // The forms of step 1 save for staff, and the markers say staff.
  await fillBaseForm(request, lead.id, staffHeaders, { payer_kind: "self", acts_on_own_account: true });
  let intake = await call(request, "GET", `/leads/${lead.id}/portal-intake`, staffHeaders);
  for (const field of ["city", "date_of_birth", "citizenships", "phone", "legal_sex"]) {
    expect(intake.patient_fields[field]?.access_kind, field).toBe("staff");
  }
  expect(intake.patient_payer?.access_kind).toBe("staff");
  expect(intake.billing_updated_at).toBeTruthy();
  expect(intake.identification_updated_at).toBeTruthy();
  expect(intake.representation_updated_at).toBeTruthy();
  expect(intake.consents.map((consent: Json) => consent.access_kind)).toEqual(["staff", "staff"]);

  // The consent form's options and the trusted persons follow the same rule.
  const choices = {
    agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false,
    channel_email: true, channel_threema: false, channel_whatsapp: false, channel_telegram: false,
  };
  const choiceBody = { choices, version: CONSENT_FORM_VERSION, language: "de" };
  refused = await call(request, "POST", cabinet(lead.id, "consent-choices"), staffHeaders, choiceBody, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  await call(request, "POST", cabinet(lead.id, "consent-choices"), staffHeaders,
    { ...choiceBody, recorded_how: "in_person", recorded_note: "Visit at the office" });
  const personsBody = {
    persons: [trustedPerson], allow_disclosure: true, consent_given: true,
    version: DISCLOSURE_VERSION, language: "de",
  };
  refused = await call(request, "POST", cabinet(lead.id, "trusted-persons"), staffHeaders, personsBody, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  const withPersons = await call(request, "POST", cabinet(lead.id, "trusted-persons"), staffHeaders,
    { ...personsBody, recorded_how: "email", recorded_note: "Mail of the client" });
  expect(withPersons.trusted_persons).toHaveLength(1);
  intake = await call(request, "GET", `/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(intake.consent_form.access_kind).toBe("staff");
  expect(intake.consent_form.choices).toMatchObject({ agency_processing: true, data_system: true, named_recipients: true });
  expect(intake.trusted_persons).toEqual([trustedPerson]);
  if (wslStack) {
    expect(sqlValue(`SELECT string_agg(recorded_how, ',' ORDER BY chosen_at, id) FROM consent_form_choices WHERE lead_id = '${lead.id}'`))
      .toMatch(/^in_person,email$/);
  }

  // Routes that stay the client's own: 403 for staff.
  for (const [path, data] of [
    [cabinet(lead.id, "payer-questionnaire/consent"), { acknowledged: true }],
    [cabinet(lead.id, "payer-questionnaire/submit"), { declared_correct: true }],
    [cabinet(lead.id, "plan-requests"), { package_id: randomUUID(), module_id: randomUUID() }],
  ] as const) {
    await call(request, "POST", path, staffHeaders, data, 403);
  }

  // The lead's readiness counts the consents staff recorded.
  const detail = await call(request, "GET", `/leads/${lead.id}`, staffHeaders);
  expect(detail.readiness.cabinet_consents).toEqual({ healthcare: true, privacy_practices: true });
  const passed = (key: string) => detail.readiness.checks.find((check: Json) => check.key === key)?.passed;
  expect(passed("privacy_consent")).toBe(true);

  // The send: an identity copy is part of it; staff say how the client confirmed.
  await uploadIdentity(request, lead.id, staffHeaders);
  const before = await call(request, "GET", cabinet(lead.id), staffHeaders);
  expect(before.progress.missing_for_submit, JSON.stringify(before.progress)).toEqual([]);
  refused = await call(request, "POST", cabinet(lead.id, "submit"), staffHeaders, { declared_correct: true }, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  refused = await call(request, "POST", cabinet(lead.id, "submit"), staffHeaders, { recorded_how: "phone" }, 422);
  expect(refused.code).toBe("declaration_required");
  const sent = await call(request, "POST", cabinet(lead.id, "submit"), staffHeaders,
    { declared_correct: true, recorded_how: "phone", recorded_note: "Client confirmed by phone" });
  expect(sent.submitted_at).toBeTruthy();
  intake = await call(request, "GET", `/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(intake.submitted_at).toBe(sent.submitted_at);
  expect(intake.changed_since_submit).toBe(false);
  fixedBug(intake.submitted_by !== "self",
    "GET /leads/{id}/portal-intake says `submitted_by: \"self\"` when staff sent the request (any non-guardian submitter with a role counts as the client)");
  // The client's own login may no longer change the sent request …
  refused = await call(request, "POST", cabinet(lead.id, "personal-data"), lead.patientHeaders, { city: "Leipzig" }, 409);
  expect(refused.code).toBe("request_already_sent");

  // … staff still correct it, and the correction is staff's own: it is no
  // unsent change of the client and counts in the risk assessment at once,
  // as the same correction made in the wizard does.
  await call(request, "POST", cabinet(lead.id, "personal-data"), staffHeaders, { city: "Potsdam", citizenships: ["DE", "IR"] });
  const patientView = await call(request, "GET", cabinet(lead.id), lead.patientHeaders);
  expect(patientView.personal_data.city).toBe("Potsdam");
  fixedBug(patientView.changed_since_submit === false,
    "a staff correction through the client's form after the send sets `changed_since_submit` (CHANGED_SINCE_SUBMIT_SQL counts portal_field_updates markers of kind \"staff\")");
  const risk = await call(request, "GET", `/leads/${lead.id}/risk-assessment`, staffHeaders);
  const fired = (assessment: Json) => assessment.triggers.filter((trigger: Json) => trigger.active).map((trigger: Json) => trigger.key);
  fixedBug(fired(risk).includes("T1"),
    "a citizenship staff correct through the client's form after the send is held back as an unsent cabinet change: T1 does not fire (risk/inputs.rs unsent_personal_fields counts the staff marker)");
  await call(request, "POST", `/leads/${lead.id}/update`, staffHeaders, { citizenships: ["IR", "DE"] });
  const viaWizard = await call(request, "GET", `/leads/${lead.id}/risk-assessment`, staffHeaders);
  expect(fired(viaWizard)).toContain("T1");
});

// ---------------------------------------------------------------------------
// 2. Staff correct a trusted person the client named
// ---------------------------------------------------------------------------

test("staff correct and remove a trusted person the client named", async ({ request }) => {
  const lead = await newLead(request, "trusted");
  await giveConsents(request, lead.id, lead.patientHeaders, false);
  await call(request, "POST", cabinet(lead.id, "consent-choices"), lead.patientHeaders, {
    choices: {
      agency_processing: true, doctors_to_agency: true, data_system: true, named_recipients: false,
      channel_email: true, channel_threema: false, channel_whatsapp: false, channel_telegram: false,
    },
    version: CONSENT_FORM_VERSION, language: "de",
  });
  const second = { ...trustedPerson, name: "Erika Zweite", relation: "friend", phone: "+49 40 5550000", birth_date: "1966-02-03" };
  const saved = await call(request, "POST", cabinet(lead.id, "trusted-persons"), lead.patientHeaders, {
    persons: [trustedPerson, second], allow_disclosure: true, consent_given: true,
    version: DISCLOSURE_VERSION, language: "de",
  });
  expect(saved.trusted_persons).toHaveLength(2);
  const base = saved.trusted_persons[0];
  const path = `/leads/${lead.id}/trusted-persons/0`;

  // Without a reason, or changing what is the client's choice: refused.
  let refused = await call(request, "POST", path, staffHeaders, { base, person: { ...base, phone: "+49 30 1111111" }, reason: " " }, 422);
  expect(refused.code).toBe("correction_reason_required");
  refused = await call(request, "POST", path, staffHeaders,
    { base, person: { ...base, scope_codes: ["all"] }, reason: "Client asked" }, 422);
  expect(refused.code).toBe("trusted_person_scope_patient_only");
  refused = await call(request, "POST", path, staffHeaders,
    { base, person: { ...base, relation: "spouse" }, reason: "Client asked" }, 422);
  expect(refused.code).toBe("trusted_person_scope_patient_only");
  refused = await call(request, "POST", path, staffHeaders, { base, person: base, reason: "No change" }, 422);
  expect(refused.code).toBe("nothing_changed");
  refused = await call(request, "POST", path, staffHeaders,
    { base: { ...base, name: "Somebody Else" }, person: base, reason: "Stale" }, 409);
  expect(refused.code).toBe("trusted_person_changed");
  // The client cannot use the staff route.
  await call(request, "POST", path, lead.patientHeaders, { base, person: { ...base, phone: "+49 30 1111111" }, reason: "x" }, 403);

  // Correct the phone number and the name's spelling.
  const corrected = { ...base, name: "Hans Vertrauter", phone: "+49 30 2222222" };
  const done = await call(request, "POST", path, staffHeaders, { base, person: corrected, reason: "Typo, client called" });
  expect(done.action).toBe("corrected");
  expect(done.trusted_persons).toEqual([corrected, second]);
  let intake = await call(request, "GET", `/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(intake.trusted_persons).toEqual([corrected, second]);
  // The consent form prints the corrected person; the choice stays the client's.
  expect(intake.consent_form.choices.named_recipients).toBe(true);
  const client = await call(request, "GET", cabinet(lead.id), lead.patientHeaders);
  expect(client.trusted_persons).toEqual([corrected, second]);
  expect(client.consent_form.recipients).toEqual([corrected, second]);
  if (wslStack) {
    expect(sqlValue(`SELECT source || '|' || correction_reason FROM consent_form_choices WHERE lead_id = '${lead.id}' AND source = 'staff_correction' ORDER BY corrected_at LIMIT 1`))
      .toBe("staff_correction|Typo, client called");
  }

  // The client withdraws the consent for the second person: staff remove it,
  // then the first; with nobody left there is no disclosure.
  const removed = await call(request, "POST", `/leads/${lead.id}/trusted-persons/1`, staffHeaders,
    { base: second, person: null, reason: "Client withdrew by phone" });
  expect(removed.action).toBe("withdrawn");
  expect(removed.trusted_persons).toEqual([corrected]);
  await call(request, "POST", path, staffHeaders, { base: corrected, person: null, reason: "Client withdrew" });
  intake = await call(request, "GET", `/leads/${lead.id}/portal-intake`, staffHeaders);
  expect(intake.trusted_persons).toEqual([]);
  expect(intake.consent_form.choices.named_recipients).toBe(false);
  expect(intake.disclosure?.allow_disclosure ?? false).toBe(false);
  await call(request, "POST", path, staffHeaders, { base: corrected, person: null, reason: "Again" }, 409);
});

// ---------------------------------------------------------------------------
// 3. The payer's cost-estimate consent recorded by staff
// ---------------------------------------------------------------------------

test("staff record the cost-estimate consent for a third-party payer only, saying how", async ({ request }) => {
  const lead = await newLead(request, "estimate");
  const path = cabinet(lead.id, "payer/cost-estimate-consent");
  // A self-payer: nobody to pass the estimate on to.
  await call(request, "POST", cabinet(lead.id, "payer"), staffHeaders, { payer_kind: "self", acts_on_own_account: true });
  let refused = await call(request, "POST", path, staffHeaders, { consent: true, recorded_how: "phone" }, 409);
  expect(refused.code).toBe("no_third_party_payer");

  await call(request, "POST", cabinet(lead.id, "payer"), staffHeaders, thirdPartyPayer(uniqueEmail("estimate-payer")));
  refused = await call(request, "POST", path, staffHeaders, { consent: true }, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  refused = await call(request, "POST", path, staffHeaders, { consent: true, recorded_how: "letter" }, 422);
  expect(refused.code).toBe("consent_recorded_how_required");
  const given = await call(request, "POST", path, staffHeaders,
    { consent: true, recorded_how: "in_person", recorded_note: "Said so at the office" });
  const consentAt = given.payer?.cost_estimate_consent_at;
  expect(consentAt, JSON.stringify(given.payer)).toBeTruthy();
  if (wslStack) {
    expect(sqlValue(`SELECT cost_estimate_consent_recorded_how || '|' || cost_estimate_consent_recorded_note FROM lead_payer_declarations WHERE lead_id = '${lead.id}'`))
      .toBe("in_person|Said so at the office");
  }
  // The client sees it as given; withdrawing needs no channel.
  const client = await call(request, "GET", cabinet(lead.id), lead.patientHeaders);
  expect(client.payer?.cost_estimate_consent_at).toBe(consentAt);
  const withdrawn = await call(request, "POST", path, staffHeaders, { consent: false });
  expect(withdrawn.payer?.cost_estimate_consent_at ?? null).toBeNull();
  // The client gives it again in the own cabinet: no channel needed.
  const own = await call(request, "POST", path, lead.patientHeaders, { consent: true });
  expect(own.payer?.cost_estimate_consent_at).toBeTruthy();
  if (wslStack) {
    expect(sqlValue(`SELECT coalesce(cost_estimate_consent_recorded_how, 'none') FROM lead_payer_declarations WHERE lead_id = '${lead.id}'`))
      .toBe("none");
  }
});

// ---------------------------------------------------------------------------
// 4. The prepared payer invitation
// ---------------------------------------------------------------------------

test("a prepared payer invitation sends no e-mail until staff send it; a stale token is refused", async ({ request }) => {
  const lead = await newLead(request, "payerlink");
  // The client fills in the cabinet and sends the request.
  await call(request, "POST", `/leads/${lead.id}/portal-intake/fill-mode`, staffHeaders, { mode: "patient" });
  const payerEmail = uniqueEmail("payer");
  await giveConsents(request, lead.id, lead.patientHeaders, false);
  await fillBaseForm(request, lead.id, lead.patientHeaders, thirdPartyPayer(payerEmail));
  await uploadIdentity(request, lead.id, lead.patientHeaders);
  await call(request, "POST", cabinet(lead.id, "payer/cost-estimate-consent"), lead.patientHeaders, { consent: true });
  let blocked = await call(request, "GET", `/leads/${lead.id}/payer-link`, staffHeaders);
  expect(blocked.blocked_reason).toBe("request_not_submitted");
  let refused = await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { delivery: "manual" }, 409);
  expect(refused.code).toBe("request_not_submitted");
  const form = await call(request, "GET", cabinet(lead.id), lead.patientHeaders);
  expect(form.progress.missing_for_submit, JSON.stringify(form.progress)).toEqual([]);
  await call(request, "POST", cabinet(lead.id, "submit"), lead.patientHeaders, { declared_correct: true });
  blocked = await call(request, "GET", `/leads/${lead.id}/payer-link`, staffHeaders);
  expect(blocked.blocked_reason).toBeNull();
  expect(blocked.can_prepare).toBe(true);

  // Prepare for manual sharing: token, link and messages; no e-mail.
  const prepared = await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { delivery: "manual", language: "de" });
  expect(prepared.token).toMatch(/\S{20,}/);
  expect(prepared.url).toContain(`/payer#${prepared.token}`);
  expect(prepared.email).toBe(payerEmail);
  expect(Object.keys(prepared.messages).length).toBeGreaterThan(1);
  expect(prepared.messages.de).toContain(prepared.url);
  let status = await call(request, "GET", `/leads/${lead.id}/payer-link`, staffHeaders);
  expect(status.link.status).toBe("prepared");
  expect(status.link.sent_at).toBeNull();
  expect(JSON.stringify(status)).not.toContain(prepared.token);
  if (wslStack) expect(mailsTo(payerEmail)).toHaveLength(0);

  // A malformed token, or a token with a new manual link, is refused.
  await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { token: "short" }, 422);
  await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { token: prepared.token, delivery: "manual" }, 422);

  // Send the prepared link: the same token, now by e-mail.
  const sent = await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { token: prepared.token });
  expect(sent.link.status).toBe("sent");
  expect(sent.link.id).toBe(prepared.id);
  expect(sent.link.sent_at).toBeTruthy();
  if (wslStack) {
    await expect.poll(() => mailsTo(payerEmail).length, { timeout: 15_000 }).toBe(1);
    expect(mailsTo(payerEmail)[0]).toContain(prepared.url);
  }

  // A newer prepared link replaces it: the old token is stale.
  const newer = await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { delivery: "manual" });
  expect(newer.token).not.toBe(prepared.token);
  refused = await call(request, "POST", `/leads/${lead.id}/payer-link`, staffHeaders, { token: prepared.token }, 409);
  expect(refused.code).toBe("payer_link_stale");
  status = await call(request, "GET", `/leads/${lead.id}/payer-link`, staffHeaders);
  expect(status.link.id).toBe(newer.id);
  expect(status.link.status).toBe("prepared");
  if (wslStack) expect(mailsTo(payerEmail)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// 5. Services: wished start date and the additional support
// ---------------------------------------------------------------------------

test("the services step takes the new support services; a wished date in the past is refused", async ({ request }) => {
  const lead = await newLead(request, "services");
  const path = cabinet(lead.id, "services");
  const yesterday = berlinDate(-1);
  const inAMonth = berlinDate(30);

  const saved = await call(request, "POST", path, lead.patientHeaders, {
    services: ["document_translation", "visa_support", "interpreter_support"],
    service_comments: { visa_support: "Schengen visa for two" },
    notes: "Individual wishes: quiet room",
    program_date_from: inAMonth,
  });
  expect(saved.service_preferences).toEqual({
    services: ["document_translation", "visa_support", "interpreter_support"],
    service_comments: { visa_support: "Schengen visa for two" },
    notes: "Individual wishes: quiet room",
    program_date_from: inAMonth,
  });
  // Old spellings map to the new codes; an unknown service is refused.
  await call(request, "POST", path, lead.patientHeaders, { services: ["visa-support", "dog_walking"] }, 422);

  // The client cannot wish a past start …
  let refused = await call(request, "POST", path, lead.patientHeaders, { program_date_from: yesterday }, 422);
  expect(JSON.stringify(refused)).toContain("program_date_from");
  // … nor can staff through the client's form (same picker, same rule).
  refused = await call(request, "POST", path, staffHeaders, { program_date_from: yesterday }, 422);
  expect(JSON.stringify(refused)).toContain("program_date_from");
  const today = await call(request, "POST", path, lead.patientHeaders, { program_date_from: berlinDate(0) });
  expect(today.service_preferences.program_date_from).toBe(berlinDate(0));

  // Staff set a past start in the wizard (e.g. a programme already running).
  const detail = await call(request, "GET", `/leads/${lead.id}`, staffHeaders);
  await call(request, "POST", `/leads/${lead.id}/update`, staffHeaders, {
    wizard_state: { ...detail.wizard_state, program_date_from: yesterday },
  });
  let client = await call(request, "GET", cabinet(lead.id), lead.patientHeaders);
  expect(client.service_preferences.program_date_from).toBe(yesterday);
  // The stored past date stays while the client changes something else …
  client = await call(request, "POST", path, lead.patientHeaders, { notes: "Individual wishes: vegetarian food" });
  expect(client.service_preferences.program_date_from).toBe(yesterday);
  expect(client.service_preferences.notes).toBe("Individual wishes: vegetarian food");
  // … and the services survive the wizard save.
  expect(client.service_preferences.services).toEqual(["document_translation", "visa_support", "interpreter_support"]);
  // The client may clear it, never set another past date.
  await call(request, "POST", path, lead.patientHeaders, { program_date_from: berlinDate(-2) }, 422);
  client = await call(request, "POST", path, lead.patientHeaders, { program_date_from: "" });
  expect(client.service_preferences.program_date_from).toBe("");
});

// ---------------------------------------------------------------------------
// 6. Relation link suggestion
// ---------------------------------------------------------------------------

test("a relation is linked to a patient record only when staff confirm a name and birth-date match", async ({ request }) => {
  const suffix = randomUUID().slice(0, 6);
  async function patient(firstName: string, lastName: string, birthDate: string) {
    return call(request, "POST", "/patients", staffHeaders, {
      first_name: firstName, last_name: lastName, birth_date: birthDate, gender: "female",
      email: uniqueEmail(`pt-${firstName.toLowerCase()}`),
    }, 201);
  }
  const mother = await patient("Mira", `Linkprobe${suffix}`, "1975-03-04");
  const child = await patient("Lena", `Linkprobe${suffix}`, "2001-08-09");
  const relation = await call(request, "POST", `/patients/${child.id}/relations`, staffHeaders, {
    related_name: `Mira  Linkprobe${suffix}`, relation_type: "mother", phone: "+49 30 3333333",
  }, 201);
  const relations = await call(request, "GET", `/patients/${child.id}/relations`, staffHeaders);
  const row = (relations as unknown as Json[]).find((item) => item.id === relation.id);
  // Staff cannot record a relation's date of birth, so a typed relation is
  // never suggested and the link is refused.
  expect(row?.related_patient_id ?? null).toBeNull();
  expect(row?.link_suggestion).toBeUndefined();
  await call(request, "POST", `/patients/${child.id}/relations/${relation.id}/link`, staffHeaders,
    { related_patient_id: mother.id }, 409);
  // The ward relation type is accepted.
  await call(request, "POST", `/patients/${mother.id}/relations`, staffHeaders, {
    related_name: `Lena Linkprobe${suffix}`, relation_type: "ward",
  }, 201);
});