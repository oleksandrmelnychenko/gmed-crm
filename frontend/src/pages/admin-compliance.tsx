import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Download, ShieldAlert } from "lucide-react";
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

interface ConsentType {
  consent_type: string;
  total: number;
  active: number;
}

interface ConsentChange {
  user_name: string;
  consent_type: string;
  granted: boolean;
  granted_at: string | null;
  revoked_at: string | null;
}

interface ConsentDashboard {
  total: number;
  granted_active: number;
  revoked: number;
  by_type: ConsentType[];
  recent_changes: ConsentChange[];
}

interface ExpiredConsent {
  user_name: string;
  consent_type: string;
  granted_at: string | null;
}

function compactDt(dt: string | null | undefined): string {
  if (!dt) return "\u2014";
  return dt.split("T")[0] ?? dt;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminCompliancePage() {
  const { t } = useLang();

  const [dashboard, setDashboard] = useState<ConsentDashboard | null>(null);
  const [expired, setExpired] = useState<ExpiredConsent[]>([]);
  const [loading, setLoading] = useState(true);

  const [exportId, setExportId] = useState("");
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [anonId, setAnonId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dash, exp] = await Promise.all([
        apiFetch<ConsentDashboard>("/admin/compliance/consents"),
        apiFetch<ExpiredConsent[]>("/admin/compliance/consents/expired"),
      ]);
      setDashboard(dash);
      setExpired(exp);
    } catch {
      /* keep defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doExport = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!exportId.trim()) return;
    setExportResult(null);
    try {
      const data = await apiFetch<unknown>(
        `/admin/compliance/patient/${exportId}/export`,
      );
      setExportResult(JSON.stringify(data, null, 2));
    } catch (e) {
      setExportResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const doAnonymize = async () => {
    if (!anonId.trim()) return;
    if (!window.confirm(t.compliance_anonymize_confirm)) return;
    try {
      await apiFetch(`/admin/compliance/patient/${anonId}/anonymize`, {
        method: "POST",
      });
      setExportResult("OK");
    } catch (e) {
      setExportResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // -- stats cards --
  const stats = dashboard
    ? [
        { label: t.compliance_consents, value: dashboard.total },
        { label: t.compliance_granted, value: dashboard.granted_active },
        { label: t.compliance_revoked, value: dashboard.revoked },
        { label: t.compliance_expired, value: expired.length },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{t.compliance_title}</h1>
        <p className="text-muted-foreground text-sm">
          {t.compliance_subtitle}
        </p>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-10 text-center">
          {t.common_loading}
        </p>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border bg-white p-5 dark:bg-neutral-900"
              >
                <p className="text-muted-foreground text-xs">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Export & Anonymize */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Export */}
            <div className="rounded-xl border bg-white p-6 dark:bg-neutral-900">
              <h2 className="mb-4 text-lg font-semibold">
                {t.compliance_export}
              </h2>
              <form onSubmit={doExport} className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>{t.compliance_patient_id} (UUID)</Label>
                  <Input
                    required
                    placeholder="xxxxxxxx-xxxx-..."
                    value={exportId}
                    onChange={(e) => setExportId(e.target.value)}
                  />
                </div>
                <Button type="submit">
                  <Download className="mr-1 size-4" />
                  {t.compliance_export}
                </Button>
              </form>
              {exportResult && (
                <pre className="bg-muted mt-4 max-h-72 overflow-auto rounded p-3 text-xs">
                  {exportResult}
                </pre>
              )}
            </div>

            {/* Anonymize */}
            <div className="rounded-xl border bg-white p-6 dark:bg-neutral-900">
              <h2 className="mb-4 text-lg font-semibold">
                {t.compliance_anonymize}
              </h2>
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>{t.compliance_patient_id} (UUID)</Label>
                  <Input
                    placeholder="xxxxxxxx-xxxx-..."
                    value={anonId}
                    onChange={(e) => setAnonId(e.target.value)}
                  />
                </div>
                <Button variant="destructive" onClick={doAnonymize}>
                  <ShieldAlert className="mr-1 size-4" />
                  {t.compliance_anonymize}
                </Button>
              </div>
            </div>
          </div>

          {/* Consents by type */}
          {dashboard && dashboard.by_type.length > 0 && (
            <div className="rounded-xl border bg-white dark:bg-neutral-900">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold">
                  {t.compliance_consents}
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>{t.compliance_granted}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.by_type.map((ct) => (
                    <TableRow key={ct.consent_type}>
                      <TableCell className="font-medium">
                        {ct.consent_type}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {ct.total}
                      </TableCell>
                      <TableCell>
                        <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                          {ct.active}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Expired consents */}
          <div className="rounded-xl border bg-white dark:bg-neutral-900">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold">
                {t.compliance_expired_consents} ({expired.length})
              </h2>
            </div>
            {expired.length === 0 ? (
              <p className="text-muted-foreground px-6 py-10 text-center text-sm">
                {t.compliance_no_expired}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.activity_user}</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>{t.activity_time}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expired.map((e, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">
                        {e.user_name}
                      </TableCell>
                      <TableCell>{e.consent_type}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {compactDt(e.granted_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Recent changes */}
          {dashboard && dashboard.recent_changes.length > 0 && (
            <div className="rounded-xl border bg-white dark:bg-neutral-900">
              <div className="border-b px-6 py-4">
                <h2 className="text-lg font-semibold">
                  {t.compliance_recent}
                </h2>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.activity_user}</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>{t.users_status}</TableHead>
                    <TableHead>{t.activity_time}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recent_changes.map((c, i) => {
                    const isRevoked = !!c.revoked_at;
                    const badgeCls = isRevoked
                      ? "bg-red-500/15 text-red-700 dark:text-red-400"
                      : c.granted
                        ? "bg-green-500/15 text-green-700 dark:text-green-400"
                        : "bg-neutral-500/15 text-neutral-700 dark:text-neutral-400";
                    const label = isRevoked
                      ? t.compliance_revoked
                      : c.granted
                        ? t.compliance_granted
                        : "\u2014";
                    const dt = isRevoked
                      ? compactDt(c.revoked_at)
                      : compactDt(c.granted_at);
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium">
                          {c.user_name}
                        </TableCell>
                        <TableCell>{c.consent_type}</TableCell>
                        <TableCell>
                          <Badge className={badgeCls}>{label}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-sm">
                          {dt}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
