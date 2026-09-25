import { describe, expect, it } from "vitest";

import {
  ALL_STAFF_ROLES,
  canAccessPatientPortalRoute,
  canAccessStaffRoute,
  listPatientPortalNavItems,
  listStaffNavItems,
  staffHrefIfAllowed,
} from "./staff-route-access";

const nav = (role: string, capabilities?: readonly string[] | null) =>
  listStaffNavItems(role, capabilities).map((item) => item.to);

describe("staff route access by capability", () => {
  it("opens the dashboard to every staff role", () => {
    for (const role of ALL_STAFF_ROLES) {
      expect(canAccessStaffRoute(role, "/")).toBe(true);
    }
    expect(canAccessStaffRoute("patient", "/")).toBe(false);
    expect(canAccessStaffRoute("unknown", "/")).toBe(false);
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
      "/concierge",
      "/task-manager",
      "/services",
      "/appointments",
      "/employees",
      "/interpreters",
      "/sops",
      "/admin/users",
      "/admin/access",
      "/admin/settings",
      "/admin/signatures",
      "/admin/datev",
    ];
    for (const path of paths) {
      expect(canAccessStaffRoute("ceo", path), path).toBe(true);
    }
  });

  it("keeps Concierge in the operational workspace only", () => {
    for (const path of [
      "/",
      "/hotels",
      "/reports/hotels",
      "/chat",
      "/leads",
      "/providers/provider-1",
      "/projects",
      "/files",
      "/concierge",
      "/task-manager",
      "/services",
      "/appointments",
      "/employees",
      "/patients",
      "/patients/patient-1",
      "/documents",
      "/documents/document-1",
      "/sops",
      "/feedback",
    ]) {
      expect(canAccessStaffRoute("concierge", path), path).toBe(true);
    }
    for (const path of [
      "/reports",
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

  it("opens invoices to every role the API lets read them", () => {
    for (const role of ["ceo", "ceo_assistant", "patient_manager", "billing"] as const) {
      expect(canAccessStaffRoute(role, "/invoices"), role).toBe(true);
    }
    expect(canAccessStaffRoute("patient_manager", "/company-finance")).toBe(false);
    expect(canAccessStaffRoute("interpreter", "/invoices")).toBe(false);
    expect(canAccessStaffRoute("sales", "/invoices")).toBe(false);
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
      "/admin/datev",
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
      "/admin/settings",
    ]) {
      expect(canAccessStaffRoute("billing", path), path).toBe(false);
    }
  });

  it("gives Sales the leads, providers, reports and chat cabinet", () => {
    for (const path of [
      "/",
      "/leads",
      "/providers",
      "/providers/provider-1",
      "/reports",
      "/chat",
      "/task-manager",
      "/projects",
      "/files",
      "/sops",
      "/notes",
    ]) {
      expect(canAccessStaffRoute("sales", path), path).toBe(true);
    }
    for (const path of [
      "/patients",
      "/patients/patient-1",
      "/orders",
      "/invoices",
      "/company-finance",
      "/documents",
      "/appointments",
      "/hotels",
      "/services",
      "/admin/users",
      "/admin/settings",
    ]) {
      expect(canAccessStaffRoute("sales", path), path).toBe(false);
    }
    const sales = nav("sales");
    expect(sales).toContain("/leads");
    expect(sales).toContain("/providers");
    expect(sales).toContain("/reports");
    expect(sales).toContain("/chat");
    expect(sales).not.toContain("/patients");
  });

  it("gives the CEO assistant the read-only business cabinet", () => {
    for (const path of [
      "/patients",
      "/patients/patient-1",
      "/orders",
      "/contracts",
      "/invoices",
      "/company-finance",
      "/finance-catalog",
      "/documents",
      "/reports",
      "/leads",
      "/appointments",
      "/providers",
      "/services",
      "/hotels",
      "/chat",
      "/task-manager",
      "/sops",
    ]) {
      expect(canAccessStaffRoute("ceo_assistant", path), path).toBe(true);
    }
    for (const path of ["/admin/users", "/admin/settings", "/admin/access", "/employees"]) {
      expect(canAccessStaffRoute("ceo_assistant", path), path).toBe(false);
    }
    const assistant = nav("ceo_assistant");
    for (const path of ["/patients", "/orders", "/contracts", "/invoices", "/documents", "/reports"]) {
      expect(assistant, path).toContain(path);
    }
  });

  it("gives the IT admin the technical cabinet and nothing clinical", () => {
    const technical = [
      "/admin/users",
      "/admin/access",
      "/admin/security",
      "/admin/settings",
      "/admin/activity",
      "/admin/health",
      "/admin/signatures",
      "/admin/notifications",
      "/admin/announcements",
      "/admin/custom-fields",
      "/admin/datev",
      "/admin/compliance",
      "/incidents",
      "/account",
      "/security/two-factor",
      "/sops",
      "/notes",
      "/",
    ];
    for (const path of technical) {
      expect(canAccessStaffRoute("it_admin", path), path).toBe(true);
    }
    for (const path of [
      "/patients",
      "/patients/patient-1",
      "/chat",
      "/appointments",
      "/documents",
      "/leads",
      "/orders",
      "/invoices",
      "/task-manager",
      "/projects",
      "/files",
      "/reports",
      "/providers",
    ]) {
      expect(canAccessStaffRoute("it_admin", path), path).toBe(false);
    }
    const itAdmin = nav("it_admin");
    for (const path of technical) {
      // `/security/two-factor` is a nav-less alias of the /account page.
      if (path === "/security/two-factor") {
        continue;
      }
      expect(itAdmin, path).toContain(path);
    }
    expect(itAdmin).not.toContain("/patients");
    expect(itAdmin).not.toContain("/chat");
    expect(itAdmin).not.toContain("/appointments");
    expect(staffHrefIfAllowed("it_admin", "/patients")).toBe("/");
    expect(staffHrefIfAllowed("it_admin", "/admin/users")).toBe("/admin/users");
  });

  it("keeps interpreters on assignments, documents and the calendar", () => {
    for (const role of ["interpreter", "teamlead_interpreter"] as const) {
      for (const path of ["/patients", "/appointments", "/documents", "/providers", "/chat", "/task-manager", "/sops"]) {
        expect(canAccessStaffRoute(role, path), `${role} -> ${path}`).toBe(true);
      }
      for (const path of ["/leads", "/invoices", "/orders", "/admin/users", "/reports"]) {
        expect(canAccessStaffRoute(role, path), `${role} -> ${path}`).toBe(false);
      }
    }
  });

  it("locks the P0 operations workspaces to their capability contracts", () => {
    const matrix = {
      "/notes": [...ALL_STAFF_ROLES],
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
      "/concierge": [
        "ceo",
        "ceo_assistant",
        "patient_manager",
        "sales",
        "concierge",
        "billing",
        "teamlead_interpreter",
        "interpreter",
      ],
      "/company-finance": ["ceo", "ceo_assistant", "billing"],
      "/admin/signatures": ["ceo", "it_admin"],
      "/admin/users": ["ceo", "it_admin"],
      "/leads": ["ceo", "ceo_assistant", "patient_manager", "concierge", "sales"],
      // feedback.view; capture stays behind feedback.capture on the page.
      "/feedback": ["ceo", "ceo_assistant", "patient_manager", "teamlead_interpreter", "concierge"],
    } as const;

    for (const [path, allowedRoles] of Object.entries(matrix)) {
      for (const role of ALL_STAFF_ROLES) {
        expect(canAccessStaffRoute(role, path), `${role} -> ${path}`).toBe(
          (allowedRoles as readonly string[]).includes(role),
        );
        const hiddenFromCombinedNavigation = path === "/concierge";
        expect(nav(role).includes(path), `${role} nav -> ${path}`).toBe(
          (allowedRoles as readonly string[]).includes(role) && !hiddenFromCombinedNavigation,
        );
      }
    }
  });

  it("derives navigation from the same rules", () => {
    const ceo = nav("ceo");
    expect(ceo.indexOf("/files")).toBe(ceo.indexOf("/documents") + 1);

    const concierge = nav("concierge");
    expect(concierge).toContain("/leads");
    expect(concierge).toContain("/appointments");
    expect(concierge).toContain("/employees");
    expect(concierge).not.toContain("/concierge");
    expect(concierge).toContain("/task-manager");
    expect(concierge).toContain("/projects");
    expect(concierge).toContain("/files");
    expect(concierge).toContain("/documents");
    expect(concierge).toContain("/patients");
    expect(concierge).toContain("/feedback");
    expect(concierge).not.toContain("/reports");

    const billing = nav("billing");
    expect(billing).toContain("/invoices");
    expect(billing).toContain("/company-finance");
    expect(billing).toContain("/finance-catalog");
    expect(billing).not.toContain("/concierge");
    expect(billing).toContain("/task-manager");
    expect(billing).not.toContain("/appointments");

    expect(ceo).not.toContain("/concierge");
    expect(ceo).toContain("/task-manager");
    expect(ceo).toContain("/projects");
  });

  it("leads each cabinet's navigation with its primary modules", () => {
    const leading = (role: string, count: number) =>
      listStaffNavItems(role)
        .map((item) => item.id)
        .slice(0, count);
    expect(leading("billing", 4)).toEqual(["invoices", "orders", "company-finance", "contracts"]);
    expect(leading("concierge", 4)).toEqual(["services", "hotels", "appointments", "leads"]);
    expect(leading("patient_manager", 4)).toEqual(["patients", "leads", "orders", "contracts"]);
    expect(leading("sales", 4)).toEqual(["leads", "providers", "reports", "chat"]);
    expect(leading("ceo_assistant", 4)).toEqual([
      "task-manager",
      "appointments",
      "patients",
      "reports",
    ]);
    // `/interpreters` and `/appointments?focus=reports` have no nav entry, so
    // the teamlead and interpreter cabinets lead with the rest of their list.
    expect(leading("teamlead_interpreter", 3)).toEqual(["appointments", "documents", "task-manager"]);
    expect(leading("interpreter", 3)).toEqual(["appointments", "documents", "task-manager"]);
    expect(leading("it_admin", 8)).toEqual([
      "admin/users",
      "admin/security",
      "admin/settings",
      "admin/activity",
      "admin/health",
      "admin/signatures",
      "admin/datev",
      "incidents",
    ]);
    // The CEO keeps the rule order of the full navigation.
    expect(listStaffNavItems("ceo")[0]?.id).toBe("task-manager");
    // Every role keeps /account and the dashboard.
    for (const role of ALL_STAFF_ROLES) {
      expect(nav(role), role).toContain("/account");
      expect(nav(role), role).toContain("/");
    }
  });

  it("leaves whole sections empty for roles outside them", () => {
    const sections = (role: string) => new Set(listStaffNavItems(role).map((item) => item.section));
    expect(sections("it_admin").has("crm")).toBe(false);
    expect(sections("it_admin").has("medicine")).toBe(false);
    expect(sections("sales").has("accounting")).toBe(false);
    expect(sections("sales").has("admin")).toBe(false);
    expect(sections("interpreter").has("accounting")).toBe(false);
    expect(sections("interpreter").has("admin")).toBe(false);
  });

  it("opens the interpreters registry to the roles that hold interpreters.view", () => {
    expect(canAccessStaffRoute("teamlead_interpreter", "/interpreters")).toBe(true);
    expect(canAccessStaffRoute("patient_manager", "/interpreters/staff-1")).toBe(true);
    expect(canAccessStaffRoute("interpreter", "/interpreters")).toBe(false);
    expect(canAccessStaffRoute("concierge", "/interpreters")).toBe(false);
  });

  it("prefers the capabilities reported by /me over the role mirror", () => {
    expect(canAccessStaffRoute("it_admin", "/patients", ["patients.view"])).toBe(true);
    expect(canAccessStaffRoute("ceo", "/patients", [])).toBe(false);
    expect(canAccessStaffRoute("ceo", "/patients", null)).toBe(true);
    expect(staffHrefIfAllowed("sales", "/invoices", ["invoices.view"])).toBe("/invoices");

    const chatOnly = nav("sales", ["chat.use"]);
    expect(chatOnly).toContain("/chat");
    expect(chatOnly).not.toContain("/leads");
    // Rules without a capability still fall back to their role list.
    expect(chatOnly).toContain("/notes");
    expect(chatOnly).toContain("/");
  });

  it("keeps the new-order route available to patient managers", () => {
    const href = "/orders?create=1&patient=patient-1";

    expect(canAccessStaffRoute("patient_manager", href)).toBe(true);
    expect(staffHrefIfAllowed("patient_manager", href)).toBe(href);
    expect(nav("patient_manager")).toContain("/orders");
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
      "/account",
      "/legal",
    ]);
  });
});
