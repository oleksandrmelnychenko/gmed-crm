import { expect, test, type Locator, type Page } from "@playwright/test";

// Lead cabinet, the paying parent's own questionnaire (contract phase 3a,
// 5.2): the parent who pays for the child answers the payer-only questions
// in the cabinet — the payer notice first — and sends them on their own.
// Mocked API that behaves like the contract, synthetic data.

const LEAD = "lead-1";

/** The keys the paying parent may write (contract 5.2). */
const WRITABLE = [
  "salutation",
  "former_names",
  "habitual_residence_country",
  "language",
  "occupation",
  "funds_sources",
  "funds_description",
  "pep_self",
  "pep_self_details",
  "pep_related",
  "pep_related_details",
  "high_risk_country",
  "high_risk_country_code",
  "sanctions_links",
  "sanctions_links_details",
];

const LEGAL: Array<[string, string]> = [
  ["pep_self", "pep_self_details"],
  ["pep_related", "pep_related_details"],
  ["high_risk_country", "high_risk_country_code"],
  ["sanctions_links", "sanctions_links_details"],
];

type Questionnaire = {
  state: string;
  email: string;
  privacy: { acknowledged_at: string | null; text_version: string; contact_channels: string[] };
  answers: Record<string, unknown>;
  payment_route: { asked: boolean };
  identity_documents: unknown[];
  funds_proof_documents: Array<Record<string, unknown>>;
  funds_proof_required: boolean;
  missing_for_submit: string[];
  declared_correct_at: string | null;
  submitted_at: string | null;
};

function questionnaire(): Questionnaire {
  return {
    state: "draft",
    email: "anna.muster@example.com",
    privacy: { acknowledged_at: null, text_version: "payer-privacy-2026-10-06", contact_channels: [] },
    answers: {
      salutation: null,
      first_name: "Anna",
      last_name: "Muster",
      former_names: null,
      habitual_residence_country: null,
      language: null,
      occupation: null,
      funds_sources: [],
      funds_description: null,
      pep_self: null,
      pep_self_details: null,
      pep_related: null,
      pep_related_details: null,
      high_risk_country: null,
      high_risk_country_code: null,
      sanctions_links: null,
      sanctions_links_details: null,
    },
    payment_route: { asked: false },
    identity_documents: [],
    funds_proof_documents: [],
    funds_proof_required: false,
    missing_for_submit: [],
    declared_correct_at: null,
    submitted_at: null,
  };
}

/** A child's request in a parent's login; the parent answered "I pay (as a parent)". */
function childRequest(options: { paying: boolean }) {
  return {
    lead_id: LEAD,
    access_kind: "guardian",
    created_at: "2026-10-05T08:00:00Z",
    personal_data: {
      first_name: "Mia",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: "2015-06-01",
      legal_sex: "female",
      citizenships: ["DE"],
      street_address: "Musterstraße 1",
      zip_code: "10115",
      city: "Berlin",
      country: "DE",
      phone: null,
      primary_language: "de",
      has_insurance: false,
      insurance_type: "self_pay",
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    },
    // The request itself is complete: the payer's questions are not part of it.
    progress: { filled: 12, total: 12, missing_for_submit: [] as string[] },
    payer: {
      payer_kind: "third_party",
      payer_type: "person",
      organisation_name: null,
      first_name: options.paying ? "Anna" : "Ben",
      last_name: "Muster",
      date_of_birth: options.paying ? "1985-04-12" : "1983-02-01",
      street: null,
      zip: null,
      city: null,
      country: null,
      citizenships: ["DE"],
      relationship: null,
      relationship_kind: "parent",
      email: null,
      phone: null,
      acts_on_own_account: true,
      beneficial_owner: null,
      contact_consent_at: "2026-10-05T09:16:00Z",
    },
    payer_self_template: { first_name: "Anna", last_name: "Muster", date_of_birth: "1985-04-12", email: "anna.muster@example.com", phone: null },
    identification: {
      salutation: null,
      former_names: null,
      birth_place: "Berlin",
      birth_country: "DE",
      habitual_residence_country: null,
      contact_channels: ["email"],
      id_document_type: "passport",
      id_document_number: "C01X00T47",
      id_issuing_authority: "Bürgeramt Mitte",
      id_issuing_country: "DE",
      id_issued_on: null,
      id_valid_until: "2031-03-04",
      pep_self: false,
      pep_self_details: null,
      pep_related: false,
      pep_related_details: null,
      high_risk_country: false,
      high_risk_country_code: null,
      sanctions_links: false,
      sanctions_links_details: null,
      payment_background: null,
      declared_correct_at: null,
    },
    identity_documents: [],
    billing: {
      invoice_to: "payer",
      invoice_name: null,
      invoice_street: null,
      invoice_zip: null,
      invoice_city: null,
      invoice_country: null,
      invoice_email: null,
      payer_declared: true,
      payment_route_by: options.paying ? "guardian" : "payer",
      payment_method: options.paying ? "bank_transfer" : null,
      payment_method_details: null,
      account_country: options.paying ? "DE" : null,
      account_holder: options.paying ? "Anna Muster" : null,
      bank_name: options.paying ? "Musterbank" : null,
      via_third_party: options.paying ? false : null,
      via_third_party_details: null,
      account_holder_suggestion: options.paying ? "Anna Muster" : null,
    },
    payer_questionnaire: options.paying ? { available: true, submitted_at: null, missing_count: 7 } : null,
    minor: true,
    documents: [],
    max_documents: 30,
    consents: {
      health_data_processing: { type: "health_data_processing", version: "2026-10-03", texts: { de: "Ich willige ein …" }, given_at: null },
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: "2026-10-03",
        texts: { de: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden." },
        given_at: "2026-10-05T09:15:00Z",
      },
    },
    submitted_at: null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-19T08:00:00Z",
  };
}

/** Like the server (contract 3.5, D4): level 2 with a PEP or a high-risk country needs a proof of funds. */
function recompute(value: Questionnaire, representativeMissing: string[]) {
  const answers = value.answers;
  const missing: string[] = [];
  if (!value.privacy.acknowledged_at) missing.push("privacy_ack");
  missing.push(...representativeMissing);
  if (!answers.occupation) missing.push("occupation");
  const sources = answers.funds_sources as string[];
  if (sources.length === 0) missing.push("funds_sources");
  if (sources.includes("other") && !answers.funds_description) missing.push("funds_description");
  value.funds_proof_required = answers.pep_self === true || answers.pep_related === true || answers.high_risk_country === true;
  if (value.funds_proof_required && value.funds_proof_documents.length === 0) missing.push("funds_proof_upload");
  for (const [question, details] of LEGAL) {
    if (answers[question] == null) missing.push(question);
    else if (answers[question] === true && !answers[details]) missing.push(details);
  }
  value.missing_for_submit = missing;
}

async function setup(page: Page, options: { paying?: boolean; adult?: boolean; representativeMissing?: string[] } = {}) {
  const paying = options.paying ?? true;
  const request = childRequest({ paying }) as Record<string, unknown>;
  if (options.adult) {
    Object.assign(request, {
      access_kind: "self",
      minor: false,
      payer: { ...(request.payer as Record<string, unknown>), payer_kind: "self", first_name: null, last_name: null },
      payer_self_template: null,
      payer_questionnaire: null,
      billing: { ...(request.billing as Record<string, unknown>), invoice_to: "self", payer_declared: false, payment_route_by: "patient" },
    });
  }
  const representativeMissing = options.representativeMissing ?? [];
  const state = { questionnaire: questionnaire() };
  recompute(state.questionnaire, representativeMissing);
  const calls = {
    patches: [] as Record<string, unknown>[],
    consents: [] as Record<string, unknown>[],
    uploads: 0,
    withdrawals: [] as string[],
    submits: [] as unknown[],
    loads: 0,
    other: [] as string[],
  };
  const answer = () => {
    recompute(state.questionnaire, representativeMissing);
    return state.questionnaire;
  };
  const refuse = (status: number, code: string, field?: string) => ({ status, json: { code, message: code, ...(field ? { field } : {}) } });

  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", "lead-cabinet-payer-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1", "");
    const method = req.method();
    const base = `/me/lead-requests/${LEAD}`;
    const own = `${base}/payer-questionnaire`;

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "parent-user",
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
      return route.fulfill({ json: { requests: [request] } });
    }
    if (path === own && method === "GET") {
      calls.loads += 1;
      // Only the paying parent has the questionnaire (contract 5.2).
      if (!paying || options.adult) return route.fulfill(refuse(404, "not_found"));
      return route.fulfill({ json: answer() });
    }
    if (path === own && method === "POST") {
      const patch = req.postDataJSON() as Record<string, unknown>;
      calls.patches.push(patch);
      if (!state.questionnaire.privacy.acknowledged_at) return route.fulfill(refuse(403, "payer_consent_required"));
      if (state.questionnaire.submitted_at) return route.fulfill(refuse(409, "payer_submitted"));
      const unknown = Object.keys(patch).find((key) => !WRITABLE.includes(key));
      if (unknown) return route.fulfill(refuse(422, "invalid_field", unknown));
      Object.assign(state.questionnaire.answers, patch);
      for (const [question, details] of LEGAL) {
        if (state.questionnaire.answers[question] !== true) state.questionnaire.answers[details] = null;
      }
      return route.fulfill({ json: answer() });
    }
    if (path === `${own}/consent` && method === "POST") {
      const body = req.postDataJSON() as { acknowledged: boolean; contact_channels: string[] };
      calls.consents.push(body);
      state.questionnaire.privacy.acknowledged_at ??= "2026-10-06T10:00:00Z";
      state.questionnaire.privacy.contact_channels = body.contact_channels;
      return route.fulfill({ json: answer() });
    }
    if (path === `${own}/funds-proof` && method === "POST") {
      calls.uploads += 1;
      if (!state.questionnaire.privacy.acknowledged_at) return route.fulfill(refuse(403, "payer_consent_required"));
      state.questionnaire.funds_proof_documents.push({
        id: `proof-${calls.uploads}`,
        file_name: "kontoauszug.pdf",
        size_bytes: 2048,
        mime_type: "application/pdf",
        uploaded_at: "2026-10-06T10:20:00Z",
        reviewed: false,
        can_delete: true,
      });
      return route.fulfill({ status: 201, json: answer() });
    }
    if (path === `${own}/submit` && method === "POST") {
      const body = req.postDataJSON() as Record<string, unknown>;
      calls.submits.push(body);
      const current = answer();
      if (current.missing_for_submit.length > 0) {
        return route.fulfill({ status: 422, json: { code: "questionnaire_incomplete", message: "incomplete", missing: current.missing_for_submit } });
      }
      if (body.declared_correct !== true) return route.fulfill(refuse(422, "declaration_required"));
      Object.assign(state.questionnaire, { state: "submitted", declared_correct_at: "2026-10-06T10:30:00Z", submitted_at: "2026-10-06T10:30:00Z" });
      return route.fulfill({ json: answer() });
    }
    if (path.startsWith(`${base}/documents/`) && method === "DELETE") {
      const id = path.split("/").at(-1) ?? "";
      calls.withdrawals.push(id);
      state.questionnaire.funds_proof_documents = state.questionnaire.funds_proof_documents.filter((document) => document.id !== id);
      return route.fulfill({ json: request });
    }
    if (path.startsWith(`${base}/`) && method === "POST") {
      // The other parts of the request are complete: nothing of them is expected here.
      calls.other.push(path);
      return route.fulfill({ json: request });
    }
    if (path === "/me/profile") {
      return route.fulfill({ json: { id: "parent-user", email: "anna.muster@example.com", name: "Anna Muster", role: "patient", phone: null, preferred_language: "de" } });
    }
    if (path.startsWith("/me/") || path.startsWith("/notifications")) {
      return route.fulfill({ status: 403, json: { error: "Forbidden", code: "lead_portal_only", message: "Lead portal only" } });
    }
    return route.fulfill({ json: [] });
  });
  return { calls, state };
}

/** Picks an option of one of the cabinet's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const TITLE = "Angaben als zahlende Person";

test.describe("lead cabinet: the paying parent's questionnaire", () => {
  test("the paying parent acknowledges the notice first, then the answers save on their own and are sent", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const { calls } = await setup(page);
    await page.goto("/");
    const section = page.getByTestId("lead-request-payer-questionnaire");

    // After the payment route, before the legal questions of the request.
    await expect(page.getByRole("heading", { name: TITLE, exact: true })).toBeVisible();
    const order = await page.getByTestId("lead-request-data").locator("h3").evaluateAll((titles) => titles.map((title) => title.textContent));
    expect(order.slice(order.indexOf("Rechnungsempfänger"), order.indexOf("Gesetzliche Fragen (Geldwäscheprävention)") + 1)).toEqual([
      "Rechnungsempfänger",
      "Zahlungsweg",
      TITLE,
      "Gesetzliche Fragen (Geldwäscheprävention)",
    ]);
    await expect(section).toContainText("Name, Anschrift und Ausweis geben Sie im Abschnitt „Gesetzliche Vertreter“ an.");

    // The notice comes first: nothing else is asked before it.
    const notice = section.getByTestId("lead-request-payer-notice");
    await expect(notice).toContainText("Datenschutzhinweis für die zahlende Person");
    await expect(notice).toContainText("Verantwortlich für die Verarbeitung ist GMED.");
    await expect(notice).toContainText("§ 8 Abs. 4 GwG");
    await expect(notice.getByRole("link", { name: "Datenschutzhinweise" })).toHaveAttribute("href", "/legal#privacy");
    await expect(section.getByTestId("lead-request-payer-notice-first")).toHaveText(
      "Bitte bestätigen Sie zuerst den Datenschutzhinweis. Danach können Sie Ihre Angaben als zahlende Person machen.",
    );
    await expect(section.getByTestId("lead-request-payer-fields")).toHaveCount(0);
    await expect(section.getByTestId("lead-request-payer-missing-own").getByRole("listitem")).toHaveText([
      "Datenschutzhinweis bestätigen",
      "Beruf / Tätigkeit",
      "Herkunft der Mittel",
      "Gesetzliche Fragen: Öffentliches Amt",
      "Gesetzliche Fragen: Politisch exponierte nahestehende Person",
      "Gesetzliche Fragen: Land mit hohem Risiko",
      "Gesetzliche Fragen: Sanktionen",
    ]);
    await expect(section.getByTestId("lead-request-payer-submit")).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("lead-cabinet-payer-notice-de-desktop.png"), animations: "disabled", fullPage: true });

    await notice.getByRole("checkbox", { name: "E-Mail" }).check();
    await notice.getByRole("checkbox", { name: "Ich habe die Datenschutzhinweise gelesen." }).check();
    await expect.poll(() => calls.consents).toEqual([{ acknowledged: true, contact_channels: ["email"] }]);
    await expect(notice).toContainText("Bestätigt am 06.10.2026 12:00");
    await expect(notice.getByRole("checkbox", { name: "Ich habe die Datenschutzhinweise gelesen." })).toBeDisabled();
    const fields = section.getByTestId("lead-request-payer-fields");
    await expect(fields).toBeVisible();
    expect(calls.patches).toEqual([]);

    // Only the payer-only keys, each saved when it changed.
    await choose(page, fields.getByRole("combobox", { name: "Anrede" }), "Frau");
    await expect.poll(() => calls.patches.at(-1)).toEqual({ salutation: "ms" });
    await fields.getByRole("textbox", { name: /Beruf \/ Tätigkeit/ }).fill("Ingenieurin");
    await expect.poll(() => calls.patches.at(-1)).toEqual({ occupation: "Ingenieurin" });
    await fields.getByRole("checkbox", { name: "Gehalt / nichtselbständige Arbeit" }).check();
    await fields.getByRole("checkbox", { name: "Sonstiges" }).check();
    await expect.poll(() => calls.patches.at(-1)).toEqual({ funds_sources: ["employment", "other"] });
    await expect(section.getByTestId("lead-request-payer-missing-own")).toContainText("Beschreibung der Herkunft der Mittel");
    await fields.getByRole("textbox", { name: /Beschreibung der Herkunft der Mittel/ }).fill("Gehalt und ein Bausparvertrag");
    await expect.poll(() => calls.patches.at(-1)).toEqual({ funds_description: "Gehalt und ein Bausparvertrag" });
    // Nothing else of the person is asked here.
    for (const label of ["Vorname", "Nachname", "Geburtsdatum", "Dokumentnummer"]) {
      await expect(fields.getByRole("textbox", { name: label, exact: true })).toHaveCount(0);
    }

    // A PEP: level 2, the proof of funds becomes required.
    const proof = section.getByTestId("lead-request-payer-funds-proof");
    await expect(proof).toContainText("optional");
    const legal = section.getByTestId("lead-request-payer-legal");
    await choose(page, legal.getByRole("combobox", { name: /Üben Sie ein hochrangiges öffentliches Amt aus/ }), "Ja");
    await expect.poll(() => calls.patches.at(-1)).toEqual({ pep_self: true });
    await expect(proof).toHaveAttribute("data-required", "true");
    await expect(proof).toContainText("erforderlich");
    await expect(proof).toContainText("Für diese Zahlung schreibt das Geldwäschegesetz einen Nachweis der Herkunft der Mittel vor.");
    await legal.getByRole("textbox", { name: /Amt, Land und Zeitraum/ }).fill("Stadträtin 2020–2024");
    await expect.poll(() => calls.patches.at(-1)).toEqual({ pep_self_details: "Stadträtin 2020–2024" });
    for (const question of [/Ist ein unmittelbares Familienmitglied/, /Haben Sie oder eine beteiligte Person Wohnsitz/, /Bestehen Verbindungen zu Personen/]) {
      await choose(page, legal.getByRole("combobox", { name: question }), "Nein");
    }
    await expect.poll(() => Object.assign({}, ...calls.patches)).toMatchObject({ pep_related: false, high_risk_country: false, sanctions_links: false });
    await expect(section.getByTestId("lead-request-payer-missing-own").getByRole("listitem")).toHaveText(["Nachweis der Herkunft der Mittel"]);

    await page.locator("#lead-request-payer-funds-proof-files").setInputFiles({
      name: "kontoauszug.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic"),
    });
    await expect(proof.getByTestId("lead-request-payer-funds-proof-list")).toContainText("kontoauszug.pdf");
    expect(calls.uploads).toBe(1);
    await expect(section.getByTestId("lead-request-payer-missing-own")).toHaveCount(0);

    // Every body held only keys the parent may write.
    for (const patch of calls.patches) {
      for (const key of Object.keys(patch)) expect(WRITABLE).toContain(key);
    }
    expect(calls.other).toEqual([]);

    const submit = section.getByTestId("lead-request-payer-submit");
    await expect(submit).toBeDisabled();
    await section.getByTestId("lead-request-payer-declaration").getByRole("checkbox").check();
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("lead-cabinet-payer-filled-de-desktop.png"), animations: "disabled", fullPage: true });
    await submit.click();
    await expect(section.getByTestId("lead-request-payer-sent")).toContainText(
      "Ihre Angaben als zahlende Person wurden am 06.10.2026 12:30 gesendet.",
    );
    expect(calls.submits).toEqual([{ declared_correct: true }]);
    await expect(fields.getByRole("textbox", { name: /Beruf \/ Tätigkeit/ })).toBeDisabled();
    await expect(section.getByTestId("lead-request-payer-submit")).toHaveCount(0);

    // The request itself does not wait for the payer's questions.
    await page.locator('[data-step="send"]').click();
    await expect(page.getByTestId("lead-request-missing")).toHaveCount(0);
  });

  test("what the representatives' block still lacks is named with that section, and the phone layout holds", async ({ page }, testInfo) => {
    const { calls } = await setup(page, { representativeMissing: ["birth_place", "id_document_number", "id_document_upload"] });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const section = page.getByTestId("lead-request-payer-questionnaire");
      await section.getByTestId("lead-request-payer-notice").getByRole("checkbox", { name: "Ich habe die Datenschutzhinweise gelesen." }).check();
      await expect(section.getByTestId("lead-request-payer-fields")).toBeVisible();
      const elsewhere = section.getByTestId("lead-request-payer-missing-representatives");
      await expect(elsewhere).toContainText("Bitte im Abschnitt „Gesetzliche Vertreter“ ergänzen:");
      await expect(elsewhere.getByRole("listitem")).toHaveText([
        "Geburtsort",
        "Ausweisdokument: Dokumentnummer",
        "Ausweisdokument: Foto oder Scan des Ausweises",
      ]);
      expect(await overflow(page), `${width}px`).toBeLessThanOrEqual(1);
      await section.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`lead-cabinet-payer-elsewhere-de-${width}.png`), animations: "disabled", fullPage: true });
    }
    // The answers here cannot send it while the person's data are missing.
    await page.getByTestId("lead-request-payer-declaration").getByRole("checkbox").check();
    await expect(page.getByTestId("lead-request-payer-submit")).toBeDisabled();
    expect(calls.submits).toEqual([]);
  });

  test("the other parent, who does not pay, and an adult self-payer see no such section", async ({ page }) => {
    const other = await setup(page, { paying: false });
    await page.goto("/");
    await expect(page.getByTestId("lead-request-payment-route-by-payer")).toBeVisible();
    await expect(page.getByRole("heading", { name: TITLE })).toHaveCount(0);
    await expect(page.getByTestId("lead-request-payer-questionnaire")).toHaveCount(0);
    expect(other.calls.loads).toBe(0);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    const adult = await setup(page, { adult: true });
    await page.goto("/");
    await expect(page.getByTestId("lead-request-billing")).toBeVisible();
    await expect(page.getByTestId("lead-request-payer-questionnaire")).toHaveCount(0);
    expect(adult.calls.loads).toBe(0);
  });
});
