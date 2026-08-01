import { lazy, Suspense, useMemo } from "react";

import { Plus } from "lucide-react";

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

import type { AppointmentItem } from "../../model/detail-tab-types";

const loadPatientAppointmentSheet = () => import("../sheets/patient-appointment-sheet");

const LazyPatientAppointmentSheet = lazy(async () => {
  const mod = await loadPatientAppointmentSheet();
  return { default: mod.PatientAppointmentSheet };
});

type PatientAppointmentsDictionary = {
  appointments_new: string;
  appointments_title: string;
};

type PatientAppointmentsTabProps = {
  appointmentCarePathKindLabel: (value?: string | null) => string;
  appointmentSheetOpen: boolean;
  appointmentTypeLabel: (value: string) => string;
  appointments: AppointmentItem[];
  canManage: boolean;
  emptyLabel: string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onAppointmentSheetOpenChange: (open: boolean) => void;
  onOpenAppointment: (appointmentId: string) => void;
  patientId?: string;
  reload: () => void;
  statusColors: Record<string, string>;
  statusLabel: (status: string) => string;
  t: PatientAppointmentsDictionary;
  tabLoading: boolean;
};

export function PatientAppointmentsTab({
  appointmentCarePathKindLabel,
  appointmentSheetOpen,
  appointmentTypeLabel,
  appointments,
  canManage,
  emptyLabel,
  formatDate,
  onAppointmentSheetOpenChange,
  onOpenAppointment,
  patientId,
  reload,
  statusColors,
  statusLabel,
  t,
  tabLoading,
}: PatientAppointmentsTabProps) {
  const { t: dict } = useLang();
  const appointmentPagination = useDataTablePagination(
    appointments,
    patientId ?? "",
  );
  const handleAppointmentSheetOpenChange = (open: boolean) => {
    if (open) {
      void loadPatientAppointmentSheet();
    }
    onAppointmentSheetOpenChange(open);
  };

  const handleCreateAppointment = () => {
    void loadPatientAppointmentSheet();
    onAppointmentSheetOpenChange(true);
  };

  const columns = useMemo<ColumnDef<AppointmentItem>[]>(
    () => [
      {
        id: "title",
        label: dict.appointments_title_col,
        accessor: (item) => item.title,
        sortable: true,
        searchable: true,
        required: true,
        width: 260,
        render: (item) => (
          <span className="block truncate text-xs font-medium text-foreground">{item.title}</span>
        ),
      },
      {
        id: "date",
        label: dict.appointments_date,
        accessor: (item) => `${item.date} ${item.time_start ?? ""}`.trim(),
        sortable: true,
        width: 170,
        render: (item) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 font-mono text-xs tabular-nums text-foreground">
              {formatDate(item.date)}
            </span>
            {item.time_start ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {item.time_start}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: "type",
        label: dict.appointments_type,
        accessor: (item) => appointmentTypeLabel(item.apt_type),
        sortable: true,
        width: 300,
        render: (item) => (
          <div className="flex min-w-0 items-center gap-1.5">
            <Badge variant="outline" className="rounded-full font-mono text-[10px]">
              {appointmentTypeLabel(item.apt_type)}
            </Badge>
            <Badge
              variant="outline"
              className="rounded-full border-violet-200 bg-violet-50 font-mono text-[10px] text-violet-700"
            >
              {appointmentCarePathKindLabel(item.care_path_kind)}
            </Badge>
          </div>
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
        id: "provider",
        label: dict.common_provider,
        accessor: (item) => item.provider_name ?? "",
        searchable: true,
        sortable: true,
        width: 220,
        render: (item) => (
          <span className="block truncate font-mono text-xs text-foreground">
            {item.provider_name || dict.common_not_set}
          </span>
        ),
      },
    ],
    [appointmentCarePathKindLabel, appointmentTypeLabel, dict, formatDate, statusColors, statusLabel],
  );

  return (
    <TabsContent value="appointments" className="space-y-4 mt-4 min-h-[400px]">
        {tabLoading ? (
          <TabLoader />
        ) : appointments.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <DataTableSurface
            rows={appointmentPagination.pagedRows}
            columns={columns}
            rowId={(item) => item.id}
            dictionary={dict as unknown as Record<string, string>}
            emptyState={<EmptyCell>{emptyLabel}</EmptyCell>}
            onRowClick={(item) => onOpenAppointment(item.id)}
            toolbarStart={
              <>
                {canManage ? (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 shrink-0 rounded-lg gap-1.5"
                    onClick={handleCreateAppointment}
                  >
                    <Plus className="size-3.5" />
                    {t.appointments_new}
                  </Button>
                ) : null}
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
              </>
            }
            toolbarAfter={
              <DataTablePager
                pageIndex={appointmentPagination.pageIndex}
                pageSize={appointmentPagination.pageSize}
                totalPages={appointmentPagination.totalPages}
                totalRows={appointmentPagination.totalRows}
                previousLabel={dict.pagination_previous}
                nextLabel={dict.pagination_next}
                onPageChange={appointmentPagination.onPageChange}
              />
            }
          />
        )}
      {patientId && canManage && appointmentSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientAppointmentSheet
            patientId={patientId}
            open={appointmentSheetOpen}
            onOpenChange={handleAppointmentSheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}
    </TabsContent>
  );
}
