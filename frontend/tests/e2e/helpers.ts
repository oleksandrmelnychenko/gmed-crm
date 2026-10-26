import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The instant the browser clock of a date-sensitive spec starts at; the clock
 * runs on from there. The mocks date their deadlines, link expiries and slots
 * around it (retention deadline 19.10.2026, payer link until 05.11.2026, …),
 * so no spec breaks as real time passes, around midnight, or in another time
 * zone. The app's "today" is the Europe/Berlin date of this clock: 12.10.2026.
 */
export const E2E_NOW = new Date("2026-10-12T10:00:00+02:00");

/** Starts the browser clock at `now` (default {@link E2E_NOW}); call before `page.goto`. */
export async function startClockAt(page: Page, now: Date = E2E_NOW) {
  await page.clock.setSystemTime(now);
}

/**
 * Checks a radio that is visually hidden inside its label (segmented controls and
 * radio cards, owner UI polish 2026-10-27): the radio itself is not hit-testable, so
 * the visible label is clicked, as a person would, and the radio must end up checked.
 */
export async function checkLabelledRadio(radio: Locator) {
  await radio.locator("xpath=ancestor::label[1]").click();
  await expect(radio).toBeChecked();
}

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
