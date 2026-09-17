import { expect, type Page, type Locator } from "@playwright/test";
export const expectedTarget = { revision: "00000000-0000-0000-0000-000000000002", generation: "00000000-0000-0000-0000-000000000003", mode: "sandbox", profile_revision: "00000000-0000-0000-0000-000000000004", consultant_number: 29098, client_number: 55003 };
export async function setup(page: Page, connected = false, lang = "ru", overrides: Record<string, unknown> = {}) {
  let status = { configured: connected, generation: expectedTarget.generation, revision: "00000000-0000-0000-0000-000000000002", mode: "sandbox", redirect_uri: "http://127.0.0.1:5174/api/v1/datev/oauth/callback", exchange_enabled: true, status: connected ? "connected" : "not_configured", has_tokens: connected, checked_at: null, expires_at: "2026-09-14T15:00:00Z", accounting_writes_enabled: false, invoice_originals_supported: false, ...overrides };
  const calls: { path: string; payload: unknown }[] = [];
  await page.addInitScript((lang) => { localStorage.setItem("gmed_access_token", "datev-ui-test"); localStorage.setItem("gmed_refresh_token", "datev-ui-refresh"); localStorage.setItem("gmed_lang", lang); }, lang);
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (route.request().method() !== "GET") calls.push({ path, payload: route.request().postData() ? route.request().postDataJSON() : null });
    if (path === "/me") body = { id: "00000000-0000-0000-0000-000000000001", name: "Test", role: "ceo", email: "test@example.invalid" };
    if (path === "/admin/datev/setup") body = { revision: expectedTarget.profile_revision, updated_at: null, profile: { company_name: "Test", consultant_number: "29098", client_number: "55003", belege_version: "", modules: ["belege"], export_service: "unknown" }, connection_status: "not_configured", read_only: true, accounting_writes_enabled: false, last_sync_at: null };
    if (path === "/admin/datev/connection") {
      if (route.request().method() === "PUT") status = { ...status, configured: true, status: "disconnected", ...route.request().postDataJSON().credentials };
      const { ...safe } = status; delete (safe as Record<string,unknown>).client_secret; delete (safe as Record<string,unknown>).client_id;
      body = safe;
    }
    if (path === "/admin/datev/check") body = { mode: "sandbox", checked_at: "2026-09-14T14:00:00Z", clients: [{ id: "technical-id-do-not-display", name: "Musterholz", consultant_number: 29098, client_number: 55003, services: [{ name: "Buchungsdatenservice", scopes: ["write-scope-do-not-enable"] }] }] };
    if (path === "/admin/datev/read") body = { source: "DATEV", mode: "sandbox", kind: route.request().postDataJSON().kind, fiscal_year: route.request().postDataJSON().fiscal_year, company: "Musterholz", consultant_number: 29098, client_number: 55003, retrieved_at: "2026-09-14T14:00:00Z", records: [{ id: 20260101, caption: "Testjahr" }], accounting_writes_performed: false, invoice_originals_included: false };
    if (path === "/admin/datev/disconnect") { status = { ...status, status: "disconnected", has_tokens: false }; body = status; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/admin/datev");
  return { panel: page.getByTestId("datev-live-connection"), calls, setStatus: (patch: Record<string, unknown>) => { status = { ...status, ...patch }; } };
}
export async function confirm(page: Page, scope: Locator, name: string) {
  await scope.getByRole("button", { name, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /DATEV · (Подтвердить|Bestätigen)/ }).click();
  await expect(dialog).toHaveCount(0);
}
