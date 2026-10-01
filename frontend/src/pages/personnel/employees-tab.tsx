import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderLock, Inbox, Search } from "lucide-react";

import { AdminTableCard } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import type { ColumnDef } from "@/components/data-table/types";
import { Banner, STATUS_TONE, StatusBadge, TabLoader } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

import { personnelApi, type PersonnelEmployeeList, type PersonnelEmployeeRow } from "./api";
import {
  filterEmployees,
  formatEmploymentPeriod,
  formatMonth,
  type EmployeeStatusFilter,
} from "./model";
import { categoryLabel, errorMessage } from "./personnel-ui";

export function EmployeesTab({ onOpenIntake }: { onOpenIntake: () => void }) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { staffGo } = useStaffNavigate();
  const [data, setData] = useState<PersonnelEmployeeList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<EmployeeStatusFilter>("active");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    personnelApi
      .employees()
      .then(setData)
      .catch((reason: unknown) => setError(errorMessage(reason, t.common_failed_load)))
      .finally(() => setLoading(false));
  }, [t.common_failed_load]);

  useEffect(() => load(), [load]);

  const rows = useMemo(
    () => filterEmployees(data?.employees ?? [], status, search),
    [data, search, status],
  );
  const previousMonth = formatMonth(data?.previous_month);

  const columns = useMemo<ColumnDef<PersonnelEmployeeRow>[]>(
    () => [
      {
        id: "name",
        label: t.personnel_employee,
        accessor: (row) => `${row.last_name} ${row.first_name}`,
        sortable: true,
        width: 260,
        pinned: "left",
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{row.display_name}</p>
            {row.user_name ? (
              <p className="truncate text-xs text-muted-foreground">{row.user_name}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: "personnel_number",
        label: t.personnel_number,
        accessor: (row) => row.personnel_number ?? "",
        sortable: true,
        width: 140,
        render: (row) => (
          <span className="font-mono text-xs">{row.personnel_number || "—"}</span>
        ),
      },
      {
        id: "employment",
        label: t.personnel_employment_period,
        accessor: (row) => row.employment_start ?? "",
        sortable: true,
        width: 220,
        render: (row) => (
          <span className="text-xs">
            {formatEmploymentPeriod(row.employment_start, row.employment_end, t.personnel_since) || "—"}
          </span>
        ),
      },
      {
        id: "status",
        label: t.personnel_status,
        accessor: (row) => (row.is_active ? "active" : "former"),
        sortable: true,
        width: 130,
        render: (row) => (
          <StatusBadge tone={row.is_active ? "success" : "neutral"}>
            {row.is_active ? t.personnel_status_active : t.personnel_status_former}
          </StatusBadge>
        ),
      },
      {
        id: "documents",
        label: t.personnel_documents_count,
        accessor: (row) => row.document_count,
        sortable: true,
        width: 120,
        align: "right",
        render: (row) => <span className="font-mono text-xs tabular-nums">{row.document_count}</span>,
      },
      {
        id: "last_archived",
        label: t.personnel_last_archived,
        accessor: (row) => row.last_archived_at ?? "",
        sortable: true,
        width: 170,
        render: (row) => (
          <span className="text-xs">{row.last_archived_at ? formatAppDateTime(row.last_archived_at) : "—"}</span>
        ),
      },
      {
        id: "missing",
        label: formatUiText(t.personnel_missing_for_month, { month: previousMonth }),
        accessor: (row) => row.missing_previous_month.length,
        sortable: true,
        width: 260,
        render: (row) =>
          row.missing_previous_month.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {row.missing_previous_month.map((code) => (
                <StatusBadge key={code} tone="error">
                  {categoryLabel(t, code)}
                </StatusBadge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [previousMonth, t],
  );

  return (
    <div className="space-y-3">
      {data && data.pending_intake > 0 ? (
        <div
          role="status"
          className={cn(
            "flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 text-sm",
            STATUS_TONE.info,
          )}
        >
          <span className="flex items-center gap-2">
            <Inbox className="size-4 shrink-0" />
            {formatUiText(t.personnel_intake_banner, { count: data.pending_intake })}
          </span>
          <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg bg-card" onClick={onOpenIntake}>
            {t.personnel_intake_open}
          </Button>
        </div>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading && !data ? <TabLoader /> : null}
      {data ? (
        <AdminTableCard>
          <DataTableSurface
            rows={rows}
            columns={columns}
            rowId={(row) => row.id}
            defaultDensity="comfortable"
            defaultFrozenColumns={["name"]}
            dictionary={tr}
            storageKey="personnel-employees"
            mobilePrimaryColumnId="name"
            mobileDetailColumnIds={["status", "personnel_number", "employment", "documents", "missing"]}
            onRowClick={(row) => staffGo(`/personnel/${row.id}`)}
            toolbarStart={
              <>
                <ToolbarField label={t.common_search} className="min-w-[220px] flex-1 sm:max-w-sm">
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
                <ToolbarField label={t.personnel_status} className="w-44">
                  <NativeComboboxSelect
                    value={status}
                    aria-label={t.personnel_status}
                    className="h-8 rounded-md bg-field text-xs"
                    onChange={(event) => setStatus(event.target.value as EmployeeStatusFilter)}
                  >
                    <option value="active">{t.personnel_filter_active}</option>
                    <option value="former">{t.personnel_filter_former}</option>
                    <option value="all">{t.personnel_filter_all}</option>
                  </NativeComboboxSelect>
                </ToolbarField>
              </>
            }
            emptyState={
              <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
                <FolderLock className="size-5" />
                <span className="text-sm">{t.personnel_employees_empty}</span>
              </div>
            }
          />
        </AdminTableCard>
      ) : null}
    </div>
  );
}
