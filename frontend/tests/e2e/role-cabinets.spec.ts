import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * Role cabinets (docs/role-cabinets-plan-2026-09-20_ua.md, stage 4): the
 * landing dashboard of each staff role shows only its primary modules, and
 * only those the capability set from `/me` opens.
 *
 * `/me` is mocked with the role's capabilities from the generated server
 * snapshot, so the spec follows the registry instead of a hand-written list.
 */

function snapshotCapabilities(role: string): string[] {
  const path = resolve(SPEC_DIR, "../../../docs/backlog/02_rbac-capability-snapshot.md");
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  const header = lines.find((line) => line.startsWith("| Capability |"));
  if (!header) throw new Error("capability snapshot header not found");
  const roles = header.split("|").map((cell) => cell.trim()).filter(Boolean).slice(1);
  const column = roles.indexOf(role);
  if (column === -1) throw new Error(`role ${role} missing from the capability snapshot`);
  const held: string[] = [];
  for (const line of lines) {
    const match = /^\| `([a-z_.]+)` \|(.*)\|$/.exec(line);
    if (!match) continue;
    const cells = match[2].split("|").map((cell) => cell.trim());
    if (cells[column] === "x") held.push(match[1]);
  }
  return held;
}

async function setup(page: Page, role: string, capabilities = snapshotCapabilities(role)) {
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "role-cabinets-test");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "00000000-0000-0000-0000-000000000001",
          email: `${role}@example.com`,
          name: `${role} user`,
          role,
          capabilities,
          created_at: "2026-01-01T00:00:00Z",
        },
      });
    }
    if (path === "/stats/my-kpis") {
      return route.fulfill({ json: { section: role, kpi: {} } });
    }
    if (path.startsWith("/concierge-operational-items")) {
      return route.fulfill({ json: [] });
    }
    if (path === "/stats/overview") {
      return route.fulfill({ json: {} });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/");
  await expect(page.getByTestId("role-cabinet-quick-links")).toBeVisible();
}

const link = (page: Page, id: string) => page.getByTestId(`role-cabinet-link-${id}`);

async function expectLinks(page: Page, present: string[], absent: string[]) {
  for (const id of present) {
    await expect(link(page, id), id).toBeVisible();
  }
  for (const id of absent) {
    await expect(link(page, id), id).toHaveCount(0);
  }
  const rendered = await page
    .getByTestId("role-cabinet-quick-links")
    .locator("[data-testid^='role-cabinet-link-']")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid")?.replace("role-cabinet-link-", "")),
    );
  expect(rendered).toEqual(present);
}

test("billing lands on the finance cabinet", async ({ page }) => {
  await setup(page, "billing");
  await expectLinks(
    page,
    ["invoices", "orders", "company-finance", "contracts"],
    ["patients", "leads", "appointments", "admin/users"],
  );
  await expect(page.getByText("Кабинет бухгалтерии", { exact: false })).toBeVisible();
  await link(page, "invoices").click();
  await expect(page).toHaveURL(/\/invoices$/);
});

test("concierge lands on the service cabinet with the lead grid", async ({ page }) => {
  await setup(page, "concierge");
  await expectLinks(
    page,
    ["services", "hotels", "appointments", "leads"],
    ["invoices", "orders", "contracts", "company-finance", "admin/users"],
  );
  await expect(page.getByText("Кабинет консьержа", { exact: false })).toBeVisible();
});

test("sales lands on the leads cabinet without finance", async ({ page }) => {
  await setup(page, "sales");
  await expectLinks(
    page,
    ["leads", "providers", "reports", "chat"],
    ["invoices", "orders", "patients", "appointments", "company-finance"],
  );
  await expect(page.getByText("Кабинет продаж", { exact: false })).toBeVisible();
});

test("it admin lands on the technical cabinet without patients", async ({ page }) => {
  await setup(page, "it_admin");
  await expectLinks(
    page,
    [
      "admin/users",
      "admin/security",
      "admin/settings",
      "admin/activity",
      "admin/health",
      "admin/signatures",
      "admin/datev",
      "incidents",
    ],
    ["patients", "leads", "orders", "invoices", "appointments", "chat"],
  );
  await expect(page.getByText("Технический кабинет", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Пациенты", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Пользователи и роли", exact: true })).toBeVisible();
});

test("quick links follow the capabilities reported by /me", async ({ page }) => {
  await setup(page, "billing", ["invoices.view", "tasks.use", "sops.view"]);
  await expectLinks(page, ["invoices"], ["orders", "company-finance", "contracts"]);
});
