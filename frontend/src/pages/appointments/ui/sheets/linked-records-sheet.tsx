import { memo } from "react";

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
    active: appointmentText("Aktiv", "Активно", "Active"),
    approved: appointmentText("Genehmigt", "Одобрено", "Approved"),
    archived: appointmentText("Archiviert", "Архивировано", "Archived"),
    cancelled: appointmentText("Abgesagt", "Отменено", "Cancelled"),
    closed: appointmentText("Geschlossen", "Закрыто", "Closed"),
    completed: appointmentText("Abgeschlossen", "Завершено", "Completed"),
    confirmed: appointmentText("Bestätigt", "Подтверждено", "Confirmed"),
    draft: appointmentText("Entwurf", "Черновик", "Draft"),
    in_progress: appointmentText("In Bearbeitung", "В работе", "In progress"),
    open: appointmentText("Offen", "Открыто", "Open"),
    pending: appointmentText("Ausstehend", "Ожидает", "Pending"),
    planned: appointmentText("Geplant", "Запланировано", "Planned"),
    ready: appointmentText("Bereit", "Готово", "Ready"),
    rejected: appointmentText("Abgelehnt", "Отклонено", "Rejected"),
    released: appointmentText("Freigegeben", "Опубликовано", "Released"),
    sent: appointmentText("Versendet", "Отправлено", "Sent"),
  };
  return labels[status] ?? formatUnknownValue(status, translations);
}

function linkedTypeLabel(value: unknown, translations: Translations) {
  if (value === undefined || value === null || value === "") return "";
  const type = String(value);
  const labels: Record<string, string> = {
    administrative: appointmentText("Administrativ", "Административный", "Administrative"),
    billing: appointmentText("Abrechnung", "Биллинг", "Billing"),
    document: appointmentText("Dokument", "Документ", "Document"),
    internal: appointmentText("Intern", "Внутренний", "Internal"),
    medical: appointmentText("Medizinisch", "Медицинский", "Medical"),
    non_medical: appointmentText("Nicht-medizinisch", "Немедицинский", "Non-medical"),
    provider: appointmentText("Leistungserbringer", "Провайдер", "Provider"),
    service: appointmentText("Leistung", "Услуга", "Service"),
  };
  return labels[type] ?? formatUnknownValue(type, translations);
}

function linkedCategoryLabel(value: unknown, translations: Translations) {
  if (value === undefined || value === null || value === "") return "";
  const category = String(value);
  const labels: Record<string, string> = {
    administrative: appointmentText("Administrativ", "Административный", "Administrative"),
    clinical: appointmentText("Klinisch", "Клинический", "Clinical"),
    contract: appointmentText("Vertrag", "Договор", "Contract"),
    document: appointmentText("Dokument", "Документ", "Document"),
    imaging: appointmentText("Bildgebung", "Визуализация", "Imaging"),
    invoice: appointmentText("Rechnung", "Счет", "Invoice"),
    lab: appointmentText("Labor", "Лаборатория", "Lab"),
    medical: appointmentText("Medizinisch", "Медицинский", "Medical"),
    portal: appointmentText("Portal", "Портал", "Portal"),
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

  function renderContent() {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          {appointmentText(
            "Verknupfte Daten werden geladen…",
            "Загрузка связанных данных…",
            "Loading linked records…",
          )}
        </div>
      );
    }

    if (error) {
      return <Banner tone="error" withIcon>{error}</Banner>;
    }

    if (!payload || (Array.isArray(payload) && payload.length === 0)) {
      return (
        <EmptyCell>
          {appointmentText(
            "Keine verknupften Daten gefunden.",
            "Связанные данные не найдены.",
            "No linked records found.",
          )}
        </EmptyCell>
      );
    }

    if (!Array.isArray(payload)) {
      const record = payload;
      const fields: Array<{ label: string; value: string }> =
        kind === "patient"
          ? [
              {
                label: appointmentText("Name", "Имя", "Name"),
                value: readLinkedPreviewValue(record, [
                  "name",
                  "full_name",
                  "display_name",
                ]),
              },
              {
                label: "Patient ID",
                value: readLinkedPreviewValue(record, ["patient_id", "id"]),
              },
              {
                label: "PID",
                value: readLinkedPreviewValue(record, ["pid"]),
              },
              {
                label: appointmentText("Telefon", "Телефон", "Phone"),
                value: readLinkedPreviewValue(record, [
                  "phone",
                  "phone_number",
                  "mobile",
                ]),
              },
              {
                label: "Email",
                value: readLinkedPreviewValue(record, ["email"]),
              },
            ]
          : kind === "order"
            ? [
                {
                  label: appointmentText("Auftrag", "Заказ", "Order"),
                  value: readLinkedPreviewValue(record, [
                    "order_number",
                    "number",
                    "id",
                  ]),
                },
                {
                  label: appointmentText("Status", "Статус", "Status"),
                  value: linkedStatusLabel(readLinkedPreviewRawValue(record, ["status"]), t),
                },
                {
                  label: appointmentText("Typ", "Тип", "Type"),
                  value: linkedTypeLabel(readLinkedPreviewRawValue(record, ["order_type", "type"]), t),
                },
                {
                  label: appointmentText("Patient", "Пациент", "Patient"),
                  value: readLinkedPreviewValue(record, [
                    "patient_name",
                    "patient_id",
                  ]),
                },
                {
                  label: appointmentText("Erstellt", "Создано", "Created"),
                  value: readLinkedPreviewValue(record, [
                    "created_at",
                    "updated_at",
                  ]),
                },
              ]
            : [
                {
                  label: appointmentText("Name", "Название", "Name"),
                  value: readLinkedPreviewValue(record, ["name"]),
                },
                {
                  label: appointmentText("Typ", "Тип", "Type"),
                  value: linkedTypeLabel(
                    readLinkedPreviewRawValue(record, ["provider_type", "type"]),
                    t,
                  ),
                },
                {
                  label: appointmentText("Stadt", "Город", "City"),
                  value: readLinkedPreviewValue(record, ["address_city", "city"]),
                },
                {
                  label: appointmentText(
                    "Fachbereich",
                    "Специализация",
                    "Specialty",
                  ),
                  value: readLinkedPreviewValue(record, ["fachbereich", "specialty"]),
                },
                {
                  label: appointmentText("Adresse", "Адрес", "Address"),
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
            {appointmentText(
              `+${hiddenCount} weitere`,
              `+${hiddenCount} еще`,
              `+${hiddenCount} more`,
            )}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      maxWidthClassName="sm:max-w-[540px]"
      bodyClassName="px-4 pb-6 pt-4"
    >
      {renderContent()}
    </AppointmentPreviewSheet>
  );
}

export const MemoizedLinkedRecordsSheet = memo(LinkedRecordsSheet);
