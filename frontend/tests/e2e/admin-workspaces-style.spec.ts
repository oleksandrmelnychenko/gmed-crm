import { expect, test, type Page, type TestInfo } from "@playwright/test";

type RequestRecord = { path: string; method: string; body: unknown };
async function mockWorkspace(page: Page, data: Record<string, unknown>) {
  const requests: RequestRecord[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "admin-workspaces-fixture");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/v1", "");
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      /* GET requests have no body. */
    }
    requests.push({ path, method: request.method(), body });
    if (path === "/me")
      return route.fulfill({
        json: {
          id: "actor",
          name: "Mia Muster",
          email: "mia@example.com",
          role: "it_admin",
          password_change_required: false,
        },
      });
    return route.fulfill({
      json: data[path] ?? (path === "/stats/overview" ? {} : []),
    });
  });
  return requests;
}

async function responsiveProof(page: Page, testInfo: TestInfo, name: string) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId(`${name}-workspace`)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    const metrics = page.getByTestId(`${name}-metrics`);
    const boxes = await metrics
      .locator(":scope > article")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const box = node.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: node.scrollWidth,
          };
        }),
      );
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].width).toBeLessThanOrEqual(
        Math.ceil(boxes[i].right - boxes[i].left) + 1,
      );
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        expect(
          a.left < b.right - 1 &&
            b.left < a.right - 1 &&
            a.top < b.bottom - 1 &&
            b.top < a.bottom - 1,
        ).toBe(false);
      }
    }
    await page.screenshot({
      path: testInfo.outputPath(`${name}-${width}.png`),
      fullPage: true,
    });
  }
}

async function dialogProof(page: Page, testInfo: TestInfo, name: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(10);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 10,
  );
  expect(bounds!.y).toBeGreaterThanOrEqual(10);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 10,
  );
  const overlay = page.locator('[data-slot="dialog-overlay"]').last();
  await expect(overlay).toBeVisible();
  expect(
    await overlay.evaluate((node) => getComputedStyle(node).backgroundColor),
  ).toMatch(/(?:0\.4|40%)/);
  await page.screenshot({
    path: testInfo.outputPath(`${name}-dialog.png`),
    fullPage: true,
  });
}

const analytics = {
  summary: {
    failed_logins_24h: 3,
    blocked_logins_24h: 1,
    token_theft_30d: 0,
    executive_sensitive_access_7d: 2,
    off_hours_sensitive_access_7d: 1,
  },
  recent_suspicious_events: [
    {
      id: 1,
      user_name: "Mia Muster",
      user_role: "it_admin",
      action: "login_failure",
      entity_type: "auth",
      reason_code: "login_failure",
      reason: "Failed login attempt",
      method: "POST",
      route: "/api/v1/auth/login",
      status: 401,
      ip_hash: "sha256:fixture",
      created_at: "2026-10-12T08:00:00Z",
    },
  ],
  top_sensitive_readers: [
    {
      user_id: "reader",
      user_name: "Ben Muster",
      user_role: "patient_manager",
      event_count: 12,
      distinct_entities: 4,
    },
  ],
};

test("security workspace is responsive and keeps maintenance confirmation and IP form actions", async ({
  page,
}, testInfo) => {
  const requests = await mockWorkspace(page, {
    "/admin/settings": [{ key: "maintenance_mode", value: "false" }],
    "/admin/audit-analytics": analytics,
    "/admin/ip-whitelist": [
      {
        id: "ip-1",
        cidr: "203.0.113.0/24",
        description: "Office",
        is_active: true,
      },
    ],
    "/admin/login-geo": [
      {
        user_name: "Ben Muster",
        user_email: "ben@example.com",
        ip_address: "203.0.113.7",
        user_agent: "Chrome / Windows",
        created_at: "2026-10-12T08:00:00Z",
        is_revoked: false,
      },
    ],
  });
  await page.goto("/admin/security");
  await responsiveProof(page, testInfo, "security");
  await page
    .getByRole("button", { name: "Режим обслуживания", exact: true })
    .click();
  await dialogProof(page, testInfo, "security-maintenance");
  let confirmed = false;
  page.once("dialog", async (nativeDialog) => {
    confirmed = true;
    await nativeDialog.dismiss();
  });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Включить", exact: true })
    .click();
  expect(confirmed).toBe(true);
  expect(
    requests.filter((request) => request.path === "/admin/maintenance"),
  ).toEqual([]);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Добавить IP", exact: true })
    .first()
    .click();
  await dialogProof(page, testInfo, "security-ip");
  await page
    .getByRole("dialog")
    .getByLabel("CIDR (напр. 192.168.1.0/24)")
    .fill("198.51.100.0/24");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Добавить IP", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    requests.find(
      (request) =>
        request.path === "/admin/ip-whitelist" && request.method === "POST",
    )?.body,
  ).toEqual({ cidr: "198.51.100.0/24", description: null });
});

test("activity workspace keeps readable filters and complete event diagnostics in a centered dialog", async ({
  page,
}, testInfo) => {
  await mockWorkspace(page, {
    "/admin/activity": {
      items: [
        {
          id: "event-1",
          user_id: "reader",
          user_name: "Ben Muster",
          user_email: "ben@example.com",
          actor_role: "patient_manager",
          action: "login_failure",
          entity_type: "auth",
          entity_id: null,
          context: {
            reason: "unknown_email",
            method: "POST",
            route: "/api/v1/auth/login",
            status: 401,
          },
          created_at: "2026-10-12T08:00:00Z",
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
      has_more: false,
      view: "activity",
      summary: {
        activity_24h: 15,
        active_users_24h: 3,
        changes_24h: 7,
        security_24h: 1,
        technical_24h: 4,
      },
      retention: { technical_days: 30, meaningful_days: 365 },
    },
  });
  await page.goto("/admin/activity");
  await responsiveProof(page, testInfo, "activity");
  await page.getByRole("listitem").filter({ hasText: "Ben Muster" }).click();
  await dialogProof(page, testInfo, "activity");
  await expect(page.getByRole("dialog")).toContainText("Неизвестный e-mail");
  await page.getByRole("dialog").locator("summary").click();
  await expect(page.getByRole("dialog").locator("pre")).toContainText(
    '"status": 401',
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("health workspace retains database and queue diagnostics across responsive layouts", async ({
  page,
}, testInfo) => {
  await mockWorkspace(page, {
    "/admin/health": {
      database: {
        size: "24 MB",
        active_connections: 4,
        tables: [
          { table: "audit_log", size: "12 MB" },
          { table: "users", size: "4 MB" },
        ],
      },
      users: { total: 12, active: 10, locked: 1 },
      sessions: { active: 7, pending_mfa: 1 },
      data: { patients: 20, leads: 6, orders: 12, audit_entries: 320 },
      medication_ai: {
        provider: {
          kind: "openai",
          status: "ready",
          external_calls_enabled: true,
          reason_code: "ready",
          model: "fixture-model",
        },
        operational_status: "attention",
        queue: {
          available: true,
          total: 12,
          requested: 2,
          processing: 1,
          ready: 8,
          failed: 1,
          stale_processing: 1,
          ready_last_24h: 8,
          failed_last_24h: 1,
          lease_recovered_last_24h: 1,
          lease_exhausted_last_24h: 0,
          oldest_requested_seconds: 80,
          last_ready_at: "2026-10-12T08:00:00Z",
          last_failed_at: "2026-10-12T07:00:00Z",
          last_lease_recovery_at: "2026-10-12T07:10:00Z",
          last_lease_exhausted_at: null,
        },
      },
      clinical_imports: {
        available: true,
        operational_status: "healthy",
        queued: 0,
        processing: 0,
        stale_processing: 0,
        retried_processing: 0,
        stale_applying: 0,
        failed_last_24h: 0,
        attempts_exhausted_last_24h: 0,
        oldest_queued_seconds: null,
        max_attempts: 3,
      },
    },
  });
  await page.goto("/admin/health");
  await responsiveProof(page, testInfo, "health");
  await expect(page.getByRole("listitem").filter({ hasText: "audit_log" })).toBeVisible();
  await page
    .getByRole("button", { name: "Детали", exact: true })
    .last()
    .click();
  await dialogProof(page, testInfo, "health-ai");
  await expect(page.getByRole("dialog")).toContainText("fixture-model");
  await expect(page.getByRole("dialog")).toContainText("12.10.2026");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Закрыть", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
