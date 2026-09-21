import { expect, test, type Page } from "@playwright/test";

import { bootstrapAndLogin, setGermanLanguage } from "./support/live-helpers";

async function expectForbiddenRouteRedirect(page: Page, path: string) {
  await page.goto(path);
  await expect
    .poll(() => new URL(page.url()).pathname, {
      message: `expected forbidden route ${path} to normalize to /`,
    })
    .toBe("/");
}

test.describe("live RBAC denied route normalization", () => {
  test("patient manager is redirected away from it-admin settings", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "pm");
    await expectForbiddenRouteRedirect(page, "/admin/settings");
  });

  test("ceo assistant is redirected away from admin users", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "assistant");
    await expectForbiddenRouteRedirect(page, "/admin/users");
  });

  test("billing is redirected away from appointments workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "billing");
    await expectForbiddenRouteRedirect(page, "/appointments");
  });

  test("patient manager can open Work Center and its legacy route but not Company Finance", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "pm");
    await page.goto("/task-manager");
    await expect(page.getByRole("heading", { level: 1, name: "Arbeitszentrale", exact: true })).toBeVisible();
    await page.goto("/concierge");
    await expect(page).toHaveURL(/\/task-manager$/);
    await expectForbiddenRouteRedirect(page, "/company-finance");
  });

  test("concierge can open notes and Task Manager but not Company Finance", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "concierge");
    await page.goto("/notes");
    await expect(page.getByTestId("internal-notes-page")).toBeVisible();
    await page.goto("/task-manager");
    await expect(
      page.getByRole("heading", { level: 1, name: "Arbeitszentrale", exact: true }),
    ).toBeVisible();
    await expectForbiddenRouteRedirect(page, "/company-finance");
  });

  test("billing can open notes, Work Center, its legacy route and Company Finance", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "billing");
    await page.goto("/notes");
    await expect(page.getByTestId("internal-notes-page")).toBeVisible();
    await page.goto("/task-manager");
    await expect(page.getByRole("heading", { level: 1, name: "Arbeitszentrale", exact: true })).toBeVisible();
    await page.goto("/company-finance");
    await expect(page.getByRole("heading", { name: /Unternehmenssaldo|Company balance/i })).toBeVisible();
    await page.goto("/concierge");
    await expect(page).toHaveURL(/\/task-manager$/);
  });

  test("sales is redirected away from documents workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "sales");
    await expectForbiddenRouteRedirect(page, "/documents");
  });

  test("sales is redirected away from contracts workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "sales");
    await expectForbiddenRouteRedirect(page, "/contracts");
  });

  test("concierge is redirected away from invoices workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "concierge");
    await expectForbiddenRouteRedirect(page, "/invoices");
  });

  test("billing is redirected away from cases workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "billing");
    await expectForbiddenRouteRedirect(page, "/cases");
  });

  // IT Admin runs a technical cabinet only and never sees patient data
  // (capability registry, 2026-09-20).
  test("it_admin is redirected away from patients workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");
    await expectForbiddenRouteRedirect(page, "/patients");
  });

  test("it_admin is redirected away from cases workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");
    await expectForbiddenRouteRedirect(page, "/cases");
  });

  test("it_admin is redirected away from reports workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");
    await expectForbiddenRouteRedirect(page, "/reports");
  });

  test("it_admin is redirected away from documents workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");
    await expectForbiddenRouteRedirect(page, "/documents");
  });

  test("interpreter can open Task Manager but is redirected away from reports workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "interpreter");
    await page.goto("/task-manager");
    await expect(
      page.getByRole("heading", { level: 1, name: "Arbeitszentrale", exact: true }),
    ).toBeVisible();
    await expectForbiddenRouteRedirect(page, "/reports");
  });

  test("patient is redirected away from staff-only patients route", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "patient");
    await expectForbiddenRouteRedirect(page, "/patients");
  });

  // Capability registry (2026-09-20): positive cabinet checks per role.
  test("sales opens the leads and chat workspaces", async ({ page, request }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "sales");
    await page.goto("/leads");
    await expect(page).toHaveURL(/\/leads$/);
    await page.goto("/chat");
    await expect(page).toHaveURL(/\/chat$/);
  });

  test("ceo assistant opens patients and orders read-only", async ({ page, request }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "assistant");
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByTestId("read-only-banner").first()).toBeVisible();
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId("read-only-banner").first()).toBeVisible();
  });

  test("it_admin opens the users administration", async ({ page, request }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/users$/);
  });

  test("billing opens invoices without a read-only banner", async ({ page, request }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "billing");
    await page.goto("/invoices");
    await expect(page).toHaveURL(/\/invoices$/);
    await expect(page.getByTestId("read-only-banner")).toHaveCount(0);
  });

  test("interpreter is redirected away from invoices", async ({ page, request }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "interpreter");
    await expectForbiddenRouteRedirect(page, "/invoices");
  });
});
