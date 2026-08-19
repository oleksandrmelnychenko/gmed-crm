import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  AdminSheetScaffold,
  AdminInlineMetric,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Banner,
  Field,
  PageHeader,
  Section as FormSection,
  StatusBadge,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import {
  agencyServiceDescriptionLabel,
  agencyServiceNameLabel,
  agencyServiceUnitLabel,
} from "@/lib/agency-service-labels";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabel,
  formatEnumLabelFromKeys,
  formatUnknownValue,
  formatUiText,
  type TranslationKey,
  type UiTextValues,
  useLang,
} from "@/lib/i18n";
import { localizeDocumentCode } from "@/lib/required-document-labels";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { localizeWorkflowItemText } from "@/lib/workflow-labels";
import {
  createOrderServiceGroup,
  fetchOrderServiceGroup,
  fetchOrderServiceGroupLinePreview,
  fetchOrderServiceGroups,
  generateServiceGroupLines,
  type CreateOrderServiceGroupInput,
  type OrderServiceGroup,
  type OrderServiceGroupLinePreview,
} from "@/lib/api/clinical";
import {
  orderPhaseTone,
  orderStatusTone,
  priorityBadgeClass,
  recheckBadgeClass,
  statusClassName,
} from "./appearance/status-appearance";
import {
  DEFAULT_ORDER_SECTION,
  type OrderSectionKey,
  normalizeOrderSectionKey,
} from "./sections";
import {
  isOrderReadinessGateApplicable,
  resolveOrderBlockingReason,
} from "./model/blocking-reasons";
import {
  approveOrderLeistung,
  completeWorkflowChecklistItem,
  createExternalInvoice,
  createOrder,
  createOrderLeistung,
  createWorkflowChecklistItem,
  fetchOrderDebtQueue,
  fetchOrderDirectory,
  fetchOrderWorkspace,
  fetchOrders,
  fetchPatientOrderRecheck,
  fetchProviderDoctors,
  updateExternalInvoice,
  updateOrderDebtManagement,
  updateOrderExecutionFlow,
  updateOrderFollowupFlow,
  updateOrderPhase,
  updateOrderStatus,
  updateOrderPlanningPreparation,
  updateOrderProcessGates,
} from "./data/order-api";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
import { doctorSpecialtyLabel } from "@/pages/providers/model/specialization-labels";
import { fetchAgencyServices } from "@/pages/contracts/data/contracts-api";
import type { AgencyServiceItem } from "@/pages/contracts/model/types";
import {
  DEFAULT_FILTERS,
  EXTERNAL_INVOICE_STATUSES,
  ORDER_PHASES,
  ORDER_STATUSES,
  blankCreateOrderForm,
  blankExternalInvoiceForm,
  blankLeistungForm,
  blankOrderExecutionForm,
  blankOrderFollowupForm,
  blankOrderPlanningForm,
  blankOrderProcessGateForm,
  blankWorkflowChecklistForm,
  formatCurrency,
  formatDate,
  formatDateOnly,
  formatDateTime,
  formatNumber,
  externalInvoiceStatusTransitions,
  inputDateTimeToApiValue,
  nextPhase,
  numberFromUnknown,
  optString,
  orderExecutionToForm,
  orderFollowupToForm,
  orderPermissions,
  orderPlanningToForm,
  orderProcessGatesToForm,
  patientLabel,
  recheckMissingFieldLabel,
  sumLeistungTotals,
  workflowChecklistLabel,
} from "./model/order-model";
import type {
  CreateOrderFormState,
  DoctorOption,
  ExternalInvoiceFormState,
  ExternalInvoicePaidBy,
  ExternalInvoiceStatus,
  LeistungBillingStatus,
  LeistungFormState,
  OrderDebtQueueItem,
  OrderDetail,
  OrderExecutionFormState,
  OrderFollowupFormState,
  OrderPlanningFormState,
  OrderProcessGateFormState,
  OrdersFilters,
  OrderSummary,
  PatientAssignmentOption,
  PatientOption,
  PatientOrderRecheck,
  ProviderOption,
  OrderStatus,
  SupportingDocumentOption,
  WorkflowChecklistItem,
  WorkflowChecklistFormState,
  WorkflowChecklistResponse,
} from "./model/types";
import { OrderAmendmentsPanel } from "./ui/order-amendments-panel";
import { OrderGroupPanel } from "./ui/order-group-panel";
import { ExternalInvoiceAllocationSheet } from "./ui/external-invoice-allocation-sheet";
import {
  OrderServiceGroupPanel,
  OrderServiceGroupWizard,
} from "./ui/order-service-group-panel";

const ORDER_REALTIME_EVENTS = [
  "order.created",
  "order.phase_changed",
  "order.status_changed",
  "order.process_gates_updated",
  "order.debt_management_updated",
  "order.planning_preparation_updated",
  "order.execution_flow_updated",
  "order.followup_flow_updated",
  "order.external_invoice_created",
  "order.external_invoice_updated",
  "order.external_invoice_overdue",
  "order.external_invoice_allocation_created",
  "order.external_invoice_allocation_reversed",
  "order.leistung_added",
  "order.leistung_approved",
  "invoice.created",
  "invoice.status_changed",
  "invoice.prepayment_applied",
  "invoice.prepayment_released",
  "task.created",
  "task.status_changed",
  "workflow_checklist_item.created",
  "workflow_checklist_item.completed",
] as const;

type SectionCardProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

const inputClassName = shellInputClassName;
const selectClassName = shellSelectClassName;
const textareaClassName = shellTextareaClass;
const ORDER_DEFAULT_FROZEN_COLUMNS = ["order_number", "patient"];
const ORDER_MAX_FROZEN_COLUMNS = 3;
const ORDER_PAGE_SIZE = 50;
const ORDER_TASK_STATUS_LABEL_KEYS = {
  open: "orders_task_status_open",
  in_progress: "orders_task_status_in_progress",
  completed: "orders_task_status_completed",
  done: "orders_task_status_completed",
  cancelled: "orders_task_status_cancelled",
} satisfies Partial<Record<string, TranslationKey>>;

function SectionCard({
  title,
  description,
  action,
  children,
  className,
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border/70 bg-card p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-start 2xl:justify-between">
        <div>
          <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
          {description ? (
            <p className={cn(tokens.text.muted, "mt-1")}>{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function OrderSheetSection({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/70 bg-card p-6">
      <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function OrderSummaryLine({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-lg py-2", className)}>
      <span className="min-w-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-4 flex-1 bg-border/70" />
      <span className="min-w-0 max-w-[50%] break-words text-right text-sm font-semibold leading-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function MiniMetric({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[210px] flex-1 items-center justify-between gap-3 rounded-full border border-border bg-muted/20 px-4 py-2",
        className,
      )}
    >
      <span className="min-w-0 break-words text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 max-w-[55%] break-words text-right text-sm font-semibold leading-snug text-foreground">
        {value}
      </span>
    </div>
  );
}

function orderAccentClass(phase: string, status: string) {
  if (status === "completed") return "bg-emerald-500";
  if (status === "cancelled") return "bg-rose-500";
  if (status === "paused") return "bg-amber-500";
  if (phase === "execution" || phase === "closure") return "bg-sky-500";
  return "bg-orange-500";
}

function leistungBillingStatusClass(status: LeistungBillingStatus) {
  switch (status) {
    case "paid":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "partially_paid":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "awaiting_payment":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "partially_invoiced":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "not_invoiced":
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <div className="rounded-lg border border-border/70 bg-card p-3 text-muted-foreground">
          <ClipboardList className="size-5" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

function OrdersPager({
  pageIndex,
  totalPages,
  totalRows,
  previousLabel,
  nextLabel,
  onPageChange,
}: {
  nextLabel: string;
  onPageChange: (pageIndex: number) => void;
  pageIndex: number;
  previousLabel: string;
  totalPages: number;
  totalRows: number;
}) {
  const pageStart = pageIndex * ORDER_PAGE_SIZE;
  return (
    <div className="flex min-h-8 items-center justify-between gap-2 border-b border-border/60 bg-field px-4 py-0.5">
      <span className="font-mono text-xs tabular-nums text-foreground">
        {totalRows === 0
          ? "0 / 0"
          : `${pageStart + 1}-${Math.min(pageStart + ORDER_PAGE_SIZE, totalRows)} / ${totalRows}`}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={pageIndex === 0}
          aria-label={previousLabel}
          title={previousLabel}
          onClick={() => onPageChange(Math.max(0, pageIndex - 1))}
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="min-w-12 text-center font-mono text-xs font-medium tabular-nums text-foreground">
          {pageIndex + 1} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          className="size-7 rounded-md"
          disabled={pageIndex >= totalPages - 1}
          aria-label={nextLabel}
          title={nextLabel}
          onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1))}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-2 rounded-full bg-amber-500" />
      <span>{title}</span>
    </span>
  );
}

function providerTaxonomyLabel(
  item: {
    provider_taxonomy_node_code?: string | null;
    provider_taxonomy_node_name_de?: string | null;
    provider_taxonomy_node_name_ru?: string | null;
  },
  lang: string,
) {
  if (lang === "ru") {
    return (
      item.provider_taxonomy_node_name_ru ||
      item.provider_taxonomy_node_name_de ||
      item.provider_taxonomy_node_code ||
      ""
    );
  }
  return (
    item.provider_taxonomy_node_name_de ||
    item.provider_taxonomy_node_name_ru ||
    item.provider_taxonomy_node_code ||
    ""
  );
}

function orderBlockingReasonSection(reason: string): OrderSectionKey {
  if (
    reason === "Treatment plan must be finalized before execution" ||
    reason === "At least one confirmed medical appointment is required" ||
    reason === "Required non-medical services still need a confirmed booking" ||
    reason === "Interpreter is required but not assigned yet" ||
    reason === "Assigned interpreter has not confirmed yet" ||
    reason === "Interpreter briefing is still pending" ||
    reason === "Preparation documents still need to be sent" ||
    /required patient document\(s\) are missing$/.test(reason)
  ) {
    return "planning";
  }

  if (
    reason === "Patient arrival or execution start is not recorded yet" ||
    reason === "Medical execution must be completed and backed by delivered appointments or services" ||
    reason === "Required non-medical services still need execution confirmation" ||
    reason === "Interpreter-supported execution still needs completion or report confirmation" ||
    reason === "Execution deviations or incidents must be resolved or marked as not required" ||
    reason === "Results, Arztbrief or final patient handoff still need to be released" ||
    /execution checklist item\(s\) remain open$/.test(reason)
  ) {
    return "execution";
  }

  if (
    reason === "Doctor-directed follow-up is required but not scheduled yet" ||
    reason === "1-week follow-up is not scheduled yet" ||
    reason === "1-month follow-up is not scheduled yet" ||
    reason === "6-month follow-up is not scheduled yet" ||
    reason === "Package-end follow-up is required but not scheduled yet" ||
    reason === "No follow-up reminder, task or appointment has been launched yet"
  ) {
    return "followup";
  }

  return "gates";
}

type OrdersPageState = {
  filters: OrdersFilters;
  orders: OrderSummary[];
  loading: boolean;
  listError: string | null;
  reloadNonce: number;
  patients: PatientOption[];
  providers: ProviderOption[];
  taxonomyNodes: ProviderTaxonomyNode[];
  providerDoctors: Record<string, DoctorOption[]>;
  orderDocuments: SupportingDocumentOption[];
  selectedOrderId: string | null;
  orderDetail: OrderDetail | null;
  orderServiceGroups: OrderServiceGroup[];
  serviceGroupPreviews: Record<string, OrderServiceGroupLinePreview>;
  serviceGroupsLoading: boolean;
  serviceGroupsError: string | null;
  serviceGroupWizardError: string | null;
  serviceGroupWizardOpen: boolean;
  serviceGroupCreating: boolean;
  generatingServiceGroupId: string | null;
  workflowChecklist: WorkflowChecklistResponse | null;
  workflowAssignments: PatientAssignmentOption[];
  detailLoading: boolean;
  detailError: string | null;
  phaseDraft: string;
  phaseSaving: boolean;
  phaseError: string | null;
  approvingLeistungId: string | null;
  workflowBusy: boolean;
  workflowCreateOpen: boolean;
  workflowForm: WorkflowChecklistFormState;
  processGateBusy: boolean;
  processGateError: string | null;
  processGateForm: OrderProcessGateFormState;
  debtQueue: OrderDebtQueueItem[];
  debtQueueLoading: boolean;
  debtQueueError: string | null;
  planningBusy: boolean;
  planningError: string | null;
  planningForm: OrderPlanningFormState;
  executionBusy: boolean;
  executionError: string | null;
  executionForm: OrderExecutionFormState;
  followupBusy: boolean;
  followupError: string | null;
  followupForm: OrderFollowupFormState;
  createOpen: boolean;
  createForm: CreateOrderFormState;
  createSaving: boolean;
  createError: string | null;
  createRecheck: PatientOrderRecheck | null;
  createRecheckLoading: boolean;
  createRecheckError: string | null;
  leistungOpen: boolean;
  leistungForm: LeistungFormState;
  leistungSaving: boolean;
  leistungError: string | null;
  externalInvoiceOpen: boolean;
  externalInvoiceForm: ExternalInvoiceFormState;
  externalInvoiceSaving: boolean;
  externalInvoiceError: string | null;
  externalInvoiceUpdatingId: string | null;
};

type OrdersPagePatch =
  | Partial<OrdersPageState>
  | ((current: OrdersPageState) => Partial<OrdersPageState>);

function ordersPageReducer(
  current: OrdersPageState,
  patch: OrdersPagePatch,
): OrdersPageState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveOrdersPageStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createOrdersPageFieldPatch<K extends keyof OrdersPageState>(
  field: K,
  nextValue: SetStateAction<OrdersPageState[K]>,
): OrdersPagePatch {
  return (current) => ({
    [field]: resolveOrdersPageStateAction(nextValue, current[field]),
  } as Partial<OrdersPageState>);
}

function useOrdersPageContent() {
  const { t, lang } = useLang();
  const tx = t as unknown as Record<string, string>;
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const { orderId: routeOrderIdParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeOrderId = routeOrderIdParam ?? "";
  const isOrderRouteDetail = routeOrderId !== "";
  const patientContextId = searchParams.get("patient") ?? "";
  const activeOrderSection = normalizeOrderSectionKey(searchParams.get("section"));
  const permissions = orderPermissions(user?.role);
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const l = useCallback(
    (key: string, values?: UiTextValues) =>
      formatUiText(t.uiText[key] ?? key, values),
    [t],
  );
  const lWorkflow = useCallback(
    (key: string) => t.uiText[key] ?? key,
    [t],
  );
  const orderColumnGroupLabels = useMemo(
    () => ({
      identity: t.operations_column_group_identity,
      workflow: t.operations_column_group_workflow,
      finance: t.operations_column_group_finance,
      audit: t.operations_column_group_audit,
    }),
    [t],
  );
  const workflowTaskStatusLabel = useCallback(
    (status: string | null | undefined) =>
      formatEnumLabelFromKeys(status, ORDER_TASK_STATUS_LABEL_KEYS, t),
    [t],
  );
  const normalizeLeistungDescription = useCallback(
    (value: string) =>
      value === "Discovery and provider shortlist"
        ? l("orders_bedarfsklarung")
        : value,
    [l],
  );
  const phaseLabels = useMemo(
    () => ({
      discovery: l("orders_bedarfsklarung"),
      intake: l("orders_aufnahme"),
      execution: l("orders_durchfuhrung"),
      closure: l("orders_abschluss"),
      followup: l("orders_nachsorge"),
    }),
    [l],
  );
  const workflowGroupLabels = useMemo(
    () => ({
      ...phaseLabels,
      custom: l("orders_individuell"),
    }),
    [l, phaseLabels],
  );
  const orderStatusLabels = useMemo(
    () => ({
      active: l("orders_aktiv"),
      paused: l("orders_pausiert"),
      completed: l("orders_abgeschlossen"),
      cancelled: l("orders_storniert"),
    }),
    [l],
  );
  const frameworkContractStatusLabels = useMemo(
    () => ({
      draft: l("orders_entwurf"),
      sent: l("orders_versendet"),
      signed: l("orders_unterzeichnet"),
      expired: l("orders_abgelaufen"),
      terminated: l("orders_beendet"),
    }),
    [l],
  );
  const debtStatusLabels = useMemo(
    () => ({
      review_required: l("orders_review_erforderlich"),
      payment_plan: l("orders_zahlungsplan"),
      awaiting_payment: l("orders_zahlung_ausstehend"),
      escalated: l("orders_eskaliert"),
      cleared: l("orders_geklart"),
      not_required: l("orders_nicht_erforderlich"),
    }),
    [l],
  );
  const billingReleaseLabels = useMemo(
    () => ({
      pending: l("orders_ausstehend"),
      granted: l("orders_freigegeben"),
      denied: l("orders_abgelehnt"),
    }),
    [l],
  );
  const packageCoverageLabels = useMemo(
    () => ({
      unknown: l("orders_unbekannt"),
      covered: l("orders_abgedeckt"),
      not_covered: l("orders_nicht_abgedeckt"),
    }),
    [l],
  );
  const roleLabels = useMemo(
    () => ({
      ceo: "CEO",
      ceo_assistant: l("orders_ceo_assistenz"),
      admin: l("orders_admin"),
      assistant: l("orders_ceo_assistenz"),
      patient_manager: l("orders_patientenmanagement"),
      billing: l("orders_billing"),
      sales: l("orders_vertrieb"),
      it_admin: l("orders_it_admin"),
      patient: l("orders_patient"),
      concierge: l("orders_concierge"),
      interpreter: l("orders_dolmetscher"),
      teamlead_interpreter: l("orders_dolmetscher_teamlead"),
      debt_owner: l("orders_debt_owner"),
    }),
    [l],
  );
  const labelFor = (
    value: string | null | undefined,
    labels: Partial<Record<string, string>>,
  ) => formatEnumLabel(value, labels, t);
  const formatMoney = (value: unknown, currency = "EUR") =>
    formatCurrency(value, currency, locale);
  const formatDateLabel = (value: string | null | undefined) =>
    formatDate(value, locale, l("orders_nicht_festgelegt"));
  const formatDateTimeLabel = (value: string | null | undefined) =>
    formatDateTime(value, locale, l("orders_nicht_festgelegt"));
  const formatDateOnlyLabel = (value: string | null | undefined) =>
    formatDateOnly(value, locale, l("orders_nicht_festgelegt"));
  const phaseLabel = (value: string) => labelFor(value, phaseLabels);
  const orderStatusLabel = (value: string) => labelFor(value, orderStatusLabels);
  const frameworkContractStatusLabel = (value: string) =>
    labelFor(value, frameworkContractStatusLabels);
  const debtStatusLabel = (value: string) => labelFor(value, debtStatusLabels);
  const billingReleaseLabel = (value: string) =>
    labelFor(value, billingReleaseLabels);
  const packageCoverageLabel = (value: string) =>
    labelFor(value, packageCoverageLabels);
  const leistungStatusLabel = (value: string) =>
    labelFor(value, {
      planned: l("orders_geplant"),
      delivered: l("orders_erbracht"),
      approved: l("orders_freigegeben_2"),
      invoiced: lang === "de" ? "Abgerechnet" : "Выставлен счёт",
    });
  const leistungBillingStatusLabel = (value: LeistungBillingStatus) =>
    labelFor(value, {
      not_invoiced: lang === "de" ? "Noch nicht abgerechnet" : "Счёт не выставлен",
      partially_invoiced:
        lang === "de" ? "Teilweise abgerechnet" : "Частично выставлено",
      awaiting_payment:
        lang === "de" ? "Zahlung ausstehend" : "Ожидает оплаты",
      partially_paid: lang === "de" ? "Teilweise bezahlt" : "Частично оплачено",
      paid: lang === "de" ? "Vollständig bezahlt" : "Полностью оплачено",
    });
  const externalInvoiceStatusLabel = (value: string) =>
    labelFor(value, {
      expected: l("orders_erwartet"),
      received: l("orders_eingegangen"),
      approved: l("orders_freigegeben_3"),
      paid: l("orders_bezahlt"),
      overdue: l("orders_uberfallig"),
      cancelled: l("orders_storniert"),
    });
  const treatmentPlanStatusLabel = (value: string) =>
    labelFor(value, {
      draft: l("orders_entwurf"),
      agreed: l("orders_abgestimmt"),
      correction_requested: l("orders_korrektur_angefragt"),
      finalized: l("orders_finalisiert"),
    });
  const preparationDocumentStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("orders_dokumente_ausstehend"),
      sent: l("orders_dokumente_versendet"),
      not_required: l("orders_dokumente_nicht_erforderlich"),
    });
  const interpreterBriefingStatusLabel = (value: string) =>
    labelFor(value, {
      not_needed: l("orders_nicht_erforderlich"),
      pending: l("orders_briefing_ausstehend"),
      completed: l("orders_briefing_abgeschlossen"),
    });
  const arrivalStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("orders_ankunft_ausstehend"),
      arrived: l("orders_angekommen"),
      not_required: l("orders_nicht_erforderlich"),
    });
  const executionStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("orders_ausstehend"),
      in_progress: l("orders_in_bearbeitung"),
      completed: l("orders_abgeschlossen_2"),
      not_required: l("orders_nicht_erforderlich"),
    });
  const issueStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("orders_offene_punkte"),
      monitoring: l("orders_unter_beobachtung"),
      resolved: l("orders_geklart_2"),
      not_required: l("orders_keine_punkte"),
    });
  const followupStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("orders_ausstehend"),
      scheduled: l("orders_geplant"),
      completed: l("orders_abgeschlossen_2"),
      not_required: l("orders_nicht_erforderlich"),
    });
  const resultsHandoffStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("orders_ausstehend"),
      completed: l("orders_abgeschlossen_2"),
      not_required: l("orders_nicht_erforderlich"),
    });
  const priorityLabel = (value: string) =>
    labelFor(value, {
      low: l("orders_niedrig"),
      normal: l("orders_normal"),
      high: l("orders_hoch"),
      urgent: l("orders_dringend"),
    });
  const transitionKindLabel = (value: string) =>
    labelFor(value, {
      created: l("orders_erstellt"),
      phase_change: l("orders_phasenwechsel"),
    });
  const roleLabel = (value: string) => labelFor(value, roleLabels);
  const debtBlockingReasonLabel = (status: string, overdueInvoiceCount: number) => {
    if (overdueInvoiceCount > 0) {
      const key =
        status === "payment_plan"
          ? "orders_debt_reason_payment_plan_overdue"
          : status === "awaiting_payment"
            ? "orders_debt_reason_awaiting_payment_overdue"
            : status === "escalated"
              ? "orders_debt_reason_escalated_overdue"
              : "orders_debt_reason_review_overdue";
      return l(key, { count: overdueInvoiceCount });
    }

    const key =
      status === "payment_plan"
        ? "orders_debt_reason_payment_plan_open"
        : status === "awaiting_payment"
          ? "orders_debt_reason_awaiting_payment_open"
          : status === "escalated"
            ? "orders_debt_reason_escalated_open"
            : "orders_debt_reason_review_open";
    return l(key);
  };
  const localizedBlockingReason = (reason: string) => {
    const completionLabels: Record<string, [string, string]> = {
      "Order must reach the follow-up phase before completion": [
        "Der Auftrag muss vor dem Abschluss die Nachsorgephase erreichen.",
        "Перед завершением заказ должен перейти в этап наблюдения.",
      ],
      "Follow-up state has not been prepared": [
        "Die Nachsorge wurde noch nicht vorbereitet.",
        "Этап наблюдения ещё не подготовлен.",
      ],
      "Doctor follow-up must be completed or marked not required": [
        "Die ärztliche Nachsorge muss abgeschlossen oder als nicht erforderlich markiert sein.",
        "Врачебное наблюдение нужно завершить или отметить как необязательное.",
      ],
      "1-week follow-up must be completed or marked not required": [
        "Die 1-Wochen-Nachsorge muss abgeschlossen oder als nicht erforderlich markiert sein.",
        "Наблюдение через неделю нужно завершить или отметить как необязательное.",
      ],
      "1-month follow-up must be completed or marked not required": [
        "Die 1-Monats-Nachsorge muss abgeschlossen oder als nicht erforderlich markiert sein.",
        "Наблюдение через месяц нужно завершить или отметить как необязательное.",
      ],
      "6-month follow-up must be completed or marked not required": [
        "Die 6-Monats-Nachsorge muss abgeschlossen oder als nicht erforderlich markiert sein.",
        "Наблюдение через шесть месяцев нужно завершить или отметить как необязательное.",
      ],
      "Package-end follow-up must be completed or marked not required": [
        "Die Nachsorge zum Paketende muss abgeschlossen oder als nicht erforderlich markiert sein.",
        "Наблюдение по окончании пакета нужно завершить или отметить как необязательное.",
      ],
      "Results handoff must be completed or marked not required": [
        "Die Ergebnisübergabe muss abgeschlossen oder als nicht erforderlich markiert sein.",
        "Передачу результатов нужно завершить или отметить как необязательную.",
      ],
    };
    const completionLabel = completionLabels[reason];
    if (completionLabel) return lang === "de" ? completionLabel[0] : completionLabel[1];
    const openWorkflowItems = reason.match(
      /^(\d+) workflow checklist item\(s\) are still open$/,
    );
    if (openWorkflowItems) {
      return lang === "de"
        ? `${openWorkflowItems[1]} Workflow-Punkt(e) sind noch offen.`
        : `В чеклисте ещё открыто пунктов: ${openWorkflowItems[1]}.`;
    }
    const unsettledServices = reason.match(
      /^(\d+) service item\(s\) are not approved or invoiced$/,
    );
    if (unsettledServices) {
      return lang === "de"
        ? `${unsettledServices[1]} Leistung(en) sind noch nicht freigegeben oder abgerechnet.`
        : `Не согласовано или не выставлено в счёт услуг: ${unsettledServices[1]}.`;
    }
    const translation = resolveOrderBlockingReason(reason);
    if (translation) return l(translation.key, translation.values);
    return formatUnknownValue(reason, t);
  };

  const [ordersPageState, dispatchOrdersPageState] = useReducer(
    ordersPageReducer,
    undefined,
    (): OrdersPageState => ({
      filters: DEFAULT_FILTERS,
      orders: [],
      loading: true,
      listError: null,
      reloadNonce: 0,
      patients: [],
      providers: [],
      taxonomyNodes: [],
      providerDoctors: {},
      orderDocuments: [],
      selectedOrderId: routeOrderId || null,
      orderDetail: null,
      orderServiceGroups: [],
      serviceGroupPreviews: {},
      serviceGroupsLoading: false,
      serviceGroupsError: null,
      serviceGroupWizardError: null,
      serviceGroupWizardOpen: false,
      serviceGroupCreating: false,
      generatingServiceGroupId: null,
      workflowChecklist: null,
      workflowAssignments: [],
      detailLoading: false,
      detailError: null,
      phaseDraft: "",
      phaseSaving: false,
      phaseError: null,
      approvingLeistungId: null,
      workflowBusy: false,
      workflowCreateOpen: false,
      workflowForm: blankWorkflowChecklistForm(),
      processGateBusy: false,
      processGateError: null,
      processGateForm: blankOrderProcessGateForm(),
      debtQueue: [],
      debtQueueLoading: false,
      debtQueueError: null,
      planningBusy: false,
      planningError: null,
      planningForm: blankOrderPlanningForm(),
      executionBusy: false,
      executionError: null,
      executionForm: blankOrderExecutionForm(),
      followupBusy: false,
      followupError: null,
      followupForm: blankOrderFollowupForm(),
      createOpen: false,
      createForm: blankCreateOrderForm(),
      createSaving: false,
      createError: null,
      createRecheck: null,
      createRecheckLoading: false,
      createRecheckError: null,
      leistungOpen: false,
      leistungForm: blankLeistungForm(),
      leistungSaving: false,
      leistungError: null,
      externalInvoiceOpen: false,
      externalInvoiceForm: blankExternalInvoiceForm(),
      externalInvoiceSaving: false,
      externalInvoiceError: null,
      externalInvoiceUpdatingId: null,
    }),
  );
  const {
    approvingLeistungId,
    createError,
    createForm,
    createOpen,
    createRecheck,
    createRecheckError,
    createRecheckLoading,
    createSaving,
    debtQueue,
    debtQueueError,
    debtQueueLoading,
    detailError,
    detailLoading,
    executionBusy,
    executionError,
    executionForm,
    externalInvoiceError,
    externalInvoiceForm,
    externalInvoiceOpen,
    externalInvoiceSaving,
    externalInvoiceUpdatingId,
    filters,
    followupBusy,
    followupError,
    followupForm,
    generatingServiceGroupId,
    leistungError,
    leistungForm,
    leistungOpen,
    leistungSaving,
    listError,
    loading,
    orderDetail,
    orderDocuments,
    orderServiceGroups,
    orders,
    patients,
    taxonomyNodes,
    phaseDraft,
    phaseError,
    phaseSaving,
    planningBusy,
    planningError,
    planningForm,
    processGateBusy,
    processGateError,
    processGateForm,
    providerDoctors,
    providers,
    reloadNonce,
    selectedOrderId,
    serviceGroupCreating,
    serviceGroupPreviews,
    serviceGroupsError,
    serviceGroupsLoading,
    serviceGroupWizardError,
    serviceGroupWizardOpen,
    workflowAssignments,
    workflowBusy,
    workflowChecklist,
    workflowCreateOpen,
    workflowForm,
  } = ordersPageState;
  const [statusSaving, setStatusSaving] = useState<OrderStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [debtManagementSheetOpen, setDebtManagementSheetOpen] = useState(false);
  const [externalInvoiceAllocationId, setExternalInvoiceAllocationId] = useState<string | null>(null);
  const [agencyServices, setAgencyServices] = useState<AgencyServiceItem[]>([]);
  const [agencyServicesLoaded, setAgencyServicesLoaded] = useState(false);
  const setOrdersPageField = <K extends keyof OrdersPageState>(
    field: K,
    nextValue: SetStateAction<OrdersPageState[K]>,
  ) => dispatchOrdersPageState(createOrdersPageFieldPatch(field, nextValue));
  const setFilters = (nextValue: SetStateAction<OrdersFilters>) =>
    setOrdersPageField("filters", nextValue);
  const deferredSearch = useDeferredValue(filters.search);
  const orderPaginationResetKey = JSON.stringify(filters);
  const [orderPaginationState, setOrderPaginationState] = useState(() => ({
    pageIndex: 0,
    resetKey: orderPaginationResetKey,
  }));
  const orderPageIndex =
    orderPaginationState.resetKey === orderPaginationResetKey
      ? orderPaginationState.pageIndex
      : 0;
  const orderTotalPages = Math.max(1, Math.ceil(orders.length / ORDER_PAGE_SIZE));
  const safeOrderPageIndex = Math.min(orderPageIndex, orderTotalPages - 1);
  const orderPageStart = safeOrderPageIndex * ORDER_PAGE_SIZE;
  const pagedOrders = useMemo(
    () => orders.slice(orderPageStart, orderPageStart + ORDER_PAGE_SIZE),
    [orderPageStart, orders],
  );
  const handleOrderPageChange = (nextPageIndex: number) => {
    setOrderPaginationState({
      pageIndex: nextPageIndex,
      resetKey: orderPaginationResetKey,
    });
  };
  const setOrders = (nextValue: SetStateAction<OrderSummary[]>) =>
    setOrdersPageField("orders", nextValue);
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("loading", nextValue);
  const setListError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("listError", nextValue);
  const setReloadNonce = (nextValue: SetStateAction<number>) =>
    setOrdersPageField("reloadNonce", nextValue);
  const setPatients = (nextValue: SetStateAction<PatientOption[]>) =>
    setOrdersPageField("patients", nextValue);
  const setProviders = (nextValue: SetStateAction<ProviderOption[]>) =>
    setOrdersPageField("providers", nextValue);
  const setTaxonomyNodes = (nextValue: SetStateAction<ProviderTaxonomyNode[]>) =>
    setOrdersPageField("taxonomyNodes", nextValue);
  const setProviderDoctors = (
    nextValue: SetStateAction<Record<string, DoctorOption[]>>,
  ) => setOrdersPageField("providerDoctors", nextValue);
  const setOrderDocuments = (
    nextValue: SetStateAction<SupportingDocumentOption[]>,
  ) => setOrdersPageField("orderDocuments", nextValue);
  const setSelectedOrderId = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("selectedOrderId", nextValue);
  const setOrderDetail = (nextValue: SetStateAction<OrderDetail | null>) =>
    setOrdersPageField("orderDetail", nextValue);
  const setOrderServiceGroups = (
    nextValue: SetStateAction<OrderServiceGroup[]>,
  ) => setOrdersPageField("orderServiceGroups", nextValue);
  const setServiceGroupPreviews = (
    nextValue: SetStateAction<Record<string, OrderServiceGroupLinePreview>>,
  ) => setOrdersPageField("serviceGroupPreviews", nextValue);
  const setServiceGroupsLoading = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("serviceGroupsLoading", nextValue);
  const setServiceGroupsError = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("serviceGroupsError", nextValue);
  const setServiceGroupWizardError = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("serviceGroupWizardError", nextValue);
  const setServiceGroupWizardOpen = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("serviceGroupWizardOpen", nextValue);
  const setServiceGroupCreating = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("serviceGroupCreating", nextValue);
  const setGeneratingServiceGroupId = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("generatingServiceGroupId", nextValue);
  const setWorkflowChecklist = (
    nextValue: SetStateAction<WorkflowChecklistResponse | null>,
  ) => setOrdersPageField("workflowChecklist", nextValue);
  const setWorkflowAssignments = (
    nextValue: SetStateAction<PatientAssignmentOption[]>,
  ) => setOrdersPageField("workflowAssignments", nextValue);
  const setDetailLoading = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("detailLoading", nextValue);
  const setDetailError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("detailError", nextValue);
  const setPhaseDraft = (nextValue: SetStateAction<string>) =>
    setOrdersPageField("phaseDraft", nextValue);
  const setPhaseSaving = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("phaseSaving", nextValue);
  const setPhaseError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("phaseError", nextValue);
  const setApprovingLeistungId = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("approvingLeistungId", nextValue);
  const setWorkflowBusy = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("workflowBusy", nextValue);
  const setWorkflowCreateOpen = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("workflowCreateOpen", nextValue);
  const setWorkflowForm = (
    nextValue: SetStateAction<WorkflowChecklistFormState>,
  ) => setOrdersPageField("workflowForm", nextValue);
  const setProcessGateBusy = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("processGateBusy", nextValue);
  const setProcessGateError = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("processGateError", nextValue);
  const setProcessGateForm = (
    nextValue: SetStateAction<OrderProcessGateFormState>,
  ) => setOrdersPageField("processGateForm", nextValue);
  const setDebtQueue = (nextValue: SetStateAction<OrderDebtQueueItem[]>) =>
    setOrdersPageField("debtQueue", nextValue);
  const setDebtQueueLoading = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("debtQueueLoading", nextValue);
  const setDebtQueueError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("debtQueueError", nextValue);
  const setPlanningBusy = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("planningBusy", nextValue);
  const setPlanningError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("planningError", nextValue);
  const setPlanningForm = (
    nextValue: SetStateAction<OrderPlanningFormState>,
  ) => setOrdersPageField("planningForm", nextValue);
  const setExecutionBusy = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("executionBusy", nextValue);
  const setExecutionError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("executionError", nextValue);
  const setExecutionForm = (
    nextValue: SetStateAction<OrderExecutionFormState>,
  ) => setOrdersPageField("executionForm", nextValue);
  const setFollowupBusy = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("followupBusy", nextValue);
  const setFollowupError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("followupError", nextValue);
  const setFollowupForm = (
    nextValue: SetStateAction<OrderFollowupFormState>,
  ) => setOrdersPageField("followupForm", nextValue);
  const setCreateOpen = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("createOpen", nextValue);
  const setCreateForm = (nextValue: SetStateAction<CreateOrderFormState>) =>
    setOrdersPageField("createForm", nextValue);
  const setCreateSaving = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("createSaving", nextValue);
  const setCreateError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("createError", nextValue);
  const setCreateRecheck = (
    nextValue: SetStateAction<PatientOrderRecheck | null>,
  ) => setOrdersPageField("createRecheck", nextValue);
  const setCreateRecheckLoading = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("createRecheckLoading", nextValue);
  const setCreateRecheckError = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("createRecheckError", nextValue);
  const setLeistungOpen = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("leistungOpen", nextValue);
  const setLeistungForm = (nextValue: SetStateAction<LeistungFormState>) =>
    setOrdersPageField("leistungForm", nextValue);
  const setLeistungSaving = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("leistungSaving", nextValue);
  const setLeistungError = (nextValue: SetStateAction<string | null>) =>
    setOrdersPageField("leistungError", nextValue);
  const setExternalInvoiceOpen = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("externalInvoiceOpen", nextValue);
  const setExternalInvoiceForm = (
    nextValue: SetStateAction<ExternalInvoiceFormState>,
  ) => setOrdersPageField("externalInvoiceForm", nextValue);
  const setExternalInvoiceSaving = (nextValue: SetStateAction<boolean>) =>
    setOrdersPageField("externalInvoiceSaving", nextValue);
  const setExternalInvoiceError = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("externalInvoiceError", nextValue);
  const setExternalInvoiceUpdatingId = (
    nextValue: SetStateAction<string | null>,
  ) => setOrdersPageField("externalInvoiceUpdatingId", nextValue);

  const filterDoctorOptions = useMemo(
    () =>
      filters.providerId ? (providerDoctors[filters.providerId] ?? []) : [],
    [filters.providerId, providerDoctors],
  );
  const leistungDoctorOptions = useMemo(
    () =>
      leistungForm.providerId
        ? (providerDoctors[leistungForm.providerId] ?? [])
        : [],
    [leistungForm.providerId, providerDoctors],
  );
  const supportingDocumentOptions = useMemo(
    () =>
      orderDocuments.filter(
        (document) =>
          document.order_id === selectedOrderId &&
          document.has_stored_file !== false &&
          !document.file_deleted_at,
      ),
    [orderDocuments, selectedOrderId],
  );
  const requestedAgencyServiceId = searchParams.get("service") ?? "";
  const pendingCreateAgencyService = requestedAgencyServiceId
    ? agencyServices.find((item) => item.id === requestedAgencyServiceId) ?? null
    : null;

  const orderTableColumns: ColumnDef<OrderSummary>[] = [
    {
      id: "order_number",
      label: l("orders_auftrag"),
      accessor: (row) => row.order_number,
      filterType: "text",
      group: "identity",
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 160,
      render: (row) => (
        <span className="font-mono text-xs tracking-[0.12em] text-foreground">
          {row.order_number}
        </span>
      ),
    },
    {
      id: "patient",
      label: t.orders_patient,
      accessor: (row) => row.patient_name,
      filterType: "text",
      group: "identity",
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 220,
      render: (row) => (
        <span className="truncate font-mono text-xs text-foreground">
          {row.patient_name}
        </span>
      ),
    },
    {
      id: "total_estimated",
      label: l("orders_geschaftsvolumen"),
      accessor: (row) => numberFromUnknown(row.total_estimated) ?? 0,
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="block text-right font-mono text-xs tabular-nums text-foreground">
          {formatMoney(row.total_estimated)}
        </span>
      ),
    },
    {
      id: "phase",
      label: t.orders_phase,
      accessor: (row) => phaseLabel(row.phase),
      filterType: "enum",
      filterOptions: ORDER_PHASES.map((phase) => ({
        value: phase,
        label: phaseLabel(phase),
      })),
      group: "workflow",
      sortable: true,
      width: 170,
      render: (row) => (
        <StatusBadge tone={orderPhaseTone(row.phase)}>
          {phaseLabel(row.phase)}
        </StatusBadge>
      ),
    },
    {
      id: "status",
      label: t.users_status,
      accessor: (row) => orderStatusLabel(row.status),
      filterType: "enum",
      filterOptions: ORDER_STATUSES.map((status) => ({
        value: status,
        label: orderStatusLabel(status),
      })),
      group: "workflow",
      sortable: true,
      width: 150,
      render: (row) => (
        <StatusBadge tone={orderStatusTone(row.status)}>
          {orderStatusLabel(row.status)}
        </StatusBadge>
      ),
    },
    {
      id: "created_at",
      label: l("orders_erstellt"),
      accessor: (row) => row.created_at,
      filterType: "date",
      group: "audit",
      sortable: true,
      width: 160,
      render: (row) => (
        <span className="text-xs text-foreground">
          {formatDateOnlyLabel(row.created_at)}
        </span>
      ),
    },
  ];

  const leistungMetrics = useMemo(() => {
    const items = orderDetail?.leistungen ?? [];
    return {
      total: items.length,
      delivered: items.filter((item) => item.status === "delivered").length,
      approved: items.filter((item) =>
        item.status === "approved" || item.status === "invoiced"
      ).length,
      net: sumLeistungTotals(items),
    };
  }, [orderDetail]);
  const serviceGroupMetrics = useMemo(
    () => ({
      total: orderServiceGroups.length,
      participants: orderServiceGroups.reduce(
        (sum, group) => sum + (group.participants?.length ?? 0),
        0,
      ),
      generated: orderServiceGroups.reduce(
        (sum, group) => sum + (group.generated_line_count ?? 0),
        0,
      ),
    }),
    [orderServiceGroups],
  );
  const externalInvoiceMetrics = useMemo(() => {
    const items = orderDetail?.external_invoices ?? [];
    return {
      total: items.length,
      overdue: items.filter((item) => item.status === "overdue").length,
      paid: items.filter((item) => item.status === "paid").length,
      gross: items.reduce(
        (sum, item) => sum + (numberFromUnknown(item.amount_gross) ?? 0),
        0,
      ),
      receivable: items.reduce(
        (sum, item) =>
          sum + (numberFromUnknown(item.remaining_receivable_gross) ?? 0),
        0,
      ),
      allocated: items.reduce(
        (sum, item) =>
          sum + (numberFromUnknown(item.allocated_receivable_gross) ?? 0),
        0,
      ),
      liability: items.reduce(
        (sum, item) =>
          sum + (numberFromUnknown(item.provider_liability_gross) ?? 0),
        0,
      ),
    };
  }, [orderDetail]);
  const workflowChecklistGroups = useMemo(() => {
    const items = workflowChecklist?.items ?? [];
    const grouped = new Map<string, WorkflowChecklistItem[]>();
    for (const item of items) {
      const current = grouped.get(item.checklist_key) ?? [];
      current.push(item);
      grouped.set(item.checklist_key, current);
    }
    return Array.from(grouped.entries()).map(([key, groupItems]) => ({
      key,
      label: workflowChecklistLabel(key, workflowGroupLabels, t),
      items: groupItems,
    }));
  }, [t, workflowChecklist, workflowGroupLabels]);
  const workflowMetrics = useMemo(() => {
    const items = workflowChecklist?.items ?? [];
    const ownerKeys = new Set<string>();
    const now = Date.now();
    let overdue = 0;

    for (const item of items) {
      if (item.is_completed) continue;
      ownerKeys.add(item.owner_user_id ?? item.owner_role);

      if (!item.due_date) continue;
      const dueTime = Date.parse(item.due_date);
      if (Number.isFinite(dueTime) && dueTime < now) {
        overdue += 1;
      }
    }

    return {
      total: items.length,
      owners: ownerKeys.size,
      overdue,
    };
  }, [workflowChecklist]);
  const nextLifecycleTransition = useMemo(
    () => orderDetail?.lifecycle?.allowed_transitions?.[0] ?? null,
    [orderDetail?.lifecycle],
  );
  const planningReadinessApplicable = isOrderReadinessGateApplicable(
    orderDetail?.phase,
    "planning",
  );
  const processGateReadinessApplicable = isOrderReadinessGateApplicable(
    orderDetail?.phase,
    "process",
  );
  const executionReadinessApplicable = isOrderReadinessGateApplicable(
    orderDetail?.phase,
    "execution",
  );
  const followupReadinessApplicable = isOrderReadinessGateApplicable(
    orderDetail?.phase,
    "followup",
  );
  const activeWorkflowAssignments = useMemo(
    () =>
      workflowAssignments.filter(
        (item) => !item.revoked_at && item.user_active,
      ),
    [workflowAssignments],
  );
  const debtOwnerOptions = useMemo(() => {
    const items = [...activeWorkflowAssignments];
    const currentOwnerId =
      orderDetail?.process_gates?.debt_management?.owner_user_id;
    const currentOwnerName =
      orderDetail?.process_gates?.debt_management?.owner_name;
    if (
      currentOwnerId &&
      !items.some((item) => item.user_id === currentOwnerId)
    ) {
      items.push({
        user_id: currentOwnerId,
        user_name: currentOwnerName ?? l("orders_aktueller_owner"),
        user_role: "debt_owner",
        user_active: true,
        revoked_at: null,
      });
    }
    return items;
  }, [
    activeWorkflowAssignments,
    l,
    orderDetail?.process_gates?.debt_management?.owner_name,
    orderDetail?.process_gates?.debt_management?.owner_user_id,
  ]);
  const canManageDebt =
    user?.role === "patient_manager" ||
    user?.role === "billing" ||
    user?.role === "ceo";
  const shouldRenderOrderSection = (section: OrderSectionKey) =>
    !isOrderRouteDetail || activeOrderSection === section;

  function syncQuery(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  function triggerReload() {
    startTransition(() => {
      setReloadNonce((current) => current + 1);
    });
  }

  const resetOrderWorkspace = useCallback(() => {
    setSelectedOrderId(null);
    setOrderDetail(null);
    setOrderServiceGroups([]);
    setServiceGroupPreviews({});
    setServiceGroupsError(null);
    setServiceGroupWizardError(null);
    setServiceGroupWizardOpen(false);
    setServiceGroupCreating(false);
    setServiceGroupsLoading(false);
    setGeneratingServiceGroupId(null);
    setWorkflowChecklist(null);
    setWorkflowAssignments([]);
    setWorkflowCreateOpen(false);
    setDetailError(null);
    setPhaseDraft("");
    setProcessGateError(null);
    setProcessGateForm(blankOrderProcessGateForm());
  }, []);

  function buildOrderWorkspaceHref(
    orderId: string,
    section: OrderSectionKey = DEFAULT_ORDER_SECTION,
    patientIdOverride = "",
    agencyServiceId = "",
  ) {
    const params = new URLSearchParams();
    const patientId = patientIdOverride || filters.patientId || patientContextId;
    const providerId = filters.providerId || searchParams.get("provider") || "";
    const doctorId = filters.doctorId || searchParams.get("doctor") || "";
    const taxonomyNodeId =
      filters.providerTaxonomyNodeId || searchParams.get("taxonomy") || "";

    if (patientId) params.set("patient", patientId);
    if (taxonomyNodeId) params.set("taxonomy", taxonomyNodeId);
    if (providerId) params.set("provider", providerId);
    if (doctorId) params.set("doctor", doctorId);
    if (agencyServiceId) params.set("add_service", agencyServiceId);
    if (section !== DEFAULT_ORDER_SECTION) params.set("section", section);

    const query = params.toString();
    return query ? `/orders/${orderId}?${query}` : `/orders/${orderId}`;
  }

  function closeOrderWorkspace() {
    resetOrderWorkspace();
    if (isOrderRouteDetail) {
      if (patientContextId) {
        staffGo(`/patients/${patientContextId}?tab=orders`);
        return;
      }
      staffGo("/orders");
      return;
    }
    syncQuery({ order: null });
  }

  useDebouncedRealtimeSubscription(ORDER_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/orders");
    clearApiCache("/orders/debt-management");

    for (const event of events) {
      const eventOrderId =
        typeof event.payload?.order_id === "string" ? event.payload.order_id : null;
      if (event.entity_type === "order" && event.entity_id) {
        clearApiCache(`/orders/${event.entity_id}`);
        clearApiCache(`/orders/${event.entity_id}/workflow-checklist`);
        clearApiCache(`/documents?order_id=${event.entity_id}`);
      }
      if (eventOrderId) {
        clearApiCache(`/orders/${eventOrderId}`);
        clearApiCache(`/orders/${eventOrderId}/workflow-checklist`);
        clearApiCache(`/documents?order_id=${eventOrderId}`);
      }
    }

    if (selectedOrderId) {
      clearApiCache(`/orders/${selectedOrderId}`);
      clearApiCache(`/orders/${selectedOrderId}/workflow-checklist`);
      clearApiCache(`/documents?order_id=${selectedOrderId}`);
    }
    triggerReload();
  }, 250);

  const ensureProviderDoctors = useCallback(
    async (providerId: string) => {
      if (!providerId) return [] as DoctorOption[];
      const cached = providerDoctors[providerId];
      if (cached) return cached;

      const doctors = await fetchProviderDoctors(providerId);
      setProviderDoctors((current) => ({
        ...current,
        [providerId]: doctors,
      }));
      return doctors;
    },
    [providerDoctors],
  );

  useEffect(() => {
    if (workflowForm.ownerUserId) return;
    const preferredAssignee =
      activeWorkflowAssignments.find((item) => item.user_id === user?.id)
        ?.user_id ??
      activeWorkflowAssignments[0]?.user_id ??
      "";
    if (!preferredAssignee) return;
    setWorkflowForm((current) => ({
      ...current,
      ownerUserId: preferredAssignee,
    }));
  }, [activeWorkflowAssignments, user?.id, workflowForm.ownerUserId]);

  function openOrder(
    orderId: string,
    patientId?: string | null,
    agencyServiceId = "",
  ) {
    setDetailError(null);
    setDetailLoading(true);
    startTransition(() => {
      setSelectedOrderId(orderId);
    });
    staffGo(
      buildOrderWorkspaceHref(
        orderId,
        DEFAULT_ORDER_SECTION,
        patientId ?? "",
        agencyServiceId,
      ),
    );
  }

  function updateCreateDialog(open: boolean, clearRequestedService: boolean) {
    setCreateOpen(open);
    if (!open) {
      setCreateError(null);
      setCreateForm(blankCreateOrderForm());
      setCreateSaving(false);
      setCreateRecheck(null);
      setCreateRecheckError(null);
      setCreateRecheckLoading(false);
      if (clearRequestedService && searchParams.has("service")) {
        const params = new URLSearchParams(searchParams);
        params.delete("service");
        setSearchParams(params, { replace: true });
      }
    }
  }

  function resetCreateDialog(open: boolean) {
    updateCreateDialog(open, true);
  }

  function resetLeistungDialog(open: boolean) {
    setLeistungOpen(open);
    if (!open) {
      setLeistungError(null);
      setLeistungForm(blankLeistungForm());
      setLeistungSaving(false);
    }
  }

  function resetExternalInvoiceDialog(open: boolean) {
    setExternalInvoiceOpen(open);
    if (!open) {
      setExternalInvoiceError(null);
      setExternalInvoiceForm(blankExternalInvoiceForm());
      setExternalInvoiceSaving(false);
    }
  }

  const hydrateFiltersFromRoute = useCallback(
    (
      patientParam: string,
      providerParam: string,
      doctorParam: string,
      taxonomyParam: string,
    ) => {
      setFilters((current) => {
        if (
          current.patientId === patientParam &&
          current.providerId === providerParam &&
          current.doctorId === doctorParam &&
          current.providerTaxonomyNodeId === taxonomyParam
        ) {
          return current;
        }
        return {
          ...current,
          patientId: patientParam,
          providerId: providerParam,
          providerTaxonomyNodeId: taxonomyParam,
          doctorId: doctorParam,
        };
      });
    },
    [],
  );

  const openRouteOrderWorkspace = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    setDetailLoading(true);
  }, []);

  const openCreateDialogFromRoute = useCallback(
    (patientParam: string, currentSearchParams: URLSearchParams) => {
      setCreateError(null);
      setCreateForm({
        ...blankCreateOrderForm(),
        patientId: patientParam,
      });
      setCreateOpen(true);
      const params = new URLSearchParams(currentSearchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const applyOrderDirectory = useCallback((directory: Awaited<ReturnType<typeof fetchOrderDirectory>>) => {
    setPatients(directory.patients);
    setProviders(directory.providers);
    setTaxonomyNodes(directory.taxonomyNodes);
  }, []);

  const clearOrderDirectory = useCallback(() => {
    setPatients([]);
    setProviders([]);
    setTaxonomyNodes([]);
  }, []);

  const resetCreateRecheckState = useCallback(() => {
    setCreateRecheck(null);
    setCreateRecheckError(null);
    setCreateRecheckLoading(false);
  }, []);

  const startCreateRecheckLoad = useCallback(() => {
    setCreateRecheckLoading(true);
    setCreateRecheckError(null);
  }, []);

  const applyCreateRecheck = useCallback((response: Awaited<ReturnType<typeof fetchPatientOrderRecheck>>) => {
    setCreateRecheck(response);
  }, []);

  const failCreateRecheck = useCallback((error: unknown) => {
    setCreateRecheck(null);
    setCreateRecheckError(
      error instanceof Error
        ? error.message
        : l("orders_error_load_patient_recheck"),
    );
  }, [l]);

  const finishCreateRecheckLoad = useCallback(() => {
    setCreateRecheckLoading(false);
  }, []);

  const startOrdersLoad = useCallback(() => {
    setLoading(true);
    setListError(null);
  }, []);

  const applyOrders = useCallback((response: Awaited<ReturnType<typeof fetchOrders>>) => {
    setOrders(response);
  }, []);

  const failOrdersLoad = useCallback((error: unknown) => {
    setListError(
      error instanceof Error ? error.message : l("orders_error_load_orders"),
    );
    setOrders([]);
  }, [l]);

  const finishOrdersLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const resetDebtQueue = useCallback(() => {
    setDebtQueue([]);
    setDebtQueueError(null);
    setDebtQueueLoading(false);
  }, []);

  const startDebtQueueLoad = useCallback(() => {
    setDebtQueueLoading(true);
    setDebtQueueError(null);
  }, []);

  const applyDebtQueue = useCallback((response: Awaited<ReturnType<typeof fetchOrderDebtQueue>>) => {
    setDebtQueue(response);
  }, []);

  const failDebtQueueLoad = useCallback((error: unknown) => {
    setDebtQueue([]);
    setDebtQueueError(
      error instanceof Error
        ? error.message
        : l("orders_error_load_debt_queue"),
    );
  }, [l]);

  const finishDebtQueueLoad = useCallback(() => {
    setDebtQueueLoading(false);
  }, []);

  const resetSelectedOrderWorkspaceData = useCallback(() => {
    setOrderDetail(null);
    setOrderDocuments([]);
    setOrderServiceGroups([]);
    setServiceGroupsError(null);
    setServiceGroupsLoading(false);
    setGeneratingServiceGroupId(null);
    setWorkflowChecklist(null);
    setWorkflowAssignments([]);
    setPhaseDraft("");
    setProcessGateForm(blankOrderProcessGateForm());
    setProcessGateError(null);
    setPlanningForm(blankOrderPlanningForm());
    setPlanningError(null);
    setExecutionForm(blankOrderExecutionForm());
    setExecutionError(null);
    setFollowupForm(blankOrderFollowupForm());
    setFollowupError(null);
  }, []);

  const startOrderDetailLoad = useCallback(() => {
    setDetailLoading(true);
    setDetailError(null);
  }, []);

  const applyOrderWorkspace = useCallback((workspace: Awaited<ReturnType<typeof fetchOrderWorkspace>>) => {
    setOrderDetail(workspace.detail);
    setOrderDocuments(workspace.documents);
    setWorkflowChecklist(workspace.workflow);
    setWorkflowAssignments(workspace.assignments);
    setPhaseDraft(workspace.detail.phase);
    setProcessGateForm(orderProcessGatesToForm(workspace.detail.process_gates));
    setProcessGateError(null);
    setPlanningForm(orderPlanningToForm(workspace.detail.planning_preparation));
    setPlanningError(null);
    setExecutionForm(orderExecutionToForm(workspace.detail.execution_flow));
    setExecutionError(null);
    setFollowupForm(orderFollowupToForm(workspace.detail.followup_flow));
    setFollowupError(null);
  }, []);

  const failOrderWorkspaceLoad = useCallback((error: unknown) => {
    setOrderDetail(null);
    setOrderDocuments([]);
    setWorkflowChecklist(null);
    setWorkflowAssignments([]);
    setProcessGateForm(blankOrderProcessGateForm());
    setPlanningError(null);
    setPlanningForm(blankOrderPlanningForm());
    setExecutionForm(blankOrderExecutionForm());
    setExecutionError(null);
    setFollowupForm(blankOrderFollowupForm());
    setFollowupError(null);
    setDetailError(
      error instanceof Error ? error.message : l("orders_error_load_order"),
    );
  }, [l]);

  const finishOrderDetailLoad = useCallback(() => {
    setDetailLoading(false);
  }, []);

  const resetOrderServiceGroupsData = useCallback(() => {
    setOrderServiceGroups([]);
    setServiceGroupPreviews({});
    setServiceGroupsError(null);
    setServiceGroupsLoading(false);
  }, []);

  const startOrderServiceGroupsLoad = useCallback(() => {
    setServiceGroupsLoading(true);
    setServiceGroupsError(null);
  }, []);

  const applyOrderServiceGroups = useCallback((groups: Parameters<typeof setOrderServiceGroups>[0]) => {
    setOrderServiceGroups(groups);
  }, []);

  const applyOrderServiceGroupPreviews = useCallback((previews: Record<string, OrderServiceGroupLinePreview>) => {
    setServiceGroupPreviews(previews);
  }, []);

  const failOrderServiceGroupsLoad = useCallback((error: unknown) => {
    setOrderServiceGroups([]);
    setServiceGroupPreviews({});
    setServiceGroupsError(
      error instanceof Error
        ? error.message
        : t.orders_service_groups_failed_load,
    );
  }, [t.orders_service_groups_failed_load]);

  const finishOrderServiceGroupsLoad = useCallback(() => {
    setServiceGroupsLoading(false);
  }, []);

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const providerParam = searchParams.get("provider") ?? "";
    const doctorParam = searchParams.get("doctor") ?? "";
    const taxonomyParam = searchParams.get("taxonomy") ?? "";
    const legacyOrderParam = searchParams.get("order") ?? "";
    const createParam = searchParams.get("create") ?? "";

    if (!routeOrderId && legacyOrderParam) {
      const params = new URLSearchParams(searchParams);
      params.delete("order");
      const suffix = params.toString();
      staffGo(`/orders/${legacyOrderParam}${suffix ? `?${suffix}` : ""}`);
      return;
    }

    const orderParam = routeOrderId;

    hydrateFiltersFromRoute(patientParam, providerParam, doctorParam, taxonomyParam);

    if (orderParam && orderParam !== selectedOrderId) {
      openRouteOrderWorkspace(orderParam);
    } else if (!orderParam && selectedOrderId) {
      resetOrderWorkspace();
    }

    if (createParam && permissions.canCreate) {
      openCreateDialogFromRoute(patientParam, searchParams);
    }
  }, [
    hydrateFiltersFromRoute,
    openCreateDialogFromRoute,
    openRouteOrderWorkspace,
    permissions.canCreate,
    resetOrderWorkspace,
    routeOrderId,
    searchParams,
    selectedOrderId,
    staffGo,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    async function loadDirectory() {
      try {
        const directory = await fetchOrderDirectory();
        if (cancelled) return;
        applyOrderDirectory(directory);
      } catch {
        if (cancelled) return;
        clearOrderDirectory();
      }
    }

    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [applyOrderDirectory, clearOrderDirectory, permissions.canViewPage]);

  useEffect(() => {
    if (!createOpen || !createForm.patientId) {
      resetCreateRecheckState();
      return;
    }

    let cancelled = false;
    startCreateRecheckLoad();

    async function loadCreateRecheck() {
      try {
        const response = await fetchPatientOrderRecheck(createForm.patientId);
        if (cancelled) return;
        applyCreateRecheck(response);
      } catch (error) {
        if (cancelled) return;
        failCreateRecheck(error);
      } finally {
        if (!cancelled) {
          finishCreateRecheckLoad();
        }
      }
    }

    void loadCreateRecheck();
    return () => {
      cancelled = true;
    };
  }, [
    applyCreateRecheck,
    createForm.patientId,
    createOpen,
    failCreateRecheck,
    finishCreateRecheckLoad,
    resetCreateRecheckState,
    startCreateRecheckLoad,
  ]);

  useEffect(() => {
    if (!permissions.canAddLeistung) {
      setAgencyServices([]);
      setAgencyServicesLoaded(true);
      return;
    }

    let cancelled = false;
    setAgencyServicesLoaded(false);
    void fetchAgencyServices("/agency-services?active_only=true")
      .then((items) => {
        if (!cancelled) setAgencyServices(items);
      })
      .catch(() => {
        if (!cancelled) setAgencyServices([]);
      })
      .finally(() => {
        if (!cancelled) setAgencyServicesLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [permissions.canAddLeistung]);

  useEffect(() => {
    const agencyServiceId = searchParams.get("add_service") ?? "";
    if (
      !agencyServiceId ||
      !routeOrderId ||
      !orderDetail ||
      orderDetail.id !== routeOrderId ||
      !agencyServicesLoaded ||
      leistungOpen
    ) {
      return;
    }

    const params = new URLSearchParams(searchParams);
    params.delete("add_service");
    setSearchParams(params, { replace: true });

    const service = agencyServices.find((item) => item.id === agencyServiceId);
    if (!service) {
      setDetailError(
        lang === "de"
          ? "Die ausgewählte Katalogleistung ist nicht mehr aktiv oder nicht verfügbar."
          : "Выбранная позиция каталога больше не активна или недоступна.",
      );
      return;
    }

    setLeistungError(null);
    setLeistungForm({
      ...blankLeistungForm(),
      agencyServiceId: service.id,
      description: agencyServiceNameLabel(
        service.service_key,
        service.service_name,
        t,
      ),
      unitPrice: String(service.unit_price ?? ""),
      vatRate: String(service.vat_rate ?? "0"),
    });
    setLeistungOpen(true);
  }, [
    agencyServices,
    agencyServicesLoaded,
    lang,
    leistungOpen,
    orderDetail,
    routeOrderId,
    searchParams,
    setSearchParams,
    t,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    startOrdersLoad();

    async function loadOrders() {
      try {
        const params = new URLSearchParams();
        if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
        if (filters.phase) params.set("phase", filters.phase);
        if (filters.status) params.set("status", filters.status);
        if (filters.patientId) params.set("patient_id", filters.patientId);
        if (filters.providerId) params.set("provider_id", filters.providerId);
        if (filters.providerTaxonomyNodeId) {
          params.set("provider_taxonomy_node_id", filters.providerTaxonomyNodeId);
        }
        if (filters.doctorId) params.set("doctor_id", filters.doctorId);

        const queryString = params.toString();
        const response = await fetchOrders(
          `/orders${queryString ? `?${queryString}` : ""}`,
        );
        if (cancelled) return;
        applyOrders(response);
      } catch (error) {
        if (cancelled) return;
        failOrdersLoad(error);
      } finally {
        if (!cancelled) {
          finishOrdersLoad();
        }
      }
    }

    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, [
    deferredSearch,
    applyOrders,
    failOrdersLoad,
    filters.doctorId,
    filters.patientId,
    filters.phase,
    filters.providerId,
    filters.providerTaxonomyNodeId,
    filters.status,
    finishOrdersLoad,
    permissions.canViewPage,
    reloadNonce,
    startOrdersLoad,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage || !canManageDebt) {
      resetDebtQueue();
      return;
    }

    let cancelled = false;
    startDebtQueueLoad();

    async function loadDebtQueue() {
      try {
        const response = await fetchOrderDebtQueue(filters.providerTaxonomyNodeId);
        if (cancelled) return;
        applyDebtQueue(response);
      } catch (error) {
        if (cancelled) return;
        failDebtQueueLoad(error);
      } finally {
        if (!cancelled) {
          finishDebtQueueLoad();
        }
      }
    }

    void loadDebtQueue();
    return () => {
      cancelled = true;
    };
  }, [
    applyDebtQueue,
    canManageDebt,
    failDebtQueueLoad,
    filters.providerTaxonomyNodeId,
    finishDebtQueueLoad,
    permissions.canViewPage,
    reloadNonce,
    resetDebtQueue,
    startDebtQueueLoad,
  ]);

  useEffect(() => {
    if (!filters.providerId) return;
    void ensureProviderDoctors(filters.providerId).catch(() => {
      setProviderDoctors((current) => ({
        ...current,
        [filters.providerId]: [],
      }));
    });
  }, [ensureProviderDoctors, filters.providerId]);

  useEffect(() => {
    if (!leistungForm.providerId) return;
    void ensureProviderDoctors(leistungForm.providerId).catch(() => {
      setProviderDoctors((current) => ({
        ...current,
        [leistungForm.providerId]: [],
      }));
    });
  }, [ensureProviderDoctors, leistungForm.providerId]);

  useEffect(() => {
    if (!selectedOrderId) {
      resetSelectedOrderWorkspaceData();
      return;
    }

    const currentOrderId = selectedOrderId;
    let cancelled = false;
    startOrderDetailLoad();

    async function loadDetail() {
      try {
        const workspace = await fetchOrderWorkspace(currentOrderId);
        if (cancelled) return;
        applyOrderWorkspace(workspace);
      } catch (error) {
        if (cancelled) return;
        failOrderWorkspaceLoad(error);
      } finally {
        if (!cancelled) {
          finishOrderDetailLoad();
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [
    applyOrderWorkspace,
    failOrderWorkspaceLoad,
    finishOrderDetailLoad,
    reloadNonce,
    resetSelectedOrderWorkspaceData,
    selectedOrderId,
    startOrderDetailLoad,
  ]);

  useEffect(() => {
    if (!selectedOrderId) {
      resetOrderServiceGroupsData();
      return;
    }

    const currentOrderId = selectedOrderId;
    let cancelled = false;
    startOrderServiceGroupsLoad();

    async function loadServiceGroups() {
      try {
        const groups = await fetchOrderServiceGroups(currentOrderId);
        const detailedGroups = await Promise.all(
          groups.map(async (group) => {
            try {
              const detail = await fetchOrderServiceGroup(group.id);
              return {
                ...group,
                ...detail,
                generated_line_count:
                  detail.generated_line_count ?? group.generated_line_count,
              };
            } catch {
              return {
                ...group,
                participants: group.participants ?? [],
              };
            }
          }),
        );
        if (cancelled) return;
        applyOrderServiceGroups(detailedGroups);
        const previews = await Promise.all(
          detailedGroups.map(async (group) => {
            try {
              return [
                group.id,
                await fetchOrderServiceGroupLinePreview(group.id),
              ] as const;
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        applyOrderServiceGroupPreviews(
          Object.fromEntries(previews.filter(Boolean) as Array<readonly [string, OrderServiceGroupLinePreview]>),
        );
      } catch (error) {
        if (cancelled) return;
        failOrderServiceGroupsLoad(error);
      } finally {
        if (!cancelled) finishOrderServiceGroupsLoad();
      }
    }

    void loadServiceGroups();
    return () => {
      cancelled = true;
    };
  }, [
    applyOrderServiceGroupPreviews,
    applyOrderServiceGroups,
    failOrderServiceGroupsLoad,
    finishOrderServiceGroupsLoad,
    reloadNonce,
    resetOrderServiceGroupsData,
    selectedOrderId,
    startOrderServiceGroupsLoad,
  ]);

  async function handleCreateOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!createForm.patientId) {
      setCreateError(l("orders_error_patient_required"));
      return;
    }
    if (
      requestedAgencyServiceId &&
      (!agencyServicesLoaded || !pendingCreateAgencyService)
    ) {
      setCreateError(
        agencyServicesLoaded
          ? lang === "de"
            ? "Die ausgewählte Katalogleistung ist nicht mehr aktiv oder nicht verfügbar."
            : "Выбранная позиция каталога больше не активна или недоступна."
          : lang === "de"
            ? "Der Leistungskatalog wird noch geladen."
            : "Каталог услуг ещё загружается.",
      );
      return;
    }
    if (createRecheckLoading) {
      setCreateError(l("orders_error_recheck_still_loading"));
      return;
    }
    if (!createRecheck) {
      setCreateError(createRecheckError ?? l("orders_error_load_patient_recheck"));
      return;
    }
    if (createRecheck?.requires_recheck && !createRecheck.can_create_order) {
      const blockingReason = createRecheck?.blocking_reasons?.[0];
      setCreateError(
        blockingReason
          ? localizedBlockingReason(blockingReason)
          : l("orders_error_recheck_incomplete"),
      );
      return;
    }

    setCreateSaving(true);
    setCreateError(null);
    try {
      const agencyServiceId = searchParams.get("service") ?? "";
      const created = await createOrder({
        patient_id: createForm.patientId,
        contract_id: null,
        needs_description: optString(createForm.needsDescription),
      });

      updateCreateDialog(false, false);
      openOrder(created.id, createForm.patientId, agencyServiceId);
      triggerReload();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : l("orders_error_create_order"),
      );
    } finally {
      setCreateSaving(false);
    }
  }

  async function handleSavePhase() {
    if (!selectedOrderId || !phaseDraft || phaseDraft === orderDetail?.phase) {
      return;
    }
    if (
      orderDetail?.lifecycle?.next_stage &&
      phaseDraft !== orderDetail.lifecycle.next_stage
    ) {
      setPhaseError(
        l("orders_error_only_next_lifecycle_phase", {
          phase: orderDetail.lifecycle.next_stage,
        }),
      );
      return;
    }

    setPhaseSaving(true);
    setPhaseError(null);
    try {
      await updateOrderPhase(selectedOrderId, phaseDraft);
      window.dispatchEvent(
        new CustomEvent("gmed:order-phase-changed", {
          detail: { orderId: selectedOrderId, phase: phaseDraft },
        }),
      );
      triggerReload();
    } catch (error) {
      setPhaseError(
        error instanceof Error ? error.message : l("orders_error_update_phase"),
      );
    } finally {
      setPhaseSaving(false);
    }
  }

  async function handleAdvancePhase() {
    if (!orderDetail) return;
    const phase =
      orderDetail.lifecycle?.next_stage ?? nextPhase(orderDetail.phase);
    if (!phase) return;
    setPhaseDraft(phase);
    await updateOrderPhase(orderDetail.id, phase)
      .then(() => {
        window.dispatchEvent(
          new CustomEvent("gmed:order-phase-changed", {
            detail: { orderId: orderDetail.id, phase },
          }),
        );
        setPhaseError(null);
        triggerReload();
      })
      .catch((error: unknown) => {
        setPhaseDraft(orderDetail.phase);
        setPhaseError(
          error instanceof Error ? error.message : l("orders_error_advance_phase"),
        );
      });
  }

  async function handleOrderStatusChange(status: OrderStatus) {
    if (!orderDetail || status === orderDetail.status || statusSaving) return;
    if (
      status === "cancelled" &&
      !window.confirm(
        lang === "de"
          ? "Diesen Auftrag wirklich stornieren? Dieser Status kann nicht wieder geöffnet werden."
          : "Действительно отменить этот заказ? После этого его нельзя будет открыть снова.",
      )
    ) {
      return;
    }

    setStatusSaving(status);
    setStatusError(null);
    try {
      await updateOrderStatus(orderDetail.id, status);
      triggerReload();
    } catch (error) {
      setStatusError(
        error instanceof Error
          ? error.message
          : lang === "de"
            ? "Der Auftragsstatus konnte nicht aktualisiert werden."
            : "Не удалось обновить статус заказа.",
      );
    } finally {
      setStatusSaving(null);
    }
  }

  async function handleSaveDebtManagement() {
    if (!selectedOrderId) return;

    setProcessGateBusy(true);
    setProcessGateError(null);
    try {
      await updateOrderDebtManagement(selectedOrderId, {
        status: processGateForm.debtStatus,
        note: optString(processGateForm.debtNote),
        owner_user_id: processGateForm.debtOwnerUserId || null,
        next_review_at: inputDateTimeToApiValue(
          processGateForm.debtNextReviewAt,
        ),
        last_contact_at: inputDateTimeToApiValue(
          processGateForm.debtLastContactAt,
        ),
        resolution_note: optString(processGateForm.debtResolutionNote),
      });
      setDebtManagementSheetOpen(false);
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_debt_workflow"),
      );
    } finally {
      setProcessGateBusy(false);
    }
  }

  function openDebtManagementSheet() {
    if (!orderDetail?.process_gates) return;

    setProcessGateForm(orderProcessGatesToForm(orderDetail.process_gates));
    setProcessGateError(null);
    setDebtManagementSheetOpen(true);
  }

  async function handleSaveBillingRelease() {
    if (!selectedOrderId) return;

    setProcessGateBusy(true);
    setProcessGateError(null);
    try {
      await updateOrderProcessGates(selectedOrderId, {
        billing_release_status: processGateForm.billingReleaseStatus,
        billing_release_note: optString(processGateForm.billingReleaseNote),
      });
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_billing_release"),
      );
    } finally {
      setProcessGateBusy(false);
    }
  }

  async function handleSavePackageCoverage() {
    if (!selectedOrderId) return;

    setProcessGateBusy(true);
    setProcessGateError(null);
    try {
      await updateOrderProcessGates(selectedOrderId, {
        package_coverage_status: processGateForm.packageCoverageStatus,
        package_coverage_note: optString(processGateForm.packageCoverageNote),
      });
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_package_coverage"),
      );
    } finally {
      setProcessGateBusy(false);
    }
  }

  async function handleSavePlanningPreparation() {
    if (!selectedOrderId) return;

    setPlanningBusy(true);
    setPlanningError(null);
    try {
      await updateOrderPlanningPreparation(selectedOrderId, {
        treatment_plan_status: planningForm.treatmentPlanStatus,
        treatment_plan_note: optString(planningForm.treatmentPlanNote),
        non_medical_required: planningForm.nonMedicalRequired,
        interpreter_required: planningForm.interpreterRequired,
        preparation_documents_status: planningForm.preparationDocumentsStatus,
        interpreter_briefing_status: planningForm.interpreterRequired
          ? planningForm.interpreterBriefingStatus
          : "not_needed",
      });
      triggerReload();
    } catch (error) {
      setPlanningError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_planning"),
      );
    } finally {
      setPlanningBusy(false);
    }
  }

  async function handleSaveExecutionFlow() {
    if (!selectedOrderId) return;

    setExecutionBusy(true);
    setExecutionError(null);
    try {
      await updateOrderExecutionFlow(selectedOrderId, {
        arrival_status: executionForm.arrivalStatus,
        medical_execution_status: executionForm.medicalExecutionStatus,
        non_medical_execution_status: executionForm.nonMedicalExecutionStatus,
        interpreter_service_status: executionForm.interpreterServiceStatus,
        issue_status: executionForm.issueStatus,
        deviation_note: optString(executionForm.deviationNote),
        execution_summary: optString(executionForm.executionSummary),
      });
      triggerReload();
    } catch (error) {
      setExecutionError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_execution_flow"),
      );
    } finally {
      setExecutionBusy(false);
    }
  }

  async function handleSaveFollowupFlow() {
    if (!selectedOrderId) return;

    setFollowupBusy(true);
    setFollowupError(null);
    try {
      await updateOrderFollowupFlow(selectedOrderId, {
        doctor_followup_status: followupForm.doctorFollowupStatus,
        followup_1w_status: followupForm.followup1wStatus,
        followup_1m_status: followupForm.followup1mStatus,
        followup_6m_status: followupForm.followup6mStatus,
        package_end_date: followupForm.packageEndDate,
        package_end_status: followupForm.packageEndStatus,
        results_handoff_status: followupForm.resultsHandoffStatus,
        followup_summary: optString(followupForm.followupSummary),
      });
      triggerReload();
    } catch (error) {
      setFollowupError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_followup_flow"),
      );
    } finally {
      setFollowupBusy(false);
    }
  }

  async function handleAddLeistung(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedOrderId) {
      setLeistungError(l("orders_error_select_order_first"));
      return;
    }

    const quantity = Number(leistungForm.quantity.replace(",", "."));
    const unitPrice = Number(leistungForm.unitPrice.replace(",", "."));
    const vatRate = Number(leistungForm.vatRate.replace(",", "."));

    if (!leistungForm.description.trim()) {
      setLeistungError(l("orders_error_description_required"));
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLeistungError(l("orders_error_quantity_positive"));
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setLeistungError(l("orders_error_unit_price_numeric"));
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setLeistungError(l("orders_error_vat_numeric"));
      return;
    }

    setLeistungSaving(true);
    setLeistungError(null);
    try {
      await createOrderLeistung(selectedOrderId, {
        agency_service_id: optString(leistungForm.agencyServiceId),
        description: leistungForm.description.trim(),
        quantity,
        unit_price: unitPrice,
        vat_rate: vatRate,
        is_cost_passthrough: leistungForm.isCostPassthrough,
        provider_id: optString(leistungForm.providerId),
        doctor_id: optString(leistungForm.doctorId),
        external_document_id: optString(leistungForm.externalDocumentId),
        notes: optString(leistungForm.notes),
      });
      resetLeistungDialog(false);
      triggerReload();
    } catch (error) {
      setLeistungError(
        error instanceof Error ? error.message : l("orders_error_add_leistung"),
      );
    } finally {
      setLeistungSaving(false);
    }
  }

  async function handleApproveLeistung(leistungId: string) {
    if (!selectedOrderId) return;

    setApprovingLeistungId(leistungId);
    try {
      await approveOrderLeistung(selectedOrderId, leistungId);
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : l("orders_error_approve_leistung"),
      );
    } finally {
      setApprovingLeistungId(null);
    }
  }

  async function handleGenerateServiceGroupLines(
    serviceGroupId: string,
    overrideDuplicates = false,
  ) {
    setGeneratingServiceGroupId(serviceGroupId);
    setServiceGroupsError(null);
    try {
      await generateServiceGroupLines(serviceGroupId, overrideDuplicates);
      triggerReload();
    } catch (error) {
      setServiceGroupsError(
        error instanceof Error
          ? error.message
          : t.orders_service_group_lines_failed_generate,
      );
    } finally {
      setGeneratingServiceGroupId(null);
    }
  }

  async function handleCreateServiceGroup(input: CreateOrderServiceGroupInput) {
    if (!selectedOrderId) {
      setServiceGroupWizardError(l("orders_error_select_order_first"));
      return;
    }
    setServiceGroupCreating(true);
    setServiceGroupWizardError(null);
    try {
      await createOrderServiceGroup(selectedOrderId, input);
      triggerReload();
    } catch (error) {
      setServiceGroupWizardError(
        error instanceof Error
          ? error.message
          : t.orders_service_group_failed_create,
      );
      throw error;
    } finally {
      setServiceGroupCreating(false);
    }
  }

  async function handleCreateExternalInvoice(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (!selectedOrderId) {
      setExternalInvoiceError(l("orders_error_select_order_first"));
      return;
    }
    if (!externalInvoiceForm.externalInvoiceNumber.trim()) {
      setExternalInvoiceError(l("orders_error_external_invoice_number_required"));
      return;
    }

    const amountNet = Number(externalInvoiceForm.amountNet.replace(",", "."));
    const amountVat = Number(externalInvoiceForm.amountVat.replace(",", "."));
    const amountGross = Number(
      externalInvoiceForm.amountGross.replace(",", "."),
    );

    if (!Number.isFinite(amountGross) || amountGross < 0) {
      setExternalInvoiceError(l("orders_error_gross_amount_numeric"));
      return;
    }
    if (
      externalInvoiceForm.amountNet.trim() &&
      (!Number.isFinite(amountNet) || amountNet < 0)
    ) {
      setExternalInvoiceError(l("orders_error_net_amount_numeric"));
      return;
    }
    if (
      externalInvoiceForm.amountVat.trim() &&
      (!Number.isFinite(amountVat) || amountVat < 0)
    ) {
      setExternalInvoiceError(l("orders_error_vat_amount_numeric"));
      return;
    }

    setExternalInvoiceSaving(true);
    setExternalInvoiceError(null);
    try {
      await createExternalInvoice(selectedOrderId, {
        provider_id: optString(externalInvoiceForm.providerId),
        external_invoice_number:
          externalInvoiceForm.externalInvoiceNumber.trim(),
        invoice_date: optString(externalInvoiceForm.invoiceDate),
        due_date: optString(externalInvoiceForm.dueDate),
        amount_net: externalInvoiceForm.amountNet.trim() ? amountNet : 0,
        amount_vat: externalInvoiceForm.amountVat.trim() ? amountVat : 0,
        amount_gross: amountGross,
        currency: optString(externalInvoiceForm.currency) ?? "EUR",
        status: externalInvoiceForm.status,
        paid_by: externalInvoiceForm.paidBy,
        service_delivered: externalInvoiceForm.serviceDelivered,
        notes: optString(externalInvoiceForm.notes),
      });
      resetExternalInvoiceDialog(false);
      triggerReload();
    } catch (error) {
      setExternalInvoiceError(
        error instanceof Error
          ? error.message
          : l("orders_error_create_external_invoice"),
      );
    } finally {
      setExternalInvoiceSaving(false);
    }
  }

  async function handleUpdateExternalInvoiceStatus(
    externalInvoiceId: string,
    status: ExternalInvoiceStatus,
    paidBy?: ExternalInvoicePaidBy,
  ) {
    if (!selectedOrderId) return;

    setExternalInvoiceUpdatingId(externalInvoiceId);
    setDetailError(null);
    try {
      await updateExternalInvoice(selectedOrderId, externalInvoiceId, {
        status,
        paid_by: paidBy,
      });
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_external_invoice"),
      );
    } finally {
      setExternalInvoiceUpdatingId(null);
    }
  }

  async function handleMarkExternalInvoiceDelivered(externalInvoiceId: string) {
    if (!selectedOrderId) return;
    setExternalInvoiceUpdatingId(externalInvoiceId);
    setDetailError(null);
    try {
      await updateExternalInvoice(selectedOrderId, externalInvoiceId, {
        service_delivered: true,
      });
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : l("orders_error_update_external_invoice"),
      );
    } finally {
      setExternalInvoiceUpdatingId(null);
    }
  }

  async function handleAddWorkflowItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrderId || !workflowForm.itemText.trim()) {
      setDetailError(l("orders_error_checklist_item_text_required"));
      return;
    }

    setWorkflowBusy(true);
    setDetailError(null);
    try {
      await createWorkflowChecklistItem(selectedOrderId, {
        item_text: workflowForm.itemText.trim(),
        owner_user_id: optString(workflowForm.ownerUserId),
        priority: workflowForm.priority,
        due_date: workflowForm.dueDate
          ? new Date(workflowForm.dueDate).toISOString()
          : null,
      });
      setWorkflowForm((current) => ({
        ...blankWorkflowChecklistForm(),
        ownerUserId: current.ownerUserId,
      }));
      setWorkflowCreateOpen(false);
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : l("orders_error_create_checklist_item"),
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function handleCompleteWorkflowItem(itemId: string) {
    if (!selectedOrderId) return;

    setWorkflowBusy(true);
    setDetailError(null);
    try {
      await completeWorkflowChecklistItem(selectedOrderId, itemId);
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : l("orders_error_complete_checklist_item"),
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  if (!permissions.canViewPage) {
    return (
      <EmptyState title={tx.orders_title} description={tx.orders_subtitle} />
    );
  }

  const anyQuickFilterActive =
    filters.search.trim() !== "" ||
    filters.phase !== "" ||
    filters.status !== "" ||
    filters.patientId !== "" ||
    filters.providerId !== "" ||
    filters.providerTaxonomyNodeId !== "" ||
    filters.doctorId !== "";
  const detailPatientId = orderDetail?.patient_id || null;
  const detailLeadId =
    orderDetail?.lead_id || orderDetail?.source_lead_id || null;
  const detailLeadLabel = lang === "de" ? "Lead" : "Лид";
  const detailSubjectLabel = detailPatientId
    ? t.orders_patient
    : detailLeadId
      ? detailLeadLabel
      : t.orders_patient;
  const detailSubjectName =
    orderDetail?.patient_name?.trim() || tx.common_not_set;
  const detailSubjectReference = detailPatientId
    ? orderDetail?.patient_pid?.trim() || ""
    : detailLeadId
      ? detailLeadLabel
      : "";
  const detailLeadHref = detailLeadId
    ? `/leads?lead=${encodeURIComponent(detailLeadId)}`
    : "";
  const detailSubjectHref = detailPatientId
    ? `/patients/${detailPatientId}?tab=orders`
    : detailLeadHref;
  const detailPatientQuery = detailPatientId
    ? `&patient=${encodeURIComponent(detailPatientId)}`
    : "";
  const detailOrderHref = orderDetail
    ? `order=${encodeURIComponent(orderDetail.id)}`
    : "";
  const detailAppointmentsHref = orderDetail
    ? `/appointments?${detailOrderHref}${detailPatientQuery}`
    : "";
  const detailDocumentsHref = orderDetail
    ? `/documents?${detailOrderHref}${detailPatientQuery}`
    : "";
  const detailContractsHref = orderDetail
    ? `/contracts?${detailOrderHref}${detailPatientQuery}&tab=quotes`
    : "";
  const detailInvoicesHref = orderDetail
    ? `/invoices?${detailOrderHref}${detailPatientQuery}`
    : "";
  const detailProvidersHref = detailPatientId
    ? `/providers?patient=${encodeURIComponent(detailPatientId)}`
    : "/providers";
  const detailRequiresPatient = Boolean(
    orderDetail && !detailPatientId && detailLeadId,
  );
  const workflowPatientRequired =
    workflowChecklist?.blocked_reason === "patient_required" ||
    detailRequiresPatient;
  const detailOverviewLinks = orderDetail
    ? [
        ...(detailSubjectHref
          ? [{
              label: detailSubjectLabel,
              description: detailSubjectReference
                ? `${detailSubjectName} (${detailSubjectReference})`
                : detailSubjectName,
              href: detailSubjectHref,
            }]
          : []),
        ...(detailPatientId
          ? [
              {
                label: l("orders_termine"),
                description: l("orders_termine_dieses_patienten_anzeigen"),
                href: detailAppointmentsHref,
              },
            ]
          : []),
        {
          label: l("orders_vertrage"),
          description: l("orders_angebote_und_vertrage_dieses_auftrags_offnen"),
          href: detailContractsHref,
        },
        {
          label: l("orders_rechnungen"),
          description: l("orders_rechnungen_dieses_auftrags_anzeigen"),
          href: detailInvoicesHref,
        },
        {
          label: l("orders_dokumente"),
          description: l("orders_dokumente_dieses_auftrags_anzeigen"),
          href: detailDocumentsHref,
        },
      ]
    : [];

  return (
    <div className={cn("space-y-6", isOrderRouteDetail && "min-h-0")}>
      {!isOrderRouteDetail ? (
        <>
      <PageHeader
        title={t.orders_title}
        description={t.orders_subtitle}
        actions={
          <>
            {permissions.canCreate ? (
              <Button
                type="button"
                className="h-9 rounded-lg px-3.5"
                onClick={() => setCreateOpen(true)}
              >
                <Plus className="size-4" />
                {t.orders_new_button}
              </Button>
            ) : null}
          </>
        }
      />

      {canManageDebt && (Boolean(debtQueueError) || debtQueue.length > 0) ? (
        <section className="rounded-lg border border-border/70 bg-card p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className={tokens.text.sectionTitle}>
                {titleWithDot(
                  l("orders_orders_blocked_by_overdue_receivables_or_an_open_debt_wo"),
                )}
              </h2>
              <p className={cn(tokens.text.muted, "mt-2 max-w-3xl")}>
                {l("orders_auftrage_die_durch_uberfallige_forderungen_oder_einen_of")}
              </p>
            </div>
          </div>

          <div className="mt-5">
            {debtQueueError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {debtQueueError}
              </div>
            ) : debtQueueLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {l("orders_debt_management_queue_wird_geladen")}
              </div>
            ) : (
              <div className="space-y-3 pl-6">
                {debtQueue.slice(0, 6).map((item, index, items) => (
                  <div
                    key={item.order_id}
                    className={cn(
                      "relative",
                      index < items.length - 1 &&
                        "before:absolute before:-bottom-5 before:-left-4 before:top-3 before:w-px before:bg-border",
                    )}
                  >
                    <span className="absolute -left-[1.125rem] top-1.5 z-10 size-2 rounded-full bg-muted-foreground ring-4 ring-background" />
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={tokens.text.sectionTitle}>
                        {item.order_number}
                      </div>
                      <span className="text-sm font-medium text-foreground">
                        {item.patient_name}
                      </span>
                      {item.updated_at ? (
                        <span className="text-xs text-muted-foreground">
                          {l("orders_aktualisiert")}: {formatDateTimeLabel(item.updated_at)}
                        </span>
                      ) : null}
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          statusClassName(item.effective_status),
                        )}
                      >
                        {debtStatusLabel(item.effective_status)}
                      </Badge>
                    </div>

                    <button
                      type="button"
                      onClick={() => openOrder(item.order_id, item.patient_id)}
                      className="group mt-2 w-full overflow-hidden rounded-2xl border border-border text-left transition-colors hover:border-primary/40"
                    >
                      <div className="grid gap-0 sm:grid-cols-[minmax(0,1fr)_220px]">
                        <div className="px-4 py-3">
                          <div className="max-w-xl text-xs leading-snug text-muted-foreground">
                            {debtBlockingReasonLabel(
                              item.effective_status,
                              item.overdue_invoice_count,
                            )}
                          </div>
                          {item.note ? (
                            <div className="mt-2 max-w-xl text-xs leading-snug text-muted-foreground">
                              {item.note}
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              {l("orders_uberfallig_2")}:{" "}
                              <span className="font-medium text-foreground">
                                {item.overdue_invoice_count}
                              </span>
                            </span>
                            <span>
                              {l("orders_owner")}:{" "}
                              <span className="font-medium text-foreground">
                                {item.owner_name ?? l("orders_nicht_zugewiesen")}
                              </span>
                            </span>
                            <span>
                              {l("orders_next_review")}:{" "}
                              <span className="font-medium text-foreground">
                                {item.next_review_at
                                  ? formatDateTimeLabel(item.next_review_at)
                                  : l("orders_not_scheduled")}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="relative border-t border-border px-4 py-3 sm:border-t-0 sm:pl-5 sm:before:absolute sm:before:bottom-3 sm:before:left-0 sm:before:top-3 sm:before:border-l sm:before:border-dashed sm:before:border-border">
                          <div className="space-y-2 text-xs leading-tight">
                            <div>
                              <div className="text-muted-foreground">
                                {l("orders_open_balance")}
                              </div>
                              <div className="mt-1 text-2xl font-semibold leading-none text-foreground">
                                {formatMoney(item.outstanding_balance)}
                              </div>
                            </div>
                            <div className="border-t border-border/70 pt-2">
                              <div className="text-muted-foreground">
                                {l("orders_overdue_balance")}
                              </div>
                              <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-rose-600">
                                {formatMoney(item.overdue_balance)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      <div>
        {listError ? (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {listError}
          </div>
        ) : null}
        <DataTableSurface
          rows={pagedOrders}
          columns={orderTableColumns}
          rowId={(row) => row.id}
          defaultDensity="comfortable"
          defaultFrozenColumns={ORDER_DEFAULT_FROZEN_COLUMNS}
          dictionary={tx}
          groupLabels={orderColumnGroupLabels}
          loading={loading}
          maxFrozenColumns={ORDER_MAX_FROZEN_COLUMNS}
          toolbarClassName="items-end gap-2.5 bg-muted/[0.14] px-4 py-3"
          toolbarStart={
            <div className="grid min-w-[960px] flex-1 grid-cols-12 items-end gap-x-2 gap-y-2.5">
              <ToolbarField label={t.common_search} className="col-span-4 w-full">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="orders-search"
                    value={filters.search}
                    onChange={(event) =>
                      startTransition(() =>
                        setFilters((current) => ({
                          ...current,
                          search: event.target.value,
                        })),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setFilters((current) => ({ ...current, search: "" }));
                        (event.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder={t.search_placeholder}
                    className={cn(shellInputClassName, "h-8 rounded-md bg-field pl-8 text-xs")}
                  />
                </div>
              </ToolbarField>

              <ToolbarField label={t.orders_patient} className="col-span-4 w-full">
                <NativeComboboxSelect
                  value={filters.patientId || "__all__"}
                  onChange={(event) => {
                    const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                    setFilters((current) => ({ ...current, patientId }));
                    syncQuery({ patient: patientId || null });
                  }}
                  className={cn(selectClassName, "h-8 rounded-md w-full bg-field text-xs")}
                >
                  <option value="__all__">{t.orders_all_patients}</option>
                  {patients.map((patient) => (
                    <option key={patient.id} value={patient.id}>
                      {patientLabel(patient, t.orders_patient_fallback)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </ToolbarField>

              <ToolbarField label={t.orders_phase} className="col-span-2 w-full">
                <NativeComboboxSelect
                  value={filters.phase || "__all__"}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      phase:
                        event.target.value && event.target.value !== "__all__"
                          ? event.target.value
                          : "",
                    }))
                  }
                  className={cn(selectClassName, "h-8 rounded-md w-full bg-field text-xs")}
                >
                  <option value="__all__">{t.orders_phase}</option>
                  {ORDER_PHASES.map((phase) => (
                    <option key={phase} value={phase}>
                      {phaseLabel(phase)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </ToolbarField>

              <ToolbarField label={t.users_status} className="col-span-2 w-full">
                <NativeComboboxSelect
                  value={filters.status || "__all__"}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      status:
                        event.target.value && event.target.value !== "__all__"
                          ? event.target.value
                          : "",
                    }))
                  }
                  className={cn(selectClassName, "h-8 rounded-md w-full bg-field text-xs")}
                >
                  <option value="__all__">{t.users_status}</option>
                  {ORDER_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {orderStatusLabel(status)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </ToolbarField>

              <ToolbarField
                label={`${t.common_provider} / ${t.providers_category}`}
                className="col-span-6 w-full"
              >
                <ProviderSelectWithTaxonomyFilter
                  value={filters.providerId}
                  providers={providers}
                  taxonomyNodes={taxonomyNodes}
                  taxonomyValue={filters.providerTaxonomyNodeId}
                  providerPlaceholder={t.common_provider}
                  taxonomyPlaceholder={t.providers_category}
                  taxonomyAllLabel={t.providers_category}
                  containerClassName="grid w-full grid-cols-2 gap-2"
                  taxonomySelectClassName={cn(selectClassName, "h-8 rounded-md min-w-0 bg-field text-xs")}
                  providerSelectClassName={cn(selectClassName, "h-8 rounded-md min-w-0 bg-field text-xs")}
                  providerLabel={(provider) =>
                    `${provider.name}${provider.address_city ? ` (${provider.address_city})` : ""}`
                  }
                  onTaxonomyChange={(providerTaxonomyNodeId) => {
                    setFilters((current) => ({
                      ...current,
                      providerTaxonomyNodeId,
                    }));
                    syncQuery({ taxonomy: providerTaxonomyNodeId || null });
                  }}
                  onChange={(providerId) => {
                    setFilters((current) => ({
                      ...current,
                      providerId,
                      doctorId: "",
                    }));
                    syncQuery({ provider: providerId || null, doctor: null });
                  }}
                />
              </ToolbarField>

              <ToolbarField label={t.orders_filter_doctor} className="col-span-3 w-full">
                <NativeComboboxSelect
                  value={filters.doctorId || "__all__"}
                  onChange={(event) => {
                    const doctorId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                    setFilters((current) => ({ ...current, doctorId }));
                    syncQuery({ doctor: doctorId || null });
                  }}
                  disabled={!filters.providerId}
                  className={cn(selectClassName, "h-8 rounded-md w-full bg-field text-xs")}
                >
                  <option value="__all__">{t.orders_filter_doctor}</option>
                  {filterDoctorOptions.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                      {doctorSpecialtyLabel(doctor, lang) ? ` (${doctorSpecialtyLabel(doctor, lang)})` : ""}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </ToolbarField>

              <ToolbarField label={t.table_actions} className="col-span-3 w-full">
                <div className="flex h-8 items-center justify-end gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-8 shrink-0 rounded-md bg-field"
                    title={t.orders_refresh}
                    aria-label={t.orders_refresh}
                    onClick={triggerReload}
                  >
                    <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 min-w-0 flex-1 justify-center rounded-md bg-field px-2.5"
                    disabled={!anyQuickFilterActive}
                    onClick={() => {
                      setFilters(DEFAULT_FILTERS);
                      syncQuery({
                        patient: null,
                        taxonomy: null,
                        provider: null,
                        doctor: null,
                        order: null,
                      });
                    }}
                  >
                    <X className="size-3.5" />
                    {t.common_reset}
                  </Button>
                </div>
              </ToolbarField>
            </div>
          }
          toolbarAfter={
            <OrdersPager
              pageIndex={safeOrderPageIndex}
              totalPages={orderTotalPages}
              totalRows={orders.length}
              previousLabel={t.pagination_previous}
              nextLabel={t.pagination_next}
              onPageChange={handleOrderPageChange}
            />
          }
          activeRowId={selectedOrderId}
          onRowClick={(row) => openOrder(row.id, row.patient_id)}
          rowAccent={(row) => {
            if (row.id === selectedOrderId) return "bg-sky-500";
            if (row.status === "cancelled") return "bg-rose-500";
            if (row.status === "completed") return "bg-emerald-500";
            if (row.phase === "execution") return "bg-amber-500";
            return null;
          }}
          emptyState={
            <EmptyState
              title={tx.common_not_set}
              description={tx.orders_subtitle}
              action={
                permissions.canCreate ? (
                  <Button
                    type="button"
                    className="h-9 rounded-lg px-3.5"
                    onClick={() => setCreateOpen(true)}
                  >
                    <Plus className="size-4" />
                    {t.orders_new_button}
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>
        </>
      ) : null}

      <Sheet
        open={!isOrderRouteDetail && Boolean(selectedOrderId)}
        onOpenChange={(open) => {
          if (!open) {
            closeOrderWorkspace();
          }
        }}
      >
        <SheetContent
          inline={isOrderRouteDetail}
          side="right"
          showCloseButton={!isOrderRouteDetail}
          showOverlay={!isOrderRouteDetail}
          className={cn(
            isOrderRouteDetail
              ? "min-h-0 flex-1 gap-1 rounded-none border-0 bg-transparent p-0 shadow-none sm:max-w-none"
              : "w-full border-l border-border p-0 sm:max-w-3xl",
          )}
        >
          <AdminSheetScaffold
            title={
              orderDetail
                ? `${orderDetail.order_number} / ${detailSubjectName}`
                : tx.orders_title
            }
            description={l("orders_vollstandige_operative_sicht_auf_den_aktuellen_auftrag_i")}
            bodyClassName={isOrderRouteDetail ? "pt-0" : undefined}
            hideHeader={isOrderRouteDetail}
          >
            {detailLoading ? (
              <div
                className={cn(
                  "rounded-xl px-6 py-12 text-center text-sm text-muted-foreground",
                  tokens.surface.card,
                )}
              >
                <LoaderCircle className="mx-auto mb-3 size-5 animate-spin" />
                {t.common_loading}
              </div>
            ) : detailError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {detailError}
              </div>
            ) : !orderDetail ? (
              <EmptyState
                title={tx.common_not_set}
                description={tx.orders_subtitle}
              />
            ) : (
              <div className="space-y-4 rounded-xl">
                <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <div className="relative p-5">
                    <span
                      className={cn(
                        "absolute bottom-5 left-0 top-5 w-1 rounded-r-full",
                        orderAccentClass(orderDetail.phase, orderDetail.status),
                      )}
                    />
                    <div className="grid gap-5 pl-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={orderPhaseTone(orderDetail.phase)}>
                            {phaseLabel(orderDetail.phase)}
                          </StatusBadge>
                          <StatusBadge tone={orderStatusTone(orderDetail.status)}>
                            {orderStatusLabel(orderDetail.status)}
                          </StatusBadge>
                        </div>
                        <h1 className="mt-2 min-w-0 max-w-full break-words text-xl font-semibold leading-snug text-foreground">
                          {detailSubjectName}
                        </h1>
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                          {[orderDetail.order_number, detailSubjectReference]
                            .filter(Boolean)
                            .join(" - ")}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className="rounded-full">
                            {lang === "de" ? "Brutto" : "Брутто"}: {formatMoney(orderDetail.total_estimated)}
                          </Badge>
                          <Badge variant="outline" className="rounded-full">
                            {leistungMetrics.total} {tx.providers_services}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {l("orders_aktualisiert")}: {formatDateTimeLabel(orderDetail.updated_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2 xl:justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-center rounded-lg"
                            disabled={!detailSubjectHref}
                            onClick={() => {
                              if (detailSubjectHref) {
                                window.open(
                                  detailSubjectHref,
                                  "_blank",
                                  "noopener,noreferrer",
                                );
                              }
                            }}
                          >
                            <UserRound className="size-3.5" />
                            {detailSubjectLabel}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-center rounded-lg"
                            onClick={() =>
                              window.open(
                                detailDocumentsHref,
                                "_blank",
                                "noopener,noreferrer",
                              )
                            }
                          >
                            <ArrowUpRight className="size-3.5" />
                            {l("orders_dokumente")}
                          </Button>
                          {permissions.canManagePhase
                            ? (orderDetail.lifecycle?.allowed_status_transitions ?? []).map(
                                (transition) => {
                                  const label =
                                    transition.status === "active"
                                      ? lang === "de"
                                        ? "Fortsetzen"
                                        : "Продолжить"
                                      : transition.status === "paused"
                                        ? lang === "de"
                                          ? "Pausieren"
                                          : "Приостановить"
                                        : transition.status === "completed"
                                          ? lang === "de"
                                            ? "Abschließen"
                                            : "Завершить"
                                          : lang === "de"
                                            ? "Stornieren"
                                            : "Отменить";
                                  const icon =
                                    transition.status === "active" ? (
                                      <Play className="size-3.5" />
                                    ) : transition.status === "paused" ? (
                                      <Pause className="size-3.5" />
                                    ) : transition.status === "completed" ? (
                                      <CheckCircle2 className="size-3.5" />
                                    ) : (
                                      <X className="size-3.5" />
                                    );
                                  return (
                                    <Button
                                      key={transition.status}
                                      type="button"
                                      size="sm"
                                      variant={
                                        transition.status === "cancelled"
                                          ? "destructive"
                                          : transition.status === "completed"
                                            ? "default"
                                            : "outline"
                                      }
                                      className="justify-center rounded-lg"
                                      disabled={
                                        statusSaving != null || transition.blocked
                                      }
                                      title={
                                        transition.reasons
                                          .map(localizedBlockingReason)
                                          .join("\n") || undefined
                                      }
                                      onClick={() =>
                                        void handleOrderStatusChange(transition.status)
                                      }
                                    >
                                      {statusSaving === transition.status ? (
                                        <LoaderCircle className="size-3.5 animate-spin" />
                                      ) : (
                                        icon
                                      )}
                                      {label}
                                    </Button>
                                  );
                                },
                              )
                            : null}
                      </div>
                    </div>
                    {statusError ? (
                      <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                        {statusError}
                      </div>
                    ) : null}
                  </div>

                  <div className="border-t border-border/70 bg-slate-50/70 px-5 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <ShieldCheck className="size-4 text-amber-600" />
                          <span className="text-sm font-semibold text-foreground">
                            {lang === "de" ? "Prozessstatus" : "Статус процесса"}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full",
                              nextLifecycleTransition?.blocked
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700",
                            )}
                          >
                            {nextLifecycleTransition?.blocked
                              ? l("orders_blockiert_2")
                              : orderDetail.lifecycle?.next_stage
                                ? l("orders_bereit_2")
                                : lang === "de"
                                  ? "Abgeschlossen"
                                  : "Завершено"}
                          </Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                          {nextLifecycleTransition?.blocked
                            ? lang === "de"
                              ? `${nextLifecycleTransition.reasons.length} Blocker vor dem nächsten Schritt`
                              : `${nextLifecycleTransition.reasons.length} блокирующих пунктов перед следующим шагом`
                            : orderDetail.lifecycle?.next_stage
                              ? `${l("orders_nachste_phase")}: ${phaseLabel(orderDetail.lifecycle.next_stage)}`
                              : lang === "de"
                                ? "Keine weitere Phase erforderlich"
                                : "Следующий этап не требуется"}
                        </p>
                      </div>
                      {permissions.canManagePhase &&
                      !detailRequiresPatient &&
                      orderDetail.lifecycle?.next_stage ? (
                        <Button
                          type="button"
                          className="h-9 shrink-0 rounded-lg"
                          onClick={() => void handleAdvancePhase()}
                          disabled={
                            phaseSaving ||
                            orderDetail.status !== "active" ||
                            Boolean(nextLifecycleTransition?.blocked)
                          }
                        >
                          {phaseSaving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                          {l("orders_weiter_zu")} {phaseLabel(orderDetail.lifecycle.next_stage)}
                          <ChevronRight className="size-4" />
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-4 grid gap-2 sm:grid-cols-5">
                      {ORDER_PHASES.map((phase, index) => {
                        const currentIndex = ORDER_PHASES.indexOf(orderDetail.phase as (typeof ORDER_PHASES)[number]);
                        const isCurrent = phase === orderDetail.phase;
                        const isCompleted = currentIndex >= 0 && index < currentIndex;
                        const isNext = orderDetail.lifecycle?.next_stage === phase;
                        return (
                          <div
                            key={phase}
                            className={cn(
                              "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2",
                              isCurrent
                                ? "border-orange-200 bg-orange-50 text-orange-900"
                                : isCompleted
                                  ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                                  : isNext
                                    ? "border-border bg-white text-foreground"
                                    : "border-transparent bg-white/50 text-muted-foreground",
                            )}
                          >
                            {isCompleted ? (
                              <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                            ) : isCurrent ? (
                              <CheckCircle2 className="size-4 shrink-0 text-orange-600" />
                            ) : (
                              <Circle className="size-4 shrink-0 text-muted-foreground/50" />
                            )}
                            <span className="min-w-0 truncate text-xs font-medium">
                              {phaseLabel(phase)}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {nextLifecycleTransition?.blocked ? (
                      <div className="mt-3 overflow-hidden rounded-lg border border-amber-200 bg-amber-50 text-amber-950">
                        <div className="flex items-center gap-2 px-3 py-2.5 text-xs">
                          <AlertTriangle className="size-4 shrink-0" />
                          <span className="font-semibold">{l("orders_blockierende_grunde")}</span>
                          <Badge
                            variant="outline"
                            className="ml-auto rounded-full border-amber-300 bg-white/70 text-amber-900"
                          >
                            {nextLifecycleTransition.reasons.length}
                          </Badge>
                        </div>
                        <div className="grid border-t border-amber-200/80 p-1.5 sm:grid-cols-2">
                          {nextLifecycleTransition.reasons.map((reason) => {
                            const targetSection = orderBlockingReasonSection(reason);
                            return (
                              <button
                                key={reason}
                                type="button"
                                className="group flex min-h-10 min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs leading-4 transition-colors hover:bg-amber-100/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                                onClick={() =>
                                  staffGo(
                                    buildOrderWorkspaceHref(
                                      orderDetail.id,
                                      targetSection,
                                      detailPatientId || "",
                                    ),
                                  )
                                }
                              >
                                <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-amber-500" />
                                <span className="min-w-0 flex-1">{localizedBlockingReason(reason)}</span>
                                <ChevronRight className="size-3.5 shrink-0 text-amber-700 transition-transform group-hover:translate-x-0.5" />
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>

                {shouldRenderOrderSection("overview") ? (
                  <>
                    <section className="rounded-lg border border-border/70 bg-card p-6">
                      <h2 className={tokens.text.sectionTitle}>
                        {titleWithDot(lang === "de" ? "Auftrag" : "Заказ")}
                      </h2>
                      <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <div className="space-y-1">
                          <OrderSummaryLine
                            label={detailSubjectLabel}
                            value={
                              detailSubjectReference
                                ? `${detailSubjectName} (${detailSubjectReference})`
                                : detailSubjectName
                            }
                          />
                          <OrderSummaryLine
                            label={tx.patients_created}
                            value={formatDateTimeLabel(orderDetail.created_at)}
                          />
                          <OrderSummaryLine
                            label={tx.contracts_signed}
                            value={`${orderDetail.signed_patient ? tx.contracts_signed : tx.mfa_pending} / ${
                              orderDetail.signed_agency
                                ? tx.contracts_signed
                                : tx.mfa_pending
                            }`}
                          />
                          <OrderSummaryLine
                            label={tx.providers_services}
                            value={l("orders_leistung_metrics_summary", {
                              total: leistungMetrics.total,
                              delivered: leistungMetrics.delivered,
                              approved: leistungMetrics.approved,
                            })}
                          />
                        </div>
                        <div className="rounded-xl border border-border bg-slate-50/60 p-4">
                          <h3 className="text-sm font-semibold text-foreground">
                            {t.leads_needs}
                          </h3>
                          <div className="mt-2 text-sm leading-6 text-muted-foreground">
                            {orderDetail.needs_description || tx.common_not_set}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="rounded-lg border border-border/70 bg-card p-6">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <h2 className={tokens.text.sectionTitle}>
                            {titleWithDot(l("orders_bedarfsklarung"))}
                          </h2>
                        </div>
                      </div>

                      <div className="mt-5 grid grid-cols-[repeat(auto-fit,minmax(185px,1fr))] gap-3">
                        {detailOverviewLinks.map((link) => (
                          <button
                            key={link.href}
                            type="button"
                            className="group relative min-h-[150px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                            onClick={() =>
                              window.open(link.href, "_blank", "noopener,noreferrer")
                            }
                          >
                            <div className="relative z-10">
                              <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                                {link.label}
                              </h3>
                              <p className="mt-2 text-xs leading-tight text-muted-foreground">
                                {link.description}
                              </p>
                            </div>
                            <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                              <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </>
                ) : null}

                {shouldRenderOrderSection("gates") && orderDetail.process_gates ? (
                  <section className="rounded-lg border border-border/70 bg-card p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(l("orders_prozess_gates"))}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <OrderSummaryLine
                          label={l("orders_durchfuhrungsfreigabe")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                !processGateReadinessApplicable
                                  ? "border-border bg-muted/50 text-muted-foreground"
                                  : orderDetail.process_gates.execution_ready
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-rose-200 bg-rose-50 text-rose-700",
                              )}
                            >
                              {!processGateReadinessApplicable
                                ? l("orders_nicht_verfugbar")
                                : orderDetail.process_gates.execution_ready
                                  ? l("orders_bereit")
                                  : l("orders_blockiert")}
                            </Badge>
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_debt_workflow")}
                          value={
                            debtStatusLabel(
                              orderDetail.process_gates.debt_management
                                ?.effective_status ?? "not_required",
                            )
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_billing_release")}
                          value={billingReleaseLabel(
                            orderDetail.process_gates.billing_release_status,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_paketdeckung")}
                          value={packageCoverageLabel(
                            orderDetail.process_gates.package_coverage_status,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_debt_hold")}
                          className="md:col-span-2"
                          value={
                            orderDetail.process_gates.debt_management
                              ?.blocking_reason
                              ? localizedBlockingReason(
                                  orderDetail.process_gates.debt_management
                                    .blocking_reason,
                                )
                              : orderDetail.process_gates.debt_hold
                                ? `${orderDetail.process_gates.overdue_invoice_count} ${l("orders_uberfallige_rechnung_en")}`
                                : l("orders_keine_uberfalligen_forderungen")
                          }
                        />
                      </div>

                      {processGateReadinessApplicable &&
                      orderDetail.process_gates.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          <div className="font-medium">
                            {l("orders_blockierende_grunde")}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.process_gates.blocking_reasons.map(
                              (reason) => (
                                <li key={reason}>• {localizedBlockingReason(reason)}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : null}

                      {processGateError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {processGateError}
                        </div>
                      ) : null}

                      {detailRequiresPatient ? (
                        <EmptyState
                          title={
                            lang === "de"
                              ? "Patient wurde noch nicht angelegt"
                              : "Пациент ещё не создан"
                          }
                          description={
                            lang === "de"
                              ? "Patientenbezogene Prozessfreigaben werden nach der Konvertierung des Leads verfügbar."
                              : "Процессные статусы пациента станут доступны после конвертации лида."
                          }
                        />
                      ) : (
                        <div className="grid gap-4">
                        <div className="overflow-hidden rounded-2xl border border-border bg-card">
                          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-foreground">
                                {titleWithDot(l("orders_debt_management"))}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {l("orders_aktiven_debt_workflow_nachverfolgen_owner_zuweisen_und_d")}
                              </div>
                            </div>
                            {canManageDebt ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg"
                                onClick={openDebtManagementSheet}
                              >
                                <ArrowUpRight className="size-3.5" />
                                {lang === "de" ? "Bearbeiten" : "Редактировать"}
                              </Button>
                            ) : null}
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[900px] text-left text-xs">
                              <thead className="bg-muted/25 text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-2.5 font-medium">{l("orders_debt_status")}</th>
                                  <th className="px-4 py-2.5 font-medium">{l("orders_owner")}</th>
                                  <th className="px-4 py-2.5 text-right font-medium">{l("orders_uberfallig_2")}</th>
                                  <th className="px-4 py-2.5 text-right font-medium">{l("orders_open_balance")}</th>
                                  <th className="px-4 py-2.5 font-medium">{l("orders_letzter_kontakt")}</th>
                                  <th className="px-4 py-2.5 font-medium">{l("orders_nachstes_review")}</th>
                                  <th className="px-4 py-2.5 font-medium">{l("orders_erledigt")}</th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr className="border-t border-border/70">
                                  <td className="px-4 py-3">
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "whitespace-nowrap rounded-full",
                                        statusClassName(
                                          orderDetail.process_gates.debt_management
                                            ?.effective_status ?? "not_required",
                                        ),
                                      )}
                                    >
                                      {debtStatusLabel(
                                        orderDetail.process_gates.debt_management
                                          ?.effective_status ?? "not_required",
                                      )}
                                    </Badge>
                                  </td>
                                  <td className="px-4 py-3 font-medium text-foreground">
                                    {orderDetail.process_gates.debt_management
                                      ?.owner_name ?? l("orders_nicht_zugewiesen")}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-foreground">
                                    {orderDetail.process_gates.overdue_invoice_count}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-foreground">
                                    {formatMoney(
                                      orderDetail.process_gates.debt_management
                                        ?.outstanding_balance ??
                                        orderDetail.process_gates.outstanding_balance ??
                                        0,
                                    )}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                    {formatDateTimeLabel(orderDetail.process_gates.debt_management?.last_contact_at)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                    {formatDateTimeLabel(orderDetail.process_gates.debt_management?.next_review_at)}
                                  </td>
                                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                    {formatDateTimeLabel(orderDetail.process_gates.debt_management?.resolved_at)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>

                          {orderDetail.process_gates.debt_management?.note ? (
                            <div className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
                              <span className="font-medium text-foreground">{l("orders_debt_notiz")}:</span>{" "}
                              {orderDetail.process_gates.debt_management.note}
                            </div>
                          ) : null}
                        </div>

                        {user?.role === "billing" || user?.role === "ceo" ? (
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(l("orders_billing_release"))}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l("orders_billing_entscheidet_ob_die_durchfuhrung_ausserhalb_der_p")}
                            </div>
                            <div className="mt-4 space-y-3">
                              <NativeComboboxSelect
                                value={processGateForm.billingReleaseStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    billingReleaseStatus: event.target.value as OrderProcessGateFormState["billingReleaseStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">{billingReleaseLabel("pending")}</option>
                                <option value="granted">{billingReleaseLabel("granted")}</option>
                                <option value="denied">{billingReleaseLabel("denied")}</option>
                              </NativeComboboxSelect>
                              <textarea
                                value={processGateForm.billingReleaseNote}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    billingReleaseNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder={l("orders_billing_notiz")}
                              />
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() =>
                                    void handleSaveBillingRelease()
                                  }
                                  disabled={processGateBusy}
                                >
                                  {processGateBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  {l("orders_billing_gate_speichern")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {user?.role === "patient_manager" ||
                        user?.role === "ceo" ? (
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(l("orders_paketdeckung"))}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l("orders_bestehende_paketdeckung_kann_wiederholungsleistungen_ohn")}
                            </div>
                            <div className="mt-4 space-y-3">
                              <NativeComboboxSelect
                                value={processGateForm.packageCoverageStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    packageCoverageStatus: event.target.value as OrderProcessGateFormState["packageCoverageStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="unknown">{packageCoverageLabel("unknown")}</option>
                                <option value="covered">{packageCoverageLabel("covered")}</option>
                                <option value="not_covered">{packageCoverageLabel("not_covered")}</option>
                              </NativeComboboxSelect>
                              <textarea
                                value={processGateForm.packageCoverageNote}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    packageCoverageNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder={l("orders_notiz_zur_paketdeckung")}
                              />
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() =>
                                    void handleSavePackageCoverage()
                                  }
                                  disabled={processGateBusy}
                                >
                                  {processGateBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  {l("orders_paket_gate_speichern")}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                        </div>
                      )}
                    </div>
                  </section>
                ) : null}

                {shouldRenderOrderSection("planning") && orderDetail.planning_preparation ? (
                  <section className="rounded-lg border border-border/70 bg-card p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(
                            l("orders_planung_und_vorbereitung"),
                          )}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <OrderSummaryLine
                          label={l("orders_planungsfreigabe")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                !planningReadinessApplicable
                                  ? "border-border bg-muted/50 text-muted-foreground"
                                  : orderDetail.planning_preparation.planning_ready
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {!planningReadinessApplicable
                                ? l("orders_nicht_verfugbar")
                                : orderDetail.planning_preparation.planning_ready
                                  ? l("orders_bereit")
                                  : l("orders_blockiert")}
                            </Badge>
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_behandlungsplan")}
                          value={
                            treatmentPlanStatusLabel(
                              orderDetail.planning_preparation
                                .treatment_plan_status,
                            )
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_medizinische_termine")}
                          value={l("orders_planning_medical_confirmed_summary", {
                            confirmed:
                              orderDetail.planning_preparation.medical_confirmed,
                            total: orderDetail.planning_preparation.medical_total,
                          })}
                        />
                        <OrderSummaryLine
                          label={l("orders_vorbereitungsunterlagen")}
                          value={
                            preparationDocumentStatusLabel(
                              orderDetail.planning_preparation
                                .preparation_documents_status,
                            )
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_nicht_medizinischer_ablauf")}
                          value={
                            orderDetail.planning_preparation
                              .non_medical_required
                              ? l("orders_planning_non_medical_confirmed_summary", {
                                  confirmed:
                                    orderDetail.planning_preparation
                                      .non_medical_confirmed,
                                  total:
                                    orderDetail.planning_preparation
                                      .non_medical_total,
                                })
                              : l("orders_nicht_erforderlich")
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_dolmetscher")}
                          value={
                            orderDetail.planning_preparation
                              .interpreter_required
                              ? l("orders_planning_interpreter_summary", {
                                  assigned:
                                    orderDetail.planning_preparation
                                      .interpreter_assigned,
                                  confirmed:
                                    orderDetail.planning_preparation
                                      .interpreter_confirmed,
                                })
                              : l("orders_nicht_erforderlich")
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_dolmetscher_briefing")}
                          value={
                            interpreterBriefingStatusLabel(
                              orderDetail.planning_preparation
                                .interpreter_briefing_status,
                            )
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_letzter_meilenstein")}
                          value={
                            orderDetail.planning_preparation.plan_finalized_at
                              ? l("orders_plan") +
                                ` ${formatDateTimeLabel(
                                  orderDetail.planning_preparation
                                    .plan_finalized_at,
                                )}`
                              : l("orders_noch_kein_planungsmeilenstein")
                          }
                        />
                      </div>

                      {planningReadinessApplicable ? (
                        orderDetail.planning_preparation.blocking_reasons
                          .length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">
                            {l("orders_blocker_aus_der_planung")}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.planning_preparation.blocking_reasons.map(
                              (reason) => (
                                <li key={reason}>• {localizedBlockingReason(reason)}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          {l("orders_planung_und_vorbereitung_sind_fur_die_durchfuhrung_volls")}
                        </div>
                        )
                      ) : null}

                      {planningError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {planningError}
                        </div>
                      ) : null}

                      {user?.role === "patient_manager" ||
                      user?.role === "ceo" ? (
                        <div className="grid gap-4">
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(
                                l("orders_planungssteuerung"),
                              )}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l("orders_behandlungsplan_fixieren_bedarf_an_nicht_medizinischen_l")}
                            </div>
                            <div className="mt-4 space-y-3">
                              <NativeComboboxSelect
                                value={planningForm.treatmentPlanStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    treatmentPlanStatus: event.target.value as OrderPlanningFormState["treatmentPlanStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="draft">{treatmentPlanStatusLabel("draft")}</option>
                                <option value="agreed">{treatmentPlanStatusLabel("agreed")}</option>
                                <option value="correction_requested">
                                  {treatmentPlanStatusLabel("correction_requested")}
                                </option>
                                <option value="finalized">{treatmentPlanStatusLabel("finalized")}</option>
                              </NativeComboboxSelect>
                              <textarea
                                value={planningForm.treatmentPlanNote}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    treatmentPlanNote: event.target.value,
                                  }))
                                }
                                className={textareaClassName}
                                placeholder={l("orders_notiz_zum_behandlungsplan")}
                              />
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input
                                  type="checkbox"
                                  className={checkboxClass}
                                  checked={planningForm.nonMedicalRequired}
                                  onChange={(event) =>
                                    setPlanningForm((current) => ({
                                      ...current,
                                      nonMedicalRequired: event.target.checked,
                                    }))
                                  }
                                />
                                {l("orders_nicht_medizinische_leistungen_sind_erforderlich")}
                              </label>
                              <label className="flex items-center gap-2 text-sm text-foreground">
                                <input
                                  type="checkbox"
                                  className={checkboxClass}
                                  checked={planningForm.interpreterRequired}
                                  onChange={(event) =>
                                    setPlanningForm((current) => ({
                                      ...current,
                                      interpreterRequired: event.target.checked,
                                      interpreterBriefingStatus: event.target
                                        .checked
                                        ? current.interpreterBriefingStatus ===
                                          "not_needed"
                                          ? "pending"
                                          : current.interpreterBriefingStatus
                                        : "not_needed",
                                    }))
                                  }
                                />
                                {l("orders_dolmetscher_ist_erforderlich")}
                              </label>
                              <NativeComboboxSelect
                                value={planningForm.preparationDocumentsStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    preparationDocumentsStatus:
                                      event.target.value as OrderPlanningFormState["preparationDocumentsStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">
                                  {preparationDocumentStatusLabel("pending")}
                                </option>
                                <option value="sent">
                                  {preparationDocumentStatusLabel("sent")}
                                </option>
                                <option value="not_required">
                                  {preparationDocumentStatusLabel("not_required")}
                                </option>
                              </NativeComboboxSelect>
                              <NativeComboboxSelect
                                value={planningForm.interpreterBriefingStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    interpreterBriefingStatus:
                                      event.target.value as OrderPlanningFormState["interpreterBriefingStatus"],
                                  }))
                                }
                                className={selectClassName}
                                disabled={!planningForm.interpreterRequired}
                              >
                                <option value="not_needed">
                                  {interpreterBriefingStatusLabel("not_needed")}
                                </option>
                                <option value="pending">
                                  {interpreterBriefingStatusLabel("pending")}
                                </option>
                                <option value="completed">
                                  {interpreterBriefingStatusLabel("completed")}
                                </option>
                              </NativeComboboxSelect>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() =>
                                    void handleSavePlanningPreparation()
                                  }
                                  disabled={planningBusy}
                                >
                                  {planningBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  {l("orders_planungsstand_speichern")}
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(
                                l("orders_operative_ubergabe"),
                              )}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l("orders_verknupfte_arbeitsbereiche_nutzen_um_medizinische_slots")}
                            </div>
                            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(185px,1fr))] gap-3">
                              {[
                                {
                                  label: l("orders_medizinische_und_nicht_medizinische_termine"),
                                  description: l("orders_slots_und_nicht_medizinische_leistungen_bestatigen"),
                                  href: detailAppointmentsHref,
                                },
                                {
                                  label: l("orders_vorbereitungsunterlagen"),
                                  description: l("orders_unterlagen_vor_der_durchfuhrung_prufen"),
                                  href: detailDocumentsHref,
                                },
                                {
                                  label: l("orders_dolmetscher_zuweisung_und_briefing"),
                                  description: l("orders_zuweisung_und_briefingstatus_prufen"),
                                  href: detailAppointmentsHref,
                                },
                              ].map((link) => (
                                <button
                                  key={link.label}
                                  type="button"
                                  className="group relative min-h-[150px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                                  onClick={() =>
                                    window.open(
                                      link.href,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  <div className="relative z-10">
                                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                                      {link.label}
                                    </h3>
                                    <p className="mt-2 text-xs leading-tight text-muted-foreground">
                                      {link.description}
                                    </p>
                                  </div>
                                  <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                                    <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                  </span>
                                </button>
                              ))}
                              {orderDetail.planning_preparation
                                .treatment_plan_note ? (
                                <div className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                                  {
                                    orderDetail.planning_preparation
                                      .treatment_plan_note
                                  }
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {shouldRenderOrderSection("execution") && orderDetail.execution_flow ? (
                  <section className="rounded-lg border border-border/70 bg-card p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(l("orders_durchfuhrung_2"))}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <OrderSummaryLine
                          label={l("orders_abschlussreife")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                !executionReadinessApplicable
                                  ? "border-border bg-muted/50 text-muted-foreground"
                                  : orderDetail.execution_flow.closure_ready
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {!executionReadinessApplicable
                                ? l("orders_nicht_verfugbar")
                                : orderDetail.execution_flow.closure_ready
                                  ? l("orders_bereit")
                                  : l("orders_blockiert")}
                            </Badge>
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_ankunft")}
                          value={arrivalStatusLabel(
                            orderDetail.execution_flow.arrival_status,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_medizinische_durchfuhrung")}
                          className="md:col-span-2"
                          value={l("orders_execution_medical_summary", {
                            status: executionStatusLabel(
                              orderDetail.execution_flow
                                .medical_execution_status,
                            ),
                            appointments:
                              orderDetail.execution_flow.medical_completed,
                            positions:
                              orderDetail.execution_flow.delivered_leistungen,
                          })}
                        />
                        <OrderSummaryLine
                          label={l("orders_offene_durchfuhrungspunkte")}
                          value={String(
                            orderDetail.execution_flow
                              .open_execution_checklist_count,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_nicht_medizinische_durchfuhrung")}
                          value={
                            orderDetail.execution_flow.non_medical_required
                              ? l("orders_execution_non_medical_summary", {
                                  status: executionStatusLabel(
                                    orderDetail.execution_flow
                                      .non_medical_execution_status,
                                  ),
                                  appointments:
                                    orderDetail.execution_flow
                                      .non_medical_completed,
                                  services:
                                    orderDetail.execution_flow
                                      .concierge_completed,
                                })
                              : l("orders_nicht_erforderlich")
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_dolmetscher_support")}
                          value={
                            orderDetail.execution_flow.interpreter_required
                              ? l("orders_execution_interpreter_summary", {
                                  status: executionStatusLabel(
                                    orderDetail.execution_flow
                                      .interpreter_service_status,
                                  ),
                                  reports:
                                    orderDetail.execution_flow
                                      .approved_interpreter_reports,
                                })
                              : l("orders_nicht_erforderlich")
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_abweichungen")}
                          value={issueStatusLabel(orderDetail.execution_flow.issue_status)}
                        />
                        <OrderSummaryLine
                          label={l("orders_durchfuhrungsdokumente")}
                          value={String(
                            orderDetail.execution_flow.execution_documents,
                          )}
                        />
                      </div>

                      {executionReadinessApplicable ? (
                        orderDetail.execution_flow.blocking_reasons.length >
                        0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">
                            {l("orders_blocker_aus_der_durchfuhrung")}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.execution_flow.blocking_reasons.map(
                              (reason) => (
                                <li key={reason}>• {localizedBlockingReason(reason)}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          {l("orders_durchfuhrungsnachweise_und_operative_ubergabe_sind_fur_d")}
                        </div>
                        )
                      ) : null}

                      {executionError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {executionError}
                        </div>
                      ) : null}

                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("orders_steuerung_der_durchfuhrung"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l("orders_ankunft_leistungsumfang_und_klarung_von_abweichungen_ode")}
                          </div>
                          <fieldset
                            disabled={!permissions.canManagePhase}
                            className="mt-4 space-y-3"
                          >
                            <NativeComboboxSelect
                              value={executionForm.arrivalStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  arrivalStatus: event.target.value as OrderExecutionFormState["arrivalStatus"],
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">{arrivalStatusLabel("pending")}</option>
                              <option value="arrived">{arrivalStatusLabel("arrived")}</option>
                              <option value="not_required">{arrivalStatusLabel("not_required")}</option>
                            </NativeComboboxSelect>
                            <NativeComboboxSelect
                              value={executionForm.medicalExecutionStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  medicalExecutionStatus: event.target.value as OrderExecutionFormState["medicalExecutionStatus"],
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">{executionStatusLabel("pending")}</option>
                              <option value="in_progress">
                                {executionStatusLabel("in_progress")}
                              </option>
                              <option value="completed">
                                {executionStatusLabel("completed")}
                              </option>
                              <option value="not_required">
                                {executionStatusLabel("not_required")}
                              </option>
                            </NativeComboboxSelect>
                            <NativeComboboxSelect
                              value={executionForm.nonMedicalExecutionStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  nonMedicalExecutionStatus: event.target.value as OrderExecutionFormState["nonMedicalExecutionStatus"],
                                }))
                              }
                              className={selectClassName}
                              disabled={
                                !orderDetail.execution_flow.non_medical_required
                              }
                            >
                              <option value="not_required">
                                {executionStatusLabel("not_required")}
                              </option>
                              <option value="pending">
                                {executionStatusLabel("pending")}
                              </option>
                              <option value="in_progress">
                                {executionStatusLabel("in_progress")}
                              </option>
                              <option value="completed">
                                {executionStatusLabel("completed")}
                              </option>
                            </NativeComboboxSelect>
                            <NativeComboboxSelect
                              value={executionForm.interpreterServiceStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  interpreterServiceStatus: event.target.value as OrderExecutionFormState["interpreterServiceStatus"],
                                }))
                              }
                              className={selectClassName}
                              disabled={
                                !orderDetail.execution_flow.interpreter_required
                              }
                            >
                              <option value="not_required">
                                {executionStatusLabel("not_required")}
                              </option>
                              <option value="pending">
                                {executionStatusLabel("pending")}
                              </option>
                              <option value="in_progress">
                                {executionStatusLabel("in_progress")}
                              </option>
                              <option value="completed">
                                {executionStatusLabel("completed")}
                              </option>
                            </NativeComboboxSelect>
                            <NativeComboboxSelect
                              value={executionForm.issueStatus}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  issueStatus: event.target.value as OrderExecutionFormState["issueStatus"],
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">{issueStatusLabel("pending")}</option>
                              <option value="monitoring">
                                {issueStatusLabel("monitoring")}
                              </option>
                              <option value="resolved">{issueStatusLabel("resolved")}</option>
                              <option value="not_required">{issueStatusLabel("not_required")}</option>
                            </NativeComboboxSelect>
                            <textarea
                              value={executionForm.deviationNote}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  deviationNote: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              placeholder={l("orders_notiz_zu_abweichung_oder_offenem_operativen_detail")}
                            />
                            <textarea
                              value={executionForm.executionSummary}
                              onChange={(event) =>
                                setExecutionForm((current) => ({
                                  ...current,
                                  executionSummary: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              placeholder={l("orders_ankunft_leistungsumfang_kliniknotizen_ergebnis")}
                            />
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                onClick={() => void handleSaveExecutionFlow()}
                                disabled={executionBusy}
                              >
                                  {executionBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                {l("orders_durchfuhrungsstand_speichern")}
                              </Button>
                            </div>
                          </fieldset>
                        </div>

                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("orders_nachweise_der_durchfuhrung"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l("orders_verknupfte_arbeitsbereiche_nutzen_um_die_restliche_opera")}
                          </div>
                          <div className="mt-4 grid gap-3">
                            <OrderSummaryLine
                              label={l("orders_ankunft_erfasst")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow.arrival_recorded_at,
                              )}
                            />
                            <OrderSummaryLine
                              label={l("orders_medizinisch_abgeschlossen")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow.medical_completed_at,
                              )}
                            />
                            <OrderSummaryLine
                              label={l("orders_nicht_medizinisch_abgeschlossen")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow
                                .non_medical_completed_at,
                              )}
                            />
                            <OrderSummaryLine
                              label={l("orders_abweichungen_geklart")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow.issues_resolved_at,
                              )}
                            />
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(185px,1fr))] gap-3 pt-2">
                              {[
                                {
                                  label: l("orders_termine"),
                                  description: l("orders_durchfuhrungstermine_und_status_prufen"),
                                  href: detailAppointmentsHref,
                                },
                                {
                                  label: l("orders_dokumente"),
                                  description: l("orders_ausfuhrungsdokumente_und_nachweise_offnen"),
                                  href: detailDocumentsHref,
                                },
                                {
                                  label: l("orders_provider"),
                                  description: l("orders_provider_kontext_dieses_patienten_prufen"),
                                  href: detailProvidersHref,
                                },
                              ].map((link) => (
                                <button
                                  key={link.label}
                                  type="button"
                                  className="group relative min-h-[150px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                                  onClick={() =>
                                    window.open(
                                      link.href,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  <div className="relative z-10">
                                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                                      {link.label}
                                    </h3>
                                    <p className="mt-2 text-xs leading-tight text-muted-foreground">
                                      {link.description}
                                    </p>
                                  </div>
                                  <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                                    <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {shouldRenderOrderSection("followup") && orderDetail.followup_flow ? (
                  <section className="rounded-lg border border-border/70 bg-card p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(l("orders_nachsorge_ablauf"))}
                        </h2>
                      </div>
                    </div>
                    <div className="mt-5 space-y-4">
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <OrderSummaryLine
                          label={l("orders_nachsorge_freigabe")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                !followupReadinessApplicable
                                  ? "border-border bg-muted/50 text-muted-foreground"
                                  : orderDetail.followup_flow.followup_ready
                                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                    : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {!followupReadinessApplicable
                                ? l("orders_nicht_verfugbar")
                                : orderDetail.followup_flow.followup_ready
                                  ? l("orders_bereit")
                                  : l("orders_blockiert")}
                            </Badge>
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_ergebnisubergabe")}
                          value={resultsHandoffStatusLabel(
                            orderDetail.followup_flow.results_handoff_status,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_nachsorge_aktivitat")}
                          className="md:col-span-2"
                          value={l("orders_followup_activity_summary", {
                            appointments:
                              orderDetail.followup_flow
                                .followup_appointments_total,
                            reminders:
                              orderDetail.followup_flow.followup_1w_reminders +
                              orderDetail.followup_flow.followup_1m_reminders +
                              orderDetail.followup_flow.followup_6m_reminders +
                              orderDetail.followup_flow.package_end_reminders,
                          })}
                        />
                        <OrderSummaryLine
                          label={l("orders_portal_freigaben")}
                          value={String(
                            orderDetail.followup_flow.results_portal_shares,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_arztgesteuert")}
                          value={
                            followupStatusLabel(
                              orderDetail.followup_flow.doctor_followup_status,
                            )
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_followup_interval_summary_label")}
                          className="md:col-span-2"
                          value={`${followupStatusLabel(orderDetail.followup_flow.followup_1w_status)} / ${followupStatusLabel(orderDetail.followup_flow.followup_1m_status)} / ${followupStatusLabel(orderDetail.followup_flow.followup_6m_status)}`}
                        />
                        <OrderSummaryLine
                          label={l("orders_paketende")}
                          value={
                            orderDetail.followup_flow.package_end_required
                              ? `${followupStatusLabel(orderDetail.followup_flow.package_end_status)} · ${formatDateOnlyLabel(
                                  orderDetail.followup_flow.package_end_date ??
                                    orderDetail.followup_flow
                                      .suggested_package_end_date,
                                )}`
                              : l("orders_nicht_erforderlich")
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_abschlussanker")}
                          value={formatDateTimeLabel(
                            orderDetail.followup_flow.closure_anchor_at,
                          )}
                        />
                      </div>

                      {followupReadinessApplicable ? (
                        orderDetail.followup_flow.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">
                            {l("orders_blocker_fur_den_start_der_nachsorge")}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {orderDetail.followup_flow.blocking_reasons.map(
                              (reason) => (
                                <li key={reason}>• {localizedBlockingReason(reason)}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                          {l("orders_nachsorge_meilensteine_und_ubergabe_sind_fur_die_post_ca")}
                        </div>
                        )
                      ) : null}

                      {followupError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {followupError}
                        </div>
                      ) : null}

                      <div className="grid gap-4">
                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("orders_steuerung_der_nachsorge"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l("orders_markieren_welche_meilensteine_erforderlich_sind_und_ob_d")}
                          </div>
                          <fieldset
                            disabled={!permissions.canManagePhase}
                            className="mt-4 space-y-3"
                          >
                            <NativeComboboxSelect
                              value={followupForm.doctorFollowupStatus}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  doctorFollowupStatus: event.target.value as OrderFollowupFormState["doctorFollowupStatus"],
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="not_required">
                                {followupStatusLabel("not_required")}
                              </option>
                              <option value="pending">
                                {followupStatusLabel("pending")}
                              </option>
                              <option value="scheduled">
                                {followupStatusLabel("scheduled")}
                              </option>
                              <option value="completed">
                                {followupStatusLabel("completed")}
                              </option>
                            </NativeComboboxSelect>
                            <div className="grid gap-3 md:grid-cols-3">
                              <NativeComboboxSelect
                                value={followupForm.followup1wStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    followup1wStatus: event.target.value as OrderFollowupFormState["followup1wStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">{`1W ${followupStatusLabel("pending")}`}</option>
                                <option value="scheduled">{`1W ${followupStatusLabel("scheduled")}`}</option>
                                <option value="completed">{`1W ${followupStatusLabel("completed")}`}</option>
                                <option value="not_required">
                                  {`1W ${followupStatusLabel("not_required")}`}
                                </option>
                              </NativeComboboxSelect>
                              <NativeComboboxSelect
                                value={followupForm.followup1mStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    followup1mStatus: event.target.value as OrderFollowupFormState["followup1mStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">{`1M ${followupStatusLabel("pending")}`}</option>
                                <option value="scheduled">{`1M ${followupStatusLabel("scheduled")}`}</option>
                                <option value="completed">{`1M ${followupStatusLabel("completed")}`}</option>
                                <option value="not_required">
                                  {`1M ${followupStatusLabel("not_required")}`}
                                </option>
                              </NativeComboboxSelect>
                              <NativeComboboxSelect
                                value={followupForm.followup6mStatus}
                                onChange={(event) =>
                                  setFollowupForm((current) => ({
                                    ...current,
                                    followup6mStatus: event.target.value as OrderFollowupFormState["followup6mStatus"],
                                  }))
                                }
                                className={selectClassName}
                              >
                                <option value="pending">{`6M ${followupStatusLabel("pending")}`}</option>
                                <option value="scheduled">{`6M ${followupStatusLabel("scheduled")}`}</option>
                                <option value="completed">{`6M ${followupStatusLabel("completed")}`}</option>
                                <option value="not_required">
                                  {`6M ${followupStatusLabel("not_required")}`}
                                </option>
                              </NativeComboboxSelect>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <Field label={l("orders_paketende")}>
                                <Input
                                  type="date"
                                  value={followupForm.packageEndDate}
                                  onChange={(event) =>
                                    setFollowupForm((current) => ({
                                      ...current,
                                      packageEndDate: event.target.value,
                                    }))
                                  }
                                  className={inputClassName}
                                />
                              </Field>
                              <Field label={l("orders_paketende_status")}>
                                <NativeComboboxSelect
                                  value={followupForm.packageEndStatus}
                                  onChange={(event) =>
                                    setFollowupForm((current) => ({
                                      ...current,
                                      packageEndStatus: event.target.value as OrderFollowupFormState["packageEndStatus"],
                                    }))
                                  }
                                  className={selectClassName}
                                >
                                  <option value="not_required">
                                    {l("orders_paketende_nicht_erforderlich")}
                                  </option>
                                  <option value="pending">
                                    {l("orders_paketende_ausstehend")}
                                  </option>
                                  <option value="scheduled">
                                    {l("orders_paketende_geplant")}
                                  </option>
                                  <option value="completed">
                                    {l("orders_paketende_abgeschlossen")}
                                  </option>
                                </NativeComboboxSelect>
                              </Field>
                            </div>
                            <NativeComboboxSelect
                              value={followupForm.resultsHandoffStatus}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  resultsHandoffStatus: event.target.value as OrderFollowupFormState["resultsHandoffStatus"],
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="pending">
                                {resultsHandoffStatusLabel("pending")}
                              </option>
                              <option value="completed">
                                {resultsHandoffStatusLabel("completed")}
                              </option>
                              <option value="not_required">
                                {resultsHandoffStatusLabel("not_required")}
                              </option>
                            </NativeComboboxSelect>
                            <textarea
                              value={followupForm.followupSummary}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  followupSummary: event.target.value,
                                }))
                              }
                              className={textareaClassName}
                              placeholder={l("orders_patientenkommunikation_arztbrief_ubergabe_outreach_plan")}
                            />
                            <div className="flex justify-end">
                              <Button
                                type="button"
                                onClick={() => void handleSaveFollowupFlow()}
                                disabled={followupBusy}
                              >
                                  {followupBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                {l("orders_nachsorge_stand_speichern")}
                              </Button>
                            </div>
                          </fieldset>
                        </div>

                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("orders_empfohlene_meilenstein_anker"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l("orders_bestehende_termin_presets_und_portalsichtbarkeit_lesen_d")}
                          </div>
                          <div className="mt-4 space-y-3">
                            <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                              <OrderSummaryLine
                                label={l("orders_1_wochen_ziel")}
                                value={formatDateTimeLabel(
                                  orderDetail.followup_flow
                                    .recommended_followup_1w_at,
                                )}
                              />
                              <OrderSummaryLine
                                label={l("orders_1_monats_ziel")}
                                value={formatDateTimeLabel(
                                  orderDetail.followup_flow
                                    .recommended_followup_1m_at,
                                )}
                              />
                              <OrderSummaryLine
                                label={l("orders_6_monats_ziel")}
                                value={formatDateTimeLabel(
                                  orderDetail.followup_flow
                                    .recommended_followup_6m_at,
                                )}
                              />
                              <OrderSummaryLine
                                label={l("orders_paketende_outreach")}
                                value={formatDateOnlyLabel(
                                  orderDetail.followup_flow
                                    .recommended_package_end_followup_at,
                                )}
                              />
                            </div>
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(185px,1fr))] gap-3 pt-2">
                              {[
                                {
                                  label: l("orders_termine"),
                                  description: l("orders_follow_up_termine_und_erinnerungen_prufen"),
                                  href: detailAppointmentsHref,
                                },
                                {
                                  label: l("orders_dokumente"),
                                  description: l("orders_ergebnisse_und_ubergabedokumente_offnen"),
                                  href: detailDocumentsHref,
                                },
                                {
                                  label: detailPatientId
                                    ? l("orders_patientenprofil")
                                    : detailLeadLabel,
                                  description: detailPatientId
                                    ? l("orders_patientenprofil_im_neuen_tab_offnen")
                                    : lang === "de"
                                      ? "Ursprünglichen Lead öffnen"
                                      : "Открыть исходный лид",
                                  href: detailSubjectHref,
                                },
                              ].filter((link) => Boolean(link.href)).map((link) => (
                                <button
                                  key={link.label}
                                  type="button"
                                  className="group relative min-h-[150px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80 p-4 pb-14 text-left transition-colors hover:border-orange-200 hover:bg-orange-50/50"
                                  onClick={() =>
                                    window.open(
                                      link.href,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  <div className="relative z-10">
                                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                                      {link.label}
                                    </h3>
                                    <p className="mt-2 text-xs leading-tight text-muted-foreground">
                                      {link.description}
                                    </p>
                                  </div>
                                  <span className="absolute bottom-0 right-0 flex size-12 items-center justify-center rounded-br-xl rounded-tl-[1.75rem] bg-orange-100 text-orange-700 transition-all duration-200 group-hover:size-14 group-hover:bg-orange-200 group-hover:text-orange-800">
                                    <ArrowUpRight className="size-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                                  </span>
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                ) : null}

                {shouldRenderOrderSection("phase") ? (
                  <section className="rounded-lg border border-border/70 bg-card p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h2 className={tokens.text.sectionTitle}>
                          {titleWithDot(tx.orders_phase)}
                        </h2>
                      </div>
                      {permissions.canManagePhase &&
                      !detailRequiresPatient &&
                      orderDetail.lifecycle?.next_stage ? (
                        <Button
                          variant="outline"
                          className="h-8 rounded-lg"
                          onClick={() => void handleAdvancePhase()}
                          disabled={
                            orderDetail.status !== "active" ||
                            Boolean(nextLifecycleTransition?.blocked)
                          }
                        >
                          <ChevronRight className="size-4" />
                          {l("orders_weiter_zu")}{" "}
                          {phaseLabel(orderDetail.lifecycle.next_stage)}
                        </Button>
                      ) : null}
                    </div>

                    <div className="mt-5 space-y-5">
                      {detailRequiresPatient ? (
                        <EmptyState
                          title={
                            lang === "de"
                              ? "Patient wurde noch nicht angelegt"
                              : "Пациент ещё не создан"
                          }
                          description={
                            lang === "de"
                              ? "Schließen Sie zuerst die Konvertierung des ursprünglichen Leads ab. Danach kann die Auftragsphase geändert werden."
                              : "Сначала завершите конвертацию исходного лида. После этого фазу заказа можно будет изменять."
                          }
                        />
                      ) : null}
                      <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
                        <OrderSummaryLine
                          label={l("orders_aktuelle_phase")}
                          value={phaseLabel(orderDetail.phase)}
                        />
                        <OrderSummaryLine
                          label={l("orders_nachste_phase")}
                          value={
                            orderDetail.lifecycle?.next_stage
                              ? phaseLabel(orderDetail.lifecycle.next_stage)
                              : tx.common_not_set
                          }
                        />
                        <OrderSummaryLine
                          label={l("orders_seit")}
                          value={formatDateTimeLabel(
                            orderDetail.lifecycle?.stage_entered_at,
                          )}
                        />
                        <OrderSummaryLine
                          label={l("orders_ubergabe")}
                          value={
                            detailRequiresPatient ||
                            nextLifecycleTransition?.blocked
                              ? l("orders_blockiert_2")
                              : orderDetail.lifecycle?.next_stage
                                ? l("orders_bereit_2")
                                : l("orders_nicht_verfugbar")
                          }
                        />
                      </div>

                      <div className="flex items-center gap-2" aria-hidden>
                        <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
                        <span className="size-1.5 rounded-full bg-orange-400" />
                        <span className="size-1.5 rounded-full bg-orange-300" />
                        <span className="size-1.5 rounded-full bg-orange-200" />
                        <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
                      </div>

                      <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
                        {ORDER_PHASES.map((phase) => {
                          const isCurrent = orderDetail.phase === phase;
                          const isNext = orderDetail.lifecycle?.next_stage === phase;
                          const disabled =
                            detailRequiresPatient ||
                            orderDetail.status !== "active" ||
                            !permissions.canManagePhase ||
                            (!isCurrent && !isNext);
                          const selected = phaseDraft === phase;
                          return (
                            <button
                              key={phase}
                              type="button"
                              disabled={disabled}
                              onClick={() => setPhaseDraft(phase)}
                              className={cn(
                                "relative min-h-[96px] rounded-xl border p-3 pr-10 text-left transition-colors",
                                selected
                                  ? "border-orange-200 bg-orange-50/60"
                                  : "border-border bg-slate-50/70 hover:border-orange-200 hover:bg-orange-50/40",
                                disabled && "cursor-not-allowed opacity-60",
                              )}
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "absolute right-3 top-3 flex size-4 items-center justify-center rounded-full border",
                                  selected ? "border-orange-500" : "border-border",
                                )}
                              >
                                <span
                                  className={cn(
                                    "size-2 rounded-full",
                                    selected ? "bg-orange-500" : "bg-transparent",
                                  )}
                                />
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-foreground">
                                  {phaseLabel(phase)}
                                </span>
                              </div>
                              <p className="mt-3 text-xs leading-tight text-muted-foreground">
                                {isCurrent
                                  ? l("orders_aktuelle_auftragsphase")
                                  : isNext
                                    ? l("orders_nachster_erlaubter_schritt")
                                    : l("orders_sequenziell_gesperrt")}
                              </p>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex flex-col gap-3 rounded-xl border border-border bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {phaseDraft
                              ? phaseLabel(phaseDraft)
                              : l("orders_keine_phase_ausgewahlt")}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {l("orders_nur_die_aktuelle_oder_nachste_phase_kann_gespeichert_wer")}
                          </p>
                        </div>
                        {permissions.canManagePhase && !detailRequiresPatient ? (
                          <Button
                            className="h-9 rounded-lg"
                            onClick={() => void handleSavePhase()}
                            disabled={
                              phaseSaving ||
                              orderDetail.status !== "active" ||
                              !phaseDraft ||
                              phaseDraft === orderDetail.phase ||
                              (orderDetail.lifecycle?.next_stage != null &&
                                phaseDraft !== orderDetail.lifecycle.next_stage) ||
                              Boolean(nextLifecycleTransition?.blocked)
                            }
                          >
                            {phaseSaving ? (
                              <LoaderCircle className="size-4 animate-spin" />
                            ) : null}
                            {l("orders_phase_speichern")}
                          </Button>
                        ) : (
                          <Badge
                            variant="outline"
                            className="rounded-full border-border bg-muted/50 text-muted-foreground"
                          >
                            {l("orders_billing_nur_lesend")}
                          </Badge>
                        )}
                      </div>

                      {nextLifecycleTransition?.blocked &&
                      nextLifecycleTransition.reasons.length > 0 ? (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                          <div className="font-medium">
                            {phaseLabel(nextLifecycleTransition.phase)}{" "}
                            {l("orders_ist_blockiert")}
                          </div>
                          <ul className="mt-2 space-y-1">
                            {nextLifecycleTransition.reasons.map((reason) => (
                              <li key={reason}>• {localizedBlockingReason(reason)}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {phaseError ? (
                        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {phaseError}
                        </div>
                      ) : null}

                      {orderDetail.lifecycle?.history?.length ? (
                        <div className="space-y-3">
                          <h3 className={tokens.text.sectionTitle}>
                            {titleWithDot(l("orders_historie"))}
                          </h3>
                          <div className="space-y-3 pl-6">
                            {orderDetail.lifecycle.history.map((event, index) => (
                              <div
                                key={[
                                  event.created_at,
                                  event.from_stage ?? "",
                                  event.to_stage,
                                  event.transition_kind,
                                  event.note ?? "",
                                ].join("|")}
                                className={cn(
                                  "relative",
                                  index < (orderDetail.lifecycle?.history?.length ?? 0) - 1 &&
                                    "before:absolute before:-bottom-5 before:-left-4 before:top-3 before:w-px before:bg-border",
                                )}
                              >
                                <span className="absolute -left-[1.125rem] top-1.5 z-10 size-2 rounded-full bg-muted-foreground ring-4 ring-background" />
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className={tokens.text.sectionTitle}>
                                    {event.from_stage
                                      ? `${phaseLabel(event.from_stage)} -> ${phaseLabel(event.to_stage)}`
                                      : phaseLabel(event.to_stage)}
                                  </div>
                                  <span className="text-xs text-muted-foreground">
                                    {formatDateTimeLabel(event.created_at)}
                                  </span>
                                </div>
                                <div className="mt-2 rounded-xl border border-border/70 bg-slate-50/60 px-4 py-3">
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span>{l("orders_ubergang")}</span>
                                    <span className="h-px min-w-6 flex-1 bg-border/70" />
                                    <span className="font-medium text-foreground">
                                      {transitionKindLabel(event.transition_kind)}
                                    </span>
                                  </div>
                                  {event.note ? (
                                    <p className="mt-2 text-xs leading-snug text-muted-foreground">
                                      {event.note}
                                    </p>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </section>
                ) : null}

                {shouldRenderOrderSection("workflow") ? (
                  <section className="rounded-lg border border-border/70 bg-card p-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <h2 className={tokens.text.sectionTitle}>
                        {titleWithDot(l("orders_workflow_checkliste"))}
                      </h2>
                      <div className="flex flex-wrap items-center gap-2">
                        {workflowChecklist ? (
                          <Badge
                            variant="outline"
                            className="rounded-full border-border bg-slate-50 text-muted-foreground"
                          >
                            {workflowMetrics.total} {l("orders_punkte")}
                          </Badge>
                        ) : null}
                        {permissions.canManagePhase && !workflowPatientRequired ? (
                          <Button
                            type="button"
                            className="rounded-xl"
                            onClick={() => setWorkflowCreateOpen(true)}
                          >
                            <Plus className="size-4" />
                            {l("orders_punkt_hinzufugen")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  {workflowChecklist ? (
                    <div className="mt-5 space-y-5">
                      <div className="flex flex-wrap gap-6 rounded-xl border border-border px-4 py-3">
                        <AdminInlineMetric
                          icon={ClipboardList}
                          label={l("orders_aktive_workflow_punkte")}
                          value={String(workflowChecklist.open_count)}
                          description={l("orders_offen")}
                          tone="sky"
                        />
                        <AdminInlineMetric
                          icon={CheckCircle2}
                          label={l("orders_erledigte_punkte")}
                          value={String(workflowChecklist.completed_count)}
                          description={l("orders_abgeschlossen_2")}
                          tone="emerald"
                        />
                        <AdminInlineMetric
                          icon={CalendarClock}
                          label={l("orders_uberfallig_3")}
                          value={String(workflowMetrics.overdue)}
                          description={l("orders_nach_falligkeit")}
                          tone={workflowMetrics.overdue > 0 ? "amber" : "slate"}
                        />
                        <AdminInlineMetric
                          icon={UserRound}
                          label={l("orders_owner_im_workflow")}
                          value={String(workflowMetrics.owners)}
                          description={l("orders_offene_zustandigkeiten")}
                          tone="slate"
                        />
                      </div>

                      {workflowChecklistGroups.length === 0 ? (
                        <EmptyState
                          title={
                            workflowPatientRequired
                              ? lang === "de"
                                ? "Patient wurde noch nicht angelegt"
                                : "Пациент ещё не создан"
                              : l("orders_noch_keine_workflow_punkte")
                          }
                          description={
                            workflowPatientRequired
                              ? lang === "de"
                                ? "Öffnen Sie den ursprünglichen Lead und schließen Sie die Konvertierung ab. Danach wird die Checkliste automatisch erstellt."
                                : "Откройте исходный лид и завершите конвертацию. После этого чеклист заказа будет создан автоматически."
                              : l("orders_checklistenpunkte_werden_aus_der_auftragsphase_erzeugt_u")
                          }
                        />
                      ) : (
                        <>
                          <div className="flex items-center gap-2" aria-hidden>
                            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-border" />
                            <span className="size-1.5 rounded-full bg-orange-400" />
                            <span className="size-1.5 rounded-full bg-orange-300" />
                            <span className="size-1.5 rounded-full bg-orange-200" />
                            <span className="h-px flex-1 bg-gradient-to-r from-border via-border to-transparent" />
                          </div>

                          <div className="space-y-4">
                            {workflowChecklistGroups.map((group, index) => {
                              const openItems = group.items.filter(
                                (item) => !item.is_completed,
                              ).length;
                              const completedItems = group.items.length - openItems;
                              const groupIsActive = openItems > 0;

                              return (
                                <div key={group.key} className="relative pl-9">
                                  {index < workflowChecklistGroups.length - 1 ? (
                                    <span
                                      aria-hidden
                                      className="absolute bottom-[-18px] left-[13px] top-11 w-px bg-border/70"
                                    />
                                  ) : null}
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "absolute left-0 top-3 flex size-7 items-center justify-center rounded-full ring-1",
                                      groupIsActive
                                        ? "bg-sky-50 text-sky-700 ring-sky-200"
                                        : "bg-emerald-50 text-emerald-700 ring-emerald-200",
                                    )}
                                  >
                                    {groupIsActive ? (
                                      <ClipboardList className="size-3.5" />
                                    ) : (
                                      <CheckCircle2 className="size-3.5" />
                                    )}
                                  </span>

                                  <div className="rounded-xl border border-border bg-slate-50/60 p-3">
                                    <div className="grid gap-1.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                                      <div className="min-w-0">
                                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                          <p className="min-w-0 max-w-full break-words text-[15px] font-semibold leading-5 text-foreground">
                                            {group.label}
                                          </p>
                                          <span className="size-1 rounded-full bg-muted-foreground/35" />
                                          <span className="text-xs tabular-nums text-muted-foreground">
                                            {openItems} {l("orders_offen_2")} /{" "}
                                            {group.items.length} {l("orders_gesamt")}
                                          </span>
                                        </div>
                                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                                          <span className="inline-flex items-center gap-1">
                                            <ClipboardList className="size-3.5 shrink-0 text-muted-foreground/65" />
                                            {group.items.length} {l("orders_eintrage")}
                                          </span>
                                          {completedItems > 0 ? (
                                            <>
                                              <span className="size-1 rounded-full bg-muted-foreground/35" />
                                              <span>
                                                {completedItems}{" "}
                                                {l("orders_abgeschlossen_3")}
                                              </span>
                                            </>
                                          ) : null}
                                        </div>
                                      </div>
                                      <div className="flex min-w-0 flex-wrap justify-start gap-1.5 lg:justify-end">
                                        <Badge
                                          variant="outline"
                                          className={cn(
                                            "rounded-full text-[10px]",
                                            groupIsActive
                                              ? "border-sky-200 bg-sky-50 text-sky-700"
                                              : "border-emerald-200 bg-emerald-50 text-emerald-700",
                                          )}
                                        >
                                          {groupIsActive
                                            ? l("orders_in_arbeit")
                                            : l("orders_fertig")}
                                        </Badge>
                                        <Badge
                                          variant="outline"
                                          className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                                        >
                                          {l("orders_offen")}:{" "}
                                          <span className="ml-1 font-semibold text-foreground">
                                            {openItems}
                                          </span>
                                        </Badge>
                                      </div>
                                    </div>

                                    <div className="mt-2.5 grid gap-1.5">
                                      {group.items.map((item) => {
                                        const itemStatus = item.is_completed
                                          ? "completed"
                                          : item.linked_task_status ?? "open";

                                        return (
                                          <article
                                            key={item.id}
                                            className={cn(
                                              "rounded-md bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-border/40",
                                              item.is_completed && "opacity-75",
                                            )}
                                          >
                                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                                              <div className="min-w-0">
                                                <div className="flex min-w-0 flex-wrap items-center gap-2">
                                                  <p className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">
                                                    {localizeWorkflowItemText(
                                                      item.item_key,
                                                      item.item_text,
                                                      lWorkflow,
                                                    )}
                                                  </p>
                                                  <Badge
                                                    variant="outline"
                                                    className={cn(
                                                      "rounded-full text-[10px]",
                                                      priorityBadgeClass(item.priority),
                                                    )}
                                                  >
                                                    {priorityLabel(item.priority)}
                                                  </Badge>
                                                  <Badge
                                                    variant="outline"
                                                    className={cn(
                                                      "rounded-full text-[10px]",
                                                      item.is_completed
                                                        ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                                                        : statusClassName(itemStatus),
                                                    )}
                                                  >
                                                    {workflowTaskStatusLabel(itemStatus)}
                                                  </Badge>
                                                </div>
                                                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                                                  <span className="inline-flex items-center gap-1">
                                                    <UserRound className="size-3.5 shrink-0 text-muted-foreground/65" />
                                                    {item.owner_name
                                                      ? `${item.owner_name} · ${roleLabel(item.owner_user_role ?? item.owner_role)}`
                                                      : roleLabel(item.owner_role)}
                                                  </span>
                                                  <span className="size-1 rounded-full bg-muted-foreground/35" />
                                                  <span className="inline-flex items-center gap-1">
                                                    <CalendarClock className="size-3.5 shrink-0 text-muted-foreground/65" />
                                                    {formatDateTimeLabel(item.due_date)}
                                                  </span>
                                                  <span className="size-1 rounded-full bg-muted-foreground/35" />
                                                  <span>
                                                    {l("orders_erstellt")}:{" "}
                                                    {formatDateTimeLabel(item.created_at)}
                                                  </span>
                                                  {item.completed_at ? (
                                                    <>
                                                      <span className="size-1 rounded-full bg-muted-foreground/35" />
                                                      <span>
                                                        {l("orders_erledigt_2")}:{" "}
                                                        {formatDateTimeLabel(
                                                          item.completed_at,
                                                        )}
                                                      </span>
                                                    </>
                                                  ) : null}
                                                </div>
                                              </div>
                                              {!item.is_completed ? (
                                                <Button
                                                  type="button"
                                                  variant="outline"
                                                  size="sm"
                                                  className="h-7 shrink-0 gap-1.5 rounded-lg px-2 text-xs"
                                                  disabled={workflowBusy}
                                                  onClick={() =>
                                                    void handleCompleteWorkflowItem(
                                                      item.id,
                                                    )
                                                  }
                                                >
                                                  <CheckCircle2 className="size-3.5" />
                                                  {l("orders_abschliessen")}
                                                </Button>
                                              ) : null}
                                            </div>
                                          </article>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="mt-5">
                      <EmptyState
                        title={l("orders_noch_keine_workflow_punkte")}
                        description={l("orders_checklistenpunkte_werden_aus_der_aktuellen_phase_erzeugt")}
                      />
                    </div>
                  )}
                  </section>
                ) : null}

                {shouldRenderOrderSection("services") ? (
                  <>
                    <SectionCard
                      title={l("orders_leistungsubersicht")}
                      description={t.orders_services_section_description}
                      action={
                        permissions.canAddLeistung ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              className="h-8 rounded-lg px-3"
                              onClick={() => resetLeistungDialog(true)}
                            >
                              <Plus className="size-4" />
                              {t.orders_add_service}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-8 rounded-lg px-3"
                              onClick={() => setServiceGroupWizardOpen(true)}
                            >
                              <Plus className="size-4" />
                              {t.orders_service_group_wizard_create}
                            </Button>
                          </div>
                        ) : undefined
                      }
                    >
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-1.5">
                        <MiniMetric
                          label={tx.providers_services}
                          value={String(leistungMetrics.total)}
                        />
                        <MiniMetric
                          label={t.orders_services_pending_approval_label}
                          value={String(leistungMetrics.delivered)}
                        />
                        <MiniMetric
                          label={t.orders_services_approved_label}
                          value={String(leistungMetrics.approved)}
                        />
                        <MiniMetric
                          label={lang === "de" ? "Leistungssumme netto" : "Сумма услуг нетто"}
                          value={formatMoney(leistungMetrics.net)}
                        />
                        <MiniMetric
                          label={t.orders_service_group_split_title}
                          value={String(serviceGroupMetrics.total)}
                        />
                        <MiniMetric
                          label={t.orders_service_group_participants}
                          value={String(serviceGroupMetrics.participants)}
                        />
                        <MiniMetric
                          label={t.orders_service_group_generated}
                          value={String(serviceGroupMetrics.generated)}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title={t.orders_service_group_split_title}>
                      <div className="space-y-3">
                        {serviceGroupsError ? (
                          <Banner tone="error" withIcon>
                            {serviceGroupsError}
                          </Banner>
                        ) : null}
                        {serviceGroupsLoading ? (
                          <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-5 text-sm text-muted-foreground">
                            {t.orders_service_groups_loading}
                          </div>
                        ) : null}
                        {orderServiceGroups.map((group) => (
                          <OrderServiceGroupPanel
                            key={group.id}
                            group={{
                              ...group,
                              participants: group.participants ?? [],
                            }}
                            preview={serviceGroupPreviews[group.id] ?? null}
                            generating={generatingServiceGroupId === group.id}
                            onGenerate={
                              permissions.canAddLeistung
                                ? (overrideDuplicates) =>
                                    void handleGenerateServiceGroupLines(
                                      group.id,
                                      overrideDuplicates,
                                    )
                                : undefined
                            }
                          />
                        ))}
                        {!serviceGroupsLoading &&
                        !serviceGroupsError &&
                        orderServiceGroups.length === 0 ? (
                          <EmptyState
                            title={l("orders_keine_servicegruppen")}
                            description={l("orders_erstellen_sie_eine_gruppe_um_leistungen_aus_beteiligten")}
                          />
                        ) : null}
                      </div>
                    </SectionCard>

                    <SectionCard
                      title={lang === "de" ? "Auftragsgruppe" : "Групповой заказ"}
                    >
                      <OrderGroupPanel orderId={orderDetail.id} />
                    </SectionCard>

                    <SectionCard
                      title={
                        lang === "de" ? "Betragsänderungen" : "Изменения суммы"
                      }
                    >
                      <OrderAmendmentsPanel orderId={orderDetail.id} />
                    </SectionCard>

                    <SectionCard title={tx.providers_services}>
                      <div className="space-y-3">
                        {orderDetail.leistungen.length === 0 ? (
                          <EmptyState
                            title={tx.common_not_set}
                            description={t.orders_services_empty_description}
                          />
                        ) : (
                          orderDetail.leistungen.map((leistung, index) => {
                            const lineTotal =
                              (numberFromUnknown(leistung.quantity) ?? 0) *
                              (numberFromUnknown(leistung.unit_price) ?? 0);
                            const taxonomyLabel = providerTaxonomyLabel(
                              leistung,
                              lang,
                            );
                            const providerValue = leistung.provider_id ? (
                              <button
                                type="button"
                                className="min-w-0 max-w-full break-words text-right font-semibold text-sky-700 hover:text-sky-800"
                                onClick={() =>
                                  window.open(
                                    `/providers/${leistung.provider_id}?return_to=/orders`,
                                    "_blank",
                                    "noopener,noreferrer",
                                  )
                                }
                              >
                                {leistung.provider_name || t.orders_open_provider}
                              </button>
                            ) : (
                              leistung.provider_name || t.orders_unlinked
                            );
                            const doctorValue =
                              leistung.provider_id && leistung.doctor_id ? (
                                <button
                                  type="button"
                                  className="min-w-0 max-w-full break-words text-right font-semibold text-sky-700 hover:text-sky-800"
                                  onClick={() =>
                                    window.open(
                                      `/appointments?provider=${leistung.provider_id}&doctor=${leistung.doctor_id}`,
                                      "_blank",
                                      "noopener,noreferrer",
                                    )
                                  }
                                >
                                  {leistung.doctor_name ||
                                    t.orders_open_doctor_context}
                                </button>
                              ) : (
                                leistung.doctor_name || t.orders_not_specified
                              );
                            const supportingDocumentValue =
                              leistung.external_document_id ? (
                                <button
                                  type="button"
                                  className="min-w-0 max-w-full break-words text-right font-semibold text-sky-700 hover:text-sky-800"
                                  onClick={() =>
                                    staffGo(detailDocumentsHref)
                                  }
                                >
                                  {leistung.external_document_auto_name ||
                                    leistung.external_document_filename ||
                                    t.orders_open_linked_document}
                                </button>
                              ) : leistung.is_cost_passthrough ? (
                                t.orders_supporting_document_auto_link_hint
                              ) : (
                                t.orders_unlinked
                              );
                            const agencyServiceValue =
                              leistung.agency_service_name || leistung.agency_service_key
                                ? agencyServiceNameLabel(
                                    leistung.agency_service_key,
                                    leistung.agency_service_name,
                                    t,
                                  )
                                : t.orders_not_catalog_linked;
                            const catalogDescription =
                              leistung.agency_service_description_snapshot
                              ?? leistung.agency_service_description;
                            const billingStatus =
                              leistung.billing_status ?? "not_invoiced";
                            const invoiceReferences =
                              leistung.invoice_references ?? [];

                            return (
                              <article
                                key={leistung.id}
                                className="overflow-hidden rounded-2xl border border-border bg-card"
                              >
                                <div className="grid 2xl:grid-cols-[minmax(0,1fr)_170px]">
                                  <div className="p-4">
                                    <div className="flex items-start gap-3">
                                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
                                        {index + 1}
                                      </div>
                                      <div className="min-w-0">
                                        <h3 className="min-w-0 max-w-full break-words text-sm font-semibold leading-snug text-foreground">
                                          {normalizeLeistungDescription(
                                            leistung.description,
                                          )}
                                        </h3>
                                        {catalogDescription?.trim() ? (
                                          <p className="mt-1 max-w-3xl whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                                            {catalogDescription.trim()}
                                          </p>
                                        ) : null}
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "rounded-full",
                                              statusClassName(leistung.status),
                                            )}
                                          >
                                            {leistungStatusLabel(leistung.status)}
                                          </Badge>
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "rounded-full",
                                              leistungBillingStatusClass(billingStatus),
                                            )}
                                          >
                                            {leistungBillingStatusLabel(billingStatus)}
                                          </Badge>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-1.5">
                                          {leistung.is_cost_passthrough ? (
                                            <Badge
                                              variant="outline"
                                              className="rounded-full border-violet-200 bg-violet-100 text-violet-700"
                                            >
                                              {t.orders_cost_pass_through_badge}
                                            </Badge>
                                          ) : null}
                                          {leistung.source_interpreter_report_id ? (
                                            <Badge
                                              variant="outline"
                                              className="rounded-full border-emerald-200 bg-emerald-100 text-emerald-700"
                                            >
                                              {
                                                t.orders_auto_billed_from_interpreter_report
                                              }
                                            </Badge>
                                          ) : null}
                                          {leistung.source_medical_appointment_id ? (
                                            <Badge
                                              variant="outline"
                                              className="rounded-full border-amber-200 bg-amber-100 text-amber-700"
                                            >
                                              {
                                                t.orders_auto_billed_from_completed_appointment
                                              }
                                            </Badge>
                                          ) : null}
                                          {leistung.agency_service_name ||
                                          leistung.agency_service_key ? (
                                            <Badge
                                              variant="outline"
                                              className="rounded-full border-sky-200 bg-sky-100 text-sky-700"
                                            >
                                              {agencyServiceValue}
                                            </Badge>
                                          ) : null}
                                          {taxonomyLabel ? (
                                            <Badge variant="outline" className="rounded-full">
                                              {taxonomyLabel}
                                            </Badge>
                                          ) : null}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="relative border-t border-border p-4 2xl:border-t-0 2xl:pl-5 2xl:before:absolute 2xl:before:bottom-4 2xl:before:left-0 2xl:before:top-4 2xl:before:border-l 2xl:before:border-dashed 2xl:before:border-border">
                                    <div className="text-xs text-muted-foreground">
                                      {tx.invoices_total}
                                    </div>
                                    <div className="mt-1 text-xl font-semibold leading-none text-foreground">
                                      {formatMoney(lineTotal, leistung.currency)}
                                    </div>
                                    {permissions.canApproveLeistung &&
                                    leistung.status === "delivered" ? (
                                      <Button
                                        className="mt-4 h-8 w-full rounded-lg"
                                        onClick={() =>
                                          void handleApproveLeistung(leistung.id)
                                        }
                                        disabled={
                                          approvingLeistungId === leistung.id
                                        }
                                      >
                                        {approvingLeistungId === leistung.id ? (
                                          <LoaderCircle className="size-4 animate-spin" />
                                        ) : (
                                          <CheckCircle2 className="size-4" />
                                        )}
                                        {t.orders_approve}
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>

                                <div className="grid gap-1.5 border-t border-border bg-muted/15 p-3 min-[760px]:grid-cols-2">
                                  <MiniMetric
                                    label={t.common_provider}
                                    value={providerValue}
                                    className="min-[760px]:col-span-2"
                                  />
                                  <MiniMetric
                                    label={t.common_doctor}
                                    value={doctorValue}
                                  />
                                  <MiniMetric
                                    label={l("orders_menge")}
                                    value={formatNumber(leistung.quantity, locale)}
                                  />
                                  <MiniMetric
                                    label={l("orders_einzelpreis")}
                                    value={formatMoney(
                                      leistung.unit_price,
                                      leistung.currency,
                                    )}
                                  />
                                  <MiniMetric
                                    label={l("orders_mwst")}
                                    value={`${formatNumber(leistung.vat_rate, locale)}%`}
                                  />
                                  <MiniMetric
                                    label={l("orders_erbracht")}
                                    value={formatDateTimeLabel(
                                      leistung.delivered_at,
                                    )}
                                  />
                                  <MiniMetric
                                    label={l("orders_freigegeben_2")}
                                    value={formatDateTimeLabel(
                                      leistung.approved_at,
                                    )}
                                  />
                                  <MiniMetric
                                    label={t.orders_supporting_document}
                                    value={supportingDocumentValue}
                                  />
                                  <MiniMetric
                                    label={t.orders_agency_service}
                                    value={agencyServiceValue}
                                  />
                                  <MiniMetric
                                    label={t.orders_billing_source}
                                    value={
                                      leistung.source_interpreter_report_id
                                        ? `${t.orders_billing_source_interpreter_report} ${leistung.source_interpreter_report_id}`
                                        : leistung.source_medical_appointment_id
                                          ? `${t.orders_billing_source_completed_appointment} ${leistung.source_medical_appointment_id}`
                                          : t.orders_billing_source_manual
                                    }
                                    className="min-[760px]:col-span-2"
                                  />
                                  <MiniMetric
                                    label={lang === "de" ? "Abrechnung" : "Расчёты"}
                                    value={
                                      invoiceReferences.length > 0 ? (
                                        <span className="flex min-w-0 flex-wrap justify-end gap-1.5">
                                          {invoiceReferences.map((invoice) => (
                                            <button
                                              key={invoice.invoice_id}
                                              type="button"
                                              className="rounded-full border border-border bg-background px-2 py-1 text-xs font-semibold text-sky-700 hover:border-sky-300 hover:text-sky-800"
                                              onClick={() =>
                                                staffGo(`/invoices?invoice=${invoice.invoice_id}`)
                                              }
                                              title={`${formatMoney(invoice.line_gross, leistung.currency)} · ${leistungBillingStatusLabel(billingStatus)}`}
                                            >
                                              {invoice.invoice_number ||
                                                (lang === "de" ? "Rechnung" : "Счёт")}
                                            </button>
                                          ))}
                                        </span>
                                      ) : (
                                        leistungBillingStatusLabel("not_invoiced")
                                      )
                                    }
                                    className="min-[760px]:col-span-2"
                                  />
                                  <MiniMetric
                                    label={lang === "de" ? "Abgerechnete Menge" : "Выставленное количество"}
                                    value={`${formatNumber(leistung.invoiced_quantity ?? 0, locale)} / ${formatNumber(leistung.quantity, locale)}`}
                                    className="min-[760px]:col-span-2"
                                  />
                                </div>

                                {leistung.notes ? (
                                  <div className="border-t border-border px-4 py-3 text-sm leading-snug text-muted-foreground">
                                    {leistung.notes}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })
                        )}
                      </div>
                    </SectionCard>
                  </>
                ) : null}

                {shouldRenderOrderSection("invoices") ? (
                  <>
                    <SectionCard
                      title={t.orders_external_invoices_title}
                      action={
                        permissions.canManageExternalInvoices &&
                        !detailRequiresPatient ? (
                          <Button
                            type="button"
                            className="h-8 rounded-lg px-3"
                            onClick={() => resetExternalInvoiceDialog(true)}
                          >
                            <Plus className="size-4" />
                            {t.orders_external_invoice_create_title}
                          </Button>
                        ) : undefined
                      }
                    >
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,230px),1fr))] gap-1.5">
                        <MiniMetric
                          label={t.orders_external_invoices_count_label}
                          value={String(externalInvoiceMetrics.total)}
                        />
                        <MiniMetric
                          label={t.orders_external_invoices_overdue_label}
                          value={String(externalInvoiceMetrics.overdue)}
                        />
                        <MiniMetric
                          label={t.orders_external_invoices_paid_label}
                          value={String(externalInvoiceMetrics.paid)}
                        />
                        <MiniMetric
                          label={t.orders_external_invoices_gross_label}
                          value={formatMoney(externalInvoiceMetrics.gross)}
                        />
                        <MiniMetric
                          label={lang === "de" ? "Noch nicht zugeordnet" : "Ещё не распределено"}
                          value={formatMoney(externalInvoiceMetrics.receivable)}
                        />
                        <MiniMetric
                          label={lang === "de" ? "Patientenrechnungen zugeordnet" : "Распределено по счетам пациента"}
                          value={formatMoney(externalInvoiceMetrics.allocated)}
                        />
                        <MiniMetric
                          label={lang === "de" ? "Offen beim Anbieter" : "Долг поставщику"}
                          value={formatMoney(externalInvoiceMetrics.liability)}
                        />
                      </div>
                    </SectionCard>

                    <SectionCard title={lang === "de" ? "Eingangsrechnungen" : "Входящие счета"}>
                      {(orderDetail.external_invoices ?? []).length === 0 ? (
                        <EmptyState
                          title={
                            detailRequiresPatient
                              ? lang === "de"
                                ? "Patient wurde noch nicht angelegt"
                                : "Пациент ещё не создан"
                              : t.orders_external_invoices_empty_title
                          }
                          description={
                            detailRequiresPatient
                              ? lang === "de"
                                ? "Externe Rechnungen können nach der Konvertierung des Leads erfasst werden."
                                : "Внешние счета можно добавлять после конвертации лида."
                              : t.orders_external_invoices_empty_description
                          }
                        />
                      ) : (
                        <div className="space-y-3">
                          {(orderDetail.external_invoices ?? []).map((invoice, index) => {
                            const invoiceUpdating =
                              externalInvoiceUpdatingId === invoice.id;
                            const providerLabel =
                              invoice.provider_name || t.common_provider;
                            const taxonomyLabel = providerTaxonomyLabel(
                              invoice,
                              lang,
                            );
                            const providerValue = invoice.provider_id ? (
                              <button
                                type="button"
                                className="min-w-0 max-w-full break-words font-semibold text-sky-700 hover:text-sky-800"
                                onClick={() =>
                                  window.open(
                                    `/providers/${invoice.provider_id}?return_to=/orders`,
                                    "_blank",
                                    "noopener,noreferrer",
                                  )
                                }
                              >
                                {providerLabel}
                              </button>
                            ) : invoice.provider_name ? (
                              invoice.provider_name
                            ) : (
                              t.common_not_set
                            );

                            return (
                              <article
                                key={invoice.id}
                                className="overflow-hidden rounded-2xl border border-border bg-card"
                              >
                                <div className="grid lg:grid-cols-[minmax(0,1fr)_230px]">
                                  <div className="p-4">
                                    <div className="flex items-start gap-3">
                                      <div className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
                                        {index + 1}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                                          <h3 className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">
                                            {invoice.external_invoice_number}
                                          </h3>
                                          <Badge
                                            variant="outline"
                                            className={cn(
                                              "rounded-full",
                                              statusClassName(invoice.status),
                                            )}
                                          >
                                            {externalInvoiceStatusLabel(invoice.status)}
                                          </Badge>
                                          <Badge variant="outline" className="rounded-full">
                                            {invoice.paid_by === "agency"
                                              ? lang === "de"
                                                ? "Bezahlt: GMED"
                                                : "Плательщик: GMED"
                                              : invoice.paid_by === "patient"
                                                ? lang === "de"
                                                  ? "Bezahlt: Patient"
                                                  : "Плательщик: пациент"
                                                : lang === "de"
                                                  ? "Noch unbezahlt"
                                                  : "Не оплачено"}
                                          </Badge>
                                          {invoice.service_delivered ? (
                                            <Badge variant="outline" className="rounded-full border-emerald-300 text-emerald-700">
                                              {lang === "de" ? "Leistung erbracht" : "Услуга оказана"}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                          {providerValue}
                                          {taxonomyLabel ? (
                                            <Badge variant="outline" className="rounded-full">
                                              {taxonomyLabel}
                                            </Badge>
                                          ) : null}
                                        </div>
                                        <p className="mt-2 max-w-2xl text-xs leading-snug text-muted-foreground">
                                          {t.orders_external_invoice_date}:{" "}
                                          {formatDateLabel(invoice.invoice_date)}
                                          {" · "}
                                          {t.orders_external_invoice_due_date}:{" "}
                                          {formatDateLabel(invoice.due_date)}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="relative border-t border-border p-4 lg:border-t-0 lg:pl-5 lg:before:absolute lg:before:bottom-4 lg:before:left-0 lg:before:top-4 lg:before:border-l lg:before:border-dashed lg:before:border-border">
                                    <div className="space-y-3">
                                      {permissions.canManageExternalInvoices ? (
                                        <div className="flex flex-col gap-2">
                                          {(numberFromUnknown(invoice.patient_receivable_gross) ?? 0) > 0 ? (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-auto min-h-8 w-full whitespace-normal rounded-lg px-3 text-center"
                                              onClick={() => setExternalInvoiceAllocationId(invoice.id)}
                                              disabled={invoiceUpdating}
                                            >
                                              {lang === "de"
                                                ? "Patientenrechnung zuordnen"
                                                : "Связать со счётом пациента"}
                                            </Button>
                                          ) : null}
                                          {!invoice.service_delivered &&
                                          invoice.status !== "cancelled" ? (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              className="h-auto min-h-8 w-full whitespace-normal rounded-lg px-3 text-center"
                                              onClick={() =>
                                                void handleMarkExternalInvoiceDelivered(
                                                  invoice.id,
                                                )
                                              }
                                              disabled={invoiceUpdating}
                                            >
                                              {lang === "de"
                                                ? "Leistung als erbracht markieren"
                                                : "Отметить услугу оказанной"}
                                            </Button>
                                          ) : null}
                                          {externalInvoiceStatusTransitions(invoice.status).map(
                                            (nextStatus) =>
                                              nextStatus === "paid" ? (
                                                <div key={nextStatus} className="grid gap-2">
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-auto min-h-8 w-full whitespace-normal rounded-lg px-3 text-center"
                                                    onClick={() =>
                                                      void handleUpdateExternalInvoiceStatus(
                                                        invoice.id,
                                                        nextStatus,
                                                        "patient",
                                                      )
                                                    }
                                                    disabled={invoiceUpdating}
                                                  >
                                                    {lang === "de"
                                                      ? "Vom Patienten bezahlt"
                                                      : "Оплачено пациентом"}
                                                  </Button>
                                                  <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-auto min-h-8 w-full whitespace-normal rounded-lg px-3 text-center"
                                                    onClick={() =>
                                                      void handleUpdateExternalInvoiceStatus(
                                                        invoice.id,
                                                        nextStatus,
                                                        "agency",
                                                      )
                                                    }
                                                    disabled={invoiceUpdating}
                                                  >
                                                    {invoiceUpdating ? (
                                                      <LoaderCircle className="mr-2 size-4 animate-spin" />
                                                    ) : null}
                                                    {lang === "de"
                                                      ? "Von GMED bezahlt"
                                                      : "Оплачено GMED"}
                                                  </Button>
                                                </div>
                                              ) : (
                                                <Button
                                                  key={nextStatus}
                                                  type="button"
                                                  variant={
                                                    nextStatus === "cancelled"
                                                      ? "destructive"
                                                      : "outline"
                                                  }
                                                  size="sm"
                                                  className="h-auto min-h-8 w-full whitespace-normal rounded-lg px-3 text-center"
                                                  onClick={() =>
                                                    void handleUpdateExternalInvoiceStatus(
                                                      invoice.id,
                                                      nextStatus,
                                                    )
                                                  }
                                                  disabled={invoiceUpdating}
                                                >
                                                  {invoiceUpdating ? (
                                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                                  ) : null}
                                                  {nextStatus === "received"
                                                    ? lang === "de"
                                                      ? "Als eingegangen markieren"
                                                      : "Отметить как полученный"
                                                    : nextStatus === "approved"
                                                      ? t.orders_external_invoice_mark_approved
                                                      : t.orders_external_invoice_cancel}
                                                </Button>
                                              ),
                                          )}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>

                                <div className="grid border-t border-border bg-muted/15 sm:grid-cols-2 xl:grid-cols-9">
                                  <div className="px-4 py-3">
                                    <div className="text-xs text-muted-foreground">
                                      {t.orders_external_invoice_net}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.amount_net,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 sm:border-l sm:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {t.orders_external_invoice_vat}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.amount_vat,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 xl:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {t.orders_external_invoice_gross}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.amount_gross,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 sm:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {lang === "de" ? "Forderung Patient" : "Долг пациента"}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.patient_receivable_gross,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 xl:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {lang === "de" ? "Zugeordnet" : "Распределено"}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.allocated_receivable_gross,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 sm:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {lang === "de" ? "Noch zuzuordnen" : "Осталось распределить"}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.remaining_receivable_gross,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 xl:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {lang === "de" ? "Verbindlichkeit" : "Долг поставщику"}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatMoney(
                                        invoice.provider_liability_gross,
                                        invoice.currency,
                                      )}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 sm:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {t.orders_external_invoice_received}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatDateTimeLabel(invoice.received_at)}
                                    </div>
                                  </div>
                                  <div className="border-t border-border px-4 py-3 xl:border-l xl:border-t-0">
                                    <div className="text-xs text-muted-foreground">
                                      {t.orders_external_invoice_paid}
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-foreground">
                                      {formatDateTimeLabel(invoice.paid_at)}
                                    </div>
                                  </div>
                                </div>

                                {invoice.notes ? (
                                  <div className="border-t border-border px-4 py-3 text-sm leading-snug text-muted-foreground">
                                    {invoice.notes}
                                  </div>
                                ) : null}
                              </article>
                            );
                          })}
                        </div>
                      )}
                    </SectionCard>
                  </>
                ) : null}
              </div>
            )}
          </AdminSheetScaffold>
      </SheetContent>
      </Sheet>

      <ExternalInvoiceAllocationSheet
        open={Boolean(externalInvoiceAllocationId)}
        orderId={selectedOrderId ?? ""}
        externalInvoiceId={externalInvoiceAllocationId}
        onOpenChange={(open) => {
          if (!open) setExternalInvoiceAllocationId(null);
        }}
        onChanged={triggerReload}
      />

      <Sheet
        open={debtManagementSheetOpen}
        onOpenChange={(open) => {
          if (!open && !processGateBusy) {
            setDebtManagementSheetOpen(false);
            setProcessGateError(null);
          }
        }}
      >
        <SheetContent
          side="right"
          className="w-full border-l border-border p-0 sm:max-w-xl"
        >
          <form
            className="flex h-full min-h-0 flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveDebtManagement();
            }}
          >
            <AdminSheetScaffold
              title={l("orders_debt_management")}
              description={l("orders_aktiven_debt_workflow_nachverfolgen_owner_zuweisen_und_d")}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  error={processGateError}
                  submitLabel={l("orders_debt_workflow_speichern")}
                  submittingLabel={l("orders_debt_workflow_speichern")}
                  submitting={processGateBusy}
                  submitDisabled={processGateBusy}
                  onCancel={() => {
                    setDebtManagementSheetOpen(false);
                    setProcessGateError(null);
                  }}
                />
              }
              headerClassName="px-4 py-3"
              bodyClassName="min-h-0 overscroll-y-contain px-5 py-4"
            >
              <div className="space-y-4 rounded-xl">
                {orderDetail?.process_gates ? (
                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
                    <div className="bg-card px-3 py-3">
                      <div className="text-[11px] text-muted-foreground">
                        {l("orders_uberfallig_2")}
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {orderDetail.process_gates.overdue_invoice_count}
                      </div>
                    </div>
                    <div className="bg-card px-3 py-3">
                      <div className="text-[11px] text-muted-foreground">
                        {l("orders_open_balance")}
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-foreground">
                        {formatMoney(
                          orderDetail.process_gates.debt_management
                            ?.outstanding_balance ??
                            orderDetail.process_gates.outstanding_balance ??
                            0,
                        )}
                      </div>
                    </div>
                    <div className="col-span-2 bg-card px-3 py-3 sm:col-span-1">
                      <div className="text-[11px] text-muted-foreground">
                        {l("orders_erledigt")}
                      </div>
                      <div className="mt-1 text-sm font-medium text-foreground">
                        {formatDateTimeLabel(
                          orderDetail.process_gates.debt_management?.resolved_at,
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={l("orders_debt_status")}>
                    <NativeComboboxSelect
                      value={processGateForm.debtStatus}
                      onChange={(event) =>
                        setProcessGateForm((current) => ({
                          ...current,
                          debtStatus: event.target.value as OrderProcessGateFormState["debtStatus"],
                        }))
                      }
                      className={selectClassName}
                    >
                      {[
                        "review_required",
                        "payment_plan",
                        "awaiting_payment",
                        "escalated",
                        "cleared",
                        "not_required",
                      ].map((status) => (
                        <option key={status} value={status}>
                          {debtStatusLabel(status)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>

                  <Field label={l("orders_owner")}>
                    <NativeComboboxSelect
                      value={processGateForm.debtOwnerUserId}
                      onChange={(event) =>
                        setProcessGateForm((current) => ({
                          ...current,
                          debtOwnerUserId: event.target.value,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="">
                        {l("orders_aktuellen_owner_beibehalten")}
                      </option>
                      {debtOwnerOptions.map((item) => (
                        <option key={item.user_id} value={item.user_id}>
                          {item.user_name} · {roleLabel(item.user_role)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>

                  <Field label={l("orders_letzter_kontakt")}>
                    <Input
                      type="datetime-local"
                      value={processGateForm.debtLastContactAt}
                      onChange={(event) =>
                        setProcessGateForm((current) => ({
                          ...current,
                          debtLastContactAt: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>

                  <Field label={l("orders_nachstes_review")}>
                    <Input
                      type="datetime-local"
                      value={processGateForm.debtNextReviewAt}
                      onChange={(event) =>
                        setProcessGateForm((current) => ({
                          ...current,
                          debtNextReviewAt: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>

                  <Field
                    label={l("orders_debt_notiz")}
                    className="sm:col-span-2"
                  >
                    <textarea
                      value={processGateForm.debtNote}
                      onChange={(event) =>
                        setProcessGateForm((current) => ({
                          ...current,
                          debtNote: event.target.value,
                        }))
                      }
                      className={textareaClassName}
                      placeholder={l("orders_notiz_zum_debt_workflow")}
                    />
                  </Field>

                  <Field
                    label={l("orders_losungsnotiz")}
                    className="sm:col-span-2"
                  >
                    <textarea
                      value={processGateForm.debtResolutionNote}
                      onChange={(event) =>
                        setProcessGateForm((current) => ({
                          ...current,
                          debtResolutionNote: event.target.value,
                        }))
                      }
                      className={textareaClassName}
                      placeholder={l("orders_losungsnotiz")}
                    />
                  </Field>
                </div>
              </div>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={externalInvoiceOpen} onOpenChange={resetExternalInvoiceDialog}>
        <SheetContent
          side="right"
          className="w-full border-l border-border p-0 sm:max-w-[860px]"
        >
          <form
            onSubmit={handleCreateExternalInvoice}
            className="flex h-full min-h-0 flex-col"
          >
            <AdminSheetScaffold
              title={t.orders_external_invoice_create_title}
              description={t.orders_external_invoice_create_description}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.orders_external_invoice_add}
                  submittingLabel={t.orders_external_invoice_add}
                  submitting={externalInvoiceSaving}
                  submitDisabled={externalInvoiceSaving}
                  onCancel={() => resetExternalInvoiceDialog(false)}
                />
              }
              headerClassName="px-4 py-3"
              bodyClassName="min-h-0 overscroll-y-contain space-y-4 px-5 py-4"
            >
              {externalInvoiceError ? (
                <Banner tone="error" withIcon>
                  {externalInvoiceError}
                </Banner>
              ) : null}

              <OrderSheetSection title={l("orders_grunddaten")}>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field
                    label={t.orders_external_invoice_number}
                    className="md:col-span-2"
                  >
                    <Input
                      value={externalInvoiceForm.externalInvoiceNumber}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          externalInvoiceNumber: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                  <div className="md:col-span-2">
                    <ProviderSelectWithTaxonomyFilter
                      value={externalInvoiceForm.providerId}
                      providers={providers}
                      taxonomyNodes={taxonomyNodes}
                      providerPlaceholder={t.common_not_set}
                      taxonomyPlaceholder={t.providers_category}
                      taxonomyAllLabel={t.providers_all}
                      taxonomyLabel={t.providers_category}
                      providerSelectLabel={t.common_provider}
                      containerClassName="grid-cols-1 sm:grid-cols-2"
                      taxonomySelectClassName={selectClassName}
                      providerSelectClassName={selectClassName}
                      providerLabel={(provider) => provider.name}
                      onChange={(providerId) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          providerId,
                        }))
                      }
                    />
                  </div>
                  <Field label={t.orders_external_invoice_date}>
                    <Input
                      type="date"
                      value={externalInvoiceForm.invoiceDate}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          invoiceDate: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                  <Field label={t.orders_external_invoice_due_date}>
                    <Input
                      type="date"
                      value={externalInvoiceForm.dueDate}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          dueDate: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                  <Field label={t.orders_external_invoice_status}>
                    <NativeComboboxSelect
                      value={externalInvoiceForm.status}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          status: event.target.value as ExternalInvoiceStatus,
                          paidBy:
                            event.target.value === "paid"
                              ? current.paidBy === "unpaid"
                                ? "agency"
                                : current.paidBy
                              : "unpaid",
                        }))
                      }
                      className={selectClassName}
                    >
                      {EXTERNAL_INVOICE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {externalInvoiceStatusLabel(status)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field label={lang === "de" ? "Bezahlt durch" : "Кто оплатил"}>
                    <NativeComboboxSelect
                      value={externalInvoiceForm.paidBy}
                      disabled={externalInvoiceForm.status !== "paid"}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          paidBy: event.target.value as ExternalInvoicePaidBy,
                        }))
                      }
                      className={selectClassName}
                    >
                      <option value="unpaid">
                        {lang === "de" ? "Noch unbezahlt" : "Не оплачено"}
                      </option>
                      <option value="patient">
                        {lang === "de" ? "Patient" : "Пациент"}
                      </option>
                      <option value="agency">GMED</option>
                    </NativeComboboxSelect>
                  </Field>
                  <label className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground md:col-span-2">
                    <input
                      type="checkbox"
                      checked={externalInvoiceForm.serviceDelivered}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          serviceDelivered: event.target.checked,
                        }))
                      }
                      className="size-4 rounded border-border"
                    />
                    <span>
                      {lang === "de"
                        ? "Leistung wurde dem Patienten bereits erbracht"
                        : "Услуга пациенту уже оказана"}
                    </span>
                  </label>
                </div>
              </OrderSheetSection>

              <OrderSheetSection title={l("orders_kosten")}>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label={t.orders_external_invoice_net}>
                    <Input
                      value={externalInvoiceForm.amountNet}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          amountNet: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                  <Field label={t.orders_external_invoice_vat}>
                    <Input
                      value={externalInvoiceForm.amountVat}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          amountVat: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                  <Field label={t.orders_external_invoice_gross}>
                    <Input
                      value={externalInvoiceForm.amountGross}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          amountGross: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                  <Field label={t.orders_service_group_currency}>
                    <Input
                      value={externalInvoiceForm.currency}
                      onChange={(event) =>
                        setExternalInvoiceForm((current) => ({
                          ...current,
                          currency: event.target.value,
                        }))
                      }
                      className={inputClassName}
                    />
                  </Field>
                </div>
              </OrderSheetSection>

              <OrderSheetSection title={t.patients_notes}>
                <Field label={t.patients_notes}>
                  <textarea
                    value={externalInvoiceForm.notes}
                    onChange={(event) =>
                      setExternalInvoiceForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className={textareaClassName}
                  />
                </Field>
              </OrderSheetSection>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={serviceGroupWizardOpen} onOpenChange={setServiceGroupWizardOpen}>
        <SheetContent
          side="right"
          className="w-full border-l border-border p-0 sm:max-w-[860px]"
        >
          <AdminSheetScaffold
            title={t.orders_service_group_wizard_title}
            description={t.orders_service_group_wizard_steps}
            headerClassName="px-4 py-3"
            bodyClassName="min-h-0 overscroll-y-contain space-y-4 px-5 py-4"
          >
            <OrderServiceGroupWizard
              embedded
              providers={providers}
              taxonomyNodes={taxonomyNodes}
              providerDoctors={providerDoctors}
              creating={serviceGroupCreating}
              error={serviceGroupWizardError}
              onLoadProviderDoctors={(providerId) =>
                void ensureProviderDoctors(providerId)
              }
              onCreate={handleCreateServiceGroup}
              onCreated={() => setServiceGroupWizardOpen(false)}
            />
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Sheet open={workflowCreateOpen} onOpenChange={setWorkflowCreateOpen}>
        <SheetContent
          side="right"
          className="w-full border-l border-border p-0 sm:max-w-[760px]"
        >
          <form className="flex h-full flex-col" onSubmit={handleAddWorkflowItem}>
            <AdminSheetScaffold
              title={l("orders_neuer_workflow_punkt")}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={l("orders_punkt_hinzufugen")}
                  submittingLabel={l("orders_wird_hinzugefugt")}
                  submitting={workflowBusy}
                  submitDisabled={!workflowForm.itemText.trim()}
                  onCancel={() => setWorkflowCreateOpen(false)}
                />
              }
              headerClassName="px-4 py-3"
              bodyClassName="min-h-0 overscroll-y-contain space-y-4 px-5 py-4"
            >
              <FormSection title={l("orders_workflow_punkt")}>
                <Field
                  label={l("orders_beschreibung")}
                  htmlFor="order-workflow-item-sheet"
                >
                  <Input
                    id="order-workflow-item-sheet"
                    value={workflowForm.itemText}
                    onChange={(event) =>
                      setWorkflowForm((current) => ({
                        ...current,
                        itemText: event.target.value,
                      }))
                    }
                    className={inputClassName}
                    placeholder={l("orders_eskalationsanruf_klinik_nachverfolgung_dokumentenubergab")}
                    disabled={workflowBusy}
                  />
                </Field>
              </FormSection>

              <FormSection title={l("orders_zustandigkeit")}>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field
                    htmlFor="order-workflow-owner-sheet"
                    label={l("orders_verantwortlich")}
                  >
                    <NativeComboboxSelect
                      id="order-workflow-owner-sheet"
                      className={selectClassName}
                      value={workflowForm.ownerUserId}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          ownerUserId: event.target.value,
                        }))
                      }
                      disabled={workflowBusy}
                    >
                      <option value="">
                        {l("orders_aktueller_benutzer")}
                      </option>
                      {activeWorkflowAssignments.map((item) => (
                        <option key={item.user_id} value={item.user_id}>
                          {item.user_name} · {roleLabel(item.user_role)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>

                  <Field
                    htmlFor="order-workflow-priority-sheet"
                    label={l("orders_prioritat")}
                  >
                    <NativeComboboxSelect
                      id="order-workflow-priority-sheet"
                      className={selectClassName}
                      value={workflowForm.priority}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          priority: event.target.value,
                        }))
                      }
                      disabled={workflowBusy}
                    >
                      {["low", "normal", "high", "urgent"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priorityLabel(priority)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>

                  <Field
                    htmlFor="order-workflow-due-sheet"
                    label={l("orders_fallig_bis")}
                  >
                    <Input
                      id="order-workflow-due-sheet"
                      type="datetime-local"
                      value={workflowForm.dueDate}
                      onChange={(event) =>
                        setWorkflowForm((current) => ({
                          ...current,
                          dueDate: event.target.value,
                        }))
                      }
                      className={inputClassName}
                      disabled={workflowBusy}
                    />
                  </Field>
                </div>
              </FormSection>
            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={createOpen} onOpenChange={resetCreateDialog}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
          <form className="flex h-full flex-col" onSubmit={handleCreateOrder}>
            <AdminSheetScaffold
              title={t.orders_create_title}
              description={t.orders_create_description}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submitting={createSaving}
                  submitDisabled={
                    (!!requestedAgencyServiceId &&
                      (!agencyServicesLoaded || !pendingCreateAgencyService)) ||
                    createRecheckLoading ||
                    (!!createForm.patientId &&
                      !createRecheck &&
                      !createRecheckLoading) ||
                    (!!createForm.patientId &&
                      createRecheck?.requires_recheck === true &&
                      !createRecheck.can_create_order)
                  }
                  onCancel={() => resetCreateDialog(false)}
                />
              }
            >
              <div className="space-y-4 rounded-xl">
                {createError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {createError}
                  </div>
                ) : null}

                {requestedAgencyServiceId ? (
                  <OrderSheetSection title={t.revenue_agency_service_catalog_items}>
                    {!agencyServicesLoaded ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />
                        {lang === "de"
                          ? "Leistungskatalog wird geladen …"
                          : "Загружается каталог услуг…"}
                      </div>
                    ) : pendingCreateAgencyService ? (
                      <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
                        <div className="font-medium text-foreground">
                          {agencyServiceNameLabel(
                            pendingCreateAgencyService.service_key,
                            pendingCreateAgencyService.service_name,
                            t,
                          )}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {pendingCreateAgencyService.description
                            ? agencyServiceDescriptionLabel(
                                pendingCreateAgencyService.service_key,
                                pendingCreateAgencyService.description,
                                t,
                              )
                            : t.common_not_set}
                        </div>
                        <div className="mt-2 text-xs font-medium text-foreground">
                          {formatMoney(
                            pendingCreateAgencyService.unit_price,
                            pendingCreateAgencyService.currency,
                          )}
                          {` · ${pendingCreateAgencyService.vat_rate}% ${t.finance_catalog_vat_label}`}
                        </div>
                      </div>
                    ) : (
                      <Banner tone="error" withIcon>
                        {lang === "de"
                          ? "Die ausgewählte Katalogleistung ist nicht mehr aktiv oder nicht verfügbar."
                          : "Выбранная позиция каталога больше не активна или недоступна."}
                      </Banner>
                    )}
                  </OrderSheetSection>
                ) : null}

                <OrderSheetSection title={l("orders_grunddaten")}>
                  <Field label={t.orders_patient}>
                    <NativeComboboxSelect
                      value={createForm.patientId || "__empty__"}
                      onChange={(event) => {
                        const patientId =
                          event.target.value && event.target.value !== "__empty__"
                            ? event.target.value
                            : "";
                        setCreateError(null);
                        setCreateRecheck(null);
                        setCreateForm((current) => ({
                          ...current,
                          patientId,
                        }));
                      }}
                      className={selectClassName}
                    >
                      <option value="__empty__">{t.orders_patient}</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patientLabel(patient, t.orders_patient_fallback)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                </OrderSheetSection>

                {createForm.patientId ? (
                  <OrderSheetSection title={l("orders_re_check_fur_bestandskunden")}>
                    <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {l("orders_stammdaten_compliance_identitat_dokumentenpaket_vertrags")}
                    </p>
                  </div>
                  {createRecheck ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full",
                        !createRecheck.requires_recheck ||
                          createRecheck.can_create_order
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700",
                      )}
                    >
                      {!createRecheck.requires_recheck
                        ? l("orders_nicht_erforderlich")
                        : createRecheck.can_create_order
                          ? l("orders_bereit_fur_auftrag")
                          : l("orders_blockiert_2")}
                    </Badge>
                  ) : null}
                </div>

                {createRecheckLoading ? (
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    {l("orders_patienten_re_check_wird_geladen")}
                  </div>
                ) : null}

                {createRecheckError ? (
                  <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {createRecheckError}
                  </div>
                ) : null}

                {createRecheck ? (
                  <div className="mt-4 space-y-4">
                    {createRecheck.requires_recheck ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {createRecheck.checks.map((check) => (
                          <div
                            key={check.key}
                            className="rounded-lg border border-border/70 bg-card px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-foreground">
                                {check.key === "base_data"
                                  ? l("orders_stammdaten_vollstandig")
                                  : check.key === "compliance"
                                    ? l("orders_compliance_dokumente_gultig")
                                    : check.key === "identity"
                                      ? l("orders_identitat_verifiziert")
                                      : check.key === "document_pack"
                                        ? l("orders_erforderliche_patientendokumente_vollstandig")
                                        : check.key === "contract"
                                          ? l("orders_vertragsunterlagen_gultig")
                                          : check.key === "debt_clear"
                                            ? l("orders_debt_hold_aufgehoben")
                                            : check.key === "passport_valid"
                                              ? l("orders_recheck_passport_valid")
                                              : check.label}
                              </span>
                              {check.key === "passport_valid" &&
                              check.status === "unknown" ? (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-slate-200 bg-slate-50 text-slate-600"
                                >
                                  {t.common_not_set}
                                </Badge>
                              ) : check.key === "passport_valid" &&
                              (check.status === "expired" ||
                                check.status === "expiring") ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    check.status === "expired"
                                      ? "border-rose-200 bg-rose-50 text-rose-700"
                                      : "border-amber-200 bg-amber-50 text-amber-700",
                                  )}
                                >
                                  {check.status === "expired"
                                    ? l("orders_recheck_passport_expired")
                                    : l("orders_recheck_passport_expiring")}
                                </Badge>
                              ) : (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    recheckBadgeClass(check.passed),
                                  )}
                                >
                                  {check.passed
                                    ? t.common_yes
                                    : l("orders_aktualisierung_notig")}
                                </Badge>
                              )}
                            </div>
                            {check.key === "passport_valid" &&
                            check.expiry &&
                            (check.status === "expired" ||
                              check.status === "expiring") ? (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {l("orders_recheck_passport_expires_on")}{" "}
                                {check.expiry}
                                {check.status === "expiring" &&
                                typeof check.days_until_expiry === "number"
                                  ? ` · ${check.days_until_expiry} ${l("orders_recheck_days")}`
                                  : ""}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {createRecheck.reason
                          ? localizedBlockingReason(createRecheck.reason)
                          : l("orders_vor_dem_ersten_operativen_auftrag_ist_kein_bestandskunde")}
                      </div>
                    )}

                    {createRecheck.requires_recheck &&
                    createRecheck.base_data_missing_fields.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        {l("orders_fehlende_stammdaten")}:{" "}
                        {createRecheck.base_data_missing_fields
                          .map((field) =>
                            recheckMissingFieldLabel(field, {
                              primary_contact: l("orders_hauptkontakt"),
                              country: l("orders_land"),
                              language: l("orders_bevorzugte_sprache"),
                            }, t),
                          )
                          .join(", ")}
                      </div>
                    ) : null}

                    {createRecheck.requires_recheck &&
                    createRecheck.blocking_reasons.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <div className="font-medium">
                          {l("orders_blockierende_grunde")}
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {createRecheck.blocking_reasons.map((reason) => (
                            <li key={reason}>{localizedBlockingReason(reason)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : createRecheck.requires_recheck ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {l("orders_der_bestandskunden_re_check_ist_vollstandig_der_patient")}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                      <div className="space-y-1">
                        <div>
                          {createRecheck.requires_recheck &&
                          !createRecheck.document_pack_ready &&
                          createRecheck.document_alerts.missing_count > 0
                            ? l("orders_recheck_missing_required_documents_count", {
                                count:
                                  createRecheck.document_alerts.missing_count,
                              })
                            : createRecheck.requires_recheck
                              ? l("orders_erforderliches_dokumentenpaket_ist_vollstandig")
                              : l("orders_fur_bestandskundendokumente_ist_noch_kein_check_erforder")}
                        </div>
                        <div>
                          {createRecheck.requires_recheck &&
                          createRecheck.debt_hold
                            ? l("orders_recheck_overdue_invoice_debt_hold_count", {
                                count: createRecheck.overdue_invoice_count,
                              })
                            : createRecheck.requires_recheck
                              ? l("orders_keine_uberfalligen_forderungen_erkannt")
                              : l("orders_debt_hold_wird_gepruft_sobald_eine_fruhere_kundenhistori")}
                        </div>
                        {createRecheck.requires_recheck &&
                        createRecheck.outstanding_balance ? (
                          <div>
                            {l("orders_offener_saldo")}:{" "}
                            {formatMoney(createRecheck.outstanding_balance)}
                          </div>
                        ) : null}
                        {createRecheck.requires_recheck &&
                        createRecheck.debt_management?.latest_workflow ? (
                          <div>
                            {l("orders_letzter_debt_workflow")}:{" "}
                            {
                              createRecheck.debt_management.latest_workflow
                                .order_number
                            }{" "}
                            /{" "}
                            {debtStatusLabel(
                              createRecheck.debt_management.latest_workflow
                                .effective_status,
                            )}
                            {createRecheck.debt_management.latest_workflow
                              .owner_name
                              ? ` / ${createRecheck.debt_management.latest_workflow.owner_name}`
                              : ""}
                          </div>
                        ) : null}
                        {createRecheck.latest_framework_contract ? (
                          <div>
                            {l("orders_letzter_rahmenvertrag")}:{" "}
                            {
                              createRecheck.latest_framework_contract
                                .contract_number
                            }{" "}
                            ({frameworkContractStatusLabel(
                              createRecheck.latest_framework_contract.status,
                            )})
                          </div>
                        ) : (
                          <div>
                            {l("orders_noch_kein_rahmenvertrag_hinterlegt")}
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg px-3.5"
                        onClick={() =>
                          staffGo(`/patients?patient=${createForm.patientId}`)
                        }
                      >
                        {l("orders_patientenprofil_offnen")}
                      </Button>
                    </div>
                  </div>
                ) : null}
                    </div>
                  </OrderSheetSection>
                ) : null}

                <OrderSheetSection title={l("orders_zusatzlich")}>
                  <Field label={t.orders_intake_note}>
                    <textarea
                      value={createForm.needsDescription}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          needsDescription: event.target.value,
                        }))
                      }
                      className={cn(textareaClassName, "min-h-[140px]")}
                      placeholder={tx.patients_notes}
                    />
                  </Field>
                </OrderSheetSection>
              </div>

            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={leistungOpen} onOpenChange={resetLeistungDialog}>
        <SheetContent
          side="right"
          className="w-full border-l border-border p-0 sm:max-w-[860px]"
        >
          <form onSubmit={handleAddLeistung} className="flex h-full min-h-0 flex-col">
            <AdminSheetScaffold
              title={t.orders_add_service_title}
              footer={
                <SheetFormFooter
                  cancelLabel={t.common_cancel}
                  submitLabel={t.common_save}
                  submittingLabel={t.common_save}
                  submitting={leistungSaving}
                  submitDisabled={leistungSaving}
                  onCancel={() => resetLeistungDialog(false)}
                />
              }
              headerClassName="px-4 py-3"
              bodyClassName="min-h-0 overscroll-y-contain space-y-4 px-5 py-4"
            >
            {leistungError ? (
              <Banner tone="error" withIcon>{leistungError}</Banner>
            ) : null}

            <OrderSheetSection title={l("orders_basis")}>
              <div className="grid gap-3 md:grid-cols-4">
                <Field
                  label={t.revenue_agency_service_catalog_items}
                  className="md:col-span-4"
                >
                  <NativeComboboxSelect
                    value={leistungForm.agencyServiceId}
                    onChange={(event) => {
                      const agencyServiceId = event.target.value;
                      const service = agencyServices.find(
                        (item) => item.id === agencyServiceId,
                      );
                      setLeistungForm((current) => ({
                        ...current,
                        agencyServiceId,
                        description: service
                          ? agencyServiceNameLabel(
                              service.service_key,
                              service.service_name,
                              t,
                            )
                          : current.description,
                        unitPrice: service
                          ? String(service.unit_price ?? "")
                          : current.unitPrice,
                        vatRate: service
                          ? String(service.vat_rate ?? "0")
                          : current.vatRate,
                      }));
                    }}
                    className={selectClassName}
                  >
                    <option value="">
                      {lang === "de"
                        ? "Individuelle Leistung ohne Katalogbezug"
                        : "Индивидуальная услуга без позиции каталога"}
                    </option>
                    {agencyServices.map((service) => (
                      <option key={service.id} value={service.id}>
                        {agencyServiceNameLabel(
                          service.service_key,
                          service.service_name,
                          t,
                        )}
                        {` · ${formatMoney(service.unit_price, service.currency)} · ${agencyServiceUnitLabel(service.unit_label, t)}`}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                  {leistungForm.agencyServiceId ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {(() => {
                        const service = agencyServices.find(
                          (item) => item.id === leistungForm.agencyServiceId,
                        );
                        return service?.description
                          ? agencyServiceDescriptionLabel(
                              service.service_key,
                              service.description,
                              t,
                            )
                          : t.common_not_set;
                      })()}
                    </p>
                  ) : null}
                </Field>
                <Field label={t.orders_service_description} className="md:col-span-2">
                  <Input
                    required
                    value={leistungForm.description}
                    onChange={(event) =>
                      setLeistungForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label={t.orders_service_notes} className="md:col-span-2">
                  <Input
                    value={leistungForm.notes}
                    onChange={(event) =>
                      setLeistungForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </Field>
              </div>
            </OrderSheetSection>

            <OrderSheetSection title={l("orders_kosten")}>
              <div className="grid gap-3 md:grid-cols-3">
                <Field label={t.orders_service_quantity}>
                  <Input
                    value={leistungForm.quantity}
                    onChange={(event) =>
                      setLeistungForm((current) => ({
                        ...current,
                        quantity: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label={t.orders_service_unit_price}>
                  <Input
                    value={leistungForm.unitPrice}
                    onChange={(event) =>
                      setLeistungForm((current) => ({
                        ...current,
                        unitPrice: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </Field>
                <Field label={t.orders_service_vat_percent}>
                  <Input
                    value={leistungForm.vatRate}
                    onChange={(event) =>
                      setLeistungForm((current) => ({
                        ...current,
                        vatRate: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </Field>
              </div>
            </OrderSheetSection>

            <OrderSheetSection title={t.orders_service_group_doctors}>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t.orders_service_provider}>
                  <ProviderSelectWithTaxonomyFilter
                    value={leistungForm.providerId}
                    providers={providers}
                    taxonomyNodes={taxonomyNodes}
                    providerPlaceholder={t.common_provider}
                    taxonomyPlaceholder={t.providers_category}
                    taxonomyAllLabel={t.providers_all}
                    containerClassName="grid-cols-1 sm:grid-cols-2"
                    taxonomySelectClassName={selectClassName}
                    providerSelectClassName={selectClassName}
                    providerLabel={(provider) =>
                      provider.address_city
                        ? `${provider.name} (${provider.address_city})`
                        : provider.name
                    }
                    onChange={(providerId) => {
                      setLeistungForm((current) => ({
                        ...current,
                        providerId,
                        doctorId: "",
                      }));
                    }}
                  />
                </Field>
                <Field label={t.orders_service_doctor}>
                  <NativeComboboxSelect
                    value={leistungForm.doctorId}
                    onChange={(event) =>
                      setLeistungForm((current) => ({
                        ...current,
                        doctorId: event.target.value,
                      }))
                    }
                    className={selectClassName}
                    disabled={!leistungForm.providerId}
                  >
                    <option value="">{t.common_doctor}</option>
                    {leistungDoctorOptions.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                        {doctorSpecialtyLabel(doctor, lang) ? ` (${doctorSpecialtyLabel(doctor, lang)})` : ""}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
              </div>
            </OrderSheetSection>

            <OrderSheetSection title={t.orders_supporting_document}>
            <div className={cn("rounded-lg px-4 py-3", tokens.surface.mutedCard)}>
              <label
                htmlFor="leistung-cost-passthrough"
                aria-label={t.orders_treat_as_cost_pass_through}
                className="flex items-start gap-3"
              >
                <input
                  id="leistung-cost-passthrough"
                  type="checkbox"
                  checked={leistungForm.isCostPassthrough}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      isCostPassthrough: event.target.checked,
                      externalDocumentId: event.target.checked
                        ? current.externalDocumentId
                        : "",
                    }))
                  }
                  className={cn(checkboxClass, "mt-1")}
                />
                <span>
                  <div className="text-sm font-medium text-foreground">
                    {t.orders_treat_as_cost_pass_through}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {t.orders_cost_pass_through_hint}
                  </div>
                </span>
              </label>
            </div>

            {leistungForm.isCostPassthrough ? (
              <Field label={t.orders_supporting_document}>
                <NativeComboboxSelect
                  value={leistungForm.externalDocumentId}
                  onChange={(event) =>
                    setLeistungForm((current) => ({
                      ...current,
                      externalDocumentId: event.target.value,
                    }))
                  }
                  className={selectClassName}
                >
                  <option value="">
                    {t.orders_supporting_document_select_hint}
                  </option>
                  {supportingDocumentOptions.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.auto_name ||
                        document.original_filename ||
                        document.id}
                      {document.art ? ` · ${localizeDocumentCode(document.art, l)}` : ""}
                      {document.original_filename
                        ? ` · ${document.original_filename}`
                        : ""}
                    </option>
                  ))}
                </NativeComboboxSelect>
                <p className="mt-2 text-xs text-muted-foreground">
                  {t.orders_supporting_document_pin_hint}
                </p>
              </Field>
            ) : null}
            </OrderSheetSection>

            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}

export function OrdersPage(...args: Parameters<typeof useOrdersPageContent>) {
  return useOrdersPageContent(...args);
}
