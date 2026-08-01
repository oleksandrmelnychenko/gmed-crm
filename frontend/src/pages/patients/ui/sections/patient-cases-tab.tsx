import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import {
  DataTablePager,
  useDataTablePagination,
} from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import {
  EmptyCell,
  TabLoader,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { CaseItem } from "../../model/detail-tab-types";

const CASE_TAB_LABELS = {
  manager: { de: "Manager", ru: "Менеджер" },
  updated: { de: "Aktualisiert", ru: "Обновлено" },
} as const;

type PatientCasesDictionary = {
  cases_title: string;
  common_not_set: string;
};

type PatientCasesTabProps = {
  cases: CaseItem[];
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenCase: (caseId: string) => void;
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientCasesDictionary;
  tabLoading: boolean;
};

export function PatientCasesTab({
  cases,
  emptyLabel,
  formatDate,
  onOpenCase,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientCasesTabProps) {
  const { t: dict, lang } = useLang();
  const labelLang = lang === "de" ? "de" : "ru";
  const pagination = useDataTablePagination(
    cases,
    cases.map((item) => item.id).join(":"),
  );
  const columns = useMemo<ColumnDef<CaseItem>[]>(
    () => [
      {
        id: "case_id",
        label: dict.cases_clinical_case_id,
        accessor: (item) => item.case_id,
        sortable: true,
        searchable: true,
        required: true,
        width: 180,
        render: (item) => (
          <span className="font-mono text-xs text-foreground">{item.case_id}</span>
        ),
      },
      {
        id: "reason",
        label: dict.cases_reason,
        accessor: (item) => item.hauptanfragegrund ?? "",
        searchable: true,
        width: 300,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {item.hauptanfragegrund?.trim() || t.common_not_set}
          </span>
        ),
      },
      {
        id: "zuweiser",
        label: dict.cases_referrer,
        accessor: (item) => item.zuweiser ?? "",
        filterType: "text",
        sortable: true,
        width: 200,
        render: (item) => (
          <span className="block truncate text-xs text-foreground">
            {item.zuweiser?.trim() || t.common_not_set}
          </span>
        ),
      },
      {
        id: "manager",
        label: CASE_TAB_LABELS.manager[labelLang],
        accessor: (item) => item.manager_name ?? "",
        filterType: "text",
        sortable: true,
        width: 180,
        render: (item) => (
          <span className="block truncate text-xs text-foreground">
            {item.manager_name?.trim() || t.common_not_set}
          </span>
        ),
      },
      {
        id: "status",
        label: dict.users_status,
        accessor: (item) => statusLabel(item.status),
        sortable: true,
        width: 160,
        render: (item) => (
          <Badge
            variant="outline"
            className={cn("rounded-full font-mono text-[10px]", statusColors[item.status] ?? "")}
          >
            {statusLabel(item.status)}
          </Badge>
        ),
      },
      {
        id: "created_at",
        label: dict.users_created,
        accessor: (item) => item.created_at,
        sortable: true,
        filterType: "date",
        width: 150,
        render: (item) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDate(item.created_at)}
          </span>
        ),
      },
      {
        id: "updated_at",
        label: CASE_TAB_LABELS.updated[labelLang],
        accessor: (item) => item.updated_at ?? "",
        sortable: true,
        filterType: "date",
        width: 150,
        render: (item) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDate(item.updated_at)}
          </span>
        ),
      },
    ],
    [dict, formatDate, labelLang, statusColors, statusLabel, t.common_not_set],
  );

  return (
    <TabsContent value="cases" className="space-y-4 mt-4 min-h-[400px]">
        {tabLoading ? (
          <TabLoader />
        ) : cases.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <DataTableSurface
            rows={pagination.pagedRows}
            columns={columns}
            rowId={(item) => item.id}
            dictionary={dict as unknown as Record<string, string>}
            emptyState={<EmptyCell>{emptyLabel}</EmptyCell>}
            onRowClick={(item) => onOpenCase(item.id)}
            toolbarAfter={
              <DataTablePager
                pageIndex={pagination.pageIndex}
                pageSize={pagination.pageSize}
                totalPages={pagination.totalPages}
                totalRows={pagination.totalRows}
                previousLabel={dict.pagination_previous}
                nextLabel={dict.pagination_next}
                onPageChange={pagination.onPageChange}
              />
            }
          />
        )}
    </TabsContent>
  );
}
