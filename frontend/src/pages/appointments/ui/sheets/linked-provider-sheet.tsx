import { memo } from "react";
import { LoaderCircle } from "lucide-react";

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
import { useLang, type TranslationKey, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { appointmentPreviewInfoCardClassName } from "@/pages/appointments/appearance/surface-appearance";
import { appointmentText } from "@/pages/appointments/model/labels";
import { AppointmentPreviewSheet } from "@/pages/appointments/ui/shared/workspace-primitives";
import { specializationSummaryForItems } from "@/pages/providers/model/specialization-labels";
import type { ProviderDetail as ProviderSheetDetail } from "@/pages/providers";

const LINKED_INTERACTION_KIND_LABEL_KEYS = {
  appointment: "interaction_appointment",
  concierge_service: "activity_entity_concierge_service",
  service: "interaction_service",
  activity: "interaction_activity",
} satisfies Partial<Record<string, TranslationKey>>;

const LINKED_INTERACTION_STATUS_LABEL_KEYS = {
  planned: "operations_status_planned",
  scheduled: "operations_status_planned",
  requested: "documents_requested",
  booked: "operations_status_booked",
  confirmed: "operations_status_confirmed",
  in_progress: "operations_status_in_progress",
  in_service: "operations_status_in_service",
  completed: "common_completed",
  cancelled: "invoices_workspace_status_cancelled",
  draft: "invoices_workspace_status_draft",
  delivered: "operations_status_delivered",
  approved: "operations_status_approved",
} satisfies Partial<Record<string, TranslationKey>>;

const LINKED_INTERACTION_TYPE_LABEL_KEYS = {
  medical: "providers_type_medical",
  non_medical: "providers_type_non_medical",
  internal: "operations_status_internal",
  hotel: "services_type_hotel",
  transfer: "services_type_transfer",
  vip_terminal: "services_type_vip_terminal",
  flight: "services_type_flight",
  chauffeur: "services_type_chauffeur",
  translation_support: "services_type_translation_support",
  other: "services_type_other",
} satisfies Partial<Record<string, TranslationKey>>;

const AUTO_CREATED_NON_MEDICAL_NOTE = "auto-created from non-medical appointment";

function normalizeLinkedInteractionCode(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function fallbackLinkedInteractionLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function linkedInteractionLabel(
  value: string | null | undefined,
  labelKeys: Partial<Record<string, TranslationKey>>,
  translations: Translations,
) {
  const normalized = normalizeLinkedInteractionCode(value);
  if (!normalized) return appointmentText("appointments_not_set");
  const labelKey = labelKeys[normalized];
  return labelKey ? translations[labelKey] : fallbackLinkedInteractionLabel(normalized);
}

function linkedInteractionKindLabel(value: string | null | undefined, translations: Translations) {
  return linkedInteractionLabel(value, LINKED_INTERACTION_KIND_LABEL_KEYS, translations);
}

function linkedInteractionStatusLabel(value: string | null | undefined, translations: Translations) {
  return linkedInteractionLabel(value, LINKED_INTERACTION_STATUS_LABEL_KEYS, translations);
}

function linkedInteractionTypeLabel(value: string | null | undefined, translations: Translations) {
  return linkedInteractionLabel(value, LINKED_INTERACTION_TYPE_LABEL_KEYS, translations);
}

function linkedInteractionNoteLabel(value: string | null | undefined, lang: "de" | "ru") {
  const note = value?.trim();
  if (!note) return null;
  if (note.toLowerCase() === AUTO_CREATED_NON_MEDICAL_NOTE) {
    return lang === "de"
      ? "Automatisch aus einem nicht-medizinischen Termin erstellt."
      : "Автоматически создано из немедицинского приёма.";
  }
  return note;
}

function linkedProviderAddress(detail: ProviderSheetDetail) {
  const notSet = appointmentText("appointments_not_set");
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
  const { t, lang } = useLang();
  const providerTypeLabel =
    detail.provider_type === "medical"
      ? appointmentText("appointments_medical")
      : appointmentText("appointments_non_medical");
  const notSet = appointmentText("appointments_not_set");

  return (
    <Section
      title={appointmentText("appointments_clinic_profile")}
      accessory={<CountBadge>{providerTypeLabel}</CountBadge>}
    >
      <div className="flex flex-wrap gap-2">
        <StatusBadge tone={detail.is_active ? "success" : "neutral"}>
          {detail.is_active
            ? appointmentText("appointments_active")
            : appointmentText("appointments_inactive")}
        </StatusBadge>
        {detail.kooperationsvertrag ? (
          <StatusBadge tone="warning">
            {appointmentText("appointments_contract_linked")}
          </StatusBadge>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={appointmentText("appointments_contacts")}
          value={detail.doctors.length}
        />
        <StatCard
          label={appointmentText("appointments_services_2")}
          value={detail.services.length}
        />
        <StatCard
          label={appointmentText("appointments_linked_patients")}
          value={detail.linked_patients.length}
        />
        <StatCard
          label={appointmentText("appointments_activity")}
          value={detail.interactions.length}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("appointments_name")}
            value={detail.name || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("appointments_legal_name")}
            value={detail.legal_name || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("appointments_location")}
            value={linkedProviderAddress(detail)}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("appointments_specialty")}
            value={specializationSummaryForItems(detail.specializations, detail.fachbereich, lang, notSet)}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow
            label={appointmentText("appointments_phone")}
            value={detail.phone || notSet}
          />
        </div>
        <div className={appointmentPreviewInfoCardClassName}>
          <InfoRow label={t.appointments_linked_email} value={detail.email || notSet} />
        </div>
      </div>

      {detail.notes ? (
        <ListItem className="space-y-1">
          <p className={tokens.text.label}>
            {appointmentText("appointments_notes_2")}
          </p>
          <p className="text-sm leading-6 text-foreground">{detail.notes}</p>
        </ListItem>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {appointmentText("appointments_updated")}:{" "}
        {formatDateTimeLabel(detail.updated_at)}
      </p>
    </Section>
  );
}

function LinkedProviderPatientsSection({
  detail,
  formatDateTimeLabel,
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
}) {
  const { t } = useLang();
  return (
    <Section
      title={appointmentText("appointments_linked_patients")}
      accessory={<CountBadge>{detail.linked_patients.length}</CountBadge>}
    >
      {detail.linked_patients.length === 0 ? (
        <EmptyCell>
          {appointmentText("appointments_no_patients_are_linked_to_this_clinic_yet")}
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
                    {appointmentText("appointments_last_activity")}
                    : {formatDateTimeLabel(patient.last_interaction_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <CountBadge>
                    {patient.appointment_count}{" "}
                    {appointmentText("appointments_appointments_2")}
                  </CountBadge>
                  <CountBadge>
                    {patient.leistung_count}{" "}
                    {appointmentText("appointments_services_3")}
                  </CountBadge>
                  <CountBadge>
                    {patient.concierge_count} {t.appointments_linked_concierge}
                  </CountBadge>
                </div>
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
}: {
  detail: ProviderSheetDetail;
  formatDateTimeLabel: (value?: string | null) => string;
}) {
  const notSet = appointmentText("appointments_not_set");
  const { lang, t } = useLang();

  return (
    <Section
      title={appointmentText("appointments_interaction_history")}
      accessory={<CountBadge>{detail.interactions.length}</CountBadge>}
    >
      {detail.interactions.length === 0 ? (
        <EmptyCell>
          {appointmentText("appointments_no_interactions_for_this_clinic_yet")}
        </EmptyCell>
      ) : (
        <div className="space-y-3">
          {detail.interactions.map((item) => {
            const notes = linkedInteractionNoteLabel(item.notes, lang);
            return (
              <ListItem key={item.id} className="space-y-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="neutral">
                        {linkedInteractionKindLabel(item.kind, t)}
                      </StatusBadge>
                      <StatusBadge status={item.status}>
                        {linkedInteractionStatusLabel(item.status, t)}
                      </StatusBadge>
                      {item.appointment_type ? (
                        <StatusBadge tone="info">
                          {linkedInteractionTypeLabel(item.appointment_type, t)}
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
                      label={appointmentText("appointments_doctor")}
                      value={item.doctor_name || notSet}
                    />
                  </div>
                  <div className={appointmentPreviewInfoCardClassName}>
                    <InfoRow
                      label={appointmentText("appointments_location")}
                      value={item.location || notSet}
                    />
                  </div>
                </div>

                {notes ? (
                  <div
                    className={cn(
                      "rounded-xl px-4 py-3 text-sm leading-6 text-foreground",
                      tokens.surface.mutedCard,
                    )}
                  >
                    {notes}
                  </div>
                ) : null}
              </ListItem>
            );
          })}
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
};

function LinkedProviderSheet({
  open,
  onOpenChange,
  detail,
  loading,
  error,
  fallbackTitle,
  formatDateTimeLabel,
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
          {appointmentText("appointments_loading_provider")}
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
          />
          <LinkedProviderInteractionsSection
            detail={detail}
            formatDateTimeLabel={formatDateTimeLabel}
          />
        </>
      ) : error ? (
        <Banner tone="error" withIcon>{error}</Banner>
      ) : (
        <EmptyCell>
          {appointmentText("appointments_no_provider_data_available")}
        </EmptyCell>
      )}
    </AppointmentPreviewSheet>
  );
}

export const MemoizedLinkedProviderSheet = memo(LinkedProviderSheet);
