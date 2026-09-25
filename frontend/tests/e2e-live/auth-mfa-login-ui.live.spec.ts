import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  setGermanLanguage,
} from "./support/live-helpers";

test.describe("login UI MFA pending poll", () => {
  test("click sign-in shows pending overlay then home after admin approves", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    const { mfa_staff } = scenario.credentials;

    await page.goto("/login");
    await page.locator("#email").fill(mfa_staff.email);
    await page.locator("#password").fill(scenario.credentials.password);

    const loginResponsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/auth/login") &&
        res.request().method() === "POST" &&
        res.ok(),
    );
    await page.getByRole("button", { name: /Anmelden/i }).click();
    const loginRes = await loginResponsePromise;
    const loginBody = (await loginRes.json()) as {
      status?: string;
      pending_id?: string;
    };
    expect(loginBody.status).toBe("mfa_pending");
    const pendingId = loginBody.pending_id;
    expect(pendingId).toBeTruthy();

    await expect(page.getByRole("heading", { name: /Wartet auf Bestätigung/i })).toBeVisible();

    const approvedPoll = page.waitForResponse(
      async (res) => {
        if (
          !res.url().includes(`/api/v1/auth/pending/${pendingId}`) ||
          res.request().method() !== "GET"
        ) {
          return false;
        }
        if (!res.ok()) {
          return false;
        }
        try {
          const body = (await res.json()) as { status?: string };
          return body.status === "approved";
        } catch {
          return false;
        }
      },
      { timeout: 15_000 },
    );

    // The legacy admin@gmed.de/admin123 seed account is disabled; the scenario IT
    // admin holds the admin-security capability that approves pending logins.
    const admin = await authenticateApiClient(
      request,
      scenario.credentials.it_admin.email,
      scenario.credentials.password,
    );
    const approve = await request.post(
      `${admin.backendUrl}/api/v1/admin/mfa/pending/${pendingId}/approve`,
      { headers: admin.headers },
    );
    expect(approve.ok(), await approve.text()).toBeTruthy();

    await approvedPoll;

    await page.waitForURL(/\/$/, { timeout: 30_000 });
    await expect(page).not.toHaveURL(/login/);
  });
});
