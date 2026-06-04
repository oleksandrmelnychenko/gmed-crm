import { expect, test, type Page, type Route } from "@playwright/test";
import { chooseComboboxOption } from "./helpers";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

type StaffMockOptions = {
  role?: string;
  email?: string;
  name?: string;
  userId?: string;
};

let generatedDocumentPayloads: Array<Record<string, unknown>> = [];

function localIsoDate(date = new Date()) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function loginAsStaff(page: Page, email: string) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill("admin123");
  await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

async function installStaffApiMocks(page: Page, options: StaffMockOptions = {}) {
  generatedDocumentPayloads = [];
  const role = options.role ?? "ceo";
  const email = options.email ?? "admin@gmed.de";
  const name = options.name ?? "Admin GMED";
  const userId = options.userId ?? "00000000-0000-0000-0000-000000000001";
  let portalShareActive = false;
  const documentId = "00000000-0000-0000-0000-000000000501";
  const patientId = "00000000-0000-0000-0000-000000000301";
  const appointmentDate = localIsoDate();
  let nextGeneratedDocumentIndex = 1;
  let nextProviderShareIndex = 1;
  let nextTranslationRequestIndex = 1;
  let feedbackRows = [
    {
      id: "00000000-0000-0000-0000-000000001301",
      patient_id: "00000000-0000-0000-0000-000000000301",
      patient_name: "Anna Muster",
      patient_pid: "PT-001",
      appointment_id: "00000000-0000-0000-0000-000000000401",
      appointment_title: "Follow-up slot",
      provider_id: "00000000-0000-0000-0000-000000000201",
      provider_name: "Clinic Cologne",
      doctor_id: "00000000-0000-0000-0000-000000000202",
      doctor_name: "Doctor Cologne",
      patient_manager_id: "00000000-0000-0000-0000-000000000001",
      patient_manager_name: "Admin GMED",
      interpreter_id: null,
      interpreter_name: null,
      concierge_id: null,
      concierge_name: null,
      source: "patient_portal",
      status: "submitted",
      overall_score: 5,
      patient_manager_score: 5,
      interpreter_score: null,
      concierge_score: null,
      treatment_score: 5,
      doctor_score: 5,
      organization_score: 4,
      service_score: 5,
      infrastructure_score: 4,
      price_value_score: 4,
      treatment_success: "yes",
      complication_reported: false,
      nps_score: 9,
      comments: "Portal feedback from Anna.",
      improvement_notes: "Please shorten the waiting time at check-in.",
      internal_note: null,
      review_note: null,
      submitted_by_name: "Anna Portal",
      reviewed_by_name: null,
      submitted_at: "2026-04-10T09:30:00Z",
      reviewed_at: null,
    },
  ];

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
        supported_languages: ["de"],
        text_block_keys: ["intro", "next_steps"],
      },
      {
        id: "single_order",
        label: "Einzelauftrag",
        description: "Einzelauftrag zum Rahmendienstleistungsvertrag.",
        art: "single_order",
        category: "contract",
        default_auto_name: "Einzelauftrag",
        default_status: "active",
        default_visibility: "internal",
        is_medical: false,
        supported_languages: ["de"],
        text_block_keys: [],
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

  const patientDetail = {
    id: patientId,
    patient_id: "PT-001",
    title: null,
    first_name: "Anna",
    last_name: "Muster",
    birth_date: "1990-01-01",
    gender: "diverse",
    nationality: "DE",
    residence_country: "DE",
    languages: ["de", "uk"],
    functional_labels: [],
    phone_primary: "+49 30 000000",
    phone_secondary: null,
    email: "anna@example.com",
    insurance_provider: "AOK",
    insurance_type: "public",
    insurance_number: "4711",
    is_active: true,
    created_at: "2026-01-01T09:00:00Z",
    updated_at: "2026-04-01T09:00:00Z",
    address_street: "Musterstrasse 1",
    address_city: "Berlin",
    address_zip: "10115",
    address_country: "DE",
    emergency_contact_name: "Max Muster",
    emergency_contact_phone: "+49 30 111111",
    emergency_contact_relation: "Spouse",
    legal_status: {
      dsgvo_signed: true,
      identity_verified: true,
      compliance_completed: true,
      contract_status: "signed",
      notes: null,
    },
    notes: "Portal-ready patient profile.",
  };
  const patientAssignments = [
    {
      user_id: userId,
      user_name: name,
      user_role: role,
      user_active: true,
      assigned_by_name: "System",
      assigned_at: "2026-01-01T09:00:00Z",
      revoked_at: null,
    },
  ];
  const patientContracts = [
    {
      id: "00000000-0000-0000-0000-000000000801",
      contract_number: "CTR-001",
      status: "signed",
      signed_at: "2026-03-01T09:00:00Z",
      valid_from: "2026-03-01",
      valid_to: "2026-12-31",
      created_at: "2026-03-01T09:00:00Z",
    },
  ];
  const patientInvoices = [
    {
      id: "00000000-0000-0000-0000-000000000601",
      invoice_number: "INV-001",
      invoice_type: "advance",
      status: "sent",
      issued_at: "2026-04-01",
      due_date: "2026-04-15",
      total_gross: "1000.00",
      paid_amount: "0.00",
      order_number: "ORD-001",
      quote_number: null,
    },
  ];
  const leads = [
    {
      id: "00000000-0000-0000-0000-000000000901",
      first_name: "Blocked",
      last_name: "Lead",
      email: "blocked.lead@example.com",
      phone: "+49 30 100001",
      source: "website",
      country: "DE",
      intake_source: "website",
      flow: "standard",
      qualification_status: "qualified",
      compliance_status: "pending",
      conversion_ready: false,
      failed_outcome: { status: "none", reason: null, note: null, processed_at: null },
      submitted_at: "2026-04-01T09:00:00Z",
      created_at: "2026-04-01T09:00:00Z",
      attachment_count: 0,
    },
    {
      id: "00000000-0000-0000-0000-000000000902",
      first_name: "Ready",
      last_name: "Lead",
      email: "ready.lead@example.com",
      phone: "+49 30 100002",
      source: "referral",
      country: "DE",
      intake_source: "referral",
      flow: "standard",
      qualification_status: "qualified",
      compliance_status: "signed",
      conversion_ready: true,
      failed_outcome: { status: "none", reason: null, note: null, processed_at: null },
      submitted_at: "2026-04-02T09:00:00Z",
      created_at: "2026-04-02T09:00:00Z",
      attachment_count: 0,
    },
  ];
  const leadDetails = new Map(
    leads.map((lead) => [
      lead.id,
      {
        ...lead,
        middle_name: null,
        suffix: null,
        date_of_birth: lead.conversion_ready ? "1990-01-01" : null,
        legal_sex: lead.conversion_ready ? "female" : null,
        primary_language: lead.conversion_ready ? "de" : "",
        notes: lead.conversion_ready
          ? "Ready for conversion."
          : "Needs compliance and identity completion.",
        attachments: [],
        converted_patient_id: null,
        converted_patient_pid: null,
        readiness: {
          qualification_ready: true,
          conversion_ready: lead.conversion_ready,
          qualification_reasons: [],
          blocking_reasons: lead.conversion_ready
            ? []
            : [
                "Date of birth is missing",
                "Legal sex is missing",
                "Compliance status is not signed",
              ],
          checks: [
            {
              key: "contact",
              label: "Contact data complete",
              passed: true,
              blocking_for: "qualification",
            },
            {
              key: "compliance",
              label: "Compliance signed",
              passed: lead.conversion_ready,
              blocking_for: "convert",
            },
          ],
        },
        lifecycle: {
          current_stage: "qualified",
          stage_entered_at: "2026-04-03T09:00:00Z",
          can_convert: lead.conversion_ready,
          can_resolve_failed: true,
          history: [
            {
              from_stage: "new",
              to_stage: "qualified",
              transition_kind: "qualify",
              note: null,
              metadata: {},
              changed_by: userId,
              created_at: "2026-04-03T09:00:00Z",
            },
          ],
        },
      },
    ]),
  );

  const buildDocument = (overrides: Record<string, unknown> = {}) => ({
    id: documentId,
    patient_id: patientId,
    order_id: null,
    appointment_id: "00000000-0000-0000-0000-000000000401",
    provider_context_ids: ["00000000-0000-0000-0000-000000000201"],
    has_active_patient_portal_user: true,
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
  let translationRequests: Array<{
    id: string;
    document_id: string;
    requested_language: string;
    status: string;
    note: string | null;
    requested_at: string;
    requested_by_name: string | null;
    source_language: string | null;
    source_text: string | null;
    translated_text: string | null;
    translated_at: string | null;
    translated_by_name: string | null;
    completed_at: string | null;
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

  function buildFeedbackSummary() {
    const total = feedbackRows.length;
    const reviewed = feedbackRows.filter((item) => item.status === "reviewed").length;
    const patientPortal = feedbackRows.filter((item) => item.source === "patient_portal").length;
    const staffCapture = feedbackRows.filter((item) => item.source === "staff_capture").length;
    const overallAverage =
      total === 0
        ? null
        : Number(
            (
              feedbackRows.reduce((sum, item) => sum + Number(item.overall_score || 0), 0) / total
            ).toFixed(1),
          );
    const promoters = feedbackRows.filter((item) => Number(item.nps_score) >= 9).length;
    const detractors = feedbackRows.filter((item) => Number(item.nps_score) <= 6).length;
    const passives = total - promoters - detractors;

    return {
      total_feedback: total,
      reviewed_feedback: reviewed,
      patient_portal_count: patientPortal,
      staff_capture_count: staffCapture,
      nps_score: total === 0 ? null : Math.round(((promoters - detractors) / total) * 100),
      promoters,
      passives,
      detractors,
      average_scores: {
        overall: overallAverage,
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
    };
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
        email,
        name,
        role,
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

    if (path === "/stats/leads/by-status") {
      return json(route, [
        { status: "qualified", count: 2 },
        { status: "new", count: 1 },
      ]);
    }

    if (path === "/stats/orders/by-phase") {
      return json(route, [{ phase: "execution", count: 3 }]);
    }

    if (path === "/stats/appointments/upcoming") {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000101",
          title: "Follow-up slot",
          date: appointmentDate,
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
      return json(route, buildFeedbackSummary());
    }

    if (path === "/feedback") {
      return json(route, feedbackRows);
    }

    if (
      path.startsWith("/feedback/") &&
      path.endsWith("/review") &&
      route.request().method() === "POST"
    ) {
      const feedbackId = path.replace("/feedback/", "").replace("/review", "");
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        status?: string;
        review_note?: string | null;
      };
      let updatedRow: (typeof feedbackRows)[number] | null = null;
      feedbackRows = feedbackRows.map((item) => {
        if (item.id !== feedbackId) return item;
        updatedRow = {
          ...item,
          status: payload.status ?? "reviewed",
          review_note: payload.review_note ?? null,
          reviewed_by_name: "Admin GMED",
          reviewed_at: "2026-04-13T11:45:00Z",
        };
        return updatedRow;
      });
      return json(route, updatedRow ?? { message: "Not found" }, updatedRow ? 200 : 404);
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
          id: patientId,
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

    if (path === `/patients/${patientId}`) {
      return json(route, patientDetail);
    }

    if (path === `/patients/${patientId}/assignments`) {
      return json(route, patientAssignments);
    }

    if (path === `/patients/${patientId}/framework-contracts`) {
      return json(route, patientContracts);
    }

    if (path === `/patients/${patientId}/invoices`) {
      return json(route, patientInvoices);
    }

    if (path === "/leads" || path.startsWith("/leads?")) {
      return json(route, leads);
    }

    if (path.startsWith("/leads/")) {
      const leadSuffix = path.replace("/leads/", "");
      if (!leadSuffix.includes("/")) {
        const detail = leadDetails.get(leadSuffix);
        if (detail) {
          return json(route, detail);
        }
      }
    }

    if (path === "/appointments/meta/staff") {
      return json(route, []);
    }

    if (path === "/appointments" || path.startsWith("/appointments?")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000401",
          title: "Follow-up slot",
          date: appointmentDate,
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
      generatedDocumentPayloads.push(payload as Record<string, unknown>);
      const template = templateCatalog.templates.find(
        (item) => item.id === payload.template_id,
      );
      const generatedId = `00000000-0000-0000-0000-0000000005${10 + nextGeneratedDocumentIndex}`;
      const generatedName =
        payload.auto_name?.trim() || template?.default_auto_name || "Generated document";
      const generatedDocument = buildDocument({
        id: generatedId,
        auto_name: generatedName,
        original_filename: `${generatedName}.pdf`,
        art: template?.art ?? "generated_document",
        category: template?.category ?? "generated",
        status: payload.status ?? template?.default_status ?? "active",
        visibility:
          payload.visibility ?? template?.default_visibility ?? "patient_visible",
        mime_type: "application/pdf",
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
        original_filename: `${generatedName}.pdf`,
        mime_type: "application/pdf",
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
        contentType: requestedDocument.mime_type ?? "application/pdf",
        body: `%PDF-1.4
1 0 obj
<< /Type /Catalog >>
endobj
%%EOF`,
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

    if (
      path.startsWith("/documents/") &&
      path.endsWith("/translation-requests") &&
      route.request().method() === "POST"
    ) {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        requested_language?: string;
        note?: string | null;
      };
      const createdRequest = {
        id: `00000000-0000-0000-0000-0000000011${10 + nextTranslationRequestIndex}`,
        document_id: path
          .replace("/documents/", "")
          .replace("/translation-requests", ""),
        requested_language: payload.requested_language ?? "de",
        status: "pending",
        note: payload.note ?? null,
        requested_at: `2026-04-1${nextTranslationRequestIndex}T09:00:00Z`,
        requested_by_name: "Admin GMED",
        source_language: null,
        source_text: null,
        translated_text: null,
        translated_at: null,
        translated_by_name: null,
        completed_at: null,
      };
      nextTranslationRequestIndex += 1;
      translationRequests = [createdRequest, ...translationRequests];
      return json(route, createdRequest);
    }

    if (path.startsWith("/documents/") && path.endsWith("/translation-requests")) {
      const requestedId = path
        .replace("/documents/", "")
        .replace("/translation-requests", "");
      return json(
        route,
        translationRequests.filter((item) => item.document_id === requestedId),
      );
    }

    if (
      path.startsWith("/documents/translation-requests/") &&
      path.endsWith("/update") &&
      route.request().method() === "POST"
    ) {
      const requestId = path
        .replace("/documents/translation-requests/", "")
        .replace("/update", "");
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        status?: string;
        note?: string | null;
        source_language?: string | null;
        source_text?: string | null;
        translated_text?: string | null;
      };
      let updatedRequest: (typeof translationRequests)[number] | null = null;
      translationRequests = translationRequests.map((item) => {
        if (item.id !== requestId) return item;
        updatedRequest = {
          ...item,
          status: payload.status ?? item.status,
          note: payload.note ?? item.note,
          source_language:
            payload.source_language !== undefined
              ? payload.source_language
              : item.source_language,
          source_text:
            payload.source_text !== undefined
              ? payload.source_text
              : item.source_text,
          translated_text:
            payload.translated_text !== undefined
              ? payload.translated_text
              : item.translated_text,
          translated_at:
            payload.source_text !== undefined ||
            payload.translated_text !== undefined ||
            payload.source_language !== undefined
              ? "2026-04-13T10:15:00Z"
              : item.translated_at,
          translated_by_name:
            payload.source_text !== undefined ||
            payload.translated_text !== undefined ||
            payload.source_language !== undefined
              ? "Admin GMED"
              : item.translated_by_name,
          completed_at:
            (payload.status ?? item.status) === "completed"
              ? "2026-04-13T10:30:00Z"
              : item.completed_at,
        };
        return updatedRequest;
      });
      return json(route, updatedRequest ?? { message: "Not found" }, updatedRequest ? 200 : 404);
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
      return json(route, {
        items: [
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
        ],
        page: 1,
        per_page: 25,
        total: 1,
        total_pages: 1,
      });
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
    await loginAsStaff(page, "admin@gmed.de");
    await expect(page.getByRole("link", { name: /Dashboard/i })).toBeVisible();
  });

  test("staff can open dashboard, patients, appointments, documents and invoices", async ({
    page,
  }) => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("Admin GMED", { exact: true })).toBeVisible();

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
        name: /Ins Patientenportal freigeben/i,
      }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: /Ins Patientenportal freigeben/i,
      })
      .click();
    await expect(page.getByText(/aktive Portalfreigaben/i)).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: /Portalfreigabe widerrufen/i,
      }),
    ).toBeEnabled();

    await page
      .getByRole("button", {
        name: /Portalfreigabe widerrufen/i,
      })
      .click();
    await expect(
      page.getByText(/Noch keine aktiven Portal-Freigaben|No active portal releases/i),
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

    await chooseComboboxOption(
      page,
      dialog.getByRole("combobox", { name: /Vorlage/i }),
      /Treatment plan|Behandlungsplan/i,
    );
    await chooseComboboxOption(
      page,
      dialog.getByRole("combobox", { name: /Patient/i }),
      /Anna Muster/i,
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

  test("staff sends typed bindings when generating a single order", async ({
    page,
  }) => {
    await page.goto("/documents");

    await page
      .getByRole("button", { name: /Aus Vorlage generieren/i })
      .click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    await chooseComboboxOption(
      page,
      dialog.getByRole("combobox", { name: /Vorlage/i }),
      /Einzelauftrag/i,
    );
    await chooseComboboxOption(
      page,
      dialog.getByRole("combobox", { name: /Patient/i }),
      /Anna Muster/i,
    );

    await dialog.getByLabel("Dateiname").first().fill("Einzelauftrag Mai");
    await dialog.getByLabel("Laufende Nr. des Einzelauftrags").fill("5");
    await dialog.getByLabel("Patient E-Mail").fill("anna.binding@example.test");
    await dialog.getByLabel("Auftragsnummer").fill("EA-BIND-5");
    await dialog.getByLabel("Kostenübernehmer Anrede").fill("Frau");
    await dialog.getByLabel("Kostenübernehmer (Name)").fill("Erika Zahlerin");
    await dialog
      .getByLabel("Bestandteile / Rangfolge")
      .fill("Anlage A: Vorbefunde und Medikationsliste");

    await dialog.locator("form").evaluate((formElement) => {
      (formElement as HTMLFormElement).requestSubmit();
    });

    await expect(
      page
        .locator('[role="status"]')
        .filter({ hasText: /Version 1 erzeugt/i }),
    ).toBeVisible();

    expect(generatedDocumentPayloads.at(-1)).toMatchObject({
      template_id: "single_order",
      auto_name: "Einzelauftrag Mai",
      patient_id: "00000000-0000-0000-0000-000000000301",
      bindings: {
        order_sequence: 5,
        party_email: "anna.binding@example.test",
        order_number: "EA-BIND-5",
        payer_salutation: "Frau",
        payer_name: "Erika Zahlerin",
        order_components: "Anlage A: Vorbefunde und Medikationsliste",
      },
    });
  });

  test("staff can share a document with provider and revoke it with cover message", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.getByText("MRI report").click();
    const sheet = page.getByRole("main");
    await expect(
      sheet.getByRole("heading", { name: "MRI report" }),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /Freigabe erstellen/i }).click();
    const shareSheet = page.locator('[data-slot="sheet-content"]').filter({
      has: page.getByRole("heading", { name: /Freigabe erstellen|Create share/i }),
    });
    await expect(shareSheet).toBeVisible();
    const shareForm = shareSheet.locator("form").last();
    const providerToggle = shareForm.getByRole("button", { name: /^Provider$/i });
    await providerToggle.scrollIntoViewIfNeeded();
    await providerToggle.click();
    await chooseComboboxOption(
      page,
      shareForm.getByRole("combobox", { name: /Provider auswählen/i }),
      /Clinic Cologne/i,
    );
    await shareForm
      .getByPlaceholder(/Kurzer Kontext/i)
      .fill("Bitte fuer das Kardiologie-Team freigeben.");
    await shareForm
      .getByRole("button", { name: /Freigabe erstellen/i })
      .click();

    await expect(sheet.getByText(/Provider.*Clinic Cologne/)).toBeVisible();
    await expect(
      sheet.getByText("Bitte fuer das Kardiologie-Team freigeben."),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /^Widerrufen$/i }).click();

    await expect(
      sheet.getByText(/^Widerrufen$|^Revoked$/i).first(),
    ).toBeVisible();
  });

  test("staff can delete a stored document file and keep metadata trail", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.getByText("MRI report").click();
    const sheet = page.getByRole("main");
    await expect(
      sheet.getByRole("heading", { name: "MRI report" }),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /Datei/i }).click();
    const deleteDialog = page.getByRole("dialog").filter({
      hasText: "gespeicherte Datei",
    });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog
      .getByPlaceholder(/Warum wird die gespeicherte Datei entfernt/i)
      .fill("Patient requested binary removal after handoff.");
    await deleteDialog
      .locator("button")
      .filter({ hasText: "endg" })
      .click();

    await expect(sheet.getByText(/Gespeicherte Datei entfernt/i)).toBeVisible();
    await expect(sheet.getByText("Patient requested binary removal after handoff.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: /Herunterladen/i })).toBeDisabled();
  });

  test("staff can create and complete a document translation workspace flow", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page.getByText("MRI report")).toBeVisible();

    await page.getByText("MRI report").click();
    const sheet = page.getByRole("main");
    await expect(
      sheet.getByRole("heading", { name: "MRI report" }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: /bersetzungsanfragen/i }),
    ).toBeVisible();

    await sheet.locator("button").filter({ hasText: "bersetzung anfordern" }).click();
    const translationSheet = page.locator('[data-slot="sheet-content"]').filter({
      hasText: /bersetzung anfordern|Request translation/i,
    });
    await expect(translationSheet).toBeVisible();
    await chooseComboboxOption(page, translationSheet.getByRole("combobox").first(), /Deutsch|German/i);
    await translationSheet
      .getByPlaceholder(/Umfang, Frist oder Lieferhinweise/i)
      .first()
      .fill("Patient-safe English version for portal handoff.");
    await translationSheet
      .locator("button")
      .filter({ hasText: "bersetzung anfordern" })
      .click();

    await expect(
      sheet.locator("p").filter({ hasText: /^Admin GMED$/ }),
    ).toBeVisible();
    await sheet.getByText(/Zugewiesen: Nicht zugewiesen|Assigned: Unassigned/i).click();

    await sheet.locator("button").filter({ hasText: "Extrahierten Text" }).click();
    await sheet.getByLabel(/Ausgangstext/i).fill("Original German report");
    await sheet.getByLabel(/bersetzter Text/i).fill("Patient-safe English report");
    await sheet
      .getByLabel(/Notizen|Notes/i)
      .fill("Ready for patient delivery.");
    await sheet.getByRole("button", { name: /Workspace speichern/i }).click();

    await expect(
      sheet.getByLabel(/bersetzter Text/i),
    ).toHaveValue("Patient-safe English report");

    await sheet.getByRole("button", { name: /Aktionen|Actions/i }).click();
    await page
      .locator("[data-translation-action-menu]")
      .last()
      .locator("button")
      .filter({ hasText: "Abschlie" })
      .first()
      .click();
    await expect(sheet.getByText(/Abgeschlossen|Completed/i).first()).toBeVisible();
    await expect(sheet.getByText("Ready for patient delivery.")).toBeVisible();
  });

  test("staff can review portal feedback from the feedback workspace", async ({
    page,
  }) => {
    await page.goto("/feedback");
    await expect(page).toHaveURL(/\/feedback$/);
    await expect(
      page.getByRole("heading", { name: /Feedback und NPS|Feedback and NPS/i }),
    ).toBeVisible();

    const feedbackCard = page
      .getByRole("row")
      .filter({ hasText: "Anna Muster" })
      .first();
    await expect(feedbackCard).toBeVisible();
    await expect(feedbackCard.getByText(/Eingereicht|Submitted/i)).toBeVisible();

    await feedbackCard.click();

    const reviewSheet = page.getByRole("dialog").filter({
      hasText: "Portal feedback from Anna.",
    });
    await expect(
      reviewSheet.getByRole("heading", {
        name: /Feedback|Review/i,
      }).first(),
    ).toBeVisible();
    await reviewSheet
      .getByPlaceholder(
        /Operative Nachverfolgung oder Pr|Operational follow-up or review note/i,
      )
      .fill("Reviewed with the clinic manager and added to the quality follow-up list.");
    await reviewSheet
      .getByRole("button", {
        name: /fung speichern|Save review/i,
      })
      .click();

    await expect(reviewSheet).toHaveCount(0);
    await expect(
      feedbackCard.getByText(/^Gepr|^Reviewed$/i).first(),
    ).toBeVisible();
  });
});

test.describe("patient-profile RBAC shell", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "de");
    });
    await installStaffApiMocks(page, {
      role: "ceo_assistant",
      email: "assistant@gmed.de",
      name: "CEO Assistant",
      userId: "00000000-0000-0000-0000-000000000002",
    });
    await loginAsStaff(page, "assistant@gmed.de");
    await expect(page.getByText("CEO Assistant", { exact: true }).first()).toBeVisible();
  });

  test("ceo assistant sees only read-only commercial tabs on patient profile", async ({
    page,
  }) => {
    await page.goto("/patients/00000000-0000-0000-0000-000000000301?tab=documents");
    await page.waitForURL(/\/patients\/00000000-0000-0000-0000-000000000301$/);
    const workspaceNav = page.getByRole("complementary");

    await expect(page.getByRole("heading", { name: "Anna Muster" })).toBeVisible();
    await expect(
      workspaceNav.getByRole("link", { name: /Dokumente|Documents/i }),
    ).toHaveCount(0);
    await expect(
      workspaceNav.getByRole("link", { name: /Relations/i }),
    ).toHaveCount(0);
    await expect(
      workspaceNav.getByRole("link", { name: /Arbeitsablauf|Workflow/i }),
    ).toHaveCount(0);
    await expect(
      workspaceNav.getByRole("link", { name: /Timeline/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Open documents/i }),
    ).toHaveCount(0);

    await expect(
      workspaceNav.locator('a[href*="tab=contracts"]'),
    ).toBeVisible();
    await expect(
      workspaceNav.locator('a[href*="tab=invoices"]'),
    ).toBeVisible();

    await workspaceNav.locator('a[href*="tab=contracts"]').click();
    await expect(page.getByText("CTR-001")).toBeVisible();

    await workspaceNav.locator('a[href*="tab=invoices"]').click();
    await expect(page.getByText("INV-001")).toBeVisible();
  });
});

test.describe("lead conversion gating", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "de");
    });
    await installStaffApiMocks(page, {
      role: "patient_manager",
      email: "pm@gmed.de",
      name: "PM GMED",
      userId: "00000000-0000-0000-0000-000000000003",
    });
    await loginAsStaff(page, "pm@gmed.de");
  });

  test("patient manager sees blocked and ready convert states directly on lead cards", async ({
    page,
  }) => {
    await page.goto("/leads");
    await expect(page.getByText("Blocked Lead")).toBeVisible();
    await expect(page.getByText("Ready Lead")).toBeVisible();

    const convertButtons = page.getByRole("button", {
      name: /Konvertieren|Convert/i,
    });
    await expect(convertButtons).toHaveCount(2);
    await expect(convertButtons.nth(0)).toBeDisabled();
    await expect(convertButtons.nth(0)).toHaveAttribute(
      "title",
      /Missing required data|Qualifikation und Konvertierung/i,
    );
    await expect(convertButtons.nth(1)).toBeEnabled();

    await page.getByText("Ready Lead").click();
    const readyLeadDetail = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Ready Lead" }),
    });
    await expect(
      readyLeadDetail.getByRole("button", { name: /Konvertieren|Convert/i }),
    ).toBeEnabled();
  });
});
