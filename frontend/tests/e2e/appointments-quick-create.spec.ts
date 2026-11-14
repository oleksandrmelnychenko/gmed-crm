import { expect, test, type Route } from "@playwright/test";

import { chooseComboboxOption } from "./helpers";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const patientId = "b0000000-0000-0000-0000-000000000041";
const ownerId = "a0000000-0000-0000-0000-000000000041";

test.describe("quick visit from the calendar (owner 2026-11-14)", () => {
  test("a click on free time opens a small form next to it, names a clash and saves without the big sheet", async ({ page }) => {
    const created: Array<Record<string, unknown>> = [];
    let appointmentLoads = 0;

    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "ru");
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
        return json(route, { id: ownerId, email: "admin@gmed.de", name: "Admin GMED", role: "ceo", created_at: "2026-01-01T00:00:00Z" });
      }
      if (path === "/patients") {
        return json(route, [{ id: patientId, patient_id: "P-0041", first_name: "Anna", last_name: "Beispiel" }]);
      }
      if (path === `/patients/${patientId}/orders`) return json(route, []);
      if (path === "/providers") {
        return json(route, [{ id: "klinik", name: "Klinik Nord", provider_type: "medical", address_city: "Berlin" }]);
      }
      if (path === "/providers/klinik/doctors") return json(route, [{ id: "weber", name: "Dr. Weber", title: null, fachbereich: null }]);
      if (path === "/providers/specializations") return json(route, []);
      if (path === "/appointments/meta/staff") return json(route, [{ id: ownerId, name: "Admin GMED", role: "ceo" }]);
      if (path.startsWith("/appointments/meta/conflicts")) {
        // The patient already has a visit at that time.
        return json(route, {
          patient_conflict_count: 1,
          interpreter_conflict_count: 0,
          doctor_conflict_count: 0,
          has_conflicts: true,
          patient_conflicts: [
            { id: "existing", title: "Check up-Kardiologie", date: url.searchParams.get("date"), time_start: "10:00", time_end: "11:00",
              patient_id: patientId, patient_name: "Anna Beispiel", patient_pid: "P-0041" },
          ],
          interpreter_conflicts: [],
          doctor_conflicts: [],
        });
      }
      if (path === "/appointments" && method === "POST") {
        created.push(route.request().postDataJSON());
        return json(route, { id: "new-visit", conflicts: null }, 201);
      }
      if (path === "/appointments") {
        appointmentLoads += 1;
        return json(route, []);
      }
      if (path.startsWith("/appointments/meta/") || path.startsWith("/tasks") || path.startsWith("/concierge-services")) {
        return json(route, []);
      }
      return json(route, { message: "Not mocked" }, 404);
    });

    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await page.goto("/appointments");

    const lane = page.locator('.fc-timegrid-slot-lane[data-time="10:00:00"]').first();
    await expect(lane).toBeVisible();
    await lane.click();

    const quick = page.getByTestId("appointment-quick-create");
    await expect(quick).toBeVisible();
    await expect(quick).toContainText("10:00–11:00");
    // The full sheet does not open.
    await expect(page.getByRole("dialog").filter({ hasText: "Термин и время" })).toHaveCount(0);

    await chooseComboboxOption(page, quick.getByRole("combobox", { name: /Пациент/ }), "P-0041 · Anna Beispiel");
    await chooseComboboxOption(page, quick.getByRole("combobox", { name: "Клиника / провайдер" }), /Klinik Nord/);
    await chooseComboboxOption(page, quick.getByRole("combobox", { name: "Врач" }), "Dr. Weber");
    await expect(quick.getByRole("textbox", { name: "Название приёма" })).toHaveValue("Dr. Weber");
    await quick.getByRole("button", { name: "45 мин" }).click();
    await expect(quick).toContainText("10:00–10:45");
    await expect(quick.getByTestId("appointment-quick-create-conflict")).toContainText("Check up-Kardiologie");

    const loadsBefore = appointmentLoads;
    await quick.getByTestId("appointment-quick-create-save").click();
    await expect(quick).toHaveCount(0);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      patient_id: patientId,
      provider_id: "klinik",
      doctor_id: "weber",
      appointment_type: "medical",
      title: "Dr. Weber",
      time_start: "10:00",
      time_end: "10:45",
      location: "Klinik Nord",
    });
    expect(created[0].interpreter_needed ?? null).toBeNull();
    await expect.poll(() => appointmentLoads).toBeGreaterThan(loadsBefore);
  });

  test("«Больше полей…» opens the full sheet with the time already chosen", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("gmed_lang", "ru");
    });
    await page.route("**/api/v1/**", async (route) => {
      const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
      if (path === "/auth/login") {
        return json(route, { access_token: "t", refresh_token: "r", token_type: "Bearer", expires_in: 900 });
      }
      if (path === "/me") {
        return json(route, { id: ownerId, email: "admin@gmed.de", name: "Admin GMED", role: "ceo", created_at: "2026-01-01T00:00:00Z" });
      }
      if (path === "/patients") return json(route, [{ id: patientId, patient_id: "P-0041", first_name: "Anna", last_name: "Beispiel" }]);
      if (path === "/providers") return json(route, []);
      if (path === "/providers/specializations") return json(route, []);
      if (path === "/appointments/meta/staff") return json(route, [{ id: ownerId, name: "Admin GMED", role: "ceo" }]);
      if (path === "/appointments" || path.startsWith("/appointments/meta/") || path.startsWith("/tasks") || path.startsWith("/concierge-services")) {
        return json(route, []);
      }
      return json(route, { message: "Not mocked" }, 404);
    });
    await page.goto("/login");
    await page.locator("#email").fill("admin@gmed.de");
    await page.locator("#password").fill("admin123");
    await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
    await page.waitForURL(/\/$/, { timeout: 15_000 });
    await page.goto("/appointments");

    await page.locator('.fc-timegrid-slot-lane[data-time="14:00:00"]').first().click();
    const quick = page.getByTestId("appointment-quick-create");
    await expect(quick).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(quick).toHaveCount(0);

    await page.locator('.fc-timegrid-slot-lane[data-time="14:00:00"]').first().click();
    await quick.getByRole("button", { name: "Больше полей…" }).click();
    await expect(quick).toHaveCount(0);
    const sheet = page.getByRole("dialog").last();
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('input[value="14:00"], input[value="15:00"]').first()).toBeAttached();
  });
});
