/**
 * DSGVO page (/admin/compliance), QA 2026-10-12 round 3:
 *
 * - B3-02: the "Пациент" picker could show patient B while the page still
 *   held patient A (opened with `?patient=A`); "Создать запрос" and the
 *   consent "Отозвать" then acted on A and named nobody. Choosing a patient
 *   now loads it at once, every action waits until it is loaded, and each
 *   dialog names the patient its request is sent for.
 * - B3-11: the CEO Assistant reads the register and changes nothing.
 *
 * Synthetic data only; every API call is mocked.
 */

import { expect, test, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";

import { chooseComboboxOption } from "./helpers";

const SNAPSHOT_URL = new URL("../../../docs/backlog/02_rbac-capability-snapshot.md", import.meta.url);

function snapshotCapabilities(role: string): string[] {
  const lines = readFileSync(SNAPSHOT_URL, "utf8").split(/\r?\n/);
  const header = lines.find((line) => line.startsWith("| Capability |"));
  if (!header) throw new Error("snapshot header not found");
  const roles = header.split("|").map((cell) => cell.trim()).filter(Boolean).slice(1);
  const column = roles.indexOf(role);
  const capabilities: string[] = [];
  for (const line of lines) {
    const match = /^\| `([a-z_.]+)` \|(.*)\|$/.exec(line);
    if (!match) continue;
    const cells = match[2].split("|").map((cell) => cell.trim());
    if (cells[column] === "x") capabilities.push(match[1]);
  }
  return capabilities;
}

const PATIENT_A = { id: "00000000-0000-0000-0000-00000000000a", patient_id: "P-20261012-0002", first_name: "Ben", last_name: "Muster" };
const PATIENT_B = { id: "00000000-0000-0000-0000-00000000000b", patient_id: "P-20261012-0003", first_name: "Mia", last_name: "Muster" };
const LABEL_A = "P-20261012-0002 · Ben Muster";
const LABEL_B = "P-20261012-0003 · Mia Muster";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function privacyRequest(patient: typeof PATIENT_A, id: string) {
  return {
    id,
    patient_id: patient.id,
    patient_pid: patient.patient_id,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    requested_by_name: "CEO Beispiel",
    request_type: "access",
    source: "patient_request",
    status: "requested",
    reason: null,
    due_at: "2026-11-11T09:00:00Z",
    retention_until: null,
    requested_at: "2026-10-12T09:00:00Z",
    reviewed_at: null,
    executed_at: null,
    record_summary: { appointments: 0, cases: 0, orders: 0, documents: 0, invoices: 0 },
    manual_override: false,
    is_overdue: false,
    patient_open_business: false,
  };
}

function consent(patient: typeof PATIENT_A) {
  return {
    id: `consent-${patient.id}`,
    patient_id: patient.id,
    patient_pid: patient.patient_id,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    managed_by_name: "CEO Beispiel",
    consent_type: "dsgvo_data_transfer",
    granted: true,
    granted_at: "2026-10-01T09:00:00Z",
    expires_at: "2027-10-01T09:00:00Z",
    revoked_at: null,
    note: null,
    created_at: "2026-10-01T09:00:00Z",
  };
}

type Mocks = {
  posts: Array<{ path: string; body: unknown }>;
  releasePatientB: () => void;
};

async function installMocks(page: Page, role: "ceo" | "ceo_assistant"): Promise<Mocks> {
  const posts: Mocks["posts"] = [];
  let releasePatientB = () => {};
  const patientBGate = new Promise<void>((resolve) => {
    releasePatientB = resolve;
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("gmed_lang", "ru");
    window.localStorage.setItem("gmed_access_token", "playwright-access-token");
    window.localStorage.setItem("gmed_refresh_token", "playwright-refresh-token");
  });
  await page.route("**/auth/**", (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/refresh") {
      return json(route, {
        access_token: "playwright-access-token",
        refresh_token: "playwright-refresh-token",
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    return json(route, { ok: true });
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();

    if (path === "/me") {
      return json(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: `${role}@example.com`,
        name: role === "ceo" ? "CEO Beispiel" : "Assistenz Beispiel",
        role,
        capabilities: snapshotCapabilities(role),
        created_at: "2026-01-01T00:00:00Z",
      });
    }
    if (path === "/notifications/unread-count") return json(route, { count: 0 });
    if (path === "/notifications" || path === "/users/online" || path === "/announcements/active") {
      return json(route, []);
    }
    if (path === "/patients" && method === "GET") return json(route, [PATIENT_A, PATIENT_B]);
    if (path === "/admin/compliance/privacy-requests") return json(route, []);
    if (path === "/admin/compliance/incidents" && method === "GET") return json(route, []);
    if (path.endsWith("/recipients")) return json(route, []);

    for (const patient of [PATIENT_A, PATIENT_B]) {
      const base = `/admin/compliance/patient/${patient.id}`;
      if (path === `${base}/privacy-requests` && method === "GET") {
        // Patient B answers only when the test lets it: the page must not act
        // while B is still loading.
        if (patient === PATIENT_B) await patientBGate;
        return json(route, patient === PATIENT_A ? [privacyRequest(PATIENT_A, "request-a")] : []);
      }
      if (path === `${base}/consents` && method === "GET") return json(route, [consent(patient)]);
      if ((path === `${base}/privacy-requests` || path === `${base}/consents`) && method === "POST") {
        posts.push({ path, body: route.request().postDataJSON() });
        return json(
          route,
          path.endsWith("/consents")
            ? { ...consent(patient), granted: false }
            : privacyRequest(patient, "request-new"),
          201,
        );
      }
    }
    return json(route, { message: `Not mocked: ${method} ${path}` }, 404);
  });
  return { posts, releasePatientB: () => releasePatientB() };
}

test("choosing a patient loads it at once; requests and revocations go to that patient (B3-02)", async ({ page }) => {
  const mocks = await installMocks(page, "ceo");
  await page.goto(`/admin/compliance?patient=${PATIENT_A.id}`);

  await expect(page.getByTestId("compliance-active-patient")).toHaveText(LABEL_A);
  await expect(page.getByText(`История запросов приватности — ${LABEL_A}`)).toBeVisible();

  // Registries scroll inside their cards; the surrounding page fits a phone.
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 4400 : 2300 });
    const workspace = page.getByTestId("compliance-workspace");
    expect(await workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await workspace.screenshot({ path: `../.tmp/release-audit/compliance-${width}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Pick patient B (the old bug: nothing loaded until "Поиск..." was pressed).
  await chooseComboboxOption(page, page.getByRole("combobox", { name: "Пациент", exact: true }), LABEL_B);
  await expect(page.getByTestId("compliance-active-patient")).toHaveText(LABEL_B);
  await expect(page).toHaveURL(new RegExp(`patient=${PATIENT_B.id}`));
  // While B loads, nothing can be filed or revoked for anybody.
  const create = page.getByTestId("compliance-create-request");
  await expect(create).toBeDisabled();
  await expect(page.getByTestId("compliance-patient-not-ready")).toBeVisible();
  await expect(page.getByTestId("consents-patient")).toHaveText(LABEL_B);
  await expect(page.getByRole("button", { name: "Отозвать" })).toBeDisabled();
  mocks.releasePatientB();
  await expect(page.getByText(`История запросов приватности — ${LABEL_B}`)).toBeVisible();
  await expect(create).toBeEnabled();

  // The create dialog names patient B and files the request for B.
  await create.click();
  await expect(page.getByTestId("privacy-request-dialog-patient")).toContainText(LABEL_B);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const dialog = page.getByRole("dialog");
    expect(await dialog.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `../.tmp/release-audit/compliance-create-${width}.png`, animations: "disabled" });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await chooseComboboxOption(page, page.getByRole("combobox", { name: "Тип запроса" }), "Исправление данных (ст. 16)");
  await chooseComboboxOption(page, page.getByRole("combobox", { name: "Источник запроса" }), /Пациент обратился сам/);
  await page.getByRole("dialog").getByRole("button", { name: "Создать запрос" }).click();
  await expect.poll(() => mocks.posts.length).toBe(1);
  expect(mocks.posts[0].path).toBe(`/admin/compliance/patient/${PATIENT_B.id}/privacy-requests`);
  expect(mocks.posts[0].body).toMatchObject({ request_type: "rectification", source: "patient_request" });

  // The revocation dialog names patient B and revokes B's consent.
  await page.getByRole("button", { name: "Отозвать" }).click();
  const revoke = page.getByTestId("consent-revoke-dialog");
  await expect(revoke.getByTestId("consent-revoke-patient")).toContainText(LABEL_B);
  await revoke.locator("#consent-revoke-channel").selectOption("email");
  await revoke.locator("#consent-revoke-reason").fill("E-Mail vom 12.10.2026, im Postfach abgelegt");
  await revoke.getByRole("button", { name: "Зафиксировать отзыв" }).click();
  await expect.poll(() => mocks.posts.length).toBe(2);
  expect(mocks.posts[1].path).toBe(`/admin/compliance/patient/${PATIENT_B.id}/consents`);
  expect(mocks.posts[1].body).toMatchObject({ consent_type: "dsgvo_data_transfer", action: "revoke" });
  expect(mocks.posts.some((post) => post.path.includes(PATIENT_A.id))).toBe(false);
});

test("the CEO Assistant reads the DSGVO register without any action (B3-11)", async ({ page }) => {
  const mocks = await installMocks(page, "ceo_assistant");
  mocks.releasePatientB();
  await page.goto(`/admin/compliance?patient=${PATIENT_A.id}`);

  await expect(page.getByTestId("read-only-banner")).toBeVisible();
  await expect(page.getByText(`История запросов приватности — ${LABEL_A}`)).toBeVisible();
  // The consent history is shown, without grant or revoke.
  await expect(page.getByTestId("patient-consents")).toBeVisible();
  await expect(page.getByTestId("consents-patient")).toHaveText(LABEL_A);
  await expect(page.getByTestId("compliance-create-request")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Отозвать" })).toHaveCount(0);
  await expect(page.locator("#consent-type")).toHaveCount(0);
  await expect(page.getByTestId("compliance-export-not-available")).toBeVisible();
  expect(mocks.posts).toHaveLength(0);
});
