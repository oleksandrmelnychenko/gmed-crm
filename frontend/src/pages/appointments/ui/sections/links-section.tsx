import { memo } from "react";

import { Button } from "@/components/ui/button";
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
  const previewButtonClass =
    "h-8 rounded-lg gap-1.5 border-orange-500 bg-orange-500 px-3 text-xs font-medium text-white transition-colors hover:cursor-pointer hover:border-orange-600 hover:bg-orange-600";
  const patientLabel = appointmentText("Patient", "Пациент", "Patient");
  const orderLabel = appointmentText("Auftrag", "Заказ", "Order");
  const clinicLabel = appointmentText("Klinik", "Клиника", "Clinic");
  const documentsLabel = appointmentText("Dokumente", "Документы", "Documents");
  const casesLabel = appointmentText("Fälle", "Кейсы", "Cases");
  const linkedCount =
    3 + Number(Boolean(detail.order_id)) + Number(Boolean(detail.provider_id));

  return (
    <Section
      title={t.compliance_col_linked_records}
      accessory={<CountBadge>{linkedCount}</CountBadge>}
    >
      <div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className={previewButtonClass}
            onClick={() => onOpenPreview("patient", patientLabel)}
          >
            {patientLabel}
          </Button>
          {detail.order_id ? (
            <Button
              type="button"
              className={previewButtonClass}
              onClick={() => onOpenPreview("order", orderLabel)}
            >
              {orderLabel}
            </Button>
          ) : null}
          {detail.provider_id ? (
            <Button
              type="button"
              className={previewButtonClass}
              onClick={() => onOpenPreview("provider", clinicLabel)}
            >
              {clinicLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            className={previewButtonClass}
            onClick={() => onOpenPreview("documents", documentsLabel)}
          >
            {documentsLabel}
          </Button>
          <Button
            type="button"
            className={previewButtonClass}
            onClick={() => onOpenPreview("cases", casesLabel)}
          >
            {casesLabel}
          </Button>
        </div>
      </div>
    </Section>
  );
}

export const MemoizedAppointmentLinksSection = memo(AppointmentLinksSection);
