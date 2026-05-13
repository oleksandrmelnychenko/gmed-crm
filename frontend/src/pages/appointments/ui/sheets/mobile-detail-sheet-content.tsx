import { memo } from "react";
import { LoaderCircle } from "lucide-react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import { Banner } from "@/components/ui-shell";
import {
  SheetContent,
} from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentAttentionItem,
  AppointmentCommunicationEntry,
  AppointmentDetail,
  AppointmentListItem,
  AppointmentPermissions,
  AppointmentTimelineEvent,
  ChecklistItem,
  ConciergeServiceEntry,
  HandoffStakeholder,
  InterpreterOption,
  LinkedPreviewKind,
  ProviderSummary,
  ReminderEntry,
  ReportSummary,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import { MemoizedAppointmentAttentionSection } from "@/pages/appointments/ui/sections/attention-section";
import { MemoizedAppointmentBillingHandoffSection } from "@/pages/appointments/ui/sections/billing-handoff-section";
import {
  MemoizedAppointmentFindingsSection,
  MemoizedAppointmentIncomingDataSection,
} from "@/pages/appointments/ui/sections/clinical-follow-up-sections";
import { MemoizedAppointmentConciergeSection } from "@/pages/appointments/ui/sections/concierge-section";
import { MemoizedEditAppointmentSection } from "@/pages/appointments/ui/sections/edit-appointment-section";
import { MemoizedAppointmentExternalHandoffSection } from "@/pages/appointments/ui/sections/external-handoff-section";
import { MemoizedAppointmentFollowUpVisitSection } from "@/pages/appointments/ui/sections/follow-up-visit-section";
import { MemoizedAppointmentHandoffSection } from "@/pages/appointments/ui/sections/handoff-section";
import { MemoizedAppointmentLinksSection } from "@/pages/appointments/ui/sections/links-section";
import { MemoizedAppointmentNotesSection } from "@/pages/appointments/ui/sections/notes-section";
import { MemoizedAppointmentOverviewSection } from "@/pages/appointments/ui/sections/overview-section";
import { MemoizedAppointmentReportSection } from "@/pages/appointments/ui/sections/report-section";
import { MemoizedAppointmentSnapshotSection } from "@/pages/appointments/ui/sections/snapshot-section";
import { MemoizedAppointmentTimelineSection } from "@/pages/appointments/ui/sections/timeline-section";
import {
  MemoizedAppointmentDoctorFollowUpSection,
  MemoizedAppointmentPackageEndSection,
} from "@/pages/appointments/ui/sections/workflow-follow-up-sections";
import {
  MemoizedAppointmentChecklistSection,
  MemoizedAppointmentCompletionSection,
  MemoizedAppointmentInterpreterSection,
  MemoizedAppointmentRemindersSection,
  MemoizedAppointmentStatusSection,
  MemoizedAppointmentTasksSection,
} from "@/pages/appointments/ui/sections/workflow-surfaces";

export type AppointmentMobileDetailSheetContentProps = {
  detailLoading: boolean;
  detailError: string;
  detail: AppointmentDetail | null;
  detailVersion: number;
  detailAttention: AppointmentAttentionItem | null;
  timelineEvents: AppointmentTimelineEvent[];
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  permissions: AppointmentPermissions;
  currentUserId?: string;
  detailDefaultAssigneeId: string;
  doctorFollowUpAssignees: StaffOption[];
  handoffStakeholders: HandoffStakeholder[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  detailChecklist: ChecklistItem[];
  detailReminders: ReminderEntry[];
  detailTasks: TaskEntry[];
  detailServices: ConciergeServiceEntry[];
  detailReport: ReportSummary | null;
  doctorDirectedReminders: ReminderEntry[];
  doctorDirectedTasks: TaskEntry[];
  incomingDataChecklist: ChecklistItem[];
  incomingDataReminders: ReminderEntry[];
  incomingDataTasks: TaskEntry[];
  packageEndReminders: ReminderEntry[];
  packageEndTasks: TaskEntry[];
  externalCommunicationEntries: AppointmentCommunicationEntry[];
  externalHandoffReminders: ReminderEntry[];
  externalHandoffTasks: TaskEntry[];
  findingsChecklist: ChecklistItem[];
  findingsReminders: ReminderEntry[];
  findingsTasks: TaskEntry[];
  openChecklistCount: number;
  openTaskCount: number;
  pendingReminderCount: number;
  interpreterReportReady: boolean;
  completionWarnings: string[];
  taskAssignableStaff: StaffOption[];
  reportReviewMeta: string;
  detailDisplay: {
    canSubmitInterpreterReport: boolean;
    canResubmitRejectedReport: boolean;
    showReportReviewActions: boolean;
    canShowConciergeSection: boolean;
    canShowBillingHandoffSection: boolean;
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
  openDetailSheet: (id: string) => void;
  openLinkedPreview: (kind: LinkedPreviewKind, label: string) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onFollowUpVisitCreated: (payload: { id?: string; notice: string }) => void;
  onEditSaved: (notice: string) => void;
};

function useAppointmentMobileDetailSheetContentContent({
  detailLoading,
  detailError,
  detail,
  detailVersion,
  detailAttention,
  timelineEvents,
  appointments,
  providers,
  staff,
  interpreters,
  permissions,
  currentUserId,
  detailDefaultAssigneeId,
  doctorFollowUpAssignees,
  handoffStakeholders,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  detailChecklist,
  detailReminders,
  detailTasks,
  detailServices,
  detailReport,
  doctorDirectedReminders,
  doctorDirectedTasks,
  incomingDataChecklist,
  incomingDataReminders,
  incomingDataTasks,
  packageEndReminders,
  packageEndTasks,
  externalCommunicationEntries,
  externalHandoffReminders,
  externalHandoffTasks,
  findingsChecklist,
  findingsReminders,
  findingsTasks,
  openChecklistCount,
  openTaskCount,
  pendingReminderCount,
  interpreterReportReady,
  completionWarnings,
  taskAssignableStaff,
  reportReviewMeta,
  detailDisplay,
  nonMedicalProviders,
  conciergeStaff,
  billingStaff,
  billingHandoffReminders,
  billingHandoffTasks,
  openBillingHandoffTasks,
  readyConciergeServices,
  settledConciergeServices,
  billingReadinessWarnings,
  openDetailSheet,
  openLinkedPreview,
  onRefresh,
  onError,
  onNotice,
  onFollowUpVisitCreated,
  onEditSaved,
}: AppointmentMobileDetailSheetContentProps) {
  const { t } = useLang();
  const {
    canSubmitInterpreterReport,
    canResubmitRejectedReport,
    showReportReviewActions,
    canShowConciergeSection,
    canShowBillingHandoffSection,
  } = detailDisplay;

  return (
    <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[860px]">
      <AdminSheetScaffold
        title={t.appointments_title}
        headerClassName="px-4 py-3"
        bodyClassName="flex-1 overflow-y-auto overscroll-y-contain px-4 pb-6 pt-4"
      >
        {detailLoading ? (
            <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
              <LoaderCircle className="mr-2 size-4 animate-spin" />
              {appointmentText("appointments_loading_appointment")}
            </div>
          ) : detailError ? (
            <div className="pt-5">
              <Banner tone="error" withIcon>{detailError}</Banner>
            </div>
          ) : detail ? (
            <div className="space-y-6 pt-5">
              <MemoizedAppointmentOverviewSection
                detail={detail}
                onOpenDetail={openDetailSheet}
              />
              <MemoizedAppointmentSnapshotSection detail={detail} />
              {detailAttention ? (
                <MemoizedAppointmentAttentionSection attention={detailAttention} />
              ) : null}
              <MemoizedAppointmentLinksSection
                detail={detail}
                onOpenPreview={openLinkedPreview}
              />
              <MemoizedAppointmentTimelineSection
                key={`${detail.id}:${detailVersion}`}
                timelineEvents={timelineEvents}
              />

              {!detail.is_blocked ? (
                <MemoizedAppointmentHandoffSection
                  detail={detail}
                  handoffStakeholders={handoffStakeholders}
                  followUpAssigneeId={followUpAssigneeId}
                  setFollowUpAssigneeId={setFollowUpAssigneeId}
                  canManageReminders={permissions.canManageReminders}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {!detail.is_blocked && permissions.canCreate ? (
                <MemoizedAppointmentFollowUpVisitSection
                  detail={detail}
                  appointments={appointments}
                  providers={providers}
                  staff={staff}
                  interpreters={interpreters}
                  defaultReminderUserId={detailDefaultAssigneeId}
                  onCreated={onFollowUpVisitCreated}
                />
              ) : null}

              {!detail.is_blocked && permissions.canViewReminders ? (
                <MemoizedAppointmentDoctorFollowUpSection
                  detail={detail}
                  reminders={doctorDirectedReminders}
                  tasks={doctorDirectedTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  canManageReminders={permissions.canManageReminders}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {!detail.is_blocked &&
              permissions.canManageChecklist &&
              permissions.canViewReminders ? (
                <MemoizedAppointmentIncomingDataSection
                  detail={detail}
                  checklist={incomingDataChecklist}
                  reminders={incomingDataReminders}
                  tasks={incomingDataTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {!detail.is_blocked &&
              permissions.canViewReminders &&
              detail.order_id ? (
                <MemoizedAppointmentPackageEndSection
                  detail={detail}
                  reminders={packageEndReminders}
                  tasks={packageEndTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  defaultTitle={t.appointments_new ?? ""}
                  canManageReminders={permissions.canManageReminders}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {!detail.is_blocked &&
              permissions.canViewCommunications &&
              (detail.provider_id || detail.doctor_id) ? (
                <MemoizedAppointmentExternalHandoffSection
                  detail={detail}
                  communications={externalCommunicationEntries}
                  reminders={externalHandoffReminders}
                  tasks={externalHandoffTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  canManageCommunications={permissions.canManageCommunications}
                  canViewReminders={permissions.canViewReminders}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {!detail.is_blocked &&
              permissions.canManageChecklist &&
              permissions.canViewReminders &&
              (detail.provider_id || detail.doctor_id) ? (
                <MemoizedAppointmentFindingsSection
                  detail={detail}
                  checklist={findingsChecklist}
                  reminders={findingsReminders}
                  tasks={findingsTasks}
                  assignees={doctorFollowUpAssignees}
                  defaultAssigneeId={detailDefaultAssigneeId}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {permissions.canManageStatus ||
              permissions.canAssignInterpreter ||
              (permissions.canRespondToAssignment &&
                detail.interpreter_id === currentUserId) ||
              permissions.canManageChecklist ||
              permissions.canViewReminders ? (
                <>
                  {permissions.canManageStatus ? (
                    <MemoizedAppointmentCompletionSection
                      detail={detail}
                      detailReport={detailReport}
                      handoffStakeholders={handoffStakeholders}
                      openChecklistCount={openChecklistCount}
                      openTaskCount={openTaskCount}
                      pendingReminderCount={pendingReminderCount}
                      interpreterReportReady={interpreterReportReady}
                      completionWarnings={completionWarnings}
                      followUpAssigneeId={followUpAssigneeId}
                      setFollowUpAssigneeId={setFollowUpAssigneeId}
                      onRefresh={onRefresh}
                      onError={onError}
                      onNotice={onNotice}
                    />
                  ) : null}
                  {permissions.canManageStatus ? (
                    <MemoizedAppointmentStatusSection
                      detail={detail}
                      openChecklistCount={openChecklistCount}
                      onRefresh={onRefresh}
                      onError={onError}
                    />
                  ) : null}
                  {permissions.canAssignInterpreter ||
                  (permissions.canRespondToAssignment &&
                    detail.interpreter_id === currentUserId) ? (
                    <MemoizedAppointmentInterpreterSection
                      detail={detail}
                      interpreters={interpreters}
                      currentUserId={currentUserId}
                      canAssign={permissions.canAssignInterpreter}
                      canRespond={permissions.canRespondToAssignment}
                      onRefresh={onRefresh}
                      onError={onError}
                    />
                  ) : null}
                  {permissions.canManageChecklist ? (
                    <MemoizedAppointmentChecklistSection
                      detail={detail}
                      items={detailChecklist}
                      onRefresh={onRefresh}
                      onError={onError}
                    />
                  ) : null}
                  {permissions.canViewReminders ? (
                    <MemoizedAppointmentRemindersSection
                      detail={detail}
                      reminders={detailReminders}
                      staff={staff}
                      canManageReminders={permissions.canManageReminders}
                      onRefresh={onRefresh}
                      onError={onError}
                    />
                  ) : null}
                </>
              ) : null}

              {permissions.canEditSchedule ? (
                <MemoizedEditAppointmentSection
                  detail={detail}
                  appointments={appointments}
                  providers={providers}
                  staff={staff}
                  interpreters={interpreters}
                  onSaved={onEditSaved}
                />
              ) : null}

              {permissions.canViewReport ? (
                <MemoizedAppointmentReportSection
                  detail={detail}
                  detailReport={detailReport}
                  reportReviewMeta={reportReviewMeta}
                  reportActions={{
                    canSubmitInterpreterReport,
                    canResubmitRejectedReport,
                    showReportReviewActions,
                    canApproveReport: permissions.canApproveReport,
                    canRejectReport: permissions.canRejectReport,
                  }}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {permissions.canViewTasks ? (
                <MemoizedAppointmentTasksSection
                  detail={detail}
                  tasks={detailTasks}
                  assignableStaff={taskAssignableStaff}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              {canShowConciergeSection ? (
                <MemoizedAppointmentConciergeSection
                  detail={detail}
                  services={detailServices}
                  nonMedicalProviders={nonMedicalProviders}
                  conciergeStaff={conciergeStaff}
                  canManageConciergeServices={
                    permissions.canManageConciergeServices
                  }
                  canManageConciergeBilling={permissions.canManageConciergeBilling}
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
                  canManageConciergeBilling={permissions.canManageConciergeBilling}
                  canCreateTasks={permissions.canCreateTasks}
                  onRefresh={onRefresh}
                  onError={onError}
                />
              ) : null}

              <MemoizedAppointmentNotesSection
                detail={detail}
                canViewNotes={permissions.canViewNotes}
                emptyText={t.patients_notes}
                hideWhenUnavailable
              />
            </div>
        ) : (
            <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
              {appointmentText("appointments_select_an_appointment_from_the_calendar_or_list")}
            </div>
        )}
      </AdminSheetScaffold>
    </SheetContent>
  );
}

function AppointmentMobileDetailSheetContent(...args: Parameters<typeof useAppointmentMobileDetailSheetContentContent>) {
  return useAppointmentMobileDetailSheetContentContent(...args);
}

export const MemoizedAppointmentMobileDetailSheetContent = memo(
  AppointmentMobileDetailSheetContent,
);
