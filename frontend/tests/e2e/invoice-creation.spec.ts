import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { chooseComboboxOption } from "./helpers";

const orderId = "00000000-0000-0000-0000-000000000901";
const patientId = "00000000-0000-0000-0000-000000000301";
const quoteId = "00000000-0000-0000-0000-000000000501";
const invoiceId = "00000000-0000-0000-0000-000000000601";
const previewPdf = readFileSync(new URL("./fixtures/signature-preview.pdf", import.meta.url));

async function prepare(page: Page, lang = "ru") {
  const lines = Array.from({ length: 12 }, (_, index) => ({
    description: `Service ${index + 1}`, quantity: "1", remaining_quantity: "1", unit_price: "100", vat_rate: "19",
    line_net: "100", line_vat: "19", line_gross: "119", is_cost_passthrough: false, vat_source: "legacy",
    source_order_leistung_id: `service-${index + 1}`, notes: "Detailed service description remains in the workspace.",
  }));
  const quote = { id: quoteId, order_id: orderId, order_number: "A-TEST-1", patient_id: patientId, patient_name: "Anna Beispiel", patient_pid: "P-TEST-1", quote_number: "KV-TEST-1", status: "accepted", active_invoice_types: [] as string[], total_gross: "1428", line_items: lines };
  const quotes = [
    quote,
    { ...quote, id: "paid", quote_number: "KV-PAID", active_invoice_types: ["final"], line_items: lines.map(line => ({ ...line, remaining_quantity: "0" })) },
    { ...quote, id: "rejected", quote_number: "KV-REJECTED", status: "rejected" },
    { ...quote, id: "prepaid", quote_number: "KV-PREPAID", active_invoice_types: ["advance"] },
  ];
  const order = { id: orderId, order_number: "A-TEST-1", patient_id: patientId, patient_name: "Anna Beispiel", patient_pid: "P-TEST-1", process_gates: { billing_release_status: "granted", billing_release_note: null, package_coverage_status: "not_covered" }, leistungen: lines.map(line => ({ id: line.source_order_leistung_id, status: "approved" })) };
  const invoice = { ...quote, id: invoiceId, invoice_number: "INV-TEST-1", quote_id: quoteId, invoice_type: "final", status: "draft", issued_at: "2026-09-07T10:00:00Z", created_at: "2026-09-07T10:00:00Z", updated_at: "2026-09-07T10:00:00Z", total_net: "1200", total_vat: "228", total_gross: "1428", paid_amount: "0", balance_due: "1428", due_date: null, paid_at: null, notes: null, available_prepayments: [], prepayment_allocations: [] };
  const fixture = { quote, quotes, order, invoice, postError: "", orderError: false, writes: [] as unknown[], pdfReads: 0, errors: [] as string[] };
  page.on("pageerror", error => fixture.errors.push(error.message));
  await page.addInitScript(language => {
    localStorage.setItem("gmed_access_token", "invoice-test-token");
    localStorage.setItem("gmed_refresh_token", "invoice-test-refresh");
    localStorage.setItem("gmed_lang", language);
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === `/quotes/${quoteId}/invoices` && route.request().method() === "POST") {
      fixture.writes.push(route.request().postDataJSON());
      return route.fulfill(fixture.postError ? { status: 422, json: { error: fixture.postError } } : { json: invoice });
    }
    if (path === `/invoices/${invoiceId}/pdf`) { fixture.pdfReads++; return route.fulfill({ contentType: "application/pdf", body: previewPdf }); }
    if (path === `/orders/${orderId}` && fixture.orderError) return route.fulfill({ status: 500, json: { error: "Order unavailable" } });
    let body: unknown = [];
    if (path === "/me") body = { id: "invoice-test-user", email: "invoice@example.org", name: "Invoice QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    if (path === "/auth/refresh") body = { access_token: "invoice-test-token", refresh_token: "invoice-test-refresh", expires_in: 900 };
    if (path === "/patients") body = [{ id: patientId, first_name: "Anna", last_name: "Beispiel", patient_id: "P-TEST-1" }];
    if (path === "/orders") body = [order];
    if (path === `/orders/${orderId}`) body = order;
    if (path === "/quotes") body = quotes;
    if (path === "/invoices") body = { items: [invoice], total: 1, page: 1, per_page: 50, total_pages: 1 };
    if (path === `/invoices/${invoiceId}`) body = invoice;
    if (/\/invoices\/[^/]+\/(payments|credit-notes|refunds)$/.test(path)) body = { items: [] };
    if (path === "/invoices/accounting-ledger") body = { year: 2026, summary: {}, monthly: [], entries: [] };
    if (path === "/stats/overview") body = {};
    await route.fulfill({ json: body });
  });
  return fixture;
}

async function openCreate(page: Page, lang = "ru") {
  await page.goto("/invoices");
  await page.getByRole("button", { name: lang === "de" ? "Ausgangsrechnung" : "Исходящий счёт", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: lang === "de" ? "Neue Rechnung" : "Новый счёт", exact: true });
  await chooseComboboxOption(page, dialog.getByRole("combobox", { name: lang === "de" ? "Angebot" : "Предложение", exact: true }), /KV-TEST-1/);
  await expect(page.locator('[role="listbox"]')).toBeHidden();
  return dialog;
}

test("blocks unapproved selected services before submit and recovers after approval", async ({ page }) => {
  const fixture = await prepare(page);
  fixture.order.leistungen[0].status = "pending";
  const dialog = await openCreate(page);
  const footer = dialog.getByTestId("invoice-create-footer");
  await expect(footer).toContainText("Утвердите выбранные услуги");
  await expect(footer.getByRole("link")).toHaveAttribute("href", `/orders?order=${orderId}&section=services`);
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeDisabled();
  await expect(dialog.getByText("Выставление счетов разрешено", { exact: true })).toHaveCount(0);
  fixture.order.leistungen[0].status = "approved";
  await footer.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes).toEqual([{ invoice_type: "final", due_date: null, notes: null, line_items: fixture.quote.line_items.map((_, line_index) => ({ line_index, quantity: 1 })) }]);
  expect(fixture.errors).toEqual([]);
});

test("a valid preselected quote can create a new invoice without artificial edits", async ({ page }) => {
  await prepare(page);
  await page.goto(`/invoices?quote=${quoteId}`);
  await page.getByRole("button", { name: "Исходящий счёт", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Предложение", exact: true })).toContainText("KV-TEST-1");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("allows an approved interim selection while other services remain unapproved", async ({ page }) => {
  const fixture = await prepare(page);
  fixture.order.leistungen[0].status = "pending";
  const dialog = await openCreate(page);
  await chooseComboboxOption(page, dialog.getByRole("combobox", { name: "Тип счёта", exact: true }), "Промежуточный");
  await dialog.getByRole("checkbox", { name: "Позиция: Service 1", exact: true }).uncheck();
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
});

test("hides paid and rejected quotes but keeps a paid advance available for settlement", async ({ page }) => {
  await prepare(page);
  const dialog = await openCreate(page);
  const quote = dialog.getByRole("combobox", { name: "Предложение", exact: true });
  await quote.click();
  await expect(page.getByRole("option").filter({ hasText: "KV-PAID" })).toHaveCount(0);
  await expect(page.getByRole("option").filter({ hasText: "KV-REJECTED" })).toHaveCount(0);
  await page.getByRole("option").filter({ hasText: "KV-PREPAID" }).click();
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  await chooseComboboxOption(page, dialog.getByRole("combobox", { name: "Тип счёта", exact: true }), "Авансовый");
  await expect(quote).not.toContainText("KV-PREPAID");
  await quote.click();
  await expect(page.getByRole("option").filter({ hasText: "KV-PREPAID" })).toHaveCount(0);
});

test("refreshing exhausted quote scope clears the stale selection", async ({ page }) => {
  const fixture = await prepare(page);
  const dialog = await openCreate(page);
  fixture.quote.active_invoice_types = ["final"];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog.getByRole("combobox", { name: "Предложение", exact: true })).not.toContainText("KV-TEST-1");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeDisabled();
});

test("final invoice refresh uses the new remainder without losing notes", async ({ page }) => {
  const fixture = await prepare(page);
  const dialog = await openCreate(page);
  await dialog.locator("textarea").fill("Keep this note");
  fixture.quote.line_items[0].remaining_quantity = "0.5";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog.getByRole("spinbutton", { name: "Количество: Service 1", exact: true })).toHaveValue("0.5");
  await expect(dialog.locator("textarea")).toHaveValue("Keep this note");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
});

test("failed readiness load stays blocked and shows retry beside submit", async ({ page }) => {
  const fixture = await prepare(page);
  fixture.orderError = true;
  const dialog = await openCreate(page);
  const footer = dialog.getByTestId("invoice-create-footer");
  await expect(footer.getByRole("alert")).toContainText("Не удалось проверить");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeDisabled();
  fixture.orderError = false;
  await footer.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  expect(fixture.writes).toEqual([]);
});

for (const lang of ["ru", "de"]) {
  for (const width of [1440, 390]) {
    test(`invoice error remains visible at end of a long form ${lang} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const fixture = await prepare(page, lang);
      fixture.postError = "All order services must be approved before invoice creation";
      const dialog = await openCreate(page, lang);
      await expect(dialog.getByRole("button", { name: lang === "de" ? "Rechnung erstellen" : "Создать счёт", exact: true })).toBeEnabled();
      await page.screenshot({ path: `../artifacts/design-qa/invoice-create-${lang}-${width}.png`, animations: "disabled" });
      await dialog.locator("textarea").fill("Invoice note");
      await dialog.getByRole("button", { name: lang === "de" ? "Rechnung erstellen" : "Создать счёт", exact: true }).click();
      const alert = dialog.getByTestId("invoice-create-footer").getByRole("alert");
      await expect(alert).toContainText(lang === "de" ? "genehmigt" : "утвердить");
      const box = (await alert.boundingBox())!;
      expect(box.y).toBeGreaterThan(0);
      expect(box.y + box.height).toBeLessThanOrEqual(width === 390 ? 844 : 1000);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `../artifacts/design-qa/invoice-create-error-${lang}-${width}.png`, animations: "disabled" });
      fixture.postError = "";
      await dialog.getByTestId("invoice-create-footer").getByRole("button", { name: lang === "de" ? "Prüfen" : "Проверить", exact: true }).click();
      await expect(alert).toHaveCount(0);
      await expect(dialog.getByRole("button", { name: lang === "de" ? "Rechnung erstellen" : "Создать счёт", exact: true })).toBeEnabled();
      expect(fixture.errors).toEqual([]);
    });

    test(`invoice detail and PDF actions ${lang} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const fixture = await prepare(page, lang);
      await page.goto(`/invoices?invoice=${invoiceId}`);
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByText("Anna Beispiel", { exact: true })).toBeVisible();
      expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `../artifacts/design-qa/invoice-detail-${lang}-${width}.png`, animations: "disabled" });
      const firstService = sheet.getByText("Service 1", { exact: true }).filter({ visible: true });
      await firstService.scrollIntoViewIfNeeded();
      await expect(sheet.getByText(fixture.quote.line_items[0].notes, { exact: true })).toHaveCount(0);
      await page.screenshot({ path: `../artifacts/design-qa/invoice-lines-${lang}-${width}.png`, animations: "disabled" });
      await sheet.getByRole("button", { name: lang === "de" ? "PDF-Vorschau" : "Предпросмотр PDF", exact: true }).click();
      await expect.poll(() => fixture.pdfReads).toBe(1);
      await expect(page.locator("iframe")).toHaveCount(1);
      expect(fixture.errors).toEqual([]);
    });
  }
}
