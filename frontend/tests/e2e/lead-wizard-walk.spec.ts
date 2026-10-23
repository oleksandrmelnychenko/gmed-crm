import { expect, test, type Page, type Route } from "@playwright/test";

// The staff lead wizard walked step by step as staff would (QA 2026-10-23):
// what each tab and the release checklist say about a step, where a blocker
// leads, and what reaches the server. Mocked API, synthetic data.

const leadId = "00000000-0000-0000-0000-000000000222";

type Json = Record<string, unknown>;

const STEP_KEYS = ["master_data", "medical", "service", "documents", "commercial", "release"];

const adultLead = (overrides: Json = {}): Json => ({
  id: leadId,
  first_name: "Olga",
  last_name: "Beispiel",
  middle_name: null,
  email: "olga.beispiel@example.com",
  phone: "+49 30 123456",
  date_of_birth: "1980-02-03",
  legal_sex: "female",
  street_address: "Musterweg 1",
  city: "Berlin",
  zip_code: "10115",
  country: "DE",
  citizenships: ["DE"],
  primary_language: "ru",
  qualification_status: "in_progress",
  intake_model: "patient_first",
  repeat_patient_id: null,
  consent_privacy_practices: true,
  consent_healthcare: true,
  wizard_state: {},
  services: [],
  attachments: [],
  trusted_contacts: [],
  requested_specialties: [],
  created_at: "2026-10-20T08:00:00Z",
  updated_at: "2026-10-20T08:00:00Z",
  readiness: {
    conversion_ready: false,
    qualification_ready: true,
    qualification_reasons: [],
    blocking_reasons: ["Requested specialty is missing"],
    // The server's "service" step is the specialties.
    steps: STEP_KEYS.map((key) => ({ key, label: key, ready: !["service", "documents", "commercial", "release"].includes(key) })),
    checks: [],
  },
  ...overrides,
});

type Handler = (route: Route, body: Json | null, url: URL) => unknown;

async function mount(page: Page, lead: Json, handlers: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; body: Json | null }[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-wizard-walk-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const body = method === "GET" ? null : (() => { try { return request.postDataJSON() as Json; } catch { return null; } })();
    calls.push({ method, path, body });
    const handler = handlers[`${method} ${path}`] ?? handlers[path];
    let response: unknown = [];
    if (handler) response = handler(route, body, url);
    else if (path === "/me") response = { id: "walk-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    else if (path === "/sanctions/check") response = { status: "clear", list_version_date: "2026-10-01" };
    else if (path === `/leads/${leadId}`) response = lead;
    else if (path === "/orders" && method === "POST") response = { id: "order-1" };
    else if (path === `/leads/${leadId}/update`) response = {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-wizard-walk-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/repeat-intake-harness.tsx').catch(error => {
      const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
      if (reloads >= 3) throw error;
      sessionStorage.setItem('harness-reloads', String(reloads + 1));
      location.reload();
    });</script></body></html>`,
    }),
  );
  await page.goto("/lead-wizard-walk-harness");
  await page.getByRole("button", { name: "Lead intake", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "Оформление обращения", exact: true });
  await expect(wizard.getByRole("tab", { name: /Данные клиента/ })).toBeVisible({ timeout: 45_000 });
  return { wizard, calls };
}

test("the service and order tabs and the release checklist follow what each step shows", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { wizard } = await mount(page, adultLead());

  // No specialty yet: that is the order step's gap, not the service step's
  // (which holds only the optional program period and wishes).
  await expect(wizard.getByRole("tab", { name: /Сервисная история — выполнено/ })).toBeVisible();
  await expect(wizard.getByRole("tab", { name: /Оформление заказа — не завершено/ })).toBeVisible();

  await wizard.getByRole("tab", { name: /Создание пациента/ }).click();
  const checklist = wizard.locator("section").filter({ has: page.getByText("Проверьте все этапы.", { exact: false }) }).first();
  await expect(checklist.getByRole("button", { name: /Сервисная история\s*Выполнено/ })).toBeVisible();
  // Every wizard step has its row, the order step included.
  await expect(checklist.getByRole("button", { name: /Оформление заказа\s*Не завершено/ })).toBeVisible();
  await checklist.getByRole("button", { name: /Оформление заказа\s*Не завершено/ }).click();
  await expect(wizard.getByRole("tab", { name: /Оформление заказа/ })).toHaveAttribute("aria-selected", "true");
});
