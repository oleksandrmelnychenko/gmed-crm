import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Plus } from "lucide-react";

import type { OrderItem } from "../../model/detail-tab-types";

const ORDER_TAB_LABELS = {
  period: { de: "Zeitraum", ru: "Период" },
} as const;

function orderAmount(item: OrderItem) {
  const raw = item.total_actual ?? item.total_estimated;
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return `${value.toFixed(2)} ${item.currency || "EUR"}`;
}

type PatientOrdersDictionary = {
  orders_title: string;
};

type PatientOrdersTabProps = {
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onCreateOrder?: () => void;
  onOpenOrder: (orderId: string) => void;
  orderPhaseLabel: (value: string) => string;
  orders: OrderItem[];
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientOrdersDictionary;
  tabLoading: boolean;
};

export function PatientOrdersTab({
  emptyLabel,
  formatDate,
  onCreateOrder,
  onOpenOrder,
  orderPhaseLabel,
  orders,
  statusColors,
  statusLabel,
  tabLoading,
}: PatientOrdersTabProps) {
  const { t: dict, lang } = useLang();
  const labelLang = lang === "de" ? "de" : "ru";
  const pagination = useDataTablePagination(
    orders,
    orders.map((item) => item.id).join(":"),
  );
  const orderNumberLabel = dict.uiText["orders_auftrag"] ?? "orders_auftrag";
  const columns = useMemo<ColumnDef<OrderItem>[]>(
    () => [
      {
        id: "order_number",
        label: orderNumberLabel,
        accessor: (item) => item.order_number,
        sortable: true,
        searchable: true,
        required: true,
        width: 180,
        render: (item) => (
          <span className="font-mono text-xs tracking-[0.12em] text-foreground">
            {item.order_number}
          </span>
        ),
      },
      {
        id: "needs",
        label: dict.leads_needs,
        accessor: (item) => item.needs_description ?? "",
        searchable: true,
        width: 520,
        render: (item) => {
          // needs_description carries the labeled intake summary from the lead
          // wizard; the table shows only the concern line, the rest lives in
          // the tooltip.
          const concern = (item.needs_description ?? "")
            .split("\n")
            .map((line) => line.trim())
            .find((line) => line.length > 0 && !/^[^:]{1,40}:/.test(line));
          const firstLine = (item.needs_description ?? "").split("\n")[0]?.trim();
          return (
            <span
              className="block truncate text-xs text-foreground"
              title={item.needs_description ?? undefined}
            >
              {concern || firstLine || dict.common_not_set}
            </span>
          );
        },
      },
      {
        id: "phase",
        label: dict.orders_phase,
        accessor: (item) => orderPhaseLabel(item.phase),
        sortable: true,
        width: 170,
        render: (item) => (
          <Badge variant="outline" className="rounded-full font-mono text-[10px]">
            {orderPhaseLabel(item.phase)}
          </Badge>
        ),
      },
      {
        id: "status",
        label: dict.users_status,
        accessor: (item) => statusLabel(item.status),
        sortable: true,
        width: 150,
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
        id: "amount",
        label: dict.invoices_amount,
        accessor: (item) => Number(item.total_actual ?? item.total_estimated ?? 0),
        sortable: true,
        filterType: "number",
        width: 130,
        render: (item) => {
          const amount = orderAmount(item);
          return amount ? (
            <span className="block text-right font-mono text-xs tabular-nums text-foreground">
              {amount}
            </span>
          ) : (
            <span className="block text-right text-xs text-muted-foreground">
              {dict.common_not_set}
            </span>
          );
        },
      },
      {
        id: "period",
        label: ORDER_TAB_LABELS.period[labelLang],
        accessor: (item) => item.date_from ?? "",
        sortable: true,
        filterType: "date",
        width: 190,
        render: (item) => {
          const period = [
            item.date_from ? formatDate(item.date_from) : "",
            item.date_to ? formatDate(item.date_to) : "",
          ]
            .filter(Boolean)
            .join(" – ");
          return period ? (
            <span className="font-mono text-xs tabular-nums text-foreground">{period}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{dict.common_not_set}</span>
          );
        },
      },
      {
        id: "signed",
        label: dict.contracts_signed_at,
        accessor: (item) => item.signed_at ?? "",
        sortable: true,
        filterType: "date",
        width: 150,
        render: (item) =>
          item.signed_at ? (
            <span className="font-mono text-xs tabular-nums text-foreground">
              {formatDate(item.signed_at)}
            </span>
          ) : item.signed_patient || item.signed_agency ? (
            <Badge variant="outline" className="rounded-full font-mono text-[10px]">
              {item.signed_patient ? "P✓" : "P—"} · {item.signed_agency ? "A✓" : "A—"}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">{dict.common_not_set}</span>
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
    ],
    [dict, formatDate, labelLang, orderNumberLabel, orderPhaseLabel, statusColors, statusLabel],
  );

  return (
    <TabsContent value="orders" className="space-y-4 mt-4 min-h-[400px]">
        {onCreateOrder ? (
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={onCreateOrder}>
              <Plus className="size-4" />
              {dict.orders_create_title}
            </Button>
          </div>
        ) : null}
        {tabLoading ? (
          <TabLoader />
        ) : orders.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <DataTableSurface
            rows={pagination.pagedRows}
            columns={columns}
            rowId={(item) => item.id}
            dictionary={dict as unknown as Record<string, string>}
            emptyState={<EmptyCell>{emptyLabel}</EmptyCell>}
            onRowClick={(item) => onOpenOrder(item.id)}
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
