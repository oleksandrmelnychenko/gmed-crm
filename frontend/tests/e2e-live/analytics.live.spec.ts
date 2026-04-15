import { expect, test, type Page } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

const REPORTS_WORKSPACE_HEADING = "Berichtsarbeitsbereich";

function reportExportSection(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading })
    .locator(
      "xpath=ancestor::*[.//button[normalize-space()='CSV exportieren']][1]",
    );
}

async function expectCsvDownloadFromSection(
  page: Page,
  heading: string,
  filename: string,
) {
  const section = reportExportSection(page, heading);
  const exportButton = section.getByRole("button", {
    name: "CSV exportieren",
  });
  await expect(exportButton).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(filename);
}

test.describe("analytics live workflows", () => {
  test("CEO can open dashboard and reports with executive analytics sections", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "CEO-Read-Model" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Risikobild Patientenmanagement" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungsrisiken" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sales-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forecast-Pipeline" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forderungs-Forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Follow-up-Forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Länderbericht" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Arzt-Drill-down" }),
    ).toBeVisible();
  });

  test("CEO assistant can open dashboard and reports in executive read mode", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.assistant.email,
      scenario.credentials.password,
    );

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "CEO-Read-Model" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Risikobild Patientenmanagement" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungsrisiken" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sales-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forecast-Pipeline" }),
    ).toBeVisible();
  });

  test("CEO assistant can export executive reports in read-only mode", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.assistant.email,
      scenario.credentials.password,
    );

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Klinikbericht" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Arzt-Drill-down" }),
    ).toBeVisible();

    await expectCsvDownloadFromSection(page, "Klinikbericht", "clinic-report.csv");
    await expectCsvDownloadFromSection(page, "Arzt-Drill-down", "doctor-report.csv");
  });

  test("sales can open sales-safe reports without restricted executive sections", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.sales.email,
      scenario.credentials.password,
    );

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sales-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Leistung medizinischer Anbieter" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Länderbericht" }),
    ).toBeVisible();

    await expectCsvDownloadFromSection(
      page,
      "Leistung medizinischer Anbieter",
      "medical-provider-report.csv",
    );
    await expectCsvDownloadFromSection(
      page,
      "Länderbericht",
      "country-report.csv",
    );

    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Arzt-Drill-down" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Forderungs-Forecast" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Klinikbericht" }),
    ).toHaveCount(0);
  });

  test("patient manager sees own KPI dashboard and reports without executive finance sections", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Meine KPI-Karte als Patientenmanager" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Risikobild Patientenmanagement" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "CEO-Read-Model" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Abrechnungsrisiken" }),
    ).toHaveCount(0);

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forecast-Pipeline" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Follow-up-Forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Klinikauslastung nächste 30 Tage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Sales-KPI-Scorecard" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Forderungs-Forecast" }),
    ).toHaveCount(0);
  });

  test("billing sees billing analytics without patient-manager or sales sections", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.billing.email,
      scenario.credentials.password,
    );

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Abrechnungsrisiken" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "CEO-Read-Model" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Risikobild Patientenmanagement" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Meine KPI-Karte als Patientenmanager" }),
    ).toHaveCount(0);

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forderungs-Forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sales-KPI-Scorecard" }),
    ).toHaveCount(0);
  });

  test("billing can export billing-safe report sections without country or sales analytics", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);

    await loginViaApi(
      page,
      request,
      scenario.credentials.billing.email,
      scenario.credentials.password,
    );

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Arzt-Drill-down" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Kostenentwicklung Anbieter" }),
    ).toBeVisible();

    await expectCsvDownloadFromSection(
      page,
      "Arzt-Drill-down",
      "doctor-report.csv",
    );
    await expectCsvDownloadFromSection(
      page,
      "Kostenentwicklung Anbieter",
      "provider-cost-report.csv",
    );

    await expect(
      page.getByRole("heading", { name: "Länderbericht" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Sales-KPI-Scorecard" }),
    ).toHaveCount(0);
  });
});
