import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, lang: "ru" | "de" = "ru", role = "ceo") {
  const items = Array.from({ length: 65 }, (_, index) => ({
    id: `medication-${index}`, handelsname: `Brand ${String(index + 1).padStart(3, "0")}`, wirkstoff: `Substance ${index + 1}`, version: 0,
  }));
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_lang", lang);
    localStorage.setItem("gmed_access_token", "medication-catalog-test-token");
    localStorage.setItem("gmed_refresh_token", "medication-catalog-test-refresh");
  }, { lang });
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: "catalog-user", email: "catalog@example.com", name: "Catalog test", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/auth/refresh") body = { access_token: "medication-catalog-test-token", refresh_token: "medication-catalog-test-refresh", expires_in: 900 };
    if (path === "/stats/overview") body = {};
    if (path === "/medication-name-pairs" && route.request().method() === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      const filtered = items.filter(item => `${item.handelsname} ${item.wirkstoff}`.toLowerCase().includes(q));
      body = { items: filtered.slice((pageNumber - 1) * 50, pageNumber * 50), total: filtered.length, page: pageNumber, page_size: 50 };
    } else if (path.startsWith("/medication-name-pairs") && route.request().method() !== "GET") {
      const input = route.request().postDataJSON();
      writes.push({ method: route.request().method(), body: input });
      const item = items.find(item => path.endsWith(`/${item.id}`));
      if (route.request().method() === "DELETE") {
        if (!item) return route.fulfill({ status: 404, json: { code: "medication_pair_not_found" } });
        if (item.version !== input.version) return route.fulfill({ status: 409, json: { code: "medication_pair_changed" } });
        items.splice(items.indexOf(item), 1);
        return route.fulfill({ status: 204 });
      }
      if (item) Object.assign(item, input, { version: item.version + 1 });
      else items.unshift({ id: `created-${writes.length}`, ...input, version: 0 });
      body = item ?? items[0];
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/medications");
  if (role === "ceo") await expect(page.getByText("1-50 / 65", { exact: true })).toBeVisible();
  return { items, writes };
}

for (const lang of ["ru", "de"] as const) {
  test(`CRM catalog browses all pages, searches and saves inline in ${lang}`, async ({ page }) => {
    const { writes } = await prepare(page, lang);
    const de = lang === "de";
    await expect(page.getByRole("link", { name: de ? "Medikamente" : "Медикаменты", exact: true })).toBeVisible();
    await expect(page.getByText("Brand 001", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("1-50 / 65", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`catalog-${lang}.png`) });
    await page.getByRole("button", { name: de ? "Nächste Seite" : "Следующая страница", exact: true }).click();
    await expect(page.getByText("Brand 065", { exact: true }).filter({ visible: true })).toBeVisible();
    await page.getByRole("textbox", { name: de ? "Medikamente suchen" : "Поиск медикаментов", exact: true }).fill("Substance 65");
    await page.getByRole("button", { name: de ? "Suchen" : "Найти", exact: true }).click();
    await expect(page.getByText("1-1 / 1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: de ? "Bearbeiten" : "Редактировать", exact: true }).click();
    const brand = page.getByRole("textbox", { name: de ? "Handelsname" : "Торговое название", exact: true });
    const substance = page.getByRole("textbox", { name: de ? "Wirkstoff" : "Действующее вещество", exact: true });
    await expect(page.getByRole("button", { name: de ? "Speichern" : "Сохранить", exact: true })).toBeDisabled();
    await brand.fill("Edited Brand");
    await substance.fill("Edited Substance");
    await page.screenshot({ path: test.info().outputPath(`catalog-edit-${lang}.png`) });
    await page.getByRole("button", { name: de ? "Speichern" : "Сохранить", exact: true }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ method: "PATCH", body: { handelsname: "Edited Brand", wirkstoff: "Edited Substance", version: 0 } });
    await page.getByRole("button", { name: de ? "Zurücksetzen" : "Сбросить", exact: true }).click();
    await page.getByRole("textbox", { name: de ? "Medikamente suchen" : "Поиск медикаментов", exact: true }).fill("Edited");
    await page.getByRole("button", { name: de ? "Suchen" : "Найти", exact: true }).click();
    await expect(page.getByText("Edited Brand", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("Edited Substance", { exact: true }).filter({ visible: true })).toBeVisible();
  });
}

test("catalog adds a pair, cancels drafts and keeps rejected edits", async ({ page }) => {
  const { writes } = await prepare(page);
  await page.getByRole("button", { name: "Добавить медикамент", exact: true }).click();
  const brand = page.getByRole("textbox", { name: "Торговое название", exact: true });
  const substance = page.getByRole("textbox", { name: "Действующее вещество", exact: true });
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await brand.fill("Cancel me");
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "Добавить медикамент", exact: true }).click();
  await substance.fill("New substance");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("New substance", { exact: true }).filter({ visible: true })).toBeVisible();
  expect(writes[0]).toEqual({ method: "POST", body: { handelsname: "", wirkstoff: "New substance" } });
  await page.getByRole("row").filter({ hasText: "New substance" }).getByRole("button", { name: "Редактировать", exact: true }).click();
  await brand.fill("Duplicate");
  await page.route("**/medication-name-pairs/created-1", route => route.fulfill({ status: 409, json: { code: "medication_pair_exists", message: "medication_pair_exists" } }));
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("уже есть в справочнике");
  await expect(brand).toHaveValue("Duplicate");
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled();
});

test("catalog editor remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page, "de");
  await page.getByRole("button", { name: "Medikament hinzufügen", exact: true }).filter({ visible: true }).click();
  await page.getByRole("textbox", { name: "Handelsname", exact: true }).fill("Mobile Brand");
  await page.getByRole("textbox", { name: "Wirkstoff", exact: true }).fill("Mobile Substance");
  await page.screenshot({ path: test.info().outputPath("catalog-edit-mobile.png") });
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByText("Mobile Brand", { exact: true }).filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const lang of ["ru", "de"] as const) {
  test(`catalog confirms deletion, retains failures and recovers in ${lang}`, async ({ page }) => {
    const { items, writes } = await prepare(page, lang);
    const de = lang === "de", remove = de ? "Löschen" : "Удалить";
    await expect(page.locator("#topbar-page-slot").getByRole("button", { name: de ? "Medikament hinzufügen" : "Добавить медикамент", exact: true })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Brand 001" });
    await row.getByRole("button", { name: remove, exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Substance 1");
    await dialog.getByRole("button", { name: de ? "Abbrechen" : "Отмена", exact: true }).click();
    expect(writes).toHaveLength(0);
    await row.getByRole("button", { name: remove, exact: true }).click();
    items[0].version = 1;
    await dialog.getByRole("button", { name: remove, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(de ? "bereits geändert" : "уже изменена");
    expect(items).toHaveLength(65);
    await dialog.getByRole("button", { name: de ? "Abbrechen" : "Отмена", exact: true }).click();
    await page.getByRole("button", { name: de ? "Aktualisieren" : "Обновить", exact: true }).click();
    await expect(row.getByRole("button", { name: remove, exact: true })).toBeEnabled();
    await row.getByRole("button", { name: remove, exact: true }).click();
    await page.route("**/medication-name-pairs/medication-0", route => route.fulfill({ status: 503, json: { code: "unavailable" } }));
    await dialog.getByRole("button", { name: remove, exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(de ? "nicht gelöscht" : "Не удалось удалить");
    await page.screenshot({ path: test.info().outputPath(`delete-${lang}.png`) });
    await page.unroute("**/medication-name-pairs/medication-0");
    await dialog.getByRole("button", { name: remove, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toHaveCount(0);
    expect(items).toHaveLength(64);
    expect(writes.at(-1)).toEqual({ method: "DELETE", body: { version: 1 } });
    await page.reload();
    await expect(page.getByText("1-50 / 64", { exact: true })).toBeVisible();
    await expect(page.getByText("Brand 001", { exact: true }).filter({ visible: true })).toHaveCount(0);
  });
}

test("deleting the final filtered result returns to a valid page", async ({ page }) => {
  const { items } = await prepare(page);
  items.splice(51);
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByText("1-50 / 51", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Следующая страница", exact: true }).click();
  await expect(page.getByText("51-51 / 51", { exact: true })).toBeVisible();
  await page.getByRole("row").filter({ hasText: "Brand 051" }).getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("1-50 / 50", { exact: true })).toBeVisible();
  await expect(page.getByText("Brand 001", { exact: true }).filter({ visible: true })).toBeVisible();
});

test("non-clinical staff cannot open or navigate to the medication catalog", async ({ page }) => {
  await prepare(page, "de", "billing");
  await expect(page.getByRole("link", { name: "Medikamente", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Medikament hinzufügen", exact: true })).toHaveCount(0);
  await expect(page.getByText("Brand 001", { exact: true }).filter({ visible: true })).toHaveCount(0);
});
