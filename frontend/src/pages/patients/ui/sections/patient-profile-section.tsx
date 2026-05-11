import { lazy, Suspense } from "react";
import { LoaderCircle, Pencil, Plus } from "lucide-react";

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
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

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
  clinicalSurfaceItemCount,
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
    hasClinicalSurface,
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
      <WorkspaceSectionIntro
        title={t.patient_profile_identity_and_communication}
        description={t.patient_profile_core_identity_contact_channels_address_insurance_and_emergency_c}
      />
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

      <WorkspaceSectionIntro
        title={t.patient_profile_compliance_and_legal_status}
        description={t.patient_profile_contract_readiness_required_confirmations_and_patient_legal_note}
      />
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
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-muted/25 px-4 py-3 xl:col-span-2">
            <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
              {t.patient_profile_contract_status}
            </span>
            <p className="text-base font-semibold text-foreground">
              {patientDetailStatusLabel(legalStatus.contractStatus)}
            </p>
            <p className="text-xs text-muted-foreground">
              {legalStatusCompletion.completed}/{legalStatusCompletion.total} {t.patient_profile_done}
            </p>
          </div>
          {legalStatusChecklist.map((item) => (
            <div key={item.key} className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-card px-4 py-3">
              <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                {item.label}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full text-[10px] w-fit",
                  item.done
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700",
                )}
              >
                {item.done ? t.common_completed : t.common_pending}
              </Badge>
            </div>
          ))}
        </div>

        {legalStatus.notes ? (
          <div className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-muted/25 px-4 py-3">
            <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
              {t.patient_profile_notes}
            </span>
            <p className="whitespace-pre-wrap text-sm text-foreground">{legalStatus.notes}</p>
          </div>
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
              {complianceExportBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {t.patient_profile_dsgvo_export}
            </Button>
          ) : null}
          {canOpenComplianceWorkspace ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => staffGo(`/admin/compliance?patient=${id}`)}
            >
              {t.patient_profile_open_dsgvo_workspace}
            </Button>
          ) : null}
          {canViewDocuments ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => handleDocumentsPreviewOpenChange(true)}
            >
              {t.patient_profile_open_documents}
            </Button>
          ) : null}
          {canViewContracts ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => handleContractsPreviewOpenChange(true)}
            >
              {t.patient_profile_open_contracts}
            </Button>
          ) : null}
          {canViewInvoices ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => handleInvoicesPreviewOpenChange(true)}
            >
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

      {hasClinicalSurface ? (
        <WorkspaceSectionIntro
          title={t.patient_profile_clinical_surface}
          description={t.patient_profile_warnings_vitals_clinical_log_orders_and_risk_assessments_for_the}
          accessory={<CountBadge>{clinicalSurfaceItemCount}</CountBadge>}
        />
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
              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                {vitalsHistory.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/50 bg-card px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {formatDateTime(item.measured_at, t.common_not_set)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.patient_profile_recorded_by} {item.recorded_by_name ?? t.common_unknown}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 text-xs text-muted-foreground">
                        {item.bp_systolic != null && item.bp_diastolic != null ? (
                          <span>
                            RR {formatVitalNumber(item.bp_systolic, { maximumFractionDigits: 0 })}/
                            {formatVitalNumber(item.bp_diastolic, { maximumFractionDigits: 0 })}
                          </span>
                        ) : null}
                        {item.heart_rate != null ? (
                          <span>HF {formatVitalNumber(item.heart_rate, { maximumFractionDigits: 0 })}</span>
                        ) : null}
                        {item.weight_kg != null ? <span>{formatVitalNumber(item.weight_kg)} kg</span> : null}
                        {item.height_cm != null ? <span>{formatVitalNumber(item.height_cm)} cm</span> : null}
                        {item.bmi != null ? <span>BMI {formatVitalNumber(item.bmi)}</span> : null}
                      </div>
                    </div>
                    {item.notes ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>
                    ) : null}
                  </div>
                ))}
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
            <div className="space-y-2">
              {cardEntries.slice(0, 6).map((entry) => (
                <div key={entry.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-foreground">
                      <span className="font-medium">{formatDateTime(entry.entry_date, t.common_not_set)}</span>
                      <span className="text-muted-foreground"> · {entry.author_name ?? t.common_unknown}</span>
                    </p>
                    <Badge variant="outline" className={cn("rounded-full", patientCardEntryCategoryBadgeClass(entry.category))}>
                      {patientCardEntryCategoryLabel(entry.category)}
                    </Badge>
                  </div>
                  {entry.source ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                        {t.patient_profile_source}
                      </span>
                      <p className="text-[13px] text-foreground">{entry.source}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                      {t.patient_profile_content}
                    </span>
                    <p className="whitespace-pre-wrap text-[13px] text-foreground">{entry.content}</p>
                  </div>
                </div>
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
            <div className="space-y-2">
              {medicalOrders.map((order) => (
                <div key={order.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-foreground">
                      <span className="font-medium">{formatDateTime(order.order_date, t.common_not_set)}</span>
                      <span className="text-muted-foreground"> · {t.patient_profile_ordered_by} {order.ordered_by_name ?? t.common_unknown}</span>
                    </p>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full",
                        statusBadgeClasses[order.status] ?? "border-border/60 bg-muted/25 text-muted-foreground",
                      )}
                    >
                      {patientDetailStatusLabel(order.status)}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                      {t.patient_profile_title}
                    </span>
                    <p className="text-[13px] text-foreground">{order.title}</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                      {t.patient_profile_type}
                    </span>
                    <p className="text-[13px] text-foreground">
                      {patientMedicalOrderTypeLabel(order.order_type)}
                      {order.due_date ? ` · ${t.patient_profile_due} ${order.due_date}` : ""}
                    </p>
                  </div>
                  {order.source ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                        {t.patient_profile_source}
                      </span>
                      <p className="text-[13px] text-foreground">{order.source}</p>
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                      {t.patient_profile_instructions}
                    </span>
                    <p className="whitespace-pre-wrap text-[13px] text-foreground">{order.instructions}</p>
                  </div>
                  {canManagePatientMedicalOrders && order.status === "active" ? (
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg gap-1.5"
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
                        className="h-8 rounded-lg gap-1.5 border-rose-200 text-rose-700 hover:bg-rose-50"
                        disabled={medicalOrderActionId === order.id}
                        onClick={() => void handleUpdatePatientMedicalOrderStatus(order.id, "cancelled")}
                      >
                        {medicalOrderActionId === order.id ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                        {t.patient_profile_cancel}
                      </Button>
                    </div>
                  ) : null}
                </div>
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
            <div className="space-y-2">
              {riskScores.map((score) => (
                <div key={score.id} className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[13px] text-foreground">
                      <span className="font-medium">{formatDateTime(score.computed_at, t.common_not_set)}</span>
                      <span className="text-muted-foreground"> · {t.patient_profile_recorded_by} {score.recorded_by_name ?? t.common_unknown}</span>
                    </p>
                    <Badge variant="outline" className="rounded-full">
                      {formatVitalNumber(score.score_value)}
                      {score.scale_max != null ? ` / ${formatVitalNumber(score.scale_max)}` : ""}
                    </Badge>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                      {t.patient_profile_type}
                    </span>
                    <p className="text-[13px] text-foreground">{patientRiskScoreTypeLabel(score.score_type)}</p>
                  </div>
                  {score.source ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                        {t.patient_profile_source}
                      </span>
                      <p className="text-[13px] text-foreground">{score.source}</p>
                    </div>
                  ) : null}
                  {score.interpretation ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                        {t.patient_profile_interpretation}
                      </span>
                      <p className="whitespace-pre-wrap text-[13px] text-foreground">{score.interpretation}</p>
                    </div>
                  ) : null}
                  {score.inputs ? (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
                        {t.patient_profile_inputs}
                      </span>
                      <pre className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[12px] text-foreground overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(score.inputs, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ))}
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

      <WorkspaceSectionIntro
        title={t.patient_profile_notes_and_context}
        description={t.patient_profile_free_form_context_for_operational_notes_that_do_not_belong_in_cl}
      />

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
