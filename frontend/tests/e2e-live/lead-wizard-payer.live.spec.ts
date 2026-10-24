import { expect, test, type Locator, type Page } from "@playwright/test";

import { pickerSection } from "../e2e/helpers";
import { bootstrapAndLogin } from "./support/live-helpers";

/**
 * Findings of the live staff walk-through of the lead wizard (2026-10-24),
 * against the real backend: "Кто платит" of a company payer and of a minor's
 * paying parent.
 */

async function useRussian(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem("gmed_lang", "ru"));
}

/** A NativeComboboxSelect: the button named by its label opens the option list. */
async function choose(page: Page, scope: Locator, label: RegExp, option: RegExp) {
  await scope.getByLabel(label).first().click();
  await page.getByRole("option", { name: option }).first().click();
}

async function openWizardStep(page: Page, leadId: string, step: RegExp) {
  await page.goto(`/leads?lead=${leadId}&view=wizard`);
  const wizard = page.getByRole("dialog").last();
  await wizard.getByRole("tab", { name: step }).first().click();
  await expect(wizard.getByRole("tab", { name: step }).first()).toHaveAttribute("aria-selected", "true");
  return wizard;
}

function payerSection(wizard: Locator) {
  return wizard.locator("section").filter({ has: wizard.page().getByText("Кто платит", { exact: true }) }).first();
}

test.describe("lead wizard: who pays (live QA 2026-10-24)", () => {
  test("a company payer is offered only an organisation's relationships", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await useRussian(page);
    const scenario = await bootstrapAndLogin(page, request, "pm");
    const wizard = await openWizardStep(page, scenario.leads.blocked.id, /^Документы/);
    const payer = payerSection(wizard);
    await payer.getByRole("radio", { name: /Платит третье лицо/ }).check();
    await choose(page, payer, /^Тип плательщика/, /^Компания$/);

    await payer.getByLabel(/^Кем приходится пациенту/).first().click();
    const options = page.getByRole("option");
    await expect(options.filter({ hasText: /^Работодатель$/ })).toHaveCount(1);
    await expect(options.filter({ hasText: /^Деловой партнёр$/ })).toHaveCount(1);
    await expect(options.filter({ hasText: /^Другое/ })).toHaveCount(1);
    await expect(options.filter({ hasText: /^(Супруг|Родитель|Сын|Брат|Бабушка|Друг \/|Другой родственник)/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test("a minor's paying parent is saved once chosen, without a refused save before", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await useRussian(page);
    await bootstrapAndLogin(page, request, "pm");
    const refused: string[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/payer-declaration") && response.status() >= 400) {
        refused.push(`${response.status()} ${response.url()}`);
      }
    });

    // A child under joint custody, created through the wizard's first step.
    await page.goto("/leads");
    await page.getByRole("button", { name: /Новый лид/ }).first().click();
    let wizard = page.getByRole("dialog").last();
    const suffix = Date.now().toString(36);
    await wizard.getByLabel(/^Имя\s*\*?$/).fill("Lina");
    await wizard.getByLabel(/^Фамилия\s*\*?$/).fill(`Elternzahlt ${suffix}`);
    await wizard.getByRole("spinbutton", { name: pickerSection.year }).first().fill("2016");
    await wizard.getByRole("spinbutton", { name: pickerSection.month }).first().fill("05");
    await wizard.getByRole("spinbutton", { name: pickerSection.day }).first().fill("04");
    await choose(page, wizard, /^Пол согласно документам/, /^Женский$/);
    await choose(page, wizard, /^Кто представляет ребёнка$/, /^Оба родителя совместно$/);
    const parents = wizard.locator("section").filter({ has: page.getByText("Родитель или законный представитель", { exact: true }) }).first();
    // Two parents: with one on file the wizard picks that one at once.
    for (const [name, relation] of [["Maria", /^Мать/], ["Paul", /^Отец/]] as const) {
      await parents.getByRole("button", { name: /^Добавить$/ }).click();
      const parentForm = page.getByRole("dialog").filter({ hasText: /Добавить родителя или законного представителя/ });
      await parentForm.getByLabel(/^Имя и фамилия/).fill(`${name} Elternzahlt ${suffix}`);
      await parentForm.getByLabel(/^E-Mail/).fill(`${name.toLowerCase()}.${suffix}@example.com`);
      await choose(page, parentForm, /^Кем приходится ребёнку/, relation);
      await parentForm.getByRole("button", { name: /^Добавить$/ }).click();
      await expect(parentForm).toBeHidden();
    }
    const [created] = await Promise.all([
      page.waitForResponse((response) => response.request().method() === "POST" && /\/api\/v1\/leads$/.test(new URL(response.url()).pathname)),
      wizard.getByRole("button", { name: /^Далее/ }).click(),
    ]);
    expect(created.ok(), await created.text()).toBe(true);
    const leadId = ((await created.json()) as { id: string }).id;

    wizard = await openWizardStep(page, leadId, /^Документы/);
    let payer = payerSection(wizard);
    await payer.getByRole("radio", { name: /Платит родитель/ }).check();
    await expect(payer.getByText(/Выберите, кто из родителей/)).toBeVisible();
    // Nothing is sent while no parent is chosen (it was a 422 and "Не сохранено").
    await page.waitForTimeout(1_500);
    expect(refused).toEqual([]);
    await expect(payer.getByRole("button", { name: /Повторить сохранение/ })).toHaveCount(0);

    const [saved] = await Promise.all([
      page.waitForResponse((response) => response.url().includes(`/leads/${leadId}/payer-declaration`) && response.request().method() !== "GET"),
      choose(page, payer, /^Кто из родителей \/ представителей платит/, new RegExp(`Maria Elternzahlt ${suffix}`)),
    ]);
    expect(saved.ok(), await saved.text()).toBe(true);

    wizard = await openWizardStep(page, leadId, /^Документы/);
    payer = payerSection(wizard);
    await expect(payer.getByRole("radio", { name: /Платит родитель/ })).toBeChecked();
    await expect(payer.getByText(`Maria Elternzahlt ${suffix}`).first()).toBeVisible();
    expect(refused).toEqual([]);
  });
});
