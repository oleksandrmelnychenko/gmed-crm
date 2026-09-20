/**
 * Read-only cabinets (docs/role-cabinets-plan-2026-09-20_ua.md, stage 3).
 *
 * The mock `/me` carries the capability list from the server snapshot
 * (`docs/backlog/02_rbac-capability-snapshot.md`): a `ceo_assistant` holds
 * only `*.view` capabilities and must get every module read-only, while
 * `billing` keeps its invoice controls.
 */

import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const SNAPSHOT_URL = new URL("../../../docs/backlog/02_rbac-capability-snapshot.md", import.meta.url);

/** Parses the generated `role x capability` Markdown table into role -> capabilities. */
function snapshotCapabilities(role: string): string[] {
  const lines = readFileSync(SNAPSHOT_URL, "utf8").split(/\r?\n/);
  const header = lines.find((line) => line.startsWith("| Capability |"));
  if (!header) throw new Error("snapshot header not found");
  const roles = header.split("|").map((cell) => cell.trim()).filter(Boolean).slice(1);
  const column = roles.indexOf(role);
  if (column < 0) throw new Error(`role ${role} missing from snapshot`);
  const capabilities: string[] = [];
  for (const line of lines) {
    const match = /^\| `([a-z_.]+)` \|(.*)\|$/.exec(line);
    if (!match) continue;
    const cells = match[2].split("|").map((cell) => cell.trim());
    if (cells[column] === "x") capabilities.push(match[1]);
  }
  return capabilities;
}

const orderId = "00000000-0000-0000-0000-000000000901";
const patientId = "00000000-0000-0000-0000-000000000301";
const invoiceId = "00000000-0000-0000-0000-000000000601";

const patient = {
  id: patientId,
  patient_id: "PT-0001",
  first_name: "Anna",
  last_name: "Beispiel",
  birth_date: "1990-01-01",
  gender: "female",
  nationality: "DE",
  residence_country: "DE",
  languages: ["de"],
  functional_labels: [],
  phone_primary: "+49 30 111111",
  email: "anna@example.invalid",
  insurance_provider: "AOK",
  insurance_type: "public",
  is_active: true,
  created_at: "2026-04-10T09:00:00Z",
};

const order = {
  id: orderId, order_number: "A-RO-1", patient_id: patientId, patient_name: "Anna Beispiel", patient_pid: "PT-0001",
  phase: "intake", status: "active", total_estimated: "1000", total_actual: "0", currency: "EUR",
  needs_description: "Koordination", signed_patient: true, signed_agency: true,
  created_at: "2026-09-06T12:02:00Z", updated_at: "2026-09-06T12:02:00Z",
  leistungen: [] as unknown[], external_invoices: [] as unknown[],
  process_gates: {
    execution_ready: true, debt_hold: false, overdue_invoice_count: 0,
    billing_release_status: "granted", billing_release_note: "",
    package_coverage_status: "not_covered", package_coverage_note: "", blocking_reasons: [],
  },
  planning_preparation: {
    planning_ready: true, treatment_plan_status: "finalized", treatment_plan_note: "",
    non_medical_required: false, interpreter_required: false,
    preparation_documents_status: "sent", interpreter_briefing_status: "not_needed",
    medical_total: 0, medical_confirmed: 0, non_medical_total: 0, non_medical_confirmed: 0,
    interpreter_assigned: 0, interpreter_confirmed: 0, blocking_reasons: [],
  },
  execution_flow: {
    closure_ready: false, arrival_status: "pending", medical_execution_status: "pending",
    non_medical_execution_status: "not_required", interpreter_service_status: "not_required",
    issue_status: "not_required", deviation_note: "", execution_summary: "", blocking_reasons: [],
  },
  followup_flow: {
    followup_ready: false, doctor_followup_status: "not_required",
    followup_1w_status: "pending", followup_1m_status: "pending", followup_6m_status: "pending",
    package_end_status: "not_required", results_handoff_status: "pending",
    followup_summary: "", blocking_reasons: [],
  },
  lifecycle: {
    current_stage: "intake", next_stage: "execution",
    allowed_transitions: [], allowed_status_transitions: [], history: [],
  },
};

const invoice = {
  id: invoiceId, order_id: orderId, order_number: "A-RO-1", patient_id: patientId, patient_name: "Anna Beispiel",
  patient_pid: "PT-0001", quote_id: null, quote_number: null, invoice_number: "INV-RO-1", invoice_type: "final",
  status: "draft", issued_at: "2026-09-07T10:00:00Z", created_at: "2026-09-07T10:00:00Z", updated_at: "2026-09-07T10:00:00Z",
  total_net: "1000", total_vat: "190", total_gross: "1190", paid_amount: "0", balance_due: "1190",
  due_date: null, paid_at: null, notes: null, line_items: [], available_prepayments: [], prepayment_allocations: [],
};

async function signIn(page: Page, role: string) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "read-only-test-token");
    localStorage.setItem("gmed_refresh_token", "read-only-test-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = [];
    if (path === "/me") {
      body = {
        id: `${role}-user`, email: `${role}@example.invalid`, name: `${role} QA`, role,
        capabilities: snapshotCapabilities(role), created_at: "2026-01-01T00:00:00Z",
      };
    }
    if (path === "/auth/refresh") body = { access_token: "read-only-test-token", refresh_token: "read-only-test-refresh", expires_in: 900 };
    if (path === "/patients") body = [patient];
    if (path === `/patients/${patientId}`) body = patient;
    if (path === "/orders") body = [order];
    if (path === `/orders/${orderId}`) body = order;
    if (path === `/orders/${orderId}/economics`) body = {
      order_id: orderId, currency: "EUR", economics_valid: true, margin_visible: false,
      planned: { revenue_net: "1000", revenue_gross: "1190", partner_cost_net: "0", margin_net: "1000" },
      actual: {
        recognized_revenue_net: "0", patient_cash_collected_gross: "0", invoice_outstanding_gross: "1190",
        paid_directly_by_patient_gross: "0", partner_cost_net: "0", paid_to_partner_gross: "0",
        unpaid_to_partner_gross: "0", margin_net: "0", margin_percent: "0",
      },
      warnings: [], services: [],
    };
    if (path === `/orders/${orderId}/group`) body = { head: { ...order, order_role: "standalone" }, subs: [], covered_patient_ids: [patientId], rollup_total_estimated: order.total_estimated };
    if (path === `/orders/${orderId}/workflow-checklist`) body = { scope_type: "order", scope_id: orderId, open_count: 0, completed_count: 0, items: [] };
    if (path === "/invoices") body = { items: [invoice], total: 1, page: 1, per_page: 50, total_pages: 1 };
    if (path === `/invoices/${invoiceId}`) body = invoice;
    if (/\/invoices\/[^/]+\/(payments|credit-notes|refunds)$/.test(path)) body = { items: [] };
    if (path === "/invoices/accounting-ledger") body = { year: 2026, summary: {}, monthly: [], entries: [] };
    if (path.includes("taxonomy")) body = { nodes: [] };
    if (path === "/stats/overview") body = {};
    await route.fulfill({ json: body });
  });
  return errors;
}

/**
 * Every shared form control outside a filter toolbar must be disabled: text
 * inputs and date pickers, select triggers, submit buttons and buttons marked
 * `data-action="write"`. Search boxes and toolbar fields (wrapped in a
 * `<label>`) stay usable so a viewer can still filter.
 */
async function writableControls(page: Page) {
  return page.evaluate(() => {
    const selector = [
      '[data-slot="input"]',
      'button[type="submit"]',
      '[data-action="write"]',
      '[role="combobox"]',
    ].join(", ");
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        if (element.closest("label") || element.closest('[data-slot="sheet-content"]')) return false;
        if (element.getAttribute("type") === "search") return false;
        if (element.getAttribute("data-readonly") === "exempt") return false;
        return !("disabled" in element && (element as HTMLButtonElement).disabled) && element.getAttribute("aria-disabled") !== "true";
      })
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 30)}`);
  });
}

const banner = (page: Page) => page.getByTestId("read-only-banner");

test.describe("CEO assistant cabinet is read-only", () => {
  test("patients: list loads with the banner, without the create button or writable fields", async ({ page }) => {
    const errors = await signIn(page, "ceo_assistant");
    await page.goto("/patients");
    await expect(page.getByRole("heading", { name: /Пациенты/ }).first()).toBeVisible();
    await expect(page.getByText("Anna", { exact: false }).first()).toBeVisible();
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toHaveCount(1);
    await expect(banner(page)).toContainText("Только просмотр");
    await expect(page.getByRole("button", { name: "Новый пациент" })).toHaveCount(0);
    expect(await writableControls(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("orders: list and detail load read-only while the search filter stays usable", async ({ page }) => {
    const errors = await signIn(page, "ceo_assistant");
    await page.goto("/orders");
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать заказ" })).toHaveCount(0);
    await expect(page.getByText("A-RO-1").first()).toBeVisible();
    const search = page.locator("#orders-search");
    await expect(search).toBeEnabled();
    expect(await writableControls(page)).toEqual([]);

    await page.goto(`/orders/${orderId}`);
    await expect(banner(page)).toHaveCount(1);
    await expect(page.getByText("A-RO-1").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Создать заказ" })).toHaveCount(0);
    expect(await writableControls(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("invoices: no outgoing or incoming invoice actions", async ({ page }) => {
    const errors = await signIn(page, "ceo_assistant");
    await page.goto("/invoices");
    await expect(banner(page)).toBeVisible();
    await expect(page.getByText("INV-RO-1").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Исходящий счёт", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Входящий счёт", exact: true })).toHaveCount(0);
    expect(await writableControls(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe("Billing keeps its write controls", () => {
  test("invoices: create button present and no banner", async ({ page }) => {
    const errors = await signIn(page, "billing");
    await page.goto("/invoices");
    await expect(page.getByText("INV-RO-1").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Исходящий счёт", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Исходящий счёт", exact: true })).toBeEnabled();
    await expect(banner(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("patients: billing views the list without a create button", async ({ page }) => {
    await signIn(page, "billing");
    await page.goto("/patients");
    await expect(banner(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Новый пациент" })).toHaveCount(0);
  });
});
