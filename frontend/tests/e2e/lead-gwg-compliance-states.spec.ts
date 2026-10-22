import { expect, test, type Page } from "@playwright/test";

// The compliance part of the staff wizard's documents step as a staff user
// meets it (QA 2026-10-22): the voluntary enhanced check (GMED is no obliged
// entity under § 2 GwG), the risk assessment that requires it, the GwG sheet
// whose "confirm signature" a gate refuses next to the row, and the readiness
// list that leads to the section. Mocked API, synthetic data.

const leadId = "00000000-0000-0000-0000-000000000222";

type Json = Record<string, unknown>;

function documentRow(id: string, template: string, name: string, extra: Json = {}): Json {
  return {
    id,
    patient_id: null,
    lead_id: leadId,
    has_active_patient_portal_user: true,
    order_id: null,
    appointment_id: null,
    patient_pid: null,
    patient_name: null,
    order_number: null,
    appointment_title: null,
    document_number: `DOC-${id}`,
    auto_name: name,
    original_filename: `${name}.pdf`,
    art: template,
    category: "compliance_aml",
    status: "active",
    visibility: "internal",
    is_medical: false,
    mime_type: "application/pdf",
    file_size: 2048,
    has_stored_file: true,
    generated_template_id: template,
    generated_bindings: template === "gwg_identification" ? { gwg_identification: { subject: "contract_partner" } } : {},
    signed_at: null,
    compliance_kind: null,
    version_root_document_id: id,
    replaces_document_id: null,
    superseded_by_document_id: null,
    version_number: 1,
    version_count: 1,
    is_latest_version: true,
    file_deleted_at: null,
    created_at: "2026-10-21T08:00:00Z",
    updated_at: "2026-10-21T08:00:00Z",
    share_count: 0,
    shared_to_current: false,
    deletion_protected: false,
    data_sensitivity: "standard",
    needs_categorization: false,
    classification_suggestion: null,
    ...extra,
  };
}

type Mock = {
  lang: "ru" | "de";
  /** `GET …/enhanced-check`. */
  enhancedCheck: Json;
  /** The lead's readiness reasons (server keys). */
  reasons?: string[];
  documents?: Json[];
  /** How `POST /documents/{id}/mark-signed` answers. */
  markSigned?: { status: number; body: Json };
};

async function mount(page: Page, mock: Mock) {
  const calls: Array<{ path: string; body: unknown }> = [];
  await page.addInitScript((lang) => {
    localStorage.setItem("gmed_lang", lang);
    localStorage.setItem("gmed_access_token", "lead-gwg-compliance-token");
  }, mock.lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    let response: unknown = [];
    if (request.method() !== "GET") {
      calls.push({ path, body: request.postData() ? request.postDataJSON() : null });
    }
    if (path === "/me") {
      response = { id: "qa-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    } else if (path === "/sanctions/check") {
      response = { status: "clear", list_version_date: "2026-10-01" };
    } else if (path === `/leads/${leadId}`) {
      response = {
        id: leadId,
        first_name: "Anna",
        last_name: "Muster",
        email: "anna.muster@example.com",
        date_of_birth: "1980-04-02",
        qualification_status: "in_progress",
        intake_model: "patient_first",
        repeat_patient_id: null,
        wizard_state: {},
        services: [],
        attachments: [],
        readiness: { conversion_ready: false, blocking_reasons: mock.reasons ?? [], steps: [], checks: [] },
      };
    } else if (path === `/leads/${leadId}/enhanced-check`) {
      response = mock.enhancedCheck;
    } else if (path === "/documents" && url.searchParams.get("lead_id") === leadId) {
      response = mock.documents ?? [];
    } else if (/^\/documents\/[^/]+\/mark-signed$/.test(path) && mock.markSigned) {
      await route.fulfill({ status: mock.markSigned.status, contentType: "application/json", body: JSON.stringify(mock.markSigned.body) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-gwg-compliance-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
    }),
  );
  await page.goto("/lead-gwg-compliance-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: mock.lang === "ru" ? "Оформление обращения" : "Lead-Aufnahme", exact: true });
  await wizard.getByRole("tab", { name: mock.lang === "ru" ? "Документы" : "Unterlagen", exact: false }).click();
  return { wizard, calls };
}

test("a check required by the risk assessment says it is GMED's rule, in both languages", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard } = await mount(page, {
    lang: "ru",
    enhancedCheck: { required: true, reasons: ["risk_assessment"], countries: [] },
  });
  const section = wizard.getByTestId("lead-wizard-enhanced-check-section");
  const status = section.getByTestId("lead-wizard-enhanced-check-status");
  await expect(status).toContainText("Усиленная AML-проверка (ориентир § 15 GwG)");
  await expect(status).toContainText("Требуется по правилу GMED");
  // Never an unqualified "required" that reads like a legal duty.
  await expect(status.getByText("Обязательна", { exact: true })).toHaveCount(0);
  await expect(section).toContainText("по результатам оценки риска");
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("lead-enhanced-check-required-ru.png"), animations: "disabled" });

  await section.getByRole("button", { name: "Заполнить проверку" }).click();
  const sheet = page.getByRole("dialog", { name: "Усиленная AML-проверка (ориентир § 15 GwG)" });
  await expect(sheet.getByTestId("lead-aml-sheet-requirement")).toContainText("Требуется по правилу GMED");
});

test("the readiness item of a missing enhanced check leads to its section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard } = await mount(page, {
    lang: "de",
    enhancedCheck: { required: true, reasons: ["patient_citizenship_blacklist"], countries: ["IR"] },
    reasons: ["Enhanced due diligence document is missing"],
  });
  const section = wizard.getByTestId("lead-wizard-enhanced-check-section");
  await expect(section.getByTestId("lead-wizard-enhanced-check-status")).toContainText("Verstärkte AML-Prüfung (Orientierung § 15 GwG)");
  await expect(section.getByTestId("lead-wizard-enhanced-check-status")).toContainText("Nach GMED-Regel erforderlich");
  // The section is the target of the readiness item: it can take the focus.
  await expect(section).toHaveAttribute("id", "lead-wizard-enhanced-check");
  await expect(section).toHaveAttribute("tabindex", "-1");
});

test("a refused signature confirmation of the GwG sheet is said under its row", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sheet = documentRow("gwg-sheet-1", "gwg_identification", "Dokumentationsbogen natürliche Personen – Anna Muster");
  const { wizard, calls } = await mount(page, {
    lang: "ru",
    enhancedCheck: { required: false, reasons: [], countries: [] },
    documents: [sheet],
    markSigned: { status: 409, body: { error: "risk_review_required", code: "risk_review_required", message: "Risk review required" } },
  });
  const row = wizard.getByRole("button", { name: "Dokumentationsbogen natürliche Personen – Anna Muster.pdf" }).locator("xpath=ancestor::div[contains(@class,'px-3')][1]");
  await row.scrollIntoViewIfNeeded();
  await row.getByRole("button", { name: "Подтвердить подпись" }).click();
  const refusal = wizard.locator('[data-document-row-error="gwg-sheet-1"]');
  await expect(refusal.locator("[data-document-row-error-text]")).toHaveText(
    "Подпись недоступна: сначала нужно решение по оценке риска (раздел «Оценка риска» в документах лида).",
  );
  expect(calls.filter((call) => call.path === "/documents/gwg-sheet-1/mark-signed")).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("lead-gwg-sheet-refused-ru.png"), animations: "disabled" });
  // The refusal leads to the risk assessment and is gone once staff follow it.
  await refusal.getByRole("button", { name: "Перейти к оценке риска" }).click();
  await expect(refusal).toHaveCount(0);
});
