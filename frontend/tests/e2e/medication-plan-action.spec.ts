import { expect, test, type Page } from "@playwright/test";

const active = { status: "aktiv", on_hold: false, einnahme_von: null, einnahme_bis: null };
const button = (page: Page) => page.getByRole("button", { name: /Медикаментозный план|Medikationsplan/ });

async function mount(page: Page, lang = "ru") {
  await page.route("**/__medication-plan-qa?*", route => route.fulfill({
    contentType: "text/html",
    body: `<html><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/medication-plan-action.tsx');
    </script></html>`,
  }));
  await page.goto(`/__medication-plan-qa?lang=${lang}`);
}

async function clinicalUpdated(page: Page, patientId = "patient-one") {
  await page.evaluate((patient_id) => {
    window.dispatchEvent(new CustomEvent("gmed:realtime-event", {
      detail: { type: "patient.clinical_updated", patient_id },
    }));
  }, patientId);
}

test("disabled while loading; enables and disables after medication saves", async ({ page }) => {
  let medications: typeof active[] = [];
  let release: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { release = resolve; });
  let requests = 0;
  await page.route("**/patients/patient-one/clinical", async route => {
    requests += 1;
    if (requests === 1) await firstRequest;
    await route.fulfill({ json: { medications } });
  });
  await mount(page);
  await expect(button(page)).toBeDisabled();
  release!();
  await expect(button(page)).toHaveAttribute("title", "Нет актуальных препаратов для медикаментозного плана.");
  medications = [active];
  await clinicalUpdated(page);
  await expect(button(page)).toBeEnabled();
  medications = [{ ...active, on_hold: true }];
  await clinicalUpdated(page);
  await expect(button(page)).toHaveAttribute("title", "Нет актуальных препаратов для медикаментозного плана.");
  await expect(button(page)).toBeDisabled();
});

test("refreshes on focus and ignores updates to other patients", async ({ page }) => {
  let requests = 0;
  let medications: typeof active[] = [];
  await page.route("**/patients/patient-one/clinical", route => {
    requests += 1;
    return route.fulfill({ json: { medications } });
  });
  await mount(page, "de");
  await expect(button(page)).toHaveAttribute("title", "Keine aktuellen Medikamente für den Medikationsplan vorhanden.");
  const before = requests;
  await clinicalUpdated(page, "unrelated-patient");
  await page.waitForTimeout(400);
  expect(requests).toBe(before);
  medications = [active];
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(button(page)).toBeEnabled();
});

test("does not reuse availability when switching patients", async ({ page }) => {
  await page.route("**/patients/patient-one/clinical", route => route.fulfill({ json: { medications: [active] } }));
  await page.route("**/patients/patient-two/clinical", route => route.fulfill({ json: { medications: [] } }));
  await mount(page);
  await expect(button(page)).toBeEnabled();
  await page.getByRole("button", { name: "Switch patient" }).click();
  await expect(button(page)).toHaveAttribute("title", "Нет актуальных препаратов для медикаментозного плана.");
  await expect(button(page)).toBeDisabled();
});

test("a failed availability check allows a PDF retry; server empty response disables it", async ({ page }) => {
  await page.route("**/patients/patient-one/clinical", route => route.fulfill({ status: 500, json: { error: "unavailable" } }));
  let pdfRequests = 0;
  await page.route("**/patients/patient-one/medikationsplan.pdf?lang=ru", route => {
    pdfRequests += 1;
    return route.fulfill({ status: 422, json: { error: "medication_plan_empty" } });
  });
  await mount(page);
  await expect(button(page)).toBeEnabled();
  await button(page).click();
  await expect(button(page)).toHaveAttribute("title", "Нет актуальных препаратов для медикаментозного плана.");
  await expect(button(page)).toBeDisabled();
  expect(pdfRequests).toBe(1);
});

test("current medications still download the plan", async ({ page }) => {
  await page.route("**/patients/patient-one/clinical", route => route.fulfill({ json: { medications: [active] } }));
  await page.route("**/patients/patient-one/medikationsplan.pdf?lang=de", route => route.fulfill({
    contentType: "application/pdf", body: "%PDF-1.4 test fixture",
    headers: { "content-disposition": 'attachment; filename="medikationsplan.pdf"' },
  }));
  await mount(page, "de");
  await expect(button(page)).toBeEnabled();
  const download = page.waitForEvent("download");
  await button(page).click();
  expect((await download).suggestedFilename()).toBe("medikationsplan.pdf");
  await expect(button(page)).toBeEnabled();
});
