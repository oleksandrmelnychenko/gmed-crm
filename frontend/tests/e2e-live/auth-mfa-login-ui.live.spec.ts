import { expect, test } from "@playwright/test";

import {
  bootstrapFullSmokeScenario,
  ensureLiveBackendHealthy,
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

    const state = await ensureLiveBackendHealthy();
    const adminLogin = await request.post(`${state.backendUrl}/api/v1/auth/login`, {
      data: { email: "admin@gmed.de", password: "admin123" },
    });
    expect(adminLogin.ok()).toBeTruthy();
    const adminJson = (await adminLogin.json()) as { access_token: string };
    const approve = await request.post(
      `${state.backendUrl}/api/v1/admin/mfa/pending/${pendingId}/approve`,
      {
        headers: { Authorization: `Bearer ${adminJson.access_token}` },
      },
    );
    expect(approve.ok()).toBeTruthy();

    await approvedPoll;

    await page.waitForURL(/\/$/, { timeout: 30_000 });
    await expect(page).not.toHaveURL(/login/);
  });
});
