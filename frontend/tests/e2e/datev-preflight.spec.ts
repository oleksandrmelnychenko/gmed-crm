import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const preview = {
  schema_version: "1.0", requires_review: true, extraction_complete: true, source_format: "pdf_text", warnings: [],
  fields: { supplier_name: "Example GmbH", external_invoice_number: "INV-01", invoice_date: "2026-09-06", amount_net: "100.00", amount_vat: "19.00", amount_gross: "119.00", currency: "EUR" },
  text: "Private source text", recipient: { name: "Private recipient" },
};
async function prepare(page: Page, role = "ceo", lang = "ru") {
  const mutations: string[] = [];
  const external: string[] = [];
  const setup = {
    profile: { company_name: "", consultant_number: "", client_number: "", belege_version: "", modules: ["belege"], export_service: "unknown" },
    revision: null, updated_at: null, connection_status: "not_configured", read_only: true, accounting_writes_enabled: false, last_sync_at: null,
  };
  await page.addInitScript(({ lang }) => {
    localStorage.setItem("gmed_access_token", "preflight-test-token");
    localStorage.setItem("gmed_refresh_token", "preflight-test-refresh");
    localStorage.setItem("gmed_lang", lang);
  }, { lang });
  page.on("request", (request) => {
    if (new URL(request.url()).hostname.endsWith("datev.de")) external.push(request.url());
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (route.request().method() !== "GET") mutations.push(path);
    let body: unknown = [];
    if (path === "/me") body = { id: "00000000-0000-0000-0000-000000000001", email: "preflight@example.com", name: "Test", role, created_at: "2026-01-01T00:00:00Z" };
    if (path === "/admin/datev/setup") body = setup;
    if (path === "/invoices/import-preview") body = preview;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/admin/datev");
  return { mutations, external };
}

test("preflight detects duplicate files and invoice identities without creating accounting records", async ({ page }) => {
  const { mutations, external } = await prepare(page);
  await page.getByRole("button", { name: "Проверить документы", exact: true }).click();
  const panel = page.getByTestId("datev-document-checks");
  await panel.getByLabel("Документы для проверки").setInputFiles([
    { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-first") },
    { name: "renamed-copy.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-first") },
    { name: "revised-invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-revised") },
  ]);
  await expect(panel.getByText("Обработано 3 / 3")).toBeVisible();
  await expect(panel.getByRole("article", { name: "renamed-copy.pdf", exact: true })).toContainText("Повторный файл");
  await expect(panel.getByRole("article", { name: "revised-invoice.pdf", exact: true })).toContainText("Похожие реквизиты");
  expect(mutations).toEqual(["/invoices/import-preview", "/invoices/import-preview"]);
  expect(external).toEqual([]);
  const downloadPromise = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Скачать отчёт проверки" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("GMED-DATEV-Dokumentpruefung.json");
  const reportText = await readFile((await download.path())!, "utf8");
  const report = JSON.parse(reportText);
  expect(report.documents).toHaveLength(3);
  expect(report.datev_compatibility_verified).toBe(false);
  expect(report.accounting_writes_performed).toBe(false);
  expect(reportText).not.toContain("Private");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.reload();
  await expect(panel.getByRole("article")).toHaveCount(0);
});

test("a transient OCR failure can be retried and failed attempts are not treated as duplicates", async ({ page }) => {
  await prepare(page);
  let attempts = 0;
  await page.route("**/api/v1/invoices/import-preview", async (route) => {
    attempts += 1;
    await route.fulfill({ status: attempts === 1 ? 503 : 200, contentType: "application/json", body: JSON.stringify(attempts === 1 ? { error: "unavailable" } : preview) });
  });
  const panel = page.getByTestId("datev-document-checks");
  await panel.getByLabel("Документы для проверки").setInputFiles({ name: "retry.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-retry") });
  await expect(panel).toContainText("Сервис распознавания недоступен");
  await panel.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(panel).toContainText("Распознано — сверить");
  expect(attempts).toBe(2);
});

test("stopping a batch cancels queued documents and leaves them available for retry", async ({ page }) => {
  await prepare(page);
  let requests = 0;
  let finish: (() => void) | undefined;
  const hold = new Promise<void>((resolve) => { finish = resolve; });
  await page.route("**/api/v1/invoices/import-preview", async (route) => {
    requests += 1;
    await hold;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(preview) }).catch(() => {});
  });
  const panel = page.getByTestId("datev-document-checks");
  try {
    await panel.getByLabel("Документы для проверки").setInputFiles([
      { name: "first.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-first") },
      { name: "second.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-second") },
    ]);
    await expect.poll(() => requests).toBe(1);
    await panel.getByRole("button", { name: "Остановить", exact: true }).click();
    await expect(panel.getByText("Остановлено", { exact: true })).toHaveCount(2);
    expect(requests).toBe(1);
    await expect(panel.getByRole("button", { name: "Повторить", exact: true })).toHaveCount(2);
  } finally { finish?.(); }
});

test("readiness reflects saved settings and does not grant DATEV access", async ({ page }) => {
  const { mutations } = await prepare(page, "ceo", "de");
  await expect(page.getByTestId("datev-readiness")).toContainText("Angaben vorbereitet: 1 / 5");
  await page.getByRole("textbox", { name: "Unternehmensname", exact: true }).fill("Unsaved company");
  await expect(page.getByTestId("datev-readiness")).toContainText("Änderungen zuerst speichern");
  await expect(page.getByTestId("datev-readiness")).toContainText("Angaben vorbereitet: 1 / 5");
  await expect(page.getByRole("button", { name: "DATEV verbinden", exact: true })).toBeDisabled();
  expect(mutations).toEqual([]);
});

test("IT administrators cannot reach the accounting document check", async ({ page }) => {
  const { mutations } = await prepare(page, "it_admin", "de");
  await expect(page.getByTestId("admin-datev-page")).toHaveCount(0);
  await expect(page.getByLabel("Dokumente zur Prüfung")).toHaveCount(0);
  expect(mutations).toEqual([]);
});
