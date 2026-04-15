import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  ensureLiveBackendHealthy,
  setGermanLanguage,
} from "./support/live-helpers";

const MINIMAL_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n",
  "utf8",
);
const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";

async function submitPortalFeedback(
  page: import("@playwright/test").Page,
  comment: string,
  improvement: string,
) {
  await page.getByPlaceholder("What worked well?").fill(comment);
  await page.getByPlaceholder("What should the team improve?").fill(improvement);
  await page.getByRole("button", { name: /Submit feedback/i }).click();
}

test.describe("patient portal live workflows", () => {
  test("patient dashboard shows required document alerts from the live backend", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "patient");

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Hello,/i }),
    ).toBeVisible();
    await expect(
      page.getByText("Required documents", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/required documents? still missing/i)).toBeVisible();
    await expect(page.getByText("Reisepass")).toBeVisible();
    await expect(page.getByText("Einverständniserklärung")).toBeVisible();

    await page.getByRole("button", { name: /Open documents/i }).click();
    await expect(page).toHaveURL(/\/documents$/);
  });

  test("patient can open documents and invoices released from the live backend", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/documents");
    await expect(page.getByText(scenario.documents.released.title)).toBeVisible();

    await page.goto("/invoices");
    await expect(
      page.getByRole("heading", { name: scenario.invoice.invoice_number }),
    ).toBeVisible();
  });

  test("patient can upload payment proof from invoice detail", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/invoices");
    await expect(
      page.getByRole("heading", { name: scenario.invoice.invoice_number }),
    ).toBeVisible();

    await page.getByRole("button", { name: /Upload payment proof/i }).click();
    await page
      .locator("#invoice-payment-proof")
      .setInputFiles({
        name: "payment-proof.pdf",
        mimeType: "application/pdf",
        buffer: MINIMAL_PDF,
      });
    await page
      .locator("#invoice-payment-proof-note")
      .fill("Bank transfer sent.");
    await page.getByRole("button", { name: /Send proof/i }).click();

    await expect(
      page.getByText("Payment proof uploaded for the billing team."),
    ).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const invoiceResponse = await request.get(
        `${api.backendUrl}/api/v1/me/invoices/${scenario.invoice.id}`,
        { headers: api.headers },
      );
      expect(invoiceResponse.ok()).toBe(true);
      const invoice = (await invoiceResponse.json()) as {
        payment_proof_count: number;
        last_payment_proof_at: string | null;
      };
      expect(invoice.payment_proof_count).toBeGreaterThanOrEqual(1);
      expect(invoice.last_payment_proof_at).not.toBeNull();
    }).toPass({ timeout: 15_000 });
  });

  test("patient can export data and submit a privacy request", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    const exportRequest = page.waitForRequest((next) =>
      next.method() === "GET" && next.url().includes("/api/v1/me/export?format=zip"),
    );

    await page.getByRole("button", { name: /Export my data/i }).click();
    await exportRequest;

    await page.goto("/privacy");
    await page.locator("#privacy-type").selectOption("third_party_revoke");
    await page
      .locator("#privacy-reason")
      .fill("Please stop sharing my records with external providers.");
    await page.getByRole("button", { name: /Submit request/i }).click();

    const submittedRequest = page.locator("article").filter({
      hasText: "Please stop sharing my records with external providers.",
    });
    await expect(page.getByText("Privacy request submitted.")).toBeVisible();
    await expect(submittedRequest).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/me/privacy-requests`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        request_type: string;
        reason: string | null;
        status: string;
      }>;
      const submitted = items.find(
        (item) =>
          item.request_type === "third_party_revoke" &&
          item.reason ===
            "Please stop sharing my records with external providers.",
      );
      expect(submitted).toBeDefined();
    }).toPass({ timeout: 15_000 });
  });

  test("patient can confirm a released document receipt", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/documents");
    const releasedCard = page.locator("article").filter({
      hasText: scenario.documents.released.title,
    });
    await expect(releasedCard).toBeVisible();
    await releasedCard.getByRole("button", { name: /Confirm receipt/i }).click();

    await expect(page.getByText("Document receipt confirmed.")).toBeVisible();
    await expect(releasedCard.getByText("Confirmed")).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/me/documents`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const documents = (await response.json()) as Array<{
        id: string;
        confirmed: boolean;
        confirmed_at: string | null;
      }>;
      const released = documents.find(
        (doc) => doc.id === scenario.documents.released.id,
      );
      expect(released).toBeDefined();
      expect(released!.confirmed).toBe(true);
      expect(released!.confirmed_at).not.toBeNull();
    }).toPass({ timeout: 15_000 });
  });

  test("patient can confirm receipt for an auto-sent provider preparation document", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");
    const templateLabel = `Portal auto prep ${scenario.tag}`;
    const templateFileName = `Portal prep ${scenario.tag}`;

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const createTemplateResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}/templates`,
      {
        headers: {
          ...pmApi.headers,
          "Content-Type": "application/json",
        },
        data: {
          label: templateLabel,
          description: "Auto-sent provider preparation packet for patient portal receipt proof.",
          doctor_id: null,
          art: "provider_template_instruction",
          category: "provider_template",
          default_auto_name: templateFileName,
          default_status: "draft",
          default_visibility: "patient_visible",
          is_medical: true,
          is_active: true,
          supported_languages: ["de"],
          body_de:
            "Hallo {{patient_name}}, bitte erscheinen Sie zu {{appointment_title}} am {{appointment_date}}.",
          body_en: null,
          body_uk: null,
          body_ru: null,
          notes: "Live patient portal receipt proof",
          auto_send_on_confirmed_appointment: true,
        },
      },
    );
    expect(createTemplateResponse.ok()).toBe(true);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request.post(
        `${pmApi.backendUrl}/api/v1/appointments/${scenario.appointment.id}/status`,
        {
          headers: pmApi.headers,
          data: { status: "confirmed" },
        },
      );
      expect(response.ok()).toBe(true);
    }

    const patientApi = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${patientApi.backendUrl}/api/v1/me/documents`,
        { headers: patientApi.headers },
      );
      expect(response.ok()).toBe(true);
      const documents = (await response.json()) as Array<{
        id: string;
        auto_name: string;
        visibility: string;
        confirmed: boolean;
      }>;
      const generated = documents.filter((item) =>
        item.auto_name.startsWith(templateFileName),
      );
      expect(generated).toHaveLength(1);
      expect(generated[0]!.visibility).toBe("patient_visible");
      expect(generated[0]!.confirmed).toBe(false);
    }).toPass({ timeout: 15_000 });

    await page.goto("/documents");
    const generatedCard = page.locator("article").filter({
      hasText: templateFileName,
    });
    await expect(generatedCard).toHaveCount(1);
    await generatedCard
      .getByRole("button", { name: /Confirm receipt/i })
      .click();

    await expect(page.getByText("Document receipt confirmed.")).toBeVisible();
    await expect(generatedCard.getByText("Confirmed")).toBeVisible();

    await expect(async () => {
      const response = await request.get(
        `${patientApi.backendUrl}/api/v1/me/documents`,
        { headers: patientApi.headers },
      );
      expect(response.ok()).toBe(true);
      const documents = (await response.json()) as Array<{
        id: string;
        auto_name: string;
        confirmed: boolean;
        confirmed_at: string | null;
      }>;
      const generated = documents.find((item) =>
        item.auto_name.startsWith(templateFileName),
      );
      expect(generated).toBeDefined();
      expect(generated!.confirmed).toBe(true);
      expect(generated!.confirmed_at).not.toBeNull();
    }).toPass({ timeout: 15_000 });
  });

  test("patient can upload own document and download released plus uploaded files", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/documents");

    const releasedCard = page.locator("article").filter({
      hasText: scenario.documents.released.title,
    });
    const releasedDownloadRequest = page.waitForRequest((next) =>
      next.method() === "GET" &&
      next.url().includes(`/api/v1/me/documents/${scenario.documents.released.id}/download`),
    );
    await releasedCard.getByRole("button", { name: /^Download$/i }).click();
    await releasedDownloadRequest;

    await page.getByLabel("Upload type").selectOption("insurance_document");
    await page.getByLabel("Title").fill("Insurance card April");
    await page.getByLabel("File").setInputFiles({
      name: "insurance-card.pdf",
      mimeType: "application/pdf",
      buffer: MINIMAL_PDF,
    });
    await page.getByLabel("Note").fill("Front and back scanned.");
    await page.getByRole("button", { name: /Send upload/i }).click();

    await expect(page.getByText("Upload sent to the care team.")).toBeVisible();

    const uploadedCard = page.locator("article").filter({
      hasText: "Insurance card April",
    });
    await expect(uploadedCard).toBeVisible();
    const uploadDownloadRequest = page.waitForRequest((next) =>
      next.method() === "GET" &&
      next.url().includes("/api/v1/me/documents/uploads/"),
    );
    await uploadedCard.getByRole("button", { name: /^Download$/i }).click();
    await uploadDownloadRequest;

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/me/documents/uploads`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const uploads = (await response.json()) as Array<{
        auto_name: string;
        art: string;
        notes: string | null;
        ursprung: string | null;
        original_filename: string | null;
      }>;
      const uploaded = uploads.find(
        (item) => item.auto_name === "Insurance card April",
      );
      expect(uploaded).toBeDefined();
      expect(uploaded!.art).toBe("insurance_document");
      expect(uploaded!.notes).toBe("Front and back scanned.");
      expect(uploaded!.ursprung).toBe("patient_portal");
      expect(uploaded!.original_filename).toBe("insurance-card.pdf");
    }).toPass({ timeout: 15_000 });
  });

  test("patient can submit an appointment request and see it in history", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/appointments");
    await page.getByLabel("Preferred from").fill("2026-05-10");
    await page.getByLabel("Preferred to").fill("2026-05-12");
    await page.getByLabel("Specialty or topic").fill("Cardiology follow-up");
    await page.getByLabel("Location preference").fill("Clinic Cologne");
    await page
      .getByLabel("Reason")
      .fill("Need a follow-up appointment after receiving the latest findings.");
    await page.getByLabel("Additional note").fill("Morning slots preferred.");
    await page.getByRole("button", { name: /Send appointment request/i }).click();

    const requestCard = page.locator("article").filter({
      hasText: "Need a follow-up appointment after receiving the latest findings.",
    });
    await expect(page.getByText("Appointment request sent to the care team.")).toBeVisible();
    await expect(requestCard).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/me/appointment-requests`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        patient_id: string;
        preferred_date_from: string | null;
        preferred_date_to: string | null;
        specialty: string | null;
        location: string | null;
        reason: string | null;
        notes: string | null;
        status: string;
        converted_appointment_id: string | null;
      }>;
      const submitted = items.find(
        (item) =>
          item.reason ===
          "Need a follow-up appointment after receiving the latest findings.",
      );
      expect(submitted).toBeDefined();
      expect(submitted!.patient_id).toBe(scenario.patient.id);
      expect(submitted!.preferred_date_from).toBe("2026-05-10");
      expect(submitted!.preferred_date_to).toBe("2026-05-12");
      expect(submitted!.specialty).toBe("Cardiology follow-up");
      expect(submitted!.location).toBe("Clinic Cologne");
      expect(submitted!.notes).toBe("Morning slots preferred.");
      expect(submitted!.status).toBe("requested");
      expect(submitted!.converted_appointment_id).toBeNull();
    }).toPass({ timeout: 15_000 });
  });

  test("patient can request and cancel an additional service", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/services");
    await page.getByLabel("Title").fill("Hotel near clinic");
    await page.getByLabel("Preferred vendor").fill("River Hotel");
    await page.getByLabel("Vendor contact").fill("booking@river.example");
    await page.getByLabel("Estimated budget (EUR)").fill("240");
    await page
      .getByLabel("Notes")
      .fill("Need a quiet room close to the clinic for two nights.");
    await page.getByRole("button", { name: /Send request/i }).click();

    const createdCard = page.locator("article").filter({
      hasText: "Hotel near clinic",
    });
    await expect(page.getByText("Additional service request sent to the care team.")).toBeVisible();
    await expect(createdCard).toBeVisible();
    await createdCard.getByRole("button", { name: /Cancel request/i }).click();
    await expect(page.getByText("Service request cancelled.")).toBeVisible();
    await expect(createdCard.getByText("cancelled")).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/me/concierge-services`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        title: string;
        status: string;
        vendor_name: string | null;
        vendor_contact: string | null;
        cost_estimate: string | number | null;
        service_notes: string | null;
        request_source: string | null;
      }>;
      const created = items.find((item) => item.title === "Hotel near clinic");
      expect(created).toBeDefined();
      expect(created!.status).toBe("cancelled");
      expect(created!.vendor_name).toBe("River Hotel");
      expect(created!.vendor_contact).toBe("booking@river.example");
      expect(created!.service_notes).toBe(
        "Need a quiet room close to the clinic for two nights.",
      );
      expect(String(created!.cost_estimate)).toContain("240");
      expect(created!.request_source).toBe("patient_portal");
    }).toPass({ timeout: 15_000 });
  });

  test("patient can submit feedback and see it in portal history", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "patient");

    await page.goto("/feedback");
    await expect(
      page.getByRole("heading", { name: /My feedback/i }),
    ).toBeVisible();
    const comment = "The doctor explained the next steps clearly.";
    const improvement = "Waiting area signage could be clearer.";
    await submitPortalFeedback(page, comment, improvement);

    const feedbackCard = page.locator("article").filter({
      hasText: comment,
    }).first();

    const successNotice = page.getByText("Feedback submitted. Thank you.");
    try {
      await expect(successNotice).toBeVisible({ timeout: 10_000 });
    } catch {
      const networkAlert = page.getByRole("alert").filter({
        hasText: /Failed to fetch/i,
      });
      await expect(networkAlert).toBeVisible();
      await ensureLiveBackendHealthy(true);
      await page.goto("/feedback");
      await expect(
        page.getByRole("heading", { name: /My feedback/i }),
      ).toBeVisible();
      await submitPortalFeedback(page, comment, improvement);
      await expect(successNotice).toBeVisible();
    }

    await expect(feedbackCard).toBeVisible();
    await expect(
      feedbackCard.getByText(improvement),
    ).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.patient.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/me/feedback`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        comments: string | null;
        improvement_notes: string | null;
        source: string;
        status: string;
      }>;
      const submitted = items.find(
        (item) =>
          item.comments === comment && item.improvement_notes === improvement,
      );
      expect(submitted).toBeDefined();
      expect(submitted!.source).toBe("patient_portal");
    }).toPass({ timeout: 15_000 });
  });
});
