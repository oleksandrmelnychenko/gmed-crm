import { expect, test, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  loginViaApi,
  setGermanLanguage,
  type LiveApiClient,
} from "./support/live-helpers";

async function fetchAppointmentDetail(
  request: import("@playwright/test").APIRequestContext,
  api: LiveApiClient,
  appointmentId: string,
) {
  const response = await request.get(
    `${api.backendUrl}/api/v1/appointments/${appointmentId}`,
    { headers: api.headers },
  );
  if (!response.ok()) {
    throw new Error(
      `Get appointment failed: ${response.status()} ${await response.text()}`,
    );
  }
  return (await response.json()) as {
    id: string;
    status: string;
    patient_id: string;
    order_id: string | null;
    interpreter_id: string | null;
    title: string;
  };
}

function futureLocalDateTime(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

async function openAppointmentDetail(
  page: Page,
  appointmentId: string,
  title: string,
) {
  await page.goto(`/appointments?appointment=${appointmentId}`);
  await expect(page.getByText(title).first()).toBeVisible();
}

test.describe("staff appointments live workflows", () => {
  test("patient manager can run assignment, checklist and doctor follow-up flows on an appointment", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );

    const interpreterSection = page
      .locator("section")
      .filter({
        has: page.getByRole("button", { name: "Assign interpreter" }),
      })
      .first();
    await interpreterSection
      .locator("select")
      .selectOption(scenario.credentials.interpreter.user_id);
    await interpreterSection
      .getByRole("button", { name: "Assign interpreter" })
      .click();
    await expect(async () => {
      const detail = await fetchAppointmentDetail(
        request,
        api,
        scenario.appointment.id,
      );
      expect(detail.interpreter_id).toBe(
        scenario.credentials.interpreter.user_id,
      );
    }).toPass({ timeout: 15_000 });
    await expect(
      page.getByText(`New assignment: ${scenario.appointment.title}`).first(),
    ).toBeVisible();

    const checklistSection = page
      .locator("section")
      .filter({
        has: page.getByRole("button", { name: "Add checklist item" }),
      })
      .first();
    await checklistSection
      .locator("input")
      .fill("Live E2E appointment checklist");
    await checklistSection
      .getByRole("button", { name: "Add checklist item" })
      .click();
    const checklistCard = checklistSection
      .locator("div")
      .filter({ hasText: "Live E2E appointment checklist" })
      .first();
    await expect(checklistCard).toBeVisible();
    await checklistCard.getByRole("button", { name: /Active|Aktiv/i }).click();
    await expect(async () => {
      const checklistList = await request.get(
        `${api.backendUrl}/api/v1/appointments/${scenario.appointment.id}/checklist`,
        { headers: api.headers },
      );
      expect(checklistList.ok()).toBe(true);
      const items = (await checklistList.json()) as Array<{
        item_text: string;
        is_completed: boolean;
      }>;
      const checklistItem = items.find(
        (item) => item.item_text === "Live E2E appointment checklist",
      );
      expect(checklistItem).toBeDefined();
      expect(checklistItem!.is_completed).toBe(true);
    }).toPass({ timeout: 15_000 });

    const doctorFollowUpSection = page
      .locator("section")
      .filter({ hasText: "Ärztlich angeordnete Nachsorge" })
      .first();
    const doctorFollowUpForm = doctorFollowUpSection.locator("form").first();
    await doctorFollowUpForm
      .locator("select")
      .first()
      .selectOption({ index: 1 });
    await doctorFollowUpForm
      .locator('input[type="datetime-local"]')
      .first()
      .fill(futureLocalDateTime(3));
    await doctorFollowUpForm
      .locator("textarea")
      .first()
      .fill("Coordinate the directed follow-up with the patient.");
    await doctorFollowUpForm
      .locator("input")
      .first()
      .fill("Live E2E doctor follow-up");
    await expect(doctorFollowUpForm.locator("input").first()).toHaveValue(
      "Live E2E doctor follow-up",
    );
    await expect(
      doctorFollowUpForm.getByRole("button", {
        name: "Create doctor follow-up",
      }),
    ).toBeEnabled();
    await doctorFollowUpForm
      .getByRole("button", { name: "Create doctor follow-up" })
      .click();
    await expect(
      doctorFollowUpSection.getByText("Live E2E doctor follow-up").first(),
    ).toBeVisible();
  });

  test("patient manager cycles a non-recurring appointment from confirmed through in_progress to completed via the status section", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const seeded = await fetchAppointmentDetail(
      request,
      api,
      scenario.appointment.id,
    );
    expect(seeded.status).toBe("confirmed");
    expect(seeded.patient_id).toBe(scenario.patient.id);
    expect(seeded.order_id).toBe(scenario.order.id);
    expect(seeded.title).toBe(scenario.appointment.title);

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );

    await page
      .getByRole("button", { name: "in progress", exact: true })
      .click();

    await expect(async () => {
      const detail = await fetchAppointmentDetail(
        request,
        api,
        scenario.appointment.id,
      );
      expect(detail.status).toBe("in_progress");
      expect(detail.patient_id).toBe(scenario.patient.id);
      expect(detail.order_id).toBe(scenario.order.id);
    }).toPass({ timeout: 15_000 });

    await page.getByRole("button", { name: "completed", exact: true }).click();

    await expect(async () => {
      const detail = await fetchAppointmentDetail(
        request,
        api,
        scenario.appointment.id,
      );
      expect(detail.status).toBe("completed");
      expect(detail.patient_id).toBe(scenario.patient.id);
      expect(detail.order_id).toBe(scenario.order.id);
    }).toPass({ timeout: 15_000 });
  });

  test("completing a medical appointment auto-creates the treatment-organization leistung and shows it in order detail", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );

    await page.getByRole("button", { name: "completed", exact: true }).click();

    await expect(async () => {
      const response = await request.get(
        `${api.backendUrl}/api/v1/orders/${scenario.order.id}`,
        { headers: api.headers },
      );
      expect(response.ok()).toBe(true);
      const order = (await response.json()) as {
        id: string;
        leistungen: Array<{
          description: string;
          status: string;
          agency_service_key?: string | null;
          source_medical_appointment_id?: string | null;
          notes?: string | null;
        }>;
      };

      expect(order.id).toBe(scenario.order.id);
      expect(
        order.leistungen.some(
          (item) =>
            item.description === "Organisation der Behandlung" &&
            item.status === "delivered" &&
            item.agency_service_key === "treatment_organization" &&
            item.source_medical_appointment_id === scenario.appointment.id &&
            (item.notes ?? "").includes(
              "Auto-created from completed medical appointment",
            ),
        ),
      ).toBe(true);
    }).toPass({ timeout: 15_000 });

    await page.goto(`/orders?order=${scenario.order.id}`);
    await expect(
      page.getByText("Organisation der Behandlung").first(),
    ).toBeVisible();
    await expect(
      page
        .getByText("Automatisch aus abgeschlossenem Termin abgerechnet")
        .first(),
    ).toBeVisible();
  });

  test("an open checklist item blocks completing the appointment until it is marked done", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const api = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );

    const checklistSection = page
      .locator("section")
      .filter({
        has: page.getByRole("button", { name: "Add checklist item" }),
      })
      .first();
    await checklistSection
      .locator("input")
      .fill("Block-completion checklist item");
    await checklistSection
      .getByRole("button", { name: "Add checklist item" })
      .click();
    await expect(
      checklistSection
        .locator("div")
        .filter({ hasText: "Block-completion checklist item" })
        .first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "completed", exact: true }).click();

    await expect(async () => {
      const detail = await fetchAppointmentDetail(
        request,
        api,
        scenario.appointment.id,
      );
      expect(detail.status).not.toBe("completed");
    }).toPass({ timeout: 5_000 });

    const checklistList = await request.get(
      `${api.backendUrl}/api/v1/appointments/${scenario.appointment.id}/checklist`,
      { headers: api.headers },
    );
    expect(checklistList.ok()).toBe(true);
    const items = (await checklistList.json()) as Array<{
      id: string;
      item_text: string;
      is_completed: boolean;
    }>;
    const blocker = items.find(
      (item) => item.item_text === "Block-completion checklist item",
    );
    expect(blocker).toBeDefined();
    expect(blocker!.is_completed).toBe(false);

    const completeResponse = await request.post(
      `${api.backendUrl}/api/v1/appointments/${scenario.appointment.id}/checklist/${blocker!.id}/complete`,
      { headers: api.headers, data: {} },
    );
    expect(completeResponse.ok()).toBe(true);

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );
    await page.getByRole("button", { name: "completed", exact: true }).click();

    await expect(async () => {
      const detail = await fetchAppointmentDetail(
        request,
        api,
        scenario.appointment.id,
      );
      expect(detail.status).toBe("completed");
    }).toPass({ timeout: 15_000 });
  });

  test("interpreter submits a report, the patient manager approves it and the order receives an auto-billed interpreter line", async ({
    page,
    request,
    browser,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    const agencyServiceResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/agency-services`,
      {
        headers: pmApi.headers,
        data: {
          service_key: "interpreter_hours",
          service_name: "Interpreter hours",
          description: "Approved interpreter work billed per hour",
          unit_label: "hour",
          unit_price: 89.5,
          currency: "EUR",
          vat_rate: 19.0,
          is_active: true,
          valid_from: "2026-01-01",
        },
      },
    );
    expect(agencyServiceResponse.ok()).toBe(true);

    const assignResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/appointments/${scenario.appointment.id}/assign-interpreter`,
      {
        headers: pmApi.headers,
        data: { interpreter_id: scenario.credentials.interpreter.user_id },
      },
    );
    expect(assignResponse.ok()).toBe(true);

    const interpreterContext = await browser.newContext();
    const interpreterPage = await interpreterContext.newPage();
    try {
      await setGermanLanguage(interpreterPage);
      await loginViaApi(
        interpreterPage,
        request,
        scenario.credentials.interpreter.email,
        scenario.credentials.password,
      );
      await openAppointmentDetail(
        interpreterPage,
        scenario.appointment.id,
        scenario.appointment.title,
      );

      const reportForm = interpreterPage
        .locator("form")
        .filter({
          has: interpreterPage.locator('input[type="number"][step="0.25"]'),
        })
        .first();
      await expect(reportForm).toBeVisible();

      await reportForm.locator('input[type="number"][step="0.25"]').fill("2.5");
      await reportForm
        .locator("textarea")
        .fill("Live E2E interpreter report covering the cardiology follow-up.");
      await reportForm
        .getByRole("button", { name: /^Speichern$|^Resubmit report$/ })
        .click();
    } finally {
      await interpreterContext.close();
    }

    await expect(async () => {
      const response = await request.get(
        `${pmApi.backendUrl}/api/v1/appointments/${scenario.appointment.id}/report`,
        { headers: pmApi.headers },
      );
      expect(response.ok()).toBe(true);
      const report = (await response.json()) as {
        id: string;
        interpreter_id: string;
        interpreter_name: string;
        hours: string;
        report_text: string;
        approval_status: string;
        approved_by_name: string;
      } | null;
      expect(report).not.toBeNull();
      expect(report!.interpreter_id).toBe(
        scenario.credentials.interpreter.user_id,
      );
      expect(report!.interpreter_name).toBe(
        scenario.credentials.interpreter.name,
      );
      expect(report!.hours).toContain("2.5");
      expect(report!.report_text).toBe(
        "Live E2E interpreter report covering the cardiology follow-up.",
      );
      expect(report!.approval_status).toBe("pending");
    }).toPass({ timeout: 15_000 });

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );
    await page
      .getByRole("button", { name: "Approve hours and report" })
      .click();

    await expect(async () => {
      const response = await request.get(
        `${pmApi.backendUrl}/api/v1/appointments/${scenario.appointment.id}/report`,
        { headers: pmApi.headers },
      );
      expect(response.ok()).toBe(true);
      const report = (await response.json()) as {
        approval_status: string;
        approved_by_name: string;
        approved_at: string | null;
        billing_sync_status: string | null;
        billing_service_key: string | null;
        billing_leistung_id: string | null;
      } | null;
      expect(report).not.toBeNull();
      expect(report!.approval_status).toBe("approved");
      expect(report!.approved_by_name).toBe(scenario.credentials.pm.name);
      expect(report!.approved_at).not.toBeNull();
      expect(report!.billing_sync_status).toBe("synced");
      expect(report!.billing_service_key).toBe("interpreter_hours");
      expect(report!.billing_leistung_id).toBeTruthy();
    }).toPass({ timeout: 15_000 });

    await page.goto(`/orders?order=${scenario.order.id}`);
    await expect(
      page.getByText("Automatisch aus Dolmetscherbericht abgerechnet"),
    ).toBeVisible();
    await expect(page.getByText("Interpreter hours").first()).toBeVisible();
    await expect(
      page.getByText(
        "Live E2E interpreter report covering the cardiology follow-up.",
      ),
    ).toBeVisible();

    await expect(async () => {
      const response = await request.get(
        `${pmApi.backendUrl}/api/v1/orders/${scenario.order.id}`,
        { headers: pmApi.headers },
      );
      expect(response.ok()).toBe(true);
      const order = (await response.json()) as {
        leistungen: Array<{
          description: string;
          quantity: string;
          source_interpreter_report_id: string | null;
          agency_service_key: string | null;
          agency_service_name: string | null;
          notes: string | null;
        }>;
      };
      const interpreterLine = order.leistungen.find(
        (item) => item.source_interpreter_report_id !== null,
      );
      expect(interpreterLine).toBeDefined();
      expect(interpreterLine!.quantity).toContain("2.5");
      expect(interpreterLine!.agency_service_key).toBe("interpreter_hours");
      expect(interpreterLine!.agency_service_name).toBe("Interpreter hours");
      expect(interpreterLine!.description).toContain("Interpreter hours");
      expect(interpreterLine!.notes).toContain(
        "Live E2E interpreter report covering the cardiology follow-up.",
      );
    }).toPass({ timeout: 15_000 });
  });

  test("assigned interpreter can open the appointment and accept the assignment", async ({
    page,
    request,
    browser,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );
    const interpreterSection = page
      .locator("section")
      .filter({
        has: page.getByRole("button", { name: "Assign interpreter" }),
      })
      .first();
    await interpreterSection
      .locator("select")
      .selectOption(scenario.credentials.interpreter.user_id);
    await interpreterSection
      .getByRole("button", { name: "Assign interpreter" })
      .click();

    const interpreterContext = await browser.newContext();
    const interpreterPage = await interpreterContext.newPage();

    try {
      await setGermanLanguage(interpreterPage);
      await loginViaApi(
        interpreterPage,
        request,
        scenario.credentials.interpreter.email,
        scenario.credentials.password,
      );
      await openAppointmentDetail(
        interpreterPage,
        scenario.appointment.id,
        scenario.appointment.title,
      );

      const responseSection = interpreterPage
        .locator("section")
        .filter({
          has: interpreterPage.getByRole("button", {
            name: "accepted",
            exact: true,
          }),
        })
        .first();
      await expect(responseSection).toBeVisible();
      await responseSection
        .getByRole("button", { name: "accepted", exact: true })
        .click();

      await expect(
        interpreterPage.getByText(/Interpreter accepted/i).first(),
      ).toBeVisible();
      await expect(
        interpreterPage
          .getByText(scenario.credentials.interpreter.name)
          .first(),
      ).toBeVisible();
    } finally {
      await interpreterContext.close();
    }
  });

  test("assigned teamlead interpreter can respond and reassign but cannot manage status checklist or reminder creation", async ({
    page,
    request,
    browser,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    const assignResponse = await request.post(
      `${pmApi.backendUrl}/api/v1/appointments/${scenario.appointment.id}/assign-interpreter`,
      {
        headers: pmApi.headers,
        data: {
          interpreter_id: scenario.credentials.teamlead_interpreter.user_id,
        },
      },
    );
    expect(assignResponse.ok()).toBe(true);

    const teamleadContext = await browser.newContext();
    const teamleadPage = await teamleadContext.newPage();

    try {
      await setGermanLanguage(teamleadPage);
      await loginViaApi(
        teamleadPage,
        request,
        scenario.credentials.teamlead_interpreter.email,
        scenario.credentials.password,
      );
      await openAppointmentDetail(
        teamleadPage,
        scenario.appointment.id,
        scenario.appointment.title,
      );

      await expect(
        teamleadPage.getByRole("button", {
          name: "accepted",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        teamleadPage.getByRole("button", { name: "Assign interpreter" }),
      ).toBeVisible();

      await expect(
        teamleadPage.getByRole("button", { name: "in progress", exact: true }),
      ).toHaveCount(0);
      await expect(
        teamleadPage.getByRole("button", { name: "completed", exact: true }),
      ).toHaveCount(0);
      await expect(
        teamleadPage.getByRole("button", { name: "Add checklist item" }),
      ).toHaveCount(0);
      await expect(
        teamleadPage.getByRole("button", { name: "Erinnerung hinzufügen" }),
      ).toHaveCount(0);
    } finally {
      await teamleadContext.close();
    }
  });
});
