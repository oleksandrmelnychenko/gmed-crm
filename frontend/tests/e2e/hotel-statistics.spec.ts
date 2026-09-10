import { expect, test, type Locator, type Page } from "@playwright/test";
import { emptyBreakfast, type HotelDirectoryItem, type HotelStay } from "../../src/pages/reports/hotels/model";
import { breakfastCopy } from "../../src/pages/reports/hotels/breakfast-copy";
import { createHotelCopy } from "../../src/pages/reports/hotels/copy";

async function chooseBreakfast(page: Page, editor: Locator, mode: HotelStay["breakfast_mode"], lang: "ru" | "de" = "ru") {
  await editor.getByRole("combobox", { name: breakfastCopy[lang].edit, exact: true }).click();
  await page.getByRole("option", { name: breakfastCopy[lang][mode], exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function chooseFilter(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

// Fictional hotel bookings for UI verification only; never loaded by the product.
function fixtures(): HotelStay[] {
  const names = ["Hotel Lindenhof", "City Residence", "Parkhotel Mitte", "Hotel am See", "Stadtgarten Suites", "Airport Residence"];
  return Array.from({ length: 201 }, (_, i) => {
    const month = i % 8 + 1, day = i % 17 + 1, nights = i % 8 + 2;
    const date = (value: number) => `2026-${String(month).padStart(2, "0")}-${String(value).padStart(2, "0")}`;
    return { ...emptyBreakfast, patient_name: `Test Patient ${i}`, patient_number: `P-TEST-${i}`, booking_reference: `BOOK-${i}`, breakfast_mode: i === 0 ? "unknown" : i % 3 ? "included" : "self", breakfast_count: i === 0 ? null : nights, id: `stay-${i}`, source: "service", task_id: null, patient_id: `patient-${i}`, provider_id: `hotel-${i % 6}`, hotel_name: names[i % 6], city: i % 2 ? "Berlin" : "München", status: "completed", check_in: date(day), check_out: date(day + nights), room_count: i === 0 ? null : i % 3 ? 1 : 2, details_updated_at: null, currency: i === 200 ? "USD" : "EUR", actual_cost: i % 4 ? String(nights * (90 + i % 60)) : null, cost_estimate: String(nights * (110 + i % 60)), posted_cost: "100.00", posted_count: 1, direct_paid: i % 2 ? "100.00" : "0.00", company_paid: i % 2 ? "0.00" : "80.00", provider_due: i % 2 ? "0.00" : "20.00", pending_cost: "0.00", pending_count: 0 };
  });
}
async function setup(page: Page, lang: "ru" | "de", role = "ceo") {
  await page.clock.install({ time: new Date("2026-09-10T12:00:00Z") });
  await page.addInitScript(language => { localStorage.setItem("gmed_lang", language); localStorage.setItem("gmed_access_token", "hotel-statistics-test"); localStorage.setItem("gmed_refresh_token", "hotel-statistics-refresh"); }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  const state = { rows: fixtures(), directory: [] as HotelDirectoryItem[], fail: false, failRead: false, failTaxonomy: false, providerCreates: 0, mutations: 0, documentUploads: 0, documents: [] as { id: string; auto_name: string; original_filename: string; created_at: string; notes: string | null }[] };
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url()), path = url.pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: { id: "tester", name: "Test Manager", email: "test@example.test", role } });
    if (path === "/stats/reports/hotels/directory") return route.fulfill({ json: state.directory });
    if (path === "/providers/taxonomy") {
      expect(url.searchParams.get("provider_type")).toBe("non_medical");
      if (state.failTaxonomy) return route.fulfill({ status: 503, json: { error: "Test unavailable" } });
      return route.fulfill({ json: { nodes: [{ id: "hotel-taxonomy", code: "nonmedical_hotels", provider_kind: "non_medical", level: "type", is_active: true, is_assignable: true }] } });
    }
    if (path === "/providers" && route.request().method() === "POST") {
      state.providerCreates++;
      if (state.fail) return route.fulfill({ status: 500, json: { error: "Test creation failed" } });
      const body = route.request().postDataJSON();
      expect(body.provider_type).toBe("non_medical"); expect(body.taxonomy_node_id).toBe("hotel-taxonomy");
      expect(body.name).toBe("Hotel Neue Mitte"); expect(body.phone).toBe("+49 30 123456"); expect(body.email).toBe("hotel@example.test");
      expect(body.contacts).toHaveLength(2);
      state.directory.push({ id: "hotel-created", name: body.name, city: body.address_city, country: body.address_country });
      return route.fulfill({ status: 201, json: { id: "hotel-created" } });
    }
    if (/\/providers\/[^/]+\/documents$/.test(path)) {
      if (route.request().method() === "POST") {
        state.documentUploads++;
        if (state.fail) return route.fulfill({ status: 500, json: { error: "Test upload failed" } });
        const body = route.request().postData()!;
        expect(body).toContain('name="is_medical"\r\n\r\nfalse'); expect(body).not.toContain('name="patient_id"');
        state.documents.push({ id: "document-test", auto_name: "Hotel contract 2026", original_filename: "contract.pdf", created_at: "2026-09-10T12:00:00Z", notes: "Breakfast included" });
        return route.fulfill({ status: 201, json: { id: "document-test" } });
      }
      expect(url.searchParams.get("general_only")).toBe("true");
      return route.fulfill({ json: state.documents });
    }
    if (path === "/documents/document-test/download") return route.fulfill({ body: "%PDF-1.4\n%%EOF", headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="contract.pdf"' } });
    if (path.endsWith("/breakfast")) {
      state.mutations++;
      if (state.fail) return route.fulfill({ status: 500, json: { error: "Test failure" } });
      Object.assign(state.rows.find(row => path.includes(`/${row.id}/`))!, route.request().postDataJSON());
      return route.fulfill({ json: { saved: true } });
    }
    if (path.endsWith("/rooms")) {
      state.mutations++;
      if (state.fail) return route.fulfill({ status: 500, json: { error: "Test failure" } });
      const row = state.rows.find(row => path.includes(`/${row.id}/`))!;
      row.room_count = route.request().postDataJSON().room_count;
      return route.fulfill({ json: { room_count: row.room_count } });
    }
    if (path === "/stats/reports/hotels") {
      if (state.fail || state.failRead) return route.fulfill({ status: 503, json: { error: "Test unavailable" } });
      const from = url.searchParams.get("from")!, to = url.searchParams.get("to")!;
      return route.fulfill({ json: { rows: state.rows.filter(row => !row.check_in || row.check_in >= from && row.check_in <= to), from, to, timezone: "Europe/Berlin", generated_at: "2026-09-10T12:00:00Z" } });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}

for (const lang of ["ru", "de"] as const) {
  test(`hotel statistics charts, shared filters, export and responsive layout in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1720, height: 1120 });
    await setup(page, lang);
    const failures: string[] = []; page.on("pageerror", error => failures.push(error.message));
    await page.goto("/hotels");
    await expect(page.getByTestId("hotel-kpis").getByText("200", { exact: true })).toBeVisible();
    await expect(page.getByTestId("hotel-table").locator("tbody tr")).toHaveCount(6);
    await expect(page.getByTestId("hotel-trend").locator(".recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.getByTestId("hotel-ranking").locator(".recharts-bar-rectangle").first()).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-qa/hotel-statistics-${lang}-desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 1720, height: 1700 });
    await page.screenshot({ path: `../artifacts/design-qa/hotel-statistics-${lang}-overview.png` });
    await page.setViewportSize({ width: 1720, height: 1120 });
    await page.getByTestId("hotel-table").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-qa/hotel-statistics-${lang}-table.png` });
    await chooseFilter(page, lang === "ru" ? "Гостиница" : "Hotel", "Hotel Lindenhof");
    await expect(page.getByTestId("hotel-table").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByTestId("hotel-kpis").getByText("34", { exact: true })).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: lang === "ru" ? "Экспорт CSV" : "CSV exportieren" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("hotels-2026-01-01-2026-12-31-EUR.csv");
    const stream = await download.createReadStream(); let text = ""; for await (const chunk of stream!) text += chunk.toString();
    expect(text).toContain("Hotel Lindenhof"); expect(text).not.toContain("City Residence");
    await page.getByRole("button", { name: lang === "ru" ? "Сбросить фильтры" : "Filter zurücksetzen" }).click();
    await expect(page.getByTestId("hotel-table").locator("tbody tr")).toHaveCount(6);
    await chooseFilter(page, lang === "ru" ? "Валюта" : "Währung", "USD");
    await expect(page.getByTestId("hotel-kpis").getByText("1", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: lang === "ru" ? "Сбросить фильтры" : "Filter zurücksetzen" }).click();
    await page.getByRole("spinbutton", { name: "Month", exact: true }).nth(1).fill("03");
    await page.getByRole("button", { name: lang === "ru" ? "Применить период" : "Zeitraum anwenden" }).click();
    await expect(page.getByTestId("hotel-kpis").getByText("75", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: lang === "ru" ? "Гостиницы" : "Hotels", exact: true })).toBeVisible();
    expect((await page.getByRole("heading", { name: lang === "ru" ? "Гостиницы" : "Hotels", exact: true }).boundingBox())!.height).toBeLessThan(64);
    await page.screenshot({ path: `../artifacts/design-qa/hotel-statistics-${lang}-mobile.png`, fullPage: true });
    await page.getByTestId("hotel-trend").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("hotel-trend").locator(".recharts-bar-rectangle").first()).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-qa/hotel-statistics-${lang}-mobile-charts.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false); expect(failures).toEqual([]);
  });
}

for (const lang of ["ru", "de"] as const) {
  test(`header creates a hotel without bookings and retains it after reload in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await setup(page, lang, lang === "ru" ? "ceo" : "patient_manager"), labels = createHotelCopy[lang];
    state.rows = [];
    await page.goto("/hotels");
    await page.locator("header").getByRole("button", { name: labels.add, exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: labels.save, exact: true })).toBeDisabled();
    await sheet.getByRole("textbox", { name: labels.name, exact: true }).fill("Hotel Neue Mitte");
    await sheet.getByRole("textbox", { name: labels.city, exact: true }).fill("Berlin");
    await sheet.getByRole("textbox", { name: labels.country, exact: true }).fill("Deutschland");
    await sheet.getByRole("textbox", { name: labels.phone, exact: true }).fill("+49 30 123456");
    await sheet.getByRole("textbox", { name: labels.email, exact: true }).fill("hotel@example.test");
    await page.screenshot({ path: `../artifacts/design-qa/hotel-create-${lang}-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => { const bounds = await sheet.boundingBox(); return bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390; }).toBe(true);
    await expect(sheet.getByRole("textbox", { name: labels.name, exact: true })).toBeInViewport();
    await page.screenshot({ path: `../artifacts/design-qa/hotel-create-${lang}-mobile.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    state.fail = true;
    await sheet.getByRole("button", { name: labels.save, exact: true }).click();
    await expect(sheet.getByText(labels.error, { exact: true })).toBeVisible();
    await expect(sheet.getByRole("textbox", { name: labels.name, exact: true })).toHaveValue("Hotel Neue Mitte");
    state.fail = false;
    await sheet.getByRole("button", { name: labels.save, exact: true }).click();
    const detail = page.getByTestId("hotel-detail-dialog");
    await expect(detail.getByRole("heading", { name: "Hotel Neue Mitte", exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: lang === "ru" ? "Добавить файл" : "Datei hinzufügen", exact: true })).toBeVisible();
    if (lang === "ru") await expect(detail.getByRole("link", { name: "Карточка гостиницы", exact: true })).toHaveAttribute("href", "/providers/hotel-created");
    else await expect(detail.getByText("Hotelprofil", { exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("hotel-stays-table").locator("tbody tr")).toHaveCount(0);
    await detail.locator("footer").getByRole("button", { name: lang === "ru" ? "Закрыть" : "Schließen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Hotel Neue Mitte", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Hotel Neue Mitte", exact: true })).toBeVisible();
    await expect(page.getByTestId("hotel-kpis")).toHaveCount(0);
    expect(state.rows).toHaveLength(0); expect(state.providerCreates).toBe(2); expect(state.directory).toHaveLength(1);
    await page.screenshot({ path: `../artifacts/design-qa/hotel-directory-${lang}-mobile.png` });
  });
}

test("hotel creation waits for the correct provider type and recovers from taxonomy failure", async ({ page }) => {
  const state = await setup(page, "ru"); state.failTaxonomy = true;
  await page.goto("/hotels");
  await page.getByRole("button", { name: createHotelCopy.ru.add, exact: true }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("textbox", { name: createHotelCopy.ru.name, exact: true }).fill("Hotel Neue Mitte");
  await expect(sheet.getByRole("alert")).toContainText(createHotelCopy.ru.taxonomyError);
  await expect(sheet.getByRole("button", { name: createHotelCopy.ru.save, exact: true })).toBeDisabled();
  state.failTaxonomy = false;
  await sheet.getByRole("button", { name: createHotelCopy.ru.retry, exact: true }).click();
  await expect(sheet.getByRole("button", { name: createHotelCopy.ru.save, exact: true })).toBeEnabled();
  expect(state.providerCreates).toBe(0);
});

test("room count persists, recalculates the report and a failed save stays recoverable", async ({ page }) => {
  const state = await setup(page, "ru");
  await page.goto("/hotels");
  await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const editor = dialog.getByRole("spinbutton", { name: "Номеров stay-0", exact: true });
  await editor.fill("2"); state.fail = true;
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible(); await expect(editor).toHaveValue("2");
  state.fail = false;
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("spinbutton", { name: "Номеров stay-0", exact: true })).toHaveValue("2");
  expect(state.mutations).toBe(2);
});

test("a failed refresh after saving breakfast preserves other unsaved booking edits", async ({ page }) => {
  const state = await setup(page, "ru");
  await page.goto("/hotels");
  await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const rooms = dialog.getByRole("spinbutton", { name: "Номеров stay-0", exact: true });
  await rooms.fill("3");
  const breakfast = page.getByTestId("breakfast-stay-0");
  await breakfast.getByRole("button").click();
  const editor = page.getByTestId("breakfast-editor-stay-0");
  await chooseBreakfast(page, editor, "included");
  state.failRead = true;
  await editor.getByRole("button", { name: "Сохранить завтраки", exact: true }).click();
  await expect(page.getByTestId("hotel-detail-dialog").getByRole("alert")).toContainText("Не удалось загрузить статистику");
  await expect(rooms).toHaveValue("3");
  await breakfast.getByRole("button").click();
  await expect(editor.getByRole("combobox", { name: "Условия завтрака" })).toContainText("Включён в проживание");
  await expect(editor.getByRole("button", { name: "Сохранить завтраки", exact: true })).toBeDisabled();
  await editor.locator("footer").getByRole("button", { name: "Закрыть", exact: true }).click();
  state.failRead = false;
  await dialog.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(rooms).toHaveValue("3");
  await expect(breakfast.getByRole("button", { name: "Сохранить завтраки", exact: true })).toHaveCount(0);
});

test("patient search and stay export preserve hidden drafts and guarded closing", async ({ page }) => {
  await setup(page, "ru");
  await page.goto("/hotels");
  await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("link", { name: "Test Patient 0", exact: true })).toHaveAttribute("href", "/patients/patient-0");
  const room = dialog.getByRole("spinbutton", { name: "Номеров stay-0", exact: true });
  await room.fill("4");
  const search = dialog.getByRole("textbox", { name: "Пациент или номер бронирования", exact: true });
  await search.fill("BOOK-6");
  await expect(room).not.toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Выгрузить проживания", exact: true }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream(); let csv = ""; for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain("BOOK-6"); expect(csv).toContain("P-TEST-6"); expect(csv).not.toContain('"BOOK-0"');
  await search.fill(""); await expect(room).toHaveValue("4");
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).first().click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(room).toHaveValue("4");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Закрыть", exact: true }).first().click();
  await expect(dialog).toHaveCount(0);
});

test("empty, unavailable and read-only states are explicit", async ({ page }) => {
  const state = await setup(page, "ru", "ceo_assistant");
  await page.goto("/hotels");
  await expect(page.getByRole("button", { name: "Добавить гостиницу", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("spinbutton").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "Добавить файл", exact: true })).toHaveCount(0);
  await page.getByTestId("breakfast-stay-0").getByRole("button").click();
  await expect(page.getByTestId("breakfast-editor-stay-0").getByRole("combobox")).toBeDisabled();
  await page.getByTestId("breakfast-editor-stay-0").locator("footer").getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByTestId("hotel-detail-dialog").locator("footer").getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByLabel("Поиск гостиницы или города", { exact: true }).fill("missing hotel");
  await expect(page.getByText("Нет бронирований по выбранным фильтрам", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Экспорт CSV" })).toBeDisabled();
  state.fail = true;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить статистику гостиниц");
  await expect(page.getByTestId("hotel-kpis")).toHaveCount(0);
  await page.screenshot({ path: "../artifacts/design-qa/hotel-statistics-load-error.png" });
  state.fail = false;
  await page.getByRole("alert").getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("Нет бронирований по выбранным фильтрам", { exact: true })).toBeVisible();
});

for (const lang of ["ru", "de"] as const) {
  test(`standalone hotels screen saves breakfast conditions and hotel contract files in ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 1560, height: 1120 });
    const state = await setup(page, lang);
    const ru = lang === "ru";
    await page.goto("/reports/hotels");
    await expect(page).toHaveURL(/\/hotels$/);
    await expect(page.getByRole("link", { name: ru ? "Гостиницы" : "Hotels", exact: true })).toHaveAttribute("href", "/hotels");
    await chooseFilter(page, ru ? "Завтраки" : "Frühstück", breakfastCopy[lang].unknown);
    await expect(page.getByTestId("hotel-table").locator("tbody tr")).toHaveCount(1);
    await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
    const trigger = page.getByTestId("breakfast-stay-0").getByRole("button");
    const row = page.getByTestId("hotel-stays-table").locator("tbody tr:visible").first();
    const rowHeight = (await row.boundingBox())!.height;
    expect(rowHeight).toBeLessThan(120);
    await trigger.click();
    const editor = page.getByTestId("breakfast-editor-stay-0");
    await chooseBreakfast(page, editor, "self", lang);
    await expect(editor.getByRole("combobox", { name: ru ? "Кто оплачивает" : "Wer bezahlt", exact: true })).toContainText(ru ? "Пациент" : "Patient");
    expect((await row.boundingBox())!.height).toBeLessThan(120);
    await editor.getByRole("spinbutton").fill("4");
    const amount = editor.getByRole("textbox", { name: ru ? "Общая стоимость завтраков" : "Gesamtkosten für Frühstück" });
    await amount.fill("32,50");
    await editor.getByRole("textbox", { name: ru ? "Условия и комментарий" : "Bedingungen und Kommentar", exact: true }).fill("No hotel breakfast; client purchases nearby.");
    state.fail = true;
    await editor.getByRole("button", { name: ru ? "Сохранить завтраки" : "Frühstück speichern", exact: true }).click();
    await expect(editor.getByRole("alert")).toBeVisible(); await expect(amount).toHaveValue("32,50");
    await page.screenshot({ path: `../artifacts/design-qa/hotel-breakfast-editor-${lang}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: `../artifacts/design-qa/hotel-breakfast-editor-${lang}-mobile.png` });
    const editorBounds = await editor.boundingBox();
    expect(editorBounds!.x).toBeGreaterThanOrEqual(0);
    expect(editorBounds!.x + editorBounds!.width).toBeLessThanOrEqual(390);
    await page.setViewportSize({ width: 1560, height: 1120 });
    state.fail = false;
    await editor.getByRole("button", { name: ru ? "Сохранить завтраки" : "Frühstück speichern", exact: true }).click();
    await expect(editor.getByRole("button", { name: ru ? "Сохранить завтраки" : "Frühstück speichern", exact: true })).toHaveCount(0);
    expect(state.rows[0].breakfast_total).toBe("32.50"); expect(state.rows[0].breakfast_currency).toBe("EUR");
    expect(state.rows[0].actual_cost).toBeNull(); expect(state.rows[0].cost_estimate).toBe("220");
    // The modal remains open even though the saved stay no longer matches the unknown filter.
    await expect(page.getByRole("dialog")).toBeVisible();
    const docs = page.getByTestId("hotel-documents");
    await docs.getByRole("button", { name: ru ? "Добавить файл" : "Datei hinzufügen", exact: true }).click();
    await docs.locator('input[type="file"]').setInputFiles({ name: "bad.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
    await docs.getByRole("button", { name: ru ? "Загрузить" : "Hochladen", exact: true }).click();
    await expect(docs.getByRole("alert")).toContainText("25"); expect(state.documentUploads).toBe(0);
    await docs.locator('input[type="file"]').setInputFiles({ name: "contract.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
    await docs.getByRole("textbox", { name: ru ? "Название документа" : "Dokumenttitel", exact: true }).fill("Hotel contract 2026");
    state.fail = true;
    await docs.getByRole("button", { name: ru ? "Загрузить" : "Hochladen", exact: true }).click();
    await expect(docs.getByRole("alert")).toBeVisible();
    state.fail = false;
    await docs.getByRole("button", { name: ru ? "Загрузить" : "Hochladen", exact: true }).click();
    await expect(docs.getByText("Hotel contract 2026", { exact: true })).toBeVisible();
    expect(state.documentUploads).toBe(2);
    const downloaded = page.waitForEvent("download");
    await docs.getByRole("button", { name: `${ru ? "Скачать" : "Herunterladen"}: Hotel contract 2026`, exact: true }).click();
    expect((await downloaded).suggestedFilename()).toBe("contract.pdf");
    await page.screenshot({ path: `../artifacts/design-qa/hotel-breakfast-documents-${lang}.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await docs.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-qa/hotel-documents-${lang}-mobile.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    await page.reload();
    await page.getByRole("button", { name: "Hotel Lindenhof", exact: true }).click();
    await expect(page.getByTestId("hotel-documents").getByText("Hotel contract 2026", { exact: true })).toBeVisible();
    await page.getByTestId("breakfast-stay-0").getByRole("button").click();
    await expect(page.getByTestId("breakfast-editor-stay-0").getByRole("textbox", { name: ru ? "Общая стоимость завтраков" : "Gesamtkosten für Frühstück" })).toHaveValue("32.50");
    await chooseBreakfast(page, page.getByTestId("breakfast-editor-stay-0"), "included", lang);
    await page.getByTestId("breakfast-editor-stay-0").getByRole("button", { name: ru ? "Сохранить завтраки" : "Frühstück speichern", exact: true }).click();
    await expect(page.getByTestId("breakfast-editor-stay-0")).toHaveCount(0);
    expect(state.rows[0].breakfast_total).toBeNull(); expect(state.rows[0].breakfast_currency).toBeNull();
  });
}
