import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Accessible names of the sections of an MUI date/time field. The pickers
 * speak the UI language (Russian or German), so these match both.
 */
export const pickerSection = {
  day: /^(День|Tag)$/,
  month: /^(Месяц|Monat)$/,
  year: /^(Год|Jahr)$/,
  hours: /^(Часы|Stunden)$/,
  minutes: /^(Минуты|Minuten)$/,
} as const;

/**
 * The value input of an MUI date/time field. The field's name sits on the
 * group of spin buttons; the value lives in the hidden input inside it.
 */
export function pickerValueInput(scope: Page | Locator, name: string | RegExp): Locator {
  return scope.getByRole("group", { name }).locator("input");
}

export async function chooseComboboxOption(
  page: Page,
  combobox: Locator,
  optionName: RegExp | string,
) {
  await expect(combobox).toBeVisible();
  await combobox.click();

  // Only visible candidates: list pages keep a hidden mobile card list (role="listitem") that
  // can contain the same text as the option.
  const option = page
    .getByRole("option", { name: optionName })
    .or(page.getByRole("listitem", { name: optionName }))
    .or(page.locator('[role="option"], [role="listitem"], [data-highlighted]').filter({ hasText: optionName }))
    .filter({ visible: true })
    .first();

  await expect(option).toBeVisible();
  await option.click();
}
