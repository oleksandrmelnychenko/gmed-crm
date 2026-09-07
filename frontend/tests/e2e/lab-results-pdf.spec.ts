import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const patientId = "patient-medication-test";

async function mount(page: Page, lang: "ru" | "de", empty = false, view = "clinical") {
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
  await page.goto(`/medication-plan-harness?view=${view}`);
  return page.getByRole("button", {
    name: lang === "ru" ? "Лабораторные результаты (PDF)" : "Laborergebnisse (PDF)",
    exact: true,
  });
}

for (const lang of ["ru", "de"] as const) {
 for (const view of ["clinical", "lab-header"]) {
  test(`laboratory results PDF downloads from ${view} in ${lang}`, async ({ page }) => {
    const pdf = await readFile("public/demo/datev/demo-datev-001.pdf");
    const button = await mount(page, lang, false, view);
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
}

test("empty laboratory history does not offer an empty PDF", async ({ page }) => {
  const button = await mount(page, "de", true);
  await expect(button).toHaveCount(0);
});

test("header export is disabled for an empty history and updates when results change", async ({ page }) => {
  const button = await mount(page, "ru", true, "lab-header");
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("title", "У пациента пока нет сохранённых результатов анализов.");
  let items: unknown[] = [{ id: "new-result" }];
  await page.route("**/lab-results", route => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ items }),
  }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(button).toBeEnabled();
  items = [];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(button).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("header export reports empty data as information and keeps server failures retryable", async ({ page }) => {
  const button = await mount(page, "ru", false, "lab-header");
  await expect(button).toBeEnabled();
  await page.route("**/lab-results.pdf?*", route => route.fulfill({
    status: 500, contentType: "application/json", body: '{"error":"Internal Server Error"}',
  }));
  await button.click();
  const error = page.getByRole("alert").filter({ hasText: "Не удалось сформировать лабораторный отчёт." });
  await expect(error).toBeVisible();
  await expect(button).toBeEnabled();
  await error.getByRole("button").click();

  await page.route("**/lab-results.pdf?*", route => route.fulfill({
    status: 422, contentType: "application/json", body: '{"message":"lab_results_empty","error":"Unprocessable Entity"}',
  }));
  await button.click();
  await expect(page.getByRole("status").filter({ hasText: "У пациента пока нет сохранённых результатов анализов." })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(button).toBeDisabled();
});
