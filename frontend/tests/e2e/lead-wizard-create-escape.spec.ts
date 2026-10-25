import { expect, test, type Page } from "@playwright/test";

// QA re-check V 2026-10-25, F-V1: in the create wizard of a new lead with typed
// data, one Escape on an open list (citizenship, sex) closes only that list; a
// second Escape asks «Закрыть без сохранения?». Mocked API, synthetic data.

async function mount(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-create-escape-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let response: unknown = [];
    if (path === "/me") response = { id: "escape-user", email: "intake@example.com", name: "Intake QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    else if (path === "/sanctions/check") response = { status: "clear", list_version_date: "2026-10-01" };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/lead-create-escape-harness", (route) =>
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
  await page.goto("/lead-create-escape-harness");
  await page.getByRole("button", { name: "New lead", exact: true }).click();
  return page.getByRole("dialog", { name: "Оформление обращения", exact: true });
}

for (const field of ["citizenship", "sex"] as const) {
  test(`one Escape on the open ${field} list of a new lead closes only the list`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const wizard = await mount(page);
    await wizard.getByRole("textbox", { name: "Имя", exact: true }).fill("Erik");
    await wizard.getByRole("textbox", { name: "Фамилия", exact: true }).fill("Escapetest");
    const trigger = field === "sex"
      ? wizard.locator("#lead-wizard-legal-sex")
      : wizard.getByRole("combobox", { name: /Гражданство/ });
    await trigger.click();
    await expect(page.getByRole("listbox")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { name: "Закрыть без сохранения?" })).toHaveCount(0);
    await expect(wizard).toBeVisible();

    // The next Escape belongs to the wizard: it asks before the typed data go.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alertdialog", { name: "Закрыть без сохранения?" })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(wizard.getByRole("textbox", { name: "Имя", exact: true })).toHaveValue("Erik");
  });
}

test("the same on the leads page («Новый лид»)", async ({ page }) => {
  // (motion on: the list closes with its exit animation, as in the browser)
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-create-escape-token");
    localStorage.setItem("gmed_refresh_token", "lead-create-escape-refresh");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: { id: "escape-user", email: "ceo@example.com", name: "CEO Test", role: "ceo", created_at: "2026-01-01T00:00:00Z" } });
    if (path === "/sanctions/check") return route.fulfill({ json: { status: "clear", list_version_date: "2026-10-01" } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/leads");
  await page.getByRole("button", { name: "Новый лид" }).first().click();
  const wizard = page.getByRole("dialog", { name: "Оформление обращения", exact: true });
  await wizard.getByRole("textbox", { name: "Имя", exact: true }).fill("Erik");
  await wizard.getByRole("textbox", { name: "Фамилия", exact: true }).fill("Escapetest");
  for (const trigger of [wizard.getByRole("combobox", { name: /Гражданство/ }), wizard.locator("#lead-wizard-legal-sex")]) {
    await trigger.click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { name: "Закрыть без сохранения?" })).toHaveCount(0);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "Закрыть без сохранения?" })).toBeVisible();
});
