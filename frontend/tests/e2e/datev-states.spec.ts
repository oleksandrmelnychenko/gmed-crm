import { expect, test } from "@playwright/test";
import { setup, confirm } from "./datev-fixture";

const read = "Получить из DATEV", check = "DATEV · Проверить доступ", refresh = "DATEV · Обновить статус";
const stateCases = [
  { name: "no credentials", configured: false, status: "not_configured", has_tokens: false, connect: false, read: false, disconnect: false },
  { name: "configured disconnected", configured: true, status: "disconnected", has_tokens: false, connect: true, read: false, disconnect: false },
  { name: "connected", configured: true, status: "connected", has_tokens: true, connect: false, read: true, disconnect: true },
  { name: "refresh expiry", configured: true, status: "connected", has_tokens: true, expires_at: "2020-01-01T00:00:00Z", connect: false, read: true, disconnect: true },
  { name: "reconnect without tokens", configured: true, status: "reconnect_required", has_tokens: false, connect: true, read: false, disconnect: true },
  { name: "reconnect with tokens", configured: true, status: "reconnect_required", has_tokens: true, connect: false, read: false, disconnect: true },
  { name: "revocation pending", configured: true, status: "revocation_pending", has_tokens: true, connect: false, read: false, disconnect: true },
  { name: "exchange not enabled", configured: true, status: "connected", has_tokens: true, exchange_enabled: false, connect: false, read: false, disconnect: true },
];
for (const c of stateCases) test(`DATEV buttons in ${c.name}`, async ({ page }) => {
  const { panel } = await setup(page, true, "ru", c);
  await expect(panel.getByText("Загрузка подключения…", { exact: true })).toHaveCount(0);
  for (const [name, enabled] of [["Подключить через DATEV", c.connect], [read, c.read], ["DATEV · Отключить доступ", c.disconnect]] as const) {
    await expect(panel.getByRole("button", { name, exact: true })).toBeEnabled({ enabled });
  }
  const buttons = panel.locator('[data-datev-action="true"]:enabled');
  for (let i = 0; i < await buttons.count(); i++) {
    await expect(buttons.nth(i)).toContainText("DATEV");
    await expect(buttons.nth(i)).toHaveClass(/bg-emerald-700/);
    await expect(buttons.nth(i)).toHaveAttribute("aria-haspopup", "dialog");
  }
  await expect(panel).toContainText("проведение платежей пока недоступны");
});

test("cancel, Escape and double click cannot issue unconfirmed or duplicate requests", async ({ page }) => {
  const { panel, calls } = await setup(page, true);
  await panel.getByRole("button", { name: read, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Test"); await expect(dialog).toContainText("29098"); await expect(dialog).toContainText("Sandbox");
  await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeFocused();
  expect(calls).toEqual([]);
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await panel.getByRole("button", { name: read, exact: true }).click(); await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0); expect(calls).toEqual([]);
  await panel.getByRole("button", { name: read, exact: true }).click();
  // Dispatch two clicks in the same tick, before a React rerender can disable the button.
  await dialog.getByRole("button", { name: "DATEV · Подтвердить" }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(panel.getByTestId("datev-read-result")).toBeVisible();
  expect(calls.filter((c) => c.path.endsWith("/read"))).toHaveLength(1);
});

test("failed status refresh clears old results and blocks actions; history failure is explicit", async ({ page }) => {
  const { panel } = await setup(page, true);
  await confirm(page, panel, read); await expect(panel.getByTestId("datev-read-result")).toBeVisible();
  await page.route("**/admin/datev/connection", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await page.route("**/admin/datev/events", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
  await confirm(page, panel, refresh);
  await expect(panel.getByText("Состояние неизвестно", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: read, exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: check, exact: true })).toBeDisabled();
  await expect(panel.getByTestId("datev-read-result")).toHaveCount(0);
  await expect(panel).toContainText("Не удалось загрузить журнал");
});

test("malformed connection response cannot unlock controls", async ({ page }) => {
  await page.route("**/admin/datev/connection", (route) => route.fulfill({ json: { status: "connected" } }));
  const { panel } = await setup(page, true);
  // Newest route takes precedence, so override after setup and refresh again.
  await page.route("**/admin/datev/connection", (route) => route.fulfill({ json: { status: "connected" } }));
  await confirm(page, panel, refresh);
  await expect(panel.getByRole("button", { name: read, exact: true })).toBeDisabled();
  await expect(panel).toContainText("неожиданные данные");
});

test("wrong company, malformed records and revoked sessions never leave downloadable results", async ({ page }) => {
  const { panel } = await setup(page, true);
  const valid = { source: "DATEV", mode: "production", kind: "fiscal-years", fiscal_year: null, company: "Wrong environment", consultant_number: 29098, client_number: 55003, retrieved_at: "2026-09-14T14:00:00Z", records: [{}], accounting_writes_performed: false, invoice_originals_included: false };
  for (const [response, message] of [[valid, "Данные заблокированы"], [{ records: [null] }, "неожиданные данные"]] as const) {
    await page.route("**/admin/datev/read", (route) => route.fulfill({ json: response }));
    await confirm(page, panel, read);
    await expect(panel.getByTestId("datev-read-result")).toHaveCount(0);
    await expect(panel).toContainText(message);
  }
  await page.route("**/admin/datev/read", (route) => route.fulfill({ status: 409, json: { error: "datev_reconnect_required" } }));
  await confirm(page, panel, read);
  await expect(panel.getByRole("button", { name: read, exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "DATEV · Отключить доступ", exact: true })).toBeEnabled();
});

test("a changed profile cancels an open confirmation", async ({ page }) => {
  const { panel, calls } = await setup(page, true);
  await panel.getByRole("button", { name: read, exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("gmed-datev-profile-saved")));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(calls).toEqual([]);
});

test("all records can be inspected and empty results remain explicit", async ({ page }) => {
  const { panel } = await setup(page, true);
  const response = { source: "DATEV", mode: "sandbox", kind: "fiscal-years", fiscal_year: null, company: "Musterholz", consultant_number: 29098, client_number: 55003, retrieved_at: "2026-09-14T14:00:00Z", records: Array.from({ length: 21 }, (_, i) => ({ caption: `Record ${i}`, balance: "1234.50", custom_field: { detail: "all fields preserved" } })), accounting_writes_performed: false, invoice_originals_included: false };
  await page.route("**/admin/datev/read", (route) => route.fulfill({ json: response }));
  await confirm(page, panel, read);
  const result = panel.getByTestId("datev-read-result");
  await result.getByRole("button", { name: "Далее", exact: true }).click();
  await result.locator("summary").filter({ hasText: "Record 20" }).click();
  await expect(result).toContainText("1234.50"); await expect(result).toContainText("all fields preserved");
  await page.route("**/admin/datev/read", (route) => route.fulfill({ json: { ...response, records: [] } }));
  await confirm(page, panel, read); await expect(result).toContainText("Запрос выполнен: данных нет.");
});

for (const lang of ["ru", "de"]) test(`confirmation is centered and readable on mobile ${lang}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel } = await setup(page, true, lang, { mode: "production" });
  await panel.getByRole("button", { name: lang === "de" ? "Aus DATEV abrufen" : read, exact: true }).click();
  const dialog = page.getByRole("dialog"); await expect(dialog).toContainText("Production");
  const box = (await dialog.boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - 195)).toBeLessThan(2);
  expect(Math.abs(box.y + box.height / 2 - 422)).toBeLessThan(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `../tmp/datev-confirm-${lang}-mobile.png`, animations: "disabled" });
});

test("Enter in credentials opens confirmation without exposing or saving the secret", async ({ page }) => {
  const { panel, calls } = await setup(page);
  await panel.getByLabel("Client ID приложения", { exact: true }).fill("synthetic-id");
  await panel.getByLabel("Client Secret", { exact: true }).fill("synthetic-secret-private");
  await panel.getByLabel("Client Secret", { exact: true }).press("Enter");
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText("synthetic-secret-private");
  expect(calls).toEqual([]);
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(calls).toEqual([]);
});

test("authorization contacts the official page only after confirmation", async ({ page }) => {
  const { panel, calls } = await setup(page, true, "ru", { status: "disconnected", has_tokens: false });
  let external = 0;
  await page.route("https://login.datev.de/**", (route) => { external++; return route.fulfill({ contentType: "text/html", body: "Synthetic authorization destination" }); });
  await page.route("**/admin/datev/authorize", (route) => route.fulfill({ json: { authorization_url: "https://login.datev.de/openidsandbox/authorize?state=synthetic" } }));
  await panel.getByRole("button", { name: "Подключить через DATEV", exact: true }).click();
  expect(external).toBe(0); expect(calls).toEqual([]);
  await page.getByRole("dialog").getByRole("button", { name: "DATEV · Подтвердить", exact: true }).click();
  await expect(page).toHaveURL(/^https:\/\/login\.datev\.de\/openidsandbox\/authorize/);
  expect(external).toBe(1);
});

test("an in-flight result cannot reappear after profile invalidation", async ({ page }) => {
  const { panel } = await setup(page, true);
  let release!: () => void; let received!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { received = resolve; });
  await page.route("**/admin/datev/read", async (route) => {
    received(); await waiting;
    await route.fulfill({ json: { source: "DATEV", mode: "sandbox", kind: "fiscal-years", fiscal_year: null, company: "Old company result", consultant_number: 29098, client_number: 55003, retrieved_at: "2026-09-14T14:00:00Z", records: [{ caption: "Stale" }], accounting_writes_performed: false, invoice_originals_included: false } });
  });
  await confirm(page, panel, read); await started;
  await page.evaluate(() => window.dispatchEvent(new Event("gmed-datev-profile-saved")));
  release();
  await expect(panel.getByRole("button", { name: read, exact: true })).toBeEnabled();
  await expect(panel.getByTestId("datev-read-result")).toHaveCount(0);
  await expect(panel).not.toContainText("Old company result");
});
