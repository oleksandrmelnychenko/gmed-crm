import { expect, test, type Route } from "@playwright/test";

import { chooseComboboxOption, startClockAt } from "./helpers";

// QA 2026-10-11 C-12/C-20: a concierge service reaches "Забронировано" and
// "Подтверждено" only through the partner booking, which had no reachable UI.
// The service card on /services now books the partner and links its task.

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const ceoId = "a0000000-0000-0000-0000-000000000051";
const serviceId = "c0000000-0000-0000-0000-000000000051";
const taskId = "d0000000-0000-0000-0000-000000000051";
const providerId = "e0000000-0000-0000-0000-000000000051";

function service(overrides: Record<string, unknown> = {}) {
  return {
    id: serviceId,
    patient_id: "b0000000-0000-0000-0000-000000000051",
    patient_name: "Mia Muster",
    patient_pid: "P-0051",
    appointment_id: null,
    appointment_title: null,
    provider_id: null,
    provider_name: null,
    provider_service_id: null,
    provider_service_name: null,
    taxonomy_node_id: null,
    taxonomy_node_code: null,
    taxonomy_node_name_de: null,
    taxonomy_node_name_ru: null,
    assigned_concierge_id: null,
    assigned_concierge_name: null,
    service_kind: "transfer",
    title: "Flughafentransfer Beispiel",
    status: "planned",
    booking_reference: null,
    vendor_name: null,
    vendor_contact: null,
    service_address: null,
    starts_at: "2026-10-20T12:00:00Z",
    ends_at: "2026-10-20T13:00:00Z",
    cost_estimate: null,
    actual_cost: null,
    quantity: "1",
    unit_price: null,
    currency: "EUR",
    billing_status: "draft",
    service_notes: "Automatisch aus nichtmedizinischem Termin erstellt",
    billing_notes: null,
    request_source: "appointment_bootstrap",
    completed_at: null,
    billed_at: null,
    linked_task_id: taskId,
    allowed_statuses: ["planned", "in_service", "cancelled"],
    allowed_billing_statuses: ["draft"],
    financial_locked: false,
    booking_decision_required_at: null,
    created_at: "2026-10-11T10:00:00Z",
    updated_at: "2026-10-11T10:00:00Z",
    ...overrides,
  };
}

test("CEO books the partner of a planned service and confirms the booking (RU)", async ({ page }) => {
  let current = service();
  const bookings: Array<Record<string, unknown>> = [];

  await page.addInitScript(() => {
    window.localStorage.setItem("gmed_lang", "ru");
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/auth/login" && request.method() === "POST") {
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
        id: ceoId,
        email: "ceo@example.com",
        name: "Ben Muster",
        role: "ceo",
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    if (path === "/providers" && request.method() === "GET") {
      return json(route, [
        {
          id: providerId,
          name: "Beispiel Transfer GmbH",
          provider_type: "non_medical",
          address_street: "Musterweg 1",
          address_city: "Berlin",
          address_country: "Deutschland",
          phone: "+49 30 1234567",
          email: "transfer@example.com",
          is_active: true,
        },
      ]);
    }
    if (path === "/concierge-services" && request.method() === "GET") return json(route, [current]);
    if (path === `/concierge-services/${serviceId}/book-provider` && request.method() === "POST") {
      const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
      bookings.push(body);
      current = service({
        provider_id: providerId,
        provider_name: "Beispiel Transfer GmbH",
        status: body.booking_state === "confirmed" ? "confirmed" : "booked",
        booking_reference: (body.booking_reference as string | null) ?? null,
        vendor_contact: "+49 30 1234567",
        service_address: body.service_address,
        allowed_statuses: body.booking_state === "confirmed" ? ["confirmed", "in_service", "cancelled"] : ["booked", "cancelled"],
      });
      return json(route, { service: current, interaction_id: "f0000000-0000-0000-0000-000000000051" });
    }
    if (request.method() === "GET") return json(route, []);
    return json(route, { message: "Not mocked" }, 404);
  });

  // The slot (20.10.2026) stays in the future whatever the real date.
  await startClockAt(page);
  await page.goto("/login");
  await page.locator("#email").fill("ceo@example.com");
  await page.locator("#password").fill("synthetic-test");
  await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });

  await page.goto("/services");
  await page.getByText("Flughafentransfer Beispiel").first().click();
  const detail = page.getByRole("dialog").filter({ hasText: "Flughafentransfer Beispiel" });
  await expect(detail).toBeVisible();

  // The system note is shown in the UI language; the task is one click away.
  await expect(detail).toContainText("Создано автоматически из немедицинского приёма");
  const openTask = detail.getByRole("button", { name: "Открыть задачу" });
  await expect(openTask).toHaveAttribute("href", `/task-manager?task=${taskId}`);

  // Step 1: request the booking with the partner.
  await detail.getByRole("button", { name: "Забронировать у партнёра" }).click();
  const booking = page.getByRole("dialog").filter({ hasText: "Бронирование у партнёра" });
  await expect(booking).toBeVisible();
  await chooseComboboxOption(
    page,
    booking.getByRole("combobox", { name: /Партнёр/ }),
    "Beispiel Transfer GmbH · Berlin",
  );
  await booking.getByRole("button", { name: "Сохранить бронь" }).click();
  await expect(booking).toBeHidden();
  expect(bookings[0]).toMatchObject({
    provider_id: providerId,
    booking_state: "requested",
    starts_at: "2026-10-20T12:00:00.000Z",
    service_address: "Musterweg 1, Berlin, Deutschland",
  });
  await expect(detail).toContainText("Забронировано");

  // Step 2: confirm it with the booking number.
  await detail.getByRole("button", { name: "Подтвердить бронь" }).click();
  await expect(booking).toBeVisible();
  await expect(booking.getByRole("button", { name: "Запрошено" })).toBeDisabled();
  await expect(booking.getByRole("button", { name: "Сохранить бронь" })).toBeDisabled();
  await booking.getByLabel("Номер брони (необязательно)").fill("BT-QA-0051");
  await booking.getByRole("button", { name: "Сохранить бронь" }).click();
  await expect(booking).toBeHidden();
  expect(bookings[1]).toMatchObject({
    provider_id: providerId,
    booking_state: "confirmed",
    booking_reference: "BT-QA-0051",
  });
  await expect(detail).toContainText("Подтверждено");
  await expect(detail).toContainText("BT-QA-0051");
  await expect(detail.getByRole("button", { name: /Забронировать у партнёра|Подтвердить бронь/ })).toHaveCount(0);
});
