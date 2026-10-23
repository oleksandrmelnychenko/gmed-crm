import { expect, test, type Page } from "@playwright/test";

// QA round 3, group E (2026-10-12): note visibility read from the author's
// view, read-only CEO Assistant and archive/restore of notes, /reports and the
// CEO dashboard at 375 px, top lead countries, /feedback load errors.
// Synthetic data only.

type Handler = (path: string, method: string, url: URL, body: unknown) => unknown;
type Reply = { status: number; json: unknown };

function reply(status: number, json: unknown): Reply {
  return { status, json };
}

function isReply(value: unknown): value is Reply {
  return Boolean(value) && typeof value === "object" && "status" in (value as object) && "json" in (value as object);
}

async function setup(page: Page, role: string, handler: Handler, userId = "actor") {
  const requests: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("gmed_lang", "ru");
    localStorage.setItem("gmed_access_token", "qa-round3-e-token");
  });
  await page.routeWebSocket("**/api/**", (socket) => socket.close());
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    requests.push(`${method} ${path}${url.search}`);
    if (path === "/me") {
      return route.fulfill({
        json: {
          id: userId,
          email: "mia.muster@example.com",
          name: "Mia Muster",
          role,
          created_at: "2026-01-01T00:00:00Z",
          password_change_required: false,
        },
      });
    }
    let body: unknown;
    try {
      body = request.postDataJSON();
    } catch {
      body = null;
    }
    const answer = handler(path, method, url, body);
    if (isReply(answer)) return route.fulfill({ status: answer.status, json: answer.json });
    if (answer !== undefined) return route.fulfill({ json: answer });
    if (path === "/stats/overview") return route.fulfill({ json: {} });
    if (path === "/providers/taxonomy") return route.fulfill({ json: { nodes: [] } });
    return route.fulfill({ json: [] });
  });
  return requests;
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    main: document.querySelector("main")?.scrollWidth ?? 0,
  }));
  expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
  expect(overflow.main, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
}

function salesNote(overrides: Record<string, unknown> = {}) {
  return {
    id: "note-sales",
    title: "Übergabe Vertrieb (synthetisch)",
    body: "Synthetische Notiz von Ben Muster",
    created_by: "sales-1",
    created_by_name: "Ben Muster",
    created_by_role: "sales",
    updated_by: "sales-1",
    updated_by_name: "Ben Muster",
    visibility: "private",
    visible_role: null,
    created_at: "2026-10-12T08:00:00Z",
    updated_at: "2026-10-12T08:00:00Z",
    attachments: [],
    attachment_count: 0,
    ...overrides,
  };
}

test("the CEO reads the visibility choices of a Sales note from the author's view (E3-02)", async ({ page }) => {
  const updates: Array<Record<string, unknown>> = [];
  await setup(page, "ceo", (path, method, _url, body) => {
    if (path === "/internal-notes" && method === "GET") return [salesNote()];
    if (path === "/internal-notes/note-sales" && method === "GET") return salesNote();
    if (path === "/internal-notes/note-sales/update") {
      updates.push(body as Record<string, unknown>);
      return salesNote({ visibility: "role", visible_role: "sales", updated_at: "2026-10-12T09:00:00Z" });
    }
    return undefined;
  }, "ceo-1");
  await page.goto("/notes");
  const select = page.getByRole("combobox", { name: "Видимость" });
  await expect(select).toContainText("Только автор");
  await select.click();
  await expect(page.getByRole("option", { name: "Роль автора: Отдел продаж" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Только я" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: "Моя роль" })).toHaveCount(0);
  await page.getByRole("option", { name: "Роль автора: Отдел продаж" }).click();
  await expect(page.getByText("Видимость задаётся от лица автора заметки (Ben Muster). CEO видит все заметки.")).toBeVisible();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect.poll(() => updates.length).toBe(1);
  expect(updates[0].visibility).toBe("role");
  // The CEO may archive someone else's note.
  await expect(page.getByRole("button", { name: "Архивировать", exact: true })).toBeVisible();
});

test("the CEO Assistant only reads notes (E3-03)", async ({ page }) => {
  const writes: string[] = [];
  await setup(page, "ceo_assistant", (path, method) => {
    if (method === "POST") writes.push(path);
    if (path === "/internal-notes" && method === "GET") return [salesNote({ visibility: "staff" })];
    if (path === "/internal-notes/note-sales") {
      return salesNote({
        visibility: "staff",
        attachments: [
          {
            id: "file-1",
            file_name: "uebergabe.pdf",
            mime_type: "application/pdf",
            file_size: 2048,
            uploaded_by_name: "Ben Muster",
            created_at: "2026-10-12T08:00:00Z",
          },
        ],
      });
    }
    return undefined;
  });
  await page.goto("/notes");
  await expect(page.getByTestId("read-only-banner")).toBeVisible();
  await expect(page.getByText("uebergabe.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "Новая заметка" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Архивировать", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Прикрепить файл" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Удалить файл" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Архив", exact: true })).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveAttribute("readonly", "");
  expect(writes).toEqual([]);
});

test("a colleague edits a shared note but only the author archives and restores it (E3-03)", async ({ page }) => {
  const calls: string[] = [];
  let archived = false;
  const own = salesNote({ created_by: "actor", created_by_name: "Mia Muster", visibility: "staff" });
  await setup(page, "sales", (path, method, url) => {
    if (method === "POST") calls.push(path);
    if (path === "/internal-notes" && method === "GET") {
      if (url.searchParams.get("archived") === "true") {
        return archived ? [{ ...own, archived_at: "2026-10-12T10:00:00Z", updated_by_name: "Mia Muster" }] : [];
      }
      return archived ? [salesNote({ id: "note-other", visibility: "staff" })] : [own, salesNote({ id: "note-other", visibility: "staff" })];
    }
    if (path === "/internal-notes/note-sales" && method === "GET") return own;
    if (path === "/internal-notes/note-other" && method === "GET") return salesNote({ id: "note-other", visibility: "staff" });
    if (path === "/internal-notes/note-sales/archive") {
      archived = true;
      return {};
    }
    if (path === "/internal-notes/note-sales/restore") {
      archived = false;
      return own;
    }
    return undefined;
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/notes");
  // A colleague's shared note: editable text, no archive.
  await page.getByRole("button", { name: /Übergabe Vertrieb/ }).nth(1).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Архивировать", exact: true })).toHaveCount(0);
  await expect(page.getByText("Архивировать заметку может только её автор или CEO.", { exact: false })).toBeVisible();
  // The own note: archive, then restore from the archive.
  await page.getByRole("button", { name: /Übergabe Vertrieb/ }).first().click();
  await page.getByRole("button", { name: "Архивировать", exact: true }).click();
  await expect.poll(() => calls).toContain("/internal-notes/note-sales/archive");
  await page.getByRole("button", { name: "Архив", exact: true }).click();
  await expect(page.getByTestId("archived-note")).toContainText("В архиве с");
  await page.getByRole("button", { name: "Восстановить", exact: true }).click();
  await expect.poll(() => calls).toContain("/internal-notes/note-sales/restore");
  await expect(page.getByText("Заметка восстановлена")).toBeVisible();
  await expect(page.getByRole("button", { name: "Текущие", exact: true })).toHaveAttribute("aria-pressed", "true");
});

const REPORTS_WORKSPACE = {
  summary: {
    active_patients: 12,
    active_orders: 7,
    active_clinics: 3,
    delivered_service_items: 40,
    delivered_service_volume: "12500.00",
  },
  allowed_sections: ["billing_kpis", "sales_kpis"],
  clinics: [],
  countries: [],
  service_types: [],
  medical_providers: [],
  provider_costs: [],
  doctors: [],
  non_medical_providers: [],
  billing_kpis: {
    invoices_30d: 4,
    tracked_invoice_count: 9,
    overdue_invoice_count: 1,
    dunning_rate_pct: 11.1,
    avg_invoice_gross: 1234.5,
    avg_service_to_invoice_days: 3.2,
    paid_within_14d_rate_pct: 75,
    outstanding_receivables_total: "6838.53",
    self_pay_share_pct: 60,
    cost_passthrough_share_pct: 12.5,
  },
  sales_kpis: {
    new_leads_30d: 13,
    qualified_leads_30d: 4,
    converted_leads_30d: 2,
    lead_to_patient_conversion_rate_pct: 15.4,
    active_lead_country_count: 3,
    new_partner_clinics_90d: 1,
    top_countries: [
      { country: "DE", label: null, lead_count: 18 },
      { country: null, label: null, lead_count: 3 },
      { country: "CN", label: null, lead_count: 2 },
      { country: "PL", label: null, lead_count: 2 },
    ],
  },
  financial_metrics_visible: true,
};

const FORECASTING = {
  summary: {
    open_quotes: 0,
    expiring_quotes_next_14d: 0,
    followup_milestones_next_30d: 0,
    appointments_next_30d: 0,
  },
  allowed_sections: ["quote_pipeline", "collections", "followup", "clinic_capacity"],
  quote_pipeline: { open_quotes: 0, expiring_next_14d: 0, gross_total: null, weighted_gross: null, by_status: [] },
  collections: {
    due_next_14d_count: 0,
    due_next_14d_total: null,
    overdue_invoice_count: 0,
    overdue_open_total: null,
    outstanding_open_total: null,
    workflow_open_count: 0,
    payment_plan_count: 0,
    escalated_count: 0,
    reviews_due_7d: 0,
  },
  followup: {
    active_orders: 0,
    doctor_followup_open: 0,
    followup_1w_due_next_30d: 0,
    followup_1m_due_next_30d: 0,
    followup_6m_due_next_30d: 0,
    package_end_due_next_30d: 0,
    results_handoff_pending: 0,
    milestones_due_next_30d: 0,
  },
  clinic_capacity: { appointments_next_30d_total: 0, followup_appointments_next_30d_total: 0, active_clinics: 0, clinics: [] },
};

test("/reports fits a 375 px phone and names lead countries in Russian (E3-05, E3-06)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  await setup(page, "ceo", (path) => {
    if (path === "/stats/reports/workspace") return REPORTS_WORKSPACE;
    if (path === "/stats/forecasting") return FORECASTING;
    return undefined;
  });
  await page.goto("/reports");
  const weights = page.getByTestId("report-capsule-metric").filter({ hasText: "Вес по статусу" });
  await expect(weights).toBeVisible();
  // The label stays on one line instead of one letter per line.
  const label = weights.getByText("Вес по статусу", { exact: true });
  expect((await label.boundingBox())!.height).toBeLessThan(24);
  const box = (await weights.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(376);
  const bars = page.getByTestId("lead-country-bar");
  await expect(bars).toHaveCount(4);
  await expect(bars.nth(0)).toContainText("Германия");
  await expect(bars.nth(1)).toContainText("Не указана");
  await expect(bars.nth(2)).toContainText("Китай");
  await expect(page.getByText("3 страны по лидам")).toBeVisible();
  await expect(page.getByText("Unknown")).toHaveCount(0);
  await expectNoSidewaysScroll(page);
  expect(failures).toEqual([]);
});

const FEEDBACK_SUMMARY = {
  total_feedback: 9,
  reviewed_feedback: 7,
  patient_portal_count: 5,
  staff_capture_count: 4,
  nps_score: 67,
  promoters: 7,
  passives: 1,
  detractors: 1,
  average_scores: { overall: 4.94, interpreter: 5, concierge: 4.8, treatment: 4.9, service: 4.7 },
  complication_rate: 0,
  top_promoters: [{ patient_id: "p-1", patient_name: "Anna Muster", feedback_count: 1, average_nps: 10 }],
  interpreter_ranking: [{ user_id: "i-1", name: "Mia Muster", feedback_count: 2, average_score: 4.95 }],
  clinic_ranking: [],
};

test("/feedback shows a load error with retry instead of 'no reviews' (E3-07)", async ({ page }) => {
  let failing = true;
  await setup(page, "ceo", (path) => {
    if (path === "/feedback/summary") return failing ? reply(503, { error: "unavailable" }) : FEEDBACK_SUMMARY;
    if (path === "/feedback") return failing ? reply(503, { error: "unavailable" }) : [];
    return undefined;
  });
  await page.goto("/feedback");
  const failure = page.getByTestId("feedback-load-error");
  await expect(failure).toContainText("Не удалось загрузить рабочую область отзывов.");
  await expect(page.getByTestId("feedback-metrics")).toHaveCount(0);
  await expect(page.getByText("Всего отзывов")).toHaveCount(0);
  failing = false;
  await failure.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByTestId("feedback-load-error")).toHaveCount(0);
  const metrics = page.getByTestId("feedback-metrics");
  await expect(metrics).toContainText("4,9");
  await expect(page.getByText("1 отзыв", { exact: true })).toBeVisible();
  await expect(page.getByText("2 оценки", { exact: true })).toBeVisible();
  await expect(page.getByText(/^0,0\s%$/)).toBeVisible();
});

test("the CEO dashboard does not scroll sideways at 375 px with long titles (E3-04)", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const longTitle = `Clinic-follow-up-e2e-${"f6dd2fcc287e".repeat(6)}`;
  await setup(page, "ceo", (path) => {
    if (path === "/stats/appointments/upcoming") {
      return [
        {
          id: "appt-1",
          title: longTitle,
          date: "2026-10-14",
          time_start: "09:30:00",
          status: "scheduled",
          patient_name: `Anna-Muster-${"x".repeat(60)}`,
        },
      ];
    }
    return undefined;
  });
  await page.goto("/");
  await expect(page.getByText(longTitle)).toBeVisible();
  await expectNoSidewaysScroll(page);
  const section = (await page.getByTestId("executive-cash-and-events").boundingBox())!;
  expect(section.width).toBeLessThanOrEqual(376);
});
