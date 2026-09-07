import { expect, test } from "@playwright/test";

for (const lang of ["ru", "de"] as const) {
  for (const width of [390, 1440]) {
    test(`manual delivery and acknowledgement are separate ${lang} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.clock.install();
      await page.addInitScript(value => { localStorage.setItem("gmed_lang", value); localStorage.setItem("gmed_access_token", "fixture-token"); }, lang);
      const commands: unknown[] = [];
      let state: { sent: unknown; acknowledged: unknown; can_record: boolean } = { sent: null, acknowledged: null, can_record: true };
      await page.route("**/api/v1/**", async route => {
        expect(new URL(route.request().url()).pathname).toBe("/api/v1/documents/review-fixture/review-status");
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON(); commands.push(body);
          const event = { id: "sent-event", at: "2026-09-07T14:00:00Z", by: "Test Manager", test_mode: false, automatic: false };
          if (body.kind === "sent") state = { ...state, sent: event };
          else state = { ...state, acknowledged: event };
        }
        await route.fulfill({ json: state });
      });
      await page.route("**/__document-review", route => route.fulfill({ contentType: "text/html", body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;
        await import('/tests/e2e/fixtures/document-review.tsx');</script></html>` }));
      await page.goto("/__document-review");
      await expect(page.getByText(lang === "ru" ? "Не отправлен" : "Nicht versendet", { exact: true })).toBeVisible();
      expect(commands).toEqual([]);
      await page.getByRole("button", { name: lang === "ru" ? "Отметить отправку" : "Versand vermerken", exact: true }).click();
      await expect(page.getByText(lang === "ru" ? /письмо не отправляется/ : /versendet keine E-Mail/)).toBeVisible();
      expect(commands).toEqual([]);
      await page.getByRole("button", { name: lang === "ru" ? "Подтверждаю" : "Bestätigen", exact: true }).click();
      await expect(page.getByText(lang === "ru" ? "Отправлен для ознакомления" : "Zur Kenntnisnahme versendet", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: lang === "ru" ? "Подтвердить ознакомление" : "Kenntnisnahme bestätigen", exact: true }).click();
      // A second delivery while this confirmation is open cannot silently
      // acknowledge a different dispatch. The manager must reopen it.
      state = { ...state, sent: { id: "sent-event-new", at: "2026-09-07T15:00:00Z", by: "Test Manager", test_mode: false, automatic: true } };
      await page.clock.fastForward(10_001);
      await expect(page.getByRole("button", { name: lang === "ru" ? "Подтверждаю" : "Bestätigen", exact: true })).toBeDisabled();
      await page.getByRole("button", { name: lang === "ru" ? "Отмена" : "Abbrechen", exact: true }).click();
      await page.getByRole("button", { name: lang === "ru" ? "Подтвердить ознакомление" : "Kenntnisnahme bestätigen", exact: true }).click();
      await page.getByRole("button", { name: lang === "ru" ? "Подтверждаю" : "Bestätigen", exact: true }).click();
      await expect(page.getByText(lang === "ru" ? "Ознакомлен" : "Kenntnisnahme bestätigt", { exact: true })).toBeVisible();
      await expect(page.getByText(/Test Manager/)).toBeVisible();
      expect(commands).toEqual([{ kind: "sent", sent_event_id: null }, { kind: "acknowledged", sent_event_id: "sent-event-new" }]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath("review-status.png") });
    });
  }
}
