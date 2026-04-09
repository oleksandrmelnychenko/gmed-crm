import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface ActivityRow {
  user_name: string;
  user_email: string;
  action: string;
  entity_type: string | null;
  entity_id: unknown;
  context: Record<string, unknown> | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_COLORS: Record<string, string> = {
  login: "bg-green-500/15 text-green-700",
  revoke_all_sessions: "bg-red-500/15 text-red-700",
  admin_force_logout_user: "bg-red-500/15 text-red-700",
  revoke_all_users_sessions: "bg-red-500/15 text-red-700",
  token_theft_detected: "bg-red-500/15 text-red-700",
  create_lead: "bg-blue-500/15 text-blue-700",
  create_patient: "bg-blue-500/15 text-blue-700",
  convert_lead: "bg-blue-500/15 text-blue-700",
  qualify_lead: "bg-amber-500/15 text-amber-700",
  update_setting: "bg-purple-500/15 text-purple-700",
};

function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? "bg-neutral-500/10 text-neutral-600";
}

function actionLabel(action: string): string {
  return action.replaceAll("_", " ");
}

function compactDt(dt: string): string {
  return dt.replace("T", " ").slice(0, 19);
}

function contextSummary(ctx: Record<string, unknown> | null): string {
  if (!ctx || typeof ctx !== "object") return "\u2014";
  const entries = Object.entries(ctx).slice(0, 3);
  if (entries.length === 0) return "\u2014";
  return entries
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : v === null ? "null" : JSON.stringify(v);
      return `${k}: ${val}`;
    })
    .join(", ");
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function entityDisplay(entityType: string | null, entityId: unknown): string {
  const entity = entityType ?? "";
  let idStr = "";
  if (typeof entityId === "string") {
    idStr = entityId.slice(0, 8);
  } else if (entityId != null) {
    idStr = String(entityId).slice(0, 8);
  }
  if (!idStr) return entity;
  return `${entity} ${idStr}\u2026`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminActivityPage() {
  const { t } = useLang();

  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterAction, setFilterAction] = useState("");
  const [search, setSearch] = useState("");

  const loadData = useCallback(async (action: string) => {
    setLoading(true);
    try {
      let url = "/admin/activity?limit=300";
      if (action) url += `&action=${encodeURIComponent(action)}`;
      const data = await apiFetch<ActivityRow[]>(url);
      setActivities(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData(filterAction);
  }, [loadData, filterAction]);

  // Unique action values for filter
  const actionOptions = useMemo(() => {
    const set = new Set(activities.map((a) => a.action));
    return Array.from(set).sort();
  }, [activities]);

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search) return activities;
    const q = search.toLowerCase();
    return activities.filter(
      (a) =>
        a.user_name.toLowerCase().includes(q) ||
        a.user_email.toLowerCase().includes(q) ||
        a.action.toLowerCase().includes(q) ||
        (a.entity_type ?? "").toLowerCase().includes(q),
    );
  }, [activities, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">{t.activity_title}</h1>
        <p className="text-muted-foreground text-sm">{t.activity_subtitle}</p>
      </div>

      {loading ? (
        <p className="text-muted-foreground py-12 text-center">
          {t.common_loading}
        </p>
      ) : (
        <div className="bg-white rounded-xl border">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b">
            <h2 className="text-lg font-medium">
              {t.activity_title} ({filtered.length})
            </h2>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder={t.search_placeholder}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 max-w-[220px]"
              />
              <Select
                value={filterAction}
                onValueChange={(v) => setFilterAction(v && v !== "__all__" ? v : "")}
              >
                <SelectTrigger className="h-8 w-[200px]">
                  <SelectValue placeholder={t.providers_all} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t.providers_all}</SelectItem>
                  {actionOptions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {actionLabel(a)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.activity_time}</TableHead>
                <TableHead>{t.activity_user}</TableHead>
                <TableHead>{t.activity_action}</TableHead>
                <TableHead>{t.activity_entity}</TableHead>
                <TableHead>{t.activity_details}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((a, idx) => {
                const details = contextSummary(a.context);
                return (
                  <TableRow key={idx}>
                    <TableCell className="font-mono text-muted-foreground text-xs whitespace-nowrap">
                      {compactDt(a.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                          {initials(a.user_name)}
                        </div>
                        <div>
                          <div className="text-sm font-medium leading-tight">
                            {a.user_name}
                          </div>
                          <div className="text-muted-foreground text-[11px]">
                            {a.user_email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={actionColor(a.action)}
                      >
                        {actionLabel(a.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground text-xs">
                      {entityDisplay(a.entity_type, a.entity_id)}
                    </TableCell>
                    <TableCell
                      className="text-muted-foreground max-w-[300px] truncate text-xs"
                      title={details}
                    >
                      {details}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
