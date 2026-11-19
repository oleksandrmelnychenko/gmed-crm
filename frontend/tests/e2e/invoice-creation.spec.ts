import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { chooseComboboxOption, pickerSection, startClockAt } from "./helpers";

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
  const finalPreview = {
    total_net: "1200", total_vat: "228", total_gross: "1428", deducted_gross: "0", due_gross: "1428",
    advances: [] as unknown[], interim_invoices: [] as unknown[],
  };
  const fixture = { quote: quote as typeof quote & Record<string, unknown>, quotes, order, invoice, finalPreview, previewWrites: [] as unknown[], postError: "", quotesError: false, writes: [] as unknown[], commentWrites: [] as unknown[], noteWrites: [] as unknown[], pdfReads: 0, errors: [] as string[] };
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
    if (path === `/invoices/${invoiceId}/line-comments` && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { comments: { line_index: number; comment: string | null }[] };
      fixture.commentWrites.push(body);
      for (const { line_index, comment } of body.comments) Object.assign(invoice.line_items[line_index], { comment });
      return route.fulfill({ json: invoice });
    }
    if (path === `/invoices/${invoiceId}/internal-note` && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { internal_note: string | null };
      fixture.noteWrites.push(body);
      Object.assign(invoice, { internal_note: body.internal_note });
      return route.fulfill({ json: invoice });
    }
    if (path === `/invoices/${invoiceId}/pdf`) { fixture.pdfReads++; return route.fulfill({ contentType: "application/pdf", body: previewPdf }); }
    // The prepayment advance split comes from the server (bca23f8d).
    if (path === `/quotes/${quoteId}/advance-preview`) {
      return route.fulfill({ json: {
        quote_id: quoteId, billed_advances_gross: "0", total_net: "420.17", total_vat: "79.83", total_gross: "500.00",
        lines: [{ is_cost_passthrough: false, vat_rate: "19", net: "420.17", vat: "79.83", gross: "500.00" }],
      } });
    }
    // The set-off the release of the final invoice makes (owner 2026-11-17).
    if (path === `/quotes/${quoteId}/final-preview`) {
      fixture.previewWrites.push(route.request().postDataJSON());
      return route.fulfill({ json: fixture.finalPreview });
    }
    if (path === "/quotes" && fixture.quotesError) return route.fulfill({ status: 500, json: { error: "Quotes unavailable" } });
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

// The page header renders its actions in the page and in the top bar. On desktop only
// the top-bar copy may ever be shown: a first frame with the in-page copy let a click
// resolve to the button that was hidden right after, and the click then waited forever.
test("on desktop the header actions appear only in the top bar", async ({ page }) => {
  // A wide desktop: since the search button joined the top bar (system QA 2026-11-12) two
  // actions no longer fit next to the title at 1280 px and stay in the page, as designed.
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await page.addInitScript(() => {
    // Every DOM state another task (a user, a test) could see, not only painted frames.
    const shown: string[] = [];
    Object.assign(window, { __inPageHeaderActions: shown });
    new MutationObserver(() => {
      for (const button of document.querySelectorAll("button")) {
        if (button.textContent?.trim() === "Исходящий счёт" && !button.closest("header") && button.getBoundingClientRect().width > 0) shown.push(button.outerHTML);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true });
  });
  await page.goto("/invoices");
  await expect(page.locator("header").getByRole("button", { name: "Исходящий счёт", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Исходящий счёт", exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { __inPageHeaderActions: string[] }).__inPageHeaderActions)).toEqual([]);
});

// The separate order-service approval step before invoicing was dropped (b6e12b62),
// so a not-yet-approved service no longer holds back the invoice.
test("an unapproved order service does not block creating the final invoice", async ({ page }) => {
  const fixture = await prepare(page);
  fixture.order.leistungen[0].status = "pending";
  const dialog = await openCreate(page);
  const footer = dialog.getByTestId("invoice-create-footer");
  await expect(footer.getByRole("alert")).toHaveCount(0);
  await expect(footer.getByRole("status")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes).toEqual([{ invoice_type: "final", due_date: null, notes: null, internal_note: null, line_items: fixture.quote.line_items.map((_, line_index) => ({ line_index, quantity: 1 })), order_services: [] }]);
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

test("a prepayment route opens an advance invoice with the selected quote", async ({ page }) => {
  await prepare(page);
  await page.goto(`/invoices?patient=${patientId}&order=${orderId}&quote=${quoteId}&invoice_type=advance&create=1`);
  const dialog = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Предложение", exact: true })).toContainText("KV-TEST-1");
  await expect(dialog.getByRole("combobox", { name: "Тип счёта", exact: true })).toContainText("Авансовый");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
});

test("an advance for the required prepayment takes the order's deadline as its due date", async ({ page }) => {
  const fixture = await prepare(page);
  Object.assign(fixture.quote, { order_prepayment_amount: "500", order_prepayment_required: true });
  Object.assign(fixture.order, { prepayment_due_at: "2099-11-20T11:00:00Z" });
  await page.goto(`/invoices?patient=${patientId}&order=${orderId}&quote=${quoteId}&invoice_type=advance&create=1`);
  const dialog = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  await expect(dialog.getByRole("radio", { name: /Требуемая предоплата/ })).toBeChecked();
  await dialog.getByRole("radio", { name: "Выбранные позиции предложения", exact: true }).check();
  await dialog.getByRole("radio", { name: /Требуемая предоплата/ }).check();
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes).toEqual([{ invoice_type: "advance", advance_basis: "prepayment", due_date: "2099-11-20", notes: null, internal_note: null }]);

  await page.goto(`/invoices?patient=${patientId}&order=${orderId}&quote=${quoteId}&invoice_type=advance&create=1`);
  const positions = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  await positions.getByRole("radio", { name: "Выбранные позиции предложения", exact: true }).check();
  await positions.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(positions).toHaveCount(0);
  expect(fixture.writes[1]).toMatchObject({ advance_basis: "positions", due_date: null });
});

test("an advance invoice bills the order's required prepayment unless positions are picked", async ({ page }) => {
  const fixture = await prepare(page);
  Object.assign(fixture.quote, { order_prepayment_amount: "500", order_prepayment_required: true });
  await page.goto(`/invoices?patient=${patientId}&order=${orderId}&quote=${quoteId}&invoice_type=advance&create=1`);
  const dialog = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  await expect(dialog.getByRole("radio", { name: /Требуемая предоплата · 500,00/ })).toBeChecked();
  const prepayment = dialog.getByTestId("invoice-prepayment-advance");
  // The split shown is the server preview (bca23f8d); the quote stays in its picker.
  await expect(dialog.getByRole("combobox", { name: "Предложение", exact: true })).toContainText("KV-TEST-1");
  await expect(prepayment).toContainText("Доля с НДС 19 %");
  await expect(prepayment).toContainText("500,00");
  await expect(dialog.getByRole("checkbox", { name: "Позиция: Service 1", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes).toEqual([{ invoice_type: "advance", advance_basis: "prepayment", due_date: null, notes: null, internal_note: null }]);

  await page.goto(`/invoices?patient=${patientId}&order=${orderId}&quote=${quoteId}&invoice_type=advance&create=1`);
  const again = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  await again.getByRole("radio", { name: "Выбранные позиции предложения", exact: true }).check();
  await expect(again.getByRole("checkbox", { name: "Позиция: Service 1", exact: true })).toBeChecked();
  await again.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(again).toHaveCount(0);
  expect(fixture.writes[1]).toMatchObject({ invoice_type: "advance", advance_basis: "positions" });
  expect(fixture.errors).toEqual([]);
});

test("a new invoice can be interim again", async ({ page }) => {
  // Owner 2026-11-18 (reversing 2026-11-17): «Промежуточный» is a type of a
  // new invoice again, also when a link asks for it.
  await prepare(page);
  await page.goto(`/invoices?patient=${patientId}&order=${orderId}&quote=${quoteId}&invoice_type=interim&create=1`);
  const dialog = page.getByRole("dialog", { name: "Новый счёт", exact: true });
  const type = dialog.getByRole("combobox", { name: "Тип счёта", exact: true });
  await expect(type).toContainText("Промежуточный");
  await type.click();
  const listbox = page.locator('[role="listbox"]');
  await expect(listbox.getByRole("option", { name: "Промежуточный", exact: true })).toHaveCount(1);
  await expect(listbox.getByRole("option")).toHaveCount(3);
});

test("a position remark is sent with the invoice and can be changed on the draft", async ({ page }) => {
  const fixture = await prepare(page);
  const dialog = await openCreate(page);
  // A final invoice bills every position with its delivered quantity
  // (interim is no longer offered — owner 2026-11-17); every final line has
  // its remark field again (lost with fix-96).
  await expect(dialog.getByTestId("final-invoice-lines")).toBeVisible();
  // The remark opens from a compact «+ Примечание» button (owner 2026-11-18).
  await expect(dialog.getByRole("button", { name: "Добавить примечание: Service 2", exact: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Добавить примечание: Service 1", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Примечание в счёте: Service 1", exact: true }).fill("  за 2 и 3 квартал 2026 ");
  await page.screenshot({ path: "../artifacts/design-qa/invoice-create-remark-ru.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const [write] = fixture.writes as { line_items: unknown[] }[];
  expect(write.line_items.slice(0, 2)).toEqual([
    { line_index: 0, quantity: 1, comment: "за 2 и 3 квартал 2026" },
    { line_index: 1, quantity: 1 },
  ]);

  // The new draft opens; a remark is saved when Enter is pressed in its field.
  const sheet = page.getByRole("dialog");
  const remark = sheet.getByRole("textbox", { name: "Примечание к позиции: Service 1", exact: true }).filter({ visible: true });
  await remark.scrollIntoViewIfNeeded();
  await remark.fill("счёт клиники № 4711");
  await remark.press("Enter");
  await expect.poll(() => fixture.commentWrites).toEqual([
    { comments: [{ line_index: 0, comment: "счёт клиники № 4711" }] },
  ]);
  await expect(remark).toHaveValue("счёт клиники № 4711");
  await remark.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "../artifacts/design-qa/invoice-lines-remark-ru.png", animations: "disabled" });
  expect(fixture.errors).toEqual([]);
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

// Owner 2026-10-12: the staff-only note is saved on its own, also on an issued
// invoice, and is never the printed customer remark.
test("the internal note is saved apart from the printed remark, also after release", async ({ page }) => {
  const fixture = await prepare(page);
  Object.assign(fixture.invoice, { status: "sent", released_at: "2026-09-07T10:00:00Z", notes: "Bitte überweisen Sie bis zum Fälligkeitsdatum." });
  await page.goto(`/invoices?invoice=${invoiceId}`);
  const sheet = page.getByRole("dialog");
  const editor = sheet.getByTestId("invoice-internal-note");
  await editor.scrollIntoViewIfNeeded();
  await expect(editor).toContainText("Внутренняя заметка (не печатается)");
  const save = editor.getByRole("button", { name: "Сохранить заметку", exact: true });
  await expect(save).toBeDisabled();
  const note = editor.getByRole("textbox", { name: "Внутренняя заметка (не печатается)", exact: true });
  await note.fill("  Пациент просит рассрочку  ");
  // An unsaved internal note keeps the sheet from closing silently.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(note).toHaveValue("  Пациент просит рассрочку  ");
  await save.click();
  await expect.poll(() => fixture.noteWrites).toEqual([{ internal_note: "Пациент просит рассрочку" }]);
  // The reloaded invoice carries the saved note; nothing is left to save.
  await expect(sheet.getByTestId("invoice-internal-note").getByRole("textbox", { name: "Внутренняя заметка (не печатается)", exact: true })).toHaveValue("Пациент просит рассрочку");
  await expect(sheet.getByTestId("invoice-internal-note").getByRole("button", { name: "Сохранить заметку", exact: true })).toBeDisabled();
  await expect(sheet.getByText("Bitte überweisen Sie bis zum Fälligkeitsdatum.", { exact: true })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});

test("a quote refresh keeps the typed final quantities and notes", async ({ page }) => {
  const fixture = await prepare(page);
  const dialog = await openCreate(page);
  // The printed customer remark comes first; the staff-only internal note follows.
  const notes = dialog.locator("textarea").first();
  const internalNote = dialog.getByRole("textbox", { name: "Внутренняя заметка (не печатается)" });
  await notes.fill("Keep this note");
  await internalNote.fill("Keep this internal note");
  await dialog.getByRole("spinbutton", { name: "Количество: Service 1", exact: true }).fill("2");
  fixture.quote.line_items[0].remaining_quantity = "0.5";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(dialog.getByRole("spinbutton", { name: "Количество: Service 1", exact: true })).toHaveValue("2");
  await expect(notes).toHaveValue("Keep this note");
  await expect(internalNote).toHaveValue("Keep this internal note");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
});

// Owner 2026-11-17: the final invoice bills what was delivered, not the estimate 1:1.
test("a final invoice proposes the delivered quantities, services outside the estimate and the advance set-off", async ({ page }) => {
  const fixture = await prepare(page);
  const hours = {
    description: "Dolmetscherstunden", quantity: "3", unit: "hour", remaining_quantity: "3", final_quantity: "5", delivery_basis: "actual",
    unit_price: "60", vat_rate: "19", line_net: "180", line_vat: "34.2", line_gross: "214.2", is_cost_passthrough: false,
    invoiced_quantity: "0", invoiced_net: "0", invoiced_gross: "0", source_order_leistung_id: "service-h",
  };
  const transfer = {
    description: "Transfer", quantity: "2", remaining_quantity: "2", final_quantity: "2", delivery_basis: "estimate",
    unit_price: "50", vat_rate: "19", line_net: "100", line_vat: "19", line_gross: "119", is_cost_passthrough: false,
    invoiced_quantity: "0", invoiced_net: "0", invoiced_gross: "0", source_order_leistung_id: "service-t",
  };
  Object.assign(fixture.quote, {
    total_gross: "333.2",
    line_items: [hours, transfer],
    delivered_services_outside_quote: [{
      order_leistung_id: "service-x", description: "Zusatztransfer Klinik", name: "Zusatztransfer Klinik", unit: null,
      quantity: "1", unit_price: "80", vat_rate: "19", is_cost_passthrough: false, quote_line_index: null,
    }],
  });
  Object.assign(fixture.finalPreview, {
    total_gross: "552.16", deducted_gross: "300", due_gross: "252.16",
    advances: [
      { invoice_id: "adv-1", invoice_number: "AR-2026-0001", total_gross: "300", paid_gross: "300", available_gross: "300", deduction_gross: "300",
        deduction_rows: [{ kind: "taxed", vat_rate: "19", net: "252.10", vat: "47.90", gross: "300" }] },
      { invoice_id: "adv-2", invoice_number: "AR-2026-0002", total_gross: "100", paid_gross: "0", available_gross: "0", deduction_gross: "0", deduction_rows: [] },
    ],
    interim_invoices: [{ invoice_id: "int-1", invoice_number: "ZR-2026-0001", total_gross: "119", status: "paid" }],
  });
  const dialog = await openCreate(page);
  const lines = dialog.getByTestId("final-invoice-line");
  await expect(lines.nth(0).getByTestId("invoice-line-origin-estimate")).toHaveText("по смете 3");
  await expect(lines.nth(0).getByTestId("final-line-comparison")).toContainText("фактически 5");
  await expect(lines.nth(0).getByTestId("final-line-above-estimate")).toHaveText("больше сметы");
  await expect(lines.nth(0).getByTestId("final-line-difference")).toContainText("+2");
  await expect(lines.nth(0).getByTestId("final-line-difference")).toContainText("142,80");
  // No delivery record: the estimate quantity, marked as such.
  await expect(lines.nth(1).getByTestId("invoice-line-origin-estimate")).toContainText("по смете");
  // A service outside the estimate is marked as added during the order (owner 2026-11-18).
  await expect(dialog.getByTestId("final-order-service").first().getByTestId("invoice-line-origin-added")).toHaveText("добавлено в ходе заказа");
  await dialog.getByRole("spinbutton", { name: "Количество: Transfer", exact: true }).fill("0");
  await expect(lines.nth(1).getByTestId("final-line-not-delivered")).toHaveText("не оказано");
  await expect(dialog.getByTestId("final-order-service")).toContainText("Zusatztransfer Klinik");
  await expect(dialog.getByTestId("final-summary-estimate")).toContainText("333,20");
  await expect(dialog.getByTestId("final-summary-actual")).toContainText("452,20");
  await expect(dialog.getByTestId("final-summary-difference")).toContainText("+119,00");
  const settlement = dialog.getByTestId("final-invoice-settlement");
  await expect(settlement.getByTestId("final-preview-advance").nth(0)).toContainText("AR-2026-0001");
  await expect(settlement.getByTestId("final-preview-advance").nth(0)).toContainText("−300,00");
  await expect(settlement.getByTestId("final-preview-advance").nth(1)).toContainText("не оплачен — не зачитывается");
  await expect(settlement.getByTestId("final-preview-interims")).toContainText("ZR-2026-0001");
  await expect(settlement.getByTestId("final-preview-due")).toContainText("252,16");
  await expect.poll(() => fixture.previewWrites.at(-1)).toEqual({
    line_items: [{ line_index: 0, quantity: 5 }],
    order_services: [{ order_leistung_id: "service-x", quantity: 1 }],
  });
  await page.screenshot({ path: "../artifacts/design-qa/invoice-create-final-actuals-ru.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.writes).toEqual([{
    invoice_type: "final", due_date: null, notes: null, internal_note: null,
    line_items: [{ line_index: 0, quantity: 5 }],
    order_services: [{ order_leistung_id: "service-x", quantity: 1 }],
  }]);
  expect(fixture.errors).toEqual([]);
});

test("failed quote refresh stays blocked and shows retry beside submit", async ({ page }) => {
  const fixture = await prepare(page);
  const dialog = await openCreate(page);
  const footer = dialog.getByTestId("invoice-create-footer");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  fixture.quotesError = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(footer.getByRole("alert")).toContainText("Quotes unavailable");
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeDisabled();
  fixture.quotesError = false;
  await footer.getByRole("button", { name: "Проверить", exact: true }).click();
  await expect(footer.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Создать счёт", exact: true })).toBeEnabled();
  expect(fixture.writes).toEqual([]);
});

for (const lang of ["ru", "de"]) {
  for (const width of [1440, 390]) {
    test(`invoice error remains visible at end of a long form ${lang} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const fixture = await prepare(page, lang);
      fixture.postError = "Invoice quantity changed; reload the quote and try again";
      const dialog = await openCreate(page, lang);
      await expect(dialog.getByRole("button", { name: lang === "de" ? "Rechnung erstellen" : "Создать счёт", exact: true })).toBeEnabled();
      await page.screenshot({ path: `../artifacts/design-qa/invoice-create-${lang}-${width}.png`, animations: "disabled" });
      await dialog.locator("textarea").first().fill("Invoice note");
      await dialog.getByRole("button", { name: lang === "de" ? "Rechnung erstellen" : "Создать счёт", exact: true }).click();
      const alert = dialog.getByTestId("invoice-create-footer").getByRole("alert");
      // The server's conflict is shown in the interface language, never as raw English.
      await expect(alert).toContainText(lang === "de" ? "Aktualisieren Sie das Angebot" : "Обновите предложение");
      await expect(alert).not.toContainText(fixture.postError);
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
      // Drawn by pdf.js: a PDF <iframe> stays blank without the browser's viewer.
      const preview = page.getByTestId("pdf-pages-preview");
      await expect(preview).toHaveAttribute("data-state", "ready");
      await expect(preview.locator("canvas[data-pdf-page]").first()).toBeVisible();
      await expect(page.locator("iframe")).toHaveCount(0);
      expect(fixture.errors).toEqual([]);
    });
  }
}

test("a double click on create leaves no dialog behind the invoice's sheet", async ({ page }) => {
  const fixture = await prepare(page);
  await page.route(`**/api/v1/quotes/${quoteId}/invoices`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 120));
    await route.fallback();
  });
  const dialog = await openCreate(page);
  const button = dialog.getByRole("button", { name: "Создать счёт", exact: true });
  await expect(button).toBeEnabled();
  const box = (await button.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("dialog", { name: "Новый счёт", exact: true })).toHaveCount(0);
  expect(fixture.writes).toHaveLength(1);
});

// Owner 2026-11-17: money that arrived before the invoice is noted in the
// create dialog; the due date stays empty (release date + term).
test("a payment received before the invoice is sent with the new invoice", async ({ page }) => {
  const fixture = await prepare(page);
  Object.assign(fixture.quote, {
    order_period_from: "2026-10-18",
    order_period_to: "2026-10-25",
    order_programme_from: "2026-10-20",
    order_programme_to: "2026-10-25",
    order_visits_from: "2026-10-18",
    order_visits_to: "2026-10-25",
    payment_term_days: 14,
  });
  await startClockAt(page);
  const dialog = await openCreate(page);
  await expect(dialog.getByTestId("release-due-date-default")).toHaveText("+14 дней · 26.10.2026");
  await expect(dialog.getByTestId("invoice-service-period")).toContainText("Период оказания услуг");
  // Not prefilled: the programme dates are offered as pills (owner 2026-11-18),
  // the first visit apart when it is another day (QA 2026-11-19).
  await expect(dialog.getByTestId("invoice-period-program-start")).toHaveText("Начало программы 20.10.2026");
  await expect(dialog.getByTestId("invoice-period-program-end")).toHaveText("Окончание программы 25.10.2026");
  await expect(dialog.getByTestId("invoice-period-first-visit")).toHaveText("Первый приём 18.10.2026");
  await expect(dialog.getByTestId("invoice-period-last-visit")).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Оплата уже поступила", exact: true }).check();
  const received = dialog.getByRole("group", { name: "Дата поступления" });
  await received.getByRole("spinbutton", { name: pickerSection.day }).fill("10");
  await received.getByRole("spinbutton", { name: pickerSection.month }).fill("10");
  await received.getByRole("spinbutton", { name: pickerSection.year }).fill("2026");
  await received.getByRole("spinbutton", { name: pickerSection.year }).press("Tab");
  await dialog.getByRole("textbox", { name: "Сумма оплаты", exact: true }).fill("500");
  await chooseComboboxOption(page, dialog.getByRole("combobox", { name: "Способ оплаты", exact: true }), "Наличные");
  await dialog.getByRole("button", { name: "Создать счёт", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const write = fixture.writes[0] as Record<string, unknown>;
  expect(write).toMatchObject({ invoice_type: "final", due_date: null, payment_received: { received_on: "2026-10-10", payment_method: "cash" } });
  expect(Number((write.payment_received as { amount_gross: string }).amount_gross)).toBe(500);
  // The order's period unchanged: the server reads it itself.
  expect(write).not.toHaveProperty("service_period");
  expect(fixture.errors).toEqual([]);
});

test("issuing a draft names the button and marks a due date shorter than the term", async ({ page }) => {
  const fixture = await prepare(page);
  Object.assign(fixture.invoice, { payment_term_days: 14, due_date: "2026-10-20" });
  await startClockAt(page);
  await page.goto(`/invoices?invoice=${invoiceId}`);
  await page.getByTestId("invoice-issue-draft").click();
  const status = page.getByRole("dialog").filter({ has: page.getByTestId("release-due-date") });
  await expect(status.getByTestId("release-due-date-short")).toContainText("26.10.2026");
  await expect(status.getByRole("button", { name: "Выставить счёт", exact: true })).toBeVisible();
  expect(fixture.errors).toEqual([]);
});
