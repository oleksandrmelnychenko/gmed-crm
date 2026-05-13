import { lazy, Suspense } from "react";

import { Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  TabLoader,
} from "@/components/ui-shell";
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

  return (
    <TabsContent value="appointments" className="space-y-4 mt-4 min-h-[400px]">
      <FormSection
        title={t.appointments_title}
        accessory={
          <div className="flex flex-wrap items-center gap-2">
            <CountBadge>{appointments.length}</CountBadge>
            {canManage ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={handleCreateAppointment}
              >
                <Plus className="size-3.5" />
                {t.appointments_new}
              </Button>
            ) : null}
          </div>
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : appointments.length === 0 ? (
          <EmptyCell>{emptyLabel}</EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {appointments.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onOpenAppointment(item.id)}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors hover:border-border hover:bg-muted/30"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {appointmentTypeLabel(item.apt_type)}
                    </span>
                    <Badge
                      variant="outline"
                      className="rounded-full text-[10px] border-violet-200 bg-violet-50 text-violet-700"
                    >
                      {appointmentCarePathKindLabel(item.care_path_kind)}
                    </Badge>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
                  >
                    {statusLabel(item.status)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-medium text-foreground">{item.title}</p>
                <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(item.date)}</span>
                  {item.time_start ? <span>{item.time_start}</span> : null}
                  {item.provider_name ? <span>· {item.provider_name}</span> : null}
                </div>
              </button>
            ))}
          </div>
        )}
      </FormSection>
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
