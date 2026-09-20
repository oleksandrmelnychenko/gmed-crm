import { expect, test, type Page } from "@playwright/test";

type MockUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  failed_login_attempts: number;
  locked_until: string | null;
  password_changed_at: string | null;
  password_reset_required: boolean;
  totp_enrolled: boolean;
  active_sessions: number;
  last_login_at: string | null;
  created_at: string;
};

const ONE_TIME_PASSWORD = "Kx7#pQ9mRw2!vN4t";
const RESET_ONE_TIME_PASSWORD = "Bn5&zH8kLq3*wD6y";

function mockUser(overrides: Partial<MockUser> & Pick<MockUser, "id" | "role">): MockUser {
  return {
    email: `${overrides.id}@example.com`,
    name: overrides.id,
    is_active: true,
    failed_login_attempts: 0,
    locked_until: null,
    password_changed_at: "2026-09-01T10:00:00Z",
    password_reset_required: false,
    totp_enrolled: false,
    active_sessions: 0,
    last_login_at: "2026-09-19T08:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function setup(page: Page, options: { role?: string } = {}) {
  const role = options.role ?? "it_admin";
  const state = {
    users: [
      mockUser({ id: "ceo-1", role: "ceo", name: "Chief Executive", active_sessions: 1, totp_enrolled: true }),
      mockUser({
        id: "pm-locked",
        role: "patient_manager",
        name: "Locked Manager",
        locked_until: "2999-01-01T00:00:00Z",
        active_sessions: 2,
        totp_enrolled: true,
        password_reset_required: true,
      }),
      mockUser({ id: "billing-1", role: "billing", name: "Plain Billing", last_login_at: null }),
    ] as MockUser[],
    createBodies: [] as Record<string, unknown>[],
    resetBodies: [] as Array<{ userId: string; body: Record<string, unknown> }>,
    revoked: [] as string[],
    deactivated: [] as string[],
    deactivateResponse: null as null | { status: number; json: Record<string, unknown> },
  };

  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "admin-users-test-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();

    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "actor",
          email: "actor@example.com",
          name: "Actor Name",
          role,
          created_at: "2026-01-01T00:00:00Z",
          password_change_required: false,
        },
      });
    }
    if (path === "/users" && method === "GET") {
      return route.fulfill({ json: state.users });
    }
    if (path === "/users" && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.createBodies.push(body);
      if (body.role === "ceo") {
        return route.fulfill({ status: 403, json: { error: "Forbidden", message: "Forbidden" } });
      }
      const generated = typeof body.password !== "string";
      const created = mockUser({
        id: `created-${state.createBodies.length}`,
        role: String(body.role),
        name: String(body.name),
        email: String(body.email),
        password_reset_required: generated,
        last_login_at: null,
      });
      state.users = [created, ...state.users];
      return route.fulfill({
        status: 201,
        json: generated ? { ...created, one_time_password: ONE_TIME_PASSWORD } : created,
      });
    }
    const resetMatch = path.match(/^\/users\/([^/]+)\/reset-password$/);
    if (resetMatch && method === "POST") {
      const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
      state.resetBodies.push({ userId: resetMatch[1], body });
      const generated = body.generate === true || typeof body.new_password !== "string";
      state.users = state.users.map((user) =>
        user.id === resetMatch[1] ? { ...user, password_reset_required: true, active_sessions: 0 } : user,
      );
      return route.fulfill({
        json: {
          password_reset_required: true,
          sessions_revoked: true,
          ...(generated ? { one_time_password: RESET_ONE_TIME_PASSWORD } : {}),
        },
      });
    }
    const revokeMatch = path.match(/^\/admin\/sessions\/user\/([^/]+)\/revoke$/);
    if (revokeMatch && method === "POST") {
      state.revoked.push(revokeMatch[1]);
      state.users = state.users.map((user) =>
        user.id === revokeMatch[1] ? { ...user, active_sessions: 0 } : user,
      );
      return route.fulfill({ json: { ok: true, user_id: revokeMatch[1] } });
    }
    const deactivateMatch = path.match(/^\/users\/([^/]+)\/deactivate$/);
    if (deactivateMatch && method === "POST") {
      state.deactivated.push(deactivateMatch[1]);
      if (state.deactivateResponse) {
        return route.fulfill(state.deactivateResponse);
      }
      state.users = state.users.map((user) =>
        user.id === deactivateMatch[1] ? { ...user, is_active: false } : user,
      );
      return route.fulfill({ status: 204 });
    }
    if (path.match(/^\/users\/[^/]+\/(unlock|activate|totp\/reset|update)$/)) {
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/stats/overview") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return state;
}

test("IT admin creates a user with a one-time password that is shown once", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Управление пользователями" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Новый пользователь", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("radio", { name: "Одноразовый пароль (сгенерирует сервер)" })).toHaveAttribute("aria-checked", "true");
  await expect(sheet.locator('input[type="password"]')).toHaveCount(0);

  // The technical admin never sees the CEO role in the dropdown.
  const roleSelect = sheet.getByRole("combobox", { name: "Роль" });
  await roleSelect.click();
  await expect(page.getByRole("option", { name: "Бухгалтерия" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Генеральный директор" })).toHaveCount(0);
  await page.getByRole("option", { name: "Бухгалтерия" }).click();

  await sheet.getByPlaceholder("Макс Мюллер").fill("Neue Person");
  await sheet.getByPlaceholder("max@gmed.de").fill("neue.person@example.com");
  await sheet.getByRole("button", { name: "Создать пользователя", exact: true }).click();

  expect(state.createBodies).toEqual([
    { email: "neue.person@example.com", name: "Neue Person", role: "billing" },
  ]);
  const panel = sheet.getByTestId("one-time-password-panel");
  await expect(panel).toBeVisible();
  await expect(sheet.getByTestId("one-time-password")).toHaveText(ONE_TIME_PASSWORD);
  await expect(panel).toContainText("Показывается только сейчас");
  await sheet.getByRole("button", { name: "Скопировать", exact: true }).click();
  await expect(sheet.getByRole("button", { name: "Скопировано", exact: true })).toBeVisible();

  // Closing the sheet discards the secret; reopening starts a fresh form.
  await sheet.getByRole("button", { name: "Готово", exact: true }).first().click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Новый пользователь", exact: true }).click();
  await expect(page.getByRole("dialog").getByTestId("one-time-password-panel")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByPlaceholder("Макс Мюллер")).toHaveValue("");
  await page.keyboard.press("Escape");

  // The new row is flagged until the person changes the password.
  const createdRow = page.getByRole("row").filter({ hasText: "neue.person@example.com" });
  await expect(createdRow.getByTestId("password-reset-required")).toBeVisible();
});

test("IT admin cannot touch CEO rows but manages locks, sessions and generated resets", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/admin/users");

  const ceoRow = page.getByRole("row").filter({ hasText: "Chief Executive" });
  await expect(ceoRow.getByRole("button", { name: "Редактировать" })).toBeDisabled();
  await expect(ceoRow.getByRole("button", { name: "Деактивировать" })).toBeDisabled();
  await expect(ceoRow.getByRole("button", { name: "Завершить сессии" })).toBeDisabled();
  await ceoRow.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const lockedRow = page.getByRole("row").filter({ hasText: "Locked Manager" });
  await expect(lockedRow).toContainText("Заблокирован");
  await expect(lockedRow).toContainText("Смена пароля при входе");
  await expect(lockedRow).toContainText("Подключён");
  await expect(lockedRow.getByRole("button", { name: "Разблокировать" })).toBeEnabled();

  const plainRow = page.getByRole("row").filter({ hasText: "Plain Billing" });
  await expect(plainRow).toContainText("Ещё не входил");
  await expect(plainRow.getByRole("button", { name: "Завершить сессии" })).toHaveCount(0);

  // Revoke sessions from the row after confirming.
  await lockedRow.getByRole("button", { name: "Завершить сессии" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Завершить сессии", exact: true }).click();
  await expect.poll(() => state.revoked).toEqual(["pm-locked"]);
  await expect(lockedRow.getByRole("button", { name: "Завершить сессии" })).toHaveCount(0);

  // Generated reset from the edit sheet shows the new one-time password once.
  await lockedRow.getByRole("button", { name: "Редактировать" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Locked Manager");
  const editRoleSelect = sheet.getByRole("combobox", { name: "Роль" });
  await editRoleSelect.click();
  await expect(page.getByRole("option", { name: "Генеральный директор" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await sheet.getByRole("button", { name: "Сгенерировать одноразовый пароль", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Сгенерировать одноразовый пароль", exact: true }).click();
  await expect(sheet.getByTestId("one-time-password")).toHaveText(RESET_ONE_TIME_PASSWORD);
  await expect(sheet).toContainText("при следующем входе пользователь должен задать новый пароль");
  expect(state.resetBodies).toEqual([{ userId: "pm-locked", body: { generate: true } }]);
});

test("last-CEO guard is shown as readable text", async ({ page }) => {
  const state = await setup(page, { role: "ceo" });
  state.deactivateResponse = {
    status: 409,
    json: {
      error: "last_ceo_protected",
      message: "The last active CEO account cannot be deactivated or demoted",
    },
  };
  await page.goto("/admin/users");
  await expect(page.getByRole("heading", { name: "Управление пользователями" }).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Chief Executive" })).toBeVisible();

  // The CEO sees the CEO role and may edit CEO rows.
  await page.getByRole("button", { name: "Новый пользователь", exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("combobox", { name: "Роль" }).click();
  await expect(page.getByRole("option", { name: "Генеральный директор" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const ceoRow = page.getByRole("row").filter({ hasText: "Chief Executive" });
  await expect(ceoRow.getByRole("button", { name: "Редактировать" })).toBeEnabled();
  await ceoRow.getByRole("button", { name: "Деактивировать" }).click();
  await expect(page.getByText("Нельзя деактивировать или понизить последний активный аккаунт CEO.")).toBeVisible();
  expect(state.deactivated).toEqual(["ceo-1"]);
});
