import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  chooseComboboxOption,
  ensureDetailsOpen,
  openDocumentWorkspace,
  setGermanLanguage,
  type BootstrapScenario,
} from "./support/live-helpers";

const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";

async function openDocumentSheet(page: Page, title: string) {
  return openDocumentWorkspace(page, title);
}

async function translationRequestSurface(sheet: Locator, note: string) {
  const details = sheet.locator("details").first();
  if (await details.isVisible().catch(() => false)) {
    await ensureDetailsOpen(details);
    await expect(details.getByText(note).first()).toBeVisible();
    return details;
  }

  const grouped = sheet
    .getByRole("group")
    .filter({ hasText: /Angefordert|Requested|In Bearbeitung|In Progress|Abgeschlossen|Completed/i })
    .first();
  await expect(grouped).toBeVisible();
  if (!(await grouped.getByText(note).first().isVisible().catch(() => false))) {
    await grouped.click({ position: { x: 20, y: 20 } });
  }
  await expect(grouped.getByText(note).first()).toBeVisible();
  return grouped;
}

async function clickTranslationAction(
  page: Page,
  requestSurface: Locator,
  name: RegExp,
) {
  const scopedMenu = requestSurface
    .locator("[data-translation-action-menu]")
    .getByRole("button", { name: /Aktionen|Actions/i });
  const menu = (await scopedMenu.isVisible().catch(() => false))
    ? scopedMenu
    : requestSurface.getByRole("button", { name: /Aktionen|Actions/i }).first();

  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await page.getByRole("button", { name }).click();
    return;
  }

  await requestSurface.getByRole("button", { name }).click();
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
      blockedCard.getByRole("button", { name: /Konvertieren|Convert/i }),
    ).toBeDisabled();
    await expect(
      readyCard.getByRole("button", { name: /Konvertieren|Convert/i }),
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
    await expect(page.getByText(scenario.invoice.invoice_number).first()).toBeVisible();
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
          requested_language: "de",
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

    const shareSheet = await openDocumentSheet(
      page,
      scenario.documents.provider_ready.title,
    );
    await expect(
      shareSheet.getByText("Charite Universitaetsmedizin Berlin").first(),
    ).toBeVisible();
    await expect(
      shareSheet.getByText("Provider", { exact: true }).first(),
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

    const translationSheet = await openDocumentSheet(
      page,
      scenario.documents.released.title,
    );
    const completedTranslation = await translationRequestSurface(
      translationSheet,
      "Completed translation for executive read-only inspection.",
    );
    await expect(
      completedTranslation.getByText(
        "Patient-safe English summary for executive review.",
      ).first(),
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
          requested_language: "de",
          note: "Interpreter shell should stay request-only for translation handling.",
        },
      },
    );
    expect(translationCreateResponse.ok()).toBe(true);

    const sheet = await openDocumentSheet(page, scenario.documents.released.title);
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
    await translationRequestSurface(
      sheet,
      "Interpreter shell should stay request-only for translation handling.",
    );
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
          requested_language: "de",
          note: "Concierge can process translation workflow but must not access provider-share or portal controls.",
        },
      },
    );
    expect(translationCreateResponse.ok()).toBe(true);

    await page.goto(`/documents?document=${conciergeDocument.id}`);
    const sheet = page.locator("main");
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
    const conciergeRequest = await translationRequestSurface(
      sheet,
      "Concierge can process translation workflow but must not access provider-share or portal controls.",
    );
    await expect(
      conciergeRequest.getByRole("button", { name: /Aktionen|Actions/i }).first(),
    ).toBeVisible();
    await expect(
      sheet.getByRole("button", {
        name: /Workspace speichern|Save workspace/i,
      }),
    ).toBeVisible();

    await clickTranslationAction(page, conciergeRequest, /^Starten$|^Start$/i);
    await expect(conciergeRequest.getByText(/In Bearbeitung|In Progress/i).first()).toBeVisible();
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

    const financialRow = page.getByRole("row", { name: new RegExp(financialTitle, "i") }).first();
    if (await financialRow.isVisible().catch(() => false)) {
      await financialRow.click();
    } else {
      await page.getByText(financialTitle).first().click();
    }
    const sheet = page.locator("main");
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

    const workspace = await openDocumentSheet(page, scenario.documents.internal.title);

    await workspace.getByRole("button", {
      name: /Ins Patientenportal freigeben|Release to portal/i,
    }).click();
    await expect(
      workspace.getByText(/Für Patienten sichtbar|Visible to patient/i),
    ).toBeVisible();
    await expect(
      workspace.getByRole("button", {
        name: /Portalfreigabe widerrufen|Revoke portal release/i,
      }),
    ).toBeEnabled();

    await workspace.getByRole("button", {
      name: /Portalfreigabe widerrufen|Revoke portal release/i,
    }).click();
    await expect(
      workspace.getByRole("button", {
        name: /Ins Patientenportal freigeben|Release to portal/i,
      }),
    ).toBeVisible();
    await expect(
      workspace.getByRole("button", {
        name: /Portalfreigabe widerrufen|Revoke portal release/i,
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

    const sheet = await openDocumentSheet(page, scenario.documents.provider_ready.title);

    await sheet.getByRole("button", { name: /Freigabe erstellen|Create share/i }).click();
    const shareForm = page.getByRole("dialog", {
      name: /Freigabe erstellen|Create share/i,
    });
    await expect(shareForm).toBeVisible();
    await shareForm.getByRole("button", { name: /^Provider$/i }).click();
    await chooseComboboxOption(
      page,
      shareForm.getByRole("combobox", { name: /Provider auswählen/i }),
      /Charite Universitaetsmedizin Berlin/i,
    );
    await shareForm
      .getByPlaceholder(/Kurzer Kontext|short context/i)
      .fill("Bitte fuer das Kardiologie-Team freigeben.");
    await shareForm
      .getByRole("button", { name: /Freigabe erstellen|Create share/i })
      .click();

    await expect(sheet.getByText("Charite Universitaetsmedizin Berlin").first()).toBeVisible();
    await expect(sheet.getByText("Provider", { exact: true }).first()).toBeVisible();
    await expect(
      sheet.getByText("Bitte fuer das Kardiologie-Team freigeben."),
    ).toBeVisible();

    await sheet.getByRole("button", { name: /^Widerrufen$|^Revoke$/i }).click();

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

    const sheet = await openDocumentSheet(page, scenario.documents.internal.title);
    const createTranslationResponse = page.waitForResponse((nextResponse) =>
      nextResponse.url().includes(
        `/api/v1/documents/${scenario.documents.internal.id}/translation-requests`,
      ) &&
      nextResponse.request().method() === "POST",
    );
    await sheet
      .getByRole("button", { name: /Übersetzung anfordern|Request translation/i })
      .click();
    const requestDialog = page.getByRole("dialog", {
      name: /Übersetzung anfordern|Request translation/i,
    });
    await expect(requestDialog).toBeVisible();
    await chooseComboboxOption(
      page,
      requestDialog.getByRole("combobox").first(),
      /Deutsch|German/i,
    );
    await requestDialog
      .getByPlaceholder(/Umfang, Frist oder Lieferhinweise|scope, due date/i)
      .first()
      .fill("Patient-safe English version for portal handoff.");
    await requestDialog
      .getByRole("button", { name: /Übersetzung anfordern|Request translation/i })
      .click();
    const [createdTranslationRequest, translationRequest] = await Promise.all([
      createTranslationResponse.then(
        async (response) => response.json() as Promise<{ id: string }>,
      ),
      translationRequestSurface(
        sheet,
        "Patient-safe English version for portal handoff.",
      ),
    ]);
    await clickTranslationAction(page, translationRequest, /^Starten$|^Start$/i);
    await expect(translationRequest.getByText(/In Bearbeitung|In Progress/i).first()).toBeVisible();

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

    const completedSheet = await openDocumentSheet(
      page,
      scenario.documents.internal.title,
    );
    const completedRequest = await translationRequestSurface(
      completedSheet,
      "Patient-safe English version for portal handoff.",
    );
    await expect(
      completedRequest.getByText("Patient-safe English report").first(),
    ).toBeVisible();
    await expect(
      completedRequest.getByText("Patient-safe English version for portal handoff.").first(),
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
          description: "Live E2E preparation template for patient portal handoff.",
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
          notes: "Live E2E provider template proof",
          auto_send_on_confirmed_appointment: true,
        },
      },
    );
    expect(createTemplateResponse.ok()).toBe(true);
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

    const statusResponses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request.post(
          `${pmApi.backendUrl}/api/v1/appointments/${scenario.appointment.id}/status`,
          {
            headers: pmApi.headers,
            data: { status: "confirmed" },
          },
        ),
      ),
    );
    for (const response of statusResponses) {
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

    const patientFeedbackRows = page
      .getByRole("row")
      .filter({ hasText: scenario.patient.patient_id });
    const portalFeedbackRows = patientFeedbackRows.filter({
      hasText: /Patientenportal|Patient portal/i,
    });
    const feedbackRow = portalFeedbackRows.filter({ hasText: "9" }).first();
    await expect(feedbackRow).toBeVisible();
    await feedbackRow.click();

    const reviewSheet = page.getByRole("dialog");
    await expect(
      reviewSheet.getByRole("heading", { name: /Feedback prüfen|Review feedback/i }),
    ).toBeVisible();
    await expect(reviewSheet.getByText(scenario.feedback.comments)).toBeVisible();
    await reviewSheet
      .getByPlaceholder(/Operative Nachverfolgung oder Prüfnotiz|Operational follow-up or review note/i)
      .fill("Reviewed with the clinic manager and added to the quality follow-up list.");
    await reviewSheet.getByRole("button", { name: /Prüfung speichern|Save review/i }).click();

    await expect(reviewSheet).toHaveCount(0);
    const reviewedPatientRows = page
      .getByRole("row")
      .filter({ hasText: scenario.patient.patient_id });
    const reviewedRow = reviewedPatientRows
      .filter({ hasText: /Geprüft|Reviewed/i })
      .first();
    await expect(reviewedRow).toBeVisible();
    await reviewedRow.click();
    const reviewedSheet = page.getByRole("dialog");
    await expect(
      reviewedSheet.getByRole("textbox", { name: /Review-Notiz|Review note/i }),
    ).toHaveValue("Reviewed with the clinic manager and added to the quality follow-up list.");

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
