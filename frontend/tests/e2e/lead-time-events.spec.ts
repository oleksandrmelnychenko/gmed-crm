import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

import { startClockAt } from "./helpers";

// Timed events of the background jobs arrive live (owner request 2026-10-26):
// the deletion warning shows the «Автоудаление» countdown without a reload,
// a lead the retention sweep deleted leaves the list, and an open wizard says
// so instead of failing. Mocked API and realtime socket, synthetic data.

type Json = Record<string, unknown>;

const ANTON = "00000000-0000-0000-0000-00000000d001";
const SOFIA = "00000000-0000-0000-0000-00000000d002";

const baseLead: Json = {
  phone: "+49 30 100001",
  source: "manual",
  country: "DE",
  citizenships: ["DE"],
  intake_source: "manual",
  flow: "medical",
  lead_type: "console",
  console_promoted_at: "2026-10-05T12:00:00Z",
  qualification_status: "in_progress",
  compliance_status: "pending",
  conversion_ready: false,
  failed_outcome: { status: "none", reason: null, note: null, processed_at: null },
  attachment_count: 0,
  retention_deadline_at: null,
  portal_account: null,
  portal_intake: null,
  submitted_at: "2026-10-05T12:00:00Z",
  created_at: "2026-10-05T12:00:00Z",
};

function listLeads(): Json[] {
  return [
    { ...baseLead, id: ANTON, first_name: "Anton", last_name: "Testovich", email: "anton.testovich@example.com" },
    { ...baseLead, id: SOFIA, first_name: "Sofia", last_name: "Beispiel", email: "sofia.beispiel@example.com" },
  ];
}

function leadDetail(id: string, retentionDeadline: string | null): Json {
  return {
    id,
    first_name: "Anton",
    last_name: "Testovich",
    email: "anton.testovich@example.com",
    phone: null,
    date_of_birth: "1980-05-05",
    legal_sex: "male",
    qualification_status: "in_progress",
    compliance_status: "pending",
    intake_model: "patient_first",
    repeat_patient_id: null,
    retention_deadline_at: retentionDeadline,
    wizard_state: {},
    services: [],
    attachments: [],
    trusted_contacts: [],
    requested_specialties: [],
    created_at: "2026-10-01T08:00:00Z",
    updated_at: "2026-10-01T08:00:00Z",
    readiness: { conversion_ready: false, qualification_ready: false, qualification_reasons: [], blocking_reasons: [], steps: [], checks: [] },
  };
}

type Mock = {
  leads: Json[];
  retentionDeadline: string | null;
  emit: (type: string, entityId: string, payload?: Json) => void;
};

async function mount(page: Page): Promise<Mock> {
  await startClockAt(page);
  const sockets: WebSocketRoute[] = [];
  let seq = 0;
  const mock: Mock = {
    leads: listLeads(),
    retentionDeadline: null,
    emit(type, entityId, payload = {}) {
      for (const socket of sockets) {
        socket.send(JSON.stringify({ seq: ++seq, type, entity_type: "lead", entity_id: entityId, payload }));
      }
    },
  };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "lead-time-events-token");
    localStorage.setItem("gmed_refresh_token", "lead-time-events-refresh");
  });
  await page.routeWebSocket("**/api/v1/events/ws*", (socket) => {
    sockets.push(socket);
    socket.send(JSON.stringify({ type: "realtime.connected", entity_type: "realtime", entity_id: "ceo-1" }));
  });
  await page.routeWebSocket("**/api/v1/messages/ws*", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = decodeURIComponent(new URL(request.url()).pathname.replace("/api/v1", ""));
    let response: unknown = [];
    if (path === "/auth/refresh") response = { access_token: "lead-time-events-token", refresh_token: "lead-time-events-refresh" };
    else if (path === "/me") response = { id: "ceo-1", email: "ceo@example.com", name: "CEO Test", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    else if (path === "/sanctions/check") response = { status: "clear", list_version_date: "2026-10-01" };
    else if (path === "/leads") response = mock.leads;
    else if (path === `/leads/${ANTON}`) response = leadDetail(ANTON, mock.retentionDeadline);
    else if (path === `/leads/${ANTON}/update`) response = {};
    else if (path === "/orders" && request.method() === "POST") response = { id: "order-1" };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(response) });
  });
  return mock;
}

test("the deletion warning and the automatic deletion reach the open leads list live", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mock = await mount(page);
  await page.goto("/leads");
  await expect(page.getByText("Sofia").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-lead-retention-countdown]")).toHaveCount(0);

  // The sweep warned about Anton: the countdown appears without a reload.
  mock.leads = mock.leads.map((lead) =>
    lead.id === ANTON ? { ...lead, retention_deadline_at: "2026-10-15T10:00:00Z" } : lead,
  );
  mock.emit("lead.retention_warning", ANTON, { delete_at: "2026-10-15T10:00:00Z" });
  await expect(page.locator("[data-lead-retention-countdown]").first()).toContainText("15.10.2026");

  // The sweep deleted Sofia: her row leaves the list.
  mock.leads = mock.leads.filter((lead) => lead.id !== SOFIA);
  mock.emit("lead.purged", SOFIA, { reason: "unqualified_lead_retention" });
  await expect(page.getByText("Sofia")).toHaveCount(0);
  await expect(page.getByText("Anton").first()).toBeVisible();
});

test("an open wizard shows the countdown live and says when the lead was deleted", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const mock = await mount(page);
  await page.goto(`/leads?lead=${ANTON}&view=wizard`);
  const wizard = page.getByRole("dialog", { name: "Оформление обращения", exact: true });
  await expect(wizard).toBeVisible({ timeout: 45_000 });
  await expect(wizard.locator("#lead-wizard-first-name")).toHaveValue("Anton");
  await expect(wizard.locator("[data-lead-retention-countdown]")).toHaveCount(0);

  mock.retentionDeadline = "2026-10-15T10:00:00Z";
  mock.emit("lead.retention_warning", ANTON, { delete_at: "2026-10-15T10:00:00Z" });
  await expect(wizard.locator("[data-lead-retention-countdown]")).toContainText("15.10.2026");

  // Another lead's deletion changes nothing here.
  mock.emit("lead.purged", SOFIA, { reason: "unqualified_lead_retention" });
  await page.waitForTimeout(500);
  await expect(page.getByTestId("lead-wizard-purged")).toHaveCount(0);

  mock.emit("lead.purged", ANTON, { reason: "unqualified_lead_retention" });
  const purged = page.getByTestId("lead-wizard-purged");
  await expect(purged).toBeVisible();
  await expect(purged).toContainText("Лид удалён по сроку хранения");
  await expect(wizard.locator("#lead-wizard-first-name")).toHaveCount(0);
  // The footer button (the corner cross is the dialog's own).
  await purged.getByRole("button", { name: "Закрыть" }).first().click();
  await expect(purged).toHaveCount(0);
  await expect(page).not.toHaveURL(/view=wizard/);
});
