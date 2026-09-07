import { expect, test } from "@playwright/test";

for (const scenario of [
  { lang: "ru", hours: 2, width: 1600, compact: false },
  { lang: "de", hours: 15, width: 1024, compact: false },
  { lang: "ru", hours: 15, width: 390, compact: false },
  { lang: "de", hours: 2, width: 800, compact: true },
]) {
  test(`recorded work-type range is not multiplied: ${JSON.stringify(scenario)}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    // Isolate the real shared table; no lead or financial records are changed.
    await page.route("**/api/v1/**", route => route.abort());
    await page.route("**/__work-types-qa?*", route => route.fulfill({
      contentType: "text/html",
      body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        await import('/tests/e2e/fixtures/work-types-summary.tsx');
      </script></html>`,
    }));
    await page.setViewportSize({ width: scenario.width, height: 800 });
    await page.goto(`/__work-types-qa?lang=${scenario.lang}&hours=${scenario.hours}&compact=${scenario.compact}`);
    const summary = page.getByTestId("work-types-summary");
    await expect(summary).toContainText(/250,00\s+–\s+1[.\s]000,00 EUR/);
    await expect(summary).not.toContainText(/EUR\/|2[.\s]000,00|3[.\s]750,00|15[.\s]000,00/);
    await expect(summary.locator('[data-column-id="rate"]')).toHaveCount(0);
    await expect(summary).not.toContainText(scenario.lang === "ru" ? "Итого:" : "Gesamt:");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await summary.screenshot({ path: testInfo.outputPath("work-types.png") });
    expect(errors).toEqual([]);
  });
}
