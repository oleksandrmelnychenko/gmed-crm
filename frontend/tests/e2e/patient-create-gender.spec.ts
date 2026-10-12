import { expect, test } from "@playwright/test";

// QA round 2 (2026-10-12): the new-patient form's "Пол" has no default since
// 09c9931d; it must still be set by mouse and by keyboard.
test("the new-patient form sets the sex by mouse and by keyboard", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "gender-test-token");
    localStorage.setItem("gmed_refresh_token", "gender-test-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") {
      body = { id: "a0000000-0000-0000-0000-000000000061", name: "Clara Chefin", email: "ceo@example.com", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    }
    if (path === "/stats/leads/by-status") body = [];
    if (path === "/messages/unread-total") body = { count: 0 };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/patients");
  await page.getByRole("button", { name: "Новый пациент" }).first().click();
  const sheet = page.getByRole("dialog").last();
  const sex = sheet.getByRole("combobox", { name: /^Пол/ });
  await expect(sex).toBeVisible({ timeout: 30_000 });
  await expect(sex).toContainText("Выберите пол");

  await sex.click();
  await page.getByRole("option", { name: "Женский", exact: true }).click();
  await expect(sex).toContainText("Женский");

  await sex.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Мужской", exact: true })).toBeVisible();
  await page.keyboard.type("Муж");
  await page.keyboard.press("Enter");
  await expect(sex).toContainText("Мужской");
});
