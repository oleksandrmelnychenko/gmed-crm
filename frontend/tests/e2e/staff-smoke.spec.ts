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
  const translatorId = "00000000-0000-0000-0000-000000000002";
  const translatorName = "Uliana Mu";
  let portalShareActive = false;
  const documentId = "00000000-0000-0000-0000-000000000501";
  const appointmentConfirmationId = "00000000-0000-0000-0000-000000000502";
  const patientId = "00000000-0000-0000-0000-000000000301";
  const appointmentDate = localIsoDate();
  let nextGeneratedDocumentIndex = 1;
  let nextProviderShareIndex = 1;
  let nextTranslationRequestIndex = 1;
  let intakeCaseCreated = false;
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
      {
        id: "appointment_confirmation",
        label: "Terminbestätigung",
        description: "Formelle Terminbestätigung.",
        art: "appointment_confirmation",
        category: "clinic_correspondence",
        default_auto_name: "Terminbestätigung",
        default_status: "draft",
        default_visibility: "patient_visible",
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
      source: "website_contact_form",
      country: "DE",
      intake_source: "website_contact",
      flow: "standard",
      lead_type: "form",
      console_promoted_at: null,
      qualification_status: "in_progress",
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
      source: "Website Wizard",
      country: "DE",
      intake_source: "visitor_facade",
      flow: "medical",
      lead_type: "console",
      console_promoted_at: "2026-04-02T10:00:00Z",
      qualification_status: "in_progress",
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
        middle_name: lead.conversion_ready ? "Maria" : null,
        suffix: lead.conversion_ready ? "Jr." : null,
        date_of_birth: lead.conversion_ready ? "1990-01-01" : null,
        legal_sex: lead.conversion_ready ? "female" : null,
        primary_language: lead.conversion_ready ? "de" : "",
        locale: lead.conversion_ready ? "ru-RU" : "de",
        street_address: lead.conversion_ready ? "Hauptstr. 1" : null,
        city: lead.conversion_ready ? "Berlin" : null,
        state: lead.conversion_ready ? "Berlin" : null,
        zip_code: lead.conversion_ready ? "10115" : null,
        primary_phone_type: lead.conversion_ready ? "mobile" : null,
        phones: lead.conversion_ready
          ? [
              { number: "+49 30 100002", type: "mobile" },
              { number: "+49 30 100099", type: "work" },
            ]
          : [],
        whatsapp_number: lead.conversion_ready ? "+49 30 100002" : null,
        whatsapp_consent: lead.conversion_ready ? true : null,
        email_consent: lead.conversion_ready ? true : null,
        location: lead.conversion_ready ? "eu" : null,
        location_detailed: lead.conversion_ready ? "germany" : null,
        preferred_location: lead.conversion_ready ? "berlin" : null,
        visit_timing: lead.conversion_ready ? "within_4_weeks" : null,
        wants_membership: lead.conversion_ready ? false : null,
        selected_program: lead.conversion_ready ? "medical_treatment" : null,
        can_travel: lead.conversion_ready ? true : null,
        has_travel_documents: lead.conversion_ready ? true : null,
        currently_in_treatment: lead.conversion_ready ? true : null,
        has_health_risk_for_travel: lead.conversion_ready ? false : null,
        has_medical_records: lead.conversion_ready ? "yes" : null,
        records_in_accepted_language: lead.conversion_ready ? true : null,
        has_insurance: lead.conversion_ready ? true : null,
        insurance_covers_germany: lead.conversion_ready ? "not_sure" : null,
        needs_interpreter: lead.conversion_ready ? true : null,
        message: lead.conversion_ready
          ? "Please coordinate an orthopedic consultation and airport transfer."
          : null,
        services: lead.conversion_ready
          ? ["medical_treatment", "concierge_support"]
          : [],
        consent_automated_contact: lead.conversion_ready,
        consent_opt_out: lead.conversion_ready,
        consent_healthcare: lead.conversion_ready,
        consent_privacy_practices: lead.conversion_ready,
        notes: lead.conversion_ready
          ? "Ready for conversion."
          : "Needs compliance and identity completion.",
        attachments: [],
        converted_patient_id: null,
        converted_patient_pid: null,
        wizard_state: lead.id === "00000000-0000-0000-0000-000000000902"
          ? { step: "documents" }
          : {},
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

  let documents = [
    buildDocument(),
    buildDocument({
      id: appointmentConfirmationId,
      auto_name: "Terminbestätigung",
      original_filename: "Terminbestätigung.pdf",
      art: "appointment_confirmation",
      category: "clinic_correspondence",
      status: "draft",
      visibility: "patient_visible",
      is_medical: false,
      klinik: null,
      ursprung: "template:appointment_confirmation",
      generated_template_id: "appointment_confirmation",
      data_sensitivity: "Patient Identity",
      version_root_document_id: appointmentConfirmationId,
      created_at: "2026-04-02T09:00:00Z",
      updated_at: "2026-04-02T09:00:00Z",
    }),
  ];
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
    assigned_to: string | null;
    assigned_to_name: string | null;
    assigned_at: string | null;
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

    if (path === "/providers/specializations") {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000211",
          code: "orthopedics",
          name_en: "Orthopedics",
          name_de: "Orthopädie",
          name_ru: "Ортопедия",
          is_active: true,
          sort_order: 10,
        },
        {
          id: "00000000-0000-0000-0000-000000000212",
          code: "cardiology",
          name_en: "Cardiology",
          name_de: "Kardiologie",
          name_ru: "Кардиология",
          is_active: true,
          sort_order: 20,
        },
      ]);
    }

    if (path === "/cases" && route.request().method() === "POST") {
      intakeCaseCreated = true;
      return json(route, { id: "00000000-0000-0000-0000-000000000971" }, 201);
    }

    if (path.startsWith("/cases?") && route.request().method() === "GET") {
      return json(route, intakeCaseCreated ? [{ id: "00000000-0000-0000-0000-000000000971" }] : []);
    }

    if (path === "/cases/00000000-0000-0000-0000-000000000971" && route.request().method() === "GET") {
      return json(route, {
        id: "00000000-0000-0000-0000-000000000971",
        case_id: "CASE-971",
        patient_id: "",
        manager_id: userId,
        status: "new",
        hauptanfragegrund: "Orthopädische Beratung",
        aktuelle_anamnese: "Beschwerden seit drei Wochen",
        zuweiser: null,
        notes: null,
        created_at: "2026-07-11T10:00:00Z",
        updated_at: "2026-07-11T10:00:00Z",
        vorerkrankungen: [],
        allergien: [],
        operationen: [],
        medikamente: [],
        pain_records: [],
        symptome: [],
      });
    }

    if (path === "/cases/00000000-0000-0000-0000-000000000971/anamnesis") {
      return json(route, { ok: true });
    }

    if (["vorerkrankungen", "allergien", "medikamente"].some((section) => path === `/cases/00000000-0000-0000-0000-000000000971/${section}`)) {
      return json(route, { ok: true });
    }

    if (path === "/cases/00000000-0000-0000-0000-000000000971/intake-completion") {
      return json(route, { ok: true, intake_completed_at: "2026-07-11T10:00:00Z" });
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

    if (path === "/agency-services" || path.startsWith("/agency-services?")) {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000000951",
          service_key: "transport_coordination",
          service_name: "Transport coordination",
          description: "Transport and arrival coordination",
          unit_label: "case",
          unit_price: "12500.00",
          currency: "EUR",
          vat_rate: "19.00",
          is_active: true,
          valid_from: null,
          valid_to: null,
          created_at: "2026-04-01T09:00:00Z",
          updated_at: "2026-04-01T09:00:00Z",
        },
      ]);
    }

    if (path.startsWith("/leads/")) {
      const leadSuffix = path.replace("/leads/", "");
      if (leadSuffix.endsWith("/promote-console") && route.request().method() === "POST") {
        const requestedId = leadSuffix.replace("/promote-console", "");
        const promotedAt = "2026-04-04T10:00:00Z";
        const listLead = leads.find((item) => item.id === requestedId);
        if (listLead) {
          listLead.lead_type = "console";
          listLead.console_promoted_at = promotedAt;
        }
        const detail = leadDetails.get(requestedId);
        if (detail) {
          leadDetails.set(requestedId, {
            ...detail,
            lead_type: "console",
            console_promoted_at: promotedAt,
          });
        }
        return json(route, { ok: true });
      }
      if (leadSuffix.endsWith("/failed-flow") && route.request().method() === "POST") {
        const requestedId = leadSuffix.replace("/failed-flow", "");
        const payload = JSON.parse(route.request().postData() ?? "{}") as {
          reason?: string;
          resolution?: string;
        };
        const failedOutcome = {
          status: "archived",
          reason: payload.reason ?? null,
          note: null,
          processed_at: "2026-04-04T11:00:00Z",
        };
        const listLead = leads.find((item) => item.id === requestedId);
        if (listLead) {
          listLead.qualification_status = "archived";
          listLead.failed_outcome = failedOutcome;
        }
        const detail = leadDetails.get(requestedId);
        if (detail) {
          leadDetails.set(requestedId, {
            ...detail,
            qualification_status: "archived",
            failed_outcome: failedOutcome,
          });
        }
        return json(route, { ok: true });
      }
      if (leadSuffix.endsWith("/qualify") && route.request().method() === "POST") {
        const requestedId = leadSuffix.replace("/qualify", "");
        const payload = JSON.parse(route.request().postData() ?? "{}") as {
          status?: string;
        };
        const qualificationStatus = payload.status ?? "in_progress";
        const listLead = leads.find((item) => item.id === requestedId);
        if (listLead) listLead.qualification_status = qualificationStatus;
        const detail = leadDetails.get(requestedId);
        if (detail) {
          leadDetails.set(requestedId, {
            ...detail,
            qualification_status: qualificationStatus,
          });
        }
        return json(route, { ok: true });
      }
      if (leadSuffix.endsWith("/update") && route.request().method() === "POST") {
        const requestedId = leadSuffix.replace("/update", "");
        const detail = leadDetails.get(requestedId);
        if (detail) {
          const payload = JSON.parse(route.request().postData() ?? "{}") as Record<
            string,
            unknown
          >;
          leadDetails.set(requestedId, { ...detail, ...payload });
        }
        return json(route, { ok: true });
      }
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
      return json(route, [
        { id: userId, name, role },
        { id: translatorId, name: translatorName, role: "patient_manager" },
      ]);
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
        assigned_to: null,
        assigned_to_name: null,
        assigned_at: null,
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
        assigned_to?: string | null;
      };
      let updatedRequest: (typeof translationRequests)[number] | null = null;
      translationRequests = translationRequests.map((item) => {
        if (item.id !== requestId) return item;
        const assignedTo =
          payload.assigned_to === undefined
            ? item.assigned_to
            : payload.assigned_to;
        updatedRequest = {
          ...item,
          status: payload.status ?? item.status,
          note: payload.note ?? item.note,
          assigned_to: assignedTo,
          assigned_to_name:
            assignedTo === userId
              ? name
              : assignedTo === translatorId
                ? translatorName
                : null,
          assigned_at:
            payload.assigned_to === undefined
              ? item.assigned_at
              : assignedTo
                ? "2026-04-13T10:05:00Z"
                : null,
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
      const requestedId = path
        .replace("/documents/", "")
        .replace("/text-extraction", "");
      return json(route, {
        status: "available",
        method: "pdf_text",
        message: null,
        extracted_text:
          requestedId === appointmentConfirmationId
            ? "hiermit bestätigen wir, dass Frau MUSTER, Anna, geb. am 01.01.1990, Reisepass Nr.: MA1234567, gültig bis 01.01.2050, sämtliche Termine hat."
            : "MRI report text",
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

  test("staff sees passport bindings when editing a Terminbestätigung version", async ({
    page,
  }) => {
    await page.goto("/documents");
    const appointmentConfirmationRow = page
      .getByText("Terminbestätigung", { exact: true })
      .first();
    await expect(appointmentConfirmationRow).toBeVisible();

    await appointmentConfirmationRow.click();
    const detail = page.getByRole("main");
    await expect(
      detail.getByRole("heading", { name: "Terminbestätigung" }),
    ).toBeVisible();

    await detail.getByRole("button", { name: /Neue Version/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Reisepass-Nr.")).toHaveValue("MA1234567");
    await expect(dialog.getByLabel("Reisepass gültig bis")).toHaveValue(
      "2050-01-01",
    );

    await dialog.locator("form").evaluate((formElement) => {
      (formElement as HTMLFormElement).requestSubmit();
    });

    expect(generatedDocumentPayloads.at(-1)).toMatchObject({
      template_id: "appointment_confirmation",
      replace_document_id: "00000000-0000-0000-0000-000000000502",
      bindings: {
        passport_number: "MA1234567",
        passport_valid_until: "2050-01-01",
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
    const assigneeSaveRequest = page.waitForRequest((request) => {
      if (
        request.method() !== "POST" ||
        !request.url().includes("/api/v1/documents/translation-requests/") ||
        !request.url().endsWith("/update")
      ) {
        return false;
      }
      const payload = JSON.parse(request.postData() ?? "{}") as {
        assigned_to?: string | null;
        status?: string;
      };
      return (
        payload.status === "in_progress" &&
        payload.assigned_to === "00000000-0000-0000-0000-000000000002"
      );
    });
    await Promise.all([
      assigneeSaveRequest,
      chooseComboboxOption(
        page,
        sheet.getByRole("combobox", { name: /Assignee|Ausf/i }),
        /Uliana Mu/i,
      ),
    ]);
    const workspaceSaveRequest = page.waitForRequest((request) => {
      if (
        request.method() !== "POST" ||
        !request.url().includes("/api/v1/documents/translation-requests/") ||
        !request.url().endsWith("/update")
      ) {
        return false;
      }
      const payload = JSON.parse(request.postData() ?? "{}") as {
        status?: string;
        source_text?: string | null;
        translated_text?: string | null;
        note?: string | null;
        assigned_to?: string | null;
      };
      return (
        payload.status === "in_progress" &&
        payload.source_text === "Original German report" &&
        payload.translated_text === "Patient-safe English report" &&
        payload.note === "Ready for patient delivery." &&
        !Object.prototype.hasOwnProperty.call(payload, "assigned_to")
      );
    });
    await Promise.all([
      workspaceSaveRequest,
      sheet.getByRole("button", { name: /Workspace speichern/i }).click(),
    ]);

    await expect(
      sheet.getByLabel(/bersetzter Text/i),
    ).toHaveValue("Patient-safe English report");

    await page.reload();
    const reloadedSheet = page.getByRole("main");
    await expect(
      reloadedSheet.getByRole("heading", { name: "MRI report" }),
    ).toBeVisible();
    await reloadedSheet
      .getByText(/Zugewiesen: Uliana Mu|Assigned: Uliana Mu/i)
      .click();
    await expect(reloadedSheet.getByLabel(/Ausgangstext/i)).toHaveValue(
      "Original German report",
    );
    await expect(reloadedSheet.getByLabel(/bersetzter Text/i)).toHaveValue(
      "Patient-safe English report",
    );
    await expect(reloadedSheet.getByLabel(/Notizen|Notes/i)).toHaveValue(
      "Ready for patient delivery.",
    );
    await expect(
      reloadedSheet.getByText(/Zugewiesen: Uliana Mu|Assigned: Uliana Mu/i),
    ).toBeVisible();

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

test.describe("lead onboarding wizard", () => {
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

  test("lead table omits the inline actions column", async ({
    page,
  }) => {
    await page.goto("/leads");
    await expect(page.getByText("Blocked Lead")).toBeVisible();
    await expect(page.getByText("Ready Lead")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Aktionen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "In Konsole übernehmen" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Konvertieren|Convert/i })).toHaveCount(0);
  });

  test("active console lead rows open the wizard while Details opens the audit sheet", async ({
    page,
  }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    await page.goto("/leads");

    const readyRow = page.getByRole("row").filter({ hasText: "Ready Lead" });
    await readyRow.click();

    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await expect(wizard).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`lead=${leadId}.*view=wizard`));
    await expect(page.getByRole("button", { name: "Bearbeiten", exact: true })).toHaveCount(0);

    await wizard.getByRole("button", { name: "Lead-Details" }).click();
    await expect(page.getByRole("button", { name: "Bearbeiten", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`lead=${leadId}(?!.*view=wizard)`));
    await expect(wizard).toBeHidden();
  });

  test("wizard header archives a lead that does not belong to the service", async ({ page }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    await page.goto("/leads");
    await page.getByRole("row").filter({ hasText: "Ready Lead" }).click();

    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await wizard.getByRole("button", { name: "Lead archivieren" }).click();
    const confirmation = page.getByRole("dialog", { name: "Lead archivieren?" });
    await expect(confirmation).toBeVisible();

    const archiveRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().endsWith(`/api/v1/leads/${leadId}/failed-flow`),
    );
    await confirmation.getByRole("button", { name: "Archivieren", exact: true }).click();
    const request = await archiveRequest;
    expect(request.postDataJSON()).toEqual({
      resolution: "archive",
      reason: "not_our_lead",
    });
    await expect(wizard).toBeHidden();
    await expect(page.getByText("Lead archiviert.")).toBeVisible();
  });

  test("intake lead rows open details and promotion continues directly in the wizard", async ({
    page,
  }) => {
    const leadId = "00000000-0000-0000-0000-000000000901";
    await page.goto("/leads");

    const intakeRow = page.getByRole("row").filter({ hasText: "Blocked Lead" });
    await intakeRow.click();
    await expect(page.getByRole("button", { name: "Bearbeiten", exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`lead=${leadId}(?!.*view=wizard)`));
    await expect(page.getByRole("dialog", { name: "Lead-Aufnahme" })).toBeHidden();

    await page.getByRole("button", { name: "In Konsole übernehmen" }).last().click();
    await expect(page.getByRole("dialog", { name: "Lead-Aufnahme" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`lead=${leadId}.*view=wizard`));
    await expect(page.getByRole("button", { name: "Bearbeiten", exact: true })).toHaveCount(0);
  });

  test("wizard renders six onboarding stages and catalog-backed specialties", async ({
    page,
  }) => {
    const readyLeadId = "00000000-0000-0000-0000-000000000902";
    await page.goto(`/leads?lead=${readyLeadId}`);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();

    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await expect(wizard).toBeVisible();
    const [wizardBox, viewport] = await Promise.all([
      wizard.boundingBox(),
      page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })),
    ]);
    expect(wizardBox).not.toBeNull();
    expect(Math.abs((wizardBox?.x ?? 0) + (wizardBox?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs((wizardBox?.y ?? 0) + (wizardBox?.height ?? 0) / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);
    const navigation = wizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" });
    await expect(navigation.getByRole("button")).toHaveCount(6);
    await expect(wizard.getByText("Fragebogen", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Eingangskanal", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Formulartyp", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Website-Assistent", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Russisch (ru)", { exact: true })).toBeVisible();
    await expect(wizard.getByRole("textbox", { name: "WhatsApp" })).toHaveValue("+49 30 100002");
    await expect(
      wizard.getByText("Ein Patient wird erst nach der finalen Freigabe angelegt."),
    ).toHaveCount(0);
    await expect(wizard.getByRole("button", { name: "Patient anlegen" })).toHaveCount(0);
    await expect(wizard.getByRole("button", { name: "Zurück", exact: true })).toHaveCount(0);
    await expect(wizard.getByRole("button", { name: "Weiter", exact: true })).toHaveCount(0);

    await navigation.getByRole("button", { name: /Medizinische Merkmale/i }).click();
    await expect(wizard.getByText("Krankenversicherung vorhanden", { exact: true })).toBeVisible();
    await wizard.getByRole("textbox", { name: "Aktuelle Anamnese" }).fill("Beschwerden seit drei Wochen");
    await wizard.getByRole("button", { name: "Hinzufügen" }).nth(0).click();
    await wizard.getByRole("textbox", { name: "Diagnose", exact: true }).fill("Gonarthrose");
    await wizard.getByRole("button", { name: "Hinzufügen" }).nth(1).click();
    await wizard.getByRole("textbox", { name: "Handelsname" }).fill("Ibuprofen");
    await wizard.getByRole("combobox", { name: "Einnahmeform" }).click();
    await page.getByText("Oral / Per os (p.o.)", { exact: true }).click();
    await wizard.getByRole("textbox", { name: "Morgens" }).fill("1");
    await wizard.getByRole("checkbox", { name: "Apothekenpflichtig" }).check();
    await wizard.getByRole("button", { name: "Hinzufügen" }).nth(2).click();
    await wizard.getByRole("textbox", { name: "Allergen", exact: true }).fill("Penicillin");
    const diagnosisRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/vorerkrankungen"));
    const allergyRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/allergien"));
    const medicationRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/medikamente"));
    const clinicalDraftRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || !request.url().endsWith(`/leads/${readyLeadId}/update`)) return false;
      const payload = request.postDataJSON() as { wizard_state?: { clinical_draft?: { medications?: Array<{ name?: string }> } } };
      return payload.wizard_state?.clinical_draft?.medications?.[0]?.name === "Ibuprofen";
    });
    await navigation.getByRole("button", { name: /Servicehistorie/i }).click();
    expect((await diagnosisRequest).postDataJSON()).toMatchObject({ items: [{ erkrankung: "Gonarthrose" }] });
    expect((await allergyRequest).postDataJSON()).toMatchObject({ items: [{ allergie: "Penicillin" }] });
    expect((await medicationRequest).postDataJSON()).toMatchObject({ items: [{ handelsname: "Ibuprofen", med_typ: "permanent" }] });
    expect((await clinicalDraftRequest).postDataJSON()).toMatchObject({
      wizard_state: {
        clinical_draft: {
          medications: [{ name: "Ibuprofen", route: "Oral", doseMorning: "1", pharmacyOnly: true }],
        },
      },
    });

    await expect(navigation.getByRole("button", { name: /Servicehistorie/i })).toHaveAttribute("aria-current", "step");
    await expect(wizard.getByText("Anliegen und Fachrichtungen")).toHaveCount(0);
    await expect(
      wizard.getByText("Wählen Sie die passenden Fachrichtungen aus dem Verzeichnis aus."),
    ).toHaveCount(0);
    await expect(wizard.getByText("Kundennachricht", { exact: true })).toBeVisible();
    await expect(
      wizard.getByText("Please coordinate an orthopedic consultation and airport transfer.", { exact: true }),
    ).toBeVisible();
    await expect(wizard.getByText("Unbekannter Wert", { exact: true })).toHaveCount(0);
    for (const serviceLabel of [
      "Limousinenservice und privater Fahrer",
      "Concierge-Services",
      "Bodengebundener medizinischer Transport",
      "Ambulanzflug",
      "Business Jet / Privatflugzeug",
      "Keinen der genannten Services",
      "Ich bin mir noch nicht sicher",
    ]) {
      await expect(wizard.getByRole("checkbox", { name: serviceLabel, exact: true })).toBeVisible();
    }
    await expect(
      wizard.getByRole("checkbox", { name: "Medizinische Behandlung", exact: true }),
    ).toBeChecked();
    const serviceCommentRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || !request.url().endsWith(`/leads/${readyLeadId}/update`)) return false;
      const payload = request.postDataJSON() as {
        wizard_state?: { service_comments?: Record<string, string> };
      };
      return payload.wizard_state?.service_comments?.driver === "Abholung am Flughafen BER um 14:30";
    });
    await wizard
      .getByRole("checkbox", { name: "Limousinenservice und privater Fahrer", exact: true })
      .check();
    const driverComment = wizard.getByRole("textbox", {
      name: "Kommentar zur Leistung: Limousinenservice und privater Fahrer",
    });
    await expect(driverComment).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await driverComment.fill("Abholung am Flughafen BER um 14:30");
    expect((await serviceCommentRequest).postDataJSON()).toMatchObject({
      services: expect.arrayContaining(["driver"]),
      wizard_state: {
        service_comments: {
          driver: "Abholung am Flughafen BER um 14:30",
        },
      },
    });
    await wizard.getByRole("textbox", { name: "Anliegen", exact: true }).fill("Orthopädische Beratung");
    await expect(
      wizard.getByRole("textbox", { name: "Wie sind Sie auf uns aufmerksam geworden?" }),
    ).toBeVisible();
    const specialtySelect = wizard.getByRole("combobox");
    await specialtySelect.click();
    await expect(page.getByText("Orthopädie", { exact: true })).toBeVisible();
    await page.getByText("Orthopädie", { exact: true }).click();
    const selectedSpecialty = wizard.getByText("Orthopädie", { exact: true });
    await expect(selectedSpecialty).toBeVisible();
    const [specialtySelectBox, selectedSpecialtyBox] = await Promise.all([
      specialtySelect.boundingBox(),
      selectedSpecialty.boundingBox(),
    ]);
    expect((selectedSpecialtyBox?.y ?? 0)).toBeGreaterThan(
      (specialtySelectBox?.y ?? 0) + (specialtySelectBox?.height ?? 0),
    );

    await expect(wizard.getByRole("button", { name: "Angaben bestätigen" })).toHaveCount(0);
    await navigation.getByRole("button", { name: /Unterlagen/i }).click();
    await expect(wizard.getByText("Ausweisdokument")).toBeVisible();
    await expect(wizard.getByText("Datenschutzeinwilligung (DSGVO)")).toBeVisible();
    await expect(
      wizard.getByText("Einwilligung zur Kontaktaufnahme per WhatsApp", { exact: true }),
    ).toBeVisible();
    await expect(wizard.getByText("Unterlagen und Anamnese vervollständigen")).toHaveCount(0);
    await expect(wizard.getByRole("button", { name: "Anamnese abschließen" })).toHaveCount(0);
    const intakeCompletionRequest = page.waitForRequest((request) =>
      request.method() === "POST" && request.url().endsWith("/intake-completion"),
    );
    const qualificationRequest = page.waitForRequest((request) =>
      request.method() === "POST" && request.url().endsWith(`/leads/${readyLeadId}/qualify`),
    );
    await navigation.getByRole("button", { name: /Vertrag & Angebot/i }).click();
    const intakeRequest = await intakeCompletionRequest;
    expect(intakeRequest.postDataJSON()).toEqual({
      completed: true,
      hauptanfragegrund: "Orthopädische Beratung",
      aktuelle_anamnese: "Beschwerden seit drei Wochen",
    });
    expect((await qualificationRequest).postDataJSON()).toEqual({ status: "qualified" });
    await expect(wizard.getByText("Vertrag, Auftrag und Kostenvoranschlag")).toBeVisible();
    await expect(
      wizard.getByText("Diese Unterlagen gehören bis zur Freigabe dem Lead."),
    ).toHaveCount(0);
    await expect(
      wizard.getByRole("combobox", { name: "Leistung aus dem Katalog auswählen" }),
    ).toBeVisible();
    await expect(wizard.getByText("Kundenbedarf", { exact: true })).toBeVisible();
  });

  test("healthcare consent makes the complete address required", async ({ page }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    await page.goto(`/leads?lead=${leadId}`);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();

    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    const navigation = wizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" });
    const consentName = "Einwilligung zur Verarbeitung von Gesundheitsdaten liegt vor";

    await navigation.getByRole("button", { name: /Unterlagen/i }).click();
    const healthcareConsent = wizard.getByRole("checkbox", { name: consentName });
    await expect(healthcareConsent).toBeChecked();
    const consentRemovedRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || !request.url().endsWith(`/leads/${leadId}/update`)) return false;
      return (request.postDataJSON() as { consent_healthcare?: boolean }).consent_healthcare === false;
    });
    await healthcareConsent.uncheck();
    await consentRemovedRequest;

    await navigation.getByRole("button", { name: /Personendaten/i }).click();
    const street = wizard.locator('input[name="street_address"]');
    const city = wizard.locator('input[name="city"]');
    const postalCode = wizard.locator('input[name="postal_code"]');
    await street.fill("");
    await city.fill("");
    await postalCode.fill("");
    await expect(street).not.toHaveAttribute("required", "");
    await expect(city).not.toHaveAttribute("required", "");
    await expect(postalCode).not.toHaveAttribute("required", "");

    await navigation.getByRole("button", { name: /Unterlagen/i }).click();
    const consentGrantedRequest = page.waitForRequest((request) => {
      if (request.method() !== "POST" || !request.url().endsWith(`/leads/${leadId}/update`)) return false;
      return (request.postDataJSON() as { consent_healthcare?: boolean }).consent_healthcare === true;
    });
    await wizard.getByRole("checkbox", { name: consentName }).check();
    await consentGrantedRequest;

    await navigation.getByRole("button", { name: /Vertrag & Angebot/i }).click();
    await expect(navigation.getByRole("button", { name: /Personendaten/i })).toHaveAttribute("aria-current", "step");
    await expect(street).toHaveAttribute("required", "");
    await expect(city).toHaveAttribute("required", "");
    await expect(postalCode).toHaveAttribute("required", "");
    await navigation.getByRole("button", { name: /Medizinische Merkmale/i }).click();
    await expect(street).toBeFocused();
    await expect(wizard.getByText("Pflichtfeld", { exact: true }).first()).toBeVisible();
  });

  test("wizard autosave avoids redundant reloads and clinical writes", async ({ page }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    await page.goto(`/leads?lead=${leadId}`);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();

    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await expect(wizard.locator('input[name="first_name"]')).toBeVisible();
    const navigation = wizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" });
    const repeatedReads: string[] = [];
    const clinicalWrites: string[] = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, "");
      if (request.method() === "GET" && (
        path === `/leads/${leadId}`
        || path.startsWith("/documents")
        || path.startsWith("/cases?")
        || path.startsWith("/framework-contracts")
        || path.startsWith("/orders")
        || path.startsWith("/quotes")
        || path.startsWith("/providers/specializations")
        || path.startsWith("/agency-services")
        || path === "/cases/meta/doctors"
      )) {
        repeatedReads.push(path);
      }
      if (request.method() === "POST" && (
        path === "/cases"
        || path.endsWith("/anamnesis")
        || path.endsWith("/vorerkrankungen")
        || path.endsWith("/allergien")
        || path.endsWith("/medikamente")
      )) {
        clinicalWrites.push(path);
      }
    });

    await navigation.getByRole("button", { name: /Medizinische Merkmale/i }).click();
    await expect(wizard.getByRole("textbox", { name: "Aktuelle Anamnese" })).toBeVisible();
    await page.waitForTimeout(150);
    expect(repeatedReads).toEqual([]);

    const medicalAutosave = page.waitForRequest((request) => {
      if (request.method() !== "POST" || !request.url().endsWith(`/leads/${leadId}/update`)) return false;
      return (request.postDataJSON() as { additional_concerns?: string }).additional_concerns
        === "Performance-Test Anamnese";
    });
    await wizard
      .getByRole("textbox", { name: "Aktuelle Anamnese" })
      .fill("Performance-Test Anamnese");
    const medicalAutosaveRequest = await medicalAutosave;
    expect(medicalAutosaveRequest.postDataJSON()).toMatchObject({
      additional_concerns: "Performance-Test Anamnese",
    });
    expect((await medicalAutosaveRequest.response())?.ok()).toBe(true);
    await page.waitForTimeout(250);
    expect(clinicalWrites).toEqual([]);

    await wizard.getByRole("button", { name: "Schließen" }).click();
    await expect(wizard).toBeHidden();
    await page.getByRole("row").filter({ hasText: "Ready Lead" }).click();
    const reopenedWizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await reopenedWizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" })
      .getByRole("button", { name: /Medizinische Merkmale/i })
      .click();
    await expect(reopenedWizard.getByRole("textbox", { name: "Aktuelle Anamnese" }))
      .toHaveValue("Performance-Test Anamnese");
  });

  test("wizard uses clear Russian copy across all stages", async ({ page }) => {
    await page.goto("/leads");
    await page.getByRole("button", { name: "Sprache wechseln" }).click();
    await page.getByRole("row").filter({ hasText: "Ready Lead" }).click();

    const wizard = page.getByRole("dialog", { name: "Оформление обращения" });
    const navigation = wizard.getByRole("navigation", { name: "Этапы оформления" });
    await expect(navigation.getByRole("button", { name: /Данные клиента/i })).toBeVisible();
    await expect(wizard.getByText("Канал поступления", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Тип формы", { exact: true })).toBeVisible();

    await navigation.getByRole("button", { name: /Медицинская характеристика/i }).click();
    await wizard.getByRole("textbox", { name: "Анамнез" }).fill("Жалобы в течение трёх недель");
    await navigation.getByRole("button", { name: /Сервисная история/i }).click();

    await expect(navigation.getByRole("button", { name: /Сервисная история/i })).toHaveAttribute("aria-current", "step");
    await expect(wizard.getByText("Причина обращения и специализации")).toHaveCount(0);
    await expect(wizard.getByText("Выберите подходящие специализации из справочника.")).toHaveCount(0);
    await expect(wizard.getByText("Данные обращения подтверждены")).toHaveCount(0);
    await wizard.getByRole("textbox", { name: "Причина обращения" }).fill("Консультация ортопеда");
    await wizard.getByRole("combobox").click();
    await page.getByText("Ортопедия", { exact: true }).click();

    await navigation.getByRole("button", { name: /Документы/i }).click();
    await expect(wizard.getByText("Документ, удостоверяющий личность")).toBeVisible();
    await expect(wizard.getByText("Согласие на обработку персональных данных")).toBeVisible();
    await expect(wizard.getByText("Заполните документы и анамнез")).toHaveCount(0);
    await expect(wizard.getByRole("button", { name: "Сохранить анамнез" })).toHaveCount(0);
    await navigation.getByRole("button", { name: /Договор и смета/i }).click();
    await expect(wizard.getByRole("heading", { name: "Договор, заказ и смета" })).toBeVisible();
    await expect(wizard.getByText(/кошторис/i)).toHaveCount(0);
    await expect(navigation.getByRole("button", { name: /Создание пациента/i })).toBeVisible();
  });

  test("wizard lists uploaded lead files and deletes them with an audit reason", async ({
    page,
  }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    const leadDocumentId = "00000000-0000-0000-0000-000000000972";
    let fileActive = true;

    await page.route(`**/api/v1/documents?lead_id=${leadId}`, (route) =>
      json(route, fileActive ? [{
        id: leadDocumentId,
        lead_id: leadId,
        patient_id: null,
        auto_name: "Identity document",
        original_filename: "passport-alfred.pdf",
        art: "identity",
        category: "identity",
        status: "active",
        visibility: "internal",
        mime_type: "application/pdf",
        file_size: 2 * 1024 * 1024,
        has_stored_file: true,
        compliance_kind: null,
        signed_at: null,
        file_deleted_at: null,
      }] : []),
    );
    await page.route(`**/api/v1/documents/${leadDocumentId}/delete`, (route) => {
      const payload = route.request().postDataJSON() as { reason?: string };
      fileActive = false;
      return json(route, {
        ok: true,
        document: {
          id: leadDocumentId,
          has_stored_file: false,
          status: "archived",
          file_deleted_at: "2026-07-11T11:30:00Z",
          file_delete_reason: payload.reason ?? null,
        },
      });
    });

    await page.goto(`/leads?lead=${leadId}`);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await wizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" })
      .getByRole("button", { name: /Unterlagen/i })
      .click();

    await expect(wizard.getByText("passport-alfred.pdf", { exact: true })).toBeVisible();
    await expect(wizard.getByText("2 MB", { exact: true })).toBeVisible();
    await expect(wizard.getByText("Nicht bestätigt", { exact: true })).toBeVisible();

    await wizard.getByRole("button", { name: "Datei löschen" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Datei löschen?" });
    await expect(deleteDialog.getByText("passport-alfred.pdf", { exact: true })).toBeVisible();
    await deleteDialog.getByRole("textbox", { name: "Löschgrund" }).fill("Falsches Dokument");
    const deleteRequest = page.waitForRequest((request) =>
      request.method() === "POST" &&
      request.url().endsWith(`/api/v1/documents/${leadDocumentId}/delete`),
    );
    await deleteDialog.getByRole("button", { name: "Datei löschen", exact: true }).click();
    expect((await deleteRequest).postDataJSON()).toEqual({ reason: "Falsches Dokument" });

    await expect(deleteDialog).toBeHidden();
    await expect(wizard.getByText("passport-alfred.pdf", { exact: true })).toHaveCount(0);
    await expect(wizard.getByText("Keine Dateien hinzugefügt").first()).toBeVisible();
  });

  test("final release reflects server readiness and does not expose an early conversion", async ({
    page,
  }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    await page.route("**/api/v1/leads/" + leadId, (route) =>
      json(route, {
        id: leadId,
        first_name: "Ready",
        last_name: "Lead",
        email: "ready.lead@example.com",
        phone: "+49 30 100002",
        country: "DE",
        street_address: "Hauptstr. 1",
        city: "Berlin",
        zip_code: "10115",
        qualification_status: "qualified",
        compliance_status: "signed",
        date_of_birth: "1990-01-01",
        legal_sex: "female",
        requested_specialties: ["orthopedics"],
        services: [],
        consent_healthcare: true,
        consent_privacy_practices: true,
        attachments: [],
        failed_outcome: { status: "none", reason: null, processed_at: null },
        readiness: {
          qualification_ready: true,
          conversion_ready: false,
          qualification_reasons: [],
          blocking_reasons: ["Signed DSGVO document is missing"],
          checks: [],
          steps: [
            { key: "master_data", label: "Stammdaten", ready: true },
            { key: "medical", label: "Medizinische Merkmale", ready: true },
            { key: "service", label: "Servicehistorie", ready: true },
            { key: "documents", label: "Unterlagen", ready: false },
            { key: "commercial", label: "Vertrag & Auftrag", ready: false },
            { key: "release", label: "Freigabe", ready: false },
          ],
        },
        lifecycle: {
          current_stage: "qualified",
          stage_entered_at: null,
          can_convert: false,
          can_resolve_failed: true,
          history: [],
        },
        wizard_state: { step: "master_data" },
      }),
    );

    await page.goto("/leads?lead=" + leadId);
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    await wizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" })
      .getByRole("button", { name: /Freigabe/i })
      .click();

    await expect(wizard.getByText("Was noch fehlt")).toBeVisible();
    await expect(wizard.getByText("Datenschutzeinwilligung hochladen und bestätigen")).toBeVisible();
    await expect(wizard.getByRole("button", { name: "Patient anlegen" })).toBeDisabled();
  });
});

test.describe("responsive staff workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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

  test("keeps the workspace usable and switches appointments to the compact agenda", async ({
    page,
  }) => {
    await page.goto("/leads");

    await expect.poll(async () => (await page.locator("main").boundingBox())?.width ?? 0)
      .toBeGreaterThan(340);
    const viewport = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth);

    await page.getByRole("button", { name: "Benachrichtigungen" }).click();
    const notificationPanel = page
      .getByRole("heading", { name: "Benachrichtigungen", exact: true })
      .locator("xpath=../..");
    await expect(notificationPanel).toBeVisible();
    const notificationPanelBox = await notificationPanel.boundingBox();
    expect(notificationPanelBox?.x).toBeGreaterThanOrEqual(0);
    expect((notificationPanelBox?.x ?? 0) + (notificationPanelBox?.width ?? 0))
      .toBeLessThanOrEqual(viewport.clientWidth);

    await page.goto("/appointments");
    await expect(page.getByRole("button", { name: "Patienten heute", exact: true })).toBeVisible();
    await expect(page.locator(".appointments-calendar-shell")).toHaveCount(0);
  });

  test("keeps onboarding steps labeled, localized, and reachable on mobile", async ({ page }) => {
    const leadId = "00000000-0000-0000-0000-000000000902";
    await page.goto("/leads");
    const readyRow = page.getByRole("row").filter({ hasText: "Ready Lead" });
    const readyLeadCell = readyRow.getByText("Ready Lead", { exact: true });
    await readyLeadCell.click();

    const wizard = page.getByRole("dialog", { name: "Lead-Aufnahme" });
    const navigation = wizard.getByRole("navigation", { name: "Schritte der Lead-Aufnahme" });
    await expect(navigation.getByRole("button", { name: /Personendaten/i })).toBeVisible();
    const wizardBox = await wizard.boundingBox();
    expect(wizardBox).not.toBeNull();
    expect(wizardBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((wizardBox?.x ?? 0) + (wizardBox?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(wizardBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((wizardBox?.y ?? 0) + (wizardBox?.height ?? 0)).toBeLessThanOrEqual(844);
    let leadListRefreshes = 0;
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === "/api/v1/leads"
      ) {
        leadListRefreshes += 1;
      }
    });

    const refreshButton = wizard.getByRole("button", { name: "Aktualisieren" });
    const closeButton = wizard.getByRole("button", { name: "Schließen" });
    const refreshBox = await refreshButton.boundingBox();
    const closeBox = await closeButton.boundingBox();
    expect(refreshBox).not.toBeNull();
    expect(closeBox).not.toBeNull();
    expect((refreshBox?.x ?? 0) + (refreshBox?.width ?? 0)).toBeLessThanOrEqual(
      closeBox?.x ?? 0,
    );

    const firstNameInput = wizard.locator('input[name="first_name"]');
    await firstNameInput.fill("");
    await firstNameInput.blur();
    await expect(wizard.getByText("Pflichtfeld", { exact: true }).first()).toBeVisible();
    await expect(wizard.getByText("Pflichtfelder ausfüllen", { exact: true })).toHaveCount(0);
    await navigation.getByRole("button", { name: /Medizinische Merkmale/i }).click();
    await expect(firstNameInput).toBeFocused();

    const autosaveRequest = page.waitForRequest((request) => {
      if (
        request.method() !== "POST" ||
        !request.url().endsWith(`/api/v1/leads/${leadId}/update`)
      ) {
        return false;
      }
      const payload = request.postDataJSON() as Record<string, unknown>;
      return payload.first_name === "Ready Autosaved";
    });
    await firstNameInput.fill("Ready Autosaved");
    const request = await autosaveRequest;
    expect(request.postDataJSON()).toMatchObject({
      first_name: "Ready Autosaved",
      wizard_state: {
        step: "master_data",
        commercial_draft: {
          lines: expect.any(Array),
        },
      },
    });
    expect((await request.response())?.ok()).toBe(true);
    await expect(wizard.getByText("Änderungen gespeichert", { exact: true })).toHaveCount(0);
    await page.evaluate((entityId) => {
      window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
        detail: {
          type: "lead.updated",
          entity_type: "lead",
          entity_id: entityId,
        },
      }));
    }, leadId);
    await page.waitForTimeout(400);
    expect(leadListRefreshes).toBe(0);

    await closeButton.click();
    await expect(wizard).toBeHidden();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect.poll(() => leadListRefreshes).toBeGreaterThan(0);
    await readyLeadCell.click();
    await expect(wizard.locator('input[name="first_name"]')).toHaveValue(
      "Ready Autosaved",
    );

    await navigation.getByRole("button", { name: /Medizinische Merkmale/i }).click();
    await wizard.getByRole("textbox", { name: "Aktuelle Anamnese" }).fill("Beschwerden seit drei Wochen");
    await navigation.getByRole("button", { name: /Servicehistorie/i }).click();
    await wizard
      .getByRole("textbox", { name: "Anliegen", exact: true })
      .fill("Orthopädische Beratung");
    await wizard.getByRole("combobox").click();
    await page.getByText("Orthopädie", { exact: true }).click();
    await expect(wizard.getByText("Orthopädie", { exact: true })).toBeVisible();

    const serviceCommentRequest = page.waitForRequest((candidate) => {
      if (
        candidate.method() !== "POST" ||
        !candidate.url().endsWith(`/api/v1/leads/${leadId}/update`)
      ) {
        return false;
      }
      const payload = candidate.postDataJSON() as {
        wizard_state?: { service_comments?: Record<string, string> };
      };
      return payload.wizard_state?.service_comments?.driver === "Abholung am BER, Terminal 1";
    });
    await wizard
      .getByRole("checkbox", { name: "Limousinenservice und privater Fahrer", exact: true })
      .check();
    await wizard
      .getByRole("textbox", {
        name: "Kommentar zur Leistung: Limousinenservice und privater Fahrer",
      })
      .fill("Abholung am BER, Terminal 1");
    expect((await serviceCommentRequest).postDataJSON()).toMatchObject({
      wizard_state: {
        service_comments: { driver: "Abholung am BER, Terminal 1" },
      },
    });

    const discoverySourceRequest = page.waitForRequest((candidate) => {
      if (
        candidate.method() !== "POST" ||
        !candidate.url().endsWith(`/api/v1/leads/${leadId}/update`)
      ) {
        return false;
      }
      const payload = candidate.postDataJSON() as {
        wizard_state?: { discovery_source?: string };
      };
      return payload.wizard_state?.discovery_source === "Empfehlung einer Freundin";
    });
    await wizard
      .getByRole("textbox", { name: "Wie sind Sie auf uns aufmerksam geworden?" })
      .fill("Empfehlung einer Freundin");
    const discoveryRequest = await discoverySourceRequest;
    expect(discoveryRequest.postDataJSON()).toMatchObject({
      wizard_state: { discovery_source: "Empfehlung einer Freundin" },
    });

    const commercialStep = navigation.getByRole("button", { name: /Vertrag & Angebot/i });
    await commercialStep.click();
    await expect(
      wizard.getByRole("heading", { name: "Vertrag, Auftrag und Kostenvoranschlag" }),
    ).toBeVisible();
    await expect.poll(async () => {
      const [navigationBox, stepBox] = await Promise.all([
        navigation.boundingBox(),
        commercialStep.boundingBox(),
      ]);
      if (!navigationBox || !stepBox) return false;
      return (
        stepBox.x >= navigationBox.x &&
        stepBox.x + stepBox.width <= navigationBox.x + navigationBox.width
      );
    }).toBe(true);

    const commercialAutosaveRequest = page.waitForRequest((candidate) => {
      if (
        candidate.method() !== "POST" ||
        !candidate.url().endsWith(`/api/v1/leads/${leadId}/update`)
      ) {
        return false;
      }
      const payload = candidate.postDataJSON() as {
        wizard_state?: {
          commercial_draft?: {
            lines?: Array<{ agency_service_id?: string; description?: string }>;
          };
        };
      };
      return payload.wizard_state?.commercial_draft?.lines?.[0]?.description ===
        "Transport coordination";
    });
    await wizard
      .getByRole("combobox", { name: "Leistung aus dem Katalog auswählen" })
      .click();
    await page.getByText("Transport coordination · 12.500,00 EUR", { exact: true }).click();
    const commercialRequest = await commercialAutosaveRequest;
    expect(commercialRequest.postDataJSON()).toMatchObject({
      wizard_state: {
        step: "commercial",
        commercial_draft: {
          lines: [
            expect.objectContaining({
              agency_service_id: "00000000-0000-0000-0000-000000000951",
              description: "Transport coordination",
              price: "12500.00",
            }),
          ],
        },
      },
    });
    expect((await commercialRequest.response())?.ok()).toBe(true);
    await expect(wizard.getByText("Änderungen gespeichert", { exact: true })).toHaveCount(0);

    await closeButton.click();
    await expect(wizard).toBeHidden();
    await readyLeadCell.click();
    await expect(wizard.getByRole("heading", { name: "Personendaten" })).toBeVisible();
    await navigation.getByRole("button", { name: /Vertrag & Angebot/i }).click();
    await expect(wizard.getByText("Transport coordination", { exact: true })).toBeVisible();
    await expect(wizard.getByText("12.500,00 EUR", { exact: false }).first()).toBeVisible();

    const contractId = "00000000-0000-0000-0000-000000000961";
    const orderId = "00000000-0000-0000-0000-000000000962";
    const quoteId = "00000000-0000-0000-0000-000000000963";
    let quoteCreated = false;
    let orderCreated = false;
    let orderCreatePayload: { needs_description?: string } | null = null;
    let signedPatient = false;
    let signedAgency = false;
    let prepaymentRequired = false;
    let commercialBasisRequests = 0;
    const commercialBasisPayloads: Array<{
      signed_patient?: boolean;
      signed_agency?: boolean;
      prepayment_required?: boolean;
    }> = [];
    let releaseCommercialBasis = () => undefined;
    const commercialBasisGate = new Promise<void>((resolve) => {
      releaseCommercialBasis = resolve;
    });
    let releaseAgencyConfirmation = () => undefined;
    const agencyConfirmationGate = new Promise<void>((resolve) => {
      releaseAgencyConfirmation = resolve;
    });
    let releaseQuoteReload = () => undefined;
    const quoteReloadGate = new Promise<void>((resolve) => {
      releaseQuoteReload = resolve;
    });

    await page.route("**/api/v1/framework-contracts", (route) => {
      if (route.request().method() === "POST") {
        return json(route, { id: contractId, status: "sent" }, 201);
      }
      return json(route, []);
    });
    await page.route("**/api/v1/orders", (route) => {
      if (route.request().method() === "POST") {
        orderCreatePayload = route.request().postDataJSON() as {
          needs_description?: string;
        };
        orderCreated = true;
        return json(route, { id: orderId }, 201);
      }
      return json(route, []);
    });
    await page.route("**/api/v1/orders?*", (route) =>
      json(route, orderCreated ? [{
        id: orderId,
        order_number: "A-20260711-0099",
        source_lead_id: leadId,
        signed_patient: signedPatient,
        signed_agency: signedAgency,
        prepayment_required: prepaymentRequired,
      }] : []),
    );
    await page.route(`**/api/v1/orders/${orderId}`, (route) =>
      json(route, {
        id: orderId,
        signed_patient: signedPatient,
        signed_agency: signedAgency,
        prepayment_required: prepaymentRequired,
        leistungen: [],
      }),
    );
    await page.route(`**/api/v1/orders/${orderId}/leistungen`, (route) =>
      json(route, { id: "00000000-0000-0000-0000-000000000964" }, 201),
    );
    await page.route(`**/api/v1/orders/${orderId}/commercial-basis`, async (route) => {
      const payload = route.request().postDataJSON() as {
        signed_patient?: boolean;
        signed_agency?: boolean;
        prepayment_required?: boolean;
      };
      commercialBasisRequests += 1;
      commercialBasisPayloads.push(payload);
      signedPatient = payload.signed_patient ?? signedPatient;
      signedAgency = payload.signed_agency ?? signedAgency;
      prepaymentRequired = payload.prepayment_required ?? prepaymentRequired;
      if (commercialBasisRequests === 1) await commercialBasisGate;
      if (payload.signed_agency === true) await agencyConfirmationGate;
      return json(route, { ok: true, order_id: orderId });
    });
    await page.route(`**/api/v1/orders/${orderId}/quotes`, (route) => {
      quoteCreated = true;
      return json(route, {
        id: quoteId,
        order_id: orderId,
        contract_id: contractId,
        patient_id: null,
        lead_id: leadId,
        quote_number: "KV-20260711-0099",
        status: "draft",
        total_net: "12500.00",
        total_vat: "2375.00",
        total_gross: "14875.00",
        valid_until: null,
        line_items: [],
        notes: null,
        version_count: 1,
        current_version_number: 1,
        created_at: "2026-07-11T09:35:31Z",
        updated_at: "2026-07-11T09:35:31Z",
      }, 201);
    });
    await page.route("**/api/v1/quotes?*", async (route) => {
      if (quoteCreated) await quoteReloadGate;
      return json(route, []);
    });

    const patientSignatureToggle = wizard.getByRole("checkbox", {
      name: "Auftrag vom Kunden unterzeichnet",
    });
    await patientSignatureToggle.check();
    await expect(patientSignatureToggle).toBeChecked();
    await expect.poll(() => commercialBasisRequests).toBe(1);
    expect(orderCreatePayload?.needs_description).toContain("Kundennachricht");
    expect(orderCreatePayload?.needs_description).toContain("Kann anreisen: Ja");
    expect(orderCreatePayload?.needs_description).toContain("Reisedokumente: Ja");
    expect(orderCreatePayload?.needs_description).toContain("Dolmetscher benötigt");
    expect(orderCreatePayload?.needs_description).toContain("Kommentare zu Leistungen");
    expect(orderCreatePayload?.needs_description).toContain(
      "Limousinenservice und privater Fahrer: Abholung am BER, Terminal 1",
    );
    releaseCommercialBasis();
    await expect(patientSignatureToggle).toBeEnabled();
    await expect(patientSignatureToggle).toBeChecked();
    expect(commercialBasisRequests).toBe(1);

    const agencyConfirmationToggle = wizard.getByRole("checkbox", {
      name: "Auftrag von der Agentur bestätigt",
    });
    await agencyConfirmationToggle.check();
    await expect(agencyConfirmationToggle).toBeChecked();
    await expect(agencyConfirmationToggle).toBeEnabled();
    await expect(
      wizard.getByRole("button", { name: "Kostenvoranschlag erstellen" }),
    ).toBeEnabled();
    await expect.poll(() => commercialBasisRequests).toBe(2);
    expect(commercialBasisPayloads[1]).toEqual({ signed_agency: true });
    releaseAgencyConfirmation();

    await wizard.getByRole("button", { name: "Kostenvoranschlag erstellen" }).click();
    await expect(
      wizard.getByText("Kostenvoranschlag erstellt, Annahme ausstehend", { exact: true }),
    ).toBeVisible();
    await expect(
      wizard.getByRole("button", { name: "Neuen Kostenvoranschlag erstellen" }),
    ).toBeEnabled();
    releaseQuoteReload();
  });
});
