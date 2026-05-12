import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  Wallet,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  AdminSheetScaffold,
  AdminInlineMetric,
  AdminTableCard,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Banner,
  Field,
  PageHeader,
  StatusBadge,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClassName,
  textareaClass as shellTextareaClass,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatEnumLabel, formatEnumLabelFromKeys, type TranslationKey, useLang } from "@/lib/i18n";
import { localizeDocumentCode } from "@/lib/required-document-labels";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
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
  phaseClassName,
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
  updateOrderPlanningPreparation,
  updateOrderProcessGates,
} from "./data/order-api";
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
  ExternalInvoiceStatus,
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
  SupportingDocumentOption,
  WorkflowChecklistItem,
  WorkflowChecklistFormState,
  WorkflowChecklistResponse,
} from "./model/types";
import {
  OrderServiceGroupPanel,
  OrderServiceGroupWizard,
} from "./ui/order-service-group-panel";

const ORDER_REALTIME_EVENTS = [
  "order.created",
  "order.phase_changed",
  "order.process_gates_updated",
  "order.debt_management_updated",
  "order.planning_preparation_updated",
  "order.execution_flow_updated",
  "order.followup_flow_updated",
  "order.external_invoice_created",
  "order.external_invoice_updated",
  "order.external_invoice_overdue",
  "order.leistung_added",
  "order.leistung_approved",
  "task.created",
  "task.status_changed",
  "workflow_checklist_item.created",
  "workflow_checklist_item.completed",
] as const;

type StatCardProps = {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
};

type SectionCardProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

type DetailFieldProps = {
  label: string;
  value: ReactNode;
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
const ORDER_TASK_STATUS_LABEL_KEYS = {
  open: "orders_task_status_open",
  in_progress: "orders_task_status_in_progress",
  completed: "orders_task_status_completed",
  done: "orders_task_status_completed",
  cancelled: "orders_task_status_cancelled",
} satisfies Partial<Record<string, TranslationKey>>;

function StatCard({ label, value, description, icon }: StatCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className={tokens.text.eyebrow}>{label}</div>
          <div className="text-xl font-semibold tracking-tight text-foreground">
            {value}
          </div>
        </div>
        <div className="rounded-xl border border-border bg-muted/30 p-2 text-muted-foreground">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

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
        "overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
    >
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
            <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
            <span>{title}</span>
          </h2>
          {description ? (
            <p className={tokens.text.muted}>{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="p-4">{children}</div>
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
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className={tokens.text.sectionTitle}>{titleWithDot(title)}</h2>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className={cn("rounded-xl p-3", tokens.surface.card)}>
      <div className={tokens.text.eyebrow}>{label}</div>
      <div className="mt-2 text-sm text-foreground">{value}</div>
    </div>
  );
}

function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className={cn("rounded-xl px-6 py-10 text-center", tokens.surface.dashed)}>
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <div className="rounded-xl border border-border bg-card p-3 text-muted-foreground">
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

function titleWithDot(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-2 rounded-full bg-amber-500" />
      <span>{title}</span>
    </span>
  );
}

function eyebrowWithDot(label: ReactNode) {
  return (
    <span className={cn("inline-flex items-center gap-2", tokens.text.eyebrow)}>
      <span aria-hidden className="size-2 rounded-full bg-amber-500" />
      <span>{label}</span>
    </span>
  );
}

type OrdersPageState = {
  filters: OrdersFilters;
  orders: OrderSummary[];
  loading: boolean;
  listError: string | null;
  reloadNonce: number;
  patients: PatientOption[];
  providers: ProviderOption[];
  providerDoctors: Record<string, DoctorOption[]>;
  orderDocuments: SupportingDocumentOption[];
  selectedOrderId: string | null;
  orderDetail: OrderDetail | null;
  orderServiceGroups: OrderServiceGroup[];
  serviceGroupPreviews: Record<string, OrderServiceGroupLinePreview>;
  serviceGroupsLoading: boolean;
  serviceGroupsError: string | null;
  serviceGroupWizardError: string | null;
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
  const l = useCallback((de: string, ru: string) => (lang === "de" ? de : ru), [lang]);
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
        ? l("Bedarfsklärung", "Уточнение потребности")
        : value,
    [l],
  );
  const phaseLabels = useMemo(
    () => ({
      discovery: l("Bedarfsklärung", "Уточнение потребности"),
      intake: l("Aufnahme", "Оформление"),
      execution: l("Durchführung", "Исполнение"),
      closure: l("Abschluss", "Закрытие"),
      followup: l("Nachsorge", "Наблюдение"),
    }),
    [l],
  );
  const workflowGroupLabels = useMemo(
    () => ({
      ...phaseLabels,
      custom: l("Individuell", "Индивидуально"),
    }),
    [l, phaseLabels],
  );
  const orderStatusLabels = useMemo(
    () => ({
      active: l("Aktiv", "Активен"),
      paused: l("Pausiert", "На паузе"),
      completed: l("Abgeschlossen", "Завершён"),
      cancelled: l("Storniert", "Отменён"),
    }),
    [l],
  );
  const frameworkContractStatusLabels = useMemo(
    () => ({
      draft: l("Entwurf", "Черновик"),
      sent: l("Versendet", "Отправлено"),
      signed: l("Unterzeichnet", "Подписано"),
      expired: l("Abgelaufen", "Истекло"),
      terminated: l("Beendet", "Прекращено"),
    }),
    [l],
  );
  const debtStatusLabels = useMemo(
    () => ({
      review_required: l("Review erforderlich", "Требуется ревью"),
      payment_plan: l("Zahlungsplan", "План оплаты"),
      awaiting_payment: l("Zahlung ausstehend", "Ожидание оплаты"),
      escalated: l("Eskaliert", "Эскалировано"),
      cleared: l("Geklärt", "Снято"),
      not_required: l("Nicht erforderlich", "Не требуется"),
    }),
    [l],
  );
  const billingReleaseLabels = useMemo(
    () => ({
      pending: l("Ausstehend", "Ожидается"),
      granted: l("Freigegeben", "Разрешено"),
      denied: l("Abgelehnt", "Отклонено"),
    }),
    [l],
  );
  const packageCoverageLabels = useMemo(
    () => ({
      unknown: l("Unbekannt", "Неизвестно"),
      covered: l("Abgedeckt", "Покрыто"),
      not_covered: l("Nicht abgedeckt", "Не покрыто"),
    }),
    [l],
  );
  const roleLabels = useMemo(
    () => ({
      ceo: "CEO",
      ceo_assistant: l("CEO-Assistenz", "Ассистент CEO"),
      admin: l("Admin", "Администратор"),
      assistant: l("CEO-Assistenz", "Ассистент CEO"),
      patient_manager: l("Patientenmanagement", "Пациент-менеджер"),
      billing: l("Billing", "Billing"),
      sales: l("Vertrieb", "Отдел продаж"),
      it_admin: l("IT-Admin", "IT-администратор"),
      patient: l("Patient", "Пациент"),
      concierge: l("Concierge", "Консьерж"),
      interpreter: l("Dolmetscher", "Переводчик"),
      teamlead_interpreter: l("Dolmetscher-Teamlead", "Тимлид переводчиков"),
      debt_owner: l("Debt-Owner", "Ответственный по debt"),
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
    formatDate(value, locale, l("Nicht festgelegt", "Не указано"));
  const formatDateTimeLabel = (value: string | null | undefined) =>
    formatDateTime(value, locale, l("Nicht festgelegt", "Не указано"));
  const formatDateOnlyLabel = (value: string | null | undefined) =>
    formatDateOnly(value, locale, l("Nicht festgelegt", "Не указано"));
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
      draft: l("Entwurf", "Черновик"),
      delivered: l("Erbracht", "Оказано"),
      approved: l("Freigegeben", "Утверждено"),
      cancelled: l("Storniert", "Отменено"),
    });
  const externalInvoiceStatusLabel = (value: string) =>
    labelFor(value, {
      expected: l("Erwartet", "Ожидается"),
      received: l("Eingegangen", "Получен"),
      approved: l("Freigegeben", "Утверждён"),
      paid: l("Bezahlt", "Оплачен"),
      overdue: l("Überfällig", "Просрочен"),
      cancelled: l("Storniert", "Отменён"),
    });
  const treatmentPlanStatusLabel = (value: string) =>
    labelFor(value, {
      draft: l("Entwurf", "Черновик"),
      agreed: l("Abgestimmt", "Согласовано"),
      correction_requested: l("Korrektur angefragt", "Запрошена корректировка"),
      finalized: l("Finalisiert", "Финализировано"),
    });
  const preparationDocumentStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("Dokumente ausstehend", "Документы ожидаются"),
      sent: l("Dokumente versendet", "Документы отправлены"),
      not_required: l("Dokumente nicht erforderlich", "Документы не требуются"),
    });
  const interpreterBriefingStatusLabel = (value: string) =>
    labelFor(value, {
      not_needed: l("Nicht erforderlich", "Не требуется"),
      pending: l("Briefing ausstehend", "Брифинг ожидается"),
      completed: l("Briefing abgeschlossen", "Брифинг завершён"),
    });
  const arrivalStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("Ankunft ausstehend", "Прибытие ожидается"),
      arrived: l("Angekommen", "Прибыл"),
      not_required: l("Nicht erforderlich", "Не требуется"),
    });
  const executionStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("Ausstehend", "Ожидается"),
      in_progress: l("In Bearbeitung", "В работе"),
      completed: l("Abgeschlossen", "Завершено"),
      not_required: l("Nicht erforderlich", "Не требуется"),
    });
  const issueStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("Offene Punkte", "Есть открытые вопросы"),
      monitoring: l("Unter Beobachtung", "Под наблюдением"),
      resolved: l("Geklärt", "Закрыто"),
      not_required: l("Keine Punkte", "Нет вопросов"),
    });
  const followupStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("Ausstehend", "Ожидается"),
      scheduled: l("Geplant", "Запланировано"),
      completed: l("Abgeschlossen", "Завершено"),
      not_required: l("Nicht erforderlich", "Не требуется"),
    });
  const resultsHandoffStatusLabel = (value: string) =>
    labelFor(value, {
      pending: l("Ausstehend", "Ожидается"),
      completed: l("Abgeschlossen", "Завершено"),
      not_required: l("Nicht erforderlich", "Не требуется"),
    });
  const priorityLabel = (value: string) =>
    labelFor(value, {
      low: l("Niedrig", "Низкий"),
      normal: l("Normal", "Обычный"),
      high: l("Hoch", "Высокий"),
      urgent: l("Dringend", "Срочный"),
    });
  const transitionKindLabel = (value: string) =>
    labelFor(value, {
      created: l("Erstellt", "Создано"),
      phase_change: l("Phasenwechsel", "Смена фазы"),
    });
  const roleLabel = (value: string) => labelFor(value, roleLabels);
  const localizedBlockingReason = (reason: string) => {
    const exact =
      lang === "de"
        ? {
            "Billing release is not granted and package coverage is not confirmed":
              "Billing-Release fehlt und die Paketdeckung ist nicht bestätigt.",
            "Order signatures are still incomplete":
              "Die Auftragssignaturen sind noch nicht vollständig.",
            "Advance invoice exists but payment is still missing":
              "Es gibt eine Vorausrechnung, aber die Zahlung fehlt noch.",
            "Treatment plan must be finalized before execution":
              "Der Behandlungsplan muss vor der Durchführung finalisiert sein.",
            "At least one confirmed medical appointment is required":
              "Mindestens ein bestätigter medizinischer Termin ist erforderlich.",
            "Required non-medical services still need a confirmed booking":
              "Erforderliche nicht-medizinische Leistungen brauchen noch eine bestätigte Buchung.",
            "Interpreter is required but not assigned yet":
              "Ein Dolmetscher ist erforderlich, aber noch nicht zugewiesen.",
            "Assigned interpreter has not confirmed yet":
              "Der zugewiesene Dolmetscher hat noch nicht bestätigt.",
            "Interpreter briefing is still pending":
              "Das Dolmetscher-Briefing ist noch ausstehend.",
            "Preparation documents still need to be sent":
              "Vorbereitungsunterlagen müssen noch versendet werden.",
            "Patient arrival or execution start is not recorded yet":
              "Patientenankunft oder Durchführungsstart sind noch nicht erfasst.",
            "Medical execution must be completed and backed by delivered appointments or services":
              "Die medizinische Durchführung muss abgeschlossen und durch erbrachte Termine oder Leistungen belegt sein.",
            "Required non-medical services still need execution confirmation":
              "Erforderliche nicht-medizinische Leistungen brauchen noch eine Durchführungsbestätigung.",
            "Interpreter-supported execution still needs completion or report confirmation":
              "Dolmetscher-gestützte Durchführung braucht noch Abschluss oder Berichtbestätigung.",
            "Execution deviations or incidents must be resolved or marked as not required":
              "Abweichungen oder Vorfälle müssen geklärt oder als nicht erforderlich markiert werden.",
            "Results, Arztbrief or final patient handoff still need to be released":
              "Ergebnisse, Arztbrief oder finale Patientenübergabe müssen noch freigegeben werden.",
            "Doctor-directed follow-up is required but not scheduled yet":
              "Arztgesteuertes Follow-up ist erforderlich, aber noch nicht terminiert.",
            "1-week follow-up is not scheduled yet":
              "Das 1-Wochen-Follow-up ist noch nicht terminiert.",
            "1-month follow-up is not scheduled yet":
              "Das 1-Monats-Follow-up ist noch nicht terminiert.",
            "6-month follow-up is not scheduled yet":
              "Das 6-Monats-Follow-up ist noch nicht terminiert.",
            "Package-end follow-up is required but not scheduled yet":
              "Follow-up zum Paketende ist erforderlich, aber noch nicht terminiert.",
            "No follow-up reminder, task or appointment has been launched yet":
              "Es wurde noch keine Follow-up-Erinnerung, Aufgabe oder kein Termin gestartet.",
            "Primary contact is missing": "Hauptkontakt fehlt.",
            "Residence or address country is missing":
              "Wohnsitz- oder Adressland fehlt.",
            "Preferred language is missing": "Bevorzugte Sprache fehlt.",
            "Compliance status is not completed":
              "Der Compliance-Status ist nicht abgeschlossen.",
            "DSGVO/compliance documents are not signed":
              "DSGVO-/Compliance-Dokumente sind nicht unterschrieben.",
            "Identity is not verified": "Die Identität ist nicht verifiziert.",
            "Valid contract documentation is missing":
              "Gültige Vertragsdokumentation fehlt.",
            "Patient is still in debt-management hold":
              "Der Patient befindet sich noch im Debt-Hold.",
            "Existing-customer re-check is not required before the first operational order":
              "Vor dem ersten operativen Auftrag ist kein Bestandskunden-Re-Check erforderlich.",
          }[reason]
        : {
            "Billing release is not granted and package coverage is not confirmed":
              "Billing release не выдан, и покрытие пакетом не подтверждено.",
            "Order signatures are still incomplete":
              "Подписи по заказу ещё не завершены.",
            "Advance invoice exists but payment is still missing":
              "Есть авансовый счёт, но оплата ещё не поступила.",
            "Treatment plan must be finalized before execution":
              "План лечения должен быть финализирован до исполнения.",
            "At least one confirmed medical appointment is required":
              "Нужен минимум один подтверждённый медицинский приём.",
            "Required non-medical services still need a confirmed booking":
              "Обязательные немедицинские услуги ещё требуют подтверждённого бронирования.",
            "Interpreter is required but not assigned yet":
              "Переводчик требуется, но ещё не назначен.",
            "Assigned interpreter has not confirmed yet":
              "Назначенный переводчик ещё не подтвердил участие.",
            "Interpreter briefing is still pending":
              "Брифинг переводчика ещё ожидает выполнения.",
            "Preparation documents still need to be sent":
              "Подготовительные документы ещё нужно отправить.",
            "Patient arrival or execution start is not recorded yet":
              "Прибытие пациента или начало исполнения ещё не зафиксированы.",
            "Medical execution must be completed and backed by delivered appointments or services":
              "Медицинская часть должна быть завершена и подтверждена оказанными приёмами или услугами.",
            "Required non-medical services still need execution confirmation":
              "Обязательные немедицинские услуги ещё требуют подтверждения исполнения.",
            "Interpreter-supported execution still needs completion or report confirmation":
              "Исполнение с участием переводчика ещё требует завершения или подтверждения отчёта.",
            "Execution deviations or incidents must be resolved or marked as not required":
              "Отклонения или инциденты исполнения должны быть закрыты или помечены как не требующие действий.",
            "Results, Arztbrief or final patient handoff still need to be released":
              "Результаты, Arztbrief или финальная передача пациенту ещё должны быть выпущены.",
            "Doctor-directed follow-up is required but not scheduled yet":
              "Follow-up по назначению врача требуется, но ещё не запланирован.",
            "1-week follow-up is not scheduled yet":
              "Недельный follow-up ещё не запланирован.",
            "1-month follow-up is not scheduled yet":
              "Месячный follow-up ещё не запланирован.",
            "6-month follow-up is not scheduled yet":
              "Шестимесячный follow-up ещё не запланирован.",
            "Package-end follow-up is required but not scheduled yet":
              "Follow-up по завершению пакета требуется, но ещё не запланирован.",
            "No follow-up reminder, task or appointment has been launched yet":
              "Ещё не запущено ни одного напоминания, задачи или приёма по follow-up.",
            "Primary contact is missing": "Не указан основной контакт.",
            "Residence or address country is missing":
              "Не указана страна проживания или адреса.",
            "Preferred language is missing": "Не указан предпочитаемый язык.",
            "Compliance status is not completed":
              "Статус compliance не завершён.",
            "DSGVO/compliance documents are not signed":
              "Документы DSGVO/compliance не подписаны.",
            "Identity is not verified": "Личность не подтверждена.",
            "Valid contract documentation is missing":
              "Нет действующего договорного пакета.",
            "Patient is still in debt-management hold":
              "Пациент всё ещё находится в debt-hold.",
            "Existing-customer re-check is not required before the first operational order":
              "Повторная проверка существующего клиента не требуется перед первым операционным заказом.",
          }[reason];
    if (exact) return exact;
    const executionChecklistMatch = reason.match(
      /^(\\d+) execution checklist item\\(s\\) remain open$/,
    );
    if (executionChecklistMatch) {
      const count = Number(executionChecklistMatch[1]);
      return l(
        `${count} Punkt(e) der Durchführungs-Checkliste sind noch offen.`,
        `${count} пункт(ов) чек-листа исполнения ещё открыто.`,
      );
    }
    const missingDocsMatch = reason.match(
      /^(\\d+) required patient document\\(s\\) are missing$/,
    );
    if (missingDocsMatch) {
      const count = Number(missingDocsMatch[1]);
      return l(
        `${count} erforderliche Patientendokument(e) fehlen.`,
        `Не хватает ${count} обязательных документ(ов) пациента.`,
      );
    }
    return reason;
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
      providerDoctors: {},
      orderDocuments: [],
      selectedOrderId: routeOrderId || null,
      orderDetail: null,
      orderServiceGroups: [],
      serviceGroupPreviews: {},
      serviceGroupsLoading: false,
      serviceGroupsError: null,
      serviceGroupWizardError: null,
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
    workflowAssignments,
    workflowBusy,
    workflowChecklist,
    workflowForm,
  } = ordersPageState;
  const setOrdersPageField = <K extends keyof OrdersPageState>(
    field: K,
    nextValue: SetStateAction<OrdersPageState[K]>,
  ) => dispatchOrdersPageState(createOrdersPageFieldPatch(field, nextValue));
  const setFilters = (nextValue: SetStateAction<OrdersFilters>) =>
    setOrdersPageField("filters", nextValue);
  const deferredSearch = useDeferredValue(filters.search);
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

  const metrics = useMemo(() => {
    const active = orders.filter((item) => item.status === "active").length;
    const execution = orders.filter(
      (item) => item.phase === "execution" || item.phase === "closure",
    ).length;
    const estimatedTotal = orders.reduce((sum, item) => {
      return sum + (numberFromUnknown(item.total_estimated) ?? 0);
    }, 0);

    return {
      total: orders.length,
      active,
      execution,
      estimatedTotal,
    };
  }, [orders]);

  const orderTableColumns: ColumnDef<OrderSummary>[] = [
    {
      id: "order_number",
      label: l("Auftrag", "Заказ"),
      accessor: (row) => row.order_number,
      filterType: "text",
      group: "identity",
      sortable: true,
      searchable: true,
      required: true,
      pinned: "left",
      width: 160,
      render: (row) => (
        <span className="font-mono text-xs font-semibold tracking-[0.12em] text-foreground">
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
        <span className="text-sm font-medium text-foreground">{row.patient_name}</span>
      ),
    },
    {
      id: "patient_pid",
      label: "PID",
      accessor: (row) => row.patient_pid,
      filterType: "text",
      group: "identity",
      sortable: true,
      searchable: true,
      width: 140,
      render: (row) => <span className="text-xs text-foreground">{row.patient_pid}</span>,
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
      label: l("Erstellt", "Создано"),
      accessor: (row) => row.created_at,
      filterType: "date",
      group: "audit",
      sortable: true,
      width: 160,
      render: (row) => (
        <span className="text-sm text-foreground">
          {formatDateOnlyLabel(row.created_at)}
        </span>
      ),
    },
    {
      id: "total_estimated",
      label: l("Geschaftsvolumen", "Оценочный объём"),
      accessor: (row) => numberFromUnknown(row.total_estimated) ?? 0,
      filterType: "number",
      group: "finance",
      sortable: true,
      width: 170,
      render: (row) => (
        <span className="block text-right text-sm font-medium tabular-nums text-foreground">
          {formatMoney(row.total_estimated)}
        </span>
      ),
    },
  ];

  const leistungMetrics = useMemo(() => {
    const items = orderDetail?.leistungen ?? [];
    return {
      total: items.length,
      delivered: items.filter((item) => item.status === "delivered").length,
      approved: items.filter((item) => item.status === "approved").length,
      gross: sumLeistungTotals(items),
    };
  }, [orderDetail]);
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
  const nextLifecycleTransition = useMemo(
    () => orderDetail?.lifecycle?.allowed_transitions?.[0] ?? null,
    [orderDetail?.lifecycle],
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
        user_name: currentOwnerName ?? l("Aktueller Owner", "Текущий ответственный"),
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
    setServiceGroupCreating(false);
    setServiceGroupsLoading(false);
    setGeneratingServiceGroupId(null);
    setWorkflowChecklist(null);
    setWorkflowAssignments([]);
    setDetailError(null);
    setPhaseDraft("");
    setProcessGateError(null);
    setProcessGateForm(blankOrderProcessGateForm());
  }, []);

  function buildOrderWorkspaceHref(
    orderId: string,
    section: OrderSectionKey = DEFAULT_ORDER_SECTION,
    patientIdOverride = "",
  ) {
    const params = new URLSearchParams();
    const patientId = patientIdOverride || filters.patientId || patientContextId;
    const providerId = filters.providerId || searchParams.get("provider") || "";
    const doctorId = filters.doctorId || searchParams.get("doctor") || "";

    if (patientId) params.set("patient", patientId);
    if (providerId) params.set("provider", providerId);
    if (doctorId) params.set("doctor", doctorId);
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

  function openOrder(orderId: string, patientId?: string | null) {
    setDetailError(null);
    setDetailLoading(true);
    startTransition(() => {
      setSelectedOrderId(orderId);
    });
    staffGo(buildOrderWorkspaceHref(orderId, DEFAULT_ORDER_SECTION, patientId ?? ""));
  }

  function resetCreateDialog(open: boolean) {
    setCreateOpen(open);
    if (!open) {
      setCreateError(null);
      setCreateForm(blankCreateOrderForm());
      setCreateSaving(false);
      setCreateRecheck(null);
      setCreateRecheckError(null);
      setCreateRecheckLoading(false);
    }
  }

  function resetLeistungDialog(open: boolean) {
    setLeistungOpen(open);
    if (!open) {
      setLeistungError(null);
      setLeistungForm(blankLeistungForm());
      setLeistungSaving(false);
    }
  }

  const hydrateFiltersFromRoute = useCallback(
    (patientParam: string, providerParam: string, doctorParam: string) => {
      setFilters((current) => {
        if (
          current.patientId === patientParam &&
          current.providerId === providerParam &&
          current.doctorId === doctorParam
        ) {
          return current;
        }
        return {
          ...current,
          patientId: patientParam,
          providerId: providerParam,
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
  }, []);

  const clearOrderDirectory = useCallback(() => {
    setPatients([]);
    setProviders([]);
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
        : "Failed to load patient re-check",
    );
  }, []);

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
      error instanceof Error ? error.message : "Failed to load orders",
    );
    setOrders([]);
  }, []);

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
        : "Failed to load debt-management queue",
    );
  }, []);

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
      error instanceof Error ? error.message : "Failed to load order",
    );
  }, []);

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

    hydrateFiltersFromRoute(patientParam, providerParam, doctorParam);

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
        const response = await fetchOrderDebtQueue();
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
      setCreateError("Patient is required");
      return;
    }
    if (createRecheckLoading) {
      setCreateError("Existing customer re-check is still loading");
      return;
    }
    if (!createRecheck) {
      setCreateError(createRecheckError ?? "Failed to load patient re-check");
      return;
    }
    if (createRecheck?.requires_recheck && !createRecheck.can_create_order) {
      setCreateError(
        createRecheck?.blocking_reasons?.[0] ??
          "Existing customer re-check is incomplete",
      );
      return;
    }

    setCreateSaving(true);
    setCreateError(null);
    try {
      const created = await createOrder({
        patient_id: createForm.patientId,
        contract_id: null,
        needs_description: optString(createForm.needsDescription),
      });

      resetCreateDialog(false);
      openOrder(created.id, createForm.patientId);
      triggerReload();
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create order",
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
        `Only the next lifecycle phase is allowed: ${orderDetail.lifecycle.next_stage}`,
      );
      return;
    }

    setPhaseSaving(true);
    setPhaseError(null);
    try {
      await updateOrderPhase(selectedOrderId, phaseDraft);
      triggerReload();
    } catch (error) {
      setPhaseError(
        error instanceof Error ? error.message : "Failed to update phase",
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
        setPhaseError(null);
        triggerReload();
      })
      .catch((error: unknown) => {
        setPhaseDraft(orderDetail.phase);
        setPhaseError(
          error instanceof Error ? error.message : "Failed to advance phase",
        );
      });
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
      triggerReload();
    } catch (error) {
      setProcessGateError(
        error instanceof Error
          ? error.message
          : "Failed to update debt-management workflow",
      );
    } finally {
      setProcessGateBusy(false);
    }
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
          : "Failed to update billing release",
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
          : "Failed to update package coverage",
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
          : "Failed to update planning/preparation",
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
          : "Failed to update execution flow",
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
          : "Failed to update follow-up flow",
      );
    } finally {
      setFollowupBusy(false);
    }
  }

  async function handleAddLeistung(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedOrderId) {
      setLeistungError("Select an order first");
      return;
    }

    const quantity = Number(leistungForm.quantity.replace(",", "."));
    const unitPrice = Number(leistungForm.unitPrice.replace(",", "."));
    const vatRate = Number(leistungForm.vatRate.replace(",", "."));

    if (!leistungForm.description.trim()) {
      setLeistungError("Description is required");
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setLeistungError("Quantity must be a positive number");
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setLeistungError("Unit price must be numeric");
      return;
    }
    if (!Number.isFinite(vatRate) || vatRate < 0) {
      setLeistungError("VAT must be numeric");
      return;
    }

    setLeistungSaving(true);
    setLeistungError(null);
    try {
      await createOrderLeistung(selectedOrderId, {
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
        error instanceof Error ? error.message : "Failed to add Leistung",
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
        error instanceof Error ? error.message : "Failed to approve Leistung",
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
      setServiceGroupWizardError("Select an order first");
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
      setExternalInvoiceError("Select an order first");
      return;
    }
    if (!externalInvoiceForm.externalInvoiceNumber.trim()) {
      setExternalInvoiceError("External invoice number is required");
      return;
    }

    const amountNet = Number(externalInvoiceForm.amountNet.replace(",", "."));
    const amountVat = Number(externalInvoiceForm.amountVat.replace(",", "."));
    const amountGross = Number(
      externalInvoiceForm.amountGross.replace(",", "."),
    );

    if (!Number.isFinite(amountGross) || amountGross < 0) {
      setExternalInvoiceError("Gross amount must be numeric");
      return;
    }
    if (
      externalInvoiceForm.amountNet.trim() &&
      (!Number.isFinite(amountNet) || amountNet < 0)
    ) {
      setExternalInvoiceError("Net amount must be numeric");
      return;
    }
    if (
      externalInvoiceForm.amountVat.trim() &&
      (!Number.isFinite(amountVat) || amountVat < 0)
    ) {
      setExternalInvoiceError("VAT amount must be numeric");
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
        notes: optString(externalInvoiceForm.notes),
      });
      setExternalInvoiceForm(blankExternalInvoiceForm());
      triggerReload();
    } catch (error) {
      setExternalInvoiceError(
        error instanceof Error
          ? error.message
          : "Failed to create external invoice",
      );
    } finally {
      setExternalInvoiceSaving(false);
    }
  }

  async function handleUpdateExternalInvoiceStatus(
    externalInvoiceId: string,
    status: ExternalInvoiceStatus,
  ) {
    if (!selectedOrderId) return;

    setExternalInvoiceUpdatingId(externalInvoiceId);
    setDetailError(null);
    try {
      await updateExternalInvoice(selectedOrderId, externalInvoiceId, { status });
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : "Failed to update external invoice",
      );
    } finally {
      setExternalInvoiceUpdatingId(null);
    }
  }

  async function handleAddWorkflowItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrderId || !workflowForm.itemText.trim()) {
      setDetailError("Checklist item text is required");
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
      triggerReload();
    } catch (error) {
      setDetailError(
        error instanceof Error
          ? error.message
          : "Failed to create checklist item",
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
          : "Failed to complete checklist item",
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
    filters.doctorId !== "";

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

      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
        <AdminInlineMetric
          icon={ClipboardList}
          label={tx.orders_title}
          value={String(metrics.total)}
          description={t.orders_metric_total_description}
          tone="sky"
        />
        <AdminInlineMetric
          icon={CheckCircle2}
          label={t.orders_metric_active_label}
          value={String(metrics.active)}
          description={t.orders_metric_active_description}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={Stethoscope}
          label={t.orders_metric_execution_label}
          value={String(metrics.execution)}
          description={t.orders_metric_execution_description}
          tone="amber"
        />
        <AdminInlineMetric
          icon={Wallet}
          label={t.orders_metric_business_volume_label}
          value={formatMoney(metrics.estimatedTotal)}
          description={t.orders_metric_business_volume_description}
          tone="slate"
        />
      </div>

      {canManageDebt ? (
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className={tokens.text.sectionTitle}>
                {titleWithDot(
                  l(
                    "Orders blocked by overdue receivables or an open debt workflow",
                    "Заказы, заблокированные просроченной задолженностью или открытым debt-workflow",
                  ),
                )}
              </h2>
              <p className={cn(tokens.text.muted, "mt-2 max-w-3xl")}>
                {l(
                  "Auftrage, die durch uberfallige Forderungen oder einen offenen Debt-Workflow blockiert sind.",
                  "Заказы, заблокированные просроченной задолженностью или открытым debt-workflow.",
                )}
              </p>
            </div>
            {!debtQueueLoading && !debtQueueError ? (
              <Badge variant="outline" className="rounded-full">
                {debtQueue.length}
              </Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {debtQueueError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {debtQueueError}
              </div>
            ) : debtQueueLoading ? (
              <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {l(
                  "Debt-Management-Queue wird geladen...",
                  "Загрузка очереди debt-management...",
                )}
              </div>
            ) : debtQueue.length === 0 ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {l(
                  "Aktuell gibt es keine offenen Debt-Management-Falle.",
                  "Сейчас нет открытых кейсов debt-management.",
                )}
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
                      <span className="text-xs text-muted-foreground">
                        {formatDateTimeLabel(item.updated_at ?? item.next_review_at)}
                      </span>
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
                            {item.blocking_reason
                              ? localizedBlockingReason(item.blocking_reason)
                              : l("Offener Debt-Workflow", "Открытый debt-workflow")}
                          </div>
                          {item.note ? (
                            <div className="mt-2 max-w-xl text-xs leading-snug text-muted-foreground">
                              {item.note}
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>
                              {l("Uberfallig", "Просрочено")}:{" "}
                              <span className="font-medium text-foreground">
                                {item.overdue_invoice_count}
                              </span>
                            </span>
                            <span>
                              {l("Owner", "Ответственный")}:{" "}
                              <span className="font-medium text-foreground">
                                {item.owner_name ?? l("Nicht zugewiesen", "Не назначено")}
                              </span>
                            </span>
                            <span>
                              {l("Review", "Ревью")}:{" "}
                              <span className="font-medium text-foreground">
                                {formatDateTimeLabel(item.next_review_at)}
                              </span>
                            </span>
                          </div>
                        </div>

                        <div className="relative border-t border-border px-4 py-3 sm:border-t-0 sm:pl-5 sm:before:absolute sm:before:bottom-3 sm:before:left-0 sm:before:top-3 sm:before:border-l sm:before:border-dashed sm:before:border-border">
                          <div className="space-y-2 text-xs leading-tight">
                            <div>
                              <div className="text-muted-foreground">
                                {l("Saldo", "Сальдо")}
                              </div>
                              <div className="mt-1 text-2xl font-semibold leading-none text-foreground">
                                {formatMoney(item.outstanding_balance)}
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

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="relative z-30 flex flex-wrap items-center gap-1.5 border-b border-border/70 bg-card px-3 py-2">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
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
              className={cn(shellInputClassName, "h-8 rounded-lg bg-background pl-8 text-[13px]")}
            />
          </div>

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
            className={cn(selectClassName, "h-8 w-[170px] bg-background text-[13px]")}
          >
            <option value="__all__">{t.orders_phase}</option>
            {ORDER_PHASES.map((phase) => (
              <option key={phase} value={phase}>
                {phaseLabel(phase)}
              </option>
            ))}
          </NativeComboboxSelect>

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
            className={cn(selectClassName, "h-8 w-[160px] bg-background text-[13px]")}
          >
            <option value="__all__">{t.users_status}</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabel(status)}
              </option>
            ))}
          </NativeComboboxSelect>

          <NativeComboboxSelect
            value={filters.patientId || "__all__"}
            onChange={(event) => {
              const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
              setFilters((current) => ({ ...current, patientId }));
              syncQuery({ patient: patientId || null });
            }}
            className={cn(selectClassName, "h-8 w-[210px] bg-background text-[13px]")}
          >
            <option value="__all__">
              {t.orders_all_patients}
            </option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patientLabel(patient, t.orders_patient_fallback)}
              </option>
            ))}
          </NativeComboboxSelect>

          <NativeComboboxSelect
            value={filters.providerId || "__all__"}
            onChange={(event) => {
              const providerId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
              setFilters((current) => ({
                ...current,
                providerId,
                doctorId: "",
              }));
              syncQuery({ provider: providerId || null, doctor: null });
            }}
            className={cn(selectClassName, "h-8 w-[210px] bg-background text-[13px]")}
          >
            <option value="__all__">{t.common_provider}</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
                {provider.address_city ? ` (${provider.address_city})` : ""}
              </option>
            ))}
          </NativeComboboxSelect>

          <NativeComboboxSelect
            value={filters.doctorId || "__all__"}
            onChange={(event) => {
              const doctorId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
              setFilters((current) => ({ ...current, doctorId }));
              syncQuery({ doctor: doctorId || null });
            }}
            disabled={!filters.providerId}
            className={cn(selectClassName, "h-8 w-[190px] bg-background text-[13px]")}
          >
            <option value="__all__">{t.orders_filter_doctor}</option>
            {filterDoctorOptions.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
                {doctor.fachbereich ? ` (${doctor.fachbereich})` : ""}
              </option>
            ))}
          </NativeComboboxSelect>

          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={t.orders_refresh}
              aria-label={t.orders_refresh}
              onClick={triggerReload}
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
            {anyQuickFilterActive ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  syncQuery({
                    patient: null,
                    provider: null,
                    doctor: null,
                    order: null,
                  });
                }}
              >
                <X className="size-3.5" />
                {t.common_reset}
              </Button>
            ) : null}
          </div>
        </div>

        {listError ? (
          <div className="border-b border-border/70 px-3 py-2">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {listError}
            </div>
          </div>
        ) : null}
        <DataTableSurface
          rows={orders}
          columns={orderTableColumns}
          rowId={(row) => row.id}
          defaultDensity="compact"
          defaultFrozenColumns={ORDER_DEFAULT_FROZEN_COLUMNS}
          dictionary={tx}
          groupLabels={orderColumnGroupLabels}
          loading={loading}
          maxFrozenColumns={ORDER_MAX_FROZEN_COLUMNS}
          toolbarClassName="border-b border-border/70 bg-card px-3 py-2"
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
              ? "min-h-0 flex-1 rounded-none border-0 bg-transparent p-0 shadow-none sm:max-w-none"
              : "w-full border-l border-border p-0 sm:max-w-3xl",
          )}
        >
          {isOrderRouteDetail ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={closeOrderWorkspace}
              >
                <ArrowLeft className="size-4" />
                {patientContextId ? l("Patient", "Пациент") : tx.orders_title}
              </Button>
            </div>
          ) : null}
          <AdminSheetScaffold
            title={
              orderDetail
                ? `${orderDetail.order_number} / ${orderDetail.patient_name}`
                : tx.orders_title
            }
            description={l(
              "Vollstandige operative Sicht auf den aktuellen Auftrag inklusive Phasensteuerung und providerbezogener Leistungen.",
              "Полная операционная картина текущего заказа, включая управление фазой и услугами провайдеров.",
            )}
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
              <>
                {shouldRenderOrderSection("overview") ? (
                  <>
                    <AdminTableCard
                      title={titleWithDot(tx.orders_title)}
                      description={tx.orders_subtitle}
                      accessory={
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={orderPhaseTone(orderDetail.phase)}>
                            {phaseLabel(orderDetail.phase)}
                          </StatusBadge>
                          <StatusBadge tone={orderStatusTone(orderDetail.status)}>
                            {orderStatusLabel(orderDetail.status)}
                          </StatusBadge>
                        </div>
                      }
                    >
                      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={t.orders_patient}
                          value={`${orderDetail.patient_name} (${orderDetail.patient_pid})`}
                        />
                        <DetailField
                          label={tx.patients_created}
                          value={
                            <span className="inline-flex items-center gap-2">
                              <CalendarClock className="size-4 text-muted-foreground" />
                              {formatDateTimeLabel(orderDetail.created_at)}
                            </span>
                          }
                        />
                        <DetailField
                          label={tx.common_loading}
                          value={
                            <span className="inline-flex items-center gap-2">
                              <RefreshCw className="size-4 text-muted-foreground" />
                              {formatDateTimeLabel(orderDetail.updated_at)}
                            </span>
                          }
                        />
                        <DetailField
                          label={tx.contracts_signed}
                          value={`${orderDetail.signed_patient ? tx.contracts_signed : tx.mfa_pending} / ${
                            orderDetail.signed_agency
                              ? tx.contracts_signed
                              : tx.mfa_pending
                          }`}
                        />
                        <DetailField
                          label={t.leads_needs}
                          value={orderDetail.needs_description || tx.common_not_set}
                        />
                        <DetailField
                          label={tx.invoices_subtotal}
                          value={formatMoney(orderDetail.total_estimated)}
                        />
                        <DetailField
                          label={tx.invoices_total}
                          value={formatMoney(orderDetail.total_actual)}
                        />
                        <DetailField
                          label={tx.providers_services}
                          value={l(
                            `${leistungMetrics.total} Positionen / ${leistungMetrics.delivered} erbracht / ${leistungMetrics.approved} freigegeben`,
                            `${leistungMetrics.total} позиций / ${leistungMetrics.delivered} оказано / ${leistungMetrics.approved} утверждено`,
                          )}
                        />
                      </div>
                    </AdminTableCard>

                    <AdminTableCard
                      title={eyebrowWithDot(l("Bedarfsklärung", "Уточнение потребности"))}
                      description={l(
                        "Direkt in Patienten-, Fall- und Terminkontexte springen, ohne Filter manuell neu aufzubauen.",
                        "Переходите в соседние контексты пациента, кейса и приёмов без ручной пересборки фильтров.",
                      )}
                    >
                      <div className="flex flex-wrap gap-2 p-4">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() =>
                            staffGo(`/patients/${orderDetail.patient_id}?tab=orders`)
                          }
                        >
                          {l("Patient", "Пациент")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() =>
                            staffGo(`/patients/${orderDetail.patient_id}?tab=cases`)
                          }
                        >
                          {l("Fälle", "Кейсы")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() =>
                            staffGo(
                              `/appointments?patient=${orderDetail.patient_id}`,
                            )
                          }
                        >
                          {l("Termine", "Приёмы")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() =>
                            staffGo(
                              `/contracts?order=${orderDetail.id}&patient=${orderDetail.patient_id}&tab=quotes`,
                            )
                          }
                        >
                          {l("Verträge", "Договоры")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() =>
                            staffGo(
                              `/invoices?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                            )
                          }
                        >
                          {l("Rechnungen", "Счета")}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() =>
                            staffGo(
                              `/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                            )
                          }
                        >
                          {l("Dokumente", "Документы")}
                        </Button>
                      </div>
                    </AdminTableCard>
                  </>
                ) : null}

                {shouldRenderOrderSection("gates") && orderDetail.process_gates ? (
                  <SectionCard
                    title={l("Prozess-Gates", "Процессные гейты")}
                    description={l(
                      "Finanzseitige Freigaben fur Debt-Hold, Billing-Release und Paketdeckung.",
                      "Финансовые гейты исполнения по debt-hold, billing-release и покрытию пакетом.",
                    )}
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l("Durchfuhrungsfreigabe", "Готовность к исполнению")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.process_gates.execution_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-rose-200 bg-rose-50 text-rose-700",
                              )}
                            >
                              {orderDetail.process_gates.execution_ready
                                ? l("bereit", "готово")
                                : l("blockiert", "заблокировано")}
                            </Badge>
                          }
                        />
                        <DetailField
                          label={l("Debt-Hold", "Debt-hold")}
                          value={
                            orderDetail.process_gates.debt_management
                              ?.blocking_reason
                              ? orderDetail.process_gates.debt_management
                                  .blocking_reason
                              : orderDetail.process_gates.debt_hold
                                ? `${orderDetail.process_gates.overdue_invoice_count} ${l("uberfallige Rechnung(en)", "просроченных счет(ов)")}`
                                : l("Keine uberfalligen Forderungen", "Нет просроченной задолженности")
                          }
                        />
                        <DetailField
                          label={l("Debt-Workflow", "Debt-workflow")}
                          value={
                            debtStatusLabel(
                              orderDetail.process_gates.debt_management
                                ?.effective_status ?? "not_required",
                            )
                          }
                        />
                        <DetailField
                          label={l("Billing-Release", "Billing-release")}
                          value={billingReleaseLabel(
                            orderDetail.process_gates.billing_release_status,
                          )}
                        />
                        <DetailField
                          label={l("Paketdeckung", "Покрытие пакетом")}
                          value={packageCoverageLabel(
                            orderDetail.process_gates.package_coverage_status,
                          )}
                        />
                        <DetailField
                          label={l("Offener Saldo", "Открытый остаток")}
                          value={formatMoney(
                            orderDetail.process_gates.outstanding_balance,
                          )}
                        />
                      </div>

                      {orderDetail.process_gates.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          <div className="font-medium">
                            {l("Blockierende Grunde", "Блокирующие причины")}
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

                      <div className="grid gap-4 xl:grid-cols-3">
                        {canManageDebt ? (
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(l("Debt-Management", "Debt-management"))}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l(
                                "Aktiven Debt-Workflow nachverfolgen, Owner zuweisen und den nachsten Review-Punkt setzen.",
                                "Отслеживать активный debt-workflow, назначать ответственного и ставить следующую точку ревью.",
                              )}
                            </div>
                            <div className="mt-4 grid gap-3">
                              <Field label={l("Debt-Status", "Статус debt")}>
                                <NativeComboboxSelect
                                  value={processGateForm.debtStatus}
                                  onChange={(event) =>
                                    setProcessGateForm((current) => ({
                                      ...current,
                                      debtStatus: event.target.value,
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
                              <Field label={l("Owner", "Ответственный")}>
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
                                    {l(
                                      "Aktuellen Owner beibehalten",
                                      "Оставить текущего ответственного",
                                    )}
                                  </option>
                                  {debtOwnerOptions.map((item) => (
                                    <option
                                      key={item.user_id}
                                      value={item.user_id}
                                    >
                                      {item.user_name} · {roleLabel(item.user_role)}
                                    </option>
                                  ))}
                                </NativeComboboxSelect>
                              </Field>
                              <Field label={l("Nachstes Review", "Следующее ревью")}>
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
                              <Field label={l("Letzter Kontakt", "Последний контакт")}>
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
                              <Field label={l("Debt-Notiz", "Заметка по debt-workflow")}>
                                <textarea
                                  value={processGateForm.debtNote}
                                  onChange={(event) =>
                                    setProcessGateForm((current) => ({
                                      ...current,
                                      debtNote: event.target.value,
                                    }))
                                  }
                                  className={textareaClassName}
                                  placeholder={l(
                                    "Notiz zum Debt-Workflow",
                                    "Заметка по debt-workflow",
                                  )}
                                />
                              </Field>
                              <Field label={l("Losungsnotiz", "Заметка по решению")}>
                                <textarea
                                  value={processGateForm.debtResolutionNote}
                                  onChange={(event) =>
                                    setProcessGateForm((current) => ({
                                      ...current,
                                      debtResolutionNote: event.target.value,
                                    }))
                                  }
                                  className={textareaClassName}
                                  placeholder={l("Losungsnotiz", "Заметка по решению")}
                                />
                              </Field>
                              <div className="grid gap-2 rounded-2xl border border-border p-3 text-xs text-muted-foreground">
                                <div>
                                  {l("Owner", "Ответственный")}:{" "}
                                  {orderDetail.process_gates.debt_management
                                    ?.owner_name ?? l("Nicht zugewiesen", "Не назначено")}
                                </div>
                                <div>
                                  {l("Letzter Kontakt", "Последний контакт")}:{" "}
                                  {formatDateTimeLabel(
                                    orderDetail.process_gates.debt_management
                                      ?.last_contact_at,
                                  )}
                                </div>
                                <div>
                                  {l("Nachstes Review", "Следующее ревью")}:{" "}
                                  {formatDateTimeLabel(
                                    orderDetail.process_gates.debt_management
                                      ?.next_review_at,
                                  )}
                                </div>
                                <div>
                                  {l("Erledigt", "Закрыто")}:{" "}
                                  {formatDateTimeLabel(
                                    orderDetail.process_gates.debt_management
                                      ?.resolved_at,
                                  )}
                                </div>
                              </div>
                              <div className="flex justify-end">
                                <Button
                                  type="button"
                                  onClick={() =>
                                    void handleSaveDebtManagement()
                                  }
                                  disabled={processGateBusy}
                                >
                                  {processGateBusy ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : null}
                                  {l(
                                    "Debt-Workflow speichern",
                                    "Сохранить debt-workflow",
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {user?.role === "billing" || user?.role === "ceo" ? (
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(l("Billing-Release", "Billing-release"))}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l(
                                "Billing entscheidet, ob die Durchfuhrung ausserhalb der Paketdeckung weiterlaufen darf.",
                                "Биллинг решает, может ли исполнение продолжаться вне покрытия пакетом.",
                              )}
                            </div>
                            <div className="mt-4 space-y-3">
                              <NativeComboboxSelect
                                value={processGateForm.billingReleaseStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    billingReleaseStatus: event.target.value,
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
                                placeholder={l("Billing-Notiz", "Заметка биллинга")}
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
                                  {l(
                                    "Billing-Gate speichern",
                                    "Сохранить billing-gate",
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        {user?.role === "patient_manager" ||
                        user?.role === "ceo" ? (
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(l("Paketdeckung", "Покрытие пакетом"))}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l(
                                "Bestehende Paketdeckung kann Wiederholungsleistungen ohne separates Billing-Release freigeben.",
                                "Действующее покрытие пакетом может разблокировать повторную работу без отдельного billing-release.",
                              )}
                            </div>
                            <div className="mt-4 space-y-3">
                              <NativeComboboxSelect
                                value={processGateForm.packageCoverageStatus}
                                onChange={(event) =>
                                  setProcessGateForm((current) => ({
                                    ...current,
                                    packageCoverageStatus: event.target.value,
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
                                placeholder={l(
                                  "Notiz zur Paketdeckung",
                                  "Заметка по покрытию",
                                )}
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
                                  {l(
                                    "Paket-Gate speichern",
                                    "Сохранить package-gate",
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {shouldRenderOrderSection("planning") && orderDetail.planning_preparation ? (
                  <SectionCard
                    title={l("Planung und Vorbereitung", "Планирование и подготовка")}
                    description={l(
                      "Finalisierung des Behandlungsplans, Terminbuchung, Dolmetscher-Ubergabe und Versand der Vorbereitungsunterlagen vor der Durchfuhrung.",
                      "Финализация плана лечения, бронирование слотов, передача на переводчика и отправка подготовительных документов до старта исполнения.",
                    )}
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l("Planungsfreigabe", "Готовность планирования")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.planning_preparation.planning_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {orderDetail.planning_preparation.planning_ready
                                ? l("bereit", "готово")
                                : l("blockiert", "заблокировано")}
                            </Badge>
                          }
                        />
                        <DetailField
                          label={l("Behandlungsplan", "План лечения")}
                          value={
                            treatmentPlanStatusLabel(
                              orderDetail.planning_preparation
                                .treatment_plan_status,
                            )
                          }
                        />
                        <DetailField
                          label={l("Medizinische Termine", "Медицинские записи")}
                          value={l(
                            `${orderDetail.planning_preparation.medical_confirmed}/${orderDetail.planning_preparation.medical_total} bestätigt`,
                            `${orderDetail.planning_preparation.medical_confirmed}/${orderDetail.planning_preparation.medical_total} подтверждено`,
                          )}
                        />
                        <DetailField
                          label={l("Vorbereitungsunterlagen", "Подготовительные документы")}
                          value={
                            preparationDocumentStatusLabel(
                              orderDetail.planning_preparation
                                .preparation_documents_status,
                            )
                          }
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l("Nicht-medizinischer Ablauf", "Немедицинский поток")}
                          value={
                            orderDetail.planning_preparation
                              .non_medical_required
                              ? l(
                                  `${orderDetail.planning_preparation.non_medical_confirmed}/${orderDetail.planning_preparation.non_medical_total} bestätigt`,
                                  `${orderDetail.planning_preparation.non_medical_confirmed}/${orderDetail.planning_preparation.non_medical_total} подтверждено`,
                                )
                              : l("Nicht erforderlich", "Не требуется")
                          }
                        />
                        <DetailField
                          label={l("Dolmetscher", "Переводчик")}
                          value={
                            orderDetail.planning_preparation
                              .interpreter_required
                              ? l(
                                  `${orderDetail.planning_preparation.interpreter_assigned} zugewiesen / ${orderDetail.planning_preparation.interpreter_confirmed} bestätigt`,
                                  `${orderDetail.planning_preparation.interpreter_assigned} назначено / ${orderDetail.planning_preparation.interpreter_confirmed} принято`,
                                )
                              : l("Nicht erforderlich", "Не требуется")
                          }
                        />
                        <DetailField
                          label={l("Dolmetscher-Briefing", "Брифинг переводчика")}
                          value={
                            interpreterBriefingStatusLabel(
                              orderDetail.planning_preparation
                                .interpreter_briefing_status,
                            )
                          }
                        />
                        <DetailField
                          label={l("Letzter Meilenstein", "Последний этап")}
                          value={
                            orderDetail.planning_preparation.plan_finalized_at
                              ? l("Plan", "План") +
                                ` ${formatDateTimeLabel(
                                  orderDetail.planning_preparation
                                    .plan_finalized_at,
                                )}`
                              : l(
                                  "Noch kein Planungsmeilenstein",
                                  "Этапов планирования пока нет",
                                )
                          }
                        />
                      </div>

                      {orderDetail.planning_preparation.blocking_reasons
                        .length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">
                            {l("Blocker aus der Planung", "Блокеры из планирования")}
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
                          {l(
                            "Planung und Vorbereitung sind fur die Durchfuhrung vollstandig.",
                            "Планирование и подготовка полностью готовы к исполнению.",
                          )}
                        </div>
                      )}

                      {planningError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {planningError}
                        </div>
                      ) : null}

                      {user?.role === "patient_manager" ||
                      user?.role === "ceo" ? (
                        <div className="grid gap-4 xl:grid-cols-2">
                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(
                                l("Planungssteuerung", "Управление планированием"),
                              )}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l(
                                "Behandlungsplan fixieren, Bedarf an nicht-medizinischen Leistungen oder Dolmetscher-Support markieren und Vorbereitungsunterlagen steuern.",
                                "Зафиксировать план лечения, отметить необходимость немедицинских услуг или поддержки переводчика и провести подготовительные документы.",
                              )}
                            </div>
                            <div className="mt-4 space-y-3">
                              <NativeComboboxSelect
                                value={planningForm.treatmentPlanStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    treatmentPlanStatus: event.target.value,
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
                                placeholder={l(
                                  "Notiz zum Behandlungsplan",
                                  "Заметка по плану лечения",
                                )}
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
                                {l(
                                  "Nicht-medizinische Leistungen sind erforderlich",
                                  "Немедицинские услуги требуются",
                                )}
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
                                {l("Dolmetscher ist erforderlich", "Переводчик требуется")}
                              </label>
                              <NativeComboboxSelect
                                value={planningForm.preparationDocumentsStatus}
                                onChange={(event) =>
                                  setPlanningForm((current) => ({
                                    ...current,
                                    preparationDocumentsStatus:
                                      event.target.value,
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
                                      event.target.value,
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
                                  {l(
                                    "Planungsstand speichern",
                                    "Сохранить состояние планирования",
                                  )}
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-2xl border border-border p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {titleWithDot(
                                l("Operative Übergabe", "Операционная передача"),
                              )}
                            </div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {l(
                                "Verknüpfte Arbeitsbereiche nutzen, um medizinische Slots, nicht-medizinische Leistungen, Dolmetscher-Zuweisung und Vorbereitungsunterlagen zu bestätigen.",
                                "Используйте связанные рабочие пространства, чтобы подтвердить медицинские слоты, немедицинские услуги, назначение переводчика и подготовительные документы.",
                              )}
                            </div>
                            <div className="mt-4 grid gap-3">
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-start rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l(
                                  "Medizinische und nicht-medizinische Termine",
                                  "Медицинские и немедицинские приёмы",
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-start rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l("Vorbereitungsunterlagen", "Подготовительные документы")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="justify-start rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l(
                                  "Dolmetscher-Zuweisung und Briefing",
                                  "Назначение переводчика и брифинг",
                                )}
                              </Button>
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
                  </SectionCard>
                ) : null}

                {shouldRenderOrderSection("execution") && orderDetail.execution_flow ? (
                  <SectionCard
                    title={l("Durchfuhrung", "Исполнение")}
                    description={l(
                      "Ankunft, erbrachte Leistungen, Dolmetscher-Support und Abweichungsbearbeitung vor dem Wechsel in den Abschluss.",
                      "Прибытие, оказанные услуги, поддержка переводчика и обработка отклонений до перехода заказа в закрытие.",
                    )}
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l("Abschlussreife", "Готовность к закрытию")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.execution_flow.closure_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {orderDetail.execution_flow.closure_ready
                                ? l("bereit", "готово")
                                : l("blockiert", "заблокировано")}
                            </Badge>
                          }
                        />
                        <DetailField
                          label={l("Ankunft", "Прибытие")}
                          value={arrivalStatusLabel(
                            orderDetail.execution_flow.arrival_status,
                          )}
                        />
                        <DetailField
                          label={l("Medizinische Durchführung", "Медицинское исполнение")}
                          value={l(
                            `${executionStatusLabel(orderDetail.execution_flow.medical_execution_status)} · ${orderDetail.execution_flow.medical_completed} Termin(e) / ${orderDetail.execution_flow.delivered_leistungen} Position(en)`,
                            `${executionStatusLabel(orderDetail.execution_flow.medical_execution_status)} · ${orderDetail.execution_flow.medical_completed} приём(ов) / ${orderDetail.execution_flow.delivered_leistungen} позици(й)`,
                          )}
                        />
                        <DetailField
                          label={l("Offene Durchführungspunkte", "Открытые пункты исполнения")}
                          value={String(
                            orderDetail.execution_flow
                              .open_execution_checklist_count,
                          )}
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l(
                            "Nicht-medizinische Durchführung",
                            "Немедицинское исполнение",
                          )}
                          value={
                            orderDetail.execution_flow.non_medical_required
                              ? l(
                                  `${executionStatusLabel(orderDetail.execution_flow.non_medical_execution_status)} · ${orderDetail.execution_flow.non_medical_completed} Termin(e) / ${orderDetail.execution_flow.concierge_completed} Concierge-Leistung(en)`,
                                  `${executionStatusLabel(orderDetail.execution_flow.non_medical_execution_status)} · ${orderDetail.execution_flow.non_medical_completed} приём(ов) / ${orderDetail.execution_flow.concierge_completed} concierge-услуг`,
                                )
                              : l("Nicht erforderlich", "Не требуется")
                          }
                        />
                        <DetailField
                          label={l("Dolmetscher-Support", "Поддержка переводчика")}
                          value={
                            orderDetail.execution_flow.interpreter_required
                              ? l(
                                  `${executionStatusLabel(orderDetail.execution_flow.interpreter_service_status)} · ${orderDetail.execution_flow.approved_interpreter_reports} freigegebene Berichte`,
                                  `${executionStatusLabel(orderDetail.execution_flow.interpreter_service_status)} · ${orderDetail.execution_flow.approved_interpreter_reports} утверждённых отчётов`,
                                )
                              : l("Nicht erforderlich", "Не требуется")
                          }
                        />
                        <DetailField
                          label={l("Abweichungen", "Отклонения")}
                          value={issueStatusLabel(orderDetail.execution_flow.issue_status)}
                        />
                        <DetailField
                          label={l("Durchführungsdokumente", "Документы исполнения")}
                          value={String(
                            orderDetail.execution_flow.execution_documents,
                          )}
                        />
                      </div>

                      {orderDetail.execution_flow.blocking_reasons.length >
                      0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">
                            {l("Blocker aus der Durchführung", "Блокеры из исполнения")}
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
                          {l(
                            "Durchführungsnachweise und operative Übergabe sind für den Abschluss vollständig.",
                            "Подтверждения исполнения и операционная передача готовы для закрытия.",
                          )}
                        </div>
                      )}

                      {executionError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {executionError}
                        </div>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("Steuerung der Durchführung", "Управление исполнением"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l(
                              "Ankunft, Leistungsumfang und Klärung von Abweichungen oder Zwischenfällen bestätigen.",
                              "Подтвердить прибытие, объём оказанных услуг и то, что отклонения исполнения закрыты.",
                            )}
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
                                  arrivalStatus: event.target.value,
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
                                  medicalExecutionStatus: event.target.value,
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
                                  nonMedicalExecutionStatus: event.target.value,
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
                                  interpreterServiceStatus: event.target.value,
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
                                  issueStatus: event.target.value,
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
                              placeholder={l(
                                "Notiz zu Abweichung oder offenem operativen Detail",
                                "Заметка по отклонению или нерешённой операционной детали",
                              )}
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
                              placeholder={l(
                                "Ankunft, Leistungsumfang, Kliniknotizen, Ergebnis ...",
                                "Прибытие, объём оказанного, заметки клиники, результат услуги...",
                              )}
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
                                {l(
                                  "Durchführungsstand speichern",
                                  "Сохранить состояние исполнения",
                                )}
                              </Button>
                            </div>
                          </fieldset>
                        </div>

                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("Nachweise der Durchführung", "Подтверждения исполнения"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l(
                              "Verknüpfte Arbeitsbereiche nutzen, um die restliche operative Spur zu schließen.",
                              "Используйте связанные рабочие пространства, чтобы закрыть оставшийся операционный след.",
                            )}
                          </div>
                          <div className="mt-4 grid gap-3">
                            <DetailField
                              label={l("Ankunft erfasst", "Прибытие зафиксировано")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow.arrival_recorded_at,
                              )}
                            />
                            <DetailField
                              label={l("Medizinisch abgeschlossen", "Медицинская часть завершена")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow.medical_completed_at,
                              )}
                            />
                            <DetailField
                              label={l(
                                "Nicht-medizinisch abgeschlossen",
                                "Немедицинская часть завершена",
                              )}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow
                                  .non_medical_completed_at,
                              )}
                            />
                            <DetailField
                              label={l("Abweichungen geklärt", "Отклонения закрыты")}
                              value={formatDateTimeLabel(
                                orderDetail.execution_flow.issues_resolved_at,
                              )}
                            />
                            <div className="flex flex-wrap gap-3 pt-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l("Termine", "Приёмы")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l("Dokumente", "Документы")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/providers?patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l("Provider", "Провайдеры")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {shouldRenderOrderSection("followup") && orderDetail.followup_flow ? (
                  <SectionCard
                    title={l("Nachsorge-Ablauf", "Поток follow-up")}
                    description={l(
                      "Post-Care-Meilensteine, Paketende-Outreach und finale Patientenubergabe starten, bevor der Auftrag in die Nachsorge wechselt.",
                      "Запуск post-care этапов, outreach по завершению пакета и финальная передача пациенту до перехода заказа в follow-up.",
                    )}
                  >
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l("Nachsorge-Freigabe", "Готовность к follow-up")}
                          value={
                            <Badge
                              variant="outline"
                              className={cn(
                                "rounded-full",
                                orderDetail.followup_flow.followup_ready
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-amber-200 bg-amber-50 text-amber-700",
                              )}
                            >
                              {orderDetail.followup_flow.followup_ready
                                ? l("bereit", "готово")
                                : l("blockiert", "заблокировано")}
                            </Badge>
                          }
                        />
                        <DetailField
                          label={l("Ergebnisübergabe", "Передача результатов")}
                          value={resultsHandoffStatusLabel(
                            orderDetail.followup_flow.results_handoff_status,
                          )}
                        />
                        <DetailField
                          label={l("Nachsorge-Aktivität", "Активность follow-up")}
                          value={l(
                            `${orderDetail.followup_flow.followup_appointments_total} Termin(e) / ${orderDetail.followup_flow.followup_1w_reminders + orderDetail.followup_flow.followup_1m_reminders + orderDetail.followup_flow.followup_6m_reminders + orderDetail.followup_flow.package_end_reminders} Erinnerung(en)`,
                            `${orderDetail.followup_flow.followup_appointments_total} приём(ов) / ${orderDetail.followup_flow.followup_1w_reminders + orderDetail.followup_flow.followup_1m_reminders + orderDetail.followup_flow.followup_6m_reminders + orderDetail.followup_flow.package_end_reminders} напоминани(й)`,
                          )}
                        />
                        <DetailField
                          label={l("Portal-Freigaben", "Публикации в портале")}
                          value={String(
                            orderDetail.followup_flow.results_portal_shares,
                          )}
                        />
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <DetailField
                          label={l("Arztgesteuert", "По назначению врача")}
                          value={
                            followupStatusLabel(
                              orderDetail.followup_flow.doctor_followup_status,
                            )
                          }
                        />
                        <DetailField
                          label="1W / 1M / 6M"
                          value={`${followupStatusLabel(orderDetail.followup_flow.followup_1w_status)} / ${followupStatusLabel(orderDetail.followup_flow.followup_1m_status)} / ${followupStatusLabel(orderDetail.followup_flow.followup_6m_status)}`}
                        />
                        <DetailField
                          label={l("Paketende", "Завершение пакета")}
                          value={
                            orderDetail.followup_flow.package_end_required
                              ? `${followupStatusLabel(orderDetail.followup_flow.package_end_status)} · ${formatDateOnlyLabel(
                                  orderDetail.followup_flow.package_end_date ??
                                    orderDetail.followup_flow
                                      .suggested_package_end_date,
                                )}`
                              : l("Nicht erforderlich", "Не требуется")
                          }
                        />
                        <DetailField
                          label={l("Abschlussanker", "Якорь закрытия")}
                          value={formatDateTimeLabel(
                            orderDetail.followup_flow.closure_anchor_at,
                          )}
                        />
                      </div>

                      {orderDetail.followup_flow.blocking_reasons.length > 0 ? (
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                          <div className="font-medium">
                            {l(
                              "Blocker für den Start der Nachsorge",
                              "Блокеры запуска follow-up",
                            )}
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
                          {l(
                            "Nachsorge-Meilensteine und Übergabe sind für die Post-Care-Phase angestoßen.",
                            "Этапы follow-up и передача запущены для post-care фазы.",
                          )}
                        </div>
                      )}

                      {followupError ? (
                        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                          {followupError}
                        </div>
                      ) : null}

                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l("Steuerung der Nachsorge", "Управление follow-up"),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l(
                              "Markieren, welche Meilensteine erforderlich sind und ob die finale Übergabe an den Patienten vollständig ist.",
                              "Отметьте, какие этапы обязательны и завершена ли финальная передача пациенту.",
                            )}
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
                                  doctorFollowupStatus: event.target.value,
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
                                    followup1wStatus: event.target.value,
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
                                    followup1mStatus: event.target.value,
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
                                    followup6mStatus: event.target.value,
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
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                              <Field label={l("Paketende", "Завершение пакета")}>
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
                              <Field label={l("Paketende-Status", "Статус завершения пакета")}>
                                <NativeComboboxSelect
                                  value={followupForm.packageEndStatus}
                                  onChange={(event) =>
                                    setFollowupForm((current) => ({
                                      ...current,
                                      packageEndStatus: event.target.value,
                                    }))
                                  }
                                  className={selectClassName}
                                >
                                  <option value="not_required">
                                    {l("Paketende nicht erforderlich", "Завершение пакета не требуется")}
                                  </option>
                                  <option value="pending">
                                    {l("Paketende ausstehend", "Завершение пакета ожидается")}
                                  </option>
                                  <option value="scheduled">
                                    {l("Paketende geplant", "Завершение пакета запланировано")}
                                  </option>
                                  <option value="completed">
                                    {l("Paketende abgeschlossen", "Завершение пакета завершено")}
                                  </option>
                                </NativeComboboxSelect>
                              </Field>
                            </div>
                            <NativeComboboxSelect
                              value={followupForm.resultsHandoffStatus}
                              onChange={(event) =>
                                setFollowupForm((current) => ({
                                  ...current,
                                  resultsHandoffStatus: event.target.value,
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
                              placeholder={l(
                                "Patientenkommunikation, Arztbrief-Übergabe, Outreach-Plan ...",
                                "Коммуникация с пациентом, передача Arztbrief, план outreach...",
                              )}
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
                                {l(
                                  "Nachsorge-Stand speichern",
                                  "Сохранить состояние follow-up",
                                )}
                              </Button>
                            </div>
                          </fieldset>
                        </div>

                        <div className="rounded-2xl border border-border p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {titleWithDot(
                              l(
                              "Empfohlene Meilenstein-Anker",
                              "Рекомендуемые контрольные даты",
                            ),
                            )}
                          </div>
                          <div className="mt-1 text-sm text-muted-foreground">
                            {l(
                              "Bestehende Termin-Presets und Portalsichtbarkeit lesen diese auftragsbezogenen Meilensteine aus.",
                              "Текущие пресеты приёмов и видимость в портале читают эти вехи уровня заказа.",
                            )}
                          </div>
                          <div className="mt-4 grid gap-3">
                            <DetailField
                              label={l("1-Wochen-Ziel", "Цель на 1 неделю")}
                              value={formatDateTimeLabel(
                                orderDetail.followup_flow
                                  .recommended_followup_1w_at,
                              )}
                            />
                            <DetailField
                              label={l("1-Monats-Ziel", "Цель на 1 месяц")}
                              value={formatDateTimeLabel(
                                orderDetail.followup_flow
                                  .recommended_followup_1m_at,
                              )}
                            />
                            <DetailField
                              label={l("6-Monats-Ziel", "Цель на 6 месяцев")}
                              value={formatDateTimeLabel(
                                orderDetail.followup_flow
                                  .recommended_followup_6m_at,
                              )}
                            />
                            <DetailField
                              label={l("Paketende-Outreach", "Outreach по завершению пакета")}
                              value={formatDateOnlyLabel(
                                orderDetail.followup_flow
                                  .recommended_package_end_followup_at,
                              )}
                            />
                            <div className="flex flex-wrap gap-3 pt-2">
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/appointments?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l("Termine", "Приёмы")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  staffGo(
                                    `/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                  )
                                }
                              >
                                {l("Dokumente", "Документы")}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() =>
                                  staffGo(`/patients/${orderDetail.patient_id}`)
                                }
                              >
                                {l("Patientenprofil", "Профиль пациента")}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </SectionCard>
                ) : null}

                {shouldRenderOrderSection("phase") ? (
                  <SectionCard
                    title={tx.orders_phase}
                    description={l(
                      "Phasenwechsel laufen sequenziell und werden in der Workflow-Historie protokolliert.",
                      "Переходы по фазам идут последовательно и сохраняются в истории workflow.",
                    )}
                    action={
                      permissions.canManagePhase &&
                      orderDetail.lifecycle?.next_stage ? (
                        <Button
                          variant="outline"
                          onClick={() => void handleAdvancePhase()}
                          disabled={Boolean(nextLifecycleTransition?.blocked)}
                        >
                          <ChevronRight className="mr-2 size-4" />
                          {l("Weiter zu", "Перевести в")}{" "}
                          {phaseLabel(orderDetail.lifecycle.next_stage)}
                        </Button>
                      ) : null
                    }
                  >
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                    <div className="flex flex-wrap gap-2">
                      {ORDER_PHASES.map((phase) => {
                        const isCurrent = orderDetail.phase === phase;
                        const isNext =
                          orderDetail.lifecycle?.next_stage === phase;
                        const disabled =
                          !permissions.canManagePhase ||
                          (!isCurrent && !isNext);
                        return (
                          <button
                            key={phase}
                            type="button"
                            disabled={disabled}
                            onClick={() => setPhaseDraft(phase)}
                            className={cn(
                              "rounded-full border px-3 py-2 text-sm transition",
                              phaseDraft === phase
                                ? phaseClassName(phase)
                                : "border-border text-muted-foreground hover:border-border",
                              disabled && "cursor-not-allowed opacity-60",
                            )}
                          >
                            {phaseLabel(phase)}
                            {isCurrent
                              ? l(" (aktuell)", " (текущая)")
                              : isNext
                                ? l(" (als Nächstes)", " (следующая)")
                                : ""}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {permissions.canManagePhase ? (
                        <Button
                          onClick={() => void handleSavePhase()}
                          disabled={
                            phaseSaving ||
                            !phaseDraft ||
                            phaseDraft === orderDetail.phase ||
                            (orderDetail.lifecycle?.next_stage != null &&
                              phaseDraft !==
                                orderDetail.lifecycle.next_stage) ||
                            Boolean(nextLifecycleTransition?.blocked)
                          }
                        >
                          {phaseSaving ? (
                            <LoaderCircle className="mr-2 size-4 animate-spin" />
                          ) : null}
                          {l("Phase speichern", "Сохранить фазу")}
                        </Button>
                      ) : (
                        <Badge
                          variant="outline"
                          className="rounded-full border-border bg-muted/50 text-muted-foreground"
                        >
                          {l("Billing nur lesend", "Только чтение для биллинга")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {orderDetail.lifecycle?.stage_entered_at ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      {l("Aktuelle Phase seit", "Текущая фаза с")}{" "}
                      {formatDateTimeLabel(orderDetail.lifecycle.stage_entered_at)}.
                    </p>
                  ) : null}
                  {nextLifecycleTransition?.blocked &&
                  nextLifecycleTransition.reasons.length > 0 ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                      <div className="font-medium">
                        {phaseLabel(nextLifecycleTransition.phase)}{" "}
                        {l("ist blockiert", "заблокирована")}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {nextLifecycleTransition.reasons.map((reason) => (
                          <li key={reason}>• {localizedBlockingReason(reason)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {phaseError ? (
                    <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {phaseError}
                    </div>
                  ) : null}
                  {orderDetail.lifecycle?.history?.length ? (
                    <div className="mt-4 space-y-3">
                      {orderDetail.lifecycle.history.map((event) => (
                        <div
                          key={[
                            event.created_at,
                            event.from_stage ?? "",
                            event.to_stage,
                            event.transition_kind,
                            event.note ?? "",
                          ].join("|")}
                          className="rounded-2xl border border-border px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {event.from_stage
                                  ? `${phaseLabel(event.from_stage)} -> ${phaseLabel(event.to_stage)}`
                                  : phaseLabel(event.to_stage)}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                                {transitionKindLabel(event.transition_kind)}
                              </p>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTimeLabel(event.created_at)}
                            </span>
                          </div>
                          {event.note ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                              {event.note}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  </SectionCard>
                ) : null}

                {shouldRenderOrderSection("workflow") ? (
                  <SectionCard
                    title={l("Workflow-Checkliste", "Workflow-чеклист")}
                    description={l(
                      "Automatisch erzeugte To-dos fur PM und Concierge zu diesem Auftrag.",
                      "Автосозданные задачи для PM и concierge по этому заказу.",
                    )}
                  >
                  {workflowChecklist ? (
                    <div className="space-y-4">
                      <div className="grid gap-3 md:grid-cols-3">
                        <DetailField
                          label={l("Offen", "Открыто")}
                          value={String(workflowChecklist.open_count)}
                        />
                        <DetailField
                          label={l("Abgeschlossen", "Завершено")}
                          value={String(workflowChecklist.completed_count)}
                        />
                        <DetailField
                          label={l("Gruppen", "Группы")}
                          value={String(workflowChecklistGroups.length)}
                        />
                      </div>

                      {workflowChecklistGroups.length === 0 ? (
                        <EmptyState
                          title={l(
                            "Noch keine Workflow-Punkte",
                            "Пунктов workflow пока нет",
                          )}
                          description={l(
                            "Checklistenpunkte werden aus der Auftragsphase erzeugt und können manuell ergänzt werden.",
                            "Пункты чеклиста генерируются из фазы заказа и могут дополняться вручную.",
                          )}
                        />
                      ) : (
                        <div className="space-y-4">
                          {workflowChecklistGroups.map((group) => (
                            <div
                              key={group.key}
                              className="rounded-2xl border border-border p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                                    {group.label}
                                  </p>
                                  <p className="mt-1 text-sm text-muted-foreground">
                                    {
                                      group.items.filter(
                                        (item) => !item.is_completed,
                                      ).length
                                    }{" "}
                                    {l("offen", "открыто")} / {group.items.length}{" "}
                                    {l("gesamt", "всего")}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-border text-muted-foreground"
                                >
                                  {group.items.length} {l("Punkte", "пункт(ов)")}
                                </Badge>
                              </div>
                              <div className="mt-4 space-y-3">
                                {group.items.map((item) => (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      "rounded-2xl border p-4",
                                      item.is_completed
                                        ? "border-emerald-200 bg-emerald-50/70"
                                        : "border-border",
                                    )}
                                  >
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-medium text-foreground">
                                            {item.item_text}
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
                                                : statusClassName(
                                                    item.linked_task_status ??
                                                      "open",
                                                  ),
                                            )}
                                          >
                                            {item.is_completed
                                              ? workflowTaskStatusLabel("completed")
                                              : workflowTaskStatusLabel(item.linked_task_status ?? "open")}
                                          </Badge>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
                                          <span>
                                            {l("Verantwortlich", "Ответственный")}:{" "}
                                            {item.owner_name
                                              ? `${item.owner_name} · ${roleLabel(item.owner_user_role ?? item.owner_role)}`
                                              : roleLabel(item.owner_role)}
                                          </span>
                                          <span>
                                            {l("Fällig", "Срок")}: {formatDateTimeLabel(item.due_date)}
                                          </span>
                                          {item.completed_at ? (
                                            <span>
                                              {l("Erledigt", "Завершено")}:{" "}
                                              {formatDateTimeLabel(
                                                item.completed_at,
                                              )}
                                            </span>
                                          ) : null}
                                        </div>
                                      </div>
                                      {!item.is_completed ? (
                                        <Button
                                          type="button"
                                          variant="outline"
                                          className="rounded-xl"
                                          disabled={workflowBusy}
                                          onClick={() =>
                                            void handleCompleteWorkflowItem(
                                              item.id,
                                            )
                                          }
                                        >
                                          {l("Abschließen", "Завершить")}
                                        </Button>
                                      ) : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {permissions.canManagePhase ? (
                        <form
                          onSubmit={handleAddWorkflowItem}
                          className="rounded-2xl border border-border p-4"
                        >
                          <div className="grid gap-4 md:grid-cols-2">
                            <Field
                              className="md:col-span-2"
                              htmlFor="order-workflow-item"
                              label={l("Checklistenpunkt", "Пункт чеклиста")}
                            >
                              <Input
                                id="order-workflow-item"
                                value={workflowForm.itemText}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    itemText: event.target.value,
                                  }))
                                }
                                className={inputClassName}
                                placeholder={l(
                                  "Eskalationsanruf, Klinik-Nachverfolgung, Dokumentenübergabe ...",
                                  "Эскалационный звонок, follow-up с клиникой, передача документа...",
                                )}
                              />
                            </Field>
                            <Field
                              htmlFor="order-workflow-owner"
                              label={l("Verantwortlich", "Ответственный")}
                            >
                              <NativeComboboxSelect
                                id="order-workflow-owner"
                                className={selectClassName}
                                value={workflowForm.ownerUserId}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    ownerUserId: event.target.value,
                                  }))
                                }
                              >
                                <option value="">{l("Aktueller Benutzer", "Текущий пользователь")}</option>
                                {activeWorkflowAssignments.map((item) => (
                                  <option
                                    key={item.user_id}
                                    value={item.user_id}
                                  >
                                    {item.user_name} · {roleLabel(item.user_role)}
                                  </option>
                                ))}
                              </NativeComboboxSelect>
                            </Field>
                            <Field
                              htmlFor="order-workflow-priority"
                              label={l("Priorität", "Приоритет")}
                            >
                              <NativeComboboxSelect
                                id="order-workflow-priority"
                                className={selectClassName}
                                value={workflowForm.priority}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    priority: event.target.value,
                                  }))
                                }
                              >
                                {["low", "normal", "high", "urgent"].map(
                                  (priority) => (
                                    <option key={priority} value={priority}>
                                      {priorityLabel(priority)}
                                    </option>
                                  ),
                                )}
                              </NativeComboboxSelect>
                            </Field>
                            <Field
                              htmlFor="order-workflow-due"
                              label={l("Fällig am", "Срок")}
                            >
                              <Input
                                id="order-workflow-due"
                                type="datetime-local"
                                value={workflowForm.dueDate}
                                onChange={(event) =>
                                  setWorkflowForm((current) => ({
                                    ...current,
                                    dueDate: event.target.value,
                                  }))
                                }
                                className={inputClassName}
                              />
                            </Field>
                          </div>
                          <div className="mt-4 flex justify-end">
                            <Button
                              type="submit"
                              disabled={
                                workflowBusy || !workflowForm.itemText.trim()
                              }
                            >
                              {workflowBusy ? (
                                <LoaderCircle className="mr-2 size-4 animate-spin" />
                              ) : null}
                              {l("Workflow-Punkt hinzufügen", "Добавить пункт workflow")}
                            </Button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : (
                    <EmptyState
                      title={l(
                        "Noch keine Workflow-Punkte",
                        "Пунктов workflow пока нет",
                      )}
                      description={l(
                        "Checklistenpunkte werden aus der aktuellen Phase erzeugt, sobald der Auftragskontext geladen ist.",
                        "Пункты чеклиста генерируются из текущей фазы после загрузки контекста заказа.",
                      )}
                    />
                  )}
                  </SectionCard>
                ) : null}

                {shouldRenderOrderSection("services") ? (
                  <>
                    <div className="flex flex-wrap gap-6 rounded-xl border border-border px-4 py-3">
                      <AdminInlineMetric
                        icon={ClipboardList}
                        label={eyebrowWithDot(tx.providers_services)}
                        value={String(leistungMetrics.total)}
                        description={t.orders_services_metric_total_description}
                        tone="sky"
                      />
                      <AdminInlineMetric
                        icon={CheckCircle2}
                        label={eyebrowWithDot(t.orders_services_pending_approval_label)}
                        value={String(leistungMetrics.delivered)}
                        description={t.orders_services_pending_approval_description}
                        tone="amber"
                      />
                      <AdminInlineMetric
                        icon={Wallet}
                        label={eyebrowWithDot(t.orders_services_approved_label)}
                        value={String(leistungMetrics.approved)}
                        description={t.orders_services_approved_description}
                        tone="emerald"
                      />
                      <AdminInlineMetric
                        icon={Building2}
                        label={eyebrowWithDot(tx.contracts_total)}
                        value={formatMoney(leistungMetrics.gross)}
                        description={t.orders_services_gross_description}
                        tone="slate"
                      />
                    </div>

                    {permissions.canAddLeistung ? (
                      <OrderServiceGroupWizard
                        providers={providers}
                        providerDoctors={providerDoctors}
                        creating={serviceGroupCreating}
                        error={serviceGroupWizardError}
                        onLoadProviderDoctors={(providerId) =>
                          void ensureProviderDoctors(providerId)
                        }
                        onCreate={handleCreateServiceGroup}
                      />
                    ) : null}

                    {serviceGroupsLoading ||
                    serviceGroupsError ||
                    orderServiceGroups.length > 0 ? (
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
                      </div>
                    ) : null}

                    <SectionCard
                      title={tx.providers_services}
                      description={t.orders_services_section_description}
                      action={
                        permissions.canAddLeistung ? (
                          <Button onClick={() => resetLeistungDialog(true)}>
                            <Plus className="mr-2 size-4" />
                            {t.orders_add_service}
                          </Button>
                        ) : null
                      }
                    >
                  {orderDetail.leistungen.length === 0 ? (
                    <EmptyState
                      title={tx.common_not_set}
                      description={t.orders_services_empty_description}
                      action={
                        permissions.canAddLeistung ? (
                          <Button onClick={() => resetLeistungDialog(true)}>
                            <Plus className="mr-2 size-4" />
                            {t.orders_add_service}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {orderDetail.leistungen.map((leistung) => (
                        <div
                          key={leistung.id}
                          className="rounded-2xl border border-border p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold text-foreground">
                                  {normalizeLeistungDescription(leistung.description)}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "rounded-full",
                                    statusClassName(leistung.status),
                                  )}
                                >
                                  {leistungStatusLabel(leistung.status)}
                                </Badge>
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
                                    {leistung.agency_service_name ||
                                      leistung.agency_service_key}
                                  </Badge>
                                ) : null}
                              </div>

                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                <DetailField
                                  label={t.common_provider}
                                  value={
                                    leistung.provider_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          staffGo(
                                            `/providers?provider=${leistung.provider_id}`,
                                          )
                                        }
                                      >
                                        {leistung.provider_name ||
                                          t.orders_open_provider}
                                      </button>
                                    ) : (
                                      leistung.provider_name ||
                                      t.orders_unlinked
                                    )
                                  }
                                />
                                <DetailField
                                  label={t.common_doctor}
                                  value={
                                    leistung.provider_id &&
                                    leistung.doctor_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          staffGo(
                                            `/appointments?provider=${leistung.provider_id}&doctor=${leistung.doctor_id}`,
                                          )
                                        }
                                      >
                                        {leistung.doctor_name ||
                                          t.orders_open_doctor_context}
                                      </button>
                                    ) : (
                                      leistung.doctor_name ||
                                      t.orders_not_specified
                                    )
                                  }
                                />
                                <DetailField
                                  label={t.providers_service_price}
                                  value={formatNumber(leistung.quantity, locale)}
                                />
                                <DetailField
                                  label={tx.invoices_amount}
                                  value={formatMoney(
                                    leistung.unit_price,
                                    leistung.currency,
                                  )}
                                />
                                <DetailField
                                  label={t.providers_service_price}
                                  value={`${formatNumber(leistung.vat_rate, locale)}%`}
                                />
                                <DetailField
                                  label={tx.invoices_total}
                                  value={formatMoney(
                                    (numberFromUnknown(leistung.quantity) ??
                                      0) *
                                      (numberFromUnknown(leistung.unit_price) ??
                                        0),
                                    leistung.currency,
                                  )}
                                />
                                <DetailField
                                  label={tx.common_active}
                                  value={formatDateTimeLabel(leistung.delivered_at)}
                                />
                                <DetailField
                                  label={tx.common_active}
                                  value={formatDateTimeLabel(leistung.approved_at)}
                                />
                                <DetailField
                                  label={t.orders_supporting_document}
                                  value={
                                    leistung.external_document_id ? (
                                      <button
                                        type="button"
                                        className="text-left font-medium text-sky-700 hover:text-sky-800"
                                        onClick={() =>
                                          staffGo(
                                            `/documents?order=${orderDetail.id}&patient=${orderDetail.patient_id}`,
                                          )
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
                                    )
                                  }
                                />
                                <DetailField
                                  label={t.orders_billing_source}
                                  value={
                                    leistung.source_interpreter_report_id
                                      ? `${t.orders_billing_source_interpreter_report} ${leistung.source_interpreter_report_id}`
                                      : leistung.source_medical_appointment_id
                                        ? `${t.orders_billing_source_completed_appointment} ${leistung.source_medical_appointment_id}`
                                        : t.orders_billing_source_manual
                                  }
                                />
                                <DetailField
                                  label={t.orders_agency_service}
                                  value={
                                    leistung.agency_service_name ||
                                    leistung.agency_service_key ||
                                    t.orders_not_catalog_linked
                                  }
                                />
                              </div>

                              {leistung.notes ? (
                                <div className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                                  {leistung.notes}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 items-start">
                              {permissions.canApproveLeistung &&
                              leistung.status === "delivered" ? (
                                <Button
                                  onClick={() =>
                                    void handleApproveLeistung(leistung.id)
                                  }
                                  disabled={approvingLeistungId === leistung.id}
                                >
                                  {approvingLeistungId === leistung.id ? (
                                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                                  ) : (
                                    <CheckCircle2 className="mr-2 size-4" />
                                  )}
                                  {t.orders_approve}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                    </SectionCard>
                  </>
                ) : null}

                {shouldRenderOrderSection("invoices") ? (
                  <SectionCard
                    title={t.orders_external_invoices_title}
                    description={t.orders_external_invoices_description}
                  >
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      label={t.orders_external_invoices_count_label}
                      value={String(externalInvoiceMetrics.total)}
                      description={t.orders_external_invoices_count_description}
                      icon={<Wallet className="size-4" />}
                    />
                    <StatCard
                      label={t.orders_external_invoices_overdue_label}
                      value={String(externalInvoiceMetrics.overdue)}
                      description={t.orders_external_invoices_overdue_description}
                      icon={<CalendarClock className="size-4" />}
                    />
                    <StatCard
                      label={t.orders_external_invoices_paid_label}
                      value={String(externalInvoiceMetrics.paid)}
                      description={t.orders_external_invoices_paid_description}
                      icon={<CheckCircle2 className="size-4" />}
                    />
                    <StatCard
                      label={t.orders_external_invoices_gross_label}
                      value={formatMoney(externalInvoiceMetrics.gross)}
                      description={t.orders_external_invoices_gross_description}
                      icon={<Building2 className="size-4" />}
                    />
                  </div>

                  <div className="mt-5 space-y-5">
                    {permissions.canManageExternalInvoices ? (
                      <form
                        onSubmit={handleCreateExternalInvoice}
                        className="rounded-2xl border border-border p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              {titleWithDot(
                                t.orders_external_invoice_create_title,
                              )}
                            </h3>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {t.orders_external_invoice_create_description}
                            </p>
                          </div>
                        </div>
                        {externalInvoiceError ? (
                          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {externalInvoiceError}
                          </div>
                        ) : null}
                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <Field label={t.orders_external_invoice_number}>
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
                          <Field label={t.common_provider}>
                            <NativeComboboxSelect
                              value={externalInvoiceForm.providerId}
                              onChange={(event) =>
                                setExternalInvoiceForm((current) => ({
                                  ...current,
                                  providerId: event.target.value,
                                }))
                              }
                              className={selectClassName}
                            >
                              <option value="">{t.common_not_set}</option>
                              {providers.map((provider) => (
                                <option key={provider.id} value={provider.id}>
                                  {provider.name}
                                </option>
                              ))}
                            </NativeComboboxSelect>
                          </Field>
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
                          <Field label={t.orders_external_invoice_status}>
                            <NativeComboboxSelect
                              value={externalInvoiceForm.status}
                              onChange={(event) =>
                                setExternalInvoiceForm((current) => ({
                                  ...current,
                                  status: event.target
                                    .value as ExternalInvoiceStatus,
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
                          <Field className="md:col-span-2 xl:col-span-4" label={t.patients_notes}>
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
                        </div>
                        <div className="mt-4 flex justify-end">
                          <Button
                            type="submit"
                            disabled={externalInvoiceSaving}
                          >
                            {externalInvoiceSaving ? (
                              <LoaderCircle className="mr-2 size-4 animate-spin" />
                            ) : (
                              <Plus className="mr-2 size-4" />
                            )}
                            {t.orders_external_invoice_add}
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {(orderDetail.external_invoices ?? []).length === 0 ? (
                      <EmptyState
                        title={t.orders_external_invoices_empty_title}
                        description={t.orders_external_invoices_empty_description}
                      />
                    ) : (
                      <div className="space-y-3">
                        {(orderDetail.external_invoices ?? []).map(
                          (invoice) => (
                            <div
                              key={invoice.id}
                              className="rounded-2xl border border-border p-4"
                            >
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-base font-semibold text-foreground">
                                      {invoice.external_invoice_number}
                                    </div>
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "rounded-full",
                                        statusClassName(invoice.status),
                                      )}
                                    >
                                      {externalInvoiceStatusLabel(invoice.status)}
                                    </Badge>
                                    {invoice.provider_name ? (
                                      <Badge
                                        variant="outline"
                                        className="rounded-full border-sky-200 bg-sky-50 text-sky-700"
                                      >
                                        {invoice.provider_name}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                    <DetailField
                                      label={t.orders_external_invoice_date}
                                      value={formatDateLabel(invoice.invoice_date)}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_due_date}
                                      value={formatDateLabel(invoice.due_date)}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_net}
                                      value={formatMoney(
                                        invoice.amount_net,
                                        invoice.currency,
                                      )}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_vat}
                                      value={formatMoney(
                                        invoice.amount_vat,
                                        invoice.currency,
                                      )}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_gross}
                                      value={formatMoney(
                                        invoice.amount_gross,
                                        invoice.currency,
                                      )}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_received}
                                      value={formatDateTimeLabel(
                                        invoice.received_at,
                                      )}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_paid}
                                      value={formatDateTimeLabel(invoice.paid_at)}
                                    />
                                    <DetailField
                                      label={t.orders_external_invoice_updated}
                                      value={formatDateTimeLabel(invoice.updated_at)}
                                    />
                                  </div>
                                  {invoice.notes ? (
                                    <div className="rounded-xl border border-border px-4 py-3 text-sm text-muted-foreground">
                                      {invoice.notes}
                                    </div>
                                  ) : null}
                                </div>

                                {permissions.canManageExternalInvoices ? (
                                  <div className="flex shrink-0 flex-wrap gap-2">
                                    {invoice.status !== "approved" ? (
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          void handleUpdateExternalInvoiceStatus(
                                            invoice.id,
                                            "approved",
                                          )
                                        }
                                        disabled={
                                          externalInvoiceUpdatingId ===
                                          invoice.id
                                        }
                                      >
                                        {externalInvoiceUpdatingId ===
                                        invoice.id ? (
                                          <LoaderCircle className="mr-2 size-4 animate-spin" />
                                        ) : null}
                                        {t.orders_external_invoice_mark_approved}
                                      </Button>
                                    ) : null}
                                    {invoice.status !== "paid" ? (
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          void handleUpdateExternalInvoiceStatus(
                                            invoice.id,
                                            "paid",
                                          )
                                        }
                                        disabled={
                                          externalInvoiceUpdatingId ===
                                          invoice.id
                                        }
                                      >
                                        {externalInvoiceUpdatingId ===
                                        invoice.id ? (
                                          <LoaderCircle className="mr-2 size-4 animate-spin" />
                                        ) : null}
                                        {t.orders_external_invoice_mark_paid}
                                      </Button>
                                    ) : null}
                                    {invoice.status !== "cancelled" ? (
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          void handleUpdateExternalInvoiceStatus(
                                            invoice.id,
                                            "cancelled",
                                          )
                                        }
                                        disabled={
                                          externalInvoiceUpdatingId ===
                                          invoice.id
                                        }
                                      >
                                        {externalInvoiceUpdatingId ===
                                        invoice.id ? (
                                          <LoaderCircle className="mr-2 size-4 animate-spin" />
                                        ) : null}
                                        {t.orders_external_invoice_cancel}
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                  </SectionCard>
                ) : null}
              </>
            )}
          </AdminSheetScaffold>
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
              <div className="space-y-4 rounded-xl p-4">
                {createError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {createError}
                  </div>
                ) : null}

                <OrderSheetSection title={l("Grunddaten", "Основные данные")}>
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
                  <OrderSheetSection title={l("Re-Check", "Повторная проверка")}>
                    <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-6 text-muted-foreground">
                      {l(
                        "Stammdaten, Compliance, Identitat, Dokumentenpaket, Vertragsstatus und Debt-Hold vor dem Anlegen eines neuen Auftrags prufen.",
                        "Проверьте базовые данные, compliance, идентификацию, комплект документов, статус договора и debt-hold перед созданием нового заказа.",
                      )}
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
                        ? l("Nicht erforderlich", "Не требуется")
                        : createRecheck.can_create_order
                          ? l("Bereit fur Auftrag", "Готов к заказу")
                          : l("Blockiert", "Заблокирован")}
                    </Badge>
                  ) : null}
                </div>

                {createRecheckLoading ? (
                  <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" />
                    {l(
                      "Patienten-Re-Check wird geladen...",
                      "Загрузка повторной проверки пациента...",
                    )}
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
                            className="rounded-xl border border-border bg-card px-3 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm text-foreground">
                                {check.key === "base_data"
                                  ? l("Stammdaten vollstandig", "Базовые данные заполнены")
                                  : check.key === "compliance"
                                    ? l("Compliance-Dokumente gultig", "Compliance-документы валидны")
                                    : check.key === "identity"
                                      ? l("Identitat verifiziert", "Личность подтверждена")
                                      : check.key === "document_pack"
                                        ? l(
                                            "Erforderliche Patientendokumente vollstandig",
                                            "Обязательные документы пациента собраны",
                                          )
                                        : check.key === "contract"
                                          ? l("Vertragsunterlagen gultig", "Договорные документы валидны")
                                          : check.key === "debt_clear"
                                            ? l("Debt-Hold aufgehoben", "Debt-hold снят")
                                            : check.label}
                              </span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "rounded-full",
                                  recheckBadgeClass(check.passed),
                                )}
                              >
                                {check.passed
                                  ? "OK"
                                  : l("Aktualisierung notig", "Требует обновления")}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {createRecheck.reason
                          ? localizedBlockingReason(createRecheck.reason)
                          : l(
                              "Vor dem ersten operativen Auftrag ist kein Bestandskunden-Re-Check erforderlich.",
                              "Повторная проверка существующего клиента не требуется перед первым операционным заказом.",
                            )}
                      </div>
                    )}

                    {createRecheck.requires_recheck &&
                    createRecheck.base_data_missing_fields.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        {l("Fehlende Stammdaten", "Не хватает базовых данных")}:{" "}
                        {createRecheck.base_data_missing_fields
                          .map((field) =>
                            recheckMissingFieldLabel(field, {
                              primary_contact: l("Hauptkontakt", "Основной контакт"),
                              country: l("Land", "Страна"),
                              language: l("Bevorzugte Sprache", "Предпочитаемый язык"),
                            }, t),
                          )
                          .join(", ")}
                      </div>
                    ) : null}

                    {createRecheck.requires_recheck &&
                    createRecheck.blocking_reasons.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        <div className="font-medium">
                          {l("Blockierende Grunde", "Блокирующие причины")}
                        </div>
                        <ul className="mt-2 list-disc space-y-1 pl-5">
                          {createRecheck.blocking_reasons.map((reason) => (
                            <li key={reason}>{localizedBlockingReason(reason)}</li>
                          ))}
                        </ul>
                      </div>
                    ) : createRecheck.requires_recheck ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {l(
                          "Der Bestandskunden-Re-Check ist vollstandig. Der Patient kann in einen neuen Auftrag ubergehen.",
                          "Повторная проверка существующего клиента завершена. Пациент может перейти в новый заказ.",
                        )}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                      <div className="space-y-1">
                        <div>
                          {createRecheck.requires_recheck &&
                          createRecheck.document_alerts.missing_count > 0
                            ? l(
                                `${createRecheck.document_alerts.missing_count} erforderliche Dokument(e) fehlen noch`,
                                `Ещё не хватает ${createRecheck.document_alerts.missing_count} обязательных документ(ов)`,
                              )
                            : createRecheck.requires_recheck
                              ? l(
                                  "Erforderliches Dokumentenpaket ist vollstandig",
                                  "Обязательный комплект документов собран",
                                )
                              : l(
                                  "Fur Bestandskundendokumente ist noch kein Check erforderlich",
                                  "Проверка документов существующего клиента пока не требуется",
                                )}
                        </div>
                        <div>
                          {createRecheck.requires_recheck &&
                          createRecheck.debt_hold
                            ? l(
                                `${createRecheck.overdue_invoice_count} uberfallige Rechnung(en) halten den Patienten im Debt-Hold`,
                                `${createRecheck.overdue_invoice_count} просроченных счет(ов) держат пациента в debt-hold`,
                              )
                            : createRecheck.requires_recheck
                              ? l(
                                  "Keine uberfalligen Forderungen erkannt",
                                  "Просроченной задолженности не найдено",
                                )
                              : l(
                                  "Debt-Hold wird gepruft, sobald eine fruhere Kundenhistorie existiert",
                                  "Debt-hold проверяется, когда уже есть история предыдущего клиента",
                                )}
                        </div>
                        {createRecheck.requires_recheck &&
                        createRecheck.outstanding_balance ? (
                          <div>
                            {l("Offener Saldo", "Открытый остаток")}:{" "}
                            {formatMoney(createRecheck.outstanding_balance)}
                          </div>
                        ) : null}
                        {createRecheck.requires_recheck &&
                        createRecheck.debt_management?.latest_workflow ? (
                          <div>
                            {l("Letzter Debt-Workflow", "Последний debt-workflow")}:{" "}
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
                            {l("Letzter Rahmenvertrag", "Последний рамочный договор")}:{" "}
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
                            {l(
                              "Noch kein Rahmenvertrag hinterlegt",
                              "Рамочный договор пока не зафиксирован",
                            )}
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
                        {l("Patientenprofil offnen", "Открыть профиль пациента")}
                      </Button>
                    </div>
                  </div>
                ) : null}
                    </div>
                  </OrderSheetSection>
                ) : null}

                <OrderSheetSection title={l("Zusätzlich", "Дополнительно")}>
                  <Field label={t.orders_intake_note}>
                    <textarea
                      value={createForm.needsDescription}
                      onChange={(event) =>
                        setCreateForm((current) => ({
                          ...current,
                          needsDescription: event.target.value,
                        }))
                      }
                      className={cn(textareaClassName, "min-h-[140px] bg-background/60")}
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
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
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
            >
            {leistungError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {leistungError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.orders_service_description}>
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
              <Field label={t.orders_service_notes}>
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

            <div className="grid gap-4 md:grid-cols-3">
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

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.orders_service_provider}>
                <NativeComboboxSelect
                  value={leistungForm.providerId}
                  onChange={(event) => {
                    const providerId = event.target.value;
                    setLeistungForm((current) => ({
                      ...current,
                      providerId,
                      doctorId: "",
                    }));
                  }}
                  className={selectClassName}
                >
                  <option value="">{t.common_provider}</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                      {provider.address_city
                        ? ` (${provider.address_city})`
                        : ""}
                    </option>
                  ))}
                </NativeComboboxSelect>
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
                      {doctor.fachbereich ? ` (${doctor.fachbereich})` : ""}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>

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
