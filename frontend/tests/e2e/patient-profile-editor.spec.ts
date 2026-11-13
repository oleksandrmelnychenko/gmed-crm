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
      // DSGVO consent and the confidentiality release are read-only here.
      for (const name of lang === "de"
        ? ["DSGVO unterschrieben", "Schweigepflicht freigegeben"]
        : ["DSGVO подписано", "Снятие врачебной тайны"]) {
        await expect(sheet.getByRole("checkbox", { name, exact: true })).toBeDisabled();
      }
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
      // DSGVO consent and the confidentiality release follow signed documents
      // only (owner decision 2026-10-12): the editor never sends them.
      expect(savedBody?.legal_status).not.toHaveProperty("dsgvo_signed");
      expect(savedBody?.legal_status).not.toHaveProperty("confidentiality_release_signed");
      expect(errors).toEqual([]);
    });
  }
}

test("saving a minor's profile preserves the linked mother and her e-mail-only contact", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "profile-editor-test");
  });
  const relation = {
    id: "relation-mother", patient_id: "patient-profile-qa", related_patient_id: "patient-mother",
    related_name: "Anna Muster", related_display_name: "Anna Muster", relation_type: "mother",
    is_emergency_contact: true, email: "anna@example.test", phone: null, notes: null,
  };
  let savedRelation: Record<string, unknown> | undefined;
  await page.route("**/api/v1/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/relations")) return route.fulfill({ json: [relation] });
    if (url.endsWith("/relations/relation-mother/update")) {
      savedRelation = route.request().postDataJSON();
      return route.fulfill({ json: { ...relation, ...savedRelation } });
    }
    if (url.endsWith("/patients/patient-profile-qa/update")) return route.fulfill({ json: { id: "patient-profile-qa" } });
    return route.fulfill({ json: [] });
  });
  await page.route("**/__patient-profile-editor-qa**", route => route.fulfill({
    contentType: "text/html",
    body: `<html><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/patient-profile-editor.tsx');
    </script></html>`,
  }));
  await page.goto("/__patient-profile-editor-qa?minor=1");
  const sheet = page.getByRole("dialog", { name: "Редактировать профиль пациента", exact: true });
  await expect(sheet.locator('input[value="anna@example.test"]')).toHaveCount(1);
  await sheet.locator('input[value="Alex"]').fill("Alexandra");
  await sheet.getByRole("button", { name: "Сохранить пациента", exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(savedRelation).toMatchObject({
    relation_type: "mother", email: "anna@example.test", phone: null,
  });
  expect(savedRelation).not.toHaveProperty("related_patient_id");
});

// Owner 2026-11-13: recognition wherever ID data are typed — the patient card's
// passport number and "valid until" too, as a proposal staff confirm.
test("the profile editor reads the patient's passport scan as a proposal", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "profile-editor-test");
  });
  const recognitions: string[] = [];
  let savedBody: Record<string, unknown> | undefined;
  await page.route("**/api/v1/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/patients/patient-profile-qa/documents")) {
      return route.fulfill({ json: [
        { id: "scan-passport", filename: "pass.pdf", art: "identity", category: "identity", created_at: "2026-11-01T08:00:00Z" },
        { id: "scan-payer", filename: "payer.pdf", art: "payer_identity", category: "identity", created_at: "2026-11-01T08:00:00Z" },
      ] });
    }
    const recognition = url.match(/\/documents\/([^/]+)\/identity-recognition$/);
    if (recognition) {
      recognitions.push(recognition[1]);
      // Synthetic values (the ICAO specimen with a real country code).
      return route.fulfill({ json: {
        status: "verified",
        format: "TD3",
        checks: { document_number: true, birth_date: true, valid_until: true, composite: true },
        names_truncated: false,
        document: { id_document_type: "passport", id_document_number: "L898902C3", id_issuing_country: "UA", id_valid_until: "2031-04-15" },
        holder: { last_name: "Beispiel", first_name: "Alex", date_of_birth: "1976-07-06", legal_sex: "male", citizenship: "UA" },
      } });
    }
    if (url.endsWith("/patients/patient-profile-qa/update")) {
      savedBody = route.request().postDataJSON();
      return route.fulfill({ json: { id: "patient-profile-qa" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/__patient-profile-editor-qa**", route => route.fulfill({
    contentType: "text/html",
    body: `<html><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/patient-profile-editor.tsx');
    </script></html>`,
  }));
  await page.goto("/__patient-profile-editor-qa");
  const sheet = page.getByRole("dialog", { name: "Редактировать профиль пациента", exact: true });
  // One own scan and empty fields: the reading starts by itself; the payer's copy is never offered.
  const proposal = sheet.getByTestId("patient-profile-id-recognition-proposal");
  await expect(proposal).toBeVisible();
  expect(recognitions).toEqual(["scan-passport"]);
  // Only the fields the card has: no type, no country.
  await expect(proposal).toContainText("L898902C3");
  await expect(proposal).toContainText("15.04.2031");
  await expect(proposal).not.toContainText("Страна выдачи");
  // Nothing is taken before the confirmation.
  await expect(sheet.locator('input[value="L898902C3"]')).toHaveCount(0);
  await sheet.getByTestId("patient-profile-id-recognition-apply").click();
  await expect(sheet.locator('input[value="L898902C3"]')).toHaveCount(1);
  await sheet.getByRole("button", { name: "Сохранить пациента", exact: true }).click();
  await expect(sheet).toBeHidden();
  expect(savedBody).toMatchObject({ passport_number: "L898902C3", passport_expiry: "2031-04-15" });
});
