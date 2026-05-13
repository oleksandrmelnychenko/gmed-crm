import { memo, useMemo } from "react";

import { Banner, EmptyCell, InfoRow, ListItem } from "@/components/ui-shell";
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
import { appointmentPreviewInfoCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import {
  linkedPreviewText,
  readLinkedPreviewValue,
} from "@/pages/appointments/model/linked-preview";
import { appointmentText } from "@/pages/appointments/model/labels";
import type {
  LinkedPreviewKind,
  LinkedPreviewPayload,
  LinkedPreviewRecord,
} from "@/pages/appointments/model/types";
import { AppointmentPreviewSheet } from "@/pages/appointments/ui/shared/workspace-primitives";

export type LinkedRecordsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  loading: boolean;
  error: string;
  payload: LinkedPreviewPayload | null;
  kind: LinkedPreviewKind | null;
};

function readLinkedPreviewRawValue(
  record: LinkedPreviewRecord,
  keys: string[],
): unknown {
  for (const key of keys) {
    const value = record[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function linkedOptionalText(value: unknown) {
  return value === undefined || value === null || value === ""
    ? ""
    : linkedPreviewText(value);
}

function linkedStatusLabel(value: unknown, translations: Translations) {
  if (value === undefined || value === null || value === "") return "";
  const status = String(value);
  const labels: Record<string, string> = {
    active: appointmentText("appointments_active_2"),
    approved: appointmentText("appointments_approved_2"),
    archived: appointmentText("appointments_archived"),
    cancelled: appointmentText("appointments_cancelled"),
    closed: appointmentText("appointments_closed"),
    completed: appointmentText("appointments_completed"),
    confirmed: appointmentText("appointments_confirmed"),
    draft: appointmentText("appointments_draft"),
    in_progress: appointmentText("appointments_in_progress"),
    open: appointmentText("appointments_open_2"),
    pending: appointmentText("appointments_pending_3"),
    planned: appointmentText("appointments_planned"),
    ready: appointmentText("appointments_ready"),
    rejected: appointmentText("appointments_rejected_2"),
    released: appointmentText("appointments_released"),
    sent: appointmentText("appointments_sent"),
  };
  return labels[status] ?? formatUnknownValue(status, translations);
}

function linkedTypeLabel(value: unknown, translations: Translations) {
  if (value === undefined || value === null || value === "") return "";
  const type = String(value);
  const labels: Record<string, string> = {
    administrative: appointmentText("appointments_administrative"),
    billing: appointmentText("appointments_billing"),
    document: appointmentText("appointments_document"),
    internal: appointmentText("appointments_internal"),
    medical: appointmentText("appointments_medical_2"),
    non_medical: appointmentText("appointments_non_medical_2"),
    provider: appointmentText("appointments_provider"),
    service: appointmentText("appointments_service"),
  };
  return labels[type] ?? formatUnknownValue(type, translations);
}

function linkedCategoryLabel(value: unknown, translations: Translations) {
  if (value === undefined || value === null || value === "") return "";
  const category = String(value);
  const labels: Record<string, string> = {
    administrative: appointmentText("appointments_administrative"),
    clinical: appointmentText("appointments_clinical_3"),
    contract: appointmentText("appointments_contract"),
    document: appointmentText("appointments_document"),
    imaging: appointmentText("appointments_imaging"),
    invoice: appointmentText("appointments_invoice"),
    lab: appointmentText("appointments_lab"),
    medical: appointmentText("appointments_medical_2"),
    portal: appointmentText("appointments_portal"),
  };
  return labels[category] ?? formatUnknownValue(category, translations);
}

function LinkedRecordsSheet({
  open,
  onOpenChange,
  title,
  loading,
  error,
  payload,
  kind,
}: LinkedRecordsSheetProps) {
  const { t } = useLang();

  const content = useMemo(() => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          {appointmentText("appointments_loading_linked_records")}
        </div>
      );
    }

    if (error) {
      return <Banner tone="error" withIcon>{error}</Banner>;
    }

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return (
        <EmptyCell>
          {appointmentText("appointments_no_linked_records_found")}
        </EmptyCell>
      );
    }

    if (!Array.isArray(payload)) {
      const record = payload;
      const fields: Array<{ label: string; value: string }> =
        kind === "patient"
          ? [
              {
                label: appointmentText("appointments_name_2"),
                value: readLinkedPreviewValue(record, [
                  "name",
                  "full_name",
                  "display_name",
                ]),
              },
              {
                label: t.appointments_linked_patient_id,
                value: readLinkedPreviewValue(record, ["patient_id", "id"]),
              },
              {
                label: appointmentText("documents_pid_fallback"),
                value: readLinkedPreviewValue(record, ["pid"]),
              },
              {
                label: appointmentText("appointments_phone"),
                value: readLinkedPreviewValue(record, [
                  "phone",
                  "phone_number",
                  "mobile",
                ]),
              },
              {
                label: t.appointments_linked_email,
                value: readLinkedPreviewValue(record, ["email"]),
              },
            ]
          : kind === "order"
            ? [
                {
                  label: appointmentText("appointments_order"),
                  value: readLinkedPreviewValue(record, [
                    "order_number",
                    "number",
                    "id",
                  ]),
                },
                {
                  label: appointmentText("appointments_status"),
                  value: linkedStatusLabel(readLinkedPreviewRawValue(record, ["status"]), t),
                },
                {
                  label: appointmentText("appointments_type"),
                  value: linkedTypeLabel(readLinkedPreviewRawValue(record, ["order_type", "type"]), t),
                },
                {
                  label: appointmentText("appointments_patient"),
                  value: readLinkedPreviewValue(record, [
                    "patient_name",
                    "patient_id",
                  ]),
                },
                {
                  label: appointmentText("appointments_created"),
                  value: readLinkedPreviewValue(record, [
                    "created_at",
                    "updated_at",
                  ]),
                },
              ]
            : [
                {
                  label: appointmentText("appointments_name"),
                  value: readLinkedPreviewValue(record, ["name"]),
                },
                {
                  label: appointmentText("appointments_type"),
                  value: linkedTypeLabel(
                    readLinkedPreviewRawValue(record, ["provider_type", "type"]),
                    t,
                  ),
                },
                {
                  label: appointmentText("appointments_city"),
                  value: readLinkedPreviewValue(record, ["address_city", "city"]),
                },
                {
                  label: appointmentText("appointments_specialty"),
                  value: readLinkedPreviewValue(record, ["fachbereich", "specialty"]),
                },
                {
                  label: appointmentText("appointments_address"),
                  value: readLinkedPreviewValue(record, [
                    "address",
                    "address_line1",
                  ]),
                },
              ];

      return (
        <div className="grid gap-3 md:grid-cols-2">
          {fields.map((field) => (
            <div
              key={field.label}
              className={appointmentPreviewInfoCardClassName}
            >
              <InfoRow label={field.label} value={field.value} />
            </div>
          ))}
        </div>
      );
    }

    const items = payload.slice(0, 20);
    const hiddenCount = payload.length - items.length;
    return (
      <div className="space-y-2">
        {items.map((item, index) => {
          const titleText =
            kind === "documents"
              ? readLinkedPreviewValue(item, [
                  "filename",
                  "title",
                  "document_id",
                  "id",
                ])
              : kind === "cases"
                ? readLinkedPreviewValue(item, [
                    "case_id",
                    "title",
                    "hauptanfragegrund",
                    "id",
                  ])
                : readLinkedPreviewValue(item, ["title", "name", "id"]);
          const meta = [
            linkedStatusLabel(item.status, t),
            linkedCategoryLabel(item.category, t),
            linkedOptionalText(item.created_at),
          ]
            .filter(Boolean)
            .join(" • ");

          return (
            <ListItem
              key={readLinkedPreviewValue(item, ["id"]) + String(index)}
              className="space-y-1"
            >
              <p className="text-sm font-medium text-foreground">{titleText}</p>
              {meta ? (
                <p className="text-xs text-muted-foreground">{meta}</p>
              ) : null}
            </ListItem>
          );
        })}
        {hiddenCount > 0 ? (
          <p className="pt-1 text-xs text-muted-foreground">
            {appointmentText("appointments_hidden_more_count", {
              count: hiddenCount,
            })}
          </p>
        ) : null}
      </div>
    );
  }, [error, kind, loading, payload, t]);

  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      maxWidthClassName="sm:max-w-[540px]"
      bodyClassName="px-4 pb-6 pt-4"
    >
      {content}
    </AppointmentPreviewSheet>
  );
}

export const MemoizedLinkedRecordsSheet = memo(LinkedRecordsSheet);
