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

  test("it_admin can open patients workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "it_admin");
    await page.goto("/patients");
    await expect(page).toHaveURL(/\/patients$/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Patient/i }),
    ).toBeVisible();
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

  test("interpreter is redirected away from reports workspace", async ({
    page,
    request,
  }) => {
    await setGermanLanguage(page);
    await bootstrapAndLogin(page, request, "interpreter");
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
});
