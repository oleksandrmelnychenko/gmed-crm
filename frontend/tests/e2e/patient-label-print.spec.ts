import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// «Печать наклейки» in the patient card header: each of the three formats
// asks the server for the label PDF and opens it in a new tab. Synthetic data.

const patientId = "5d0c3f7e-2b1a-4c6d-9e8f-0a1b2c3d4e5f";

async function prepare(page: Page, lang: "ru" | "de", role = "ceo") {
  await page.addInitScript(lang => {
    localStorage.setItem("gmed_access_token", "patient-label-test-token");
    localStorage.setItem("gmed_refresh_token", "patient-label-test-refresh");
    localStorage.setItem("gmed_lang", lang);
  }, lang);
  await page.routeWebSocket("**/api/**", socket => socket.close());
  const requests: string[] = [];
  const pdf = await readFile("public/demo/datev/demo-datev-001.pdf");
  await page.route("**/api/v1/**", async route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path === `/patients/${patientId}/label.pdf`) {
      requests.push(url.searchParams.get("format") ?? "");
      expect(route.request().headers().authorization).toBe("Bearer patient-label-test-token");
      return route.fulfill({
        contentType: "application/pdf",
        headers: { "content-disposition": 'inline; filename="etikett-P-DEMO-LABEL.pdf"' },
        body: pdf,
      });
    }
    let body: unknown = [];
    if (path === "/me") body = { id: "label-user", email: "label@example.org", name: "Label test", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/auth/refresh") body = { access_token: "patient-label-test-token", refresh_token: "patient-label-test-refresh", expires_in: 900 };
    if (path === "/stats/overview") body = {};
    if (path.endsWith("/account-statement")) body = { summary: { calculated_balance: "0", closing_balance: "0", balance_side: "settled" }, entries: [] };
    if (path === "/documents/meta/categories") body = { categories: [], arts: [] };
    if (path === "/documents/templates") body = { templates: [], text_blocks: [] };
    if (path === "/patients/" + patientId) body = {
      id: patientId, patient_id: "P-DEMO-LABEL", first_name: "Erika", last_name: "Beispiel",
      birth_date: "1951-03-02", gender: "female", is_active: true, languages: ["de", "uk"],
      functional_labels: [], created_at: "2026-08-01T00:00:00Z",
    };
    if (path.endsWith("/clinical")) body = { diagnoses: [], medications: [], examinations: [], procedures: [], allergien: [], cave: [], verlauf: [], narrative: null };
    if (/\/(vitals|lab-results|risk-scores|card-entries|medical-orders|clinical-document-imports)$/.test(path)) body = { items: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/patients/" + patientId);
  await expect(page.getByRole("heading", { name: "Erika Beispiel", exact: true })).toBeVisible();
  return { requests, picker: page.getByRole("combobox", { name: lang === "ru" ? "Печать наклейки" : "Etikett drucken" }) };
}

const formats = {
  ru: [
    ["Компактная 90 x 48 mm", "compact-90x48"],
    ["Стандартная 105 x 74 mm", "standard-105x74"],
    ["Лист 70 x 36 mm", "sheet-70x37"],
  ],
  de: [
    ["Kompakt 90 x 48 mm", "compact-90x48"],
    ["Standard 105 x 74 mm", "standard-105x74"],
    ["Bogen 70 x 36 mm", "sheet-70x37"],
  ],
} as const;

for (const lang of ["ru", "de"] as const) {
  test(`patient label picker opens the server PDF of each format (${lang})`, async ({ page }) => {
    const { requests, picker } = await prepare(page, lang);
    await expect(picker).toBeVisible();
    for (const [label, format] of formats[lang]) {
      await picker.click();
      const option = page.getByRole("option", { name: label, exact: true });
      await expect(option).toBeVisible();
      if (format === "compact-90x48") {
        await page.screenshot({ path: `../artifacts/design-qa/patient-label-menu-${lang}.png` });
      }
      const popup = page.waitForEvent("popup");
      await option.click();
      const tab = await popup;
      await expect.poll(() => tab.url()).toMatch(/^blob:/);
      await tab.close();
      await expect.poll(() => requests.at(-1)).toBe(format);
    }
    expect(requests).toEqual(formats[lang].map(([, format]) => format));
  });
}

test("roles without the patient label do not see the picker", async ({ page }) => {
  const { picker } = await prepare(page, "ru", "billing");
  await expect(picker).toHaveCount(0);
});
