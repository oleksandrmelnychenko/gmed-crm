import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { CompanyFinancialAccount, CompanyFinancialPosition, CompanyProviderLiability, CompanyProviderPosition } from "../../src/pages/company-finance/types";

async function mockFinance(page: Page, connected = true) {
  const state = { receivable: "100.00", cash: "500.00", remaining: "100.00", positionReads: 0, accountReads: 0, queueReads: 0, settlementReads: 0, statementReads: 0, fail: false };
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
        provider_positions: [provider()], provider_liabilities: [liability()], cash_movements: [], cash_movement_count: 0,
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
