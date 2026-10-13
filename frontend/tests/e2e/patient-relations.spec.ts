import { expect, test, type Page } from "@playwright/test";

async function openRelations(page: Page, readonly = false) {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "relations-test");
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/__patient-relations-qa**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/patient-relations.tsx');
    </script></html>`,
  }));
  await page.goto(`/__patient-relations-qa${readonly ? "?readonly" : ""}`);
}

test("relationship row opens its editor; row actions stay independent", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRelations(page);
  const row = page.getByRole("row").filter({ hasText: "Alex Example" });
  const dialog = page.getByRole("dialog", { name: "Редактировать связь", exact: true });
  await row.getByText("Alex Example").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Имя", { exact: true })).toHaveValue("Alex Example");
  await expect(dialog.locator("#relation-email")).toHaveValue("alex@example.org");
  await expect(dialog.getByRole("button", { name: "Отмена", exact: true })).toBeInViewport();
  await page.screenshot({ path: "../.tmp/release-audit/patient-relation-dialog-20261013.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await row.focus();
  await row.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await row.getByRole("button", { name: "Редактировать", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await row.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByTestId("relation-action")).toHaveText("delete");
  await expect(dialog).toHaveCount(0);
  await row.getByRole("button", { name: "Открыть пациента", exact: true }).click();
  await expect(page.getByTestId("relation-action")).toHaveText("open-patient");
  await expect(dialog).toHaveCount(0);
});

test("relationship modal fits a narrow viewport with full backdrop and reachable footer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRelations(page);
  await page.getByText("Alex Example", { exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Редактировать связь", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  const overlay = page.locator('[data-slot="dialog-overlay"]').last();
  const bounds = await overlay.boundingBox();
  expect(bounds).toEqual({ x: 0, y: 0, width: 390, height: 844 });
  await expect(overlay).toHaveClass(/bg-black\/40/);
  const notes = dialog.locator("#relation-notes");
  await notes.scrollIntoViewIfNeeded();
  await expect(notes).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Сохранить", exact: true })).toBeInViewport();
});

test("relationship rows remain read-only without manage permission", async ({ page }) => {
  await openRelations(page, true);
  const row = page.getByRole("row").filter({ hasText: "Alex Example" });
  await row.getByText("Alex Example").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Редактировать", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "Удалить", exact: true })).toHaveCount(0);
});
