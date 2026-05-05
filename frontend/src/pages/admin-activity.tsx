import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Activity,
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
    case "create_lead":
    case "create_patient":
    case "convert_lead":
      return "success" as const;
    case "revoke_all_sessions":
    case "admin_force_logout_user":
    case "revoke_all_users_sessions":
    case "token_theft_detected":
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
  create_lead: "activity_action_create_lead",
  create_patient: "activity_action_create_patient",
  convert_lead: "activity_action_convert_lead",
  qualify_lead: "activity_action_qualify_lead",
  update_setting: "activity_action_update_setting",
  revoke_all_sessions: "activity_action_revoke_all_sessions",
  admin_force_logout_user: "activity_action_admin_force_logout_user",
  revoke_all_users_sessions: "activity_action_revoke_all_users_sessions",
  token_theft_detected: "activity_action_token_theft_detected",
} as const satisfies Partial<Record<string, TranslationKey>>;

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

function contextSummary(context: Record<string, unknown> | null): string {
  if (!context || typeof context !== "object") return "\u2014";
  const entries = Object.entries(context).slice(0, 3);
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

export function AdminActivityPage() {
  const { t, lang } = useLang();

  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filterAction, setFilterAction] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const loadData = useCallback(async (action: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAdminActivity<ActivityRow>(action);
      startTransition(() => setActivities(data));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void loadData(filterAction);
  }, [filterAction, loadData]);

  useDebouncedRealtimeSubscription(ADMIN_ACTIVITY_REALTIME_EVENTS, () => {
    clearApiCache("/admin/activity");
    void loadData(filterAction);
  }, 300);

  const actionOptions = useMemo(() => {
    const values = new Set(activities.map((item) => item.action));
    return Array.from(values).sort();
  }, [activities]);

  const filtered = useMemo(() => {
    const needle = deferredSearch.trim().toLowerCase();
    if (!needle) return activities;
    return activities.filter((item) =>
      [
        item.user_name,
        item.user_email,
        item.action,
        item.entity_type ?? "",
        contextSummary(item.context),
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [activities, deferredSearch]);

  const metrics = useMemo(() => {
    const uniqueUsers = new Set(filtered.map((item) => item.user_email)).size;
    const loginCount = filtered.filter((item) => item.action === "login").length;
    const settingsUpdates = filtered.filter(
      (item) => item.action === "update_setting",
    ).length;
    const securityEvents = filtered.filter((item) =>
      [
        "revoke_all_sessions",
        "admin_force_logout_user",
        "revoke_all_users_sessions",
        "token_theft_detected",
      ].includes(item.action),
    ).length;

    return {
      total: filtered.length,
      uniqueUsers,
      loginCount,
      settingsUpdates,
      securityEvents,
    };
  }, [filtered]);

  const selectedActivity =
    selectedIndex !== null ? filtered[selectedIndex] ?? null : null;
  const selectedActivityId = selectedActivity
    ? `${selectedActivity.user_email}-${selectedActivity.created_at}-${selectedActivity.action}`
    : null;

  const columns = useMemo<ColumnDef<ActivityRow>[]>(() => [
    {
      id: "created_at",
      label: t.activity_time,
      accessor: (activity) => activity.created_at,
      width: 170,
      render: (activity) => (
        <span className="font-mono text-xs text-muted-foreground whitespace-nowrap">
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
            {activityInitials(activity.user_name)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-foreground">
              {activity.user_name}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              {activity.user_email}
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
        <span className="font-mono text-xs text-muted-foreground">
          {entityDisplay(activity.entity_type, activity.entity_id, t)}
        </span>
      ),
    },
    {
      id: "details",
      label: t.activity_details,
      accessor: (activity) => contextSummary(activity.context),
      width: 360,
      render: (activity) => {
        const details = contextSummary(activity.context);
        return (
          <span className="truncate text-xs text-muted-foreground" title={details}>
            {details}
          </span>
        );
      },
    },
  ], [
    lang,
    t,
  ]);

  const anyFilterActive = search.trim() !== "" || filterAction !== "";

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
                onClick={() => void loadData(filterAction)}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
            </>
          )}
        />

        <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.search_placeholder}
              className="h-8 w-[240px] rounded-lg bg-card pl-8 text-[13px]"
            />
          </div>

          <NativeComboboxSelect
            value={filterAction}


            onChange={(event) => setFilterAction(event.target.value && event.target.value !== "__all__" ? event.target.value : "")} className="h-8 w-[240px] rounded-lg bg-card text-[13px]">
              <option value="__all__">{t.providers_all}</option>
              {actionOptions.map((value) => (
                <option key={value} value={value}>
                  {actionLabel(value, t)}
                </option>
              ))}
            </NativeComboboxSelect>

          {anyFilterActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
              onClick={() => {
                setSearch("");
                setFilterAction("");
              }}
            >
              <X className="size-3.5" />
              {t.common_reset}
            </Button>
          ) : null}
        </AdminToolbar>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
          <AdminInlineMetric
            icon={Activity}
            tone="sky"
            label={t.activity_title}
            value={metrics.total}
            description={t.common_registry}
          />
          <AdminInlineMetric
            icon={UsersRound}
            tone="emerald"
            label={t.activity_user}
            value={metrics.uniqueUsers}
            description={t.common_monitoring}
          />
          <AdminInlineMetric
            icon={ShieldAlert}
            tone="amber"
            label={t.security_title}
            value={metrics.securityEvents}
            description={t.activity_action}
          />
          <AdminInlineMetric
            icon={Settings2}
            tone="slate"
            label={t.settings_title}
            value={metrics.settingsUpdates}
            description={`${metrics.loginCount} ${actionLabel("login", t)}`}
          />
        </div>

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminTableCard
            title={t.activity_title}
            description={t.activity_subtitle}
            count={filtered.length}
          >
            {filtered.length === 0 ? (
              <div className="p-4">
                <EmptyCell>{t.activity_subtitle}</EmptyCell>
              </div>
            ) : (
              <DataTableSurface
                rows={filtered}
                columns={columns}
                defaultDensity="comfortable"
                defaultSort={[{ field: "created_at", dir: "desc" }]}
                dictionary={t as unknown as Record<string, string>}
                rowId={(activity) => `${activity.user_email}-${activity.created_at}-${activity.action}`}
                activeRowId={selectedActivityId}
                onRowClick={(activity) => {
                  setSelectedIndex(filtered.indexOf(activity));
                  setDetailOpen(true);
                }}
                tableClassName="min-h-[360px]"
              />
            )}
          </AdminTableCard>
        ) : null}
      </div>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
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
                  onClick={() => setDetailOpen(false)}
                >
                  {t.common_cancel}
                </Button>
              </SheetActionsFooter>
            )}
          >
            {selectedActivity ? (
              <>
                <section className={`space-y-3 rounded-xl p-3.5 ${tokens.surface.softCard}`}>
                  <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
                    <span>{t.activity_details}</span>
                  </h3>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">{t.activity_user}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {selectedActivity.user_name || "-"}
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

                <section className={`space-y-3 rounded-xl p-3.5 ${tokens.surface.softCard}`}>
                  <h3 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
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
    </>
  );
}
