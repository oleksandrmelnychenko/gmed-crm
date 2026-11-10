import { SectionHeading } from "@/components/ui/section-heading";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type SetStateAction,
} from "react";
import {
  Settings2,
  BellRing,
  Building2,
  Fingerprint,
  KeyRound,
  LoaderCircle,
  Monitor,
  Palette,
  Pencil,
  Receipt,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCheck,
} from "lucide-react";

import { AdminGuideButton } from "@/components/admin-guide";
import {
  SheetActionsFooter,
} from "@/components/admin-page-patterns";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AdminDialogScaffold, AdminFormSection } from "@/components/admin-dialog-scaffold";
import { StatusChip } from "@/components/ui/status-chip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import { formatEnumLabelFromKeys, useLang, type TranslationKey, type Translations } from "@/lib/i18n";
import {
  formatAdminDateTime,
  normalizeAdminSettingValue,
  shortAdminUserAgent,
  summarizeAdminSettingValue,
} from "@/pages/admin-pages.helpers";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { BUILTIN_THEMES, DEFAULT_THEME, parseAppearancePreferences } from "@/lib/appearance-theme";
import { useAppearanceTheme } from "@/lib/use-appearance-theme";
import { InfoHint } from "@/components/ui/info-hint";
import { issuerTaxRegistrationText } from "@/components/issuer-tax-registration-banner";
import { clearApiCache } from "@/lib/api";
import { isValidEmailAddress } from "@/lib/contact-validation";
import { useAuth } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { useRealtimeSubscription } from "@/lib/realtime";
import { cn } from "@/lib/utils";
import { canManageAdminAccount } from "@/pages/admin-users.helpers";
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
  /** The signed-in administrator may change it (business and legal settings: CEO only). */
  editable?: boolean;
}

function storedPortalTheme(value: string) {
  const { selectedId, themes } = parseAppearancePreferences(value);
  return [...BUILTIN_THEMES, ...themes].find((theme) => theme.id === selectedId) ?? DEFAULT_THEME;
}

function settingEditValue(row?: SettingRow) {
  if (row?.key === "patient_portal_default_theme" || row?.key === "lead_portal_default_theme") {
    return storedPortalTheme(row.value).id;
  }
  return normalizeAdminSettingValue(row?.value);
}

/**
 * Readable text for a refused setting change (QA E-31). A refused BIC names
 * the part that is wrong — bank code, country, location — instead of always
 * blaming the length (QA R3-04).
 */
export function describeSettingError(error: unknown, t: Translations): string {
  const details = (error ?? {}) as { code?: unknown; message?: unknown };
  const message = typeof details.message === "string" ? details.message : String(error);
  if (details.code === "business_setting_ceo_only") return t.settings_ceo_only_hint;
  if (message.startsWith("IBAN")) return t.settings_iban_invalid;
  if (message.startsWith("BIC bank code")) return t.settings_bic_invalid_bank_code;
  if (message.startsWith("BIC country code")) return t.settings_bic_invalid_country;
  if (message.startsWith("BIC location")) return t.settings_bic_invalid_location;
  if (message.startsWith("BIC")) return t.settings_bic_invalid;
  // The agency's own tax registration, printed on every invoice (QA 2026-11-10, D-06).
  if (message.startsWith("VAT ID of Germany")) return t.settings_vat_id_invalid_german;
  if (message.startsWith("VAT ID")) return t.settings_vat_id_invalid;
  if (message.startsWith("Tax number")) return t.settings_tax_number_invalid;
  return message || t.common_error;
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
  inputType: "number" | "text" | "email" | "date" | "textarea" | "theme";
  min?: number;
  maxLength?: number;
  rows?: number;
};

type SettingsGroupId =
  | "tokens"
  | "agency"
  | "portal_themes"
  | "documents"
  | "clinical"
  | "concierge"
  | "interpreter_access"
  | "dunning";

type SettingsGroup = {
  id: SettingsGroupId;
  titleKey: string;
  descriptionKey: string;
  fields: SettingFieldMeta[];
  icon: typeof KeyRound;
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
  // Sign-out after minutes without input (15–720, 0 = off); changed by the CEO.
  { key: "idle_logout_minutes", labelKey: "settings_idle_logout_minutes", inputType: "number", min: 0 },
  { key: "password_expire_days", labelKey: "settings_password_expire_days", inputType: "number", min: 0 },
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
  {
    key: "agency_website",
    labelKey: "settings_agency_website",
    inputType: "text",
    maxLength: 300,
  },
  { key: "agency_privacy_email", labelKey: "settings_agency_privacy_email", inputType: "email" },
  { key: "agency_sign_place", labelKey: "settings_agency_sign_place", inputType: "text" },
  { key: "agency_data_system_name", labelKey: "settings_agency_data_system_name", inputType: "text" },
  {
    key: "agency_data_controller_statement",
    labelKey: "settings_agency_data_controller_statement",
    inputType: "textarea",
    maxLength: 1000,
    rows: 3,
  },
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
  { key: "agency_vat_id", labelKey: "settings_agency_vat_id", inputType: "text" },
  { key: "agency_tax_number", labelKey: "settings_agency_tax_number", inputType: "text" },
  { key: "agency_country_code", labelKey: "settings_agency_country_code", inputType: "text", maxLength: 2 },
];

const DOCUMENT_REQUIREMENT_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "required_patient_documents",
    labelKey: "settings_required_patient_documents",
    inputType: "textarea",
    rows: 12,
  },
  // Signature requests Skribble cannot confirm are closed as failed after this.
  {
    key: "signature_stuck_request_days",
    labelKey: "settings_signature_stuck_request_days",
    inputType: "number",
    min: 1,
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

// Lead times of the automatic reminder and preparation task of a concierge service.
const CONCIERGE_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "concierge_reminder_lead_hours",
    labelKey: "settings_concierge_reminder_lead_hours",
    inputType: "number",
    min: 1,
  },
  {
    key: "concierge_prep_lead_hours",
    labelKey: "settings_concierge_prep_lead_hours",
    inputType: "number",
    min: 1,
  },
];

// How long a booking keeps an interpreter linked to the patient.
const INTERPRETER_ACCESS_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "interpreter_booking_access_days",
    labelKey: "settings_interpreter_booking_access_days",
    inputType: "number",
    min: 1,
  },
];

// Days after an invoice's due date before the first automatic reminder.
const DUNNING_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "auto_dunning_grace_days",
    labelKey: "settings_auto_dunning_grace_days",
    inputType: "number",
    min: 0,
  },
];

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: "tokens",
    titleKey: "settings_token_config",
    descriptionKey: "settings_subtitle",
    fields: TOKEN_SETTING_FIELDS,
    icon: KeyRound,
  },
  {
    id: "agency",
    titleKey: "settings_agency_profile",
    descriptionKey: "settings_agency_hint",
    fields: AGENCY_SETTING_FIELDS,
    icon: Building2,
  },
  {
    id: "portal_themes",
    titleKey: "settings_portal_themes",
    descriptionKey: "settings_portal_themes_hint",
    fields: [
      { key: "patient_portal_default_theme", labelKey: "settings_patient_theme", inputType: "theme" },
      { key: "lead_portal_default_theme", labelKey: "settings_lead_theme", inputType: "theme" },
    ],
    icon: Palette,
  },
  {
    id: "documents",
    titleKey: "settings_document_requirements",
    descriptionKey: "settings_document_requirements_hint",
    fields: DOCUMENT_REQUIREMENT_SETTING_FIELDS,
    icon: ScrollText,
  },
  {
    id: "clinical",
    titleKey: "settings_clinical_data",
    descriptionKey: "settings_clinical_data_hint",
    fields: CLINICAL_SETTING_FIELDS,
    icon: ShieldCheck,
  },
  {
    id: "concierge",
    titleKey: "settings_concierge_preparation",
    descriptionKey: "settings_concierge_preparation_hint",
    fields: CONCIERGE_SETTING_FIELDS,
    icon: BellRing,
  },
  {
    id: "interpreter_access",
    titleKey: "settings_interpreter_access",
    descriptionKey: "settings_interpreter_access_hint",
    fields: INTERPRETER_ACCESS_SETTING_FIELDS,
    icon: UserRoundCheck,
  },
  {
    id: "dunning",
    titleKey: "settings_dunning",
    descriptionKey: "settings_dunning_hint",
    fields: DUNNING_SETTING_FIELDS,
    icon: Receipt,
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
  const { themes } = useAppearanceTheme();
  const { user: currentUser } = useAuth();
  // Mirrors the server: signing out an existing CEO or deciding the CEO's
  // pending login is a change to the CEO account, so it needs
  // `users.manage_ceo` (the CEO).
  const canManageCeo = hasCapability(currentUser, "users.manage_ceo");
  // Portal logins of patients and leads: only the CEO acts on them (QA E-05).
  const canManagePortalAccounts =
    hasCapability(currentUser, "users.manage") && hasCapability(currentUser, "patients.edit");
  const [workspaceTab, setWorkspaceTab] = useState("configuration");
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
          acc[row.key] = settingEditValue(row);
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

  const closeGroupSheet = useCallback(() => {
    setSelectedGroupId(null);
    setSheetState({ saving: false, error: "", warning: "" });
    setEditValues(
      settings.reduce<Record<string, string>>((acc, row) => {
        acc[row.key] = settingEditValue(row);
        return acc;
      }, {}),
    );
  }, [settings]);

  function updateEditValue(key: string, value: string) {
    setEditValues((current) => ({ ...current, [key]: value }));
    // The message of the last refused save belongs to the value that was
    // refused: it goes once the field is changed (typing the stored value
    // back left it next to a disabled "save", verification 2026-11-10).
    setSheetState((current) =>
      current.error || current.warning ? { ...current, error: "", warning: "" } : current,
    );
  }

  function hasFieldChanged(key: string): boolean {
    return settingEditValue(settingsMap[key]) !== (editValues[key] ?? "");
  }

  const roleLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ROLE_LABEL_KEYS, t),
    [t],
  );
  const groupHasChanges =
    selectedGroup?.fields.some((field) => hasFieldChanged(field.key)) ?? false;
  // Invoices are not released without GMED's Steuernummer or USt-IdNr.
  const issuerTaxRegistrationMissing =
    !loading
    && settings.length > 0
    && ["agency_tax_number", "agency_vat_id"].every(
      (key) => !normalizeAdminSettingValue(settingsMap[key]?.value).trim(),
    );

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
        settingEditValue(settingsMap[field.key]) !==
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
    const invalidEmailField = changedFields.find((field) => {
      const value = editValues[field.key] ?? "";
      return field.inputType === "email" && value.trim() !== "" && !isValidEmailAddress(value);
    });
    if (invalidEmailField) {
      setSheetState({
        saving: false,
        error: `${tr[invalidEmailField.labelKey] ?? invalidEmailField.key}: ${t.login_error_email_invalid}`,
        warning: "",
      });
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
        error: describeSettingError(saveError, t),
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

  const sessionsPagination = useDataTablePagination(sessions, String(sessions.length));

  const pendingColumns = useMemo<ColumnDef<PendingLogin>[]>(() => [
    {
      id: "name",
      label: t.field_name,
      accessor: (entry) => entry.user_name,
      sortable: true,
      width: 220,
      render: (entry) => (
        <div className="min-w-0">
          <div className="text-xs text-foreground">{entry.user_name}</div>
          <div className="text-xs text-foreground">{roleLabel(entry.role)}</div>
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
        <span className="font-mono text-xs text-foreground">{entry.user_email}</span>
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
        <span className="truncate text-xs text-foreground" title={entry.user_agent ?? ""}>
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
        <span className="font-mono text-xs text-foreground">
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
        const canDecide = canManageAdminAccount(entry.role, canManageCeo, canManagePortalAccounts);
        const lockedTitle = canDecide ? undefined : t.users_ceo_managed_by_ceo_only;
        return (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg"
              disabled={!canDecide || approveBusy || rejectBusy}
              title={lockedTitle}
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
              disabled={!canDecide || approveBusy || rejectBusy}
              title={lockedTitle}
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
    canManageCeo,
    canManagePortalAccounts,
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
    t.users_ceo_managed_by_ceo_only,
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
        <span className="text-xs text-foreground">{session.user_name}</span>
      ),
    },
    {
      id: "email",
      label: t.field_email,
      accessor: (session) => session.user_email,
      sortable: true,
      width: 230,
      render: (session) => (
        <span className="font-mono text-xs text-foreground">{session.user_email}</span>
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
        <span className="font-mono text-xs text-foreground">
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
        <span className="truncate text-xs text-foreground" title={session.user_agent ?? ""}>
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
        <span className="font-mono text-xs text-foreground">
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
        const canSignOut = canManageAdminAccount(session.role, canManageCeo, canManagePortalAccounts);
        return (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-8 rounded-lg"
            disabled={!canSignOut || busy}
            title={canSignOut ? undefined : t.users_ceo_managed_by_ceo_only}
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
    canManageCeo,
    canManagePortalAccounts,
    lang,
    logoutUser,
    t.common_device,
    t.common_ip,
    t.field_email,
    t.field_name,
    t.settings_last_active,
    t.settings_logout_user,
    t.users_actions,
    t.users_ceo_managed_by_ceo_only,
    t.users_role,
    roleLabel,
  ]);

  const issuerTaxText = issuerTaxRegistrationText(lang);

  return (
    <>
      <div className="min-w-0 space-y-3" data-testid="admin-settings-page">
        {issuerTaxRegistrationMissing ? (
          <Banner tone="warning" withIcon>
            <p className="font-medium">{issuerTaxText.title}</p>
            <p className="mt-1">{issuerTaxText.body}</p>
            <p className="mt-1">{issuerTaxText.onSettings}</p>
          </Banner>
        ) : null}
        <PageHeader
          title={t.settings_title}
          description={t.settings_subtitle}
          actions={(
            <>
              <AdminGuideButton title={t.settings_title} description={t.settings_subtitle} />
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 rounded-lg px-3"
                disabled={loading}
                onClick={() => void load()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
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
            <Tabs value={workspaceTab} onValueChange={(value) => setWorkspaceTab(String(value))}>
              <TabsList className="group-data-horizontal/tabs:h-auto max-w-full flex-wrap justify-start gap-0.5 rounded-lg border border-border bg-card p-0.5">
                <TabsTrigger value="configuration" className="h-8 gap-2 rounded-lg px-3"><ScrollText className="size-3.5" />{t.common_configuration}</TabsTrigger>
                <TabsTrigger value="sessions" className="h-8 gap-2 rounded-lg px-3"><KeyRound className="size-3.5" />{t.settings_active_sessions}<span className="font-mono text-xs">{sessions.length}</span></TabsTrigger>
                <TabsTrigger value="pending" className="h-8 gap-2 rounded-lg px-3"><UserRoundCheck className="size-3.5" />{t.mfa_pending_logins}<span className="font-mono text-xs">{pending.length}</span></TabsTrigger>
              </TabsList>
              <TabsContent value="configuration" className="mt-0">
                <div className="grid items-stretch gap-2.5 md:grid-cols-2 2xl:grid-cols-3">
                  {SETTINGS_GROUPS.map((group) => {
                    return (
                      <section key={group.id} aria-labelledby={`settings-group-${group.id}`} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
                        <header className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-2">
                          <h2 id={`settings-group-${group.id}`} className="min-w-0 flex-1 text-sm font-semibold leading-5"><SectionHeading icon={group.icon}>{tr[group.titleKey] ?? group.id}</SectionHeading></h2>
                          <InfoHint label={tr[group.titleKey] ?? group.id}>{tr[group.descriptionKey]}</InfoHint>
                        </header>
                        <div className="flex flex-1 flex-col px-3 py-2">
                          <dl className="flex-1 divide-y divide-border/60">
                            {group.fields.slice(0, 3).map((field) => {
                              const raw = settingsMap[field.key]?.value ?? "";
                              const value = field.inputType === "theme" && raw
                                ? storedPortalTheme(raw).name
                                : summarizeAdminSettingValue(field.key, raw);
                              return <div key={field.key} className="flex min-w-0 items-baseline justify-between gap-3 py-1.5">
                                <dt className="min-w-0 flex-1 text-xs leading-5 text-muted-foreground">{tr[field.labelKey] ?? field.key}</dt>
                                <dd className="max-w-[55%] break-words text-right text-xs font-medium leading-5 text-foreground tabular-nums" title={value || undefined}>{value || "—"}</dd>
                              </div>;
                            })}
                          </dl>
                          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-border pt-2">
                            <span className="font-mono text-[11px] text-muted-foreground">{t.admin_system_fields}: {group.fields.length}</span>
                            <Button type="button" size="sm" className="h-7 gap-1.5 rounded-lg px-2.5 text-xs" aria-label={`${t.common_edit}: ${tr[group.titleKey] ?? group.id}`} onClick={() => openGroupSheet(group.id)}><Pencil aria-hidden="true" className="size-3.5" />{t.common_edit}</Button>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              </TabsContent>
              <TabsContent value="pending" className="mt-0">
            <DataTableSurface
              rows={pending}
              columns={pendingColumns}
              defaultDensity="compact"
              defaultSort={[{ field: "created_at", dir: "desc" }]}
              dictionary={t as unknown as Record<string, string>}
              rowId={(entry) => entry.id}
              emptyState={<EmptyCell>{t.mfa_no_pending}</EmptyCell>}
              toolbarStart={
                <>
                  <SectionHeading icon={Fingerprint}>{t.mfa_pending_logins}</SectionHeading>
                  <CountBadge>{pending.length}</CountBadge>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                </>
              }
            />

              </TabsContent>
              <TabsContent value="sessions" className="mt-0">
            <DataTableSurface
              rows={sessionsPagination.pagedRows}
              columns={sessionColumns}
              defaultDensity="compact"
              defaultSort={[{ field: "last_activity_at", dir: "desc" }]}
              dictionary={t as unknown as Record<string, string>}
              rowId={(session) => session.family_id}
              emptyState={<EmptyCell>{t.settings_no_sessions}</EmptyCell>}
              toolbarStart={
                <>
                  <SectionHeading icon={Monitor}>{t.settings_active_sessions}</SectionHeading>
                  <CountBadge>{sessions.length}</CountBadge>
                  <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border" />
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="h-7 rounded-lg"
                    disabled={sessions.length === 0 || actionBusyKey === "sessions:all"}
                    onClick={() => void logoutAll()}
                  >
                    {actionBusyKey === "sessions:all" ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {t.settings_logout_all}
                  </Button>
                </>
              }
              toolbarAfter={
                <DataTablePager
                  pageIndex={sessionsPagination.pageIndex}
                  pageSize={sessionsPagination.pageSize}
                  totalPages={sessionsPagination.totalPages}
                  totalRows={sessionsPagination.totalRows}
                  previousLabel={t.pagination_previous}
                  nextLabel={t.pagination_next}
                  onPageChange={sessionsPagination.onPageChange}
                />
              }
            />
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>

      <Dialog
        open={Boolean(selectedGroup)}
        onOpenChange={handleGroupSheetOpenChange}
        dirty={groupHasChanges}
      >
        <AdminDialogScaffold icon={selectedGroup?.icon ?? Settings2} maxWidthClassName={selectedGroup && selectedGroup.fields.length > 3 ? "sm:max-w-[760px]" : "sm:max-w-[560px]"}
            bodyClassName="space-y-2 [&_label]:font-mono [&_label]:text-xs"
            title={selectedGroup ? tr[selectedGroup.titleKey] : t.settings_title}
            description={selectedGroup ? tr[selectedGroup.descriptionKey] : t.settings_subtitle}
            footer={(
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => handleGroupSheetOpenChange(false)}
                >
                  {t.common_cancel}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg"
                  disabled={!selectedGroup || sheetState.saving || !groupHasChanges}
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
            {selectedGroup?.fields.some((field) => settingsMap[field.key]?.editable === false) ? (
              <Banner tone="warning">{t.settings_ceo_only_hint}</Banner>
            ) : null}

            {selectedGroup ? (
              <>
                {changedFieldLabels.length > 0 ? <StatusChip tone="warning">{t.common_edit}: {changedFieldLabels.join(" · ")}</StatusChip> : null}

                <AdminFormSection icon={SlidersHorizontal} title={t.admin_system_fields} className="space-y-2 p-3">
                  <div className={cn("grid gap-x-3 gap-y-2.5", selectedGroup.fields.length > 3 && "sm:grid-cols-2")}>
                    {selectedGroup.fields.map((field) => {
                      const changed = hasFieldChanged(field.key);
                      const storedTheme = field.inputType === "theme" && settingsMap[field.key]
                        ? storedPortalTheme(settingsMap[field.key].value) : undefined;
                      const inputClassName = cn(
                        field.inputType === "textarea"
                          ? textareaClass
                          : "h-8 rounded-lg bg-field text-sm",
                        field.inputType === "textarea" && "bg-field font-mono text-xs",
                        changed && "border-ring ring-1 ring-ring/25",
                      );
                      return (
                        <Field
                          key={field.key}
                          label={tr[field.labelKey] ?? field.key}
                          htmlFor={`setting-${field.key}`}
                          className={field.inputType === "textarea" && selectedGroup.fields.length > 3 ? "sm:col-span-2" : undefined}
                        >
                          <>
                            {field.inputType === "theme" ? (
                              <NativeComboboxSelect
                                id={`setting-${field.key}`}
                                value={editValues[field.key] ?? ""}
                                disabled={!storedTheme || settingsMap[field.key]?.editable === false}
                                onChange={(event) => updateEditValue(field.key, event.target.value)}
                                className={inputClassName}
                              >
                                {storedTheme && !themes.some((theme) => theme.id === storedTheme.id) && (
                                  <option value={storedTheme.id}>{storedTheme.name}</option>
                                )}
                                {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                              </NativeComboboxSelect>
                            ) : field.inputType === "textarea" ? (
                              <textarea
                                id={`setting-${field.key}`}
                                rows={field.rows ?? 4}
                                maxLength={field.maxLength}
                                value={editValues[field.key] ?? ""}
                                disabled={settingsMap[field.key]?.editable === false}
                                onChange={(event) => updateEditValue(field.key, event.target.value)}
                                className={inputClassName}
                              />
                            ) : (
                              <Input
                                id={`setting-${field.key}`}
                                type={field.inputType}
                                min={field.min}
                                maxLength={field.maxLength}
                                value={editValues[field.key] ?? ""}
                                disabled={settingsMap[field.key]?.editable === false}
                                onChange={(event) => updateEditValue(field.key, event.target.value)}
                                className={inputClassName}
                              />
                            )}
                          </>
                        </Field>
                      );
                    })}
                  </div>
                </AdminFormSection>
              </>
            ) : null}
        </AdminDialogScaffold>
      </Dialog>
    </>
  );
}

export function AdminSettingsPage(...args: Parameters<typeof useAdminSettingsPageContent>) {
  return useAdminSettingsPageContent(...args);
}
