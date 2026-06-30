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

import type { PatientLegalStatus } from "../../model/legal-status";
import type { PatientDetail } from "../../model/list-model";
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
}: {
  title: ReactNode;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-3.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
        <h3 className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">
          {title}
        </h3>
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
              value={fieldValue(contact.value, t.common_not_set)}
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
          <ProfileSummaryLine label={t.patients_emergency_name} value={fieldValue(detail.emergency_contact_name, t.common_not_set)} />
          <ProfileSummaryLine label={t.patients_emergency_phone} value={fieldValue(detail.emergency_contact_phone, t.common_not_set)} />
          <ProfileSummaryLine label={t.patients_emergency_relation} value={fieldValue(detail.emergency_contact_relation, t.common_not_set)} />
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
      const kindLabel = contact.contact_kind === "email" ? t.field_email : t.field_phone;
      const typeLabel = patientContactTypeLabel(contact.contact_type, l);
      const primaryLabel = contact.is_primary ? ` · ${l("providers_contact_primary")}` : "";
      return {
        key: contact.id ?? `${contact.contact_kind}-${index}-${contact.value}`,
        label: `${kindLabel} · ${typeLabel}${primaryLabel}`,
        value: contact.value,
      };
    });
  }

  return [
    {
      key: "phone_primary",
      label: t.patients_phone_primary,
      value: detail.phone_primary,
    },
    {
      key: "phone_secondary",
      label: t.patients_phone_secondary,
      value: detail.phone_secondary,
    },
    {
      key: "email",
      label: t.patients_email,
      value: detail.email,
    },
  ];
}
