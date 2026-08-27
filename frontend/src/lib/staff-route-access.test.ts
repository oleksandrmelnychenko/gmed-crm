import { describe, expect, it } from "vitest";

import {
  ALL_STAFF_ROLES,
  RELEASE_STAFF_ROLES,
  canAccessPatientPortalRoute,
  canAccessStaffRoute,
  listPatientPortalNavItems,
  listStaffNavItems,
  staffHrefIfAllowed,
} from "./staff-route-access";

describe("first-release staff RBAC", () => {
  it("enables exactly CEO, Concierge and Billing as staff roles", () => {
    expect(RELEASE_STAFF_ROLES).toEqual(["ceo", "concierge", "billing"]);
    for (const role of ALL_STAFF_ROLES) {
      expect(canAccessStaffRoute(role, "/")).toBe(true);
    }
  });

  it("gives CEO every mounted staff workspace", () => {
    const paths = [
      "/chat",
      "/feedback",
      "/reports",
      "/leads",
      "/patients/patient-1",
      "/providers/provider-1",
      "/orders/order-1",
      "/contracts",
      "/invoices",
      "/company-finance",
      "/finance-catalog",
      "/documents/document-1",
      "/files",
      "/specializations",
      "/task-manager",
      "/services",
      "/appointments",
      "/employees",
      "/interpreters",
      "/admin/users",
      "/admin/access",
      "/admin/settings",
    ];
    for (const path of paths) {
      expect(canAccessStaffRoute("ceo", path), path).toBe(true);
    }
    expect(canAccessStaffRoute("ceo", "/concierge")).toBe(false);
    expect(listStaffNavItems("ceo").map((item) => item.to)).not.toContain("/concierge");
  });

  it("keeps Concierge in the operational workspace only", () => {
    for (const path of [
      "/",
      "/chat",
      "/leads",
      "/providers/provider-1",
      "/files",
      "/concierge",
      "/task-manager",
      "/services",
      "/appointments",
      "/employees",
    ]) {
      expect(canAccessStaffRoute("concierge", path), path).toBe(true);
    }
    for (const path of [
      "/feedback",
      "/reports",
      "/sops",
      "/patients",
      "/patients/patient-1",
      "/documents",
      "/documents/document-1",
      "/orders",
      "/contracts",
      "/invoices",
      "/company-finance",
      "/finance-catalog",
      "/specializations",
      "/interpreters",
      "/admin/users",
    ]) {
      expect(canAccessStaffRoute("concierge", path), path).toBe(false);
    }
  });

  it("keeps Billing in finance workspaces and out of operations/admin", () => {
    for (const path of [
      "/",
      "/chat",
      "/reports",
      "/sops",
      "/patients/patient-1",
      "/providers/provider-1",
      "/orders/order-1",
      "/contracts",
      "/invoices",
      "/company-finance",
      "/finance-catalog",
      "/documents",
      "/files",
      "/services",
    ]) {
      expect(canAccessStaffRoute("billing", path), path).toBe(true);
    }
    for (const path of [
      "/leads",
      "/appointments",
      "/employees",
      "/feedback",
      "/specializations",
      "/admin/users",
    ]) {
      expect(canAccessStaffRoute("billing", path), path).toBe(false);
    }
  });

  it("locks the P0 operations workspaces to their backend role contracts", () => {
    const matrix = {
      "/notes": [
        "ceo",
        "ceo_assistant",
        "patient_manager",
        "teamlead_interpreter",
        "interpreter",
        "concierge",
        "billing",
        "sales",
        "it_admin",
      ],
      "/task-manager": [
        "ceo",
        "ceo_assistant",
        "patient_manager",
        "sales",
        "concierge",
        "billing",
        "teamlead_interpreter",
        "interpreter",
      ],
      "/files": [
        "ceo",
        "ceo_assistant",
        "patient_manager",
        "sales",
        "concierge",
        "billing",
        "teamlead_interpreter",
        "interpreter",
      ],
      "/concierge": ["concierge"],
      "/company-finance": ["ceo", "billing"],
    } as const;

    for (const [path, allowedRoles] of Object.entries(matrix)) {
      for (const role of ALL_STAFF_ROLES) {
        expect(canAccessStaffRoute(role, path), `${role} -> ${path}`).toBe(
          (allowedRoles as readonly string[]).includes(role),
        );
        expect(listStaffNavItems(role).map((item) => item.to).includes(path), `${role} nav -> ${path}`).toBe(
          (allowedRoles as readonly string[]).includes(role),
        );
      }
    }
  });

  it("derives navigation from the same rules", () => {
    const ceo = listStaffNavItems("ceo").map((item) => item.to);
    expect(ceo.indexOf("/files")).toBe(ceo.indexOf("/documents") + 1);

    const concierge = listStaffNavItems("concierge").map((item) => item.to);
    expect(concierge).toContain("/leads");
    expect(concierge).toContain("/appointments");
    expect(concierge).toContain("/employees");
    expect(concierge).toContain("/concierge");
    expect(concierge).toContain("/task-manager");
    expect(concierge).toContain("/files");
    expect(concierge).not.toContain("/documents");
    expect(concierge).not.toContain("/sops");
    expect(concierge).not.toContain("/patients");
    expect(concierge).not.toContain("/feedback");
    expect(concierge).not.toContain("/reports");

    const billing = listStaffNavItems("billing").map((item) => item.to);
    expect(billing).toContain("/invoices");
    expect(billing).toContain("/company-finance");
    expect(billing).toContain("/finance-catalog");
    expect(billing).not.toContain("/concierge");
    expect(billing).toContain("/task-manager");
    expect(billing).not.toContain("/appointments");

    expect(listStaffNavItems("it_admin").map((item) => item.to)).toEqual([
      "/chat",
      "/notes",
      "/patients",
      "/",
    ]);
  });

  it("activates chat for care and support roles without opening unrelated workspaces", () => {
    for (const role of [
      "ceo_assistant",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "it_admin",
    ]) {
      expect(canAccessStaffRoute(role, "/chat"), role).toBe(true);
      expect(listStaffNavItems(role).map((item) => item.to), role).toContain("/chat");
      expect(canAccessStaffRoute(role, "/patients/patient-1"), role).toBe(true);
      expect(listStaffNavItems(role).map((item) => item.to), role).toContain("/patients");
    }
    expect(canAccessStaffRoute("sales", "/chat")).toBe(false);
    expect(canAccessStaffRoute("sales", "/patients")).toBe(false);

    expect(canAccessStaffRoute("it_admin", "/admin/settings")).toBe(false);
    expect(canAccessStaffRoute("sales", "/leads")).toBe(false);
    expect(staffHrefIfAllowed("it_admin", "/admin/users")).toBe("/");
  });

  it("keeps the new-order route available to patient managers", () => {
    const href = "/orders?create=1&patient=patient-1";

    expect(canAccessStaffRoute("patient_manager", href)).toBe(true);
    expect(staffHrefIfAllowed("patient_manager", href)).toBe(href);
    expect(listStaffNavItems("patient_manager").map((item) => item.to)).toContain("/orders");
  });
});

describe("patient portal routes", () => {
  it("keeps the existing patient portal whitelist", () => {
    expect(canAccessPatientPortalRoute("/")).toBe(true);
    expect(canAccessPatientPortalRoute("/chat")).toBe(true);
    expect(canAccessPatientPortalRoute("/documents?tab=portal")).toBe(true);
    expect(canAccessPatientPortalRoute("/subscriptions")).toBe(true);
    expect(canAccessPatientPortalRoute("/notifications")).toBe(true);
    expect(canAccessPatientPortalRoute("/reports")).toBe(false);
    expect(canAccessPatientPortalRoute("/patients")).toBe(false);
  });

  it("keeps the canonical portal navigation order", () => {
    expect(listPatientPortalNavItems().map((item) => item.to)).toEqual([
      "/",
      "/notifications",
      "/chat",
      "/appointments",
      "/recommendations",
      "/documents",
      "/services",
      "/subscriptions",
      "/invoices",
      "/feedback",
      "/privacy",
    ]);
  });
});
