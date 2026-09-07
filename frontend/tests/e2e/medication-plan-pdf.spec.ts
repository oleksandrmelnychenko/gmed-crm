import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function mount(page: Page, lang: "ru" | "de", view = "overview", empty = false) {
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "medication-test-token");
  }, lang);
  await page.routeWebSocket("**/api/v1/events/ws*", socket => {
    socket.send(JSON.stringify({type: "realtime.connected", entity_type: "realtime", entity_id: "tester"}));
  });
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/clinical") ? {
      allergien: [], cave: [], diagnoses: [], examinations: [], procedures: [], verlauf: [], narrative: null,
      medications: empty ? [] : [{ id: "med-1", category: "dauer", wirkstoff: "Wirkstoff Beispiel", handelsname: "Beispiel Medikament",
        form: "TABL", status: "aktiv", on_hold: false, dose_morgens: "1/2", dose_abends: "1", einnahme_bis: null }],
    } : /\/(vitals|lab-results|risk-scores|medication-import-history)$/.test(path) ? { items: [] } : [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/medication-plan-harness?*", route => route.fulfill({ contentType: "text/html", body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/medication-plan-harness.tsx');
    </script></body></html>` }));
  await page.goto(`/medication-plan-harness?view=${view}`);
  return page.getByRole("button", { name: lang === "ru" ? "Медикаментозный план (PDF)" : "Medikationsplan (PDF)", exact: true });
}

for (const lang of ["ru", "de"] as const) {
  test(`medication PDF action downloads above overview and clinical content in ${lang}`, async ({page}) => {
    const pdf = await readFile("public/demo/datev/demo-datev-001.pdf");
    for (const view of ["overview", "clinical"]) {
      await page.setViewportSize({width: view === "overview" ? 1440 : 390, height: 1000});
      const button = await mount(page, lang, view);
      await expect(button).toBeEnabled();
      let requests = 0;
      await page.route("**/medikationsplan.pdf?*", async route => {
        requests += 1;
        expect(new URL(route.request().url()).searchParams.get("lang")).toBe(lang);
        expect(route.request().headers().authorization).toBe("Bearer medication-test-token");
        expect(route.request().url()).toContain("/patients/patient-medication-test/");
        await route.fulfill({ contentType: "application/pdf", headers: { "content-disposition": 'attachment; filename="medikationsplan-TEST-001.pdf"' }, body: pdf });
      });
      const downloaded = page.waitForEvent("download");
      await button.click();
      const file = await downloaded;
      expect(file.suggestedFilename()).toBe("medikationsplan-TEST-001.pdf");
      expect(await readFile((await file.path())!)).toEqual(pdf);
      expect(requests).toBe(1);
      await expect(button).toBeEnabled();
      await button.scrollIntoViewIfNeeded();
      await page.screenshot({path: `../artifacts/design-qa/medication-plan-${lang}-${view}.png`});
    }
  });
}

test("PDF export prevents duplicate requests and recovers after an error", async ({page}) => {
  const button = await mount(page, "ru");
  let finish!: () => void;
  const wait = new Promise<void>(resolve => {finish = resolve;});
  let requests = 0;
  await page.route("**/medikationsplan.pdf?*", async route => {
    requests += 1;
    await wait;
    await route.fulfill({status: 500, contentType: "application/json", body: '{"error":"internal detail"}'});
  });
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-busy", "true");
  finish();
  await expect(page.getByText("Не удалось сформировать медикаментозный план. Повторите попытку.")).toBeVisible();
  await expect(button).toBeEnabled();
  expect(requests).toBe(1);
  await page.route("**/medikationsplan.pdf?*", route => route.fulfill({status: 422, contentType: "application/json", body: '{"error":"Unprocessable Entity","message":"medication_plan_empty"}'}));
  await button.click();
  await expect(page.getByText("Нет актуальных препаратов для медикаментозного плана.")).toBeVisible();
  await expect(button).toBeEnabled();
});

test("medication PDF action explains when the patient has no current medications", async ({page}) => {
  const button = await mount(page, "de", "overview", true);
  await page.route("**/medikationsplan.pdf?*", route => route.fulfill({status: 422, contentType: "application/json", body: '{"error":"Unprocessable Entity","message":"medication_plan_empty"}'}));
  await button.click();
  await expect(page.getByText("Keine aktuellen Medikamente für den Medikationsplan vorhanden.")).toBeVisible();
  await expect(button).toBeEnabled();
});
