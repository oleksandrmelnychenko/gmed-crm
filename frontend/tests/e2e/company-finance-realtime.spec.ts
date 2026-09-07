import { expect, test, type Download, type Page, type WebSocketRoute } from "@playwright/test";
import { readFile } from "node:fs/promises";
import type { CompanyFinancialAccount, CompanyFinancialPosition, CompanyProviderLiability, CompanyProviderPosition } from "../../src/pages/company-finance/types";

async function mockFinance(page: Page, connected = true) {
  const state = { receivable: "100.00", cash: "500.00", remaining: "100.00", positionReads: 0, accountReads: 0, queueReads: 0, settlementReads: 0, statementReads: 0, fail: false };
  let providerTables: { positions: CompanyProviderPosition[]; liabilities: CompanyProviderLiability[] } | null = null;
  const sockets: WebSocketRoute[] = [];
  let seq = 0;
  let held: { started: () => void; wait: Promise<void> } | null = null;
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "finance-test-token");
    localStorage.setItem("gmed_refresh_token", "finance-test-refresh");
    localStorage.setItem("gmed_lang", "de");
  });
  if (connected) {
    await page.routeWebSocket("**/api/v1/events/ws*", (socket) => {
      sockets.push(socket);
      socket.send(JSON.stringify({ type: "realtime.connected", entity_type: "realtime", entity_id: "tester" }));
    });
  } else {
    await page.addInitScript(() => {
      class PendingSocket extends EventTarget { close() {} send() {} }
      Object.defineProperty(window, "WebSocket", { value: PendingSocket });
    });
  }
  const provider = (): CompanyProviderPosition => ({
    provider_id: "provider-1", provider_name: "Clinic Realtime", invoice_total_gross: "100.00",
    company_paid_gross: String(100 - Number(state.remaining)), payable_remaining_gross: state.remaining,
    expected_remaining_gross: "0.00", invoice_count: 1, open_invoice_count: 1, partial_invoice_count: 0,
    settled_invoice_count: 0, latest_payment_on: null,
  });
  const liability = (): CompanyProviderLiability => ({
    id: "liability-1", external_invoice_number: "LIVE-INVOICE-1", invoice_date: "2026-09-01", due_date: "2026-09-20",
    status: "approved", paid_by: "unpaid", liability_kind: "payable", amount_gross: "100.00",
    company_paid_gross: String(100 - Number(state.remaining)), remaining_gross: state.remaining,
    settlement_status: "unpaid", latest_payment_on: null, payment_count: 0,
    order_id: null, order_number: null, patient_id: null, patient_pid: null, patient_name: "",
    provider_id: "provider-1", provider_name: "Clinic Realtime",
  });
  const account = (): CompanyFinancialAccount => ({
    id: "account-1", name: "Realtime Bank", account_type: "bank", currency: "EUR", iban: null,
    opening_balance: "500.00", opening_balance_on: "2026-01-01", movement_balance: "0.00", adjustment_balance: "0.00",
    transfer_balance: "0.00", current_balance: state.cash, movement_count: 0, transfer_count: 0, latest_movement_on: null,
    is_default: true, is_active: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-05T00:00:00Z",
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/auth/refresh") body = { access_token: "finance-test-token", refresh_token: "finance-test-refresh" };
    if (path === "/me") body = { id: "tester", name: "Finance Tester", email: "finance@example.com", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    if (path === "/company-financial-position") {
      state.positionReads += 1;
      body = {
        currency: "EUR", available_currencies: ["EUR"], as_of: "2026-09-05", generated_at: new Date().toISOString(),
        period: { from: url.searchParams.get("from")!, to: url.searchParams.get("to")! },
        summary: { patient_receivables_calculated: state.receivable, patient_credits: "0.00", provider_payables: state.remaining,
          expected_provider_costs: "0.00", unreconciled_external_receivables: "0.00", reconciliation_required: false,
          reconciliation_patient_count: 0, calculated_net_position: state.receivable, confirmed_net_position: state.receivable,
          cash_inflow: "0.00", cash_outflow: "0.00", net_cash_flow: "0.00" },
        patient_positions: [{ patient_id: "patient-1", patient_pid: "P-001", patient_name: "Alice Balance", is_active: true,
          invoice_due: state.receivable, external_receivable: "0.00", manual_balance: "0.00", available_prepayment: "0.00",
          calculated_balance: state.receivable, balance_side: "debit", reconciliation_required: false }],
        provider_positions: providerTables?.positions ?? [provider()], provider_liabilities: providerTables?.liabilities ?? [liability()], cash_movements: [], cash_movement_count: 0,
        cash_movements_truncated: false,
      } satisfies CompanyFinancialPosition;
      if (held) { const pending = held; held = null; pending.started(); await pending.wait; }
      if (state.fail) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Finance temporarily unavailable" }) });
    }
    if (path === "/company-financial-accounts") {
      state.accountReads += 1;
      body = { currency: "EUR", available_currencies: ["EUR"], items: [account()], adjustments: [], transfers: [],
        unassigned_movement_count: 0, unassigned_signed_amount: "0.00", generated_at: new Date().toISOString() };
    }
    if (path === "/concierge-expenses") {
      state.queueReads += 1;
      body = { items: [], page: 1, page_size: 100, total: 0, has_more: false };
    }
    if (path === "/company-provider-liabilities/liability-1/settlements") {
      state.settlementReads += 1;
      body = { ...liability(), external_invoice_id: "liability-1", currency: "EUR", remaining_provider_liability_gross: state.remaining, transactions: [] };
    }
    if (path === "/company-provider-statements/provider-1") {
      state.statementReads += 1;
      body = { provider_id: "provider-1", provider_name: "Clinic Realtime", currency: "EUR",
        period: { from: "2026-01-01", to: "2026-09-05" }, generated_at: new Date().toISOString(), movements: [],
        summary: { opening_balance: "0.00", charged_gross: "100.00", paid_gross: "0.00", reversed_gross: "0.00", expected_gross: "0.00", closing_balance: state.remaining } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return {
    state,
    provider,
    liability,
    setProviderTables(positions: CompanyProviderPosition[], liabilities: CompanyProviderLiability[]) { providerTables = { positions, liabilities }; },
    emit(type = "invoice.payment_recorded") { sockets.forEach((socket) => socket.send(JSON.stringify({ seq: ++seq, type, entity_type: "invoice", entity_id: "liability-1" }))); },
    holdNextPosition() {
      let started!: () => void;
      let release!: () => void;
      const ready = new Promise<void>((resolve) => { started = resolve; });
      const wait = new Promise<void>((resolve) => { release = resolve; });
      held = { started, wait };
      return { ready, release };
    },
  };
}

test("named suppliers without registry links stay separate and preserve paid filters on drilldown", async ({ page }) => {
  const api = await mockFinance(page);
  await page.addInitScript(() => localStorage.setItem("gmed_lang", "ru"));
  const telekom = { ...api.provider(), provider_id: null, provider_name: "Telekom Deutschland GmbH", invoice_count: 2, settled_invoice_count: 1, invoice_total_gross: "140.00", company_paid_gross: "40.00" };
  const stadtwerke = { ...api.provider(), provider_id: null, provider_name: "Stadtwerke" };
  const unknown = { ...api.provider(), provider_id: null, provider_name: null };
  api.setProviderTables([telekom, stadtwerke, unknown], [
    { ...api.liability(), id: "telekom-open", external_invoice_number: "TELEKOM-OPEN", provider_id: null, provider_name: telekom.provider_name },
    { ...api.liability(), id: "telekom-paid", external_invoice_number: "TELEKOM-PAID", provider_id: null, provider_name: telekom.provider_name, liability_kind: "settled", settlement_status: "paid", remaining_gross: "0.00", amount_gross: "40.00", company_paid_gross: "40.00" },
    { ...api.liability(), id: "stadtwerke", external_invoice_number: "STADTWERKE-1", provider_id: null, provider_name: stadtwerke.provider_name },
    { ...api.liability(), id: "unknown", external_invoice_number: "UNKNOWN-1", provider_id: null, provider_name: null },
  ]);
  await page.goto("/company-finance?tab=providers");
  const table = page.locator('[role="table"]:visible');
  await expect(table.getByText(telekom.provider_name, { exact: true })).toBeVisible();
  await expect(table.getByText(stadtwerke.provider_name, { exact: true })).toBeVisible();
  await expect(table.getByText("Поставщик не указан", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Оплачено", exact: true }).click();
  await expect(table.locator('[role="cell"][data-column-id="provider"]')).toHaveCount(1);
  await table.getByText(telekom.provider_name, { exact: true }).click();
  await expect(table.getByText("TELEKOM-PAID", { exact: true })).toBeVisible();
  await expect(table.getByText("TELEKOM-OPEN", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Поставщик не указан", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await expect(table.locator('[role="cell"][data-column-id="document"]')).toHaveCount(2);
  await expect(table.getByText("STADTWERKE-1", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "По поставщикам", exact: true }).click();
  const search = page.getByRole("searchbox");
  await search.fill("STADTWERKE");
  await expect(table.locator('[role="cell"][data-column-id="provider"]')).toHaveCount(1);
  await table.getByText(stadtwerke.provider_name, { exact: true }).click();
  await expect(table.getByText("STADTWERKE-1", { exact: true })).toBeVisible();
  await expect(table.locator('[role="cell"][data-column-id="document"]')).toHaveCount(1);
  await search.fill("");
  await expect(table.locator('[role="cell"][data-column-id="document"]')).toHaveCount(1);
  await page.getByRole("button", { name: "По поставщикам", exact: true }).click();
  await search.fill("TELEKOM-PAID");
  await expect(table.locator('[role="cell"][data-column-id="provider"]')).toHaveCount(1);
  await table.getByText(telekom.provider_name, { exact: true }).click();
  await expect(table.getByText("TELEKOM-PAID", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../artifacts/design-qa/provider-names-and-filters.png" });
});

test("patient search combines with balance filters and zero advances have no minus sign", async ({ page }) => {
  await mockFinance(page);
  await page.goto("/company-finance");
  const table = page.locator('[role="table"]:visible');
  const advances = table.locator('[role="cell"][data-column-id="prepayment"]');
  await expect(advances).toContainText("0,00");
  await expect(advances).not.toContainText("−");
  await page.getByRole("searchbox").fill("Alice");
  await expect(table.getByText("Alice Balance", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guthaben", exact: true }).click();
  await expect(table.locator('[role="cell"][data-column-id="patient"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Alle", exact: true }).click();
  await expect(table.getByText("Alice Balance", { exact: true })).toBeVisible();
  await page.getByRole("searchbox").fill("does not exist");
  await expect(table.locator('[role="cell"][data-column-id="patient"]')).toHaveCount(0);
  await page.getByRole("searchbox").fill("P-001");
  await expect(table.getByText("Alice Balance", { exact: true })).toBeVisible();
});

function summary(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..").locator("p").last();
}

test("financial events update balances without a refresh button and coalesce during a slow request", async ({ page }) => {
  const api = await mockFinance(page);
  await page.goto("/company-finance");
  await expect(summary(page, "Patientenforderungen")).toContainText("100,00");
  await expect.poll(() => api.state.positionReads).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("button", { name: "Aktualisieren", exact: true })).toHaveCount(0);
  api.state.receivable = "145.00";
  api.state.cash = "545.00";
  api.emit();
  await expect(summary(page, "Patientenforderungen")).toContainText("145,00");
  await expect(summary(page, "Tatsächlicher Kontostand")).toContainText("545,00");
  const gate = api.holdNextPosition();
  api.state.receivable = "200.00";
  api.emit();
  await gate.ready;
  const reads = api.state.positionReads;
  api.state.receivable = "250.00";
  api.emit("provider_payment.recorded");
  api.emit("company_financial_account.updated");
  // Let the event debounce expire while the response is held.
  await page.waitForTimeout(300);
  expect(api.state.positionReads).toBe(reads);
  await expect(summary(page, "Patientenforderungen")).toContainText("145,00");
  gate.release();
  await expect(summary(page, "Patientenforderungen")).toContainText("250,00");
  expect(api.state.positionReads).toBe(reads + 1);
  await page.screenshot({ path: "../artifacts/design-qa/company-finance-live-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 393, height: 852 });
  await expect(page.getByRole("button", { name: "Aktualisieren", exact: true })).toHaveCount(0);
  await page.screenshot({ path: "../artifacts/design-qa/company-finance-live-mobile.png", fullPage: true });
});

test("lost realtime connections recover automatically, pause in hidden tabs, and retry errors", async ({ page }) => {
  await page.clock.install();
  const api = await mockFinance(page, false);
  await page.goto("/company-finance");
  await expect(summary(page, "Patientenforderungen")).toContainText("100,00");
  await expect.poll(() => api.state.positionReads).toBeGreaterThanOrEqual(2);
  api.state.receivable = "175.00";
  await page.clock.fastForward(6_000);
  await expect(summary(page, "Patientenforderungen")).toContainText("175,00");
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  const reads = api.state.positionReads;
  api.state.receivable = "190.00";
  await page.clock.fastForward(30_000);
  expect(api.state.positionReads).toBe(reads);
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect(summary(page, "Patientenforderungen")).toContainText("190,00");
  api.state.fail = true;
  await page.clock.fastForward(6_000);
  await expect(page.getByText("Finance temporarily unavailable")).toBeVisible();
  await expect(summary(page, "Patientenforderungen")).toContainText("190,00");
  api.state.fail = false;
  api.state.receivable = "220.00";
  await page.clock.fastForward(6_000);
  await expect(summary(page, "Patientenforderungen")).toContainText("220,00");
  await expect(page.getByText("Finance temporarily unavailable")).toHaveCount(0);
});

test("provider settlements update without resetting a payment draft", async ({ page }) => {
  const api = await mockFinance(page);
  await page.goto("/company-finance?provider_invoice=liability-1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Zahlungsbetrag", { exact: true })).toHaveValue("100.00");
  await dialog.getByLabel("Zahlungsbetrag", { exact: true }).fill("23.45");
  await dialog.getByLabel("Interne Notiz", { exact: true }).fill("Keep this payment draft");
  const reads = api.state.settlementReads;
  api.state.remaining = "75.00";
  api.state.cash = "475.00";
  api.emit("provider_payment.recorded");
  await expect.poll(() => api.state.settlementReads).toBeGreaterThan(reads);
  await expect(dialog.getByText(/75,00/).first()).toBeVisible();
  await expect(summary(page, "Tatsächlicher Kontostand")).toContainText("475,00");
  await expect(dialog.getByLabel("Zahlungsbetrag", { exact: true })).toHaveValue("23.45");
  await expect(dialog.getByLabel("Interne Notiz", { exact: true })).toHaveValue("Keep this payment draft");
});

test("an open provider statement receives financial updates", async ({ page }) => {
  const api = await mockFinance(page);
  await page.goto("/company-finance?provider=provider-1&statement=1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/100,00/).first()).toBeVisible();
  const reads = api.state.statementReads;
  api.state.remaining = "55.00";
  api.emit("provider_payment.recorded");
  await expect.poll(() => api.state.statementReads).toBeGreaterThan(reads);
  await expect(dialog.getByText(/55,00/)).toBeVisible();
});

test("the concierge expense tab updates automatically and has no refresh button", async ({ page }) => {
  const api = await mockFinance(page);
  await page.goto("/company-finance?tab=concierge-expenses");
  await expect.poll(() => api.state.queueReads).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Aktualisieren", exact: true })).toHaveCount(0);
  const reads = api.state.queueReads;
  api.emit("concierge_expense.posted");
  await expect.poll(() => api.state.queueReads).toBeGreaterThan(reads);
});

function waitForOriginalDocument(page: Page, original: Buffer) {
  return page.waitForEvent("popup").then(async popup => {
    // Headless shell downloads PDFs; full Chromium opens its built-in viewer.
    const download = new Promise<Download>(resolve => popup.once("download", resolve));
    const navigation = popup.waitForURL(/^blob:/, { waitUntil: "commit" }).then(() => null).catch(() => download);
    const file = await Promise.race([download, navigation]);
    if (file) expect(await readFile((await file.path())!)).toEqual(original);
    expect(await popup.evaluate(() => window.opener === null)).toBe(true);
    return popup;
  });
}

for (const lang of ["ru", "de"] as const) {
  test(`supplier invoice originals open from the document cell in ${lang}`, async ({ page }) => {
    const api = await mockFinance(page);
    await page.addInitScript(value => localStorage.setItem("gmed_lang", value), lang);
    api.setProviderTables([api.provider()], [
      { ...api.liability(), source_document_id: "source-document-1", source_document_name: "original.pdf" },
      { ...api.liability(), id: "no-source", external_invoice_number: "NO-SOURCE", source_document_id: null },
    ]);
    const original = await readFile(new URL("../../public/demo/datev/demo-datev-001.pdf", import.meta.url));
    const requests: string[] = [];
    await page.route("**/api/v1/documents/source-document-1/download", async route => {
      expect(route.request().headers().authorization).toBe("Bearer finance-test-token");
      requests.push(route.request().url());
      await route.fulfill({ contentType: "application/pdf", body: original });
    });
    await page.goto("/company-finance?tab=providers");
    await page.getByRole("button", { name: lang === "ru" ? "Документы" : "Belege", exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const surface = width === 390 ? page.getByRole("list") : page.locator('[role="table"]:visible');
      const link = surface.getByRole("button", { name: `${lang === "ru" ? "Открыть оригинал документа" : "Originaldokument öffnen"}: LIVE-INVOICE-1`, exact: true });
      const preview = surface.getByRole("button", { name: `${lang === "ru" ? "Просмотр документа" : "Dokument ansehen"}: LIVE-INVOICE-1`, exact: true });
      await expect(preview).toBeVisible();
      const popupPromise = waitForOriginalDocument(page, original);
      if (width === 390) await preview.click();
      else { await link.focus(); await page.keyboard.press("Enter"); }
      const popup = await popupPromise;
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await popup.close();
      await expect(link).toBeEnabled();
      await expect(surface.getByText("NO-SOURCE", { exact: true })).toBeVisible();
      await expect(surface.getByRole("button", { name: /NO-SOURCE/ })).toHaveCount(0);
      await link.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../artifacts/design-qa/provider-original-${lang}-${width}.png` });
    }
    expect(requests).toHaveLength(2);
    expect(requests.every(url => new URL(url).search === "")).toBe(true);
    expect(api.state.settlementReads).toBe(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('[role="table"]:visible [role="cell"][data-column-id="amount"]').first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test(`provider document status and amounts remain readable in ${lang}`, async ({ page }) => {
    await mockFinance(page);
    await page.addInitScript(value => localStorage.setItem("gmed_lang", value), lang);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/company-finance?tab=providers");
    const table = page.locator('[role="table"]:visible');
    // Switching from the summary must not retain its pinned provider column
    // or sorting; these views have different columns and default sort orders.
    await expect(table.locator('[role="columnheader"][data-column-id="provider"]')).toHaveAttribute("data-pinned", "left");
    await page.getByRole("button", { name: lang === "ru" ? "Документы" : "Belege", exact: true }).click();
    await expect(table.locator('[role="columnheader"][data-column-id="document"]')).toHaveAttribute("data-pinned", "left");
    await expect(table.locator('[role="columnheader"][data-column-id="due_date"]')).toHaveAttribute("aria-sort", "ascending");
    const documentCell = table.locator('[role="cell"][data-column-id="document"]');
    await expect(documentCell).toContainText("LIVE-INVOICE-1");
    await expect(documentCell.locator('[data-slot="badge"]')).toHaveCount(0);
    const statusCell = table.locator('[role="cell"][data-column-id="status"]');
    await expect(table.locator('[role="columnheader"][data-column-id="status"]')).toContainText(lang === "ru" ? "Статус" : "Status");
    const badge = statusCell.locator('[data-slot="badge"]');
    await expect(badge).toBeVisible();
    const cellBounds = await statusCell.boundingBox();
    const badgeBounds = await badge.boundingBox();
    expect(badgeBounds!.y).toBeGreaterThanOrEqual(cellBounds!.y);
    expect(badgeBounds!.y + badgeBounds!.height).toBeLessThanOrEqual(cellBounds!.y + cellBounds!.height);
    const tableBounds = await table.boundingBox();
    for (const column of ["amount", "company_paid", "remaining"]) {
      const bounds = await table.locator(`[role="cell"][data-column-id="${column}"]`).boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(tableBounds!.x + tableBounds!.width);
    }
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-qa/provider-documents-${lang}-desktop.png` });
    // Trailing context and the payment action remain reachable by scrolling.
    await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await table.locator('[role="cell"][data-column-id="settlement"] button').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
    await page.getByRole("listitem").scrollIntoViewIfNeeded();
    await expect(page.getByRole("listitem").getByText("LIVE-INVOICE-1", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").getByText(lang === "ru" ? "Статус" : "Status", { exact: true })).toBeVisible();
    await expect(page.getByRole("listitem").getByText(lang === "ru" ? "Осталось выплатить" : "Noch zu zahlen", { exact: true })).toBeVisible();
    await page.screenshot({ path: `../artifacts/design-qa/provider-documents-${lang}-mobile.png`, fullPage: true });
  });
}

test("unavailable invoice originals close the empty tab and can be retried", async ({ page }) => {
  const api = await mockFinance(page);
  api.setProviderTables([api.provider()], [{ ...api.liability(), source_document_id: "source-document-1" }]);
  const original = await readFile(new URL("../../public/demo/datev/demo-datev-001.pdf", import.meta.url));
  let fail = true;
  await page.route("**/api/v1/documents/source-document-1/download", route => route.fulfill(fail
    ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }
    : { contentType: "application/pdf", body: original }));
  await page.goto("/company-finance?tab=providers");
  await page.getByRole("button", { name: "Belege", exact: true }).click();
  const link = page.locator('[role="table"]:visible').getByRole("button", { name: "Originaldokument öffnen: LIVE-INVOICE-1", exact: true });
  const failedPopupPromise = page.waitForEvent("popup");
  await link.click();
  const failedPopup = await failedPopupPromise;
  await expect.poll(() => failedPopup.isClosed()).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Das Originaldokument konnte nicht geöffnet werden");
  await expect(link).toBeEnabled();
  fail = false;
  const popupPromise = waitForOriginalDocument(page, original);
  await link.click();
  const popup = await popupPromise;
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await popup.close();
});

test("a blocked document tab shows guidance without downloading the file", async ({ page }) => {
  const api = await mockFinance(page);
  api.setProviderTables([api.provider()], [{ ...api.liability(), source_document_id: "source-document-1" }]);
  let downloads = 0;
  await page.route("**/api/v1/documents/*/download", async route => { downloads += 1; await route.abort(); });
  await page.goto("/company-finance?tab=providers");
  await page.getByRole("button", { name: "Belege", exact: true }).click();
  await page.evaluate(() => { window.open = () => null; });
  await page.locator('[role="table"]:visible').getByRole("button", { name: "Originaldokument öffnen: LIVE-INVOICE-1", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Bitte das Öffnen eines neuen Tabs erlauben");
  expect(downloads).toBe(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
