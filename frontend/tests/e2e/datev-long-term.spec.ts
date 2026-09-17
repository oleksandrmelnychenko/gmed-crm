import { expect, test } from "@playwright/test";
import { setup, confirm, expectedTarget } from "./datev-fixture";

const long = "DATEV · Подключить на длительный срок", force = "DATEV · Отключить без подтверждения";
const target = { revision: expectedTarget.revision, generation: expectedTarget.generation, mode: "sandbox" };

test("long-term access is offered only for the checked company and requests the bound token", async ({ page }) => {
  const { panel, calls, setStatus } = await setup(page, true, "ru", { status: "disconnected", has_tokens: false, checked_consultant: 29098, checked_client: 1 });
  await expect(panel.getByRole("button", { name: long, exact: true })).toBeDisabled();
  await expect(panel).toContainText("не более 11 часов");
  setStatus({ checked_client: 55003 });
  await panel.getByRole("button", { name: "DATEV · Обновить статус", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "DATEV · Подтвердить", exact: true }).click();
  await expect(panel.getByRole("button", { name: long, exact: true })).toBeEnabled();
  await page.route("https://login.datev.de/**", (route) => route.fulfill({ contentType: "text/html", body: "Synthetic authorization destination" }));
  await page.route("**/admin/datev/authorize", (route) => { calls.push({ path: "/admin/datev/authorize", payload: route.request().postDataJSON() }); return route.fulfill({ json: { authorization_url: "https://login.datev.de/openidsandbox/authorize?state=synthetic" } }); });
  await panel.getByRole("button", { name: long, exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("до 2 лет");
  await page.getByRole("dialog").getByRole("button", { name: "DATEV · Подтвердить", exact: true }).click();
  await expect(page).toHaveURL(/^https:\/\/login\.datev\.de\/openidsandbox\/authorize/);
  expect(calls).toEqual([{ path: "/admin/datev/authorize", payload: { expected: target, long_term: true } }]);
});

test("a long-term connection names its company instead of an 11-hour session", async ({ page }) => {
  const { panel } = await setup(page, true, "ru", { long_term: true, bound_consultant: 29098, bound_client: 55003, session_expires_at: null });
  await expect(panel).toContainText("Длительный доступ для компании");
  await expect(panel).toContainText("29098 / 55003");
  await expect(panel).not.toContainText("не более 11 часов");
});

test("an unconfirmed revocation can be left only through an explicit forced disconnect", async ({ page }) => {
  const { panel, calls } = await setup(page, true, "ru", { status: "connected", has_tokens: true });
  await expect(panel.getByRole("button", { name: force, exact: true })).toHaveCount(0);
  const pending = await setup(page, true, "ru", { status: "revocation_pending", has_tokens: true });
  await page.route("**/admin/datev/disconnect", async (route) => {
    const payload = route.request().postDataJSON(); pending.calls.push({ path: "/admin/datev/disconnect", payload });
    pending.setStatus({ status: "disconnected", has_tokens: false });
    return route.fulfill({ json: { configured: true, ...target, redirect_uri: "http://localhost:5174/api/v1/datev/oauth/callback", exchange_enabled: true, status: "disconnected", has_tokens: false, long_term: false, revocation_confirmed: false, accounting_writes_enabled: false, invoice_originals_supported: false } });
  });
  await confirm(page, pending.panel, force);
  await expect(pending.panel).toContainText("DATEV не подтвердил отзыв");
  expect(pending.calls).toEqual([{ path: "/admin/datev/disconnect", payload: { expected: target, force: true } }]);
  await expect(pending.panel.getByRole("button", { name: force, exact: true })).toHaveCount(0);
  expect(calls.every((c) => c.path !== "/admin/datev/disconnect" || (c.payload as { force?: boolean }).force === true)).toBe(true);
});
