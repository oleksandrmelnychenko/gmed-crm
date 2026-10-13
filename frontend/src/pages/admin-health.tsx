import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type SetStateAction,
  type ReactNode,
} from "react";
import {
  Activity,
  Database,
  FileStack,
  RefreshCcw,
  UsersRound,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminSectionTitle,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { AiMark } from "@/components/ui/ai-mark";
import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { useLang } from "@/lib/i18n";
import { formatAdminDateTime } from "@/pages/admin-pages.helpers";
import { fetchAdminHealth } from "@/pages/admin/data/admin-api";
import {
  Banner,
  EmptyCell,
  PageHeader,
  TabLoader,
} from "@/components/ui-shell";

function HealthSection({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <AdminSectionTitle>{title}</AdminSectionTitle>
        {actions}
      </header>
      <div className="min-w-0 space-y-4 p-3 sm:p-4">{children}</div>
    </section>
  );
}

function HealthMetric({
  label,
  value,
  description,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border/60 bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.03em] text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : null}
      </div>
      <div className="mt-2 break-words font-mono text-lg font-semibold tabular-nums">
        {value}
      </div>
      {description ? (
        <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </article>
  );
}

function healthStatusTone(status: string): StatusChipTone {
  if (status === "healthy" || status === "ready") return "success";
  if (status === "attention" || status === "blocked") return "warning";
  if (status === "unavailable") return "error";
  return "neutral";
}

interface HealthData {
  database: {
    size: string;
    active_connections: number;
    tables: { table: string; size: string }[];
  };
  users: {
    total: number;
    active: number;
    locked: number;
  };
  sessions: {
    active: number;
    pending_mfa: number;
  };
  data: {
    patients: number;
    leads: number;
    orders: number;
    audit_entries: number;
  };
  medication_ai: {
    provider: {
      kind: "none" | "openai";
      status: "not_configured" | "disabled" | "blocked" | "ready";
      external_calls_enabled: boolean;
      reason_code: string;
      model: string | null;
    };
    operational_status:
      | "not_configured"
      | "disabled"
      | "blocked"
      | "healthy"
      | "attention"
      | "unavailable";
    queue: {
      available: boolean;
      total: number;
      requested: number;
      processing: number;
      ready: number;
      failed: number;
      stale_processing: number;
      ready_last_24h: number;
      failed_last_24h: number;
      lease_recovered_last_24h: number;
      lease_exhausted_last_24h: number;
      oldest_requested_seconds: number | null;
      last_ready_at: string | null;
      last_failed_at: string | null;
      last_lease_recovery_at: string | null;
      last_lease_exhausted_at: string | null;
    };
  };
  clinical_imports: ClinicalImportHealth;
}

/** Clinical document parser queue (admin_security.rs load_clinical_import_health). */
export interface ClinicalImportHealth {
  available: boolean;
  operational_status: "healthy" | "attention" | "unavailable";
  queued: number;
  processing: number;
  stale_processing: number;
  retried_processing: number;
  stale_applying: number;
  failed_last_24h: number;
  attempts_exhausted_last_24h: number;
  oldest_queued_seconds: number | null;
  max_attempts: number;
}

const DEFAULT_CLINICAL_IMPORT_HEALTH: ClinicalImportHealth = {
  available: false,
  operational_status: "unavailable",
  queued: 0,
  processing: 0,
  stale_processing: 0,
  retried_processing: 0,
  stale_applying: 0,
  failed_last_24h: 0,
  attempts_exhausted_last_24h: 0,
  oldest_queued_seconds: null,
  max_attempts: 3,
};

/** Defaults every field, for servers that do not send the section yet. */
export function normalizeClinicalImportHealth(
  value: Partial<ClinicalImportHealth> | null | undefined,
): ClinicalImportHealth {
  return { ...DEFAULT_CLINICAL_IMPORT_HEALTH, ...(value ?? {}) };
}

export function clinicalImportHealthCopy(lang: "ru" | "de") {
  return lang === "de"
    ? {
        section: "Klinischer Dokumentimport",
        healthy: "Stabil",
        attention: "Prüfung erforderlich",
        unavailable: "Nicht verfügbar",
        queue: "Warteschlange",
        queued: "Wartend",
        processing: "In Verarbeitung",
        oldestQueued: "Ältester Auftrag wartet seit",
        stale: "Verarbeitung hängt",
        retried: "Wiederholte Versuche",
        staleApplying: "Übernahme abgebrochen",
        staleApplyingHint:
          "Im Import öffnen und abschließen oder mit Begründung aufgeben",
        failed24h: "Fehlgeschlagen (24 h)",
        exhausted24h: "Versuche erschöpft (24 h)",
        exhaustedHint: (max: number) => `nach ${max} Versuchen`,
      }
    : {
        section: "Импорт клинических документов",
        healthy: "Стабильно",
        attention: "Требует проверки",
        unavailable: "Недоступно",
        queue: "Очередь",
        queued: "Ожидают",
        processing: "Обрабатываются",
        oldestQueued: "Самый старый запрос ждёт",
        stale: "Обработка зависла",
        retried: "Повторные попытки",
        staleApplying: "Применение прервано",
        staleApplyingHint:
          "Откройте импорт и завершите его или закройте с причиной",
        failed24h: "Ошибки (24 ч)",
        exhausted24h: "Попытки исчерпаны (24 ч)",
        exhaustedHint: (max: number) => `после ${max} попыток`,
      };
}

/** Attention items of the clinical import queue for the page banner. */
export function clinicalImportAttention(
  health: ClinicalImportHealth,
  copy: ReturnType<typeof clinicalImportHealthCopy>,
  age: (seconds: number | null) => string,
): string[] {
  const items: string[] = [];
  if (health.operational_status === "unavailable")
    items.push(`${copy.section}: ${copy.unavailable}`);
  if (health.stale_processing > 0)
    items.push(`${copy.section} · ${copy.stale}: ${health.stale_processing}`);
  if (health.stale_applying > 0)
    items.push(
      `${copy.section} · ${copy.staleApplying}: ${health.stale_applying}`,
    );
  if (health.failed_last_24h > 0)
    items.push(
      `${copy.section} · ${copy.failed24h}: ${health.failed_last_24h}`,
    );
  if ((health.oldest_queued_seconds ?? 0) > 300) {
    items.push(
      `${copy.section} · ${copy.oldestQueued}: ${age(health.oldest_queued_seconds)}`,
    );
  }
  return items;
}

const DEFAULT_MEDICATION_AI_HEALTH: HealthData["medication_ai"] = {
  provider: {
    kind: "none",
    status: "not_configured",
    external_calls_enabled: false,
    reason_code: "not_configured",
    model: null,
  },
  operational_status: "not_configured",
  queue: {
    available: false,
    total: 0,
    requested: 0,
    processing: 0,
    ready: 0,
    failed: 0,
    stale_processing: 0,
    ready_last_24h: 0,
    failed_last_24h: 0,
    lease_recovered_last_24h: 0,
    lease_exhausted_last_24h: 0,
    oldest_requested_seconds: null,
    last_ready_at: null,
    last_failed_at: null,
    last_lease_recovery_at: null,
    last_lease_exhausted_at: null,
  },
};

type MedicationAiHealthPayload = Partial<
  Omit<HealthData["medication_ai"], "provider" | "queue">
> & {
  provider?: Partial<HealthData["medication_ai"]["provider"]>;
  queue?: Partial<HealthData["medication_ai"]["queue"]>;
};

export function normalizeMedicationAiHealth(
  value: MedicationAiHealthPayload | null | undefined,
): HealthData["medication_ai"] {
  if (!value) return DEFAULT_MEDICATION_AI_HEALTH;
  return {
    ...DEFAULT_MEDICATION_AI_HEALTH,
    ...value,
    provider: {
      ...DEFAULT_MEDICATION_AI_HEALTH.provider,
      ...value.provider,
    },
    queue: {
      ...DEFAULT_MEDICATION_AI_HEALTH.queue,
      ...value.queue,
    },
  };
}

function normalizeHealthData(payload: HealthData): HealthData {
  return {
    ...payload,
    medication_ai: normalizeMedicationAiHealth(payload.medication_ai),
    clinical_imports: normalizeClinicalImportHealth(payload.clinical_imports),
  };
}

type HealthDetailPanel = "database" | "access" | "data" | "ai";

type AiHealthCopy = ReturnType<typeof aiHealthCopy>;

export function aiHealthCopy(lang: "ru" | "de") {
  return lang === "de"
    ? {
        section: "KI-Betrieb",
        provider: "Anbieterstatus",
        reason: "Konfigurationshinweis",
        operational: "Betriebsstatus",
        queue: "Aktive Warteschlange",
        requested: "Wartend",
        processing: "In Verarbeitung",
        ready: "Gespeichert",
        failed: "Fehlgeschlagen",
        stale: "Abgelaufene Leases",
        ready24h: "Bereit in 24 Std.",
        failed24h: "Fehler in 24 Std.",
        leaseRecovered24h: "Lease-Recoveries in 24 Std.",
        leaseExhausted24h: "Lease-Abbrüche in 24 Std.",
        oldest: "Ältester wartender Auftrag",
        lastReady: "Letztes Ergebnis",
        lastFailed: "Letzter Fehler",
        lastLeaseRecovery: "Letzte Lease-Recovery",
        lastLeaseExhausted: "Letzter Lease-Abbruch",
        model: "Freigegebenes Modell",
        externalCalls: "Externe Aufrufe",
        enabled: "Aktiv",
        disabled: "Aus",
        noModel: "Nicht festgelegt",
        noTimestamp: "Keine Ereignisse",
        privacy:
          "Es werden weder API-Schlüssel noch Patienten- oder Antwortinhalte angezeigt.",
        attentionFailed: "KI-Aufträge mit Fehlern in den letzten 24 Stunden",
        attentionStale: "KI-Aufträge mit abgelaufener Verarbeitungssperre",
        attentionLeaseRecovered:
          "KI-Aufträge nach abgelaufener Lease wieder eingeplant",
        attentionLeaseExhausted:
          "KI-Aufträge nach Lease-Ablauf endgültig fehlgeschlagen",
        attentionDelayed: "KI-Aufträge warten länger als zwei Minuten",
        attentionBlocked: "Der konfigurierte KI-Anbieter ist blockiert",
        attentionUnavailable:
          "Der KI-Warteschlangenstatus konnte nicht gelesen werden",
        statuses: {
          not_configured: "Nicht konfiguriert",
          disabled: "Deaktiviert",
          blocked: "Blockiert",
          ready: "Bereit",
          healthy: "Stabil",
          attention: "Prüfung erforderlich",
          unavailable: "Nicht verfügbar",
        },
        reasons: {
          external_provider_not_configured:
            "Externer Anbieter nicht konfiguriert",
          external_provider_disabled: "Administrativ deaktiviert",
          data_transfer_not_approved: "Datenübertragung nicht freigegeben",
          api_key_missing: "Server-Schlüssel fehlt",
          model_missing: "Freigegebenes Modell fehlt",
          client_initialization_failed:
            "Sicherer HTTP-Client konnte nicht gestartet werden",
          ready: "Konfiguration vollständig",
        },
      }
    : {
        section: "AI-контур",
        provider: "Состояние провайдера",
        reason: "Состояние конфигурации",
        operational: "Операционное состояние",
        queue: "Активная очередь",
        requested: "Ожидают",
        processing: "Обрабатываются",
        ready: "Сохранены",
        failed: "Завершились ошибкой",
        stale: "Просроченные блокировки обработки",
        ready24h: "Готовы за 24 часа",
        failed24h: "Ошибки за 24 часа",
        leaseRecovered24h: "Восстановлены после lease за 24 часа",
        leaseExhausted24h: "Исчерпали lease-попытки за 24 часа",
        oldest: "Самая старая ожидающая задача",
        lastReady: "Последний результат",
        lastFailed: "Последняя ошибка",
        lastLeaseRecovery: "Последнее восстановление lease",
        lastLeaseExhausted: "Последнее исчерпание lease",
        model: "Разрешённая модель",
        externalCalls: "Внешние вызовы",
        enabled: "Включены",
        disabled: "Выключены",
        noModel: "Не задана",
        noTimestamp: "Событий ещё нет",
        privacy:
          "API-ключи, данные пациентов и содержимое ответов здесь не отображаются.",
        attentionFailed: "AI-задачи с ошибками за последние 24 часа",
        attentionStale: "AI-задачи с просроченной блокировкой обработки",
        attentionLeaseRecovered:
          "AI-задачи повторно поставлены в очередь после истечения lease",
        attentionLeaseExhausted:
          "AI-задачи завершились ошибкой после исчерпания lease-попыток",
        attentionDelayed: "AI-задачи ожидают обработки больше двух минут",
        attentionBlocked: "Настроенный AI-провайдер заблокирован",
        attentionUnavailable: "Не удалось прочитать состояние AI-очереди",
        statuses: {
          not_configured: "Не настроен",
          disabled: "Отключён",
          blocked: "Заблокирован",
          ready: "Готов",
          healthy: "Стабильно",
          attention: "Требует проверки",
          unavailable: "Недоступно",
        },
        reasons: {
          external_provider_not_configured: "Внешний провайдер не настроен",
          external_provider_disabled: "Отключён администратором",
          data_transfer_not_approved: "Передача данных не согласована",
          api_key_missing: "Нет серверного ключа",
          model_missing: "Не задана разрешённая модель",
          client_initialization_failed:
            "Не удалось запустить безопасный HTTP-клиент",
          ready: "Конфигурация завершена",
        },
      };
}

export function aiStatusLabel(status: string, copy: AiHealthCopy) {
  return (
    copy.statuses[status as keyof typeof copy.statuses] ??
    copy.statuses.unavailable
  );
}

export function aiReasonLabel(reason: string, copy: AiHealthCopy) {
  return (
    copy.reasons[reason as keyof typeof copy.reasons] ??
    copy.statuses.unavailable
  );
}

export function aiLeaseAttention(
  recoveredLast24h: number,
  exhaustedLast24h: number,
  copy: AiHealthCopy,
) {
  const attention: string[] = [];
  if (recoveredLast24h > 0) {
    attention.push(`${copy.attentionLeaseRecovered}: ${recoveredLast24h}`);
  }
  if (exhaustedLast24h > 0) {
    attention.push(`${copy.attentionLeaseExhausted}: ${exhaustedLast24h}`);
  }
  return attention;
}

function aiQueueAge(seconds: number | null, lang: "ru" | "de") {
  if (seconds == null) return "—";
  if (seconds < 60) return lang === "de" ? "< 1 Min." : "< 1 мин.";
  if (seconds < 3_600)
    return `${Math.floor(seconds / 60)} ${lang === "de" ? "Min." : "мин."}`;
  return `${Math.floor(seconds / 3_600)} ${lang === "de" ? "Std." : "ч."}`;
}

function aiEventTimestamp(
  value: string | null,
  lang: "ru" | "de",
  copy: AiHealthCopy,
) {
  if (!value) return copy.noTimestamp;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? copy.noTimestamp
    : formatAdminDateTime(parsed, lang);
}

type AdminHealthState = {
  data: HealthData | null;
  loading: boolean;
  error: string;
  refreshedAt: Date | null;
  detailPanel: HealthDetailPanel | null;
};

type AdminHealthPatch =
  | Partial<AdminHealthState>
  | ((current: AdminHealthState) => Partial<AdminHealthState>);

function adminHealthReducer(
  current: AdminHealthState,
  patch: AdminHealthPatch,
): AdminHealthState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveAdminHealthStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createAdminHealthFieldPatch<K extends keyof AdminHealthState>(
  field: K,
  nextValue: SetStateAction<AdminHealthState[K]>,
): AdminHealthPatch {
  return (current) =>
    ({
      [field]: resolveAdminHealthStateAction(nextValue, current[field]),
    }) as Partial<AdminHealthState>;
}

type AdminHealthDetailMeta = {
  title: string;
  description: string;
};

type AdminHealthDetailSheetProps = {
  data: HealthData | null;
  detailMeta: AdminHealthDetailMeta | null;
  detailPanel: HealthDetailPanel | null;
  t: Record<string, string>;
  aiCopy: AiHealthCopy;
  lang: "ru" | "de";
  onDetailPanelChange: (value: HealthDetailPanel | null) => void;
};

function AdminHealthDetailSheet({
  data,
  detailMeta,
  detailPanel,
  t,
  aiCopy,
  lang,
  onDetailPanelChange,
}: AdminHealthDetailSheetProps) {
  return (
    <Dialog
      open={Boolean(detailPanel && data)}
      onOpenChange={(open) => !open && onDetailPanelChange(null)}
    >
      {data && detailPanel && detailMeta ? (
        <AdminDialogScaffold
          title={detailMeta.title}
          description={detailMeta.description}
          maxWidthClassName="sm:w-[calc(100vw-2rem)] sm:max-w-[800px]"
          footer={
            <div className="flex justify-end px-4 py-3">
              <Button
                variant="outline"
                className="h-8 text-xs"
                onClick={() => onDetailPanelChange(null)}
              >
                {t.common_close}
              </Button>
            </div>
          }
        >
          {detailPanel === "database" ? (
            <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
              <AdminSectionTitle>{t.health_section_database}</AdminSectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t.health_db_size}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.database.size}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t.health_connections}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.database.active_connections}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {data.database.tables.map((table) => (
                  <div
                    key={table.table}
                    className="flex items-center justify-between rounded-lg border border-border/50 bg-background px-3 py-2"
                  >
                    <span className="text-sm font-medium text-foreground">
                      {table.table}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {table.size}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {detailPanel === "access" ? (
            <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
              <AdminSectionTitle>{t.health_section_access}</AdminSectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t.health_users_total}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.users.total}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t.health_users_active}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.users.active}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t.health_users_locked}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.users.locked}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {t.health_sessions_active}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.sessions.active}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <StatusChip
                  tone={data.sessions.pending_mfa > 0 ? "warning" : "neutral"}
                >
                  {t.health_mfa_pending}: {data.sessions.pending_mfa}
                </StatusChip>
                <StatusChip tone={data.users.locked > 0 ? "error" : "neutral"}>
                  {t.health_users_locked}: {data.users.locked}
                </StatusChip>
              </div>
            </section>
          ) : null}

          {detailPanel === "data" ? (
            <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
              <AdminSectionTitle>{t.health_section_data}</AdminSectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {t.patients_title}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.data.patients}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {t.nav_crm}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.data.leads}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {t.orders_title}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.data.orders}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {t.activity_title}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.data.audit_entries}
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          {detailPanel === "ai" ? (
            <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
              <div className="flex items-center gap-2">
                <AiMark className="size-4 text-foreground" />
                <AdminSectionTitle>{aiCopy.section}</AdminSectionTitle>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.provider}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {aiStatusLabel(data.medication_ai.provider.status, aiCopy)}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {aiCopy.reason}:{" "}
                    {aiReasonLabel(
                      data.medication_ai.provider.reason_code,
                      aiCopy,
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.operational}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {aiStatusLabel(
                      data.medication_ai.operational_status,
                      aiCopy,
                    )}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.model}
                  </div>
                  <div className="mt-1 truncate font-mono text-sm font-semibold">
                    {data.medication_ai.provider.model ?? aiCopy.noModel}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.externalCalls}
                  </div>
                  <div className="mt-1 text-base font-semibold">
                    {data.medication_ai.provider.external_calls_enabled
                      ? aiCopy.enabled
                      : aiCopy.disabled}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.requested}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {data.medication_ai.queue.requested}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.processing}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {data.medication_ai.queue.processing}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.stale}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {data.medication_ai.queue.stale_processing}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.leaseRecovered24h}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {data.medication_ai.queue.lease_recovered_last_24h}
                  </div>
                </div>
                <div className="rounded-lg border border-border/60 bg-background px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {aiCopy.leaseExhausted24h}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">
                    {data.medication_ai.queue.lease_exhausted_last_24h}
                  </div>
                </div>
              </div>
              <div className="space-y-2 rounded-lg border border-border/60 bg-background p-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">{aiCopy.oldest}</span>
                  <span className="font-mono text-xs">
                    {aiQueueAge(
                      data.medication_ai.queue.oldest_requested_seconds,
                      lang,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {aiCopy.lastReady}
                  </span>
                  <span className="text-right text-xs">
                    {aiEventTimestamp(
                      data.medication_ai.queue.last_ready_at,
                      lang,
                      aiCopy,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {aiCopy.lastFailed}
                  </span>
                  <span className="text-right text-xs">
                    {aiEventTimestamp(
                      data.medication_ai.queue.last_failed_at,
                      lang,
                      aiCopy,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {aiCopy.lastLeaseRecovery}
                  </span>
                  <span className="text-right text-xs">
                    {aiEventTimestamp(
                      data.medication_ai.queue.last_lease_recovery_at,
                      lang,
                      aiCopy,
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">
                    {aiCopy.lastLeaseExhausted}
                  </span>
                  <span className="text-right text-xs">
                    {aiEventTimestamp(
                      data.medication_ai.queue.last_lease_exhausted_at,
                      lang,
                      aiCopy,
                    )}
                  </span>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {aiCopy.privacy}
              </p>
            </section>
          ) : null}
        </AdminDialogScaffold>
      ) : null}
    </Dialog>
  );
}

type AdminHealthMetricsProps = {
  data: HealthData;
  datasetVolume: number;
  t: Record<string, string>;
  aiCopy: AiHealthCopy;
};

function AdminHealthMetrics({
  data,
  datasetVolume,
  t,
  aiCopy,
}: AdminHealthMetricsProps) {
  return (
    <div
      data-testid="health-metrics"
      className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-5"
    >
      <HealthMetric
        icon={Database}
        label={t.health_db_size}
        value={data.database.size}
        description={`${data.database.active_connections} ${t.health_connections}`}
      />
      <HealthMetric
        icon={UsersRound}
        label={t.health_users_active}
        value={data.users.active}
        description={`${data.users.total} ${t.health_users_total}`}
      />
      <HealthMetric
        icon={Activity}
        label={t.health_sessions_active}
        value={data.sessions.active}
        description={`${data.sessions.pending_mfa} ${t.health_mfa_pending}`}
      />
      <HealthMetric
        icon={FileStack}
        label={t.health_data}
        value={datasetVolume}
        description={`${data.data.audit_entries} ${t.health_audit_suffix}`}
      />
      <HealthMetric
        icon={AiMark}
        label={aiCopy.queue}
        value={
          data.medication_ai.queue.requested +
          data.medication_ai.queue.processing
        }
        description={aiStatusLabel(
          data.medication_ai.operational_status,
          aiCopy,
        )}
      />
    </div>
  );
}

type AdminHealthHeaderActionsProps = {
  loading: boolean;
  t: Record<string, string>;
  onRefresh: () => void;
};

function AdminHealthHeaderActions({
  loading,
  t,
  onRefresh,
}: AdminHealthHeaderActionsProps) {
  return (
    <>
      <AdminGuideButton
        title={t.health_title}
        description={t.health_subtitle}
      />
      <Button
        type="button"
        variant="outline"
        className="h-8 rounded-lg gap-1.5 bg-card px-3 text-xs"
        disabled={loading}
        onClick={onRefresh}
      >
        <RefreshCcw className="size-3.5" />
        {t.common_refresh}
      </Button>
    </>
  );
}

export function AdminHealthPage() {
  const { t, lang } = useLang();
  const aiCopy = useMemo(() => aiHealthCopy(lang), [lang]);
  const importCopy = useMemo(() => clinicalImportHealthCopy(lang), [lang]);
  const [adminHealthState, dispatchAdminHealthState] = useReducer(
    adminHealthReducer,
    undefined,
    (): AdminHealthState => ({
      data: null,
      loading: true,
      error: "",
      refreshedAt: null,
      detailPanel: null,
    }),
  );
  const { data, loading, error, refreshedAt, detailPanel } = adminHealthState;
  const databaseTables = useMemo(() => data?.database.tables ?? [], [data]);
  const databaseTablesPagination = useDataTablePagination(
    databaseTables,
    String(databaseTables.length),
  );
  const setAdminHealthField = <K extends keyof AdminHealthState>(
    field: K,
    nextValue: SetStateAction<AdminHealthState[K]>,
  ) => dispatchAdminHealthState(createAdminHealthFieldPatch(field, nextValue));
  const setData = (nextValue: SetStateAction<HealthData | null>) =>
    setAdminHealthField("data", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setAdminHealthField("loading", nextValue);
  const setError = (nextValue: SetStateAction<string>) =>
    setAdminHealthField("error", nextValue);
  const setRefreshedAt = (nextValue: SetStateAction<Date | null>) =>
    setAdminHealthField("refreshedAt", nextValue);
  const setDetailPanel = (
    nextValue: SetStateAction<HealthDetailPanel | null>,
  ) => setAdminHealthField("detailPanel", nextValue);

  const databaseTableColumns = useMemo<
    ColumnDef<{ table: string; size: string }>[]
  >(
    () => [
      {
        id: "table",
        label: t.health_col_table,
        accessor: (table) => table.table,
        sortable: true,
        width: 260,
        render: (table) => (
          <span className="text-foreground">{table.table}</span>
        ),
      },
      {
        id: "size",
        label: t.health_col_size,
        accessor: (table) => table.size,
        sortable: true,
        width: 180,
        render: (table) => (
          <span className="font-mono text-xs text-foreground">
            {table.size}
          </span>
        ),
      },
    ],
    [t.health_col_size, t.health_col_table],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await fetchAdminHealth<HealthData>();
      setData(normalizeHealthData(payload));
      setRefreshedAt(new Date());
    } catch {
      setError(t.common_error);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  const operationalAttention = useMemo(() => {
    if (!data) return [];
    const attention: string[] = [];
    if (data.users.locked > 0) {
      attention.push(`${t.health_users_locked}: ${data.users.locked}`);
    }
    if (data.sessions.pending_mfa > 0) {
      attention.push(`${t.health_mfa_pending}: ${data.sessions.pending_mfa}`);
    }
    if (data.medication_ai.operational_status === "blocked") {
      attention.push(aiCopy.attentionBlocked);
    }
    if (data.medication_ai.operational_status === "unavailable") {
      attention.push(aiCopy.attentionUnavailable);
    }
    if (data.medication_ai.queue.stale_processing > 0) {
      attention.push(
        `${aiCopy.attentionStale}: ${data.medication_ai.queue.stale_processing}`,
      );
    }
    if (data.medication_ai.queue.failed_last_24h > 0) {
      attention.push(
        `${aiCopy.attentionFailed}: ${data.medication_ai.queue.failed_last_24h}`,
      );
    }
    attention.push(
      ...aiLeaseAttention(
        data.medication_ai.queue.lease_recovered_last_24h,
        data.medication_ai.queue.lease_exhausted_last_24h,
        aiCopy,
      ),
    );
    if ((data.medication_ai.queue.oldest_requested_seconds ?? 0) > 120) {
      attention.push(
        `${aiCopy.attentionDelayed}: ${aiQueueAge(data.medication_ai.queue.oldest_requested_seconds, lang)}`,
      );
    }
    attention.push(
      ...clinicalImportAttention(data.clinical_imports, importCopy, (seconds) =>
        aiQueueAge(seconds, lang),
      ),
    );
    return attention;
  }, [
    aiCopy,
    data,
    importCopy,
    lang,
    t.health_mfa_pending,
    t.health_users_locked,
  ]);

  const datasetVolume = data
    ? data.data.patients + data.data.leads + data.data.orders
    : 0;

  const detailMeta = useMemo(() => {
    if (!data || !detailPanel) {
      return null;
    }

    if (detailPanel === "database") {
      return {
        title: t.health_section_database,
        description: `${t.health_db_size}: ${data.database.size}`,
      };
    }

    if (detailPanel === "access") {
      return {
        title: t.health_section_access,
        description: `${t.health_sessions_active}: ${data.sessions.active}`,
      };
    }

    if (detailPanel === "ai") {
      return {
        title: aiCopy.section,
        description: `${aiCopy.operational}: ${aiStatusLabel(data.medication_ai.operational_status, aiCopy)}`,
      };
    }

    return {
      title: t.health_section_data,
      description: `${t.health_data}: ${datasetVolume}`,
    };
  }, [
    data,
    aiCopy,
    datasetVolume,
    detailPanel,
    t.health_data,
    t.health_db_size,
    t.health_section_access,
    t.health_section_data,
    t.health_section_database,
    t.health_sessions_active,
  ]);

  return (
    <div
      data-testid="health-workspace"
      className="min-w-0 space-y-4 rounded-xl bg-muted p-3 sm:p-4"
    >
      <PageHeader
        title={t.health_title}
        description={
          refreshedAt
            ? `${t.health_subtitle} - ${t.common_last_updated}: ${formatAdminDateTime(refreshedAt, lang)}`
            : t.health_subtitle
        }
        actions={
          <AdminHealthHeaderActions
            loading={loading}
            t={t as unknown as Record<string, string>}
            onRefresh={() => void load()}
          />
        }
      />

      {loading ? <TabLoader /> : null}
      {!loading && error ? <Banner tone="error">{error}</Banner> : null}

      {!loading && data ? (
        <>
          <AdminHealthMetrics
            data={data}
            datasetVolume={datasetVolume}
            t={t as unknown as Record<string, string>}
            aiCopy={aiCopy}
          />

          {operationalAttention.length > 0 ? (
            <Banner tone="warning" withIcon>
              <div className="space-y-1">
                <div className="font-medium">{t.health_attention}</div>
                {operationalAttention.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            </Banner>
          ) : null}

          <HealthSection
            title={t.health_section_database}
            actions={
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => setDetailPanel("database")}
              >
                {t.activity_details}
                <ChevronRight className="size-3.5" />
              </Button>
            }
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <HealthMetric
                label={t.health_db_size}
                value={data.database.size}
                description={`${data.database.active_connections} ${t.health_connections}`}
              />
              <HealthMetric
                label={t.health_tables}
                value={data.database.tables.length}
                description={t.common_monitoring}
              />
              <HealthMetric
                label={t.common_last_updated}
                value={
                  refreshedAt ? formatAdminDateTime(refreshedAt, lang) : "-"
                }
                description={t.health_title}
              />
            </div>

            <AdminTableCard
              title={t.health_tables}
              description={t.health_subtitle}
              count={data.database.tables.length}
            >
              {data.database.tables.length === 0 ? (
                <div className="p-4">
                  <EmptyCell>{t.health_tables}</EmptyCell>
                </div>
              ) : (
                <DataTableSurface
                  rows={databaseTablesPagination.pagedRows}
                  columns={databaseTableColumns}
                  defaultDensity="comfortable"
                  dictionary={t as unknown as Record<string, string>}
                  rowId={(table) => table.table}
                  toolbarAfter={
                    <DataTablePager
                      pageIndex={databaseTablesPagination.pageIndex}
                      pageSize={databaseTablesPagination.pageSize}
                      totalPages={databaseTablesPagination.totalPages}
                      totalRows={databaseTablesPagination.totalRows}
                      previousLabel={t.pagination_previous}
                      nextLabel={t.pagination_next}
                      onPageChange={databaseTablesPagination.onPageChange}
                    />
                  }
                />
              )}
            </AdminTableCard>
          </HealthSection>

          <HealthSection
            title={t.health_section_access}
            actions={
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => setDetailPanel("access")}
              >
                {t.activity_details}
                <ChevronRight className="size-3.5" />
              </Button>
            }
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <HealthMetric
                label={t.health_users_total}
                value={data.users.total}
                description={t.health_title}
              />
              <HealthMetric
                label={t.health_users_active}
                value={data.users.active}
                description={t.users_status}
              />
              <HealthMetric
                label={t.health_users_locked}
                value={data.users.locked}
                description={t.security_title}
              />
              <HealthMetric
                label={t.health_mfa_pending}
                value={data.sessions.pending_mfa}
                description={t.settings_active_sessions}
              />
            </div>
          </HealthSection>

          <HealthSection
            title={t.health_section_data}
            actions={
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => setDetailPanel("data")}
              >
                {t.activity_details}
                <ChevronRight className="size-3.5" />
              </Button>
            }
          >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <HealthMetric
                label={t.patients_title}
                value={data.data.patients}
                description={t.health_data}
              />
              <HealthMetric
                label={t.nav_crm}
                value={data.data.leads}
                description={t.health_data}
              />
              <HealthMetric
                label={t.orders_title}
                value={data.data.orders}
                description={t.health_data}
              />
              <HealthMetric
                label={t.activity_title}
                value={data.data.audit_entries}
                description={t.health_audit_suffix}
              />
            </div>
          </HealthSection>

          <HealthSection
            title={aiCopy.section}
            actions={
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1 text-xs"
                onClick={() => setDetailPanel("ai")}
              >
                {t.activity_details}
                <ChevronRight className="size-3.5" />
              </Button>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <AiMark className="size-4 text-foreground" />
              <StatusChip
                tone={healthStatusTone(data.medication_ai.operational_status)}
              >
                {aiStatusLabel(data.medication_ai.operational_status, aiCopy)}
              </StatusChip>
              <span className="text-xs text-muted-foreground">
                {aiCopy.privacy}
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <HealthMetric
                label={aiCopy.provider}
                value={
                  <StatusChip
                    tone={healthStatusTone(data.medication_ai.provider.status)}
                  >
                    {aiStatusLabel(data.medication_ai.provider.status, aiCopy)}
                  </StatusChip>
                }
                description={
                  data.medication_ai.provider.status === "ready"
                    ? (data.medication_ai.provider.model ?? aiCopy.noModel)
                    : aiReasonLabel(
                        data.medication_ai.provider.reason_code,
                        aiCopy,
                      )
                }
              />
              <HealthMetric
                label={aiCopy.queue}
                value={
                  data.medication_ai.queue.requested +
                  data.medication_ai.queue.processing
                }
                description={`${aiCopy.requested}: ${data.medication_ai.queue.requested} · ${aiCopy.processing}: ${data.medication_ai.queue.processing}`}
              />
              <HealthMetric
                label={aiCopy.ready24h}
                value={data.medication_ai.queue.ready_last_24h}
                description={`${aiCopy.ready}: ${data.medication_ai.queue.ready}`}
              />
              <HealthMetric
                label={aiCopy.failed24h}
                value={data.medication_ai.queue.failed_last_24h}
                description={`${aiCopy.stale}: ${data.medication_ai.queue.stale_processing}`}
              />
              <HealthMetric
                label={aiCopy.leaseRecovered24h}
                value={data.medication_ai.queue.lease_recovered_last_24h}
                description={aiEventTimestamp(
                  data.medication_ai.queue.last_lease_recovery_at,
                  lang,
                  aiCopy,
                )}
              />
              <HealthMetric
                label={aiCopy.leaseExhausted24h}
                value={data.medication_ai.queue.lease_exhausted_last_24h}
                description={aiEventTimestamp(
                  data.medication_ai.queue.last_lease_exhausted_at,
                  lang,
                  aiCopy,
                )}
              />
            </div>
          </HealthSection>

          <HealthSection title={importCopy.section}>
            <StatusChip
              tone={healthStatusTone(data.clinical_imports.operational_status)}
            >
              {importCopy[data.clinical_imports.operational_status]}
            </StatusChip>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <HealthMetric
                label={importCopy.queue}
                value={
                  data.clinical_imports.queued +
                  data.clinical_imports.processing
                }
                description={`${importCopy.queued}: ${data.clinical_imports.queued} · ${importCopy.processing}: ${data.clinical_imports.processing} · ${importCopy.oldestQueued}: ${aiQueueAge(data.clinical_imports.oldest_queued_seconds, lang)}`}
              />
              <HealthMetric
                label={importCopy.stale}
                value={data.clinical_imports.stale_processing}
                description={`${importCopy.retried}: ${data.clinical_imports.retried_processing}`}
              />
              <HealthMetric
                label={importCopy.staleApplying}
                value={data.clinical_imports.stale_applying}
                description={importCopy.staleApplyingHint}
              />
              <HealthMetric
                label={importCopy.failed24h}
                value={data.clinical_imports.failed_last_24h}
                description={`${importCopy.exhausted24h}: ${data.clinical_imports.attempts_exhausted_last_24h} (${importCopy.exhaustedHint(data.clinical_imports.max_attempts)})`}
              />
            </div>
          </HealthSection>
        </>
      ) : null}

      {!loading && !error && !data ? (
        <HealthSection title={t.health_title}>
          <EmptyCell>{t.health_subtitle}</EmptyCell>
        </HealthSection>
      ) : null}

      <AdminHealthDetailSheet
        data={data}
        detailMeta={detailMeta}
        detailPanel={detailPanel}
        t={t as unknown as Record<string, string>}
        aiCopy={aiCopy}
        lang={lang}
        onDetailPanelChange={setDetailPanel}
      />
    </div>
  );
}
