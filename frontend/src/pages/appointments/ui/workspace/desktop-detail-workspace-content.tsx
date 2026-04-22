import { Suspense, lazy, memo } from "react";
import { LoaderCircle } from "lucide-react";

import { Banner, Section } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { appointmentSectionCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  AppointmentAttentionItem,
  AppointmentCommunicationEntry,
  AppointmentDetail,
  AppointmentListItem,
  AppointmentPermissions,
  AppointmentTimelineEvent,
  AppointmentWorkspaceTab,
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
import { MemoizedAppointmentLinksSection } from "@/pages/appointments/ui/sections/links-section";
import { MemoizedAppointmentOverviewSection } from "@/pages/appointments/ui/sections/overview-section";
import { MemoizedAppointmentSnapshotSection } from "@/pages/appointments/ui/sections/snapshot-section";
import { MemoizedAppointmentTimelineSection } from "@/pages/appointments/ui/sections/timeline-section";
import { EmptyState } from "@/pages/appointments/ui/shared/workspace-primitives";

const loadClinicalSection = () =>
  import("@/pages/appointments/ui/sections/clinical-section");
const loadCoordinationSection = () =>
  import("@/pages/appointments/ui/sections/coordination-section");
const loadEditAppointmentSection = () =>
  import("@/pages/appointments/ui/sections/edit-appointment-section");
const loadNotesSection = () =>
  import("@/pages/appointments/ui/sections/notes-section");
const loadServicesSection = () =>
  import("@/pages/appointments/ui/sections/services-section");
const loadWorkflowSurfaces = () =>
  import("@/pages/appointments/ui/sections/workflow-surfaces");

const LazyClinicalSection = lazy(async () => {
  const mod = await loadClinicalSection();
  return { default: mod.MemoizedAppointmentClinicalSection };
});

const LazyCoordinationSection = lazy(async () => {
  const mod = await loadCoordinationSection();
  return { default: mod.MemoizedAppointmentCoordinationSection };
});

const LazyEditAppointmentSection = lazy(async () => {
  const mod = await loadEditAppointmentSection();
  return { default: mod.MemoizedEditAppointmentSection };
});

const LazyNotesSection = lazy(async () => {
  const mod = await loadNotesSection();
  return { default: mod.MemoizedAppointmentNotesSection };
});

const LazyServicesSection = lazy(async () => {
  const mod = await loadServicesSection();
  return { default: mod.MemoizedAppointmentServicesSection };
});

const LazyWorkflowTab = lazy(async () => {
  const mod = await loadWorkflowSurfaces();
  return { default: mod.MemoizedAppointmentWorkflowTab };
});

function loadingSection(title: string, text: string) {
  return (
    <Section title={title}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {text}
      </div>
    </Section>
  );
}

type AppointmentDesktopDetailWorkspaceContentProps = {
  detailLoading: boolean;
  detailError: string;
  detail: AppointmentDetail | null;
  detailVersion: number;
  detailTab: AppointmentWorkspaceTab;
  extendedResourcesReady: boolean;
  appointmentsNotice: string;
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
  taskAssignableStaff: StaffOption[];
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
  reportReviewMeta: string;
  canSubmitInterpreterReport: boolean;
  canResubmitRejectedReport: boolean;
  showReportReviewActions: boolean;
  canShowConciergeSection: boolean;
  canShowBillingHandoffSection: boolean;
  nonMedicalProviders: ProviderSummary[];
  conciergeStaff: StaffOption[];
  billingStaff: StaffOption[];
  billingHandoffReminders: ReminderEntry[];
  billingHandoffTasks: TaskEntry[];
  openBillingHandoffTasks: TaskEntry[];
  readyConciergeServices: ConciergeServiceEntry[];
  settledConciergeServices: ConciergeServiceEntry[];
  billingReadinessWarnings: string[];
  onOpenDetail: (id: string) => void;
  onOpenPreview: (kind: LinkedPreviewKind, label: string) => void;
  onRefresh: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onEditSaved: (notice: string) => void;
  onFollowUpVisitCreated: (payload: { id?: string; notice: string }) => void;
};

function AppointmentDesktopDetailWorkspaceContent({
  detailLoading,
  detailError,
  detail,
  detailVersion,
  detailTab,
  extendedResourcesReady,
  appointmentsNotice,
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
  taskAssignableStaff,
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
  reportReviewMeta,
  canSubmitInterpreterReport,
  canResubmitRejectedReport,
  showReportReviewActions,
  canShowConciergeSection,
  canShowBillingHandoffSection,
  nonMedicalProviders,
  conciergeStaff,
  billingStaff,
  billingHandoffReminders,
  billingHandoffTasks,
  openBillingHandoffTasks,
  readyConciergeServices,
  settledConciergeServices,
  billingReadinessWarnings,
  onOpenDetail,
  onOpenPreview,
  onRefresh,
  onError,
  onNotice,
  onEditSaved,
  onFollowUpVisitCreated,
}: AppointmentDesktopDetailWorkspaceContentProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  if (detailLoading) {
    return (
      <div className="flex min-h-[320px] items-center justify-center text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        {appointmentText(
          "Termin wird geladen",
          "Загрузка приёма",
          "Loading appointment",
        )}
      </div>
    );
  }

  if (detailError) {
    return <Banner tone="error" withIcon>{detailError}</Banner>;
  }

  if (!detail) {
    return (
      <section className={appointmentSectionCardClassName("p-5")}>
        <EmptyState
          text={appointmentText(
            "Termin im Kalender oder in der Liste auswahlen.",
            "Выберите приём в календаре или списке.",
            "Select an appointment from the calendar or list.",
          )}
        />
      </section>
    );
  }

  const coordinationEmpty = appointmentText(
    "Für diesen Termin sind keine Koordinationsflächen verfügbar.",
    "Для этого приёма нет координационных блоков.",
    "No coordination surfaces are available for this appointment.",
  );
  const workflowEmpty = appointmentText(
    "Für diesen Termin sind keine Workflow-Blöcke verfügbar.",
    "Для этого приёма нет workflow-блоков.",
    "No workflow surfaces are available for this appointment.",
  );
  const notesEmpty = appointmentText(
    "Für diesen Termin sind keine Notizen verfügbar.",
    "Для этого приёма нет заметок.",
    "No notes are available for this appointment.",
  );

  const showOverviewDetails = detailTab === "overview";
  const showTimelineTab = detailTab === "timeline";
  const showCoordinationTab = detailTab === "coordination";
  const showClinicalTab = detailTab === "clinical";
  const showWorkflowTab = detailTab === "workflow";
  const showServicesTab = detailTab === "services";
  const showNotesTab = detailTab === "notes";

  const showWorkflowCompletionSection = permissions.canManageStatus;
  const showWorkflowStatusSection = permissions.canManageStatus;
  const showWorkflowScheduleSection = permissions.canEditSchedule;
  const showWorkflowInterpreterSection =
    permissions.canAssignInterpreter ||
    (permissions.canRespondToAssignment &&
      detail.interpreter_id === currentUserId);
  const showWorkflowChecklistSection = permissions.canManageChecklist;
  const showWorkflowRemindersSection = permissions.canViewReminders;
  const showWorkflowTasksSection = permissions.canViewTasks;
  const hasWorkflowContent =
    showWorkflowCompletionSection ||
    showWorkflowStatusSection ||
    showWorkflowScheduleSection ||
    showWorkflowInterpreterSection ||
    showWorkflowChecklistSection ||
    showWorkflowRemindersSection ||
    showWorkflowTasksSection;

  return (
    <div className="space-y-6">
      {appointmentsNotice ? (
        <Banner tone="warning" withIcon>{appointmentsNotice}</Banner>
      ) : null}
      <MemoizedAppointmentOverviewSection
        detail={detail}
        onOpenDetail={onOpenDetail}
      />

      {showOverviewDetails ? (
        <>
          <MemoizedAppointmentSnapshotSection detail={detail} />
          {detailAttention ? (
            <MemoizedAppointmentAttentionSection attention={detailAttention} />
          ) : null}
          <MemoizedAppointmentLinksSection
            detail={detail}
            onOpenPreview={onOpenPreview}
          />
        </>
      ) : null}

      {showTimelineTab ? (
        <MemoizedAppointmentTimelineSection
          key={`${detail.id}:${detailVersion}:workspace`}
          timelineEvents={timelineEvents}
        />
      ) : null}

      {showCoordinationTab ? (
        extendedResourcesReady ? (
          <Suspense
            fallback={loadingSection(
              appointmentText(
                "Koordinationsoberfläche",
                "Координационный блок",
                "Coordination surface",
              ),
              appointmentText(
                "Koordinationsbereich wird geladen",
                "Загрузка coordination-блока",
                "Loading coordination surface",
              ),
            )}
          >
            <LazyCoordinationSection
              detail={detail}
              appointments={appointments}
              providers={providers}
              staff={staff}
              interpreters={interpreters}
              permissions={permissions}
              handoffStakeholders={handoffStakeholders}
              followUpAssigneeId={followUpAssigneeId}
              setFollowUpAssigneeId={setFollowUpAssigneeId}
              detailDefaultAssigneeId={detailDefaultAssigneeId}
              doctorFollowUpAssignees={doctorFollowUpAssignees}
              doctorDirectedReminders={doctorDirectedReminders}
              doctorDirectedTasks={doctorDirectedTasks}
              packageEndReminders={packageEndReminders}
              packageEndTasks={packageEndTasks}
              externalCommunicationEntries={externalCommunicationEntries}
              externalHandoffReminders={externalHandoffReminders}
              externalHandoffTasks={externalHandoffTasks}
              coordinationEmpty={coordinationEmpty}
              defaultPackageEndTitle={tr.appointments_new ?? ""}
              onRefresh={onRefresh}
              onError={onError}
              onFollowUpVisitCreated={onFollowUpVisitCreated}
            />
          </Suspense>
        ) : (
          loadingSection(
            appointmentText(
              "Koordinationsoberfläche",
              "Координационный блок",
              "Coordination surface",
            ),
            appointmentText(
              "Koordinationsdaten werden geladen",
              "Загрузка coordination-данных",
              "Loading coordination data",
            ),
          )
        )
      ) : null}

      {showClinicalTab ? (
        extendedResourcesReady ? (
          <Suspense
            fallback={loadingSection(
              appointmentText(
                "Klinische Oberfläche",
                "Клинический блок",
                "Clinical surface",
              ),
              appointmentText(
                "Klinischer Bereich wird geladen",
                "Загрузка clinical-блока",
                "Loading clinical surface",
              ),
            )}
          >
            <LazyClinicalSection
              detail={detail}
              permissions={permissions}
              detailDefaultAssigneeId={detailDefaultAssigneeId}
              doctorFollowUpAssignees={doctorFollowUpAssignees}
              incomingDataChecklist={incomingDataChecklist}
              incomingDataReminders={incomingDataReminders}
              incomingDataTasks={incomingDataTasks}
              findingsChecklist={findingsChecklist}
              findingsReminders={findingsReminders}
              findingsTasks={findingsTasks}
              detailReport={detailReport}
              reportReviewMeta={reportReviewMeta}
              canSubmitInterpreterReport={canSubmitInterpreterReport}
              canResubmitRejectedReport={canResubmitRejectedReport}
              showReportReviewActions={showReportReviewActions}
              onRefresh={onRefresh}
              onError={onError}
            />
          </Suspense>
        ) : (
          loadingSection(
            appointmentText(
              "Klinische Oberfläche",
              "Клинический блок",
              "Clinical surface",
            ),
            appointmentText(
              "Klinische Daten werden geladen",
              "Загрузка clinical-данных",
              "Loading clinical data",
            ),
          )
        )
      ) : null}

      {showWorkflowTab ? (
        hasWorkflowContent ? (
          extendedResourcesReady ? (
            <Suspense
              fallback={loadingSection(
                appointmentText(
                  "Workflow-Cockpit",
                  "Панель workflow",
                  "Workflow cockpit",
                ),
                appointmentText(
                  "Workflow-Oberfläche wird geladen",
                  "Загрузка workflow-блока",
                  "Loading workflow surface",
                ),
              )}
            >
              <LazyWorkflowTab
                detail={detail}
                detailReport={detailReport}
                staff={staff}
                interpreters={interpreters}
                currentUserId={currentUserId}
                permissions={permissions}
                handoffStakeholders={handoffStakeholders}
                followUpAssigneeId={followUpAssigneeId}
                setFollowUpAssigneeId={setFollowUpAssigneeId}
                openChecklistCount={openChecklistCount}
                openTaskCount={openTaskCount}
                pendingReminderCount={pendingReminderCount}
                interpreterReportReady={interpreterReportReady}
                completionWarnings={completionWarnings}
                checklistItems={detailChecklist}
                reminders={detailReminders}
                tasks={detailTasks}
                taskAssignableStaff={taskAssignableStaff}
                editAppointmentSection={
                  showWorkflowScheduleSection ? (
                    <LazyEditAppointmentSection
                      detail={detail}
                      appointments={appointments}
                      providers={providers}
                      staff={staff}
                      interpreters={interpreters}
                      onSaved={onEditSaved}
                    />
                  ) : null
                }
                onRefresh={onRefresh}
                onError={onError}
                onNotice={onNotice}
              />
            </Suspense>
          ) : (
            loadingSection(
              appointmentText(
                "Workflow-Cockpit",
                "Панель workflow",
                "Workflow cockpit",
              ),
              appointmentText(
                "Workflow-Daten werden geladen",
                "Загрузка workflow-данных",
                "Loading workflow data",
              ),
            )
          )
        ) : (
          <section className={appointmentSectionCardClassName("p-5")}>
            <EmptyState text={workflowEmpty} />
          </section>
        )
      ) : null}

      {showServicesTab ? (
        extendedResourcesReady ? (
          <Suspense
            fallback={loadingSection(
              appointmentText(
                "Service und Billing",
                "Сервисы и billing",
                "Services and billing",
              ),
              appointmentText(
                "Service-Bereich wird geladen",
                "Загрузка service-блока",
                "Loading services surface",
              ),
            )}
          >
            <LazyServicesSection
              detail={detail}
              detailServices={detailServices}
              detailReport={detailReport}
              reportReviewMeta={reportReviewMeta}
              interpreterReportReady={interpreterReportReady}
              canShowConciergeSection={canShowConciergeSection}
              canShowBillingHandoffSection={canShowBillingHandoffSection}
              nonMedicalProviders={nonMedicalProviders}
              conciergeStaff={conciergeStaff}
              billingStaff={billingStaff}
              billingHandoffReminders={billingHandoffReminders}
              billingHandoffTasks={billingHandoffTasks}
              openBillingHandoffTasks={openBillingHandoffTasks}
              readyConciergeServices={readyConciergeServices}
              settledConciergeServices={settledConciergeServices}
              billingReadinessWarnings={billingReadinessWarnings}
              canManageConciergeServices={permissions.canManageConciergeServices}
              canManageConciergeBilling={permissions.canManageConciergeBilling}
              canCreateTasks={permissions.canCreateTasks}
              onRefresh={onRefresh}
              onError={onError}
            />
          </Suspense>
        ) : (
          loadingSection(
            appointmentText(
              "Service und Billing",
              "Сервисы и billing",
              "Services and billing",
            ),
            appointmentText(
              "Service-Daten werden geladen",
              "Загрузка service-данных",
              "Loading services data",
            ),
          )
        )
      ) : null}

      {showNotesTab ? (
        <Suspense
          fallback={<section className={appointmentSectionCardClassName("p-5")} />}
        >
          <LazyNotesSection
            detail={detail}
            canViewNotes={permissions.canViewNotes}
            emptyText={notesEmpty}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export const MemoizedAppointmentDesktopDetailWorkspaceContent = memo(
  AppointmentDesktopDetailWorkspaceContent,
);
