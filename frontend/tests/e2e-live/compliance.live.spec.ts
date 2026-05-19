import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

function privacyQueueRow(page: Page, requestType: RegExp, reason: string) {
  const escapedReason = reason.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = requestType.flags.replace("g", "");
  const combinedMatch = new RegExp(
    `(${requestType.source}[\\s\\S]*${escapedReason})|(${escapedReason}[\\s\\S]*${requestType.source})`,
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
  await page.getByRole("button", { name: /Schließen|Close/i }).last().click();
}

test.describe("compliance live workflows", () => {
  test("patient manager can grant consent and execute a third-party revoke request", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const consentNote =
      "Consent granted in the clinic for external provider sharing.";
    const revokeReason =
      "Patient withdrew all external provider sharing permissions.";

    await page.goto(`/admin/compliance?patient=${scenario.patient.id}`);
    await expect(
      page.getByRole("heading", { name: /DSGVO \/ Compliance|Compliance/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Details" }).first().click();
    const consentSheet = page.getByRole("dialog").last();
    await chooseSheetOption(
      page,
      consentSheet,
      /Weitergabe an Dritte|Third-party sharing/i,
    );
    await consentSheet.locator("#consent-note").fill(consentNote);
    await consentSheet
      .getByRole("button", { name: /Einwilligung erteilen|Grant consent/i })
      .click();
    await closeCurrentSheet(page);

    const consentTypeRows = page
      .getByRole("row")
      .filter({ hasText: /Weitergabe an Dritte|Third-party sharing/i });
    const consentHistoryRow = consentTypeRows.filter({ hasText: consentNote }).first();
    await expect(consentHistoryRow).toBeVisible();

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
    await requestSheet
      .getByRole("button", { name: /Antrag anlegen|Create request/i })
      .click();
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

    const pmQueueRow = privacyQueueRow(pmPage, /Löschantrag|Erasure/i, reason);

    await expect(pmQueueRow).toBeVisible();
    await expect(pmQueueRow.getByText(/Genehmigt|Approved/i)).toBeVisible();
    await expect(
      pmQueueRow.getByRole("button", { name: /Details/i }),
    ).toHaveCount(0);

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
