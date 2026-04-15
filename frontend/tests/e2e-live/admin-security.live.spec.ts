import { expect, test } from "@playwright/test";

import { bootstrapAndLogin, setGermanLanguage } from "./support/live-helpers";

test.describe("admin security live workflows", () => {
  test("it_admin can open audit analytics and see the security summary shell", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");

    await page.goto("/admin/security");
    await expect(
      page.getByRole("heading", { name: /^Sicherheit$/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Audit-Analytik|Audit analytics/i }),
    ).toBeVisible();

    await expect(page.getByText(/^Fehlgeschlagene Logins 24h$/i)).toBeVisible();
    await expect(page.getByText(/^Blockierte Logins 24h$/i)).toBeVisible();
    await expect(page.getByText(/^Token-Diebstahl 30d$/i)).toBeVisible();
    await expect(
      page.getByText(/^Executive-Sensitivzugriffe 7d$/i),
    ).toBeVisible();
    await expect(
      page.getByText(/^Auffällige Leser 24h$/i),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Aktuelle verdächtige Ereignisse|Recent suspicious events/i }),
    ).toBeVisible();
  });
});
