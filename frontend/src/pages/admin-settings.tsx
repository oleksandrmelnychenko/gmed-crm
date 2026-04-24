import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  KeyRound,
  LoaderCircle,
  RefreshCcw,
  ScrollText,
  ShieldCheck,
  UsersRound,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import { useLang } from "@/lib/i18n";
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
import { cn } from "@/lib/utils";

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
  inputType: "number" | "text" | "email" | "textarea";
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
  { key: "agency_address", labelKey: "settings_agency_address", inputType: "textarea", rows: 3 },
  { key: "agency_phone", labelKey: "settings_agency_phone", inputType: "text" },
  { key: "agency_email", labelKey: "settings_agency_email", inputType: "email" },
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

export function AdminSettingsPage() {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pending, setPending] = useState<PendingLogin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<FlashState>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [selectedGroupId, setSelectedGroupId] = useState<SettingsGroupId | null>(null);
  const [sheetState, setSheetState] = useState<{ saving: boolean; error: string; warning: string }>({
    saving: false,
    error: "",
    warning: "",
  });
  const [actionBusyKey, setActionBusyKey] = useState("");

  const settingsMap = useMemo(() => {
    const map: Record<string, SettingRow> = {};
    for (const row of settings) map[row.key] = row;
    return map;
  }, [settings]);

  const selectedGroup = useMemo(
    () => SETTINGS_GROUPS.find((group) => group.id === selectedGroupId) ?? null,
    [selectedGroupId],
  );
  const closeUnsavedConfirmMessage =
    tr.common_discard_unsaved_confirm ?? "Discard unsaved changes?";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [settingsRows, sessionRows, pendingRows] = await Promise.all([
        apiFetch<SettingRow[]>("/admin/settings"),
        apiFetch<SessionRow[]>("/admin/sessions"),
        apiFetch<PendingLogin[]>("/admin/mfa/pending"),
      ]);
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
    return selectedGroup.fields
      .filter(
        (field) =>
          normalizeAdminSettingValue(settingsMap[field.key]?.value) !==
          (editValues[field.key] ?? ""),
      )
      .map((field) => tr[field.labelKey] ?? field.key);
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
      for (const field of changedFields) {
        await apiFetch(`/admin/settings/${field.key}`, {
          method: "POST",
          body: JSON.stringify({ value: editValues[field.key] ?? "" }),
        });
      }
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

  async function logoutUser(userId: string) {
    setActionBusyKey(`session:${userId}`);
    setFlash(null);
    try {
      await apiFetch(`/admin/sessions/user/${userId}/revoke`, { method: "POST" });
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

  async function logoutAll() {
    if (!window.confirm(t.settings_logout_all_confirm)) return;
    setActionBusyKey("sessions:all");
    setFlash(null);
    try {
      await apiFetch("/admin/sessions/revoke-all", { method: "POST" });
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

  async function approvePending(id: string) {
    setActionBusyKey(`mfa:approve:${id}`);
    setFlash(null);
    try {
      await apiFetch(`/admin/mfa/pending/${id}/approve`, { method: "POST" });
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

  async function rejectPending(id: string) {
    setActionBusyKey(`mfa:reject:${id}`);
    setFlash(null);
    try {
      await apiFetch(`/admin/mfa/pending/${id}/reject`, { method: "POST" });
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

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.settings_title}
          description={t.settings_subtitle}
          actions={(
            <>
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
            <div className="flex flex-wrap gap-x-8 gap-y-4">
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
              <div className="grid gap-3 xl:grid-cols-2">
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

                      <div className="mt-3 grid gap-2 md:grid-cols-2">
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-muted/40">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">{t.field_name}</th>
                          <th className="px-4 py-2.5 font-medium">{t.field_email}</th>
                          <th className="w-[140px] px-4 py-2.5 font-medium">{t.common_ip}</th>
                          <th className="px-4 py-2.5 font-medium">{t.common_device}</th>
                          <th className="w-[180px] px-4 py-2.5 font-medium">{t.activity_time}</th>
                          <th className="w-[200px] px-4 py-2.5 font-medium">{t.users_actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pending.map((entry) => {
                          const approveBusy = actionBusyKey === `mfa:approve:${entry.id}`;
                          const rejectBusy = actionBusyKey === `mfa:reject:${entry.id}`;
                          return (
                            <tr key={entry.id} className="border-t border-border">
                              <td className="px-4 py-3">
                                <div className="text-sm font-medium text-foreground">
                                  {entry.user_name}
                                </div>
                                <div className="text-[11.5px] text-muted-foreground">
                                  {entry.role}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {entry.user_email}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {entry.ip_address ?? "-"}
                              </td>
                              <td
                                className="max-w-[240px] px-4 py-3 text-xs text-muted-foreground truncate"
                                title={entry.user_agent ?? ""}
                              >
                                {shortAdminUserAgent(entry.user_agent)}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {formatAdminDateTime(entry.created_at, lang)}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-8 rounded-lg"
                                    disabled={approveBusy || rejectBusy}
                                    onClick={() => void approvePending(entry.id)}
                                  >
                                    {approveBusy ? (
                                      <LoaderCircle className="size-3.5 animate-spin" />
                                    ) : null}
                                    {t.mfa_approve}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="destructive"
                                    className="h-8 rounded-lg"
                                    disabled={approveBusy || rejectBusy}
                                    onClick={() => void rejectPending(entry.id)}
                                  >
                                    {rejectBusy ? (
                                      <LoaderCircle className="size-3.5 animate-spin" />
                                    ) : null}
                                    {t.mfa_reject}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-muted/40">
                        <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-4 py-2.5 font-medium">{t.field_name}</th>
                          <th className="px-4 py-2.5 font-medium">{t.field_email}</th>
                          <th className="w-[120px] px-4 py-2.5 font-medium">{t.users_role}</th>
                          <th className="w-[140px] px-4 py-2.5 font-medium">{t.common_ip}</th>
                          <th className="px-4 py-2.5 font-medium">{t.common_device}</th>
                          <th className="w-[180px] px-4 py-2.5 font-medium">{t.settings_last_active}</th>
                          <th className="w-[150px] px-4 py-2.5 font-medium">{t.users_actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sessions.map((session) => {
                          const busy = actionBusyKey === `session:${session.user_id}`;
                          return (
                            <tr key={session.family_id} className="border-t border-border">
                              <td className="px-4 py-3">
                                <div className="text-sm font-medium text-foreground">
                                  {session.user_name}
                                </div>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {session.user_email}
                              </td>
                              <td className="px-4 py-3">
                                <StatusBadge tone="neutral">{session.role}</StatusBadge>
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {session.ip_address ?? "-"}
                              </td>
                              <td
                                className="max-w-[240px] px-4 py-3 text-xs text-muted-foreground truncate"
                                title={session.user_agent ?? ""}
                              >
                                {shortAdminUserAgent(session.user_agent)}
                              </td>
                              <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                                {formatAdminDateTime(session.last_activity_at, lang)}
                              </td>
                              <td className="px-4 py-3">
                                <Button
                                  type="button"
                                  variant="destructive"
                                  size="sm"
                                  className="h-8 rounded-lg"
                                  disabled={busy}
                                  onClick={() => void logoutUser(session.user_id)}
                                >
                                  {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                                  {t.settings_logout_user}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </AdminTableCard>
            </Section>
          </>
        ) : null}
      </div>

      <Sheet open={Boolean(selectedGroup)} onOpenChange={handleGroupSheetOpenChange}>
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
                  onClick={closeGroupSheet}
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
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                    Overview
                  </h3>
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
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                    Fields
                  </h3>
                  <div className="grid gap-4 md:grid-cols-2">
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

