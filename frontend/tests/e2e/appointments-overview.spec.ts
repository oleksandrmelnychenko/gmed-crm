import { expect, test, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test.describe("appointments overview detail", () => {
  test("staff overview shows mapped roles, warning copy and linked records sections correctly", async ({
    page,
  }) => {
    const patientId = "b0000000-0000-0000-0000-000000000008";
    const providerId = "c0000000-0000-0000-0000-000000000003";
    const doctorId = "c1000000-0000-0000-0000-000000000006";
    const ownerId = "a0000000-0000-0000-0000-000000000003";
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
      status: "completed",
      location: "Heidelberg International Office",
      interpreter_response: "accepted",
      checklist_phase: "done",
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
      notes: "Used for feedback, document versioning and closure billing examples.",
      order_id: orderId,
      recurrence_parent_series_id: null,
      recurrence_split_from_appointment_id: null,
      recurrence_split_from_index: null,
      recurring_scope_preview: [],
      recurring_lineage_history: [],
      created_at: "2026-04-11T15:15:16.409719+03:00",
    };

    const attentionItem = {
      ...listItem,
      attention_score: 1,
      reasons: ["1 visit-processing checklist item(s) remain open"],
      next_due_at: "2026-04-14T09:30:00Z",
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
        return json(route, [attentionItem]);
      }

      if (path === `/appointments/${appointmentId}`) {
        return json(route, detail);
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

      return json(route, { message: "Not mocked" }, 404);
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });

    await page.goto(
      `/appointments?appointment=${appointmentId}&detailTab=overview`,
    );

    const summarySection = page
      .locator("section")
      .filter({ hasText: "Status und Zuständigkeiten" })
      .first();
    await expect(summarySection).toBeVisible();
    await expect(summarySection).toContainText("Arzt");
    await expect(summarySection).toContainText("Claudia Neumann");
    await expect(summarySection).toContainText("Dolmetscher");
    await expect(summarySection).toContainText("Marina Sokolova");
    await expect(summarySection).not.toContainText(/Arzt\s*Marina Sokolova/);

    await expect(summarySection).toContainText("Medizinisch");
    await expect(page.getByText(/Mon,\s*13 Apr 2026/)).toHaveCount(0);
    await expect(page.getByText(/Mo.*13.*Apr.*2026.*13:00 - 14:00/)).toBeVisible();

    const attentionSection = page
      .locator("section")
      .filter({ hasText: "Operativer Follow-up offen" })
      .first();
    await expect(attentionSection).toBeVisible();
    await expect(attentionSection).toContainText("1 offener Punkt");
    await expect(page.getByText("Ein Fehler ist aufgetreten")).toHaveCount(0);

    const linkedSection = page
      .locator("section")
      .filter({ hasText: "Verknüpfte Datensätze" })
      .first();
    await expect(linkedSection).toBeVisible();
    await expect(linkedSection.getByRole("button", { name: /^Patient\b/ })).toBeVisible();
    await expect(linkedSection.getByRole("button", { name: /^Auftrag\b/ })).toBeVisible();
    await expect(linkedSection.getByRole("button", { name: /^Klinik\b/ })).toBeVisible();
    await expect(linkedSection.getByRole("button", { name: /^Dokumente\b/ })).toBeVisible();
    await expect(linkedSection.getByRole("button", { name: /^Fälle\b/ })).toBeVisible();
    await expect(linkedSection).not.toContainText("Arbeitsbereich öffnen");
    await expect(linkedSection).not.toContainText("Schnellvorschau");
  });
});
