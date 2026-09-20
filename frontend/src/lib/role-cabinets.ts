/**
 * Role cabinets: the primary modules of each staff role, in the order the
 * role's landing dashboard and navigation show them.
 * See docs/role-cabinets-plan-2026-09-20_ua.md (section 2 and stage 4).
 *
 * A module is only shown when the user holds its capability, so a role whose
 * capability set (from `/me`) lacks every module gets no quick link at all.
 */

import { hasCapability, type Capability } from "@/lib/permissions";

export type RoleCabinetModule = {
  /** Route rule id in `@/lib/staff-route-access` (used to order the nav). */
  id: string;
  /** Path (with optional query) the quick link opens. */
  to: string;
  /** i18n key of the label. */
  labelKey: string;
  /** Capability that opens the module. */
  capability: Capability;
};

const define = (
  id: string,
  to: string,
  labelKey: string,
  capability: Capability,
): RoleCabinetModule => ({ id, to, labelKey, capability });

const PATIENTS = define("patients", "/patients", "patients_title", "patients.view");
const LEADS = define("leads", "/leads", "leads_title", "leads.view");
const ORDERS = define("orders", "/orders", "orders_title", "orders.view");
const CONTRACTS = define("contracts", "/contracts", "nav_contracts", "contracts.view");
const INVOICES = define("invoices", "/invoices", "nav_invoices", "invoices.view");
const COMPANY_FINANCE = define(
  "company-finance",
  "/company-finance",
  "nav_company_finance",
  "company_finance.view",
);
const SERVICES = define("services", "/services", "nav_my_services", "services.view");
const HOTELS = define("hotels", "/hotels", "nav_hotels", "hotels.view");
const APPOINTMENTS = define(
  "appointments",
  "/appointments",
  "appointments_title",
  "appointments.view",
);
const PROVIDERS = define("providers", "/providers", "nav_providers", "providers.view");
const REPORTS = define("reports", "/reports", "nav_reports", "reports.view");
const CHAT = define("chat", "/chat", "nav_chat", "chat.use");
const TASK_MANAGER = define("task-manager", "/task-manager", "nav_task_manager", "tasks.use");
const DOCUMENTS = define("documents", "/documents", "nav_documents", "documents.view");
const INTERPRETERS = define(
  "interpreters",
  "/interpreters",
  "nav_interpreters",
  "interpreters.view",
);
// Hours are submitted through appointment reports; the link opens the agenda
// focused on reports until a dedicated hours page exists.
const HOURS = define(
  "hours",
  "/appointments?focus=reports",
  "cabinet_module_hours",
  "interpreters.hours.submit",
);
const USERS = define("admin/users", "/admin/users", "nav_users_roles", "users.view");
const SECURITY = define("admin/security", "/admin/security", "nav_security", "admin.security");
const SETTINGS = define("admin/settings", "/admin/settings", "settings_title", "admin.settings");
const ACTIVITY = define("admin/activity", "/admin/activity", "nav_activity", "admin.activity");
const HEALTH = define("admin/health", "/admin/health", "nav_health", "admin.health");
const SIGNATURES = define(
  "admin/signatures",
  "/admin/signatures",
  "nav_signatures",
  "admin.signatures",
);
const DATEV = define("admin/datev", "/admin/datev", "nav_datev", "datev.admin");
const INCIDENTS = define("incidents", "/incidents", "nav_incident_report", "incidents.manage");

/**
 * Primary modules per role, in cabinet order. The CEO lands on the executive
 * map and keeps the full navigation, so it has no primary list.
 */
export const ROLE_PRIMARY_MODULES: Readonly<Record<string, readonly RoleCabinetModule[]>> = {
  ceo: [],
  billing: [INVOICES, ORDERS, COMPANY_FINANCE, CONTRACTS],
  concierge: [SERVICES, HOTELS, APPOINTMENTS, LEADS],
  patient_manager: [PATIENTS, LEADS, ORDERS, CONTRACTS],
  sales: [LEADS, PROVIDERS, REPORTS, CHAT],
  ceo_assistant: [TASK_MANAGER, APPOINTMENTS, PATIENTS, REPORTS],
  teamlead_interpreter: [APPOINTMENTS, INTERPRETERS, DOCUMENTS, TASK_MANAGER],
  interpreter: [APPOINTMENTS, DOCUMENTS, TASK_MANAGER, HOURS],
  it_admin: [USERS, SECURITY, SETTINGS, ACTIVITY, HEALTH, SIGNATURES, DATEV, INCIDENTS],
};

/** Primary modules of `role` that the given capabilities (or the role mirror) open. */
export function primaryModulesFor(
  role: string,
  capabilities?: readonly string[] | null,
): RoleCabinetModule[] {
  const holder = { role, capabilities };
  return (ROLE_PRIMARY_MODULES[role] ?? []).filter((item) =>
    hasCapability(holder, item.capability),
  );
}

/** Route rule ids of the role's primary modules, in cabinet order. */
export function primaryModuleIds(role: string): readonly string[] {
  return (ROLE_PRIMARY_MODULES[role] ?? []).map((item) => item.id);
}
