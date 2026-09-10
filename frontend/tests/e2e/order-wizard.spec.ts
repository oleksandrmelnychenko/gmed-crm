import { expect, test, type Page } from "@playwright/test";
import { emptyIntake, type IntakeFacts, type IntakeWorkspace } from "../../src/pages/orders/model/order-intake";

const facts: IntakeFacts = { insurance_type: "private", insurance_provider: "Existing insurer", insurance_number: "1234",
  phone_primary: "+490000000", email: "patient@example.test", address_street: "Teststraße 1", address_city: "Berlin",
  address_zip: "10000", address_country: "DE", pep_contract_partner: null, pep_beneficial_owner: null,
  pep_office: "", pep_asset_origin: "", representative_name: "", representative_phone: "", representative_authority: "" };
async function setup(page: Page, language: "ru" | "de", resume = false, failLoad = false) {
  const state = { creates: 0, actions: [] as string[], failSave: false, failLoad, workspace: {
    order_id: "intake-qa", patient_id: "patient-intake-qa", order_number: "ORD-TEST-1", intake_state: "draft",
    revision: 0, data: emptyIntake(structuredClone(facts)), baseline_facts: structuredClone(facts), current_facts: structuredClone(facts),
    confirmed_facts: null, facts_confirmed_at: null, checks: [{ key: "single_order", status: "blocked", step: 4 }], current_document_ids: [],
  } as IntakeWorkspace };
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
  await sheet.locator("select").selectOption("contract-qa");
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
