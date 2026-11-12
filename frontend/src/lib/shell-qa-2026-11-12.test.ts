import { describe, expect, it } from "vitest";

import { ApiRequestError } from "./api";
import { recordLoadErrorText } from "./section-load-error";
import { canAccessStaffRoute, isKnownAppPath, pageLabelKeyForPath } from "./staff-route-access";
import { commandPaletteSearchKinds } from "@/components/command-palette";
import { metricRoute } from "@/pages/dashboard/model/role-dashboard-routes";
import { filterLeadsByPeriod, leadListPeriodFromSearchParams } from "@/pages/leads/model/leads-model";
import { buildInvoicesPath, DEFAULT_FILTERS, parseCreatedWithinDays } from "@/pages/invoices/model/invoice-model";
import { leadAccountText } from "@/pages/patient-lead/lead-shell-text";

// Shell and role homes, system QA B of 2026-11-12.
describe("record pages (S3-2)", () => {
  it("reads a missing, malformed or refused record alike, translated", () => {
    for (const status of [400, 403, 404]) {
      const error = new ApiRequestError("Patient not found", { status });
      expect(recordLoadErrorText(error, "ru")).toBe("Запись не найдена или недоступна для вашей роли.");
      expect(recordLoadErrorText(error, "de")).toContain("nicht gefunden");
    }
    expect(recordLoadErrorText(new ApiRequestError("boom", { status: 500 }), "ru")).not.toContain("boom");
  });
});

describe("unknown addresses (S3-3)", () => {
  it("tells an unknown address from a known page the role may not open", () => {
    expect(isKnownAppPath("/this-page-does-not-exist")).toBe(false);
    expect(isKnownAppPath("/employees/00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isKnownAppPath("/patients-x")).toBe(false);
    for (const path of ["/", "/patients", "/patients/abc", "/admin/users", "/request", "/subscriptions", "/notifications"]) {
      expect(isKnownAppPath(path)).toBe(true);
    }
    // A forbidden section stays forbidden (and leads home).
    expect(canAccessStaffRoute("sales", "/patients")).toBe(false);
  });

  it("names the page for the browser tab", () => {
    expect(pageLabelKeyForPath("/patients")?.labelKey).toBe("patients_title");
    expect(pageLabelKeyForPath("/patients/123")?.labelKey).toBe("patients_title");
    expect(pageLabelKeyForPath("/nowhere")).toBeNull();
    expect(pageLabelKeyForPath("/account", "lead")?.id).toBe("account");
    expect(pageLabelKeyForPath("/appointments", "patient")?.labelKey).toBe("nav_my_appointments");
  });
});

describe("dashboard counters open the matching list (S3-4)", () => {
  it("links each counter to its filtered list", () => {
    expect(metricRoute("ceo_assistant", "active_orders")).toBe("/orders?status=active");
    expect(metricRoute("patient_manager", "active_orders")).toBe("/orders?status=active&assigned=me");
    expect(metricRoute("sales", "new_leads_30d")).toBe("/leads?archived=true&created_within_days=30");
    expect(metricRoute("billing", "overdue_invoice_count")).toBe("/invoices?status=overdue");
    expect(metricRoute("billing", "invoices_30d")).toBe("/invoices?created_within_days=30");
    expect(metricRoute("it_admin", "active_sessions")).toBe("/admin/health");
    expect(metricRoute("it_admin", "pending_logins")).toBe("/admin/health");
  });

  it("filters leads by the counter's period", () => {
    const now = new Date("2026-11-12T12:00:00Z");
    const leads = [
      { id: "a", created_at: "2026-11-01T00:00:00Z", status_changed_at: "2026-11-01T00:00:00Z" },
      { id: "b", created_at: "2026-09-01T00:00:00Z", status_changed_at: "2026-11-05T00:00:00Z" },
      { id: "c", created_at: "2026-09-01T00:00:00Z", status_changed_at: null },
    ];
    const created = leadListPeriodFromSearchParams(new URLSearchParams("created_within_days=30"));
    expect(filterLeadsByPeriod(leads, created, now).map((lead) => lead.id)).toEqual(["a"]);
    const changed = leadListPeriodFromSearchParams(new URLSearchParams("status_within_days=30"));
    expect(filterLeadsByPeriod(leads, changed, now).map((lead) => lead.id)).toEqual(["a", "b"]);
    expect(leadListPeriodFromSearchParams(new URLSearchParams("created_within_days=x"))).toBeNull();
    expect(filterLeadsByPeriod(leads, null, now)).toHaveLength(3);
  });

  it("passes the invoice period to the list request", () => {
    expect(parseCreatedWithinDays("30")).toBe(30);
    expect(parseCreatedWithinDays("0")).toBeNull();
    expect(parseCreatedWithinDays("abc")).toBeNull();
    expect(buildInvoicesPath(DEFAULT_FILTERS, 1, 50, 30)).toContain("created_within_days=30");
    expect(buildInvoicesPath(DEFAULT_FILTERS, 1)).not.toContain("created_within_days");
  });
});

describe("global search (S3-5)", () => {
  it("searches only the lists the role may open", () => {
    expect(commandPaletteSearchKinds({ role: "sales" })).toEqual({ patients: false, leads: true, orders: false });
    expect(commandPaletteSearchKinds({ role: "ceo" })).toEqual({ patients: true, leads: true, orders: true });
    expect(commandPaletteSearchKinds({ role: "patient" })).toEqual({ patients: false, leads: false, orders: false });
  });
});

describe("lead cabinet account page (S3-1)", () => {
  it("speaks all four cabinet languages", () => {
    expect(leadAccountText("en", "account_profile_save")).toBe("Save profile");
    expect(leadAccountText("uk", "account_title")).toBe("Обліковий запис");
    expect(leadAccountText("de", "account_profile_language")).toBe("Sprache der Oberfläche");
    expect(leadAccountText("ru", "account_password_title")).toBeNull();
  });
});
