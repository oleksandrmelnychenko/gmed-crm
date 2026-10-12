import { expect, test, type Page } from "@playwright/test";

// QA 2026-10-12 B2-04: "Загрузить документ" in the patient card sends the
// "Медицинский документ" box as it is set — unticked is "false" — and no
// default type "report" when the type is left empty. Mocked API, synthetic
// data only.

type Lang = "ru" | "de";

const words = {
  ru: { medical: "Медицинский документ", submit: "Загрузить и распознать", type: "Тип" },
  de: { medical: "Medizinisches Dokument", submit: "Hochladen und erkennen", type: "Typ" },
} as const;

async function mount(page: Page, lang: Lang) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const uploads: string[] = [];
  await page.addInitScript((language) => {
    localStorage.setItem("gmed_lang", language);
    localStorage.setItem("gmed_access_token", "patient-document-upload-token");
  }, lang);
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({
        json: { id: "upload-user", email: "qa@example.com", name: "Upload QA", role: "ceo", created_at: "2026-01-01T00:00:00Z" },
      });
    }
    if (path === "/documents/upload" && request.method() === "POST") {
      uploads.push(request.postDataBuffer()?.toString("utf8") ?? "");
      return route.fulfill({ json: { id: "00000000-0000-4000-8000-000000000401" } });
    }
    return route.fulfill({ json: [] });
  });
  await page.route("**/__patient-document-upload-qa", (route) => route.fulfill({
    contentType: "text/html",
    body: `<html><meta name="viewport" content="width=device-width, initial-scale=1"><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      import('/tests/e2e/fixtures/patient-document-upload.tsx').catch(error => {
        const reloads = Number(sessionStorage.getItem('harness-reloads') ?? 0);
        if (reloads >= 3) throw error;
        sessionStorage.setItem('harness-reloads', String(reloads + 1));
        location.reload();
      });
    </script></html>`,
  }));
  await page.goto("/__patient-document-upload-qa");
  return { errors, uploads };
}

/** The value of one multipart field, or null when the body does not have it. */
function multipartField(body: string, name: string): string | null {
  const match = new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)\\r\\n`).exec(body);
  return match ? match[1] : null;
}

for (const lang of ["ru", "de"] as const) {
  const w = words[lang];

  test(`an unticked medical box is sent as false, without a default type (${lang})`, async ({ page }) => {
    const { errors, uploads } = await mount(page, lang);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "reisepass-mia-muster.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic passport scan"),
    });
    // The type starts empty: the server classifies the file.
    await expect(dialog.locator("#document-art")).toHaveValue("");
    const medical = dialog.getByRole("checkbox", { name: w.medical });
    await expect(medical).toBeChecked();
    await medical.uncheck();
    await dialog.getByRole("button", { name: w.submit }).click();
    await expect.poll(() => uploads.length).toBe(1);
    expect(multipartField(uploads[0], "is_medical")).toBe("false");
    expect(multipartField(uploads[0], "art")).toBeNull();
    expect(multipartField(uploads[0], "patient_id")).toBe("00000000-0000-4000-8000-000000000301");
    expect(errors).toEqual([]);
  });

  test(`a ticked box and a chosen type are sent as chosen (${lang})`, async ({ page }) => {
    const { errors, uploads } = await mount(page, lang);
    const dialog = page.getByRole("dialog");
    await dialog.locator('input[type="file"]').setInputFiles({
      name: "arztbrief-mia-muster.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 synthetic doctor letter"),
    });
    await dialog.locator("#document-art").fill("arztbrief");
    await dialog.getByRole("button", { name: w.submit }).click();
    await expect.poll(() => uploads.length).toBe(1);
    expect(multipartField(uploads[0], "is_medical")).toBe("true");
    expect(multipartField(uploads[0], "art")).toBe("arztbrief");
    expect(errors).toEqual([]);
  });
}
