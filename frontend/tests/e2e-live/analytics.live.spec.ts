import { expect, test } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

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
      page.getByRole("heading", { name: "CEO read model" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Patient manager risk analysis" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Billing risk analysis" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: "Reports workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Billing KPI scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sales KPI scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forecast pipeline" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Collections forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Follow-up forecast" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Country report" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Doctor drill-down" }),
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
      page.getByRole("heading", { name: "CEO read model" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Patient manager risk analysis" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Billing risk analysis" }),
    ).toBeVisible();

    await page.goto("/reports");
    await expect(
      page.getByRole("heading", { name: "Reports workspace" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Billing KPI scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Sales KPI scorecard" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Forecast pipeline" }),
    ).toBeVisible();
  });
});
