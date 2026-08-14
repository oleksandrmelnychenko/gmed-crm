import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
} from "react";
import {
  Activity,
  Database,
  RefreshCcw,
  Search,
  Settings2,
  ShieldAlert,
  UsersRound,
  X,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminToolbar,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTablePager } from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { clearApiCache } from "@/lib/api";
import {
  formatEnumLabelFromKeys,
  formatUnknownValue,
  useLang,
  type TranslationKey,
  type Translations,
} from "@/lib/i18n";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { formatAdminDateTime } from "@/pages/admin-pages.helpers";
import { fetchAdminActivity } from "@/pages/admin/data/admin-api";
import {
  Banner,
  EmptyCell,
  PageHeader,
  StatusBadge,
  TabLoader,
  tokens,
} from "@/components/ui-shell";

interface ActivityRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string | null;
  entity_id: unknown;
  context: Record<string, unknown> | null;
  created_at: string;
}

const ADMIN_ACTIVITY_REALTIME_EVENTS = [
  "access_policy.updated",
  "access_policy.reset",
  "announcement.created",
  "announcement.updated",
  "announcement.deleted",
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_checklist.created",
  "appointment_checklist.completed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "case.created",
  "case.updated",
  "case.medication_expiry_confirmed",
  "case.medication_expiry_flagged",
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
  "consent.granted",
  "consent.revoked",
  "custom_field.created",
  "custom_field.updated",
  "custom_field.deleted",
  "document.uploaded",
  "document.payment_proof_uploaded",
  "document.generated",
  "document.updated",
  "document.deleted",
  "document.portal_released",
  "document.portal_revoked",
  "document.translation_requested",
  "document.translation_updated",
  "feedback.submitted",
  "feedback.reviewed",
  "framework_contract.created",
  "framework_contract.status_changed",
  "invoice.created",
  "invoice.status_changed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "lead.created",
  "lead.updated",
  "lead.status_changed",
  "lead.converted",
  "lead.failed_resolved",
  "notification_channel.created",
  "notification_channel.updated",
  "notification_channel.deleted",
  "order.created",
  "order.phase_changed",
  "order.process_gates_updated",
  "order.debt_management_updated",
  "order.planning_preparation_updated",
  "order.execution_flow_updated",
  "order.followup_flow_updated",
  "order.external_invoice_created",
  "order.external_invoice_updated",
  "order.external_invoice_overdue",
  "order.leistung_added",
  "order.leistung_approved",
  "patient.created",
  "patient.updated",
  "patient.assigned",
  "patient.assignment_revoked",
  "patient.activated",
  "patient.deactivated",
  "pending_login.approved",
  "pending_login.rejected",
  "privacy_request.created",
  "privacy_request.reviewed",
  "privacy_request.executed",
  "provider.created",
  "provider.updated",
  "provider.deleted",
  "provider.activated",
  "provider.deactivated",
  "provider.doctor_created",
  "provider.doctor_updated",
  "provider.doctor_deleted",
  "provider.service_created",
  "provider.service_updated",
  "provider.service_deleted",
  "quote.created",
  "quote.status_changed",
  "reminder.created",
  "reminder.completed",
  "security.ip_whitelist_added",
  "security.ip_whitelist_deleted",
  "session.revoked",
  "session.revoked_all",
  "system_setting.updated",
  "system_setting.maintenance_toggled",
  "task.created",
  "task.status_changed",
  "user.created",
  "user.updated",
  "user.deactivated",
  "user.activated",
  "user.password_reset",
  "user.unlocked",
  "user.force_password_reset",
  "user.mfa_toggled",
  "workflow_checklist_item.created",
  "workflow_checklist_item.completed",
] as const;

function actionTone(action: string) {
  switch (action) {
    case "login":
    case "login_success":
    case "create_lead":
    case "create_patient":
    case "convert_lead":
      return "success" as const;
    case "revoke_all_sessions":
    case "admin_force_logout_user":
    case "revoke_all_users_sessions":
    case "token_theft_detected":
    case "login_failure":
    case "login_failed":
    case "login_blocked":
    case "refresh_token_theft":
    case "refresh_family_revoked":
      return "error" as const;
    case "qualify_lead":
      return "warning" as const;
    case "update_setting":
      return "brand" as const;
    default:
      return "neutral" as const;
  }
}

const EXACT_ACTION_LABEL_KEYS = {
  login: "activity_action_login",
  login_success: "activity_action_login_success",
  login_failure: "activity_action_login_failure",
  login_failed: "activity_action_login_failure",
  login_blocked: "activity_action_login_blocked",
  login_mfa_requested: "activity_action_login_mfa_requested",
  create_lead: "activity_action_create_lead",
  create_patient: "activity_action_create_patient",
  convert_lead: "activity_action_convert_lead",
  qualify_lead: "activity_action_qualify_lead",
  update_setting: "activity_action_update_setting",
  revoke_all_sessions: "activity_action_revoke_all_sessions",
  admin_force_logout_user: "activity_action_admin_force_logout_user",
  revoke_all_users_sessions: "activity_action_revoke_all_users_sessions",
  token_theft_detected: "activity_action_token_theft_detected",
  refresh_token_theft: "activity_action_token_theft_detected",
  refresh_family_revoked: "activity_action_refresh_family_revoked",
} as const satisfies Partial<Record<string, TranslationKey>>;

type ActivityView = "activity" | "security" | "technical";

const SECURITY_ACTIONS = new Set([
  "login",
  "login_success",
  "login_failure",
  "login_failed",
  "login_blocked",
  "login_mfa_requested",
  "refresh_token_theft",
  "refresh_family_revoked",
  "token_theft_detected",
  "session.revoked",
  "session.revoked_all",
  "admin_force_logout_user",
  "revoke_all_sessions",
  "revoke_all_users_sessions",
  "pending_login.approved",
  "pending_login.rejected",
  "user.password_reset",
  "user.unlocked",
  "user.force_password_reset",
  "user.mfa_toggled",
]);

function isSecurityActivity(activity: ActivityRow): boolean {
  return activity.entity_type === "auth"
    || activity.entity_type === "security"
    || activity.entity_type === "session"
    || SECURITY_ACTIONS.has(activity.action);
}

function filterLegacyActivity(items: ActivityRow[], view: ActivityView): ActivityRow[] {
  if (view === "technical") return items.filter((item) => item.action === "http_request");
  if (view === "security") return items.filter(isSecurityActivity);
  return items.filter((item) => item.action !== "http_request");
}

const ACTIVITY_ENTITY_LABEL_KEYS = {
  access_policy: "activity_entity_access_policy",
  announcement: "activity_entity_announcement",
  appointment: "activity_entity_appointment",
  appointment_checklist: "activity_entity_appointment_checklist",
  appointment_request: "activity_entity_appointment_request",
  case: "activity_entity_case",
  concierge_service: "activity_entity_concierge_service",
  consent: "activity_entity_consent",
  custom_field: "activity_entity_custom_field",
  document: "activity_entity_document",
  feedback: "activity_entity_feedback",
  framework_contract: "activity_entity_framework_contract",
  invoice: "activity_entity_invoice",
  lead: "activity_entity_lead",
  notification_channel: "activity_entity_notification_channel",
  order: "activity_entity_order",
  patient: "activity_entity_patient",
  pending_login: "activity_entity_pending_login",
  privacy_request: "activity_entity_privacy_request",
  provider: "activity_entity_provider",
  quote: "activity_entity_quote",
  reminder: "activity_entity_reminder",
  security: "activity_entity_security",
  session: "activity_entity_session",
  system_setting: "activity_entity_system_setting",
  task: "activity_entity_task",
  user: "activity_entity_user",
  workflow_checklist_item: "activity_entity_workflow_checklist_item",
  http: "activity_entity_http",
} as const satisfies Partial<Record<string, TranslationKey>>;

const ACTIVITY_EVENT_LABEL_KEYS = {
  activated: "activity_event_activated",
  added: "activity_event_added",
  approved: "activity_event_approved",
  assigned: "activity_event_assigned",
  assignment_revoked: "activity_event_assignment_revoked",
  billing_ready: "activity_event_billing_ready",
  cancelled: "activity_event_cancelled",
  completed: "activity_event_completed",
  confirmed: "activity_event_confirmed",
  converted: "activity_event_converted",
  created: "activity_event_created",
  deactivated: "activity_event_deactivated",
  debt_management_updated: "activity_event_debt_management_updated",
  deleted: "activity_event_deleted",
  doctor_created: "activity_event_doctor_created",
  doctor_deleted: "activity_event_doctor_deleted",
  doctor_updated: "activity_event_doctor_updated",
  dunning_created: "activity_event_dunning_created",
  executed: "activity_event_executed",
  execution_flow_updated: "activity_event_execution_flow_updated",
  external_invoice_created: "activity_event_external_invoice_created",
  external_invoice_overdue: "activity_event_external_invoice_overdue",
  external_invoice_updated: "activity_event_external_invoice_updated",
  failed_resolved: "activity_event_failed_resolved",
  followup_flow_updated: "activity_event_followup_flow_updated",
  force_password_reset: "activity_event_force_password_reset",
  generated: "activity_event_generated",
  granted: "activity_event_granted",
  ip_whitelist_added: "activity_event_ip_whitelist_added",
  ip_whitelist_deleted: "activity_event_ip_whitelist_deleted",
  leistung_added: "activity_event_leistung_added",
  leistung_approved: "activity_event_leistung_approved",
  maintenance_toggled: "activity_event_maintenance_toggled",
  medication_expiry_confirmed: "activity_event_medication_expiry_confirmed",
  medication_expiry_flagged: "activity_event_medication_expiry_flagged",
  mfa_toggled: "activity_event_mfa_toggled",
  overdue_marked: "activity_event_overdue_marked",
  password_reset: "activity_event_password_reset",
  payment_proof_uploaded: "activity_event_payment_proof_uploaded",
  phase_changed: "activity_event_phase_changed",
  planning_preparation_updated: "activity_event_planning_preparation_updated",
  portal_released: "activity_event_portal_released",
  portal_revoked: "activity_event_portal_revoked",
  process_gates_updated: "activity_event_process_gates_updated",
  rejected: "activity_event_rejected",
  reset: "activity_event_reset",
  reviewed: "activity_event_reviewed",
  revoked: "activity_event_revoked",
  revoked_all: "activity_event_revoked_all",
  service_created: "activity_event_service_created",
  service_deleted: "activity_event_service_deleted",
  service_updated: "activity_event_service_updated",
  status_changed: "activity_event_status_changed",
  submitted: "activity_event_submitted",
  translation_requested: "activity_event_translation_requested",
  translation_updated: "activity_event_translation_updated",
  unlocked: "activity_event_unlocked",
  updated: "activity_event_updated",
  uploaded: "activity_event_uploaded",
} as const satisfies Partial<Record<string, TranslationKey>>;

function actionLabel(action: string, translations: Translations): string {
  if (action === "http_request") return translations.activity_http_request;

  const exact = formatEnumLabelFromKeys(action, EXACT_ACTION_LABEL_KEYS, translations);
  if (exact !== translations.common_unknown_value && exact !== translations.common_unknown) {
    return exact;
  }

  const [entityKey, eventKey] = action.split(".");
  const entityLabel = entityKey
    ? formatEnumLabelFromKeys(entityKey, ACTIVITY_ENTITY_LABEL_KEYS, translations)
    : translations.common_not_set;
  const eventLabel = eventKey
    ? formatEnumLabelFromKeys(eventKey, ACTIVITY_EVENT_LABEL_KEYS, translations)
    : translations.common_not_set;
  if (
    entityKey &&
    eventKey &&
    entityLabel !== translations.common_unknown_value &&
    eventLabel !== translations.common_unknown_value
  ) {
    return `${entityLabel}: ${eventLabel}`;
  }

  return formatUnknownValue(action, translations);
}

const TECHNICAL_CONTEXT_KEYS = new Set(["latency_ms", "method", "route", "status"]);

function contextSummary(
  context: Record<string, unknown> | null,
  action: string,
  translations: Translations,
): string {
  if (!context || typeof context !== "object") return "\u2014";
  const method = typeof context.method === "string" ? context.method : "";
  const route = typeof context.route === "string" ? context.route : "";
  const status = typeof context.status === "number" ? context.status : null;
  const latency = typeof context.latency_ms === "number" ? context.latency_ms : null;

  if (action === "http_request") {
    return [
      method && route ? `${method} ${route}` : route || method,
      status !== null ? `${translations.activity_technical_status} ${status}` : "",
      latency !== null ? `${latency} ms` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "\u2014";
  }

  const entries = Object.entries(context)
    .filter(([key]) => !TECHNICAL_CONTEXT_KEYS.has(key))
    .slice(0, 3);
  if (entries.length === 0) return "\u2014";
  return entries
    .map(([key, value]) => {
      const normalized =
        typeof value === "string"
          ? value
          : value === null
            ? "null"
            : JSON.stringify(value);
      return `${key}: ${normalized}`;
    })
    .join(", ");
}

function entityTechnicalValue(entityType: string | null, entityId: unknown): string {
  const entity = entityType ?? "";
  let idStr = "";
  if (typeof entityId === "string") {
    idStr = entityId.slice(0, 8);
  } else if (entityId != null) {
    idStr = String(entityId).slice(0, 8);
  }
  if (!idStr) return entity || "\u2014";
  return entity ? `${entity} ${idStr}\u2026` : idStr;
}

function entityTypeLabel(entityType: string | null, translations: Translations): string {
  if (!entityType) return translations.common_not_set;
  return formatEnumLabelFromKeys(entityType, ACTIVITY_ENTITY_LABEL_KEYS, translations);
}

function entityDisplay(
  entityType: string | null,
  entityId: unknown,
  translations: Translations,
): string {
  let idStr = "";
  if (typeof entityId === "string") {
    idStr = entityId.slice(0, 8);
  } else if (entityId != null) {
    idStr = String(entityId).slice(0, 8);
  }

  const entity = entityTypeLabel(entityType, translations);
  return idStr ? `${entity} ${idStr}\u2026` : entity;
}

function activityInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function prettyContext(context: Record<string, unknown> | null) {
  return context ? JSON.stringify(context, null, 2) : "-";
}

type AdminActivityMetricsValue = {
  activity24h: number;
  activeUsers24h: number;
  changes24h: number;
  security24h: number;
  technical24h: number;
};

type AdminActivityMetricsProps = {
  metrics: AdminActivityMetricsValue;
  t: Translations;
};

function AdminActivityMetrics({
  metrics,
  t,
}: AdminActivityMetricsProps) {
  return (
    <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
      <AdminInlineMetric
        icon={Activity}
        tone="sky"
        label={t.activity_metric_events_24h}
        value={metrics.activity24h}
        description="24h"
      />
      <AdminInlineMetric
        icon={UsersRound}
        tone="emerald"
        label={t.activity_metric_users_24h}
        value={metrics.activeUsers24h}
        description="24h"
      />
      <AdminInlineMetric
        icon={Database}
        tone="amber"
        label={t.activity_metric_changes_24h}
        value={metrics.changes24h}
        description="24h"
      />
      <AdminInlineMetric
        icon={ShieldAlert}
        tone="slate"
        label={t.activity_metric_security_24h}
        value={metrics.security24h}
        description="24h"
      />
    </div>
  );
}

type AdminActivityDetailSheetProps = {
  detailOpen: boolean;
  lang: Parameters<typeof formatAdminDateTime>[1];
  selectedActivity: ActivityRow | null;
  t: Translations;
  onOpenChange: (open: boolean) => void;
};

function AdminActivityDetailSheet({
  detailOpen,
  lang,
  selectedActivity,
  t,
  onOpenChange,
}: AdminActivityDetailSheetProps) {
  return (
    <Sheet open={detailOpen} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
        <AdminSheetScaffold
          title={selectedActivity ? actionLabel(selectedActivity.action, t) : t.activity_details}
          description={
            selectedActivity
              ? `${selectedActivity.user_name} - ${formatAdminDateTime(selectedActivity.created_at, lang)}`
              : t.activity_subtitle
          }
          footer={(
            <SheetActionsFooter>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => onOpenChange(false)}
              >
                {t.common_cancel}
              </Button>
            </SheetActionsFooter>
          )}
        >
          {selectedActivity ? (
            <>
              <section className={`space-y-2.5 rounded-xl p-3.5 ${tokens.surface.softCard}`}>
                <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                  <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                  <span>{t.activity_details}</span>
                </h3>

                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                    <p className="text-[11.5px] text-muted-foreground">{t.activity_user}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {selectedActivity.user_name || t.activity_anonymous_actor}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selectedActivity.user_email || "-"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                    <p className="text-[11.5px] text-muted-foreground">{t.activity_action}</p>
                    <div className="mt-1">
                      <StatusBadge tone={actionTone(selectedActivity.action)}>
                        {actionLabel(selectedActivity.action, t)}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                    <p className="text-[11.5px] text-muted-foreground">{t.activity_entity}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {entityDisplay(selectedActivity.entity_type, selectedActivity.entity_id, t) || "-"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                    <p className="text-[11.5px] text-muted-foreground">{t.activity_time}</p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      {formatAdminDateTime(selectedActivity.created_at, lang) || "-"}
                    </p>
                  </div>
                </div>
              </section>

              <section className={`space-y-2.5 rounded-xl p-3.5 ${tokens.surface.softCard}`}>
                <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                  <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                  <span>{t.activity_payload}</span>
                </h3>
                <pre className="overflow-x-auto rounded-lg border border-border/50 bg-card/60 p-3 text-xs leading-6 text-muted-foreground">
                  {prettyContext(selectedActivity.context)}
                </pre>
              </section>
            </>
          ) : (
            <EmptyCell>{t.activity_subtitle}</EmptyCell>
          )}
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}

type AdminActivityToolbarSectionProps = {
  actionOptions: string[];
  anyFilterActive: boolean;
  dateFrom: string;
  dateTo: string;
  filterAction: string;
  pageSize: number;
  search: string;
  t: Translations;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onFilterActionChange: (value: string) => void;
  onPageSizeChange: (value: number) => void;
  onReset: () => void;
  onSearchChange: (value: string) => void;
};

function AdminActivityToolbarSection({
  actionOptions,
  anyFilterActive,
  dateFrom,
  dateTo,
  filterAction,
  pageSize,
  search,
  t,
  onDateFromChange,
  onDateToChange,
  onFilterActionChange,
  onPageSizeChange,
  onReset,
  onSearchChange,
}: AdminActivityToolbarSectionProps) {
  return (
    <AdminToolbar className="grid grid-cols-1 items-end gap-2 rounded-none border-0 bg-transparent p-0 shadow-none sm:grid-cols-2 xl:grid-cols-[minmax(200px,1.2fr)_minmax(190px,1fr)_150px_150px_100px_auto]">
      <div className="relative w-full">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        <Input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t.activity_search_placeholder}
          className="h-8 w-full rounded-lg bg-field pl-8 text-[13px]"
        />
      </div>

      <NativeComboboxSelect
        value={filterAction || "__all__"}
        onChange={(event) =>
          onFilterActionChange(
            event.target.value && event.target.value !== "__all__"
              ? event.target.value
              : "",
          )
        }
        className="h-8 w-full rounded-lg bg-field text-[13px]"
      >
        <option value="__all__">{t.providers_all}</option>
        {actionOptions.map((value) => (
          <option key={value} value={value}>
            {actionLabel(value, t)}
          </option>
        ))}
      </NativeComboboxSelect>

      <div className="grid gap-1">
        <span className={cn(tokens.text.label, "text-[11px]")}>
          {t.documents_date_from}
        </span>
        <Input
          type="date"
          value={dateFrom}
          onChange={(event) => onDateFromChange(event.target.value)}
          className="h-8 w-full rounded-lg bg-field text-[13px]"
        />
      </div>

      <div className="grid gap-1">
        <span className={cn(tokens.text.label, "text-[11px]")}>
          {t.documents_date_to}
        </span>
        <Input
          type="date"
          value={dateTo}
          onChange={(event) => onDateToChange(event.target.value)}
          className="h-8 w-full rounded-lg bg-field text-[13px]"
        />
      </div>

      <div className="grid gap-1">
        <span className={cn(tokens.text.label, "text-[11px]")}>
          {t.pagination_per_page}
        </span>
        <NativeComboboxSelect
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          className="h-8 w-full rounded-lg bg-field text-[13px]"
        >
          {[25, 50, 100, 200].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </NativeComboboxSelect>
      </div>

      {anyFilterActive ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
          onClick={onReset}
        >
          <X className="size-3.5" />
          {t.common_reset}
        </Button>
      ) : null}
    </AdminToolbar>
  );
}

function AdminActivityViewSelector({
  view,
  retention,
  lang,
  t,
  onChange,
}: {
  view: ActivityView;
  retention: { technicalDays: number; meaningfulDays: number };
  lang: Parameters<typeof formatAdminDateTime>[1];
  t: Translations;
  onChange: (view: ActivityView) => void;
}) {
  const options: Array<{
    icon: typeof Activity;
    label: string;
    value: ActivityView;
  }> = [
    { icon: Activity, label: t.activity_view_activity, value: "activity" },
    { icon: ShieldAlert, label: t.activity_view_security, value: "security" },
    { icon: Settings2, label: t.activity_view_technical, value: "technical" },
  ];
  const hint = view === "technical"
    ? t.activity_view_technical_hint
    : view === "security"
      ? t.activity_view_security_hint
      : t.activity_view_activity_hint;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-border/70 bg-muted/30 p-0.5">
          {options.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={view === option.value}
                onClick={() => onChange(option.value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  view === option.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>

      <div className="shrink-0 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t.activity_retention}:</span>{" "}
        {t.activity_retention_technical}{" "}
        {new Intl.NumberFormat(lang, { style: "unit", unit: "day", unitDisplay: "long" }).format(retention.technicalDays)} ·{" "}
        {t.activity_retention_meaningful}{" "}
        {new Intl.NumberFormat(lang, { style: "unit", unit: "day", unitDisplay: "long" }).format(retention.meaningfulDays)}
      </div>
    </section>
  );
}

interface AdminActivityPageState {
  activities: ActivityRow[];
  loading: boolean;
  error: string;
  search: string;
  filterAction: string;
  dateFrom: string;
  dateTo: string;
  pageSize: number;
  offset: number;
  total: number;
  hasMore: boolean;
  metrics: AdminActivityMetricsValue;
  retention: { technicalDays: number; meaningfulDays: number };
  view: ActivityView;
  detailOpen: boolean;
  selectedIndex: number | null;
}

type AdminActivityPagePatch = Partial<AdminActivityPageState>;
type AdminActivityLoadParams = {
  action: string;
  dateFrom: string;
  dateTo: string;
  limit: number;
  offset: number;
  search: string;
  view: ActivityView;
};

const EMPTY_ACTIVITY_METRICS: AdminActivityMetricsValue = {
  activity24h: 0,
  activeUsers24h: 0,
  changes24h: 0,
  security24h: 0,
  technical24h: 0,
};

const INITIAL_ADMIN_ACTIVITY_PAGE_STATE: AdminActivityPageState = {
  activities: [],
  loading: true,
  error: "",
  search: "",
  filterAction: "",
  dateFrom: "",
  dateTo: "",
  pageSize: 25,
  offset: 0,
  total: 0,
  hasMore: false,
  metrics: EMPTY_ACTIVITY_METRICS,
  retention: { technicalDays: 3, meaningfulDays: 365 },
  view: "activity",
  detailOpen: false,
  selectedIndex: null,
};

function adminActivityPageReducer(
  current: AdminActivityPageState,
  patch: AdminActivityPagePatch,
): AdminActivityPageState {
  return {
    ...current,
    ...patch,
  };
}

export function AdminActivityPage() {
  const { t, lang } = useLang();

  const [activityState, dispatchActivityState] = useReducer(
    adminActivityPageReducer,
    INITIAL_ADMIN_ACTIVITY_PAGE_STATE,
  );
  const {
    activities,
    dateFrom,
    dateTo,
    detailOpen,
    error,
    filterAction,
    loading,
    metrics,
    offset,
    pageSize,
    search,
    selectedIndex,
    total,
    retention,
    view,
  } = activityState;
  const deferredSearch = useDeferredValue(search);
  const setSearch = useCallback(
    (value: string) => dispatchActivityState({ offset: 0, search: value }),
    [],
  );
  const setFilterAction = useCallback(
    (value: string) =>
      dispatchActivityState({
        detailOpen: false,
        filterAction: value,
        offset: 0,
        selectedIndex: null,
      }),
    [],
  );
  const setDateFrom = useCallback(
    (value: string) =>
      dispatchActivityState({
        dateFrom: value,
        detailOpen: false,
        offset: 0,
        selectedIndex: null,
      }),
    [],
  );
  const setDateTo = useCallback(
    (value: string) =>
      dispatchActivityState({
        dateTo: value,
        detailOpen: false,
        offset: 0,
        selectedIndex: null,
      }),
    [],
  );
  const setPageSize = useCallback(
    (value: number) =>
      dispatchActivityState({
        detailOpen: false,
        offset: 0,
        pageSize: Number.isFinite(value) ? value : 50,
        selectedIndex: null,
      }),
    [],
  );
  const setDetailOpen = useCallback(
    (value: boolean) => dispatchActivityState({ detailOpen: value }),
    [],
  );
  const setView = useCallback(
    (value: ActivityView) =>
      dispatchActivityState({
        detailOpen: false,
        filterAction: "",
        offset: 0,
        selectedIndex: null,
        view: value,
      }),
    [],
  );

  const loadData = useCallback(async (params: AdminActivityLoadParams) => {
    dispatchActivityState({ loading: true, error: "" });
    try {
      const data = await fetchAdminActivity<ActivityRow>({
        action: params.action,
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
        limit: params.limit,
        offset: params.offset,
        search: params.search,
        view: params.view,
      });
      const legacyResponse = data.view === undefined;
      const visibleItems = legacyResponse
        ? filterLegacyActivity(data.items, params.view)
        : data.items;
      startTransition(() =>
        dispatchActivityState({
          activities: visibleItems,
          error: "",
          hasMore: legacyResponse ? false : data.has_more,
          loading: false,
          offset: data.offset,
          pageSize: data.limit,
          metrics: data.summary
            ? {
                activity24h: data.summary.activity_24h,
                activeUsers24h: data.summary.active_users_24h,
                changes24h: data.summary.changes_24h,
                security24h: data.summary.security_24h,
                technical24h: data.summary.technical_24h,
              }
            : EMPTY_ACTIVITY_METRICS,
          retention: data.retention
            ? {
                technicalDays: data.retention.technical_days,
                meaningfulDays: data.retention.meaningful_days,
              }
            : { technicalDays: 3, meaningfulDays: 365 },
          selectedIndex: null,
          total: legacyResponse ? visibleItems.length : data.total,
        }),
      );
    } catch (loadError) {
      dispatchActivityState({
        activities: [],
        error: loadError instanceof Error ? loadError.message : t.common_error,
        hasMore: false,
        loading: false,
        selectedIndex: null,
        total: 0,
      });
    }
  }, [t.common_error]);

  useEffect(() => {
    void loadData({
      action: filterAction,
      dateFrom,
      dateTo,
      limit: pageSize,
      offset,
      search: deferredSearch,
      view,
    });
  }, [dateFrom, dateTo, deferredSearch, filterAction, loadData, offset, pageSize, view]);

  useDebouncedRealtimeSubscription(ADMIN_ACTIVITY_REALTIME_EVENTS, () => {
    clearApiCache("/admin/activity");
    void loadData({
      action: filterAction,
      dateFrom,
      dateTo,
      limit: pageSize,
      offset,
      search: deferredSearch,
      view,
    });
  }, 300);

  const actionOptions = useMemo(() => {
    const values = new Set<string>([
      ...Object.keys(EXACT_ACTION_LABEL_KEYS),
      ...ADMIN_ACTIVITY_REALTIME_EVENTS,
      ...activities.map((item) => item.action),
    ]);
    return Array.from(values).sort();
  }, [activities]);

  const selectedActivity =
    selectedIndex !== null ? activities[selectedIndex] ?? null : null;
  const selectedActivityId = selectedActivity?.id ?? null;

  const columns = useMemo<ColumnDef<ActivityRow>[]>(() => [
    {
      id: "created_at",
      label: t.activity_time,
      accessor: (activity) => activity.created_at,
      width: 170,
      render: (activity) => (
        <span className="font-mono text-xs text-foreground whitespace-nowrap">
          {formatAdminDateTime(activity.created_at, lang)}
        </span>
      ),
    },
    {
      id: "user",
      label: t.activity_user,
      accessor: (activity) => `${activity.user_name} ${activity.user_email}`,
      width: 260,
      render: (activity) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-foreground">
            {activityInitials(activity.user_name || t.activity_anonymous_actor)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">
              {activity.user_name || t.activity_anonymous_actor}
            </div>
            <div className="truncate text-[11px] text-foreground">
              {activity.user_email || "—"}
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "action",
      label: t.activity_action,
      accessor: (activity) => activity.action,
      width: 180,
      render: (activity) => (
        <StatusBadge tone={actionTone(activity.action)}>
          {actionLabel(activity.action, t)}
        </StatusBadge>
      ),
    },
    {
      id: "entity",
      label: t.activity_entity,
      accessor: (activity) => entityTechnicalValue(activity.entity_type, activity.entity_id),
      width: 180,
      render: (activity) => (
        <span className="font-mono text-xs text-foreground">
          {entityDisplay(activity.entity_type, activity.entity_id, t)}
        </span>
      ),
    },
    {
      id: "details",
      label: t.activity_details,
      accessor: (activity) => contextSummary(activity.context, activity.action, t),
      width: 360,
      render: (activity) => {
        const details = contextSummary(activity.context, activity.action, t);
        return (
          <span className="truncate text-xs text-foreground" title={details}>
            {details}
          </span>
        );
      },
    },
  ], [
    lang,
    t,
  ]);

  const anyFilterActive =
    search.trim() !== "" || filterAction !== "" || dateFrom !== "" || dateTo !== "";
  const pageIndex = Math.floor(offset / pageSize);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const countLabel = total;

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.activity_title}
          description={t.activity_subtitle}
          actions={(
            <>
              <AdminGuideButton
                title={t.activity_title}
                description={t.activity_subtitle}
              />
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                disabled={loading}
                onClick={() =>
                  void loadData({
                    action: filterAction,
                    dateFrom,
                    dateTo,
                    limit: pageSize,
                    offset,
                    search: deferredSearch,
                    view,
                  })
                }
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
            </>
          )}
        />

        <AdminActivityViewSelector
          view={view}
          retention={retention}
          lang={lang}
          t={t}
          onChange={setView}
        />

        <AdminActivityToolbarSection
          actionOptions={actionOptions}
          anyFilterActive={anyFilterActive}
          dateFrom={dateFrom}
          dateTo={dateTo}
          filterAction={filterAction}
          pageSize={pageSize}
          search={search}
          t={t}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
          onFilterActionChange={setFilterAction}
          onPageSizeChange={setPageSize}
          onReset={() =>
            dispatchActivityState({
              dateFrom: "",
              dateTo: "",
              detailOpen: false,
              filterAction: "",
              offset: 0,
              search: "",
              selectedIndex: null,
            })
          }
          onSearchChange={setSearch}
        />

        <DataTablePager
          className="rounded-lg border border-border/60"
          pageIndex={pageIndex}
          pageSize={pageSize}
          totalPages={totalPages}
          totalRows={total}
          previousLabel={t.pagination_previous}
          nextLabel={t.pagination_next}
          onPageChange={(nextPageIndex) =>
            dispatchActivityState({
              detailOpen: false,
              offset: nextPageIndex * pageSize,
              selectedIndex: null,
            })
          }
        />

        <AdminActivityMetrics metrics={metrics} t={t} />

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminTableCard
            title={t.activity_title}
            description={t.activity_subtitle}
            count={countLabel}
          >
            {activities.length === 0 ? (
              <div className="p-4">
                <EmptyCell>{t.activity_no_events}</EmptyCell>
              </div>
            ) : (
              <DataTableSurface
                rows={activities}
                columns={columns}
                defaultDensity="comfortable"
                defaultSort={[{ field: "created_at", dir: "desc" }]}
                dictionary={t as unknown as Record<string, string>}
                rowId={(activity) => activity.id}
                activeRowId={selectedActivityId}
                onRowClick={(activity) => {
                  dispatchActivityState({
                    detailOpen: true,
                    selectedIndex: activities.indexOf(activity),
                  });
                }}
                tableClassName="min-h-[360px]"
              />
            )}
          </AdminTableCard>
        ) : null}
      </div>

      <AdminActivityDetailSheet
        detailOpen={detailOpen}
        lang={lang}
        selectedActivity={selectedActivity}
        t={t}
        onOpenChange={setDetailOpen}
      />
    </>
  );
}
