import { expect, test, type Page } from "@playwright/test";

// Owner decision 2026-10-26: the idle sign-out limit comes from `GET /me`
// (CEO setting), a dialog warns two minutes before it, "continue" resets it.
const accessToken = `synthetic.${Buffer.from(JSON.stringify({ sub: "actor" })).toString("base64")}.signature`;

async function setup(page: Page, idleLogoutMinutes: number) {
  const state = { logouts: 0 };
  await page.addInitScript((token) => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", token);
    localStorage.setItem("gmed_refresh_token", "idle-refresh");
  }, accessToken);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "actor",
          email: "actor@example.com",
          name: "Actor Name",
          role: "ceo",
          created_at: "2026-01-01T00:00:00Z",
          preferred_language: "ru",
          password_change_required: false,
          totp_enrolment_required: false,
          idle_logout_minutes: idleLogoutMinutes,
        },
      });
    }
    if (path === "/auth/refresh") {
      return route.fulfill({
        json: { access_token: accessToken, refresh_token: "idle-refresh", token_type: "Bearer", expires_in: 900 },
      });
    }
    if (path === "/auth/logout") {
      state.logouts += 1;
      return route.fulfill({ status: 204 });
    }
    if (path === "/stats/overview" || path === "/me/profile" || path === "/me/totp") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return state;
}

test("warns two minutes before the server's idle limit, continues, then signs out", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page, 15);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Аккаунт", exact: true })).toBeVisible();

  const dialog = page.getByTestId("idle-warning-dialog");
  await page.clock.fastForward("12:30");
  await expect(dialog).toBeHidden();

  await page.clock.fastForward("00:45");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Вы ещё здесь?");
  await expect(dialog).toContainText("Через 2 минуты вы выйдете из системы из-за бездействия.");
  await expect(dialog.getByRole("timer")).toContainText(/Выход через [12]:\d\d/);

  await dialog.getByRole("button", { name: "Продолжить работу" }).click();
  await expect(dialog).toBeHidden();
  // The limit counts from "continue" again: no sign-out where the old one was due.
  await page.clock.fastForward("05:00");
  await expect(dialog).toBeHidden();
  expect(state.logouts).toBe(0);

  await page.clock.fastForward("08:30");
  await expect(dialog).toBeVisible();
  await page.clock.fastForward("02:00");
  await expect(page.getByText("Вы вышли из системы после периода бездействия. Войдите снова.")).toBeVisible();
  expect(state.logouts).toBe(1);
});

test("0 from the server switches the idle sign-out off", async ({ page }) => {
  await page.clock.install();
  const state = await setup(page, 0);
  await page.goto("/account");
  await expect(page.getByRole("link", { name: "Аккаунт", exact: true })).toBeVisible();
  await page.clock.fastForward("04:00:00");
  await expect(page.getByTestId("idle-warning-dialog")).toBeHidden();
  await expect(page.getByRole("link", { name: "Аккаунт", exact: true })).toBeVisible();
  expect(state.logouts).toBe(0);
});
