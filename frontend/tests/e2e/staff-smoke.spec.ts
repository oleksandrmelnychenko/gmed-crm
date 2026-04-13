import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installStaffApiMocks(page: Page) {
  let portalShareActive = false;
  const documentId = "00000000-0000-0000-0000-000000000501";
  let nextGeneratedDocumentIndex = 1;
  let nextProviderShareIndex = 1;

  const templateCatalog = {
    templates: [
      {
        id: "treatment_plan",
        label: "Behandlungsplan",
        description: "Erstellt einen patientenbezogenen Behandlungsplan.",
        art: "treatment_plan",
        category: "care_plan",
        default_auto_name: "Behandlungsplan",
        default_status: "active",
        default_visibility: "patient_visible",
        is_medical: true,
        supported_languages: ["de", "uk", "ru"],
        text_block_keys: ["intro", "next_steps"],
      },
    ],
    text_blocks: [
      {
        key: "intro",
        label: "Einleitung",
        description: "Kurze Einführung für den Patienten.",
      },
      {
        key: "next_steps",
        label: "Nächste Schritte",
        description: "Hinweise für die Nachbereitung.",
      },
    ],
  };

  const buildDocument = (overrides: Record<string, unknown> = {}) => ({
    id: documentId,
    patient_id: "00000000-0000-0000-0000-000000000301",
    order_id: null,
    appointment_id: "00000000-0000-0000-0000-000000000401",
    patient_pid: "PT-001",
    patient_name: "Anna Muster",
    order_number: null,
    appointment_title: "Follow-up slot",
    auto_name: "MRI report",
    original_filename: "mri-report.pdf",
    art: "medical_report",
    category: "report",
    status: "active",
    visibility: portalShareActive ? "patient_visible" : "internal",
    is_medical: true,
    mime_type: "application/pdf",
    file_size: 2048,
    has_stored_file: true,
    klinik: "Clinic Cologne",
    ursprung: "provider",
    notes: null,
    uploaded_by_name: "Admin GMED",
    version_root_document_id: documentId,
    replaces_document_id: null,
    superseded_by_document_id: null,
    version_number: 1,
    version_count: 1,
    is_latest_version: true,
    file_deleted_at: null,
    file_deleted_by: null,
    file_deleted_by_name: null,
    file_delete_reason: null,
    created_at: "2026-04-01T09:00:00Z",
    updated_at: "2026-04-01T09:00:00Z",
    share_count: portalShareActive ? 1 : 0,
    shared_to_current: false,
    data_sensitivity: "medical",
    needs_categorization: false,
    classification_suggestion: null,
    ...overrides,
  });

  let documents = [buildDocument()];
  let providerShares: Array<{
    id: string;
    shared_with_provider_id: string | null;
    shared_with_user_id: string | null;
    provider_name: string | null;
    target_user_name: string | null;
    target_user_role: string | null;
    shared_by_name: string | null;
    channel: string | null;
    message: string | null;
    requires_confirmation: boolean;
    confirmed: boolean;
    confirmed_at: string | null;
    shared_at: string;
    revoked_at: string | null;
  }> = [];

  const buildPortalShares = () => [
    {
      id: "00000000-0000-0000-0000-000000000901",
      shared_with_provider_id: null,
      shared_with_user_id: null,
      provider_name: null,
      target_user_name: "Anna Muster",
      target_user_role: "patient",
      shared_by_name: "Admin GMED",
      channel: "patient_portal",
      message: null,
      requires_confirmation: true,
      confirmed: false,
      confirmed_at: null,
      shared_at: "2026-04-05T09:00:00Z",
      revoked_at: null,
    },
  ];

  function buildSharesForDocument(requestedDocumentId: string) {
    if (requestedDocumentId !== documentId) {
      return [];
    }

    return [
      ...(portalShareActive ? buildPortalShares() : []),
      ...providerShares,
    ];
  }

  await page.route("**/auth/**", async (route) => {
    const url = new URL(route.request().url());
    const { pathname } = url;

    if (pathname === "/auth/login" && route.request().method() === "POST") {
      return json(route, {
        access_token: "playwright-access-token",
        refresh_token: "playwright-refresh-token",
        token_type: "Bearer",
        expires_in: 900,
      });
    }

    if (pathname === "/auth/logout") {
      return json(route, { ok: true });
    }

    return json(route, { message: "Not mocked" }, 404);
  });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");

    if (path === "/me") {
      return json(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@gmed.de",
        name: "Admin GMED",
        role: "ceo",
        created_at: "2026-01-01T00:00:00Z",
      });
    }

    if (path === "/stats/overview") {
      return json(route, {
        patients: 12,
        leads: 4,
        orders: 7,
        appointments: 5,
        cases: 3,
        users: 9,
      });
    }

    if (path === "/stats/leads") {
      return json(route, {
        total_this_month: 4,
        growth_pct: 12,
        qualified_this_month: 2,
        converted_this_month: 1,
        total_all: 19,
      });
    }

    if (path === "/stats/leads/monthly") {
      return json(route, [{ month: "2026-04", count: 4 }]);
    }

    if (path === "/stats/orders/by-phase") {
      return json(route, [{ phase: "execution", count: 3 }]);
    }

    if (path === "/stats/appointments/upcoming") {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000101",
          title: "Follow-up slot",
          date: "2026-04-20",
          time_start: "09:00",
          status: "planned",
          patient_name: "Patient One",
        },
      ]);
    }

    if (path === "/tasks") {
      return json(route, []);
    }

    if (path === "/notifications") {
      return json(route, []);
    }

    if (path === "/stats/ceo/dashboard") {
      return json(route, {
        summary: {
          invoiced_this_month: "1200.00",
          collected_this_month: "700.00",
          invoiced_this_quarter: "3000.00",
          outstanding_receivables: "500.00",
          average_revenue_per_patient: "250.00",
          on_time_payment_rate_pct: 91,
          new_patients_this_month: 3,
          active_patients_total: 12,
          active_patients_under_care: 7,
          returning_patients: 5,
          patients_with_orders: 6,
          retention_rate_pct: 83,
          retention_definition: "returning patients over patients with orders",
        },
        countries: [],
        service_mix: [],
        patient_manager_kpis: [],
        interpreter_kpis: [],
        concierge_kpis: [],
        provider_kpis: [],
      });
    }

    if (path === "/stats/forecasting") {
      return json(route, {
        allowed_sections: ["quote_pipeline", "collections", "followup", "clinic_capacity"],
        summary: { open_quotes: 1 },
        quote_pipeline: { by_status: [{ status: "sent", count: 1 }], gross_total: "1000.00" },
        collections: { payment_plan_count: 1 },
        followup: {
          milestones_due_next_30d: 1,
          package_end_due_next_30d: 1,
          followup_1w_due_next_30d: 0,
          followup_1m_due_next_30d: 0,
          followup_6m_due_next_30d: 0,
        },
        clinic_capacity: { clinics: [] },
      });
    }

    if (path === "/stats/risk-analysis") {
      return json(route, {
        allowed_sections: ["executive", "patient_manager", "billing"],
        executive: { total_alerts: 0, urgent_alerts: 0, high_alerts: 0, medium_alerts: 0 },
        patient_manager: {
          summary: {
            total_alerts: 0,
            urgent_alerts: 0,
            high_alerts: 0,
            medium_alerts: 0,
            complex_case_alerts: 0,
            overdue_appointments: 0,
            overdue_tasks: 0,
            overdue_checklists: 0,
          },
          alerts: [],
        },
        billing: {
          summary: {
            total_alerts: 0,
            urgent_alerts: 0,
            high_alerts: 0,
            medium_alerts: 0,
            overdue_invoice_count: 0,
            blocked_orders: 0,
            outstanding_balance_total: "0.00",
            exposure_gap_total: "0.00",
          },
          alerts: [],
        },
      });
    }

    if (path === "/feedback/summary") {
      return json(route, {
        total_feedback: 0,
        reviewed_feedback: 0,
        patient_portal_count: 0,
        staff_capture_count: 0,
        nps_score: null,
        promoters: 0,
        passives: 0,
        detractors: 0,
        average_scores: {
          overall: null,
          interpreter: null,
          concierge: null,
          treatment: null,
          service: null,
          infrastructure: null,
          price_value: null,
        },
        top_promoters: [],
        interpreter_ranking: [],
        clinic_ranking: [],
      });
    }

    if (path === "/providers" || path.startsWith("/providers?")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000201",
          name: "Clinic Cologne",
          provider_type: "medical",
          fachbereich: "Cardiology",
          is_active: true,
        },
      ]);
    }

    if (path.startsWith("/providers/") && path.endsWith("/doctors")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000202",
          name: "Doctor Cologne",
          fachbereich: "Cardiology",
        },
      ]);
    }

    if (path === "/patients" || path.startsWith("/patients?")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000301",
          patient_id: "PT-001",
          first_name: "Anna",
          last_name: "Muster",
          birth_date: "1990-01-01",
          gender: "diverse",
          phone_primary: null,
          insurance_type: "public",
          is_active: true,
        },
      ]);
    }

    if (path === "/appointments/meta/staff") {
      return json(route, []);
    }

    if (path === "/appointments" || path.startsWith("/appointments?")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000401",
          title: "Follow-up slot",
          date: "2026-04-20",
          time_start: "09:00",
          time_end: "10:00",
          type: "medical",
          status: "planned",
          location: "Clinic Cologne",
          interpreter_response: "accepted",
          checklist_phase: "coordination",
          patient_id: "00000000-0000-0000-0000-000000000301",
          patient_name: "Anna Muster",
          patient_pid: "PT-001",
          provider_id: "00000000-0000-0000-0000-000000000201",
          provider_name: "Clinic Cologne",
          doctor_id: "00000000-0000-0000-0000-000000000202",
          doctor_name: "Doctor Cologne",
          owner_user_id: "00000000-0000-0000-0000-000000000001",
          owner_name: "Admin GMED",
          owner_role: "ceo",
          interpreter_id: null,
          interpreter_name: null,
          recurrence_series_id: null,
          recurrence_frequency: null,
          recurrence_interval: null,
          recurrence_count: null,
          recurrence_until: null,
          recurrence_index: 1,
          recurrence_series_size: 1,
          is_blocked: false,
        },
      ]);
    }

    if (
      path === "/appointments/meta/attention" ||
      path.startsWith("/appointments/meta/attention?")
    ) {
      return json(route, []);
    }

    if (path === "/documents/meta/staff") {
      return json(route, []);
    }

    if (path === "/documents/meta/categories") {
      return json(route, {
        categories: [{ key: "report", label: "Report" }],
        arts: ["medical_report"],
      });
    }

    if (path === "/documents/templates") {
      return json(route, templateCatalog);
    }

    if (path === "/documents" || path.startsWith("/documents?")) {
      return json(route, documents);
    }

    if (path === "/documents/generate" && route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        template_id?: string;
        patient_id?: string | null;
        auto_name?: string | null;
        status?: string;
        visibility?: string;
        language?: string | null;
      };
      const template = templateCatalog.templates.find(
        (item) => item.id === payload.template_id,
      );
      const generatedId = `00000000-0000-0000-0000-0000000005${10 + nextGeneratedDocumentIndex}`;
      const generatedName =
        payload.auto_name?.trim() || template?.default_auto_name || "Generated document";
      const generatedDocument = buildDocument({
        id: generatedId,
        auto_name: generatedName,
        original_filename: `${generatedName}.html`,
        art: template?.art ?? "generated_document",
        category: template?.category ?? "generated",
        status: payload.status ?? template?.default_status ?? "active",
        visibility:
          payload.visibility ?? template?.default_visibility ?? "patient_visible",
        mime_type: "text/html",
        file_size: 4096,
        uploaded_by_name: "Admin GMED",
        version_root_document_id: generatedId,
        version_number: 1,
        version_count: 1,
        patient_id: payload.patient_id ?? "00000000-0000-0000-0000-000000000301",
        created_at: `2026-04-1${nextGeneratedDocumentIndex}T10:00:00Z`,
        updated_at: `2026-04-1${nextGeneratedDocumentIndex}T10:00:00Z`,
        share_count: 0,
      });
      nextGeneratedDocumentIndex += 1;
      documents = [generatedDocument, ...documents];
      return json(route, {
        id: generatedId,
        auto_name: generatedName,
        original_filename: `${generatedName}.html`,
        mime_type: "text/html",
        file_size: 4096,
        language: payload.language ?? "de",
        version_number: 1,
        preview_html: `<html><body><h1>${generatedName}</h1><p>Template preview</p></body></html>`,
      });
    }

    if (path.startsWith("/documents/") && path.endsWith("/download")) {
      const requestedDocumentId = path
        .replace("/documents/", "")
        .replace("/download", "");
      const requestedDocument = documents.find((item) => item.id === requestedDocumentId);
      if (!requestedDocument) {
        return json(route, { message: "Not found" }, 404);
      }
      return route.fulfill({
        status: 200,
        contentType: requestedDocument.mime_type ?? "text/html",
        body: `<html><body><h1>${requestedDocument.auto_name}</h1></body></html>`,
      });
    }

    const requestedDocument = documents.find((item) => path === `/documents/${item.id}`);
    if (requestedDocument) {
      return json(route, requestedDocument);
    }

    if (
      path === `/documents/${documentId}/delete` &&
      route.request().method() === "POST"
    ) {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        reason?: string | null;
      };
      const updatedDocument = buildDocument({
        ...documents.find((item) => item.id === documentId),
        has_stored_file: false,
        status: "archived",
        file_deleted_at: "2026-04-13T12:30:00Z",
        file_deleted_by: "00000000-0000-0000-0000-000000000001",
        file_deleted_by_name: "Admin GMED",
        file_delete_reason: payload.reason ?? null,
        visibility: "internal",
        share_count: 0,
      });
      documents = documents.map((item) =>
        item.id === documentId ? updatedDocument : item,
      );
      portalShareActive = false;
      providerShares = [];
      return json(route, {
        ok: true,
        document: updatedDocument,
      });
    }

    if (
      path === `/documents/${documentId}/shares` &&
      route.request().method() === "POST"
    ) {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        shared_with_provider_id?: string | null;
        channel?: string | null;
        message?: string | null;
        requires_confirmation?: boolean;
      };
      const createdShare = {
        id: `00000000-0000-0000-0000-0000000009${20 + nextProviderShareIndex}`,
        shared_with_provider_id:
          payload.shared_with_provider_id ?? "00000000-0000-0000-0000-000000000201",
        shared_with_user_id: null,
        provider_name: "Clinic Cologne",
        target_user_name: null,
        target_user_role: null,
        shared_by_name: "Admin GMED",
        channel: payload.channel ?? "email",
        message: payload.message ?? null,
        requires_confirmation: payload.requires_confirmation ?? true,
        confirmed: false,
        confirmed_at: null,
        shared_at: `2026-04-0${5 + nextProviderShareIndex}T09:00:00Z`,
        revoked_at: null,
      };
      nextProviderShareIndex += 1;
      providerShares = [createdShare, ...providerShares];
      return json(route, { ok: true });
    }

    if (
      path.startsWith(`/documents/${documentId}/shares/`) &&
      path.endsWith("/revoke") &&
      route.request().method() === "POST"
    ) {
      const shareId = path
        .replace(`/documents/${documentId}/shares/`, "")
        .replace("/revoke", "");
      providerShares = providerShares.map((share) =>
        share.id === shareId
          ? {
              ...share,
              revoked_at: "2026-04-12T09:00:00Z",
            }
          : share,
      );
      return json(route, { ok: true });
    }

    if (path.startsWith("/documents/") && path.endsWith("/shares")) {
      const requestedId = path.replace("/documents/", "").replace("/shares", "");
      return json(route, buildSharesForDocument(requestedId));
    }

    if (path.startsWith("/documents/") && path.endsWith("/versions")) {
      const requestedId = path.replace("/documents/", "").replace("/versions", "");
      const requested = documents.find((item) => item.id === requestedId);
      return json(route, requested ? [requested] : []);
    }

    if (path.startsWith("/documents/") && path.endsWith("/translation-requests")) {
      return json(route, []);
    }

    if (path.startsWith("/documents/") && path.endsWith("/text-extraction")) {
      return json(route, {
        status: "available",
        method: "pdf_text",
        message: null,
        extracted_text: "MRI report text",
        has_text: true,
        extracted_at: "2026-04-05T09:00:00Z",
        extracted_by: "00000000-0000-0000-0000-000000000001",
        extracted_by_name: "Admin GMED",
      });
    }

    if (
      path === `/documents/${documentId}/portal-release` &&
      route.request().method() === "POST"
    ) {
      portalShareActive = true;
      return json(route, { ok: true });
    }

    if (
      path === `/documents/${documentId}/portal-release/revoke` &&
      route.request().method() === "POST"
    ) {
      portalShareActive = false;
      return json(route, { ok: true });
    }

    if (path === "/documents/intake-queue") {
      return json(route, []);
    }

    if (path === "/orders" || path.startsWith("/orders?")) {
      return json(route, []);
    }

    if (path === "/quotes" || path.startsWith("/quotes?")) {
      return json(route, []);
    }

    if (path === "/invoices" || path.startsWith("/invoices?")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000601",
          quote_id: null,
          quote_number: null,
          order_id: "00000000-0000-0000-0000-000000000701",
          order_number: "ORD-001",
          contract_id: null,
          patient_id: "00000000-0000-0000-0000-000000000301",
          patient_name: "Anna Muster",
          patient_pid: "PT-001",
          invoice_number: "INV-001",
          invoice_type: "advance",
          status: "sent",
          issued_at: "2026-04-01",
          due_date: "2026-04-15",
          total_net: "1000.00",
          total_vat: "0.00",
          total_gross: "1000.00",
          paid_amount: "0.00",
          balance_due: "1000.00",
          paid_at: null,
          notes: null,
          created_at: "2026-04-01T09:00:00Z",
          updated_at: "2026-04-01T09:00:00Z",
          line_items: [],
        },
      ]);
    }

    return json(route, []);
  });
}

test.describe("staff smoke flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "de");
    });
    await installStaffApiMocks(page);
    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /Open calendar/i })).toBeVisible();
  });

  test("staff can open dashboard, patients, appointments, documents and invoices", async ({
    page,
  }) => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Admin GMED|GMED/i);

    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByText("Anna Muster")).toBeVisible();

    await page.goto("/appointments");
    await expect(page).toHaveURL(/\/appointments$/);
    await expect(page.getByText("Follow-up slot")).toBeVisible();

    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByText("INV-001")).toBeVisible();
  });

  test("staff can release and revoke a document from patient portal scope", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.getByText("MRI report").click();
    await expect(
      page.getByRole("button", {
        name: /Ins Patientenportal freigeben|Выпустить в портал пациента/i,
      }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: /Ins Patientenportal freigeben|Выпустить в портал пациента/i,
      })
      .click();
    await expect(
      page.getByText(
        /Dokument ins Patientenportal freigegeben|Документ выпущен в портал пациента/i,
      ),
    ).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: /Portalfreigabe widerrufen|Отозвать релиз портала/i,
      }),
    ).toBeEnabled();

    await page
      .getByRole("button", {
        name: /Portalfreigabe widerrufen|Отозвать релиз портала/i,
      })
      .click();
    await expect(
      page
        .locator('[role="status"]')
        .filter({ hasText: /Portalfreigabe widerrufen|Релиз портала отозван/i }),
    ).toBeVisible();
  });

  test("staff can generate a document from template", async ({ page }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page
      .getByRole("button", { name: /Aus Vorlage generieren/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await dialog
      .getByRole("combobox", { name: /Kategorie/i })
      .selectOption("treatment_plan");
    await dialog.getByRole("combobox", { name: /Patient/i }).selectOption(
      "00000000-0000-0000-0000-000000000301",
    );
    await dialog.getByLabel("Dateiname").first().fill("Behandlungsplan April");

    await dialog.locator("form").evaluate((formElement) => {
      (formElement as HTMLFormElement).requestSubmit();
    });

    await expect(
      page
        .locator('[role="status"]')
        .filter({ hasText: /Version 1 erzeugt/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Behandlungsplan April" }),
    ).toBeVisible();
  });

  test("staff can share a document with provider and revoke it with cover message", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.getByText("MRI report").click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByRole("heading", { name: "MRI report" }),
    ).toBeVisible();

    const shareForm = sheet.locator("form").last();
    const providerToggle = shareForm.getByRole("button", { name: /^Provider$/i });
    await providerToggle.scrollIntoViewIfNeeded();
    await providerToggle.click();
    await shareForm.locator("select").first().selectOption(
      "00000000-0000-0000-0000-000000000201",
    );
    await shareForm
      .getByPlaceholder(/Kurzer Kontext/i)
      .fill("Bitte fuer das Kardiologie-Team freigeben.");
    await shareForm
      .getByRole("button", { name: /Freigabe erstellen/i })
      .click();

    await expect(
      page.locator('[role="status"]').filter({ hasText: /Freigabe erstellt\./i }),
    ).toBeVisible();
    await expect(sheet.getByText("Provider · Clinic Cologne")).toBeVisible();
    await expect(
      sheet.getByText("Bitte fuer das Kardiologie-Team freigeben."),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /^Widerrufen$/i }).click();

    await expect(
      page.locator('[role="status"]').filter({ hasText: /Freigabe widerrufen\./i }),
    ).toBeVisible();
    await expect(sheet.getByText("Revoked")).toBeVisible();
  });

  test("staff can delete a stored document file and keep metadata trail", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.getByText("MRI report").click();
    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByRole("heading", { name: "MRI report" }),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /Datei löschen/i }).click();
    const deleteDialog = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: /Datei löschen/i }),
    });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog
      .getByPlaceholder(/Warum wird die gespeicherte Datei entfernt/i)
      .fill("Patient requested binary removal after handoff.");
    await deleteDialog
      .getByRole("button", { name: /Datei endgültig löschen/i })
      .click();

    await expect(
      page.locator('[role="status"]').filter({ hasText: /Die gespeicherte Datei wurde entfernt\./i }),
    ).toBeVisible();
    await expect(sheet.getByText(/Gespeicherte Datei entfernt/i)).toBeVisible();
    await expect(sheet.getByText("Patient requested binary removal after handoff.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Herunterladen/i })).toBeDisabled();
  });
});
