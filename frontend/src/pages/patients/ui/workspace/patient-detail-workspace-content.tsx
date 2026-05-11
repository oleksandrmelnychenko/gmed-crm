import { lazy, Suspense, type FormEvent } from "react";

import { SquarePen } from "lucide-react";

import { TabLoader } from "@/components/record-workspace";
import { StatusActionPill } from "@/components/status-action-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatUnknownValue, type Translations } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  PATIENT_LABEL_FORMAT_OPTIONS,
  type PatientLabelFormatId,
  type PatientTimelineItem,
  type PatientTimelineRangeFilter,
  type PatientTimelineSummary,
} from "../../model/detail-model";
import type {
  AppointmentItem,
  CaseItem,
  ContractItem,
  DocumentAlerts,
  DocumentItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientServicePackageItem,
  InvoiceItem,
  OrderItem,
  RelationItem,
  WorkflowChecklistItem,
  WorkflowChecklistResponse,
} from "../../model/detail-tab-types";
import type { PatientLegalStatus } from "../../model/legal-status";
import type { PatientAssignment, PatientDetail, PatientsDictionary, StaffOption } from "../../model/list-model";
import type {
  PatientCardEntry,
  PatientMedicalOrder,
  PatientRiskScore,
  PatientVitalMeasurement,
} from "../../model/detail-resource-types";
import {
  functionalLabelChipClass,
  humanizeFunctionalLabel,
} from "../shared/patient-form-primitives";

const loadPatientProfileTab = () => import("../sections/patient-profile-section");
const loadPatientCuratorsTab = () => import("../sections/patient-curators-tab");
const loadPatientRelationsTab = () => import("../sections/patient-relations-tab");
const loadPatientCasesTab = () => import("../sections/patient-cases-tab");
const loadPatientOrdersTab = () => import("../sections/patient-orders-tab");
const loadPatientAppointmentsTab = () => import("../sections/patient-appointments-tab");
const loadPatientDocumentsTab = () => import("../sections/patient-documents-tab");
const loadPatientContractsTab = () => import("../sections/patient-contracts-tab");
const loadPatientInvoicesTab = () => import("../sections/patient-invoices-tab");
const loadPatientWorkflowTab = () => import("../sections/patient-workflow-section");
const loadPatientTimelineTab = () => import("../sections/patient-timeline-section");

const LazyPatientProfileTab = lazy(async () => {
  const mod = await loadPatientProfileTab();
  return { default: mod.PatientProfileTab };
});

const LazyPatientCuratorsTab = lazy(async () => {
  const mod = await loadPatientCuratorsTab();
  return { default: mod.PatientCuratorsTab };
});

const LazyPatientRelationsTab = lazy(async () => {
  const mod = await loadPatientRelationsTab();
  return { default: mod.PatientRelationsTab };
});

const LazyPatientCasesTab = lazy(async () => {
  const mod = await loadPatientCasesTab();
  return { default: mod.PatientCasesTab };
});

const LazyPatientOrdersTab = lazy(async () => {
  const mod = await loadPatientOrdersTab();
  return { default: mod.PatientOrdersTab };
});

const LazyPatientAppointmentsTab = lazy(async () => {
  const mod = await loadPatientAppointmentsTab();
  return { default: mod.PatientAppointmentsTab };
});

const LazyPatientDocumentsTab = lazy(async () => {
  const mod = await loadPatientDocumentsTab();
  return { default: mod.PatientDocumentsTab };
});

const LazyPatientContractsTab = lazy(async () => {
  const mod = await loadPatientContractsTab();
  return { default: mod.PatientContractsTab };
});

const LazyPatientInvoicesTab = lazy(async () => {
  const mod = await loadPatientInvoicesTab();
  return { default: mod.PatientInvoicesTab };
});

const LazyPatientWorkflowTab = lazy(async () => {
  const mod = await loadPatientWorkflowTab();
  return { default: mod.PatientWorkflowTab };
});

const LazyPatientTimelineTab = lazy(async () => {
  const mod = await loadPatientTimelineTab();
  return { default: mod.PatientTimelineTab };
});

function preloadPatientWorkspaceTab(tab: string) {
  switch (tab) {
    case "profile":
      void loadPatientProfileTab();
      break;
    case "curators":
      void loadPatientCuratorsTab();
      break;
    case "relations":
      void loadPatientRelationsTab();
      break;
    case "cases":
      void loadPatientCasesTab();
      break;
    case "orders":
      void loadPatientOrdersTab();
      break;
    case "appointments":
      void loadPatientAppointmentsTab();
      break;
    case "documents":
      void loadPatientDocumentsTab();
      break;
    case "contracts":
      void loadPatientContractsTab();
      break;
    case "invoices":
      void loadPatientInvoicesTab();
      break;
    case "workflow":
      void loadPatientWorkflowTab();
      break;
    case "timeline":
      void loadPatientTimelineTab();
      break;
    default:
      break;
  }
}

type LocalizeFn = (de: string, ru: string, en: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type MoneyFormatter = (value?: string | null, currency?: string) => string;
type FieldValueFn = (value: string | string[] | null | undefined, fallback: string) => string;
type NumberFormatter = (value?: number | null, options?: Intl.NumberFormatOptions) => string | null;

type WorkflowFormState = {
  itemText: string;
  ownerUserId: string;
  priority: string;
  dueDate: string;
};

type LegalStatusChecklistItem = {
  key: string;
  label: string;
  done: boolean;
};

type TimelineRangeOption = {
  value: PatientTimelineRangeFilter;
  label: string;
};

type WorkflowChecklistGroup = {
  key: string;
  label: string;
  items: WorkflowChecklistItem[];
};

type WorkspaceTab = {
  key: string;
  label: string;
};

type PatientDetailWorkspaceContentProps = {
  activeTab: string;
  activeWorkflowAssignees: PatientAssignment[];
  appointmentCarePathKindLabel: (value?: string | null) => string;
  appointmentSheetOpen: boolean;
  appointmentTypeLabel: (value: string) => string;
  appointments: AppointmentItem[];
  assignBusy: boolean;
  assignments: PatientAssignment[];
  assignableStaff: StaffOption[];
  canEditPatientProfile: boolean;
  canExportPatientCompliance: boolean;
  canManage: boolean;
  canManageContracts: boolean;
  canManageDocuments: boolean;
  canManageInvoices: boolean;
  canManagePatientCardEntries: boolean;
  canManagePatientMedicalOrders: boolean;
  canManagePatientRiskScores: boolean;
  canManagePatientVitals: boolean;
  canManageRelations: boolean;
  canManageWorkflowChecklist: boolean;
  canOpenComplianceWorkspace: boolean;
  canOpenDocumentsWorkspace: boolean;
  canPrintPatientLabel: boolean;
  canViewContracts: boolean;
  canViewDocuments: boolean;
  canViewInvoices: boolean;
  cardEntries: PatientCardEntry[];
  cardEntrySheetOpen: boolean;
  cases: CaseItem[];
  caveSheetOpen: boolean;
  clinicalSurfaceItemCount: number;
  complianceExportBusy: boolean;
  contractExpiringSoonCount: number;
  contractPendingCount: number;
  contractSignedCount: number;
  contracts: ContractItem[];
  contractsPreviewOpen: boolean;
  detail: PatientDetail;
  docsPreviewOpen: boolean;
  documentAlerts: DocumentAlerts | null;
  documentCategoryFilter: string;
  documentCategoryOptions: string[];
  documentStatusFilter: string;
  documentStatusOptions: string[];
  documents: DocumentItem[];
  documentsFilenameLabel: string;
  appointmentsTypeLabel: string;
  usersStatusLabel: string;
  patientsAssignedByLabel: string;
  usersCreatedLabel: string;
  emptyCasesLabel: string;
  emptyOrdersLabel: string;
  emptyAppointmentsLabel: string;
  fieldValue: FieldValueFn;
  filteredDocuments: DocumentItem[];
  filteredTimeline: PatientTimelineItem[];
  financialLedger: PatientFinancialLedger | null;
  financialSummary: PatientFinancialSummary | null;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  formatMoney: MoneyFormatter;
  formatVitalNumber: NumberFormatter;
  formInputClassName: string;
  genderLabel: (value: string | null | undefined, tr: PatientsDictionary) => string;
  groupedTimeline: Array<{ key: string; label: string; items: PatientTimelineItem[] }>;
  handleExportPatientCompliance: () => void | Promise<void>;
  handleTabChange: (nextTab: string) => void;
  handleUpdatePatientMedicalOrderStatus: (orderId: string, nextStatus: "completed" | "cancelled") => void | Promise<void>;
  hasClinicalSurface: boolean;
  hasDocumentFilters: boolean;
  hasTimelineFilters: boolean;
  id?: string;
  initials: string;
  insuranceLabel: (value: string | null | undefined, tr: PatientsDictionary) => string;
  invoiceOpenCount: number;
  invoiceOutstandingAmount: number;
  invoiceOverdueCount: number;
  invoicePaidAmountTotal: number;
  invoiceTypeLabel: (value: string) => string;
  invoices: InvoiceItem[];
  invoicesPreviewOpen: boolean;
  isContractExpiringSoon: (contract: ContractItem) => boolean;
  l: LocalizeFn;
  legalStatus: PatientLegalStatus;
  legalStatusChecklist: LegalStatusChecklistItem[];
  legalStatusCompletion: {
    completed: number;
    total: number;
    ratio: number;
  };
  legalStatusSheetOpen: boolean;
  localizedTimelineRangeOptions: TimelineRangeOption[];
  medicalOrderActionId: string;
  medicalOrderSheetOpen: boolean;
  medicalOrders: PatientMedicalOrder[];
  moneyValueNumber: (value?: string | null) => number;
  notesSheetOpen: boolean;
  onAppointmentSheetOpenChange: (open: boolean) => void;
  onAssign: () => void;
  onCardEntrySheetOpenChange: (open: boolean) => void;
  onCaveSheetOpenChange: (open: boolean) => void;
  onContractsPreviewOpenChange: (open: boolean) => void;
  onCreateContract: () => void;
  onCreateRelation: () => void;
  onDeleteRelation: (relationId: string) => void;
  onDocsPreviewOpenChange: (open: boolean) => void;
  onEditContractStatus: (contract: ContractItem) => void;
  onEditRelation: (relation: RelationItem) => void;
  onInvoicesPreviewOpenChange: (open: boolean) => void;
  onLegalStatusSheetOpenChange: (open: boolean) => void;
  onManageInvoice: (invoice: InvoiceItem) => void;
  onMedicalOrderSheetOpenChange: (open: boolean) => void;
  onNotesSheetOpenChange: (open: boolean) => void;
  onOpenAppointment: (appointmentId: string) => void;
  onOpenCase: (caseId: string) => void;
  onOpenContract: (contractId: string) => void;
  onOpenInvoice: (invoiceId: string) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenPatient: (patientId: string) => void;
  onOpenProfileEditor: () => void;
  onOpenUpload: () => void;
  onPrintPatientLabel: (format: PatientLabelFormatId) => void;
  onResetDocumentFilters: () => void;
  onResetTimelineFilters: () => void;
  onRevokeAssignment: (item: PatientAssignment) => void;
  onRiskScoreSheetOpenChange: (open: boolean) => void;
  onSelectedAssigneeChange: (value: string) => void;
  onTimelineCategoryFilterChange: (value: string) => void;
  onTimelineEntityFilterChange: (value: string) => void;
  onTimelineOffsetChange: (value: number) => void;
  onTimelineRangeFilterChange: (value: PatientTimelineRangeFilter) => void;
  onTimelineSearchChange: (value: string) => void;
  onTimelineSourceFilterChange: (value: string) => void;
  onTogglePatientActivation: () => Promise<void>;
  onVitalsSheetOpenChange: (open: boolean) => void;
  onWorkflowCompleteItem: (itemId: string) => void | Promise<void>;
  onWorkflowDueDateChange: (value: string) => void;
  onWorkflowItemTextChange: (value: string) => void;
  onWorkflowOwnerChange: (value: string) => void;
  onWorkflowPriorityChange: (value: string) => void;
  onWorkflowSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  orderPhaseLabel: (value: string) => string;
  orders: OrderItem[];
  patientCardEntryCategoryBadgeClass: (category: string) => string;
  patientCardEntryCategoryLabel: (category: string) => string;
  patientDetailStatusLabel: (status: string) => string;
  patientLabelBusy: boolean;
  patientMedicalOrderTypeLabel: (orderType: string) => string;
  patientName: (detail: PatientDetail) => string;
  patientRiskScoreTypeLabel: (scoreType: string) => string;
  priorityBadgeClass: (priority: string) => string;
  priorityLabel: (priority: string) => string;
  relationTypeLabel: (value: string) => string;
  relations: RelationItem[];
  reload: () => void;
  requiredDocumentFulfilledCount: number;
  riskScoreSheetOpen: boolean;
  riskScores: PatientRiskScore[];
  roleColors: Record<string, string>;
  roleLabel: (value: string | null | undefined, tr: PatientsDictionary) => string;
  selectedAssignee: string;
  servicePackages: PatientServicePackageItem[];
  staffGo: (to: string) => void;
  statusColors: Record<string, string>;
  statusBadgeClasses: Record<string, string>;
  t: Translations;
  tabActionError: string;
  tabLoading: boolean;
  timeline: PatientTimelineItem[];
  timelineCategoryFilter: string;
  timelineCategoryOptions: string[];
  timelineEntityDotClass: (entityType: string) => string;
  timelineEntityFilter: string;
  timelineHasNextPage: boolean;
  timelineItemSurfaceClass: (status: string) => string;
  timelineLimit: number;
  timelineOffset: number;
  timelineRangeFilter: PatientTimelineRangeFilter;
  timelineSearch: string;
  timelineSourceFilter: string;
  timelineSourceOptions: string[];
  timelineSummary: PatientTimelineSummary;
  timelineTotal: number;
  tr: PatientsDictionary;
  vitalsHistory: PatientVitalMeasurement[];
  vitalsSheetOpen: boolean;
  workflowBusy: boolean;
  workflowChecklist: WorkflowChecklistResponse | null;
  workflowChecklistGroups: WorkflowChecklistGroup[];
  workflowForm: WorkflowFormState;
  workflowItemCount: number;
  workspaceTabs: WorkspaceTab[];
};

function usePatientDetailWorkspaceContentContent(props: PatientDetailWorkspaceContentProps) {
  const {
    activeTab,
    activeWorkflowAssignees,
    appointmentCarePathKindLabel,
    appointmentSheetOpen,
    appointmentTypeLabel,
    appointments,
    assignBusy,
    assignments,
    assignableStaff,
    canEditPatientProfile,
    canExportPatientCompliance,
    canManage,
    canManageContracts,
    canManageDocuments,
    canManageInvoices,
    canManagePatientCardEntries,
    canManagePatientMedicalOrders,
    canManagePatientRiskScores,
    canManagePatientVitals,
    canManageRelations,
    canManageWorkflowChecklist,
    canOpenComplianceWorkspace,
    canOpenDocumentsWorkspace,
    canPrintPatientLabel,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
    cardEntries,
    cardEntrySheetOpen,
    cases,
    caveSheetOpen,
    clinicalSurfaceItemCount,
    complianceExportBusy,
    contractExpiringSoonCount,
    contractPendingCount,
    contractSignedCount,
    contracts,
    contractsPreviewOpen,
    detail,
    docsPreviewOpen,
    documentAlerts,
    documentCategoryFilter,
    documentCategoryOptions,
    documentStatusFilter,
    documentStatusOptions,
    documents,
    documentsFilenameLabel,
    appointmentsTypeLabel,
    usersStatusLabel,
    patientsAssignedByLabel,
    usersCreatedLabel,
    emptyCasesLabel,
    emptyOrdersLabel,
    emptyAppointmentsLabel,
    fieldValue,
    filteredDocuments,
    filteredTimeline,
    financialLedger,
    financialSummary,
    formatDate,
    formatDateTime,
    formatMoney,
    formatVitalNumber,
    formInputClassName,
    genderLabel,
    groupedTimeline,
    handleExportPatientCompliance,
    handleTabChange,
    handleUpdatePatientMedicalOrderStatus,
    hasClinicalSurface,
    hasDocumentFilters,
    hasTimelineFilters,
    id,
    initials,
    insuranceLabel,
    invoiceOpenCount,
    invoiceOutstandingAmount,
    invoiceOverdueCount,
    invoicePaidAmountTotal,
    invoiceTypeLabel,
    invoices,
    invoicesPreviewOpen,
    isContractExpiringSoon,
    l,
    legalStatus,
    legalStatusChecklist,
    legalStatusCompletion,
    legalStatusSheetOpen,
    localizedTimelineRangeOptions,
    medicalOrderActionId,
    medicalOrderSheetOpen,
    medicalOrders,
    moneyValueNumber,
    notesSheetOpen,
    onAppointmentSheetOpenChange,
    onAssign,
    onCardEntrySheetOpenChange,
    onCaveSheetOpenChange,
    onContractsPreviewOpenChange,
    onCreateContract,
    onCreateRelation,
    onDeleteRelation,
    onDocsPreviewOpenChange,
    onEditContractStatus,
    onEditRelation,
    onInvoicesPreviewOpenChange,
    onLegalStatusSheetOpenChange,
    onManageInvoice,
    onMedicalOrderSheetOpenChange,
    onNotesSheetOpenChange,
    onOpenAppointment,
    onOpenCase,
    onOpenContract,
    onOpenInvoice,
    onOpenOrder,
    onOpenPatient,
    onOpenProfileEditor,
    onOpenUpload,
    onPrintPatientLabel,
    onResetDocumentFilters,
    onResetTimelineFilters,
    onRevokeAssignment,
    onRiskScoreSheetOpenChange,
    onSelectedAssigneeChange,
    onTimelineCategoryFilterChange,
    onTimelineEntityFilterChange,
    onTimelineOffsetChange,
    onTimelineRangeFilterChange,
    onTimelineSearchChange,
    onTimelineSourceFilterChange,
    onTogglePatientActivation,
    onVitalsSheetOpenChange,
    onWorkflowCompleteItem,
    onWorkflowDueDateChange,
    onWorkflowItemTextChange,
    onWorkflowOwnerChange,
    onWorkflowPriorityChange,
    onWorkflowSubmit,
    orderPhaseLabel,
    orders,
    patientCardEntryCategoryBadgeClass,
    patientCardEntryCategoryLabel,
    patientDetailStatusLabel,
    patientLabelBusy,
    patientMedicalOrderTypeLabel,
    patientName,
    patientRiskScoreTypeLabel,
    priorityBadgeClass,
    priorityLabel,
    relationTypeLabel,
    relations,
    reload,
    requiredDocumentFulfilledCount,
    riskScoreSheetOpen,
    riskScores,
    roleColors,
    roleLabel,
    selectedAssignee,
    servicePackages,
    staffGo,
    statusColors,
    statusBadgeClasses,
    t,
    tabActionError,
    tabLoading,
    timeline,
    timelineCategoryFilter,
    timelineCategoryOptions,
    timelineEntityDotClass,
    timelineEntityFilter,
    timelineHasNextPage,
    timelineItemSurfaceClass,
    timelineLimit,
    timelineOffset,
    timelineRangeFilter,
    timelineSearch,
    timelineSourceFilter,
    timelineSourceOptions,
    timelineSummary,
    timelineTotal,
    tr,
    vitalsHistory,
    vitalsSheetOpen,
    workflowBusy,
    workflowChecklist,
    workflowChecklistGroups,
    workflowForm,
    workflowItemCount,
    workspaceTabs,
  } = props;

  function handleWorkspaceTabChange(nextTab: string) {
    preloadPatientWorkspaceTab(nextTab);
    handleTabChange(nextTab);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{patientName(detail)}</h1>
            <StatusActionPill
              isActive={detail.is_active}
              activeLabel={t.common_active}
              inactiveLabel={t.common_inactive}
              toggleActiveLabel={l("Patient deaktivieren", "Деактивировать пациента", "Deactivate patient")}
              toggleInactiveLabel={l("Patient aktivieren", "Активировать пациента", "Activate patient")}
              onToggle={onTogglePatientActivation}
            />
            {detail.functional_labels?.map((label) => (
              <Badge
                key={`${detail.id}-${label}`}
                variant="outline"
                className={cn("rounded-full text-[10.5px]", functionalLabelChipClass(label))}
              >
                {humanizeFunctionalLabel(label)}
              </Badge>
            ))}
          </div>
          <p className="mt-0.5 text-[12px] font-mono text-muted-foreground">{detail.patient_id}</p>
        </div>
        {canPrintPatientLabel ? (
          <NativeComboboxSelect
            value=""

            disabled={patientLabelBusy}

            onChange={(event) => {
              if (!event.target.value) return;
              onPrintPatientLabel(event.target.value as PatientLabelFormatId);
            }} className="h-9 rounded-lg bg-card text-[13px] gap-1.5 w-auto">
              {PATIENT_LABEL_FORMAT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </NativeComboboxSelect>
        ) : null}
        {canEditPatientProfile ? (
          <Button size="sm" className="h-9 rounded-lg gap-1.5 px-3.5" onClick={onOpenProfileEditor}>
            <SquarePen className="size-3.5" />
            {l("Profil bearbeiten", "Редактировать профиль", "Edit profile")}
          </Button>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={handleWorkspaceTabChange}>
        <div className="border-b border-zinc-200 lg:hidden overflow-x-auto">
          <TabsList variant="line" className="min-w-max">
            {workspaceTabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="px-4 py-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabActionError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {tabActionError}
          </div>
        ) : null}

        <Suspense fallback={<TabLoader />}>
          {activeTab === "profile" ? (
            <LazyPatientProfileTab
              profileControls={{
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
              }}
              cardEntries={cardEntries}
              cardEntrySheetOpen={cardEntrySheetOpen}
              caveSheetOpen={caveSheetOpen}
              clinicalSurfaceItemCount={clinicalSurfaceItemCount}
              complianceExportBusy={complianceExportBusy}
              contractsPreviewOpen={contractsPreviewOpen}
              detail={detail}
              docsPreviewOpen={docsPreviewOpen}
              fieldValue={fieldValue}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
              formatVitalNumber={formatVitalNumber}
              genderLabel={genderLabel}
              handleExportPatientCompliance={handleExportPatientCompliance}
              handleUpdatePatientMedicalOrderStatus={handleUpdatePatientMedicalOrderStatus}
              id={id}
              insuranceLabel={insuranceLabel}
              invoicesPreviewOpen={invoicesPreviewOpen}
              l={l}
              legalStatus={legalStatus}
              legalStatusChecklist={legalStatusChecklist}
              legalStatusCompletion={legalStatusCompletion}
              legalStatusSheetOpen={legalStatusSheetOpen}
              medicalOrderActionId={medicalOrderActionId}
              medicalOrderSheetOpen={medicalOrderSheetOpen}
              medicalOrders={medicalOrders}
              notesSheetOpen={notesSheetOpen}
              onCardEntrySheetOpenChange={onCardEntrySheetOpenChange}
              onCaveSheetOpenChange={onCaveSheetOpenChange}
              onContractsPreviewOpenChange={onContractsPreviewOpenChange}
              onDocsPreviewOpenChange={onDocsPreviewOpenChange}
              onInvoicesPreviewOpenChange={onInvoicesPreviewOpenChange}
              onLegalStatusSheetOpenChange={onLegalStatusSheetOpenChange}
              onMedicalOrderSheetOpenChange={onMedicalOrderSheetOpenChange}
              onNotesSheetOpenChange={onNotesSheetOpenChange}
              onRiskScoreSheetOpenChange={onRiskScoreSheetOpenChange}
              onVitalsSheetOpenChange={onVitalsSheetOpenChange}
              openProfileEditor={onOpenProfileEditor}
              patientCardEntryCategoryBadgeClass={patientCardEntryCategoryBadgeClass}
              patientCardEntryCategoryLabel={patientCardEntryCategoryLabel}
              patientDetailStatusLabel={patientDetailStatusLabel}
              patientMedicalOrderTypeLabel={patientMedicalOrderTypeLabel}
              patientRiskScoreTypeLabel={patientRiskScoreTypeLabel}
              reload={reload}
              riskScoreSheetOpen={riskScoreSheetOpen}
              riskScores={riskScores}
              staffGo={staffGo}
              statusBadgeClasses={statusBadgeClasses}
              t={t}
              tr={tr}
              vitalsHistory={vitalsHistory}
              vitalsSheetOpen={vitalsSheetOpen}
            />
          ) : null}

          {activeTab === "curators" ? (
            <LazyPatientCuratorsTab
              assignments={assignments}
              assignableStaff={assignableStaff}
              assignBusy={assignBusy}
              canManage={canManage}
              formInputClassName={formInputClassName}
              l={l}
              onAssign={onAssign}
              onRevoke={onRevokeAssignment}
              onSelectedAssigneeChange={onSelectedAssigneeChange}
              roleColors={roleColors}
              roleLabel={roleLabel}
              selectedAssignee={selectedAssignee}
              formatDateTime={formatDateTime}
              t={t}
              tr={tr}
            />
          ) : null}

          {activeTab === "relations" ? (
            <LazyPatientRelationsTab
              canManageRelations={canManageRelations}
              formatDateTime={formatDateTime}
              l={l}
              onCreateRelation={onCreateRelation}
              onDeleteRelation={onDeleteRelation}
              onEditRelation={onEditRelation}
              onOpenPatient={onOpenPatient}
              relationTypeLabel={relationTypeLabel}
              relations={relations}
              tabLoading={tabLoading}
            />
          ) : null}

          {activeTab === "cases" ? (
            <LazyPatientCasesTab
              cases={cases}
              emptyLabel={emptyCasesLabel}
              formatDate={formatDate}
              onOpenCase={onOpenCase}
              statusColors={statusColors}
              statusLabel={(status) => tr[`cases_${status}`] ?? formatUnknownValue(status, t)}
              t={t}
              tabLoading={tabLoading}
            />
          ) : null}

          {activeTab === "orders" ? (
            <LazyPatientOrdersTab
              emptyLabel={emptyOrdersLabel}
              formatDate={formatDate}
              onOpenOrder={onOpenOrder}
              orderPhaseLabel={orderPhaseLabel}
              orders={orders}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              t={t}
              tabLoading={tabLoading}
            />
          ) : null}

          {activeTab === "appointments" ? (
            <LazyPatientAppointmentsTab
              appointmentCarePathKindLabel={appointmentCarePathKindLabel}
              appointmentSheetOpen={appointmentSheetOpen}
              appointmentTypeLabel={appointmentTypeLabel}
              appointments={appointments}
              canManage={canManage}
              emptyLabel={emptyAppointmentsLabel}
              formatDate={formatDate}
              onAppointmentSheetOpenChange={onAppointmentSheetOpenChange}
              onOpenAppointment={onOpenAppointment}
              patientId={id}
              reload={reload}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              t={t}
              tabLoading={tabLoading}
            />
          ) : null}

          {activeTab === "documents" ? (
            <LazyPatientDocumentsTab
              l={l}
              commonNotSet={t.common_not_set}
              commonUnknown={t.common_unknown}
              documentsFilenameLabel={documentsFilenameLabel}
              appointmentsTypeLabel={appointmentsTypeLabel}
              usersStatusLabel={usersStatusLabel}
              patientsAssignedByLabel={patientsAssignedByLabel}
              usersCreatedLabel={usersCreatedLabel}
              tabLoading={tabLoading}
              documents={documents}
              filteredDocuments={filteredDocuments}
              documentAlerts={documentAlerts}
              requiredDocumentFulfilledCount={requiredDocumentFulfilledCount}
              documentCategoryOptions={documentCategoryOptions}
              documentStatusOptions={documentStatusOptions}
              hasDocumentFilters={hasDocumentFilters}
              documentStatusFilter={documentStatusFilter}
              documentCategoryFilter={documentCategoryFilter}
              onDocumentStatusFilterChange={onTimelineEntityFilterChange}
              onDocumentCategoryFilterChange={onTimelineCategoryFilterChange}
              onResetDocumentFilters={onResetDocumentFilters}
              canManageDocuments={canManageDocuments}
              onOpenUpload={onOpenUpload}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              formatDate={formatDate}
            />
          ) : null}

          {activeTab === "contracts" && canViewContracts ? (
            <LazyPatientContractsTab
              l={l}
              commonNotSet={t.common_not_set}
              tabLoading={tabLoading}
              contracts={contracts}
              contractSignedCount={contractSignedCount}
              contractPendingCount={contractPendingCount}
              contractExpiringSoonCount={contractExpiringSoonCount}
              canManageContracts={canManageContracts}
              onCreateContract={onCreateContract}
              onEditContractStatus={onEditContractStatus}
              onOpenContract={onOpenContract}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
              isContractExpiringSoon={isContractExpiringSoon}
            />
          ) : null}

          {activeTab === "invoices" && canViewInvoices ? (
            <LazyPatientInvoicesTab
              l={l}
              commonNotSet={t.common_not_set}
              tabLoading={tabLoading}
              invoices={invoices}
              invoiceOpenCount={invoiceOpenCount}
              invoiceOverdueCount={invoiceOverdueCount}
              invoiceOutstandingAmount={invoiceOutstandingAmount}
              invoicePaidAmountTotal={invoicePaidAmountTotal}
              financialSummary={financialSummary}
              financialLedger={financialLedger}
              servicePackages={servicePackages}
              canManageInvoices={canManageInvoices}
              onOpenInvoice={onOpenInvoice}
              onManageInvoice={onManageInvoice}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              formatDate={formatDate}
              formatDateTime={formatDateTime}
              formatMoney={formatMoney}
              moneyValueNumber={moneyValueNumber}
              invoiceTypeLabel={invoiceTypeLabel}
            />
          ) : null}

          {activeTab === "workflow" ? (
            <LazyPatientWorkflowTab
              l={l}
              commonNotSet={t.common_not_set}
              tabLoading={tabLoading}
              workflowChecklist={workflowChecklist}
              workflowChecklistGroups={workflowChecklistGroups}
              workflowItemCount={workflowItemCount}
              workflowBusy={workflowBusy}
              workflowForm={workflowForm}
              activeWorkflowAssignees={activeWorkflowAssignees}
              canManageWorkflowChecklist={canManageWorkflowChecklist}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              formatDateTime={formatDateTime}
              roleLabel={(value) => roleLabel(value, tr)}
              priorityLabel={priorityLabel}
              priorityBadgeClass={priorityBadgeClass}
              onCompleteWorkflowItem={onWorkflowCompleteItem}
              onSubmitWorkflowItem={onWorkflowSubmit}
              onWorkflowItemTextChange={onWorkflowItemTextChange}
              onWorkflowOwnerChange={onWorkflowOwnerChange}
              onWorkflowPriorityChange={onWorkflowPriorityChange}
              onWorkflowDueDateChange={onWorkflowDueDateChange}
            />
          ) : null}

          {activeTab === "timeline" ? (
            <LazyPatientTimelineTab
              l={l}
              commonSearch={t.common_search}
              tabLoading={tabLoading}
              timeline={timeline}
              filteredTimeline={filteredTimeline}
              groupedTimeline={groupedTimeline}
              timelineSummary={timelineSummary}
              timelineTotal={timelineTotal}
              timelineOffset={timelineOffset}
              timelineLimit={timelineLimit}
              timelineHasNextPage={timelineHasNextPage}
              timelineEntityFilter={timelineEntityFilter}
              timelineCategoryFilter={timelineCategoryFilter}
              timelineSourceFilter={timelineSourceFilter}
              timelineRangeFilter={timelineRangeFilter}
              timelineSearch={timelineSearch}
              localizedTimelineRangeOptions={localizedTimelineRangeOptions}
              timelineCategoryOptions={timelineCategoryOptions}
              timelineSourceOptions={timelineSourceOptions}
              statusColors={statusColors}
              statusLabel={patientDetailStatusLabel}
              formatDateTime={formatDateTime}
              timelineEntityDotClass={timelineEntityDotClass}
              timelineItemSurfaceClass={timelineItemSurfaceClass}
              timelineAccess={{
                hasTimelineFilters,
                canOpenDocumentsWorkspace,
                canViewContracts,
                canViewInvoices,
                canOpenComplianceWorkspace,
              }}
              patientId={id}
              onTimelineEntityFilterChange={onTimelineEntityFilterChange}
              onTimelineCategoryFilterChange={onTimelineCategoryFilterChange}
              onTimelineSourceFilterChange={onTimelineSourceFilterChange}
              onTimelineRangeFilterChange={onTimelineRangeFilterChange}
              onTimelineSearchChange={onTimelineSearchChange}
              onTimelineOffsetChange={onTimelineOffsetChange}
              onResetTimelineFilters={onResetTimelineFilters}
              onOpenRoute={staffGo}
            />
          ) : null}
        </Suspense>
      </Tabs>
    </div>
  );
}

export function PatientDetailWorkspaceContent(...args: Parameters<typeof usePatientDetailWorkspaceContentContent>) {
  return usePatientDetailWorkspaceContentContent(...args);
}
