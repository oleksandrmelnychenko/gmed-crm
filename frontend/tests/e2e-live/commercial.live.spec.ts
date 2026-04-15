import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  bootstrapFullSmokeScenario,
  loginViaApi,
  loginViaUi,
  setGermanLanguage,
} from "./support/live-helpers";

function dateInputOffset(days: number) {
  const value = new Date();
  value.setHours(12, 0, 0, 0);
  value.setDate(value.getDate() + days);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test.describe("commercial live workflows", () => {
  test("patient manager and billing can complete quote to invoice to dunning flow", async ({
    browser,
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaUi(
      page,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );

    await page.goto(
      `/contracts?patient=${scenario.patient.id}&order=${scenario.order.id}&tab=quotes`,
    );
    await expect(
      page.getByRole("heading", { name: /Contracts and quotes/i }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Quotes" }).click();

    const createQuoteResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/orders/${scenario.order.id}/quotes`) &&
        nextResponse.request().method() === "POST",
    );

    await page.getByRole("button", { name: /New quote/i }).click();
    const quoteDialog = page.getByRole("dialog");
    await expect(quoteDialog).toBeVisible();
    await quoteDialog.locator("select").first().selectOption(scenario.order.id);
    await quoteDialog.locator('input[type="date"]').fill(dateInputOffset(30));
    await quoteDialog
      .locator("textarea")
      .fill("Live E2E quote handoff note.");
    await quoteDialog.getByRole("button", { name: /Create quote/i }).click();

    const createdQuote = await createQuoteResponse.then(
      async (response) => response.json() as Promise<{ id: string }>,
    );

    const quoteSheet = page.getByRole("dialog");
    await expect(quoteSheet.getByText("Quote lifecycle")).toBeVisible();
    await quoteSheet.locator("select").first().selectOption("sent");
    await quoteSheet
      .locator("textarea")
      .first()
      .fill("Quote sent to the patient for commercial confirmation.");

    const saveQuoteResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/quotes/${createdQuote.id}/status`) &&
        nextResponse.request().method() === "POST",
    );
    await quoteSheet.getByRole("button", { name: /Save quote/i }).click();
    await saveQuoteResponse;

    const pmApi = await authenticateApiClient(
      request,
      scenario.credentials.pm.email,
      scenario.credentials.password,
    );
    await expect(async () => {
      const response = await request.get(
        `${pmApi.backendUrl}/api/v1/quotes/${createdQuote.id}`,
        { headers: pmApi.headers },
      );
      expect(response.ok()).toBe(true);
      const quote = (await response.json()) as {
        id: string;
        order_id: string;
        status: string;
        notes: string | null;
        valid_until: string | null;
      };
      expect(quote.id).toBe(createdQuote.id);
      expect(quote.order_id).toBe(scenario.order.id);
      expect(quote.status).toBe("sent");
      expect(quote.notes).toContain(
        "Quote sent to the patient for commercial confirmation.",
      );
      expect(quote.valid_until).not.toBeNull();
    }).toPass({ timeout: 15_000 });

    const baseUrl = new URL(page.url()).origin;
    const billingContext = await browser.newContext({ baseURL: baseUrl });
    const billingPage = await billingContext.newPage();
    await setGermanLanguage(billingPage);
    await loginViaApi(
      billingPage,
      request,
      scenario.credentials.billing.email,
      scenario.credentials.password,
    );
    const billingApi = await authenticateApiClient(
      request,
      scenario.credentials.billing.email,
      scenario.credentials.password,
    );
    const billingReleaseResult = await billingPage.evaluate(
      async ({ orderId }) => {
        const token = window.localStorage.getItem("gmed_access_token");
        const response = await fetch(`/api/v1/orders/${orderId}/process-gates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            billing_release_status: "granted",
            billing_release_note:
              "Live E2E billing release before invoice creation.",
          }),
        });

        return {
          ok: response.ok,
          status: response.status,
          body: await response.text(),
        };
      },
      { orderId: scenario.order.id },
    );
    expect(
      billingReleaseResult.ok,
      billingReleaseResult.body,
    ).toBeTruthy();

    await billingPage.goto(
      `/invoices?quote=${createdQuote.id}&order=${scenario.order.id}&patient=${scenario.patient.id}`,
    );
    await expect(
      billingPage.getByRole("heading", {
        level: 1,
        name: /Invoices|Rechnungen/i,
      }),
    ).toBeVisible();

    const createInvoiceResponse = billingPage.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/quotes/${createdQuote.id}/invoices`) &&
        nextResponse.request().method() === "POST",
    );

    await billingPage
      .getByRole("button", { name: /New invoice|Neue Rechnung/i })
      .first()
      .click();
    const invoiceDialog = billingPage.getByRole("dialog");
    await expect(invoiceDialog).toBeVisible();
    await invoiceDialog.locator("select").first().selectOption(createdQuote.id);
    await invoiceDialog.locator("select").nth(1).selectOption("interim");
    await invoiceDialog
      .locator('input[type="date"]')
      .fill(dateInputOffset(-3));
    await invoiceDialog
      .locator("textarea")
      .fill("Billing-ready interim invoice for live dunning proof.");
    await invoiceDialog
      .getByRole("button", { name: /New invoice|Neue Rechnung/i })
      .click();

    const invoiceCreationResponse = await createInvoiceResponse;
    const invoiceCreationBody = await invoiceCreationResponse.text();
    expect(
      invoiceCreationResponse.status(),
      invoiceCreationBody,
    ).toBe(201);
    const createdInvoice = JSON.parse(invoiceCreationBody) as {
      id: string;
      invoice_number: string;
    };

    const invoiceSheet = billingPage.getByRole("dialog");
    await expect(
      invoiceSheet.getByText("Invoice overview"),
    ).toBeVisible();

    const saveInvoiceResponse = billingPage.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/invoices/${createdInvoice.id}/status`) &&
        nextResponse.request().method() === "POST",
    );
    await invoiceSheet.locator("select").first().selectOption("sent");
    await invoiceSheet
      .locator('input[type="date"]')
      .first()
      .fill(dateInputOffset(-3));
    await invoiceSheet
      .locator("textarea")
      .first()
      .fill("Invoice sent and now overdue for the first reminder.");
    await invoiceSheet.getByRole("button", { name: /Save invoice/i }).click();
    await saveInvoiceResponse;

    await invoiceSheet
      .getByPlaceholder(/Reminder message or internal billing note/i)
      .fill("First live dunning reminder for the commercial QA flow.");
    const dunningResponse = billingPage.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/invoices/${createdInvoice.id}/dunning`) &&
        nextResponse.request().method() === "POST",
    );
    await invoiceSheet.getByRole("button", { name: /Send first/i }).click();
    const firstDunningResponse = await dunningResponse;
    const firstDunningBody = await firstDunningResponse.text();
    expect(firstDunningResponse.status(), firstDunningBody).toBe(200);
    const firstDunningEvent = JSON.parse(firstDunningBody) as {
      invoice_id: string;
      level: string;
      note: string | null;
    };
    expect(firstDunningEvent.invoice_id).toBe(createdInvoice.id);
    expect(firstDunningEvent.level).toBe("first");
    expect(firstDunningEvent.note).toBe(
      "First live dunning reminder for the commercial QA flow.",
    );

    await expect(
      invoiceSheet.getByText("First live dunning reminder for the commercial QA flow."),
    ).toBeVisible();

    await expect(async () => {
      const invoiceResponse = await request.get(
        `${billingApi.backendUrl}/api/v1/invoices/${createdInvoice.id}`,
        { headers: billingApi.headers },
      );
      expect(invoiceResponse.ok()).toBe(true);
      const invoice = (await invoiceResponse.json()) as {
        id: string;
        quote_id: string | null;
        order_id: string;
        patient_id: string;
        contract_id: string | null;
        invoice_type: string;
        status: string;
        notes: string | null;
        due_date: string | null;
        total_gross: string;
      };
      expect(invoice.id).toBe(createdInvoice.id);
      expect(invoice.quote_id).toBe(createdQuote.id);
      expect(invoice.order_id).toBe(scenario.order.id);
      expect(invoice.patient_id).toBe(scenario.patient.id);
      expect(invoice.invoice_type).toBe("interim");
      expect(["sent", "overdue"]).toContain(invoice.status);
      expect(invoice.notes).toContain(
        "Invoice sent and now overdue for the first reminder.",
      );
      expect(invoice.due_date).not.toBeNull();
      expect(Number(invoice.total_gross)).toBeGreaterThan(0);
    }).toPass({ timeout: 15_000 });

    await billingPage.reload();
    const reloadedInvoiceSheet = billingPage.getByRole("dialog");
    await expect(
      reloadedInvoiceSheet.getByText(createdInvoice.invoice_number),
    ).toBeVisible();
    await expect(
      reloadedInvoiceSheet.getByText(
        "First live dunning reminder for the commercial QA flow.",
      ),
    ).toBeVisible();
    await expect(
      reloadedInvoiceSheet.getByRole("button", {
        name: /Send second|Send collections/i,
      }),
    ).toBeVisible();

    await billingContext.close();
  });
});
