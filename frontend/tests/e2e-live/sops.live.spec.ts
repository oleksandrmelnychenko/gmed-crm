import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

test.describe("SOP live workflows", () => {
  test("patient manager creates an interpreter SOP, CEO approves it and the interpreter acknowledges it", async ({
    browser,
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    const sopTitle = `Live SOP ${scenario.tag}`;
    const sopSummary = `Interpreter briefing standard ${scenario.tag}`;
    const sopBody = `1. Review the case brief for ${scenario.patient.name}.\n2. Confirm glossary coverage.\n3. Upload the report before billing handoff.`;

    await loginViaApi(
      page,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await page.goto("/sops");
    await expect(
      page.getByRole("heading", { name: /SOP & learning/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New content" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    const createTextboxes = createDialog.getByRole("textbox");
    await createTextboxes.nth(0).fill(sopTitle);
    await createTextboxes.nth(1).fill(sopSummary);
    await createTextboxes.nth(2).fill(sopBody);
    await createDialog
      .getByRole("checkbox", { name: /^(Dolmetscher|Interpreter)$/i })
      .check();
    const requiresAckCheckbox = createDialog.getByRole("checkbox", {
      name: /acknowledgement-relevant/i,
    });
    await requiresAckCheckbox.scrollIntoViewIfNeeded();
    await requiresAckCheckbox.check();
    await createDialog
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.requestSubmit());

    await expect(createDialog).toHaveCount(0);
    await expect(page.getByText("Learning content created.")).toBeVisible();

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    let sopId = "";
    await expect(async () => {
      const response = await request.get(`${pmApi.backendUrl}/api/v1/sops`, {
        headers: pmApi.headers,
      });
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        id: string;
        title: string;
        status: string;
        can_edit: boolean;
      }>;
      const created = items.find((item) => item.title === sopTitle);
      expect(created).toBeDefined();
      expect(created!.status).toBe("pending_approval");
      expect(created!.can_edit).toBe(true);
      sopId = created!.id;
    }).toPass({ timeout: 15_000 });

    const baseUrl = new URL(page.url()).origin;
    const ceoContext = await browser.newContext({ baseURL: baseUrl });
    const ceoPage = await ceoContext.newPage();
    await setGermanLanguage(ceoPage);
    await loginViaApi(
      ceoPage,
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    await ceoPage.goto("/sops");
    await expect(
      ceoPage.getByRole("heading", { name: /SOP & learning/i }),
    ).toBeVisible();

    const reviewQueueCard = ceoPage.locator("article").filter({ hasText: sopTitle }).first();
    await expect(reviewQueueCard).toBeVisible();
    await reviewQueueCard.getByRole("button", { name: /^Review$/i }).click();

    const reviewDialog = ceoPage.getByRole("dialog");
    await expect(reviewDialog).toBeVisible();
    await reviewDialog.locator("select").first().selectOption("approve");
    await reviewDialog
      .locator("textarea")
      .fill("Approved in live browser flow.");
    await reviewDialog.getByRole("button", { name: /Save review/i }).click();
    await expect(reviewDialog).toHaveCount(0);
    await expect(ceoPage.getByText("Review decision saved.")).toBeVisible();

    await expect(async () => {
      const response = await request.get(`${pmApi.backendUrl}/api/v1/sops`, {
        headers: pmApi.headers,
      });
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        id: string;
        status: string;
        can_request_ack: boolean;
      }>;
      const approved = items.find((item) => item.id === sopId);
      expect(approved).toBeDefined();
      expect(approved!.status).toBe("approved");
      expect(approved!.can_request_ack).toBe(true);
    }).toPass({ timeout: 15_000 });

    await page.goto("/sops");
    const pmItem = page.locator("article").filter({ hasText: sopTitle }).first();
    await expect(pmItem).toBeVisible();
    await pmItem.getByRole("button", { name: /Request ack/i }).click();
    await expect(page.getByText("Acknowledgement request sent.")).toBeVisible();

    const interpreterContext = await browser.newContext({ baseURL: baseUrl });
    const interpreterPage = await interpreterContext.newPage();
    await setGermanLanguage(interpreterPage);
    await loginViaApi(
      interpreterPage,
      request,
      scenario.credentials.interpreter.email,
      scenario.credentials.password,
    );
    await interpreterPage.goto("/sops");
    const interpreterItem = interpreterPage
      .locator("article")
      .filter({ hasText: sopTitle })
      .first();
    await expect(interpreterItem).toBeVisible();
    await expect(interpreterItem.getByText("My status: pending")).toBeVisible();
    await interpreterItem.getByRole("button", { name: /^Acknowledge$/i }).click();
    await expect(interpreterPage.getByText("Acknowledgement recorded.")).toBeVisible();
    await expect(interpreterItem.getByText("My status: acknowledged")).toBeVisible();

    const interpreterApi = await authenticateApiClient(
      request,
      scenario.credentials.interpreter.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(`${interpreterApi.backendUrl}/api/v1/sops`, {
        headers: interpreterApi.headers,
      });
      expect(response.ok()).toBe(true);
      const items = (await response.json()) as Array<{
        id: string;
        status: string;
        my_ack_status?: string | null;
        title: string;
      }>;
      const acknowledged = items.find((item) => item.id === sopId);
      expect(acknowledged).toBeDefined();
      expect(acknowledged!.title).toBe(sopTitle);
      expect(acknowledged!.status).toBe("approved");
      expect(acknowledged!.my_ack_status).toBe("acknowledged");
    }).toPass({ timeout: 15_000 });

    await ceoContext.close();
    await interpreterContext.close();
  });

  test("teamlead interpreter content waits for patient-manager approval and never appears in the CEO queue", async ({
    browser,
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    const sopTitle = `Teamlead SOP ${scenario.tag}`;
    const sopSummary = `Interpreter-only escalation ${scenario.tag}`;
    const sopBody = `1. Confirm terminology before the visit.\n2. Escalate unclear logistics to the patient manager.\n3. Log unresolved issues in the interpreter handoff note.`;

    await loginViaApi(
      page,
      request,
      scenario.credentials.teamlead_interpreter.email,
      scenario.credentials.password,
    );
    await page.goto("/sops");
    await expect(
      page.getByRole("heading", { name: /SOP & learning/i }),
    ).toBeVisible();

    await page.getByRole("button", { name: "New content" }).click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    await expect(
      createDialog.getByRole("checkbox", { name: /^(Dolmetscher|Interpreter)$/i }),
    ).toBeVisible();
    await expect(
      createDialog.getByRole("checkbox", { name: /Concierge/i }),
    ).toHaveCount(0);

    const createTextboxes = createDialog.getByRole("textbox");
    await createTextboxes.nth(0).fill(sopTitle);
    await createTextboxes.nth(1).fill(sopSummary);
    await createTextboxes.nth(2).fill(sopBody);
    await createDialog
      .getByRole("checkbox", { name: /^(Dolmetscher|Interpreter)$/i })
      .check();
    const requiresAckCheckbox = createDialog.getByRole("checkbox", {
      name: /acknowledgement-relevant/i,
    });
    await createDialog
      .locator("label")
      .filter({ hasText: /acknowledgement-relevant/i })
      .evaluate((label: HTMLLabelElement) => {
        label.scrollIntoView({ block: "center" });
        label.click();
      });
    await expect(requiresAckCheckbox).toBeChecked();
    await createDialog
      .locator("form")
      .evaluate((form: HTMLFormElement) => form.requestSubmit());

    await expect(createDialog).toHaveCount(0);
    await expect(page.getByText("Learning content created.")).toBeVisible();

    const teamleadItem = page.locator("article").filter({ hasText: sopTitle }).first();
    await expect(teamleadItem).toBeVisible();
    await expect(teamleadItem.getByText(/pending approval/i)).toBeVisible();
    await expect(teamleadItem.getByText(/Patient-manager approval/i)).toBeVisible();
    await expect(teamleadItem.getByRole("button", { name: /Request ack/i })).toHaveCount(0);

    const baseUrl = new URL(page.url()).origin;

    const ceoContext = await browser.newContext({ baseURL: baseUrl });
    const ceoPage = await ceoContext.newPage();
    await setGermanLanguage(ceoPage);
    await loginViaApi(
      ceoPage,
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    await ceoPage.goto("/sops");
    await expect(
      ceoPage.getByRole("heading", { name: /SOP & learning/i }),
    ).toBeVisible();
    const ceoReviewQueueCard = ceoPage
      .locator("article")
      .filter({
        hasText: sopTitle,
        has: ceoPage.getByRole("button", { name: /^Review$/i }),
      });
    await expect(ceoReviewQueueCard).toHaveCount(0);

    const interpreterContext = await browser.newContext({ baseURL: baseUrl });
    const interpreterPage = await interpreterContext.newPage();
    await setGermanLanguage(interpreterPage);
    await loginViaApi(
      interpreterPage,
      request,
      scenario.credentials.interpreter.email,
      scenario.credentials.password,
    );
    await interpreterPage.goto("/sops");
    await expect(
      interpreterPage.locator("article").filter({ hasText: sopTitle }),
    ).toHaveCount(0);

    const pmContext = await browser.newContext({ baseURL: baseUrl });
    const pmPage = await pmContext.newPage();
    await setGermanLanguage(pmPage);
    await loginViaApi(
      pmPage,
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await pmPage.goto("/sops");
    await expect(
      pmPage.getByRole("heading", { name: /SOP & learning/i }),
    ).toBeVisible();

    const pmReviewQueueCard = pmPage.locator("article").filter({ hasText: sopTitle }).first();
    await expect(pmReviewQueueCard).toBeVisible();
    await pmReviewQueueCard.getByRole("button", { name: /^Review$/i }).click();

    const reviewDialog = pmPage.getByRole("dialog");
    await expect(reviewDialog).toBeVisible();
    await reviewDialog.locator("select").first().selectOption("approve");
    await reviewDialog
      .locator("textarea")
      .fill("Approved by patient manager in live browser flow.");
    await reviewDialog.getByRole("button", { name: /Save review/i }).click();
    await expect(reviewDialog).toHaveCount(0);
    await expect(pmPage.getByText("Review decision saved.")).toBeVisible();

    const approvedPmItem = pmPage.locator("article").filter({ hasText: sopTitle }).first();
    await expect(approvedPmItem).toBeVisible();
    await expect(approvedPmItem.getByText(/^approved$/i)).toBeVisible();
    await approvedPmItem.getByRole("button", { name: /Request ack/i }).click();
    await expect(pmPage.getByText("Acknowledgement request sent.")).toBeVisible();

    await interpreterPage.goto("/sops");
    const interpreterItem = interpreterPage
      .locator("article")
      .filter({ hasText: sopTitle })
      .first();
    await expect(interpreterItem).toBeVisible();
    await expect(interpreterItem.getByText("My status: pending")).toBeVisible();
    await interpreterItem.getByRole("button", { name: /^Acknowledge$/i }).click();
    await expect(interpreterPage.getByText("Acknowledgement recorded.")).toBeVisible();
    await expect(interpreterItem.getByText("My status: acknowledged")).toBeVisible();

    await ceoContext.close();
    await interpreterContext.close();
    await pmContext.close();
  });
});
