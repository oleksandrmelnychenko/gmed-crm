import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

test.describe("feedback live workflows", () => {
  test("teamlead and concierge only see their relevant feedback rows", async ({
    browser,
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    const interpreterComment = `Interpreter scoped feedback ${scenario.tag}`;
    const conciergeComment = `Concierge scoped feedback ${scenario.tag}`;

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const assignTeamleadResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/patients/${scenario.patient.id}/assign`,
      {
        headers: pmApi.headers,
        data: { user_id: scenario.credentials.teamlead_interpreter.user_id },
      },
    );
    expect(assignTeamleadResponse.ok()).toBe(true);

    const assignConciergeResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/patients/${scenario.patient.id}/assign`,
      {
        headers: pmApi.headers,
        data: { user_id: scenario.credentials.concierge.user_id },
      },
    );
    expect(assignConciergeResponse.ok()).toBe(true);

    const interpreterFeedbackResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/feedback`,
      {
        headers: pmApi.headers,
        data: {
          patient_id: scenario.patient.id,
          appointment_id: scenario.appointment.id,
          overall_score: 4,
          patient_manager_score: 4,
          interpreter_score: 5,
          treatment_score: 4,
          doctor_score: 4,
          organization_score: 4,
          service_score: 5,
          infrastructure_score: 4,
          price_value_score: 4,
          treatment_success: "yes",
          complication_reported: false,
          nps_score: 9,
          comments: interpreterComment,
        },
      },
    );
    expect(interpreterFeedbackResponse.ok()).toBe(true);

    const conciergeFeedbackResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/feedback`,
      {
        headers: pmApi.headers,
        data: {
          patient_id: scenario.patient.id,
          overall_score: 4,
          patient_manager_score: 4,
          concierge_score: 5,
          treatment_score: 4,
          doctor_score: 4,
          organization_score: 5,
          service_score: 5,
          infrastructure_score: 4,
          price_value_score: 4,
          treatment_success: "partial",
          complication_reported: true,
          nps_score: 8,
          comments: conciergeComment,
        },
      },
    );
    expect(conciergeFeedbackResponse.ok()).toBe(true);

    const teamleadContext = await browser.newContext();
    const teamleadPage = await teamleadContext.newPage();
    await setGermanLanguage(teamleadPage);
    await loginViaApi(
      teamleadPage,
      request,
      scenario.credentials.teamlead_interpreter.email,
      scenario.credentials.password,
    );
    await teamleadPage.goto("/feedback");
    await expect(
      teamleadPage.getByRole("heading", { name: /Feedback und NPS|Feedback and NPS/i }),
    ).toBeVisible();
    const teamleadInterpreterCard = teamleadPage
      .locator("article")
      .filter({ hasText: interpreterComment })
      .first();
    await expect(teamleadInterpreterCard).toBeVisible();
    await expect(
      teamleadPage.locator("article").filter({ hasText: conciergeComment }),
    ).toHaveCount(0);
    await expect(
      teamleadInterpreterCard.getByRole("button", { name: /^(Prüfen|Review)$/i }),
    ).toBeVisible();

    const conciergeContext = await browser.newContext();
    const conciergePage = await conciergeContext.newPage();
    await setGermanLanguage(conciergePage);
    await loginViaApi(
      conciergePage,
      request,
      scenario.credentials.concierge.email,
      scenario.credentials.password,
    );
    await conciergePage.goto("/feedback");
    await expect(
      conciergePage.getByRole("heading", { name: /Feedback und NPS|Feedback and NPS/i }),
    ).toBeVisible();
    const conciergeCard = conciergePage
      .locator("article")
      .filter({ hasText: conciergeComment })
      .first();
    await expect(conciergeCard).toBeVisible();
    await expect(
      conciergePage.locator("article").filter({ hasText: interpreterComment }),
    ).toHaveCount(0);
    await expect(
      conciergeCard.getByRole("button", { name: /^(Prüfen|Review)$/i }),
    ).toBeVisible();

    await teamleadContext.close();
    await conciergeContext.close();
  });
});
