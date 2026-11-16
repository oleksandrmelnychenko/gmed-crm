import { memo } from "react";
import { ClipboardList, FolderOpen, Hospital, Link2, UserRound, type LucideIcon } from "lucide-react";

import { Section } from "@/components/ui-shell";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { useAppointmentLabels } from "@/pages/appointments/model/labels";
import type {
  AppointmentDetail,
  LinkedPreviewKind,
} from "@/pages/appointments/model/types";

function AppointmentLinksSection({
  detail,
  onOpenPreview,
}: {
  detail: AppointmentDetail;
  onOpenPreview: (kind: LinkedPreviewKind, label: string) => void;
}) {
  const { appointmentText } = useAppointmentLabels();
  const { t } = useLang();
  const { user } = useAuth();
  // The order link only helps people who may open orders (an interpreter
  // would land on the dashboard).
  const canOpenOrder = hasCapability(user, "orders.view");
  const patientLabel = appointmentText("appointments_patient");
  const orderLabel = appointmentText("appointments_order");
  const clinicLabel = appointmentText("appointments_clinic");
  const documentsLabel = appointmentText("appointments_documents");

  return (
    <Section
      icon={Link2}
      title={t.compliance_col_linked_records}
    >
      <div className="flex flex-wrap gap-2">
        {/* The team lead sees team visits of patients it is not assigned to:
            their card would answer "раздел не открыт" (release QA D R-07). */}
        {detail.can_open_patient !== false ? (
          <LinkedRecordChip
            icon={UserRound}
            title={patientLabel}
            detail={detail.patient_pid}
            onClick={() => onOpenPreview("patient", patientLabel)}
          />
        ) : null}
        {detail.order_id && canOpenOrder ? (
          <LinkedRecordChip
            icon={ClipboardList}
            title={orderLabel}
            detail={detail.order_number}
            onClick={() => onOpenPreview("order", orderLabel)}
          />
        ) : null}
        {detail.provider_id ? (
          <LinkedRecordChip
            icon={Hospital}
            title={clinicLabel}
            detail={detail.provider_name}
            onClick={() => onOpenPreview("provider", clinicLabel)}
          />
        ) : null}
        <LinkedRecordChip
          icon={FolderOpen}
          title={documentsLabel}
          onClick={() => onOpenPreview("documents", documentsLabel)}
        />
      </div>
    </Section>
  );
}

function LinkedRecordChip({
  icon: Icon,
  title,
  detail,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  /** The record's number or name, when the appointment carries it. */
  detail?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
      onClick={onClick}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0">{title}</span>
      {detail ? (
        <span className="min-w-0 truncate font-normal text-muted-foreground">{detail}</span>
      ) : null}
    </button>
  );
}

export const MemoizedAppointmentLinksSection = memo(AppointmentLinksSection);
