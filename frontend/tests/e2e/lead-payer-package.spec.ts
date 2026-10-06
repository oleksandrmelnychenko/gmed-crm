import { expect, test, type Page } from "@playwright/test";

// The payer's signature package in the staff wizard (contract phase 3b,
// section 6.1): four documents, prepared and sent for a qualified signature
// through Skribble. Mocked API that behaves like the contract, synthetic data.

// The lead the wizard harness opens through "Lead intake".
const leadId = "00000000-0000-0000-0000-000000000222";

const lead = {
  id: leadId,
  first_name: "Mia",
  last_name: "Muster",
  email: "anna.muster@example.com",
  primary_language: "de",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  wizard_state: {},
  services: [],
  attachments: [],
  readiness: { conversion_ready: false, blocking_reasons: [], steps: [], checks: [] },
};

/** A third-party person who pays; the lead agreed to the contact and to passing the cost estimate on. */
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
  payer_informed_at: "2026-10-06T10:00:00Z",
  payer_informed_by: null,
  payer_type: "person",
  organisation_name: null,
  relationship_kind: "parent",
  contact_consent_at: "2026-10-05T09:30:00Z",
  cost_estimate_consent_at: "2026-10-05T09:31:00Z",
  updated_at: "2026-10-06T10:31:00Z",
};

/** The payer's link: answered through the link at 12:30. */
const linkState = {
  mode: "link",
  can_send: false,
  blocked_reason: null,
  mail_available: true,
  link: {
    status: "submitted",
    email: "viktor.zahler@example.com",
    language: "de",
    sent_at: "2026-10-06T10:00:00Z",
    sent_by_name: "Intake QA",
    expires_at: "2026-11-05T10:00:00Z",
    last_email_status: "sent",
  },
  estimated_total_eur: "8000.00",
  funds_proof_threshold_eur: 10000,
  questionnaire: {
    patient_name: "Mia Muster",
    source: "link",
    payer_type: "person",
    state: "submitted",
    email: "viktor.zahler@example.com",
    email_confirmed_at: "2026-10-06T10:05:00Z",
    privacy: { acknowledged_at: "2026-10-06T10:06:00Z", text_version: "payer-privacy-2026-10-06", contact_channels: ["email"], ip: null },
    answers: { first_name: "Viktor", last_name: "Zahler", citizenships: ["AT"], funds_sources: ["savings"] },
    payment_route: { payment_method: "bank_transfer", asked: true },
    identity_documents: [],
    funds_proof_documents: [],
    funds_proof_required: false,
    missing_for_submit: [],
    declared_correct_at: "2026-10-06T10:30:00Z",
    submitted_at: "2026-10-06T10:30:00Z",
    check_level: 1,
    check_reasons: [],
    updated_at: "2026-10-06T10:30:00Z",
    adopted_at: "2026-10-06T10:30:00Z",
  },
};

type Json = Record<string, unknown>;

const SLOTS = [
  ["self_disclosure", "payer_self_disclosure", "Selbstauskunft der zahlenden Person"],
  ["cost_coverage", "cost_coverage_declaration", "Kostenübernahmeerklärung"],
  ["patient_statement", "patient_payer_statement", "Erklärung zur Kostenübernahme durch Dritte"],
  ["cost_estimate", "payer_cost_estimate", "Kostenvoranschlag (Ausfertigung Kostenübernehmer/in)"],
] as const;

/** The four documents of a package as the documents list carries them. */
function packageDocuments(version = 1): Json[] {
  return SLOTS.map(([slot, template, title], index) => ({
    id: `doc-${slot}-${version}`,
    auto_name: title,
    original_filename: `${template}.pdf`,
    art: template,
    category: slot === "cost_estimate" ? "finance_payer_cost_estimate" : "compliance_aml",
    status: "active",
    visibility: "internal",
    is_medical: false,
    mime_type: "application/pdf",
    has_stored_file: true,
    file_size: 1000,
    version_root_document_id: `doc-${slot}-1`,
    version_number: version,
    version_count: version,
    is_latest_version: true,
    lead_id: leadId,
    patient_id: null,
    order_id: "order-1",
    generated_template_id: template,
    signed_at: null,
    file_deleted_at: null,
    created_at: `2026-10-06T11:0${index}:00Z`,
    updated_at: `2026-10-06T11:0${index}:00Z`,
  }));
}

/** A package of the server: prepared at 13:00 Berlin time (11:00 UTC). */
function preparedPackage(patch: Json = {}, version = 1): Json {
  return {
    id: `package-${version}`,
    status: "prepared",
    outdated_reasons: [],
    prepared_at: "2026-10-06T11:00:00Z",
    prepared_by_name: "Intake QA",
    sent_at: null,
    sent_by_name: null,
    language: null,
    request_id: null,
    test_mode: false,
    signed_at: null,
    documents: SLOTS.map(([slot, , title]) => ({ slot, document_id: `doc-${slot}-${version}`, title, version, signed_at: null })),
    attachments: [],
    ...patch,
  };
}

/** The package state of a submitted payer, nothing prepared yet. */
function packageState(patch: Json = {}): Json {
  return {
    mode: "link",
    blocked_reason: null,
    missing: [],
    can_prepare: true,
    can_send: false,
    signature_enabled: true,
    languages: ["de", "en", "fr", "it"],
    suggested_language: "de",
    signer: { first_name: "Viktor", last_name: "Zahler", email: "viktor.zahler@example.com", acting_for: null },
    order: { id: "order-1", number: "A-2026-0042" },
    cost_estimate_document_id: "doc-kva-1",
    package: null,
    payer_identification: { qes_signed_at: null, qes_test_mode: false, own_account_payment_confirmed_at: null },
    ...patch,
  };
}

/** The declaration's summary of the package (contract 4.4). */
function summary(state: Json): Json | null {
  const pkg = state.package as Json | null;
  if (!pkg) return null;
  return {
    status: pkg.status,
    outdated: (pkg.outdated_reasons as string[]).length > 0,
    sent_at: pkg.sent_at,
    signed_at: pkg.signed_at,
  };
}

type Calls = { prepares: number; sends: Json[] };

async function mount(page: Page, lang: "ru" | "de", initial: Json, options: { declaration?: Json; status?: Json } = {}) {
  const state = {
    package: initial,
    documents: (initial.package ? packageDocuments() : []) as Json[],
    declaration: { ...declaration, ...options.declaration } as Json,
  };
  const calls: Calls = { prepares: 0, sends: [] };
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lead-payer-package-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();
    let response: unknown = [];
    if (path === "/me") {
      response = { id: "payer-package-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
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
      };
    } else if (path === `/leads/${leadId}/payer-declaration`) {
      const pkg = summary(state.package);
      response = {
        declaration: state.declaration,
        status: {
          complete: false,
          missing: [pkg && pkg.status !== "prepared" ? "cost_assumption_unsigned" : "cost_assumption_missing"],
          cost_assumption: { required: true, document_id: null, current: false, signed: false, signed_at: null },
          order_id: "order-1",
          order_number: "A-2026-0042",
          client_signed_order: true,
          agency_signed_order: false,
          agency_may_sign: false,
          agency_blocking: [],
          aml_countries: ["AT"],
          contact_consent_required: true,
          cost_estimate_consent_required: true,
          payer_package: pkg,
          ...options.status,
        },
      };
    } else if (path === `/leads/${leadId}/payer-link`) {
      response = linkState;
    } else if (path === `/leads/${leadId}/payer-signature-package/prepare` && method === "POST") {
      calls.prepares += 1;
      const version = calls.prepares;
      state.package = { ...state.package, package: preparedPackage({}, version), can_send: true };
      state.documents = packageDocuments(version);
      response = state.package;
    } else if (path === `/leads/${leadId}/payer-signature-package/send` && method === "POST") {
      const body = request.postDataJSON() as Json;
      calls.sends.push(body);
      const pkg = state.package.package as Json;
      if (body.package_id !== pkg.id) {
        return route.fulfill({ status: 409, json: { error: "payer_package_stale", code: "payer_package_stale", message: "payer_package_stale" } });
      }
      state.package = {
        ...state.package,
        can_prepare: false,
        can_send: false,
        package: {
          ...pkg,
          status: "pending",
          sent_at: "2026-10-06T11:30:00Z",
          sent_by_name: "Intake QA",
          language: body.language,
          request_id: "request-1",
        },
      };
      return route.fulfill({ status: 202, json: state.package });
    } else if (path === `/leads/${leadId}/payer-signature-package`) {
      response = state.package;
    } else if (path === "/documents") {
      response = state.documents;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  // The wizard harness of the repeat-intake spec, under its own address.
  await page.route("**/lead-payer-package-harness", (route) =>
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
  await page.goto("/lead-payer-package-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  const tab = (ru: string, de: string) => wizard.getByRole("tab", { name: lang === "ru" ? ru : de, exact: false });
  return {
    wizard,
    calls,
    state,
    panel: wizard.getByTestId("lead-payer-package"),
    openCommercial: () => tab("Договор и смета", "Vertrag & Angebot").click(),
    openDocuments: () => tab("Документы", "Unterlagen").click(),
  };
}

const noOverflow = (locator: ReturnType<Page["getByTestId"]>) =>
  locator.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);

test("a blocked package names the reason; 'Wer zahlt' shows the lead's cost estimate consent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, panel, calls, openCommercial, openDocuments } = await mount(
    page,
    "de",
    packageState({ blocked_reason: "cost_estimate_consent_missing", can_prepare: false }),
    { declaration: { cost_estimate_consent_at: null } },
  );

  await openDocuments();
  const section = wizard.locator("#lead-wizard-payer-declaration");
  await expect(section.getByTestId("lead-payer-cost-estimate-consent")).toHaveText(
    "Einwilligung zur Weitergabe des Kostenvoranschlags: noch nicht erteilt",
  );
  await expect(section.getByTestId("lead-payer-cost-estimate-consent")).toHaveAttribute("data-state", "missing");
  // The payer answered: the link panel names the package and where it is made.
  await expect(section.getByTestId("lead-payer-link-package")).toHaveText(
    "Unterschriftenpaket: noch nicht erstellt (Schritt „Vertrag & Angebot“)",
  );

  await openCommercial();
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Unterlagen für den Zahler zur Unterschrift");
  await expect(panel.getByTestId("lead-payer-package-blocked")).toHaveText(
    "Die Patientin / der Patient hat der Weitergabe des Kostenvoranschlags noch nicht zugestimmt",
  );
  await expect(panel.getByRole("button", { name: "Unterlagen erstellen" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "An den Zahler zur Unterschrift senden" })).toHaveCount(0);
  // The payer has a statement: the standalone Kostenübernahmeerklärung is gone.
  await expect(wizard.getByRole("button", { name: "Kostenübernahmeerklärung erstellen" })).toHaveCount(0);
  expect(calls.prepares).toBe(0);
});

test("staff prepare the four documents and send them; the payer section waits for the signature", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { wizard, panel, calls, openCommercial, openDocuments } = await mount(page, "de", packageState());

  await openCommercial();
  await expect(panel).toContainText(
    "Der Zahler erhält ein Paket mit vier Dokumenten zur qualifizierten elektronischen Signatur (QES) über Skribble. Die QES identifiziert den Zahler zugleich nach dem GwG.",
  );
  await expect(panel.getByTestId("lead-payer-package-signer")).toHaveText("Unterschreibt: Viktor Zahler · viktor.zahler@example.com");
  const rows = panel.getByTestId("lead-payer-package-documents").getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows).toContainText([
    "Selbstauskunft der zahlenden Person",
    "Kostenübernahmeerklärung",
    "Erklärung zur Kostenübernahme durch Dritte",
    "Kostenvoranschlag für den Zahler",
  ]);
  await expect(panel.getByText("noch nicht erstellt")).toHaveCount(4);
  await expect(panel.getByTestId("lead-payer-package-qes")).toHaveText("Identifizierung des Zahlers (QES): noch nicht erfolgt");

  await panel.getByRole("button", { name: "Unterlagen erstellen" }).click();
  await expect(panel.getByTestId("lead-payer-package-notice")).toHaveText("Unterlagen erstellt – bitte vor dem Senden prüfen");
  expect(calls.prepares).toBe(1);
  await expect(panel.getByTestId("lead-payer-package-badge")).toHaveText("Erstellt");
  await expect(panel.getByTestId("lead-payer-package-status")).toHaveText("Erstellt am 06.10.2026 13:00 (Intake QA) · noch nicht gesendet");
  for (const [slot] of SLOTS) {
    const row = panel.getByTestId(`lead-payer-package-document-${slot}`);
    await expect(row).toHaveAttribute("data-document-id", `doc-${slot}-1`);
    await expect(row).toContainText("Version 1");
    await expect(row.getByRole("button")).toBeVisible();
  }
  await expect(panel.getByRole("button", { name: "Unterlagen neu erstellen" })).toBeEnabled();

  // The invitation's language, then the app's own question.
  const languages = panel.getByRole("group", { name: "Sprache der Einladung" });
  await expect(languages.getByRole("button", { name: "DE", exact: true })).toHaveAttribute("aria-pressed", "true");
  await languages.getByRole("button", { name: "EN", exact: true }).click();
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-package-prepared-de-desktop.png"), animations: "disabled" });
  await panel.getByRole("button", { name: "An den Zahler zur Unterschrift senden" }).click();
  const question = page.getByTestId("lead-payer-package-send-dialog");
  await expect(question).toContainText("Unterlagen an den Zahler senden?");
  await expect(question).toContainText(
    "Skribble sendet die Einladung an viktor.zahler@example.com: vier Dokumente zur qualifizierten elektronischen Signatur (QES). Sprache der Einladung: EN.",
  );
  await question.getByRole("button", { name: "Abbrechen", exact: true }).click();
  await expect(question).toBeHidden();
  expect(calls.sends).toEqual([]);
  await panel.getByRole("button", { name: "An den Zahler zur Unterschrift senden" }).click();
  await question.getByRole("button", { name: "Zur Unterschrift senden", exact: true }).click();
  await expect(question).toBeHidden();
  await expect(panel.getByTestId("lead-payer-package-notice")).toHaveText("Paket über Skribble an viktor.zahler@example.com gesendet");
  expect(calls.sends).toEqual([{ package_id: "package-1", language: "en", message: null, expires_at: null }]);
  await expect(panel.getByTestId("lead-payer-package-badge")).toHaveText("Wartet auf Unterschrift");
  await expect(panel.getByTestId("lead-payer-package-status")).toHaveText(
    "Gesendet am 06.10.2026 13:30 (Intake QA) · Sprache EN · wartet auf die Unterschrift des Zahlers",
  );
  await expect(panel.getByRole("button", { name: "An den Zahler zur Unterschrift senden" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Unterlagen neu erstellen" })).toHaveCount(0);
  // The details of the request (withdraw, refresh, report) on the first document.
  await expect(panel.getByTestId("lead-payer-package-details").getByRole("button")).toHaveAttribute(
    "data-document-signature-id",
    "doc-self_disclosure-1",
  );

  // "Wer zahlt": the badge and the link panel say the payer is to sign.
  await openDocuments();
  const section = wizard.locator("#lead-wizard-payer-declaration");
  await expect(section.getByTestId("lead-payer-status-badge")).toHaveText("wartet auf Unterschrift des Zahlers");
  await expect(section.getByTestId("lead-payer-link-package")).toHaveText(
    "Unterschriftenpaket: gesendet am 06.10.2026, wartet auf Unterschrift (Schritt „Vertrag & Angebot“)",
  );
  await expect(section.getByTestId("lead-payer-cost-estimate-consent")).toHaveText(
    "Einwilligung zur Weitergabe des Kostenvoranschlags: erteilt am 05.10.2026",
  );
  // The package's own documents are not listed among the wizard's other documents.
  for (const title of ["Selbstauskunft der zahlenden Person", "Erklärung zur Kostenübernahme durch Dritte", "Kostenvoranschlag (Ausfertigung Kostenübernehmer/in)"]) {
    await expect(wizard.getByText(title)).toHaveCount(0);
  }
  await expect(wizard.getByRole("button", { name: "Kostenübernahmeerklärung erstellen" })).toHaveCount(0);
});

test("an outdated package cannot be sent and says why", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const { panel, calls, openCommercial } = await mount(
    page,
    "ru",
    packageState({ can_send: false, package: preparedPackage({ outdated_reasons: ["payer_answers_changed", "cost_estimate_changed"] }) }),
  );

  await openCommercial();
  const send = panel.getByRole("button", { name: "Отправить плательщику на подпись" });
  await expect(send).toBeDisabled();
  const outdated = panel.getByTestId("lead-payer-package-outdated");
  await expect(outdated).toContainText("Документы устарели — пересоздайте их перед отправкой:");
  await expect(outdated.getByRole("listitem")).toHaveText(["плательщик изменил ответы анкеты", "появилась новая версия сметы"]);
  await expect(outdated).toHaveClass(/text-amber-700/);

  // Prepared again, the package is current and can go out.
  await panel.getByRole("button", { name: "Пересоздать документы" }).click();
  await expect(panel.getByTestId("lead-payer-package-outdated")).toHaveCount(0);
  expect(calls.prepares).toBe(1);
  await expect(send).toBeEnabled();
  await expect(panel.getByTestId("lead-payer-package-document-self_disclosure")).toHaveAttribute(
    "data-document-id",
    "doc-self_disclosure-1",
  );
});

test("a demo package is marked as without legal effect, also on a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const signed = SLOTS.map(([slot, , title]) => ({ slot, document_id: `doc-${slot}-1`, title, version: 1, signed_at: "2026-10-07T08:15:00Z" }));
  const { wizard, panel, openCommercial } = await mount(
    page,
    "de",
    packageState({
      can_prepare: false,
      can_send: false,
      package: preparedPackage({
        status: "signed",
        test_mode: true,
        request_id: "request-1",
        sent_at: "2026-10-06T11:30:00Z",
        sent_by_name: "Intake QA",
        language: "de",
        signed_at: "2026-10-07T08:15:00Z",
        documents: signed,
      }),
      payer_identification: { qes_signed_at: "2026-10-07T08:15:00Z", qes_test_mode: true, own_account_payment_confirmed_at: null },
    }),
  );

  await openCommercial();
  await expect(panel.getByTestId("lead-payer-package-test-mode")).toHaveText("TEST (DEMO): ohne Rechtswirkung");
  await expect(panel.getByTestId("lead-payer-package-badge")).toHaveText("Unterschrieben");
  await expect(panel.getByTestId("lead-payer-package-status")).toHaveText(
    "Unterschrieben am 07.10.2026 10:15 · gesendet am 06.10.2026 13:30 (Intake QA) · Sprache DE",
  );
  for (const [slot] of SLOTS) {
    await expect(panel.getByTestId(`lead-payer-package-signed-${slot}`)).toHaveText("unterschrieben am 07.10.2026");
  }
  await expect(panel.getByTestId("lead-payer-package-qes")).toHaveText(
    "Identifizierung des Zahlers (QES): signiert am 07.10.2026 · Test, ohne Rechtswirkung",
  );
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-package-demo-de-desktop.png"), animations: "disabled" });

  // On a phone the panel must not widen the wizard.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => noOverflow(wizard)).toBe(true);
  await expect.poll(() => noOverflow(panel)).toBe(true);
  await panel.scrollIntoViewIfNeeded();
  await expect(panel.getByTestId("lead-payer-package-test-mode")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-package-demo-de-mobile.png"), animations: "disabled" });
});

test("a prepared package with its send controls fits a phone", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { wizard, panel, openCommercial } = await mount(
    page,
    "ru",
    packageState({
      can_send: true,
      signer: { first_name: "Ben", last_name: "Muster", email: "buchhaltung@beispiel-gmbh.example.com", acting_for: "Beispiel GmbH" },
      package: preparedPackage(),
    }),
  );
  await openCommercial();
  await expect(panel.getByTestId("lead-payer-package-signer")).toHaveText(
    "Подписывает: Ben Muster · buchhaltung@beispiel-gmbh.example.com · от имени Beispiel GmbH",
  );
  await expect.poll(() => noOverflow(wizard)).toBe(true);
  await expect.poll(() => noOverflow(panel)).toBe(true);
  const send = panel.getByRole("button", { name: "Отправить плательщику на подпись" });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeVisible();
  await expect(send).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("lead-payer-package-prepared-ru-mobile.png"), animations: "disabled" });
});
