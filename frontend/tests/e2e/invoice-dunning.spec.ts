import { expect, test, type Page } from "@playwright/test";

const invoiceId = "00000000-0000-0000-0000-000000000601";

async function prepare(page: Page, lang = "ru") {
  const invoice = {
    id: invoiceId, invoice_number: "INV-DUNNING-QA", patient_name: "Invoice QA",
    patient_id: "00000000-0000-0000-0000-000000000301", invoice_type: "final",
    status: "sent", due_date: "2026-09-06", issued_at: "2026-09-01T10:00:00Z",
    total_net: "2490", total_vat: "473.10", total_gross: "2963.10",
    balance_due: "2963.10", paid_amount: "0", notes: null, paid_at: null,
    available_prepayments: [], prepayment_allocations: [], line_items: [],
  };
  const state = { invoice, events: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[], error: "", errors: [] as string[] };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-09-07T12:00:00Z"));
  await page.addInitScript(language => {
    localStorage.setItem("gmed_access_token", "dunning-qa-token");
    localStorage.setItem("gmed_refresh_token", "dunning-qa-refresh");
    localStorage.setItem("gmed_lang", language);
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: "dunning-qa", name: "Invoice QA", email: "qa@example.org", role: "billing" };
    if (path === "/auth/refresh") body = { access_token: "dunning-qa-token", refresh_token: "dunning-qa-refresh", expires_in: 900 };
    if (path === "/invoices") body = { items: [invoice], total: 1, page: 1, per_page: 50, total_pages: 1 };
    if (path === `/invoices/${invoiceId}`) body = invoice;
    if (/\/invoices\/[^/]+\/(payments|credit-notes|refunds)$/.test(path)) body = { items: [] };
    if (path === "/invoices/accounting-ledger") body = { year: 2026, summary: {}, monthly: [], entries: [] };
    if (path === `/invoices/${invoiceId}/dunning`) {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        state.writes.push(payload);
        if (state.error) return route.fulfill({ status: 422, json: { error: state.error } });
        const event = { ...payload, id: `event-${state.events.length}`, invoice_id: invoiceId, balance_due: invoice.balance_due, sent_at: "2026-09-07T12:00:00Z", created_at: "2026-09-07T12:00:00Z" };
        state.events.push(event);
        return route.fulfill({ json: event });
      }
      body = state.events;
    }
    await route.fulfill({ json: body });
  });
  return state;
}

test("draft reminders are blocked before opening the form, with a Russian explanation", async ({ page }) => {
  const state = await prepare(page);
  state.invoice.status = "draft";
  await page.goto(`/invoices?invoice=${invoiceId}`);
  await expect(page.getByRole("button", { name: "Добавить напоминание", exact: true })).toBeDisabled();
  await expect(page.locator("#invoice-dunning-block-reason")).toContainText("Сначала отправьте счёт");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("eligible reminders use clear labels and advance through the sequence only once", async ({ page }, testInfo) => {
  const state = await prepare(page);
  await page.goto(`/invoices?invoice=${invoiceId}`);
  for (const [index, label] of ["Первое напоминание", "Второе напоминание", "Передача на взыскание"].entries()) {
    const action = index === 2 ? "Зафиксировать передачу на взыскание" : "Добавить напоминание";
    await page.getByRole("button", { name: action, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Контроль оплаты", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(label);
    await expect(dialog).not.toContainText("Следующая эскалация");
    if (index === 0) await dialog.screenshot({ path: testInfo.outputPath("dunning-ru.png") });
    await dialog.getByRole("button", { name: action, exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Все шаги уже зарегистрированы", exact: true })).toBeDisabled();
  expect(state.writes.map(write => write.level)).toEqual(["first", "second", "collections"]);
  expect(state.errors).toEqual([]);
});

test("server rejection is translated, and refreshing rechecks the invoice", async ({ page }, testInfo) => {
  const state = await prepare(page, "de");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/invoices?invoice=${invoiceId}`);
  await page.getByRole("button", { name: "Mahnung hinzufügen", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Zahlung nachverfolgen", exact: true });
  state.invoice.status = "draft";
  state.error = "Invoice must be sent before dunning starts";
  await dialog.getByRole("button", { name: "Mahnung hinzufügen", exact: true }).click();
  await expect(dialog).toContainText("Senden Sie zuerst die Rechnung");
  await expect(dialog).not.toContainText(state.error);
  await dialog.screenshot({ path: testInfo.outputPath("dunning-de-mobile-error.png") });
  await dialog.getByRole("button", { name: "Aktualisieren", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Mahnung hinzufügen", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("Für Entwürfe sind keine Mahnungen möglich");
  expect(state.writes).toHaveLength(1);
  expect(state.errors).toEqual([]);
});
