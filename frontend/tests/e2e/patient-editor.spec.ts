import { expect, test } from "@playwright/test";

for (const lang of ["ru", "de"]) {
  for (const width of [1440, 390]) {
    test(`patient editor style and saved changes ${lang} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.addInitScript(language => {
        localStorage.setItem("gmed_lang", language);
        localStorage.setItem("gmed_access_token", "patient-editor-test");
      }, lang);
      let rejectSave = true;
      const saveError = lang === "de" ? "Änderungen konnten nicht gespeichert werden. Bitte erneut versuchen." : "Не удалось сохранить изменения. Повторите попытку.";
      let savedBody: Record<string, unknown> | undefined;
      await page.route("**/api/v1/**", async route => {
        if (route.request().url().endsWith("/patients/patient-editor-qa/update")) {
          savedBody = route.request().postDataJSON();
          return route.fulfill(rejectSave
            ? { status: 422, json: { error: saveError } }
            : { json: { id: "patient-editor-qa" } });
        }
        return route.fulfill({ json: [] });
      });
      await page.route("**/__patient-editor-qa", route => route.fulfill({
        contentType: "text/html",
        body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          await import('/tests/e2e/fixtures/patient-editor.tsx');
        </script></html>`,
      }));
      await page.goto("/__patient-editor-qa");
      const sheet = page.getByRole("dialog", { name: "Alex Beispiel", exact: true });
      const save = sheet.getByRole("button", { name: lang === "de" ? "Patient speichern" : "Сохранить пациента", exact: true });
      const cancel = sheet.getByRole("button", { name: lang === "de" ? "Abbrechen" : "Отмена", exact: true });
      await expect(save).toBeDisabled();
      await expect(sheet.locator('input[value="Alex"]')).toBeVisible();
      await page.screenshot({ path: `../artifacts/design-qa/patient-editor-${lang}-${width}.png`, animations: "disabled" });
      expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await sheet.getByRole("heading", { name: lang === "de" ? "Kontakt" : "Контакты", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../artifacts/design-qa/patient-editor-contacts-${lang}-${width}.png`, animations: "disabled" });
      await sheet.locator("textarea").last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../artifacts/design-qa/patient-editor-bottom-${lang}-${width}.png`, animations: "disabled" });
      await cancel.click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Open editor", exact: true }).click();
      const name = sheet.locator('input[value="Alex"]');
      await name.fill("Alexandra");
      await expect(save).toBeEnabled();
      await cancel.click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(sheet).toBeVisible();
      await sheet.locator('input[value="Alexandra"]').fill("Alex");
      await expect(save).toBeDisabled();
      await name.fill("Alexandra");
      await save.click();
      await expect(sheet.getByRole("alert")).toContainText(saveError);
      const alertBounds = await sheet.getByRole("alert").boundingBox();
      expect(alertBounds && alertBounds.y + alertBounds.height).toBeLessThanOrEqual(width === 390 ? 844 : 1000);
      await page.screenshot({ path: `../artifacts/design-qa/patient-editor-footer-${lang}-${width}.png`, animations: "disabled" });
      rejectSave = false;
      await save.click();
      await expect(save).toBeDisabled();
      await expect(sheet.getByRole("alert")).toHaveCount(0);
      expect(savedBody?.first_name).toBe("Alexandra");
      expect((savedBody?.contacts as unknown[]).length).toBe(3);
      await cancel.click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(errors).toEqual([]);
    });
  }
}
