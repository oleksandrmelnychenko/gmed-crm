import { useEffect, useMemo, useState } from "react";
import { KeyRound, Search, ShieldCheck, UsersRound } from "lucide-react";

import { AdminTableCard } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import { Banner, PageHeader, StatusBadge, TabLoader } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatUnknownValue, useLang } from "@/lib/i18n";

import { canManageStaffAccess } from "./employees/staff-access-model";
import { StaffAccessSheet } from "./employees/staff-access-sheet";

type StaffDirectoryEntry = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export function EmployeesPage() {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const tr = t as unknown as Record<string, string>;
  const [items, setItems] = useState<StaffDirectoryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accessEmployee, setAccessEmployee] = useState<StaffDirectoryEntry | null>(null);
  const canManageAccess = canManageStaffAccess(user?.role);
  const accessLabel = lang === "de" ? "Zugriffe" : "Доступи";
  const fullAccessLabel = lang === "de" ? "Vollständiger Systemzugriff" : "Повний системний доступ";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void apiFetch<StaffDirectoryEntry[]>("/staff-directory")
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : t.common_failed_load);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t.common_failed_load]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      `${item.name} ${item.email} ${item.role}`.toLocaleLowerCase().includes(needle),
    );
  }, [items, search]);

  const columns = useMemo<ColumnDef<StaffDirectoryEntry>[]>(
    () => [
      {
        id: "name",
        label: t.users_name,
        accessor: (row) => row.name,
        sortable: true,
        width: 280,
        pinned: "left",
        render: (row) => <span className="text-sm text-foreground">{row.name}</span>,
      },
      {
        id: "role",
        label: t.users_role,
        accessor: (row) => row.role,
        sortable: true,
        width: 190,
        render: (row) => (
          <StatusBadge tone={row.role === "ceo" ? "brand" : row.role === "billing" ? "warning" : "info"}>
            {tr[`role_${row.role}`] ?? formatUnknownValue(row.role, t)}
          </StatusBadge>
        ),
      },
      {
        id: "email",
        label: t.users_email,
        accessor: (row) => row.email,
        sortable: true,
        width: 320,
        render: (row) => <span className="font-mono text-xs text-foreground">{row.email}</span>,
      },
      {
        id: "access",
        label: accessLabel,
        accessor: (row) => row.role === "ceo" ? fullAccessLabel : "",
        sortable: false,
        width: 240,
        render: (row) => {
          if (row.role === "ceo") {
            return (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <ShieldCheck className="size-3.5" />
                {fullAccessLabel}
              </span>
            );
          }
          if (!canManageAccess) return <span className="text-muted-foreground">—</span>;
          return (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-lg"
              onClick={(event) => {
                event.stopPropagation();
                setAccessEmployee(row);
              }}
            >
              <KeyRound className="size-3.5" />
              {accessLabel}
            </Button>
          );
        },
      },
    ],
    [accessLabel, canManageAccess, fullAccessLabel, t, tr],
  );

  const title = tr.nav_interpreters ?? (lang === "de" ? "Mitarbeiter" : "Сотрудники");
  const description =
    lang === "de"
      ? canManageAccess
        ? "Arbeitskontakte und individuelle Ressourcenzugriffe."
        : "Arbeitskontakte für die operative Koordination. Nur Lesen."
      : canManageAccess
        ? "Робочі контакти та індивідуальні доступи до ресурсів."
        : "Рабочие контакты для оперативной координации. Только просмотр.";

  return (
    <div className="space-y-4">
      <PageHeader title={title} description={description} />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? <TabLoader /> : null}
      {!loading && !error ? (
        <AdminTableCard>
          <DataTableSurface
            rows={filtered}
            columns={columns}
            rowId={(row) => row.id}
            defaultDensity="comfortable"
            defaultFrozenColumns={["name"]}
            dictionary={tr}
            toolbarStart={
              <ToolbarField label={t.common_search} className="min-w-[240px] flex-1 sm:max-w-sm">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t.common_search}
                    className="h-8 rounded-md bg-field pl-8 text-xs"
                  />
                </div>
              </ToolbarField>
            }
            emptyState={
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <UsersRound className="size-5" />
                <span className="text-sm">
                  {lang === "de" ? "Keine Mitarbeiter gefunden" : "Сотрудники не найдены"}
                </span>
              </div>
            }
          />
        </AdminTableCard>
      ) : null}
      {canManageAccess ? (
        <StaffAccessSheet
          open={Boolean(accessEmployee)}
          employee={accessEmployee}
          onClose={() => setAccessEmployee(null)}
        />
      ) : null}
    </div>
  );
}
