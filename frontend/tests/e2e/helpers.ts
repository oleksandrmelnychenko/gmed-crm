import { expect, type Locator, type Page } from "@playwright/test";

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
