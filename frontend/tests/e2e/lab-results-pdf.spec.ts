import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const patientId = "patient-medication-test";

async function mount(page: Page, lang: "ru" | "de", empty = false) {
  await page.addInitScript((value) => {
    localStorage.setItem("gmed_lang", value);
    localStorage.setItem("gmed_access_token", "lab-results-test-token");
  }, lang);
  await page.routeWebSocket("**/api/v1/events/ws*", socket => socket.close());
  await page.route("**/api/v1/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path.endsWith("/clinical") ? {
      allergien: [], cave: [], diagnoses: [], medications: [], examinations: [], procedures: [], verlauf: [], narrative: null,
    } : path.endsWith("/lab-results") ? { items: empty ? [] : [{
      id: "lab-1", measured_at: "2026-09-01T10:30:00Z", measured_at_precision: "datetime",
      panel: "Blutbild", laboratory_name: "Labor München", analyte_name: "CRP", result_text: "<0,5",
      numeric_result: 0.5, comparator: "<", unit: "mg/L", reference_text: "0–5", reference_low: 0,
      reference_high: 5, interpretation_note: null, abnormal_flag: "normal", source_document_name: "labor.pdf",
      source_page: 1, created_at: "2026-09-01T10:31:00Z",
    }] } : /\/(vitals|risk-scores|medication-import-history)$/.test(path) ? { items: [] } : [];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/medication-plan-harness?*", route => route.fulfill({ contentType: "text/html", body: `
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/medication-plan-harness.tsx');
    </script></body></html>` }));
  await page.goto("/medication-plan-harness?view=clinical");
  return page.getByRole("button", {
    name: lang === "ru" ? "Лабораторные результаты (PDF)" : "Laborergebnisse (PDF)",
    exact: true,
  });
}

for (const lang of ["ru", "de"] as const) {
  test(`laboratory results PDF downloads from the laboratory section in ${lang}`, async ({ page }) => {
    const pdf = await readFile("public/demo/datev/demo-datev-001.pdf");
    const button = await mount(page, lang);
    await expect(button).toBeEnabled();
    let requests = 0;
    await page.route("**/lab-results.pdf?*", async route => {
      requests += 1;
      const url = new URL(route.request().url());
      expect(url.pathname).toBe(`/api/v1/patients/${patientId}/lab-results.pdf`);
      expect(url.searchParams.get("lang")).toBe(lang);
      expect(route.request().headers().authorization).toBe("Bearer lab-results-test-token");
      await route.fulfill({
        contentType: "application/pdf",
        headers: { "content-disposition": 'attachment; filename="laborergebnisse-TEST-001.pdf"' },
        body: pdf,
      });
    });
    const download = page.waitForEvent("download");
    await button.click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("laborergebnisse-TEST-001.pdf");
    expect(await readFile((await file.path())!)).toEqual(pdf);
    expect(requests).toBe(1);
  });
}

test("empty laboratory history does not offer an empty PDF", async ({ page }) => {
  const button = await mount(page, "de", true);
  await expect(button).toHaveCount(0);
});
