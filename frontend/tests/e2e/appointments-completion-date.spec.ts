import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function berlinDate(offsetDays: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const value = new Date(`${parts}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

const patientId = "b0000000-0000-0000-0000-000000000031";
const providerId = "c0000000-0000-0000-0000-000000000031";
const ownerId = "a0000000-0000-0000-0000-000000000031";
const appointmentId = "11000000-0000-0000-0000-000000000031";
const completedStatusButton = /^Abgeschlossen$/;
const completeAndScheduleButton = /Abschließen & planen/;
const dateHint = "Abschließen ist erst ab dem Termindatum möglich.";

const interpreterId = "a0000000-0000-0000-0000-000000000032";
const reportDateHint =
  "Dolmetscherberichte können erst ab dem Termindatum eingereicht und freigegeben werden.";

const pendingReport = {
  id: "report-0031",
  interpreter_id: interpreterId,
  interpreter_name: "Marina Sokolova",
  hours: "2.5",
  report_text: "Interpreted the consultation.",
  approval_status: "pending",
  notes: null,
  approved_by_name: null,
  approved_at: null,
  created_at: "2026-09-20T12:00:00Z",
  billing_leistung_id: null,
  billing_sync_status: null,
  billing_service_key: null,
};

async function openMockedAppointment(
  page: Page,
  date: string,
  options: { report?: typeof pendingReport; detailTab?: string } = {},
) {
  const statusPosts: unknown[] = [];
  const reportPosts: string[] = [];
  const listItem = {
    id: appointmentId,
    title: "Cardiology consultation",
    date,
    time_start: "10:00",
    time_end: "11:00",
    type: "medical",
    care_path_kind: "regular",
    status: "confirmed",
    location: "Berlin",
    interpreter_response: null,
    checklist_phase: "preparation",
    patient_id: patientId,
    patient_name: "Synthetic Patient",
    patient_pid: "P-0031",
    provider_id: providerId,
    provider_name: "Synthetic Clinic",
    doctor_id: null,
    doctor_name: null,
    owner_user_id: ownerId,
    owner_name: "Sarah Kovacs",
    owner_role: "patient_manager",
    interpreter_id: options.report ? interpreterId : null,
    interpreter_name: options.report ? "Marina Sokolova" : null,
    recurrence_series_id: null,
    recurrence_frequency: null,
    recurrence_interval: null,
    recurrence_count: null,
    recurrence_until: null,
    recurrence_index: 0,
    recurrence_series_size: 1,
    is_blocked: false,
  };
  const detail = {
    ...listItem,
    category: "consultation",
    notes: null,
    order_id: null,
    recurrence_parent_series_id: null,
    recurrence_split_from_appointment_id: null,
    recurrence_split_from_index: null,
    recurring_scope_preview: [],
    recurring_lineage_history: [],
    created_at: "2026-09-01T10:00:00Z",
  };

  await page.addInitScript(() => {
    window.localStorage.setItem("gmed_lang", "de");
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();

    if (path === "/auth/login" && method === "POST") {
      return json(route, {
        access_token: "playwright-access-token",
        refresh_token: "playwright-refresh-token",
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    if (path === "/auth/logout") return json(route, { ok: true });
    if (path === "/me") {
      return json(route, {
        id: ownerId,
        email: "admin@gmed.de",
        name: "Admin GMED",
        role: "ceo",
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    if (path === `/appointments/${appointmentId}/status` && method === "POST") {
      statusPosts.push(route.request().postDataJSON());
      return json(route, { ok: true });
    }
    if (path === `/appointments/${appointmentId}`) return json(route, detail);
    if (path === "/appointments" || path.startsWith("/appointments?")) {
      return json(route, [listItem]);
    }
    if (path.startsWith("/appointments/meta/conflicts")) {
      return json(route, {
        patient_conflict_count: 0,
        interpreter_conflict_count: 0,
        has_conflicts: false,
        patient_conflicts: [],
        interpreter_conflicts: [],
      });
    }
    if (path === "/appointments/meta/staff") {
      return json(route, [{ id: ownerId, name: "Sarah Kovacs", role: "patient_manager" }]);
    }
    if (
      method === "POST" &&
      (path === `/appointments/${appointmentId}/report/approve` ||
        path === `/appointments/${appointmentId}/report/reject`)
    ) {
      reportPosts.push(path.split("/").pop() ?? "");
      return json(route, { ok: true, report_id: pendingReport.id });
    }
    if (path === `/appointments/${appointmentId}/report`) {
      return json(route, options.report ?? null);
    }
    if (path === "/patients") {
      return json(route, [
        { id: patientId, patient_id: "P-0031", first_name: "Synthetic", last_name: "Patient" },
      ]);
    }
    if (path === "/providers") {
      return json(route, [
        { id: providerId, name: "Synthetic Clinic", provider_type: "medical" },
      ]);
    }
    if (
      path.startsWith("/appointments/meta/") ||
      path.startsWith(`/appointments/${appointmentId}/`) ||
      path.startsWith("/tasks") ||
      path.startsWith("/concierge-services") ||
      path.startsWith(`/patients/${patientId}/`) ||
      path.startsWith(`/providers/${providerId}/`)
    ) {
      return json(route, []);
    }
    return json(route, { message: "Not mocked" }, 404);
  });

  await page.goto("/login");
  await page.locator("#email").fill("admin@gmed.de");
  await page.locator("#password").fill("admin123");
  await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await page.goto(
    `/appointments?appointment=${appointmentId}&detailTab=${options.detailTab ?? "workflow"}`,
  );
  return { statusPosts, reportPosts };
}

async function expectWorkflowReady(page: Page) {
  await expect(
    page.getByRole("button", { name: completeAndScheduleButton }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: completedStatusButton }),
  ).toBeVisible();
}

async function openReportReview(page: Page) {
  await page.getByRole("button", { name: /Review öffnen/ }).click();
  const sheet = page.getByRole("dialog").last();
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("appointment completion date rule", () => {
  test("a future appointment keeps completion closed with a hint", async ({ page }) => {
    const { statusPosts } = await openMockedAppointment(page, berlinDate(10));
    await expectWorkflowReady(page);

    const completed = page.getByRole("button", { name: completedStatusButton });
    await expect(completed).toBeDisabled();
    await expect(completed).toHaveAttribute("title", dateHint);
    await expect(
      page.getByTestId("appointment-status-completion-date-hint"),
    ).toHaveText(dateHint);
    const completeAndSchedule = page
      .getByRole("button", { name: completeAndScheduleButton })
      .first();
    await expect(completeAndSchedule).toBeDisabled();
    await expect(completeAndSchedule).toHaveAttribute("title", dateHint);
    // One hint per card: the status toggle carries it under its buttons.
    await expect(page.getByText(dateHint, { exact: true })).toHaveCount(1);
    // Other statuses stay available.
    await expect(page.getByRole("button", { name: /^Läuft$/ })).toBeEnabled();

    await completed.click({ force: true });
    expect(statusPosts).toEqual([]);
  });

  test("an appointment dated today can be completed", async ({ page }) => {
    const { statusPosts } = await openMockedAppointment(page, berlinDate(0));
    await expectWorkflowReady(page);

    await expect(
      page.getByRole("button", { name: completeAndScheduleButton }).first(),
    ).toBeEnabled();
    await expect(page.getByTestId("appointment-completion-date-hint")).toHaveCount(0);
    await expect(
      page.getByTestId("appointment-status-completion-date-hint"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: completedStatusButton }).click();
    await expect.poll(() => statusPosts).toEqual([
      { status: "completed", recurrence_scope: "single" },
    ]);
  });

  test("a pending report of a future appointment can be returned but not approved", async ({
    page,
  }) => {
    const { reportPosts } = await openMockedAppointment(page, berlinDate(10), {
      report: pendingReport,
      detailTab: "clinical",
    });
    const sheet = await openReportReview(page);

    const approve = sheet.getByRole("button", { name: /Stunden und Bericht freigeben/ });
    await expect(approve).toBeDisabled();
    await expect(approve).toHaveAttribute("title", reportDateHint);
    await expect(sheet.getByTestId("appointment-report-date-hint")).toHaveText(
      reportDateHint,
    );

    await sheet.getByRole("button", { name: /Zur Überarbeitung zurückgeben/ }).click();
    await expect.poll(() => reportPosts).toEqual(["reject"]);
  });

  test("a pending report of today's appointment can be approved", async ({ page }) => {
    const { reportPosts } = await openMockedAppointment(page, berlinDate(0), {
      report: pendingReport,
      detailTab: "clinical",
    });
    const sheet = await openReportReview(page);

    await expect(sheet.getByTestId("appointment-report-date-hint")).toHaveCount(0);
    await sheet.getByRole("button", { name: /Stunden und Bericht freigeben/ }).click();
    await expect.poll(() => reportPosts).toEqual(["approve"]);
  });
});
