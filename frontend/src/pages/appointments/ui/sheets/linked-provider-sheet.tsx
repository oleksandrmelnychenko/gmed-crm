import { memo } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  EmptyCell,
  InfoRow,
  ListItem,
  Section,
  StatCard,
  StatusBadge,
  tokens,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { appointmentPreviewInfoCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import { appointmentText } from "@/pages/appointments/model/labels";
import { AppointmentPreviewSheet } from "@/pages/appointments/ui/shared/workspace-primitives";
import type { ProviderDetail as ProviderSheetDetail } from "@/pages/providers";

function humanizeLinkedCode(value: string | null | undefined) {
  if (!value) {
    return appointmentText("Nicht festgelegt", "Не указано", "Not set");
  }
  const parts: string[] = [];
  for (const part of value.split("_")) {
    if (part) {
      parts.push(part.charAt(0).toUpperCase() + part.slice(1));
    }
  }
  return parts.join(" ");
}

function linkedProviderAddress(detail: ProviderSheetDetail) {
  const notSet = appointmentText("Nicht festgelegt", "Не указано", "Not set");
  const cityLine = [detail.address_zip, detail.address_city]
    .filter(Boolean)
    .join(" ")
    .trim();
  return [detail.address_street, cityLine, detail.address_country]
    .filter(Boolean)
    .join(", ") || notSet;
}

function linkedProviderPatientLabel(
  patient: ProviderSheetDetail["linked_patients"][number],
) {
  return (
    [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim() ||
    patient.patient_id
  );
}

function LinkedProviderOverviewSection({
  detail,
  formatDateTimeLabel,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
}) {
  const providerTypeLabel =
    detail.provider_type === "medical"
      ? appointmentText("Medizinisch", "Медицинская", "Medical")
      : appointmentText("Nicht medizinisch", "Немедицинская", "Non-medical");
  const notSet = appointmentText("Nicht festgelegt", "Не указано", "Not set");

  return (
    <Section
      title={appointmentText("Klinikprofil", "Профиль клиники", "Clinic profile")}
      accessory={<CountBadge>{providerTypeLabel}</CountBadge>}
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={detail.is_active ? "success" : "neutral"}>
          {detail.is_active
            ? appointmentText("Aktiv", "Активна", "Active")
            : appointmentText("Inaktiv", "Неактивна", "Inactive")}
        </StatusBadge>
        {detail.kooperationsvertrag ? (
          <StatusBadge tone="warning">
            {appointmentText(
              "Vertrag verknüpft",
              "Договор привязан",
              "Contract linked",
            )}
          </StatusBadge>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={appointmentText("Kontakte", "Контакты", "Contacts")}
          value={detail.doctors.length}
        />
        <StatCard
          label={appointmentText("Services", "Сервисы", "Services")}
          value={detail.services.length}
        />
        <StatCard
          label={appointmentText(
            "Verknüpfte Patienten",
            "Связанные пациенты",
            "Linked patients",
          )}
          value={detail.linked_patients.length}
        />
        <StatCard
          label={appointmentText("Aktivität", "Активность", "Activity")}
          value={detail.interactions.length}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("Name", "Название", "Name")}
            value={detail.name || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("Rechtsträger", "Юрлицо", "Legal name")}
            value={detail.legal_name || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("Standort", "Локация", "Location")}
            value={linkedProviderAddress(detail)}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("Fachbereich", "Специализация", "Specialty")}
            value={detail.fachbereich || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("Telefon", "Телефон", "Phone")}
            value={detail.phone || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow label="Email" value={detail.email || notSet} />
        </div>
      </div>

      {detail.notes ? (
        <ListItem className="space-y-1">
          <p className={tokens.text.label}>
            {appointmentText("Notizen", "Заметки", "Notes")}
          </p>
          <p className="text-sm leading-6 text-foreground">{detail.notes}</p>
        </ListItem>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {appointmentText("Aktualisiert", "Обновлено", "Updated")}:{" "}
        {formatDateTimeLabel(detail.updated_at)}
      </p>
    </Section>
  );
}

function LinkedProviderPatientsSection({
  detail,
  formatDateTimeLabel,
  onOpenPatient,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
  onOpenPatient: (patientId: string) => void;
}) {
  return (
    <Section
      title={appointmentText(
        "Verknüpfte Patienten",
        "Связанные пациенты",
        "Linked patients",
      )}
      accessory={<CountBadge>{detail.linked_patients.length}</CountBadge>}
    >
      {detail.linked_patients.length === 0 ? (
        <EmptyCell>
          {appointmentText(
            "Für diese Klinik sind noch keine Patienten verknüpft.",
            "Для этой клиники пока нет связанных пациентов.",
            "No patients are linked to this clinic yet.",
          )}
        </EmptyCell>
      ) : (
        <div className="space-y-3">
          {detail.linked_patients.map((patient) => (
            <ListItem key={patient.id} className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {linkedProviderPatientLabel(patient)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {patient.patient_id}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {appointmentText(
                      "Letzte Aktivität",
                      "Последняя активность",
                      "Last activity",
                    )}
                    : {formatDateTimeLabel(patient.last_interaction_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CountBadge>
                    {patient.appointment_count}{" "}
                    {appointmentText("Termine", "записи", "appointments")}
                  </CountBadge>
                  <CountBadge>
                    {patient.leistung_count}{" "}
                    {appointmentText("Services", "сервисы", "services")}
                  </CountBadge>
                  <CountBadge>
                    {patient.concierge_count} Concierge
                  </CountBadge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => onOpenPatient(patient.id)}
                >
                  {appointmentText("Patient", "Пациент", "Patient")}
                </Button>
              </div>
            </ListItem>
          ))}
        </div>
      )}
    </Section>
  );
}

function LinkedProviderInteractionsSection({
  detail,
  formatDateTimeLabel,
  onOpenPatient,
  onOpenAppointment,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
}) {
  const notSet = appointmentText("Nicht festgelegt", "Не указано", "Not set");

  return (
    <Section
      title={appointmentText(
        "Interaktionsverlauf",
        "История взаимодействий",
        "Interaction history",
      )}
      accessory={<CountBadge>{detail.interactions.length}</CountBadge>}
    >
      {detail.interactions.length === 0 ? (
        <EmptyCell>
          {appointmentText(
            "Für diese Klinik gibt es noch keine Interaktionen.",
            "Для этой клиники пока нет взаимодействий.",
            "No interactions for this clinic yet.",
          )}
        </EmptyCell>
      ) : (
        <div className="space-y-3">
          {detail.interactions.map((item) => (
            <ListItem key={item.id} className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge tone="neutral">
                      {humanizeLinkedCode(item.kind)}
                    </StatusBadge>
                    <StatusBadge status={item.status}>
                      {humanizeLinkedCode(item.status)}
                    </StatusBadge>
                    {item.appointment_type ? (
                      <StatusBadge tone="info">
                        {humanizeLinkedCode(item.appointment_type)}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-semibold text-foreground">
                    {item.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.patient_id} · {item.patient_name}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeLabel(item.occurred_at)}
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className={appointmentPreviewInfoCardClassName}>
                  <InfoRow
                    label={appointmentText("Arzt", "Врач", "Doctor")}
                    value={item.doctor_name || notSet}
                  />
                </div>
                <div className={appointmentPreviewInfoCardClassName}>
                  <InfoRow
                    label={appointmentText("Standort", "Локация", "Location")}
                    value={item.location || notSet}
                  />
                </div>
              </div>

              {item.notes ? (
                <div
                  className={cn(
                    "rounded-xl px-4 py-3 text-sm leading-6 text-foreground",
                    tokens.surface.mutedCard,
                  )}
                >
                  {item.notes}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={() => onOpenPatient(item.patient_id)}
                >
                  {appointmentText("Patient", "Пациент", "Patient")}
                </Button>
                {item.kind === "appointment" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => onOpenAppointment(item.id)}
                  >
                    {appointmentText("Termin", "Запись", "Appointment")}
                  </Button>
                ) : null}
              </div>
            </ListItem>
          ))}
        </div>
      )}
    </Section>
  );
}

export type LinkedProviderSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: ProviderSheetDetail | null;
  loading: boolean;
  error: string;
  fallbackTitle: string;
  formatDateTimeLabel: (value?: string | null) => string;
  onOpenPatient: (patientId: string) => void;
  onOpenAppointment: (appointmentId: string) => void;
};

function LinkedProviderSheet({
  open,
  onOpenChange,
  detail,
  loading,
  error,
  fallbackTitle,
  formatDateTimeLabel,
  onOpenPatient,
  onOpenAppointment,
}: LinkedProviderSheetProps) {
  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={detail?.name || fallbackTitle}
      maxWidthClassName="sm:max-w-[920px]"
    >
      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {appointmentText(
            "Anbieter wird geladen",
            "Загрузка провайдера",
            "Loading provider",
          )}
        </div>
      ) : detail ? (
        <>
          {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
          <LinkedProviderOverviewSection
            detail={detail}
            formatDateTimeLabel={formatDateTimeLabel}
          />
          <LinkedProviderPatientsSection
            detail={detail}
            formatDateTimeLabel={formatDateTimeLabel}
            onOpenPatient={onOpenPatient}
          />
          <LinkedProviderInteractionsSection
            detail={detail}
            formatDateTimeLabel={formatDateTimeLabel}
            onOpenPatient={onOpenPatient}
            onOpenAppointment={onOpenAppointment}
          />
        </>
      ) : error ? (
        <Banner tone="error" withIcon>{error}</Banner>
      ) : (
        <EmptyCell>
          {appointmentText(
            "Keine Klinikdaten verfügbar.",
            "Нет данных клиники.",
            "No provider data available.",
          )}
        </EmptyCell>
      )}
    </AppointmentPreviewSheet>
  );
}

export const MemoizedLinkedProviderSheet = memo(LinkedProviderSheet);
