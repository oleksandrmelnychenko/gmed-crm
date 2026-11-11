import { expect, test, type Page } from "@playwright/test";

// QA 2026-11-11, C-1 and C-3: rows of the billing lists grow with their
// content. A wrapped button of one settlement never lies over the next
// patient's row, and the small amounts under «Bezahlt» / «Saldo» are never
// cut mid-number.

type Payload = Record<string, unknown>;

const figures = (uninvoiced: string): Payload => ({
  accrued_net: uninvoiced,
  accrued_gross: uninvoiced,
  invoiced_gross: "0",
  paid_gross: "0",
  balance_gross: uninvoiced,
  uninvoiced_gross: uninvoiced,
  billable_gross: uninvoiced,
  warnings: [],
});

function settlement(index: number, uninvoiced: string): Payload {
  const id = `00000000-0000-0000-0000-00000000070${index}`;
  return {
    id,
    order_id: `00000000-0000-0000-0000-00000000080${index}`,
    order_number: `ORD-2026-000${index}`,
    order_status: "cancelled",
    patient_id: `00000000-0000-0000-0000-00000000090${index}`,
    patient_pid: `P-000${index}`,
    patient_name: `Testpatientin Nummer ${index}`,
    contract_id: null,
    contract_number: null,
    terminated_at: "2026-11-02",
    currency: "EUR",
    status: "open",
    snapshot: figures(uninvoiced),
    current: figures(uninvoiced),
    can_settle: true,
    lines: [],
    final_invoice: null,
    settled_at: null,
    settled_by_name: null,
    settlement_note: null,
    settlement_forced: false,
    settled_balance_gross: null,
    created_at: "2026-11-02T10:00:00Z",
    created_by_name: "Billing QA",
  };
}

function invoice(index: number, patch: Payload): Payload {
  return {
    id: `00000000-0000-0000-0000-00000000060${index}`,
    invoice_number: `INV-2026110${index}-0001`,
    patient_name: `Testpatient ${index}`,
    patient_id: `00000000-0000-0000-0000-00000000030${index}`,
    invoice_type: "final",
    status: "issued",
    due_date: "2026-12-01",
    issued_at: "2026-11-01",
    total_net: "840.34",
    total_vat: "159.66",
    total_gross: "1000",
    balance_due: "0",
    paid_amount: "500",
    prepayment_applied_amount: "500",
    credited_amount: "0",
    credit_balance: "0",
    notes: null,
    paid_at: null,
    line_items: [],
    available_prepayments: [],
    prepayment_allocations: [],
    ...patch,
  };
}

async function prepare(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "list-layout-qa-token");
    localStorage.setItem("gmed_refresh_token", "list-layout-qa-refresh");
    localStorage.setItem("gmed_lang", "de");
  });
  const invoices = [
    invoice(1, {}),
    invoice(2, { paid_amount: "9999999.99", prepayment_applied_amount: "519", credit_balance: "9998999.99" }),
    invoice(3, { paid_amount: "0", prepayment_applied_amount: "123456.78", total_gross: "123456.78" }),
  ];
  const settlements = [settlement(1, "1000"), settlement(2, "123456.78"), settlement(3, "250")];
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: "list-layout-qa", name: "Billing QA", email: "billing@example.com", role: "billing" };
    if (path === "/auth/refresh") body = { access_token: "list-layout-qa-token", refresh_token: "list-layout-qa-refresh", expires_in: 900 };
    if (path === "/invoices") body = { items: invoices, total: invoices.length, page: 1, per_page: 50, total_pages: 1 };
    if (path === "/invoices/termination-settlements") body = settlements;
    if (path === "/invoices/accounting-ledger") body = { year: 2026, summary: {}, monthly: [], entries: [] };
    await route.fulfill({ json: body });
  });
  return errors;
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test(`settlement queue at ${viewport.width}: every action button is the element under its own centre`, async ({ page }) => {
    const errors = await prepare(page);
    await page.setViewportSize(viewport);
    await page.goto("/invoices?source=settlements");
    const queue = page.getByTestId("termination-settlement-queue");
    const rows = queue.locator('[role="table"] [role="row"][aria-rowindex]:not([aria-rowindex="1"])');
    await expect(rows).toHaveCount(3);
    const buttons = queue.locator('[role="table"] [role="row"] [data-column-id="actions"] button');
    await expect(buttons).toHaveCount(6);

    for (let index = 0; index < 6; index += 1) {
      const button = buttons.nth(index);
      await button.scrollIntoViewIfNeeded();
      const hit = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const found = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        const row = element.closest('[role="row"]');
        const rowRect = row?.getBoundingClientRect();
        return {
          own: found === element || element.contains(found),
          insideRow: rowRect ? rect.top >= rowRect.top - 0.5 && rect.bottom <= rowRect.bottom + 0.5 : false,
        };
      });
      expect(hit, `button ${index + 1}`).toEqual({ own: true, insideRow: true });
    }
    expect(errors).toEqual([]);
  });
}

test("invoice list: the amounts under «Bezahlt» and «Saldo» are never cut", async ({ page }) => {
  const errors = await prepare(page);
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/invoices");
    const subAmounts = page.locator('[role="table"] [data-testid="invoice-sub-amount"]');
    await expect(subAmounts.first()).toBeVisible();
    const count = await subAmounts.count();
    expect(count).toBeGreaterThanOrEqual(4);
    for (let index = 0; index < count; index += 1) {
      const line = subAmounts.nth(index);
      await line.scrollIntoViewIfNeeded();
      const fit = await line.evaluate((element) => {
        const amount = element.querySelector("span:last-child") ?? element;
        const cell = element.closest('[role="cell"]');
        const row = element.closest('[role="row"]');
        if (!cell || !row) return { text: element.textContent, inside: false };
        const a = amount.getBoundingClientRect();
        const c = cell.getBoundingClientRect();
        const r = row.getBoundingClientRect();
        return {
          text: element.textContent,
          inside: a.left >= c.left - 0.5 && a.right <= c.right + 0.5 && a.bottom <= r.bottom + 0.5 && a.top >= r.top - 0.5,
        };
      });
      expect(fit, `${viewport.width}: ${fit.text}`).toMatchObject({ inside: true });
    }
  }
  expect(errors).toEqual([]);
});
