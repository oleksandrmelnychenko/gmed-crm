import { lazy, Suspense, type ReactNode } from "react";
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

import { AdminInlineMetric } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  knownLeadProgramServiceLabel,
  leadInsuranceCoverageLabel,
  leadIntakeTypeFromLead,
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

import type { PatientLegalStatus } from "../../model/legal-status";
import type { PatientDetail } from "../../model/list-model";
import { createPatientLeadOrigin } from "../../model/patient-lead-origin";
import { LegalStatusPill } from "../shared/legal-status-pill";
import { FormSection, humanizeFunctionalLabel } from "../shared/patient-form-primitives";

const loadPatientLegalPreviewSheets = () => import("../sheets/patient-legal-preview-sheets");
const loadPatientLegalStatusSheet = () => import("../sheets/patient-legal-status-sheet");
const loadPatientNotesSheet = () => import("../sheets/patient-notes-sheet");

const LazyPatientDocumentsPreviewSheet = lazy(async () => {
  const mod = await loadPatientLegalPreviewSheets();
  return { default: mod.PatientDocumentsPreviewSheet };
});

const LazyPatientContractsPreviewSheet = lazy(async () => {
  const mod = await loadPatientLegalPreviewSheets();
  return { default: mod.PatientContractsPreviewSheet };
});

const LazyPatientInvoicesPreviewSheet = lazy(async () => {
  const mod = await loadPatientLegalPreviewSheets();
  return { default: mod.PatientInvoicesPreviewSheet };
});

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

function profileRecordString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
        "group relative min-h-[118px] overflow-hidden rounded-xl border border-border bg-white px-3.5 py-2.5 transition-colors hover:border-zinc-300",
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <span className="block h-px w-8 bg-border" />
          <p className="mt-2.5 break-words text-sm font-semibold leading-5 text-foreground">
            {label}
          </p>
        </div>
        {children ? (
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-lg bg-white",
              done ? "text-emerald-700" : "text-amber-700",
            )}
          >
            {children}
          </div>
        ) : null}
      </div>
      <div className="absolute bottom-2.5 left-3.5 right-3.5 flex items-center gap-2">
        <span className="h-px min-w-6 flex-1 bg-border/70" />
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
  contentClassName,
  className,
  action,
}: {
  title: ReactNode;
  children: ReactNode;
  contentClassName?: string;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={cn("rounded-xl border border-border bg-card p-3.5", className)}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
          <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">
            {title}
          </h3>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className={cn("mt-2.5 grid gap-1", contentClassName)}>
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
    <div className="group relative flex min-w-0 items-center gap-2 rounded-lg px-2 py-1">
      <span className="min-w-0 break-words text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="h-px min-w-5 flex-1 self-center bg-border/70" />
      <span
        className={cn(
          "min-w-0 max-w-[58%] break-words text-right text-sm font-semibold leading-snug text-foreground",
          onEdit ? "pr-5" : undefined,
        )}
      >
        {value}
      </span>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={editLabel}
          className="absolute right-1 top-1/2 rounded-md p-1 text-muted-foreground/70 opacity-0 transition -translate-y-1/2 hover:bg-muted hover:text-foreground group-hover:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
    </div>
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
      className="group relative min-h-[128px] overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 p-3.5 pb-12 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-zinc-200 disabled:hover:bg-zinc-50/80"
      onClick={onClick}
    >
      <div className="relative z-10">
        <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h3>
        <p className="mt-1.5 text-xs leading-tight text-muted-foreground">
          {description}
        </p>
      </div>
      <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800 group-disabled:size-12 group-disabled:bg-orange-100 group-disabled:text-orange-700">
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
    <article className="overflow-hidden rounded-xl border border-border bg-card">
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
    canEditPatientProfile: boolean;
    canExportPatientCompliance: boolean;
    canOpenComplianceWorkspace: boolean;
    canViewContracts: boolean;
    canViewDocuments: boolean;
    canViewInvoices: boolean;
  };
  complianceExportBusy: boolean;
  contractsPreviewOpen: boolean;
  detail: PatientDetail;
  docsPreviewOpen: boolean;
  fieldValue: FieldValueFn;
  formatDate: DateFormatter;
  genderLabel: (value: string | null | undefined, tr: Record<string, string>) => string;
  handleExportPatientCompliance: () => void | Promise<void>;
  id?: string;
  insuranceLabel: (value: string | null | undefined, tr: Record<string, string>) => string;
  invoicesPreviewOpen: boolean;
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
  onContractsPreviewOpenChange: ToggleHandler;
  onDocsPreviewOpenChange: ToggleHandler;
  onInvoicesPreviewOpenChange: ToggleHandler;
  onLegalStatusSheetOpenChange: ToggleHandler;
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
  contractsPreviewOpen,
  detail,
  docsPreviewOpen,
  fieldValue,
  formatDate,
  handleExportPatientCompliance,
  id,
  insuranceLabel,
  invoicesPreviewOpen,
  l,
  legalStatus,
  legalStatusChecklist,
  legalStatusCompletion,
  legalStatusSheetOpen,
  notesSheetOpen,
  onContractsPreviewOpenChange,
  onDocsPreviewOpenChange,
  onInvoicesPreviewOpenChange,
  onLegalStatusSheetOpenChange,
  onNotesSheetOpenChange,
  openProfileEditor,
  patientDetailStatusLabel,
  reload,
  staffGo,
  t,
  tr,
}: PatientProfileTabProps) {
  const {
    canEditPatientProfile,
    canExportPatientCompliance,
    canOpenComplianceWorkspace,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
  } = profileControls;
  const editAction = canEditPatientProfile ? openProfileEditor : undefined;

  function handleDocumentsPreviewOpenChange(open: boolean) {
    if (open) void loadPatientLegalPreviewSheets();
    onDocsPreviewOpenChange(open);
  }

  function handleContractsPreviewOpenChange(open: boolean) {
    if (open) void loadPatientLegalPreviewSheets();
    onContractsPreviewOpenChange(open);
  }

  function handleInvoicesPreviewOpenChange(open: boolean) {
    if (open) void loadPatientLegalPreviewSheets();
    onInvoicesPreviewOpenChange(open);
  }

  function handleLegalStatusSheetOpenChange(open: boolean) {
    if (open) void loadPatientLegalStatusSheet();
    onLegalStatusSheetOpenChange(open);
  }

  function handleNotesSheetOpenChange(open: boolean) {
    if (open) void loadPatientNotesSheet();
    onNotesSheetOpenChange(open);
  }

  const leadOrigin = createPatientLeadOrigin(detail);
  const trustedContactProfile = leadOrigin.record("trusted_contact");
  const trustedContacts = leadOrigin.records("trusted_contacts");
  const trustedContactEmail = leadOrigin.string("trusted_contact_email")
    ?? profileRecordString(trustedContactProfile, "email");
  const trustedContactBirthDate = leadOrigin.string("trusted_contact_birth_date")
    ?? profileRecordString(trustedContactProfile, "birth_date");
  const trustedContactAddress = leadOrigin.string("trusted_contact_address")
    ?? profileRecordString(trustedContactProfile, "address");
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
  const requestedSpecialtiesValue = requestedSpecialties
    .map((value) => specializationLabelForValue(value, [], profileLang))
    .join(", ");
  const intakeSourceValue = [
    intakeSource ? leadSourceLabel(intakeSource, t) : null,
    intakeFlow ? intakeFlow.replaceAll("_", " ") : null,
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
      <div className="grid gap-3 xl:grid-cols-2">
        <ProfileSummaryCard
          title={t.patient_profile_personal_data}
          contentClassName="md:grid-cols-2"
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
          contentClassName="md:grid-cols-2"
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
          {trustedContacts.length > 0 ? trustedContacts.map((contact, index) => {
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
                {relation ? <ProfileSummaryLine label={t.patients_emergency_relation} value={relation} /> : null}
                {birthDate ? <ProfileSummaryLine label={t.patients_birth_date} value={formatDate(birthDate)} /> : null}
                {address ? <ProfileSummaryLine label={t.patient_profile_editor_address} value={address} /> : null}
              </div>
            );
          }) : (
            <>
              <ProfileSummaryLine label={t.patients_emergency_name} value={fieldValue(detail.emergency_contact_name, t.common_not_set)} />
              <ProfileSummaryLine label={t.patients_emergency_phone} value={fieldValue(detail.emergency_contact_phone, t.common_not_set)} />
              <ProfileSummaryLine label={t.patients_emergency_relation} value={fieldValue(detail.emergency_contact_relation, t.common_not_set)} />
              {trustedContactEmail ? (
                <ProfileSummaryLine label={t.patient_profile_editor_email} value={trustedContactEmail} />
              ) : null}
              {trustedContactBirthDate ? (
                <ProfileSummaryLine label={t.patients_birth_date} value={formatDate(trustedContactBirthDate)} />
              ) : null}
              {trustedContactAddress ? (
                <ProfileSummaryLine label={t.patient_profile_editor_address} value={trustedContactAddress} />
              ) : null}
            </>
          )}
        </ProfileSummaryCard>

        {hasIntakeProfile ? (
          <ProfileSummaryCard
            title={t.patient_profile_intake_data}
            className="xl:col-span-2"
            contentClassName="md:grid-cols-2 md:gap-x-5"
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
            {leadOrigin.serviceRequests.length > 0 ? (
              <div className="mt-2 border-t border-border pt-2 md:col-span-2">
                <p className="px-2 pb-1 text-[11px] font-medium uppercase text-muted-foreground">
                  {t.patient_profile_intake_services}
                </p>
                <div className="grid gap-1 md:grid-cols-2 md:gap-x-5">
                  {leadOrigin.serviceRequests.map((service) => (
                    <ProfileSummaryLine
                      key={service.value}
                      label={knownLeadProgramServiceLabel(service.value, t) ?? leadProgramServiceLabel(service.value, t)}
                      value={service.comment ?? t.patient_profile_intake_service_requested}
                    />
                  ))}
                </div>
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
                  <span>{detail.passport_expiry}</span>
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
        <div className="grid gap-y-3 overflow-hidden rounded-xl border border-border px-3 pb-3.5 pt-3.5 md:grid-cols-2 xl:grid-cols-4 [&>article:not(:last-child):not(:nth-child(4n))_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric
            icon={ShieldCheck}
            label={t.patient_profile_contract_status}
            value={patientDetailStatusLabel(legalStatus.contractStatus)}
            description={l("patients_contract_readiness")}
            tone="sky"
          />
          <AdminInlineMetric
            icon={CheckCircle2}
            label={t.patient_profile_done}
            value={`${legalStatusCompletion.completed}/${legalStatusCompletion.total}`}
            description={l("patients_required_checks")}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={ClipboardCheck}
            label={l("patients_compliance")}
            value={legalStatus.complianceCompleted ? t.common_completed : t.common_pending}
            description={l("patients_internal_approval")}
            tone={legalStatus.complianceCompleted ? "emerald" : "amber"}
          />
          <AdminInlineMetric
            icon={NotebookText}
            label={t.patient_profile_notes}
            value={legalStatus.notes ? l("patients_yes") : l("patients_no")}
            description={l("patients_legal_note")}
            tone="slate"
          />
        </div>

        <div className="flex items-center gap-2" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
          <span className="size-1.5 rounded-full bg-orange-400" />
          <span className="size-1.5 rounded-full bg-orange-300" />
          <span className="size-1.5 rounded-full bg-orange-200" />
          <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
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

        <div className="flex items-center gap-2" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
          <span className="size-1.5 rounded-full bg-orange-400" />
          <span className="size-1.5 rounded-full bg-orange-300" />
          <span className="size-1.5 rounded-full bg-orange-200" />
          <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
        </div>

        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
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
              onClick={() => handleDocumentsPreviewOpenChange(true)}
            />
          ) : null}
          {canViewContracts ? (
            <ProfileActionCard
              title={t.patient_profile_open_contracts}
              description={l("patients_open_this_patient_s_contracts_and_confirmations")}
              onClick={() => handleContractsPreviewOpenChange(true)}
            />
          ) : null}
          {canViewInvoices ? (
            <ProfileActionCard
              title={t.patient_profile_open_invoices}
              description={l("patients_review_invoices_and_payments_for_this_patient")}
              onClick={() => handleInvoicesPreviewOpenChange(true)}
            />
          ) : null}
        </div>
      </FormSection>

      {id && canViewDocuments && docsPreviewOpen ? (
        <Suspense fallback={null}>
          <LazyPatientDocumentsPreviewSheet
            key={`documents:${id}:${docsPreviewOpen ? "open" : "closed"}`}
            patientId={id}
            open={docsPreviewOpen}
            onOpenChange={handleDocumentsPreviewOpenChange}
          />
        </Suspense>
      ) : null}
      {id && canViewContracts && contractsPreviewOpen ? (
        <Suspense fallback={null}>
          <LazyPatientContractsPreviewSheet
            key={`contracts:${id}:${contractsPreviewOpen ? "open" : "closed"}`}
            patientId={id}
            open={contractsPreviewOpen}
            onOpenChange={handleContractsPreviewOpenChange}
          />
        </Suspense>
      ) : null}
      {id && canViewInvoices && invoicesPreviewOpen ? (
        <Suspense fallback={null}>
          <LazyPatientInvoicesPreviewSheet
            key={`invoices:${id}:${invoicesPreviewOpen ? "open" : "closed"}`}
            patientId={id}
            open={invoicesPreviewOpen}
            onOpenChange={handleInvoicesPreviewOpenChange}
          />
        </Suspense>
      ) : null}
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
