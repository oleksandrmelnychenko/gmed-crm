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

    const blockedCard = page.getByRole("row").filter({
      hasText: scenario.leads.blocked.name,
    }).first();
    const readyCard = page.getByRole("row").filter({
      hasText: scenario.leads.ready.name,
    }).first();

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
    await expect(
      page.getByRole("button", { name: /Dokumente öffnen|Open documents/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Verträge öffnen|Open contracts/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Rechnungen öffnen|Open invoices/i }),
    ).toBeVisible();

    await page
      .locator('[data-workspace-rail="patient"]')
      .getByRole("link", { name: /Verträge|Contracts/i })
      .click();
    await expect(page.getByText(scenario.contract.contract_number)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Öffnen$|^Open$/i }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Neuer Vertrag|New contract/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Status aktualisieren|Update status/i })).toHaveCount(0);

    await page
      .locator('[data-workspace-rail="patient"]')
      .getByRole("link", { name: /Rechnungen|Invoices/i })
      .click();
    await expect(page.getByText(scenario.invoice.invoice_number)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Öffnen$|^Open$/i }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Billing verwalten|Manage billing/i })).toHaveCount(0);
  });

  test("ceo assistant can inspect released document share and translation history without mutation controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "assistant");

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const shareResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/${scenario.documents.provider_ready.id}/shares`,
      {
        headers: pmApi.headers,
        data: {
          shared_with_provider_id: SEEDED_MEDICAL_PROVIDER_ID,
          channel: "email",
          message: "Read-only provider share trail for executive review.",
          requires_confirmation: false,
        },
      },
    );
    expect(shareResponse.ok()).toBe(true);

    const translationCreateResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/${scenario.documents.released.id}/translation-requests`,
      {
        headers: pmApi.headers,
        data: {
          requested_language: "en",
          note: "Read-only translation history note for executive review.",
        },
      },
    );
    expect(translationCreateResponse.ok()).toBe(true);
    const translationRequest = (await translationCreateResponse.json()) as {
      id: string;
    };

    const translationUpdateResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/translation-requests/${translationRequest.id}/update`,
      {
        headers: pmApi.headers,
        data: {
          status: "completed",
          note: "Completed translation for executive read-only inspection.",
          translated_text: "Patient-safe English summary for executive review.",
        },
      },
    );
    expect(translationUpdateResponse.ok()).toBe(true);

    await openDocumentSheet(page, scenario.documents.provider_ready.title);

    const shareSheet = page.getByRole("dialog");
    await expect(
      shareSheet.getByText("Provider · Charite Universitaetsmedizin Berlin"),
    ).toBeVisible();
    await expect(
      shareSheet.getByText("Read-only provider share trail for executive review."),
    ).toBeVisible();
    await expect(
      shareSheet.getByRole("button", { name: /^Widerrufen$|^Revoke$/i }),
    ).toHaveCount(0);
    await expect(
      shareSheet.getByRole("button", {
        name: /Freigabe erstellen|Create share/i,
      }),
    ).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(shareSheet).toHaveCount(0);

    await openDocumentSheet(page, scenario.documents.released.title);

    const translationSheet = page.getByRole("dialog");
    await expect(
      translationSheet.getByText(
        "Completed translation for executive read-only inspection.",
      ),
    ).toBeVisible();
    await expect(
      translationSheet.getByText(
        "Patient-safe English summary for executive review.",
      ),
    ).toBeVisible();
    await expect(
      translationSheet.getByRole("button", {
        name: /Übersetzung anfordern|Request translation/i,
      }),
    ).toHaveCount(0);
    await expect(
      translationSheet.getByRole("button", { name: /^Starten$|^Start$/i }),
    ).toHaveCount(0);
    await expect(
      translationSheet.getByRole("button", {
        name: /Abschließen|Complete/i,
      }),
    ).toHaveCount(0);
    await expect(
      translationSheet.getByRole("button", {
        name: /Abbrechen|Cancel/i,
      }),
    ).toHaveCount(0);
    await expect(
      translationSheet.getByRole("button", {
        name: /Workspace speichern|Save workspace/i,
      }),
    ).toHaveCount(0);
  });

  test("interpreter can request document translation but cannot access share portal or translation-status controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "interpreter");

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const translationCreateResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/${scenario.documents.released.id}/translation-requests`,
      {
        headers: pmApi.headers,
        data: {
          requested_language: "en",
          note: "Interpreter shell should stay request-only for translation handling.",
        },
      },
    );
    expect(translationCreateResponse.ok()).toBe(true);

    await openDocumentSheet(page, scenario.documents.released.title);

    const sheet = page.getByRole("dialog");
    await expect(
      sheet.getByText(
        "Nur CEO und Patientenmanager dürfen Dokumente ins Patientenportal veröffentlichen.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: /Ins Patientenportal freigeben|Release to portal/i,
      }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Portalfreigabe widerrufen|Revoke portal release/i,
      }),
    ).toHaveCount(0);
    await expect(
      sheet.getByText("Teilen", { exact: true }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Übersetzung anfordern|Request translation/i,
      }),
    ).toBeVisible();
    await expect(
      sheet.getByText(
        "Interpreter shell should stay request-only for translation handling.",
      ),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /^Starten$|^Start$/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Abschließen|Complete/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Abbrechen|Cancel/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Workspace speichern|Save workspace/i,
      }),
    ).toHaveCount(0);
  });

  test("concierge can run translation workflow without provider-share or portal controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "concierge");

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const conciergeDocumentTitle = `Concierge translation packet ${scenario.tag}`;
    const uploadResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/upload`,
      {
        headers: pmApi.headers,
        multipart: {
          patient_id: scenario.patient.id,
          auto_name: conciergeDocumentTitle,
          art: "concierge_service_note",
          category: "service",
          status: "active",
          visibility: "released_internal",
          is_medical: "false",
          file: {
            name: `concierge-translation-${scenario.tag}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from("Concierge-accessible released document for translation workflow."),
          },
        },
      },
    );
    expect(uploadResponse.ok()).toBe(true);
    const conciergeDocument = (await uploadResponse.json()) as { id: string };

    const assignConciergeResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/patients/${scenario.patient.id}/assign`,
      {
        headers: pmApi.headers,
        data: {
          user_id: scenario.credentials.concierge.user_id,
        },
      },
    );
    expect(assignConciergeResponse.ok()).toBe(true);

    const translationCreateResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/${conciergeDocument.id}/translation-requests`,
      {
        headers: pmApi.headers,
        data: {
          requested_language: "en",
          note: "Concierge can process translation workflow but must not access provider-share or portal controls.",
        },
      },
    );
    expect(translationCreateResponse.ok()).toBe(true);

    await page.goto(`/documents?document=${conciergeDocument.id}`);
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: conciergeDocumentTitle }).first(),
    ).toBeVisible();
    await expect(
      sheet.getByText(
        "Nur CEO und Patientenmanager dürfen Dokumente ins Patientenportal veröffentlichen.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: /Ins Patientenportal freigeben|Release to portal/i,
      }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Portalfreigabe widerrufen|Revoke portal release/i,
      }),
    ).toHaveCount(0);
    await expect(
      sheet.getByText("Teilen", { exact: true }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Übersetzung anfordern|Request translation/i,
      }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /^Starten$|^Start$/i }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Abschließen|Complete/i }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Abbrechen|Cancel/i }),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: /Workspace speichern|Save workspace/i,
      }),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /^Starten$|^Start$/i }).click();
    await expect(
      page.locator('[role="status"]').filter({
        hasText: /als In Bearbeitung markiert|marked as In Progress/i,
      }),
    ).toBeVisible();
    await expect(sheet.getByText("In Bearbeitung", { exact: true })).toBeVisible();
  });

  test("billing can inspect financial documents but not medical ones and gets no document mutation controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "billing");

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const financialTitle = `Billing invoice packet ${scenario.tag}`;
    const medicalTitle = `Billing hidden medical packet ${scenario.tag}`;

    const financialUploadResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/upload`,
      {
        headers: pmApi.headers,
        multipart: {
          patient_id: scenario.patient.id,
          appointment_id: scenario.appointment.id,
          auto_name: financialTitle,
          art: "invoice",
          category: "billing",
          status: "active",
          visibility: "internal",
          is_medical: "false",
          file: {
            name: `billing-invoice-${scenario.tag}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from("Invoice-like financial document for billing shell proof."),
          },
        },
      },
    );
    expect(financialUploadResponse.ok()).toBe(true);

    const medicalUploadResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/documents/upload`,
      {
        headers: pmApi.headers,
        multipart: {
          patient_id: scenario.patient.id,
          appointment_id: scenario.appointment.id,
          auto_name: medicalTitle,
          art: "medical_report",
          category: "medical",
          status: "active",
          visibility: "released_internal",
          is_medical: "true",
          file: {
            name: `billing-medical-${scenario.tag}.txt`,
            mimeType: "text/plain",
            buffer: Buffer.from("Medical document that billing must not see."),
          },
        },
      },
    );
    expect(medicalUploadResponse.ok()).toBe(true);

    await page.goto(`/documents?patient=${scenario.patient.id}`);
    await expect(page.getByText(financialTitle).first()).toBeVisible();
    await expect(page.getByText(medicalTitle)).toHaveCount(0);

    await page.getByText(financialTitle).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: financialTitle }).first(),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Übersetzung anfordern|Request translation/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByText("Teilen", { exact: true }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Ins Patientenportal freigeben|Release to portal/i,
      }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", {
        name: /Portalfreigabe widerrufen|Revoke portal release/i,
      }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Metadaten speichern|Save metadata/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByRole("button", { name: /Datei löschen|Delete file/i }),
    ).toHaveCount(0);
    await expect(
      sheet.getByText(
        "Nur CEO und Patientenmanager dürfen Dokumente ins Patientenportal veröffentlichen.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", { name: /Herunterladen|Download/i }),
    ).toBeVisible();
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
    await expect(page.getByRole("tab", { name: /Vorlagen|Templates/i })).toBeVisible();
    await page.getByRole("tab", { name: /Vorlagen|Templates/i }).click();
    const templatePanel = page.getByRole("tabpanel", { name: /Vorlagen|Templates/i });
    await expect(
      templatePanel.getByRole("heading", { name: /Klinikvorlagen|Clinic templates/i }),
    ).toBeVisible();

    await templatePanel.getByRole("button", { name: /Neue Vorlage|New template/i }).click();
    const createTemplateHeading = templatePanel.getByRole("heading", {
      name: /Vorlage erstellen|Create template/i,
    });
    if (!(await createTemplateHeading.isVisible().catch(() => false))) {
      const resetButton = templatePanel.getByRole("button", { name: /Zurücksetzen|Reset/i });
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
        name: /Automatisch senden, wenn der Termin bestätigt ist|Auto-send when appointment is confirmed/i,
      })
      .check();
    await templatePanel
      .getByPlaceholder(/Platzhalter wie|Use placeholders like/i)
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
      .getByRole("button", { name: /Vorlage erstellen|Create template/i })
      .click();
    expect((await createTemplateResponse).ok()).toBeTruthy();

    const templateCard = page.locator("button").filter({
      has: page.getByText(templateLabel),
    });
    await expect(templateCard).toBeVisible();
    await expect(
      templateCard.getByText(/Automatisch bei Bestätigung senden|Auto-send on confirmation/i),
    ).toBeVisible();

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
      page.getByRole("heading", { name: /Feedback und NPS|Feedback and NPS/i }),
    ).toBeVisible();

    const feedbackCard = page
      .locator("article")
      .filter({ hasText: scenario.feedback.comments })
      .first();
    await expect(feedbackCard).toBeVisible();
    await feedbackCard.getByRole("button", { name: /^Prüfen$|^Review$/i }).click();

    const reviewSheet = page.getByRole("dialog");
    await expect(
      reviewSheet.getByRole("heading", { name: /Feedback prüfen|Review feedback/i }),
    ).toBeVisible();
    await reviewSheet
      .getByPlaceholder(/Operative Nachverfolgung oder Prüfnotiz|Operational follow-up or review note/i)
      .fill("Reviewed with the clinic manager and added to the quality follow-up list.");
    await reviewSheet.getByRole("button", { name: /Prüfung speichern|Save review/i }).click();

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
