import { lazy, Suspense, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  FileText,
  LoaderCircle,
  NotebookText,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";

import { AdminInlineMetric } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CountBadge,
  EmptyCell,
  InfoRow,
  Section as FormSection,
} from "@/components/ui-shell";
import type { Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { PatientLegalStatus } from "../../model/legal-status";
import type { PatientDetail } from "../../model/list-model";
import type {
  PatientCardEntry,
  PatientMedicalOrder,
  PatientRiskScore,
  PatientVitalMeasurement,
} from "../../model/detail-resource-types";
import { LegalStatusPill } from "../shared/legal-status-pill";
import { humanizeFunctionalLabel } from "../shared/patient-form-primitives";

const loadPatientLegalPreviewSheets = () => import("../sheets/patient-legal-preview-sheets");
const loadPatientLegalStatusSheet = () => import("../sheets/patient-legal-status-sheet");
const loadPatientVitalsSheet = () => import("../sheets/patient-vitals-sheet");
const loadPatientCaveNotesSheet = () => import("../sheets/patient-cave-notes-sheet");
const loadPatientCardEntrySheet = () => import("../sheets/patient-card-entry-sheet");
const loadPatientMedicalOrderSheet = () => import("../sheets/patient-medical-order-sheet");
const loadPatientRiskScoreSheet = () => import("../sheets/patient-risk-score-sheet");
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

const LazyPatientVitalsSheet = lazy(async () => {
  const mod = await loadPatientVitalsSheet();
  return { default: mod.PatientVitalsSheet };
});

const LazyPatientCaveNotesSheet = lazy(async () => {
  const mod = await loadPatientCaveNotesSheet();
  return { default: mod.PatientCaveNotesSheet };
});

const LazyPatientCardEntrySheet = lazy(async () => {
  const mod = await loadPatientCardEntrySheet();
  return { default: mod.PatientCardEntrySheet };
});

const LazyPatientMedicalOrderSheet = lazy(async () => {
  const mod = await loadPatientMedicalOrderSheet();
  return { default: mod.PatientMedicalOrderSheet };
});

const LazyPatientRiskScoreSheet = lazy(async () => {
  const mod = await loadPatientRiskScoreSheet();
  return { default: mod.PatientRiskScoreSheet };
});

const LazyPatientNotesSheet = lazy(async () => {
  const mod = await loadPatientNotesSheet();
  return { default: mod.PatientNotesSheet };
});

type LocalizeFn = (de: string, ru: string, en: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type StatusLabelFn = (status: string) => string;
type FieldValueFn = (value: string | string[] | null | undefined, fallback: string) => string;
type NumberFormatter = (
  value?: number | null,
  options?: Intl.NumberFormatOptions,
) => string | null;
type ToggleHandler = (open: boolean) => void;
type LegalStatusChecklistItem = {
  key: string;
  label: string;
  done: boolean;
};

function ProfileDetailTile({
  label,
  value,
  description,
  children,
}: {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <article className="rounded-lg bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-border/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium leading-tight text-muted-foreground">
            {label}
          </p>
          <p className="mt-1 text-[13px] font-medium leading-5 text-foreground">
            {value}
          </p>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {children ? <div className="shrink-0">{children}</div> : null}
      </div>
    </article>
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
    canManagePatientCardEntries: boolean;
    canManagePatientMedicalOrders: boolean;
    canManagePatientRiskScores: boolean;
    canManagePatientVitals: boolean;
    canOpenComplianceWorkspace: boolean;
    canViewContracts: boolean;
    canViewDocuments: boolean;
    canViewInvoices: boolean;
    hasClinicalSurface: boolean;
  };
  cardEntries: PatientCardEntry[];
  cardEntrySheetOpen: boolean;
  caveSheetOpen: boolean;
  clinicalSurfaceItemCount: number;
  complianceExportBusy: boolean;
  contractsPreviewOpen: boolean;
  detail: PatientDetail;
  docsPreviewOpen: boolean;
  fieldValue: FieldValueFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  formatVitalNumber: NumberFormatter;
  genderLabel: (value: string | null | undefined, tr: Record<string, string>) => string;
  handleExportPatientCompliance: () => void | Promise<void>;
  handleUpdatePatientMedicalOrderStatus: (
    orderId: string,
    nextStatus: "completed" | "cancelled",
  ) => void | Promise<void>;
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
  medicalOrderActionId: string;
  medicalOrderSheetOpen: boolean;
  medicalOrders: PatientMedicalOrder[];
  notesSheetOpen: boolean;
  onCardEntrySheetOpenChange: ToggleHandler;
  onCaveSheetOpenChange: ToggleHandler;
  onContractsPreviewOpenChange: ToggleHandler;
  onDocsPreviewOpenChange: ToggleHandler;
  onInvoicesPreviewOpenChange: ToggleHandler;
  onLegalStatusSheetOpenChange: ToggleHandler;
  onMedicalOrderSheetOpenChange: ToggleHandler;
  onNotesSheetOpenChange: ToggleHandler;
  onRiskScoreSheetOpenChange: ToggleHandler;
  onVitalsSheetOpenChange: ToggleHandler;
  openProfileEditor: () => void;
  patientCardEntryCategoryBadgeClass: (category: string) => string;
  patientCardEntryCategoryLabel: (category: string) => string;
  patientDetailStatusLabel: StatusLabelFn;
  patientMedicalOrderTypeLabel: (orderType: string) => string;
  patientRiskScoreTypeLabel: (scoreType: string) => string;
  reload: () => void;
  riskScoreSheetOpen: boolean;
  riskScores: PatientRiskScore[];
  staffGo: (to: string) => void;
  statusBadgeClasses: Record<string, string>;
  t: Translations;
  tr: Record<string, string>;
  vitalsHistory: PatientVitalMeasurement[];
  vitalsSheetOpen: boolean;
};

function usePatientProfileTabContent({
  profileControls,
  cardEntries,
  cardEntrySheetOpen,
  caveSheetOpen,
  complianceExportBusy,
  contractsPreviewOpen,
  detail,
  docsPreviewOpen,
  fieldValue,
  formatDate,
  formatDateTime,
  formatVitalNumber,
  genderLabel,
  handleExportPatientCompliance,
  handleUpdatePatientMedicalOrderStatus,
  id,
  insuranceLabel,
  invoicesPreviewOpen,
  l,
  legalStatus,
  legalStatusChecklist,
  legalStatusCompletion,
  legalStatusSheetOpen,
  medicalOrderActionId,
  medicalOrderSheetOpen,
  medicalOrders,
  notesSheetOpen,
  onCardEntrySheetOpenChange,
  onCaveSheetOpenChange,
  onContractsPreviewOpenChange,
  onDocsPreviewOpenChange,
  onInvoicesPreviewOpenChange,
  onLegalStatusSheetOpenChange,
  onMedicalOrderSheetOpenChange,
  onNotesSheetOpenChange,
  onRiskScoreSheetOpenChange,
  onVitalsSheetOpenChange,
  openProfileEditor,
  patientCardEntryCategoryBadgeClass,
  patientCardEntryCategoryLabel,
  patientDetailStatusLabel,
  patientMedicalOrderTypeLabel,
  patientRiskScoreTypeLabel,
  reload,
  riskScoreSheetOpen,
  riskScores,
  staffGo,
  statusBadgeClasses,
  t,
  tr,
  vitalsHistory,
  vitalsSheetOpen,
}: PatientProfileTabProps) {
  const {
    canEditPatientProfile,
    canExportPatientCompliance,
    canManagePatientCardEntries,
    canManagePatientMedicalOrders,
    canManagePatientRiskScores,
    canManagePatientVitals,
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

  function handleVitalsSheetOpenChange(open: boolean) {
    if (open) void loadPatientVitalsSheet();
    onVitalsSheetOpenChange(open);
  }

  function handleCaveSheetOpenChange(open: boolean) {
    if (open) void loadPatientCaveNotesSheet();
    onCaveSheetOpenChange(open);
  }

  function handleCardEntrySheetOpenChange(open: boolean) {
    if (open) void loadPatientCardEntrySheet();
    onCardEntrySheetOpenChange(open);
  }

  function handleMedicalOrderSheetOpenChange(open: boolean) {
    if (open) void loadPatientMedicalOrderSheet();
    onMedicalOrderSheetOpenChange(open);
  }

  function handleRiskScoreSheetOpenChange(open: boolean) {
    if (open) void loadPatientRiskScoreSheet();
    onRiskScoreSheetOpenChange(open);
  }

  function handleNotesSheetOpenChange(open: boolean) {
    if (open) void loadPatientNotesSheet();
    onNotesSheetOpenChange(open);
  }

  return (
    <div className="space-y-6 mt-4 min-h-[400px]">
      <div className="grid gap-4 xl:grid-cols-2">
        <FormSection title={t.patient_profile_personal_data}>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <InfoRow label={t.patients_birth_date} value={formatDate(detail.birth_date, t.common_not_set)} />
            <InfoRow label={t.patients_gender} value={genderLabel(detail.gender, tr)} />
            <InfoRow label={t.patients_nationality} value={fieldValue(detail.nationality, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_nationality)} />
            <InfoRow label={t.patients_residence_country} value={fieldValue(detail.residence_country, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_residence_country)} />
            <InfoRow label={t.patients_languages} value={fieldValue(detail.languages, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_languages)} />
            <InfoRow
              label={t.patient_profile_functional_labels}
              value={
                detail.functional_labels?.length
                  ? detail.functional_labels
                      .map((label) => humanizeFunctionalLabel(label))
                      .join(", ")
                  : t.common_not_set
              }
              onEdit={editAction}
              editLabel={editPatientFieldLabel(t.patient_profile_functional_labels)}
            />
          </div>
        </FormSection>

        <FormSection title={t.patient_profile_contact}>
          <div className="grid gap-4 md:grid-cols-2">
            <InfoRow label={t.patients_phone_primary} value={fieldValue(detail.phone_primary, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_phone_primary)} />
            <InfoRow label={t.patients_phone_secondary} value={fieldValue(detail.phone_secondary, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_phone_secondary)} />
            <InfoRow label={t.patients_email} value={fieldValue(detail.email, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_email)} />
          </div>
        </FormSection>

        <FormSection title={t.patient_profile_insurance_and_payer}>
          <div className="grid gap-4 md:grid-cols-2">
            <InfoRow label={t.patients_insurance_type} value={insuranceLabel(detail.insurance_type, tr)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_insurance_type)} />
            <InfoRow label={t.patients_insurance_provider} value={fieldValue(detail.insurance_provider, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_insurance_provider)} />
            <InfoRow label={t.patients_insurance_number} value={fieldValue(detail.insurance_number, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_insurance_number)} />
          </div>
        </FormSection>

        <FormSection title={t.patient_profile_address}>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <InfoRow label={t.patients_address_street} value={fieldValue(detail.address_street, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_address_street)} />
            <InfoRow label={t.patients_address_city} value={fieldValue(detail.address_city, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_address_city)} />
            <InfoRow label={t.patients_address_zip} value={fieldValue(detail.address_zip, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_address_zip)} />
            <InfoRow label={t.patients_address_country} value={fieldValue(detail.address_country, t.common_not_set)} onEdit={editAction} editLabel={editPatientFieldLabel(t.patients_address_country)} />
          </div>
        </FormSection>

        <FormSection
          title={t.patient_profile_emergency_contact}
        >
          <div className="grid gap-4 md:grid-cols-3">
            <InfoRow label={t.patients_emergency_name} value={fieldValue(detail.emergency_contact_name, t.common_not_set)} />
            <InfoRow label={t.patients_emergency_phone} value={fieldValue(detail.emergency_contact_phone, t.common_not_set)} />
            <InfoRow label={t.patients_emergency_relation} value={fieldValue(detail.emergency_contact_relation, t.common_not_set)} />
          </div>
        </FormSection>
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
        <div className="grid gap-y-4 overflow-hidden rounded-xl border border-border px-3 pb-4 pt-4 md:grid-cols-2 xl:grid-cols-4 [&>article:not(:last-child):not(:nth-child(4n))_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric
            icon={ShieldCheck}
            label={t.patient_profile_contract_status}
            value={patientDetailStatusLabel(legalStatus.contractStatus)}
            description={l("Vertragsfreigabe.", "Готовность договора.", "Contract readiness.")}
            tone="sky"
          />
          <AdminInlineMetric
            icon={CheckCircle2}
            label={t.patient_profile_done}
            value={`${legalStatusCompletion.completed}/${legalStatusCompletion.total}`}
            description={l("Pflichtpunkte.", "Обязательные пункты.", "Required checks.")}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={ClipboardCheck}
            label={l("Compliance", "Комплаенс", "Compliance")}
            value={legalStatus.complianceCompleted ? t.common_completed : t.common_pending}
            description={l("Interne Freigabe.", "Внутреннее подтверждение.", "Internal approval.")}
            tone={legalStatus.complianceCompleted ? "emerald" : "amber"}
          />
          <AdminInlineMetric
            icon={NotebookText}
            label={t.patient_profile_notes}
            value={legalStatus.notes ? l("Ja", "Есть", "Yes") : l("Nein", "Нет", "No")}
            description={l("Rechtsnotiz.", "Правовая заметка.", "Legal note.")}
            tone="slate"
          />
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          {legalStatusChecklist.map((item) => (
            <ProfileDetailTile
              key={item.key}
              label={item.label}
              value={item.done ? t.common_completed : t.common_pending}
              description={l(
                "Bestätigung im Profil.",
                "Подтверждение в профиле.",
                "Profile confirmation.",
              )}
            >
              {item.done ? (
                <CheckCircle2 className="size-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="size-4 text-amber-600" />
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

        <div className="flex flex-wrap gap-2">
          {canExportPatientCompliance ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={complianceExportBusy}
              onClick={() => void handleExportPatientCompliance()}
            >
              {complianceExportBusy ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <FileText className="size-3.5" />
              )}
              {t.patient_profile_dsgvo_export}
            </Button>
          ) : null}
          {canOpenComplianceWorkspace ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => staffGo(`/admin/compliance?patient=${id}`)}
            >
              <ShieldCheck className="size-3.5" />
              {t.patient_profile_open_dsgvo_workspace}
            </Button>
          ) : null}
          {canViewDocuments ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => handleDocumentsPreviewOpenChange(true)}
            >
              <FileText className="size-3.5" />
              {t.patient_profile_open_documents}
            </Button>
          ) : null}
          {canViewContracts ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => handleContractsPreviewOpenChange(true)}
            >
              <ClipboardList className="size-3.5" />
              {t.patient_profile_open_contracts}
            </Button>
          ) : null}
          {canViewInvoices ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              onClick={() => handleInvoicesPreviewOpenChange(true)}
            >
              <FileText className="size-3.5" />
              {t.patient_profile_open_invoices}
            </Button>
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
      {id && canManagePatientVitals && vitalsSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientVitalsSheet
            patientId={id}
            open={vitalsSheetOpen}
            onOpenChange={handleVitalsSheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}
      {id && canEditPatientProfile && caveSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientCaveNotesSheet
            patientId={id}
            initial={detail.clinical_warnings ?? ""}
            open={caveSheetOpen}
            onOpenChange={handleCaveSheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}

      {canManagePatientVitals || detail.clinical_warnings || vitalsHistory.length > 0 ? (
        <div className="space-y-6">
          <FormSection
            title={t.patient_profile_cave_notes}
            accessory={
              canEditPatientProfile ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={() => handleCaveSheetOpenChange(true)}
                >
                  <Pencil className="size-3.5" />
                  {t.patient_profile_update}
                </Button>
              ) : null
            }
          >
            <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4">
              {detail.clinical_warnings ? (
                <p className="whitespace-pre-wrap text-sm text-rose-900">{detail.clinical_warnings}</p>
              ) : (
                <p className="text-sm text-rose-700">
                  {t.patient_profile_no_active_cave_notes_documented}
                </p>
              )}
            </div>
          </FormSection>

          <FormSection
            title={t.patient_profile_vitals_history}
            accessory={
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-full border-border/60 bg-muted/25 text-foreground">
                  {l(`${vitalsHistory.length} Einträge`, `${vitalsHistory.length} записей`, `${vitalsHistory.length} entries`)}
                </Badge>
                {canManagePatientVitals ? (
                  <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => handleVitalsSheetOpenChange(true)}>
                    <Plus className="size-3.5" />
                    {t.patient_profile_add}
                  </Button>
                ) : null}
              </div>
            }
          >
            {vitalsHistory.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-sm text-muted-foreground">
                {t.patient_profile_no_vitals_have_been_recorded_for_this_patient_yet}
              </div>
            ) : null}

            {vitalsHistory.length > 0 ? (
              <div className="max-h-[540px] overflow-y-auto rounded-xl border border-border bg-card">
                {vitalsHistory.map((item) => {
                  const vitalMetrics = [
                    item.bp_systolic != null && item.bp_diastolic != null
                      ? {
                          label: l("RR", "АД", "BP"),
                          value: `${formatVitalNumber(item.bp_systolic, { maximumFractionDigits: 0 }) ?? t.common_not_set}/${
                            formatVitalNumber(item.bp_diastolic, { maximumFractionDigits: 0 }) ?? t.common_not_set
                          }`,
                        }
                      : null,
                    item.heart_rate != null
                      ? {
                          label: l("Herzfrequenz", "ЧСС", "Heart rate"),
                          value: formatVitalNumber(item.heart_rate, { maximumFractionDigits: 0 }) ?? t.common_not_set,
                        }
                      : null,
                    item.weight_kg != null
                      ? {
                          label: l("Gewicht", "Вес", "Weight"),
                          value: `${formatVitalNumber(item.weight_kg) ?? t.common_not_set} kg`,
                        }
                      : null,
                    item.height_cm != null
                      ? {
                          label: l("Groesse", "Рост", "Height"),
                          value: `${formatVitalNumber(item.height_cm) ?? t.common_not_set} cm`,
                        }
                      : null,
                    item.bmi != null
                      ? {
                          label: "BMI",
                          value: formatVitalNumber(item.bmi) ?? t.common_not_set,
                        }
                      : null,
                  ].filter((metric): metric is { label: string; value: string } => Boolean(metric));

                  return (
                    <div
                      key={item.id}
                      className="grid gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="text-sm font-medium text-foreground">
                            {formatDateTime(item.measured_at, t.common_not_set)}
                          </p>
                          <span className="size-1 rounded-full bg-muted-foreground/35" />
                          <span className="text-xs text-muted-foreground">
                            {t.patient_profile_recorded_by} {item.recorded_by_name ?? t.common_unknown}
                          </span>
                        </div>
                        {item.notes ? (
                          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                            {item.notes}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex min-w-0 flex-wrap gap-1.5 md:justify-end">
                        {vitalMetrics.length > 0 ? (
                          vitalMetrics.map((metric) => (
                            <span
                              key={metric.label}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/25 px-2 py-1 text-xs text-muted-foreground"
                            >
                              <span>{metric.label}</span>
                              <span className="font-medium text-foreground">{metric.value}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">{t.common_not_set}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </FormSection>
        </div>
      ) : null}

      {canManagePatientCardEntries || cardEntries.length > 0 ? (
        <FormSection
          title={t.patient_profile_clinical_card_log}
          accessory={
            <div className="flex items-center gap-2">
              <CountBadge>
                {l(`${cardEntries.length} Einträge`, `${cardEntries.length} записей`, `${cardEntries.length} entries`)}
              </CountBadge>
              {canManagePatientCardEntries ? (
                <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => handleCardEntrySheetOpenChange(true)}>
                  <Plus className="size-3.5" />
                  {t.patient_profile_add}
                </Button>
              ) : null}
            </div>
          }
        >
          {cardEntries.length === 0 ? (
            <EmptyCell>{t.patient_profile_no_clinical_card_log_entries_have_been_recorded_for_this_patient}</EmptyCell>
          ) : (
            <div className="space-y-3">
              {cardEntries.slice(0, 6).map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-xl border border-border bg-card"
                >
                  <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="h-px w-8 bg-border" />
                        <Badge
                          variant="outline"
                          className={cn("rounded-full text-[10px]", patientCardEntryCategoryBadgeClass(entry.category))}
                        >
                          {patientCardEntryCategoryLabel(entry.category)}
                        </Badge>
                        {entry.source ? (
                          <Badge
                            variant="outline"
                            className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                          >
                            {t.patient_profile_source}:{" "}
                            <span className="ml-1 font-semibold text-foreground">{entry.source}</span>
                          </Badge>
                        ) : null}
                      </div>

                      <p className="mt-3 whitespace-pre-wrap text-sm font-medium leading-6 text-foreground">
                        {entry.content}
                      </p>
                    </div>

                    <div className="flex flex-col justify-between gap-4 border-l border-dashed border-border pl-4">
                      <div>
                        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          {l("Eintrag", "Запись", "Entry")}
                        </span>
                        <p className="mt-2 text-sm font-semibold leading-5 text-foreground">
                          {formatDateTime(entry.entry_date, t.common_not_set)}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {entry.author_name ?? t.common_unknown}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </FormSection>
      ) : null}

      {canManagePatientCardEntries && id && cardEntrySheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientCardEntrySheet
            patientId={id}
            open={cardEntrySheetOpen}
            onOpenChange={handleCardEntrySheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}

      {canManagePatientMedicalOrders || medicalOrders.length > 0 ? (
        <FormSection
          title={t.patient_profile_medical_orders}
          accessory={
            <div className="flex items-center gap-2">
              <CountBadge>
                {l(`${medicalOrders.length} Anordnungen`, `${medicalOrders.length} назначений`, `${medicalOrders.length} orders`)}
              </CountBadge>
              {canManagePatientMedicalOrders ? (
                <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => handleMedicalOrderSheetOpenChange(true)}>
                  <Plus className="size-3.5" />
                  {t.patient_profile_add}
                </Button>
              ) : null}
            </div>
          }
        >
          {medicalOrders.length === 0 ? (
            <EmptyCell>{t.patient_profile_no_medical_orders_have_been_recorded_for_this_patient_yet}</EmptyCell>
          ) : (
            <div className="space-y-3">
              {medicalOrders.map((order) => (
                <article
                  key={order.id}
                  className="rounded-xl border border-border bg-card"
                >
                  <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="h-px w-8 bg-border" />
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full text-[10px]",
                            statusBadgeClasses[order.status] ?? "border-border/60 bg-muted/25 text-muted-foreground",
                          )}
                        >
                          {patientDetailStatusLabel(order.status)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                        >
                          {patientMedicalOrderTypeLabel(order.order_type)}
                        </Badge>
                      </div>

                      <h3 className="mt-3 text-base font-semibold leading-6 text-foreground">
                        {order.title}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs leading-5">
                        <span className="inline-flex items-baseline gap-1">
                          <span className="text-muted-foreground">{t.patient_profile_ordered_by}</span>
                          <span className="font-medium text-foreground">
                            {order.ordered_by_name ?? t.common_unknown}
                          </span>
                        </span>
                        {order.due_date ? (
                          <span className="inline-flex items-baseline gap-1">
                            <span className="text-muted-foreground">{t.patient_profile_due}</span>
                            <span className="font-medium tabular-nums text-foreground">{order.due_date}</span>
                          </span>
                        ) : null}
                        {order.source ? (
                          <span className="inline-flex min-w-0 items-baseline gap-1">
                            <span className="shrink-0 text-muted-foreground">{t.patient_profile_source}</span>
                            <span className="min-w-0 break-words font-medium text-foreground">{order.source}</span>
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                        {order.instructions}
                      </p>
                    </div>

                    <div className="flex flex-col justify-between gap-4 border-l border-dashed border-border pl-4">
                      <div>
                        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          {l("Datum der Anordnung", "Дата назначения", "Order date")}
                        </span>
                        <p className="mt-2 text-sm font-semibold leading-5 text-foreground">
                          {formatDateTime(order.order_date, t.common_not_set)}
                        </p>
                      </div>

                      {canManagePatientMedicalOrders && order.status === "active" ? (
                        <div className="flex flex-col gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-center rounded-lg"
                            disabled={medicalOrderActionId === order.id}
                            onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "completed")}
                          >
                            {medicalOrderActionId === order.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                            {t.patient_profile_complete}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-center rounded-lg"
                            disabled={medicalOrderActionId === order.id}
                            onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "cancelled")}
                          >
                            {medicalOrderActionId === order.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                            {t.patient_profile_cancel}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </FormSection>
      ) : null}

      {canManagePatientMedicalOrders && id && medicalOrderSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientMedicalOrderSheet
            patientId={id}
            open={medicalOrderSheetOpen}
            onOpenChange={handleMedicalOrderSheetOpenChange}
            onSaved={reload}
          />
        </Suspense>
      ) : null}

      {canManagePatientRiskScores || riskScores.length > 0 ? (
        <FormSection
          title={t.patient_profile_risk_scores}
          accessory={
            <div className="flex items-center gap-2">
              <CountBadge>
                {l(`${riskScores.length} Scores`, `${riskScores.length} скоров`, `${riskScores.length} scores`)}
              </CountBadge>
              {canManagePatientRiskScores ? (
                <Button size="sm" className="h-8 rounded-lg gap-1.5" onClick={() => handleRiskScoreSheetOpenChange(true)}>
                  <Plus className="size-3.5" />
                  {t.patient_profile_add}
                </Button>
              ) : null}
            </div>
          }
        >
          {riskScores.length === 0 ? (
            <EmptyCell>{t.patient_profile_no_risk_scores_have_been_recorded_for_this_patient_yet}</EmptyCell>
          ) : (
            <div className="space-y-3">
              {riskScores.map((score) => {
                const scoreValue = formatVitalNumber(score.score_value) ?? t.common_not_set;
                const scaleValue = score.scale_max != null ? formatVitalNumber(score.scale_max) : null;

                return (
                  <article
                    key={score.id}
                    className="rounded-xl border border-border bg-card"
                  >
                    <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_180px]">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="h-px w-8 bg-border" />
                          <Badge
                            variant="outline"
                            className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                          >
                            {l("Risikobewertung", "Риск-оценка", "Risk assessment")}
                          </Badge>
                        </div>

                        <h3 className="mt-3 text-base font-semibold leading-6 text-foreground">
                          {patientRiskScoreTypeLabel(score.score_type)}
                        </h3>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs leading-5">
                          <span className="inline-flex items-baseline gap-1">
                            <span className="text-muted-foreground">{t.patient_profile_recorded_by}</span>
                            <span className="font-medium text-foreground">
                              {score.recorded_by_name ?? t.common_unknown}
                            </span>
                          </span>
                          {score.source ? (
                            <span className="inline-flex min-w-0 items-baseline gap-1">
                              <span className="shrink-0 text-muted-foreground">{t.patient_profile_source}</span>
                              <span className="min-w-0 break-words font-medium text-foreground">{score.source}</span>
                            </span>
                          ) : null}
                        </div>

                        {score.interpretation ? (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                            {score.interpretation}
                          </p>
                        ) : null}

                        {score.inputs ? (
                          <details className="mt-3 rounded-lg border border-border/60">
                            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
                              {t.patient_profile_inputs}
                            </summary>
                            <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border/60 px-3 py-2 text-[12px] text-foreground">
                              {JSON.stringify(score.inputs, null, 2)}
                            </pre>
                          </details>
                        ) : null}
                      </div>

                      <div className="flex flex-col justify-between gap-4 border-l border-dashed border-border pl-4">
                        <div>
                          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {l("Risikowert", "Оценка риска", "Risk score")}
                          </span>
                          <p className="mt-2 text-lg font-semibold leading-none text-foreground">
                            {scoreValue}
                            {scaleValue ? (
                              <span className="text-sm font-medium text-muted-foreground"> / {scaleValue}</span>
                            ) : null}
                          </p>
                          {scaleValue ? (
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {l("Skala", "Шкала", "Scale")} {scaleValue}
                            </p>
                          ) : null}
                        </div>

                        <div>
                          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {l("Berechnet", "Дата расчета", "Computed")}
                          </span>
                          <p className="mt-2 text-sm font-semibold leading-5 text-foreground">
                            {formatDateTime(score.computed_at, t.common_not_set)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </FormSection>
      ) : null}

      {canManagePatientRiskScores && id && riskScoreSheetOpen ? (
        <Suspense fallback={null}>
          <LazyPatientRiskScoreSheet
            patientId={id}
            open={riskScoreSheetOpen}
            onOpenChange={handleRiskScoreSheetOpenChange}
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

function editPatientFieldLabel(label: string) {
  return `Edit ${label}`;
}
