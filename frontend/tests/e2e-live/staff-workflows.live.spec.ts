import { expect, test, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  setGermanLanguage,
  type BootstrapScenario,
} from "./support/live-helpers";

const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";

async function openDocumentSheet(page: Page, title: string) {
  await page.goto("/documents");
  await expect(page.getByText(title).first()).toBeVisible();
  await page.getByText(title).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

test.describe("staff live workflows", () => {
  test("patient manager sees blocked and ready convert states directly on lead cards", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await page.goto("/leads");
    await expect(page.getByText(scenario.leads.blocked.name)).toBeVisible();
    await expect(page.getByText(scenario.leads.ready.name)).toBeVisible();

    const blockedCard = page.getByRole("button", {
      name: `Open lead ${scenario.leads.blocked.name}`,
    });
    const readyCard = page.getByRole("button", {
      name: `Open lead ${scenario.leads.ready.name}`,
    });

    await blockedCard.scrollIntoViewIfNeeded();
    await readyCard.scrollIntoViewIfNeeded();

    await expect(
      blockedCard.getByRole("button", { name: "Convert", exact: true }),
    ).toBeDisabled();
    await expect(
      readyCard.getByRole("button", { name: "Convert", exact: true }),
    ).toBeEnabled();
  });

  test("ceo assistant sees only read-only commercial tabs on patient profile", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "assistant");

    await page.goto(`/patients/${scenario.patient.id}?tab=documents`);
    await page.waitForURL(
      new RegExp(`/patients/${scenario.patient.id}$`),
      { timeout: 30_000 },
    );

    await expect(
      page.getByRole("heading", { name: scenario.patient.name }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Documents" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Relations" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Workflow" })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Timeline" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open documents" })).toBeVisible();

    await page.getByRole("tab", { name: "Contracts" }).click();
    await expect(page.getByText(scenario.contract.contract_number)).toBeVisible();

    await page.getByRole("tab", { name: "Invoices" }).click();
    await expect(page.getByText(scenario.invoice.invoice_number)).toBeVisible();
  });

  test("patient manager can release and revoke a document from patient portal scope", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await openDocumentSheet(page, scenario.documents.internal.title);

    await page.getByRole("button", {
      name: /Ins Patientenportal freigeben|Выпустить в портал пациента/i,
    }).click();
    await expect(
      page.getByText(
        /Dokument ins Patientenportal freigegeben|Документ выпущен в портал пациента/i,
      ),
    ).toBeVisible();

    await page.getByRole("button", {
      name: /Portalfreigabe widerrufen|Отозвать релиз портала/i,
    }).click();
    await expect(
      page.getByRole("button", {
        name: /Ins Patientenportal freigeben|Выпустить в портал пациента/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Portalfreigabe widerrufen|Отозвать релиз портала/i,
      }),
    ).toBeDisabled();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const sharesResponse = await request.get(
        `${api.backendUrl}/api/v1/documents/${scenario.documents.internal.id}/shares`,
        { headers: api.headers },
      );
      expect(sharesResponse.ok()).toBe(true);
      const shares = (await sharesResponse.json()) as Array<{
        channel: string;
        shared_with_user_id: string | null;
        revoked_at: string | null;
      }>;
      const portalShares = shares.filter(
        (item) => item.channel === "patient_portal",
      );
      expect(portalShares.length).toBeGreaterThanOrEqual(1);
      for (const share of portalShares) {
        expect(share.shared_with_user_id).toBe(
          scenario.credentials.patient.user_id,
        );
        expect(share.revoked_at).not.toBeNull();
      }
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager can share a document with provider and revoke it with cover message", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await openDocumentSheet(page, scenario.documents.provider_ready.title);

    const sheet = page.getByRole("dialog");
    const shareForm = sheet.locator("form").last();
    await shareForm.getByRole("button", { name: /^Provider$/i }).click();
    await shareForm.locator("select").first().selectOption(
      "c0000000-0000-0000-0000-000000000001",
    );
    await shareForm
      .getByPlaceholder(/Kurzer Kontext|short context/i)
      .fill("Bitte fuer das Kardiologie-Team freigeben.");
    await shareForm
      .getByRole("button", { name: /Freigabe erstellen|Create share/i })
      .click();

    await expect(
      page.locator('[role="status"]').filter({
        hasText: /Freigabe erstellt|Share created/i,
      }),
    ).toBeVisible();
    await expect(sheet.getByText("Provider · Charite Universitaetsmedizin Berlin")).toBeVisible();
    await expect(
      sheet.getByText("Bitte fuer das Kardiologie-Team freigeben."),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /^Widerrufen$|^Revoke$/i }).click();
    await expect(
      page.locator('[role="status"]').filter({
        hasText: /Freigabe widerrufen|Share revoked/i,
      }),
    ).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const sharesResponse = await request.get(
        `${api.backendUrl}/api/v1/documents/${scenario.documents.provider_ready.id}/shares`,
        { headers: api.headers },
      );
      expect(sharesResponse.ok()).toBe(true);
      const shares = (await sharesResponse.json()) as Array<{
        channel: string;
        shared_with_provider_id: string | null;
        provider_name: string | null;
        message: string | null;
        shared_by_name: string | null;
        revoked_at: string | null;
      }>;
      const providerShare = shares.find(
        (item) =>
          item.shared_with_provider_id ===
          "c0000000-0000-0000-0000-000000000001",
      );
      expect(providerShare).toBeDefined();
      expect(providerShare!.channel).toBe("email");
      expect(providerShare!.message).toBe(
        "Bitte fuer das Kardiologie-Team freigeben.",
      );
      expect(providerShare!.provider_name).toContain("Charite");
      expect(providerShare!.shared_by_name).toBe(scenario.credentials.pm.name);
      expect(providerShare!.revoked_at).not.toBeNull();
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager can create and complete a document translation flow", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await openDocumentSheet(page, scenario.documents.internal.title);

    const sheet = page.getByRole("dialog");
    const createTranslationResponse = page.waitForResponse((nextResponse) =>
      nextResponse.url().includes(
        `/api/v1/documents/${scenario.documents.internal.id}/translation-requests`,
      ) &&
      nextResponse.request().method() === "POST",
    );
    await sheet
      .getByPlaceholder(/Umfang, Frist oder Lieferhinweise|scope, due date/i)
      .first()
      .fill("Patient-safe English version for portal handoff.");
    await sheet
      .getByRole("button", { name: /Übersetzung anfordern|Request translation/i })
      .click();
    const createdTranslationRequest = await createTranslationResponse.then(
      async (response) => response.json() as Promise<{ id: string }>,
    );

    await expect(
      page.locator('[role="status"]').filter({
        hasText: /Übersetzungsanfrage erstellt|Translation request created/i,
      }),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /^Starten$|^Start$/i }).click();
    await expect(
      page.locator('[role="status"]').filter({
        hasText: /als In Bearbeitung markiert|marked as In Progress/i,
      }),
    ).toBeVisible();

    const completionResult = await page.evaluate(
      async ({ requestId }) => {
        const token = window.localStorage.getItem("gmed_access_token");
        const response = await fetch(
          `/api/v1/documents/translation-requests/${requestId}/update`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              status: "completed",
              note: "Patient-safe English version for portal handoff.",
              translated_text: "Patient-safe English report",
            }),
          },
        );

        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      },
      { requestId: createdTranslationRequest.id },
    );
    expect(completionResult.ok, completionResult.body).toBeTruthy();

    await openDocumentSheet(page, scenario.documents.internal.title);
    const completedSheet = page.getByRole("dialog");
    await expect(
      completedSheet.getByText("Patient-safe English report"),
    ).toBeVisible();
    await expect(
      completedSheet.getByText("Patient-safe English version for portal handoff."),
    ).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/documents/${scenario.documents.internal.id}/translation-requests`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const requests = (await response.json()) as Array<{
        id: string;
        document_id: string;
        status: string;
        note: string | null;
        translated_text: string | null;
        requested_by: string;
      }>;
      const completed = requests.find(
        (item) => item.id === createdTranslationRequest.id,
      );
      expect(completed).toBeDefined();
      expect(completed!.document_id).toBe(scenario.documents.internal.id);
      expect(completed!.status).toBe("completed");
      expect(completed!.translated_text).toBe("Patient-safe English report");
      expect(completed!.note).toBe(
        "Patient-safe English version for portal handoff.",
      );
      expect(completed!.requested_by).toBe(scenario.credentials.pm.user_id);
    }).toPass({ timeout: 15_000 });
  });

  test("patient manager can create an auto-send provider template and the patient portal receives exactly one preparation document on repeated confirmation", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const templateLabel = `Live auto prep ${scenario.tag}`;
    const templateFileName = `Prep packet ${scenario.tag}`;

    await page.goto(`/providers/${SEEDED_MEDICAL_PROVIDER_ID}`);
    await expect(page.getByRole("tab", { name: "Templates" })).toBeVisible();
    await page.getByRole("tab", { name: "Templates" }).click();
    const templatePanel = page.getByRole("tabpanel", { name: "Templates" });
    await expect(templatePanel.getByRole("heading", { name: "Clinic templates" })).toBeVisible();

    await templatePanel.getByRole("button", { name: "New template" }).click();
    const createTemplateHeading = templatePanel.getByRole("heading", {
      name: "Create template",
    });
    if (!(await createTemplateHeading.isVisible().catch(() => false))) {
      const resetButton = templatePanel.getByRole("button", { name: "Reset" });
      if (await resetButton.isVisible().catch(() => false)) {
        await resetButton.click();
      }
    }
    await expect(createTemplateHeading).toBeVisible();
    const editorTextboxes = templatePanel.getByRole("textbox");
    await editorTextboxes
      .nth(0)
      .fill(templateLabel);
    await editorTextboxes
      .nth(1)
      .fill(templateFileName);
    await editorTextboxes
      .nth(2)
      .fill("Live E2E preparation template for patient portal handoff.");
    await templatePanel
      .getByRole("checkbox", {
        name: "Auto-send when appointment is confirmed",
      })
      .check();
    await templatePanel
      .getByPlaceholder(/Use placeholders like/i)
      .first()
      .fill(
        "Hallo {{patient_name}}, bitte erscheinen Sie zu {{appointment_title}} am {{appointment_date}}.",
      );

    const createTemplateResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(
          `/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}/templates`,
        ) && nextResponse.request().method() === "POST",
    );
    await templatePanel
      .getByRole("button", { name: "Create template" })
      .click();
    expect((await createTemplateResponse).ok()).toBeTruthy();

    const templateCard = page.locator("button").filter({
      has: page.getByText(templateLabel),
    });
    await expect(templateCard).toBeVisible();
    await expect(templateCard.getByText("Auto-send on confirmation")).toBeVisible();

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${pmApi.backendUrl}/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}/templates`,
        { headers: pmApi.headers },
      );
      expect(response.ok()).toBe(true);
      const templates = (await response.json()) as Array<{
        label: string;
        auto_send_on_confirmed_appointment: boolean;
      }>;
      const created = templates.find((item) => item.label === templateLabel);
      expect(created).toBeDefined();
      expect(created!.auto_send_on_confirmed_appointment).toBe(true);
    }).toPass({ timeout: 15_000 });

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
        auto_name: string;
        visibility: string;
      }>;
      const generated = documents.filter((item) =>
        item.auto_name.startsWith(templateFileName),
      );
      expect(generated).toHaveLength(1);
      expect(generated[0]!.visibility).toBe("patient_visible");
    }).toPass({ timeout: 15_000 });

  });

  test("patient manager can review portal feedback from the feedback workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario: BootstrapScenario = await bootstrapAndLogin(page, request, "pm");

    await page.goto("/feedback");
    await expect(
      page.getByRole("heading", { name: /Feedback and NPS/i }),
    ).toBeVisible();

    const feedbackCard = page
      .locator("article")
      .filter({ hasText: scenario.feedback.comments })
      .first();
    await expect(feedbackCard).toBeVisible();
    await feedbackCard.getByRole("button", { name: /^Review$/i }).click();

    const reviewSheet = page.getByRole("dialog");
    await expect(
      reviewSheet.getByRole("heading", { name: /Review feedback/i }),
    ).toBeVisible();
    await reviewSheet
      .getByPlaceholder(/Operational follow-up or review note/i)
      .fill("Reviewed with the clinic manager and added to the quality follow-up list.");
    await reviewSheet.getByRole("button", { name: /Save review/i }).click();

    await expect(reviewSheet).toHaveCount(0);
    await expect(
      feedbackCard.getByText("Reviewed with the clinic manager and added to the quality follow-up list."),
    ).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/feedback?patient_id=${scenario.patient.id}`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        id: string;
        patient_id: string;
        status: string;
        review_note: string | null;
        reviewed_by_name?: string | null;
      }>;
      const reviewed = items.find((item) => item.id === scenario.feedback.id);
      expect(reviewed).toBeDefined();
      expect(reviewed!.patient_id).toBe(scenario.patient.id);
      expect(reviewed!.status).toBe("reviewed");
      expect(reviewed!.review_note).toBe(
        "Reviewed with the clinic manager and added to the quality follow-up list.",
      );
      expect(reviewed!.reviewed_by_name).toBe(scenario.credentials.pm.name);
    }).toPass({ timeout: 15_000 });
  });
});
