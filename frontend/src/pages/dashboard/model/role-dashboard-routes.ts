/**
 * Where each scorecard counter of a role home leads. A counter opens its list
 * filtered so that the list shows the same number (QA 2026-11-12, B S3-4); the
 * server KPIs (`crates/server/src/routes/stats.rs`) use the same rules as the
 * list filters named here.
 */
const METRIC_ROUTES: Record<string, string> = {
  active_patients: "/patients",
  active_orders: "/orders?status=active",
  appointments_next_7d: "/appointments",
  completed_appointments_30d: "/appointments",
  upcoming_hours_30d: "/appointments",
  open_tasks: "/task-manager",
  overdue_tasks: "/task-manager?timing=overdue",
  open_checklist_items: "/task-manager",
  // The service tiles open the services list (/concierge is the task board).
  active_services: "/services",
  completed_services_30d: "/services",
  ready_for_billing: "/services",
  portal_requests_30d: "/services",
  qualified_leads: "/leads?status=qualified",
  // Created in 30 days, whatever the status now (archived and converted too).
  new_leads_30d: "/leads?archived=true&created_within_days=30",
  qualified_leads_30d: "/leads?status=qualified&status_within_days=30",
  converted_leads_30d: "/leads?status=converted&status_within_days=30",
  // The rate is converted / created in 90 days: the list shows its numerator.
  lead_to_patient_conversion_rate_pct: "/leads?status=converted&status_within_days=90",
  // Same figure as "Долг пациентов" on the company finance page.
  outstanding_receivables_total: "/company-finance",
  open_advance_requests_total: "/invoices",
  overdue_invoice_count: "/invoices?status=overdue",
  invoices_30d: "/invoices?created_within_days=30",
  // Sessions and pending second factors are counted on the health page.
  active_sessions: "/admin/health",
  locked_accounts: "/admin/users",
  pending_logins: "/admin/health",
  failed_logins_24h: "/admin/activity",
  blocked_logins_24h: "/admin/activity",
  active_users: "/admin/users",
  db_active_connections: "/admin/health",
  audit_events_24h: "/admin/activity",
};

/** Counters whose number is narrower for one role than the shared rule above. */
const ROLE_METRIC_ROUTES: Record<string, Record<string, string>> = {
  // «Активные заказы по вашим пациентам»: the PM's assigned patients only.
  patient_manager: { active_orders: "/orders?status=active&assigned=me" },
};

export function metricRoute(role: string, key: string): string | undefined {
  return ROLE_METRIC_ROUTES[role]?.[key] ?? METRIC_ROUTES[key];
}
