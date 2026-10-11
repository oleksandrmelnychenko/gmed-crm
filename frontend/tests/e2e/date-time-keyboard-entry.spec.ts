import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

import { pickerValueInput } from "./helpers";

// Keyboard entry of dates and times (QA 2026-10-11, C-07/C-11/C-26/C-29, A-28):
// typed day and month must survive the year, time fields take digits, and the
// time lists close with "OK" or Escape, one at a time.

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const ownerId = "a0000000-0000-0000-0000-000000000041";
const patientId = "b0000000-0000-0000-0000-000000000041";

async function openNewAppointmentSheet(page: Page) {
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
      return json(route, [{ id: patientId, patient_id: "P-0041", first_name: "Mia", last_name: "Muster" }]);
    }
    if (path === `/patients/${patientId}/orders`) return json(route, []);
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

  await page.goto(`/appointments?patient=${patientId}`);
  await page.getByRole("button", { name: "Neuer Termin" }).first().click();
  const sheet = page.getByRole("dialog").filter({ hasText: "Termin und Zeit" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Clicks the first section of a picker field and types digits like a person (one key at a time). */
async function typeIntoPicker(page: Page, field: Locator, digits: string) {
  await field.getByRole("spinbutton").first().click();
  // The pause lets the field's own timers run between keys, as with a real keyboard.
  await page.keyboard.type(digits, { delay: 120 });
}

test.describe("keyboard entry of dates and times", () => {
  test("appointment date and times can be typed; time lists close and open one at a time", async ({ page }) => {
    const sheet = await openNewAppointmentSheet(page);

    const date = sheet.getByRole("group", { name: /^Datum/ });
    await typeIntoPicker(page, date, "20102026");
    await expect(pickerValueInput(sheet, /^Datum/)).toHaveValue("20.10.2026");

    const start = sheet.getByRole("group", { name: /^Start$/ });
    const end = sheet.getByRole("group", { name: /^Ende$/ });
    await typeIntoPicker(page, start, "0930");
    await expect(pickerValueInput(sheet, /^Start$/)).toHaveValue("09:30");
    await typeIntoPicker(page, end, "1045");
    await expect(pickerValueInput(sheet, /^Ende$/)).toHaveValue("10:45");

    const listboxes = page.getByRole("listbox");
    const openButton = (field: Locator) => field.getByRole("button", { name: /Uhrzeit auswählen/ });

    // Escape closes the start list.
    await openButton(start).click();
    await expect(listboxes.first()).toBeVisible();
    const openCount = await listboxes.count();
    await page.keyboard.press("Escape");
    await expect(listboxes).toHaveCount(0);

    // Opening the end list closes the start list: never two at once.
    await openButton(start).click();
    await expect(listboxes).toHaveCount(openCount);
    await openButton(end).click();
    await expect(listboxes).toHaveCount(openCount);

    // "OK" closes the list.
    await page.getByRole("button", { name: /^OK$/i }).click();
    await expect(listboxes).toHaveCount(0);
    await expect(pickerValueInput(sheet, /^Start$/)).toHaveValue("09:30");
    await expect(pickerValueInput(sheet, /^Ende$/)).toHaveValue("10:45");
  });
});
