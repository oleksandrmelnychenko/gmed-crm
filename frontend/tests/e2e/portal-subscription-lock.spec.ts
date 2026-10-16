import { expect, test, type Page } from "@playwright/test";

async function setup(page: Page, subscribed = false, guardianOnly = false) {
  const paidReads: string[] = [];
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
    if (["/me/recommendations", "/me/appointments", "/notifications", "/me/subscriptions"].some((prefix) => path.startsWith(prefix))) {
      paidReads.push(`${path}:${route.request().headers()["x-patient-id"]}`);
    }
    if (path === "/notifications/unread-count") return route.fulfill({ json: { count: 0 } });
    return route.fulfill({ json: [] });
  });
  return { paidReads };
}

test("without a subscription, services have locks while basic records stay linked", async ({ page }) => {
  const { paidReads } = await setup(page);
  await page.goto("/account");
  const nav = page.locator("nav");
  for (const name of ["Аккаунт", "Конфиденциальность", "Мои документы", "Мои счета"]) {
    await expect(nav.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await nav.getByRole("button", { name: /Мои визиты/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Нужна активная подписка");
  await expect(page.getByRole("dialog")).toContainText("в заказе этого пациента");
  await page.getByRole("dialog").getByRole("button", { name: "Закрыть", exact: true }).first().click();
  expect(paidReads).toEqual([]);
});

test("a direct paid URL stays locked and switching to the subscribed child opens only that context", async ({ page }) => {
  const { paidReads } = await setup(page);
  await page.goto("/recommendations");
  await expect(page.getByRole("status")).toContainText("Этот раздел закрыт");
  expect(paidReads.filter((read) => read.startsWith("/me/recommendations"))).toEqual([]);
  await page.locator("#portal-patient").selectOption("child");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect.poll(() => paidReads.filter((read) => read.startsWith("/me/recommendations"))).toEqual(["/me/recommendations:child"]);
  await page.locator("#portal-patient").selectOption("mother");
  await expect(page.getByRole("status")).toContainText("Этот раздел закрыт");
  expect(paidReads.filter((read) => read.startsWith("/me/recommendations"))).toEqual(["/me/recommendations:child"]);
});

test("an actively subscribed patient keeps normal navigation", async ({ page }) => {
  await setup(page, true);
  await page.goto("/legal");
  await expect(page.locator("nav").getByRole("link", { name: "Мои визиты", exact: true })).toBeVisible();
  await expect(page.locator("nav").getByRole("button", { name: /Мои визиты/ })).toHaveCount(0);
});

test("a guardian without a selected patient can reach the chooser before subscription checks", async ({ page }) => {
  const { paidReads } = await setup(page, false, true);
  await page.goto("/account");
  await page.locator("nav").getByRole("link", { name: "Мои рекомендации", exact: true }).click();
  await expect(page.getByText("Выберите, для кого открыть кабинет.", { exact: true })).toBeVisible();
  expect(paidReads).toEqual([]);
  await page.locator("#portal-patient").selectOption("child");
  await expect.poll(() => paidReads.filter((read) => read.startsWith("/me/recommendations"))).toEqual(["/me/recommendations:child"]);
});
