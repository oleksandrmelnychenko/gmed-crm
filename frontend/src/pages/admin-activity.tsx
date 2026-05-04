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
import { formatUnknownValue, useLang, type Lang, type Translations } from "@/lib/i18n";
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

type UnknownTranslations = Pick<Translations, "common_not_set" | "common_unknown" | "common_unknown_value">;

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

const EXACT_ACTION_LABELS = {
  de: {
    login: "Anmeldung",
    create_lead: "Lead erstellt",
    create_patient: "Patient erstellt",
    convert_lead: "Lead konvertiert",
    qualify_lead: "Lead qualifiziert",
    update_setting: "Einstellung aktualisiert",
    revoke_all_sessions: "Alle Sitzungen widerrufen",
    admin_force_logout_user: "Benutzer abgemeldet",
    revoke_all_users_sessions: "Alle Benutzersitzungen widerrufen",
    token_theft_detected: "Token-Diebstahl erkannt",
  },
  ru: {
    login: "Вход",
    create_lead: "Лид создан",
    create_patient: "Пациент создан",
    convert_lead: "Лид конвертирован",
    qualify_lead: "Лид квалифицирован",
    update_setting: "Настройка обновлена",
    revoke_all_sessions: "Все сессии отозваны",
    admin_force_logout_user: "Пользователь выведен из системы",
    revoke_all_users_sessions: "Все сессии пользователей отозваны",
    token_theft_detected: "Обнаружена кража токена",
  },
} as const;

const ACTIVITY_ENTITY_LABELS = {
  de: {
    access_policy: "Zugriffsregel",
    announcement: "Ankuendigung",
    appointment: "Termin",
    appointment_checklist: "Termin-Checkliste",
    appointment_request: "Terminanfrage",
    case: "Fall",
    concierge_service: "Concierge-Service",
    consent: "Einwilligung",
    custom_field: "Benutzerdefiniertes Feld",
    document: "Dokument",
    feedback: "Feedback",
    framework_contract: "Rahmenvertrag",
    invoice: "Rechnung",
    lead: "Lead",
    notification_channel: "Benachrichtigungskanal",
    order: "Auftrag",
    patient: "Patient",
    pending_login: "Ausstehende Anmeldung",
    privacy_request: "Datenschutzantrag",
    provider: "Anbieter",
    quote: "Angebot",
    reminder: "Erinnerung",
    security: "Sicherheit",
    session: "Sitzung",
    system_setting: "Systemeinstellung",
    task: "Aufgabe",
    user: "Benutzer",
    workflow_checklist_item: "Workflow-Checkliste",
  },
  ru: {
    access_policy: "Правило доступа",
    announcement: "Объявление",
    appointment: "Приём",
    appointment_checklist: "Чек-лист приёма",
    appointment_request: "Запрос на приём",
    case: "Кейс",
    concierge_service: "Консьерж-сервис",
    consent: "Согласие",
    custom_field: "Пользовательское поле",
    document: "Документ",
    feedback: "Отзыв",
    framework_contract: "Рамочный договор",
    invoice: "Счёт",
    lead: "Лид",
    notification_channel: "Канал уведомлений",
    order: "Заказ",
    patient: "Пациент",
    pending_login: "Ожидающий вход",
    privacy_request: "Запрос приватности",
    provider: "Провайдер",
    quote: "Предложение",
    reminder: "Напоминание",
    security: "Безопасность",
    session: "Сессия",
    system_setting: "Системная настройка",
    task: "Задача",
    user: "Пользователь",
    workflow_checklist_item: "Чек-лист workflow",
  },
} as const;

const ACTIVITY_EVENT_LABELS = {
  de: {
    activated: "aktiviert",
    added: "hinzugefuegt",
    approved: "genehmigt",
    assigned: "zugewiesen",
    assignment_revoked: "Zuweisung widerrufen",
    billing_ready: "abrechnungsbereit",
    cancelled: "abgesagt",
    completed: "abgeschlossen",
    confirmed: "bestaetigt",
    converted: "konvertiert",
    created: "erstellt",
    deactivated: "deaktiviert",
    debt_management_updated: "Debt-Management aktualisiert",
    deleted: "geloescht",
    doctor_created: "Arzt erstellt",
    doctor_deleted: "Arzt geloescht",
    doctor_updated: "Arzt aktualisiert",
    dunning_created: "Mahnung erstellt",
    executed: "ausgefuehrt",
    execution_flow_updated: "Ausfuehrung aktualisiert",
    external_invoice_created: "externe Rechnung erstellt",
    external_invoice_overdue: "externe Rechnung ueberfaellig",
    external_invoice_updated: "externe Rechnung aktualisiert",
    failed_resolved: "Fehlschlag geklaert",
    followup_flow_updated: "Nachsorge aktualisiert",
    force_password_reset: "Passwort-Reset erzwungen",
    generated: "erzeugt",
    granted: "erteilt",
    ip_whitelist_added: "IP-Freigabe hinzugefuegt",
    ip_whitelist_deleted: "IP-Freigabe geloescht",
    leistung_added: "Leistung hinzugefuegt",
    leistung_approved: "Leistung genehmigt",
    maintenance_toggled: "Wartung umgeschaltet",
    medication_expiry_confirmed: "Medikamentenablauf bestaetigt",
    medication_expiry_flagged: "Medikamentenablauf markiert",
    mfa_toggled: "MFA umgeschaltet",
    overdue_marked: "ueberfaellig markiert",
    password_reset: "Passwort zurueckgesetzt",
    payment_proof_uploaded: "Zahlungsnachweis hochgeladen",
    phase_changed: "Phase geaendert",
    planning_preparation_updated: "Planung aktualisiert",
    portal_released: "im Portal freigegeben",
    portal_revoked: "Portalfreigabe widerrufen",
    process_gates_updated: "Prozess-Gates aktualisiert",
    rejected: "abgelehnt",
    reset: "zurueckgesetzt",
    reviewed: "geprueft",
    revoked: "widerrufen",
    revoked_all: "alle widerrufen",
    service_created: "Service erstellt",
    service_deleted: "Service geloescht",
    service_updated: "Service aktualisiert",
    status_changed: "Status geaendert",
    submitted: "eingereicht",
    translation_requested: "Uebersetzung angefragt",
    translation_updated: "Uebersetzung aktualisiert",
    unlocked: "entsperrt",
    updated: "aktualisiert",
    uploaded: "hochgeladen",
  },
  ru: {
    activated: "активирован",
    added: "добавлено",
    approved: "одобрен",
    assigned: "назначен",
    assignment_revoked: "назначение отозвано",
    billing_ready: "готово к биллингу",
    cancelled: "отменён",
    completed: "завершён",
    confirmed: "подтверждён",
    converted: "конвертирован",
    created: "создан",
    deactivated: "деактивирован",
    debt_management_updated: "debt-management обновлён",
    deleted: "удалён",
    doctor_created: "врач создан",
    doctor_deleted: "врач удалён",
    doctor_updated: "врач обновлён",
    dunning_created: "напоминание об оплате создано",
    executed: "исполнен",
    execution_flow_updated: "исполнение обновлено",
    external_invoice_created: "внешний счёт создан",
    external_invoice_overdue: "внешний счёт просрочен",
    external_invoice_updated: "внешний счёт обновлён",
    failed_resolved: "ошибка закрыта",
    followup_flow_updated: "follow-up обновлён",
    force_password_reset: "сброс пароля принудительно",
    generated: "сгенерирован",
    granted: "выдан",
    ip_whitelist_added: "IP добавлен в whitelist",
    ip_whitelist_deleted: "IP удалён из whitelist",
    leistung_added: "услуга добавлена",
    leistung_approved: "услуга одобрена",
    maintenance_toggled: "режим обслуживания переключён",
    medication_expiry_confirmed: "срок препарата подтверждён",
    medication_expiry_flagged: "срок препарата отмечен",
    mfa_toggled: "MFA переключена",
    overdue_marked: "помечен просроченным",
    password_reset: "пароль сброшен",
    payment_proof_uploaded: "подтверждение оплаты загружено",
    phase_changed: "фаза изменена",
    planning_preparation_updated: "планирование обновлено",
    portal_released: "опубликован в портале",
    portal_revoked: "публикация в портале отозвана",
    process_gates_updated: "process gates обновлены",
    rejected: "отклонён",
    reset: "сброшен",
    reviewed: "проверен",
    revoked: "отозван",
    revoked_all: "все отозваны",
    service_created: "сервис создан",
    service_deleted: "сервис удалён",
    service_updated: "сервис обновлён",
    status_changed: "статус изменён",
    submitted: "отправлен",
    translation_requested: "перевод запрошен",
    translation_updated: "перевод обновлён",
    unlocked: "разблокирован",
    updated: "обновлён",
    uploaded: "загружен",
  },
} as const;

function actionLabel(action: string, translations: UnknownTranslations, lang: Lang): string {
  const exactLabels = EXACT_ACTION_LABELS[lang] as Record<string, string>;
  const exact = exactLabels[action];
  if (exact) return exact;

  const [entityKey, eventKey] = action.split(".");
  const entityLabel = (ACTIVITY_ENTITY_LABELS[lang] as Record<string, string>)[entityKey ?? ""];
  const eventLabel = (ACTIVITY_EVENT_LABELS[lang] as Record<string, string>)[eventKey ?? ""];
  if (entityLabel && eventLabel) {
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

function entityTypeLabel(entityType: string | null, translations: UnknownTranslations, lang: Lang): string {
  if (!entityType) return translations.common_not_set;
  return (ACTIVITY_ENTITY_LABELS[lang] as Record<string, string>)[entityType] ?? formatUnknownValue(entityType, translations);
}

function entityDisplay(
  entityType: string | null,
  entityId: unknown,
  translations: UnknownTranslations,
  lang: Lang,
): string {
  let idStr = "";
  if (typeof entityId === "string") {
    idStr = entityId.slice(0, 8);
  } else if (entityId != null) {
    idStr = String(entityId).slice(0, 8);
  }

  const entity = entityTypeLabel(entityType, translations, lang);
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
          {actionLabel(activity.action, t, lang)}
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
          {entityDisplay(activity.entity_type, activity.entity_id, t, lang)}
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
                  {actionLabel(value, t, lang)}
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
            description={`${metrics.loginCount} ${actionLabel("login", t, lang)}`}
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
            title={selectedActivity ? actionLabel(selectedActivity.action, t, lang) : t.activity_details}
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
                          {actionLabel(selectedActivity.action, t, lang)}
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5">
                      <p className="text-[11.5px] text-muted-foreground">{t.activity_entity}</p>
                      <p className="mt-1 text-sm font-medium text-foreground">
                        {entityDisplay(selectedActivity.entity_type, selectedActivity.entity_id, t, lang) || "-"}
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
