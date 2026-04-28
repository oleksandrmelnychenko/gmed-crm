import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
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
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
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
const ORDER_COLUMN_GROUPS = {
  identity: "Identity",
  workflow: "Workflow",
  finance: "Finance",
  audit: "Audit",
};

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
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className={cn("rounded-xl p-3", tokens.surface.mutedCard)}>
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
      <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
      <span>{title}</span>
    </span>
  );
}

export function OrdersPage() {
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
      custom: l("Individuell", "Individualno"),
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
      admin: l("Admin", "Администратор"),
      assistant: l("CEO-Assistenz", "Ассистент CEO"),
      patient_manager: l("Patientenmanagement", "Пациент-менеджер"),
      billing: l("Billing", "Billing"),
      concierge: l("Concierge", "Консьерж"),
      interpreter: l("Dolmetscher", "Переводчик"),
      teamlead_interpreter: l("Dolmetscher-Teamlead", "Тимлид переводчиков"),
      debt_owner: l("Debt-Owner", "Ответственный по debt"),
    }),
    [l],
  );
  const labelFor = (value: string | null | undefined, labels: Record<string, string>) =>
    (value ? labels[value] : null) ?? value ?? l("Nicht festgelegt", "Не указано");
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
              "Billing-Release fehlt und die Paketdeckung ist nicht bestatigt.",
            "Order signatures are still incomplete":
              "Die Auftragssignaturen sind noch nicht vollstandig.",
            "Advance invoice exists but payment is still missing":
              "Es gibt eine Vorausrechnung, aber die Zahlung fehlt noch.",
            "Treatment plan must be finalized before execution":
              "Der Behandlungsplan muss vor der Durchfuhrung finalisiert sein.",
            "At least one confirmed medical appointment is required":
              "Mindestens ein bestatigter medizinischer Termin ist erforderlich.",
            "Required non-medical services still need a confirmed booking":
              "Erforderliche nicht-medizinische Leistungen brauchen noch eine bestatigte Buchung.",
            "Interpreter is required but not assigned yet":
              "Ein Dolmetscher ist erforderlich, aber noch nicht zugewiesen.",
            "Assigned interpreter has not confirmed yet":
              "Der zugewiesene Dolmetscher hat noch nicht bestatigt.",
            "Interpreter briefing is still pending":
              "Das Dolmetscher-Briefing ist noch ausstehend.",
            "Preparation documents still need to be sent":
              "Vorbereitungsunterlagen mussen noch versendet werden.",
            "Patient arrival or execution start is not recorded yet":
              "Patientenankunft oder Durchfuhrungsstart sind noch nicht erfasst.",
            "Medical execution must be completed and backed by delivered appointments or services":
              "Die medizinische Durchfuhrung muss abgeschlossen und durch erbrachte Termine oder Leistungen belegt sein.",
            "Required non-medical services still need execution confirmation":
              "Erforderliche nicht-medizinische Leistungen brauchen noch eine Durchfuhrungsbestatigung.",
            "Interpreter-supported execution still needs completion or report confirmation":
              "Dolmetscher-gestutzte Durchfuhrung braucht noch Abschluss oder Berichtbestatigung.",
            "Execution deviations or incidents must be resolved or marked as not required":
              "Abweichungen oder Vorfalle mussen geklart oder als nicht erforderlich markiert werden.",
            "Results, Arztbrief or final patient handoff still need to be released":
              "Ergebnisse, Arztbrief oder finale Patientenubergabe mussen noch freigegeben werden.",
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
            "Identity is not verified": "Die Identitat ist nicht verifiziert.",
            "Valid contract documentation is missing":
              "Gultige Vertragsdokumentation fehlt.",
            "Patient is still in debt-management hold":
              "Der Patient befindet sich noch im Debt-Hold.",
            "Existing-customer re-check is not required before the first operational order":
              "Vor dem ersten operativen Auftrag ist kein Bestandskunden-Re-Check erforderlich.",
          }[reason]
        : {
            "Billing release is not granted and package coverage is not confirmed":
              "Billing-release ne vydan, a pokrytie paketom ne podtverzhdeno.",
            "Order signatures are still incomplete":
              "Podpisi po zakazu eshche ne zaversheny.",
            "Advance invoice exists but payment is still missing":
              "Est avansovyy schet, no oplata eshche ne postupila.",
            "Treatment plan must be finalized before execution":
              "Plan lecheniya dolzhen byt finalizirovan do ispolneniya.",
            "At least one confirmed medical appointment is required":
              "Nuzhen kak minimum odin podtverzhdennyy meditsinskiy priem.",
            "Required non-medical services still need a confirmed booking":
              "Objazatelnye nemeditsinskie uslugi eshche trebuyut podtverzhdennogo bronirovaniya.",
            "Interpreter is required but not assigned yet":
              "Perevodchik trebuetsya, no eshche ne naznachen.",
            "Assigned interpreter has not confirmed yet":
              "Naznachennyy perevodchik eshche ne podtverdil uchastie.",
            "Interpreter briefing is still pending":
              "Brifing perevodchika vse eshche ozhidaetsya.",
            "Preparation documents still need to be sent":
              "Podgotovitelnye dokumenty eshche nuzhno otpravit.",
            "Patient arrival or execution start is not recorded yet":
              "Pribytie patsienta ili start ispolneniya eshche ne zafiksirovany.",
            "Medical execution must be completed and backed by delivered appointments or services":
              "Meditsinskaya chast dolzhna byt zavershena i podtverzhdena okazannymi priemami ili uslugami.",
            "Required non-medical services still need execution confirmation":
              "Objazatelnye nemeditsinskie uslugi eshche trebuyut podtverzhdeniya ispolneniya.",
            "Interpreter-supported execution still needs completion or report confirmation":
              "Ispolnenie s uchastiem perevodchika eshche trebuet zaversheniya ili podtverzhdeniya otcheta.",
            "Execution deviations or incidents must be resolved or marked as not required":
              "Otkлонeniya ili intsidenty ispolneniya dolzhny byt zakryty ili pomеcheny kak ne trebuyushchie deystviy.",
            "Results, Arztbrief or final patient handoff still need to be released":
              "Rezul'taty, Arztbrief ili finalnaya peredacha patsientu eshche dolzhny byt vypushcheny.",
            "Doctor-directed follow-up is required but not scheduled yet":
              "Follow-up po naznacheniyu vracha trebuetsya, no eshche ne zaplanirovan.",
            "1-week follow-up is not scheduled yet":
              "1-nedelnyy follow-up eshche ne zaplanirovan.",
            "1-month follow-up is not scheduled yet":
              "1-mesyachnyy follow-up eshche ne zaplanirovan.",
            "6-month follow-up is not scheduled yet":
              "6-mesyachnyy follow-up eshche ne zaplanirovan.",
            "Package-end follow-up is required but not scheduled yet":
              "Follow-up po zaversheniyu paketa trebuetsya, no eshche ne zaplanirovan.",
            "No follow-up reminder, task or appointment has been launched yet":
              "Eshche ne zapushcheno ni odnogo napominaniya, zadachi ili priema po follow-up.",
            "Primary contact is missing": "Ne ukazan osnovnoy kontakt.",
            "Residence or address country is missing":
              "Ne ukazana strana prozhivaniya ili adresa.",
            "Preferred language is missing": "Ne ukazan predpochitaemyy yazyk.",
            "Compliance status is not completed":
              "Status compliance ne zavershen.",
            "DSGVO/compliance documents are not signed":
              "Dokumenty DSGVO/compliance ne podpisany.",
            "Identity is not verified": "Lichnost ne podtverzhdena.",
            "Valid contract documentation is missing":
              "Net validnogo dogovornogo paketa.",
            "Patient is still in debt-management hold":
              "Patsient vse eshche nakhoditsya v debt-hold.",
            "Existing-customer re-check is not required before the first operational order":
              "Povtornaya proverka sushchestvuyushchego klienta ne trebuetsya pered pervym operatsionnym zakazom.",
          }[reason];
    if (exact) return exact;
    const executionChecklistMatch = reason.match(
      /^(\\d+) execution checklist item\\(s\\) remain open$/,
    );
    if (executionChecklistMatch) {
      const count = Number(executionChecklistMatch[1]);
      return l(
        `${count} Punkt(e) der Durchfuhrungs-Checkliste sind noch offen.`,
        `Otkryto eshche ${count} punkt(ov) cheklista ispolneniya.`,
      );
    }
    const missingDocsMatch = reason.match(
      /^(\\d+) required patient document\\(s\\) are missing$/,
    );
    if (missingDocsMatch) {
      const count = Number(missingDocsMatch[1]);
      return l(
        `${count} erforderliche Patientendokument(e) fehlen.`,
        `Ne khvataet ${count} obyazatelnykh dokument(ov) patsienta.`,
      );
    }
    return reason;
  };

  const [filters, setFilters] = useState<OrdersFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [providerDoctors, setProviderDoctors] = useState<
    Record<string, DoctorOption[]>
  >({});
  const [orderDocuments, setOrderDocuments] = useState<
    SupportingDocumentOption[]
  >([]);

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(
    routeOrderId || null,
  );
  const [orderDetail, setOrderDetail] = useState<OrderDetail | null>(null);
  const [workflowChecklist, setWorkflowChecklist] =
    useState<WorkflowChecklistResponse | null>(null);
  const [workflowAssignments, setWorkflowAssignments] = useState<
    PatientAssignmentOption[]
  >([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [phaseDraft, setPhaseDraft] = useState("");
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [approvingLeistungId, setApprovingLeistungId] = useState<string | null>(
    null,
  );
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowForm, setWorkflowForm] = useState<WorkflowChecklistFormState>(
    blankWorkflowChecklistForm,
  );
  const [processGateBusy, setProcessGateBusy] = useState(false);
  const [processGateError, setProcessGateError] = useState<string | null>(null);
  const [processGateForm, setProcessGateForm] =
    useState<OrderProcessGateFormState>(blankOrderProcessGateForm);
  const [debtQueue, setDebtQueue] = useState<OrderDebtQueueItem[]>([]);
  const [debtQueueLoading, setDebtQueueLoading] = useState(false);
  const [debtQueueError, setDebtQueueError] = useState<string | null>(null);
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState<string | null>(null);
  const [planningForm, setPlanningForm] = useState<OrderPlanningFormState>(
    blankOrderPlanningForm,
  );
  const [executionBusy, setExecutionBusy] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [executionForm, setExecutionForm] = useState<OrderExecutionFormState>(
    blankOrderExecutionForm,
  );
  const [followupBusy, setFollowupBusy] = useState(false);
  const [followupError, setFollowupError] = useState<string | null>(null);
  const [followupForm, setFollowupForm] = useState<OrderFollowupFormState>(
    blankOrderFollowupForm,
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreateOrderFormState>(blankCreateOrderForm);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createRecheck, setCreateRecheck] =
    useState<PatientOrderRecheck | null>(null);
  const [createRecheckLoading, setCreateRecheckLoading] = useState(false);
  const [createRecheckError, setCreateRecheckError] = useState<string | null>(
    null,
  );

  const [leistungOpen, setLeistungOpen] = useState(false);
  const [leistungForm, setLeistungForm] =
    useState<LeistungFormState>(blankLeistungForm);
  const [leistungSaving, setLeistungSaving] = useState(false);
  const [leistungError, setLeistungError] = useState<string | null>(null);
  const [externalInvoiceForm, setExternalInvoiceForm] =
    useState<ExternalInvoiceFormState>(blankExternalInvoiceForm);
  const [externalInvoiceSaving, setExternalInvoiceSaving] = useState(false);
  const [externalInvoiceError, setExternalInvoiceError] = useState<
    string | null
  >(null);
  const [externalInvoiceUpdatingId, setExternalInvoiceUpdatingId] = useState<
    string | null
  >(null);

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
      label: workflowChecklistLabel(key, workflowGroupLabels),
      items: groupItems,
    }));
  }, [workflowChecklist, workflowGroupLabels]);
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

  useRealtimeSubscription(ORDER_REALTIME_EVENTS, (event) => {
    if (!permissions.canViewPage) return;
    const eventOrderId =
      typeof event.payload?.order_id === "string" ? event.payload.order_id : null;
    clearApiCache("/orders");
    clearApiCache("/orders/debt-management");
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
    if (
      selectedOrderId &&
      selectedOrderId !== event.entity_id &&
      selectedOrderId !== eventOrderId
    ) {
      clearApiCache(`/orders/${selectedOrderId}`);
      clearApiCache(`/orders/${selectedOrderId}/workflow-checklist`);
      clearApiCache(`/documents?order_id=${selectedOrderId}`);
    }
    triggerReload();
  });

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

    if (orderParam && orderParam !== selectedOrderId) {
      setSelectedOrderId(orderParam);
      setDetailLoading(true);
    } else if (!orderParam && selectedOrderId) {
      resetOrderWorkspace();
    }

    if (createParam && permissions.canCreate) {
      setCreateError(null);
      setCreateForm({
        ...blankCreateOrderForm(),
        patientId: patientParam,
      });
      setCreateOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    }
  }, [
    permissions.canCreate,
    resetOrderWorkspace,
    routeOrderId,
    searchParams,
    selectedOrderId,
    setSearchParams,
    staffGo,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    async function loadDirectory() {
      try {
        const directory = await fetchOrderDirectory();
        if (cancelled) return;
        setPatients(directory.patients);
        setProviders(directory.providers);
      } catch {
        if (cancelled) return;
        setPatients([]);
        setProviders([]);
      }
    }

    void loadDirectory();
    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

  useEffect(() => {
    if (!createOpen || !createForm.patientId) {
      setCreateRecheck(null);
      setCreateRecheckError(null);
      setCreateRecheckLoading(false);
      return;
    }

    let cancelled = false;
    setCreateRecheckLoading(true);
    setCreateRecheckError(null);

    async function loadCreateRecheck() {
      try {
        const response = await fetchPatientOrderRecheck(createForm.patientId);
        if (cancelled) return;
        setCreateRecheck(response);
      } catch (error) {
        if (cancelled) return;
        setCreateRecheck(null);
        setCreateRecheckError(
          error instanceof Error
            ? error.message
            : "Failed to load patient re-check",
        );
      } finally {
        if (!cancelled) {
          setCreateRecheckLoading(false);
        }
      }
    }

    void loadCreateRecheck();
    return () => {
      cancelled = true;
    };
  }, [createForm.patientId, createOpen]);

  useEffect(() => {
    if (!permissions.canViewPage) return;

    let cancelled = false;
    setLoading(true);
    setListError(null);

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
        setOrders(response);
      } catch (error) {
        if (cancelled) return;
        setListError(
          error instanceof Error ? error.message : "Failed to load orders",
        );
        setOrders([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadOrders();
    return () => {
      cancelled = true;
    };
  }, [
    deferredSearch,
    filters.doctorId,
    filters.patientId,
    filters.phase,
    filters.providerId,
    filters.status,
    permissions.canViewPage,
    reloadNonce,
  ]);

  useEffect(() => {
    if (!permissions.canViewPage || !canManageDebt) {
      setDebtQueue([]);
      setDebtQueueError(null);
      setDebtQueueLoading(false);
      return;
    }

    let cancelled = false;
    setDebtQueueLoading(true);
    setDebtQueueError(null);

    async function loadDebtQueue() {
      try {
        const response = await fetchOrderDebtQueue();
        if (cancelled) return;
        setDebtQueue(response);
      } catch (error) {
        if (cancelled) return;
        setDebtQueue([]);
        setDebtQueueError(
          error instanceof Error
            ? error.message
            : "Failed to load debt-management queue",
        );
      } finally {
        if (!cancelled) {
          setDebtQueueLoading(false);
        }
      }
    }

    void loadDebtQueue();
    return () => {
      cancelled = true;
    };
  }, [canManageDebt, permissions.canViewPage, reloadNonce]);

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
      setOrderDetail(null);
      setOrderDocuments([]);
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
      return;
    }

    const currentOrderId = selectedOrderId;
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    async function loadDetail() {
      try {
        const { detail, documents, workflow, assignments } =
          await fetchOrderWorkspace(currentOrderId);
        if (cancelled) return;
        setOrderDetail(detail);
        setOrderDocuments(documents);
        setWorkflowChecklist(workflow);
        setWorkflowAssignments(assignments);
        setPhaseDraft(detail.phase);
        setProcessGateForm(orderProcessGatesToForm(detail.process_gates));
        setProcessGateError(null);
        setPlanningForm(orderPlanningToForm(detail.planning_preparation));
        setPlanningError(null);
        setExecutionForm(orderExecutionToForm(detail.execution_flow));
        setExecutionError(null);
        setFollowupForm(orderFollowupToForm(detail.followup_flow));
        setFollowupError(null);
      } catch (error) {
        if (cancelled) return;
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
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [reloadNonce, selectedOrderId]);

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
                {l("Neuen Auftrag", "Создать заказ")}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex flex-wrap gap-6 rounded-xl border border-border bg-card px-4 py-3">
        <AdminInlineMetric
          icon={ClipboardList}
          label={tx.orders_title}
          value={String(metrics.total)}
          description={l(
            "Alle Auftrage im aktuellen Filter-Scope.",
            "Все заказы в текущем видимом скоупе.",
          )}
          tone="sky"
        />
        <AdminInlineMetric
          icon={CheckCircle2}
          label={l("Aktive Auftrage", "Активные заказы")}
          value={String(metrics.active)}
          description={l(
            "Auftrage mit laufender Bearbeitung im sichtbaren Scope.",
            "Заказы с активной операционной работой в видимом скоупе.",
          )}
          tone="emerald"
        />
        <AdminInlineMetric
          icon={Stethoscope}
          label={l("In Durchfuhrung", "В исполнении")}
          value={String(metrics.execution)}
          description={l(
            "Auftrage, die sich aktuell in der Durchfuhrung befinden.",
            "Заказы, которые сейчас находятся в фазе исполнения.",
          )}
          tone="amber"
        />
        <AdminInlineMetric
          icon={Wallet}
          label={l("Geschaftsvolumen", "Оценочный объём")}
          value={formatMoney(metrics.estimatedTotal)}
          description={l(
            "Geschatztes Gesamtvolumen der sichtbaren Auftrage.",
            "Оценочный совокупный объём видимых заказов.",
          )}
          tone="slate"
        />
      </div>

      {canManageDebt ? (
        <SectionCard
          title={l("Debt-Management-Queue", "Очередь debt-management")}
          description={l(
            "Auftrage, die durch uberfallige Forderungen oder einen offenen Debt-Workflow blockiert sind.",
            "Заказы, заблокированные просроченной задолженностью или открытым debt-workflow.",
          )}
        >
          {debtQueueError ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {debtQueueError}
            </div>
          ) : debtQueueLoading ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              <LoaderCircle className="mb-2 size-4 animate-spin" />
              {l(
                "Debt-Management-Queue wird geladen...",
                "Загрузка очереди debt-management...",
              )}
            </div>
          ) : debtQueue.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-700">
              {l(
                "Aktuell gibt es keine offenen Debt-Management-Falle.",
                "Сейчас нет открытых кейсов debt-management.",
              )}
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-3">
              {debtQueue.slice(0, 6).map((item) => (
                <button
                  key={item.order_id}
                  type="button"
                  onClick={() => openOrder(item.order_id, item.patient_id)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                        {item.order_number}
                      </div>
                      <div className="mt-2 text-sm font-semibold text-slate-950">
                        {item.patient_name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {item.patient_code}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full border-amber-200 bg-amber-50 text-amber-700"
                    >
                      {debtStatusLabel(item.effective_status)}
                    </Badge>
                  </div>
                  <div className="mt-4 space-y-2 text-sm text-slate-600">
                    <div>
                      {item.blocking_reason
                        ? localizedBlockingReason(item.blocking_reason)
                        : l("Offener Debt-Workflow", "Открытый debt-workflow")}
                    </div>
                    <div>
                      {item.overdue_invoice_count}{" "}
                      {l("uberfallig", "просрочено")} /{" "}
                      {formatMoney(item.outstanding_balance)}
                    </div>
                    <div>
                      {l("Owner", "Ответственный")}:{" "}
                      {item.owner_name ?? l("Nicht zugewiesen", "Не назначено")} /{" "}
                      {l("Review", "ревью")} {formatDateTimeLabel(item.next_review_at)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
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
              {l("Alle Patienten", "Все пациенты")}
            </option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patientLabel(patient, l("Patient", "Пациент"))}
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
            <option value="__all__">{l("Arzt", "Врач")}</option>
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
              title={l("Aktualisieren", "Обновить")}
              aria-label={l("Aktualisieren", "Обновить")}
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
          groupLabels={ORDER_COLUMN_GROUPS}
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
                    {l("Neuen Auftrag", "Создать заказ")}
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
                              <CalendarClock className="size-4 text-slate-500" />
                              {formatDateTimeLabel(orderDetail.created_at)}
                            </span>
                          }
                        />
                        <DetailField
                          label={tx.common_loading}
                          value={
                            <span className="inline-flex items-center gap-2">
                              <RefreshCw className="size-4 text-slate-500" />
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
                      title={titleWithDot(tx.providers_linked_patients)}
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
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {l("Debt-Management", "Debt-management")}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
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
                              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-500">
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
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {l("Billing-Release", "Billing-release")}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
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
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {l("Paketdeckung", "Покрытие пакетом")}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
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
                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {l("Planungssteuerung", "Управление планированием")}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
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

                          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                            <div className="text-sm font-semibold text-foreground">
                              {l("Operative Übergabe", "Операционная передача")}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
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
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
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
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {l("Steuerung der Durchführung", "Управление исполнением")}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
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

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {l("Nachweise der Durchführung", "Подтверждения исполнения")}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
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
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {l("Steuerung der Nachsorge", "Управление follow-up")}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
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

                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm font-semibold text-foreground">
                            {l(
                              "Empfohlene Meilenstein-Anker",
                              "Рекомендуемые контрольные даты",
                            )}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
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
                                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
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
                          className="rounded-full border-slate-200 bg-slate-100 text-slate-600"
                        >
                          {l("Billing nur lesend", "Только чтение для биллинга")}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {orderDetail.lifecycle?.stage_entered_at ? (
                    <p className="mt-4 text-sm text-slate-600">
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
                      {orderDetail.lifecycle.history.map((event, index) => (
                        <div
                          key={`${event.created_at}-${event.to_stage}-${index}`}
                          className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium text-slate-900">
                                {event.from_stage
                                  ? `${phaseLabel(event.from_stage)} -> ${phaseLabel(event.to_stage)}`
                                  : phaseLabel(event.to_stage)}
                              </p>
                              <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-500">
                                {transitionKindLabel(event.transition_kind)}
                              </p>
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatDateTimeLabel(event.created_at)}
                            </span>
                          </div>
                          {event.note ? (
                            <p className="mt-2 text-sm text-slate-600">
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
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                    {group.label}
                                  </p>
                                  <p className="mt-1 text-sm text-slate-600">
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
                                  className="rounded-full border-slate-200 bg-white text-slate-700"
                                >
                                  {group.items.length} {l("Punkte", "пункт(ов)")}
                                </Badge>
                              </div>
                              <div className="mt-4 space-y-3">
                                {group.items.map((item) => (
                                  <div
                                    key={item.id}
                                    className={cn(
                                      "rounded-2xl border px-4 py-4",
                                      item.is_completed
                                        ? "border-emerald-200 bg-emerald-50/70"
                                        : "border-slate-200 bg-white",
                                    )}
                                  >
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <p className="text-sm font-medium text-slate-950">
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
                                              ? l("abgeschlossen", "завершено")
                                              : item.linked_task_status === "open"
                                                ? l("offen", "открыто")
                                                : item.linked_task_status ?? l("offen", "открыто")}
                                          </Badge>
                                        </div>
                                        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
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
                          className="rounded-2xl border border-slate-200 bg-white p-4"
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
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <StatCard
                        label={tx.providers_services}
                        value={String(leistungMetrics.total)}
                        description={l(
                          "Aktuelle Leistungspositionen in diesem Auftrag.",
                          "Текущие позиции услуг в этом заказе.",
                        )}
                        icon={<ClipboardList className="size-4" />}
                      />
                      <StatCard
                        label={l("Zur Freigabe", "Ждут утверждения")}
                        value={String(leistungMetrics.delivered)}
                        description={l(
                          "Leistungspositionen, die auf PM-Freigabe warten.",
                          "Позиции услуг, ожидающие утверждения PM.",
                        )}
                        icon={<CheckCircle2 className="size-4" />}
                      />
                      <StatCard
                        label={l("Freigegeben", "Утверждено")}
                        value={String(leistungMetrics.approved)}
                        description={l(
                          "Bereits freigegebene Leistungspositionen in diesem Auftrag.",
                          "Позиции услуг, уже утверждённые в текущем заказе.",
                        )}
                        icon={<Wallet className="size-4" />}
                      />
                      <StatCard
                        label={tx.contracts_total}
                        value={formatMoney(leistungMetrics.gross)}
                        description={l(
                          "Menge x Preis uber alle sichtbaren Leistungspositionen.",
                          "Количество x цена по всем видимым позициям услуг.",
                        )}
                        icon={<Building2 className="size-4" />}
                      />
                    </div>

                    <SectionCard
                      title={tx.providers_services}
                      description={l(
                        "Provider- und arztbezogene Leistungen innerhalb dieses Auftrags.",
                        "Привязанные к провайдеру и врачу услуги внутри текущего заказа.",
                      )}
                      action={
                        permissions.canAddLeistung ? (
                          <Button onClick={() => resetLeistungDialog(true)}>
                            <Plus className="mr-2 size-4" />
                            {l("Leistung hinzufugen", "Добавить Leistung")}
                          </Button>
                        ) : null
                      }
                    >
                  {orderDetail.leistungen.length === 0 ? (
                    <EmptyState
                      title={tx.common_not_set}
                      description={l(
                        "Mit providerbezogenen Positionen den Leistungsumfang des Auftrags aufbauen und Billing genug Kontext geben.",
                        "Используйте позиции, привязанные к провайдеру, чтобы собрать объём исполнения заказа и дать биллингу достаточный контекст.",
                      )}
                      action={
                        permissions.canAddLeistung ? (
                          <Button onClick={() => resetLeistungDialog(true)}>
                            <Plus className="mr-2 size-4" />
                            {l("Leistung hinzufugen", "Добавить Leistung")}
                          </Button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <div className="space-y-3">
                      {orderDetail.leistungen.map((leistung) => (
                        <div
                          key={leistung.id}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="space-y-3">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-base font-semibold text-slate-950">
                                  {leistung.description}
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
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
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
                                  {l("Freigeben", "Утвердить")}
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
                    title={l("Externe Rechnungen", "Внешние счета")}
                    description={l(
                      "Lieferanten- und Klinikrechnungen im Auftragskontext nachverfolgen, die gepruft, bezahlt oder eskaliert werden mussen.",
                      "Отслеживание счетов от клиник и поставщиков, которые нужно проверить, оплатить или эскалировать в контексте заказа.",
                    )}
                  >
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <StatCard
                      label={l("Erfasste Rechnungen", "Учтённые счета")}
                      value={String(externalInvoiceMetrics.total)}
                      description={l(
                        "Externe Rechnungen, die mit dem aktuellen Auftrag verknupft sind.",
                        "Внешние счета, привязанные к текущему заказу.",
                      )}
                      icon={<Wallet className="size-4" />}
                    />
                    <StatCard
                      label={l("Überfällig", "Просрочено")}
                      value={String(externalInvoiceMetrics.overdue)}
                      description={l(
                        "Rechnungen, deren Fälligkeitsdatum bereits überschritten ist.",
                        "Счета, у которых уже прошёл срок оплаты.",
                      )}
                      icon={<CalendarClock className="size-4" />}
                    />
                    <StatCard
                      label={l("Bezahlt", "Оплачено")}
                      value={String(externalInvoiceMetrics.paid)}
                      description={l(
                        "Rechnungen, die bereits als beglichen markiert sind.",
                        "Счета, уже отмеченные как погашенные.",
                      )}
                      icon={<CheckCircle2 className="size-4" />}
                    />
                    <StatCard
                      label={l("Erfasstes Brutto", "Учтённое брутто")}
                      value={formatMoney(externalInvoiceMetrics.gross)}
                      description={l(
                        "Gesamtes Bruttoexposure aller verknüpften externen Rechnungen.",
                        "Совокупное брутто по всем привязанным внешним счетам.",
                      )}
                      icon={<Building2 className="size-4" />}
                    />
                  </div>

                  <div className="mt-5 space-y-5">
                    {permissions.canManageExternalInvoices ? (
                      <form
                        onSubmit={handleCreateExternalInvoice}
                        className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-sm font-semibold text-foreground">
                              {l("Externe Rechnung erfassen", "Зарегистрировать внешний счёт")}
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">
                              {l(
                                "Für eingehende Klinik- oder Partnerrechnungen verwenden, die ein Fristen-Tracking brauchen.",
                                "Используйте для входящих счетов клиник или партнёров, по которым нужно отслеживать дедлайны.",
                              )}
                            </p>
                          </div>
                        </div>
                        {externalInvoiceError ? (
                          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                            {externalInvoiceError}
                          </div>
                        ) : null}
                        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <Field label={l("Rechnungsnummer", "Номер счёта")}>
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
                          <Field label={l("Rechnungsdatum", "Дата счёта")}>
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
                          <Field label={l("Fälligkeitsdatum", "Срок оплаты")}>
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
                          <Field label={l("Netto", "Нетто")}>
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
                          <Field label={l("MwSt.", "НДС")}>
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
                          <Field label={l("Brutto", "Брутто")}>
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
                          <Field label={l("Status", "Статус")}>
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
                            {l("Externe Rechnung hinzufügen", "Добавить внешний счёт")}
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {(orderDetail.external_invoices ?? []).length === 0 ? (
                      <EmptyState
                        title={l(
                          "Noch keine externen Rechnungen",
                          "Внешних счетов пока нет",
                        )}
                        description={l(
                          "Eingehende Provider- oder Klinikrechnungen hier erfassen, um Fälligkeiten und überfällige Nachverfolgung zu steuern.",
                          "Регистрируйте здесь входящие счета от провайдеров и клиник, чтобы отслеживать дедлайны и просрочки.",
                        )}
                      />
                    ) : (
                      <div className="space-y-3">
                        {(orderDetail.external_invoices ?? []).map(
                          (invoice) => (
                            <div
                              key={invoice.id}
                              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                            >
                              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                <div className="space-y-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-base font-semibold text-slate-950">
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
                                      label={l("Rechnungsdatum", "Дата счёта")}
                                      value={formatDateLabel(invoice.invoice_date)}
                                    />
                                    <DetailField
                                      label={l("Fälligkeitsdatum", "Срок оплаты")}
                                      value={formatDateLabel(invoice.due_date)}
                                    />
                                    <DetailField
                                      label={l("Netto", "Нетто")}
                                      value={formatMoney(
                                        invoice.amount_net,
                                        invoice.currency,
                                      )}
                                    />
                                    <DetailField
                                      label={l("MwSt.", "НДС")}
                                      value={formatMoney(
                                        invoice.amount_vat,
                                        invoice.currency,
                                      )}
                                    />
                                    <DetailField
                                      label={l("Brutto", "Брутто")}
                                      value={formatMoney(
                                        invoice.amount_gross,
                                        invoice.currency,
                                      )}
                                    />
                                    <DetailField
                                      label={l("Eingegangen", "Получен")}
                                      value={formatDateTimeLabel(
                                        invoice.received_at,
                                      )}
                                    />
                                    <DetailField
                                      label={l("Bezahlt", "Оплачен")}
                                      value={formatDateTimeLabel(invoice.paid_at)}
                                    />
                                    <DetailField
                                      label={l("Letzte Aktualisierung", "Последнее обновление")}
                                      value={formatDateTimeLabel(invoice.updated_at)}
                                    />
                                  </div>
                                  {invoice.notes ? (
                                    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
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
                                        {l("Als freigegeben markieren", "Отметить как утверждённый")}
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
                                        {l("Als bezahlt markieren", "Отметить как оплаченный")}
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
                                        {l("Stornieren", "Отменить")}
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
              title={l("Auftrag anlegen", "Создать заказ")}
              description={l(
                "Patient auswahlen, Bestandskunden-Re-Check prufen und Intake-Notiz fur den neuen Auftrag erfassen.",
                "Выберите пациента, проверьте re-check существующего клиента и добавьте intake-заметку для нового заказа.",
              )}
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
            {createError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {createError}
              </div>
            ) : null}

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
                    {patientLabel(patient, l("Patient", "Пациент"))}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>

            {createForm.patientId ? (
              <div className={cn("rounded-xl p-4", tokens.surface.mutedCard)}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-foreground">
                      {l(
                        "Re-Check fur Bestandskunden",
                        "Повторная проверка для существующего клиента",
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
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
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
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
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                        {l("Fehlende Stammdaten", "Не хватает базовых данных")}:{" "}
                        {createRecheck.base_data_missing_fields
                          .map((field) =>
                            recheckMissingFieldLabel(field, {
                              primary_contact: l("Hauptkontakt", "Основной контакт"),
                              country: l("Land", "Страна"),
                              language: l("Bevorzugte Sprache", "Предпочитаемый язык"),
                            }),
                          )
                          .join(", ")}
                      </div>
                    ) : null}

                    {createRecheck.requires_recheck &&
                    createRecheck.blocking_reasons.length ? (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
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
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
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
                            ({createRecheck.latest_framework_contract.status})
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
            ) : null}

            <Field label={l("Bedarfs- / Intake-Notiz", "Заметка по потребности / intake")}>
              <textarea
                value={createForm.needsDescription}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    needsDescription: event.target.value,
                  }))
                }
                className={textareaClassName}
                placeholder={tx.patients_notes}
              />
            </Field>

            </AdminSheetScaffold>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog open={leistungOpen} onOpenChange={resetLeistungDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{l("Leistung hinzufugen", "Добавить Leistung")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddLeistung} className="space-y-4">
            {leistungError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {leistungError}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={l("Beschreibung", "Описание")}>
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
              <Field label={l("Notizen", "Заметки")}>
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
              <Field label={l("Menge", "Количество")}>
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
              <Field label={l("Einzelpreis", "Цена за единицу")}>
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
              <Field label={l("MwSt. %", "НДС %")}>
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
              <Field label={l("Provider", "Провайдер")}>
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
              <Field label={l("Arzt", "Врач")}>
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
              <label className="flex items-start gap-3">
                <input
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
                      {document.art ? ` · ${document.art}` : ""}
                      {document.original_filename
                        ? ` · ${document.original_filename}`
                        : ""}
                    </option>
                  ))}
                </NativeComboboxSelect>
                <p className="mt-2 text-xs text-slate-500">
                  {t.orders_supporting_document_pin_hint}
                </p>
              </Field>
            ) : null}

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => resetLeistungDialog(false)}
              >
                {t.common_cancel}
              </Button>
              <Button type="submit" disabled={leistungSaving}>
                {leistungSaving ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : null}
                {t.common_save}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
