import { memo } from "react";

import { appointmentSectionCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentDetail,
  ConciergeServiceEntry,
  ReportSummary,
  StaffOption,
  TaskEntry,
  ReminderEntry,
  ProviderSummary,
} from "@/pages/appointments/model/types";
import { MemoizedAppointmentBillingHandoffSection } from "@/pages/appointments/ui/sections/billing-handoff-section";
import { MemoizedAppointmentConciergeSection } from "@/pages/appointments/ui/sections/concierge-section";
import { EmptyState } from "@/pages/appointments/ui/shared/workspace-primitives";

type AppointmentServicesSectionProps = {
  detail: AppointmentDetail;
  detailServices: ConciergeServiceEntry[];
  detailReport: ReportSummary | null;
  reportReviewMeta: string;
  interpreterReportReady: boolean;
  serviceAccess: {
    canShowConciergeSection: boolean;
    canShowBillingHandoffSection: boolean;
    canManageConciergeServices: boolean;
    canManageConciergeBilling: boolean;
    canCreateTasks: boolean;
  };
  nonMedicalProviders: ProviderSummary[];
  conciergeStaff: StaffOption[];
  billingStaff: StaffOption[];
  billingHandoffReminders: ReminderEntry[];
  billingHandoffTasks: TaskEntry[];
  openBillingHandoffTasks: TaskEntry[];
  readyConciergeServices: ConciergeServiceEntry[];
  settledConciergeServices: ConciergeServiceEntry[];
  billingReadinessWarnings: string[];
  onRefresh: () => void;
  onError: (message: string) => void;
};

function AppointmentServicesSection({
  detail,
  detailServices,
  detailReport,
  reportReviewMeta,
  interpreterReportReady,
  serviceAccess,
  nonMedicalProviders,
  conciergeStaff,
  billingStaff,
  billingHandoffReminders,
  billingHandoffTasks,
  openBillingHandoffTasks,
  readyConciergeServices,
  settledConciergeServices,
  billingReadinessWarnings,
  onRefresh,
  onError,
}: AppointmentServicesSectionProps) {
  const {
    canShowConciergeSection,
    canShowBillingHandoffSection,
    canManageConciergeServices,
    canManageConciergeBilling,
    canCreateTasks,
  } = serviceAccess;
  const hasServicesContent =
    canShowConciergeSection || canShowBillingHandoffSection;
  const servicesEmpty = appointmentText(
    "Für diesen Termin sind keine Service- oder Billing-Blöcke verfügbar.",
    "Для этого приёма нет сервисных или billing-блоков.",
    "No service or billing surfaces are available for this appointment.",
  );

  if (!hasServicesContent) {
    return (
      <section className={appointmentSectionCardClassName("p-5")}>
        <EmptyState text={servicesEmpty} />
      </section>
    );
  }

  return (
    <>
      {canShowConciergeSection ? (
        <MemoizedAppointmentConciergeSection
          detail={detail}
          services={detailServices}
          nonMedicalProviders={nonMedicalProviders}
          conciergeStaff={conciergeStaff}
          canManageConciergeServices={canManageConciergeServices}
          canManageConciergeBilling={canManageConciergeBilling}
          onRefresh={onRefresh}
          onError={onError}
        />
      ) : null}
      {canShowBillingHandoffSection ? (
        <MemoizedAppointmentBillingHandoffSection
          detail={detail}
          detailReport={detailReport}
          reportReviewMeta={reportReviewMeta}
          interpreterReportReady={interpreterReportReady}
          serviceCount={detailServices.length}
          billingStaff={billingStaff}
          reminders={billingHandoffReminders}
          tasks={billingHandoffTasks}
          openTasks={openBillingHandoffTasks}
          readyServices={readyConciergeServices}
          settledServices={settledConciergeServices}
          warnings={billingReadinessWarnings}
          canManageConciergeBilling={canManageConciergeBilling}
          canCreateTasks={canCreateTasks}
          onRefresh={onRefresh}
          onError={onError}
        />
      ) : null}
    </>
  );
}

export const MemoizedAppointmentServicesSection = memo(
  AppointmentServicesSection,
);
