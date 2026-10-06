import { expect, test, type Page } from "@playwright/test";

// The payer's own link in the staff wizard (contract phase 3a, section 6):
// the panel "Zahler-Link" in "Wer zahlt" and the payer's answers in "Angaben
// des Patienten". Mocked API that behaves like the contract, synthetic data.

// The lead the wizard harness opens through "Lead intake".
const leadId = "00000000-0000-0000-0000-000000000222";

const lead = {
  id: leadId,
  first_name: "Mia",
  last_name: "Muster",
  email: "anna.muster@example.com",
  primary_language: "uk",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  wizard_state: {},
  services: [],
  attachments: [],
  readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
};

/** A third-party person who pays, with the lead's consent to contact him. */
const declaration = {
  payer_kind: "third_party",
  acts_on_own_account: true,
  own_account_answered: true,
  beneficial_owner_name: null,
  beneficial_owner_note: null,
  source_of_funds: "savings",
  source_of_funds_description: null,
  source_of_funds_document_id: null,
  first_name: "Viktor",
  last_name: "Zahler",
  date_of_birth: "1970-03-02",
  place_of_birth: "Wien",
  street: "Musterweg 1",
  zip: "1010",
  city: "Wien",
  country: "AT",
  citizenships: ["AT"],
  relationship: null,
  email: "viktor.zahler@example.com",
  phone: null,
  payer_informed_at: null,
  payer_informed_by: null,
  payer_type: "person",
  organisation_name: null,
  relationship_kind: "parent",
  contact_consent_at: "2026-10-05T09:30:00Z",
  updated_at: "2026-10-05T09:31:00Z",
};

/** The lead's own statements, sent with the request; the payer answers section 8. */
const portalStatements = {
  submitted_at: "2026-10-05T09:40:00Z",
  submitted_by: "self",
  identification: {
    salutation: "ms",
    former_names: null,
    birth_place: "Berlin",
    birth_country: "DE",
    habitual_residence_country: null,
    contact_channels: ["email"],
    id_document_type: "passport",
    id_document_number: "C01X00T47",
    id_issuing_authority: "Bürgeramt Mitte",
    id_issuing_country: "DE",
    id_issued_on: "2021-03-05",
    id_valid_until: "2031-03-04",
    pep_self: false,
    pep_self_details: null,
    pep_related: false,
    pep_related_details: null,
    high_risk_country: false,
    high_risk_country_code: null,
    sanctions_links: false,
    sanctions_links_details: null,
    payment_background: "Mein Vater zahlt.",
    declared_correct_at: "2026-10-05T09:40:00Z",
  },
  identification_updated_at: "2026-10-05T09:20:00Z",
  identity_documents: [],
  billing: {
    invoice_to: "payer",
    invoice_name: null,
    invoice_street: null,
    invoice_zip: null,
    invoice_city: null,
    invoice_country: null,
    invoice_email: null,
    invoice_vat_id: null,
    invoice_tax_number: null,
    payment_route_by: "payer",
    payment_method: "bank_transfer",
    payment_method_details: null,
    account_country: "AT",
    account_holder: "Viktor Zahler",
    bank_name: "Beispielbank",
    via_third_party: false,
    via_third_party_details: null,
    compliance_flags: [],
  },
  billing_updated_at: "2026-10-05T09:35:00Z",
};

type LinkState = Record<string, unknown>;

/** Nothing sent yet; the lead's request is in, so the link may go out. */
function freshState(patch: LinkState = {}): LinkState {
  return {
    mode: "link",
    can_send: true,
    blocked_reason: null,
    mail_available: true,
    link: null,
    estimated_total_eur: null,
    funds_proof_threshold_eur: 10000,
    questionnaire: null,
    ...patch,
  };
}

/** A link the server sent at 12:00 Berlin time (10:00 UTC). */
function sentLink(patch: LinkState = {}): LinkState {
  return {
    status: "sent",
    email: "viktor.zahler@example.com",
    language: "de",
    sent_at: "2026-10-06T10:00:00Z",
    sent_by_name: "Intake QA",
    expires_at: "2026-11-05T10:00:00Z",
    opened_at: null,
    verified_at: null,
    revoked_at: null,
    revoked_reason: null,
    last_email_status: "sent",
    ...patch,
  };
}

/** What the payer sent through the link at 12:30: a PEP, level 2, no proof of funds yet. */
function answeredQuestionnaire(patch: LinkState = {}): LinkState {
  return {
    patient_name: "Mia Muster",
    source: "link",
    payer_type: "person",
    state: "submitted",
    email: "viktor.zahler@example.com",
    email_confirmed_at: "2026-10-06T10:05:00Z",
    privacy: {
      acknowledged_at: "2026-10-06T10:06:00Z",
      text_version: "payer-privacy-2026-10-06",
      contact_channels: ["email"],
      ip: "203.0.113.7",
    },
    answers: {
      salutation: "mr",
      first_name: "Viktor",
      last_name: "Zahler",
      date_of_birth: "1970-03-02",
      birth_place: "Wien",
      birth_country: "AT",
      citizenships: ["AT"],
      street: "Musterweg 1",
      zip: "1010",
      city: "Wien",
      country: "AT",
      language: "de",
      id_document_type: "passport",
      id_document_number: "P1234567",
      id_issuing_authority: "BH Wien",
      id_issuing_country: "AT",
      id_issued_on: "2020-01-15",
      id_valid_until: "2030-01-14",
      relationship_kind: "parent",
      occupation: "Ingenieur",
      funds_sources: ["employment", "savings"],
      funds_description: "Gehalt und Ersparnisse",
      pep_self: true,
      pep_self_details: "Bürgermeister 2019–2024",
      pep_related: false,
      high_risk_country: false,
      sanctions_links: false,
    },
    payment_route: { payment_method: "bank_transfer", asked: true },
    identity_documents: [{ id: "doc-payer-id", file_name: "viktor-pass.pdf", uploaded_at: "2026-10-06T10:10:00Z", reviewed: false }],
    funds_proof_documents: [],
    funds_proof_required: true,
    missing_for_submit: [],
    declared_correct_at: "2026-10-06T10:30:00Z",
    submitted_at: "2026-10-06T10:30:00Z",
    check_level: 2,
    check_reasons: ["pep", "amount_over_threshold"],
    updated_at: "2026-10-06T10:30:00Z",
    adopted_at: "2026-10-06T10:30:00Z",
    ...patch,
  };
}

type Calls = {
  sends: Record<string, unknown>[];
  revokes: number;
  estimates: Record<string, unknown>[];
};

async function mount(page: Page, lang: "ru" | "de", initial: LinkState, portal: Record<string, unknown> = {}) {
  const state = { link: initial, declaration: { ...declaration } as Record<string, unknown> };
  const calls: Calls = { sends: [], revokes: 0, estimates: [] };
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-payer-link-staff-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "payer-link-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = lead;
    } else if (path === `/leads/${leadId}/portal-intake`) {
      response = {
        lead_id: leadId,
        fill_mode: "patient",
        patient_fields: {},
        patient_payer: null,
        progress: { filled: 12, total: 12, documents: 0, submitted_at: "2026-10-05T09:40:00Z" },
        consents: [],
        uploads: [],
        uploads_hidden: false,
        guardians: { links: [], candidates: [] },
        minor: false,
        can_issue: true,
        can_review_uploads: true,
        ...portalStatements,
        ...portal,
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      response = {
        declaration: state.declaration,
        status: {
          complete: true,
          missing: [],
          cost_assumption: { required: false, document_id: null, current: false, signed: false, signed_at: null },
          order_id: null,
          order_number: null,
          client_signed_order: false,
          agency_signed_order: false,
          agency_may_sign: false,
          agency_blocking: [],
          aml_countries: ["AT"],
        },
      };
    } else if (path === `/leads/${leadId}/payer-link` && method === "POST") {
      // Like the server: a submitted questionnaire needs "reopen"; the new link replaces the active one.
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.sends.push(body);
      const questionnaire = state.link.questionnaire as LinkState | null;
      if (questionnaire?.submitted_at && body.reopen !== true) {
        return route.fulfill({ status: 409, json: { code: "payer_already_submitted", message: "payer_already_submitted" } });
      }
      state.link = {
        ...state.link,
        link: sentLink({ language: body.language, sent_at: "2026-10-06T11:00:00Z" }),
        questionnaire: questionnaire && body.reopen ? { ...questionnaire, state: "draft", submitted_at: null, declared_correct_at: null } : questionnaire,
      };
      // The invitation carries the payer notice: the payer counts as informed (contract D7).
      state.declaration = { ...state.declaration, payer_informed_at: state.declaration.payer_informed_at ?? "2026-10-06T11:00:00Z" };
      response = state.link;
    } else if (path === `/leads/${leadId}/payer-link/revoke` && method === "POST") {
      calls.revokes += 1;
      state.link = {
        ...state.link,
        link: { ...(state.link.link as LinkState), status: "revoked", revoked_at: "2026-10-06T11:30:00Z", revoked_reason: "staff_revoked" },
      };
      response = state.link;
    } else if (path === `/leads/${leadId}/payer-link/estimated-total` && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      calls.estimates.push(body);
      state.link = { ...state.link, estimated_total_eur: body.estimated_total_eur };
      response = state.link;
    } else if (path === `/leads/${leadId}/payer-link`) {
      response = state.link;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  // The wizard harness of the repeat-intake spec, under its own address.
  await page.route("**/lead-payer-link-staff-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    // A cold dev server answers "504 Outdated Optimize Dep" on the first import; reload like Vite's client would.
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
    }),
  );
  await page.goto("/lead-payer-link-staff-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  return { wizard, panel: wizard.getByTestId("lead-payer-link"), calls, state };
}

const noOverflow = (locator: ReturnType<Page["getByTestId"]>) =>
  locator.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);

test("staff send the payer link in the chosen language and enter the expected total", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, panel, calls } = await mount(page, "de", freshState());

  // Inside "Wer zahlt", below the payer's data.
  await expect(wizard.locator("#lead-wizard-payer-declaration").getByTestId("lead-payer-link")).toBeVisible();
  await expect(panel).toContainText("Zahler-Link");
  await expect(panel.getByTestId("lead-payer-link-status")).toHaveText("Noch kein Link gesendet");
  await expect(panel.getByTestId("lead-payer-link-ready")).toHaveText(
    "Die Anfrage ist eingegangen: Der Zahler-Link kann jetzt gesendet werden",
  );
  const send = panel.getByRole("button", { name: "Link an den Zahler senden" });
  await expect(send).toBeEnabled();
  await expect(send).toHaveAttribute("data-highlight", "true");
  await expect(panel.getByRole("button", { name: "Link widerrufen" })).toHaveCount(0);
  // The lead speaks Ukrainian: the invitation starts in UA.
  const languages = panel.getByRole("group", { name: "Sprache der E-Mail" });
  await expect(languages.getByRole("button", { name: "UA", exact: true })).toHaveAttribute("aria-pressed", "true");
  await languages.getByRole("button", { name: "EN", exact: true }).click();
  await expect(languages.getByRole("button", { name: "EN", exact: true })).toHaveAttribute("aria-pressed", "true");
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-link-new-de-desktop.png"), animations: "disabled" });
  const informed = wizard.getByRole("checkbox", { name: /Der Kostenübernehmer wurde über die Verarbeitung seiner Daten informiert/ });
  await expect(informed).not.toBeChecked();

  await send.click();
  await expect(panel.getByTestId("lead-payer-link-notice")).toHaveText("Link gesendet an viktor.zahler@example.com");
  expect(calls.sends).toEqual([{ language: "en", reopen: false }]);
  const badge = panel.getByTestId("lead-payer-link-badge");
  await expect(badge).toHaveAttribute("data-status", "sent");
  await expect(badge).toHaveText("Gesendet");
  await expect(panel.getByTestId("lead-payer-link-status")).toHaveText(
    "Gesendet am 06.10.2026 13:00 an viktor.zahler@example.com (Intake QA) · gültig bis 05.11.2026",
  );
  await expect(panel.getByRole("button", { name: "Erneut senden" })).toBeEnabled();
  await expect(panel.getByRole("button", { name: "Link widerrufen" })).toBeVisible();
  await expect(panel.getByTestId("lead-payer-link-ready")).toHaveCount(0);
  // The invitation informed the payer: the declaration is loaded afresh and says so.
  await expect(informed).toBeChecked();

  // The amount is saved when the field is left; German grouping is read.
  const total = panel.getByTestId("lead-payer-estimated-total");
  await expect(panel).toContainText("Ab 10.000 EUR legt der Zahler einen Nachweis der Herkunft der Mittel vor");
  await total.fill("12.500");
  await total.press("Tab");
  await expect.poll(() => calls.estimates).toEqual([{ estimated_total_eur: "12500.00" }]);
  await expect(total).toHaveValue("12500,00");
  // Something that is no amount is not sent.
  await total.fill("zwölftausend");
  await total.press("Tab");
  await expect(panel.getByTestId("lead-payer-estimated-total-error")).toContainText("Bitte den Betrag prüfen");
  // Cleared, it is sent as null.
  await total.fill("");
  await total.press("Tab");
  await expect.poll(() => calls.estimates.at(-1)).toEqual({ estimated_total_eur: null });
  expect(calls.estimates).toHaveLength(2);

  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-link-sent-de-desktop.png"), animations: "disabled" });
  // On a phone the panel must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => noOverflow(wizard)).toBe(true);
  await expect.poll(() => noOverflow(panel)).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByRole("button", { name: "Erneut senden" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-link-sent-de-mobile.png"), animations: "disabled" });
});

test("after the payer answered, a new link needs 'reopen for correction'", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { panel, calls } = await mount(
    page,
    "de",
    freshState({ link: sentLink({ status: "submitted" }), questionnaire: answeredQuestionnaire(), estimated_total_eur: "12000.00" }),
  );

  await expect(panel.getByTestId("lead-payer-link-badge")).toHaveText("Angaben eingegangen");
  await expect(panel.getByTestId("lead-payer-link-status")).toHaveText(
    "Angaben eingegangen am 06.10.2026 12:30 · gesendet am 06.10.2026 12:00 an viktor.zahler@example.com (Intake QA)",
  );
  await expect(panel.getByTestId("lead-payer-estimated-total")).toHaveValue("12000,00");
  const resend = panel.getByRole("button", { name: "Erneut senden" });
  await expect(resend).toBeDisabled();
  await expect(panel.getByTestId("lead-payer-link-blocked")).toHaveText(
    "Die Angaben sind eingegangen: Für einen neuen Link „Zur Korrektur öffnen“ wählen",
  );
  const reopen = panel.getByRole("checkbox", { name: "Zur Korrektur öffnen" });
  await reopen.check();
  await expect(resend).toBeEnabled();
  await expect(panel.getByTestId("lead-payer-link-blocked")).toHaveCount(0);
  // The link of the payer is in German.
  await expect(panel.getByRole("button", { name: "DE", exact: true })).toHaveAttribute("aria-pressed", "true");
  await resend.click();
  await expect(panel.getByTestId("lead-payer-link-notice")).toHaveText("Link gesendet an viktor.zahler@example.com");
  expect(calls.sends).toEqual([{ language: "de", reopen: true }]);
  await expect(panel.getByTestId("lead-payer-link-badge")).toHaveText("Gesendet");
  await expect(panel.getByRole("checkbox", { name: "Zur Korrektur öffnen" })).toHaveCount(0);
});

test("staff revoke a link only after the confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { panel, calls } = await mount(page, "ru", freshState({ link: sentLink({ status: "opened", opened_at: "2026-10-06T10:05:00Z" }) }));

  await expect(panel.getByTestId("lead-payer-link-status")).toHaveText(
    "Открыта 06.10.2026 12:05 · отправлена 06.10.2026 12:00 на viktor.zahler@example.com (Intake QA) · действует до 05.11.2026",
  );
  const revoke = panel.getByRole("button", { name: "Отозвать ссылку" });
  let question = "";
  page.once("dialog", (dialog) => {
    question = dialog.message();
    void dialog.dismiss();
  });
  await revoke.click();
  expect(question).toContain("Отозвать ссылку плательщика?");
  expect(calls.revokes).toBe(0);
  await expect(panel.getByTestId("lead-payer-link-badge")).toHaveText("Открыта");

  page.once("dialog", (dialog) => void dialog.accept());
  await revoke.click();
  await expect(panel.getByTestId("lead-payer-link-notice")).toHaveText("Ссылка отозвана");
  expect(calls.revokes).toBe(1);
  await expect(panel.getByTestId("lead-payer-link-badge")).toHaveText("Отозвана");
  await expect(panel.getByTestId("lead-payer-link-status")).toContainText("Отозвана 06.10.2026 13:30 — отозвана сотрудником");
  // An ended link: send a new one, nothing to revoke.
  await expect(panel.getByRole("button", { name: "Отправить ссылку плательщику" })).toBeEnabled();
  await expect(revoke).toHaveCount(0);
});

test("a blocked link names the reason", async ({ page }) => {
  const { panel, calls } = await mount(page, "de", freshState({ can_send: false, blocked_reason: "request_not_submitted" }));
  const send = panel.getByRole("button", { name: "Link an den Zahler senden" });
  await expect(send).toBeDisabled();
  await expect(send).not.toHaveAttribute("data-highlight", "true");
  await expect(panel.getByTestId("lead-payer-link-blocked")).toHaveText(
    "Der Link kann gesendet werden, sobald der Patient die Anfrage im Portal gesendet hat",
  );
  await expect(panel.getByTestId("lead-payer-link-ready")).toHaveCount(0);
  expect(calls.sends).toEqual([]);
});

test("without e-mail sending set up the link cannot go out", async ({ page }) => {
  // Like the server: without e-mail sending `can_send` is false, without a blocked reason.
  const { panel } = await mount(page, "de", freshState({ can_send: false, mail_available: false }));
  await expect(panel.getByRole("button", { name: "Link an den Zahler senden" })).toBeDisabled();
  await expect(panel.getByTestId("lead-payer-link-blocked")).toHaveText(
    "Der E-Mail-Versand ist nicht eingerichtet. Mittaro wird unter „API-Verbindungen“ → „E-Mail“ verbunden.",
  );
});

test("a paying parent with a cabinet login gets a note, no link", async ({ page }) => {
  const { panel } = await mount(page, "ru", freshState({ mode: "cabinet", can_send: false, blocked_reason: "payer_has_cabinet_login" }));
  await expect(panel.getByTestId("lead-payer-link-cabinet")).toHaveText(
    "Плательщик — родитель с доступом в кабинет: анкета в его кабинете",
  );
  await expect(panel.getByRole("button", { name: "Отправить ссылку плательщику" })).toHaveCount(0);
  await expect(panel.getByTestId("lead-payer-link-blocked")).toHaveCount(0);
  // The expected total still decides the parent's check level.
  await expect(panel.getByTestId("lead-payer-estimated-total")).toBeVisible();
});

test("the payer's answers stand after invoice and payment: a PEP in amber, level 2 without proof", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard } = await mount(
    page,
    "de",
    freshState({ link: sentLink({ status: "submitted" }), questionnaire: answeredQuestionnaire(), estimated_total_eur: "12000.00" }),
    { payer_link: { mode: "link", status: "submitted", sent_at: "2026-10-06T10:00:00Z", submitted_at: "2026-10-06T10:30:00Z", check_level: 2 } },
  );
  const block = wizard.getByTestId("lead-gwg-statements");
  const group = block.getByTestId("lead-gwg-payer");

  await expect(group).toContainText("Angaben des Zahlers");
  await expect(group.getByTestId("lead-gwg-payer-badge")).toHaveText("vom Zahler am 06.10.2026 12:30");
  // Section 8 is the payer's: the line says when, the rows follow.
  const billing = block.getByTestId("lead-gwg-billing");
  await expect(billing.getByTestId("lead-gwg-billing-by-payer")).toHaveText("Zahlungsweg: angegeben vom Zahler am 06.10.2026 12:30");
  await expect(billing.getByTestId("lead-gwg-billing-payment_method")).toContainText("Überweisung");
  // After invoice and payment, before the lead's own legal questions.
  // Polled: the wizard may still be laying out the blocks around it.
  await expect
    .poll(async () => {
      const billingBox = await billing.boundingBox();
      const groupBox = await group.boundingBox();
      const legalBox = await block.getByTestId("lead-gwg-answer-pep_self").boundingBox();
      if (!billingBox || !groupBox || !legalBox) return false;
      return billingBox.y + billingBox.height <= groupBox.y && groupBox.y + groupBox.height <= legalBox.y;
    })
    .toBe(true);

  for (const text of ["Viktor Zahler", "Herr", "02.03.1970", "Wien, Österreich", "Musterweg 1, 1010 Wien, Österreich", "Reisepass", "P1234567", "Elternteil", "Ingenieur"]) {
    await expect(group).toContainText(text);
  }
  await expect(group.getByTestId("lead-gwg-payer-email")).toContainText("viktor.zahler@example.com · bestätigt am 06.10.2026 12:05");
  await expect(group.getByTestId("lead-gwg-payer-identity_documents")).toContainText("viktor-pass.pdf · 06.10.2026");
  await expect(group.getByTestId("lead-gwg-payer-funds_sources")).toContainText("Gehalt / nichtselbständige Arbeit, Ersparnisse");
  const pep = group.getByTestId("lead-gwg-payer-answer-pep_self");
  await expect(pep).toHaveAttribute("data-warning", "true");
  await expect(pep).toContainText("Bürgermeister 2019–2024");
  await expect(group.getByTestId("lead-gwg-payer-answer-pep_related")).not.toHaveAttribute("data-warning", "true");
  await expect(group.getByTestId("lead-gwg-payer-check-level")).toHaveText("Prüfstufe: 2 — PEP, Betrag ab 10.000 EUR");
  const missingProof = group.getByTestId("lead-payer-funds-proof-missing");
  await expect(missingProof).toHaveText("Prüfstufe 2: Der Nachweis der Herkunft der Mittel fehlt noch");
  await expect(missingProof).toHaveClass(/text-amber-700/);
  await expect(group.getByTestId("lead-gwg-payer-privacy")).toHaveText(
    "Datenschutzhinweis bestätigt am 06.10.2026 12:06 · Version payer-privacy-2026-10-06 · IP 203.0.113.7 · Kontaktwege: E-Mail",
  );
  // Read-only.
  await expect(group.locator("input, textarea, select, button")).toHaveCount(0);

  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-answers-de-desktop.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  // Polled: the narrower layout settles a moment after the resize.
  await expect.poll(() => noOverflow(wizard)).toBe(true);
  await expect.poll(() => noOverflow(group)).toBe(true);
  await group.scrollIntoViewIfNeeded();
  await expect(missingProof).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-answers-de-mobile.png"), animations: "disabled" });
});
