import { expect, test } from "@playwright/test";

for (const lang of ["ru", "de"]) {
  for (const width of [1440, 390]) {
    test(`patient profile editor layout and save feedback ${lang} ${width}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      const height = width === 390 ? 844 : 1000;
      await page.setViewportSize({ width, height });
      await page.addInitScript(language => {
        localStorage.setItem("gmed_lang", language);
        localStorage.setItem("gmed_access_token", "profile-editor-test");
      }, lang);
      let rejectSave = true;
      let savedBody: Record<string, unknown> | undefined;
      const saveError = lang === "de" ? "Speichern fehlgeschlagen. Bitte erneut versuchen." : "Не удалось сохранить изменения. Повторите попытку.";
      await page.route("**/api/v1/**", async route => {
        if (route.request().url().endsWith("/patients/patient-profile-qa/update")) {
          savedBody = route.request().postDataJSON();
          return route.fulfill(rejectSave ? { status: 422, json: { error: saveError } } : { json: { id: "patient-profile-qa" } });
        }
        return route.fulfill({ json: [] });
      });
      await page.route("**/__patient-profile-editor-qa", route => route.fulfill({
        contentType: "text/html",
        body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => (type) => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          await import('/tests/e2e/fixtures/patient-profile-editor.tsx');
        </script></html>`,
      }));
      await page.goto("/__patient-profile-editor-qa");
      const sheet = page.getByRole("dialog", { name: lang === "de" ? "Patientenprofil bearbeiten" : "Редактировать профиль пациента", exact: true });
      const save = sheet.getByRole("button", { name: lang === "de" ? "Patient speichern" : "Сохранить пациента", exact: true });
      const cancel = sheet.getByRole("button", { name: lang === "de" ? "Abbrechen" : "Отмена", exact: true });
      await expect(save).toBeDisabled();
      const birthDate = sheet.locator('input[value="06.07.1976"]');
      await expect(birthDate).toBeVisible();
      expect((await sheet.getByRole("group").first().boundingBox())!.width).toBeGreaterThan(190);
      expect(await sheet.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: `../artifacts/design-qa/patient-profile-editor-${lang}-${width}.png`, animations: "disabled" });
      await sheet.getByRole("heading", { name: lang === "de" ? "Kontakt" : "Контакты", exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../artifacts/design-qa/patient-profile-editor-contacts-${lang}-${width}.png`, animations: "disabled" });
      await sheet.locator("textarea").last().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../artifacts/design-qa/patient-profile-editor-bottom-${lang}-${width}.png`, animations: "disabled" });
      await cancel.click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await page.getByRole("button", { name: "Open profile editor" }).click();
      await sheet.locator('input[value="Alex"]').fill("Alexandra");
      await expect(save).toBeEnabled();
      await cancel.click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await sheet.locator('input[value="Alexandra"]').fill("Alex");
      await expect(save).toBeDisabled();
      await sheet.locator('input[value="Alex"]').fill("Alexandra");
      await sheet.locator("textarea").last().scrollIntoViewIfNeeded();
      await save.click();
      await expect(sheet.getByRole("alert")).toContainText(saveError);
      const bounds = await sheet.getByRole("alert").boundingBox();
      expect(bounds && bounds.y + bounds.height).toBeLessThanOrEqual(height);
      await page.screenshot({ path: `../artifacts/design-qa/patient-profile-editor-footer-${lang}-${width}.png`, animations: "disabled" });
      rejectSave = false;
      await save.click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByRole("status", { name: "" }).filter({ hasText: "Profile saved" })).toBeVisible();
      expect(savedBody).toMatchObject({ first_name: "Alexandra", birth_date: "1976-07-06", languages: ["de", "uk", "en"] });
      expect(savedBody?.contacts).toHaveLength(2);
      expect(errors).toEqual([]);
    });
  }
}
