import { expect, test, type Page } from "@playwright/test";
import type { InvoiceImportPreview } from "../../src/pages/invoices/model/import-model";
import fs from "node:fs";
import path from "node:path";
if (process.env.PARSER_TEST_BASE_URL) test.use({ baseURL: process.env.PARSER_TEST_BASE_URL });

const patientA = "00000000-0000-0000-0000-000000000101";
const patientB = "00000000-0000-0000-0000-000000000102";
const orderA = "00000000-0000-0000-0000-000000000201";
const orderB = "00000000-0000-0000-0000-000000000202";
const documentId = "00000000-0000-0000-0000-000000000301";
const invoice = { schema_version: "1.0", requires_review: true, extraction_complete: true, warnings: [], text: "Synthetic invoice R-42",
  fields: { supplier_name: "Testklinik", external_invoice_number: "R-42", invoice_date: "2026-09-01", due_date: "2026-09-15", amount_net: "100.00", amount_vat: "19.00", amount_gross: "119.00", currency: "EUR" } };

async function prepare(page: Page, options: { pdf?: string; scope?: "company" | "patient_order"; xml?: string; parserFails?: boolean; saveFailsOnce?: boolean; delayedParse?: Promise<void>; parserTexts?: string[]; preview?: Partial<InvoiceImportPreview> } = {}) {
  const writes: Array<Record<string, unknown>> = [];
  const uploads: string[] = [];
  const discards: string[] = [];
  let parseCount = 0;
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "invoice-test-token");
    localStorage.setItem("gmed_refresh_token", "invoice-test-refresh");
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    let status = 200;
    if (path === "/me") body = { id: "00000000-0000-0000-0000-000000000001", email: "invoice@example.com", name: "Invoice tester", role: "billing", created_at: "2026-01-01T00:00:00Z" };
    if (path === "/invoices/accounting-ledger") { status = 503; body = { message: "Ledger not part of this test" }; }
    if (path === "/patients") body = [
      { id: patientA, patient_id: "PT-101", first_name: "Anna", last_name: "Alpha" },
      { id: patientB, patient_id: "PT-102", first_name: "Boris", last_name: "Beta" },
    ];
    if (path === "/orders") body = [
      { id: orderA, order_number: "O-101", patient_id: patientA, patient_name: "Anna Alpha", patient_pid: "PT-101" },
      { id: orderB, order_number: "O-102", patient_id: patientB, patient_name: "Boris Beta", patient_pid: "PT-102" },
    ];
    if (path === "/invoices") body = { items: [], total: 0, page: 1, per_page: 25, total_pages: 1 };
    if (path === "/invoices/import-preview") {
      expect(route.request().headers()["content-type"]).toBe(options.pdf ? "application/pdf" : options.xml ? "application/xml" : "image/png");
      await options.delayedParse;
      status = options.parserFails ? 503 : 200;
      body = options.parserFails ? { message: "invoice_parser_unavailable" } : { ...invoice, ...options.preview, text: options.parserTexts?.[parseCount] ?? options.preview?.text ?? invoice.text };
      parseCount += 1;
    }
    if (path === "/invoices/import-document") { uploads.push(route.request().postData() ?? ""); body = { id: documentId }; }
    if (path === `/documents/${documentId}/delete`) { discards.push(path); body = { ok: true }; }
    if ((path.endsWith("/external-invoices") || path === "/external-invoices/company") && route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      status = options.saveFailsOnce && writes.length === 1 ? 503 : 201;
      body = { id: "00000000-0000-0000-0000-000000000401" };
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/invoices");
  await page.getByRole("button", { name: /Входящий счёт|Eingangsrechnung/ }).click();
  const dialog = page.getByRole("dialog", { name: /Проверка входящего инвойса|Eingangsrechnung prüfen/ });
  if (options.scope !== "company") {
    await dialog.getByRole("button", { name: /Расход по заказу|Auftragsbezogene Ausgabe/ }).click();
  }
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 850; canvas.height = 1100;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 850, 1100);
    ctx.fillStyle = "#152b42"; ctx.font = "bold 30px Arial";
    ctx.fillText("TESTKLINIK", 65, 95);
    ctx.font = "16px Arial"; ctx.fillText("Synthetischer Testbeleg · keine echte Rechnung", 65, 130);
    ctx.font = "bold 32px Arial"; ctx.fillText("RECHNUNG R-42", 65, 250);
    ctx.font = "20px Arial";
    ["Rechnungsdatum: 01.09.2026", "Fällig am: 15.09.2026", "", "Beispielleistung                         100,00 EUR", "", "Nettobetrag                                100,00 EUR", "Umsatzsteuer (19 %)                    19,00 EUR", "Gesamtbetrag                              119,00 EUR"].forEach((line, index) => ctx.fillText(line, 65, 325 + index * 52));
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await dialog.getByLabel(/Файл инвойса|Rechnungsdatei/).setInputFiles(options.pdf ?? (options.xml
    ? { name: "invoice.xml", mimeType: "text/xml", buffer: Buffer.from(options.xml) }
    : { name: "invoice.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }));
  return { dialog, uploads, writes, discards };
}

if (process.env.PARSER_CORPUS_DIR) {
  test.use({ trace: "off", video: "off", screenshot: "off" });
  test.describe("local invoice corpus", () => {
    const directory = process.env.PARSER_CORPUS_DIR!;
    const files: Record<string, string> = JSON.parse(fs.readFileSync(path.join(directory, "invoice-files.json"), "utf8"));
    for (const [key, file] of Object.entries(files)) {
      test(`${key}: every header and line item reaches review`, async ({ page }) => {
        const preview: InvoiceImportPreview = JSON.parse(fs.readFileSync(path.join(directory, `${key}.json`), "utf8"));
        const { dialog } = await prepare(page, { scope: "company", pdf: file, preview });
        for (const [label, field] of [
          [/Поставщик|Lieferant/, "supplier_name"], [/Номер инвойса|Rechnungsnummer/, "external_invoice_number"],
          [/Дата инвойса|Rechnungsdatum/, "invoice_date"], [/Оплатить до|Fällig am/, "due_date"],
          [/^Без НДС$|^Nettobetrag$/, "amount_net"], [/^НДС$|^Umsatzsteuer$/, "amount_vat"],
          [/^Итого$|^Bruttobetrag$/, "amount_gross"], [/Валюта|Währung/, "currency"],
        ] as const) await expect(dialog.getByLabel(label)).toHaveValue(preview.fields[field] ?? "");
        const positions = dialog.locator("div.rounded-xl").filter({ has: page.getByRole("heading", { name: /Позиции в документе|Positionen im Dokument/ }) }).last();
        for (const line of preview.line_items ?? []) {
          for (const field of ["name", "qty", "unit_price", "price_subtotal", "service_period", "vat_rate"]) {
            if (line[field] != null) await expect(positions).toContainText(String(line[field]));
          }
        }
      });
    }
  });
}

test("company supplier invoice saves without a patient or order", async ({ page }) => {
  const { dialog, uploads, writes } = await prepare(page, { scope: "company" });
  await expect(dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ })).toHaveCount(0);
  await expect(dialog.getByText(/Клиент и заказ не требуются|Patient und Auftrag sind nicht erforderlich/)).toHaveCount(0);
  await expect(dialog.getByLabel(/Поставщик \/ клиника|Lieferant \/ Klinik/)).toHaveValue("Testklinik");
  await dialog.getByRole("checkbox").check();
  const save = dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain("invoice_scope");
  expect(uploads[0]).toContain("company");
  expect(uploads[0]).not.toContain(patientA);
  expect(uploads[0]).not.toContain(orderA);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    supplier_name: "Testklinik",
    external_invoice_number: "R-42",
    amount_net: 100,
    amount_vat: 19,
    amount_gross: 119,
    currency: "EUR",
  });
  expect(writes[0]).not.toHaveProperty("patient_id");
});

test("replace discards an unfinished uploaded original and recognizes the new file immediately", async ({ page }) => {
  const { dialog, discards } = await prepare(page, { scope: "company", saveFailsOnce: true });
  await expect(dialog.getByLabel(/Номер инвойса|Rechnungsnummer/)).toHaveValue("R-42");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ }).click();
  await expect(dialog.getByText(/Не удалось сохранить счёт компании|Unternehmensrechnung konnte nicht gespeichert/)).toBeVisible();

  await dialog.getByLabel(/Файл инвойса|Rechnungsdatei/).setInputFiles({
    name: "replacement.png",
    mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/B8AAAAASUVORK5CYII=", "base64"),
  });
  await expect(dialog.getByText("replacement.png", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel(/Номер инвойса|Rechnungsnummer/)).toHaveValue("R-42");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  expect(discards).toEqual([`/documents/${documentId}/delete`]);
});

async function selectClient(page: Page, name: string, order: string) {
  const dialog = page.getByRole("dialog", { name: /Проверка входящего инвойса|Eingangsrechnung prüfen/ });
  await dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ }).click();
  await page.getByRole("option", { name: new RegExp(name) }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ }).click();
  await expect(page.getByRole("option", { name: order === "O-101" ? "O-102" : "O-101", exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: order, exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
}

async function prepareAccountingLedger(page: Page) {
  let originalRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "ledger-test-token");
    localStorage.setItem("gmed_refresh_token", "ledger-test-refresh");
  });
  await page.route("**/api/v1/**", async (route) => {
    const requestPath = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (requestPath === `/documents/${documentId}/download`) {
      originalRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/pdf",
        headers: { "content-disposition": 'inline; filename="supplier-original.pdf"' },
        body: "%PDF-1.4\n%%EOF",
      });
      return;
    }

    let body: unknown = [];
    if (requestPath === "/me") {
      body = { id: "00000000-0000-0000-0000-000000000001", email: "ledger@example.com", name: "Ledger tester", role: "billing", created_at: "2026-01-01T00:00:00Z" };
    } else if (requestPath === "/invoices/accounting-ledger") {
      body = {
        year: 2026,
        summary: { income_gross: "0", expense_gross: "119", net_surplus: "-119", service_revenue_gross: "0", cost_passthrough_revenue_gross: "0", provider_expense_gross: "119" },
        monthly: [{ period: "2026-09", income_gross: "0", expense_gross: "119", net_surplus: "-119" }],
        entries: [{
          id: "00000000-0000-0000-0000-000000000501",
          entry_date: "2026-09-01",
          direction: "expense",
          category: "provider_expense",
          description: "External invoice payment R-42",
          amount_net: "100",
          amount_vat: "19",
          amount_gross: "119",
          currency: "EUR",
          external_invoice_id: "00000000-0000-0000-0000-000000000401",
          external_invoice_number: "R-42",
          source_document_id: documentId,
          source_document_name: "supplier-original.pdf",
        }],
      };
    } else if (requestPath === "/invoices") {
      body = { items: [], total: 0, page: 1, per_page: 25, total_pages: 1 };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/invoices");
  return { originalRequestCount: () => originalRequests };
}

test("accounting ledger exposes and opens an imported invoice original", async ({ page }) => {
  const { originalRequestCount } = await prepareAccountingLedger(page);
  const invoiceNumberButton = page.getByRole("button", { name: "R-42", exact: true });
  const originalButton = page.getByRole("button", { name: /Original|Оригинал/ });
  await expect(invoiceNumberButton).toBeVisible();
  await expect(originalButton).toBeVisible();
  await expect(originalButton).toHaveAttribute("title", "supplier-original.pdf");

  const rowPopupPromise = page.waitForEvent("popup");
  await page.getByText("External invoice payment R-42", { exact: true }).first().click();
  const rowPopup = await rowPopupPromise;
  await expect.poll(originalRequestCount).toBe(1);
  await rowPopup.close();

  const popupPromise = page.waitForEvent("popup");
  await originalButton.click();
  const popup = await popupPromise;
  await expect.poll(originalRequestCount).toBe(2);
  await popup.close();

  const numberPopupPromise = page.waitForEvent("popup");
  await invoiceNumberButton.click();
  const numberPopup = await numberPopupPromise;
  await expect.poll(originalRequestCount).toBe(3);
  await numberPopup.close();
});

test("XML original is escaped, buyer fills client and prepaid amount does not replace total", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const xml = '<Invoice><Note>&lt;img src=x onerror=alert(1)&gt;</Note></Invoice>';
  const { dialog, uploads, writes } = await prepare(page, { xml, preview: {
    source_format: "xml", structured: { syntax: "ubl", profile: null, document_type: "380", validation: "basic_checks", import_allowed: true },
    recipient: { name: "Anna Alpha" }, payment: { amount_due: "99.00", prepaid: "20.00" }, warnings: ["payable_differs_from_total"],
  } });
  await expect(dialog.getByLabel(/Содержимое XML|XML-Inhalt/)).toHaveText(xml);
  await expect(dialog.locator("iframe, img")).toHaveCount(0);
  await expect(dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ })).toContainText("Alpha");
  await expect(dialog.getByText(/К оплате по XML|Zahlbetrag laut XML/)).toContainText("99.00");
  await expect(dialog.getByLabel(/^(Итого|Bruttobetrag)$/)).toHaveValue("119.00");
  await dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ }).click();
  await page.getByRole("option", { name: "O-101", exact: true }).click();
  await dialog.getByRole("checkbox").check();
  const downloadEvent = page.waitForEvent("download");
  await dialog.getByRole("link", { name: /Скачать оригинал|Original herunterladen/ }).click();
  expect((await downloadEvent).suggestedFilename()).toBe("invoice.xml");
  await dialog.screenshot({ path: "../artifacts/design-qa/invoice-xml-desktop.png" });
  await dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(uploads[0]).toContain("application/xml");
  expect(uploads[0]).toContain(xml);
  expect(writes[0]).toMatchObject({ amount_gross: 119, paid_by: "unpaid" });
});

test("unsupported XML remains preview only even after manual confirmation", async ({ page }) => {
  const { dialog, uploads, writes } = await prepare(page, { xml: "<CreditNote/>", preview: {
    source_format: "xml", structured: { syntax: "ubl", profile: null, document_type: "381", validation: "basic_checks", import_allowed: false },
  } });
  await expect(dialog.getByText(/Этот тип документа пока|Dieser Dokumenttyp/)).toBeVisible();
  await selectClient(page, "Alpha", "O-101");
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ })).toBeDisabled();
  expect(uploads).toHaveLength(0); expect(writes).toHaveLength(0);
});

test("unverified XML cannot be saved when parsing fails", async ({ page }) => {
  const { dialog, uploads } = await prepare(page, { xml: "<Invoice/>", parserFails: true });
  await expect(dialog.getByText(/Не удалось проверить XML|Rechnungs-XML konnte nicht geprüft/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ })).toBeDisabled();
  expect(uploads).toHaveLength(0);
});

test("hybrid invoice shows both conflicting values and keeps XML fields for review", async ({ page }) => {
  const { dialog } = await prepare(page, { preview: {
    source_format: "embedded_xml", structured: { syntax: "cii", profile: null, document_type: "380", validation: "basic_checks", import_allowed: true },
    source_differences: [{ field: "amount_gross", structured: "119.00", visible: "120.00" }], warnings: ["structured_pdf_mismatch"],
  } });
  await expect(dialog.getByText(/XML 119.00 · PDF 120.00/)).toBeVisible();
  await expect(dialog.getByLabel(/^(Итого|Bruttobetrag)$/)).toHaveValue("119.00");
});

test("review links corrected invoice and original to selected patient, retry reuses original", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const { dialog, uploads, writes } = await prepare(page, { saveFailsOnce: true });
  await expect(dialog.getByLabel(/Номер инвойса|Rechnungsnummer/)).toHaveValue("R-42");
  await expect(dialog.getByRole("img", { name: /Оригинал инвойса|Originalrechnung/ })).toBeVisible();
  const save = dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ });
  await expect(save).toBeDisabled();
  await selectClient(page, "Alpha", "O-101");
  await dialog.getByRole("checkbox").check();
  await selectClient(page, "Beta", "O-102");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByLabel(/Номер инвойса|Rechnungsnummer/).fill("R-42-checked");
  await dialog.getByLabel(/^(Итого|Bruttobetrag)$/).fill("120");
  await dialog.getByRole("checkbox").check();
  await expect(save).toBeDisabled();
  await dialog.getByLabel(/^(Итого|Bruttobetrag)$/).fill("119,00");
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await dialog.getByRole("checkbox").check();
  await dialog.screenshot({ path: "../artifacts/design-qa/invoice-import-desktop.png" });
  await save.click();
  await expect(dialog.getByText(/Оригинал уже сохранён|Das Original ist beim/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ })).toBeDisabled();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain(patientB);
  expect(uploads[0]).toContain(orderB);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toMatchObject({ patient_id: patientB, source_document_id: documentId, external_invoice_number: "R-42-checked", amount_gross: 119, amount_net: 100, amount_vat: 19, currency: "EUR", status: "received", paid_by: "unpaid" });
});

test("manual review stays available when parser is unavailable, including mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { dialog, writes } = await prepare(page, { parserFails: true });
  await expect(dialog.getByText(/Не удалось распознать счёт|Rechnung konnte nicht erkannt/)).toBeVisible();
  await selectClient(page, "Alpha", "O-101");
  for (const [label, value] of [
    [/Номер инвойса|Rechnungsnummer/, "MANUAL-1"],
    [/^Без НДС$|^Nettobetrag$/, "80"], [/^НДС$|^Umsatzsteuer$/, "0"], [/^Итого$|^Bruttobetrag$/, "80"], [/^Валюта$|^Währung$/, "EUR"],
  ] as const) await dialog.getByLabel(label).fill(value);
  // MUI date fields use editable sections; filling the hidden input bypasses them.
  await dialog.getByLabel(/Дата инвойса|Rechnungsdatum/).locator("..").getByRole("button").click();
  await page.getByRole("gridcell", { name: "1", exact: true }).click();
  await expect(dialog.getByLabel(/Дата инвойса|Rechnungsdatum/)).not.toHaveValue("");
  await dialog.getByRole("heading", { name: /Проверка входящего инвойса|Eingangsrechnung prüfen/ }).click();
  await dialog.getByRole("checkbox").check();
  await dialog.screenshot({ path: "../artifacts/design-qa/invoice-import-mobile.png" });
  await dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes[0]).toMatchObject({ patient_id: patientA, amount_net: 80, amount_vat: 0, amount_gross: 80 });
});

test("cancelled recognition cannot overwrite manual edits", async ({ page }) => {
  let finish!: () => void;
  const delayedParse = new Promise<void>((resolve) => { finish = resolve; });
  const { dialog } = await prepare(page, { delayedParse });
  await dialog.getByRole("button", { name: /Заполнить вручную|Manuell ausfüllen/ }).click();
  await dialog.getByLabel(/Номер инвойса|Rechnungsnummer/).fill("KEEP-MANUAL");
  finish();
  await expect(dialog.getByLabel(/Номер инвойса|Rechnungsnummer/)).toHaveValue("KEEP-MANUAL");
  await expect(dialog.getByRole("status")).toHaveCount(0);
});

test("parsed recipient fills client, manual changes survive another recognition", async ({ page }) => {
  const { dialog } = await prepare(page, { parserTexts: ["Rechnungsempfänger: Anna Alpha", "Patient-ID: PT-101"] });
  const client = dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ });
  await expect(client).toContainText("Alpha");
  await expect(dialog.getByText(/Клиент подставлен из документа|Patient aus dem Dokument zugeordnet/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ })).not.toContainText("O-101");
  await expect(dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ })).toBeDisabled();
  await selectClient(page, "Beta", "O-102");
  await dialog.getByRole("button", { name: /^(Распознать|Erkennen)$/ }).click();
  await expect(dialog.getByLabel(/Номер инвойса|Rechnungsnummer/)).toBeEnabled();
  await expect(client).toContainText("Beta");
  await expect(dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ })).toContainText("O-102");
});

test("ambiguous parsed recipients leave client selection manual", async ({ page }) => {
  const { dialog } = await prepare(page, { parserTexts: ["Patient: Anna Alpha\nPatient: Boris Beta"] });
  await expect(dialog.getByText(/Данные подходят нескольким клиентам|Die Angaben passen zu mehreren Patienten/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ })).toBeDisabled();
  await selectClient(page, "Beta", "O-102");
  await expect(dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ })).toContainText("Beta");
});

test("a client selected while OCR runs is not replaced by the parsed recipient", async ({ page }) => {
  let finish!: () => void;
  const delayedParse = new Promise<void>((resolve) => { finish = resolve; });
  const { dialog } = await prepare(page, { delayedParse, parserTexts: ["Patient: Anna Alpha"] });
  await selectClient(page, "Beta", "O-102");
  finish();
  await expect(dialog.getByLabel(/Номер инвойса|Rechnungsnummer/)).toHaveValue("R-42");
  await expect(dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ })).toContainText("Beta");
  await expect(dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ })).toContainText("O-102");
});

test("replacing an invoice clears the previous automatic patient and order", async ({ page }) => {
  const { dialog } = await prepare(page, { parserTexts: ["Patient-ID: PT-101", "Unknown recipient"] });
  const client = dialog.getByRole("combobox", { name: /^(Клиент|Patient)$/ });
  await expect(client).toContainText("Alpha");
  await dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ }).click();
  await page.getByRole("option", { name: "O-101", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await dialog.getByRole("checkbox").check();
  await dialog.getByLabel(/Файл инвойса|Rechnungsdatei/).setInputFiles({ name: "replacement.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/B8AAAAASUVORK5CYII=", "base64") });
  await expect(dialog.getByText(/Не удалось определить клиента по документу|Patient konnte nicht anhand des Dokuments/)).toBeVisible();
  await expect(client).not.toContainText("Alpha");
  await expect(dialog.getByRole("combobox", { name: /Заказ клиента|Auftrag des Patienten/ })).toBeDisabled();
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
});

test("explicit invoiced VAT and calculated due date show their sources without a false OCR failure", async ({ page }) => {
  const { dialog, writes } = await prepare(page, { preview: {
    fields: { ...invoice.fields, amount_net: "42.50", amount_vat: "0.00", amount_gross: "42.50", due_date: "2026-10-01" },
    warnings: ["generic_extraction_review_required", "tax_treatment_requires_review", "invoice_vat_explicitly_not_charged", "due_date_calculated_from_invoice_date"],
    field_sources: {
      amount_net: { method: "document_without_vat", text: "Der Rechnungsausweis erfolgt ohne Umsatzsteuer." },
      amount_vat: { method: "document_without_vat", text: "Der Rechnungsausweis erfolgt ohne Umsatzsteuer." },
      due_date: { method: "invoice_date_plus_days", days: 30, text: "Zahlbar innert 30 Tagen" },
    },
    payment: { terms: ["Zahlbar innert 30 Tagen"] },
    line_items: [{ name: "Software-Lizenz", qty: "5", unit_price: "8.50", price_subtotal: "42.50", page: 1 }],
  } });
  await expect(dialog.getByText(/Распознавание завершено|Erkennung abgeschlossen/)).toBeVisible();
  await expect(dialog.getByText(/Часть данных не распознана|Einige Angaben wurden nicht sicher/)).toHaveCount(0);
  await expect(dialog.getByText(/Заполните поля:|Bitte ergänzen:/)).toHaveCount(0);
  await expect(dialog.getByLabel(/^(НДС|Umsatzsteuer)$/)).toHaveValue("0.00");
  await expect(dialog.getByText(/в самом счёте НДС не начислен|Rechnung weist keine Umsatzsteuer aus/)).toBeVisible();
  await expect(dialog.getByText(/\+30 (дней|Tage)/)).toBeVisible();
  await expect(dialog.getByText("Software-Lizenz", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/5 · (Цена|Preis): 8.50 EUR/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Подтвердить и сохранить|Bestätigen und speichern/ })).toBeDisabled();
  await dialog.getByLabel(/^(НДС|Umsatzsteuer)$/).fill("1.00");
  await expect(dialog.getByText(/По фразе в счёте|Laut Rechnung: ohne Umsatzsteuer/)).toHaveCount(1);
  expect(writes).toHaveLength(0);
});

test("missing amounts are named and collection date is distinct from payment deadline", async ({ page }) => {
  const { dialog } = await prepare(page, { preview: {
    fields: { ...invoice.fields, amount_net: null, amount_vat: null, due_date: null },
    warnings: ["generic_extraction_review_required"],
    payment: { method: "direct_debit", collection_date: "2026-09-29" },
  } });
  await expect(dialog.getByText(/Заполните поля: Без НДС, НДС|Bitte ergänzen: Nettobetrag, Umsatzsteuer/).first()).toBeVisible();
  await expect(dialog.getByText(/Автоматическое списание · 29.09.2026|Lastschrift · 29.09.2026/)).toBeVisible();
  await expect(dialog.getByLabel(/Оплатить до|Fällig am/)).toHaveValue("");
  await dialog.getByLabel(/^(Без НДС|Nettobetrag)$/).fill("100");
  await dialog.getByLabel(/^(НДС|Umsatzsteuer)$/).fill("19");
  await expect(dialog.getByText(/Заполните поля:|Bitte ergänzen:/)).toHaveCount(0);
});
