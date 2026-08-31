import { expect, test, type Page, type Response } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  loginViaApi,
  setGermanLanguage,
} from "./support/live-helpers";

type ApiPostResult = {
  ok: boolean;
  status: number;
  body: unknown;
  text: string;
};

type TaskListItem = {
  status: string;
  title: string;
};

type AppointmentListItem = {
  title: string;
};

function futureDate(daysFromNow: number) {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

async function waitForRealtime(page: Page) {
  await expect(
    page.locator('[aria-label="Realtime verbunden"]'),
  ).toBeVisible({ timeout: 30_000 });
}

function waitForApiGet(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === `/api/v1${path}`
      );
    },
    { timeout: 15_000 },
  );
}

async function browserApiGet<T>(page: Page, path: string): Promise<T> {
  const result = await page.evaluate(async (path) => {
    const token = window.localStorage.getItem("gmed_access_token");
    const response = await fetch(`/api/v1${path}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return {
      ok: response.ok,
      status: response.status,
      body: parsed,
      text,
    } satisfies ApiPostResult;
  }, path);

  expect(
    result.ok,
    `GET ${path} failed with ${result.status}: ${result.text}`,
  ).toBeTruthy();
  return result.body as T;
}

async function browserApiPost<TBody extends Record<string, unknown>>(
  page: Page,
  path: string,
  body: TBody,
) {
  const result = await page.evaluate(
    async ({ path, body }) => {
      const token = window.localStorage.getItem("gmed_access_token");
      const response = await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        body: parsed,
        text,
      } satisfies ApiPostResult;
    },
    { path, body },
  );

  expect(
    result.ok,
    `POST ${path} failed with ${result.status}: ${result.text}`,
  ).toBeTruthy();
  return result.body;
}

test.describe("realtime live propagation", () => {
  test("a second client receives patient, appointment and task updates without manual refresh", async ({
    browser,
    page,
    request,
  }) => {
    const scenario = await bootstrapFullSmokeScenario(request);
    const password = scenario.credentials.password;
    const creator = scenario.credentials.ceo;
    const operationsObserver = scenario.credentials.concierge;

    await setGermanLanguage(page);
    await loginViaApi(page, request, creator.email, password);

    const mutatorContext = await browser.newContext();
    const mutatorPage = await mutatorContext.newPage();
    const operationsContext = await browser.newContext();
    const operationsPage = await operationsContext.newPage();

    try {
      await setGermanLanguage(mutatorPage);
      await loginViaApi(mutatorPage, request, creator.email, password);
      await waitForRealtime(page);
      await waitForRealtime(mutatorPage);

      const tag = `rt-${Date.now().toString(36)}`;
      const firstName = `RealtimeFirst-${tag}`;
      const lastName = `RealtimeLast-${tag}`;
      const appointmentTitle = `Realtime appointment ${tag}`;
      const taskTitle = `Realtime dashboard task ${tag}`;

      await page.goto(`/patients?q=${encodeURIComponent(tag)}`);
      await expect(
        page.getByRole("heading", { level: 1, name: /Patient/i }),
      ).toBeVisible();
      await expect(page.getByText(firstName)).toHaveCount(0);

      await browserApiPost(mutatorPage, "/patients", {
        title: "Ms.",
        first_name: firstName,
        last_name: lastName,
        birth_date: "1991-02-03",
        gender: "female",
        nationality: "Ukrainian",
        residence_country: "Germany",
        languages: ["uk", "de"],
        functional_labels: ["complex_coordination"],
        phone_primary: "+49 30 7770001",
        phone_secondary: null,
        email: `${tag}@example.test`,
        address_street: "Realtime Weg 1",
        address_city: "Berlin",
        address_zip: "10117",
        address_country: "Germany",
        insurance_provider: "TK",
        insurance_number: `RT-${tag}`,
        insurance_type: "public",
        emergency_contact_name: "Realtime Contact",
        emergency_contact_phone: "+49 30 7770002",
        emergency_contact_relation: "spouse",
        notes: "Created from realtime live test.",
      });

      await expect(page.getByText(firstName).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByText(lastName).first()).toBeVisible();

      // Keep appointment observation on the already connected CEO page. A
      // concierge without a current patient assignment intentionally receives
      // a privacy-safe blocked slot even when named as appointment owner.
      const initialAppointmentsResponsePromise = waitForApiGet(
        page,
        "/appointments",
      );
      await page.goto(`/appointments?patient=${scenario.patient.id}`);
      const initialAppointmentsResponse = await initialAppointmentsResponsePromise;
      expect(initialAppointmentsResponse.ok()).toBeTruthy();
      await expect(
        page.getByRole("heading", { level: 1, name: "Termine" }),
      ).toBeVisible();
      await waitForRealtime(page);
      await expect(page.getByText(appointmentTitle)).toHaveCount(0);

      const appointmentRefreshPromise = waitForApiGet(
        page,
        "/appointments",
      );
      await browserApiPost(mutatorPage, "/appointments", {
        patient_id: scenario.patient.id,
        provider_id: null,
        doctor_id: null,
        owner_user_id: creator.user_id,
        interpreter_id: null,
        order_id: scenario.order.id,
        appointment_type: "medical",
        skip_medical_provider_binding: true,
        care_path_kind: "regular",
        title: appointmentTitle,
        date: futureDate(1),
        time_start: "06:00",
        time_end: "06:30",
        location: "Realtime test room",
        category: "live-test",
        notes: "Created in another browser context.",
        recurrence_frequency: null,
        recurrence_interval: null,
        recurrence_count: null,
        recurrence_until: null,
      });
      const appointmentRefreshResponse = await appointmentRefreshPromise;
      expect(appointmentRefreshResponse.ok()).toBeTruthy();
      const refreshedAppointments =
        (await appointmentRefreshResponse.json()) as AppointmentListItem[];
      expect(
        refreshedAppointments.some((item) => item.title === appointmentTitle),
      ).toBeTruthy();

      await expect(page.getByText(appointmentTitle).first()).toBeVisible({
        timeout: 30_000,
      });

      await setGermanLanguage(operationsPage);
      await loginViaApi(
        operationsPage,
        request,
        operationsObserver.email,
        password,
      );
      const initialTasksResponsePromise = waitForApiGet(
        operationsPage,
        "/concierge-operational-items",
      );
      await operationsPage.goto("/");
      const initialTasksResponse = await initialTasksResponsePromise;
      expect(initialTasksResponse.ok()).toBeTruthy();
      await expect(
        operationsPage
          .getByRole("heading", { name: /Guten|Hello|Willkommen/i })
          .first(),
      ).toBeVisible();
      await waitForRealtime(operationsPage);
      await expect(operationsPage.getByText(taskTitle)).toHaveCount(0);
      const taskPanel = operationsPage.locator("div").filter({
        has: operationsPage.getByRole("heading", {
          name: /Meine Aufgaben|My tasks|Мои задачи/i,
        }),
      }).first();
      const tasksBefore = await browserApiGet<TaskListItem[]>(
        operationsPage,
        "/concierge-operational-items?archive=active",
      );
      const expectedOpenTasksCount =
        tasksBefore.filter(
          (task) =>
            task.status !== "done" &&
            task.status !== "completed" &&
            task.status !== "cancelled",
        )
          .length + 1;

      const taskRefreshPromise = waitForApiGet(
        operationsPage,
        "/concierge-operational-items",
      );
      const taskRequestId = await mutatorPage.evaluate(() => crypto.randomUUID());
      await browserApiPost(mutatorPage, "/concierge-operational-items", {
        request_id: taskRequestId,
        kind: "task",
        title: taskTitle,
        note: "Created in another browser context for dashboard realtime.",
        assigned_to: operationsObserver.user_id,
        concierge_service_id: null,
        starts_at: null,
        ends_at: null,
        location: null,
        patient_id: scenario.patient.id,
        provider_id: null,
        due_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        priority: "urgent",
        reminder_at: null,
        task_audience: "internal",
        external_assignee_type: null,
        external_assignee_name: null,
        external_assignee_phone: null,
        external_assignee_email: null,
      });
      const taskRefreshResponse = await taskRefreshPromise;
      expect(taskRefreshResponse.ok()).toBeTruthy();
      const refreshedTasks = (await taskRefreshResponse.json()) as TaskListItem[];
      expect(refreshedTasks.some((task) => task.title === taskTitle)).toBeTruthy();

      await expect(operationsPage.getByText(taskTitle).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        taskPanel.locator("span").filter({
          hasText: new RegExp(`^${expectedOpenTasksCount}$`),
        }).first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await operationsContext.close();
      await mutatorContext.close();
    }
  });
});
