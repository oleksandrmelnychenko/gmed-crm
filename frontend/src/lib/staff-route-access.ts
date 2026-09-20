/**
 * Single source of truth for staff route access (pathname + role/capabilities).
 * See docs/testing/ui-rbac-route-guard-plan_ua.md and
 * docs/role-cabinets-plan-2026-09-20_ua.md (stage 2).
 */

import { capabilitiesFor } from "@/lib/permissions";
import { primaryModuleIds } from "@/lib/role-cabinets";

export const ALL_STAFF_ROLES = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
  "sales",
  "it_admin",
] as const;

type StaffRole = (typeof ALL_STAFF_ROLES)[number];

const ROLES_CHAT = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
  "it_admin",
] as const satisfies readonly StaffRole[];

const ROLES_NOTES = ALL_STAFF_ROLES;

const ROLES_FEEDBACK = [
  "ceo",
] as const satisfies readonly StaffRole[];

const ROLES_REPORTS = [
  "ceo",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_CONTRACTS_INVOICES = [
  "ceo",
  "billing",
] as const satisfies readonly StaffRole[];

// Mirrors can_read_invoices on the server; the page itself limits what each role may change.
const ROLES_INVOICES = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_FINANCE_CATALOG = [
  "ceo",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_DOCUMENTS = [
  "ceo",
  "concierge",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_SOPS = ["ceo", "billing"] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/appointments.rs` (`list_appointments`) */
const ROLES_APPOINTMENTS = [
  "ceo",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
] as const satisfies readonly StaffRole[];

const ROLES_INTERPRETERS = [
  "ceo",
] as const satisfies readonly StaffRole[];

const ROLES_EMPLOYEES = ["ceo", "concierge"] as const satisfies readonly StaffRole[];
const ROLES_SPECIALIZATIONS = ["ceo"] as const satisfies readonly StaffRole[];

// CEO has full access by policy — `AuthUser::require_any_role` in
// `crates/server/src/auth/middleware.rs` short-circuits to Ok for Ceo,
// so the frontend guard mirrors that by including "ceo" everywhere.
const ROLES_ADMIN = ["ceo"] as const satisfies readonly StaffRole[];

const ROLES_COMPLIANCE = [
  "ceo",
] as const satisfies readonly StaffRole[];

const ROLES_ADMIN_USERS = [
  "ceo",
] as const satisfies readonly StaffRole[];

const ROLES_ADMIN_CUSTOM_FIELDS = [
  "ceo",
] as const satisfies readonly StaffRole[];

// Role constants below are aligned with the canonical "list" handler each
// staff workspace page hits on mount. See
// `docs/testing/phase-f-ssot-drift-audit.md` for the cross-reference table.

/** `crates/server/src/routes/leads.rs:114` (`list_leads`) — CEO passes via `require_any_role` bypass. */
const ROLES_LEADS = [
  "ceo",
  "concierge",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/cases.rs:275` (`list_cases`) */
const ROLES_CASES = [
  "ceo",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/orders.rs:157` (`list_orders`) */
const ROLES_ORDERS = [
  "ceo",
  "patient_manager",
  "billing",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/patients.rs:445` (`list_patients`) */
const ROLES_PATIENTS = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "it_admin",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/providers.rs:132` (`list_providers`) */
const ROLES_PROVIDERS = [
  "ceo",
  "concierge",
  "billing",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/concierge_services.rs:564` (`list_concierge_services`) */
const ROLES_SERVICES = [
  "ceo",
  "concierge",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_TASK_MANAGER = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "sales",
  "concierge",
  "billing",
  "teamlead_interpreter",
  "interpreter",
] as const satisfies readonly StaffRole[];

const ROLES_PROJECTS = ROLES_TASK_MANAGER;

const ROLES_FILES = ROLES_TASK_MANAGER;

type RouteRule = {
  id: string;
  match: "exact" | "prefix";
  path: string;
  /** Fallback when the rule carries no capability. */
  roles: readonly string[];
  /**
   * Capability (or any-of list) that opens the route; evaluated against the
   * user's capabilities from `/me`, or the role mirror in `@/lib/permissions`.
   */
  capability?: string | readonly string[];
  nav?: {
    section: StaffNavSection;
    labelKey: string;
    after?: string;
  };
};

export type StaffNavSection =
  | "main"
  | "crm"
  | "medicine"
  | "accounting"
  | "security"
  | "dsgvo"
  | "admin";
export type PatientPortalNavItem = {
  id: string;
  to: string;
  labelKey: string;
};
export type StaffNavItem = {
  id: string;
  to: string;
  labelKey: string;
  section: StaffNavSection;
  after?: string;
};

function pathMatches(pathname: string, rule: RouteRule): boolean {
  if (rule.match === "exact") {
    return pathname === rule.path;
  }
  return pathname === rule.path || pathname.startsWith(`${rule.path}/`);
}

/**
 * More specific rules must appear earlier than broader prefixes.
 */
const STAFF_ROUTE_RULES: RouteRule[] = [
  {
    id: "concierge",
    match: "exact",
    path: "/concierge",
    roles: ROLES_TASK_MANAGER,
    capability: "tasks.use",
  },
  {
    id: "task-manager",
    match: "exact",
    path: "/task-manager",
    roles: ROLES_TASK_MANAGER,
    capability: "tasks.use",
    nav: { section: "main", labelKey: "nav_task_manager" },
  },
  {
    id: "projects",
    match: "exact",
    path: "/projects",
    roles: ROLES_PROJECTS,
    capability: "tasks.use",
    nav: { section: "main", labelKey: "nav_projects", after: "task-manager" },
  },
  // Administration in three groups: access and security, DSGVO, system.
  // Keep the order in sync with the nav test.
  {
    id: "admin/users",
    match: "prefix",
    path: "/admin/users",
    roles: ROLES_ADMIN_USERS,
    capability: "users.view",
    nav: { section: "security", labelKey: "nav_users_roles" },
  },
  {
    id: "admin/access",
    match: "prefix",
    path: "/admin/access",
    roles: ROLES_ADMIN,
    capability: "admin.security",
    nav: { section: "security", labelKey: "nav_access_matrix" },
  },
  {
    id: "admin/security",
    match: "prefix",
    path: "/admin/security",
    roles: ROLES_ADMIN,
    capability: "admin.security",
    nav: { section: "security", labelKey: "nav_security" },
  },
  {
    id: "account",
    match: "exact",
    path: "/account",
    roles: ALL_STAFF_ROLES,
    nav: { section: "security", labelKey: "nav_account" },
  },
  // Alias of the two-factor section on /account; kept for old links, no nav item.
  {
    id: "security/two-factor",
    match: "exact",
    path: "/security/two-factor",
    roles: ALL_STAFF_ROLES,
  },
  {
    id: "admin/compliance",
    match: "prefix",
    path: "/admin/compliance",
    roles: ROLES_COMPLIANCE,
    capability: "admin.compliance",
    nav: { section: "dsgvo", labelKey: "nav_compliance" },
  },
  {
    id: "incidents",
    match: "exact",
    path: "/incidents",
    roles: ALL_STAFF_ROLES,
    nav: { section: "dsgvo", labelKey: "nav_incident_report" },
  },
  {
    id: "admin/activity",
    match: "prefix",
    path: "/admin/activity",
    roles: ROLES_ADMIN,
    capability: "admin.activity",
    nav: { section: "admin", labelKey: "nav_activity" },
  },
  {
    id: "admin/health",
    match: "prefix",
    path: "/admin/health",
    roles: ROLES_ADMIN,
    capability: "admin.health",
    nav: { section: "admin", labelKey: "nav_health" },
  },
  {
    id: "admin/settings",
    match: "prefix",
    path: "/admin/settings",
    roles: ROLES_ADMIN,
    capability: "admin.settings",
    nav: { section: "admin", labelKey: "settings_title" },
  },
  {
    id: "admin/signatures",
    match: "prefix",
    path: "/admin/signatures",
    roles: ["ceo", "it_admin"],
    capability: "admin.signatures",
    nav: { section: "admin", labelKey: "nav_signatures" },
  },
  {
    id: "admin/notifications",
    match: "prefix",
    path: "/admin/notifications",
    roles: ROLES_ADMIN,
    capability: "admin.notifications",
    nav: { section: "admin", labelKey: "nav_notifications" },
  },
  {
    id: "admin/announcements",
    match: "prefix",
    path: "/admin/announcements",
    roles: ROLES_ADMIN,
    capability: "admin.announcements",
    nav: { section: "admin", labelKey: "nav_announcements" },
  },
  {
    id: "admin/custom-fields",
    match: "prefix",
    path: "/admin/custom-fields",
    roles: ROLES_ADMIN_CUSTOM_FIELDS,
    capability: "admin.custom_fields",
    nav: { section: "admin", labelKey: "nav_custom_fields" },
  },
  {
    id: "admin/datev",
    match: "prefix",
    path: "/admin/datev",
    roles: ROLES_ADMIN,
    capability: ["datev.admin", "datev.read"],
    nav: { section: "accounting", labelKey: "nav_datev", after: "finance-catalog" },
  },
  { id: "admin", match: "prefix", path: "/admin", roles: ROLES_ADMIN },
  {
    id: "appointments",
    match: "prefix",
    path: "/appointments",
    roles: ROLES_APPOINTMENTS,
    capability: "appointments.view",
    nav: { section: "medicine", labelKey: "appointments_title" },
  },
  {
    id: "employees",
    match: "exact",
    path: "/employees",
    roles: ROLES_EMPLOYEES,
    nav: { section: "medicine", labelKey: "nav_interpreters" },
  },
  {
    id: "interpreters",
    match: "prefix",
    path: "/interpreters",
    roles: ROLES_INTERPRETERS,
    capability: "interpreters.view",
  },
  {
    id: "specializations",
    match: "exact",
    path: "/specializations",
    roles: ROLES_SPECIALIZATIONS,
    nav: {
      section: "medicine",
      labelKey: "nav_specializations",
      after: "employees",
    },
  },
  {
    id: "medications",
    match: "exact",
    path: "/medications",
    roles: ["ceo"],
    nav: { section: "medicine", labelKey: "nav_medications", after: "specializations" },
  },
  {
    id: "chat",
    match: "exact",
    path: "/chat",
    roles: ROLES_CHAT,
    capability: "chat.use",
    nav: { section: "main", labelKey: "nav_chat" },
  },
  {
    id: "notes",
    match: "exact",
    path: "/notes",
    roles: ROLES_NOTES,
    nav: { section: "main", labelKey: "nav_notes", after: "chat" },
  },
  {
    id: "feedback",
    match: "exact",
    path: "/feedback",
    roles: ROLES_FEEDBACK,
    nav: { section: "main", labelKey: "nav_feedback" },
  },
  {
    id: "reports",
    match: "exact",
    path: "/reports",
    roles: ROLES_REPORTS,
    capability: "reports.view",
    nav: { section: "main", labelKey: "nav_reports" },
  },
  {
    id: "hotel-statistics",
    match: "exact",
    path: "/reports/hotels",
    roles: ["ceo", "ceo_assistant", "billing", "patient_manager", "concierge"],
    capability: "hotels.view",
  },
  {
    id: "hotels",
    match: "exact",
    path: "/hotels",
    roles: ["ceo", "ceo_assistant", "billing", "patient_manager", "concierge"],
    capability: "hotels.view",
    nav: { section: "crm", labelKey: "nav_hotels", after: "providers" },
  },
  {
    id: "recommendations",
    match: "exact",
    path: "/recommendations",
    roles: ["ceo"],
  },
  {
    id: "leads",
    match: "exact",
    path: "/leads",
    roles: ROLES_LEADS,
    capability: "leads.view",
    nav: { section: "crm", labelKey: "leads_title" },
  },
  {
    id: "patients",
    match: "prefix",
    path: "/patients",
    roles: ROLES_PATIENTS,
    capability: "patients.view",
    nav: { section: "crm", labelKey: "patients_title" },
  },
  {
    id: "orders",
    match: "prefix",
    path: "/orders",
    roles: ROLES_ORDERS,
    capability: "orders.view",
    nav: { section: "crm", labelKey: "orders_title" },
  },
  {
    id: "contracts",
    match: "exact",
    path: "/contracts",
    roles: ROLES_CONTRACTS_INVOICES,
    capability: "contracts.view",
    nav: { section: "crm", labelKey: "nav_contracts" },
  },
  {
    id: "providers",
    match: "prefix",
    path: "/providers",
    roles: ROLES_PROVIDERS,
    capability: "providers.view",
    nav: { section: "crm", labelKey: "nav_providers" },
  },
  {
    id: "services",
    match: "exact",
    path: "/services",
    roles: ROLES_SERVICES,
    capability: "services.view",
    nav: { section: "crm", labelKey: "nav_my_services" },
  },
  {
    id: "documents",
    match: "prefix",
    path: "/documents",
    roles: ROLES_DOCUMENTS,
    capability: "documents.view",
    nav: { section: "crm", labelKey: "nav_documents" },
  },
  {
    id: "files",
    match: "exact",
    path: "/files",
    roles: ROLES_FILES,
    capability: "tasks.use",
    nav: { section: "crm", labelKey: "nav_files", after: "documents" },
  },
  {
    id: "invoices",
    match: "exact",
    path: "/invoices",
    roles: ROLES_INVOICES,
    capability: "invoices.view",
    nav: { section: "accounting", labelKey: "nav_invoices" },
  },
  {
    id: "company-finance",
    match: "exact",
    path: "/company-finance",
    roles: ROLES_REPORTS,
    capability: "company_finance.view",
    nav: {
      section: "accounting",
      labelKey: "nav_company_finance",
      after: "invoices",
    },
  },
  {
    id: "finance-catalog",
    match: "exact",
    path: "/finance-catalog",
    roles: ROLES_FINANCE_CATALOG,
    capability: "company_finance.view",
    nav: { section: "accounting", labelKey: "nav_finance_catalog" },
  },
  {
    id: "cases",
    match: "prefix",
    path: "/cases",
    roles: ROLES_CASES,
  },
  {
    id: "sops",
    match: "exact",
    path: "/sops",
    roles: ROLES_SOPS,
    capability: "sops.view",
    nav: { section: "main", labelKey: "nav_learning" },
  },
  {
    id: "privacy",
    match: "exact",
    path: "/privacy",
    roles: ["ceo"],
  },
  {
    id: "dashboard",
    match: "exact",
    path: "/",
    roles: ALL_STAFF_ROLES,
    nav: { section: "main", labelKey: "nav_dashboard" },
  },
];

const PATIENT_PORTAL_NAV_ITEMS: readonly PatientPortalNavItem[] = [
  { id: "dashboard", to: "/", labelKey: "nav_dashboard" },
  { id: "notifications", to: "/notifications", labelKey: "nav_my_notifications" },
  { id: "chat", to: "/chat", labelKey: "nav_chat" },
  { id: "appointments", to: "/appointments", labelKey: "nav_my_appointments" },
  { id: "recommendations", to: "/recommendations", labelKey: "nav_my_recommendations" },
  { id: "documents", to: "/documents", labelKey: "nav_my_documents" },
  { id: "services", to: "/services", labelKey: "nav_my_services" },
  { id: "subscriptions", to: "/subscriptions", labelKey: "nav_my_subscriptions" },
  { id: "invoices", to: "/invoices", labelKey: "nav_my_invoices" },
  { id: "feedback", to: "/feedback", labelKey: "nav_my_feedback" },
  { id: "privacy", to: "/privacy", labelKey: "nav_my_privacy" },
  { id: "account", to: "/account", labelKey: "nav_account" },
  { id: "legal", to: "/legal", labelKey: "nav_legal_notice" },
] as const;

const STAFF_ROUTE_ROLE_SETS = new Map(
  STAFF_ROUTE_RULES.map((rule) => [rule.id, new Set(rule.roles)]),
);

/**
 * Whether `role` (with `capabilities` from `/me`, or the role mirror when
 * absent) may use `rule`: the capability decides when the rule has one, the
 * role list otherwise.
 */
function ruleAllows(
  rule: RouteRule,
  role: string,
  capabilities: readonly string[] | null | undefined,
): boolean {
  if (rule.capability === undefined) {
    return STAFF_ROUTE_ROLE_SETS.get(rule.id)?.has(role) ?? false;
  }
  const held = capabilitiesFor(role, capabilities);
  const wanted = typeof rule.capability === "string" ? [rule.capability] : rule.capability;
  return wanted.some((capability) => held.includes(capability));
}

function normalizePathname(pathname: string): string {
  const base = pathname.split("?")[0] ?? "/";
  if (base === "") {
    return "/";
  }
  return base.startsWith("/") ? base : `/${base}`;
}

/**
 * Whether a patient may open this pathname inside the portal shell.
 * Query string is ignored; only mounted portal routes are allowed.
 */
export function canAccessPatientPortalRoute(pathname: string): boolean {
  const p = normalizePathname(pathname);
  return PATIENT_PORTAL_NAV_ITEMS.some((item) => item.to === p);
}

export function listPatientPortalNavItems(): PatientPortalNavItem[] {
  return [...PATIENT_PORTAL_NAV_ITEMS];
}

/**
 * Whether a logged-in staff user may open this pathname. Pass the user's
 * `capabilities` from `/me` when available; otherwise the role mirror in
 * `@/lib/permissions` is used.
 */
export function canAccessStaffRoute(
  role: string,
  pathname: string,
  capabilities?: readonly string[] | null,
): boolean {
  if (role === "patient") {
    return false;
  }
  if (!(ALL_STAFF_ROLES as readonly string[]).includes(role)) {
    return false;
  }
  const p = normalizePathname(pathname);
  for (const rule of STAFF_ROUTE_RULES) {
    if (!pathMatches(p, rule)) {
      continue;
    }
    return ruleAllows(rule, role, capabilities);
  }
  return false;
}

export type StaffRouteRulePeek = {
  id: string;
  roles: readonly string[];
};

/**
 * First matching staff route rule for `pathname` (query string ignored).
 * Used by tests to assert `canAccessStaffRoute` stays aligned with `STAFF_ROUTE_RULES`.
 */
export function peekStaffRouteRule(pathname: string): StaffRouteRulePeek | null {
  const p = normalizePathname(pathname);
  for (const rule of STAFF_ROUTE_RULES) {
    if (pathMatches(p, rule)) {
      return { id: rule.id, roles: rule.roles };
    }
  }
  return null;
}

/**
 * Returns `href` when the current role may open that path; otherwise `/`.
 */
export function staffHrefIfAllowed(
  role: string,
  href: string,
  capabilities?: readonly string[] | null,
): string {
  const pathname = normalizePathname(href);
  if (role === "patient") {
    return canAccessPatientPortalRoute(pathname) ? href : "/";
  }
  if (!canAccessStaffRoute(role, pathname, capabilities)) {
    return "/";
  }
  return href;
}

export function listStaffNavItems(
  role: string,
  capabilities?: readonly string[] | null,
): StaffNavItem[] {
  if (role === "patient") {
    return [];
  }
  if (!(ALL_STAFF_ROLES as readonly string[]).includes(role)) {
    return [];
  }
  const items: StaffNavItem[] = [];
  for (const rule of STAFF_ROUTE_RULES) {
    if (!rule.nav || !ruleAllows(rule, role, capabilities)) {
      continue;
    }
    items.push({
      id: rule.id,
      to: rule.path,
      labelKey: rule.nav.labelKey,
      section: rule.nav.section,
      after: rule.nav.after,
    });
  }

  const ordered: StaffNavItem[] = [];
  const pending = new Map<string, StaffNavItem[]>();
  const append = (item: StaffNavItem) => {
    ordered.push(item);
    for (const dependent of pending.get(item.id) ?? []) {
      append(dependent);
    }
    pending.delete(item.id);
  };

  for (const item of items) {
    if (item.after && !ordered.some((candidate) => candidate.id === item.after)) {
      pending.set(item.after, [...(pending.get(item.after) ?? []), item]);
      continue;
    }
    append(item);
  }
  for (const deferred of pending.values()) {
    deferred.forEach(append);
  }
  return orderPrimaryModulesFirst(role, ordered);
}

/**
 * Puts the role's primary cabinet modules first, in cabinet order (see
 * `@/lib/role-cabinets`), and keeps everything else in rule order. The nav
 * panel groups by section, so within each section the primary modules lead.
 */
function orderPrimaryModulesFirst(role: string, items: StaffNavItem[]): StaffNavItem[] {
  const primary = primaryModuleIds(role);
  if (primary.length === 0) {
    return items;
  }
  const rank = (item: StaffNavItem) => {
    const index = primary.indexOf(item.id);
    return index === -1 ? primary.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}
