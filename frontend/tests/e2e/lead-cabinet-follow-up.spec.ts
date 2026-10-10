import { expect, test, type Locator, type Page } from "@playwright/test";

// Lead cabinet as a stepper with the follow-up blocks (trigger flow
// 2026-10-07, contract sections 3, 6 and 13): short steps with badges from
// `missing_by_step`, the identity document as an upload only, the payer's
// organisation mask, "Grund der Anfrage", and after sending only the blocks
// the server opened under a neutral heading — never points, levels or
// reasons. Mocked API, synthetic data.

const CONSENT_VERSION = "2026-10-03";

type Json = Record<string, unknown>;

function leadRequest() {
  return {
    lead_id: "lead-1",
    access_kind: "self",
    created_at: "2026-10-07T08:00:00Z",
    personal_data: {
      first_name: "Anna",
      middle_name: null,
      last_name: "Muster",
      date_of_birth: "1988-05-01",
      legal_sex: "female",
      citizenships: ["DE"],
      street_address: null,
      zip_code: null,
      city: null,
      country: null,
      phone: null,
      primary_language: "de",
      has_insurance: null,
      insurance_type: null,
      insurance_provider: null,
      insurance_number: null,
      insurance_covers_germany: null,
    } as Json,
    progress: {
      filled: 4,
      total: 12,
      missing_for_submit: [] as string[],
      missing_by_step: {} as Record<string, string[]>,
    },
    payer: null as Json | null,
    payer_self_template: null as Json | null,
    identification: {
      salutation: null,
      former_names: null,
      birth_place: "Kyiv",
      birth_country: "UA",
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
    } as Json,
    identity_documents: [] as Json[],
    representation: {
      has_representative: false,
      under_guardianship: false,
      custody: null,
      custody_stated: false,
      representatives: [],
    } as Json,
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
    } as Json,
    follow_up: {
      required: false,
      blocks: [] as string[],
      missing: {} as Record<string, string[]>,
      answered_at: null as string | null,
      answers: {
        funds_source: null,
        funds_description: null,
        payer_funds_source: null,
        payer_funds_description: null,
        occupation: null,
        sector: null,
      } as Json,
      funds_source_options: ["income", "savings", "asset_sale", "inheritance_gift", "other"],
      funds_proof_documents: [] as Json[],
      relationship_proof_documents: [] as Json[],
    },
    review_notice: false,
    payer_questionnaire: null,
    minor: false,
    documents: [] as Json[],
    max_documents: 30,
    consents: {
      health_data_processing: {
        type: "health_data_processing",
        version: CONSENT_VERSION,
        texts: { de: "Ich willige ein … (Art. 9 Abs. 2 lit. a DSGVO) …" },
        given_at: null as string | null,
      },
      lead_inquiry_processing: {
        type: "lead_inquiry_processing",
        version: CONSENT_VERSION,
        texts: { de: "Ich bin einverstanden, dass meine Angaben zur Bearbeitung meiner Anfrage verarbeitet werden." },
        given_at: "2026-10-07T08:05:00Z" as string | null,
      },
    } as Record<string, { type: string; version: string; texts: Record<string, string>; given_at: string | null }>,
    submitted_at: null as string | null,
    changed_since_submit: false,
    retention_deadline_at: "2026-10-21T08:00:00Z",
  };
}

type LeadRequestMock = ReturnType<typeof leadRequest>;

/** Like the server: what each step still misses, and what each open block misses. */
function recompute(request: LeadRequestMock) {
  const data = request.personal_data;
  const id = request.identification;
  const filled = (value: unknown) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== "");
  const byStep: Record<string, string[]> = {
    person: ["date_of_birth", "legal_sex", "citizenships"].filter((key) => !filled(data[key])),
    contact: ["street_address", "zip_code", "city", "country"].filter((key) => !filled(data[key])),
    identity: request.identity_documents.length > 0 ? [] : ["id_document_upload"],
    payer: [] as string[],
    billing: request.billing.invoice_to ? [] : ["invoice_to"],
    // The legal questions and the own economic interest are follow-up block L (owner 2026-10-09): not in the base form.
  };
  const payer = request.payer;
  if (!payer) byStep.payer.push("payer_kind");
  else if (payer.payer_kind === "third_party" && payer.payer_type !== "person") {
    if (!payer.organisation_name) byStep.payer.push("payer_organisation_name");
    if (!payer.organisation_legal_form) byStep.payer.push("payer_legal_form");
    if (!payer.country) byStep.payer.push("payer_country");
    if (!payer.organisation_contact_name) byStep.payer.push("payer_contact_name");
    if (!payer.email && !payer.phone) byStep.payer.push("payer_email_or_phone");
  }
  const reason = id.request_reason ? [] : ["request_reason"];
  request.progress.missing_by_step = byStep;
  request.progress.missing_for_submit = [...Object.values(byStep).flat(), ...reason];

  // The open blocks and what each misses (contract 3.1).
  const answers = request.follow_up.answers;
  const missing: Record<string, string[]> = {};
  for (const block of request.follow_up.blocks) {
    if (block === "A") {
      missing.A = [
        ...(filled(answers.funds_source) ? [] : ["funds_source"]),
        ...(filled(answers.funds_description) ? [] : ["funds_description"]),
        ...(filled(answers.occupation) ? [] : ["occupation"]),
        ...(filled(answers.sector) ? [] : ["sector"]),
        ...(request.follow_up.funds_proof_documents.length > 0 ? [] : ["funds_proof_upload"]),
      ];
    }
    if (block === "B") {
      missing.B = ["payment_background", "relationship_since"].filter((key) => !filled(id[key]));
    }
    if (block === "C") {
      const billing = request.billing;
      missing.C = [
        ...(billing.payment_method ? [] : ["payment_method"]),
        ...(billing.via_third_party == null ? ["via_third_party"] : []),
      ];
    }
    if (block === "I") missing.I = request.identity_documents.length > 1 ? [] : ["id_document_upload"];
    // K: the birth data; L: the legal questions and the own economic interest (owner 2026-10-09).
    if (block === "K") missing.K = ["birth_place", "birth_country"].filter((key) => !filled(id[key]));
    if (block === "L") {
      missing.L = ["pep_self", "pep_related", "sanctions_links"].filter((key) => id[key] === null);
      if (payer && payer.acts_on_own_account == null) missing.L.push("payer_own_account");
      else if (payer?.acts_on_own_account === false && !payer.beneficial_owner) missing.L.push("payer_beneficial_owner");
    }
  }
  request.follow_up.missing = missing;
}

async function setup(page: Page, prepare?: (request: LeadRequestMock) => void) {
  const request = leadRequest();
  prepare?.(request);
  recompute(request);
  const calls = {
    personalData: [] as Json[],
    identification: [] as Json[],
    payer: [] as Json[],
    billing: [] as Json[],
    enhanced: [] as Json[],
    fundsProofs: 0,
    relationshipProofs: 0,
    identityUploads: 0,
    followUpSubmits: 0,
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
    const answer = () => {
      recompute(request);
      return route.fulfill({ json: request });
    };
    const upload = (list: Json[], name: string) =>
      list.push({
        id: `${name}-${list.length + 1}`,
        file_name: name,
        size_bytes: 4096,
        mime_type: "application/pdf",
        uploaded_at: "2026-10-07T09:00:00Z",
        uploaded_by_me: true,
        reviewed: false,
        can_delete: true,
      });

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "lead-user",
          email: "anna.muster@example.com",
          name: "Anna Muster",
          role: "patient",
          capabilities: [],
          created_at: "2026-10-07T08:00:00Z",
          preferred_language: "de",
          password_change_required: false,
          portal_mode: "lead",
          lead_portal: { requests: 1 },
        },
      });
    }
    if (path === "/me/lead-requests") return route.fulfill({ json: { requests: [request] } });
    if (method === "POST" && path === `${base}/personal-data`) {
      const patch = req.postDataJSON() as Json;
      calls.personalData.push(patch);
      Object.assign(request.personal_data, patch);
      return answer();
    }
    if (method === "POST" && path === `${base}/identification`) {
      const patch = req.postDataJSON() as Json;
      calls.identification.push(patch);
      // The identity document's data are staff's (contract 3.2).
      const staffOnly = Object.keys(patch).find((key) => key.startsWith("id_"));
      if (staffOnly) return route.fulfill({ status: 422, json: { code: "staff_only", field: staffOnly } });
      for (const [key, value] of Object.entries(patch)) request.identification[key] = value === "" ? null : value;
      return answer();
    }
    if (method === "POST" && path === `${base}/payer`) {
      const input = req.postDataJSON() as Json;
      calls.payer.push(input);
      const { contact_consent: consent, ...rest } = input;
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
        messenger: null,
        organisation_name: null,
        organisation_legal_form: null,
        organisation_register_number: null,
        organisation_contact_name: null,
        relationship_kind: null,
        payer_type: null,
        acts_on_own_account: request.payer?.acts_on_own_account ?? null,
        beneficial_owner: null,
        cost_estimate_consent_at: null,
        ...rest,
        contact_consent_at: consent ? "2026-10-07T09:00:00Z" : null,
      };
      return answer();
    }
    if (method === "POST" && path === `${base}/billing`) {
      const patch = req.postDataJSON() as Json;
      calls.billing.push(patch);
      for (const [key, value] of Object.entries(patch)) request.billing[key] = value === "" ? null : value;
      if (request.billing.via_third_party !== true) request.billing.via_third_party_kind = null;
      return answer();
    }
    if (method === "POST" && path === `${base}/enhanced-details`) {
      const patch = req.postDataJSON() as Json;
      calls.enhanced.push(patch);
      for (const [key, value] of Object.entries(patch)) request.follow_up.answers[key] = value === "" ? null : value;
      return answer();
    }
    if (method === "POST" && path === `${base}/funds-proof`) {
      calls.fundsProofs += 1;
      upload(request.follow_up.funds_proof_documents, "kontoauszug.pdf");
      return answer();
    }
    if (method === "POST" && path === `${base}/relationship-proof`) {
      calls.relationshipProofs += 1;
      upload(request.follow_up.relationship_proof_documents, "heiratsurkunde.pdf");
      return answer();
    }
    if (method === "POST" && path === `${base}/identity-document`) {
      calls.identityUploads += 1;
      upload(request.identity_documents, "reisepass.pdf");
      return answer();
    }
    if (method === "POST" && path === `${base}/follow-up/submit`) {
      calls.followUpSubmits += 1;
      recompute(request);
      const open = Object.fromEntries(Object.entries(request.follow_up.missing).filter(([, keys]) => keys.length > 0));
      if (Object.keys(open).length > 0) {
        return route.fulfill({ status: 422, json: { code: "follow_up_incomplete", missing: open } });
      }
      request.follow_up.answered_at = "2026-10-07T10:00:00Z";
      return answer();
    }
    if (path === "/me/profile") {
      return route.fulfill({ json: { id: "lead-user", email: "anna.muster@example.com", name: "Anna Muster", role: "patient", phone: null, preferred_language: "de" } });
    }
    if (path.startsWith("/me/") || path.startsWith("/notifications")) {
      return route.fulfill({ status: 403, json: { code: "lead_portal_only", message: "Lead portal only" } });
    }
    return route.fulfill({ json: [] });
  });
  return { request, calls };
}

/** Picks an option of one of the cabinet's selects (a searchable combobox). */
async function choose(page: Page, select: Locator, option: string) {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(0);
}

const tab = (page: Page, step: string) => page.locator(`[data-step="${step}"]`);

/** A sent request whose follow-up blocks are open: what the server shows after its assessment. */
function sentWithBlocks(blocks: string[]) {
  return (request: LeadRequestMock) => {
    Object.assign(request.personal_data, { street_address: "Musterstraße 1", zip_code: "10115", city: "Berlin", country: "DE" });
    Object.assign(request.identification, { pep_self: false, pep_related: false, sanctions_links: false, request_reason: "Zweitmeinung zur Knie-OP" });
    request.identity_documents.push({
      id: "id-doc-0",
      file_name: "reisepass.pdf",
      size_bytes: 4096,
      mime_type: "application/pdf",
      uploaded_at: "2026-10-07T08:10:00Z",
      uploaded_by_me: true,
      reviewed: false,
      can_delete: true,
    });
    request.billing.invoice_to = "self";
    request.payer = {
      payer_kind: "self",
      payer_type: null,
      organisation_name: null,
      organisation_legal_form: null,
      organisation_register_number: null,
      organisation_contact_name: null,
      acts_on_own_account: true,
      citizenships: [],
    };
    request.submitted_at = "2026-10-07T09:30:00Z";
    request.review_notice = true;
    request.follow_up = { ...request.follow_up, required: true, blocks, missing: {}, answered_at: null };
  };
}

/** Words of an assessment the lead must never read (contract P2). */
const RISK_WORDS = /risiko|risk|punkte|points|stufe|level|trigger|abgelehnt|rejected|verdacht|ризик|риск|балл/i;

test.describe("lead cabinet stepper and follow-up", () => {
  test("short steps with badges, free navigation, the identity document as an upload only, and the reason of the request", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto("/");

    // Six steps without open blocks: no "Ergänzende Angaben"; the contact is part of the first step and the
    // declarations are follow-up block L (owner 2026-10-09).
    const tabs = page.getByTestId("lead-request-steps").getByRole("tab");
    await expect(tabs).toHaveCount(6);
    await expect(tab(page, "follow_up")).toHaveCount(0);
    await expect(tab(page, "contact")).toHaveCount(0);
    await expect(tab(page, "declarations")).toHaveCount(0);
    await expect(tab(page, "person")).toHaveAttribute("aria-selected", "true");
    // No amber badge before "Weiter" (QA 2026-10-10).
    await expect(page.getByTestId("lead-request-step-badge")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-legal")).toHaveCount(0);
    // After "Weiter" the step's badge counts what it misses (the server's `missing_by_step`, the contact
    // keys in the first step); the other steps stay without one.
    await page.getByTestId("lead-request-step-person").getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "person");
    await expect(tab(page, "person").getByTestId("lead-request-step-badge")).toHaveText("4");
    await expect(tab(page, "identity").getByTestId("lead-request-step-badge")).toHaveCount(0);
    await expect(tab(page, "documents").getByTestId("lead-request-step-badge")).toHaveCount(0);

    // Free navigation: straight to the identity document, then back with the step bar.
    await tab(page, "identity").click();
    const identity = page.getByTestId("lead-request-step-identity");
    // The yellow list shows only after "Weiter"; the first press stays on the step (owner 2026-10-09).
    await expect(identity.getByTestId("lead-request-step-missing")).toHaveCount(0);
    await identity.getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "identity");
    await expect(identity.getByTestId("lead-request-step-missing")).toContainText("Ausweisdokument: Foto oder Scan des Ausweises");
    await expect(tab(page, "identity").getByTestId("lead-request-step-badge")).toHaveText("1");
    // No intro sentence above the upload (owner 2026-10-09).
    await expect(identity).not.toContainText("Bitte laden Sie ein Foto oder einen Scan");
    // Upload only: the document's data are staff's.
    await expect(page.getByRole("combobox", { name: "Art des Dokuments" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Dokumentnummer" })).toHaveCount(0);
    await expect(page.locator("#lead-request-id_valid_until")).toHaveCount(0);
    await page.locator("#lead-request-identity-files").setInputFiles({
      name: "reisepass.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await expect(page.getByTestId("lead-request-identity-list")).toContainText("reisepass.pdf");
    await expect(tab(page, "identity").getByTestId("lead-request-step-badge")).toHaveCount(0);
    await expect(identity.getByTestId("lead-request-step-missing")).toHaveCount(0);
    await page.getByRole("button", { name: "Zurück" }).click();
    await expect(page.getByTestId("lead-request-step-person")).toBeVisible();
    await page.locator("#lead-request-city").fill("Berlin");
    await expect.poll(() => calls.personalData.at(-1)).toEqual({ city: "Berlin" });
    await expect(tab(page, "person").getByTestId("lead-request-step-badge")).toHaveText("3");

    // "Anliegen & Unterlagen": the reason of the request, required, in the lead's own words.
    await tab(page, "documents").click();
    const reason = page.getByRole("textbox", { name: "Grund der Anfrage" });
    await expect(reason).toBeVisible();
    await reason.fill("Zweitmeinung zur Knie-OP");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ request_reason: "Zweitmeinung zur Knie-OP" });
    // Nothing of the identity document's data was ever sent.
    expect(calls.identification.some((patch) => Object.keys(patch).some((key) => key.startsWith("id_")))).toBe(false);

    // The summary lists what is missing by step, each with a way there.
    await tab(page, "send").click();
    // Once the summary was opened, every step that misses something shows its badge.
    await expect(tab(page, "payer").getByTestId("lead-request-step-badge")).toBeVisible();
    await expect(tab(page, "documents").getByTestId("lead-request-step-badge")).toHaveCount(0);
    const missing = page.getByTestId("lead-request-missing");
    await expect(missing.getByTestId("lead-request-missing-payer")).toContainText("Wer übernimmt die Kosten der Behandlung?");
    await missing.getByTestId("lead-request-missing-payer").getByRole("button", { name: "Wer zahlt" }).click();
    await expect(page.getByTestId("lead-request-step-payer")).toBeVisible();
  });

  test("an organisation pays: the organisation mask with legal form, register number and contact person", async ({ page }) => {
    const { calls } = await setup(page);
    await page.goto("/");
    await tab(page, "payer").click();
    const payer = page.getByTestId("lead-request-payer");
    await choose(page, payer.getByRole("combobox", { name: "Wer übernimmt die Kosten der Behandlung?" }), "Eine andere Person oder Organisation");
    await choose(page, payer.getByRole("combobox", { name: "Wer ist der Zahler?" }), "Unternehmen");
    await expect(payer.getByRole("textbox", { name: "Vorname" })).toHaveCount(0);
    await payer.getByRole("textbox", { name: "Name des Unternehmens" }).fill("Beispiel GmbH");
    await payer.getByRole("textbox", { name: "Rechtsform" }).fill("GmbH");
    await payer.getByRole("textbox", { name: "Registernummer (falls vorhanden)" }).fill("HRB 12345");
    await payer.getByRole("textbox", { name: "Ansprechperson" }).fill("Ben Muster");
    await expect(payer.getByTestId("lead-request-payer-email-or-phone")).toContainText("E-Mail oder Telefon");
    await expect.poll(() => calls.payer.at(-1)).toMatchObject({
      payer_kind: "third_party",
      payer_type: "company",
      organisation_name: "Beispiel GmbH",
      organisation_legal_form: "GmbH",
      organisation_register_number: "HRB 12345",
      organisation_contact_name: "Ben Muster",
    });
    const stepMissing = page.getByTestId("lead-request-step-payer").getByTestId("lead-request-step-missing");
    // What is missing shows after "Weiter" (owner 2026-10-09).
    await expect(stepMissing).toHaveCount(0);
    await page.getByTestId("lead-request-step-payer").getByRole("button", { name: "Weiter" }).click();
    await expect(stepMissing).toContainText("Zahler: E-Mail oder Telefon");
    await expect(stepMissing).toContainText("Zahler: Land des Sitzes");
    await payer.getByRole("textbox", { name: "Telefon" }).fill("+49 30 1234567");
    await expect(stepMissing).not.toContainText("E-Mail oder Telefon");

    // Back to a private person: the organisation mask goes with what was typed in it.
    await choose(page, payer.getByRole("combobox", { name: "Wer ist der Zahler?" }), "Privatperson");
    await expect(payer.getByRole("textbox", { name: "Rechtsform" })).toHaveCount(0);
    await expect.poll(() => calls.payer.at(-1)).not.toHaveProperty("organisation_legal_form");
    expect(calls.payer.at(-1)).toMatchObject({ payer_type: "person" });
  });

  test("blocks A and B open: only those sub-sections under a neutral heading, never why", async ({ page }) => {
    const { calls } = await setup(page, sentWithBlocks(["A", "B"]));
    await page.goto("/");

    // A sent request with open blocks opens in "Ergänzende Angaben"; its badge only after a
    // press on the step (QA 2026-10-10: no amber count on load).
    const followUp = page.getByTestId("lead-request-follow-up");
    await expect(followUp).toBeVisible();
    await expect(tab(page, "follow_up")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "follow_up").getByTestId("lead-request-step-badge")).toHaveCount(0);
    // No notice above the blocks (owner 2026-10-09): the step's name says it.
    await expect(page.getByTestId("lead-request-follow-up-notice")).toHaveCount(0);
    await expect(followUp).not.toContainText("Wir benötigen ergänzende Angaben");
    await expect(page.getByTestId("lead-request-follow-up-A")).toContainText("Herkunft der Mittel");
    await expect(page.getByTestId("lead-request-follow-up-B")).toContainText("Beziehung zur zahlenden Person");
    for (const block of ["C", "F", "G", "H", "I", "J", "K", "L"]) {
      await expect(page.getByTestId(`lead-request-follow-up-${block}`)).toHaveCount(0);
    }
    // Nothing of an assessment is in the page: no points, level, trigger or reason.
    expect(await page.locator("body").innerText()).not.toMatch(RISK_WORDS);

    // Step "send" points to the open blocks in one short line, and does not say that nothing
    // more is needed meanwhile (QA 2026-10-10).
    await tab(page, "send").click();
    await expect(page.getByTestId("lead-request-follow-up-open")).toContainText("Bitte ergänzen Sie noch einige Angaben.");
    await expect(page.getByTestId("lead-request-follow-up-open")).not.toContainText("Wir benötigen");
    await expect(page.getByTestId("lead-request-next-steps")).toContainText("ergänzen Sie Ihre Anfrage und senden Sie sie erneut");
    await expect(page.getByTestId("lead-request-next-steps")).not.toContainText("Bis dahin müssen Sie nichts weiter tun.");
    await expect(tab(page, "follow_up").getByTestId("lead-request-step-badge")).toHaveCount(0);
    await page.getByTestId("lead-request-follow-up-open").getByRole("button").click();
    await expect(followUp).toBeVisible();

    // Sending too early names what is still open, block by block.
    await page.getByTestId("lead-request-follow-up-submit").click();
    await expect(followUp).toContainText("Bitte ergänzen Sie zuerst die noch offenen Angaben.");
    await expect(page.getByTestId("lead-request-follow-up-A-missing")).toContainText("Nachweise zur Herkunft der Mittel");
    await expect(page.getByTestId("lead-request-follow-up-B-missing")).toContainText("Seit wann besteht die Beziehung?");
    await expect(tab(page, "follow_up").getByTestId("lead-request-step-badge")).toBeVisible();

    // Block A: one source from the list, the words, profession, sector and a proof.
    const blockA = page.getByTestId("lead-request-follow-up-A");
    await choose(page, blockA.getByRole("combobox", { name: "Herkunft der Mittel" }), "Einkommen");
    await blockA.getByRole("textbox", { name: "Bitte beschreiben Sie die Herkunft der Mittel" }).fill("Gehalt als Ingenieurin");
    await blockA.getByRole("textbox", { name: "Ihr Beruf" }).fill("Ingenieurin");
    await blockA.getByRole("textbox", { name: "Branche / Sektor Ihrer Tätigkeit" }).fill("Maschinenbau");
    await expect
      .poll(() => Object.assign({}, ...calls.enhanced))
      .toEqual({
        funds_source: "income",
        funds_description: "Gehalt als Ingenieurin",
        occupation: "Ingenieurin",
        sector: "Maschinenbau",
      });
    await page.locator("#lead-request-funds-proof-files").setInputFiles({
      name: "kontoauszug.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await expect(page.getByTestId("lead-request-funds-proof-list")).toContainText("kontoauszug.pdf");
    await expect(page.getByTestId("lead-request-follow-up-A-missing")).toHaveCount(0);

    // Block B: why the payer pays, since when, and a proof (optional).
    const blockB = page.getByTestId("lead-request-follow-up-B");
    // No relationship of the family named: no certificate as the example (QA 2026-10-10).
    await expect(blockB).toContainText("Zum Beispiel ein Dokument, aus dem die Beziehung hervorgeht");
    await expect(blockB).not.toContainText("Heirats- oder Geburtsurkunde");
    await blockB.getByRole("textbox", { name: "Warum übernimmt diese Person bzw. Organisation die Kosten?" }).fill("Familie");
    await blockB.getByRole("textbox", { name: "Seit wann besteht die Beziehung?" }).fill("2010");
    await expect
      .poll(() => Object.assign({}, ...calls.identification))
      .toEqual({ payment_background: "Familie", relationship_since: "2010" });
    await page.locator("#lead-request-relationship-proof-files").setInputFiles({
      name: "heiratsurkunde.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await expect(page.getByTestId("lead-request-relationship-proof-list")).toContainText("heiratsurkunde.pdf");
    await expect(tab(page, "follow_up").getByTestId("lead-request-step-badge")).toHaveCount(0);

    await page.getByTestId("lead-request-follow-up-submit").click();
    await expect(page.getByTestId("lead-request-follow-up-answered")).toContainText("Ihre Angaben werden geprüft.");
    expect(calls.followUpSubmits).toBe(2);

    // The summary: the neutral notice for every request alike, and the answers.
    await tab(page, "send").click();
    // One thank-you: the notice continues the sentence of the sending (QA 2026-10-10).
    await expect(page.getByTestId("lead-request-sent")).toHaveText(
      /^Ihre Angaben wurden am \d\d\.\d\d\.\d{4} \d\d:\d\d gesendet\. Wir prüfen sie und melden uns bei Ihnen\.$/,
    );
    await expect(page.getByTestId("lead-request-send")).toContainText("Vielen Dank!");
    expect(await page.getByTestId("lead-request-send").innerText()).not.toMatch(/Vielen Dank\.|werden geprüft\. Wir melden/);
    await expect(page.getByTestId("lead-request-follow-up-open")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-summary-follow_up")).toContainText("Einkommen");
    await expect(page.getByTestId("lead-request-summary-request")).toContainText("Zweitmeinung zur Knie-OP");
    expect(await page.locator("body").innerText()).not.toMatch(RISK_WORDS);
  });

  test("blocks C and I: the payment route with its extras, and a new copy of the identity document", async ({ page }) => {
    const { calls } = await setup(page, sentWithBlocks(["C", "I"]));
    await page.goto("/");
    await expect(page.getByTestId("lead-request-follow-up-A")).toHaveCount(0);

    const blockC = page.getByTestId("lead-request-follow-up-C");
    await choose(page, blockC.getByRole("combobox", { name: "Wie werden Sie bezahlen?" }), "Bar");
    await choose(page, blockC.getByRole("combobox", { name: /Erfolgt die Zahlung über eine dritte Person/ }), "Ja");
    await blockC.getByRole("textbox", { name: "Bitte beschreiben (wer, welcher Dienst)" }).fill("Mein Bruder");
    await choose(page, blockC.getByRole("combobox", { name: "Über wen erfolgt die Zahlung?" }), "Über eine andere Person");
    await blockC.getByRole("textbox", { name: "Voraussichtlicher Gesamtbetrag (EUR)" }).fill("12.500");
    await expect
      .poll(() => Object.assign({}, ...calls.billing))
      .toEqual({
        payment_method: "cash",
        via_third_party: true,
        via_third_party_details: "Mein Bruder",
        via_third_party_kind: "person",
        expected_total_eur: 12500,
      });
    // An amount that is no number is marked and not sent.
    await blockC.getByRole("textbox", { name: "Voraussichtlicher Gesamtbetrag (EUR)" }).fill("zwölf");
    await expect(blockC.getByText("Bitte prüfen Sie diese Angabe.")).toBeVisible();

    const blockI = page.getByTestId("lead-request-follow-up-I");
    // No intro sentence above the upload (owner 2026-10-09): the button says what to do.
    await expect(blockI).not.toContainText("Bitte laden Sie ein aktuelles, gut lesbares Foto");
    await expect(blockI.getByRole("button", { name: "Foto oder Scan des Ausweises hochladen" })).toBeEnabled();
    await blockI.locator("#lead-request-identity-files").setInputFiles({
      name: "reisepass-neu.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n%%EOF\n"),
    });
    await expect.poll(() => calls.identityUploads).toBe(1);
    await expect(page.getByTestId("lead-request-follow-up-I-missing")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(RISK_WORDS);
  });

  test("blocks K and L first: the birth data, the legal questions and the own economic interest", async ({ page }) => {
    const { calls } = await setup(page, (request) => {
      sentWithBlocks(["A", "L", "K"])(request);
      Object.assign(request.identification, { birth_place: null, birth_country: null, pep_self: null, pep_related: null, sanctions_links: null });
      request.payer = { ...request.payer, acts_on_own_account: null };
    });
    await page.goto("/");
    const followUp = page.getByTestId("lead-request-follow-up");
    await expect(followUp).toBeVisible();
    // The personal details and the legal questions come first (owner 2026-10-09).
    const order = await followUp
      .locator(':scope > div[data-testid^="lead-request-follow-up-"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-testid")));
    expect(order).toEqual(["lead-request-follow-up-K", "lead-request-follow-up-L", "lead-request-follow-up-A"]);

    // Block K: birth name, place and country of birth (no longer in the first step).
    const blockK = page.getByTestId("lead-request-follow-up-K");
    await expect(blockK).toContainText("Angaben zur Person");
    await expect(blockK.getByRole("textbox", { name: "Geburtsname (falls abweichend)" })).toBeVisible();
    await blockK.getByRole("textbox", { name: "Geburtsort" }).fill("Kyiv");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ birth_place: "Kyiv" });

    // Block L: the three legal questions, yes or no, and the own economic interest (no longer in the payer step).
    const blockL = page.getByTestId("lead-request-follow-up-L");
    await expect(blockL).toContainText("Fragen nach dem Geldwäschegesetz");
    await expect(blockL.getByTestId("lead-request-legal").getByRole("combobox")).toHaveCount(3);
    await choose(page, blockL.getByTestId("lead-request-legal-pep_self").getByRole("combobox"), "Nein");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ pep_self: false });
    await choose(page, blockL.getByRole("combobox", { name: "Handeln Sie im eigenen wirtschaftlichen Interesse?" }), "Nein");
    await blockL.getByRole("textbox", { name: /In wessen Interesse handeln Sie/ }).fill("Ben Muster, 01.01.1960, Berlin");
    await expect
      .poll(() => calls.payer.at(-1))
      .toMatchObject({ payer_kind: "self", acts_on_own_account: false, beneficial_owner: "Ben Muster, 01.01.1960, Berlin" });

    // "Weiter" shows what each block still misses and stays.
    await followUp.getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", "follow_up");
    await expect(page.getByTestId("lead-request-follow-up-K-missing")).toContainText("Geburtsland");
    await expect(page.getByTestId("lead-request-follow-up-L-missing")).toBeVisible();
    await expect(page.getByTestId("lead-request-follow-up-L-missing")).not.toContainText("wirtschaftlichen Interesse");

    // The first step asks none of it.
    await tab(page, "person").click();
    await expect(page.locator("#lead-request-birth_place")).toHaveCount(0);
    await expect(page.locator("#lead-request-former_names")).toHaveCount(0);
    await expect(page.getByTestId("lead-request-legal")).toHaveCount(0);
    expect(await page.locator("body").innerText()).not.toMatch(RISK_WORDS);
  });

  test("wide multi-column layout at 1440 px, one step at a time without horizontal scrolling at 390 px", async ({ page }, testInfo) => {
    const { calls } = await setup(page, sentWithBlocks(["A", "B", "C", "F", "H", "I", "J"]));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    await tab(page, "person").click();
    const person = page.getByTestId("lead-request-step-person");
    await expect(person).toBeVisible();
    // Three fields side by side, the steps in a column beside the form.
    const first = await page.locator("#lead-request-first_name").boundingBox();
    const last = await page.locator("#lead-request-last_name").boundingBox();
    const middle = await page.locator("#lead-request-middle_name").boundingBox();
    expect(first && last && middle).toBeTruthy();
    const nav = await page.getByTestId("lead-request-steps").boundingBox();
    const form = await page.getByTestId("lead-request-step").boundingBox();
    expect(nav && form && nav.x + nav.width <= form.x + 1).toBe(true);
    const columns = new Set(
      await Promise.all(
        ["#lead-request-salutation", "#lead-request-first_name", "#lead-request-last_name"].map(async (selector) =>
          Math.round((await page.locator(selector).boundingBox())?.x ?? 0),
        ),
      ),
    );
    expect(columns.size).toBe(3);
    await page.screenshot({ path: testInfo.outputPath("cabinet-1440-person.png"), fullPage: true });
    await tab(page, "follow_up").click();
    await expect(page.getByTestId("lead-request-follow-up")).toBeVisible();
    // Block F: a citizen of the country or a person born there has an answer of its own and
    // nothing to describe (QA 2026-10-10).
    const residence = page.getByTestId("lead-request-follow-up-F");
    await choose(page, residence.getByRole("combobox", { name: "Grund des Aufenthalts im Wohnsitzland" }), "Staatsangehörigkeit / dort geboren");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ stay_reason: "citizenship_or_birth" });
    await expect(residence.locator("#lead-request-stay_reason_details")).toHaveCount(0);
    // A named reason says enough: the words only for "other" (QA 2026-10-10).
    await choose(page, residence.getByRole("combobox", { name: "Grund des Aufenthalts im Wohnsitzland" }), "Arbeit");
    await expect.poll(() => calls.identification.at(-1)).toEqual({ stay_reason: "work" });
    await expect(residence.locator("#lead-request-stay_reason_details")).toHaveCount(0);
    await choose(page, residence.getByRole("combobox", { name: "Grund des Aufenthalts im Wohnsitzland" }), "Sonstiges");
    await expect(residence.locator("#lead-request-stay_reason_details")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("cabinet-1440-follow-up.png"), fullPage: true });

    // A phone: the dots side by side, the current step named below, no horizontal scrolling.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("lead-request-step-title")).toContainText("Ergänzende Angaben");
    for (const step of ["person", "identity", "payer", "billing", "follow_up", "documents", "send"]) {
      await tab(page, step).click();
      await expect(page.getByTestId("lead-request-step")).toHaveAttribute("data-current-step", step);
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const scroll = document.documentElement.scrollWidth - width;
        const widest = Math.max(
          0,
          ...Array.from(document.querySelectorAll("[data-testid=lead-request] *"), (node) => node.getBoundingClientRect().right - width),
        );
        return { scroll, widest };
      });
      expect(overflow, `step ${step}`).toEqual({ scroll: 0, widest: 0 });
    }
    await tab(page, "follow_up").click();
    await page.screenshot({ path: testInfo.outputPath("cabinet-390-follow-up.png"), fullPage: true });
    await tab(page, "person").click();
    await page.screenshot({ path: testInfo.outputPath("cabinet-390-person.png"), fullPage: true });

    // No visible step name is cut (QA 2026-10-10): on a phone the dots carry the names for screen
    // readers only and the current step is named in full below; on a tablet the named tabs wrap.
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const cut = await page.getByTestId("lead-request-steps").evaluate((nav) =>
        // Each visible text (the screen-reader names are 1 px wide; a corner badge may stick out of its dot).
        Array.from(nav.querySelectorAll<HTMLElement>("*"))
          .filter((node) => node.childElementCount === 0 && node.textContent?.trim())
          .filter((node) => node.getBoundingClientRect().width > 1 && node.scrollWidth > node.clientWidth + 1)
          .map((node) => node.textContent ?? ""),
      );
      expect(cut, `${width}px`).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBe(0);
      await page.screenshot({ path: testInfo.outputPath(`cabinet-${width}-steps.png`) });
    }
  });
});
