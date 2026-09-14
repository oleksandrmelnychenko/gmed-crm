import { expect, test } from "@playwright/test";
import { setup, confirm, expectedTarget } from "./datev-fixture";
import { readFile } from "node:fs/promises";


test("credentials are submitted only on save and never persisted in browser storage", async ({ page }) => {
  const { panel, calls } = await setup(page);
  await expect(panel.getByRole("button", { name: "Подключить через DATEV" })).toBeDisabled();
  await panel.getByLabel("Client ID приложения", { exact: true }).fill("synthetic-id");
  await panel.getByLabel("Client Secret", { exact: true }).fill("synthetic-secret");
  expect(calls).toHaveLength(0);
  await confirm(page, panel, "DATEV · Сохранить ключи");
  await expect(panel.getByText("Ключи сохранены. Теперь подключитесь через DATEV.")).toBeVisible();
  await expect(panel.getByLabel("Client Secret", { exact: true })).toHaveValue("");
  await expect(panel.getByRole("button", { name: "Подключить через DATEV" })).toBeEnabled();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain("synthetic-secret");
  expect(calls.map((c) => c.path)).toEqual(["/admin/datev/connection"]);
});
test("verified services and data download do not imply invoice access or create records", async ({ page }) => {
  const { panel, calls } = await setup(page, true);
  await confirm(page, panel, "DATEV · Проверить доступ");
  expect(calls[0]?.payload).toEqual({ expected: expectedTarget });
  await expect(panel.getByRole("region", { name: "Сервисы, возвращённые DATEV" })).toContainText("Buchungsdatenservice");
  await expect(panel).not.toContainText("technical-id-do-not-display");
  await confirm(page, panel, "Получить из DATEV");
  await expect(panel.getByTestId("datev-read-result")).toContainText("Получено записей: 1");
  const download = page.waitForEvent("download");
  await confirm(page, panel, "DATEV · Скачать JSON");
  const file = await download; const payload = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(payload.records).toHaveLength(1); expect(payload.mode).toBe("sandbox"); expect(payload.accounting_writes_performed).toBe(false); expect(payload.invoice_originals_included).toBe(false);
  await confirm(page, panel, "DATEV · Отключить доступ");
  await expect(panel.getByTestId("datev-read-result")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "Получить из DATEV", exact: true })).toBeDisabled();
  expect(calls.map((c) => c.path)).toEqual(["/admin/datev/check", "/admin/datev/read", "/admin/datev/disconnect"]);
});
test("failed reads clear previous results and show access guidance", async ({ page }) => {
  const { panel } = await setup(page, true);
  await confirm(page, panel, "Получить из DATEV");
  await expect(panel.getByTestId("datev-read-result")).toBeVisible();
  await page.route("**/api/v1/admin/datev/read", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "datev_access_denied" }) }));
  await confirm(page, panel, "Получить из DATEV");
  await expect(panel.getByRole("alert")).toContainText("Нет доступа");
  await expect(panel.getByTestId("datev-read-result")).toHaveCount(0);
});
test("German mobile view uses explicit fiscal year and has no overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, calls } = await setup(page, true, "de");
  await panel.getByLabel("Daten auswählen", { exact: true }).selectOption("sums-and-balances");
  await expect(panel.getByRole("button", { name: "Aus DATEV abrufen" })).toBeDisabled();
  // The shared MUI picker exposes editable date sections, not a native date input.
  await panel.getByRole("spinbutton", { name: "Day", exact: true }).fill("01");
  await panel.getByRole("spinbutton", { name: "Month", exact: true }).fill("04");
  await panel.getByRole("spinbutton", { name: "Year", exact: true }).fill("2026");
  await panel.getByRole("spinbutton", { name: "Year", exact: true }).press("Tab");
  await confirm(page, panel, "Aus DATEV abrufen");
  await expect(panel.getByTestId("datev-read-result")).toBeVisible();
  expect(calls.at(-1)?.payload).toEqual({ expected: expectedTarget, kind: "sums-and-balances", fiscal_year: 20260401 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../tmp/datev-read-mobile.png", fullPage: true });
});
