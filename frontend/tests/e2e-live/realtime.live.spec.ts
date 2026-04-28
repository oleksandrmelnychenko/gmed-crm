import { expect, test, type Page } from "@playwright/test";

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
    const pm = scenario.credentials.pm;

    await setGermanLanguage(page);
    await loginViaApi(page, request, pm.email, password);

    const mutatorContext = await browser.newContext();
    const mutatorPage = await mutatorContext.newPage();

    try {
      await setGermanLanguage(mutatorPage);
      await loginViaApi(mutatorPage, request, pm.email, password);
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
        nationality: "Ukraine",
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

      await page.goto(`/appointments?patient=${scenario.patient.id}`);
      await expect(
        page.getByRole("heading", { level: 1, name: "Termine" }),
      ).toBeVisible();
      await waitForRealtime(page);
      await expect(page.getByText(appointmentTitle)).toHaveCount(0);

      await browserApiPost(mutatorPage, "/appointments", {
        patient_id: scenario.patient.id,
        provider_id: null,
        doctor_id: null,
        owner_user_id: pm.user_id,
        interpreter_id: null,
        order_id: scenario.order.id,
        appointment_type: "medical",
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

      await expect(page.getByText(appointmentTitle).first()).toBeVisible({
        timeout: 30_000,
      });

      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: /Guten|Hello|Willkommen/i }).first(),
      ).toBeVisible();
      await expect(page.getByText(taskTitle)).toHaveCount(0);
      const taskPanel = page.locator("div").filter({
        has: page.getByRole("heading", { name: /Meine Aufgaben|My tasks|Мои задачи/i }),
      }).first();
      const tasksBefore = await browserApiGet<TaskListItem[]>(
        page,
        "/tasks?mine_only=true",
      );
      const expectedOpenTasksCount =
        tasksBefore.filter((task) => task.status !== "done" && task.status !== "cancelled")
          .length + 1;

      await browserApiPost(mutatorPage, "/tasks", {
        title: taskTitle,
        description: "Created in another browser context for dashboard realtime.",
        assigned_to: pm.user_id,
        patient_id: scenario.patient.id,
        order_id: null,
        appointment_id: null,
        due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        priority: "urgent",
      });

      await expect(page.getByText(taskTitle).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        taskPanel.locator("span").filter({
          hasText: new RegExp(`^${expectedOpenTasksCount}$`),
        }).first(),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await mutatorContext.close();
    }
  });
});
