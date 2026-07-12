import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type SetStateAction,
} from "react";
import {
  Building2,
  KeyRound,
  LoaderCircle,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  AdminInlineMetric,
  AdminSectionTitle,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import { formatEnumLabelFromKeys, useLang, type TranslationKey } from "@/lib/i18n";
import {
  formatAdminDateTime,
  normalizeAdminSettingValue,
  shortAdminUserAgent,
  summarizeAdminSettingValue,
} from "@/pages/admin-pages.helpers";
import {
  Banner,
  EmptyCell,
  Field,
  ListItem,
  PageHeader,
  Section,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { clearApiCache } from "@/lib/api";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import {
  approvePendingMfaLogin,
  fetchAdminSettingsWorkspace,
  rejectPendingMfaLogin,
  revokeAdminUserSessions,
  revokeAllAdminSessions,
  saveAdminSetting,
} from "@/pages/admin/data/admin-api";

interface SettingRow {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

interface SessionRow {
  family_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: string;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_activity_at: string;
}

interface PendingLogin {
  id: string;
  user_name: string;
  user_email: string;
  role: string;
  ip_address: string | null;
  user_agent: string | null;
  device_info: unknown;
  created_at: string;
}

type SettingFieldMeta = {
  key: string;
  labelKey: string;
  inputType: "number" | "text" | "email" | "date" | "textarea";
  min?: number;
  rows?: number;
};

type SettingsGroupId = "tokens" | "agency" | "documents" | "clinical";

type SettingsGroup = {
  id: SettingsGroupId;
  titleKey: string;
  descriptionKey: string;
  fields: SettingFieldMeta[];
  icon: typeof KeyRound;
  tone: "sky" | "emerald" | "amber" | "slate";
};

type FlashState =
  | { tone: "success"; text: string }
  | { tone: "error"; text: string }
  | null;

const TOKEN_SETTING_FIELDS: SettingFieldMeta[] = [
  { key: "access_token_minutes", labelKey: "settings_access_token_min", inputType: "number", min: 1 },
  { key: "refresh_token_days", labelKey: "settings_refresh_token_days", inputType: "number", min: 1 },
  { key: "max_sessions_per_user", labelKey: "settings_max_sessions", inputType: "number", min: 1 },
  { key: "session_idle_days", labelKey: "settings_idle_days", inputType: "number", min: 1 },
];

const AGENCY_SETTING_FIELDS: SettingFieldMeta[] = [
  { key: "agency_name", labelKey: "settings_agency_name", inputType: "text" },
  { key: "agency_care_of", labelKey: "settings_agency_care_of", inputType: "text" },
  {
    key: "agency_principal_birth_date",
    labelKey: "settings_agency_principal_birth_date",
    inputType: "date",
  },
  { key: "agency_address", labelKey: "settings_agency_address", inputType: "textarea", rows: 3 },
  { key: "agency_phone", labelKey: "settings_agency_phone", inputType: "text" },
  { key: "agency_email", labelKey: "settings_agency_email", inputType: "email" },
  { key: "agency_privacy_email", labelKey: "settings_agency_privacy_email", inputType: "email" },
  { key: "agency_sign_place", labelKey: "settings_agency_sign_place", inputType: "text" },
  { key: "agency_data_system_name", labelKey: "settings_agency_data_system_name", inputType: "text" },
  {
    key: "agency_data_processor_notice",
    labelKey: "settings_agency_data_processor_notice",
    inputType: "textarea",
    rows: 5,
  },
  { key: "agency_bank_holder", labelKey: "settings_agency_bank_holder", inputType: "text" },
  { key: "agency_bank_name", labelKey: "settings_agency_bank_name", inputType: "text" },
  { key: "agency_bank_swift", labelKey: "settings_agency_bank_swift", inputType: "text" },
  { key: "agency_bank_iban", labelKey: "settings_agency_bank_iban", inputType: "text" },
];

const DOCUMENT_REQUIREMENT_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "required_patient_documents",
    labelKey: "settings_required_patient_documents",
    inputType: "textarea",
    rows: 12,
  },
];

const CLINICAL_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "clinical_case_retention_years",
    labelKey: "settings_clinical_retention_years",
    inputType: "number",
    min: 1,
  },
];

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "tokens",
    titleKey: "settings_token_config",
    descriptionKey: "settings_subtitle",
    fields: TOKEN_SETTING_FIELDS,
    icon: KeyRound,
    tone: "sky",
  },
  {
    id: "agency",
    titleKey: "settings_agency_profile",
    descriptionKey: "settings_agency_hint",
    fields: AGENCY_SETTING_FIELDS,
    icon: Building2,
    tone: "emerald",
  },
  {
    id: "documents",
    titleKey: "settings_document_requirements",
    descriptionKey: "settings_document_requirements_hint",
    fields: DOCUMENT_REQUIREMENT_SETTING_FIELDS,
    icon: ScrollText,
    tone: "amber",
  },
  {
    id: "clinical",
    titleKey: "settings_clinical_data",
    descriptionKey: "settings_clinical_data_hint",
    fields: CLINICAL_SETTING_FIELDS,
    icon: ShieldCheck,
    tone: "slate",
  },
];

const ADMIN_SETTINGS_REALTIME_EVENTS = [
  "system_setting.updated",
  "system_setting.maintenance_toggled",
  "session.revoked",
  "session.revoked_all",
  "pending_login.approved",
  "pending_login.rejected",
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

type AdminSettingsSheetState = {
  saving: boolean;
  error: string;
  warning: string;
};

type AdminSettingsState = {
  settings: SettingRow[];
  sessions: SessionRow[];
  pending: PendingLogin[];
  loading: boolean;
  error: string;
  flash: FlashState;
  editValues: Record<string, string>;
  selectedGroupId: SettingsGroupId | null;
  sheetState: AdminSettingsSheetState;
  actionBusyKey: string;
};

type AdminSettingsPatch =
  | Partial<AdminSettingsState>
  | ((current: AdminSettingsState) => Partial<AdminSettingsState>);

function adminSettingsReducer(
  current: AdminSettingsState,
  patch: AdminSettingsPatch,
): AdminSettingsState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveAdminSettingsStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createAdminSettingsFieldPatch<K extends keyof AdminSettingsState>(
  field: K,
  nextValue: SetStateAction<AdminSettingsState[K]>,
): AdminSettingsPatch {
  return (current) => ({
    [field]: resolveAdminSettingsStateAction(nextValue, current[field]),
  } as Partial<AdminSettingsState>);
}

function useAdminSettingsPageContent() {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [settingsState, dispatchSettingsState] = useReducer(
    adminSettingsReducer,
    undefined,
    (): AdminSettingsState => ({
      settings: [],
      sessions: [],
      pending: [],
      loading: true,
      error: "",
      flash: null,
      editValues: {},
      selectedGroupId: null,
      sheetState: {
        saving: false,
        error: "",
        warning: "",
      },
      actionBusyKey: "",
    }),
  );
  const {
    actionBusyKey,
    editValues,
    error,
    flash,
    loading,
    pending,
    selectedGroupId,
    sessions,
    settings,
    sheetState,
  } = settingsState;
  const setSettingsField = <K extends keyof AdminSettingsState>(
    field: K,
    nextValue: SetStateAction<AdminSettingsState[K]>,
  ) => dispatchSettingsState(createAdminSettingsFieldPatch(field, nextValue));
  const setSettings = (nextValue: SetStateAction<SettingRow[]>) =>
    setSettingsField("settings", nextValue);
  const setSessions = (nextValue: SetStateAction<SessionRow[]>) =>
    setSettingsField("sessions", nextValue);
  const setPending = (nextValue: SetStateAction<PendingLogin[]>) =>
    setSettingsField("pending", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setSettingsField("loading", nextValue);
  const setError = (nextValue: SetStateAction<string>) =>
    setSettingsField("error", nextValue);
  const setFlash = (nextValue: SetStateAction<FlashState>) =>
    setSettingsField("flash", nextValue);
  const setEditValues = (
    nextValue: SetStateAction<Record<string, string>>,
  ) => setSettingsField("editValues", nextValue);
  const setSelectedGroupId = (
    nextValue: SetStateAction<SettingsGroupId | null>,
  ) => setSettingsField("selectedGroupId", nextValue);
  const setSheetState = (
    nextValue: SetStateAction<AdminSettingsSheetState>,
  ) => setSettingsField("sheetState", nextValue);
  const setActionBusyKey = (nextValue: SetStateAction<string>) =>
    setSettingsField("actionBusyKey", nextValue);

  const settingsMap = useMemo(() => {
    const map: Record<string, SettingRow> = {};
    for (const row of settings) map[row.key] = row;
    return map;
  }, [settings]);

  const selectedGroup = useMemo(
    () => SETTINGS_GROUPS.find((group) => group.id === selectedGroupId) ?? null,
    [selectedGroupId],
  );
  const closeUnsavedConfirmMessage = t.common_discard_unsaved_confirm;

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { settingsRows, sessionRows, pendingRows } =
        await fetchAdminSettingsWorkspace<SettingRow, SessionRow, PendingLogin>();
      setSettings(settingsRows);
      setSessions(sessionRows);
      setPending(pendingRows);
      setEditValues(
        settingsRows.reduce<Record<string, string>>((acc, row) => {
          acc[row.key] = normalizeAdminSettingValue(row.value);
          return acc;
        }, {}),
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

  useRealtimeSubscription(ADMIN_SETTINGS_REALTIME_EVENTS, () => {
    clearApiCache("/admin/settings");
    clearApiCache("/admin/sessions");
    clearApiCache("/admin/mfa/pending");
    void load();
  });

  const accessTokenMinutes = editValues.access_token_minutes || "-";

  const closeGroupSheet = useCallback(() => {
    setSelectedGroupId(null);
    setSheetState({ saving: false, error: "", warning: "" });
    setEditValues(
      settings.reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = normalizeAdminSettingValue(row.value);
        return acc;
      }, {}),
    );
  }, [settings]);

  function updateEditValue(key: string, value: string) {
    setEditValues((current) => ({ ...current, [key]: value }));
  }

  function hasFieldChanged(key: string): boolean {
    return normalizeAdminSettingValue(settingsMap[key]?.value) !== (editValues[key] ?? "");
  }

  const roleLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ROLE_LABEL_KEYS, t),
    [t],
  );

  const groupHasChanges =
    selectedGroup?.fields.some((field) => hasFieldChanged(field.key)) ?? false;

  const handleGroupSheetOpenChange = useSheetDirtyGuard({
    isDirty: groupHasChanges,
    onClose: closeGroupSheet,
    confirmMessage: closeUnsavedConfirmMessage,
  });

  const changedFieldLabels = useMemo(() => {
    if (!selectedGroup) {
      return [];
    }
    return selectedGroup.fields.reduce<string[]>((labels, field) => {
      if (
        normalizeAdminSettingValue(settingsMap[field.key]?.value) !==
        (editValues[field.key] ?? "")
      ) {
        labels.push(tr[field.labelKey] ?? field.key);
      }
      return labels;
    }, []);
  }, [selectedGroup, tr, editValues, settingsMap]);

  function openGroupSheet(groupId: SettingsGroupId) {
    if (
      selectedGroupId &&
      selectedGroupId !== groupId &&
      groupHasChanges &&
      !window.confirm(closeUnsavedConfirmMessage)
    ) {
      return;
    }
    setSelectedGroupId(groupId);
    setSheetState({ saving: false, error: "", warning: "" });
  }

  async function saveSelectedGroup() {
    if (!selectedGroup) return;

    const changedFields = selectedGroup.fields.filter((field) => hasFieldChanged(field.key));
    if (changedFields.length === 0) {
      setSheetState((current) => ({
        ...current,
        warning: t.settings_no_changes,
        error: "",
      }));
      return;
    }

    setSheetState({ saving: true, error: "", warning: "" });
    setFlash(null);
    try {
      await Promise.all(
        changedFields.map((field) =>
          saveAdminSetting(field.key, editValues[field.key] ?? ""),
        ),
      );
      setFlash({ tone: "success", text: t.settings_updated });
      setSelectedGroupId(null);
      await load();
    } catch (saveError) {
      setSheetState({
        saving: false,
        error: saveError instanceof Error ? saveError.message : t.common_error,
        warning: "",
      });
      return;
    }
    setSheetState({ saving: false, error: "", warning: "" });
  }

  const logoutUser = useCallback(async (userId: string) => {
    setActionBusyKey(`session:${userId}`);
    setFlash(null);
    try {
      await revokeAdminUserSessions(userId);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (actionError) {
      setFlash({
        tone: "error",
        text: actionError instanceof Error ? actionError.message : t.common_error,
      });
    } finally {
      setActionBusyKey("");
    }
  }, [load, t.common_error, t.settings_updated]);

  async function logoutAll() {
    if (!window.confirm(t.settings_logout_all_confirm)) return;
    setActionBusyKey("sessions:all");
    setFlash(null);
    try {
      await revokeAllAdminSessions();
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (actionError) {
      setFlash({
        tone: "error",
        text: actionError instanceof Error ? actionError.message : t.common_error,
      });
    } finally {
      setActionBusyKey("");
    }
  }

  const approvePending = useCallback(async (id: string) => {
    setActionBusyKey(`mfa:approve:${id}`);
    setFlash(null);
    try {
      await approvePendingMfaLogin(id);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (actionError) {
      setFlash({
        tone: "error",
        text: actionError instanceof Error ? actionError.message : t.common_error,
      });
    } finally {
      setActionBusyKey("");
    }
  }, [load, t.common_error, t.settings_updated]);

  const rejectPending = useCallback(async (id: string) => {
    setActionBusyKey(`mfa:reject:${id}`);
    setFlash(null);
    try {
      await rejectPendingMfaLogin(id);
      setFlash({ tone: "success", text: t.settings_updated });
      await load();
    } catch (actionError) {
      setFlash({
        tone: "error",
        text: actionError instanceof Error ? actionError.message : t.common_error,
      });
    } finally {
      setActionBusyKey("");
    }
  }, [load, t.common_error, t.settings_updated]);

  const pendingColumns = useMemo<ColumnDef<PendingLogin>[]>(() => [
    {
      id: "name",
      label: t.field_name,
      accessor: (entry) => entry.user_name,
      sortable: true,
      width: 220,
      render: (entry) => (
        <div className="min-w-0">
          <div className="text-xs font-medium text-foreground">{entry.user_name}</div>
          <div className="text-[11px] text-muted-foreground">{roleLabel(entry.role)}</div>
        </div>
      ),
    },
    {
      id: "email",
      label: t.field_email,
      accessor: (entry) => entry.user_email,
      sortable: true,
      width: 230,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">{entry.user_email}</span>
      ),
    },
    {
      id: "ip",
      label: t.common_ip,
      accessor: (entry) => entry.ip_address ?? "",
      sortable: true,
      width: 140,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">
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
        <span className="truncate text-xs text-muted-foreground" title={entry.user_agent ?? ""}>
          {shortAdminUserAgent(entry.user_agent)}
        </span>
      ),
    },
    {
      id: "created_at",
      label: t.activity_time,
      accessor: (entry) => entry.created_at,
      sortable: true,
      width: 180,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatAdminDateTime(entry.created_at, lang)}
        </span>
      ),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (entry) => entry.id,
      width: 210,
      render: (entry) => {
        const approveBusy = actionBusyKey === `mfa:approve:${entry.id}`;
        const rejectBusy = actionBusyKey === `mfa:reject:${entry.id}`;
        return (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg"
              disabled={approveBusy || rejectBusy}
              onClick={(event) => {
                event.stopPropagation();
                void approvePending(entry.id);
              }}
            >
              {approveBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t.mfa_approve}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              className="h-8 rounded-lg"
              disabled={approveBusy || rejectBusy}
              onClick={(event) => {
                event.stopPropagation();
                void rejectPending(entry.id);
              }}
            >
              {rejectBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t.mfa_reject}
            </Button>
          </div>
        );
      },
    },
  ], [
    actionBusyKey,
    approvePending,
    lang,
    rejectPending,
    t.activity_time,
    t.common_device,
    t.common_ip,
    t.field_email,
    t.field_name,
    t.mfa_approve,
    t.mfa_reject,
    t.users_actions,
    roleLabel,
  ]);

  const sessionColumns = useMemo<ColumnDef<SessionRow>[]>(() => [
    {
      id: "name",
      label: t.field_name,
      accessor: (session) => session.user_name,
      sortable: true,
      width: 190,
      render: (session) => (
        <span className="text-xs font-medium text-foreground">{session.user_name}</span>
      ),
    },
    {
      id: "email",
      label: t.field_email,
      accessor: (session) => session.user_email,
      sortable: true,
      width: 230,
      render: (session) => (
        <span className="font-mono text-xs text-muted-foreground">{session.user_email}</span>
      ),
    },
    {
      id: "role",
      label: t.users_role,
      accessor: (session) => session.role,
      sortable: true,
      width: 130,
      render: (session) => <StatusBadge tone="neutral">{roleLabel(session.role)}</StatusBadge>,
    },
    {
      id: "ip",
      label: t.common_ip,
      accessor: (session) => session.ip_address ?? "",
      sortable: true,
      width: 140,
      render: (session) => (
        <span className="font-mono text-xs text-muted-foreground">
          {session.ip_address ?? "-"}
        </span>
      ),
    },
    {
      id: "device",
      label: t.common_device,
      accessor: (session) => shortAdminUserAgent(session.user_agent),
      sortable: true,
      width: 260,
      render: (session) => (
        <span className="truncate text-xs text-muted-foreground" title={session.user_agent ?? ""}>
          {shortAdminUserAgent(session.user_agent)}
        </span>
      ),
    },
    {
      id: "last_activity_at",
      label: t.settings_last_active,
      accessor: (session) => session.last_activity_at,
      sortable: true,
      width: 180,
      render: (session) => (
        <span className="font-mono text-xs text-muted-foreground">
          {formatAdminDateTime(session.last_activity_at, lang)}
        </span>
      ),
    },
    {
      id: "actions",
      label: t.users_actions,
      accessor: (session) => session.user_id,
      width: 170,
      render: (session) => {
        const busy = actionBusyKey === `session:${session.user_id}`;
        return (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 rounded-lg"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void logoutUser(session.user_id);
            }}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t.settings_logout_user}
          </Button>
        );
      },
    },
  ], [
    actionBusyKey,
    lang,
    logoutUser,
    t.common_device,
    t.common_ip,
    t.field_email,
    t.field_name,
    t.settings_last_active,
    t.settings_logout_user,
    t.users_actions,
    t.users_role,
    roleLabel,
  ]);

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.settings_title}
          description={t.settings_subtitle}
          actions={(
            <>
              <AdminGuideButton title={t.settings_title} description={t.settings_subtitle} />
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="h-9 rounded-lg"
                disabled={sessions.length === 0 || actionBusyKey === "sessions:all"}
                onClick={() => void logoutAll()}
              >
                {actionBusyKey === "sessions:all" ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : null}
                {t.settings_logout_all}
              </Button>
            </>
          )}
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
            <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
              <AdminInlineMetric
                icon={KeyRound}
                tone="sky"
                label={t.settings_token_config}
                value={accessTokenMinutes}
                description={t.settings_access_token_min}
              />
              <AdminInlineMetric
                icon={UsersRound}
                tone="emerald"
                label={t.settings_active_sessions}
                value={sessions.length}
                description={t.settings_sessions}
              />
              <AdminInlineMetric
                icon={ShieldCheck}
                tone={pending.length > 0 ? "amber" : "slate"}
                label={t.mfa_pending_logins}
                value={pending.length}
                description={t.security_title}
              />
              <AdminInlineMetric
                icon={Building2}
                tone="slate"
                label={t.common_configuration}
                value={settings.length}
                description={t.common_registry}
              />
            </div>

            <Section title={t.common_configuration}>
              <div className="grid gap-2.5 xl:grid-cols-2">
                {SETTINGS_GROUPS.map((group) => {
                  const Icon = group.icon;
                  return (
                    <ListItem
                      key={group.id}
                      onClick={() => {
                        openGroupSheet(group.id);
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 gap-3">
                          <span
                            className={cn(
                              "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-2xl",
                              group.tone === "sky"
                                ? "bg-sky-100 text-sky-700"
                                : group.tone === "emerald"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : group.tone === "amber"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-700",
                            )}
                          >
                            <Icon className="size-4.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[13px] font-semibold tracking-tight text-foreground">
                              {tr[group.titleKey]}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {tr[group.descriptionKey]}
                            </p>
                          </div>
                        </div>
                        <StatusBadge tone="info">{t.common_edit}</StatusBadge>
                      </div>

                      <div className="mt-2.5 grid gap-1.5 md:grid-cols-2">
                        {group.fields.map((field) => (
                          <div
                            key={field.key}
                            className="rounded-lg border border-border/50 bg-card/60 px-3 py-2.5"
                          >
                            <p className="text-[11.5px] text-muted-foreground">
                              {tr[field.labelKey] ?? field.key}
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {summarizeAdminSettingValue(field.key, editValues[field.key] ?? settingsMap[field.key]?.value ?? "")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ListItem>
                  );
                })}
              </div>
            </Section>

            <Section title={t.mfa_pending_logins}>
              <AdminTableCard
                title={t.common_monitoring}
                description={t.mfa_pending_logins}
                count={pending.length}
              >
                {pending.length === 0 ? (
                  <div className="p-4">
                    <EmptyCell>{t.mfa_no_pending}</EmptyCell>
                  </div>
                ) : (
                  <DataTableSurface
                    rows={pending}
                    columns={pendingColumns}
                    defaultDensity="comfortable"
                    defaultSort={[{ field: "created_at", dir: "desc" }]}
                    dictionary={t as unknown as Record<string, string>}
                    rowId={(entry) => entry.id}
                    tableClassName="min-h-[320px]"
                  />
                )}
              </AdminTableCard>
            </Section>

            <Section title={t.settings_active_sessions}>
              <AdminTableCard
                title={t.common_monitoring}
                description={t.settings_active_sessions}
                count={sessions.length}
                accessory={(
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={sessions.length === 0 || actionBusyKey === "sessions:all"}
                    onClick={() => void logoutAll()}
                  >
                    {actionBusyKey === "sessions:all" ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {t.settings_logout_all}
                  </Button>
                )}
              >
                {sessions.length === 0 ? (
                  <div className="p-4">
                    <EmptyCell>{t.settings_no_sessions}</EmptyCell>
                  </div>
                ) : (
                  <DataTableSurface
                    rows={sessions}
                    columns={sessionColumns}
                    defaultDensity="comfortable"
                    defaultSort={[{ field: "last_activity_at", dir: "desc" }]}
                    dictionary={t as unknown as Record<string, string>}
                    rowId={(session) => session.family_id}
                    tableClassName="min-h-[360px]"
                  />
                )}
              </AdminTableCard>
            </Section>
          </>
        ) : null}
      </div>

      <Sheet
        open={Boolean(selectedGroup)}
        onOpenChange={handleGroupSheetOpenChange}
        dirty={groupHasChanges}
      >
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[860px]">
          <AdminSheetScaffold
            title={selectedGroup ? tr[selectedGroup.titleKey] : t.settings_title}
            description={selectedGroup ? tr[selectedGroup.descriptionKey] : t.settings_subtitle}
            footer={(
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => handleGroupSheetOpenChange(false)}
                >
                  {t.common_cancel}
                </Button>
                <Button
                  type="button"
                  className="h-9 rounded-lg"
                  disabled={!selectedGroup || sheetState.saving}
                  onClick={() => void saveSelectedGroup()}
                >
                  {sheetState.saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {t.common_save}
                </Button>
              </SheetActionsFooter>
            )}
          >
            {sheetState.error ? <Banner tone="error">{sheetState.error}</Banner> : null}
            {sheetState.warning ? <Banner tone="warning">{sheetState.warning}</Banner> : null}

            {selectedGroup ? (
              <>
                <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <AdminSectionTitle>{t.admin_system_overview}</AdminSectionTitle>
                  <div className="flex items-center gap-2">
                    <StatusBadge tone={groupHasChanges ? "warning" : "neutral"}>
                      {groupHasChanges ? t.common_edit : t.common_monitoring}
                    </StatusBadge>
                  </div>

                  {changedFieldLabels.length > 0 ? (
                    <div className="rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-2.5">
                      <p className="text-xs font-medium text-amber-700">{t.common_edit}</p>
                      <p className="mt-1 text-xs text-amber-700/90">
                        {changedFieldLabels.join(" - ")}
                      </p>
                    </div>
                  ) : null}
                </section>

                <section className={cn("space-y-4 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <AdminSectionTitle>{t.admin_system_fields}</AdminSectionTitle>
                  <div className="grid gap-3 md:grid-cols-2">
                    {selectedGroup.fields.map((field) => {
                      const changed = hasFieldChanged(field.key);
                      const inputClassName = cn(
                        field.inputType === "textarea"
                          ? textareaClass
                          : "h-9 rounded-lg bg-card",
                        changed && "border-[var(--brand)] ring-2 ring-[var(--brand)]/10",
                      );
                      return (
                        <Field
                          key={field.key}
                          label={tr[field.labelKey] ?? field.key}
                          htmlFor={`setting-${field.key}`}
                          className={field.inputType === "textarea" ? "md:col-span-2" : undefined}
                        >
                          <>
                            {settingsMap[field.key]?.description ? (
                              <p className="mb-2 text-xs text-muted-foreground">
                                {settingsMap[field.key]?.description}
                              </p>
                            ) : null}
                            {field.inputType === "textarea" ? (
                              <textarea
                                id={`setting-${field.key}`}
                                rows={field.rows ?? 4}
                                value={editValues[field.key] ?? ""}
                                onChange={(event) => updateEditValue(field.key, event.target.value)}
                                className={inputClassName}
                              />
                            ) : (
                              <Input
                                id={`setting-${field.key}`}
                                type={field.inputType}
                                min={field.min}
                                value={editValues[field.key] ?? ""}
                                onChange={(event) => updateEditValue(field.key, event.target.value)}
                                className={inputClassName}
                              />
                            )}
                            {settingsMap[field.key]?.updated_at ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {t.common_last_updated}: {formatAdminDateTime(settingsMap[field.key].updated_at, lang)}
                              </p>
                            ) : null}
                          </>
                        </Field>
                      );
                    })}
                  </div>
                </section>
              </>
            ) : null}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminSettingsPage(...args: Parameters<typeof useAdminSettingsPageContent>) {
  return useAdminSettingsPageContent(...args);
}
