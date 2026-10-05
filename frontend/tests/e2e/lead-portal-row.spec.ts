import { expect, test, type Page } from "@playwright/test";

// The expanded row of the leads list: the state of the lead's patient portal
// at a glance (owner feedback 2026-10-05). Mocked API, synthetic data.

const baseLead = {
  phone: "+49 30 100001",
  source: "manual",
  country: "DE",
  citizenships: ["DE"],
  intake_source: "manual",
  flow: "medical",
  lead_type: "console",
  console_promoted_at: "2026-10-05T12:00:00Z",
  qualification_status: "in_progress",
  compliance_status: "pending",
  conversion_ready: false,
  failed_outcome: { status: "none", reason: null, note: null, processed_at: null },
  attachment_count: 0,
  retention_deadline_at: "2026-10-19T12:00:00Z",
};

const leads = [
  {
    ...baseLead,
    id: "00000000-0000-0000-0000-000000000a01",
    first_name: "Anton",
    last_name: "Testovich",
    email: "anton.testovich@example.com",
    submitted_at: "2026-10-05T12:00:00Z",
    created_at: "2026-10-05T12:00:00Z",
    portal_account: { user_id: "u-anton", is_active: true, password_change_pending: false, last_login_at: null },
    portal_intake: { filled: 2, total: 12, documents: 0, guardians: 0, submitted_at: null },
  },
  {
    ...baseLead,
    id: "00000000-0000-0000-0000-000000000a02",
    first_name: "Sofia",
    last_name: "Beispiel",
    email: "sofia.beispiel@example.com",
    submitted_at: "2026-10-05T11:00:00Z",
    created_at: "2026-10-05T11:00:00Z",
    portal_account: { user_id: "u-sofia", is_active: true, password_change_pending: false, last_login_at: "2026-10-05T12:10:00Z" },
    portal_intake: { filled: 12, total: 12, documents: 3, guardians: 0, submitted_at: "2026-10-05T12:30:00Z" },
  },
];

async function setup(page: Page, lang: "ru" | "de") {
  await page.addInitScript((language) => {
    localStorage.setItem("gmed_lang", language);
    localStorage.setItem("gmed_access_token", "lead-portal-row-token");
    localStorage.setItem("gmed_refresh_token", "lead-portal-row-refresh");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({
        json: { id: "ceo-1", email: "ceo@example.com", name: "CEO Test", role: "ceo", created_at: "2026-01-01T00:00:00Z" },
      });
    }
    if (path === "/leads") return route.fulfill({ json: leads });
    return route.fulfill({ json: [] });
  });
}

test("the expanded lead row shows the patient portal at a glance", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, "ru");
  await page.goto("/leads");

  // The frozen name column renders the cell twice; either button opens the row.
  await page.getByTestId(`lead-expand-${leads[0].id}`).first().click();
  await page.getByTestId(`lead-expand-${leads[1].id}`).first().click();
  // The table renders a row once per pane (frozen and scrolling): take the first.
  const rows = page.getByTestId("lead-portal-access");

  // Not signed in yet: every fact has its own caption.
  const fresh = rows.filter({ hasText: "anton.testovich@example.com" }).first();
  await expect(fresh).toContainText("Портал пациента");
  await expect(fresh).toContainText("Ещё не входил");
  await expect(fresh).toContainText("Последний вход");
  await expect(fresh).toContainText("ещё не было");
  await expect(fresh).toContainText("Доступ до");
  await expect(fresh).toContainText("19.10.2026");
  await expect(fresh.getByTestId("lead-portal-progress")).toContainText("2 из 12 полей");
  await expect(fresh).toContainText("Отправлено");
  await expect(fresh).toContainText("ещё нет");

  // Filled in and sent.
  const sent = rows.filter({ hasText: "sofia.beispiel@example.com" }).first();
  await expect(sent).toContainText("Входил");
  await expect(sent.getByTestId("lead-portal-progress")).toContainText("12 из 12 полей");
  await expect(sent).toContainText("05.10.2026 14:30");

  // "New password" is the one action of the row: the brand button, not an outline one.
  const action = fresh.getByRole("button", { name: "Новый пароль" });
  await expect(action).toBeVisible();
  const colours = await action.evaluate((button) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--brand)";
    document.body.append(probe);
    const brand = getComputedStyle(probe).color;
    probe.remove();
    return { background: getComputedStyle(button).backgroundColor, brand };
  });
  expect(colours.background).toBe(colours.brand);

  await page.screenshot({ path: "test-results/lead-portal-row.png" });
});

test("the patient portal row reads in German too", async ({ page }) => {
  await setup(page, "de");
  await page.goto("/leads");
  await page.getByTestId(`lead-expand-${leads[1].id}`).first().click();
  const row = page.getByTestId("lead-portal-access").first();
  await expect(row).toContainText("Patientenportal");
  await expect(row).toContainText("Letzte Anmeldung");
  await expect(row.getByTestId("lead-portal-progress")).toContainText("12 von 12 Feldern");
  await expect(row).toContainText("Gesendet");
  await expect(row.getByRole("button", { name: "Neues Passwort" })).toBeVisible();
});
