import { expect, test, type Page } from "@playwright/test";

// QA 2026-10-12 B2-01: once the file is uploaded, the clinical import runs on
// the server ("В очереди" / "In der Warteschlange"): closing the sheet loses
// nothing and must not ask "Закрыть без сохранения?". A file chosen but not
// uploaded yet still asks. Mocked API, synthetic data only.

const patientId = "00000000-0000-0000-0000-000000000101";

async function mount(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const queued = {
    id: "import-queued",
    patient_id: patientId,
    document_id: "document-queued",
    document_name: "Arztbrief.pdf",
    mime_type: "application/pdf",
    status: "queued",
    document_type: null,
    source_language: null,
    parser_version: null,
    draft: { candidates: [], warnings: [] },
    reviewed_draft: null,
    applied_counts: {},
    error_message: null,
    created_at: "2026-10-12T08:00:00Z",
    updated_at: "2026-10-12T08:00:00Z",
  };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "clinical-queued-test");
    Object.assign(window, {
      __clinicalTestIdentity: { firstName: "Anna", lastName: "Beispiel", birthDate: "1980-01-01" },
    });
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (url.endsWith("/me")) body = { id: "tester", name: "Manager", email: "qa@example.test", role: "ceo" };
    else if (url.endsWith("/upload")) body = { id: queued.document_id };
    else if (url.endsWith("/download")) {
      return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
    } else if (url.includes("/clinical-document-imports")) {
      body = url.endsWith("/clinical-document-imports")
        ? route.request().method() === "GET" ? { items: [] } : queued
        : queued;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/clinical-import-harness", (route) => route.fulfill({ contentType: "text/html", body: `
    <html><body><div id="root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    import('/tests/e2e/fixtures/clinical-import-harness.tsx');
    </script></body></html>` }));
  await page.goto("/clinical-import-harness");
  return errors;
}

test("closing a queued import does not ask about unsaved data", async ({ page }) => {
  const errors = await mount(page);
  const dialog = page.getByRole("dialog", { name: "Assistent für den Import" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Arztbrief.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await dialog.getByRole("button", { name: "Hochladen und Entwurf erstellen" }).click();
  // The import waits on the server.
  await expect(dialog.getByText("Klinischen Entwurf erstellen…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
});

test("a chosen file that was not uploaded still asks before closing", async ({ page }) => {
  await mount(page);
  const dialog = page.getByRole("dialog", { name: "Assistent für den Import" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "Arztbrief.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n%%EOF"),
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
});
