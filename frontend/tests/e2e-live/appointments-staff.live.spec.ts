import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapAndLogin,
  chooseComboboxOption,
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
    interpreter_response: string | null;
    interpreter_name: string | null;
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
  detailTab = "workflow",
) {
  await page.goto(`/appointments?appointment=${appointmentId}&detailTab=${detailTab}`);
  await expect
    .poll(
      () => {
        const url = new URL(page.url());
        return [
          url.pathname,
          url.searchParams.get("appointment") ?? "",
          url.searchParams.get("detailTab") ?? "",
        ].join("|");
      },
      { timeout: 15_000 },
    )
    .toBe(`/appointments|${appointmentId}|${detailTab}`);
  await expect(page.getByText(title).first()).toBeVisible();
}

async function fillMuiDateTime(locator: Locator, value: string) {
  const [date = "", time = ""] = value.split("T");
  const [year = "", month = "", day = ""] = date.split("-");
  const [hours = "", minutes = ""] = time.split(":");

  await locator.getByRole("spinbutton", { name: "Year" }).fill(year);
  await locator.getByRole("spinbutton", { name: "Month" }).fill(month);
  await locator.getByRole("spinbutton", { name: "Day" }).fill(day);
  await locator.getByRole("spinbutton", { name: "Hours" }).fill(hours);
  await locator.getByRole("spinbutton", { name: "Minutes" }).fill(minutes);
}

const assignInterpreterButtonName = /Dolmetscher zuweisen|Assign interpreter/i;
const addChecklistItemButtonName =
  /Checklistenpunkt hinzufügen|Add checklist item/i;
const completeChecklistItemButtonName =
  /Als erledigt(?: markieren)?|Mark complete/i;
const acceptedResponseButtonName = /^(Bestätigt|Accepted|Confirmed)$/i;
const createDoctorFollowUpButtonName =
  /Ärztliche Nachsorge erstellen|Ärztliches Follow-up erstellen|Create doctor follow-up/i;
const inProgressStatusButtonName = /^(Läuft|Lauft|In progress)$/i;
const completedStatusButtonName = /^(Abgeschlossen|Completed)$/i;
const approveReportButtonName =
  /Stunden und Bericht freigeben|Approve hours and report/i;
const openReportButtonName = /Bericht öffnen|Open report/i;
const openReviewButtonName = /Review öffnen|Open review/i;
const interpreterBillingServiceName = /Interpreter hours|Interpreter support/;

function sectionWithButton(page: Page, name: RegExp) {
  return page.locator("section").filter({
    has: page.getByRole("button", { name }),
  }).last();
}

async function assignInterpreter(page: Page, interpreterName: string) {
  const section = sectionWithButton(page, assignInterpreterButtonName);
  await expect(section).toBeVisible();
  await section.getByRole("button", { name: assignInterpreterButtonName }).click();
  const sheet = page
    .getByRole("dialog")
    .filter({
      has: page.getByRole("button", { name: assignInterpreterButtonName }),
    })
    .last();
  await expect(sheet).toBeVisible();
  await chooseComboboxOption(
    page,
    sheet.getByRole("combobox", { name: /Dolmetscher|Interpreter/i }).last(),
    interpreterName,
  );
  await sheet.getByRole("button", { name: assignInterpreterButtonName }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

/** The checklist is a data table; adds an item and returns its table row. */
async function addChecklistItem(page: Page, itemText: string) {
  const addButton = page
    .getByRole("button", { name: addChecklistItemButtonName })
    .first();
  await expect(addButton).toBeVisible();
  await addButton.click();
  const sheet = page
    .getByRole("dialog")
    .filter({
      has: page.getByRole("button", { name: addChecklistItemButtonName }),
    })
    .last();
  await expect(sheet).toBeVisible();
  const titleInput = sheet.getByRole("textbox", { name: /^(Titel|Title)$/i });
  await titleInput.fill(itemText);
  await expect(titleInput).toHaveValue(itemText);
  await sheet.getByRole("button", { name: addChecklistItemButtonName }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
  const row = page.getByRole("row").filter({ hasText: itemText }).first();
  await expect(row).toBeVisible();
  return row;
}

/** The interpreter answer buttons sit under the "Dolmetscherantwort" heading. */
function interpreterResponseGroup(page: Page) {
  return page
    .getByRole("heading", { name: /^(Dolmetscherantwort|Interpreter response)$/i })
    .locator("xpath=ancestor::*[.//button][1]");
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

    await assignInterpreter(page, scenario.credentials.interpreter.name);
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

    const checklistRow = await addChecklistItem(
      page,
      "Live E2E appointment checklist",
    );
    await checklistRow
      .getByRole("button", { name: completeChecklistItemButtonName })
      .click();
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

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
      "coordination",
    );
    // The doctor-directed follow-up is created in a sheet opened from its table.
    await page
      .getByRole("button", { name: createDoctorFollowUpButtonName })
      .first()
      .click();
    const doctorFollowUpForm = page.getByRole("dialog", {
      name: /Ärztlich angeordnete Nachsorge|Doctor-directed follow-up/i,
    });
    await expect(doctorFollowUpForm).toBeVisible();
    const followUpTitle = doctorFollowUpForm.getByRole("textbox", {
      name: /^(Titel|Title)$/i,
    });
    await followUpTitle.fill("Live E2E doctor follow-up");
    await expect(followUpTitle).toHaveValue("Live E2E doctor follow-up");
    await chooseComboboxOption(
      page,
      doctorFollowUpForm.getByRole("combobox", { name: /^(Betreuer|Assignee)$/i }),
      scenario.credentials.pm.name,
    );
    await fillMuiDateTime(doctorFollowUpForm, futureLocalDateTime(3));
    await doctorFollowUpForm
      .getByRole("textbox", { name: /^(Notizen|Notes)$/i })
      .fill("Coordinate the directed follow-up with the patient.");
    const createFollowUp = doctorFollowUpForm.getByRole("button", {
      name: createDoctorFollowUpButtonName,
    });
    await expect(createFollowUp).toBeEnabled();
    await createFollowUp.click();
    await expect(doctorFollowUpForm).toBeHidden({ timeout: 15_000 });
    await expect(async () => {
      const remindersResponse = await request.get(
        `${api.backendUrl}/api/v1/appointments/${scenario.appointment.id}/reminders`,
        { headers: api.headers },
      );
      expect(remindersResponse.ok()).toBe(true);
      const reminders = (await remindersResponse.json()) as Array<{
        title: string;
        user_id: string | null;
      }>;
      expect(
        reminders.some(
          (item) =>
            item.title === "Doctor-directed: Live E2E doctor follow-up" &&
            item.user_id === scenario.credentials.pm.user_id,
        ),
      ).toBe(true);
    }).toPass({ timeout: 15_000 });
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

    await page.getByRole("button", { name: inProgressStatusButtonName }).click();

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

    await page.getByRole("button", { name: completedStatusButtonName }).click();

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

  test("a future appointment cannot be completed or reported before its date in the UI or on the server", async ({
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
    // The seeded recurring series starts two weeks ahead.
    const futureAppointment = scenario.recurring_appointment;

    await openAppointmentDetail(page, futureAppointment.id, futureAppointment.title);
    await expect(
      page.getByRole("button", { name: completedStatusButtonName }),
    ).toBeDisabled();
    await expect(
      page.getByTestId("appointment-status-completion-date-hint"),
    ).toHaveText(/erst ab dem Termindatum/);
    await expect(
      page.getByRole("button", { name: inProgressStatusButtonName }),
    ).toBeEnabled();

    const early = await request.post(
      `${api.backendUrl}/api/v1/appointments/${futureAppointment.id}/status`,
      {
        headers: api.headers,
        data: { status: "completed", recurrence_scope: "single" },
      },
    );
    expect(early.status(), await early.text()).toBe(422);
    expect(((await early.json()) as { code?: string }).code).toBe(
      "appointment_completion_before_date",
    );
    expect(
      (await fetchAppointmentDetail(request, api, futureAppointment.id)).status,
    ).toBe("confirmed");

    // Approval bills interpreter hours, so the report waits for the date too.
    const assignResponse = await request.post(
      `${api.backendUrl}/api/v1/appointments/${futureAppointment.id}/assign-interpreter`,
      {
        headers: api.headers,
        data: { interpreter_id: scenario.credentials.interpreter.user_id },
      },
    );
    expect(assignResponse.ok(), await assignResponse.text()).toBe(true);
    const interpreterApi = await authenticateApiClient(
      request,
      scenario.credentials.interpreter.email,
      scenario.credentials.password,
    );
    const earlyReport = await request.post(
      `${interpreterApi.backendUrl}/api/v1/appointments/${futureAppointment.id}/report`,
      {
        headers: interpreterApi.headers,
        data: { hours: 1.5, report_text: "Live E2E report before the date" },
      },
    );
    expect(earlyReport.status(), await earlyReport.text()).toBe(422);
    expect(((await earlyReport.json()) as { code?: string }).code).toBe(
      "appointment_report_before_date",
    );
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

    await page.getByRole("button", { name: completedStatusButtonName }).click();

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
              `Automatisch aus abgeschlossenem medizinischem Termin ${scenario.appointment.id} erstellt`,
            ),
        ),
      ).toBe(true);
    }).toPass({ timeout: 15_000 });

    await page.goto(`/orders/${scenario.order.id}?section=services`);
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

    await addChecklistItem(page, "Block-completion checklist item");

    // The UI blocks completion while a checklist item is open ...
    await expect(
      page.getByRole("button", { name: completedStatusButtonName }),
    ).toBeDisabled();
    // ... and so does the server.
    const blockedCompletion = await request.post(
      `${api.backendUrl}/api/v1/appointments/${scenario.appointment.id}/status`,
      { headers: api.headers, data: { status: "completed" } },
    );
    expect(blockedCompletion.status(), await blockedCompletion.text()).toBeGreaterThanOrEqual(400);
    expect(
      (await fetchAppointmentDetail(request, api, scenario.appointment.id)).status,
    ).not.toBe("completed");

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
    await page.getByRole("button", { name: completedStatusButtonName }).click();

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
    expect(
      [200, 201, 409],
      await agencyServiceResponse.text(),
    ).toContain(agencyServiceResponse.status());

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
        "clinical",
      );
      await interpreterPage
        .getByRole("button", { name: openReportButtonName })
        .click();

      const reportForm = interpreterPage
        .locator("form")
        .filter({
          has: interpreterPage.locator('input[type="number"][step="0.25"]'),
        })
        .first();
      await expect(reportForm).toBeVisible();

      const hoursInput = reportForm.locator('input[type="number"][step="0.25"]');
      await expect(
        hoursInput,
        "the assigned interpreter must be able to enter the report hours",
      ).toBeEnabled();
      await hoursInput.fill("2.5");
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
      "clinical",
    );
    await page.getByRole("button", { name: openReviewButtonName }).click();
    await page
      .getByRole("button", { name: approveReportButtonName })
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

    await page.goto(`/orders/${scenario.order.id}?section=services`);
    await expect(
      page.getByText("Automatisch aus Dolmetscherbericht abgerechnet"),
    ).toBeVisible();
    await expect(page.getByText(interpreterBillingServiceName).first()).toBeVisible();
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
      expect(interpreterLine!.agency_service_name).toMatch(
        interpreterBillingServiceName,
      );
      expect(interpreterLine!.description).toMatch(interpreterBillingServiceName);
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
    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await openAppointmentDetail(
      page,
      scenario.appointment.id,
      scenario.appointment.title,
    );
    await assignInterpreter(page, scenario.credentials.interpreter.name);

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

      const responseSection = interpreterResponseGroup(interpreterPage);
      await expect(responseSection).toBeVisible();
      await expect(
        interpreterPage.getByTestId("read-only-banner"),
        "no view-only banner above the interpreter's own actions",
      ).toHaveCount(0);
      await responseSection
        .getByRole("button", { name: acceptedResponseButtonName })
        .click();

      await expect(async () => {
        const detail = await fetchAppointmentDetail(
          request,
          pmApi,
          scenario.appointment.id,
        );
        expect(detail.interpreter_response).toBe("accepted");
        expect(detail.interpreter_id).toBe(
          scenario.credentials.interpreter.user_id,
        );
      }).toPass({ timeout: 15_000 });
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
        interpreterResponseGroup(teamleadPage).getByRole("button", {
          name: acceptedResponseButtonName,
        }),
      ).toBeVisible();
      await expect(
        teamleadPage.getByRole("button", { name: assignInterpreterButtonName }),
      ).toBeVisible();

      await expect(
        teamleadPage.getByRole("button", { name: inProgressStatusButtonName }),
      ).toHaveCount(0);
      await expect(
        teamleadPage.getByRole("button", { name: completedStatusButtonName }),
      ).toHaveCount(0);
      await expect(
        teamleadPage.getByRole("button", { name: addChecklistItemButtonName }),
      ).toHaveCount(0);
      await expect(
        teamleadPage.getByRole("button", { name: "Erinnerung hinzufügen" }),
      ).toHaveCount(0);
    } finally {
      await teamleadContext.close();
    }
  });
});
