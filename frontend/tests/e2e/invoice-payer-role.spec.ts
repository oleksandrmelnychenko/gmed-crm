import { expect, test, type Page } from "@playwright/test";

// The invoice payer dialog knows the role `invoice_address` (the contracting
// party at another address, e.g. from the lead's form): it shows it, offers
// it and keeps it on save; the recipient block shows the declared e-mail and
// tax numbers the invoice will carry.

const invoiceId = "00000000-0000-0000-0000-000000000611";

type Payload = Record<string, unknown>;

async function prepare(page: Page, role: string | null) {
  const payer = {
    role,
    contact_name: "Beispiel GmbH",
    contact_email: "rechnung@example.com",
    address_street: "Industriestraße 9",
    address_zip: "50667",
    address_city: "Köln",
    address_country: "DE",
  };
  const invoice = {
    id: invoiceId, invoice_number: null, patient_name: "Anna Muster",
    patient_id: "00000000-0000-0000-0000-000000000311", invoice_type: "final",
    status: "draft", due_date: null, issued_at: null,
    total_net: "100", total_vat: "19", total_gross: "119",
    balance_due: "119", paid_amount: "0", notes: null, paid_at: null,
    available_prepayments: [], prepayment_allocations: [], line_items: [],
    payer, payer_relation_options: [],
    recipient: {
      name: "Beispiel GmbH", street: "Industriestraße 9", zip: "50667", city: "Köln",
      country: "DE", email: "rechnung@example.com", vat_id: "DE 987 654 321",
      tax_number: "214/5678/9012", is_payer: true, kind: "contact", frozen: false,
      has_postal_address: true, has_complete_address: true, missing_address_parts: [],
      service_recipient_name: "Anna Muster",
    },
  };
  const state = { invoice, writes: [] as Payload[], errors: [] as string[] };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "payer-role-qa-token");
    localStorage.setItem("gmed_refresh_token", "payer-role-qa-refresh");
    localStorage.setItem("gmed_lang", "de");
  });
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = { id: "payer-role-qa", name: "Billing QA", email: "billing@example.com", role: "billing" };
    if (path === "/auth/refresh") body = { access_token: "payer-role-qa-token", refresh_token: "payer-role-qa-refresh", expires_in: 900 };
    if (path === "/invoices") body = { items: [state.invoice], total: 1, page: 1, per_page: 50, total_pages: 1 };
    if (path === `/invoices/${invoiceId}`) body = state.invoice;
    if (/\/invoices\/[^/]+\/(payments|credit-notes|refunds)$/.test(path)) body = { items: [] };
    if (path === "/invoices/accounting-ledger") body = { year: 2026, summary: {}, monthly: [], entries: [] };
    if (path === `/invoices/${invoiceId}/payer` && route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as Payload;
      state.writes.push(payload);
      state.invoice = {
        ...state.invoice,
        payer: { ...state.invoice.payer, role: payload.payer_role as string | null },
      };
      body = state.invoice;
    }
    await route.fulfill({ json: body });
  });
  return state;
}

function payerDialog(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Aktueller Zahler" });
  const role = dialog.getByRole("combobox", { name: /^Rechnungsempfänger/ });
  return { dialog, role };
}

async function openPayerDialog(page: Page) {
  await page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /Aktueller Zahler/ }) })
    .getByRole("button", { name: "Bearbeiten" })
    .click();
  const { dialog, role } = payerDialog(page);
  await expect(dialog).toBeVisible();
  return { dialog, role };
}

test("a stored invoice address is shown, kept on save, with the recipient's tax numbers", async ({ page }) => {
  const state = await prepare(page, "invoice_address");
  await page.goto(`/invoices?invoice=${invoiceId}`);
  const payerSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /Aktueller Zahler/ }) });
  // The role metric names the role instead of "Nicht gesetzt".
  await expect(payerSection).toContainText(
    "RechnungsempfängerRechnungsanschrift (keine Kostenübernahme)",
  );
  const recipient = page.getByTestId("invoice-recipient");
  await expect(recipient).toContainText("E-Mail für Rechnungen: rechnung@example.com");
  await expect(recipient).toContainText("USt-IdNr.: DE 987 654 321");
  await expect(recipient).toContainText("Steuernummer: 214/5678/9012");

  const { dialog, role } = await openPayerDialog(page);
  await expect(role).toContainText("Rechnungsanschrift (keine Kostenübernahme)");
  await dialog.getByLabel("E-Mail", { exact: true }).fill("buchhaltung@example.com");
  await dialog.getByRole("button", { name: "Zahler speichern" }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({
    payer_role: "invoice_address",
    payer_contact_name: "Beispiel GmbH",
    payer_contact_email: "buchhaltung@example.com",
  });
  expect(state.errors).toEqual([]);
});

test("the invoice address is offered as a third role choice", async ({ page }) => {
  const state = await prepare(page, null);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/invoices?invoice=${invoiceId}`);
  const { dialog, role } = await openPayerDialog(page);
  await role.click();
  const options = page.getByRole("option");
  await expect(options).toHaveText([
    "Bei Ausstellung prüfen",
    "Rechnungsempfänger ist Vertragspartner",
    "Abweichender Rechnungsempfänger (Kostenübernehmer)",
    "Rechnungsanschrift (keine Kostenübernahme)",
  ]);
  await page.getByRole("option", { name: "Rechnungsanschrift (keine Kostenübernahme)" }).click();
  await expect(role).toContainText("Rechnungsanschrift (keine Kostenübernahme)");
  await dialog.getByRole("button", { name: "Zahler speichern" }).click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toMatchObject({ payer_role: "invoice_address" });
  expect(state.errors).toEqual([]);
});
