import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Globe,
  LoaderCircle,
  Plus,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import {
  formatEnumLabelFromKeys,
  useLang,
  type TranslationKey,
  type Translations,
} from "@/lib/i18n";
import { actionLabel, entityTypeLabel } from "@/pages/admin-activity";
import {
  formatAdminDateTime,
  normalizeAdminSettingValue,
  shortAdminUserAgent,
} from "@/pages/admin-pages.helpers";
import {
  Banner,
  EmptyCell,
  Field,
  PageHeader,
  SuccessBanner,
  TabLoader,
  textareaClass,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { clearApiCache } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  createIpWhitelistEntry,
  deleteIpWhitelistEntry,
  fetchAdminSecurityWorkspace,
  saveAdminMaintenance,
} from "@/pages/admin/data/admin-api";

function SecuritySection({
  id,
  title,
  description,
  count,
  actions,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="min-w-0 scroll-mt-4 overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AdminSectionTitle>{title}</AdminSectionTitle>
            {count != null ? (
              <StatusChip className="font-mono tabular-nums">
                {count}
              </StatusChip>
            ) : null}
          </div>
          {description ? (
            <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </header>
      <div className="min-w-0 space-y-4 p-3 sm:p-4">{children}</div>
    </section>
  );
}

function SecurityMetric({
  label,
  value,
  description,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  description?: string;
  icon?: LucideIcon;
  tone?: StatusChipTone;
}) {
  return (
    <article className="min-w-0 rounded-xl border border-border/70 bg-card p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words font-mono text-[10.5px] font-medium uppercase leading-4 tracking-[0.03em] text-muted-foreground">
          {label}
        </p>
        {Icon ? (
          <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        ) : null}
      </div>
      <div className="mt-2 min-w-0">
        {typeof value === "number" ? (
          <span
            className={cn(
              "font-mono text-xl font-semibold tabular-nums",
              tone === "error"
                ? "text-destructive"
                : tone === "warning"
                  ? "text-amber-700"
                  : "text-foreground",
            )}
          >
            {value}
          </span>
        ) : (
          <StatusChip tone={tone}>{value}</StatusChip>
        )}
      </div>
      {description ? (
        <p className="mt-1.5 break-words text-[11px] leading-4 text-muted-foreground">
          {description}
        </p>
      ) : null}
    </article>
  );
}

function SecurityDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer: ReactNode;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdminDialogScaffold
        title={title}
        description={description}
        onSubmit={onSubmit}
        maxWidthClassName="sm:w-[calc(100vw-2rem)] sm:max-w-[640px]"
        footer={
          <div className="flex flex-wrap justify-end gap-2 px-4 py-3">
            {footer}
          </div>
        }
      >
        {children}
      </AdminDialogScaffold>
    </Dialog>
  );
}

interface IpEntry {
  id: string;
  cidr: string;
  description: string | null;
  is_active: boolean;
}

interface GeoLogin {
  user_name: string;
  user_email: string;
  ip_address: string | null;
  user_agent: string | null;
  geo_data: unknown;
  created_at: string;
  is_revoked: boolean;
}

interface AuditAnalyticsSummary {
  failed_logins_24h: number;
  blocked_logins_24h: number;
  token_theft_30d: number;
  executive_sensitive_access_7d: number;
  off_hours_sensitive_access_7d: number;
}

interface AuditAnalyticsEvent {
  id: number;
  /** `null` for anonymous attempts and, without full access, portal logins. */
  user_name: string | null;
  user_role: string | null;
  action: string;
  entity_type: string;
  /** Stable code of `reason`; older servers send only the English text. */
  reason_code?: string | null;
  reason: string;
  /** HTTP method of `route` (sign-in events: the sign-in endpoint, QA E2-06). */
  method?: string | null;
  route: string | null;
  status: number | null;
  ip_hash: string | null;
  created_at: string;
}

interface AuditAnalyticsReader {
  /** `null` for the anonymous row of portal logins (QA E2-01). */
  user_id: string | null;
  user_name: string | null;
  user_role: string;
  event_count: number;
  distinct_entities: number;
}

/** "POST /api/v1/auth/login", or "—" when the event has no request. */
export function securityEventRoute(
  event: Pick<AuditAnalyticsEvent, "method" | "route">,
): string {
  if (!event.route) return "—";
  return event.method ? `${event.method} ${event.route}` : event.route;
}

/** Name of the actor; portal logins and anonymous attempts get a neutral label. */
export function securityActorName(
  actor: { user_name: string | null; user_role: string | null },
  t: Translations,
): string {
  if (actor.user_name) return actor.user_name;
  return actor.user_role === "patient"
    ? t.activity_portal_actor
    : t.security_anonymous;
}

/** One-word status of a sign-in session: "Отозвана" / "Активна", never a plural (QA E2-06). */
export function securitySessionStatus(
  isRevoked: boolean,
  t: Translations,
): string {
  return isRevoked
    ? t.uiText.security_session_revoked
    : t.uiText.security_session_active;
}

interface AuditAnalyticsPayload {
  summary: AuditAnalyticsSummary;
  recent_suspicious_events: AuditAnalyticsEvent[];
  top_sensitive_readers: AuditAnalyticsReader[];
}

type FlashState =
  | { tone: "success"; text: string }
  | { tone: "error"; text: string }
  | null;

type AdminSecurityState = {
  ips: IpEntry[];
  geo: GeoLogin[];
  auditAnalytics: AuditAnalyticsPayload | null;
  loading: boolean;
  error: string;
  flash: FlashState;
  deleteBusyId: string;
  maintEnabled: boolean;
  maintMsg: string;
  maintDraftMsg: string;
  maintOpen: boolean;
  maintBusy: boolean;
  maintError: string;
  ipOpen: boolean;
  ipBusy: boolean;
  ipError: string;
  newCidr: string;
  newDesc: string;
};

type AdminSecurityPatch =
  | Partial<AdminSecurityState>
  | ((current: AdminSecurityState) => Partial<AdminSecurityState>);

function adminSecurityReducer(
  state: AdminSecurityState,
  patch: AdminSecurityPatch,
): AdminSecurityState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createAdminSecurityFieldPatch<K extends keyof AdminSecurityState>(
  field: K,
  value: SetStateAction<AdminSecurityState[K]>,
): AdminSecurityPatch {
  return (current) => {
    const nextValue =
      typeof value === "function"
        ? (value as (previous: AdminSecurityState[K]) => AdminSecurityState[K])(
            current[field],
          )
        : value;

    return { [field]: nextValue } as Partial<AdminSecurityState>;
  };
}

const ADMIN_SECURITY_REALTIME_EVENTS = [
  "security.ip_whitelist_added",
  "security.ip_whitelist_deleted",
  "system_setting.updated",
  "system_setting.maintenance_toggled",
  "session.revoked",
  "session.revoked_all",
  "pending_login.approved",
  "pending_login.rejected",
  "user.unlocked",
  "user.force_password_reset",
  "user.mfa_toggled",
] as const;

const ROLE_LABEL_KEYS = {
  ceo: "role_ceo",
  ceo_assistant: "role_ceo_assistant",
  patient_manager: "role_patient_manager",
  teamlead_interpreter: "role_teamlead_interpreter",
  interpreter: "role_interpreter",
  concierge: "role_concierge",
  billing: "role_billing",
  sales: "role_sales",
  it_admin: "role_it_admin",
  patient: "role_patient",
} as const satisfies Partial<Record<string, TranslationKey>>;

const SECURITY_REASON_LABEL_KEYS = {
  token_theft: "security_reason_token_theft",
  login_blocked: "security_reason_login_blocked",
  login_failure: "security_reason_login_failure",
  revoked_session_refresh: "security_reason_revoked_session_refresh",
  executive_access: "security_reason_executive_access",
  off_hours_read: "security_reason_off_hours_read",
} as const satisfies Partial<Record<string, TranslationKey>>;

/** English reasons of servers that do not send `reason_code` yet. */
const LEGACY_SECURITY_REASON_CODES: Record<
  string,
  keyof typeof SECURITY_REASON_LABEL_KEYS
> = {
  "Refresh token theft detected": "token_theft",
  "Blocked login attempt": "login_blocked",
  "Failed login attempt": "login_failure",
  "Refresh attempted on revoked session family": "revoked_session_refresh",
  "Executive access to sensitive communication surface": "executive_access",
  "Off-hours sensitive read": "off_hours_read",
};

/** The seeded default of `maintenance_message`, shown in the UI language. */
const DEFAULT_MAINTENANCE_MESSAGE = "System maintenance in progress";

export function securityReasonLabel(
  event: Pick<AuditAnalyticsEvent, "reason" | "reason_code">,
  t: Translations,
): string {
  const code = event.reason_code ?? LEGACY_SECURITY_REASON_CODES[event.reason];
  const key = code
    ? SECURITY_REASON_LABEL_KEYS[
        code as keyof typeof SECURITY_REASON_LABEL_KEYS
      ]
    : undefined;
  return key ? t[key] : event.reason;
}

/** The custom maintenance message, or "" while the seeded default is set. */
export function customMaintenanceMessage(message: string): string {
  const trimmed = message.trim();
  return trimmed === DEFAULT_MAINTENANCE_MESSAGE ? "" : trimmed;
}

function useAdminSecurityPageContent() {
  const { t, lang } = useLang();
  const [securityState, dispatchSecurityState] = useReducer(
    adminSecurityReducer,
    undefined,
    (): AdminSecurityState => ({
      ips: [],
      geo: [],
      auditAnalytics: null,
      loading: true,
      error: "",
      flash: null,
      deleteBusyId: "",
      maintEnabled: false,
      maintMsg: "",
      maintDraftMsg: "",
      maintOpen: false,
      maintBusy: false,
      maintError: "",
      ipOpen: false,
      ipBusy: false,
      ipError: "",
      newCidr: "",
      newDesc: "",
    }),
  );
  const {
    ips,
    geo,
    auditAnalytics,
    loading,
    error,
    flash,
    deleteBusyId,
    maintEnabled,
    maintMsg,
    maintDraftMsg,
    maintOpen,
    maintBusy,
    maintError,
    ipOpen,
    ipBusy,
    ipError,
    newCidr,
    newDesc,
  } = securityState;
  const setSecurityField = <K extends keyof AdminSecurityState>(
    field: K,
    value: SetStateAction<AdminSecurityState[K]>,
  ) => dispatchSecurityState(createAdminSecurityFieldPatch(field, value));
  const setIps = (value: SetStateAction<IpEntry[]>) =>
    setSecurityField("ips", value);
  const setGeo = (value: SetStateAction<GeoLogin[]>) =>
    setSecurityField("geo", value);
  const setAuditAnalytics = (
    value: SetStateAction<AuditAnalyticsPayload | null>,
  ) => setSecurityField("auditAnalytics", value);
  const setLoading = (value: SetStateAction<boolean>) =>
    setSecurityField("loading", value);
  const setError = (value: SetStateAction<string>) =>
    setSecurityField("error", value);
  const setFlash = (value: SetStateAction<FlashState>) =>
    setSecurityField("flash", value);
  const setDeleteBusyId = (value: SetStateAction<string>) =>
    setSecurityField("deleteBusyId", value);
  const setMaintEnabled = (value: SetStateAction<boolean>) =>
    setSecurityField("maintEnabled", value);
  const setMaintMsg = (value: SetStateAction<string>) =>
    setSecurityField("maintMsg", value);
  const setMaintDraftMsg = (value: SetStateAction<string>) =>
    setSecurityField("maintDraftMsg", value);
  const setMaintOpen = (value: SetStateAction<boolean>) =>
    setSecurityField("maintOpen", value);
  const setMaintBusy = (value: SetStateAction<boolean>) =>
    setSecurityField("maintBusy", value);
  const setMaintError = (value: SetStateAction<string>) =>
    setSecurityField("maintError", value);
  const setIpOpen = (value: SetStateAction<boolean>) =>
    setSecurityField("ipOpen", value);
  const setIpBusy = (value: SetStateAction<boolean>) =>
    setSecurityField("ipBusy", value);
  const setIpError = (value: SetStateAction<string>) =>
    setSecurityField("ipError", value);
  const setNewCidr = (value: SetStateAction<string>) =>
    setSecurityField("newCidr", value);
  const setNewDesc = (value: SetStateAction<string>) =>
    setSecurityField("newDesc", value);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { ipList, geoList, analyticsPayload, settings } =
        await fetchAdminSecurityWorkspace<
          IpEntry,
          GeoLogin,
          AuditAnalyticsPayload
        >();

      setIps(ipList);
      setGeo(geoList);
      setAuditAnalytics(analyticsPayload);

      const maintenanceMode = settings.find(
        (row) => row.key === "maintenance_mode",
      );
      const maintenanceMessage = settings.find(
        (row) => row.key === "maintenance_message",
      );
      setMaintEnabled(
        normalizeAdminSettingValue(maintenanceMode?.value) === "true",
      );
      setMaintMsg(
        customMaintenanceMessage(
          normalizeAdminSettingValue(maintenanceMessage?.value),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeSubscription(ADMIN_SECURITY_REALTIME_EVENTS, () => {
    clearApiCache("/admin/ip-whitelist");
    clearApiCache("/admin/login-geo");
    clearApiCache("/admin/audit-analytics");
    clearApiCache("/admin/settings");
    clearApiCache("/admin/sessions");
    clearApiCache("/admin/mfa/pending");
    void load();
  });

  const metrics = useMemo(
    () => ({
      suspicious: auditAnalytics?.recent_suspicious_events.length ?? 0,
    }),
    [auditAnalytics],
  );
  const suspiciousEvents = useMemo(
    () => auditAnalytics?.recent_suspicious_events ?? [],
    [auditAnalytics],
  );
  const suspiciousEventsPagination = useDataTablePagination(
    suspiciousEvents,
    String(suspiciousEvents.length),
  );
  const ipRegistryPagination = useDataTablePagination(ips, String(ips.length));
  const loginHistoryPagination = useDataTablePagination(
    geo,
    String(geo.length),
  );

  function openMaintenanceSheet() {
    setMaintDraftMsg(maintMsg);
    setMaintError("");
    setMaintOpen(true);
  }

  function closeMaintenanceSheet(open: boolean) {
    setMaintOpen(open);
    if (!open) {
      setMaintDraftMsg(maintMsg);
      setMaintError("");
      setMaintBusy(false);
    }
  }

  function closeIpSheet(open: boolean) {
    setIpOpen(open);
    if (!open) {
      setNewCidr("");
      setNewDesc("");
      setIpError("");
      setIpBusy(false);
    }
  }

  async function saveMaintenance(enabled: boolean) {
    if (
      enabled &&
      !maintEnabled &&
      !window.confirm(t.security_maintenance_hint)
    ) {
      return;
    }

    setMaintBusy(true);
    setMaintError("");
    setFlash(null);

    try {
      await saveAdminMaintenance({
        enabled,
        message: maintDraftMsg.trim() || null,
      });
      closeMaintenanceSheet(false);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (submitError) {
      setMaintError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setMaintBusy(false);
    }
  }

  async function addIp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newCidr.trim()) return;

    setIpBusy(true);
    setIpError("");
    setFlash(null);
    try {
      await createIpWhitelistEntry({
        cidr: newCidr.trim(),
        description: newDesc.trim() || null,
      });
      closeIpSheet(false);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (submitError) {
      setIpError(
        submitError instanceof Error ? submitError.message : t.common_error,
      );
    } finally {
      setIpBusy(false);
    }
  }

  const deleteIp = useCallback(
    async (id: string) => {
      setDeleteBusyId(id);
      setFlash(null);
      try {
        await deleteIpWhitelistEntry(id);
        await load();
      } catch (deleteError) {
        setFlash({
          tone: "error",
          text:
            deleteError instanceof Error ? deleteError.message : t.common_error,
        });
      } finally {
        setDeleteBusyId("");
      }
    },
    [load, t.common_error],
  );

  const roleLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ROLE_LABEL_KEYS, t),
    [t],
  );
  const securityActionLabel = useCallback(
    (value: string | null | undefined) => actionLabel(value ?? "", t),
    [t],
  );
  const securityEntityLabel = useCallback(
    (value: string | null | undefined) => entityTypeLabel(value ?? null, t),
    [t],
  );

  const suspiciousEventColumns = useMemo<ColumnDef<AuditAnalyticsEvent>[]>(
    () => [
      {
        id: "created_at",
        label: t.activity_time,
        accessor: (event) => event.created_at,
        sortable: true,
        width: 170,
        render: (event) => (
          <span className="font-mono text-xs text-foreground">
            {formatAdminDateTime(event.created_at, lang)}
          </span>
        ),
      },
      {
        id: "user",
        label: t.activity_user,
        accessor: (event) =>
          `${event.user_name ?? ""} ${event.user_role ?? ""}`,
        sortable: true,
        width: 220,
        render: (event) => (
          <div className="min-w-0">
            <div className="text-xs text-foreground">
              {securityActorName(event, t)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {event.user_role
                ? roleLabel(event.user_role)
                : securityActionLabel(event.action)}
            </div>
          </div>
        ),
      },
      {
        id: "reason",
        label: t.security_col_reason,
        accessor: (event) => securityReasonLabel(event, t),
        sortable: true,
        width: 260,
        render: (event) => {
          const reason = securityReasonLabel(event, t);
          const action = securityActionLabel(event.action);
          // The action is named only when it says more than the reason.
          return (
            <div className="min-w-0">
              <div className="truncate text-xs text-foreground">{reason}</div>
              <div className="text-xs text-muted-foreground">
                {action === reason
                  ? securityEntityLabel(event.entity_type)
                  : `${securityEntityLabel(event.entity_type)} · ${action}`}
              </div>
            </div>
          );
        },
      },
      {
        id: "route",
        label: t.security_col_route,
        accessor: (event) => securityEventRoute(event),
        sortable: true,
        width: 240,
        render: (event) => (
          <span
            className="truncate font-mono text-xs text-foreground"
            title={securityEventRoute(event)}
          >
            {securityEventRoute(event)}
          </span>
        ),
      },
      {
        id: "ip",
        label: t.common_ip,
        accessor: (event) => event.ip_hash ?? "",
        sortable: true,
        width: 140,
        render: (event) => (
          <span className="font-mono text-xs text-foreground">
            {event.ip_hash ?? "-"}
          </span>
        ),
      },
    ],
    [lang, t, roleLabel, securityActionLabel, securityEntityLabel],
  );

  const readerColumns = useMemo<ColumnDef<AuditAnalyticsReader>[]>(
    () => [
      {
        id: "user",
        label: t.activity_user,
        accessor: (reader) => securityActorName(reader, t),
        sortable: true,
        width: 220,
        render: (reader) => (
          <div className="min-w-0">
            <div className="text-xs text-foreground">
              {securityActorName(reader, t)}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {roleLabel(reader.user_role)}
            </div>
          </div>
        ),
      },
      {
        id: "event_count",
        label: t.security_col_events,
        accessor: (reader) => reader.event_count,
        sortable: true,
        width: 120,
        render: (reader) => (
          <span className="tabular-nums">{reader.event_count}</span>
        ),
      },
      {
        id: "distinct_entities",
        label: t.security_col_distinct_entities,
        accessor: (reader) => reader.distinct_entities,
        sortable: true,
        width: 160,
        render: (reader) => (
          <span className="tabular-nums">{reader.distinct_entities}</span>
        ),
      },
    ],
    [roleLabel, t],
  );

  const ipColumns = useMemo<ColumnDef<IpEntry>[]>(
    () => [
      {
        id: "cidr",
        label: t.security_col_cidr,
        accessor: (ip) => ip.cidr,
        sortable: true,
        width: 220,
        render: (ip) => (
          <span className="font-mono text-xs text-foreground">{ip.cidr}</span>
        ),
      },
      {
        id: "description",
        label: t.security_ip_desc,
        accessor: (ip) => ip.description ?? "",
        sortable: true,
        width: 280,
        render: (ip) => (
          <span className="truncate text-xs text-foreground">
            {ip.description || "-"}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (ip) => ip.is_active,
        sortable: true,
        width: 140,
        render: (ip) => (
          <StatusChip tone={ip.is_active ? "success" : "neutral"}>
            {ip.is_active ? t.common_active : t.common_inactive}
          </StatusChip>
        ),
      },
      {
        id: "actions",
        label: t.users_actions,
        accessor: (ip) => ip.id,
        width: 160,
        render: (ip) => {
          const busy = deleteBusyId === ip.id;
          return (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 rounded-lg border-destructive/20 bg-card px-2.5 text-xs text-destructive hover:bg-destructive/10"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void deleteIp(ip.id);
              }}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t.common_delete}
            </Button>
          );
        },
      },
    ],
    [
      deleteBusyId,
      deleteIp,
      t.common_active,
      t.common_delete,
      t.common_inactive,
      t.security_col_cidr,
      t.security_ip_desc,
      t.users_actions,
      t.users_status,
    ],
  );

  const geoColumns = useMemo<ColumnDef<GeoLogin>[]>(
    () => [
      {
        id: "created_at",
        label: t.activity_time,
        accessor: (entry) => entry.created_at,
        sortable: true,
        width: 170,
        render: (entry) => (
          <span className="font-mono text-xs text-foreground">
            {formatAdminDateTime(entry.created_at, lang)}
          </span>
        ),
      },
      {
        id: "user",
        label: t.activity_user,
        accessor: (entry) => `${entry.user_name} ${entry.user_email}`,
        sortable: true,
        width: 240,
        render: (entry) => (
          <div className="min-w-0">
            <div className="text-xs text-foreground">{entry.user_name}</div>
            <div
              className="mt-0.5 truncate text-[11px] text-muted-foreground"
              title={entry.user_email}
            >
              {entry.user_email}
            </div>
          </div>
        ),
      },
      {
        id: "ip",
        label: t.common_ip,
        accessor: (entry) => entry.ip_address ?? "",
        sortable: true,
        width: 140,
        render: (entry) => (
          <span className="font-mono text-xs text-foreground">
            {entry.ip_address ?? "-"}
          </span>
        ),
      },
      {
        id: "device",
        label: t.common_device,
        accessor: (entry) => shortAdminUserAgent(entry.user_agent),
        sortable: true,
        width: 260,
        render: (entry) => (
          <span
            className="truncate text-xs text-foreground"
            title={entry.user_agent ?? ""}
          >
            {shortAdminUserAgent(entry.user_agent)}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (entry) => entry.is_revoked,
        sortable: true,
        width: 140,
        render: (entry) => (
          <StatusChip tone={entry.is_revoked ? "error" : "success"}>
            {securitySessionStatus(entry.is_revoked, t)}
          </StatusChip>
        ),
      },
    ],
    [lang, t],
  );

  return (
    <>
      <div
        className="min-w-0 space-y-4 rounded-xl bg-muted p-3 sm:p-4"
        data-testid="security-workspace"
      >
        <PageHeader
          title={t.security_title}
          actions={
            <>
              <AdminGuideButton
                title={t.security_title}
                description={t.security_subtitle}
              />
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1.5 rounded-lg bg-card px-3 text-xs"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCcw
                  className={cn("size-3.5", loading && "animate-spin")}
                />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 gap-1.5 rounded-lg bg-card px-3 text-xs"
                onClick={openMaintenanceSheet}
              >
                <ShieldAlert className="size-3.5" />
                {t.security_maintenance}
              </Button>
              <Button
                type="button"
                className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                onClick={() => setIpOpen(true)}
              >
                <Plus className="size-3.5" />
                {t.security_ip_add}
              </Button>
            </>
          }
        />
        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}
        {flash ? (
          flash.tone === "error" ? (
            <Banner tone="error">{flash.text}</Banner>
          ) : (
            <SuccessBanner>{flash.text}</SuccessBanner>
          )
        ) : null}
        {!loading && !error ? (
          <>
            <div
              className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-4"
              data-testid="security-metrics"
            >
              <SecurityMetric
                icon={ShieldCheck}
                tone={maintEnabled ? "warning" : "success"}
                label={t.security_maintenance}
                value={maintEnabled ? t.common_active : t.common_inactive}
              />
              <SecurityMetric
                icon={Waypoints}
                label={t.security_ip_whitelist}
                value={ips.length}
                description={t.common_registry}
              />
              <SecurityMetric
                icon={ShieldX}
                tone={metrics.suspicious > 0 ? "warning" : "neutral"}
                label={t.security_audit_recent}
                value={metrics.suspicious}
                description={t.security_audit_recent_scope}
              />
              <SecurityMetric
                icon={Globe}
                label={t.security_login_history}
                value={geo.length}
                description={t.security_login_history_scope}
              />
            </div>

            <SecuritySection
              title={t.security_maintenance}
              actions={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg bg-card text-xs"
                  onClick={openMaintenanceSheet}
                >
                  {t.common_edit}
                </Button>
              }
            >
              <div className="flex flex-wrap items-start gap-3">
                <StatusChip tone={maintEnabled ? "warning" : "success"}>
                  <ShieldCheck aria-hidden />
                  {maintEnabled ? t.common_active : t.common_inactive}
                </StatusChip>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.03em] text-muted-foreground">
                    {t.security_maintenance_msg}
                  </p>
                  <p className="break-words text-xs leading-5 text-foreground">
                    {maintMsg || t.security_maintenance_default_msg}
                  </p>
                </div>
              </div>
              {maintEnabled ? (
                <Banner tone="warning" withIcon>
                  {t.security_maintenance_hint}
                </Banner>
              ) : null}
            </SecuritySection>

            <div className="min-w-0 space-y-3">
              <div className="space-y-1 px-1">
                <AdminSectionTitle>
                  {t.security_audit_analytics}
                </AdminSectionTitle>
                <p className="max-w-4xl text-xs leading-5 text-muted-foreground">
                  {t.security_audit_hint}
                </p>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2 xl:grid-cols-5">
                <SecurityMetric
                  label={t.security_audit_failed_logins}
                  value={auditAnalytics?.summary.failed_logins_24h ?? 0}
                  tone={
                    (auditAnalytics?.summary.failed_logins_24h ?? 0) > 0
                      ? "warning"
                      : "neutral"
                  }
                />
                <SecurityMetric
                  label={t.security_audit_blocked_logins}
                  value={auditAnalytics?.summary.blocked_logins_24h ?? 0}
                  tone={
                    (auditAnalytics?.summary.blocked_logins_24h ?? 0) > 0
                      ? "warning"
                      : "neutral"
                  }
                />
                <SecurityMetric
                  label={t.security_audit_token_theft}
                  value={auditAnalytics?.summary.token_theft_30d ?? 0}
                  tone={
                    (auditAnalytics?.summary.token_theft_30d ?? 0) > 0
                      ? "error"
                      : "neutral"
                  }
                />
                <SecurityMetric
                  label={t.security_audit_executive_access}
                  value={
                    auditAnalytics?.summary.executive_sensitive_access_7d ?? 0
                  }
                />
                <SecurityMetric
                  label={t.security_audit_off_hours}
                  value={
                    auditAnalytics?.summary.off_hours_sensitive_access_7d ?? 0
                  }
                  tone={
                    (auditAnalytics?.summary.off_hours_sensitive_access_7d ??
                      0) > 0
                      ? "warning"
                      : "neutral"
                  }
                />
              </div>
              <SecuritySection
                title={t.security_audit_recent}
                count={suspiciousEvents.length}
              >
                {suspiciousEvents.length ? (
                  <DataTableSurface
                    rows={suspiciousEventsPagination.pagedRows}
                    columns={suspiciousEventColumns}
                    defaultDensity="comfortable"
                    defaultSort={[{ field: "created_at", dir: "desc" }]}
                    dictionary={t as unknown as Record<string, string>}
                    rowId={(event) => String(event.id)}
                    toolbarAfter={
                      <DataTablePager
                        pageIndex={suspiciousEventsPagination.pageIndex}
                        pageSize={suspiciousEventsPagination.pageSize}
                        totalPages={suspiciousEventsPagination.totalPages}
                        totalRows={suspiciousEventsPagination.totalRows}
                        previousLabel={t.pagination_previous}
                        nextLabel={t.pagination_next}
                        onPageChange={suspiciousEventsPagination.onPageChange}
                      />
                    }
                  />
                ) : (
                  <div className="px-1 py-3">
                    <EmptyCell>{t.security_no_suspicious}</EmptyCell>
                  </div>
                )}
              </SecuritySection>
              <SecuritySection
                title={t.security_audit_top_readers}
                count={auditAnalytics?.top_sensitive_readers.length ?? 0}
              >
                {auditAnalytics?.top_sensitive_readers.length ? (
                  <DataTableSurface
                    rows={auditAnalytics.top_sensitive_readers}
                    columns={readerColumns}
                    defaultDensity="comfortable"
                    defaultSort={[{ field: "event_count", dir: "desc" }]}
                    dictionary={t as unknown as Record<string, string>}
                    rowId={(reader) =>
                      reader.user_id ?? "anonymous-" + reader.user_role
                    }
                  />
                ) : (
                  <div className="px-1 py-3">
                    <EmptyCell>{t.security_no_outlier_readers}</EmptyCell>
                  </div>
                )}
              </SecuritySection>
            </div>

            <SecuritySection
              title={t.security_ip_whitelist}
              description={t.security_ip_add_hint}
              count={ips.length}
              actions={
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg px-3 text-xs"
                  onClick={() => setIpOpen(true)}
                >
                  <Plus className="size-3.5" />
                  {t.security_ip_add}
                </Button>
              }
            >
              {ips.length ? (
                <DataTableSurface
                  rows={ipRegistryPagination.pagedRows}
                  columns={ipColumns}
                  defaultDensity="comfortable"
                  dictionary={t as unknown as Record<string, string>}
                  rowId={(ip) => ip.id}
                  toolbarAfter={
                    <DataTablePager
                      pageIndex={ipRegistryPagination.pageIndex}
                      pageSize={ipRegistryPagination.pageSize}
                      totalPages={ipRegistryPagination.totalPages}
                      totalRows={ipRegistryPagination.totalRows}
                      previousLabel={t.pagination_previous}
                      nextLabel={t.pagination_next}
                      onPageChange={ipRegistryPagination.onPageChange}
                    />
                  }
                />
              ) : (
                <div className="px-1 py-3">
                  <EmptyCell>{t.security_ip_none}</EmptyCell>
                </div>
              )}
            </SecuritySection>

            <SecuritySection
              title={t.security_login_history}
              description={t.security_login_history_scope}
              count={geo.length}
            >
              {geo.length ? (
                <DataTableSurface
                  rows={loginHistoryPagination.pagedRows}
                  columns={geoColumns}
                  defaultDensity="comfortable"
                  defaultSort={[{ field: "created_at", dir: "desc" }]}
                  dictionary={t as unknown as Record<string, string>}
                  rowId={(entry) =>
                    entry.user_email +
                    "-" +
                    entry.created_at +
                    "-" +
                    (entry.ip_address ?? "")
                  }
                  toolbarAfter={
                    <DataTablePager
                      pageIndex={loginHistoryPagination.pageIndex}
                      pageSize={loginHistoryPagination.pageSize}
                      totalPages={loginHistoryPagination.totalPages}
                      totalRows={loginHistoryPagination.totalRows}
                      previousLabel={t.pagination_previous}
                      nextLabel={t.pagination_next}
                      onPageChange={loginHistoryPagination.onPageChange}
                    />
                  }
                />
              ) : (
                <div className="px-1 py-3">
                  <EmptyCell>{t.security_login_history}</EmptyCell>
                </div>
              )}
            </SecuritySection>
          </>
        ) : null}
      </div>

      <SecurityDialog
        open={maintOpen}
        onOpenChange={closeMaintenanceSheet}
        title={t.security_maintenance}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={() => closeMaintenanceSheet(false)}
            >
              {t.common_cancel}
            </Button>
            {maintEnabled ? (
              <Button
                type="button"
                variant="outline"
                className="h-8 rounded-lg text-xs"
                disabled={maintBusy}
                onClick={() => void saveMaintenance(false)}
              >
                {maintBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                {t.security_maintenance_off}
              </Button>
            ) : null}
            <Button
              type="button"
              variant={maintEnabled ? "default" : "destructive"}
              className="h-8 rounded-lg text-xs"
              disabled={maintBusy}
              onClick={() => void saveMaintenance(true)}
            >
              {maintBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : null}
              {maintEnabled ? t.common_save : t.security_maintenance_on}
            </Button>
          </>
        }
      >
        {maintError ? <Banner tone="error">{maintError}</Banner> : null}
        <Banner tone="warning" withIcon>
          {t.security_maintenance_hint}
        </Banner>
        <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AdminSectionTitle>{t.security_maintenance}</AdminSectionTitle>
            <StatusChip tone={maintEnabled ? "warning" : "success"}>
              {maintEnabled ? t.common_active : t.common_inactive}
            </StatusChip>
          </div>
          <Field
            label={t.security_maintenance_msg}
            htmlFor="maintenance-message"
          >
            <textarea
              id="maintenance-message"
              rows={5}
              placeholder={t.security_maintenance_default_msg}
              value={maintDraftMsg}
              onChange={(event) => setMaintDraftMsg(event.target.value)}
              className={textareaClass}
            />
          </Field>
        </section>
      </SecurityDialog>

      <SecurityDialog
        open={ipOpen}
        onOpenChange={closeIpSheet}
        title={t.security_ip_add}
        description={t.security_ip_add_hint}
        onSubmit={addIp}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg text-xs"
              onClick={() => closeIpSheet(false)}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              className="h-8 gap-1.5 rounded-lg px-3 text-xs"
              disabled={ipBusy}
            >
              {ipBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {t.security_ip_add}
            </Button>
          </>
        }
      >
        {ipError ? <Banner tone="error">{ipError}</Banner> : null}
        <section className="space-y-4 rounded-xl border border-border/60 bg-card p-3.5">
          <AdminSectionTitle>{t.security_ip_whitelist}</AdminSectionTitle>
          <Field label={t.security_ip_cidr} htmlFor="whitelist-cidr">
            <Input
              id="whitelist-cidr"
              required
              placeholder={t.security_ip_cidr_placeholder}
              value={newCidr}
              onChange={(event) => setNewCidr(event.target.value)}
              className="h-9 rounded-lg bg-field"
            />
          </Field>
          <Field label={t.security_ip_desc} htmlFor="whitelist-desc">
            <Input
              id="whitelist-desc"
              value={newDesc}
              onChange={(event) => setNewDesc(event.target.value)}
              className="h-9 rounded-lg bg-field"
            />
          </Field>
        </section>
      </SecurityDialog>
    </>
  );
}

export function AdminSecurityPage(
  ...args: Parameters<typeof useAdminSecurityPageContent>
) {
  return useAdminSecurityPageContent(...args);
}
