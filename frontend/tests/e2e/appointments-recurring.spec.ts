import { expect, test, type Route } from "@playwright/test";
import { chooseComboboxOption } from "./helpers";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.describe("appointments recurring flows", () => {
  test("staff can cancel a whole recurring series from the detail workspace", async ({
    page,
  }) => {
    const patientId = "00000000-0000-0000-0000-00000000a001";
    const providerId = "00000000-0000-0000-0000-00000000b001";
    const doctorId = "00000000-0000-0000-0000-00000000c001";
    const ownerId = "00000000-0000-0000-0000-000000000001";
    const seriesId = "series-root-001";
    const appointmentIds = [
      "00000000-0000-0000-0000-00000000d001",
      "00000000-0000-0000-0000-00000000d002",
      "00000000-0000-0000-0000-00000000d003",
    ];

    let statuses = ["confirmed", "planned", "planned"] as Array<
      "planned" | "confirmed" | "cancelled"
    >;

    const buildList = () =>
      appointmentIds.map((id, index) => ({
        id,
        title: "Recurring therapy",
        date: `2026-04-${14 + index}`,
        time_start: "09:00",
        time_end: "10:00",
        type: "medical",
        status: statuses[index],
        location: "Clinic Cologne",
        interpreter_response: null,
        checklist_phase: "coordination",
        patient_id: patientId,
        patient_name: "Anna Muster",
        patient_pid: "PT-001",
        provider_id: providerId,
        provider_name: "Clinic Cologne",
        doctor_id: doctorId,
        doctor_name: "Doctor Cologne",
        owner_user_id: ownerId,
        owner_name: "Admin GMED",
        owner_role: "ceo",
        interpreter_id: null,
        interpreter_name: null,
        recurrence_series_id: seriesId,
        recurrence_frequency: "weekly",
        recurrence_interval: 1,
        recurrence_count: 3,
        recurrence_until: null,
        recurrence_index: index,
        recurrence_series_size: 3,
        is_blocked: false,
      }));

    const buildScopePreview = () =>
      appointmentIds.reduce<Array<{
        id: string;
        date: string;
        status: string | undefined;
        recurrence_index: number;
        open_checklist_count: number;
      }>>((items, id, index) => {
        const status = statuses[index];
        if (status === "cancelled") {
          return items;
        }

        items.push({
          id,
          date: `2026-04-${14 + index}`,
          status,
          recurrence_index: index,
          open_checklist_count: 0,
        });
        return items;
      }, []);

    const buildDetail = (id: string) => {
      const index = appointmentIds.indexOf(id);
      const listItem = buildList()[index];
      return {
        ...listItem,
        category: "followup",
        preparation_notes: null,
        followup_notes: null,
        notes: "Recurring treatment block.",
        order_id: null,
        recurrence_parent_series_id: null,
        recurrence_split_from_appointment_id: null,
        recurrence_split_from_index: null,
        recurring_scope_preview: buildScopePreview(),
        recurring_lineage_history: [
          {
            series_id: seriesId,
            parent_series_id: null,
            split_from_appointment_id: null,
            split_from_index: null,
            first_date: "2026-04-14",
            last_date: "2026-04-16",
            total_occurrences: 3,
            active_occurrences: statuses.filter((item) => item !== "cancelled")
              .length,
            completed_occurrences: 0,
            cancelled_occurrences: statuses.filter((item) => item === "cancelled")
              .length,
            relation: "current",
            depth: 0,
          },
        ],
        created_at: "2026-04-01T09:00:00Z",
      };
    };

    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "de");
    });

    await page.route("**/auth/**", async (route) => {
      const url = new URL(route.request().url());
      const { pathname } = url;

      if (pathname === "/auth/login" && route.request().method() === "POST") {
        return json(route, {
          access_token: "playwright-access-token",
          refresh_token: "playwright-refresh-token",
          token_type: "Bearer",
          expires_in: 900,
        });
      }

      if (pathname === "/auth/logout") {
        return json(route, { ok: true });
      }

      return json(route, { message: "Not mocked" }, 404);
    });

    await page.route("**/api/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");

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
            patient_id: "PT-001",
            first_name: "Anna",
            last_name: "Muster",
          },
        ]);
      }

      if (path === "/providers") {
        return json(route, [
          {
            id: providerId,
            name: "Clinic Cologne",
            provider_type: "medical",
            address_city: "Cologne",
            fachbereich: "Cardiology",
          },
        ]);
      }

      if (path === `/providers/${providerId}/doctors`) {
        return json(route, [
          {
            id: doctorId,
            name: "Doctor Cologne",
            title: "Dr.",
            fachbereich: "Cardiology",
          },
        ]);
      }

      if (path === "/appointments/meta/interpreters") {
        return json(route, []);
      }

      if (path === "/appointments/meta/staff") {
        return json(route, [
          {
            id: ownerId,
            name: "Admin GMED",
            role: "ceo",
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
        return json(route, buildList());
      }

      if (
        path === "/appointments/meta/attention" ||
        path.startsWith("/appointments/meta/attention?")
      ) {
        return json(route, []);
      }

      if (path.startsWith("/appointments/") && path.endsWith("/checklist")) {
        return json(route, []);
      }

      if (path.startsWith("/appointments/") && path.endsWith("/reminders")) {
        return json(route, []);
      }

      if (path.startsWith("/appointments/") && path.endsWith("/report")) {
        return json(route, null);
      }

      if (
        path.startsWith("/appointments/") &&
        path.endsWith("/communications")
      ) {
        return json(route, []);
      }

      if (path.startsWith("/tasks")) {
        return json(route, []);
      }

      if (path.startsWith("/concierge-services")) {
        return json(route, []);
      }

      if (path === `/patients/${patientId}/assignments`) {
        return json(route, []);
      }

      if (
        path.startsWith("/appointments/") &&
        path.endsWith("/status") &&
        route.request().method() === "POST"
      ) {
        const payload = JSON.parse(route.request().postData() ?? "{}") as {
          status?: string;
          recurrence_scope?: string;
        };
        if (payload.status === "cancelled" && payload.recurrence_scope === "series") {
          statuses = ["cancelled", "cancelled", "cancelled"];
        }
        return json(route, { ok: true });
      }

      const selectedId = appointmentIds.find((item) => path === `/appointments/${item}`);
      if (selectedId) {
        return json(route, buildDetail(selectedId));
      }

      return json(route, []);
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto(
      `/appointments?appointment=${appointmentIds[0]}&detailTab=workflow`,
    );

    const statusScopeSelect = page.getByRole("combobox", {
      name: /Statusänderung anwenden auf/i,
    });
    await chooseComboboxOption(page, statusScopeSelect, /Ganze Serie|Вся серия/i);

    const cancelWholeSeriesButton = page
      .getByRole("button", { name: /Ganze Serie absagen/i })
      .last();
    await expect(cancelWholeSeriesButton).toBeVisible();
    await cancelWholeSeriesButton.click();

    await expect(page.getByText(/^Abgesagt$/).first()).toBeVisible();
    await expect(page.getByText(/^3 abgesagt$/)).toBeVisible();
  });
});
