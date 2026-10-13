import { expect, test, type Page } from "@playwright/test";

async function mount(page: Page) {
  let symptoms: unknown[] = [];
  await page.route("**/patients/patient-modal-qa/symptoms", async route => {
    if (route.request().method() === "POST") {
      symptoms = route.request().postDataJSON().items;
      await route.fulfill({ json: { ok: true, count: symptoms.length } });
    } else {
      await route.fulfill({ json: { items: symptoms } });
    }
  });
  await page.route("**/patients/patient-modal-qa/pain", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/__patient-clinical-editors", route => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/patient-clinical-editors.tsx');
    </script></html>`,
  }));
  await page.goto("/__patient-clinical-editors");
}

test("symptoms create and edit retain saving and dirty dismissal in a centered modal", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);
  await page.getByRole("button", { name: "Добавить", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("data-slot", "dialog-content");
  await expect(dialog.getByRole("heading", { name: "Новый симптом" })).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 720)).toBeLessThan(2);
  await page.screenshot({ path: testInfo.outputPath("patient-symptom-modal.png") });
  await dialog.getByLabel("Описание", { exact: true }).fill("Synthetic symptom");
  await dialog.getByRole("button", { name: "Добавить", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByText("Synthetic symptom", { exact: true }).first().click();
  const save = dialog.getByRole("button", { name: "Сохранить изменения" });
  await expect(save).toBeDisabled();
  await dialog.getByLabel("Описание", { exact: true }).fill("Unsaved symptom");
  await expect(save).toBeEnabled();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByLabel("Описание", { exact: true })).toHaveValue("Unsaved symptom");
});

test("pain and vitals use bounded mobile modals with a full backdrop and reachable footer", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 720 });
  await mount(page);
  await page.getByRole("button", { name: "Добавить", exact: true }).nth(1).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAttribute("data-slot", "dialog-content");
  await expect(dialog.getByRole("heading", { name: "Новая запись о боли" })).toBeVisible();
  const backdrop = page.locator('[data-slot="dialog-overlay"]');
  const box = await backdrop.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 390, height: 720 });
  await expect(backdrop).toHaveCSS("background-color", /rgba\(0, 0, 0, 0\.4\)|oklab\(0 0 0 \/ 0\.4\)/);
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await dialog.getByLabel("Локализация", { exact: true }).fill("Synthetic location");
  await expect(dialog.getByRole("button", { name: "Добавить", exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("patient-pain-modal.png") });
  await dialog.getByLabel("Локализация", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open vitals" }).click();
  await expect(dialog).toHaveAttribute("data-slot", "dialog-content");
  await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toBeInViewport();
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});
