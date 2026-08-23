import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  LoaderCircle,
  NotebookText,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { cachedNumberFormat } from "@/lib/intl-cache";
import {
  knownLeadProgramServiceLabel,
  leadInsuranceCoverageLabel,
  leadIntakeTypeFromLead,
  leadLanguageLabel,
  leadLocationDetailedLabel,
  leadLocationLabel,
  leadMedicalRecordsLabel,
  leadPreferredLocationLabel,
  leadProgramServiceLabel,
  leadSourceLabel,
  leadTypeLabel,
  leadVisitTimingLabel,
} from "@/pages/leads/model/leads-model";
import { specializationLabelForValue } from "@/pages/providers/model/specialization-labels";
import { LinkedTasksSection, OPEN_PATIENT_TASK_CREATOR_EVENT } from "@/pages/concierge/linked-tasks-section";

import {
  fetchPatientRelations,
} from "../../data/patient-detail-mutations";
import { patientRelationTypeLabel } from "../../model/detail-model";
import type { RelationItem } from "../../model/detail-tab-types";
import type { PatientLegalStatus } from "../../model/legal-status";
import type { PatientDetail } from "../../model/list-model";
import {
  createPatientLeadOrigin,
  type LeadOriginSelectedWorkType,
} from "../../model/patient-lead-origin";
import { LegalStatusPill } from "../shared/legal-status-pill";
import { FormSection, humanizeFunctionalLabel } from "../shared/patient-form-primitives";

const loadPatientLegalStatusSheet = () => import("../sheets/patient-legal-status-sheet");
const loadPatientNotesSheet = () => import("../sheets/patient-notes-sheet");

const LazyPatientLegalStatusSheet = lazy(async () => {
  const mod = await loadPatientLegalStatusSheet();
  return { default: mod.PatientLegalStatusSheet };
});

const LazyPatientNotesSheet = lazy(async () => {
  const mod = await loadPatientNotesSheet();
  return { default: mod.PatientNotesSheet };
});

type LocalizeFn = (key: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type StatusLabelFn = (status: string) => string;
type FieldValueFn = (value: string | string[] | null | undefined, fallback: string) => string;
type ToggleHandler = (open: boolean) => void;
type PatientProfileContact = NonNullable<PatientDetail["contacts"]>[number];
type LegalStatusChecklistItem = {
  key: string;
  label: string;
  done: boolean;
};

type LiveRelationsState = {
  patientId: string;
  status: "loading" | "loaded" | "unavailable";
  items: RelationItem[];
};

function profileRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function useLivePatientRelations(patientId: string): LiveRelationsState {
  const [state, setState] = useState<LiveRelationsState>({
    patientId,
    status: "loading",
    items: [],
  });

  useEffect(() => {
    let active = true;
    void fetchPatientRelations(patientId)
      .then((items) => {
        if (active) setState({ patientId, status: "loaded", items });
      })
      .catch(() => {
        if (active) setState({ patientId, status: "unavailable", items: [] });
      });

    return () => {
      active = false;
    };
  }, [patientId]);

  return state.patientId === patientId
    ? state
    : { patientId, status: "loading", items: [] };
}

function intakeDiscoverySourceLabel(value: string | null, t: Translations) {
  if (!value) return null;
  const labels: Record<string, string> = {
    customer_referral: t.patient_profile_discovery_customer_referral,
    online: t.patient_profile_discovery_online,
    employee_referral: t.patient_profile_discovery_employee_referral,
    medical_referral: t.patient_profile_discovery_medical_referral,
    partner_referral: t.patient_profile_discovery_partner_referral,
    insurance_referral: t.patient_profile_discovery_insurance_referral,
    social_media: t.patient_profile_discovery_social_media,
    advertising: t.patient_profile_discovery_advertising,
    event: t.patient_profile_discovery_event,
    other: t.patient_profile_discovery_other,
  };
  return labels[value] ?? humanizeFunctionalLabel(value);
}

function intakeFlowDisplay(value: string | null, t: Translations) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const german = t.lead_type_questionnaire === "Fragebogen";
  const labels: Record<string, string> = {
    eu: t.lead_option_location_eu,
    germany: t.lead_option_location_germany,
    eu_not_germany: t.lead_option_location_eu_not_germany,
    outside_eu: t.lead_option_location_outside_eu,
    medical: german ? "Medizinisch" : "Медицинский",
    contact: german ? "Kontaktformular" : "Контактная форма",
    standard: german ? "Standard" : "Стандартный",
  };
  return labels[normalized] ?? humanizeFunctionalLabel(value);
}

function selectedWorkTypeName(item: LeadOriginSelectedWorkType, lang: "de" | "ru") {
  const names = lang === "de"
    ? [item.nameDe, item.nameEn, item.nameRu, item.nameEs]
    : [item.nameRu, item.nameDe, item.nameEn, item.nameEs];
  return names.find((name) => name.trim()) ?? item.code;
}

function selectedWorkTypeNumber(value: number, lang: "de" | "ru") {
  return cachedNumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function selectedWorkTypePriceRange(item: LeadOriginSelectedWorkType, lang: "de" | "ru") {
  if (item.minPriceEur == null && item.maxPriceEur == null) return null;
  if (item.minPriceEur == null) return `${selectedWorkTypeNumber(item.maxPriceEur as number, lang)} EUR`;
  if (item.maxPriceEur == null) return `${selectedWorkTypeNumber(item.minPriceEur, lang)} EUR`;
  return `${selectedWorkTypeNumber(item.minPriceEur, lang)} - ${selectedWorkTypeNumber(item.maxPriceEur, lang)} EUR`;
}

function ProfileDetailTile({
  label,
  value,
  done,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  done: boolean;
  children?: ReactNode;
}) {
  return (
    <article
      className={cn(
        "group grid min-w-0 gap-2 border-b border-border/60 bg-white px-3 py-2.5 transition-colors last:border-b-0 hover:bg-muted/20 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center",
      )}
    >
      <div
        className={cn(
          "hidden size-7 shrink-0 items-center justify-center rounded-md sm:flex",
          done ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
        )}
      >
        {children}
      </div>
      <p className="min-w-0 break-words text-sm font-medium leading-5 text-foreground">
        {label}
      </p>
      <div className="flex items-center justify-start sm:justify-end">
        <Badge
          variant="outline"
          className={cn(
            "h-6 rounded-full px-2 text-[10px]",
            done
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700",
          )}
        >
          {value}
        </Badge>
      </div>
    </article>
  );
}

function ProfileSummaryCard({
  title,
  children,
  className,
  action,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn("overflow-hidden rounded-lg border border-border/70 bg-card", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border/70 bg-muted/20 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="divide-y divide-border/60">
        {children}
      </div>
    </section>
  );
}

function ProfileSummaryLine({
  label,
  value,
  onEdit,
  editLabel,
}: {
  label: ReactNode;
  value: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}) {
  return (
    <div className="group relative grid min-w-0 gap-1.5 px-3.5 py-2.5 sm:grid-cols-[minmax(10rem,0.4fr)_minmax(0,1fr)_1.75rem] sm:items-center sm:gap-3">
      <span className="min-w-0 break-words text-xs font-medium text-muted-foreground sm:text-[13px]">
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 break-words text-sm font-medium leading-snug text-foreground",
          !onEdit && "sm:col-span-2",
        )}
      >
        {value}
      </span>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          className="absolute right-2 top-1/2 rounded-md p-1 text-muted-foreground/70 opacity-0 transition -translate-y-1/2 hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 sm:static sm:translate-y-0"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function PatientEmergencyContactSummary({
  detail,
  fieldValue,
  formatDate,
  t,
}: {
  detail: PatientDetail;
  fieldValue: FieldValueFn;
  formatDate: DateFormatter;
  t: Translations;
}) {
  const liveRelations = useLivePatientRelations(detail.id);
  const emergencyRelations = liveRelations.items.filter((relation) => relation.is_emergency_contact);
  const hasStoredEmergencyContact = Boolean(
    detail.emergency_contact_name?.trim()
      || detail.emergency_contact_phone?.trim()
      || detail.emergency_contact_relation?.trim(),
  );

  if (liveRelations.status === "loaded" && emergencyRelations.length > 0) {
    return emergencyRelations.map((relation, index) => (
      <div key={relation.id} className={cn(index > 0 && "mt-2 border-t border-border pt-2")}>
        <ProfileSummaryLine
          label={t.patients_emergency_name}
          value={fieldValue(relation.related_display_name || relation.related_name, t.common_not_set)}
        />
        {relation.phone ? <ProfileSummaryLine label={t.patients_emergency_phone} value={relation.phone} /> : null}
        <ProfileSummaryLine
          label={t.patients_emergency_relation}
          value={patientRelationTypeLabel(relation.relation_type)}
        />
        {relation.notes ? <ProfileSummaryLine label={t.patient_relation_notes} value={relation.notes} /> : null}
      </div>
    ));
  }

  if (hasStoredEmergencyContact) {
    return (
      <>
        <ProfileSummaryLine label={t.patients_emergency_name} value={fieldValue(detail.emergency_contact_name, t.common_not_set)} />
        <ProfileSummaryLine label={t.patients_emergency_phone} value={fieldValue(detail.emergency_contact_phone, t.common_not_set)} />
        <ProfileSummaryLine
          label={t.patients_emergency_relation}
          value={detail.emergency_contact_relation
            ? patientRelationTypeLabel(detail.emergency_contact_relation)
            : t.common_not_set}
        />
      </>
    );
  }

  if (liveRelations.status === "loading") {
    return (
      <div className="flex min-h-20 items-center justify-center text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-label={t.common_loading} />
      </div>
    );
  }

  if (liveRelations.status === "loaded") {
    return <ProfileSummaryLine label={t.patients_emergency_name} value={t.common_not_set} />;
  }

  const leadOrigin = createPatientLeadOrigin(detail);
  const intakeContacts = leadOrigin.records("trusted_contacts");
  if (intakeContacts.length > 0) {
    return intakeContacts.map((contact, index) => {
      const contactId = profileRecordString(contact, "id") ?? `trusted-contact-${index + 1}`;
      const name = profileRecordString(contact, "name");
      const phone = profileRecordString(contact, "phone");
      const email = profileRecordString(contact, "email");
      const relation = profileRecordString(contact, "relation");
      const birthDate = profileRecordString(contact, "birth_date");
      const address = profileRecordString(contact, "address");
      return (
        <div key={contactId} className={cn(index > 0 && "mt-2 border-t border-border pt-2")}>
          <ProfileSummaryLine label={t.patients_emergency_name} value={fieldValue(name, t.common_not_set)} />
          {phone ? <ProfileSummaryLine label={t.patients_emergency_phone} value={phone} /> : null}
          {email ? <ProfileSummaryLine label={t.patient_profile_editor_email} value={email} /> : null}
          {relation ? (
            <ProfileSummaryLine
              label={t.patients_emergency_relation}
              value={patientRelationTypeLabel(relation)}
            />
          ) : null}
          {birthDate ? <ProfileSummaryLine label={t.patients_birth_date} value={formatDate(birthDate)} /> : null}
          {address ? <ProfileSummaryLine label={t.patient_profile_editor_address} value={address} /> : null}
        </div>
      );
    });
  }

  const intakeContact = leadOrigin.record("trusted_contact");
  const name = leadOrigin.string("trusted_contact_name") ?? profileRecordString(intakeContact, "name");
  const phone = leadOrigin.string("trusted_contact_phone") ?? profileRecordString(intakeContact, "phone");
  const email = leadOrigin.string("trusted_contact_email") ?? profileRecordString(intakeContact, "email");
  const relation = leadOrigin.string("trusted_contact_relation") ?? profileRecordString(intakeContact, "relation");
  const birthDate = leadOrigin.string("trusted_contact_birth_date") ?? profileRecordString(intakeContact, "birth_date");
  const address = leadOrigin.string("trusted_contact_address") ?? profileRecordString(intakeContact, "address");
  if (![name, phone, email, relation, birthDate, address].some(Boolean)) {
    return <ProfileSummaryLine label={t.patients_emergency_name} value={t.common_not_set} />;
  }

  return (
    <>
      <ProfileSummaryLine label={t.patients_emergency_name} value={fieldValue(name, t.common_not_set)} />
      {phone ? <ProfileSummaryLine label={t.patients_emergency_phone} value={phone} /> : null}
      {email ? <ProfileSummaryLine label={t.patient_profile_editor_email} value={email} /> : null}
      {relation ? (
        <ProfileSummaryLine label={t.patients_emergency_relation} value={patientRelationTypeLabel(relation)} />
      ) : null}
      {birthDate ? <ProfileSummaryLine label={t.patients_birth_date} value={formatDate(birthDate)} /> : null}
      {address ? <ProfileSummaryLine label={t.patient_profile_editor_address} value={address} /> : null}
    </>
  );
}

function ProfileActionCard({
  title,
  description,
  disabled = false,
  busy = false,
  onClick,
}: {
  title: ReactNode;
  description: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="group grid w-full min-w-0 gap-2 border-b border-border/60 bg-white px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-orange-50/40 disabled:cursor-not-allowed disabled:opacity-60 sm:grid-cols-[minmax(12rem,0.45fr)_minmax(0,1fr)_2rem] sm:items-center"
      onClick={onClick}
    >
      <h3 className="min-w-0 text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="min-w-0 text-xs leading-5 text-muted-foreground">
        {description}
      </p>
      <span className="flex size-8 items-center justify-center rounded-md bg-orange-50 text-orange-700 transition-colors group-hover:bg-orange-100 group-hover:text-orange-800">
        {busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        )}
      </span>
    </button>
  );
}

function ProfileRecordShell({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="min-w-0">{children}</div>
        {aside ? (
          <div className="flex shrink-0 justify-start md:min-w-[120px] md:justify-end">
            {aside}
          </div>
        ) : null}
      </div>
    </article>
  );
}

type PatientProfileTabProps = {
  profileControls: {
    canCreateOrders: boolean;
    canCreateTasks: boolean;
    canEditPatientProfile: boolean;
    canExportPatientCompliance: boolean;
    canOpenComplianceWorkspace: boolean;
    canViewContracts: boolean;
    canViewDocuments: boolean;
    canViewInvoices: boolean;
  };
  complianceExportBusy: boolean;
  detail: PatientDetail;
  fieldValue: FieldValueFn;
  formatDate: DateFormatter;
  genderLabel: (value: string | null | undefined, tr: Record<string, string>) => string;
  handleExportPatientCompliance: () => void | Promise<void>;
  id?: string;
  insuranceLabel: (value: string | null | undefined, tr: Record<string, string>) => string;
  l: LocalizeFn;
  legalStatus: PatientLegalStatus;
  legalStatusChecklist: LegalStatusChecklistItem[];
  legalStatusCompletion: {
    completed: number;
    total: number;
    ratio: number;
  };
  legalStatusSheetOpen: boolean;
  notesSheetOpen: boolean;
  onLegalStatusSheetOpenChange: ToggleHandler;
  onOpenTab: (tab: "orders" | "documents" | "contracts" | "invoices") => void;
  onNotesSheetOpenChange: ToggleHandler;
  openProfileEditor: () => void;
  patientDetailStatusLabel: StatusLabelFn;
  reload: () => void;
  staffGo: (to: string) => void;
  t: Translations;
  tr: Record<string, string>;
};

function usePatientProfileTabContent({
  profileControls,
  complianceExportBusy,
  detail,
  fieldValue,
  formatDate,
  handleExportPatientCompliance,
  id,
  insuranceLabel,
  l,
  legalStatus,
  legalStatusChecklist,
  legalStatusCompletion,
  legalStatusSheetOpen,
  notesSheetOpen,
  onLegalStatusSheetOpenChange,
  onNotesSheetOpenChange,
  onOpenTab,
  openProfileEditor,
  patientDetailStatusLabel,
  reload,
  staffGo,
  t,
  tr,
}: PatientProfileTabProps) {
  const {
    canCreateOrders,
    canCreateTasks,
    canEditPatientProfile,
    canExportPatientCompliance,
    canOpenComplianceWorkspace,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
  } = profileControls;
  const editAction = canEditPatientProfile ? openProfileEditor : undefined;

  function handleLegalStatusSheetOpenChange(open: boolean) {
    if (open) void loadPatientLegalStatusSheet();
    onLegalStatusSheetOpenChange(open);
  }

  function handleNotesSheetOpenChange(open: boolean) {
    if (open) void loadPatientNotesSheet();
    onNotesSheetOpenChange(open);
  }

  const leadOrigin = createPatientLeadOrigin(detail);
  const intakeSource = leadOrigin.string("source");
  const intakeSourceKind = leadOrigin.string("intake_source");
  const intakeFlow = leadOrigin.string("flow");
  const intakeLeadType = leadOrigin.string("lead_type") ?? leadIntakeTypeFromLead({
    lead_type: null,
    intake_source: intakeSourceKind,
    source: intakeSource,
    flow: intakeFlow,
  });
  const selectedProgram = leadOrigin.string("selected_program");
  const locationDetailed = leadOrigin.string("location_detailed");
  const location = leadOrigin.string("location");
  const preferredLocation = leadOrigin.string("preferred_location");
  const visitTiming = leadOrigin.string("visit_timing");
  const intakeMessage = leadOrigin.string("message");
  const primaryConcern = leadOrigin.string("primary_concern_text");
  const additionalConcerns = leadOrigin.string("additional_concerns");
  const internalNotes = leadOrigin.string("notes");
  const discoverySource = leadOrigin.string("discovery_source");
  const referrer = leadOrigin.string("referrer");
  const insuranceCoverage = leadOrigin.string("insurance_covers_germany");
  const medicalRecords = leadOrigin.string("has_medical_records");
  const requestedSpecialties = leadOrigin.strings("requested_specialties");
  const recordsInAcceptedLanguage = leadOrigin.boolean("records_in_accepted_language");
  const canTravel = leadOrigin.boolean("can_travel");
  const hasTravelDocuments = leadOrigin.boolean("has_travel_documents");
  const currentlyInTreatment = leadOrigin.boolean("currently_in_treatment");
  const hasTravelHealthRisk = leadOrigin.boolean("has_health_risk_for_travel");
  const wantsMembership = leadOrigin.boolean("wants_membership");
  const interpreterNeeded = leadOrigin.boolean("needs_interpreter");
  const emailConsent = leadOrigin.boolean("email_consent");
  const whatsappConsent = leadOrigin.boolean("whatsapp_consent");
  const automatedContactConsent = leadOrigin.boolean("consent_automated_contact");
  const healthcareConsent = leadOrigin.boolean("consent_healthcare");
  const privacyConsent = leadOrigin.boolean("consent_privacy_practices");
  const consentOptOut = leadOrigin.boolean("consent_opt_out");
  const programDateFrom = leadOrigin.string("program_date_from")
    ?? (typeof leadOrigin.wizardState["program_date_from"] === "string" ? leadOrigin.wizardState["program_date_from"] : null);
  const programDateTo = leadOrigin.string("program_date_to")
    ?? (typeof leadOrigin.wizardState["program_date_to"] === "string" ? leadOrigin.wizardState["program_date_to"] : null);
  const profileLang = t.lead_type_questionnaire === "Fragebogen" ? "de" : "ru";
  const selectedWorkTypes = leadOrigin.selectedWorkTypes;
  const costEstimateAdditionalLanguage = leadOrigin.string("cost_estimate_additional_language");
  const requestedSpecialtiesValue = requestedSpecialties
    .map((value) => specializationLabelForValue(value, [], profileLang))
    .join(", ");
  const intakeSourceValue = [
    intakeSource ? leadSourceLabel(intakeSource, t) : null,
    intakeFlowDisplay(intakeFlow, t),
  ].filter(Boolean).join(" · ");
  const intakeLocationValue = [
    locationDetailed
      ? leadLocationDetailedLabel(locationDetailed, t)
      : location
        ? leadLocationLabel(location, t)
        : null,
    preferredLocation ? leadPreferredLocationLabel(preferredLocation, t) : null,
    visitTiming ? leadVisitTimingLabel(visitTiming, t) : null,
  ].filter(Boolean).join(" · ");
  const programPeriodValue = [
    programDateFrom ? formatDate(programDateFrom) : null,
    programDateTo ? formatDate(programDateTo) : null,
  ].filter(Boolean).join(" - ");
  const hasIntakeProfile = leadOrigin.hasData;
  const booleanValue = (value: boolean | null) => (
    value == null ? t.common_not_set : value ? l("patients_yes") : l("patients_no")
  );

  return (
    <div className="space-y-5 mt-4 min-h-[400px]">
      {canCreateTasks && id ? <LinkedTasksSection patientId={id} patientName={[detail.first_name, detail.last_name].filter(Boolean).join(" ")} /> : null}

      <div className="space-y-3">
        <ProfileSummaryCard
          title={t.patient_profile_personal_data}
        >
          <ProfileSummaryLine
            label={t.patients_nationality}
            value={fieldValue(detail.nationality, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_nationality, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_residence_country}
            value={fieldValue(detail.residence_country, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_residence_country, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_languages}
            value={fieldValue(detail.languages, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_languages, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patient_profile_functional_labels}
            value={
              detail.functional_labels?.length
                ? detail.functional_labels
                    .map((label) => humanizeFunctionalLabel(label))
                    .join(", ")
                : t.common_not_set
            }
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patient_profile_functional_labels, t.patient_profile_edit_field_aria)}
          />
        </ProfileSummaryCard>

        <ProfileSummaryCard
          title={t.patient_profile_contact}
        >
          {patientProfileContactRows(detail, t, l).map((contact) => (
            <ProfileSummaryLine
              key={contact.key}
              label={contact.label}
              value={(
                <span className="flex min-w-0 flex-col items-end gap-0.5">
                  <span>{fieldValue(contact.value, t.common_not_set)}</span>
                  {contact.note ? (
                    <span className="break-words text-[11px] font-normal leading-4 text-muted-foreground">
                      {contact.note}
                    </span>
                  ) : null}
                </span>
              )}
              onEdit={editAction}
              editLabel={editPatientFieldLabel(String(contact.label), t.patient_profile_edit_field_aria)}
            />
          ))}
        </ProfileSummaryCard>

        <ProfileSummaryCard
          title={t.patient_profile_insurance_and_payer}
        >
          <ProfileSummaryLine
            label={t.patients_insurance_type}
            value={insuranceLabel(detail.insurance_type, tr)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_insurance_type, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_insurance_provider}
            value={fieldValue(detail.insurance_provider, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_insurance_provider, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_insurance_number}
            value={fieldValue(detail.insurance_number, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_insurance_number, t.patient_profile_edit_field_aria)}
          />
        </ProfileSummaryCard>

        <ProfileSummaryCard
          title={t.patient_profile_address}
        >
          <ProfileSummaryLine
            label={t.patients_address_street}
            value={fieldValue(detail.address_street, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_address_street, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_address_city}
            value={fieldValue(detail.address_city, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_address_city, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_address_zip}
            value={fieldValue(detail.address_zip, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_address_zip, t.patient_profile_edit_field_aria)}
          />
          <ProfileSummaryLine
            label={t.patients_address_country}
            value={fieldValue(detail.address_country, t.common_not_set)}
            onEdit={editAction}
            editLabel={editPatientFieldLabel(t.patients_address_country, t.patient_profile_edit_field_aria)}
          />
        </ProfileSummaryCard>

        <ProfileSummaryCard
          title={t.patient_profile_emergency_contact}
        >
          <PatientEmergencyContactSummary
            detail={detail}
            fieldValue={fieldValue}
            formatDate={formatDate}
            t={t}
          />
        </ProfileSummaryCard>

        {hasIntakeProfile ? (
          <ProfileSummaryCard
            title={t.patient_profile_intake_data}
            action={leadOrigin.sourceLeadId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={t.patient_profile_intake_open_lead}
                aria-label={t.patient_profile_intake_open_lead}
                onClick={() => staffGo(`/leads?lead=${encodeURIComponent(leadOrigin.sourceLeadId ?? "")}`)}
              >
                <ArrowUpRight className="size-3.5" />
              </Button>
            ) : null}
          >
            <ProfileSummaryLine
              label={t.patient_profile_intake_lead_type}
              value={fieldValue(leadTypeLabel(intakeLeadType, t), t.common_not_set)}
            />
            {leadOrigin.sourceLeadId ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_lead_id}
                value={<span className="font-mono text-xs tabular-nums">{leadOrigin.sourceLeadId}</span>}
              />
            ) : null}
            <ProfileSummaryLine
              label={t.patient_profile_intake_source}
              value={fieldValue(intakeSourceValue, t.common_not_set)}
            />
            {leadOrigin.string("submitted_at") ? (
              <ProfileSummaryLine
                label={t.lead_submitted_at}
                value={formatDate(leadOrigin.string("submitted_at"))}
              />
            ) : null}
            {primaryConcern ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_primary_concern}
                value={primaryConcern}
              />
            ) : null}
            {additionalConcerns ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_additional_concerns}
                value={additionalConcerns}
              />
            ) : null}
            {requestedSpecialtiesValue ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_specialties}
                value={requestedSpecialtiesValue}
              />
            ) : null}
            {selectedProgram ? (
              <ProfileSummaryLine
                label={t.lead_selected_program}
                value={leadProgramServiceLabel(selectedProgram, t)}
              />
            ) : null}
            {programPeriodValue ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_program_period}
                value={programPeriodValue}
              />
            ) : null}
            <ProfileSummaryLine
              label={t.patient_profile_intake_location}
              value={fieldValue(intakeLocationValue, t.common_not_set)}
            />
            <ProfileSummaryLine
              label={t.patient_profile_intake_interpreter}
              value={interpreterNeeded == null ? t.common_not_set : interpreterNeeded ? l("patients_yes") : l("patients_no")}
            />
            <ProfileSummaryLine
              label={t.patient_profile_intake_message}
              value={fieldValue(intakeMessage, t.common_not_set)}
            />
            {internalNotes ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_internal_notes}
                value={internalNotes}
              />
            ) : null}
            {discoverySource ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_discovery}
                value={fieldValue(intakeDiscoverySourceLabel(discoverySource, t), t.common_not_set)}
              />
            ) : null}
            {referrer ? (
              <ProfileSummaryLine label={t.patient_profile_intake_referrer} value={referrer} />
            ) : null}
            {insuranceCoverage ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_insurance_coverage}
                value={leadInsuranceCoverageLabel(insuranceCoverage, t)}
              />
            ) : null}
            {medicalRecords ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_medical_records}
                value={leadMedicalRecordsLabel(medicalRecords, t)}
              />
            ) : null}
            {recordsInAcceptedLanguage != null ? (
              <ProfileSummaryLine
                label={t.patient_profile_intake_records_language}
                value={booleanValue(recordsInAcceptedLanguage)}
              />
            ) : null}
            {canTravel != null ? (
              <ProfileSummaryLine label={t.patient_profile_intake_can_travel} value={booleanValue(canTravel)} />
            ) : null}
            {hasTravelDocuments != null ? (
              <ProfileSummaryLine label={t.patient_profile_intake_travel_documents} value={booleanValue(hasTravelDocuments)} />
            ) : null}
            {currentlyInTreatment != null ? (
              <ProfileSummaryLine label={t.patient_profile_intake_current_treatment} value={booleanValue(currentlyInTreatment)} />
            ) : null}
            {hasTravelHealthRisk != null ? (
              <ProfileSummaryLine label={t.patient_profile_intake_travel_risk} value={booleanValue(hasTravelHealthRisk)} />
            ) : null}
            {wantsMembership != null ? (
              <ProfileSummaryLine label={t.patient_profile_intake_membership} value={booleanValue(wantsMembership)} />
            ) : null}
            {emailConsent != null ? (
              <ProfileSummaryLine label={t.lead_email_consent} value={booleanValue(emailConsent)} />
            ) : null}
            {whatsappConsent != null ? (
              <ProfileSummaryLine label={t.lead_whatsapp_consent} value={booleanValue(whatsappConsent)} />
            ) : null}
            {automatedContactConsent != null ? (
              <ProfileSummaryLine label={t.lead_consent_automated_contact} value={booleanValue(automatedContactConsent)} />
            ) : null}
            {healthcareConsent != null ? (
              <ProfileSummaryLine label={t.lead_consent_healthcare} value={booleanValue(healthcareConsent)} />
            ) : null}
            {privacyConsent != null ? (
              <ProfileSummaryLine label={t.lead_consent_privacy_practices} value={booleanValue(privacyConsent)} />
            ) : null}
            {consentOptOut != null ? (
              <ProfileSummaryLine label={t.lead_consent_opt_out} value={booleanValue(consentOptOut)} />
            ) : null}
            {selectedWorkTypes.length > 0
            || leadOrigin.serviceRequests.length > 0
            || costEstimateAdditionalLanguage ? (
              <div className="mt-2 border-t border-border pt-2 md:col-span-2">
                <p className="px-2 pb-1 text-[11px] font-medium uppercase text-muted-foreground">
                  {t.patient_profile_intake_services}
                </p>
                {costEstimateAdditionalLanguage ? (
                  <ProfileSummaryLine
                    label={profileLang === "de" ? "Zusätzliche Sprache" : "Дополнительный язык"}
                    value={leadLanguageLabel(costEstimateAdditionalLanguage, t)}
                  />
                ) : null}
                {selectedWorkTypes.length > 0 ? (
                  <div className="mt-1">
                    <p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">
                      {profileLang === "de" ? "Ausgewählte Leistungsarten" : "Выбранные виды работ"}
                    </p>
                    <div className="overflow-hidden rounded-md border border-border/60 bg-white">
                      {selectedWorkTypes.map((workType) => {
                        const priceRange = selectedWorkTypePriceRange(workType, profileLang);
                        return (
                          <article
                            key={workType.id}
                            className="grid min-w-0 gap-1.5 border-b border-border/60 px-3 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
                          >
                            <p className="min-w-0 break-words text-sm font-semibold leading-5 text-foreground">
                              {selectedWorkTypeName(workType, profileLang)}
                            </p>
                            <span className="text-xs text-muted-foreground">
                              {workType.durationHours != null
                                ? `${profileLang === "de" ? "Dauer" : "Длительность"}: ${selectedWorkTypeNumber(workType.durationHours, profileLang)} ${profileLang === "de" ? "Std." : "ч"}`
                                : "—"}
                            </span>
                            <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                              {priceRange ?? "—"}
                            </span>
                          </article>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {leadOrigin.serviceRequests.length > 0 ? (
                  <div className="mt-1 divide-y divide-border/60">
                    {leadOrigin.serviceRequests.map((service) => (
                      <ProfileSummaryLine
                        key={service.value}
                        label={knownLeadProgramServiceLabel(service.value, t) ?? leadProgramServiceLabel(service.value, t)}
                        value={service.comment ?? t.patient_profile_intake_service_requested}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </ProfileSummaryCard>
        ) : null}

        <ProfileSummaryCard title={t.patient_profile_editor_passport}>
          <ProfileSummaryLine
            label={t.patient_profile_editor_passport_number}
            value={fieldValue(detail.passport_number, t.common_not_set)}
          />
          <ProfileSummaryLine
            label={t.patient_profile_editor_passport_expiry}
            value={
              detail.passport_expiry ? (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <span>{formatDate(detail.passport_expiry)}</span>
                  {detail.passport_status === "expired" ||
                  detail.passport_status === "expiring" ? (
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]",
                        detail.passport_status === "expired"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {detail.passport_status === "expired"
                        ? t.patient_passport_expired
                        : t.patient_passport_expiring}
                    </span>
                  ) : null}
                </span>
              ) : (
                t.common_not_set
              )
            }
          />
        </ProfileSummaryCard>
      </div>

      <FormSection
        title={
          <span className="inline-flex items-center gap-2">
            {t.patients_legal_status}
            <LegalStatusPill status={legalStatus} />
          </span>
        }
        accessory={
          canEditPatientProfile ? (
            <Button type="button" size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => handleLegalStatusSheetOpenChange(true)}>
              <Pencil className="size-3.5" />
              {t.patient_profile_update_status}
            </Button>
          ) : null
        }
      >
        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          {[
            {
              icon: ShieldCheck,
              label: t.patient_profile_contract_status,
              value: patientDetailStatusLabel(legalStatus.contractStatus),
              description: l("patients_contract_readiness"),
              iconClass: "bg-sky-50 text-sky-700",
            },
            {
              icon: CheckCircle2,
              label: t.patient_profile_done,
              value: `${legalStatusCompletion.completed}/${legalStatusCompletion.total}`,
              description: l("patients_required_checks"),
              iconClass: "bg-emerald-50 text-emerald-700",
            },
            {
              icon: ClipboardCheck,
              label: l("patients_compliance"),
              value: legalStatus.complianceCompleted ? t.common_completed : t.common_pending,
              description: l("patients_internal_approval"),
              iconClass: legalStatus.complianceCompleted
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700",
            },
            {
              icon: NotebookText,
              label: t.patient_profile_notes,
              value: legalStatus.notes ? l("patients_yes") : l("patients_no"),
              description: l("patients_legal_note"),
              iconClass: "bg-slate-100 text-slate-700",
            },
          ].map((metric) => {
            const Icon = metric.icon;
            return (
              <div
                key={String(metric.label)}
                className="grid min-w-0 gap-2 border-b border-border/60 px-3 py-2.5 last:border-b-0 sm:grid-cols-[2rem_minmax(10rem,0.42fr)_minmax(8rem,0.3fr)_minmax(0,1fr)] sm:items-center"
              >
                <span className={cn("hidden size-7 items-center justify-center rounded-md sm:flex", metric.iconClass)}>
                  <Icon className="size-3.5" />
                </span>
                <span className="text-xs font-medium text-muted-foreground sm:text-[13px]">{metric.label}</span>
                <span className="text-sm font-semibold text-foreground">{metric.value}</span>
                <span className="text-xs leading-5 text-muted-foreground">{metric.description}</span>
              </div>
            );
          })}
        </div>

        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          {legalStatusChecklist.map((item) => (
            <ProfileDetailTile
              key={item.key}
              label={item.label}
              value={item.done ? t.common_completed : t.common_pending}
              done={item.done}
            >
              {item.done ? (
                <CheckCircle2 className="size-4" />
              ) : (
                <AlertTriangle className="size-4" />
              )}
            </ProfileDetailTile>
          ))}
        </div>

        {legalStatus.notes ? (
          <ProfileRecordShell
            aside={
              <Badge variant="outline" className="rounded-full border-sky-200 bg-sky-50 text-sky-700">
                {t.patient_profile_notes}
              </Badge>
            }
          >
            <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">
              {legalStatus.notes}
            </p>
          </ProfileRecordShell>
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
          {canCreateOrders && id ? (
            <ProfileActionCard
              title={t.orders_create_title}
              description={t.orders_create_description}
              onClick={() => staffGo(`/orders?create=1&patient=${encodeURIComponent(id)}`)}
            />
          ) : null}
          {canCreateTasks && id ? (
            <ProfileActionCard
              title={l("patients_create_task_for_this_patient")}
              description={l("patients_create_internal_or_external_task_linked_to_this_patient")}
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_PATIENT_TASK_CREATOR_EVENT, { detail: { patientId: id } }))}
            />
          ) : null}
          {canExportPatientCompliance ? (
            <ProfileActionCard
              title={t.patient_profile_dsgvo_export}
              description={l("patients_generate_a_dsgvo_export_for_this_patient")}
              disabled={complianceExportBusy}
              busy={complianceExportBusy}
              onClick={() => void handleExportPatientCompliance()}
            />
          ) : null}
          {canOpenComplianceWorkspace ? (
            <ProfileActionCard
              title={t.patient_profile_open_dsgvo_workspace}
              description={l("patients_open_the_compliance_workspace_for_this_patient")}
              onClick={() => window.open(`/admin/compliance?patient=${id}`, "_blank", "noopener,noreferrer")}
            />
          ) : null}
          {canViewDocuments ? (
            <ProfileActionCard
              title={t.patient_profile_open_documents}
              description={l("patients_review_documents_linked_to_this_patient")}
              onClick={() => onOpenTab("documents")}
            />
          ) : null}
          {canViewContracts ? (
            <ProfileActionCard
              title={t.patient_profile_open_contracts}
              description={l("patients_open_this_patient_s_contracts_and_confirmations")}
              onClick={() => onOpenTab("contracts")}
            />
          ) : null}
          {canViewInvoices ? (
            <ProfileActionCard
              title={t.patient_profile_open_invoices}
              description={l("patients_review_invoices_and_payments_for_this_patient")}
              onClick={() => onOpenTab("invoices")}
            />
          ) : null}
        </div>
      </FormSection>

      {id && canEditPatientProfile && legalStatusSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientLegalStatusSheet
            patientId={id}
            initial={legalStatus}
            open={legalStatusSheetOpen}
            onOpenChange={handleLegalStatusSheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}


      <FormSection
        title={t.patients_notes}
        accessory={
          canEditPatientProfile ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => handleNotesSheetOpenChange(true)}
            >
              {detail.notes ? <Pencil className="size-3.5" /> : <Plus className="size-3.5" />}
              {detail.notes ? t.patient_profile_edit : t.patient_profile_add}
            </Button>
          ) : null
        }
      >
        <div className="rounded-xl border border-border/50 bg-muted/25 p-4">
          {detail.notes ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">{detail.notes}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">
              {t.patient_profile_no_notes_yet}
            </p>
          )}
        </div>
      </FormSection>
      {id && canEditPatientProfile && notesSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientNotesSheet
            patientId={id}
            initial={detail.notes ?? ""}
            open={notesSheetOpen}
            onOpenChange={handleNotesSheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export function PatientProfileTab(...args: Parameters<typeof usePatientProfileTabContent>) {
  return usePatientProfileTabContent(...args);
}

function editPatientFieldLabel(label: string, template: string) {
  return template.replace("{label}", label);
}

function patientContactTypeLabel(type: PatientProfileContact["contact_type"], l: LocalizeFn) {
  switch (type) {
    case "work":
      return l("providers_contact_type_work");
    case "other":
      return l("providers_contact_type_other");
    case "private":
    default:
      return l("providers_contact_type_private");
  }
}

function patientProfileContactRows(
  detail: PatientDetail,
  t: Translations,
  l: LocalizeFn,
) {
  const contacts = (detail.contacts ?? []).filter((contact) => contact.value.trim());
  if (contacts.length > 0) {
    return contacts.map((contact, index) => {
      const noteParts = (contact.notes ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
      const isWhatsApp = noteParts.includes("WhatsApp");
      const consentGranted = noteParts.includes("Questionnaire contact consent: granted");
      const consentDeclined = noteParts.includes("Questionnaire contact consent: declined");
      const retainedNotes = noteParts.filter((part) => ![
        "WhatsApp",
        "Questionnaire contact consent: granted",
        "Questionnaire contact consent: declined",
        "Mobile",
        "Home",
        "Work",
        "Other",
      ].includes(part));
      const kindLabel = isWhatsApp
        ? "WhatsApp"
        : contact.contact_kind === "email"
          ? t.field_email
          : t.field_phone;
      const typeLabel = patientContactTypeLabel(contact.contact_type, l);
      const primaryLabel = contact.is_primary ? ` · ${l("providers_contact_primary")}` : "";
      const consentLabel = consentGranted
        ? t.patient_profile_contact_consent_granted
        : consentDeclined
          ? t.patient_profile_contact_consent_declined
          : null;
      return {
        key: contact.id ?? `${contact.contact_kind}-${index}-${contact.value}`,
        label: `${kindLabel} · ${typeLabel}${primaryLabel}`,
        value: contact.value,
        note: [consentLabel, ...retainedNotes].filter(Boolean).join(" · ") || null,
      };
    });
  }

  return [
    {
      key: "phone_primary",
      label: t.patients_phone_primary,
      value: detail.phone_primary,
      note: null,
    },
    {
      key: "phone_secondary",
      label: t.patients_phone_secondary,
      value: detail.phone_secondary,
      note: null,
    },
    {
      key: "email",
      label: t.patients_email,
      value: detail.email,
      note: null,
    },
  ];
}
