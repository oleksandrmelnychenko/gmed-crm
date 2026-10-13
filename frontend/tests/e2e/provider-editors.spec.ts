import { expect, test, type Page } from "@playwright/test";

const provider = {
  id: "provider-ui-qa", name: "Example Provider", provider_type: "non_medical",
  organization_level: "organization", is_active: true,
  created_at: "2026-10-01T09:00:00Z", updated_at: "2026-10-01T09:00:00Z",
  contacts: [], specializations: [], insurance_providers: [], children: [],
  linked_patients: [], interactions: [],
  doctors: [{ id: "contact-qa", name: "Alex Contact", first_name: "Alex", last_name: "Contact", languages: [], is_active: true, created_at: "2026-10-01T09:00:00Z" }],
  staff: [{ id: "staff-entry-qa", display_name: "Sam Staff", first_name: "Sam", last_name: "Staff", role: "staff", status: "active", is_active: true, created_at: "2026-10-01T09:00:00Z" }],
  services: [{ id: "service-qa", service_name: "Example service", description: "Synthetic service", price: "125.00", currency: "EUR", price_type: "fixed", valid_from: "2026-10-01", created_at: "2026-10-01T09:00:00Z" }],
};

async function openProvider(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "provider-editor-test");
  });
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") return route.fulfill({ json: {
      id: "staff-qa", email: "qa@example.org", name: "QA Staff", role: "ceo", created_at: provider.created_at,
    } });
    if (path === `/providers/${provider.id}`) return route.fulfill({ json: provider });
    if (path === "/providers") return route.fulfill({ json: [provider] });
    if (path === "/providers/taxonomy") return route.fulfill({ json: { nodes: [], leaves: [] } });
    if (path === "/providers/staff-roles") return route.fulfill({ json: [{
      id: "role-qa", code: "staff", name_en: "Staff", name_de: "Mitarbeiter", name_ru: "Сотрудник", is_active: true, sort_order: 1,
    }] });
    if (path.includes("financial-summary")) return route.fulfill({ status: 404, json: { error: "No finance fixture" } });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/providers/${provider.id}`);
}

test("existing provider records use the same editors and preserve unsaved-change protection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openProvider(page);
  for (const name of ["Alex Contact", "Sam Staff", "Example service"]) {
    const row = page.getByRole("row").filter({ hasText: name });
    await row.getByRole("button", { name: "Редактировать", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveCount(1);
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveClass(/bg-black\/40/);
    await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
    if (name === "Example service") {
      const serviceName = dialog.getByLabel("Название услуги", { exact: false });
      await expect(serviceName).toHaveValue(name);
      await serviceName.fill("Updated example service");
      await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toBeEnabled();
      await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(serviceName).toHaveValue("Updated example service");
      await serviceName.fill(name);
    }
    await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
});

for (const width of [1440, 390]) {
  test(`provider editors use bounded modals with full backdrops at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await openProvider(page);
    const editors = [
      { title: "Загрузить документ", slug: "upload" },
      { title: "Новый контакт", slug: "contact" },
      { title: "Новый сотрудник", slug: "staff" },
      { title: "Новая услуга", slug: "service" },
    ];
    for (const { title, slug } of editors) {
      await page.getByRole("button", { name: title, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("form")).toHaveCount(1);
      expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      const overlay = page.locator('[data-slot="dialog-overlay"]').last();
      await expect(overlay).toHaveClass(/bg-black\/40/);
      expect(await overlay.boundingBox()).toEqual({ x: 0, y: 0, width, height: width === 390 ? 844 : 1000 });
      const cancel = dialog.getByRole("button", { name: "Отмена", exact: true });
      await expect(cancel).toBeInViewport();
      await page.screenshot({ path: `../.tmp/release-audit/provider-${slug}-modal-${width}-20261013.png`, animations: "disabled" });
      await cancel.click();
      await expect(dialog).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}
