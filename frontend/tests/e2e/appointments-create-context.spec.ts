import { expect, test, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const patientId = "b0000000-0000-0000-0000-000000000031";
const otherPatientId = "b0000000-0000-0000-0000-000000000032";
const ownerId = "a0000000-0000-0000-0000-000000000031";
const firstOrderId = "f0000000-0000-0000-0000-000000000031";
const secondOrderId = "f0000000-0000-0000-0000-000000000032";

test.describe("new appointment from an order", () => {
  test("preselects the patient and order of the order workspace", async ({ page }) => {
    let ordersRequested = false;

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
      if (path === "/patients") {
        return json(route, [
          { id: otherPatientId, patient_id: "P-0031", first_name: "Anna", last_name: "Beispiel" },
          { id: patientId, patient_id: "P-0032", first_name: "Boris", last_name: "Muster" },
        ]);
      }
      if (path === `/patients/${patientId}/orders`) {
        ordersRequested = true;
        // Two open orders: without the order context none would be preselected.
        return json(route, [
          { id: firstOrderId, order_number: "A-2026-0031", phase: "execution", status: "active" },
          { id: secondOrderId, order_number: "A-2026-0032", phase: "execution", status: "active" },
        ]);
      }
      if (path === "/providers") return json(route, []);
      if (path === "/appointments/meta/staff") {
        return json(route, [{ id: ownerId, name: "Admin GMED", role: "ceo" }]);
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
      if (
        path === "/appointments" ||
        path.startsWith("/appointments/meta/") ||
        path.startsWith("/tasks") ||
        path.startsWith("/concierge-services")
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

    // The order workspace links to the calendar with its order and patient.
    await page.goto(`/appointments?order=${secondOrderId}&patient=${patientId}`);
    await page.getByRole("button", { name: "Neuer Termin" }).first().click();

    const sheet = page.getByRole("dialog").filter({ hasText: "Termin und Zeit" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("P-0032 · Boris Muster");
    const orderSelect = sheet.getByRole("combobox", { name: "Auftrag" });
    await expect(orderSelect).toBeVisible();
    await expect(orderSelect).toContainText("A-2026-0032");
    await expect(sheet.getByText("Auftrag", { exact: true })).toBeVisible();
    expect(ordersRequested).toBe(true);
  });
});

test.describe("planning appointments in a row from an order", () => {
  test("keeps the form open for the next appointment and returns to the order", async ({ page }) => {
    const created: Array<Record<string, unknown>> = [];

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
      if (path === "/patients") {
        return json(route, [
          { id: patientId, patient_id: "P-0032", first_name: "Boris", last_name: "Muster" },
        ]);
      }
      if (path === `/patients/${patientId}/orders`) {
        return json(route, [
          { id: firstOrderId, order_number: "A-2026-0031", phase: "execution", status: "active" },
        ]);
      }
      if (path === "/providers") return json(route, []);
      if (path === "/appointments/meta/staff") {
        return json(route, [{ id: ownerId, name: "Admin GMED", role: "ceo" }]);
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
      if (path === "/appointments" && method === "POST") {
        created.push(route.request().postDataJSON());
        return json(route, { id: `a0000000-0000-0000-0000-00000000010${created.length}` });
      }
      if (
        path === "/appointments" ||
        path.startsWith("/appointments/meta/") ||
        path.startsWith("/tasks") ||
        path.startsWith("/concierge-services")
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

    const returnTo = `/orders/${firstOrderId}?section=planning`;
    await page.goto(
      `/appointments?order=${firstOrderId}&patient=${patientId}&return_to=${encodeURIComponent(returnTo)}&create=1`,
    );

    const sheet = page.getByRole("dialog").filter({ hasText: "Termin und Zeit" });
    await expect(sheet).toBeVisible();
    const planNext = sheet.getByRole("button", { name: "Speichern und nächsten planen" });
    await expect(planNext).toBeVisible();

    const title = sheet.getByLabel(/Titel/).first();
    await sheet.locator("#appointment-skip-provider-binding").check();
    await title.fill("MRT Abdomen");
    await planNext.click();

    await expect(sheet.getByTestId("appointment-planned-saved")).toContainText("Gespeicherte Termine: 1");
    await expect(title).toHaveValue("");
    await sheet.getByRole("button", { name: "Fertig" }).click();

    await expect(page).toHaveURL((url) => url.pathname === `/orders/${firstOrderId}` && url.search === "?section=planning");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ patient_id: patientId, order_id: firstOrderId, title: "MRT Abdomen" });
  });
});
