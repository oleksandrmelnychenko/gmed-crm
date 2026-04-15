import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

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

    await page.locator("#consent-type").selectOption("third_party_sharing");
    await page.locator("#consent-note").fill(consentNote);
    await page
      .getByRole("button", { name: /Einwilligung erteilen|Grant consent/i })
      .click();

    const consentHistory = page.locator("table").first();
    await expect(
      consentHistory.getByText(/Weitergabe an Dritte|Third-party sharing/i),
    ).toBeVisible();
    await expect(consentHistory.getByText(consentNote)).toBeVisible();

    await page
      .locator("#privacy-request-type")
      .selectOption("third_party_revoke");
    await page.locator("#privacy-request-reason").fill(revokeReason);
    await page
      .getByRole("button", { name: /Antrag anlegen|Create request/i })
      .click();

    const privacyHistory = page.locator("table").nth(1);
    await expect(
      privacyHistory.getByText(
        /Widerruf der Drittweitergabe|Third-party sharing revoke/i,
      ),
    ).toBeVisible();
    await expect(privacyHistory.getByText(revokeReason)).toBeVisible();

    const queueRow = page
      .getByRole("row")
      .filter({
        hasText: /Widerruf der Drittweitergabe|Third-party sharing revoke/i,
      })
      .filter({ hasText: revokeReason })
      .last();

    await expect(queueRow).toBeVisible();
    await queueRow
      .getByRole("button", { name: /Genehmigen|Approve/i })
      .click();
    await expect(queueRow.getByText(/Genehmigt|Approved/i)).toBeVisible();

    await queueRow
      .getByRole("button", { name: /Ausführen|Execute/i })
      .click();
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

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const ceoApi = await authenticateApiClient(
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );

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

    const queueRow = page
      .getByRole("row")
      .filter({ hasText: /Löschantrag|Erasure/i })
      .filter({ hasText: reason })
      .last();

    await expect(queueRow).toBeVisible();
    await expect(queueRow.getByText(/Angefordert|Requested/i)).toBeVisible();
    await queueRow.getByRole("button", { name: /Genehmigen|Approve/i }).click();
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

    const pmQueueRow = pmPage
      .getByRole("row")
      .filter({ hasText: /Löschantrag|Erasure/i })
      .filter({ hasText: reason })
      .last();

    await expect(pmQueueRow).toBeVisible();
    await expect(pmQueueRow.getByText(/Genehmigt|Approved/i)).toBeVisible();
    await expect(
      pmQueueRow.getByRole("button", { name: /Ausführen|Execute/i }),
    ).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await queueRow.getByRole("button", { name: /Ausführen|Execute/i }).click();
    await expect(
      page
        .getByRole("row")
        .filter({ hasText: /Löschantrag|Erasure/i })
        .filter({ hasText: reason })
        .last()
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
