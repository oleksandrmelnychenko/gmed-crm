import { expect, test } from "@playwright/test";
import { setup, confirm, expectedTarget } from "./datev-fixture";

for (const operation of ["check", "read"] as const) test(`${operation} rejects stale confirmation and requires a new target`, async ({ page }) => {
  const { panel, setStatus } = await setup(page, true);
  const label = operation === "read" ? "Получить из DATEV" : "DATEV · Проверить доступ";
  await panel.getByRole("button", { name: label, exact: true }).click();
  const nextGeneration = "00000000-0000-0000-0000-000000000099";
  setStatus({ generation: nextGeneration });
  const requests: unknown[] = [];
  await page.route(`**/api/v1/admin/datev/${operation}`, async (route) => {
    const request = route.request().postDataJSON(); requests.push(request.expected);
    if (request.expected.generation !== nextGeneration) return route.fulfill({ status: 409, json: { error: "datev_connection_changed" } });
    return route.fallback();
  });
  await page.getByRole("dialog").getByRole("button", { name: "DATEV · Подтвердить" }).click();
  await expect(panel.getByRole("alert")).toContainText("Подключение или профиль компании изменились");
  await expect(panel.getByTestId("datev-read-result")).toHaveCount(0);
  await expect(panel.getByRole("region", { name: "Сервисы, возвращённые DATEV" })).toHaveCount(0);
  await expect(panel.getByRole("button", { name: label, exact: true })).toBeEnabled();
  expect(requests).toEqual([expectedTarget]);
  // No automatic retry with a newly loaded target: the user confirms again.
  await confirm(page, panel, label);
  expect(requests).toEqual([expectedTarget, { ...expectedTarget, generation: nextGeneration }]);
});

for (const lang of ["ru", "de"]) test(`${lang} history explains failures without exposing arbitrary upstream text`, async ({ page }) => {
  const { panel } = await setup(page, true, lang);
  await page.route("**/api/v1/admin/datev/events", (route) => route.fulfill({ json: [
    { operation: "check", outcome: "datev_connection_changed", record_count: 0, created_at: "2026-09-14T14:00:00Z" },
    { operation: "fiscal-years", outcome: "datev_rate_limited", record_count: 0, created_at: "2026-09-14T13:00:00Z" },
    { operation: "authorize", outcome: "raw-upstream-secret-must-not-be-shown", record_count: 0, created_at: "2026-09-14T12:00:00Z" },
  ] }));
  await confirm(page, panel, lang === "de" ? "DATEV · Status aktualisieren" : "DATEV · Обновить статус");
  await expect(panel).toContainText(lang === "de" ? "Unternehmensprofil wurde geändert" : "профиль компании изменились");
  await expect(panel).toContainText(lang === "de" ? "DATEV-Anfragelimit erreicht" : "DATEV ограничил частоту запросов");
  await expect(panel).not.toContainText("raw-upstream-secret");
});

for (const operation of ["authorize", "disconnect"] as const) test(`${operation} cannot act on a replaced connection`, async ({ page }) => {
  const disconnected = operation === "authorize";
  const { panel, setStatus } = await setup(page, true, "ru", disconnected ? { status: "disconnected", has_tokens: false } : {});
  const label = disconnected ? "Подключить через DATEV" : "DATEV · Отключить доступ";
  await panel.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("http://127.0.0.1:5174/api/v1/datev/oauth/callback");
  const nextGeneration = "00000000-0000-0000-0000-000000000099";
  setStatus({ generation: nextGeneration });
  const requests: unknown[] = [];
  await page.route(`**/api/v1/admin/datev/${operation}`, (route) => {
    requests.push(route.request().postDataJSON().expected);
    return route.fulfill({ status: 409, json: { error: "datev_connection_changed" } });
  });
  await page.getByRole("dialog").getByRole("button", { name: "DATEV · Подтвердить" }).click();
  await expect(panel.getByRole("alert")).toContainText("Подключение или профиль компании изменились");
  await expect(panel.getByRole("button", { name: label, exact: true })).toBeEnabled();
  const expected = { revision: expectedTarget.revision, generation: expectedTarget.generation, mode: expectedTarget.mode };
  expect(requests).toEqual([expected]);
  await confirm(page, panel, label);
  expect(requests).toEqual([expected, { ...expected, generation: nextGeneration }]);
});

test("credential replacement sends the confirmed session and preserves input on conflict", async ({ page }) => {
  const { panel } = await setup(page, true, "ru", { status: "disconnected", has_tokens: false });
  await panel.getByText("Ключи приложения", { exact: true }).click();
  await panel.getByLabel("Client ID приложения", { exact: true }).fill("synthetic-new-id");
  await panel.getByLabel("Client Secret", { exact: true }).fill("synthetic-new-secret");
  let payload: Record<string, unknown> | undefined;
  await page.route("**/api/v1/admin/datev/connection", (route) => {
    if (route.request().method() === "GET") return route.fallback();
    payload = route.request().postDataJSON();
    return route.fulfill({ status: 409, json: { error: "datev_connection_changed" } });
  });
  await confirm(page, panel, "DATEV · Сохранить ключи");
  await expect(panel.getByRole("alert")).toContainText("Подключение или профиль компании изменились");
  expect(payload).toMatchObject({ revision: expectedTarget.revision, generation: expectedTarget.generation });
  await expect(panel.getByLabel("Client Secret", { exact: true })).toHaveValue("synthetic-new-secret");
});

test("pending revocation blocks new credentials even without stored tokens", async ({ page }) => {
  const { panel } = await setup(page, true, "ru", { status: "revocation_pending", has_tokens: false });
  await panel.getByText("Ключи приложения", { exact: true }).click();
  await expect(panel.getByLabel("Client ID приложения", { exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "Подключить через DATEV", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "DATEV · Отключить доступ", exact: true })).toBeEnabled();
});

for (const lang of ["ru", "de"]) test(`${lang} all six modules explain current GMed support without granting access`, async ({ page }) => {
  await setup(page, true, lang);
  for (const module of ["belege", "belegfreigabe", "bank", "kassenbuch", "auswertungspakete", "liquiditaetsmonitor"]) {
    const card = page.getByTestId(`datev-module-${module}`);
    await expect(card).toContainText(lang === "de" ? "aktivieren sie nicht automatisch" : "не включают их автоматически");
    await expect(card.getByRole("button")).toHaveCount(0);
  }
  await expect(page.getByTestId("datev-module-belege")).toContainText(lang === "de" ? "Manuell exportierte PDF/XML" : "импорт вручную выгруженного PDF/XML");
  await expect(page.getByTestId("datev-module-auswertungspakete")).toContainText("Export Rechnungswesen");
});
