import { expect, test, type Page } from "@playwright/test";

// QA round 2, group E (2026-10-12): security page, activity details, DSGVO
// export block, Sales pages without patient requests, note visibility.

type Handler = (path: string, method: string, body: unknown) => unknown;

async function setup(page: Page, role: string, handler: Handler) {
  const requests: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "security-review-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    requests.push(`${method} ${path}`);
    if (path === "/me") {
      return route.fulfill({
        json: {
          id: "actor",
          email: "actor@example.com",
          name: "Mia Muster",
          role,
          created_at: "2026-01-01T00:00:00Z",
          password_change_required: false,
        },
      });
    }
    let body: unknown = null;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const answer = handler(path, method, body);
    if (answer !== undefined) return route.fulfill({ json: answer });
    if (path === "/stats/overview") return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  return requests;
}

/** QA E-32: metric cards neither overlap nor spill out of their card. */
async function expectMetricCardsSideBySide(page: Page, testId: string, count: number) {
  const metrics = page.getByTestId(testId);
  await expect(metrics).toBeVisible();
  const boxes = await metrics.locator(":scope > article").evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: node.scrollWidth };
    }),
  );
  expect(boxes).toHaveLength(count);
  for (let i = 0; i < boxes.length; i += 1) {
    expect(boxes[i].width).toBeLessThanOrEqual(Math.ceil(boxes[i].right - boxes[i].left) + 1);
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      expect(overlap, `${testId}: cards ${i} and ${j}`).toBe(false);
    }
  }
}

test("notification and feedback metric cards do not overlap at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, "ceo", (path) => {
    if (path === "/feedback/summary") {
      return {
        total_feedback: 12,
        reviewed_feedback: 10,
        patient_portal_count: 7,
        staff_capture_count: 5,
        nps_score: 42,
        promoters: 6,
        passives: 4,
        detractors: 2,
        average_scores: { overall: 4.5, interpreter: 4.6, concierge: 4.4, treatment: 4.7, service: 4.3 },
        top_promoters: [],
        interpreter_ranking: [],
        clinic_ranking: [],
      };
    }
    return undefined;
  });
  await page.goto("/admin/notifications");
  await expectMetricCardsSideBySide(page, "notification-metrics", 4);
  await page.goto("/feedback");
  await expectMetricCardsSideBySide(page, "feedback-metrics", 4);
});

const ANALYTICS = {
  summary: {
    failed_logins_24h: 3,
    blocked_logins_24h: 1,
    token_theft_30d: 0,
    executive_sensitive_access_7d: 0,
    off_hours_sensitive_access_7d: 0,
  },
  recent_suspicious_events: [
    {
      id: 1,
      user_id: null,
      user_name: null,
      user_role: null,
      action: "login_failure",
      entity_type: "auth",
      entity_id: null,
      reason_code: "login_failure",
      reason: "Failed login attempt",
      method: "POST",
      route: "/api/v1/auth/login",
      status: null,
      ip_hash: "sha256:abc",
      created_at: "2026-10-12T08:00:00Z",
      context: { reason: "unknown_email" },
    },
  ],
  top_sensitive_readers: [
    { user_id: null, user_name: null, user_role: "patient", event_count: 3, distinct_entities: 2 },
    { user_id: "pm-1", user_name: "Ben Muster", user_role: "patient_manager", event_count: 1, distinct_entities: 1 },
  ],
};

test("security page: real route, singular status, anonymous portal reader, no overlap at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setup(page, "it_admin", (path) => {
    if (path === "/admin/audit-analytics") return ANALYTICS;
    if (path === "/admin/settings") return [{ key: "maintenance_mode", value: "false" }];
    if (path === "/admin/login-geo") {
      return [
        {
          id: "s-1",
          user_id: "pm-1",
          user_name: "Ben Muster",
          user_email: "ben.muster@example.com",
          ip_address: "203.0.113.7",
          user_agent: "Mozilla/5.0",
          geo_data: null,
          created_at: "2026-10-12T07:00:00Z",
          last_activity_at: "2026-10-12T07:10:00Z",
          is_revoked: true,
        },
      ];
    }
    return undefined;
  });
  await page.goto("/admin/security");

  await expectMetricCardsSideBySide(page, "security-metrics", 4);

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByText("POST /api/v1/auth/login").first()).toBeVisible();
  await expect(page.getByText("Вход пациента или лида").first()).toBeVisible();
  await expect(page.getByText("Отозвана").first()).toBeVisible();
  await expect(page.getByText("Отозванные")).toHaveCount(0);
});

test("activity details: translated keys, no nulls, payer link labelled neutrally", async ({ page }) => {
  await setup(page, "ceo", (path) => {
    if (path === "/admin/activity") {
      return {
        items: [
          {
            id: "1",
            user_id: "00000000-0000-0000-0000-000000000000",
            user_name: "",
            user_email: "",
            actor_role: null,
            action: "login_failure",
            entity_type: "auth",
            entity_id: null,
            context: { reason: "unknown_email" },
            created_at: "2026-10-12T08:00:00Z",
          },
          {
            id: "2",
            user_id: "00000000-0000-0000-0000-000000000000",
            user_name: "",
            user_email: "",
            actor_role: null,
            action: "payer_link_verified",
            entity_type: "lead",
            entity_id: "84504b42-1111-4222-8333-944445555666",
            context: { first: true, link_id: "11111111-2222-4333-8444-555555555555" },
            created_at: "2026-10-12T07:59:00Z",
          },
          {
            id: "3",
            user_id: "pm-1",
            user_name: "Ben Muster",
            user_email: "ben.muster@example.com",
            actor_role: "patient_manager",
            action: "login",
            entity_type: "token_family",
            entity_id: null,
            context: { device: null, ip: null, sessions_ended_by_limit: [] },
            created_at: "2026-10-12T07:58:00Z",
          },
          {
            id: "4",
            user_id: "ceo-1",
            user_name: "Anna Muster",
            user_email: "anna.muster@example.com",
            actor_role: "ceo",
            action: "privacy_request.executed",
            entity_type: "privacy_request",
            entity_id: null,
            context: { executed_at: "2026-10-12T08:49:42.241514687+00:00" },
            created_at: "2026-10-12T08:49:42Z",
          },
        ],
        total: 4,
        limit: 50,
        offset: 0,
        has_more: false,
        view: "activity",
        summary: { activity_24h: 4, active_users_24h: 2, changes_24h: 1, security_24h: 2, technical_24h: 0 },
        retention: { technical_days: 30, meaningful_days: 365 },
      };
    }
    return undefined;
  });
  await page.goto("/admin/activity");

  const table = page.getByRole("table").first();
  await expect(table).toContainText("Причина: Неизвестный e-mail");
  await expect(table).toContainText("Запрос по ссылке плательщика");
  await expect(table).toContainText("Исполнено: 12.10.2026 10:49");
  // The payer's token link is not an "unauthorized request"; an anonymous
  // sign-in attempt still is.
  const payerRow = page.getByRole("row").filter({ hasText: "Запрос по ссылке плательщика" });
  await expect(payerRow).toHaveCount(1);
  await expect(payerRow).not.toContainText("Неавторизованный запрос");
  await expect(page.getByRole("row").filter({ hasText: "Неизвестный e-mail" })).toContainText(
    "Неавторизованный запрос",
  );
  await expect(table).not.toContainText("null");
  await expect(table).not.toContainText("unknown_email");
  await expect(table).not.toContainText("241514687");
});

test("IT admin sees no Art. 15 export button, only who produces the export", async ({ page }) => {
  await setup(page, "it_admin", () => undefined);
  await page.goto("/admin/compliance");
  await expect(page.getByTestId("compliance-export-not-available")).toContainText(
    "Экспорт данных (ст. 15) формируют CEO или менеджер пациента",
  );
  await expect(page.getByRole("button", { name: "Экспорт данных (ст. 15)", exact: true })).toHaveCount(0);
});

test("Sales opens projects and providers without asking for patients", async ({ page }) => {
  const requests = await setup(page, "sales", () => undefined);
  await page.goto("/projects");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.goto("/providers");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(requests.filter((entry) => entry.startsWith("GET /patients"))).toEqual([]);
});

test("a new note is private unless the author shares it", async ({ page }) => {
  const created: Array<Record<string, unknown>> = [];
  await setup(page, "patient_manager", (path, method, body) => {
    if (path === "/internal-notes" && method === "POST") {
      const input = body as Record<string, unknown>;
      created.push(input);
      return {
        id: `note-${created.length}`,
        title: input.title,
        body: input.body ?? null,
        created_by: "actor",
        created_by_name: "Mia Muster",
        updated_by: "actor",
        updated_by_name: "Mia Muster",
        visibility: input.visibility,
        visible_role: input.visibility === "role" ? "patient_manager" : null,
        created_at: "2026-10-12T09:00:00Z",
        updated_at: "2026-10-12T09:00:00Z",
        attachments: [],
      };
    }
    return undefined;
  });
  await page.goto("/notes");
  await page.getByRole("button", { name: "Новая заметка", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const visibility = dialog.getByRole("combobox", { name: "Видимость" });
  await expect(visibility).toContainText("Только я");
  await dialog.getByPlaceholder("Новая заметка").fill("Übergabe Mia");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => created.length).toBe(1);
  expect(created[0].visibility).toBe("private");

  await page.getByRole("button", { name: "Новая заметка", exact: true }).click();
  const second = page.getByRole("dialog");
  await second.getByRole("combobox", { name: "Видимость" }).click();
  await page.getByRole("option", { name: "Все сотрудники" }).click();
  await second.getByPlaceholder("Новая заметка").fill("Übergabe für alle");
  await second.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => created.length).toBe(2);
  expect(created[1].visibility).toBe("staff");
});
