import { expect, test, type Page, type Route } from "@playwright/test";

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installAdminPatternMocks(page: Page) {
  const channels = [
    {
      id: "00000000-0000-0000-0000-000000001001",
      channel_type: "smtp",
      name: "Primary SMTP",
      config: { host: "smtp.gmed.de", port: 587, user: "ops@gmed.de" },
      is_active: true,
    },
    {
      id: "00000000-0000-0000-0000-000000001002",
      channel_type: "webhook",
      name: "Ops Webhook",
      config: { url: "https://ops.gmed.de/hooks/alerts", secret: "masked" },
      is_active: true,
    },
  ];

  const settings = [
    {
      key: "access_token_minutes",
      value: "\"15\"",
      description: "Controls short-lived access token lifetime.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "refresh_token_days",
      value: "\"30\"",
      description: "Controls refresh token validity.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "max_sessions_per_user",
      value: "\"5\"",
      description: "Caps concurrent device families.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "session_idle_days",
      value: "\"7\"",
      description: "Idle timeout before session revocation.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "agency_name",
      value: "\"GMED Berlin\"",
      description: "Primary agency legal display name.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "agency_care_of",
      value: "\"Operations Desk\"",
      description: "Care-of recipient label.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "agency_address",
      value: "\"Alexanderplatz 1\\n10178 Berlin\"",
      description: "Agency address block.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "agency_phone",
      value: "\"+49 30 123456\"",
      description: "Agency hotline.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "agency_email",
      value: "\"ops@gmed.de\"",
      description: "Agency operations mailbox.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "required_patient_documents",
      value: "\"Passport\\nInsurance card\\nConsent form\"",
      description: "Required intake document checklist.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "clinical_case_retention_years",
      value: "\"10\"",
      description: "Clinical retention horizon.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "maintenance_mode",
      value: "\"false\"",
      description: "Global maintenance switch.",
      updated_at: "2026-04-10T08:00:00Z",
    },
    {
      key: "maintenance_message",
      value: "\"Scheduled maintenance tonight 22:00 CET\"",
      description: "System-wide maintenance message.",
      updated_at: "2026-04-10T08:00:00Z",
    },
  ];

  const sessions = [
    {
      family_id: "session-family-001",
      user_id: "00000000-0000-0000-0000-000000000001",
      user_name: "Admin GMED",
      user_email: "admin@gmed.de",
      role: "ceo",
      ip_address: "10.0.0.12",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36",
      created_at: "2026-04-10T08:00:00Z",
      last_activity_at: "2026-04-21T16:30:00Z",
    },
  ];

  const pendingLogins = [
    {
      id: "pending-001",
      user_name: "Irina Ops",
      user_email: "irina@gmed.de",
      role: "billing",
      ip_address: "10.0.0.33",
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      device_info: null,
      created_at: "2026-04-21T10:00:00Z",
    },
  ];

  const ipWhitelist = [
    {
      id: "ip-001",
      cidr: "10.0.0.0/24",
      description: "HQ network",
      is_active: true,
    },
  ];

  const geoLogins = [
    {
      user_name: "Admin GMED",
      user_email: "admin@gmed.de",
      ip_address: "10.0.0.12",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)",
      geo_data: { country: "DE" },
      created_at: "2026-04-21T15:45:00Z",
      is_revoked: false,
    },
  ];

  const auditAnalytics = {
    summary: {
      failed_logins_24h: 4,
      blocked_logins_24h: 1,
      token_theft_30d: 0,
      executive_sensitive_access_7d: 3,
      off_hours_sensitive_access_7d: 2,
    },
    recent_suspicious_events: [
      {
        id: 1001,
        user_name: "Admin GMED",
        user_role: "ceo",
        action: "read",
        entity_type: "patient",
        reason: "Access outside standard hours",
        route: "/patients/0001",
        status: 200,
        ip_hash: "10.0.0.x",
        created_at: "2026-04-21T14:00:00Z",
      },
    ],
    top_sensitive_readers: [
      {
        user_id: "00000000-0000-0000-0000-000000000001",
        user_name: "Admin GMED",
        user_role: "ceo",
        event_count: 12,
        distinct_entities: 5,
      },
    ],
  };

  const healthPayload = {
    database: {
      size: "2.4 GB",
      active_connections: 8,
      tables: [
        { table: "patients", size: "512 MB" },
        { table: "appointments", size: "281 MB" },
      ],
    },
    users: {
      total: 22,
      active: 19,
      locked: 1,
    },
    sessions: {
      active: 11,
      pending_mfa: 2,
    },
    data: {
      patients: 218,
      leads: 41,
      orders: 37,
      audit_entries: 12803,
    },
  };

  const accessPolicies = [
    {
      role: "patient_manager",
      field_name: "name",
      access_level: "full",
      condition_type: null,
      is_system_locked: false,
    },
    {
      role: "teamlead_interpreter",
      field_name: "name",
      access_level: "masked",
      condition_type: null,
      is_system_locked: false,
    },
    {
      role: "interpreter",
      field_name: "name",
      access_level: "conditional",
      condition_type: "freigegeben",
      is_system_locked: false,
    },
    {
      role: "concierge",
      field_name: "name",
      access_level: "hidden",
      condition_type: null,
      is_system_locked: false,
    },
    {
      role: "billing",
      field_name: "name",
      access_level: "full",
      condition_type: null,
      is_system_locked: true,
    },
    {
      role: "sales",
      field_name: "name",
      access_level: "masked",
      condition_type: null,
      is_system_locked: false,
    },
    {
      role: "patient",
      field_name: "name",
      access_level: "full",
      condition_type: null,
      is_system_locked: false,
    },
    ...[
      "birth_date",
      "phone",
      "email",
      "nationality",
      "languages",
      "insurance",
      "diagnosis",
      "medications",
      "allergies",
      "vitals",
      "internal_notes",
      "travel_data",
    ].flatMap((fieldName) =>
      [
        "patient_manager",
        "teamlead_interpreter",
        "interpreter",
        "concierge",
        "billing",
        "sales",
        "patient",
      ].map((role) => ({
        role,
        field_name: fieldName,
        access_level:
          role === "patient_manager"
            ? "full"
            : role === "patient"
              ? "conditional"
              : role === "billing"
                ? "masked"
                : "hidden",
        condition_type: role === "patient" ? "freigegeben" : null,
        is_system_locked: role === "billing" && fieldName === "insurance",
      })),
    ),
  ];

  const complianceDashboard = {
    total: 16,
    granted_active: 11,
    revoked: 3,
    by_type: [
      {
        consent_type: "dsgvo_data_transfer",
        total: 8,
        active: 6,
      },
      {
        consent_type: "patient_portal_release",
        total: 5,
        active: 4,
      },
    ],
    recent_changes: [
      {
        patient_id: "patient-001",
        patient_pid: "PT-001",
        patient_name: "Anna Muster",
        user_name: "Admin GMED",
        consent_type: "dsgvo_data_transfer",
        granted: true,
        granted_at: "2026-04-19T09:00:00Z",
        expires_at: "2027-04-19T09:00:00Z",
        revoked_at: null,
      },
    ],
  };

  const expiredConsents = [
    {
      patient_id: "patient-002",
      patient_pid: "PT-002",
      patient_name: "Mila Weber",
      user_name: "Admin GMED",
      consent_type: "patient_portal_release",
      granted_at: "2025-01-01T09:00:00Z",
      expires_at: "2026-01-01T09:00:00Z",
    },
  ];

  const privacyQueue = [
    {
      id: "privacy-001",
      patient_id: "patient-001",
      patient_pid: "PT-001",
      patient_name: "Anna Muster",
      requested_by_name: "Anna Muster",
      reviewed_by_name: null,
      executed_by_name: null,
      request_type: "erasure",
      source: "patient_request",
      status: "requested",
      reason: "Please remove archived transfer data.",
      due_at: "2026-04-28T09:00:00Z",
      retention_until: null,
      review_note: null,
      requested_at: "2026-04-21T09:00:00Z",
      reviewed_at: null,
      executed_at: null,
      record_summary: {
        appointments: 3,
        cases: 1,
        orders: 1,
        documents: 4,
        invoices: 1,
      },
      manual_override: false,
      is_overdue: false,
    },
  ];

  const patientConsents = [
    {
      id: "consent-001",
      patient_id: "patient-001",
      patient_pid: "PT-001",
      patient_name: "Anna Muster",
      managed_by_name: "Admin GMED",
      consent_type: "dsgvo_data_transfer",
      granted: true,
      granted_at: "2026-04-19T09:00:00Z",
      expires_at: "2027-04-19T09:00:00Z",
      revoked_at: null,
      note: "Signed in clinic.",
      created_at: "2026-04-19T09:00:00Z",
    },
  ];

  const patientPrivacyRequests = [
    {
      id: "privacy-001",
      patient_id: "patient-001",
      patient_pid: "PT-001",
      patient_name: "Anna Muster",
      requested_by_name: "Anna Muster",
      reviewed_by_name: null,
      executed_by_name: null,
      request_type: "erasure",
      source: "patient_request",
      status: "requested",
      reason: "Please remove archived transfer data.",
      due_at: "2026-04-28T09:00:00Z",
      retention_until: null,
      review_note: null,
      requested_at: "2026-04-21T09:00:00Z",
      reviewed_at: null,
      executed_at: null,
      record_summary: {
        appointments: 3,
        cases: 1,
        orders: 1,
        documents: 4,
        invoices: 1,
      },
      manual_override: false,
      is_overdue: false,
    },
  ];

  const activityRows = [
    {
      user_name: "Admin GMED",
      user_email: "admin@gmed.de",
      action: "update_setting",
      entity_type: "setting",
      entity_id: "access_token_minutes",
      context: {
        old_value: "10",
        new_value: "15",
      },
      created_at: "2026-04-21T15:00:00Z",
    },
    {
      user_name: "Admin GMED",
      user_email: "admin@gmed.de",
      action: "login",
      entity_type: "session",
      entity_id: "session-family-001",
      context: {
        ip_address: "10.0.0.12",
      },
      created_at: "2026-04-21T14:30:00Z",
    },
  ];

  await page.addInitScript(() => {
    window.localStorage.setItem("gmed_lang", "de");
    window.localStorage.setItem("gmed_access_token", "playwright-access-token");
    window.localStorage.setItem("gmed_refresh_token", "playwright-refresh-token");
  });

  await page.route("**/auth/**", async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/auth/logout") return json(route, { ok: true });
    if (pathname === "/auth/refresh") {
      return json(route, {
        access_token: "playwright-access-token",
        refresh_token: "playwright-refresh-token",
        token_type: "Bearer",
        expires_in: 900,
      });
    }
    return json(route, { message: "Not mocked" }, 404);
  });

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const method = route.request().method();

    if (path === "/me") {
      return json(route, {
        id: "00000000-0000-0000-0000-000000000001",
        email: "admin@gmed.de",
        name: "Admin GMED",
        role: "ceo",
        created_at: "2026-01-01T00:00:00Z",
      });
    }

    if (path === "/notifications/unread-count") return json(route, { count: 0 });
    if (path === "/users/online") return json(route, []);
    if (path === "/notifications") return json(route, []);
    if (path === "/announcements/active") return json(route, []);
    if (path === "/notifications/read-all") return json(route, { ok: true });
    if (path.startsWith("/notifications/") && path.endsWith("/read")) {
      return json(route, { ok: true });
    }

    if (path === "/admin/notifications" && method === "GET") return json(route, channels);
    if (path === "/admin/notifications" && method === "POST") return json(route, { id: "created" });
    if (path.endsWith("/test")) return json(route, { ok: true });
    if (path.endsWith("/delete")) return json(route, { ok: true });

    if (path === "/admin/health") return json(route, healthPayload);

    if (path === "/access-policies" && url.searchParams.get("entity_type") === "patient") {
      return json(route, accessPolicies);
    }
    if (path === "/access-policies/update" && method === "POST") return json(route, { ok: true });
    if (path === "/access-policies/reset" && method === "POST") return json(route, { ok: true });

    if (path === "/admin/ip-whitelist" && method === "GET") return json(route, ipWhitelist);
    if (path === "/admin/ip-whitelist" && method === "POST") return json(route, { id: "ip-new" });
    if (path.startsWith("/admin/ip-whitelist/") && path.endsWith("/delete")) {
      return json(route, { ok: true });
    }

    if (path === "/admin/login-geo") return json(route, geoLogins);
    if (path === "/admin/audit-analytics") return json(route, auditAnalytics);
    if (path === "/admin/settings" && method === "GET") return json(route, settings);
    if (path.startsWith("/admin/settings/") && method === "POST") return json(route, { ok: true });
    if (path === "/admin/maintenance" && method === "POST") return json(route, { ok: true });
    if (path === "/admin/sessions" && method === "GET") return json(route, sessions);
    if (path === "/admin/sessions/revoke-all" && method === "POST") return json(route, { ok: true });
    if (path.startsWith("/admin/sessions/user/") && path.endsWith("/revoke")) {
      return json(route, { ok: true });
    }
    if (path === "/admin/mfa/pending" && method === "GET") return json(route, pendingLogins);
    if (path.startsWith("/admin/mfa/pending/") && path.endsWith("/approve")) {
      return json(route, { ok: true });
    }
    if (path.startsWith("/admin/mfa/pending/") && path.endsWith("/reject")) {
      return json(route, { ok: true });
    }

    if (path === "/admin/activity") return json(route, activityRows);

    if (path === "/admin/compliance/consents") return json(route, complianceDashboard);
    if (path === "/admin/compliance/consents/expired") return json(route, expiredConsents);
    if (path === "/admin/compliance/privacy-requests") return json(route, privacyQueue);
    if (path === "/admin/compliance/patient/patient-001/consents") return json(route, patientConsents);
    if (path === "/admin/compliance/patient/patient-001/privacy-requests") {
      return json(route, patientPrivacyRequests);
    }
    if (path === "/admin/compliance/patient/patient-001/consents" && method === "POST") {
      return json(route, { ok: true });
    }
    if (path === "/admin/compliance/patient/patient-001/privacy-requests" && method === "POST") {
      return json(route, { ok: true });
    }
    if (path.startsWith("/admin/compliance/privacy-requests/") && path.endsWith("/review")) {
      return json(route, { ok: true });
    }
    if (path.startsWith("/admin/compliance/privacy-requests/") && path.endsWith("/execute")) {
      return json(route, { ok: true, export_id: "export-001" });
    }

    return json(route, { message: `Not mocked: ${method} ${path}` }, 404);
  });
}

test.beforeEach(async ({ page }) => {
  await installAdminPatternMocks(page);
});

test("admin routes stay on the patients-style shell", async ({ page }) => {
  await page.goto("/admin/notifications");
  await expect(page.locator("h1", { hasText: "Benachrichtigungskanäle" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Neuer Kanal/i })).toBeVisible();
  await page.getByRole("button", { name: /Neuer Kanal/i }).click();
  await expect(page.getByRole("heading", { name: /Neuer Kanal/i })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-notifications-sheet.png", fullPage: true });
  await page.keyboard.press("Escape");
  await page.getByText("Primary SMTP").click();
  await expect(page.getByRole("heading", { name: /Primary SMTP/i })).toBeVisible();

  await page.goto("/admin/health");
  await expect(page.locator("h1", { hasText: "Systemstatus" })).toBeVisible();
  await expect(page.getByText(/Operative Aufmerksamkeit erforderlich/i)).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-health.png", fullPage: true });

  await page.goto("/admin/security");
  await expect(page.locator("h1", { hasText: "Sicherheit" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Wartungsmodus/i }).first()).toBeVisible();
  await page.getByRole("button", { name: /Wartungsmodus/i }).first().click();
  await expect(page.getByRole("heading", { name: /Wartungsmodus/i })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-security-sheet.png", fullPage: true });
  await page.keyboard.press("Escape");

  await page.goto("/admin/settings");
  await expect(page.locator("h1", { hasText: "Systemeinstellungen" })).toBeVisible();
  await page.getByRole("button", { name: /Token-Konfiguration/i }).first().click();
  await expect(page.getByRole("heading", { name: /Token-Konfiguration/i })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-settings-sheet.png", fullPage: true });

  await page.goto("/admin/access");
  await expect(page.locator("h1", { hasText: "Zugriffsmatrix" })).toBeVisible();
  await page.getByRole("button", { name: /Name/i }).click();
  await expect(page.getByRole("heading", { name: /^Name$/i })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-access-sheet.png", fullPage: true });
  await page.keyboard.press("Escape");

  await page.goto("/admin/activity");
  await expect(page.locator("h1", { hasText: "Aktivitätsprotokoll" })).toBeVisible();
  await page.getByText(/update setting/i).click();
  await expect(page.getByRole("heading", { name: /update setting/i })).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-activity-sheet.png", fullPage: true });
  await page.keyboard.press("Escape");

  await page.goto("/admin/compliance?patient=patient-001");
  await expect(page.locator("h1", { hasText: "DSGVO / Compliance" })).toBeVisible();
  await expect(page.getByText(/Patienten-Einwilligungsregister/i)).toBeVisible();
  await expect(page.getByText(/Privacy-Review-Queue|Datenschutz-Warteschlange/i)).toBeVisible();
  await page.screenshot({ path: "test-results/admin-pattern-compliance.png", fullPage: true });
});
