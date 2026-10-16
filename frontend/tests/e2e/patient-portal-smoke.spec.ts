import { expect, test, type Page, type Route } from "@playwright/test";
import { chooseComboboxOption, pickerValueInput, startClockAt } from "./helpers";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function multipartField(body: Buffer | null, name: string) {
  if (!body) return null;
  const text = body.toString("utf8");
  const match = text.match(
    new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`, "i"),
  );
  return match?.[1]?.trim() ?? null;
}

async function installPatientPortalMocks(page: Page, patients?: Array<{ id: string; name: string; patient_number: string }>) {
  await startClockAt(page);
  let paymentProofUploadedAt: string | null = null;
  const paymentProofTimestamp = "2026-04-10T09:15:00Z";
  let nextPrivacyRequestIndex = 1;
  let nextPortalUploadIndex = 1;
  let nextAppointmentRequestIndex = 1;
  let nextServiceRequestIndex = 1;
  let privacyRequests = [
    {
      id: "00000000-0000-0000-0000-000000009801",
      request_type: "restriction",
      source: "patient_portal",
      status: "approved",
      reason: null,
      due_at: "2026-04-20T00:00:00Z",
      retention_until: null,
      requested_at: "2026-04-04T10:00:00Z",
      reviewed_at: "2026-04-05T10:00:00Z",
      executed_at: null,
    },
  ];
  let releasedDocuments = [
    {
      id: "00000000-0000-0000-0000-000000009401",
      patient_id: "00000000-0000-0000-0000-000000009001",
      order_id: null,
      appointment_id: "00000000-0000-0000-0000-000000009101",
      auto_name: "Released discharge note",
      original_filename: "discharge-note.pdf",
      art: "medical_report",
      category: "report",
      status: "active",
      visibility: "patient_visible",
      is_medical: true,
      mime_type: "application/pdf",
      file_size: 4096,
      klinik: "Clinic Cologne",
      ursprung: "provider",
      share_id: "00000000-0000-0000-0000-000000009402",
      channel: "patient_portal",
      requires_confirmation: true,
      confirmed: false,
      confirmed_at: null,
      shared_at: "2026-04-02T10:00:00Z",
      created_at: "2026-04-01T09:00:00Z",
      updated_at: "2026-04-02T10:00:00Z",
    },
  ];
  let uploadedDocuments = [
    {
      id: "00000000-0000-0000-0000-000000009403",
      patient_id: "00000000-0000-0000-0000-000000009001",
      order_id: null,
      appointment_id: null,
      order_number: null,
      appointment_title: null,
      auto_name: "Passport copy",
      original_filename: "passport.pdf",
      art: "general",
      category: "identity",
      status: "active",
      visibility: "internal",
      is_medical: false,
      mime_type: "application/pdf",
      file_size: 2048,
      klinik: null,
      ursprung: "patient_portal",
      notes: "Uploaded from portal.",
      created_at: "2026-04-03T10:00:00Z",
      updated_at: "2026-04-03T10:00:00Z",
    },
  ];
  let appointmentRequests: Array<Record<string, unknown>> = [];
  let conciergeServices = [
    {
      id: "00000000-0000-0000-0000-000000009201",
      appointment_id: "00000000-0000-0000-0000-000000009101",
      appointment_title: "Clinic follow-up",
      provider_id: "00000000-0000-0000-0000-000000009301",
      provider_name: "Clinic Cologne",
      assigned_concierge_name: "Concierge Team",
      service_kind: "transfer",
      title: "Airport transfer",
      status: "booked",
      booking_reference: "TR-001",
      vendor_name: "Transfer Vendor",
      vendor_contact: null,
      starts_at: "2026-04-20T06:00:00Z",
      ends_at: "2026-04-20T07:00:00Z",
      cost_estimate: "150.00",
      currency: "EUR",
      service_notes: null,
      request_source: "patient_portal",
      completed_at: null,
      created_at: "2026-04-01T09:00:00Z",
      updated_at: "2026-04-01T09:00:00Z",
      can_cancel: true,
    },
  ];
  const portalAppointments = [
    {
      id: "00000000-0000-0000-0000-000000009101",
      title: "Clinic follow-up",
      date: "2026-04-20",
      time_start: "09:00",
      time_end: "10:00",
      appointment_type: "medical",
      status: "confirmed",
      location: "Clinic Cologne",
      category: "followup",
      provider_name: "Clinic Cologne",
      doctor_name: "Doctor Cologne",
      created_at: "2026-04-01T09:00:00Z",
    },
  ];
  let feedbackRows = [
    {
      id: "00000000-0000-0000-0000-000000009901",
      patient_id: "00000000-0000-0000-0000-000000009001",
      appointment_id: null,
      appointment_title: null,
      provider_id: null,
      provider_name: null,
      doctor_id: null,
      doctor_name: null,
      patient_manager_id: null,
      patient_manager_name: null,
      interpreter_id: null,
      interpreter_name: null,
      concierge_id: null,
      concierge_name: null,
      source: "patient_portal",
      status: "reviewed",
      overall_score: 5,
      patient_manager_score: null,
      interpreter_score: null,
      concierge_score: null,
      treatment_score: 5,
      doctor_score: 5,
      organization_score: 5,
      service_score: 5,
      infrastructure_score: 5,
      price_value_score: 4,
      treatment_success: "yes",
      complication_reported: false,
      nps_score: 10,
      comments: "Everything clear.",
      improvement_notes: null,
      internal_note: null,
      review_note: null,
      submitted_by_name: "Anna Portal",
      reviewed_by_name: "Admin GMED",
      submitted_at: "2026-04-05T10:00:00Z",
      reviewed_at: "2026-04-06T10:00:00Z",
    },
  ];

  const buildPortalInvoice = () => ({
    id: "00000000-0000-0000-0000-000000009501",
    quote_id: "00000000-0000-0000-0000-000000009601",
    quote_number: "QU-001",
    order_id: "00000000-0000-0000-0000-000000009701",
    order_number: "ORD-PORTAL-1",
    patient_id: "00000000-0000-0000-0000-000000009001",
    invoice_number: "INV-PORTAL-1",
    invoice_type: "advance",
    status: "sent",
    issued_at: "2026-04-01T09:00:00Z",
    due_date: "2026-04-15",
    total_net: "1000.00",
    total_vat: "0.00",
    total_gross: "1000.00",
    paid_amount: "0.00",
    balance_due: "1000.00",
    paid_at: null,
    notes: "Please transfer within the due period.",
    created_at: "2026-04-01T09:00:00Z",
    updated_at: "2026-04-01T09:00:00Z",
    payment_proof_count: paymentProofUploadedAt ? 1 : 0,
    last_payment_proof_at: paymentProofUploadedAt,
  });

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
        id: "00000000-0000-0000-0000-000000009001",
        email: "patient@gmed.de",
        name: "Anna Portal",
        role: "patient",
        patients: (patients ?? [{ id: "00000000-0000-0000-0000-000000009001", name: "Anna Portal", patient_number: "P-1" }])
          .map((patient) => ({ ...patient, has_active_subscription: true })),
        created_at: "2026-01-01T00:00:00Z",
      });
    }

    if (path === "/me/appointments") {
      return json(route, portalAppointments);
    }

    if (path === "/me/appointment-requests" && route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        appointment_type?: string;
        preferred_date_from?: string;
        preferred_date_to?: string;
        preferred_time_of_day?: string;
        specialty?: string;
        location?: string;
        reason?: string;
        notes?: string;
      };
      const createdRequest = {
        id: `00000000-0000-0000-0000-0000000096${10 + nextAppointmentRequestIndex}`,
        patient_id: "00000000-0000-0000-0000-000000009001",
        requested_by: "00000000-0000-0000-0000-000000009001",
        order_id: null,
        appointment_type: payload.appointment_type ?? "medical",
        preferred_date_from: payload.preferred_date_from ?? null,
        preferred_date_to: payload.preferred_date_to ?? null,
        preferred_time_of_day: payload.preferred_time_of_day ?? "flexible",
        requested_provider_id: null,
        requested_provider_name: null,
        requested_doctor_id: null,
        requested_doctor_name: null,
        specialty: payload.specialty ?? null,
        location: payload.location ?? null,
        reason: payload.reason ?? null,
        notes: payload.notes ?? null,
        status: "requested",
        review_note: null,
        reviewed_at: null,
        requested_at: `2026-04-1${nextAppointmentRequestIndex}T13:00:00Z`,
        converted_appointment_id: null,
        converted_appointment_title: null,
        converted_appointment_date: null,
      };
      nextAppointmentRequestIndex += 1;
      appointmentRequests = [createdRequest, ...appointmentRequests];
      return json(route, createdRequest, 201);
    }

    if (path === "/me/appointment-requests") {
      return json(route, appointmentRequests);
    }

    if (path === "/me/followup-milestones") {
      return json(route, []);
    }

    if (path === "/me/concierge-services" && route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        service_kind?: string;
        title?: string;
        vendor_name?: string;
        vendor_contact?: string;
        starts_at?: string;
        ends_at?: string;
        cost_estimate?: number;
        service_notes?: string;
      };
      const createdService = {
        id: `00000000-0000-0000-0000-0000000092${10 + nextServiceRequestIndex}`,
        appointment_id: null,
        appointment_title: null,
        provider_id: null,
        provider_name: null,
        assigned_concierge_name: null,
        service_kind: payload.service_kind ?? "hotel",
        title: payload.title ?? `Portal request ${nextServiceRequestIndex}`,
        status: "pending",
        booking_reference: null,
        vendor_name: payload.vendor_name ?? null,
        vendor_contact: payload.vendor_contact ?? null,
        starts_at: payload.starts_at ?? null,
        ends_at: payload.ends_at ?? null,
        cost_estimate:
          payload.cost_estimate !== undefined ? String(payload.cost_estimate.toFixed(2)) : null,
        currency: "EUR",
        service_notes: payload.service_notes ?? null,
        request_source: "patient_portal",
        completed_at: null,
        created_at: `2026-04-1${nextServiceRequestIndex}T14:00:00Z`,
        updated_at: `2026-04-1${nextServiceRequestIndex}T14:00:00Z`,
        can_cancel: true,
      };
      nextServiceRequestIndex += 1;
      conciergeServices = [createdService, ...conciergeServices];
      return json(route, createdService, 201);
    }

    if (path === "/me/concierge-services") {
      return json(route, conciergeServices);
    }

    if (
      path.startsWith("/me/concierge-services/") &&
      path.endsWith("/cancel") &&
      route.request().method() === "POST"
    ) {
      const serviceId = path
        .replace("/me/concierge-services/", "")
        .replace("/cancel", "");
      conciergeServices = conciergeServices.map((item) =>
        item.id === serviceId
          ? {
              ...item,
              status: "cancelled",
              can_cancel: false,
              updated_at: "2026-04-13T15:30:00Z",
            }
          : item,
      );
      return json(route, { ok: true });
    }

    if (path === "/me/documents") {
      if (patients) {
        const selected = patients.find((patient) => patient.id === route.request().headers()["x-patient-id"]);
        if (!selected) return json(route, { message: "Select patient" }, 409);
        return json(route, releasedDocuments.map((document) => ({ ...document, patient_id: selected.id, auto_name: `Report for ${selected.name}` })));
      }
      return json(route, releasedDocuments);
    }

    if (
      path === "/me/documents/00000000-0000-0000-0000-000000009401/confirm" &&
      route.request().method() === "POST"
    ) {
      releasedDocuments = releasedDocuments.map((item) =>
        item.id === "00000000-0000-0000-0000-000000009401"
          ? {
              ...item,
              confirmed: true,
              confirmed_at: "2026-04-13T12:00:00Z",
            }
          : item,
      );
      return json(route, { ok: true });
    }

    if (path === "/me/documents/uploads") {
      return json(route, uploadedDocuments);
    }

    if (path === "/me/document-alerts") {
      return json(route, {
        configured_rule_count: 2,
        document_pack_complete: false,
        stored_document_pack_complete: false,
        out_of_sync: false,
        required_documents: [
          {
            key: "passport",
            label: "Passport",
            fulfilled: true,
            matching_documents: [
              {
                id: "00000000-0000-0000-0000-000000009403",
                filename: "passport.pdf",
                art: "general",
                category: "identity",
                status: "active",
              },
            ],
          },
          {
            key: "insurance",
            label: "Insurance card",
            fulfilled: false,
            matching_documents: [],
          },
        ],
        missing_documents: [{ key: "insurance", label: "Insurance card" }],
        missing_count: 1,
      });
    }

    if (path === "/me/invoices") {
      return json(route, [buildPortalInvoice()]);
    }

    if (path === "/me/subscriptions") {
      return json(route, { items: [], total: 0 });
    }

    if (path === "/me/account-statement") {
      return json(route, {
        patient_id: "00000000-0000-0000-0000-000000009001",
        currency: "EUR",
        available_currencies: ["EUR"],
        scope: "patient_portal",
        amounts_complete: true,
        summary: {
          invoiced_gross: "1000.00",
          cash_paid: "0.00",
          prepayment_applied: "0.00",
          available_prepayment: "0.00",
          invoice_due: "1000.00",
          external_receivable: null,
          total_due: "1000.00",
          reconciliation_required: false,
          opening_balance: "0.00",
          debit_total: "1000.00",
          credit_total: "0.00",
          calculated_balance: "1000.00",
          closing_balance: "1000.00",
          balance_side: "debit",
          unreconciled_external_debit: "0.00",
        },
        redaction: {
          hidden_invoice_amount_count: 0,
          external_expense_count: 0,
          services_hidden: true,
        },
        movements: [],
        items: [],
      });
    }

    if (path === "/me/invoices/00000000-0000-0000-0000-000000009501") {
      return json(route, {
        ...buildPortalInvoice(),
        line_items: [
          {
            description: "Treatment package",
            quantity: "1.00",
            unit_price: "1000.00",
            vat_rate: "0.00",
            is_cost_passthrough: false,
            line_net: "1000.00",
            line_vat: "0.00",
            line_gross: "1000.00",
            notes: null,
          },
        ],
      });
    }

    if (path === "/me/invoices/00000000-0000-0000-0000-000000009501/payments") {
      return json(route, { items: [] });
    }

    if (path === "/me/invoices/00000000-0000-0000-0000-000000009501/credit-notes") {
      return json(route, { items: [] });
    }

    if (path === "/me/invoices/00000000-0000-0000-0000-000000009501/refunds") {
      return json(route, { items: [] });
    }

    if (path === "/me/documents/upload" && route.request().method() === "POST") {
      const body = route.request().postDataBuffer();
      const uploadKind = multipartField(body, "upload_kind");

      if (uploadKind === "payment_proof") {
        paymentProofUploadedAt = paymentProofTimestamp;
        return json(route, { ok: true });
      }

      const autoName =
        multipartField(body, "auto_name") || `Portal upload ${nextPortalUploadIndex}`;
      const notes = multipartField(body, "notes");
      const createdAt = `2026-04-1${nextPortalUploadIndex}T11:00:00Z`;
      const createdUpload = {
        id: `00000000-0000-0000-0000-0000000094${10 + nextPortalUploadIndex}`,
        patient_id: "00000000-0000-0000-0000-000000009001",
        order_id: null,
        appointment_id: null,
        order_number: null,
        appointment_title: null,
        auto_name: autoName,
        original_filename: "portal-upload.pdf",
        // As the server stores them (parse_patient_upload_preset).
        art: uploadKind === "identity_document" ? "passport_scan" : uploadKind || "general",
        category:
          uploadKind === "insurance_document"
            ? "insurance"
            : uploadKind === "identity_document"
              ? "identity"
              : "general",
        status: "active",
        visibility: "internal",
        is_medical: uploadKind === "medical_record",
        mime_type: "application/pdf",
        file_size: 3072,
        klinik: null,
        ursprung: "patient_portal",
        notes,
        created_at: createdAt,
        updated_at: createdAt,
      };
      nextPortalUploadIndex += 1;
      uploadedDocuments = [createdUpload, ...uploadedDocuments];
      return json(route, { ok: true });
    }

    if (path === "/me/documents/00000000-0000-0000-0000-000000009401/download") {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4 released-document"),
      });
    }

    if (path.startsWith("/me/documents/uploads/") && path.endsWith("/download")) {
      return route.fulfill({
        status: 200,
        contentType: "application/pdf",
        body: Buffer.from("%PDF-1.4 uploaded-document"),
      });
    }

    if (path === "/me/export") {
      return route.fulfill({
        status: 200,
        contentType: "application/zip",
        headers: {
          "content-disposition": 'attachment; filename="patient-export-2026-04-13.zip"',
        },
        body: Buffer.from("PK\x03\x04playwright-portal-export"),
      });
    }

    if (path === "/me/privacy-requests" && route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        request_type?: string;
        reason?: string | null;
      };
      const created = {
        id: `00000000-0000-0000-0000-0000000098${10 + nextPrivacyRequestIndex}`,
        request_type: payload.request_type ?? "restriction",
        source: "patient_portal",
        status: "submitted",
        reason: payload.reason ?? null,
        due_at: "2026-04-27T00:00:00Z",
        retention_until: null,
        requested_at: `2026-04-1${nextPrivacyRequestIndex}T12:00:00Z`,
        reviewed_at: null,
        executed_at: null,
      };
      nextPrivacyRequestIndex += 1;
      privacyRequests = [created, ...privacyRequests];
      return json(route, created, 201);
    }

    if (path === "/me/privacy-requests") {
      return json(route, privacyRequests);
    }

    if (path === "/me/feedback" && route.request().method() === "POST") {
      const payload = JSON.parse(route.request().postData() ?? "{}") as {
        appointment_id?: string | null;
        overall_score?: number;
        patient_manager_score?: number | null;
        interpreter_score?: number | null;
        concierge_score?: number | null;
        treatment_score?: number | null;
        doctor_score?: number | null;
        organization_score?: number | null;
        service_score?: number | null;
        infrastructure_score?: number | null;
        price_value_score?: number | null;
        treatment_success?: string | null;
        complication_reported?: boolean;
        nps_score?: number;
        comments?: string | null;
        improvement_notes?: string | null;
      };
      const linkedAppointment =
        portalAppointments.find((item) => item.id === payload.appointment_id) ?? null;
      const createdFeedback = {
        id: `00000000-0000-0000-0000-0000000099${10 + feedbackRows.length}`,
        patient_id: "00000000-0000-0000-0000-000000009001",
        appointment_id: linkedAppointment?.id ?? null,
        appointment_title: linkedAppointment?.title ?? null,
        provider_id: linkedAppointment ? "00000000-0000-0000-0000-000000009301" : null,
        provider_name: linkedAppointment?.provider_name ?? null,
        doctor_id: linkedAppointment ? "00000000-0000-0000-0000-000000009302" : null,
        doctor_name: linkedAppointment?.doctor_name ?? null,
        patient_manager_id: null,
        patient_manager_name: null,
        interpreter_id: null,
        interpreter_name: null,
        concierge_id: null,
        concierge_name: null,
        source: "patient_portal",
        status: "submitted",
        overall_score: payload.overall_score ?? 5,
        patient_manager_score: payload.patient_manager_score ?? null,
        interpreter_score: payload.interpreter_score ?? null,
        concierge_score: payload.concierge_score ?? null,
        treatment_score: payload.treatment_score ?? null,
        doctor_score: payload.doctor_score ?? null,
        organization_score: payload.organization_score ?? null,
        service_score: payload.service_score ?? null,
        infrastructure_score: payload.infrastructure_score ?? null,
        price_value_score: payload.price_value_score ?? null,
        treatment_success: payload.treatment_success ?? null,
        complication_reported: payload.complication_reported ?? false,
        nps_score: payload.nps_score ?? 10,
        comments: payload.comments ?? null,
        improvement_notes: payload.improvement_notes ?? null,
        internal_note: null,
        review_note: null,
        submitted_by_name: "Anna Portal",
        reviewed_by_name: null,
        submitted_at: "2026-04-13T16:00:00Z",
        reviewed_at: null,
      };
      feedbackRows = [createdFeedback, ...feedbackRows];
      return json(route, createdFeedback, 201);
    }

    if (path === "/me/feedback") {
      return json(route, feedbackRows);
    }

    return json(route, []);
  });
}

test.describe("patient portal smoke flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "de");
    });
    await installPatientPortalMocks(page);
    await page.goto("/login");
    await page.locator("#email").fill("patient@gmed.de");
    await page.locator("#password").fill("patient123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Anna Portal|Patient/i);
  });

  test("patient can open dashboard, documents and invoices", async ({ page }) => {
    await expect(page.getByText("Released discharge note")).toBeVisible();
    await expect(page.getByText("INV-PORTAL-1")).toBeVisible();

    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByText("Released discharge note")).toBeVisible();
    await expect(page.getByText("Passport copy")).toBeVisible();

    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByText("INV-PORTAL-1").first()).toBeVisible();
    await expect(page.getByText("ORD-PORTAL-1").first()).toBeVisible();
  });

  test("patient can upload payment proof from invoice detail", async ({ page }) => {
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices$/);
    await page.getByRole("button", { name: /INV-PORTAL-1/i }).click();
    await expect(
      page.getByRole("button", {
        name: /Zahlungsnachweis hochladen|Загрузить подтверждение оплаты|Upload payment proof/i,
      }),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: /Zahlungsnachweis hochladen|Загрузить подтверждение оплаты|Upload payment proof/i,
      })
      .click();
    await page
      .locator("#invoice-payment-proof")
      .setInputFiles({
        name: "payment-proof.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("payment-proof"),
      });
    await page.locator("#invoice-payment-proof-note").fill("Bank transfer sent.");
    await page
      .getByRole("button", {
        name: /Nachweis senden|Отправить подтверждение|Send proof/i,
      })
      .click();

    await expect(
      page.getByText(
        /Zahlungsnachweis wurde für das Abrechnungsteam hochgeladen|Подтверждение оплаты загружено для отдела биллинга|Payment proof uploaded for the billing team/i,
      ),
    ).toBeVisible();
    await expect(
      // Dates are DD.MM.YYYY in every language (2026-09-28).
      page.locator("td").getByText(/(Hochgeladen|Uploaded) 10\.04\.2026/i),
    ).toBeVisible();
  });

  test("patient can export data and submit privacy request", async ({ page }) => {
    const exportRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/me/export?format=zip"),
    );

    await page
      .getByRole("button", {
        name: /Meine Daten exportieren|Экспортировать мои данные|Export my data/i,
      })
      .click();
    await exportRequest;

    await page.goto("/privacy");
    await expect(page).toHaveURL(/\/privacy$/);

    await chooseComboboxOption(
      page,
      page.locator("#privacy-type"),
      /Weitergabe an Dritte widerrufen|Revoke third-party sharing/i,
    );
    await page.locator("#privacy-reason").fill("Please stop sharing my records with external providers.");
    await page
      .getByRole("button", {
        name: /Anfrage senden|Отправить запрос|Submit request/i,
      })
      .click();

    const submittedRequest = page
      .locator("article")
      .filter({ hasText: "Please stop sharing my records with external providers." });

    await expect(
      page.getByText(
        /Datenschutzanfrage wurde eingereicht|Запрос по приватности отправлен|Privacy request submitted/i,
      ),
    ).toBeVisible();
    await expect(submittedRequest).toBeVisible();
    await expect(
      submittedRequest.getByText(
        /Weitergabe an Dritte widerrufen|Отозвать передачу третьим лицам|Revoke third-party sharing/i,
      ),
    ).toBeVisible();
    await expect(
      page.locator("#topbar-page-slot").getByText(/Offene Anfragen:\s*2|Open requests:\s*2/i),
    ).toBeVisible();
  });

  test("patient can confirm portal document receipt", async ({ page }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents$/);
    await expect(
      page.locator("#topbar-page-slot").getByText(
        /Ausstehende Bestätigungen:\s*1|Pending confirmations:\s*1/i,
      ),
    ).toBeVisible();

    const releasedCard = page
      .locator("article")
      .filter({ hasText: "Released discharge note" });

    await page
      .getByRole("button", {
        name: /Empfang bestätigen|Подтвердить получение|Confirm receipt/i,
      })
      .click();

    await expect(
      page.getByText(
        /Dokumentenerhalt bestätigt|Получение документа подтверждено|Document receipt confirmed/i,
      ),
    ).toBeVisible();
    await expect(
      page.locator("#topbar-page-slot").getByText(
        /Ausstehende Bestätigungen:\s*0|Pending confirmations:\s*0/i,
      ),
    ).toHaveCount(0);
    await expect(releasedCard.getByText(/Bestätigt|Confirmed/i)).toBeVisible();
  });

  test("patient can upload own document and download released plus uploaded files", async ({
    page,
  }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents$/);

    const releasedCard = page
      .locator("article")
      .filter({ hasText: "Released discharge note" });
    const releasedDownloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/me/documents/00000000-0000-0000-0000-000000009401/download"),
    );
    await releasedCard
      .getByRole("button", { name: /Herunterladen|Скачать|Download/i })
      .click();
    await releasedDownloadRequest;
    await page.getByRole("button", { name: "Dokumente hochladen", exact: true }).click();

    await chooseComboboxOption(
      page,
      page.getByRole("combobox", { name: /Kategorie|Category/i }),
      /Versicherungsdokument|Insurance/i,
    );
    await page.getByLabel(/Titel|Название|Title/i).fill("Insurance card April");
    // The app's own file picker: localized button, the chosen file's name.
    await expect(page.getByText(/Datei auswählen|Выбрать файл/)).toBeVisible();
    await page
      .getByLabel(/Datei|Файл|File/i)
      .setInputFiles({
        name: "insurance-card.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("insurance-card"),
      });
    await expect(page.locator('[data-slot="file-picker-selection"]')).toHaveText("insurance-card.pdf");
    await page
      .getByLabel(/Notiz|Заметка|Note/i)
      .fill("Front and back scanned.");
    await page
      .getByRole("button", {
        name: /Datei senden|Upload senden|Отправить загрузку|Send upload/i,
      })
      .click();

    await expect(
      page.getByText(
        /Datei wurde an das Betreuungsteam gesendet|Upload wurde an das Betreuungsteam gesendet|Загрузка отправлена команде сопровождения|Upload sent to the care team/i,
      ),
    ).toBeVisible();
    await expect(
      page.locator("#topbar-page-slot").getByText(/Meine hochgeladenen Dateien:\s*2|Meine Uploads:\s*2|My uploads:\s*2/i),
    ).toBeVisible();

    const uploadedCard = page
      .locator("article")
      .filter({ hasText: "Insurance card April" });
    await expect(uploadedCard).toBeVisible();
    await expect(uploadedCard.getByText("Front and back scanned.")).toBeVisible();

    const uploadDownloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/me/documents/uploads/00000000-0000-0000-0000-000000009411/download"),
    );
    await uploadedCard
      .getByRole("button", { name: /Herunterladen|Скачать|Download/i })
      .click();
    await uploadDownloadRequest;
  });

  test("patient sends the missing passport in the identity category", async ({ page }, testInfo) => {
    let passportUploaded = false;
    await page.route("**/api/v1/me/document-alerts", (route) =>
      json(route, {
        configured_rule_count: 1,
        document_pack_complete: passportUploaded,
        stored_document_pack_complete: passportUploaded,
        out_of_sync: false,
        required_documents: [
          { key: "passport", label: "Passport", fulfilled: passportUploaded, matching_documents: [] },
        ],
        missing_documents: passportUploaded ? [] : [{ key: "passport", label: "Passport" }],
        missing_count: passportUploaded ? 0 : 1,
      }),
    );
    await page.route("**/api/v1/me/documents/upload", async (route) => {
      if (multipartField(route.request().postDataBuffer(), "upload_kind") === "identity_document") {
        passportUploaded = true;
      }
      await route.fallback();
    });

    await page.goto("/documents");
    await expect(page.getByText("Es fehlt noch 1 Pflichtdokument.", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Ausweis hochladen", exact: true }).click();
    // The categories read correctly (no "Schl?sse" / "?bersetzungen").
    const category = page.getByRole("combobox", { name: /Kategorie/i });
    await category.click();
    await expect(page.getByRole("option", { name: "Befunde / Schlüsse", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Übersetzungen", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Reisepass / Ausweis", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(category).toContainText("Reisepass / Ausweis");
    await page.getByLabel(/Titel/i).fill("Reisepass Anna");
    const fileInput = page.locator("#portal-document-upload-file");
    await fileInput.setInputFiles({
      name: "reisepass.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("reisepass"),
    });
    const uploadRequest = page.waitForRequest((request) =>
      request.method() === "POST" && request.url().includes("/api/v1/me/documents/upload"),
    );
    await page.getByRole("button", { name: "Datei senden", exact: true }).click();
    expect(multipartField((await uploadRequest).postDataBuffer(), "upload_kind")).toBe("identity_document");

    await expect(page.getByText("Datei wurde an das Betreuungsteam gesendet.")).toBeVisible();
    // The list and the requirement update without a reload; the sent file is no longer selected.
    await expect(page.locator("article").filter({ hasText: "Reisepass Anna" })).toBeVisible();
    await expect(page.getByText("Ihr Mindest-Dokumentenpaket ist vollständig.")).toBeVisible();
    await page.getByRole("button", { name: "Dokumente hochladen", exact: true }).click();
    await expect(fileInput).toHaveValue("");
    await expect(category).toContainText("Allgemein");
    await page.screenshot({ path: testInfo.outputPath("patient-documents-after-passport.png"), fullPage: true });
  });

  test("a missing consent is not sent through the upload form (QA 2026-10-12 B2-13)", async ({ page }) => {
    await page.route("**/api/v1/me/document-alerts", (route) =>
      json(route, {
        configured_rule_count: 2,
        document_pack_complete: false,
        stored_document_pack_complete: false,
        out_of_sync: false,
        required_documents: [
          { key: "passport", label: "Reisepass", fulfilled: true, matching_documents: [] },
          { key: "consent_form", label: "Einverständniserklärung", fulfilled: false, matching_documents: [] },
        ],
        missing_documents: [{ key: "consent_form", label: "Einverständniserklärung" }],
        missing_count: 1,
      }),
    );

    await page.goto("/documents");
    await expect(page.getByText("Es fehlt noch 1 Pflichtdokument.", { exact: true })).toBeVisible();
    // GMED sends the consent for signing; the upload form is not offered for it.
    await expect(page.getByTestId("portal-documents-consent-hint")).toContainText(
      "schickt Ihnen GMED zur Unterschrift",
    );
    await expect(
      page.getByText("Nutzen Sie das Formular unten, um die fehlenden Unterlagen an Ihr Betreuungsteam zu senden."),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ausweis hochladen", exact: true })).toHaveCount(0);

    // The home card says the same (QA 2026-10-12 round 3, B2-13).
    await page.goto("/");
    await expect(page.getByTestId("portal-dashboard-consent-hint")).toContainText(
      "schickt Ihnen GMED zur Unterschrift",
    );
    await expect(page.getByText("Laden Sie die fehlenden Unterlagen im Portal hoch", { exact: false })).toHaveCount(0);
  });

  test("a list read that answers after the upload does not hide the sent file (QA B-10 d)", async ({ page }) => {
    let holdNextUploadsList = false;
    let markStaleAnswered: () => void = () => {};
    const staleAnswered = new Promise<void>((resolve) => {
      markStaleAnswered = resolve;
    });
    let releaseStale!: () => void;
    const staleRelease = new Promise<void>((resolve) => { releaseStale = resolve; });
    await page.route("**/api/v1/me/documents/uploads", async (route) => {
      if (!holdNextUploadsList || route.request().method() !== "GET") return route.fallback();
      holdNextUploadsList = false;
      // The list as it was before the upload, delivered after it.
      await staleRelease;
      await json(route, []);
      markStaleAnswered();
    });

    await page.goto("/documents");
    const uploadsCount = page.locator("#topbar-page-slot").getByText(/Meine hochgeladenen Dateien:\s*\d+/);
    await expect(uploadsCount).toHaveText(/:\s*1$/);
    // "Aktualisieren" asks the server (not the client cache); its answer is late.
    holdNextUploadsList = true;
    const staleRequest = page.waitForRequest((request) =>
      request.method() === "GET" && request.url().endsWith("/api/v1/me/documents/uploads"),
    );
    await page.getByRole("button", { name: "Aktualisieren", exact: true }).click();
    await staleRequest;
    await page.getByRole("button", { name: "Dokumente hochladen", exact: true }).click();
    await page.getByLabel(/Titel/i).fill("Befund Mia Muster");
    await page.locator("#portal-document-upload-file").setInputFiles({
      name: "befund-mia.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("befund"),
    });

    await page.getByRole("button", { name: "Datei senden", exact: true }).click();
    await expect(page.getByText("Datei wurde an das Betreuungsteam gesendet.")).toBeVisible();
    const sent = page.locator("article").filter({ hasText: "Befund Mia Muster" });
    await expect(sent).toBeVisible();

    releaseStale();
    await staleAnswered;
    // Well before the page reads the list again (3.5 s): the late answer changed nothing.
    await page.waitForTimeout(300);
    await expect(sent).toBeVisible({ timeout: 500 });
    await expect(uploadsCount).toHaveText(/:\s*2$/, { timeout: 500 });
  });

  test("dashboard header fits the top bar on wide and narrow desktops", async ({ page }, testInfo) => {
    const topbar = page.locator("header").filter({ has: page.locator("#topbar-page-slot") });
    const slot = page.locator("#topbar-page-slot");
    for (const width of [1638, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      const exportButton = slot.getByRole("button", { name: "Meine Daten exportieren" });
      const refreshButton = slot.getByRole("button", { name: "Aktualisieren" });
      const menuButton = slot.getByRole("button", { name: "Weitere Bereiche" });
      const bell = topbar.getByRole("button", { name: "Benachrichtigungen" });
      const language = topbar.getByRole("button", { name: "Sprache wechseln" });
      await expect(exportButton).toBeVisible();
      const [exportBox, refreshBox, menuBox, bellBox, languageBox] = await Promise.all(
        [exportButton, refreshButton, menuButton, bell, language].map((locator) => locator.boundingBox()),
      );
      expect(exportBox!.x + exportBox!.width, `${width}: export before refresh`).toBeLessThanOrEqual(refreshBox!.x);
      expect(menuBox!.x + menuBox!.width, `${width}: page actions before the bell`).toBeLessThanOrEqual(bellBox!.x);
      expect(languageBox!.x + languageBox!.width, `${width}: language switch on screen`).toBeLessThanOrEqual(width);
      const header = await topbar.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(header.scrollWidth, `${width}: top bar does not overflow`).toBeLessThanOrEqual(header.clientWidth);
      // The patient sees the portal, not the staff console.
      await expect(topbar.getByText("CONSOLE", { exact: true })).toHaveCount(0);
      await expect(topbar.getByText("Patientenportal", { exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`patient-dashboard-${width}.png`) });
    }

    // Compact summaries retain meaningful counts without a second set of KPI cards.
    const summary = page.locator("main dl");
    await expect(summary).toContainText("Offene Datenschutzanfragen");
    await expect(summary).toContainText("1");
    await expect(page.getByText(/Unbekannter Wert/i)).toHaveCount(0);

    await slot.getByRole("button", { name: "Weitere Bereiche" }).click();
    await page.getByRole("menuitem", { name: "Meine Dokumente" }).click();
    await expect(page).toHaveURL(/\/documents$/);

    // A header whose actions do not fit next to the title keeps them in the
    // page instead of drawing them over the bell (any page, any width).
    await expect(slot.getByRole("heading", { level: 1 })).toHaveText("Meine Dokumente");
    await expect(page.getByText("Released discharge note")).toBeVisible();
    const refresh = page.getByRole("button", { name: "Aktualisieren", exact: true });
    await expect(refresh).toBeVisible();
    const [refreshBox, bellBox] = await Promise.all([
      refresh.boundingBox(),
      topbar.getByRole("button", { name: "Benachrichtigungen" }).boundingBox(),
    ]);
    const clearOfBell =
      refreshBox!.x + refreshBox!.width <= bellBox!.x || refreshBox!.y >= bellBox!.y + bellBox!.height;
    expect(clearOfBell, "documents header actions stay clear of the bell at 1024 px").toBe(true);
    await page.screenshot({ path: testInfo.outputPath("patient-documents-1024.png") });
  });

  test("patient can submit an appointment request and see it in portal history", async ({
    page,
  }) => {
    await page.goto("/appointments");
    await expect(page).toHaveURL(/\/appointments$/);

    await page
      .getByRole("button", { name: /Terminanfrage senden|Send appointment request/i })
      .click();
    const requestSheet = page
      .getByRole("dialog")
      .filter({ hasText: /Termin anfragen|Request a visit/i });
    await expect(requestSheet).toBeVisible();

    await pickerValueInput(requestSheet, /Bevorzugt ab|Preferred from/i).fill("2026-05-10");
    await pickerValueInput(requestSheet, /Bevorzugt bis|Preferred to/i).fill("2026-05-12");
    await requestSheet
      .getByLabel(/Fachgebiet oder Thema|Specialty or topic/i)
      .fill("Cardiology follow-up");
    await requestSheet
      .getByLabel(/Ortpräferenz|Location preference/i)
      .fill("Clinic Cologne");
    await requestSheet
      .getByLabel(/Anlass|Reason/i)
      .fill("Need a follow-up appointment after receiving the latest findings.");
    await requestSheet
      .getByLabel(/Zusätzliche Notiz|Additional note/i)
      .fill("Morning slots preferred.");
    await requestSheet
      .getByRole("button", {
        name: /Terminanfrage senden|Отправить запрос на запись|Send appointment request/i,
      })
      .click();

    await expect(
      page.getByText(
        /Terminanfrage wurde an das Betreuungsteam gesendet|Запрос на запись отправлен команде сопровождения|Appointment request sent to the care team/i,
      ),
    ).toBeVisible();

    const requestCard = page
      .locator("article")
      .filter({ hasText: "Need a follow-up appointment after receiving the latest findings." });
    await expect(requestCard).toBeVisible();
    await expect(
      requestCard.getByText(/Angefragt|Запрошено|requested/i).first(),
    ).toBeVisible();
  });

  test("patient types the preferred dates with the keyboard (QA C-29)", async ({ page }) => {
    await page.goto("/appointments");
    await page
      .getByRole("button", { name: /Terminanfrage senden|Send appointment request/i })
      .click();
    const requestSheet = page
      .getByRole("dialog")
      .filter({ hasText: /Termin anfragen|Request a visit/i });
    await expect(requestSheet).toBeVisible();

    // One key at a time with pauses: the field's timers run between keys, which
    // used to wipe day and month while the year was typed ("TT.MM.2026").
    for (const [label, digits, shown] of [
      [/Bevorzugt ab/i, "26102026", "26.10.2026"],
      [/Bevorzugt bis/i, "30102026", "30.10.2026"],
    ] as const) {
      await requestSheet.getByRole("group", { name: label }).getByRole("spinbutton").first().click();
      await page.keyboard.type(digits, { delay: 120 });
      await expect(pickerValueInput(requestSheet, label)).toHaveValue(shown);
    }
    await requestSheet.getByLabel(/Anlass|Reason/i).fill("Kontrolle nach dem Eingriff (Tastatur).");

    const submitted = page.waitForRequest(
      (request) => request.url().includes("/me/appointment-requests") && request.method() === "POST",
    );
    await requestSheet
      .getByRole("button", {
        name: /Terminanfrage senden|Отправить запрос на запись|Send appointment request/i,
      })
      .click();
    const payload = JSON.parse((await submitted).postData() ?? "{}") as {
      preferred_date_from?: string;
      preferred_date_to?: string;
    };
    expect(payload.preferred_date_from).toBe("2026-10-26");
    expect(payload.preferred_date_to).toBe("2026-10-30");

    // The history shows the whole preferred range, not only the start.
    const requestCard = page.locator("article").filter({ hasText: "Kontrolle nach dem Eingriff (Tastatur)." });
    await expect(requestCard).toContainText("26.10.2026");
    await expect(requestCard).toContainText("30.10.2026");
  });

  test("patient can request and cancel an additional service", async ({ page }) => {
    await page.goto("/services");
    await expect(page).toHaveURL(/\/services$/);
    await page.getByRole("button", { name: "Service anfragen", exact: true }).click();

    await page.getByLabel(/Titel|Название|Title/i).fill("Hotel near clinic");
    await page
      .getByLabel(/Bevorzugter Anbieter|Preferred vendor/i)
      .fill("River Hotel");
    await page
      .getByLabel(/Kontakt des Anbieters|Vendor contact/i)
      .fill("booking@river.example");
    await page
      .getByLabel(/Geschätztes Budget \(EUR\)|Estimated budget \(EUR\)/i)
      .fill("240");
    await page
      .getByLabel(/Notizen|Заметки|Notes/i)
      .fill("Need a quiet room close to the clinic for two nights.");
    await page
      .getByRole("button", {
        name: /Anfrage senden|Отправить запрос|Send request/i,
      })
      .click();

    await expect(
      page.getByText(
        /Serviceanfrage wurde an das Betreuungsteam gesendet|Запрос на сервис отправлен команде сопровождения|Additional service request sent to the care team/i,
      ),
    ).toBeVisible();

    const createdCard = page.locator("article").filter({ hasText: "Hotel near clinic" });
    await expect(createdCard).toBeVisible();
    await expect(createdCard.getByText(/^Ausstehend$|^Pending$/i)).toBeVisible();
    await createdCard
      .getByRole("button", {
        name: /Anfrage stornieren|Отменить запрос|Cancel request/i,
      })
      .click();

    await expect(
      page.getByText(
        /Serviceanfrage wurde storniert|Сервисный запрос отменен|Service request cancelled/i,
      ),
    ).toBeVisible();
    await expect(createdCard.getByText(/Storniert|Cancelled/i)).toBeVisible();
    await expect(
      createdCard.getByRole("button", {
        name: /Anfrage stornieren|Отменить запрос|Cancel request/i,
      }),
    ).toHaveCount(0);
  });

  for (const variant of [{ width: 1440, dark: false }, { width: 390, dark: false }, { width: 1440, dark: true }]) {
    test(`quiet empty portal and on-demand forms at ${variant.width}px dark=${variant.dark}`, async ({ page }, testInfo) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: variant.width, height: 900 });
      await page.addInitScript((dark) => { localStorage.setItem("gmed_theme", dark ? "dark" : "light"); }, variant.dark);
      await page.route("**/api/v1/me/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (route.request().method() !== "GET") return route.fallback();
        if (/\/(appointments|appointment-requests|followup-milestones|concierge-services|documents|uploads|invoices|recommendations|next-actions|privacy-requests|feedback|translation-requests)$/.test(path)) return json(route, []);
        if (path.endsWith("/document-alerts")) return json(route, {
          configured_rule_count: 2, document_pack_complete: true, missing_count: 0,
          required_documents: [{ key: "passport", fulfilled: true }, { key: "consent", fulfilled: true }], missing_documents: [],
        });
        return route.fallback();
      });
      for (const [name, route] of [["dashboard", "/"], ["appointments", "/appointments"], ["documents", "/documents"], ["services", "/services"]]) {
        await page.goto(route);
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle");
        // The theme is a DOM-only visual fixture; no account settings are changed.
        await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), variant.dark);
        await expect(page.locator("main dl")).toHaveCount(0);
        const geometry = await page.locator("main").evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        expect(geometry.scroll).toBeLessThanOrEqual(geometry.client + 1);
        if (name === "dashboard") {
          await expect(page.locator("main nav a")).toHaveCount(4);
          await expect(page.getByText("GMED auf dem Smartphone", { exact: true })).toBeVisible();
          await expect(page.getByText("Im Browser-Menü „Zum Startbildschirm“ wählen.")).not.toBeVisible();
        }
        if (name === "documents" || name === "services") await expect(page.locator("main form")).toHaveCount(0);
        await page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: "disabled" });
        if (name === "documents" || name === "services") {
          await page.getByRole("button", { name: name === "documents" ? "Dokumente hochladen" : "Service anfragen", exact: true }).click();
          const dialog = page.getByRole("dialog");
          await expect(dialog).toBeVisible();
          await expect(dialog).toHaveCSS("opacity", "1");
          const box = await dialog.boundingBox();
          expect(box!.width).toBeLessThanOrEqual(variant.width - 16);
          expect(box!.height).toBeLessThanOrEqual(884);
          await page.screenshot({ path: testInfo.outputPath(`${name}-form.png`), animations: "disabled" });
          await page.keyboard.press("Escape");
          await expect(dialog).not.toBeVisible();
        }
      }
    });
  }

  test("patient can submit appointment-linked feedback and see it in history", async ({
    page,
  }) => {
    await page.goto("/feedback");
    await expect(page).toHaveURL(/\/feedback$/);

    const form = page.locator("form").first();
    await chooseComboboxOption(page, form.getByRole("combobox").first(), /Clinic follow-up/i);
    await form
      .getByPlaceholder(/Was ist gut gelaufen\?|What worked well\?/i)
      .fill("The doctor explained the next steps clearly.");
    await form
      .getByPlaceholder(
        /Was sollte das Team verbessern\?|What should the team improve\?/i,
      )
      .fill("Waiting area signage could be clearer.");
    await form
      .getByRole("button", {
        name: /Feedback senden|Отправить отзыв|Submit feedback/i,
      })
      .click();

    await expect(
      page.getByText(
        /Feedback wurde gesendet\. Vielen Dank\.|Отзыв отправлен\. Спасибо\.|Feedback submitted\. Thank you\./i,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/Abgegebene Rückmeldungen|Submitted feedback/i),
    ).toBeVisible();

    const feedbackCard = page
      .getByRole("row")
      .filter({ hasText: "Clinic follow-up" })
      .first();
    await expect(feedbackCard).toBeVisible();
    await expect(feedbackCard.getByText("Clinic follow-up")).toBeVisible();
    await expect(feedbackCard.getByText(/Eingereicht|Submitted/i)).toBeVisible();
  });

  test("patient portal stays within a mobile viewport", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const routes = [
      ["dashboard", "/"],
      ["notifications", "/notifications"],
      ["chat", "/chat"],
      ["appointments", "/appointments"],
      ["recommendations", "/recommendations"],
      ["documents", "/documents"],
      ["services", "/services"],
      ["subscriptions", "/subscriptions"],
      ["invoices", "/invoices"],
      ["feedback", "/feedback"],
      ["privacy", "/privacy"],
    ] as const;

    for (const [name, route] of routes) {
      await page.goto(route);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();

      const viewport = await page.evaluate(() => {
        const main = document.querySelector("main");
        return {
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          mainClientWidth: main?.clientWidth ?? 0,
          mainScrollWidth: main?.scrollWidth ?? 0,
          mainScrollLeft: main?.scrollLeft ?? 0,
        };
      });
      expect(viewport.scrollWidth, `${name} should not overflow horizontally`).toBeLessThanOrEqual(
        viewport.clientWidth + 1,
      );
      expect(
        viewport.mainScrollWidth,
        `${name} main should not overflow horizontally (scrollLeft ${viewport.mainScrollLeft})`,
      ).toBeLessThanOrEqual(viewport.mainClientWidth + 1);

      await page.screenshot({
        path: testInfo.outputPath(`patient-mobile-${name}.png`),
        fullPage: false,
      });
    }
  });

  test("patient mobile sheets and dialogs use the available viewport", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await page.goto("/appointments");
    await page
      .getByRole("button", { name: /Terminanfrage senden|Send appointment request/i })
      .click();
    const appointmentSheet = page
      .getByRole("dialog")
      .filter({ hasText: /Termin anfragen|Request a visit/i });
    await expect(appointmentSheet).toBeVisible();
    await expect(appointmentSheet).toHaveCSS("width", "390px");
    await page.screenshot({
      path: testInfo.outputPath("patient-mobile-appointment-sheet.png"),
      fullPage: false,
    });
    await page.keyboard.press("Escape");

    await page.goto("/invoices");
    await page.getByRole("button", { name: /INV-PORTAL-1/i }).click();
    const invoiceSheet = page.getByRole("dialog").filter({ hasText: /INV-PORTAL-1/i });
    await expect(invoiceSheet).toBeVisible();
    await expect(invoiceSheet).toHaveCSS("width", "390px");
    await page.screenshot({
      path: testInfo.outputPath("patient-mobile-invoice-sheet.png"),
      fullPage: false,
    });

    await invoiceSheet
      .getByRole("button", {
        name: /Zahlungsnachweis hochladen|Загрузить подтверждение оплаты|Upload payment proof/i,
      })
      .click();
    const proofDialog = page
      .getByRole("dialog")
      .filter({ hasText: /Zahlungsnachweis hochladen|Upload payment proof/i });
    await expect(proofDialog).toBeVisible();
    const proofDialogBox = await proofDialog.boundingBox();
    expect(proofDialogBox?.width ?? 0).toBeLessThanOrEqual(374);
    expect(proofDialogBox?.height ?? 0).toBeLessThanOrEqual(828);
    expect(proofDialogBox?.y ?? -1).toBeGreaterThanOrEqual(8);
    expect((proofDialogBox?.y ?? 0) + (proofDialogBox?.height ?? 0)).toBeLessThanOrEqual(836);
    await page.waitForTimeout(150);
    await page.screenshot({
      path: testInfo.outputPath("patient-mobile-payment-proof-dialog.png"),
      fullPage: false,
    });
  });
});


test("guardian selects a child and switches documents without sharing cached data", async ({ page }) => {
  const patients = [
    { id: "00000000-0000-0000-0000-000000008001", name: "Mia Muster", patient_number: "P-8001" },
    { id: "00000000-0000-0000-0000-000000008002", name: "Ben Muster", patient_number: "P-8002" },
  ];
  const token = `header.${Buffer.from(JSON.stringify({ sub: "00000000-0000-0000-0000-000000009001", exp: Math.floor(new Date("2026-10-12T08:00:00Z").getTime() / 1000) + 3600 })).toString("base64url")}.signature`;
  await page.addInitScript((accessToken) => {
    localStorage.setItem("gmed_lang", "de");
    localStorage.setItem("gmed_access_token", accessToken);
    localStorage.setItem("gmed_refresh_token", "synthetic-refresh");
  }, token);
  await installPatientPortalMocks(page, patients);
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/me/documents") requests.push(request.headers()["x-patient-id"] ?? "");
  });
  await page.goto("/documents");
  const selector = page.getByLabel("Patient / Patientin", { exact: true });
  await expect(selector).toHaveValue("");
  await expect(page.getByText("Wählen Sie, für wen Sie das Portal öffnen möchten.")).toBeVisible();
  expect(requests).toEqual([]);
  await selector.selectOption(patients[0].id);
  await expect(page.getByText("Report for Mia Muster", { exact: true })).toBeVisible();
  await selector.selectOption(patients[1].id);
  await expect(page.getByText("Report for Ben Muster", { exact: true })).toBeVisible();
  await expect(page.getByText("Report for Mia Muster", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(selector).toHaveValue(patients[1].id);
  await expect(page.getByText("Report for Ben Muster", { exact: true })).toBeVisible();
  await selector.selectOption(patients[0].id);
  await expect(page.getByText("Report for Mia Muster", { exact: true })).toBeVisible();
  expect(requests).toEqual([patients[0].id, patients[1].id, patients[1].id, patients[0].id]);
});
