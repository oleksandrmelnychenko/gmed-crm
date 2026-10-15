import { expect, test } from "@playwright/test";

for (const lang of ["de", "ru"] as const) {
  for (const width of [1440, 390]) {
    test(`document and DEMO statuses fit every table density ${lang} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(language => {
        localStorage.setItem("gmed_lang", language);
        localStorage.setItem("gmed_access_token", "synthetic-status-test-token");
      }, lang);
      await page.routeWebSocket("**/api/**", socket => socket.close());
      await page.route("**/api/v1/**", route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/me")) return route.fulfill({ json: {
          id: "synthetic-status-user", role: "ceo", name: "Status QA", email: "qa@example.invalid",
        } });
        if (path.endsWith("/document-signatures/statuses")) return route.fulfill({ json:
          ["synthetic-active", "synthetic-archived"].map(document_id => ({
            document_id, test_mode: true, status: "completed", result_document_id: "synthetic-result",
          })),
        });
        return route.fulfill({ json: [] });
      });
      await page.route("**/__document-status-qa", route => route.fulfill({
        contentType: "text/html",
        body: `<html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module">
          import RefreshRuntime from '/@react-refresh';
          RefreshRuntime.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {};
          window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          import('/tests/e2e/fixtures/document-status-badges.tsx');
        </script></html>`,
      }));
      await page.goto("/__document-status-qa");
      for (const [density, rowHeight] of [["comfortable", 34], ["compact", 30], ["condensed", 26]] as const) {
        const table = page.getByTestId(`status-table-${density}`);
        await expect(table.locator('[data-testid="document-demo-signature-synthetic-active"]:visible')).toBeVisible();
        const cells = table.locator(width >= 640 ? '[role="cell"][data-column-id="status"]:visible' : 'article:visible');
        await expect(cells).toHaveCount(2);
        for (const cell of await cells.all()) {
          const geometry = await cell.evaluate(node => {
            const bounds = node.getBoundingClientRect();
            return {
              height: node.closest('[role="row"]')?.getBoundingClientRect().height ?? bounds.height,
              badges: [...node.querySelectorAll('[data-slot="badge"], [data-testid^="document-demo-signature-"]')].map(badge => {
                const rect = badge.getBoundingClientRect();
                return { top: rect.top - bounds.top, bottom: bounds.bottom - rect.bottom,
                  left: rect.left - bounds.left, right: bounds.right - rect.right };
              }),
            };
          });
          if (width >= 640) expect(geometry.height).toBe(rowHeight);
          expect(geometry.badges).toHaveLength(2);
          for (const badge of geometry.badges) {
            for (const margin of Object.values(badge)) expect(margin).toBeGreaterThanOrEqual(0);
          }
        }
      }
      await page.screenshot({ path: `../artifacts/design-qa/document-status-densities-${lang}-${width}.png` });
    });
  }
}
