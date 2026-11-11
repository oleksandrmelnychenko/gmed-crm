import { memo } from "react";
import { ArrowUpRight, ClipboardList, FolderOpen, Hospital, Link2, UserRound, type LucideIcon } from "lucide-react";

import { SectionHeading } from "@/components/ui/section-heading";
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
  // The order tile only helps people who may open orders (an interpreter
  // would land on the dashboard).
  const canOpenOrder = hasCapability(user, "orders.view");
  const l = (key: string) => t.uiText[key] ?? key;
  const descriptions = {
    patient: l("appointments_linked_tile_patient_description"),
    order: l("appointments_linked_tile_order_description"),
    clinic: l("appointments_linked_tile_clinic_description"),
    documents: l("appointments_linked_tile_documents_description"),
  };
  const patientLabel = appointmentText("appointments_patient");
  const orderLabel = appointmentText("appointments_order");
  const clinicLabel = appointmentText("appointments_clinic");
  const documentsLabel = appointmentText("appointments_documents");

  return (
    <Section
      icon={Link2}
      title={t.compliance_col_linked_records}
    >
      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {/* The team lead sees team visits of patients it is not assigned to:
            their card would answer "раздел не открыт" (release QA D R-07). */}
        {detail.can_open_patient !== false ? (
          <LinkedRecordTile
            icon={UserRound}
            title={patientLabel}
            description={descriptions.patient}
            onClick={() => onOpenPreview("patient", patientLabel)}
          />
        ) : null}
        {detail.order_id && canOpenOrder ? (
          <LinkedRecordTile
            icon={ClipboardList}
            title={orderLabel}
            description={descriptions.order}
            onClick={() => onOpenPreview("order", orderLabel)}
          />
        ) : null}
        {detail.provider_id ? (
          <LinkedRecordTile
            icon={Hospital}
            title={clinicLabel}
            description={descriptions.clinic}
            onClick={() => onOpenPreview("provider", clinicLabel)}
          />
        ) : null}
        <LinkedRecordTile
          icon={FolderOpen}
          title={documentsLabel}
          description={descriptions.documents}
          onClick={() => onOpenPreview("documents", documentsLabel)}
        />
      </div>
    </Section>
  );
}

function LinkedRecordTile({
  icon,
  title,
  description,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-input focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onClick}
    >
      <SectionHeading icon={icon}>{title}</SectionHeading>
      <ArrowUpRight aria-hidden="true" className="mt-0.5 size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
      <span className="col-span-2 min-w-0 break-words text-xs leading-5 text-muted-foreground">{description}</span>
    </button>
  );
}

export const MemoizedAppointmentLinksSection = memo(AppointmentLinksSection);
