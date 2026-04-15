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
  test("ceo assistant can open accounting ledger and export CSV in read-only mode", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaUi(
      page,
      scenario.credentials.assistant.email,
      scenario.credentials.password,
    );

    await page.goto("/invoices");
    await expect(page.getByText(/Abrechnungsarbeitsbereich/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Buchhaltungsledger/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Neue Rechnung|New invoice/i }),
    ).toHaveCount(0);

    const accountingSection = page
      .getByRole("heading", { name: /Buchhaltungsledger/i })
      .locator("xpath=ancestor::*[.//button[normalize-space()='CSV exportieren']][1]");
    const yearInput = accountingSection.locator('input[type="number"]').first();
    const accountingYear = (await yearInput.inputValue()).trim() || `${new Date().getFullYear()}`;
    await expect(
      accountingSection.getByRole("button", {
        name: /CSV exportieren|Экспорт CSV/i,
      }),
    ).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await accountingSection
      .getByRole("button", { name: /CSV exportieren|Экспорт CSV/i })
      .click();
    const download = await downloadPromise;
    await expect(download.suggestedFilename()).toBe(
      `accounting-ledger-${accountingYear}.csv`,
    );
  });

  test("ceo assistant can inspect contracts quotes and invoices in read-only mode", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaUi(
      page,
      scenario.credentials.assistant.email,
      scenario.credentials.password,
    );

    await page.goto(
      `/contracts?patient=${scenario.patient.id}&order=${scenario.order.id}&quote=${scenario.quote.id}&tab=quotes`,
    );
    await expect(page.getByText(/Kaufmännischer Arbeitsbereich/i)).toBeVisible();
    await expect(
      page.locator("h1").filter({
        hasText: /Verträge und Angebote|Договоры и предложения/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Neues Angebot|Новое предложение/i }),
    ).toHaveCount(0);

    const quoteSheet = page.getByRole("dialog");
    await expect(quoteSheet).toBeVisible();
    await expect(quoteSheet.getByText(scenario.quote.quote_number)).toBeVisible();
    await expect(
      quoteSheet.getByText(/Angebots-Lebenszyklus|Жизненный цикл предложения/i),
    ).toBeVisible();
    await expect(
      quoteSheet.getByRole("button", {
        name: /Angebot speichern|Сохранить предложение/i,
      }),
    ).toBeDisabled();

    await page.goto(
      `/invoices?patient=${scenario.patient.id}&order=${scenario.order.id}&quote=${scenario.quote.id}&invoice=${scenario.invoice.id}`,
    );
    await expect(
      page.getByText(/Abrechnungsarbeitsbereich/i),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /New invoice|Neue Rechnung/i }),
    ).toHaveCount(0);

    const invoiceSheet = page.getByRole("dialog");
    await expect(invoiceSheet).toBeVisible();
    await expect(
      invoiceSheet.getByText(scenario.invoice.invoice_number),
    ).toBeVisible();
    await expect(
      invoiceSheet.getByText(/Rechnungsübersicht|Обзор счёта/i),
    ).toBeVisible();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /Rechnung speichern|Сохранить счёт/i,
      }),
    ).toBeDisabled();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /Mahnung senden|напоминание|Inkasso/i,
      }),
    ).toBeDisabled();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /Vorschau PDF|PDF-Vorschau|Preview PDF/i,
      }),
    ).toBeVisible();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /PDF herunterladen|Download PDF/i,
      }),
    ).toBeVisible();
  });

  test("patient manager can inspect invoice detail but cannot mutate billing status or dunning", async ({
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
      `/invoices?patient=${scenario.patient.id}&order=${scenario.order.id}&quote=${scenario.quote.id}&invoice=${scenario.invoice.id}`,
    );
    await expect(page.getByText(/Abrechnungsarbeitsbereich/i)).toBeVisible();

    const invoiceSheet = page.getByRole("dialog");
    await expect(invoiceSheet).toBeVisible();
    await expect(
      invoiceSheet.getByText(scenario.invoice.invoice_number),
    ).toBeVisible();
    await expect(
      invoiceSheet.getByText(/Rechnungsübersicht|Обзор счёта/i),
    ).toBeVisible();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /Rechnung speichern|Сохранить счёт/i,
      }),
    ).toBeDisabled();
    await expect(
      invoiceSheet.getByPlaceholder(/Erinnerungstext oder interner Abrechnungshinweis|Текст напоминания или внутренняя заметка биллинга/i),
    ).toBeDisabled();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /Erste Mahnung senden|Первая просрочка|Отправить:/i,
      }),
    ).toBeDisabled();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /Vorschau PDF|PDF-Vorschau|Preview PDF/i,
      }),
    ).toBeVisible();
    await expect(
      invoiceSheet.getByRole("button", {
        name: /PDF herunterladen|Download PDF/i,
      }),
    ).toBeVisible();
  });

  test("patient manager can use invoice workspace without accounting ledger access", async ({
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
      `/invoices?patient=${scenario.patient.id}&order=${scenario.order.id}`,
    );
    await expect(page.getByText(/Abrechnungsarbeitsbereich/i)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Buchhaltungsledger/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /CSV exportieren|Экспорт CSV/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Neue Rechnung|New invoice/i }),
    ).toBeVisible();
    await expect(
      page.getByText(scenario.invoice.invoice_number),
    ).toBeVisible();
  });

  test("billing can manage order financial gates and external invoices without operational phase controls", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    const scenario = await bootstrapFullSmokeScenario(request);
    await loginViaUi(
      page,
      scenario.credentials.billing.email,
      scenario.credentials.password,
    );

    await page.goto(`/orders?order=${scenario.order.id}`);
    await expect(
      page.getByRole("heading", { name: /Aufträge|Заказы/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Prozess-Gates|Процессные гейты/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Externe Rechnungen|Внешние счета/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/Billing nur lesend|Только чтение для биллинга/i),
    ).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: /Billing-Gate speichern|Сохранить billing-gate/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Debt-Workflow speichern|Сохранить debt-workflow/i,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: /Externe Rechnung hinzufügen|Добавить внешний счёт/i,
      }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", {
        name: /Planungsstand speichern|Сохранить статус планирования/i,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Durchführungsstand speichern|Сохранить статус исполнения/i,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: /Nachsorge-Stand speichern|Сохранить статус follow-up/i,
      }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", {
        name: /Phase speichern|Сохранить фазу/i,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: /Workflow-Punkt hinzufügen|Добавить пункт workflow/i,
      }),
    ).toHaveCount(0);

    const billingGateSection = page
      .getByText(/Billing entscheidet, ob die Durchfuhrung ausserhalb der Paketdeckung weiterlaufen darf\./i)
      .locator("xpath=ancestor::*[.//button[normalize-space()='Billing-Gate speichern']][1]");
    await billingGateSection.locator("select").first().selectOption("denied");
    await billingGateSection
      .locator("textarea")
      .fill("Live E2E billing order-shell proof.");

    const saveBillingGateResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/orders/${scenario.order.id}/process-gates`) &&
        nextResponse.request().method() === "POST",
    );
    await billingGateSection
      .getByRole("button", {
        name: /Billing-Gate speichern|Сохранить billing-gate/i,
      })
      .click();
    const billingGateResponse = await saveBillingGateResponse;
    expect(billingGateResponse.ok()).toBe(true);

    await expect(
      page.getByText(/Live E2E billing order-shell proof\./i),
    ).toBeVisible();

    const externalInvoiceForm = page
      .getByRole("heading", {
        name: /Externe Rechnung erfassen|Зарегистрировать внешний счёт/i,
      })
      .locator("xpath=ancestor::form[1]");
    const externalInvoiceNumber = `EXT-LIVE-${Date.now()}`;
    const externalInvoiceInputs = externalInvoiceForm.locator("input");
    await externalInvoiceInputs.nth(0).fill(externalInvoiceNumber);
    const providerSelect = externalInvoiceForm.locator("select").first();
    const providerValue = await providerSelect
      .locator("option")
      .nth(1)
      .getAttribute("value");
    expect(providerValue).toBeTruthy();
    await providerSelect.selectOption(providerValue!);
    await externalInvoiceInputs.nth(1).fill(dateInputOffset(-2));
    await externalInvoiceInputs.nth(2).fill(dateInputOffset(7));
    await externalInvoiceInputs.nth(3).fill("100.00");
    await externalInvoiceInputs.nth(4).fill("19.00");
    await externalInvoiceInputs.nth(5).fill("119.00");
    await externalInvoiceForm.locator("select").nth(1).selectOption("received");
    await externalInvoiceForm
      .locator("textarea")
      .fill("Live E2E external invoice from billing shell.");

    const createExternalInvoiceResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/orders/${scenario.order.id}/external-invoices`) &&
        nextResponse.request().method() === "POST",
    );
    await externalInvoiceForm
      .getByRole("button", {
        name: /Externe Rechnung hinzufügen|Добавить внешний счёт/i,
      })
      .click();
    const externalInvoiceResponse = await createExternalInvoiceResponse;
    expect(externalInvoiceResponse.ok()).toBe(true);

    const invoiceCard = page.locator("div").filter({
      has: page.getByText(externalInvoiceNumber),
    }).first();
    await expect(invoiceCard.getByText(externalInvoiceNumber)).toBeVisible();
    await expect(
      invoiceCard.locator('[data-slot="badge"]').filter({
        hasText: /Eingegangen|Получен/i,
      }),
    ).toBeVisible();
    await expect(
      invoiceCard.getByRole("button", {
        name: /Als freigegeben markieren|Отметить как утверждённый/i,
      }),
    ).toBeVisible();
  });

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
      page.getByRole("heading", { name: /Verträge und Angebote|Договоры и предложения/i }),
    ).toBeVisible();
    await page.getByRole("tab", { name: /Angebote|Предложения/i }).click();

    const createQuoteResponse = page.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/orders/${scenario.order.id}/quotes`) &&
        nextResponse.request().method() === "POST",
    );

    await page.getByRole("button", { name: /Neues Angebot|Новое предложение/i }).click();
    const quoteDialog = page.getByRole("dialog");
    await expect(quoteDialog).toBeVisible();
    await quoteDialog.locator("select").first().selectOption(scenario.order.id);
    await quoteDialog.locator('input[type="date"]').fill(dateInputOffset(30));
    await quoteDialog
      .locator("textarea")
      .fill("Live E2E quote handoff note.");
    await quoteDialog.getByRole("button", { name: /Angebot anlegen|Создать предложение/i }).click();

    const createdQuote = await createQuoteResponse.then(
      async (response) => response.json() as Promise<{ id: string }>,
    );

    const quoteSheet = page.getByRole("dialog");
    await expect(quoteSheet.getByText(/Angebots-Lebenszyklus|Жизненный цикл предложения/i)).toBeVisible();
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
    await quoteSheet.getByRole("button", { name: /Angebot speichern|Сохранить предложение/i }).click();
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
      invoiceSheet.getByText(/Rechnungsübersicht|Обзор счёта/i),
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
    await invoiceSheet.getByRole("button", { name: /Rechnung speichern|Сохранить счёт/i }).click();
    await saveInvoiceResponse;

    await invoiceSheet
      .getByPlaceholder(/Erinnerungstext oder interner Abrechnungshinweis|Текст напоминания или внутренняя заметка биллинга/i)
      .fill("First live dunning reminder for the commercial QA flow.");
    const dunningResponse = billingPage.waitForResponse(
      (nextResponse) =>
        nextResponse.url().includes(`/api/v1/invoices/${createdInvoice.id}/dunning`) &&
        nextResponse.request().method() === "POST",
    );
    await invoiceSheet.getByRole("button", { name: /Erste Mahnung senden|Отправить: Первое напоминание/i }).click();
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
        name: /Zweite Mahnung senden|Inkasso senden|Отправить: Второе напоминание|Отправить: Коллекторы/i,
      }),
    ).toBeVisible();

    await billingContext.close();
  });
});
