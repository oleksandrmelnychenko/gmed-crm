/**
 * Single source of truth for staff route access (pathname + role).
 * See docs/testing/ui-rbac-route-guard-plan_ua.md.
 */

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

const ROLES_FEEDBACK = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "concierge",
] as const satisfies readonly StaffRole[];

const ROLES_REPORTS = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
  "sales",
] as const satisfies readonly StaffRole[];

const ROLES_CONTRACTS_INVOICES = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_FINANCE_CATALOG = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_DOCUMENTS = [
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
] as const satisfies readonly StaffRole[];

const ROLES_APPOINTMENTS = [
  "ceo",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "it_admin",
] as const satisfies readonly StaffRole[];

const ROLES_INTERPRETERS = [
  "ceo",
  "patient_manager",
  "teamlead_interpreter",
  "it_admin",
] as const satisfies readonly StaffRole[];

// CEO has full access by policy — `AuthUser::require_any_role` in
// `crates/server/src/auth/middleware.rs` short-circuits to Ok for Ceo,
// so the frontend guard mirrors that by including "ceo" everywhere.
const ROLES_ADMIN = ["ceo", "it_admin"] as const satisfies readonly StaffRole[];

const ROLES_COMPLIANCE = [
  "ceo",
  "patient_manager",
] as const satisfies readonly StaffRole[];

const ROLES_ADMIN_USERS = [
  "ceo",
  "it_admin",
] as const satisfies readonly StaffRole[];

const ROLES_ADMIN_CUSTOM_FIELDS = [
  "ceo",
  "it_admin",
  "patient_manager",
  "sales",
] as const satisfies readonly StaffRole[];

// Role constants below are aligned with the canonical "list" handler each
// staff workspace page hits on mount. See
// `docs/testing/phase-f-ssot-drift-audit.md` for the cross-reference table.

/** `crates/server/src/routes/leads.rs:114` (`list_leads`) — CEO passes via `require_any_role` bypass. */
const ROLES_LEADS = [
  "ceo",
  "patient_manager",
  "sales",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/cases.rs:275` (`list_cases`) */
const ROLES_CASES = [
  "ceo",
  "patient_manager",
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
  "patient_manager",
  "concierge",
  "billing",
  "sales",
  "it_admin",
] as const satisfies readonly StaffRole[];

/** `crates/server/src/routes/concierge_services.rs:564` (`list_concierge_services`) */
const ROLES_SERVICES = [
  "ceo",
  "patient_manager",
  "concierge",
  "billing",
] as const satisfies readonly StaffRole[];

type RouteRule = {
  id: string;
  match: "exact" | "prefix";
  path: string;
  roles: readonly string[];
  nav?: {
    section: StaffNavSection;
    labelKey: string;
  };
};

export type StaffNavSection = "main" | "crm" | "medicine" | "admin";
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
    id: "admin/access",
    match: "prefix",
    path: "/admin/access",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "nav_access_matrix" },
  },
  {
    id: "admin/activity",
    match: "prefix",
    path: "/admin/activity",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "nav_activity" },
  },
  {
    id: "admin/announcements",
    match: "prefix",
    path: "/admin/announcements",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "nav_announcements" },
  },
  {
    id: "admin/compliance",
    match: "prefix",
    path: "/admin/compliance",
    roles: ROLES_COMPLIANCE,
    nav: { section: "admin", labelKey: "nav_compliance" },
  },
  {
    id: "admin/custom-fields",
    match: "prefix",
    path: "/admin/custom-fields",
    roles: ROLES_ADMIN_CUSTOM_FIELDS,
    nav: { section: "admin", labelKey: "nav_custom_fields" },
  },
  {
    id: "admin/health",
    match: "prefix",
    path: "/admin/health",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "nav_health" },
  },
  {
    id: "admin/notifications",
    match: "prefix",
    path: "/admin/notifications",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "nav_notifications" },
  },
  {
    id: "admin/security",
    match: "prefix",
    path: "/admin/security",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "nav_security" },
  },
  {
    id: "admin/settings",
    match: "prefix",
    path: "/admin/settings",
    roles: ROLES_ADMIN,
    nav: { section: "admin", labelKey: "settings_title" },
  },
  {
    id: "admin/users",
    match: "prefix",
    path: "/admin/users",
    roles: ROLES_ADMIN_USERS,
    nav: { section: "admin", labelKey: "nav_users_roles" },
  },
  { id: "admin", match: "prefix", path: "/admin", roles: ROLES_ADMIN },
  {
    id: "appointments",
    match: "prefix",
    path: "/appointments",
    roles: ROLES_APPOINTMENTS,
    nav: { section: "medicine", labelKey: "appointments_title" },
  },
  {
    id: "interpreters",
    match: "prefix",
    path: "/interpreters",
    roles: ROLES_INTERPRETERS,
    nav: { section: "medicine", labelKey: "nav_interpreters" },
  },
  {
    id: "documents",
    match: "prefix",
    path: "/documents",
    roles: ROLES_DOCUMENTS,
    nav: { section: "crm", labelKey: "nav_documents" },
  },
  {
    id: "chat",
    match: "exact",
    path: "/chat",
    roles: ROLES_CHAT,
    nav: { section: "main", labelKey: "nav_chat" },
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
    nav: { section: "main", labelKey: "nav_reports" },
  },
  {
    id: "recommendations",
    match: "exact",
    path: "/recommendations",
    roles: ["ceo"],
  },
  {
    id: "contracts",
    match: "exact",
    path: "/contracts",
    roles: ROLES_CONTRACTS_INVOICES,
    nav: { section: "crm", labelKey: "nav_contracts" },
  },
  {
    id: "invoices",
    match: "exact",
    path: "/invoices",
    roles: ROLES_CONTRACTS_INVOICES,
    nav: { section: "crm", labelKey: "nav_invoices" },
  },
  {
    id: "finance-catalog",
    match: "exact",
    path: "/finance-catalog",
    roles: ROLES_FINANCE_CATALOG,
    nav: { section: "crm", labelKey: "nav_finance_catalog" },
  },
  {
    id: "orders",
    match: "prefix",
    path: "/orders",
    roles: ROLES_ORDERS,
    nav: { section: "crm", labelKey: "orders_title" },
  },
  {
    id: "leads",
    match: "exact",
    path: "/leads",
    roles: ROLES_LEADS,
    nav: { section: "crm", labelKey: "leads_title" },
  },
  {
    id: "cases",
    match: "prefix",
    path: "/cases",
    roles: ROLES_CASES,
    nav: { section: "medicine", labelKey: "cases_title" },
  },
  {
    id: "sops",
    match: "exact",
    path: "/sops",
    roles: ALL_STAFF_ROLES,
    nav: { section: "main", labelKey: "nav_learning" },
  },
  {
    id: "providers",
    match: "prefix",
    path: "/providers",
    roles: ROLES_PROVIDERS,
    nav: { section: "crm", labelKey: "nav_providers" },
  },
  {
    id: "patients",
    match: "prefix",
    path: "/patients",
    roles: ROLES_PATIENTS,
    nav: { section: "crm", labelKey: "patients_title" },
  },
  {
    id: "services",
    match: "exact",
    path: "/services",
    roles: ROLES_SERVICES,
    nav: { section: "crm", labelKey: "nav_my_services" },
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
  { id: "chat", to: "/chat", labelKey: "nav_chat" },
  { id: "appointments", to: "/appointments", labelKey: "nav_my_appointments" },
  { id: "recommendations", to: "/recommendations", labelKey: "nav_my_recommendations" },
  { id: "documents", to: "/documents", labelKey: "nav_my_documents" },
  { id: "services", to: "/services", labelKey: "nav_my_services" },
  { id: "invoices", to: "/invoices", labelKey: "nav_my_invoices" },
  { id: "feedback", to: "/feedback", labelKey: "nav_my_feedback" },
  { id: "privacy", to: "/privacy", labelKey: "nav_my_privacy" },
] as const;

const STAFF_ROUTE_ROLE_SETS = new Map(
  STAFF_ROUTE_RULES.map((rule) => [rule.id, new Set(rule.roles)]),
);

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
 * Whether a logged-in staff user may open this pathname.
 */
export function canAccessStaffRoute(role: string, pathname: string): boolean {
  if (role === "patient") {
    return false;
  }
  const p = normalizePathname(pathname);
  for (const rule of STAFF_ROUTE_RULES) {
    if (!pathMatches(p, rule)) {
      continue;
    }
    return STAFF_ROUTE_ROLE_SETS.get(rule.id)?.has(role) ?? false;
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
export function staffHrefIfAllowed(role: string, href: string): string {
  const pathname = normalizePathname(href);
  if (role === "patient") {
    return canAccessPatientPortalRoute(pathname) ? href : "/";
  }
  if (!canAccessStaffRoute(role, pathname)) {
    return "/";
  }
  return href;
}

export function listStaffNavItems(role: string): StaffNavItem[] {
  if (role === "patient") {
    return [];
  }
  const items: StaffNavItem[] = [];
  for (const rule of STAFF_ROUTE_RULES) {
    if (!rule.nav || !STAFF_ROUTE_ROLE_SETS.get(rule.id)?.has(role)) {
      continue;
    }
    items.push({
      id: rule.id,
      to: rule.path,
      labelKey: rule.nav.labelKey,
      section: rule.nav.section,
    });
  }
  return items;
}
