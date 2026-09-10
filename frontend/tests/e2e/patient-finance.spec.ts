import { expect, test, type Page } from "@playwright/test";


const patientId = "00000000-0000-0000-0000-000000000301";
const financeUrl = `/patients/${patientId}?tab=finance`;
type Entry = { id: string; kind: string; date: string; debit: number; credit: number; currency: string };

async function prepare(page: Page, lang = "ru", role = "ceo") {
  const entries: Entry[] = [
    { id: "opening", kind: "balance_adjustment", date: "2025-12-01", debit: 100, credit: 0, currency: "EUR" },
    { id: "invoice", kind: "invoice", date: "2026-07-15", debit: 1000, credit: 0, currency: "EUR" },
    { id: "payment", kind: "payment", date: "2026-08-10", debit: 0, credit: 400, currency: "EUR" },
    { id: "note", kind: "credit_note", date: "2026-09-01", debit: 0, credit: 100, currency: "EUR" },
    { id: "refund", kind: "refund", date: "2026-09-02", debit: 50, credit: 0, currency: "EUR" },
    { id: "usd", kind: "payment", date: "2026-09-01", debit: 0, credit: 25, currency: "USD" },
  ];
  const requests: string[] = [];
  const errors: string[] = [];
  const state = { fail: false, provisional: false, holdFrom: "" };
  let release: (() => void) | undefined;
  let wait: Promise<void> | undefined;
  await page.clock.setFixedTime(new Date("2026-09-10T12:00:00Z"));
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_access_token", "patient-finance-test");
    localStorage.setItem("gmed_refresh_token", "patient-finance-refresh");
    localStorage.setItem("gmed_lang", lang);
  }, { lang });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: "qa", name: "Finance QA", email: "qa@example.org", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/auth/refresh") body = { access_token: "patient-finance-test", refresh_token: "patient-finance-refresh", expires_in: 900 };
    if (path === `/patients/${patientId}`) body = { id: patientId, patient_id: "P-TEST-0301", first_name: "Alex", last_name: "Beispiel", is_active: true, birth_date: "1980-01-10", gender: "male", languages: ["de"], functional_labels: [], contacts: [], created_at: "2026-01-01T00:00:00Z" };
    if (path.includes("taxonomy")) body = { nodes: [] };
    if (path.includes("workflow-checklist")) body = { items: [], open_count: 0, completed_count: 0 };
    if (path === "/stats/overview") body = {};
    if (path.endsWith("/balance-adjustments")) body = { items: [] };
    if (path.endsWith("/financial-ledger")) body = { patient_id: patientId, margin_visible: true, entries: [] };
    if (path.endsWith("/financial-summary")) body = { patient_id: patientId, currency: "EUR", revenue_net: "0", revenue_vat: "0", revenue_gross: "0", paid_amount: "0", open_balance: "0", overdue_amount: "0", expenses_net: "0", expenses_vat: "0", expenses_gross: "0", margin_net: "0", margin_percent: null, margin_visible: true, breakdown_by_order: [], breakdown_by_service_type: [], issues: [] };
    if (path.endsWith("/account-statement")) {
      requests.push(url.search);
      const currency = url.searchParams.get("currency") || "EUR";
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "2026-09-10";
      const scoped = entries.filter(entry => entry.currency === currency && entry.date <= to).sort((a, b) => a.date.localeCompare(b.date));
      const opening = scoped.filter(entry => entry.date < from).reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
      let balance = opening;
      const movements = scoped.filter(entry => entry.date >= from).map(entry => {
        balance += entry.debit - entry.credit;
        return { id: entry.id, kind: entry.kind, entry_date: entry.date, occurred_at: `${entry.date}T12:00:00Z`, direction: entry.debit ? "debit" : "credit", description: "", document_number: `DOC-${entry.id}`, order_number: "A-TEST-1", debit: entry.debit.toFixed(2), credit: entry.credit.toFixed(2), balance_after: balance.toFixed(2), currency };
      });
      body = { patient_id: patientId, currency, available_currencies: ["EUR", "USD"], scope: "staff", amounts_complete: true,
        summary: { opening_balance: opening.toFixed(2), calculated_balance: balance.toFixed(2), closing_balance: state.provisional ? null : balance.toFixed(2), reconciliation_required: state.provisional, invoice_due: "650", total_due: "650", external_receivable: "0", available_prepayment: "0", balance_side: balance > 0 ? "debit" : balance < 0 ? "credit" : "settled", invoiced_gross: "1000", cash_paid: "400", prepayment_applied: "0", debit_total: "1050", credit_total: "500", unreconciled_external_debit: "0" },
        redaction: { hidden_invoice_amount_count: 0, external_expense_count: 0, services_hidden: false }, items: [], movements };
      if (from && state.holdFrom === from && wait) await wait;
      if (state.fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    }
    await route.fulfill({ json: body });
  });
  return { entries, requests, errors, state, hold(from: string) { state.holdFrom = from; wait = new Promise<void>(resolve => { release = resolve; }); return () => { state.holdFrom = ""; release?.(); }; } };
}

test("patient finance carries earlier balances, drills into months and links to invoices", async ({ page }) => {
  const api = await prepare(page);
  await page.goto(financeUrl);
  await expect(page.getByTestId("finance-opening")).toContainText("100,00");
  await expect(page.getByTestId("finance-invoices")).toContainText("900,00");
  await expect(page.getByTestId("finance-payments")).toContainText("400,00");
  await expect(page.getByTestId("finance-refunds")).toContainText("50,00");
  await expect(page.getByTestId("finance-closing")).toContainText("650,00");
  await expect(page.getByTestId("finance-closing").locator("p").nth(1)).toHaveClass(/text-rose-600/);
  await page.getByRole("button", { name: "август 2026 г.", exact: true }).click();
  await expect(page.getByTestId("patient-finance").getByText("DOC-payment", { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByTestId("patient-finance").getByText("DOC-invoice", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Все месяцы", exact: true }).click();
  await expect(page.getByTestId("patient-finance").getByText("DOC-invoice", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole("button", { name: "Этот месяц", exact: true }).click();
  await expect(page.getByTestId("finance-opening")).toContainText("700,00");
  await expect(page.getByTestId("finance-payments")).toContainText("0,00");
  expect(api.requests.some(query => query.includes("from=2026-09-01"))).toBe(true);
  await page.getByRole("button", { name: "Открыть счета", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`patients/${patientId}\\?tab=invoices`));
  expect(api.errors).toEqual([]);
});

test("currency, invalid periods and slow old requests never show mismatched balances", async ({ page }) => {
  const api = await prepare(page);
  await page.goto(financeUrl);
  await expect(page.getByTestId("finance-closing")).toContainText("650,00");
  await page.getByRole("combobox", { name: "Валюта", exact: true }).click();
  await page.getByRole("option", { name: "USD", exact: true }).click();
  await expect(page.getByTestId("finance-closing")).toContainText("25,00");
  await expect(page.getByTestId("finance-closing")).toContainText("Переплата");
  await expect(page.getByTestId("finance-closing")).toContainText("$");
  await page.getByRole("spinbutton", { name: "Month", exact: true }).first().fill("10");
  await expect(page.getByTestId("finance-closing")).toHaveCount(0);
  await expect(page.getByText(/начало периода не должно быть позже/)).toBeVisible();
  const release = api.hold("2026-08-01");
  try {
    await page.getByRole("button", { name: "Прошлый месяц", exact: true }).click();
    await expect.poll(() => api.requests.some(query => query.includes("from=2026-08-01"))).toBe(true);
    await page.getByRole("button", { name: "Этот месяц", exact: true }).click();
    await expect(page.getByTestId("finance-closing")).toContainText("25,00");
  } finally { release(); }
  await expect(page.getByTestId("finance-closing")).toContainText("25,00");
  expect(api.errors).toEqual([]);
});

test("refreshes payments after a financial event and recovers from a visible loading error", async ({ page }) => {
  const api = await prepare(page);
  api.state.fail = true;
  await page.goto(financeUrl);
  await expect(page.getByText("Не удалось загрузить финансы пациента.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("finance-closing")).toHaveCount(0);
  api.state.fail = false;
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(page.getByTestId("finance-closing")).toContainText("650,00");
  api.entries.push({ id: "new-payment", kind: "payment", date: "2026-09-10", debit: 0, credit: 200, currency: "EUR" });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("gmed:realtime-event", { detail: { type: "invoice.payment_recorded", entity_type: "invoice", entity_id: "invoice", payload: {} } })));
  await expect(page.getByTestId("finance-payments")).toContainText("600,00");
  await expect(page.getByTestId("finance-closing")).toContainText("450,00");
  await expect(page.getByRole("button", { name: /Баланс: 450,00.*Долг/ })).toBeVisible();
  expect(api.errors).toEqual([]);
});

test("a provisional balance is clearly marked", async ({ page }) => {
  const api = await prepare(page);
  api.state.provisional = true;
  await page.goto(financeUrl);
  await expect(page.getByText(/Остаток расчётный: есть суммы/)).toBeVisible();
  await expect(page.getByTestId("finance-closing")).toContainText("Расчётный остаток");
  await expect(page.getByTestId("finance-closing")).not.toContainText("Долг");
});

for (const lang of ["ru", "de"]) for (const width of [1440, 390]) {
  test(`grouped patient menu and period overview in ${lang} at ${width}`, async ({ page }) => {
    const api = await prepare(page, lang);
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(financeUrl);
    await expect(page.getByTestId("finance-closing")).toContainText("650,00");
    if (width >= 1024) {
      const rail = page.locator('[data-workspace-rail="patient"]');
      await expect(rail.locator("h2")).toHaveText(lang === "de" ? ["Patient", "Medizin", "Betreuung", "Finanzen"] : ["Пациент", "Медицина", "Сопровождение", "Финансы"]);
      await expect(rail.locator('[aria-current="page"]')).toContainText(lang === "de" ? "Übersicht nach Zeitraum" : "Обзор по периодам");
    } else {
      const chooser = page.getByRole("combobox", { name: lang === "de" ? "Patientenbereich" : "Раздел пациента", exact: true });
      await chooser.click();
      await page.getByRole("option", { name: lang === "de" ? "Rechnungen" : "Счета", exact: true }).click();
      await expect(page).toHaveURL(/tab=invoices/);
      await chooser.click();
      await page.getByRole("option", { name: lang === "de" ? "Übersicht nach Zeitraum" : "Обзор по периодам", exact: true }).click();
      await expect(page.getByTestId("finance-closing")).toBeVisible();
    }
    await page.getByRole("button", { name: lang === "de" ? "Dieses Quartal" : "Этот квартал", exact: true }).click();
    await expect(page.getByTestId("finance-closing")).toContainText("650,00");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../artifacts/design-qa/patient-finance-${lang}-${width}.png`, fullPage: true });
    await page.getByTestId("patient-finance").getByRole("heading", { name: lang === "de" ? "Nach Monaten" : "По месяцам", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-qa/patient-finance-months-${lang}-${width}.png`, fullPage: true });
    expect(api.errors).toEqual([]);
  });
}

test("staff without financial API access cannot open the period overview by URL", async ({ page }) => {
  const api = await prepare(page, "ru", "it_admin");
  await page.goto(financeUrl);
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`));
  await expect(page.getByTestId("patient-finance")).toHaveCount(0);
  await expect(page.locator('[data-workspace-rail="patient"] a[href$="tab=finance"]')).toHaveCount(0);
  expect(api.requests).toEqual([]);
});
