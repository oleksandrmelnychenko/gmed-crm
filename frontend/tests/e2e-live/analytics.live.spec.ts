import { expect, test, type Page } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

const REPORTS_WORKSPACE_HEADING = "Berichtsarbeitsbereich";
const DASHBOARD_HEADING = /Guten (Morgen|Tag|Abend),/i;
const SALES_KPI_HEADING = "Vertriebs-KPI-Ubersicht";
const PIPELINE_HEADING = "Prognose-Pipeline";
const COLLECTIONS_HEADING = "Forderungsprognose";
const FOLLOWUP_HEADING = "Nachsorge-Prognose";

function reportExportSection(page: Page, heading: string) {
  return page
    .getByRole("heading", { name: heading })
    .locator(
      "xpath=ancestor::*[.//button[contains(normalize-space(), 'CSV exportieren')]][1]",
    );
}

async function expectCsvDownloadFromSection(
  page: Page,
  heading: string,
  sectionName: string,
  filename: string,
) {
  const section = reportExportSection(page, heading);
  const exportButton = section.getByRole("button", {
    name: /CSV exportieren/i,
  });
  await expect(exportButton).toBeVisible();
  const exportResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.endsWith("/api/v1/stats/reports/export") &&
      url.searchParams.get("section") === sectionName
    );
  });
  await exportButton.click();
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.ok()).toBe(true);
  await expect
    .poll(
      () => exportResponse.headers()["content-disposition"] ?? "",
      { timeout: 5_000 },
    )
    .toContain(filename);
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
      page.getByRole("heading", { name: DASHBOARD_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Leistungsmix" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Top-Kliniken" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SALES_KPI_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: PIPELINE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: COLLECTIONS_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: FOLLOWUP_HEADING }),
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
      page.getByRole("heading", { name: DASHBOARD_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Leistungsmix" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Top-Kliniken" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SALES_KPI_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: PIPELINE_HEADING }),
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

    await expectCsvDownloadFromSection(page, "Klinikbericht", "clinics", "clinic-report.csv");
    await expectCsvDownloadFromSection(page, "Arzt-Drill-down", "doctors", "doctor-report.csv");
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
      page.getByRole("heading", { name: SALES_KPI_HEADING }),
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
      "medical_providers",
      "medical-provider-report.csv",
    );
    await expectCsvDownloadFromSection(
      page,
      "Länderbericht",
      "countries",
      "country-report.csv",
    );

    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Arzt-Drill-down" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: COLLECTIONS_HEADING }),
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
      page.getByRole("heading", { name: DASHBOARD_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Leistungsmix" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: PIPELINE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: FOLLOWUP_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Klinikauslastung nächste 30 Tage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: SALES_KPI_HEADING }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: COLLECTIONS_HEADING }),
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
      page.getByRole("heading", { name: DASHBOARD_HEADING }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: REPORTS_WORKSPACE_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abrechnungs-KPI-Scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: COLLECTIONS_HEADING }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: SALES_KPI_HEADING }),
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
      "doctors",
      "doctor-report.csv",
    );
    await expectCsvDownloadFromSection(
      page,
      "Kostenentwicklung Anbieter",
      "provider_costs",
      "provider-cost-report.csv",
    );

    await expect(
      page.getByRole("heading", { name: "Länderbericht" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: SALES_KPI_HEADING }),
    ).toHaveCount(0);
  });
});
