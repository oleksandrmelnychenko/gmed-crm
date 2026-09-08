import { expect, test, type Page } from "@playwright/test";

async function mount(page: Page, params = "lang=ru") {
  await page.route("**/patients/patient-one/clinical", route => route.fulfill({ json: {
    medications: [{ status: "aktiv", on_hold: false, einnahme_von: null, einnahme_bis: null }],
  } }));
  await page.route("**/patients/patient-one/lab-results", route => route.fulfill({ json: { items: [] } }));
  await page.route("**/__clinical-documents-qa?*", route => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/tests/e2e/fixtures/patient-clinical-document-actions.tsx');
    </script></html>`,
  }));
  await page.goto(`/__clinical-documents-qa?${params}`);
}

for (const lang of ["ru", "de"]) {
  for (const width of [1440, 1024, 390, 320]) {
    test(`document actions fit ${lang} at ${width}px`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width, height: 600 });
      await mount(page, `lang=${lang}`);
      const group = page.getByRole("group", { name: /Медицинские документы|Medizinische Dokumente/ });
      const buttons = group.getByRole("button");
      await expect(buttons).toHaveCount(4);
      await expect(buttons.nth(1)).toBeDisabled();
      await expect(buttons.nth(2)).toBeEnabled();
      await expect(group.locator('[data-slot="pdf-file-icon"]')).toHaveCount(3);
      for (const index of [0, 1, 2]) {
        const icon = buttons.nth(index).locator('[data-slot="pdf-file-icon"]');
        await expect(icon).toHaveAttribute("aria-hidden", "true");
        await expect(icon).toHaveClass(/text-red-600/);
        await expect(icon).toHaveText("PDF");
      }
      await expect(buttons.nth(3).locator('[data-slot="pdf-file-icon"]')).toHaveCount(0);
      const boxes = await buttons.evaluateAll(nodes => nodes.map(node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      }));
      expect(boxes.every(box => box.x >= 0 && box.x + box.width <= width)).toBe(true);
      if (width === 1440) expect(new Set(boxes.map(box => box.y)).size).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("document-actions.png") });
      await buttons.nth(0).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: lang === "ru" ? "Отмена" : "Abbrechen", exact: true }).click();
      await buttons.nth(3).click();
      await expect(page.getByRole("status")).toHaveText("Scan opened");
      expect(errors).toEqual([]);
    });
  }
}

test("document actions retain permission boundaries without an empty island", async ({ page }) => {
  await mount(page, "clinical=false");
  await expect(page.getByRole("group").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button")).toContainText("Сканировать и распознать");
  await mount(page, "scan=false");
  await expect(page.getByRole("group").getByRole("button")).toHaveCount(3);
  await mount(page, "clinical=false&scan=false");
  await expect(page.getByRole("group")).toHaveCount(0);
});
