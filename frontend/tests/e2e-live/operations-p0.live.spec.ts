import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  setGermanLanguage,
} from "./support/live-helpers";

const SEEDED_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000001";
const SEEDED_NON_MEDICAL_PROVIDER_ID = "c0000000-0000-0000-0000-000000000005";
const TINY_TRANSPARENT_PNG = Buffer.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84,
  8, 29, 99, 248, 255, 255, 255, 127, 0, 9, 251, 3, 253, 5, 67, 69, 202, 0, 0, 0,
  0, 73, 69, 78, 68, 174, 66, 96, 130,
]);

test.describe("P0 operations modules", () => {
  test("Task Manager shows internal patient tasks and external partner tasks", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "ceo");
    const conciergeApi = await authenticateApiClient(
      request,
      scenario.credentials.concierge.email,
      scenario.credentials.password,
    );
    const internalTitle = `Internal arrival ${scenario.tag}`;
    const externalTitle = `External driver ${scenario.tag}`;

    const internalResponse = await request.post(
      `${conciergeApi.backendUrl}/api/v1/concierge-operational-items`,
      {
        headers: conciergeApi.headers,
        data: {
          request_id: randomUUID(),
          kind: "task",
          title: internalTitle,
          task_audience: "internal",
          patient_id: scenario.patient.id,
          due_at: "2026-08-24T09:00:00Z",
        },
      },
    );
    expect(internalResponse.ok()).toBe(true);

    const externalResponse = await request.post(
      `${conciergeApi.backendUrl}/api/v1/concierge-operational-items`,
      {
        headers: conciergeApi.headers,
        data: {
          request_id: randomUUID(),
          kind: "task",
          title: externalTitle,
          task_audience: "external",
          provider_id: SEEDED_NON_MEDICAL_PROVIDER_ID,
          external_assignee_type: "driver",
          external_assignee_name: "Berlin Driver GmbH",
          external_assignee_email: "dispatch@example.test",
          due_at: "2026-08-24T10:00:00Z",
        },
      },
    );
    expect(externalResponse.ok()).toBe(true);

    await page.goto("/task-manager");
    await expect(page.getByText(internalTitle).first()).toBeVisible();
    await expect(page.getByText(externalTitle).first()).toBeVisible();
    await expect(page.getByText(scenario.patient.name).first()).toBeVisible();
    await expect(page.getByText("Berlin Driver GmbH").first()).toBeVisible();

    await page.goto(`/patients/${scenario.patient.id}`);
    const patientTasks = page.getByTestId("linked-tasks-section");
    await expect(patientTasks).toContainText(internalTitle);
    await expect(patientTasks).toContainText(/Offene Aufgaben:\s*[1-9]/);

    await page.goto(`/providers/${SEEDED_NON_MEDICAL_PROVIDER_ID}`);
    const providerTasks = page.getByTestId("linked-tasks-section");
    await expect(providerTasks).toContainText(externalTitle);
    await expect(providerTasks).toContainText(/Offene Aufgaben:\s*[1-9]/);
  });

  test("internal notes display an attached file and remain available to staff", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "ceo");
    const ceoApi = await authenticateApiClient(
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    const noteTitle = `P0 handover ${scenario.tag}`;

    const createResponse = await request.post(
      `${ceoApi.backendUrl}/api/v1/internal-notes`,
      {
        headers: ceoApi.headers,
        data: {
          title: noteTitle,
          body: "Operational handover for the next shift.",
        },
      },
    );
    expect(createResponse.ok()).toBe(true);
    const note = (await createResponse.json()) as { id: string };
    const attachmentName = `handover-${scenario.tag}.png`;
    const attachmentResponse = await request.post(
      `${ceoApi.backendUrl}/api/v1/internal-notes/${note.id}/attachments`,
      {
        headers: ceoApi.headers,
        multipart: {
          file: {
            name: attachmentName,
            mimeType: "image/png",
            buffer: TINY_TRANSPARENT_PNG,
          },
        },
      },
    );
    expect(attachmentResponse.ok()).toBe(true);

    await page.goto("/notes");
    await page.getByText(noteTitle).first().click();
    await expect(page.locator("main input").first()).toHaveValue(noteTitle);
    await expect(page.getByText(attachmentName)).toBeVisible();
  });

  test("provider medical documents are linked to the patient and the portal account stays editable", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "ceo");
    const ceoApi = await authenticateApiClient(
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    const documentTitle = `Provider medical link ${scenario.tag}`;

    const uploadResponse = await request.post(
      `${ceoApi.backendUrl}/api/v1/providers/${SEEDED_MEDICAL_PROVIDER_ID}/documents`,
      {
        headers: ceoApi.headers,
        multipart: {
          patient_id: scenario.patient.id,
          title: documentTitle,
          notes: "Medical document linked from the provider profile.",
          is_medical: "true",
          file: {
            name: `provider-medical-${scenario.tag}.png`,
            mimeType: "image/png",
            buffer: TINY_TRANSPARENT_PNG,
          },
        },
      },
    );
    expect(uploadResponse.ok()).toBe(true);

    await page.goto(`/providers/${SEEDED_MEDICAL_PROVIDER_ID}`);
    await expect(page.getByText(documentTitle).first()).toBeVisible();
    const documentRow = page.getByRole("row").filter({ hasText: documentTitle }).first();
    await expect(documentRow.getByText(scenario.patient.name)).toBeVisible();
    await expect(documentRow.getByText(/^(Medizinisch|Medical)$/i)).toBeVisible();

    await page.goto(`/patients/${scenario.patient.id}?tab=invoices`);
    await expect(page.getByText(/Konto aktiv|Account active/i).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Patientenkonto bearbeiten|Edit patient account/i }),
    ).toBeVisible();
  });

  test("a Concierge receipt reaches finance and increases the patient receivable", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "ceo");
    const ceoApi = await authenticateApiClient(
      request,
      scenario.credentials.ceo.email,
      scenario.credentials.password,
    );
    const conciergeApi = await authenticateApiClient(
      request,
      scenario.credentials.concierge.email,
      scenario.credentials.password,
    );
    const billingApi = await authenticateApiClient(
      request,
      scenario.credentials.billing.email,
      scenario.credentials.password,
    );
    const vendor = `P0 Hotel ${scenario.tag}`;

    const serviceResponse = await request.post(
      `${ceoApi.backendUrl}/api/v1/concierge-services`,
      {
        headers: ceoApi.headers,
        data: {
          patient_id: scenario.patient.id,
          provider_id: SEEDED_NON_MEDICAL_PROVIDER_ID,
          assigned_concierge_id: scenario.credentials.concierge.user_id,
          service_kind: "hotel",
          title: `Hotel stay ${scenario.tag}`,
          currency: "EUR",
        },
      },
    );
    expect(serviceResponse.ok()).toBe(true);
    const service = (await serviceResponse.json()) as { id: string };

    const expenseResponse = await request.post(
      `${conciergeApi.backendUrl}/api/v1/concierge-services/${service.id}/expenses`,
      {
        headers: conciergeApi.headers,
        multipart: {
          request_id: randomUUID(),
          order_id: scenario.order.id,
          vendor,
          expense_date: new Date().toISOString().slice(0, 10),
          amount_net: "100.00",
          amount_vat: "19.00",
          amount_gross: "119.00",
          currency: "EUR",
          paid_by: "unpaid",
          service_delivered: "true",
          note: "Hotel receipt attached by Concierge",
          file: {
            name: `hotel-receipt-${scenario.tag}.png`,
            mimeType: "image/png",
            buffer: TINY_TRANSPARENT_PNG,
          },
        },
      },
    );
    expect(expenseResponse.ok()).toBe(true);
    const expensePayload = (await expenseResponse.json()) as { item: { id: string } };

    const postResponse = await request.post(
      `${billingApi.backendUrl}/api/v1/concierge-services/${service.id}/expenses/${expensePayload.item.id}/post`,
      {
        headers: billingApi.headers,
        data: {
          request_id: randomUUID(),
          order_id: scenario.order.id,
        },
      },
    );
    expect(postResponse.ok()).toBe(true);

    const statementResponse = await request.get(
      `${billingApi.backendUrl}/api/v1/patients/${scenario.patient.id}/account-statement`,
      { headers: billingApi.headers },
    );
    expect(statementResponse.ok()).toBe(true);
    const statement = (await statementResponse.json()) as {
      movements: Array<{ kind: string; debit: string; description: string | null }>;
    };
    expect(statement.movements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "external_receivable",
          debit: "119",
          description: vendor,
        }),
      ]),
    );

    await page.goto(`/patients/${scenario.patient.id}?tab=invoices`);
    await expect(page.getByText(vendor).first()).toBeVisible();
    await expect(page.getByText(/119,00\s*€/).first()).toBeVisible();
  });
});
