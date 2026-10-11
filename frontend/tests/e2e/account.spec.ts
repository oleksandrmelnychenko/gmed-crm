import { expect, test, type Page } from "@playwright/test";

type MockOptions = {
  role?: string;
  lang?: "ru" | "de";
  passwordChangeRequired?: boolean;
  /** Paths (without /api/v1) that answer 403 `password_change_required`. */
  gatedPaths?: string[];
  /** Skip the stored access token so the login form is exercised. */
  anonymous?: boolean;
  /** The role must enrol a second factor (session confined to the setup). */
  totpEnrolmentRequired?: boolean;
  /** The stored session no longer works until the next sign-in. */
  expiredSession?: boolean;
};

async function setup(page: Page, options: MockOptions = {}) {
  const role = options.role ?? "ceo";
  const lang = options.lang ?? "ru";
  const state = {
    passwordChangeRequired: options.passwordChangeRequired ?? false,
    passwordWrites: [] as Record<string, unknown>[],
    profileWrites: [] as Record<string, unknown>[],
    revoked: [] as string[],
    rejectCurrentPassword: false,
    totpEnrolmentRequired: options.totpEnrolmentRequired ?? false,
    totpConfirmed: [] as string[],
    refreshed: 0,
    sessionExpired: options.expiredSession ?? false,
    profile: {
      id: "actor",
      email: "actor@example.com",
      name: "Actor Name",
      role,
      phone: "+49 30 1234567",
      preferred_language: lang,
      password_changed_at: "2026-09-01T10:00:00Z",
    },
    sessions: [
      {
        family_id: "fam-current",
        is_current: true,
        device_fingerprint: null,
        ip_address: "10.0.0.1",
        user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0 Safari/537.36",
        created_at: "2026-09-19T08:00:00Z",
        last_activity_at: "2026-09-20T09:00:00Z",
      },
      {
        family_id: "fam-phone",
        is_current: false,
        device_fingerprint: null,
        ip_address: "10.0.0.2",
        user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1",
        created_at: "2026-09-18T08:00:00Z",
        last_activity_at: "2026-09-19T20:00:00Z",
      },
    ],
  };

  await page.addInitScript(({ lang, anonymous }) => {
    localStorage.setItem("gmed_lang", lang);
    if (!anonymous) localStorage.setItem("gmed_access_token", "account-test-token");
  }, { lang, anonymous: options.anonymous ?? false });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    const method = request.method();

    if (options.gatedPaths?.includes(path)) {
      return route.fulfill({ status: 403, json: { error: "password_change_required", message: "Password must be changed before continuing" } });
    }

    if (path === "/auth/login" && method === "POST") {
      state.sessionExpired = false;
      return route.fulfill({
        json: {
          access_token: "account-test-token",
          refresh_token: "account-test-refresh",
          token_type: "Bearer",
          expires_in: 900,
          password_change_required: state.passwordChangeRequired,
          totp_enrolment_required: state.totpEnrolmentRequired,
        },
      });
    }
    if (path === "/auth/refresh" && method === "POST") {
      if (state.sessionExpired) {
        return route.fulfill({ status: 401, json: { error: "invalid_token", message: "Refresh token is invalid or expired" } });
      }
      state.refreshed += 1;
      return route.fulfill({
        json: {
          access_token: "account-test-token",
          refresh_token: "account-test-refresh",
          token_type: "Bearer",
          expires_in: 900,
          password_change_required: state.passwordChangeRequired,
          totp_enrolment_required: state.totpEnrolmentRequired,
        },
      });
    }
    if (state.sessionExpired) {
      return route.fulfill({ status: 401, json: { error: "unauthorized", message: "Invalid or expired token" } });
    }
    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "actor",
          email: state.profile.email,
          name: state.profile.name,
          role,
          created_at: "2026-01-01T00:00:00Z",
          phone: state.profile.phone,
          preferred_language: state.profile.preferred_language,
          password_change_required: state.passwordChangeRequired,
          totp_enrolment_required: state.totpEnrolmentRequired,
        },
      });
    }
    if (path === "/me/totp/setup" && method === "POST") {
      return route.fulfill({
        json: {
          secret: "JBSWY3DPEHPK3PXP",
          otpauth_uri: "otpauth://totp/GMED%20Console:actor%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=GMED%20Console&algorithm=SHA1&digits=6&period=30",
          issuer: "GMED Console",
          account: "actor@example.com",
        },
      });
    }
    if (path === "/me/totp/confirm" && method === "POST") {
      state.totpConfirmed.push(String((request.postDataJSON() as { code?: string }).code));
      state.totpEnrolmentRequired = false;
      return route.fulfill({ json: { enrolled: true, session_refresh_required: true, other_sessions_ended: 0 } });
    }
    if (state.totpEnrolmentRequired && !["/me/totp", "/auth/logout", "/auth/sessions"].includes(path)) {
      return route.fulfill({ status: 403, json: { error: "totp_enrolment_required", message: "Set up two-factor authentication before continuing" } });
    }
    if (path === "/me/profile") {
      if (method === "PUT") {
        const input = request.postDataJSON() as Record<string, unknown>;
        state.profileWrites.push(input);
        Object.assign(state.profile, input);
      }
      return route.fulfill({ json: state.profile });
    }
    if (path === "/me/password" && method === "PUT") {
      const input = request.postDataJSON() as Record<string, unknown>;
      state.passwordWrites.push(input);
      if (state.rejectCurrentPassword) {
        return route.fulfill({ status: 400, json: { error: "invalid_current_password", message: "The current password is incorrect" } });
      }
      state.passwordChangeRequired = false;
      return route.fulfill({ json: { status: "ok", other_sessions_revoked: 1 } });
    }
    if (path === "/me/totp") {
      return route.fulfill({
        json: { enrolled: state.totpConfirmed.length > 0, required: options.totpEnrolmentRequired ?? false },
      });
    }
    if (path === "/auth/sessions") return route.fulfill({ json: state.sessions });
    const revokeMatch = path.match(/^\/auth\/sessions\/([^/]+)\/revoke$/);
    if (revokeMatch) {
      state.revoked.push(revokeMatch[1]);
      state.sessions = state.sessions.filter((session) => session.family_id !== revokeMatch[1]);
      return route.fulfill({ status: 204 });
    }
    if (path === "/auth/logout" || path === "/auth/logout-all") return route.fulfill({ status: 204 });
    if (path === "/stats/overview") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return state;
}

test("account page shows profile, password, two-factor and sessions", async ({ page }) => {
  const state = await setup(page);
  await page.goto("/account");

  await expect(page.getByRole("link", { name: "Аккаунт", exact: true })).toBeVisible();
  const profileForm = page.getByTestId("account-profile-form");
  await expect(profileForm.locator("#account-name")).toHaveValue("Actor Name");
  await expect(profileForm.locator("#account-phone")).toHaveValue("+49 30 1234567");
  await expect(profileForm.locator("#account-email")).toHaveValue("actor@example.com");
  await expect(page.getByTestId("account-password-form")).toBeVisible();
  await expect(page.getByTestId("twofactor-section")).toBeVisible();
  await expect(page.getByTestId("twofactor-inactive")).toBeVisible();

  const sessions = page.getByTestId("account-sessions").getByRole("listitem");
  await expect(sessions).toHaveCount(2);
  await expect(sessions.first()).toContainText("Эта сессия");
  await expect(sessions.first()).toContainText("Chrome · Windows");
  await expect(sessions.nth(1)).toContainText("Safari · iOS");

  await sessions.nth(1).getByRole("button", { name: "Завершить", exact: true }).click();
  await expect(sessions).toHaveCount(1);
  expect(state.revoked).toEqual(["fam-phone"]);

  await profileForm.locator("#account-name").fill("Renamed Actor");
  await profileForm.getByRole("button", { name: "Сохранить профиль", exact: true }).click();
  await expect(profileForm).toContainText("Профиль сохранён.");
  expect(state.profileWrites).toEqual([{ name: "Renamed Actor", phone: "+49 30 1234567", preferred_language: "ru" }]);
});

test("password change posts current and new password and maps server errors", async ({ page }) => {
  const state = await setup(page, { role: "concierge" });
  await page.goto("/account");
  const form = page.getByTestId("account-password-form");

  await form.locator("#account-password-current").fill("Old-password-1!");
  await form.locator("#account-password-new").fill("weakpassword");
  await form.locator("#account-password-confirm").fill("weakpassword");
  await form.getByRole("button", { name: "Сменить пароль", exact: true }).click();
  await expect(form).toContainText("Пароль должен содержать заглавные и строчные буквы, цифру и спецсимвол.");
  expect(state.passwordWrites).toHaveLength(0);

  state.rejectCurrentPassword = true;
  await form.locator("#account-password-new").fill("New-password-2!");
  await form.locator("#account-password-confirm").fill("New-password-2!");
  await form.getByRole("button", { name: "Сменить пароль", exact: true }).click();
  await expect(form).toContainText("Текущий пароль указан неверно.");
  expect(state.passwordWrites).toEqual([{ current_password: "Old-password-1!", new_password: "New-password-2!" }]);

  state.rejectCurrentPassword = false;
  await form.locator("#account-password-current").fill("Old-password-1!");
  await form.locator("#account-password-new").fill("New-password-2!");
  await form.locator("#account-password-confirm").fill("New-password-2!");
  await form.getByRole("button", { name: "Сменить пароль", exact: true }).click();
  await expect(form).toContainText("Пароль изменён.");
  await expect(form.locator("#account-password-current")).toHaveValue("");
});

test("login with password_change_required lands on the gate and leaves it after the change", async ({ page }) => {
  const state = await setup(page, { passwordChangeRequired: true, anonymous: true, lang: "de" });
  await page.goto("/login");
  await page.getByLabel("E-Mail").fill("actor@example.com");
  await page.getByLabel("Passwort", { exact: true }).fill("Old-password-1!");
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();

  await expect(page).toHaveURL(/\/account\/password-required$/);
  const gate = page.getByTestId("password-required-page");
  await expect(gate).toContainText("Neues Passwort erforderlich");
  await expect(page.getByRole("navigation")).toHaveCount(0);

  await gate.locator("#account-password-current").fill("Old-password-1!");
  await gate.locator("#account-password-new").fill("New-password-2!");
  await gate.locator("#account-password-confirm").fill("New-password-2!");
  await gate.getByRole("button", { name: "Passwort ändern", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  expect(state.passwordWrites).toEqual([{ current_password: "Old-password-1!", new_password: "New-password-2!" }]);
});

test("a 403 password_change_required from any API redirects to the gate", async ({ page }) => {
  await setup(page, { gatedPaths: ["/me/profile"] });
  await page.goto("/account");
  await expect(page).toHaveURL(/\/account\/password-required$/);
  await expect(page.getByTestId("password-required-page")).toBeVisible();
});

test("a role that must use 2FA gets only the setup with a QR code until it is enrolled", async ({ page }) => {
  // QA E-17 / E-28 (2026-10-11): mandatory second factor for CEO, IT Admin and PM.
  const state = await setup(page, { role: "patient_manager", totpEnrolmentRequired: true, anonymous: true });
  await page.goto("/login");
  await page.getByLabel("Электронная почта").fill("actor@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("Old-password-1!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();

  await expect(page).toHaveURL(/\/account\/two-factor-required$/);
  const gate = page.getByTestId("two-factor-required-page");
  await expect(gate).toContainText("Настройте двухфакторный вход");
  await expect(page.getByRole("navigation")).toHaveCount(0);

  await gate.getByRole("button", { name: "Начать настройку", exact: true }).click();
  const qr = gate.getByTestId("qr-code");
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute("aria-label", "QR-код для приложения-аутентификатора");
  await expect(gate).toContainText("JBSW Y3DP EHPK 3PXP");

  // Any staff page bounces back to the setup while the factor is missing.
  await page.goto("/patients");
  await expect(page).toHaveURL(/\/account\/two-factor-required$/);

  await page.getByRole("button", { name: "Начать настройку", exact: true }).click();
  await page.getByLabel("Код из приложения").fill("123456");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(state.totpConfirmed).toEqual(["123456"]);
  expect(state.refreshed).toBeGreaterThan(0);
});

test("an explicit sign-out forgets the page for the next sign-in", async ({ page }) => {
  // QA E-24 (2026-10-11): the next person at the browser starts on the dashboard.
  await setup(page);
  await page.goto("/account");
  await expect(page.getByTestId("account-profile-form")).toBeVisible();
  await page.getByRole("button", { name: "Выход" }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-session-ended")).toHaveCount(0);

  await page.getByLabel("Электронная почта").fill("actor@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("Old-password-1!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("an expired session says so and returns to the page after sign-in", async ({ page }) => {
  // QA E-37 (2026-10-11).
  await setup(page, { expiredSession: true });
  await page.goto("/account");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByTestId("login-session-ended")).toContainText("Сессия истекла");

  await page.getByLabel("Электронная почта").fill("actor@example.com");
  await page.getByLabel("Пароль", { exact: true }).fill("Old-password-1!");
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
});
