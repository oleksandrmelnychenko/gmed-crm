import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, role = "billing", lang = "ru") {
  let setup = {
    profile: { company_name: "", consultant_number: "", client_number: "", belege_version: "", modules: ["belege", "belegfreigabe", "bank", "kassenbuch", "auswertungspakete", "liquiditaetsmonitor"], export_service: "unknown" },
    revision: null as string | null, updated_at: null as string | null, connection_status: "not_configured", read_only: true, accounting_writes_enabled: false, last_sync_at: null,
  };
  const writes: string[] = [];
  const datevRequests: string[] = [];
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_access_token", "datev-demo-test-token");
    localStorage.setItem("gmed_refresh_token", "datev-demo-test-refresh");
    localStorage.setItem("gmed_lang", lang);
  }, { lang });
  page.on("request", (request) => { if (new URL(request.url()).hostname.endsWith("datev.de")) datevRequests.push(request.url()); });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (route.request().method() !== "GET" && /invoice|document|order|datev/.test(path)) writes.push(path);
    let body: unknown = [];
    if (path === "/admin/datev/setup") {
      if (route.request().method() === "PUT") setup = { ...setup, profile: route.request().postDataJSON().profile, revision: "datev-profile-revision", updated_at: "2026-09-05T20:00:00Z" };
      body = setup;
    }
    if (path === "/me") body = { id: "00000000-0000-0000-0000-000000000001", email: "datev-test@example.com", name: "DATEV tester", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/invoices") body = { items: [], total: 0, page: 1, per_page: 25, total_pages: 1 };
    if (path === "/invoices/accounting-ledger") body = { entries: [], monthly: [], year: "2026" };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return { writes, datevRequests };
}

test("connection stays disconnected and demo never writes or contacts DATEV", async ({ page }) => {
  const { writes, datevRequests } = await prepare(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/invoices?source=datev");
  await expect(page.getByRole("heading", { name: "Подключите бухгалтерию к GMed" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Подключение DATEV", exact: true })).toHaveCount(0);
  await expect(page.getByText("Подключение DATEV настраивает администратор.")).toBeVisible();
  await expect(page.locator('a[href="/admin/datev"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Открыть демо", exact: true }).click();
  const panel = page.getByTestId("datev-workspace");
  await expect(panel.getByText("Демонстрационные данные.", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "DEMO-2026-001", exact: true }).click();
  const invoice = page.getByRole("dialog", { name: /Просмотр счёта DATEV/ });
  await expect(invoice.getByRole("img")).toBeVisible();
  await expect(invoice.getByRole("combobox", { name: "Демо-клиент", exact: true })).toContainText("Alex Muster");
  await expect(invoice.getByRole("button", { name: "Сохранить демо-привязку" })).toBeDisabled();
  await invoice.getByRole("combobox", { name: "Демо-заказ", exact: true }).click();
  await expect(page.getByRole("option", { name: "DEMO-O-1003", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: "DEMO-O-1001", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.screenshot({ path: "../artifacts/design-qa/datev-invoice-desktop.png", animations: "disabled" });
  await invoice.getByRole("checkbox").check();
  const downloadEvent = page.waitForEvent("download");
  await invoice.getByRole("link", { name: "Скачать демо-PDF" }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("DEMO-2026-001.pdf");
  await invoice.getByRole("button", { name: "Сохранить демо-привязку" }).click();
  await expect(invoice).toHaveCount(0);
  await expect(panel.getByRole("status")).toContainText("Демо-привязка сохранена");
  await panel.getByRole("button", { name: "Обновить демо" }).click();
  await expect(panel.getByText("Привязан в демо", { exact: true }).last()).toBeVisible();
  await page.getByRole("button", { name: "Счета GMed", exact: true }).click();
  await page.getByRole("button", { name: "Из DATEV", exact: true }).click();
  await panel.getByRole("button", { name: "Демо", exact: true }).click();
  await panel.getByRole("button", { name: "DEMO-2026-001", exact: true }).click();
  await expect(invoice.getByRole("combobox", { name: "Демо-заказ", exact: true })).toContainText("DEMO-O-1001");
  await invoice.getByRole("combobox", { name: "Демо-клиент", exact: true }).click();
  await page.getByRole("option", { name: /Mia Beispiel/ }).click();
  await expect(invoice.getByRole("combobox", { name: "Демо-заказ", exact: true })).not.toContainText("DEMO-O-1001");
  await expect(invoice.getByRole("checkbox")).not.toBeChecked();
  expect(writes).toEqual([]);
  expect(datevRequests).toEqual([]);
});

test("mobile demo supports search, manual assignment and centered dialogs", async ({ page }) => {
  await prepare(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/invoices?source=datev&datev_mode=demo");
  const panel = page.getByTestId("datev-workspace");
  await panel.getByRole("textbox", { name: /Поиск по номеру/ }).fill("no-match");
  await expect(panel.getByText("Счета не найдены", { exact: true }).filter({ visible: true })).toBeVisible();
  await panel.getByRole("button", { name: "Сбросить фильтры" }).click();
  await panel.getByRole("button", { name: "Просмотреть DEMO-2026-003" }).click();
  const dialog = page.getByRole("dialog", { name: /Просмотр счёта DATEV/ });
  await expect(dialog.getByText("Совпадение не найдено.", { exact: false })).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Демо-заказ", exact: true })).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Демо-клиент", exact: true }).click();
  await page.getByRole("option", { name: /Mia Beispiel/ }).click();
  await dialog.getByRole("combobox", { name: "Демо-заказ", exact: true }).click();
  await page.getByRole("option", { name: "DEMO-O-1003", exact: true }).click();
  await dialog.getByRole("checkbox").check();
  const rect = await dialog.boundingBox();
  expect(rect).not.toBeNull();
  expect(Math.abs(rect!.x + rect!.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(rect!.y + rect!.height / 2 - 422)).toBeLessThan(2);
  await page.screenshot({ path: "../artifacts/design-qa/datev-invoice-mobile.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "Сохранить демо-привязку" }).click();
  await panel.getByRole("combobox", { name: "Привязка к клиенту", exact: true }).click();
  await page.getByRole("option", { name: "Привязан в демо", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Просмотреть DEMO-2026-003" })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Просмотреть DEMO-2026-001" })).toHaveCount(0);
  await page.screenshot({ path: "../artifacts/design-qa/datev-list-mobile.png", animations: "disabled" });
});

test("German DATEV administration page is separate and links back to invoices", async ({ page }) => {
  await prepare(page, "ceo", "de");
  await page.goto("/admin/datev");
  const screen = page.getByTestId("admin-datev-page");
  await expect(page.getByRole("heading", { name: "DATEV-Verbindung", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('a[href="/admin/datev"]').first()).toHaveAttribute("aria-current", "page");
  await expect(screen.getByRole("button", { name: "DATEV verbinden", exact: true })).toBeDisabled();
  await page.screenshot({ path: "../artifacts/design-qa/datev-admin-desktop.png", animations: "disabled" });
  await page.getByRole("button", { name: "DATEV-Rechnungen öffnen", exact: true }).click();
  await page.getByRole("button", { name: "DATEV-Verbindung", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/datev$/);
  await page.reload();
  await expect(screen).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../artifacts/design-qa/datev-admin-mobile.png", animations: "disabled", fullPage: true });
  await page.getByRole("button", { name: "Demo öffnen" }).click();
  await expect(page).toHaveURL(/invoices\?source=datev&datev_mode=demo/);
  await expect(page.getByTestId("datev-workspace").getByText("GMed Demo · Testunternehmen")).toBeVisible();
  await page.getByRole("button", { name: "DATEV-Daten", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Buchhaltung mit GMed verbinden" })).toBeVisible();
});

test("DATEV profile persists module choices and does not grant DATEV access", async ({ page }) => {
  const { writes, datevRequests } = await prepare(page, "ceo");
  await page.goto("/admin/datev");
  await expect(page.getByRole("checkbox")).toHaveCount(6);
  await page.getByRole("textbox", { name: "Название компании", exact: true }).fill("GMed test company");
  await page.getByRole("textbox", { name: "Beraternummer", exact: true }).fill("0012345");
  await expect(page.getByRole("button", { name: "Сохранить профиль" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Mandantennummer", exact: true }).fill("00012");
  await page.getByRole("checkbox", { name: "Kassenbuch online", exact: true }).uncheck();
  await page.getByRole("button", { name: "Сохранить профиль" }).click();
  await expect(page.getByRole("status")).toContainText("Профиль сохранён в GMed");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Beraternummer", exact: true })).toHaveValue("0012345");
  await expect(page.getByRole("checkbox", { name: "Kassenbuch online", exact: true })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Подключить DATEV", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Открыть кабинет DATEV", exact: true })).toHaveAttribute("href", "https://www.datev.de/web/de/berufsgruppenuebergreifend/mydatev/cloud-anwendungen/datev-unternehmen-online");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать список для бухгалтерии" }).click();
  expect((await download).suggestedFilename()).toBe("GMED-DATEV-Checkliste.txt");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../artifacts/design-qa/datev-modules-mobile.png", fullPage: true });
  expect(writes).toEqual(["/admin/datev/setup"]);
  expect(datevRequests).toEqual([]);
});

test("DATEV setup handles load failure and stale save without losing the draft", async ({ page }) => {
  await prepare(page, "ceo");
  await page.route("**/api/v1/admin/datev/setup", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' }));
  await page.goto("/admin/datev");
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить настройки DATEV");
  await expect(page.getByRole("button", { name: "Сохранить профиль" })).toHaveCount(0);
  await page.unroute("**/api/v1/admin/datev/setup");
  await page.getByRole("button", { name: "Загрузить заново" }).click();
  await page.getByRole("textbox", { name: "Название компании", exact: true }).fill("Unsaved draft");
  await page.route("**/api/v1/admin/datev/setup", (route) => route.request().method() === "PUT" ? route.fulfill({ status: 409, contentType: "application/json", body: '{"error":"datev_setup_changed"}' }) : route.fallback());
  await page.getByRole("button", { name: "Сохранить профиль" }).click();
  await expect(page.getByRole("alert")).toContainText("Профиль изменён в другой сессии");
  await expect(page.getByRole("textbox", { name: "Название компании", exact: true })).toHaveValue("Unsaved draft");
});
