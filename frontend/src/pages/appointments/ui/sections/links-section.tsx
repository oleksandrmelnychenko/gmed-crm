import { memo } from "react";
import { ArrowUpRight } from "lucide-react";

import { CountBadge, Section } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { appointmentText } from "@/pages/appointments/model/labels";
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
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const descriptions = {
    patient: l("appointments_linked_tile_patient_description"),
    order: l("appointments_linked_tile_order_description"),
    clinic: l("appointments_linked_tile_clinic_description"),
    documents: l("appointments_linked_tile_documents_description"),
    cases: l("appointments_linked_tile_cases_description"),
  };
  const patientLabel = appointmentText("appointments_patient");
  const orderLabel = appointmentText("appointments_order");
  const clinicLabel = appointmentText("appointments_clinic");
  const documentsLabel = appointmentText("appointments_documents");
  const casesLabel = appointmentText("appointments_cases");
  const linkedCount =
    3 + Number(Boolean(detail.order_id)) + Number(Boolean(detail.provider_id));

  return (
    <Section
      title={t.compliance_col_linked_records}
      accessory={<CountBadge>{linkedCount}</CountBadge>}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <LinkedRecordTile
          title={patientLabel}
          description={descriptions.patient}
          onClick={() => onOpenPreview("patient", patientLabel)}
        />
        {detail.order_id ? (
          <LinkedRecordTile
            title={orderLabel}
            description={descriptions.order}
            onClick={() => onOpenPreview("order", orderLabel)}
          />
        ) : null}
        {detail.provider_id ? (
          <LinkedRecordTile
            title={clinicLabel}
            description={descriptions.clinic}
            onClick={() => onOpenPreview("provider", clinicLabel)}
          />
        ) : null}
        <LinkedRecordTile
          title={documentsLabel}
          description={descriptions.documents}
          onClick={() => onOpenPreview("documents", documentsLabel)}
        />
        <LinkedRecordTile
          title={casesLabel}
          description={descriptions.cases}
          onClick={() => onOpenPreview("cases", casesLabel)}
        />
      </div>
    </Section>
  );
}

function LinkedRecordTile({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="group relative min-h-[150px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
      onClick={onClick}
    >
      <div className="relative z-10 min-w-0">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-2 line-clamp-3 text-xs leading-tight text-muted-foreground">
          {description}
        </p>
      </div>
      <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
        <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}

export const MemoizedAppointmentLinksSection = memo(AppointmentLinksSection);
