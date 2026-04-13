import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SettingFieldMeta = {
  key: string;
  labelKey: string;
  inputType: "number" | "text" | "email" | "textarea";
  min?: number;
  rows?: number;
};

const TOKEN_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "access_token_minutes",
    labelKey: "settings_access_token_min",
    inputType: "number",
    min: 1,
  },
  {
    key: "refresh_token_days",
    labelKey: "settings_refresh_token_days",
    inputType: "number",
    min: 1,
  },
  {
    key: "max_sessions_per_user",
    labelKey: "settings_max_sessions",
    inputType: "number",
    min: 1,
  },
  {
    key: "session_idle_days",
    labelKey: "settings_idle_days",
    inputType: "number",
    min: 1,
  },
];

const AGENCY_SETTING_FIELDS: SettingFieldMeta[] = [
  {
    key: "agency_name",
    labelKey: "settings_agency_name",
    inputType: "text",
  },
  {
    key: "agency_care_of",
    labelKey: "settings_agency_care_of",
    inputType: "text",
  },
  {
    key: "agency_address",
    labelKey: "settings_agency_address",
    inputType: "textarea",
    rows: 3,
  },
  {
    key: "agency_phone",
    labelKey: "settings_agency_phone",
    inputType: "text",
  },
  {
    key: "agency_email",
    labelKey: "settings_agency_email",
    inputType: "email",
  },
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

function compactDt(value: string): string {
  return value.split("T")[0] ?? value;
}

function shortUa(ua: string | null, max = 60): string {
  if (!ua) return "\u2014";
  return ua.length > max ? ua.slice(0, max) + "\u2026" : ua;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminSettingsPage() {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pending, setPending] = useState<PendingLogin[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const settingsMap = useMemo(() => {
    const map: Record<string, SettingRow> = {};
    for (const row of settings) {
      map[row.key] = row;
    }
    return map;
  }, [settings]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, sess, pend] = await Promise.all([
        apiFetch<SettingRow[]>("/admin/settings"),
        apiFetch<SessionRow[]>("/admin/sessions"),
        apiFetch<PendingLogin[]>("/admin/mfa/pending"),
      ]);
      setSettings(s);
      const map: Record<string, string> = {};
      for (const row of s) {
        map[row.key] = row.value.replace(/^"|"$/g, "");
      }
      setEditValues(map);
      setSessions(sess);
      setPending(pend);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSetting = async (key: string) => {
    const value = editValues[key];
    if (value === undefined) return;
    setMsg(null);
    try {
      await apiFetch(`/admin/settings/${key}`, {
        method: "POST",
        body: JSON.stringify({ value }),
      });
      setMsg(t.settings_updated);
      void load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const logoutUser = async (userId: string) => {
    await apiFetch(`/admin/sessions/user/${userId}/revoke`, { method: "POST" });
    void load();
  };

  const logoutAll = async () => {
    if (!window.confirm(t.settings_logout_all_confirm)) return;
    await apiFetch("/admin/sessions/revoke-all", { method: "POST" });
    void load();
  };

  const approvePending = async (id: string) => {
    await apiFetch(`/admin/mfa/pending/${id}/approve`, { method: "POST" });
    void load();
  };

  const rejectPending = async (id: string) => {
    await apiFetch(`/admin/mfa/pending/${id}/reject`, { method: "POST" });
    void load();
  };

  const updateEditValue = (key: string, val: string) => {
    setEditValues((prev) => ({ ...prev, [key]: val }));
  };

  const renderSettingField = (field: SettingFieldMeta) => {
    const row = settingsMap[field.key];
    const label = tr[field.labelKey] ?? field.key;

    return (
      <div key={field.key} className="space-y-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="space-y-1">
          <Label htmlFor={`setting-${field.key}`}>{label}</Label>
          {row?.description ? (
            <p className="text-muted-foreground text-xs">{row.description}</p>
          ) : null}
        </div>

        {field.inputType === "textarea" ? (
          <textarea
            id={`setting-${field.key}`}
            value={editValues[field.key] ?? ""}
            rows={field.rows ?? 3}
            onChange={(event) => updateEditValue(field.key, event.target.value)}
            className="min-h-[88px] w-full rounded-xl border border-input bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          />
        ) : (
          <Input
            id={`setting-${field.key}`}
            type={field.inputType}
            min={field.min}
            value={editValues[field.key] ?? ""}
            onChange={(event) => updateEditValue(field.key, event.target.value)}
            className="bg-white"
          />
        )}

        <div className="flex justify-end">
          <Button size="sm" onClick={() => saveSetting(field.key)}>
            {t.common_save}
          </Button>
        </div>
      </div>
    );
  };

  // -- render --
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{t.settings_title}</h1>
        <p className="text-muted-foreground text-sm">{t.settings_subtitle}</p>
      </div>

      {msg && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-700">
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-muted-foreground py-12 text-center">
          {t.common_loading}
        </p>
      ) : (
        <>
          {/* Token configuration */}
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-lg font-medium">{t.settings_token_config}</h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {TOKEN_SETTING_FIELDS.map(renderSettingField)}
            </div>
          </div>

          {/* Agency profile */}
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-medium">{t.settings_agency_profile}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.settings_agency_hint}
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {AGENCY_SETTING_FIELDS.map(renderSettingField)}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-medium">
                {tr.settings_document_requirements ?? "Required documents"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {tr.settings_document_requirements_hint ??
                  "Configure the minimum patient document pack used for missing-document alerts."}
              </p>
            </div>
            <div className="grid gap-4">
              {DOCUMENT_REQUIREMENT_SETTING_FIELDS.map(renderSettingField)}
            </div>
          </div>

          <div className="bg-white rounded-xl border p-6 space-y-4">
            <div>
              <h2 className="text-lg font-medium">
                {tr.settings_clinical_data ?? "Clinical data retention"}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {tr.settings_clinical_data_hint ??
                  "Controls the retention horizon for medical cases and append-only anamnesis history."}
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {CLINICAL_SETTING_FIELDS.map(renderSettingField)}
            </div>
          </div>

          {/* MFA pending logins */}
          {pending.length > 0 && (
            <div className="bg-white rounded-xl border">
              <div className="p-4 border-b">
                <h2 className="text-lg font-medium">
                  {t.mfa_pending_logins} ({pending.length})
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.field_name}</TableHead>
                    <TableHead>{t.field_email}</TableHead>
                    <TableHead>{t.common_ip}</TableHead>
                    <TableHead>{t.activity_time}</TableHead>
                    <TableHead>{t.users_actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pending.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">
                        {p.user_name}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground text-xs">
                        {p.user_email}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {p.ip_address ?? ""}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground text-xs">
                        {compactDt(p.created_at)}
                      </TableCell>
                      <TableCell className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-green-600 hover:text-green-700"
                          onClick={() => approvePending(p.id)}
                        >
                          {t.mfa_approve}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => rejectPending(p.id)}
                        >
                          {t.mfa_reject}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Active sessions */}
          <div className="bg-white rounded-xl border">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-medium">
                {t.settings_active_sessions} ({sessions.length})
              </h2>
              <Button
                variant="destructive"
                size="sm"
                onClick={logoutAll}
              >
                {t.settings_logout_all}
              </Button>
            </div>
            {sessions.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {t.settings_no_sessions}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.field_name}</TableHead>
                    <TableHead>{t.field_email}</TableHead>
                    <TableHead>{t.users_role}</TableHead>
                    <TableHead>{t.common_ip}</TableHead>
                    <TableHead>{t.settings_last_active}</TableHead>
                    <TableHead>{t.users_actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.family_id}>
                      <TableCell className="font-medium">
                        {s.user_name}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground text-xs">
                        {s.user_email}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{s.role}</Badge>
                      </TableCell>
                      <TableCell
                        className="font-mono text-muted-foreground text-xs"
                        title={shortUa(s.user_agent)}
                      >
                        {s.ip_address ?? ""}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {compactDt(s.last_activity_at)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => logoutUser(s.user_id)}
                        >
                          {t.settings_logout_user}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
