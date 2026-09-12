import { expect, test, type Page } from "@playwright/test";
import { emptyIntake, type IntakeFacts, type IntakeWorkspace } from "../../src/pages/orders/model/order-intake";

const facts: IntakeFacts = { insurance_type: "private", insurance_provider: "Existing insurer", insurance_number: "1234",
  phone_primary: "+490000000", email: "patient@example.test", address_street: "Teststraße 1", address_city: "Berlin",
  address_zip: "10000", address_country: "DE", pep_contract_partner: null, pep_beneficial_owner: null,
  pep_office: "", pep_asset_origin: "", representative_name: "", representative_phone: "", representative_authority: "" };
async function setup(page: Page, language: "ru" | "de", resume = false, failLoad = false) {
  const state = { creates: 0, actions: [] as string[], generated: [] as string[], signed: [] as string[], failSave: false, failLoad, workspace: {
    order_id: "intake-qa", patient_id: "patient-intake-qa", order_number: "ORD-TEST-1", intake_state: "draft",
    revision: 0, data: emptyIntake(structuredClone(facts)), baseline_facts: structuredClone(facts), current_facts: structuredClone(facts),
    confirmed_facts: null, facts_confirmed_at: null, checks: [{ key: "single_order", status: "blocked", step: 4 }], current_document_ids: ["doc-current", "doc-signed"],
  } as IntakeWorkspace };
  const documents = [
    { id: "doc-current", generated_template_id: "single_order", auto_name: "Order QA", signed_at: null as string | null },
    { id: "doc-outdated", generated_template_id: "privacy_consents", auto_name: "Privacy QA", signed_at: null as string | null },
    { id: "doc-signed", generated_template_id: "framework_contract", auto_name: "Framework QA", signed_at: "2026-09-09T12:00:00Z" as string | null },
  ].map(doc => ({ ...doc, order_id: "intake-qa", is_latest_version: true, status: "active", patient_id: "patient-intake-qa" }));
  if (resume) { state.workspace.data.step = 3; state.workspace.data.date_from = "2026-12-20"; state.workspace.data.date_to = "2027-01-15"; }
  await page.addInitScript(lang => { localStorage.setItem("gmed_lang", lang); localStorage.setItem("gmed_access_token", "order-intake-test"); }, language);
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: { id: "tester", name: "Manager", email: "qa@example.test", role: "ceo" } });
    if (path.endsWith("/order-intakes")) {
      if (state.failLoad) return route.fulfill({ status: 404, json: { message: "API route not found" } });
      if (route.request().method() === "GET") return route.fulfill({ json: { facts } });
      state.creates++; return route.fulfill({ json: state.workspace });
    }
    if (path.endsWith("/intake")) {
      if (route.request().method() === "GET") return route.fulfill({ json: state.workspace });
      const body = route.request().postDataJSON(); state.actions.push(body.action);
      if (state.failSave) return route.fulfill({ status: 409, json: { message: "Order preparation changed. Reload and review your changes." } });
      expect(body.revision).toBe(state.workspace.revision);
      state.workspace.data = body.data; state.workspace.revision++;
      if (body.action === "confirm_facts") { state.workspace.current_facts = body.data.facts; state.workspace.baseline_facts = body.data.facts; state.workspace.confirmed_facts = body.data.facts; state.workspace.facts_confirmed_at = "2026-09-10T12:00:00Z"; }
      return route.fulfill({ json: state.workspace });
    }
    if (path === "/framework-contracts") return route.fulfill({ json: [{ id: "contract-qa", contract_number: "FC-OLD", status: "signed", valid_from: "2026-01-01", valid_to: "2026-12-31" }] });
    if (path === "/providers/specializations") return route.fulfill({ json: [{ id: "specialty-qa", code: "urology", name_de: "Urologie", name_ru: "Урология", name_en: "Urology", is_active: true }] });
    if (path.includes("/specializations/specialty-qa/work-types")) return route.fulfill({ json: [{ id: "work-qa", specialization_id: "specialty-qa", specialization_ids: ["specialty-qa"], code: "surgery", name_de: "Operation", name_ru: "Операция", name_en: "Surgery", name_es: "", min_price_eur: 28000, max_price_eur: 35000, duration_hours: 15, sort_order: 1, is_active: true, descriptions: [] }] });
    if (path === "/agency-services") return route.fulfill({ json: [{
      id: "service-qa", service_name: "Organisation und Begleitung medizinischer Untersuchungen", unit_label: "Std.", description: "Planung: [Fachrichtung 1], [Fachrichtung 2]", currency: "EUR", unit_price: "120", vat_rate: "19", valid_from: "2020-01-01", valid_to: null,
      price_versions: [
        { id: "price-current", name: "Aktuell", unit_price: "120", vat_rate: "19", currency: "EUR", valid_from: "2026-01-01", valid_to: null },
        { id: "price-old", name: "Archiv", unit_price: "100", vat_rate: "19", currency: "EUR", valid_from: "2020-01-01", valid_to: "2025-12-31" },
      ],
    }] });
    if (path === "/documents") return route.fulfill({ json: documents });
    if (path === "/documents/generate") { state.generated.push(route.request().postDataJSON().template_id); return route.fulfill({ json: {} }); }
    if (path.endsWith("/mark-signed")) {
      const doc = documents.find(item => path === `/documents/${item.id}/mark-signed`)!;
      doc.signed_at = "2026-09-10T12:00:00Z"; state.signed.push(doc.id);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/__order-wizard-qa*", route => route.fulfill({ contentType: "text/html", body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import('/tests/e2e/fixtures/order-wizard.tsx');</script></html>` }));
  await page.goto(`/__order-wizard-qa${resume ? "?order=intake-qa" : ""}`);
  await expect(page.getByRole("navigation")).toBeVisible();
  return state;
}

for (const lang of ["ru", "de"] as const) {
  test(`patient order wizard autosaves only draft facts and fits desktop/mobile ${lang}`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await setup(page, lang);
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByText("Existing insurer", { exact: true })).toBeVisible();
    expect(state.creates).toBe(0);
    await expect(sheet).not.toContainText(/Как вы узнали|Опросник|Fragebogen/);
    await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-desktop.png` });
    await sheet.getByRole("button", { name: lang === "ru" ? "Изменить сведения" : "Angaben ändern", exact: true }).click();
    await sheet.locator('input[value="Existing insurer"]').fill("New insurer");
    await expect.poll(() => state.actions.includes("save")).toBe(true);
    expect(state.workspace.current_facts.insurance_provider).toBe("Existing insurer");
    expect(state.workspace.data.facts.insurance_provider).toBe("New insurer");
    expect(state.creates).toBe(1);
    await expect(sheet.getByRole("status")).toContainText(lang === "ru" ? "Черновик сохранён" : "Entwurf gespeichert");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await expect(sheet.getByRole("button", { name: lang === "ru" ? "Далее" : "Weiter", exact: true })).toBeInViewport();
    await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-mobile.png` });
    await sheet.getByRole("navigation").getByRole("tab").nth(5).click();
    await expect(sheet.getByRole("button", { name: lang === "ru" ? "Оформить заказ" : "Auftrag bestätigen", exact: true })).toBeDisabled();
    expect(errors).toEqual([]);
  });
}

test("resume checks the complete contract period and stops autosave after conflicts", async ({ page }) => {
  const state = await setup(page, "ru", true);
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByText("20.12.2026 – 15.01.2027", { exact: true })).toBeVisible();
  await sheet.getByRole("combobox", { name: "Рамочный договор", exact: true }).click();
  await page.getByRole("option", { name: /FC-OLD/ }).click();
  await expect(sheet.getByText("Проверьте подпись и срок: этот договор пока не покрывает весь период заказа.")).toBeVisible();
  await expect.poll(() => state.actions.length).toBe(1);
  expect(state.creates).toBe(0);
  state.failSave = true;
  await sheet.getByRole("navigation").getByRole("tab").nth(1).click();
  await expect(sheet.getByRole("alert")).toContainText("Order preparation changed");
  expect(state.workspace.data.step).toBe(3);
});

test("unavailable order preparation shows a readable error and supports retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page, "ru", false, true);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText("Сервис оформления заказа пока недоступен");
  await expect(dialog).not.toContainText("API route not found");
  await expect(dialog.getByRole("alert")).toBeInViewport();
  await expect(dialog.getByRole("button", { name: "Закрыть", exact: true }).last()).toBeInViewport();
  expect(state.creates).toBe(0);
  state.failLoad = false;
  await dialog.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(dialog.getByText("Existing insurer", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});

test("resumed order can remove unavailable work types without losing the specialization", async ({ page }) => {
  const state = await setup(page, "ru");
  state.workspace.data.step = 1;
  state.workspace.data.specialization_ids = ["specialty-qa"];
  state.workspace.data.selected_work_type_ids = ["work-retired"];
  await page.goto("/__order-wizard-qa?order=intake-qa");
  const dialog = page.getByTestId("order-wizard");
  await expect(dialog.getByRole("alert")).toContainText("больше недоступны");
  await dialog.getByRole("button", { name: "Убрать недоступные", exact: true }).click();
  await expect.poll(() => state.workspace.data.selected_work_type_ids).toEqual([]);
  expect(state.workspace.data.specialization_ids).toEqual(["specialty-qa"]);
  expect(state.creates).toBe(0);
});

for (const lang of ["ru", "de"] as const) {
  test(`editable order tables preserve prices, documents and navigation ${lang}`, async ({ page }) => {
    const tx = (ru: string, de: string) => lang === "de" ? de : ru;
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    const state = await setup(page, lang);
    const dialog = page.getByTestId("order-wizard");
    const steps = dialog.getByRole("navigation").getByRole("tab");
    await steps.nth(1).click();
    await dialog.getByRole("combobox", { name: tx("Добавить специализацию", "Fachrichtung hinzufügen"), exact: true }).click();
    await page.getByRole("option", { name: tx("Урология", "Urologie"), exact: true }).click();
    const workRow = dialog.getByRole("row").filter({ hasText: tx("Операция", "Operation") });
    await workRow.getByRole("checkbox").check();
    await expect.poll(() => state.workspace.data.selected_work_type_ids).toEqual(["work-qa"]);
    await dialog.getByRole("checkbox", { name: "Русский", exact: true }).check();
    await expect.poll(() => state.workspace.data.cost_estimate_additional_language).toBe("ru");
    await steps.nth(2).click();
    await expect(dialog.getByRole("table").getByText(tx("Операция", "Operation"), { exact: true })).toBeVisible();
    const addService = dialog.getByRole("combobox", { name: tx("Выбрать услугу из каталога", "Leistung aus dem Katalog auswählen"), exact: true });
    await addService.click();
    await page.getByRole("option", { name: /Aktuell/ }).click();
    const table = dialog.getByRole("table").filter({ has: page.getByRole("columnheader", { name: new RegExp(`^${tx("Услуга", "Leistung")} `) }) });
    await expect(table).toHaveAttribute("aria-rowcount", "1");
    const quantity = table.getByRole("textbox", { name: new RegExp(`^${tx("Объём", "Umfang")}`) });
    await quantity.fill("2");
    const totals = dialog.getByRole("definition").filter({ hasText: /285,60/ });
    await expect(totals).toBeVisible();
    await expect(table.getByText("Planung: Urologie", { exact: true })).toBeVisible();
    await table.getByRole("combobox", { name: new RegExp(`^${tx("Цена каталога", "Katalogpreis")}`) }).click();
    await page.getByRole("option", { name: /Archiv/ }).click();
    await expect(dialog.getByRole("definition").filter({ hasText: /238,00/ })).toBeVisible();
    await expect.poll(() => state.workspace.data.lines[0]?.agency_service_price_version_id).toBe("price-old");
    await table.getByRole("button", { name: /^Удалить услугу:|^Leistung entfernen:/ }).click();
    const confirmation = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: tx("Удалить услугу?", "Leistung entfernen?"), exact: true }) });
    await confirmation.getByRole("button", { name: tx("Отмена", "Abbrechen"), exact: true }).click();
    await expect(table).toHaveAttribute("aria-rowcount", "1");
    await table.getByRole("button", { name: /^Удалить услугу:|^Leistung entfernen:/ }).click();
    await confirmation.getByRole("button", { name: tx("Удалить", "Entfernen"), exact: true }).click();
    await expect(table).toHaveCount(0);
    await addService.click();
    await page.getByRole("option", { name: /Aktuell/ }).click();
    await quantity.fill("2");
    await expect(totals).toBeVisible();
    await dialog.getByRole("checkbox", { name: tx("Предоплата предусмотрена", "Vorauszahlung vorgesehen") }).check();
    await dialog.getByRole("spinbutton", { name: tx("Сумма предоплаты, EUR", "Vorauszahlung, EUR") }).fill("100");
    await expect.poll(() => state.workspace.data.prepayment_amount).toBe("100");
    await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-services-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog).toBeInViewport();
    await expect(steps.nth(2)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: tx("Далее", "Weiter"), exact: true })).toBeInViewport();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const mobileService = dialog.getByRole("listitem").filter({ hasText: "Organisation und Begleitung" });
    await expect(mobileService.getByRole("textbox", { name: new RegExp(`^${tx("Объём", "Umfang")}`) })).toHaveValue("2");
    await expect(mobileService.getByText(/240,00/)).toBeVisible();
    await mobileService.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-services-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await steps.nth(4).click();
    const docs = dialog.getByRole("table");
    await expect(docs).toHaveAttribute("aria-rowcount", "3");
    const outdated = docs.getByRole("row").filter({ hasText: tx("Нужна новая версия", "Neue Version erforderlich") });
    await expect(outdated.getByRole("button", { name: /Privacy QA/ })).toBeDisabled();
    await expect(outdated.getByRole("button", { name: tx("Подписано на бумаге", "Auf Papier unterschrieben") })).toHaveCount(0);
    await docs.getByRole("button", { name: tx("Подписано на бумаге", "Auf Papier unterschrieben"), exact: true }).click();
    await expect.poll(() => state.signed).toEqual(["doc-current"]);
    await expect(docs.getByText("10.09.2026", { exact: true })).toBeVisible();
    await dialog.getByRole("combobox", { name: tx("Документ для подготовки", "Dokument zur Erstellung"), exact: true }).click();
    await page.getByRole("option", { name: tx("Согласование стоимости", "Kostenvereinbarung"), exact: true }).click();
    await dialog.getByRole("button", { name: tx("Создать документ", "Dokument erstellen"), exact: true }).click();
    await expect.poll(() => state.generated).toEqual(["order_cost_estimate"]);
    await expect(dialog.getByRole("button", { name: tx("Создать документ", "Dokument erstellen"), exact: true })).toBeEnabled();
    await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-documents-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(steps.nth(4)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: tx("Далее", "Weiter"), exact: true })).toBeInViewport();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-documents-mobile.png` });
    await steps.nth(5).click();
    await dialog.getByRole("button", { name: new RegExp(`^${tx("Открыть этап", "Schritt öffnen")}:`) }).click();
    await expect(steps.nth(4)).toHaveAttribute("aria-selected", "true");
    for (const index of [1, 3, 5]) {
      await steps.nth(index).click();
      await expect(steps.nth(index)).toHaveAttribute("aria-selected", "true");
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `../artifacts/design-qa/order-wizard-${lang}-step-${index + 1}-mobile.png` });
    }
    expect(state.actions).toContain("prepare");
    expect(state.actions).toContain("review_documents");
    expect(state.creates).toBe(1);
    expect(errors).toEqual([]);
  });
}
