import { expect, test } from "@playwright/test";

import { bootstrapAndLogin, setGermanLanguage } from "./support/live-helpers";

test.describe("compliance live workflows", () => {
  test("patient manager can grant consent and execute a third-party revoke request", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await page.goto(`/admin/compliance?patient=${scenario.patient.id}`);
    await expect(
      page.getByRole("heading", { name: /Compliance/i }),
    ).toBeVisible();
    await expect(page.locator("#compliance-patient-id")).toHaveValue(
      scenario.patient.id,
    );

    await page.locator("#consent-type").selectOption("third_party_sharing");
    await page
      .locator("#consent-note")
      .fill("Consent granted in the clinic for external provider sharing.");
    await page.getByRole("button", { name: /Grant consent/i }).click();

    const consentHistory = page.locator("table").first();
    await expect(consentHistory.getByText("Third-party sharing")).toBeVisible();
    await expect(
      consentHistory.getByText(
        "Consent granted in the clinic for external provider sharing.",
      ),
    ).toBeVisible();

    await page.locator("#privacy-request-type").selectOption("third_party_revoke");
    await page
      .locator("#privacy-request-reason")
      .fill("Patient withdrew all external provider sharing permissions.");
    await page.getByRole("button", { name: /Create request/i }).click();

    const privacyHistory = page.locator("table").nth(1);
    await expect(
      privacyHistory.getByText("Third-party sharing revoke"),
    ).toBeVisible();
    await expect(
      privacyHistory.getByText(
        "Patient withdrew all external provider sharing permissions.",
      ),
    ).toBeVisible();

    const queueRow = page
      .getByRole("row")
      .filter({ hasText: scenario.patient.patient_id })
      .filter({ hasText: "Third-party sharing revoke" })
      .last();

    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("button", { name: /Approve/i }).click();
    await expect(queueRow.getByText("Approved")).toBeVisible();

    await queueRow.getByRole("button", { name: /Execute/i }).click();
    await expect(queueRow.getByText("Completed")).toBeVisible();
    await expect(
      page.getByText(/"request_type": "third_party_revoke"/),
    ).toBeVisible();
    await expect(
      page.getByText(/"revoked_types": \[\s*"third_party_sharing"\s*\]/),
    ).toBeVisible();
  });
});
