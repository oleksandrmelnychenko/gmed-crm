import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
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
}

// ---------------------------------------------------------------------------
// Stat card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string | number;
  sub?: string;
  warn?: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-5 space-y-1">
      <p className="text-muted-foreground text-xs font-medium">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      {sub && (
        <p className="text-muted-foreground text-xs">{sub}</p>
      )}
      {warn && (
        <p className="text-xs text-red-600">{warn}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminHealthPage() {
  const { t } = useLang();

  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const d = await apiFetch<HealthData>("/admin/health");
      setData(d);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{t.health_title}</h1>
        <p className="text-muted-foreground text-sm">{t.health_subtitle}</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-12 text-center">
          {t.common_loading}
        </p>
      ) : error || !data ? (
        <p className="py-12 text-center text-red-600">{t.common_error}</p>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={t.health_db_size}
              value={data.database.size}
              sub={`${data.database.active_connections} ${t.health_connections}`}
            />
            <StatCard
              label={t.health_users_total}
              value={data.users.total}
              sub={`${data.users.active} ${t.health_users_active}`}
              warn={
                data.users.locked > 0
                  ? `${data.users.locked} ${t.health_users_locked}`
                  : undefined
              }
            />
            <StatCard
              label={t.health_sessions_active}
              value={data.sessions.active}
              sub={
                data.sessions.pending_mfa > 0
                  ? `${data.sessions.pending_mfa} ${t.health_mfa_pending}`
                  : undefined
              }
            />
            <StatCard
              label="Data"
              value={`P:${data.data.patients} L:${data.data.leads} O:${data.data.orders}`}
              sub={`${data.data.audit_entries} audit`}
            />
          </div>

          {/* Tables list */}
          <div className="bg-white rounded-xl border">
            <div className="p-4 border-b">
              <h2 className="text-lg font-medium">{t.health_tables}</h2>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Table</TableHead>
                  <TableHead>Size</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.database.tables.map((tbl) => (
                  <TableRow key={tbl.table}>
                    <TableCell className="font-medium">{tbl.table}</TableCell>
                    <TableCell className="font-mono">{tbl.size}</TableCell>
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
