import { expect, test, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.describe("appointments workflow detail", () => {
  test("staff workflow uses the current cockpit pattern and business warning copy", async ({
    page,
  }) => {
    const patientId = "b0000000-0000-0000-0000-000000000008";
    const providerId = "c0000000-0000-0000-0000-000000000003";
    const doctorId = "c1000000-0000-0000-0000-000000000006";
    const ownerId = "a0000000-0000-0000-0000-000000000003";
    const billingId = "a0000000-0000-0000-0000-000000000004";
    const interpreterId = "a0000000-0000-0000-0000-000000000006";
    const appointmentId = "11000000-0000-0000-0000-000000000008";
    const orderId = "f0000000-0000-0000-0000-000000000007";

    const listItem = {
      id: appointmentId,
      title: "Oncology second-opinion board",
      date: "2026-04-13",
      time_start: "13:00",
      time_end: "14:00",
      type: "medical",
      care_path_kind: "regular",
      status: "confirmed",
      location: "Heidelberg International Office",
      interpreter_response: "accepted",
      checklist_phase: "follow_up",
      patient_id: patientId,
      patient_name: "Fatima Al Rashid",
      patient_pid: "P-0008",
      provider_id: providerId,
      provider_name: "Universitaetsklinikum Heidelberg",
      doctor_id: doctorId,
      doctor_name: "Claudia Neumann",
      owner_user_id: ownerId,
      owner_name: "Sarah Kovacs",
      owner_role: "patient_manager",
      interpreter_id: interpreterId,
      interpreter_name: "Marina Sokolova",
      recurrence_series_id: null,
      recurrence_frequency: null,
      recurrence_interval: null,
      recurrence_count: null,
      recurrence_until: null,
      recurrence_index: 0,
      recurrence_series_size: 1,
      is_blocked: false,
    } as const;

    const detail = {
      ...listItem,
      category: "consultation",
      preparation_notes: "Pathology translation delivered one day before board.",
      followup_notes: "Translated recommendation pending final release.",
      notes: "Used for workflow cockpit coverage.",
      order_id: orderId,
      recurrence_parent_series_id: null,
      recurrence_split_from_appointment_id: null,
      recurrence_split_from_index: null,
      recurring_scope_preview: [],
      recurring_lineage_history: [],
      created_at: "2026-04-11T15:15:16.409719+03:00",
    };

    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "de");
    });

    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");

      if (path === "/auth/login" && route.request().method() === "POST") {
        return json(route, {
          access_token: "playwright-access-token",
          refresh_token: "playwright-refresh-token",
          token_type: "Bearer",
          expires_in: 900,
        });
      }

      if (path === "/auth/logout") {
        return json(route, { ok: true });
      }

      if (path === "/me") {
        return json(route, {
          id: ownerId,
          email: "admin@gmed.de",
          name: "Admin GMED",
          role: "ceo",
          created_at: "2026-01-01T00:00:00Z",
        });
      }

      if (path === "/patients") {
        return json(route, [
          {
            id: patientId,
            patient_id: "P-0008",
            first_name: "Fatima",
            last_name: "Al Rashid",
          },
        ]);
      }

      if (path === "/providers") {
        return json(route, [
          {
            id: providerId,
            name: "Universitaetsklinikum Heidelberg",
            provider_type: "medical",
            address_city: "Heidelberg",
            fachbereich: "Oncology",
          },
        ]);
      }

      if (path === `/providers/${providerId}/doctors`) {
        return json(route, [
          {
            id: doctorId,
            name: "Claudia Neumann",
            title: "Dr.",
            fachbereich: "Oncology",
          },
        ]);
      }

      if (path === "/appointments/meta/interpreters") {
        return json(route, [
          {
            id: interpreterId,
            name: "Marina Sokolova",
            user_id: interpreterId,
          },
        ]);
      }

      if (path === "/appointments/meta/staff") {
        return json(route, [
          {
            id: ownerId,
            name: "Sarah Kovacs",
            role: "patient_manager",
          },
          {
            id: billingId,
            name: "Lena Billing",
            role: "billing",
          },
        ]);
      }

      if (
        path === "/appointments/meta/conflicts" ||
        path.startsWith("/appointments/meta/conflicts?")
      ) {
        return json(route, {
          patient_conflict_count: 0,
          interpreter_conflict_count: 0,
          has_conflicts: false,
          patient_conflicts: [],
          interpreter_conflicts: [],
        });
      }

      if (path === "/appointments" || path.startsWith("/appointments?")) {
        return json(route, [listItem]);
      }

      if (
        path === "/appointments/meta/attention" ||
        path.startsWith("/appointments/meta/attention?")
      ) {
        return json(route, []);
      }

      if (path === `/appointments/${appointmentId}`) {
        return json(route, detail);
      }

      if (path === `/appointments/${appointmentId}/checklist`) {
        return json(route, [
          {
            id: "check-1",
            phase: "visit_processing",
            item_text: "Verify translated pathology files",
            is_completed: false,
            completed_at: null,
          },
          {
            id: "check-2",
            phase: "follow_up",
            item_text: "Prepare tumour board recap",
            is_completed: false,
            completed_at: null,
          },
          {
            id: "check-3",
            phase: "intake",
            item_text: "Patient identity confirmed",
            is_completed: true,
            completed_at: "2026-04-12T10:00:00Z",
          },
        ]);
      }

      if (path === `/appointments/${appointmentId}/reminders`) {
        return json(route, [
          {
            id: "rem-1",
            user_id: ownerId,
            user_name: "Sarah Kovacs",
            remind_at: "2026-04-14T09:30:00Z",
            title: "Confirm released recommendation",
            description: "Call the clinic and request the final signed note.",
            is_completed: false,
            completed_at: null,
          },
        ]);
      }

      if (path === `/appointments/${appointmentId}/report`) {
        return json(route, {
          id: "report-1",
          interpreter_id: interpreterId,
          interpreter_name: "Marina Sokolova",
          hours: "2.00",
          report_text: "Interpreted the board discussion and documented follow-up questions.",
          approval_status: "pending",
          notes: null,
          approved_by_name: null,
          approved_at: null,
          created_at: "2026-04-13T15:00:00Z",
        });
      }

      if (
        path === `/appointments/${appointmentId}/communications` ||
        path.startsWith(`/appointments/${appointmentId}/communications?`)
      ) {
        return json(route, []);
      }

      if (path === "/tasks" && url.searchParams.get("appointment_id") === appointmentId) {
        return json(route, [
          {
            id: "task-1",
            title: "PM follow-up with clinic",
            description: "Escalate if the written recommendation is still missing.",
            assigned_to: ownerId,
            assigned_to_name: "Sarah Kovacs",
            assigned_to_role: "patient_manager",
            assigned_by: ownerId,
            assigned_by_name: "Sarah Kovacs",
            patient_id: patientId,
            order_id: orderId,
            appointment_id: appointmentId,
            due_date: "2026-04-14T12:00:00Z",
            priority: "high",
            status: "open",
            completed_at: null,
            created_at: "2026-04-13T16:00:00Z",
            updated_at: "2026-04-13T16:00:00Z",
          },
        ]);
      }

      if (path.startsWith("/concierge-services")) {
        return json(route, []);
      }

      if (path === `/patients/${patientId}/assignments`) {
        return json(route, [
          {
            user_id: ownerId,
            user_name: "Sarah Kovacs",
            user_role: "patient_manager",
            user_active: true,
            assigned_by: ownerId,
            assigned_by_name: "Admin GMED",
            assigned_at: "2026-04-10T08:00:00Z",
            revoked_at: null,
          },
        ]);
      }

      return json(route, { message: "Not mocked" }, 404);
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto(
      `/appointments?appointment=${appointmentId}&detailTab=workflow`,
    );

    await expect(
      page.getByRole("heading", { name: /Operativer .berblick/i }),
    ).toBeVisible();
    await expect(page.getByText("Operativer Überblick")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Abschlussbereitschaft" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Termine" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Dolmetscherbesetzung" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Checkliste" })).toBeVisible();

    const overviewSection = page
      .locator("section")
      .filter({ hasText: "Operativer Überblick" })
      .first();
    await expect(overviewSection).toContainText("Checklisten-Fortschritt");
    await expect(overviewSection).toContainText("1/3");
    await expect(overviewSection).toContainText("Dolmetscher-Gate");
    await expect(overviewSection).toContainText("Ausstehend");

    await expect(
      page
        .locator("section")
        .filter({ hasText: "Operativer Überblick" })
        .first()
        .getByText(/Dolmetscherbericht oder Freigabe ist noch ausstehend/i)
        .first(),
    ).toBeVisible();
    await expect(page.getByText("Ein Fehler ist aufgetreten")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Erinnerungen" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Operative Aufgaben" })).toBeVisible();

    await page.screenshot({
      path: "test-results/appointment-workflow-11000000.png",
      fullPage: true,
    });
  });
});
