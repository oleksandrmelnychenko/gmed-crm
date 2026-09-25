import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

test.describe("case live workflows", () => {
  // The clinical workflow moved from /cases to the patient's clinical tab; legacy
  // case links only redirect there.
  test("a legacy case link opens the patient clinical tab where the patient manager records a new anamnesis version", async ({
    page,
    request,
    browser,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const createCaseResponse = await request.post(
      `${api.backendUrl}/api/v1/cases`,
      {
        headers: api.headers,
        data: {
          patient_id: scenario.patient.id,
          hauptanfragegrund: `Belastungsdyspnoe ${scenario.tag}`,
          aktuelle_anamnese: "",
          zuweiser: "Dr. Live E2E",
        },
      },
    );
    expect(createCaseResponse.ok(), await createCaseResponse.text()).toBeTruthy();
    const createdCase = (await createCaseResponse.json()) as { id: string };

    // /cases is a CEO-only route; the CEO's legacy case link resolves the patient.
    const ceoContext = await browser.newContext();
    try {
      const ceoPage = await ceoContext.newPage();
      await setGermanLanguage(ceoPage);
      await loginViaApi(
        ceoPage,
        request,
        scenario.credentials.ceo.email,
        scenario.credentials.password,
      );
      await ceoPage.goto(`/cases?case=${createdCase.id}`);
      await expect
        .poll(() => {
          const url = new URL(ceoPage.url());
          return `${url.pathname}?tab=${url.searchParams.get("tab") ?? ""}`;
        })
        .toBe(`/patients/${scenario.patient.id}?tab=clinical`);
    } finally {
      await ceoContext.close();
    }

    await page.goto(`/patients/${scenario.patient.id}?tab=clinical`);

    const anamnesisHeading = page.getByRole("heading", {
      name: /^Anamnese$/,
      level: 3,
    });
    await expect(anamnesisHeading).toBeVisible();
    const anamnesisBlock = anamnesisHeading.locator(
      "xpath=ancestor::*[.//button[normalize-space()='Neue Version']][1]",
    );
    await anamnesisBlock.getByRole("button", { name: "Neue Version" }).click();

    const versionSheet = page.getByRole("dialog", {
      name: "Neue Version: Anamnese",
    });
    await expect(versionSheet).toBeVisible();
    const narrative = `Patient ${scenario.patient.name} berichtet über Belastungsdyspnoe (${scenario.tag}).`;
    await versionSheet
      .getByRole("textbox", { name: "Aktuelle Anamnese" })
      .fill(narrative);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes(`/api/v1/patients/${scenario.patient.id}/narrative`),
    );
    await versionSheet.getByRole("button", { name: /^Speichern$/ }).click();
    expect((await saved).ok()).toBe(true);
    await expect(versionSheet).toBeHidden({ timeout: 15_000 });

    await expect(page.getByText(narrative).first()).toBeVisible();
    await expect(page.getByText("Aktive Version").first()).toBeVisible();

    await expect(async () => {
      const clinicalResponse = await request.get(
        `${api.backendUrl}/api/v1/patients/${scenario.patient.id}/clinical`,
        { headers: api.headers },
      );
      expect(clinicalResponse.ok()).toBe(true);
      const clinical = (await clinicalResponse.json()) as {
        narrative: { anamnese_aktuelle: string | null; is_active: boolean } | null;
      };
      expect(clinical.narrative?.anamnese_aktuelle).toBe(narrative);
      expect(clinical.narrative?.is_active).toBe(true);
    }).toPass({ timeout: 15_000 });
  });
});
