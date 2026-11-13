import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, subscribed = false, guardianOnly = false) {
  const chatReads: string[] = [];
  const ownReads: string[] = [];
  const patients = [
    { id: "mother", name: "Synthetic Mother", patient_number: "P1", access_kind: guardianOnly ? "guardian" : "self", has_active_subscription: subscribed },
    { id: "child", name: "Synthetic Child", patient_number: "P2", access_kind: "guardian", has_active_subscription: true },
  ];
  await page.addInitScript(() => {
    // Browser-only mock token: the client uses its subject for tab-local context.
    localStorage.setItem("gmed_access_token", `synthetic.${btoa(JSON.stringify({ sub: "family-user" }))}.signature`);
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_nav_collapsed", "false");
  });
  await page.routeWebSocket("**/api/**", (ws) => ws.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: {
      id: "family-user", role: "patient", name: "Synthetic Mother", email: "family@example.test",
      portal_mode: "patient", password_change_required: false, patients,
    } });
    if (path === "/me/profile") return route.fulfill({ json: { id: "family-user", role: "patient", name: "Synthetic Mother", email: "family@example.test" } });
    const patient = route.request().headers()["x-patient-id"];
    if (path.startsWith("/messages")) chatReads.push(`${path}:${patient}`);
    if (["/me/recommendations", "/me/appointments"].some((prefix) => path.startsWith(prefix))) {
      ownReads.push(`${path}:${patient}`);
    }
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: [] });
  });
  return { chatReads, ownReads };
}

// Owner decision 9 (2026-11-13): the order tariff is optional. Without it the
// portal shows everything of the own orders; only the team chat and a new
// concierge request carry a padlock.
test("without a tariff only the chat is locked, the own visits stay open", async ({ page }) => {
  const { chatReads } = await setup(page);
  await page.goto("/account");
  const nav = page.locator("nav");
  for (const name of ["Аккаунт", "Мои документы", "Мои счета", "Мои визиты", "Мои уведомления"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await nav.getByRole("button", { name: /Чат/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Нужен тариф заказа");
  await expect(page.getByRole("dialog")).toContainText("в заказе этого пациента");
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).first().click();
  expect(chatReads).toEqual([]);
});

test("a direct chat URL stays locked, the visits open without a tariff, the subscribed child opens the chat", async ({ page }) => {
  const { chatReads, ownReads } = await setup(page);
  await page.goto("/appointments");
  await expect(page.getByTestId("portal-subscription-lock")).toHaveCount(0);
  await expect.poll(() => ownReads.some((read) => read.startsWith("/me/appointments:mother"))).toBe(true);
  await page.goto("/chat");
  await expect(page.getByTestId("portal-subscription-lock")).toContainText("Нужен тариф заказа");
  expect(chatReads.filter((read) => read.endsWith(":mother"))).toEqual([]);
  await page.locator("#portal-patient").selectOption("child");
  await expect(page.getByTestId("portal-subscription-lock")).toHaveCount(0);
  await page.locator("#portal-patient").selectOption("mother");
  await expect(page.getByTestId("portal-subscription-lock")).toContainText("Нужен тариф заказа");
});

test("an actively subscribed patient keeps normal navigation", async ({ page }) => {
  await setup(page, true);
  await page.goto("/legal");
  await expect(page.locator("nav").getByRole("link", { name: "Чат", exact: true })).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: /Чат/ })).toHaveCount(0);
});

test("a guardian without a selected patient can reach the chooser before any read", async ({ page }) => {
  const { ownReads } = await setup(page, false, true);
  await page.goto("/account");
  await page.locator("nav").getByRole("link", { name: "Мои рекомендации", exact: true }).click();
  await expect(page.getByText("Выберите, для кого открыть кабинет.", { exact: true })).toBeVisible();
  expect(ownReads).toEqual([]);
  await page.locator("#portal-patient").selectOption("child");
  await expect.poll(() => ownReads.filter((read) => read.startsWith("/me/recommendations"))).toEqual(["/me/recommendations:child"]);
});
