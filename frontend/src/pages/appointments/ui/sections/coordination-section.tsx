import { memo } from "react";
import { LoaderCircle } from "lucide-react";

import { EmptyCell, Section, tokens } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import type {
  AppointmentCommunicationEntry,
  AppointmentDetail,
  AppointmentPermissions,
  AppointmentListItem,
  HandoffStakeholder,
  InterpreterOption,
  ProviderSummary,
  ReminderEntry,
  StaffOption,
  TaskEntry,
} from "@/pages/appointments/model/types";
import { MemoizedAppointmentExternalHandoffSection } from "@/pages/appointments/ui/sections/external-handoff-section";
import { MemoizedAppointmentFollowUpVisitSection } from "@/pages/appointments/ui/sections/follow-up-visit-section";
import { MemoizedAppointmentHandoffSection } from "@/pages/appointments/ui/sections/handoff-section";
import {
  MemoizedAppointmentDoctorFollowUpSection,
  MemoizedAppointmentPackageEndSection,
} from "@/pages/appointments/ui/sections/workflow-follow-up-sections";

function sectionCardClass(extra?: string) {
  return cn(
    "rounded-[1.75rem] border border-border/70",
    tokens.surface.card,
    extra,
  );
}

function CoordinationLoadingState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <Section title={title}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        {text}
      </div>
    </Section>
  );
}

type AppointmentCoordinationSectionProps = {
  detail: AppointmentDetail;
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  permissions: AppointmentPermissions;
  handoffStakeholders: HandoffStakeholder[];
  followUpAssigneeId: string;
  setFollowUpAssigneeId: (value: string) => void;
  detailDefaultAssigneeId: string;
  doctorFollowUpAssignees: StaffOption[];
  doctorDirectedReminders: ReminderEntry[];
  doctorDirectedTasks: TaskEntry[];
  packageEndReminders: ReminderEntry[];
  packageEndTasks: TaskEntry[];
  externalCommunicationEntries: AppointmentCommunicationEntry[];
  externalHandoffReminders: ReminderEntry[];
  externalHandoffTasks: TaskEntry[];
  coordinationEmpty: string;
  defaultPackageEndTitle: string;
  onRefresh: () => void;
  onError: (message: string) => void;
  onFollowUpVisitCreated: (payload: {
    id?: string;
    notice: string;
  }) => void;
};

function AppointmentCoordinationSection({
  detail,
  appointments,
  providers,
  staff,
  interpreters,
  permissions,
  handoffStakeholders,
  followUpAssigneeId,
  setFollowUpAssigneeId,
  detailDefaultAssigneeId,
  doctorFollowUpAssignees,
  doctorDirectedReminders,
  doctorDirectedTasks,
  packageEndReminders,
  packageEndTasks,
  externalCommunicationEntries,
  externalHandoffReminders,
  externalHandoffTasks,
  coordinationEmpty,
  defaultPackageEndTitle,
  onRefresh,
  onError,
  onFollowUpVisitCreated,
}: AppointmentCoordinationSectionProps) {
  if (detail.is_blocked) {
    return (
      <section className={sectionCardClass("p-5")}>
        <EmptyCell>{coordinationEmpty}</EmptyCell>
      </section>
    );
  }

  return (
    <>
      <MemoizedAppointmentHandoffSection
        detail={detail}
        handoffStakeholders={handoffStakeholders}
        followUpAssigneeId={followUpAssigneeId}
        setFollowUpAssigneeId={setFollowUpAssigneeId}
        canManageReminders={permissions.canManageReminders}
        onRefresh={onRefresh}
        onError={onError}
      />
      {permissions.canCreate ? (
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
      {permissions.canViewReminders ? (
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
      {permissions.canViewReminders && detail.order_id ? (
        <MemoizedAppointmentPackageEndSection
          detail={detail}
          reminders={packageEndReminders}
          tasks={packageEndTasks}
          assignees={doctorFollowUpAssignees}
          defaultAssigneeId={detailDefaultAssigneeId}
          defaultTitle={defaultPackageEndTitle}
          canManageReminders={permissions.canManageReminders}
          canCreateTasks={permissions.canCreateTasks}
          onRefresh={onRefresh}
          onError={onError}
        />
      ) : null}
      {permissions.canViewCommunications &&
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
    </>
  );
}

export const MemoizedAppointmentCoordinationSection = memo(
  AppointmentCoordinationSection,
);

export const MemoizedAppointmentCoordinationLoadingState = memo(
  CoordinationLoadingState,
);
