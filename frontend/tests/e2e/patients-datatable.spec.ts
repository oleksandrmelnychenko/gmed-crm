import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

const patients = [
  {
    id: "00000000-0000-0000-0000-000000000301",
    patient_id: "PT-0001",
    first_name: "Anna",
    last_name: "Müller",
    birth_date: "1990-01-01",
    gender: "female",
    nationality: "DE",
    residence_country: "DE",
    languages: ["de", "en"],
    functional_labels: [],
    phone_primary: "+49 30 111111",
    email: "anna@example.com",
    insurance_provider: "AOK",
    insurance_type: "public",
    is_active: true,
    created_at: "2026-04-10T09:00:00Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000302",
    patient_id: "PT-0002",
    first_name: "Boris",
    last_name: "Petrov",
    birth_date: "1973-11-02",
    gender: "male",
    nationality: "RU",
    residence_country: "DE",
    languages: ["ru", "de"],
    functional_labels: ["vip"],
    phone_primary: "+49 30 222222",
    email: null,
    insurance_provider: "Techniker",
    insurance_type: "private",
    is_active: true,
    created_at: "2026-04-15T09:00:00Z",
  },
  {
    id: "00000000-0000-0000-0000-000000000303",
    patient_id: "PT-0003",
    first_name: "Clara",
    last_name: "O'Neill",
    birth_date: "1985-05-14",
    gender: "female",
    nationality: "IE",
    residence_country: "DE",
    languages: ["en"],
    functional_labels: [],
    phone_primary: "+49 30 333333",
    email: "clara@example.com",
    insurance_provider: null,
    insurance_type: "self_pay",
    is_active: false,
    created_at: "2026-03-20T09:00:00Z",
  },
];

async function mockAuth(page: Page) {
  await page.route("**/auth/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/login" && route.request().method() === "POST") {
      return json(route, {
        access_token: "test-token",
        refresh_token: "test-refresh",
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    if (url.pathname === "/auth/logout") return json(route, { ok: true });
    return json(route, { message: "Not mocked" }, 404);
  });
}

async function mockPatientsApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");

    if (path === "/me") {
      return json(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@gmed.de",
        name: "Admin GMED",
        role: "ceo",
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    if (path === "/stats/overview") {
      return json(route, { patients: 3, leads: 0, orders: 0, appointments: 0, cases: 0, users: 1 });
    }
    if (path === "/providers") return json(route, []);
    if (path === "/patients" || path.startsWith("/patients?")) {
      const activeOnly = url.searchParams.get("active_only");
      const rows = activeOnly === "false"
        ? patients.filter((p) => !p.is_active)
        : patients.filter((p) => p.is_active);
      return json(route, rows);
    }
    if (path === "/appointments/meta/staff") return json(route, []);
    return json(route, { message: "Not mocked" }, 404);
  });
}

async function loginAsCeo(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("admin@gmed.de");
  await page.locator("#password").fill("admin123");
  await page.getByRole("button", { name: /Anmelden|Войти/i }).click();
  await page.waitForURL(/\/$/, { timeout: 15_000 });
}

test.describe("patients data-table", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await mockPatientsApi(page);
  });

  test("renders active patients by default", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients");
    await expect(page.getByText("PT-0001")).toBeVisible();
    await expect(page.getByText("PT-0002")).toBeVisible();
    await expect(page.getByText("PT-0003")).not.toBeVisible();
  });

  test("global search filters rows", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients");
    await expect(page.getByText("PT-0002")).toBeVisible();
    const searchInput = page.getByPlaceholder(/search|Suchen|Поиск/i).first();
    await searchInput.fill("Petrov");
    await expect(page.getByText("PT-0001")).not.toBeVisible();
    await expect(page.getByText("PT-0002")).toBeVisible();
  });

  test("slash key focuses global search", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients");
    await expect(page.getByText("PT-0001")).toBeVisible();
    await page.keyboard.press("/");
    const searchInput = page.getByPlaceholder(/search|Suchen|Поиск/i).first();
    await expect(searchInput).toBeFocused();
  });

  test("row click opens split-view pane and syncs URL", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients");
    await expect(page.getByText("PT-0001")).toBeVisible();
    await page.getByText("Anna Müller").first().click();
    await expect(page).toHaveURL(/patient=00000000-0000-0000-0000-000000000301/);
  });

  test("URL filter state round-trip", async ({ page }) => {
    await loginAsCeo(page);
    await page.goto("/patients?q=Petrov");
    await expect(page.getByText("PT-0002")).toBeVisible();
    await expect(page.getByText("PT-0001")).not.toBeVisible();
  });
});
