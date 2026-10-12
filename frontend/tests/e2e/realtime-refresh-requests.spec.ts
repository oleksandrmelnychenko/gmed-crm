import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

// QA round 2 (2026-10-12): C-29 — the "Очередь (N)" count follows a new
// portal request without a reload; C-33 — a navigation asks for each list
// once, not twice (the socket connecting and window focus repeated the load,
// the top bar and the nav panel each read the new-lead count).

const USER_ID = "a0000000-0000-0000-0000-000000000051";

type Mock = {
  requested: number;
  calls: Map<string, number>;
  emit: (type: string, entityType: string, entityId: string) => void;
};

function request(id: string) {
  return {
    id,
    patient_id: "b0000000-0000-0000-0000-000000000051",
    patient_name: "Mia Muster",
    patient_pid: "P-0051",
    appointment_type: "medical",
    care_path_kind: "regular",
    status: "requested",
    preferred_date_from: "2026-10-26",
    preferred_date_to: "2026-10-30",
    preferred_time_of_day: null,
    specialty: "cardiology",
    location: null,
    reason: "Kontrolle",
    notes: null,
    requested_at: `2026-10-12T0${id.length % 9}:00:00Z`,
    requested_by: "b0000000-0000-0000-0000-000000000052",
    requested_provider_id: null,
    requested_doctor_id: null,
    order_id: null,
  };
}

async function mockStaff(page: Page): Promise<Mock> {
  const sockets: WebSocketRoute[] = [];
  let seq = 0;
  const mock: Mock = {
    requested: 1,
    calls: new Map(),
    emit(type, entityType, entityId) {
      for (const socket of sockets) {
        socket.send(JSON.stringify({ seq: ++seq, type, entity_type: entityType, entity_id: entityId }));
      }
    },
  };
  await page.addInitScript(() => {
    localStorage.setItem("gmed_access_token", "realtime-test-token");
    localStorage.setItem("gmed_refresh_token", "realtime-test-refresh");
    localStorage.setItem("gmed_lang", "ru");
  });
  await page.routeWebSocket("**/api/v1/events/ws*", (socket) => {
    sockets.push(socket);
    socket.send(JSON.stringify({ type: "realtime.connected", entity_type: "realtime", entity_id: USER_ID }));
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (route.request().method() === "GET") {
      const key = `${path}${url.search}`;
      mock.calls.set(key, (mock.calls.get(key) ?? 0) + 1);
    }
    let body: unknown = [];
    if (path === "/auth/refresh") body = { access_token: "realtime-test-token", refresh_token: "realtime-test-refresh" };
    if (path === "/me") {
      body = { id: USER_ID, name: "Clara Chefin", email: "ceo@example.com", role: "ceo", created_at: "2026-01-01T00:00:00Z" };
    }
    if (path === "/stats/leads/by-status") body = [{ status: "new", count: 2 }];
    if (path === "/messages/unread-total") body = { count: 0 };
    if (path === "/appointments/requests" && url.searchParams.get("status") === "requested") {
      body = Array.from({ length: mock.requested }, (_, index) => request(`request-${index + 1}`));
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  return mock;
}

function calls(mock: Mock, prefix: string) {
  let total = 0;
  for (const [key, count] of mock.calls) if (key.startsWith(prefix)) total += count;
  return total;
}

test("the request queue count follows a new portal request live (QA C-29)", async ({ page }) => {
  const mock = await mockStaff(page);
  await page.goto("/appointments");
  const queue = page.getByRole("button", { name: /^Очередь \(1\)$/ });
  await expect(queue).toBeVisible({ timeout: 30_000 });

  mock.requested = 2;
  mock.emit("appointment_request.created", "appointment_request", "request-2");
  await expect(page.getByRole("button", { name: /^Очередь \(2\)$/ })).toBeVisible();
});

test("a navigation asks for the new-lead count and the task lists once (QA C-33)", async ({ page }) => {
  const mock = await mockStaff(page);
  await page.goto("/task-manager");
  await expect.poll(() => calls(mock, "/projects"), { timeout: 30_000 }).toBeGreaterThan(0);
  // Long enough for the socket's "connected" frame and a refocus to land.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(2_000);
  expect(calls(mock, "/projects")).toBe(1);
  expect(calls(mock, "/concierge-services")).toBe(1);
  expect(calls(mock, "/stats/leads/by-status")).toBe(1);

  // A lead event reads the count again, once for both badges.
  mock.emit("lead.created", "lead", "lead-1");
  await expect.poll(() => calls(mock, "/stats/leads/by-status")).toBe(2);
  await page.waitForTimeout(1_000);
  expect(calls(mock, "/stats/leads/by-status")).toBe(2);
});
