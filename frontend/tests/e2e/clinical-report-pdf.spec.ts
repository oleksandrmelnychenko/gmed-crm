import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const patientId = "91c88f4c-6b3d-4af2-a8b1-066b178a6701";
async function prepare(page: Page, lang: "ru" | "de", role = "ceo") {
  await page.addInitScript(lang => {
    localStorage.setItem("gmed_access_token", "clinical-report-test-token");
    localStorage.setItem("gmed_refresh_token", "clinical-report-test-refresh");
    localStorage.setItem("gmed_lang", lang);
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") body = {id:"report-user", email:"report@example.org", name:"Report test", role, created_at:"2026-01-01T00:00:00Z"};
    if (path === "/auth/refresh") body = {access_token:"clinical-report-test-token", refresh_token:"clinical-report-test-refresh", expires_in:900};
    if (path === "/stats/overview") body = {};
    if (path.endsWith("/account-statement")) body = {summary:{calculated_balance:"0", closing_balance:"0", balance_side:"settled"}, entries:[]};
    if (path === "/documents/meta/categories") body = {categories:[], arts:[]};
    if (path === "/documents/templates") body = {templates:[], text_blocks:[]};
    if (path === "/patients/" + patientId) body = {
      id:patientId, patient_id:"P-DEMO-REPORT", first_name:"Anna", last_name:"Beispiel",
      birth_date:"1974-03-12", gender:"female", is_active:true, languages:["de"],
      functional_labels:[], created_at:"2026-08-01T00:00:00Z",
    };
    if (path.endsWith("/clinical")) body = {diagnoses:[], medications:[], examinations:[], procedures:[], allergien:[], cave:[], verlauf:[], narrative:null};
    if (/\/(vitals|lab-results|risk-scores|card-entries|medical-orders|clinical-document-imports)$/.test(path)) body = {items:[]};
    await route.fulfill({json:body});
  });
  await page.goto("/patients/" + patientId);
  await expect(page.getByRole("heading", {name:"Anna Beispiel",exact:true})).toBeVisible();
  return page.getByRole("button", {name:lang === "ru" ? "Медицинская сводка (PDF)" : "Medizinische Zusammenfassung (PDF)",exact:true});
}

for (const lang of ["ru", "de"] as const) {
  test("clinical report lets the user select sections and downloads in " + lang, async ({page}) => {
    const pdf = await readFile("public/demo/datev/demo-datev-001.pdf");
    const button = await prepare(page, lang);
    await expect(button).toBeEnabled();
    let requests = 0;
    await page.route("**/clinical.pdf?*", async route => {
      requests++;
      expect(route.request().headers().authorization).toBe("Bearer clinical-report-test-token");
      expect(new URL(route.request().url()).pathname).toBe("/api/v1/patients/" + patientId + "/clinical.pdf");
      expect(new URL(route.request().url()).searchParams.get("lang")).toBe(lang);
      expect(new URL(route.request().url()).searchParams.get("sections")).toBe("diagnoses,procedures");
      await route.fulfill({contentType:"application/pdf", headers:{"content-disposition":'attachment; filename="medizinische-zusammenfassung-P-DEMO-REPORT.pdf"'}, body:pdf});
    });
    await button.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", {name:lang === "ru" ? "Состав медицинской сводки" : "Inhalt der medizinischen Zusammenfassung"})).toBeVisible();
    await dialog.getByRole("button", {name:lang === "ru" ? "Снять выбор" : "Auswahl aufheben"}).click();
    await expect(dialog.getByRole("button", {name:lang === "ru" ? "Скачать PDF" : "PDF herunterladen"})).toBeDisabled();
    await dialog.getByRole("checkbox", {name:lang === "ru" ? "Диагнозы" : "Diagnosen"}).check({force:true});
    await dialog.getByRole("checkbox", {name:lang === "ru" ? "Процедуры" : "Prozeduren"}).check({force:true});
    await page.screenshot({path:`../artifacts/design-qa/clinical-report-dialog-${lang}-${page.viewportSize()?.width}.png`});
    const download = page.waitForEvent("download");
    await dialog.getByRole("button", {name:lang === "ru" ? "Скачать PDF" : "PDF herunterladen"}).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("medizinische-zusammenfassung-P-DEMO-REPORT.pdf");
    expect(await readFile((await file.path())!)).toEqual(pdf);
    expect(requests).toBe(1);
    await expect(button).toBeEnabled();
  });
}

test("clinical report prevents concurrent export and permits retry after failure", async ({page}) => {
  const button = await prepare(page, "ru");
  let finish!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; });
  let requests = 0;
  await page.route("**/clinical.pdf?*", async route => {
    requests++;
    await waiting;
    await route.fulfill({status:500, json:{error:"internal"}});
  });
  await button.click();
  const dialog = page.getByRole("dialog");
  const downloadButton = dialog.getByRole("button", {name:"Скачать PDF"});
  await downloadButton.click();
  await expect(downloadButton).toBeDisabled();
  await expect(downloadButton).toHaveAttribute("aria-busy", "true");
  finish();
  await expect(page.getByText("Не удалось сформировать медицинскую сводку. Повторите попытку.")).toBeVisible();
  await expect(downloadButton).toBeEnabled();
  expect(requests).toBe(1);
  const pdf = await readFile("public/demo/datev/demo-datev-001.pdf");
  await page.route("**/clinical.pdf?*", route => route.fulfill({contentType:"application/pdf", body:pdf}));
  const retry = page.waitForEvent("download");
  await downloadButton.click();
  expect((await retry).suggestedFilename()).toBe("medizinische-zusammenfassung.pdf");
});

test("patient reader without clinical permission cannot export the report", async ({page}) => {
  const button = await prepare(page, "de", "concierge");
  await expect(button).toHaveCount(0);
});
