import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";

import {
  AlertTriangle,
  FileUp,
  LoaderCircle,
  Plus,
  SquarePen,
} from "lucide-react";

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
import { getLang, type Translations } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

import { resolvePatientBalancePresentation } from "../../model/account-balance";
import {
  PATIENT_LABEL_FORMAT_OPTIONS,
  patientLabelFormatLabel,
  type PatientLabelFormatId,
  type PatientTimelineItem,
  type PatientTimelineRangeFilter,
  type PatientTimelineSummary,
} from "../../model/detail-model";
import type {
  AppointmentItem,
  ContractItem,
  DocumentAlerts,
  DocumentItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientAccountStatement,
  PatientServicePackageItem,
  InvoiceItem,
  OrderItem,
  RelationItem,
  WorkflowChecklistItem,
  WorkflowChecklistResponse,
} from "../../model/detail-tab-types";
import type { PatientLegalStatus } from "../../model/legal-status";
import type { PatientAssignment, PatientDetail, PatientsDictionary, StaffOption } from "../../model/list-model";
import {
  fetchClinicalDocumentImports,
  type ClinicalDocumentImportSummary,
} from "../../data/clinical-document-import";
import { buildPatientOrderCreateHref } from "../../model/patient-order-navigation";
import {
  functionalLabelChipClass,
  humanizeFunctionalLabel,
} from "../shared/patient-form-primitives";
import { PatientOverviewCard } from "../sections/patient-overview-card";

const loadPatientProfileTab = () => import("../sections/patient-profile-section");
const loadPatientCuratorsTab = () => import("../sections/patient-curators-tab");
const loadPatientRelationsTab = () => import("../sections/patient-relations-tab");
const loadPatientOrdersTab = () => import("../sections/patient-orders-tab");
const loadPatientAppointmentsTab = () => import("../sections/patient-appointments-tab");
const loadPatientClinicalTab = () => import("../sections/patient-clinical-tab");
const loadPatientDocumentsTab = () => import("../sections/patient-documents-tab");
const loadPatientContractsTab = () => import("../sections/patient-contracts-tab");
const loadPatientInvoicesTab = () => import("../sections/patient-invoices-tab");
const loadPatientWorkflowTab = () => import("../sections/patient-workflow-section");
const loadPatientTimelineTab = () => import("../sections/patient-timeline-section");
const loadLeadWizard = () => import("@/pages/leads/ui/lead-wizard");

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

const LazyPatientOrdersTab = lazy(async () => {
  const mod = await loadPatientOrdersTab();
  return { default: mod.PatientOrdersTab };
});

const LazyPatientAppointmentsTab = lazy(async () => {
  const mod = await loadPatientAppointmentsTab();
  return { default: mod.PatientAppointmentsTab };
});

const LazyPatientClinicalTab = lazy(async () => {
  const mod = await loadPatientClinicalTab();
  return { default: mod.PatientClinicalTab };
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

const LazyLeadWizard = lazy(async () => {
  const mod = await loadLeadWizard();
  return { default: mod.LeadWizard };
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
    case "orders":
      void loadPatientOrdersTab();
      break;
    case "appointments":
      void loadPatientAppointmentsTab();
      break;
    case "clinical":
      void loadPatientClinicalTab();
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

type LocalizeFn = (key: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type MoneyFormatter = (value?: string | null, currency?: string) => string;
type FieldValueFn = (value: string | string[] | null | undefined, fallback: string) => string;

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
  canCreateOrders: boolean;
  canCreateTasks: boolean;
  canEditPatientProfile: boolean;
  canExportPatientCompliance: boolean;
  canManage: boolean;
  canManageContracts: boolean;
  canManageDocuments: boolean;
  canManageInvoices: boolean;
  canManageRelations: boolean;
  canManageWorkflowChecklist: boolean;
  canOpenComplianceWorkspace: boolean;
  canOpenDocumentsWorkspace: boolean;
  canPrintPatientLabel: boolean;
  canViewClinical: boolean;
  canViewContracts: boolean;
  canViewDocuments: boolean;
  canViewInvoices: boolean;
  complianceExportBusy: boolean;
  contractExpiringSoonCount: number;
  contractPendingCount: number;
  contractSignedCount: number;
  contracts: ContractItem[];
  detail: PatientDetail;
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
  formInputClassName: string;
  genderLabel: (value: string | null | undefined, tr: PatientsDictionary) => string;
  groupedTimeline: Array<{ key: string; label: string; items: PatientTimelineItem[] }>;
  handleExportPatientCompliance: () => void | Promise<void>;
  handleTabChange: (nextTab: string) => void;
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
  isContractExpiringSoon: (contract: ContractItem) => boolean;
  lang: "de" | "ru";
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
  moneyValueNumber: (value?: string | null) => number;
  notesSheetOpen: boolean;
  onAppointmentSheetOpenChange: (open: boolean) => void;
  onAssign: () => void;
  onCreateContract: () => void;
  onCreateRelation: () => void;
  onDeleteRelation: (relationId: string) => void;
  onDocumentCategoryFilterChange: (value: string) => void;
  onDocumentStatusFilterChange: (value: string) => void;
  onDocumentGenerated: () => void;
  onEditContractStatus: (contract: ContractItem) => void;
  onEditRelation: (relation: RelationItem) => void;
  onLegalStatusSheetOpenChange: (open: boolean) => void;
  onManageInvoice: (invoice: InvoiceItem) => void;
  onNotesSheetOpenChange: (open: boolean) => void;
  onOpenAppointment: (appointmentId: string) => void;
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
  onSelectedAssigneeChange: (value: string) => void;
  onTimelineCategoryFilterChange: (value: string) => void;
  onTimelineEntityFilterChange: (value: string) => void;
  onTimelineOffsetChange: (value: number) => void;
  onTimelineRangeFilterChange: (value: PatientTimelineRangeFilter) => void;
  onTimelineSearchChange: (value: string) => void;
  onTimelineSourceFilterChange: (value: string) => void;
  onTogglePatientActivation: () => Promise<void>;
  onWorkflowCompleteItem: (itemId: string) => void | Promise<void>;
  onWorkflowDueDateChange: (value: string) => void;
  onWorkflowItemTextChange: (value: string) => void;
  onWorkflowOwnerChange: (value: string) => void;
  onWorkflowPriorityChange: (value: string) => void;
  onWorkflowSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  orderPhaseLabel: (value: string) => string;
  orders: OrderItem[];
  patientDetailStatusLabel: (status: string) => string;
  patientLabelBusy: boolean;
  patientName: (detail: PatientDetail) => string;
  priorityBadgeClass: (priority: string) => string;
  priorityLabel: (priority: string) => string;
  relationTypeLabel: (value: string) => string;
  relations: RelationItem[];
  reload: () => void;
  roleColors: Record<string, string>;
  roleLabel: (value: string | null | undefined, tr: PatientsDictionary) => string;
  selectedAssignee: string;
  servicePackages: PatientServicePackageItem[];
  staffGo: (to: string) => void;
  statusColors: Record<string, string>;
  t: Translations;
  tabActionError: string;
  tabError: string;
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
    canCreateOrders,
    canCreateTasks,
    canEditPatientProfile,
    canExportPatientCompliance,
    canManage,
    canManageContracts,
    canManageDocuments,
    canManageInvoices,
    canManageRelations,
    canManageWorkflowChecklist,
    canOpenComplianceWorkspace,
    canOpenDocumentsWorkspace,
    canPrintPatientLabel,
    canViewClinical,
    canViewContracts,
    canViewDocuments,
    canViewInvoices,
    complianceExportBusy,
    contractExpiringSoonCount,
    contractPendingCount,
    contractSignedCount,
    contracts,
    detail,
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
    formInputClassName,
    genderLabel,
    groupedTimeline,
    handleExportPatientCompliance,
    handleTabChange,
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
    isContractExpiringSoon,
    lang,
    l,
    legalStatus,
    legalStatusChecklist,
    legalStatusCompletion,
    legalStatusSheetOpen,
    localizedTimelineRangeOptions,
    moneyValueNumber,
    notesSheetOpen,
    onAppointmentSheetOpenChange,
    onAssign,
    onCreateContract,
    onCreateRelation,
    onDeleteRelation,
    onDocumentCategoryFilterChange,
    onDocumentGenerated,
    onDocumentStatusFilterChange,
    onEditContractStatus,
    onEditRelation,
    onLegalStatusSheetOpenChange,
    onManageInvoice,
    onNotesSheetOpenChange,
    onOpenAppointment,
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
    onSelectedAssigneeChange,
    onTimelineCategoryFilterChange,
    onTimelineEntityFilterChange,
    onTimelineOffsetChange,
    onTimelineRangeFilterChange,
    onTimelineSearchChange,
    onTimelineSourceFilterChange,
    onTogglePatientActivation,
    onWorkflowCompleteItem,
    onWorkflowDueDateChange,
    onWorkflowItemTextChange,
    onWorkflowOwnerChange,
    onWorkflowPriorityChange,
    onWorkflowSubmit,
    orderPhaseLabel,
    orders,
    patientDetailStatusLabel,
    patientLabelBusy,
    patientName,
    priorityBadgeClass,
    priorityLabel,
    relationTypeLabel,
    relations,
    reload,
    roleColors,
    roleLabel,
    selectedAssignee,
    servicePackages,
    staffGo,
    statusColors,
    t,
    tabActionError,
    tabError,
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
    workflowBusy,
    workflowChecklist,
    workflowChecklistGroups,
    workflowForm,
    workflowItemCount,
    workspaceTabs,
  } = props;

  const [clinicalDocumentImportOpen, setClinicalDocumentImportOpen] = useState(false);
  const [clinicalImports, setClinicalImports] = useState<ClinicalDocumentImportSummary[]>([]);
  const [accountStatement, setAccountStatement] = useState<PatientAccountStatement | null>(null);
  const [accountStatementLoading, setAccountStatementLoading] = useState(false);
  const [repeatIntakeOpen, setRepeatIntakeOpen] = useState(false);
  const [repeatIntakeLeadId, setRepeatIntakeLeadId] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !canViewInvoices) {
      setAccountStatement(null);
      setAccountStatementLoading(false);
      return;
    }

    let cancelled = false;
    setAccountStatementLoading(true);
    void apiFetch<PatientAccountStatement>(`/patients/${id}/account-statement`, {
      forceFresh: true,
    })
      .then((statement) => {
        if (!cancelled) setAccountStatement(statement);
      })
      .catch(() => {
        if (!cancelled) setAccountStatement(null);
      })
      .finally(() => {
        if (!cancelled) setAccountStatementLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, canViewInvoices, detail, id]);

  const balance = accountStatement
    ? resolvePatientBalancePresentation(accountStatement.summary)
    : null;
  const balanceSideLabel =
    balance?.side === "debit"
      ? lang === "de" ? "Offener Betrag" : "Долг"
      : balance?.side === "credit"
        ? lang === "de" ? "Guthaben" : "Переплата"
        : "";
  const balanceValue = balance?.needsReconciliation
    ? lang === "de" ? "Abstimmung erforderlich" : "Требуется сверка"
    : balance?.amount != null
      ? [formatMoney(String(balance.amount), accountStatement?.currency), balanceSideLabel]
          .filter(Boolean)
          .join(" ")
      : accountStatementLoading ? "…" : "—";
  const balanceTitle = balance?.needsReconciliation
    ? lang === "de"
      ? "Berechneter Saldo – Abstimmung erforderlich. Rechnungen öffnen."
      : "Расчётное сальдо — требуется сверка. Открыть счета."
    : lang === "de"
      ? "Rechnungen öffnen"
      : "Открыть счета";

  const clinicalImportAttentionCount = clinicalImports.filter((item) =>
    ["queued", "processing", "review_required", "applying"].includes(item.status),
  ).length;

  useEffect(() => {
    if (!id || !canManageDocuments) return;
    let cancelled = false;

    const refreshClinicalImports = () => {
      void fetchClinicalDocumentImports(id)
        .then(({ items }) => {
          if (cancelled) return;
          setClinicalImports(items);
        })
        .catch(() => undefined);
    };

    refreshClinicalImports();
    const timer = window.setInterval(refreshClinicalImports, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canManageDocuments, id]);

  function handleWorkspaceTabChange(nextTab: string) {
    preloadPatientWorkspaceTab(nextTab);
    handleTabChange(nextTab);
  }

  function openClinicalDocumentImport() {
    preloadPatientWorkspaceTab("clinical");
    if (activeTab !== "clinical") handleTabChange("clinical");
    setClinicalDocumentImportOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-[var(--brand)] text-[12px] font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-[180px] flex-1 sm:min-w-[220px]">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight text-foreground truncate">{patientName(detail)}</h1>
            <StatusActionPill
              isActive={detail.is_active}
              activeLabel={t.common_active}
              inactiveLabel={t.common_inactive}
              toggleActiveLabel={l("patients_deactivate_patient")}
              toggleInactiveLabel={l("patients_activate_patient")}
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
        {canViewInvoices ? (
          <button
            type="button"
            className="group shrink-0 rounded-md px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`${t.invoices_workspace_balance}: ${balanceValue}. ${balanceTitle}`}
            title={balanceTitle}
            onClick={() => handleWorkspaceTabChange("invoices")}
          >
            <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t.invoices_workspace_balance}
            </span>
            <span
              className={cn(
                "flex items-center gap-1 text-sm font-semibold tabular-nums transition-colors",
                balance?.side === "debit"
                  ? "text-red-600 group-hover:text-red-700"
                  : balance?.side === "credit"
                    ? "text-emerald-600 group-hover:text-emerald-700"
                    : balance?.needsReconciliation
                      ? "text-amber-700 group-hover:text-amber-800"
                      : "text-foreground group-hover:text-primary",
              )}
            >
              {balanceValue}
              {balance?.needsReconciliation ? (
                <AlertTriangle className="size-3.5 text-amber-600" aria-hidden="true" />
              ) : null}
            </span>
          </button>
        ) : null}
        {canPrintPatientLabel ? (
          <NativeComboboxSelect
            value=""

            disabled={patientLabelBusy}

            onChange={(event) => {
              if (!event.target.value) return;
              onPrintPatientLabel(event.target.value as PatientLabelFormatId);
            }} className="h-9 rounded-lg bg-field text-[13px] gap-1.5 w-auto">
              {PATIENT_LABEL_FORMAT_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {patientLabelFormatLabel(option)}
                </option>
              ))}
            </NativeComboboxSelect>
        ) : null}
        {canCreateOrders && id ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 rounded-lg gap-1.5 px-3.5 whitespace-nowrap"
            onMouseEnter={() => void loadLeadWizard()}
            onFocus={() => void loadLeadWizard()}
            onClick={() => {
              setRepeatIntakeLeadId(null);
              setRepeatIntakeOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            {l("patients_repeat_intake")}
          </Button>
        ) : null}
        {canEditPatientProfile ? (
          <Button size="sm" className="h-9 rounded-lg gap-1.5 px-3.5" onClick={onOpenProfileEditor}>
            <SquarePen className="size-3.5" />
            {l("patients_edit_profile")}
          </Button>
        ) : null}
        {canManageDocuments ? (
          <Button
            size="sm"
            variant="outline"
            className="h-9 rounded-lg gap-1.5 px-3.5"
            onClick={openClinicalDocumentImport}
          >
            <FileUp className="size-3.5" />
            {getLang() === "de" ? "Scannen und erkennen" : "Сканировать и распознать"}
            {clinicalImportAttentionCount > 0 ? (
              <span className="flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold leading-5 text-amber-800">
                {clinicalImportAttentionCount}
              </span>
            ) : null}
          </Button>
        ) : null}
      </div>

      <Tabs value={activeTab} onValueChange={handleWorkspaceTabChange}>
        <div className="border-b border-slate-200 lg:hidden overflow-x-auto">
          <TabsList variant="line" className="min-w-max">
            {workspaceTabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} className="px-4 py-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabActionError || tabError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {tabActionError || tabError}
          </div>
        ) : null}

        <Suspense fallback={<TabLoader />}>
          {activeTab === "profile" ? (
            <div className="space-y-4">
              <PatientOverviewCard
                patientId={id ?? ""}
                allergies={detail.clinical_warnings ?? null}
                canViewClinical={canViewClinical}
                birthDate={detail.birth_date}
                gender={detail.gender}
                phone={detail.phone_primary}
                email={detail.email}
              />
              <LazyPatientProfileTab
              profileControls={{
                canCreateOrders,
                canCreateTasks,
                canEditPatientProfile,
                canExportPatientCompliance,
                canOpenComplianceWorkspace,
                canViewContracts,
                canViewDocuments,
                canViewInvoices,
              }}
              complianceExportBusy={complianceExportBusy}
              detail={detail}
              fieldValue={fieldValue}
              formatDate={formatDate}
              genderLabel={genderLabel}
              handleExportPatientCompliance={handleExportPatientCompliance}
              id={id}
              insuranceLabel={insuranceLabel}
              l={l}
              legalStatus={legalStatus}
              legalStatusChecklist={legalStatusChecklist}
              legalStatusCompletion={legalStatusCompletion}
              legalStatusSheetOpen={legalStatusSheetOpen}
              notesSheetOpen={notesSheetOpen}
              onLegalStatusSheetOpenChange={onLegalStatusSheetOpenChange}
              onNotesSheetOpenChange={onNotesSheetOpenChange}
              onOpenTab={handleWorkspaceTabChange}
              openProfileEditor={onOpenProfileEditor}
              patientDetailStatusLabel={patientDetailStatusLabel}
              reload={reload}
              staffGo={staffGo}
              t={t}
              tr={tr}
            />
            </div>
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

          {activeTab === "orders" ? (
            <LazyPatientOrdersTab
              emptyLabel={emptyOrdersLabel}
              formatDate={formatDate}
              onCreateOrder={canCreateOrders && id
                ? () => staffGo(buildPatientOrderCreateHref(id))
                : undefined}
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

          {activeTab === "clinical" && id ? (
            <LazyPatientClinicalTab
              patientId={id}
              patientIdentity={{
                firstName: detail.first_name,
                lastName: detail.last_name,
                birthDate: detail.birth_date,
                patientIdentifier: detail.patient_id,
              }}
              canManage={canManageDocuments}
              documentImportOpen={clinicalDocumentImportOpen}
              onDocumentImportOpenChange={setClinicalDocumentImportOpen}
            />
          ) : null}

          {activeTab === "documents" ? (
            <LazyPatientDocumentsTab
              l={l}
              patientId={id}
              patient={detail}
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
              documentCategoryOptions={documentCategoryOptions}
              documentStatusOptions={documentStatusOptions}
              hasDocumentFilters={hasDocumentFilters}
              documentStatusFilter={documentStatusFilter}
              documentCategoryFilter={documentCategoryFilter}
              onDocumentStatusFilterChange={onDocumentStatusFilterChange}
              onDocumentCategoryFilterChange={onDocumentCategoryFilterChange}
              onDocumentGenerated={onDocumentGenerated}
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
              patientId={detail.id}
              patientName={patientName(detail)}
              patientEmail={detail.email}
              assignments={assignments}
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

      {repeatIntakeOpen ? (
        <Suspense
          fallback={(
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-2">
              <div className="flex h-[90vh] w-full items-center justify-center rounded-lg border border-border bg-background shadow-xl sm:h-[min(88vh,52rem)] sm:w-[min(96vw,84rem)]">
                <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                  <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                  {lang === "de" ? "Anfrage wird geladen…" : "Загрузка обращения…"}
                </div>
              </div>
            </div>
          )}
        >
          <LazyLeadWizard
            leadId={repeatIntakeLeadId}
            open
            createMode={repeatIntakeLeadId === null}
            existingPatient={detail}
            onCreated={setRepeatIntakeLeadId}
            onOpenChange={(open) => {
              if (open) return;
              setRepeatIntakeOpen(false);
              setRepeatIntakeLeadId(null);
              reload();
            }}
            onArchived={() => {
              setRepeatIntakeOpen(false);
              setRepeatIntakeLeadId(null);
              reload();
            }}
            onShowDetails={(leadId) => staffGo(`/leads?lead=${encodeURIComponent(leadId)}`)}
            onConverted={() => {
              setRepeatIntakeOpen(false);
              setRepeatIntakeLeadId(null);
              reload();
            }}
            onOrderCreated={(orderId) => staffGo(`/orders/${orderId}`)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}

export function PatientDetailWorkspaceContent(...args: Parameters<typeof usePatientDetailWorkspaceContentContent>) {
  return usePatientDetailWorkspaceContentContent(...args);
}
