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
