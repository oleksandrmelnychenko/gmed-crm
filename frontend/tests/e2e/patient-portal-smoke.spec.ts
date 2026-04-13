import { expect, test, type Page, type Route } from "@playwright/test";

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

async function installPatientPortalMocks(page: Page) {
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
      notes: "Released for portal access.",
      share_id: "00000000-0000-0000-0000-000000009402",
      channel: "patient_portal",
      requires_confirmation: true,
      confirmed: false,
      confirmed_at: null,
      shared_at: "2026-04-02T10:00:00Z",
      shared_by_name: "Admin GMED",
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
        art: uploadKind || "general",
        category: uploadKind === "insurance_document" ? "insurance" : "general",
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
    await expect(page.getByRole("heading", { name: "INV-PORTAL-1" })).toBeVisible();
    await expect(page.getByText("Treatment package")).toBeVisible();
  });

  test("patient can upload payment proof from invoice detail", async ({ page }) => {
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(
      page.getByRole("button", { name: /Upload payment proof/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Upload payment proof/i }).click();
    await page
      .locator("#invoice-payment-proof")
      .setInputFiles({
        name: "payment-proof.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("payment-proof"),
      });
    await page.locator("#invoice-payment-proof-note").fill("Bank transfer sent.");
    await page.getByRole("button", { name: /Send proof/i }).click();

    await expect(
      page.getByText("Payment proof uploaded for the billing team."),
    ).toBeVisible();
    await expect(page.getByText(/Uploaded 10 Apr 2026/i)).toBeVisible();
  });

  test("patient can export data and submit privacy request", async ({ page }) => {
    const exportRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/me/export?format=zip"),
    );

    await page.getByRole("button", { name: /Export my data/i }).click();
    await exportRequest;

    await page.goto("/privacy");
    await expect(page).toHaveURL(/\/privacy$/);

    await page.locator("#privacy-type").selectOption("third_party_revoke");
    await page.locator("#privacy-reason").fill("Please stop sharing my records with external providers.");
    await page.getByRole("button", { name: /Submit request/i }).click();

    const submittedRequest = page
      .locator("article")
      .filter({ hasText: "Please stop sharing my records with external providers." });

    await expect(page.getByText("Privacy request submitted.")).toBeVisible();
    await expect(submittedRequest).toBeVisible();
    await expect(
      submittedRequest.getByText("Revoke third-party sharing"),
    ).toBeVisible();
    await expect(page.getByText(/Open requests:\s*2/i)).toBeVisible();
  });

  test("patient can confirm portal document receipt", async ({ page }) => {
    await page.goto("/documents");
    await expect(page).toHaveURL(/\/documents$/);
    await expect(page.getByText(/Pending confirmations:\s*1/i)).toBeVisible();

    const releasedCard = page
      .locator("article")
      .filter({ hasText: "Released discharge note" });

    await page.getByRole("button", { name: /Confirm receipt/i }).click();

    await expect(page.getByText("Document receipt confirmed.")).toBeVisible();
    await expect(page.getByText(/Pending confirmations:\s*0/i)).toBeVisible();
    await expect(releasedCard.getByText("Confirmed")).toBeVisible();
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
    await releasedCard.getByRole("button", { name: /^Download$/i }).click();
    await releasedDownloadRequest;

    await page.getByLabel("Upload type").selectOption("insurance_document");
    await page.getByLabel("Title").fill("Insurance card April");
    await page
      .getByLabel("File")
      .setInputFiles({
        name: "insurance-card.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("insurance-card"),
      });
    await page.getByLabel("Note").fill("Front and back scanned.");
    await page.getByRole("button", { name: /Send upload/i }).click();

    await expect(page.getByText("Upload sent to the care team.")).toBeVisible();
    await expect(page.getByText(/My uploads:\s*2/i)).toBeVisible();

    const uploadedCard = page
      .locator("article")
      .filter({ hasText: "Insurance card April" });
    await expect(uploadedCard).toBeVisible();
    await expect(uploadedCard.getByText("Front and back scanned.")).toBeVisible();

    const uploadDownloadRequest = page.waitForRequest((request) =>
      request.method() === "GET" &&
      request.url().includes("/api/v1/me/documents/uploads/00000000-0000-0000-0000-000000009411/download"),
    );
    await uploadedCard.getByRole("button", { name: /^Download$/i }).click();
    await uploadDownloadRequest;
  });

  test("patient can submit an appointment request and see it in portal history", async ({
    page,
  }) => {
    await page.goto("/appointments");
    await expect(page).toHaveURL(/\/appointments$/);

    await page.getByLabel("Preferred from").fill("2026-05-10");
    await page.getByLabel("Preferred to").fill("2026-05-12");
    await page.getByLabel("Specialty or topic").fill("Cardiology follow-up");
    await page.getByLabel("Location preference").fill("Clinic Cologne");
    await page
      .getByLabel("Reason")
      .fill("Need a follow-up appointment after receiving the latest findings.");
    await page.getByLabel("Additional note").fill("Morning slots preferred.");
    await page.getByRole("button", { name: /Send appointment request/i }).click();

    await expect(page.getByText("Appointment request sent to the care team.")).toBeVisible();

    const requestCard = page
      .locator("article")
      .filter({ hasText: "Need a follow-up appointment after receiving the latest findings." });
    await expect(requestCard).toBeVisible();
    await expect(requestCard.getByText("requested", { exact: true })).toBeVisible();
  });

  test("patient can request and cancel an additional service", async ({ page }) => {
    await page.goto("/services");
    await expect(page).toHaveURL(/\/services$/);

    await page.getByLabel("Title").fill("Hotel near clinic");
    await page.getByLabel("Preferred vendor").fill("River Hotel");
    await page.getByLabel("Vendor contact").fill("booking@river.example");
    await page.getByLabel("Estimated budget (EUR)").fill("240");
    await page
      .getByLabel("Notes")
      .fill("Need a quiet room close to the clinic for two nights.");
    await page.getByRole("button", { name: /Send request/i }).click();

    await expect(page.getByText("Additional service request sent to the care team.")).toBeVisible();

    const createdCard = page.locator("article").filter({ hasText: "Hotel near clinic" });
    await expect(createdCard).toBeVisible();
    await expect(createdCard.getByText("pending", { exact: true })).toBeVisible();
    await createdCard.getByRole("button", { name: /Cancel request/i }).click();

    await expect(page.getByText("Service request cancelled.")).toBeVisible();
    await expect(createdCard.getByText("cancelled")).toBeVisible();
    await expect(createdCard.getByRole("button", { name: /Cancel request/i })).toHaveCount(0);
  });

  test("patient can submit appointment-linked feedback and see it in history", async ({
    page,
  }) => {
    await page.goto("/feedback");
    await expect(page).toHaveURL(/\/feedback$/);

    const form = page.locator("form").first();
    await form.locator("select").first().selectOption(
      "00000000-0000-0000-0000-000000009101",
    );
    await form
      .getByPlaceholder("What worked well?")
      .fill("The doctor explained the next steps clearly.");
    await form
      .getByPlaceholder("What should the team improve?")
      .fill("Waiting area signage could be clearer.");
    await form.getByRole("button", { name: /Submit feedback/i }).click();

    await expect(page.getByText("Feedback submitted. Thank you.")).toBeVisible();
    await expect(page.getByText(/Submitted feedback/i)).toBeVisible();

    const feedbackCard = page
      .locator("article")
      .filter({ hasText: "The doctor explained the next steps clearly." })
      .first();
    await expect(feedbackCard).toBeVisible();
    await expect(feedbackCard.getByText("Clinic follow-up")).toBeVisible();
    await expect(feedbackCard.getByText("submitted")).toBeVisible();
    await expect(feedbackCard.getByText("Waiting area signage could be clearer.")).toBeVisible();
  });
});
