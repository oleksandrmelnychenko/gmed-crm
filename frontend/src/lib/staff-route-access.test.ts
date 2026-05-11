import { describe, expect, it } from "vitest";

import {
  ALL_STAFF_ROLES,
  canAccessPatientPortalRoute,
  canAccessStaffRoute,
  listPatientPortalNavItems,
  listStaffNavItems,
  peekStaffRouteRule,
  staffHrefIfAllowed,
} from "./staff-route-access";

const SAMPLE_PATHS = [
  "/",
  "/chat",
  "/feedback",
  "/reports",
  "/recommendations",
  "/contracts",
  "/invoices",
  "/finance-catalog",
  "/documents",
  "/documents/00000000-0000-0000-0000-000000000001",
  "/appointments",
  "/appointments/00000000-0000-0000-0000-000000000002",
  "/orders",
  "/orders?order=x",
  "/orders/00000000-0000-0000-0000-000000000006",
  "/leads",
  "/cases",
  "/cases/00000000-0000-0000-0000-000000000003",
  "/sops",
  "/providers",
  "/providers/00000000-0000-0000-0000-000000000004",
  "/patients",
  "/patients/00000000-0000-0000-0000-000000000005",
  "/services",
  "/privacy",
  "/admin",
  "/admin/access",
  "/admin/activity",
  "/admin/announcements",
  "/admin/users",
  "/admin/compliance",
  "/admin/compliance?patient=abc",
  "/admin/custom-fields",
  "/admin/health",
  "/admin/notifications",
  "/admin/security",
  "/admin/settings",
  "/unknown-route",
  "/chat/deep-should-deny",
];

describe("canAccessStaffRoute", () => {
  it("denies patient role (portal uses separate whitelist)", () => {
    expect(canAccessStaffRoute("patient", "/")).toBe(false);
  });

  it("allows all staff roles on dashboard", () => {
    for (const role of ALL_STAFF_ROLES) {
      expect(canAccessStaffRoute(role, "/")).toBe(true);
    }
  });

  it("matches peekStaffRouteRule for every sample path × staff role", () => {
    for (const path of SAMPLE_PATHS) {
      const rule = peekStaffRouteRule(path);
      const allowedRoles = new Set(rule?.roles ?? []);
      for (const role of ALL_STAFF_ROLES) {
        const expected = allowedRoles.has(role);
        expect(canAccessStaffRoute(role, path)).toBe(expected);
      }
    }
  });

  it("blocks sales from chat and documents", () => {
    expect(canAccessStaffRoute("sales", "/chat")).toBe(false);
    expect(canAccessStaffRoute("sales", "/documents")).toBe(false);
    expect(canAccessStaffRoute("sales", "/reports")).toBe(true);
  });

  it("blocks high-risk workspace boundaries across sales concierge and billing", () => {
    expect(canAccessStaffRoute("ceo", "/recommendations")).toBe(true);
    expect(canAccessStaffRoute("sales", "/recommendations")).toBe(false);
    expect(canAccessStaffRoute("sales", "/documents")).toBe(false);
    expect(canAccessStaffRoute("sales", "/contracts")).toBe(false);
    expect(canAccessStaffRoute("sales", "/invoices")).toBe(false);
    expect(canAccessStaffRoute("sales", "/finance-catalog")).toBe(false);
    expect(canAccessStaffRoute("concierge", "/contracts")).toBe(false);
    expect(canAccessStaffRoute("concierge", "/invoices")).toBe(false);
    expect(canAccessStaffRoute("billing", "/finance-catalog")).toBe(true);
    expect(canAccessStaffRoute("billing", "/cases")).toBe(false);
    expect(canAccessStaffRoute("billing", "/documents")).toBe(true);
    expect(canAccessStaffRoute("billing", "/invoices")).toBe(true);
    expect(canAccessStaffRoute("patient_manager", "/cases")).toBe(true);
  });

  it("keeps it_admin inside admin-only shell and out of patient-bearing workspaces", () => {
    expect(canAccessStaffRoute("it_admin", "/admin/settings")).toBe(true);
    expect(canAccessStaffRoute("it_admin", "/patients")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/cases")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/reports")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/documents")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/contracts")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/invoices")).toBe(false);
  });

  it("blocks billing and ceo_assistant from appointments", () => {
    expect(canAccessStaffRoute("billing", "/appointments")).toBe(false);
    expect(canAccessStaffRoute("ceo_assistant", "/appointments")).toBe(false);
    expect(canAccessStaffRoute("patient_manager", "/appointments")).toBe(true);
  });

  it("allows ceo and it_admin on generic /admin tooling routes", () => {
    expect(canAccessStaffRoute("patient_manager", "/admin/settings")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/admin/settings")).toBe(true);
    expect(canAccessStaffRoute("ceo", "/admin/settings")).toBe(true);
    expect(canAccessStaffRoute("ceo_assistant", "/admin/settings")).toBe(false);
  });

  it("allows compliance-authorized roles into /admin/compliance and excludes ceo_assistant + it_admin", () => {
    // Phase F micro-fix: tightened to {ceo, patient_manager} to match
    // admin_compliance::consent_dashboard at routes/admin_compliance.rs:123.
    expect(canAccessStaffRoute("patient_manager", "/admin/compliance")).toBe(true);
    expect(canAccessStaffRoute("ceo", "/admin/compliance")).toBe(true);
    expect(canAccessStaffRoute("it_admin", "/admin/compliance")).toBe(false);
    expect(canAccessStaffRoute("ceo_assistant", "/admin/compliance")).toBe(false);
    expect(canAccessStaffRoute("billing", "/admin/compliance")).toBe(false);
    expect(canAccessStaffRoute("interpreter", "/admin/compliance")).toBe(false);
    // The narrower rule must NOT leak access to other admin areas
    expect(canAccessStaffRoute("patient_manager", "/admin/settings")).toBe(false);
  });

  it("allows users-management roles into /admin/users and excludes ceo_assistant", () => {
    expect(canAccessStaffRoute("ceo", "/admin/users")).toBe(true);
    expect(canAccessStaffRoute("it_admin", "/admin/users")).toBe(true);
    expect(canAccessStaffRoute("ceo_assistant", "/admin/users")).toBe(false);
    expect(canAccessStaffRoute("patient_manager", "/admin/users")).toBe(false);
    expect(canAccessStaffRoute("ceo", "/admin/settings")).toBe(true);
    expect(canAccessStaffRoute("ceo_assistant", "/admin/settings")).toBe(false);
  });

  it("aligns /admin/custom-fields with backend allow list (ceo passes via bypass)", () => {
    expect(canAccessStaffRoute("it_admin", "/admin/custom-fields")).toBe(true);
    expect(canAccessStaffRoute("patient_manager", "/admin/custom-fields")).toBe(true);
    expect(canAccessStaffRoute("sales", "/admin/custom-fields")).toBe(true);
    expect(canAccessStaffRoute("ceo", "/admin/custom-fields")).toBe(true);
    expect(canAccessStaffRoute("ceo_assistant", "/admin/custom-fields")).toBe(false);
    expect(canAccessStaffRoute("billing", "/admin/custom-fields")).toBe(false);
  });

  it("matches dynamic patient and provider paths against tightened role lists", () => {
    // /patients now excludes sales and it_admin per backend list_patients
    expect(
      canAccessStaffRoute("sales", "/patients/00000000-0000-0000-0000-000000000001"),
    ).toBe(false);
    expect(
      canAccessStaffRoute("it_admin", "/patients/00000000-0000-0000-0000-000000000001"),
    ).toBe(false);
    expect(
      canAccessStaffRoute("interpreter", "/patients/00000000-0000-0000-0000-000000000001"),
    ).toBe(true);
    // /providers now allows ceo, patient_manager, concierge, billing, sales
    expect(
      canAccessStaffRoute("billing", "/providers/00000000-0000-0000-0000-000000000002"),
    ).toBe(true);
    expect(
      canAccessStaffRoute("interpreter", "/providers/00000000-0000-0000-0000-000000000002"),
    ).toBe(false);
  });

  it("blocks non-lead roles from /leads (ceo passes via full-access policy)", () => {
    expect(canAccessStaffRoute("patient_manager", "/leads")).toBe(true);
    expect(canAccessStaffRoute("sales", "/leads")).toBe(true);
    expect(canAccessStaffRoute("ceo", "/leads")).toBe(true);
    expect(canAccessStaffRoute("interpreter", "/leads")).toBe(false);
    expect(canAccessStaffRoute("billing", "/leads")).toBe(false);
    expect(canAccessStaffRoute("ceo_assistant", "/leads")).toBe(false);
    expect(canAccessStaffRoute("concierge", "/leads")).toBe(false);
    expect(canAccessStaffRoute("teamlead_interpreter", "/leads")).toBe(false);
    expect(canAccessStaffRoute("it_admin", "/leads")).toBe(false);
  });

  it("blocks non-case roles from /cases (Phase F: matches list_cases allow list)", () => {
    expect(canAccessStaffRoute("ceo", "/cases")).toBe(true);
    expect(canAccessStaffRoute("patient_manager", "/cases")).toBe(true);
    expect(canAccessStaffRoute("interpreter", "/cases")).toBe(false);
    expect(canAccessStaffRoute("billing", "/cases")).toBe(false);
    expect(canAccessStaffRoute("sales", "/cases")).toBe(false);
  });

  it("blocks non-order roles from /orders", () => {
    expect(canAccessStaffRoute("patient_manager", "/orders")).toBe(true);
    expect(
      canAccessStaffRoute("patient_manager", "/orders/00000000-0000-0000-0000-000000000006"),
    ).toBe(true);
    expect(canAccessStaffRoute("billing", "/orders")).toBe(true);
    expect(canAccessStaffRoute("ceo", "/orders")).toBe(true);
    expect(canAccessStaffRoute("interpreter", "/orders")).toBe(false);
    expect(canAccessStaffRoute("sales", "/orders")).toBe(false);
  });

  it("blocks non-services roles from /services (Phase F: matches list_concierge_services allow list)", () => {
    expect(canAccessStaffRoute("ceo", "/services")).toBe(true);
    expect(canAccessStaffRoute("patient_manager", "/services")).toBe(true);
    expect(canAccessStaffRoute("concierge", "/services")).toBe(true);
    expect(canAccessStaffRoute("billing", "/services")).toBe(true);
    expect(canAccessStaffRoute("interpreter", "/services")).toBe(false);
    expect(canAccessStaffRoute("sales", "/services")).toBe(false);
    expect(canAccessStaffRoute("ceo_assistant", "/services")).toBe(false);
  });

  it("keeps patient privacy out of non-ceo staff shell", () => {
    for (const role of ALL_STAFF_ROLES) {
      expect(canAccessStaffRoute(role, "/privacy")).toBe(role === "ceo");
    }
  });

  it("denies unknown paths", () => {
    expect(canAccessStaffRoute("ceo", "/unknown-module")).toBe(false);
  });
});

describe("canAccessPatientPortalRoute", () => {
  it("allows only mounted patient portal shell routes", () => {
    expect(canAccessPatientPortalRoute("/")).toBe(true);
    expect(canAccessPatientPortalRoute("/chat")).toBe(true);
    expect(canAccessPatientPortalRoute("/recommendations")).toBe(true);
    expect(canAccessPatientPortalRoute("/privacy")).toBe(true);
    expect(canAccessPatientPortalRoute("/documents?tab=portal")).toBe(true);
    expect(canAccessPatientPortalRoute("/reports")).toBe(false);
    expect(canAccessPatientPortalRoute("/patients")).toBe(false);
    expect(canAccessPatientPortalRoute("/documents/abc")).toBe(false);
  });
});

describe("staffHrefIfAllowed", () => {
  it("redirects blocked staff href to home", () => {
    expect(staffHrefIfAllowed("sales", "/chat?peer=a")).toBe("/");
  });

  it("passes allowed href through with query string intact", () => {
    expect(staffHrefIfAllowed("sales", "/leads?lead=x")).toBe("/leads?lead=x");
  });

  it("applies the shared portal whitelist for patient role", () => {
    expect(staffHrefIfAllowed("patient", "/chat")).toBe("/chat");
    expect(staffHrefIfAllowed("patient", "/reports")).toBe("/");
  });
});

describe("listStaffNavItems", () => {
  it("derives admin navigation from the same route rules as the guard", () => {
    expect(listStaffNavItems("it_admin").map((item) => item.to)).toContain("/admin/settings");
    expect(listStaffNavItems("it_admin").map((item) => item.to)).not.toContain("/admin/compliance");

    expect(listStaffNavItems("patient_manager").map((item) => item.to)).toContain("/admin/compliance");
    expect(listStaffNavItems("patient_manager").map((item) => item.to)).toContain("/admin/custom-fields");
    expect(listStaffNavItems("patient_manager").map((item) => item.to)).not.toContain("/admin/settings");

    expect(listStaffNavItems("sales").map((item) => item.to)).toContain("/admin/custom-fields");
    expect(listStaffNavItems("sales").map((item) => item.to)).not.toContain("/admin/users");

    const ceoAssistantAdminItems = listStaffNavItems("ceo_assistant").reduce<
      string[]
    >((items, item) => {
      if (item.to.startsWith("/admin")) {
        items.push(item.to);
      }
      return items;
    }, []);
    expect(ceoAssistantAdminItems).toEqual([]);
  });
});

describe("listPatientPortalNavItems", () => {
  it("returns the canonical patient portal nav order", () => {
    expect(listPatientPortalNavItems().map((item) => item.to)).toEqual([
      "/",
      "/chat",
      "/appointments",
      "/recommendations",
      "/documents",
      "/services",
      "/invoices",
      "/feedback",
      "/privacy",
    ]);
  });
});
