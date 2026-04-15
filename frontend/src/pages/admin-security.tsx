import { useCallback, useEffect, useState, type FormEvent } from "react";
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
  user_name: string | null;
  user_role: string | null;
  action: string;
  entity_type: string;
  reason: string;
  route: string | null;
  status: number | null;
  ip_hash: string | null;
  created_at: string;
}

interface AuditAnalyticsReader {
  user_id: string;
  user_name: string;
  user_role: string;
  event_count: number;
  distinct_entities: number;
}

interface AuditAnalyticsPayload {
  summary: AuditAnalyticsSummary;
  recent_suspicious_events: AuditAnalyticsEvent[];
  top_sensitive_readers: AuditAnalyticsReader[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compactDt(dt: string): string {
  return dt.replace("T", " ").slice(0, 19);
}

function shortUa(ua: string | null, max = 50): string {
  if (!ua) return "\u2014";
  return ua.length > max ? ua.slice(0, max) + "\u2026" : ua;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminSecurityPage() {
  const { t } = useLang();

  const [ips, setIps] = useState<IpEntry[]>([]);
  const [geo, setGeo] = useState<GeoLogin[]>([]);
  const [auditAnalytics, setAuditAnalytics] =
    useState<AuditAnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Add IP form
  const [newCidr, setNewCidr] = useState("");
  const [newDesc, setNewDesc] = useState("");

  // Maintenance
  const [maintEnabled, setMaintEnabled] = useState(false);
  const [maintMsg, setMaintMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ipList, geoList, analyticsPayload, settings] = await Promise.all([
        apiFetch<IpEntry[]>("/admin/ip-whitelist"),
        apiFetch<GeoLogin[]>("/admin/login-geo"),
        apiFetch<AuditAnalyticsPayload>("/admin/audit-analytics").catch(() => null),
        apiFetch<{ key: string; value: string }[]>("/admin/settings"),
      ]);
      setIps(ipList);
      setGeo(geoList);
      setAuditAnalytics(analyticsPayload);

      for (const s of settings) {
        if (s.key === "maintenance_mode") {
          setMaintEnabled(s.value.replace(/^"|"$/g, "") === "true");
        }
        if (s.key === "maintenance_message") {
          setMaintMsg(s.value.replace(/^"|"$/g, ""));
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const addIp = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!newCidr.trim()) return;
    await apiFetch("/admin/ip-whitelist", {
      method: "POST",
      body: JSON.stringify({
        cidr: newCidr.trim(),
        description: newDesc.trim() || null,
      }),
    });
    setNewCidr("");
    setNewDesc("");
    void load();
  };

  const deleteIp = async (id: string) => {
    await apiFetch(`/admin/ip-whitelist/${id}/delete`, { method: "POST" });
    void load();
  };

  const toggleMaintenance = async (enable: boolean) => {
    await apiFetch("/admin/maintenance", {
      method: "POST",
      body: JSON.stringify({
        enabled: enable,
        message: maintMsg.trim() || null,
      }),
    });
    void load();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{t.security_title}</h1>
        <p className="text-muted-foreground text-sm">{t.security_subtitle}</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-12 text-center">
          {t.common_loading}
        </p>
      ) : (
        <>
          {/* Maintenance mode */}
          <div className="bg-white rounded-xl border p-6 space-y-4">
            <h2 className="text-lg font-medium">{t.security_maintenance}</h2>
            <div className="flex items-end gap-4">
              <div className="flex-[2] space-y-1">
                <Label>{t.security_maintenance_msg}</Label>
                <Input
                  type="text"
                  value={maintMsg}
                  onChange={(e) => setMaintMsg(e.target.value)}
                />
              </div>
              <div>
                {maintEnabled ? (
                  <Button
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => toggleMaintenance(false)}
                  >
                    {t.security_maintenance_off}
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={() => toggleMaintenance(true)}>
                    {t.security_maintenance_on}
                  </Button>
                )}
              </div>
            </div>
            {maintEnabled && (
              <Badge variant="destructive">
                {t.security_maintenance} {t.security_maintenance_on}
              </Badge>
            )}
          </div>

          {/* Audit analytics */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border p-4">
              <h2 className="text-lg font-medium">{t.security_audit_analytics}</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {t.security_audit_hint}
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div className="bg-white rounded-xl border p-4">
                <div className="text-muted-foreground text-xs">{t.security_audit_failed_logins}</div>
                <div className="mt-2 text-2xl font-semibold">
                  {auditAnalytics?.summary.failed_logins_24h ?? 0}
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-muted-foreground text-xs">{t.security_audit_blocked_logins}</div>
                <div className="mt-2 text-2xl font-semibold">
                  {auditAnalytics?.summary.blocked_logins_24h ?? 0}
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-muted-foreground text-xs">{t.security_audit_token_theft}</div>
                <div className="mt-2 text-2xl font-semibold">
                  {auditAnalytics?.summary.token_theft_30d ?? 0}
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-muted-foreground text-xs">{t.security_audit_executive_access}</div>
                <div className="mt-2 text-2xl font-semibold">
                  {auditAnalytics?.summary.executive_sensitive_access_7d ?? 0}
                </div>
              </div>
              <div className="bg-white rounded-xl border p-4">
                <div className="text-muted-foreground text-xs">{t.security_audit_off_hours}</div>
                <div className="mt-2 text-2xl font-semibold">
                  {auditAnalytics?.summary.off_hours_sensitive_access_7d ?? 0}
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,0.9fr)]">
              <div className="bg-white rounded-xl border">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-medium">
                    {t.security_audit_recent} ({auditAnalytics?.recent_suspicious_events.length ?? 0})
                  </h2>
                </div>
                {auditAnalytics?.recent_suspicious_events.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.activity_time}</TableHead>
                        <TableHead>{t.activity_user}</TableHead>
                        <TableHead>{t.security_col_reason}</TableHead>
                        <TableHead>{t.security_col_route}</TableHead>
                        <TableHead>{t.common_ip}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditAnalytics.recent_suspicious_events.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell className="font-mono text-muted-foreground text-xs whitespace-nowrap">
                            {compactDt(event.created_at)}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm font-medium leading-tight">
                              {event.user_name ?? t.security_anonymous}
                            </div>
                            <div className="text-muted-foreground text-[11px]">
                              {event.user_role ?? event.action}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">{event.reason}</div>
                            <div className="text-muted-foreground text-[11px]">
                              {event.entity_type} · {event.action}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-[240px] truncate text-xs">
                            {event.route ?? "—"}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {event.ip_hash ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t.security_no_suspicious}
                  </p>
                )}
              </div>

              <div className="bg-white rounded-xl border">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-medium">{t.security_audit_top_readers}</h2>
                </div>
                {auditAnalytics?.top_sensitive_readers.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.activity_user}</TableHead>
                        <TableHead>{t.security_col_events}</TableHead>
                        <TableHead>{t.security_col_distinct_entities}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditAnalytics.top_sensitive_readers.map((reader) => (
                        <TableRow key={reader.user_id}>
                          <TableCell>
                            <div className="text-sm font-medium leading-tight">
                              {reader.user_name}
                            </div>
                            <div className="text-muted-foreground text-[11px]">
                              {reader.user_role}
                            </div>
                          </TableCell>
                          <TableCell>{reader.event_count}</TableCell>
                          <TableCell>{reader.distinct_entities}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t.security_no_outlier_readers}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* IP whitelist */}
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
              <h2 className="text-lg font-medium">{t.security_ip_whitelist}</h2>
            </div>
            <form onSubmit={addIp} className="flex items-end gap-4 p-4 border-b">
              <div className="space-y-1">
                <Label>{t.security_ip_cidr}</Label>
                <Input
                  type="text"
                  required
                  placeholder="10.0.0.0/8"
                  value={newCidr}
                  onChange={(e) => setNewCidr(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t.security_ip_desc}</Label>
                <Input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>
              <Button type="submit">{t.security_ip_add}</Button>
            </form>

            {ips.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                {t.security_ip_none}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.security_col_cidr}</TableHead>
                    <TableHead>{t.security_ip_desc}</TableHead>
                    <TableHead>{t.users_actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ips.map((ip) => (
                    <TableRow key={ip.id}>
                      <TableCell className="font-mono">{ip.cidr}</TableCell>
                      <TableCell>{ip.description ?? ""}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => deleteIp(ip.id)}
                        >
                          {t.common_delete}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Login geo history */}
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
              <h2 className="text-lg font-medium">
                {t.security_login_history} ({geo.length})
              </h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.activity_time}</TableHead>
                  <TableHead>{t.activity_user}</TableHead>
                  <TableHead>{t.common_ip}</TableHead>
                  <TableHead>{t.common_device}</TableHead>
                  <TableHead>{t.users_status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {geo.map((g, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-muted-foreground text-xs whitespace-nowrap">
                      {compactDt(g.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm font-medium leading-tight">
                        {g.user_name}
                      </div>
                      <div className="text-muted-foreground text-[11px]">
                        {g.user_email}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {g.ip_address ?? ""}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-[200px] truncate text-xs"
                      title={shortUa(g.user_agent)}
                    >
                      {shortUa(g.user_agent)}
                    </TableCell>
                    <TableCell>
                      {g.is_revoked ? (
                        <Badge variant="destructive">{t.compliance_revoked}</Badge>
                      ) : (
                        <Badge className="bg-green-500/15 text-green-700">
                          {t.providers_active}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
