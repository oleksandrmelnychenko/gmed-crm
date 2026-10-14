import { expect, test, type Locator, type Page } from "@playwright/test";
import { startClockAt } from "./helpers";
import { leadRequestText } from "../../src/pages/patient-lead/lead-request-text";
import type { RepresentativeCountryAnswers } from "../../src/pages/patient-lead/lead-request-api";

// Synthetic mocked cabinet only: country/PEP questions of a named contracting
// representative belong to that person, independently of the child's answers.
const ANNA = "11111111-1111-4111-8111-111111111111";
const BEN = "22222222-2222-4222-8222-222222222222";
const BOOLEAN_FIELDS = ["pep_self", "pep_related", "sanctions_links"] as const;
const PEP_FIELDS = ["pep_office", "pep_country", "pep_period", "pep_wealth_origin"] as const;
const SANCTIONS_FIELDS = ["sanctions_link_name", "sanctions_link_kind", "sanctions_link_since_extent"] as const;

function answers(patch: Partial<RepresentativeCountryAnswers> = {}): RepresentativeCountryAnswers {
  return {
    birth_place: "Synthetic city", birth_country: "RU",
    residence_since: null, stay_reason: null, stay_reason_details: null,
    pep_self: null, pep_related: null, sanctions_links: null,
    pep_office: null, pep_country: null, pep_period: null,
    pep_relationship: null, pep_wealth_origin: null,
    sanctions_link_name: null, sanctions_link_kind: null, sanctions_link_since_extent: null,
    ...patch,
  };
}

function representative(id: string, firstName: string, country: string) {
  return {
    id, slot: id === ANNA ? "rep1" : "rep2", role: "legal_representative", relation: "parent", mine: id === ANNA,
    email_locked: true, can_remove: false, first_name: firstName, last_name: "Canonical",
    date_of_birth: "1985-03-02", birth_place: "Synthetic city", birth_country: country,
    citizenships: [country], street: "Synthetic street 1", zip: "00000",
    city: "Synthetic city", country, email: `${firstName.toLowerCase()}@example.com`,
    phone: "+491234567890", identity_documents: [], authority_documents: [],
  };
}

function leadRequest() {
  return {
    lead_id: "lead-1", access_kind: "guardian", created_at: "2026-10-14T08:00:00Z",
    personal_data: {
      first_name: "Mia", middle_name: null, last_name: "Canonical", date_of_birth: "2015-06-01",
      legal_sex: "female", citizenships: ["DE"], street_address: "Synthetic street 1",
      zip_code: "00000", city: "Berlin", country: "DE", phone: null,
      primary_language: "de", has_insurance: false, insurance_type: null,
      insurance_provider: null, insurance_number: null, insurance_covers_germany: null,
    },
    progress: { filled: 12, total: 12, missing_for_submit: [] as string[], missing_by_step: {} },
    payer: {
      payer_kind: "third_party", payer_type: "organisation", organisation_name: "Synthetic payer",
      citizenships: ["DE"], country: "DE", first_name: null, last_name: null,
      date_of_birth: null, street: null, zip: null, city: null, relationship: "employer",
      email: "payer@example.com", phone: null, acts_on_own_account: true,
      answered_by_payer: true, beneficial_owner: null, contact_consent_at: "2026-10-14T08:00:00Z",
    },
    payer_self_template: null,
    identification: {
      salutation: null, former_names: null, birth_place: "Berlin", birth_country: "DE",
      habitual_residence_country: null, contact_channels: ["email"],
      pep_self: false, pep_related: false, sanctions_links: false,
      payment_background: null, declared_correct_at: null, request_reason: "Synthetic request",
    },
    identity_documents: [],
    representation: {
      has_representative: null, under_guardianship: null, custody: "joint", custody_stated: true,
      document_stage: false,
      representatives: [representative(ANNA, "Anna", "RU"), representative(BEN, "Ben", "DE")],
    },
    billing: {
      invoice_to: "self", invoice_name: null, invoice_street: null, invoice_zip: null,
      invoice_city: null, invoice_country: null, invoice_email: null, payer_declared: true,
      payment_route_by: "payer", payment_method: "transfer", payment_method_details: null,
      account_country: "DE", account_holder: null, bank_name: null,
      via_third_party: false, via_third_party_details: null, via_third_party_kind: null,
      expected_total_eur: null, account_holder_suggestion: null,
    },
    follow_up: {
      before_submit: true, required: true, blocks: ["R"], missing: {} as Record<string, string[]>,
      answered_at: null as string | null, changed_since_answer: false,
      representatives: [{ id: ANNA, name: "Anna Canonical", fields: answers(), country_questions: true, missing: [] as string[] }],
      answers: {}, funds_source_options: [], funds_proof_documents: [], relationship_proof_documents: [], identity_documents: [],
    },
    review_notice: false, payer_questionnaire: null, minor: true, documents: [], max_documents: 30,
    consents: {
      health_data_processing: { type: "health_data_processing", version: "2026-10-03", texts: { de: "Synthetic health consent" }, given_at: "2026-10-14T08:00:00Z" },
      lead_inquiry_processing: { type: "lead_inquiry_processing", version: "2026-10-03", texts: { de: "Synthetic inquiry consent" }, given_at: "2026-10-14T08:00:00Z" },
    },
    submitted_at: null as string | null, changed_since_submit: false, retention_deadline_at: "2026-10-28T08:00:00Z",
  };
}

type RequestMock = ReturnType<typeof leadRequest>;
type Language = "de" | "en" | "uk" | "ru";

function recompute(request: RequestMock) {
  for (const person of request.follow_up.representatives) {
    const fields = person.fields;
    const blank = (key: keyof RepresentativeCountryAnswers) => fields[key] === null || fields[key] === "";
    person.missing = person.country_questions ? [
      ...BOOLEAN_FIELDS.filter((field) => blank(field)),
      ...(["birth_place", "birth_country", "residence_since", "stay_reason"] as const).filter((field) => blank(field)),
      ...(fields.stay_reason === "other" && blank("stay_reason_details") ? ["stay_reason_details"] : []),
      ...(fields.pep_self === true || fields.pep_related === true ? PEP_FIELDS.filter((field) => blank(field)) : []),
      ...(fields.pep_related === true && blank("pep_relationship") ? ["pep_relationship"] : []),
      ...(fields.sanctions_links === true ? SANCTIONS_FIELDS.filter((field) => blank(field)) : []),
    ] : [];
  }
  request.follow_up.missing = request.follow_up.required ? {
    R: request.follow_up.representatives.flatMap((person) => person.missing.map((field) => `representative:${person.id}:${field}`)),
  } : {};
}

async function setup(
  page: Page,
  prepare?: (request: RequestMock) => void,
  options: { lang?: Language; delayFirstSave?: boolean; refuseFirstSave?: boolean; closeAfterFirstSave?: boolean } = {},
) {
  await startClockAt(page);
  const request = leadRequest();
  const lang = options.lang ?? "de";
  request.personal_data.primary_language = lang;
  prepare?.(request);
  recompute(request);
  const calls: { id: string; patch: Partial<RepresentativeCountryAnswers> }[] = [];
  const dataCalls: { id: string; patch: Record<string, unknown> }[] = [];
  let releaseFirst: (() => void) | undefined;
  let firstReplyFinished = false;
  await page.addInitScript((lang) => {
    localStorage.setItem("gmed_lang", lang);
    localStorage.setItem("gmed_access_token", "synthetic-parent-cabinet-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({ json: {
        id: "parent-user", email: "anna@example.com", name: "Anna Canonical", role: "patient",
        capabilities: [], preferred_language: lang, password_change_required: false,
        portal_mode: "lead", lead_portal: { requests: 1 }, created_at: "2026-10-14T08:00:00Z",
      } });
    }
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [request] } });
    const match = path.match(/^\/me\/lead-requests\/lead-1\/representatives\/([^/]+)\/country-questions$/);
    if (req.method() === "POST" && match) {
      const id = match[1];
      const patch = req.postDataJSON() as Partial<RepresentativeCountryAnswers>;
      calls.push({ id, patch });
      if (options.refuseFirstSave && calls.length === 1) {
        return route.fulfill({ status: 422, json: { code: "invalid_field", field: "residence_since", message: "Synthetic refusal" } });
      }
      const person = request.follow_up.representatives.find((person) => person.id === id);
      if (!person) return route.fulfill({ status: 404, json: { code: "representative_not_found" } });
      Object.assign(person.fields, patch);
      const basic = request.representation.representatives.find((value) => value.id === id);
      if (basic) {
        for (const key of ["birth_place", "birth_country"] as const) {
          if (key in patch) Object.assign(basic, { [key]: patch[key] });
        }
      }
      if (person.fields.pep_self !== true && person.fields.pep_related !== true) {
        for (const field of PEP_FIELDS) person.fields[field] = null;
      }
      if (person.fields.pep_related !== true) person.fields.pep_relationship = null;
      if (person.fields.sanctions_links !== true) {
        for (const field of SANCTIONS_FIELDS) person.fields[field] = null;
      }
      if (person.fields.stay_reason !== "other") person.fields.stay_reason_details = null;
      recompute(request);
      if (options.closeAfterFirstSave && calls.length === 1) {
        Object.assign(request.follow_up, { before_submit: false, required: false, blocks: [], missing: {}, representatives: [], answered_at: "2026-10-14T12:00:00Z" });
        request.submitted_at = "2026-10-14T12:00:00Z";
      }
      const response = structuredClone(request);
      if (options.delayFirstSave && calls.length === 1) {
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
        await route.fulfill({ json: response });
        firstReplyFinished = true;
        return;
      }
      return route.fulfill({ json: response });
    }
    const personMatch = path.match(/^\/me\/lead-requests\/lead-1\/representatives\/([^/]+)$/);
    if (req.method() === "POST" && personMatch) {
      const id = personMatch[1];
      const patch = req.postDataJSON() as Record<string, unknown>;
      dataCalls.push({ id, patch });
      const person = request.representation.representatives.find((person) => person.id === id);
      if (!person) return route.fulfill({ status: 404, json: { code: "representative_not_found" } });
      Object.assign(person, patch);
      return route.fulfill({ json: request });
    }
    if (path === "/me/profile") return route.fulfill({ json: { id: "parent-user", email: "anna@example.com", name: "Anna Canonical", role: "patient", preferred_language: lang } });
    if (path.startsWith("/me/") || path.startsWith("/notifications")) return route.fulfill({ status: 403, json: { code: "lead_portal_only" } });
    return route.fulfill({ json: [] });
  });
  return { request, calls, dataCalls, release: () => releaseFirst?.(), firstReplyFinished: () => firstReplyFinished };
}

const step = (page: Page, id: string) => page.locator(`[data-step="${id}"]`).click();
const personBlock = (page: Page, id: string) => page.getByTestId(`lead-request-representative-questions-${id}`);
const field = (page: Page, id: string, name: string) => page.locator(`#representative-${id}-${name}`);

async function choose(page: Page, select: Locator, label: string) {
  await select.click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

test.describe("Parent country follow-up", () => {
  for (const lang of ["de", "en", "uk", "ru"] as const) {
    test(`DE child and RU parent show a named R before submission with existing answers (${lang})`, async ({ page }) => {
      const { request, calls } = await setup(page, (request) => {
        request.follow_up.representatives[0].fields = answers({
          pep_self: false, pep_related: false, sanctions_links: false,
          residence_since: "2010", stay_reason: "citizenship_or_birth",
        });
      }, { lang });
      await page.goto("/");
      await step(page, "follow_up");
      await expect(personBlock(page, ANNA)).toBeVisible();
      await expect(personBlock(page, ANNA)).toContainText("Anna Canonical");
      await expect(page.getByTestId("lead-request-follow-up")).toContainText(leadRequestText(lang).representativeQuestionsIntro);
      await expect(field(page, ANNA, "residence_since")).toHaveValue("2010");
      await expect(field(page, ANNA, "pep_self")).toContainText(leadRequestText(lang).yesNo.no);
      await expect(field(page, ANNA, "pep_related")).toContainText(leadRequestText(lang).yesNo.no);
      await expect(field(page, ANNA, "sanctions_links")).toContainText(leadRequestText(lang).yesNo.no);
      await expect(personBlock(page, BEN)).toHaveCount(0);
      for (const block of ["A", "F", "K", "L", "H", "J"]) {
        await expect(page.getByTestId(`lead-request-follow-up-${block}`)).toHaveCount(0);
      }
      await expect(page.getByTestId("lead-request-follow-up-submit")).toHaveCount(0);
      expect(request.identification.pep_self).toBe(false);
      expect(calls).toEqual([]);
      expect(await page.getByTestId("lead-request-follow-up").innerText()).not.toMatch(/T1\b|T2\b|T3\b|risk score|Punkte|рівень ризику|балл риска/i);
    });

    test(`child fields and identity uploads explicitly name the child and keep parents separate (${lang})`, async ({ page }) => {
      await setup(page, (request) => { request.representation.document_stage = true; }, { lang });
      const text = leadRequestText(lang);
      await page.goto("/");
      await step(page, "person");
      const person = page.getByTestId("lead-request-step-person");
      await expect(person.getByRole("heading", { name: text.childSections.person, exact: true })).toBeVisible();
      await expect(person.getByRole("heading", { name: text.childSections.address, exact: true })).toBeVisible();
      await expect(person.getByRole("heading", { name: text.childSections.contact, exact: true })).toBeVisible();
      await expect(page.locator("#lead-request-salutation")).toHaveCount(0);
      await expect(page.getByTestId("lead-request-rep1-identity-upload")).toContainText(text.identityFiles);
      await expect(page.getByTestId("lead-request-rep1-identity-upload")).not.toContainText(text.childIdentityFiles);
      await expect(page.getByTestId("lead-request-rep2-identity-upload")).toContainText(text.identityFiles);
      await expect(page.getByTestId("lead-request-rep2-identity-upload")).not.toContainText(text.childIdentityFiles);
      await step(page, "identity");
      const identity = page.getByTestId("lead-request-step-identity");
      await expect(identity.getByRole("heading", { name: text.childSections.identity, exact: true })).toBeVisible();
      await expect(identity).toContainText(text.childIdentityFiles);
      await expect(identity.getByRole("button", { name: text.childIdentityUploadButton, exact: true })).toBeVisible();
      await expect(identity).toContainText(text.childIdentityUploadHint);
      await step(page, "billing");
      await expect(page.getByRole("heading", { name: text.childSections.insurance, exact: true })).toBeVisible();
      await step(page, "documents");
      const documents = page.getByTestId("lead-request-documents");
      await expect(documents.getByRole("heading", { name: text.childSections.request, exact: true })).toBeVisible();
      await expect(documents.getByRole("heading", { name: text.childSections.upload, exact: true })).toBeVisible();
    });
  }

  test("each parent saves separately and yes details hide and clear with no", async ({ page }) => {
    const { request, calls } = await setup(page, (request) => {
      request.representation.representatives[1].country = "RU";
      request.representation.representatives[1].citizenships = ["RU"];
      request.follow_up.representatives.push({ id: BEN, name: "Ben Canonical", fields: answers({ birth_country: "DE" }), country_questions: true, missing: [] });
    });
    await page.goto("/");
    await step(page, "follow_up");
    await choose(page, field(page, ANNA, "pep_self"), "Ja");
    await expect(field(page, ANNA, "pep_office")).toBeVisible();
    await field(page, ANNA, "pep_office").fill("Synthetic office");
    await field(page, ANNA, "pep_office").press("Tab");
    await expect.poll(() => request.follow_up.representatives[0].fields.pep_office).toBe("Synthetic office");
    await expect(field(page, BEN, "pep_office")).toHaveCount(0);
    await choose(page, field(page, BEN, "pep_self"), "Nein");
    await choose(page, field(page, BEN, "pep_related"), "Nein");
    await choose(page, field(page, BEN, "sanctions_links"), "Nein");
    await choose(page, field(page, ANNA, "sanctions_links"), "Ja");
    await expect(field(page, ANNA, "sanctions_link_name")).toBeVisible();
    await field(page, ANNA, "sanctions_link_name").fill("Synthetic contact");
    await field(page, ANNA, "sanctions_link_name").press("Tab");
    await expect.poll(() => request.follow_up.representatives[0].fields.sanctions_link_name).toBe("Synthetic contact");
    await choose(page, field(page, ANNA, "pep_self"), "Nein");
    await choose(page, field(page, ANNA, "sanctions_links"), "Nein");
    await expect(field(page, ANNA, "pep_office")).toHaveCount(0);
    await expect(field(page, ANNA, "sanctions_link_name")).toHaveCount(0);
    await expect.poll(() => request.follow_up.representatives[0].fields.pep_office).toBeNull();
    await expect.poll(() => request.follow_up.representatives[0].fields.sanctions_link_name).toBeNull();
    expect(calls.filter((call) => call.id === BEN).flatMap((call) => Object.keys(call.patch))).not.toContain("pep_office");
    expect(request.identification.pep_self).toBe(false);
    expect(request.identification.sanctions_links).toBe(false);
  });

  test("an older autosave response preserves newer typing in the same parent field", async ({ page }) => {
    const mock = await setup(page, undefined, { delayFirstSave: true });
    await page.goto("/");
    await step(page, "follow_up");
    const residence = field(page, ANNA, "residence_since");
    await residence.fill("First draft");
    await residence.press("Tab");
    await expect.poll(() => mock.calls.length).toBe(1);
    await residence.fill("Second draft");
    await residence.press("Tab");
    mock.release();
    await expect.poll(mock.firstReplyFinished).toBe(true);
    await expect(residence).toHaveValue("Second draft");
    await expect.poll(() => mock.request.follow_up.representatives[0].fields.residence_since).toBe("Second draft");
    expect(mock.calls.at(-1)).toEqual({ id: ANNA, patch: { residence_since: "Second draft" } });
  });

  test("unaffected nonpaying DE parents do not get follow-up or source-of-funds questions", async ({ page }) => {
    const { calls } = await setup(page, (request) => {
      request.representation.representatives[0].country = "DE";
      request.representation.representatives[0].citizenships = ["DE"];
      Object.assign(request.follow_up, { before_submit: false, required: false, blocks: [], representatives: [] });
    });
    await page.goto("/");
    await expect(page.locator('[data-step="follow_up"]')).toHaveCount(0);
    await expect(personBlock(page, ANNA)).toHaveCount(0);
    await expect(page.locator('[id$="funds_source"], [id$="funds_description"]')).toHaveCount(0);
    await step(page, "billing");
    await expect(page.getByTestId("lead-request-follow-up-A")).toHaveCount(0);
    expect(calls).toEqual([]);
  });

  test("missing parent answers use the person's name and fit a mobile screen", async ({ page }, testInfo) => {
    await setup(page);
    await page.goto("/");
    await step(page, "send");
    const summary = page.getByTestId("lead-request-send");
    await expect(summary).toContainText("Anna Canonical");
    await expect(summary).not.toContainText(ANNA);
    await expect(summary).not.toContainText(`representative:${ANNA}`);
    await step(page, "follow_up");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: testInfo.outputPath("parent-country-1440.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(personBlock(page, ANNA)).toBeVisible();
    await choose(page, field(page, ANNA, "pep_self"), "Ja");
    await choose(page, field(page, ANNA, "pep_related"), "Ja");
    await choose(page, field(page, ANNA, "sanctions_links"), "Ja");
    await expect(field(page, ANNA, "pep_relationship")).toBeVisible();
    await expect(field(page, ANNA, "sanctions_link_since_extent")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      return {
        scroll: document.documentElement.scrollWidth - width,
        widest: Math.max(0, ...Array.from(document.querySelectorAll("[data-testid=lead-request] *"), (node) => node.getBoundingClientRect().right - width)),
      };
    });
    expect(overflow).toEqual({ scroll: 0, widest: 0 });
    await page.screenshot({ path: testInfo.outputPath("parent-country-390.png"), fullPage: true, animations: "disabled" });
  });

  test("short parent form shows six basic fields and expands saved document details without resaving", async ({ page }, testInfo) => {
    const { dataCalls, request } = await setup(page);
    await page.goto("/");
    await step(page, "person");
    const mother = page.getByTestId("lead-request-representative-rep1");
    await expect(mother.locator("#lead-request-rep1_first_name")).toHaveValue("Anna");
    await expect(mother.locator("#lead-request-rep1_last_name")).toHaveValue("Canonical");
    await expect(mother.locator("#lead-request-rep1_email")).toHaveValue("anna@example.com");
    await expect(mother.locator("#lead-request-rep1_phone")).toHaveValue("+491234567890");
    await expect(mother.locator("#lead-request-rep1_citizenships")).toBeVisible();
    await expect(mother.getByRole("combobox", { name: leadRequestText("de").fields.country, exact: true })).toBeVisible();
    await expect(mother.locator("#lead-request-rep1_date_of_birth")).toHaveCount(0);
    await expect(mother.locator("#lead-request-rep1_street")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-rep1-identity-upload")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-rep2-identity-upload")).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mother.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("parent-short-1440.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 844 });
    await mother.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("parent-short-390.png"), fullPage: true, animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByTestId("lead-request-parent-document-details").click();
    await expect(mother.locator("#lead-request-rep1_date_of_birth")).toHaveValue("02.03.1985");
    await expect(mother.locator("#lead-request-rep1_street")).toHaveValue("Synthetic street 1");
    await expect(page.getByTestId("lead-request-rep1-identity-upload")).toBeVisible();
    await expect(page.getByTestId("lead-request-rep2-identity-upload")).toBeVisible();
    await page.getByTestId("lead-request-parent-document-details").click();
    await expect(mother.locator("#lead-request-rep1_date_of_birth")).toHaveCount(0);
    await expect(mother.locator("#lead-request-rep1_street")).toHaveCount(0);
    expect(dataCalls).toEqual([]);
    expect(request.representation.representatives[0].date_of_birth).toBe("1985-03-02");
    expect(request.representation.representatives[0].street).toBe("Synthetic street 1");
  });

  test("document stage keeps the full representative form and required uploads visible", async ({ page }) => {
    await setup(page, (request) => {
      request.representation.document_stage = true;
      request.progress.missing_for_submit = ["rep1_id_upload", "rep2_id_upload"];
    });
    await page.goto("/");
    await step(page, "person");
    await expect(page.getByTestId("lead-request-parent-document-details")).toHaveCount(0);
    await expect(page.locator("#lead-request-rep1_date_of_birth")).toHaveValue("02.03.1985");
    await expect(page.locator("#lead-request-rep2_date_of_birth")).toHaveValue("02.03.1985");
    await expect(page.locator("#lead-request-rep1_street")).toHaveValue("Synthetic street 1");
    await expect(page.getByTestId("lead-request-rep1-identity-upload")).toBeVisible();
    await expect(page.getByTestId("lead-request-rep2-identity-upload")).toBeVisible();
  });

  test("optional parent details preserve a changed address across hide and show", async ({ page }) => {
    const { dataCalls, request } = await setup(page);
    await page.goto("/");
    await step(page, "person");
    await page.getByTestId("lead-request-parent-document-details").click();
    await page.locator("#lead-request-rep1_street").fill("New synthetic street 7");
    await page.getByTestId("lead-request-parent-document-details").click();
    await expect(page.locator("#lead-request-rep1_street")).toHaveCount(0);
    await page.getByTestId("lead-request-parent-document-details").click();
    await expect(page.locator("#lead-request-rep1_street")).toHaveValue("New synthetic street 7");
    await expect.poll(() => request.representation.representatives[0].street).toBe("New synthetic street 7");
    expect(dataCalls).toEqual([{ id: ANNA, patch: { street: "New synthetic street 7" } }]);
    expect(request.representation.representatives[0].date_of_birth).toBe("1985-03-02");
    expect(request.representation.representatives[1].street).toBe("Synthetic street 1");
  });

  test("a refused parent question keeps the value and recovers after correction", async ({ page }) => {
    const { request, calls } = await setup(page, undefined, { refuseFirstSave: true });
    await page.goto("/");
    await step(page, "follow_up");
    const residence = field(page, ANNA, "residence_since");
    await residence.fill("Rejected draft");
    await residence.press("Tab");
    await expect(residence).toHaveAttribute("aria-invalid", "true");
    await expect(residence).toHaveValue("Rejected draft");
    expect(request.follow_up.representatives[0].fields.residence_since).toBeNull();
    await residence.fill("2010");
    await residence.press("Tab");
    await expect.poll(() => request.follow_up.representatives[0].fields.residence_since).toBe("2010");
    await expect(residence).not.toHaveAttribute("aria-invalid", "true");
    expect(calls.at(-1)).toEqual({ id: ANNA, patch: { residence_since: "2010" } });
  });

  test("a completed parent descriptor disappearing from a response does not blank the cabinet", async ({ page }) => {
    const { calls } = await setup(page, undefined, { closeAfterFirstSave: true });
    await page.goto("/");
    await step(page, "follow_up");
    await field(page, ANNA, "residence_since").fill("2010");
    await field(page, ANNA, "residence_since").press("Tab");
    await expect(personBlock(page, ANNA)).toHaveCount(0);
    await expect(page.locator('[data-step="follow_up"]')).toHaveCount(0);
    await expect(page.getByTestId("lead-request-step")).toBeVisible();
    await expect(page.getByTestId("lead-request-step")).not.toHaveAttribute("data-current-step", "follow_up");
    await expect(page.getByTestId("lead-request")).toContainText("Mia Canonical");
    expect(calls).toHaveLength(1);
  });

  test("conditional parent birthplace is reused and edits only that parent's basic identity", async ({ page }) => {
    const { request, calls } = await setup(page, (request) => {
      const parent = request.representation.representatives[0];
      parent.birth_place = "Synthetic parent birthplace";
      parent.birth_country = "AT";
      request.follow_up.representatives[0].fields = answers({
        birth_place: parent.birth_place, birth_country: parent.birth_country,
      });
    });
    await page.goto("/");
    await step(page, "person");
    await expect(page.locator("#lead-request-rep1_birth_place")).toHaveCount(0);
    await expect(page.locator("#lead-request-rep1_birth_country")).toHaveCount(0);
    await step(page, "follow_up");
    const parent = personBlock(page, ANNA);
    const birthplace = field(page, ANNA, "birth_place");
    await expect(birthplace).toHaveValue("Synthetic parent birthplace");
    await expect(parent.getByRole("combobox", { name: `Anna Canonical: ${leadRequestText("de").identificationFields.birth_country}`, exact: true })).toContainText("Österreich");
    await birthplace.fill("Corrected parent birthplace");
    await birthplace.press("Tab");
    await expect.poll(() => request.representation.representatives[0].birth_place).toBe("Corrected parent birthplace");
    await expect.poll(() => request.follow_up.representatives[0].fields.birth_place).toBe("Corrected parent birthplace");
    expect(calls).toEqual([{ id: ANNA, patch: { birth_place: "Corrected parent birthplace" } }]);
    expect(request.identification.birth_place).toBe("Berlin");
    expect(request.identification.birth_country).toBe("DE");
    expect(request.representation.representatives[1].birth_place).toBe("Synthetic city");
  });
});
