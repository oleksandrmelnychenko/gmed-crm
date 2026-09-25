import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  bootstrapFullSmokeScenario,
  expectPageHeading,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

function privacyQueueRow(page: Page, requestType: RegExp, reason: string) {
  const escapedReason = reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = requestType.flags.replace("g", "");
  // Group the type alternation, otherwise "A|B[..]reason" matches any row with A.
  const combinedMatch = new RegExp(
    `((?:${requestType.source})[\\s\\S]*${escapedReason})|(${escapedReason}[\\s\\S]*(?:${requestType.source}))`,
    flags,
  );
  return page
    .getByRole("row")
    .filter({ hasText: combinedMatch })
    .last();
}

async function chooseSheetOption(page: Page, sheet: Locator, option: RegExp) {
  await sheet.getByRole("combobox").first().click();
  await page.getByRole("option", { name: option }).click();
}

async function openQueueReviewSheet(page: Page, row: Locator) {
  await row.getByRole("button", { name: /Details/i }).click();
  const sheet = page.getByRole("dialog").last();
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeCurrentSheet(page: Page) {
  const sheet = page.getByRole("dialog").last();
  await page.getByRole("button", { name: /Schließen|Close/i }).last().click();
  // The request sheet stays open after "Antrag anlegen" and keeps the chosen
  // type, so closing it asks to discard; nothing unsaved is left at this point.
  const discard = page.getByRole("alertdialog", { name: /Ohne Speichern schließen\?/i });
  const asked = await discard
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (asked) {
    await discard.getByRole("button", { name: /^OK$/ }).click();
  }
  await expect(sheet).toBeHidden();
}

test.describe("compliance live workflows", () => {
  // /admin/compliance is a CEO workspace; patient managers are redirected away.
  test("ceo records a patient consent on the compliance page", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "ceo");
    const consentNote = `Consent granted in the clinic for external provider sharing ${scenario.tag}.`;

    await page.goto(`/admin/compliance?patient=${scenario.patient.id}`);
    await expectPageHeading(page, /DSGVO \/ Compliance|Compliance/i);

    await expect(
      page.getByRole("heading", { name: "Einwilligungen des Patienten" }),
      "the patient consent section is rendered once",
    ).toHaveCount(1);
    // Consents are recorded inline: type, note, "Als erteilt erfassen".
    const consentsList = page.getByTestId("patient-consents");
    const consentForm = consentsList.locator("xpath=..");
    await consentForm.locator("#consent-type").selectOption("third_party_sharing");
    await consentForm.locator("#consent-note").fill(consentNote);
    await consentForm
      .getByRole("button", { name: /Als erteilt erfassen|Grant consent/i })
      .click();
    const consentEntry = consentsList.locator("div").filter({ hasText: consentNote }).last();
    await expect(consentEntry).toBeVisible();
    await expect(consentEntry.getByText(/^Weitergabe an Dritte$/)).toBeVisible();
    await expect(consentEntry.getByText(/^aktiv$/i)).toBeVisible();

    const api = await authenticateApiClient(
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    const consentsResponse = await request.get(
      `${api.backendUrl}/api/v1/admin/compliance/patient/${scenario.patient.id}/consents`,
      { headers: api.headers },
    );
    expect(consentsResponse.ok()).toBe(true);
    const consents = (await consentsResponse.json()) as Array<{
      consent_type: string;
      granted: boolean;
      note: string | null;
    }>;
    expect(
      consents.some(
        (consent) =>
          consent.consent_type === "third_party_sharing" &&
          consent.granted &&
          consent.note === consentNote,
      ),
    ).toBe(true);
  });

  test("ceo approves and executes a third-party revoke request", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "ceo");
    const revokeReason = `Patient withdrew all external provider sharing permissions ${scenario.tag}.`;
    const api = await authenticateApiClient(
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    const grantResponse = await request.post(
      `${api.backendUrl}/api/v1/admin/compliance/patient/${scenario.patient.id}/consents`,
      {
        headers: api.headers,
        data: {
          consent_type: "third_party_sharing",
          action: "grant",
          note: "Consent granted in the clinic for external provider sharing.",
        },
      },
    );
    expect(grantResponse.ok(), await grantResponse.text()).toBe(true);

    await page.goto(`/admin/compliance?patient=${scenario.patient.id}`);
    await expectPageHeading(page, /DSGVO \/ Compliance|Compliance/i);

    await page
      .getByRole("button", { name: /Antrag anlegen|Create request/i })
      .click();
    const requestSheet = page.getByRole("dialog").last();
    await chooseSheetOption(
      page,
      requestSheet,
      /Widerruf der Drittweitergabe|Third-party sharing revoke/i,
    );
    await requestSheet.locator("#privacy-request-reason").fill(revokeReason);
    const createdRequest = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .includes(`/admin/compliance/patient/${scenario.patient.id}/privacy-requests`),
    );
    await requestSheet
      .getByRole("button", { name: /Antrag anlegen|Create request/i })
      .click();
    expect((await createdRequest).ok()).toBe(true);
    await closeCurrentSheet(page);

    const privacyRequestRows = page.getByRole("row").filter({
      hasText: /Widerruf der Drittweitergabe|Third-party sharing revoke/i,
    });
    const privacyHistoryRow = privacyRequestRows
      .filter({ hasText: revokeReason })
      .first();
    await expect(privacyHistoryRow).toBeVisible();

    const queueRow = privacyQueueRow(
      page,
      /Widerruf der Drittweitergabe|Third-party sharing revoke/i,
      revokeReason,
    );

    await expect(queueRow).toBeVisible();
    let reviewSheet = await openQueueReviewSheet(page, queueRow);
    await reviewSheet.getByRole("button", { name: /Genehmigen|Approve/i }).click();
    await expect(queueRow.getByText(/Genehmigt|Approved/i)).toBeVisible();

    reviewSheet = await openQueueReviewSheet(page, queueRow);
    await reviewSheet.getByRole("button", { name: /Ausführen|Execute/i }).click();
    await expect(queueRow.getByText(/Abgeschlossen|Completed/i)).toBeVisible();
    await expect(
      page.getByText(/"request_type": "third_party_revoke"/),
    ).toBeVisible();
    await expect(
      page.getByText(/"revoked_types": \[\s*"third_party_sharing"\s*\]/),
    ).toBeVisible();
  });

  test("ceo can approve and execute an erasure request while patient manager gets no execute control", async ({
    browser,
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    const reason = `Browser erasure request ${scenario.tag}`;

    const [pmApi, ceoApi] = await Promise.all([
      authenticateApiClient(
        request,
        scenario.credentials.pm.email,
        scenario.credentials.password,
      ),
      authenticateApiClient(
        request,
        scenario.credentials.ceo.email,
        scenario.credentials.password,
      ),
    ]);

    const createResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/admin/compliance/patient/${scenario.patient.id}/privacy-requests`,
      {
        headers: pmApi.headers,
        data: {
          request_type: "erasure",
          reason,
        },
      },
    );
    expect(createResponse.ok()).toBe(true);
    const created = (await createResponse.json()) as {
      id: string;
      request_type: string;
      status: string;
    };
    expect(created.request_type).toBe("erasure");
    expect(created.status).toBe("requested");

    await loginViaApi(
      page,
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    await page.goto(`/admin/compliance?patient=${scenario.patient.id}`);
    await expect(
      page.getByRole("heading", { name: /DSGVO \/ Compliance|Compliance/i }),
    ).toBeVisible();

    const queueRow = privacyQueueRow(page, /Löschantrag|Erasure/i, reason);

    await expect(queueRow).toBeVisible();
    await expect(queueRow.getByText(/Angefordert|Requested/i)).toBeVisible();
    let reviewSheet = await openQueueReviewSheet(page, queueRow);
    await reviewSheet.getByRole("button", { name: /Genehmigen|Approve/i }).click();
    await expect(queueRow.getByText(/Genehmigt|Approved/i)).toBeVisible();

    // The patient manager neither reaches the compliance workspace nor may
    // execute an erasure through the API.
    const baseUrl = new URL(page.url()).origin;
    const pmContext = await browser.newContext({ baseURL: baseUrl });
    const pmPage = await pmContext.newPage();
    await setGermanLanguage(pmPage);
    await loginViaApi(
      pmPage,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await pmPage.goto(`/admin/compliance?patient=${scenario.patient.id}`);
    await expect(pmPage).not.toHaveURL(/\/admin\/compliance/);
    const pmExecute = await request.post(
      `${pmApi.backendUrl}/api/v1/admin/compliance/privacy-requests/${created.id}/execute`,
      { headers: pmApi.headers, data: {} },
    );
    expect(pmExecute.status(), await pmExecute.text()).toBe(403);

    page.once("dialog", (dialog) => dialog.accept());
    reviewSheet = await openQueueReviewSheet(page, queueRow);
    await reviewSheet.getByRole("button", { name: /Ausführen|Execute/i }).click();
    await expect(
      privacyQueueRow(page, /Löschantrag|Erasure/i, reason)
        .getByText(/Abgeschlossen|Completed/i),
    ).toBeVisible();
    await expect(page.getByText(/"request_type": "erasure"/)).toBeVisible();
    await expect(page.getByText(/"mode": "erasure"/)).toBeVisible();

    await expect(async () => {
      const response = await request.get(
        `${ceoApi.backendUrl}/api/v1/admin/compliance/patient/${scenario.patient.id}/privacy-requests`,
        {
          headers: ceoApi.headers,
        },
      );
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        id: string;
        status: string;
        request_type: string;
      }>;
      const completed = items.find((item) => item.id === created.id);
      expect(completed).toBeDefined();
      expect(completed?.request_type).toBe("erasure");
      expect(completed?.status).toBe("completed");
    }).toPass({ timeout: 15_000 });

    await pmContext.close();
  });
});
