import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installPatientPortalMocks(page: Page) {
  let paymentProofUploadedAt: string | null = null;
  const paymentProofTimestamp = "2026-04-10T09:15:00Z";

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
      return json(route, [
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
      ]);
    }

    if (path === "/me/concierge-services") {
      return json(route, [
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
      ]);
    }

    if (path === "/me/documents") {
      return json(route, [
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
      ]);
    }

    if (path === "/me/documents/uploads") {
      return json(route, [
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
      ]);
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
      paymentProofUploadedAt = paymentProofTimestamp;
      return json(route, { ok: true });
    }

    if (path === "/me/privacy-requests") {
      return json(route, [
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
      ]);
    }

    if (path === "/me/feedback") {
      return json(route, [
        {
          id: "00000000-0000-0000-0000-000000009901",
          patient_id: "00000000-0000-0000-0000-000000009001",
          appointment_id: "00000000-0000-0000-0000-000000009101",
          appointment_title: "Clinic follow-up",
          provider_id: "00000000-0000-0000-0000-000000009301",
          provider_name: "Clinic Cologne",
          doctor_id: "00000000-0000-0000-0000-000000009302",
          doctor_name: "Doctor Cologne",
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
      ]);
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
});
