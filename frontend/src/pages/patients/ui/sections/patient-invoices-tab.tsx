import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  CheckCircle2,
  CircleDollarSign,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  MessageSquare,
  MoreHorizontal,
  Plus,
  RotateCcw,
} from "lucide-react";

import { AdminToolbar } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  Banner,
  EmptyCell,
  Field,
  TabLoader,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import {
  agencyServiceNameLabel,
  agencyServiceUnitLabel,
} from "@/lib/agency-service-labels";
import { apiFetch, downloadApiFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

import type {
  InvoiceItem,
  PatientAccountMovement,
  PatientAccountStatement,
  PatientAccountStatementItem,
  PatientBalanceAdjustment,
  PatientBalanceAdjustmentResponse,
  PatientFinancialLedger,
  PatientFinancialLedgerEntry,
  PatientFinancialSummary,
  PatientServicePackageItem,
  OrderItem,
} from "../../model/detail-tab-types";
import type { PatientAssignment } from "../../model/list-model";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";
import { FormSection } from "../shared/patient-form-primitives";
import {
  patientInvoiceLedgerCategoryLabel,
  patientInvoiceLedgerDirectionLabel,
} from "../../model/portal-shared";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type MoneyFormatter = (value?: string | null, currency?: string) => string;

type PackageCatalogItem = {
  id: string;
  name: string;
  package_key: string;
  is_active: boolean;
  items?: Array<{
    id: string;
    service_key?: string | null;
    agency_service_name?: string | null;
    description: string;
    included_quantity: string;
    unit_label: string;
  }>;
};

type AssignPackageForm = {
  packageId: string;
  orderId: string;
  startsOn: string;
  endsOn: string;
  payerName: string;
  payerRelationship: string;
  notes: string;
};

type ConsumptionForm = {
  packageItemId: string;
  orderId: string;
  orderLeistungId: string;
  quantity: string;
  notes: string;
};

type BalanceAdjustmentForm = {
  requestId: string;
  direction: "debit" | "credit";
  category: PatientBalanceAdjustment["category"];
  amount: string;
  currency: string;
  effectiveOn: string;
  orderId: string;
  reason: string;
  note: string;
  portalVisible: boolean;
};

type PortalAccountActivationForm = {
  email: string;
  password: string;
  passwordConfirm: string;
};

type PortalAccountActivationResponse = {
  user_id: string;
  email: string;
  name: string;
  role: "patient";
  is_active: boolean;
  created: boolean;
};

const PATIENT_CHAT_STAFF_ROLES = new Set([
  "ceo",
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
]);

type FinanceFilters = {
  from: string;
  to: string;
  orderId: string;
  packageId: string;
};

type PatientInvoicesFinanceState = {
  financeFilters: FinanceFilters;
  refreshedFinancialSummary: PatientFinancialSummary | null;
  refreshedFinancialLedger: PatientFinancialLedger | null;
  refreshedAccountStatement: PatientAccountStatement | null;
  refreshedServicePackages: PatientServicePackageItem[] | null;
  packageCatalog: PackageCatalogItem[];
  patientOrders: OrderItem[];
  financeBusy: boolean;
  financeError: string;
  assignOpen: boolean;
  assignForm: AssignPackageForm;
  assignBusy: boolean;
  assignError: string;
  consumeTargetId: string;
  consumeForm: ConsumptionForm;
  consumeBusy: boolean;
  consumeError: string;
  approvalBusyKey: string;
};

type PatientInvoicesFinancePatch =
  | Partial<PatientInvoicesFinanceState>
  | ((current: PatientInvoicesFinanceState) => Partial<PatientInvoicesFinanceState>);

const BLANK_ASSIGN_PACKAGE_FORM: AssignPackageForm = {
  packageId: "",
  orderId: "",
  startsOn: "",
  endsOn: "",
  payerName: "",
  payerRelationship: "",
  notes: "",
};

const BLANK_CONSUMPTION_FORM: ConsumptionForm = {
  packageItemId: "",
  orderId: "",
  orderLeistungId: "",
  quantity: "1",
  notes: "",
};

function generateTemporaryPortalPassword() {
  return `Gm!${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}`;
}

function createPortalAccountForm(email = ""): PortalAccountActivationForm {
  const password = generateTemporaryPortalPassword();
  return {
    email,
    password,
    passwordConfirm: password,
  };
}

function createBlankBalanceAdjustmentForm(currency = "EUR"): BalanceAdjustmentForm {
  return {
    requestId: crypto.randomUUID(),
    direction: "debit",
    category: "correction",
    amount: "",
    currency,
    effectiveOn: new Date().toISOString().slice(0, 10),
    orderId: "",
    reason: "",
    note: "",
    portalVisible: true,
  };
}

const BLANK_FINANCE_FILTERS: FinanceFilters = {
  from: "",
  to: "",
  orderId: "",
  packageId: "",
};

function patientInvoicesFinanceReducer(
  state: PatientInvoicesFinanceState,
  patch: PatientInvoicesFinancePatch,
): PatientInvoicesFinanceState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createPatientInvoicesFinanceState(): PatientInvoicesFinanceState {
  return {
    financeFilters: BLANK_FINANCE_FILTERS,
    refreshedFinancialSummary: null,
    refreshedFinancialLedger: null,
    refreshedAccountStatement: null,
    refreshedServicePackages: null,
    packageCatalog: [],
    patientOrders: [],
    financeBusy: false,
    financeError: "",
    assignOpen: false,
    assignForm: BLANK_ASSIGN_PACKAGE_FORM,
    assignBusy: false,
    assignError: "",
    consumeTargetId: "",
    consumeForm: BLANK_CONSUMPTION_FORM,
    consumeBusy: false,
    consumeError: "",
    approvalBusyKey: "",
  };
}

type PatientInvoicesTabProps = {
  l: LocalizeFn;
  commonNotSet: string;
  tabLoading: boolean;
  invoices: InvoiceItem[];
  invoiceOpenCount: number;
  invoiceOverdueCount: number;
  invoiceOutstandingAmount: number;
  invoicePaidAmountTotal: number;
  financialSummary: PatientFinancialSummary | null;
  financialLedger: PatientFinancialLedger | null;
  servicePackages: PatientServicePackageItem[];
  patientId: string;
  patientName: string;
  patientEmail?: string | null;
  assignments: PatientAssignment[];
  canManageInvoices: boolean;
  onOpenInvoice: (invoiceId: string) => void;
  onManageInvoice: (invoice: InvoiceItem) => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  formatMoney: MoneyFormatter;
  moneyValueNumber: (value?: string | null) => number;
  invoiceTypeLabel: (value: string) => string;
};

function buildPackageGroups(servicePackages: PatientServicePackageItem[]) {
  const packageGroups = new Map<
    string,
    {
      packageName: string;
      status: string;
      orderNumber: string | null;
      startsOn: string | null;
      endsOn: string | null;
      payerName: string | null;
      payerRelationship: string | null;
      notes: string | null;
      items: PatientServicePackageItem[];
    }
  >();

  for (const item of servicePackages) {
    const current = packageGroups.get(item.patient_service_package_id) ?? {
      packageName: item.package_name,
      status: item.status,
      orderNumber: item.order_number ?? null,
      startsOn: item.starts_on ?? null,
      endsOn: item.ends_on ?? null,
      payerName: item.payer_contact_name ?? null,
      payerRelationship: item.payer_contact_relationship ?? null,
      notes: item.notes ?? null,
      items: [],
    };
    current.items.push(item);
    packageGroups.set(item.patient_service_package_id, current);
  }

  return Array.from(packageGroups.entries());
}

function packageItemLabel(item: PatientServicePackageItem, t: ReturnType<typeof useLang>["t"]) {
  return agencyServiceNameLabel(
    item.service_key,
    item.agency_service_name ?? item.description,
    t,
  );
}

type PackageActionsMenuProps = {
  item: PatientServicePackageItem;
  t: ReturnType<typeof useLang>["t"];
  approvalBusyKey: string;
  onDecision: (approvalStatus: "approved" | "declined") => void;
  onRecordConsumption: () => void;
};

function PackageActionsMenu({
  item,
  t,
  approvalBusyKey,
  onDecision,
  onRecordConsumption,
}: PackageActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const decisionBusy = (approvalStatus: "approved" | "declined") =>
    approvalBusyKey ===
    `${item.patient_service_package_id}:${item.package_item_id ?? "summary"}:${approvalStatus}`;
  const hasPendingOverage = moneyNumeric(item.pending_overage_quantity) > 0;

  return (
    <div
      ref={rootRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 rounded-full text-muted-foreground hover:text-foreground"
        aria-label={t.table_actions}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-8 z-40 w-60 rounded-lg border border-border bg-popover p-1 shadow-xl">
          {hasPendingOverage ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start rounded-md px-2.5 text-xs"
                disabled={decisionBusy("approved")}
                onClick={() => {
                  setOpen(false);
                  onDecision("approved");
                }}
              >
                {t.patient_invoices_approve_overage}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-full justify-start rounded-md px-2.5 text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-700"
                disabled={decisionBusy("declined")}
                onClick={() => {
                  setOpen(false);
                  onDecision("declined");
                }}
              >
                {t.patient_invoices_decline}
              </Button>
            </>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-full justify-start rounded-md px-2.5 text-xs"
            onClick={() => {
              setOpen(false);
              onRecordConsumption();
            }}
          >
            <Plus className="size-3.5" />
            {t.patient_invoices_record_consumption}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function moneyNumeric(value?: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type RowActionsMenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  className?: string;
  disabled?: boolean;
  onSelect: () => void;
};

function RowActionsMenu({
  label,
  items,
}: {
  label: string;
  items: RowActionsMenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onClick={(event) => event.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7 rounded-full text-muted-foreground hover:text-foreground"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
      {open ? (
        <div className="absolute right-0 top-8 z-40 w-60 rounded-lg border border-border bg-popover p-1 shadow-xl">
          {items.map((item) => (
            <Button
              key={item.key}
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-8 w-full justify-start rounded-md px-2.5 text-xs",
                item.className,
              )}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const PACKAGE_CHIP_TONES = [
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-teal-200 bg-teal-50 text-teal-700",
  "border-indigo-200 bg-indigo-50 text-indigo-700",
  "border-orange-200 bg-orange-50 text-orange-700",
] as const;

function packageChipTone(text: string) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return PACKAGE_CHIP_TONES[Math.abs(hash) % PACKAGE_CHIP_TONES.length];
}

function ledgerCategoryChipClass(category?: string | null) {
  switch (category) {
    case "service_revenue":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "cost_passthrough_revenue":
      return "border-sky-200 bg-sky-50 text-sky-700";
    case "provider_expense":
      return "border-amber-200 bg-amber-50 text-amber-700";
    default:
      return "border-border/60 bg-muted/25 text-foreground";
  }
}

function invoiceAccentClass(status: string) {
  if (status === "paid") return "bg-emerald-500";
  if (status === "overdue" || status === "cancelled") return "bg-rose-500";
  if (status === "partially_paid") return "bg-amber-500";
  if (status === "draft") return "bg-slate-400";
  return "bg-sky-500";
}

function accountStatementKindLabel(kind: PatientAccountStatementItem["kind"], lang: string) {
  const labels: Record<PatientAccountStatementItem["kind"], [string, string]> = {
    invoice: ["Rechnung", "Счёт"],
    prepayment: ["Vorauszahlung", "Предоплата"],
    external_expense: ["Externe Kosten", "Внешние расходы"],
    service: ["Leistung", "Услуга"],
  };
  return lang === "de" ? labels[kind][0] : labels[kind][1];
}

function accountStatementStateLabel(state: string, lang: string) {
  const labels: Record<string, [string, string]> = {
    reconciled_to_patient_invoice: [
      "Patientenrechnung zugeordnet",
      "Распределено по счёту пациента",
    ],
    paid: ["Bezahlt", "Оплачено"],
    partially_paid: ["Teilbezahlt – Rest offen", "Оплачено частично — требуется доплата"],
    unpaid: ["Nicht bezahlt", "Не оплачено"],
    not_issued: ["Noch nicht ausgestellt", "Ещё не выставлено"],
    amount_hidden: ["Betrag ausgeblendet", "Сумма скрыта"],
    patient_paid: ["Vom Patienten bezahlt", "Оплачено пациентом"],
    gmed_paid_patient_due: ["Von GMED bezahlt – Patient schuldet", "Оплачено GMED — долг пациента"],
    provider_unpaid_patient_due: ["Anbieter offen – Patient schuldet nach Leistung", "Поставщику не оплачено — долг пациента за оказанную услугу"],
    provider_unpaid: ["Anbieter noch nicht bezahlt", "Поставщику ещё не оплачено"],
    not_invoiced: ["Noch nicht fakturiert", "Ещё не выставлено в счёт"],
    partially_invoiced: ["Teilweise fakturiert", "Частично выставлено в счёт"],
    invoiced: ["Fakturiert", "Выставлено в счёт"],
  };
  const label = labels[state];
  return label ? (lang === "de" ? label[0] : label[1]) : state;
}

function accountStatementPayerLabel(paidBy: PatientAccountStatementItem["paid_by"], lang: string) {
  if (paidBy === "patient") return lang === "de" ? "Patient" : "Пациент";
  if (paidBy === "agency") return "GMED";
  if (paidBy === "unpaid") return lang === "de" ? "Noch niemand" : "Ещё никто";
  return "—";
}

function accountMovementKindLabel(kind: PatientAccountMovement["kind"], lang: string) {
  const labels: Record<PatientAccountMovement["kind"], [string, string]> = {
    invoice: ["Patientenrechnung", "Счёт пациента"],
    payment: ["Zahlung", "Оплата"],
    payment_reversal: ["Zahlungsstorno", "Сторно оплаты"],
    refund: ["Rückzahlung", "Возврат пациенту"],
    refund_reversal: ["Rückzahlungsstorno", "Сторно возврата"],
    balance_adjustment: ["Kontokorrektur", "Корректировка баланса"],
    balance_adjustment_reversal: ["Korrekturstorno", "Сторно корректировки"],
    external_receivable: ["Externe Forderung", "Внешний долг"],
    external_allocation: ["Forderung zugeordnet", "Долг распределён"],
    external_allocation_reversal: ["Zuordnung storniert", "Сторно распределения"],
  };
  return lang === "de" ? labels[kind][0] : labels[kind][1];
}

function accountMovementDirectionLabel(
  direction: PatientAccountMovement["direction"],
  lang: string,
) {
  if (direction === "debit") return lang === "de" ? "Belastung" : "Начисление";
  return lang === "de" ? "Zahlung oder Gutschrift" : "Оплата или уменьшение долга";
}

function localizeFinancialDescription(value: string, lang: string) {
  const exact: Record<string, [string, string]> = {
    "Patient invoice": ["Patientenrechnung", "Счёт пациента"],
    "Advance payment": ["Vorauszahlung", "Предоплата"],
    "Payment received": ["Zahlung erhalten", "Оплата получена"],
    "Advance payment received": ["Vorauszahlung erhalten", "Предоплата получена"],
    "Payment reversal": ["Zahlungsstorno", "Сторно оплаты"],
    "Invoice adjustment": ["Rechnungskorrektur", "Корректировка счёта"],
    "Account adjustment": ["Kontokorrektur", "Корректировка баланса"],
    "Payment opening balance": ["Zahlungsanfangsbestand", "Начальный остаток оплаты"],
    "Advance payment opening balance": ["Anfangsbestand Vorauszahlung", "Начальный остаток предоплаты"],
    "Patient invoice cancelled; external receivable reopened": [
      "Patientenrechnung storniert; externe Forderung wieder geöffnet",
      "Счёт пациента отменён; внешний долг снова открыт",
    ],
    "External provider": ["Externer Anbieter", "Внешний поставщик"],
  };
  const direct = exact[value];
  if (direct) return lang === "de" ? direct[0] : direct[1];

  const prefixes: Array<[string, [string, string]]> = [
    ["Concierge partner payment reversal", ["Storno der Zahlung an Concierge-Partner", "Сторно оплаты партнёру консьержа"]],
    ["Concierge partner payment", ["Zahlung an Concierge-Partner", "Оплата партнёру консьержа"]],
  ];
  for (const [prefix, labels] of prefixes) {
    if (value.startsWith(prefix)) {
      return `${lang === "de" ? labels[0] : labels[1]}${value.slice(prefix.length)}`;
    }
  }

  return value;
}

function accountBalanceLabel(
  value: string | null | undefined,
  currency: string,
  formatMoney: MoneyFormatter,
  lang: string,
) {
  if (value == null) return lang === "de" ? "Abstimmung erforderlich" : "Требуется сверка";
  const amount = moneyNumeric(value);
  if (amount > 0) {
    return `${formatMoney(String(Math.abs(amount)), currency)} ${lang === "de" ? "offener Betrag" : "долг"}`;
  }
  if (amount < 0) {
    return `${formatMoney(String(Math.abs(amount)), currency)} ${lang === "de" ? "Guthaben" : "переплата"}`;
  }
  return formatMoney("0", currency);
}

function balanceAdjustmentCategoryLabel(
  category: PatientBalanceAdjustment["category"],
  lang: string,
) {
  const labels = lang === "de"
    ? {
        opening_balance: "Übertragener Anfangssaldo",
        fee: "Gebühr",
        goodwill: "Kulanz",
        correction: "Korrektur",
        other: "Sonstiges",
      }
    : {
        opening_balance: "Перенесённый остаток",
        fee: "Комиссия",
        goodwill: "Компенсация",
        correction: "Корректировка",
        other: "Другое",
      };
  return labels[category];
}

async function downloadPatientLedgerExport(patientId: string, query: URLSearchParams) {
  await downloadApiFile(
    `/patients/${patientId}/financial-ledger/export?${query.toString()}`,
    `patient-profitability-${patientId}.csv`,
  );
}

function usePatientInvoicesTabContent({
  l,
  commonNotSet,
  tabLoading,
  invoices,
  financialSummary,
  financialLedger,
  servicePackages,
  patientId,
  patientName,
  patientEmail,
  assignments,
  canManageInvoices,
  onOpenInvoice,
  onManageInvoice,
  statusColors,
  statusLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  moneyValueNumber,
  invoiceTypeLabel,
}: PatientInvoicesTabProps) {
  const { t, lang } = useLang();
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const canManageBalance = user?.role === "ceo" || user?.role === "billing";
  const canManagePortalAccount =
    user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "it_admin";
  const [movementDirectionFilter, setMovementDirectionFilter] = useState<
    "all" | PatientAccountMovement["direction"]
  >("all");
  const [movementKindFilter, setMovementKindFilter] = useState<
    "all" | PatientAccountMovement["kind"]
  >("all");
  const [balanceAdjustments, setBalanceAdjustments] = useState<PatientBalanceAdjustment[]>([]);
  const [balanceAdjustmentOpen, setBalanceAdjustmentOpen] = useState(false);
  const [balanceAdjustmentForm, setBalanceAdjustmentForm] = useState<BalanceAdjustmentForm>(() =>
    createBlankBalanceAdjustmentForm(),
  );
  const [balanceAdjustmentBusy, setBalanceAdjustmentBusy] = useState(false);
  const [balanceAdjustmentError, setBalanceAdjustmentError] = useState("");
  const [reversingBalanceAdjustmentId, setReversingBalanceAdjustmentId] = useState("");
  const [balanceAdjustmentReversalReason, setBalanceAdjustmentReversalReason] = useState("");
  const [balanceAdjustmentReversalRequestId, setBalanceAdjustmentReversalRequestId] = useState("");
  const linkedPortalAssignment = assignments.find(
    (item) => item.user_role === "patient" && !item.revoked_at,
  );
  const [activatedPortalAccount, setActivatedPortalAccount] =
    useState<PortalAccountActivationResponse | null>(null);
  const [portalAccountOpen, setPortalAccountOpen] = useState(false);
  const [portalAccountBusy, setPortalAccountBusy] = useState(false);
  const [portalAccountError, setPortalAccountError] = useState("");
  const [portalCredentialsCopied, setPortalCredentialsCopied] = useState(false);
  const [portalAccountForm, setPortalAccountForm] = useState<PortalAccountActivationForm>(() =>
    createPortalAccountForm(linkedPortalAssignment?.user_email ?? patientEmail ?? ""),
  );
  const [financeState, dispatchFinanceState] = useReducer(
    patientInvoicesFinanceReducer,
    undefined,
    createPatientInvoicesFinanceState,
  );
  const {
    financeFilters,
    refreshedFinancialSummary,
    refreshedFinancialLedger,
    refreshedAccountStatement,
    refreshedServicePackages,
    packageCatalog,
    patientOrders,
    financeBusy,
    financeError,
    assignOpen,
    assignForm,
    assignBusy,
    assignError,
    consumeTargetId,
    consumeForm,
    consumeBusy,
    consumeError,
    approvalBusyKey,
  } = financeState;
  const setFinanceFilters = (nextValue: SetStateAction<FinanceFilters>) => {
    dispatchFinanceState((current) => ({
      financeFilters:
        typeof nextValue === "function"
          ? nextValue(current.financeFilters)
          : nextValue,
    }));
  };
  const setRefreshedServicePackages = (
    nextValue: SetStateAction<PatientServicePackageItem[] | null>,
  ) => {
    dispatchFinanceState((current) => ({
      refreshedServicePackages:
        typeof nextValue === "function"
          ? nextValue(current.refreshedServicePackages)
          : nextValue,
    }));
  };
  const setFinanceError = (nextValue: SetStateAction<string>) => {
    dispatchFinanceState((current) => ({
      financeError:
        typeof nextValue === "function"
          ? nextValue(current.financeError)
          : nextValue,
    }));
  };
  const setAssignOpen = (nextValue: SetStateAction<boolean>) => {
    dispatchFinanceState((current) => ({
      assignOpen:
        typeof nextValue === "function"
          ? nextValue(current.assignOpen)
          : nextValue,
    }));
  };
  const setAssignForm = (nextValue: SetStateAction<AssignPackageForm>) => {
    dispatchFinanceState((current) => ({
      assignForm:
        typeof nextValue === "function"
          ? nextValue(current.assignForm)
          : nextValue,
    }));
  };
  const setAssignError = (nextValue: SetStateAction<string>) => {
    dispatchFinanceState((current) => ({
      assignError:
        typeof nextValue === "function"
          ? nextValue(current.assignError)
          : nextValue,
    }));
  };
  const setConsumeTargetId = (nextValue: SetStateAction<string>) => {
    dispatchFinanceState((current) => ({
      consumeTargetId:
        typeof nextValue === "function"
          ? nextValue(current.consumeTargetId)
          : nextValue,
    }));
  };
  const setConsumeForm = (nextValue: SetStateAction<ConsumptionForm>) => {
    dispatchFinanceState((current) => ({
      consumeForm:
        typeof nextValue === "function"
          ? nextValue(current.consumeForm)
          : nextValue,
    }));
  };
  const setConsumeError = (nextValue: SetStateAction<string>) => {
    dispatchFinanceState((current) => ({
      consumeError:
        typeof nextValue === "function"
          ? nextValue(current.consumeError)
          : nextValue,
    }));
  };
  const setAssignBusy = (nextValue: SetStateAction<boolean>) => {
    dispatchFinanceState((current) => ({
      assignBusy:
        typeof nextValue === "function"
          ? nextValue(current.assignBusy)
          : nextValue,
    }));
  };
  const setConsumeBusy = (nextValue: SetStateAction<boolean>) => {
    dispatchFinanceState((current) => ({
      consumeBusy:
        typeof nextValue === "function"
          ? nextValue(current.consumeBusy)
          : nextValue,
    }));
  };
  const setApprovalBusyKey = (nextValue: SetStateAction<string>) => {
    dispatchFinanceState((current) => ({
      approvalBusyKey:
        typeof nextValue === "function"
          ? nextValue(current.approvalBusyKey)
          : nextValue,
    }));
  };
  const closeConsumeSheet = () => {
    setConsumeTargetId("");
    setConsumeForm(BLANK_CONSUMPTION_FORM);
    setConsumeError("");
  };

  const financeQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (financeFilters.from) params.set("from", financeFilters.from);
    if (financeFilters.to) params.set("to", financeFilters.to);
    if (financeFilters.orderId) params.set("order_id", financeFilters.orderId);
    if (financeFilters.packageId) params.set("package_id", financeFilters.packageId);
    return params;
  }, [financeFilters]);

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    async function loadFinanceContext() {
      dispatchFinanceState({
        financeBusy: true,
        financeError: "",
      });
      try {
        const suffix = financeQuery.toString();
        const [summary, ledger, statement, packages, catalog, orders, adjustments] = await Promise.all([
          apiFetch<PatientFinancialSummary>(
            `/patients/${patientId}/financial-summary${suffix ? `?${suffix}` : ""}`,
          ),
          apiFetch<PatientFinancialLedger>(
            `/patients/${patientId}/financial-ledger${suffix ? `?${suffix}` : ""}`,
          ),
          apiFetch<PatientAccountStatement>(
            `/patients/${patientId}/account-statement${suffix ? `?${suffix}` : ""}`,
          ),
          apiFetch<PatientServicePackageItem[]>(`/patients/${patientId}/service-packages`),
          apiFetch<PackageCatalogItem[]>("/service-packages").catch(() => []),
          apiFetch<OrderItem[]>(`/patients/${patientId}/orders`).catch(() => []),
          apiFetch<PatientBalanceAdjustmentResponse>(
            `/patients/${patientId}/balance-adjustments${suffix ? `?${suffix}` : ""}`,
          ),
        ]);
        if (cancelled) return;
        setBalanceAdjustments(adjustments.items);
        setBalanceAdjustmentForm((current) =>
          current.amount || current.reason
            ? current
            : { ...current, currency: statement.currency },
        );
        dispatchFinanceState({
          refreshedFinancialSummary: summary,
          refreshedFinancialLedger: ledger,
          refreshedAccountStatement: statement,
          refreshedServicePackages: packages,
          packageCatalog: catalog,
          patientOrders: orders,
          financeBusy: false,
        });
      } catch (error) {
        if (!cancelled) {
          dispatchFinanceState({
            financeError:
              error instanceof Error
                ? error.message
                : t.patient_invoices_error_load_filters,
            financeBusy: false,
          });
        }
      }
    }

    void loadFinanceContext();
    return () => {
      cancelled = true;
    };
  }, [financeQuery, patientId, t.patient_invoices_error_load_filters]);

  async function refreshPackages() {
    if (!patientId) return;
    const packages = await apiFetch<PatientServicePackageItem[]>(
      `/patients/${patientId}/service-packages`,
    );
    setRefreshedServicePackages(packages);
  }

  async function refreshBalanceWorkspace() {
    if (!patientId) return;
    const suffix = financeQuery.toString();
    const [statement, adjustments] = await Promise.all([
      apiFetch<PatientAccountStatement>(
        `/patients/${patientId}/account-statement${suffix ? `?${suffix}` : ""}`,
      ),
      apiFetch<PatientBalanceAdjustmentResponse>(
        `/patients/${patientId}/balance-adjustments${suffix ? `?${suffix}` : ""}`,
      ),
    ]);
    dispatchFinanceState({ refreshedAccountStatement: statement });
    setBalanceAdjustments(adjustments.items);
  }

  async function handleCreateBalanceAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !patientId ||
      Number(balanceAdjustmentForm.amount.replace(",", ".")) <= 0 ||
      !balanceAdjustmentForm.reason.trim()
    ) {
      return;
    }
    setBalanceAdjustmentBusy(true);
    setBalanceAdjustmentError("");
    try {
      await apiFetch(`/patients/${patientId}/balance-adjustments`, {
        method: "POST",
        body: JSON.stringify({
          request_id: balanceAdjustmentForm.requestId,
          direction: balanceAdjustmentForm.direction,
          category: balanceAdjustmentForm.category,
          amount: balanceAdjustmentForm.amount.replace(",", "."),
          currency: balanceAdjustmentForm.currency,
          effective_on: balanceAdjustmentForm.effectiveOn,
          order_id: balanceAdjustmentForm.orderId || null,
          reason: balanceAdjustmentForm.reason.trim(),
          note: balanceAdjustmentForm.note.trim() || null,
          portal_visible: balanceAdjustmentForm.portalVisible,
        }),
      });
      await refreshBalanceWorkspace();
      setBalanceAdjustmentForm(
        createBlankBalanceAdjustmentForm(
          accountStatement?.currency ?? balanceAdjustmentForm.currency,
        ),
      );
      setBalanceAdjustmentOpen(false);
    } catch (error) {
      setBalanceAdjustmentError(
        error instanceof Error
          ? error.message
          : lang === "de"
            ? "Kontokorrektur konnte nicht gespeichert werden"
            : "Не удалось сохранить корректировку",
      );
    } finally {
      setBalanceAdjustmentBusy(false);
    }
  }

  async function handleReverseBalanceAdjustment(adjustmentId: string) {
    if (!patientId || !balanceAdjustmentReversalReason.trim()) return;
    setBalanceAdjustmentBusy(true);
    setBalanceAdjustmentError("");
    try {
      await apiFetch(
        `/patients/${patientId}/balance-adjustments/${adjustmentId}/reversal`,
        {
          method: "POST",
          body: JSON.stringify({
            request_id: balanceAdjustmentReversalRequestId,
            reason: balanceAdjustmentReversalReason.trim(),
          }),
        },
      );
      await refreshBalanceWorkspace();
      setReversingBalanceAdjustmentId("");
      setBalanceAdjustmentReversalReason("");
      setBalanceAdjustmentReversalRequestId("");
    } catch (error) {
      setBalanceAdjustmentError(
        error instanceof Error
          ? error.message
          : lang === "de"
            ? "Kontokorrektur konnte nicht storniert werden"
            : "Не удалось сторнировать корректировку",
      );
    } finally {
      setBalanceAdjustmentBusy(false);
    }
  }

  async function handleAssignPackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !assignForm.packageId) return;
    setAssignBusy(true);
    setAssignError("");
    try {
      await apiFetch(`/patients/${patientId}/service-packages`, {
        method: "POST",
        body: JSON.stringify({
          package_id: assignForm.packageId,
          order_id: assignForm.orderId || null,
          starts_on: assignForm.startsOn || null,
          ends_on: assignForm.endsOn || null,
          payer_contact_name: assignForm.payerName.trim() || null,
          payer_contact_relationship: assignForm.payerRelationship.trim() || null,
          notes: assignForm.notes.trim() || null,
        }),
      });
      setAssignForm(BLANK_ASSIGN_PACKAGE_FORM);
      setAssignOpen(false);
      await refreshPackages();
    } catch (error) {
      setAssignError(error instanceof Error ? error.message : t.patient_invoices_error_assign_package);
    } finally {
      setAssignBusy(false);
    }
  }

  function openPortalAccountActivation() {
    setPortalAccountError("");
    setPortalCredentialsCopied(false);
    setActivatedPortalAccount(null);
    setPortalAccountForm(
      createPortalAccountForm(linkedPortalAssignment?.user_email ?? patientEmail ?? ""),
    );
    setPortalAccountOpen(true);
  }

  function closePortalAccountActivation() {
    setPortalAccountOpen(false);
    setPortalAccountError("");
    setPortalCredentialsCopied(false);
    setPortalAccountForm((current) => ({
      ...current,
      password: "",
      passwordConfirm: "",
    }));
  }

  async function handleActivatePortalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || portalAccountBusy) return;
    if (!portalAccountForm.email.trim() || !portalAccountForm.email.includes("@")) {
      setPortalAccountError(
        lang === "de" ? "Bitte geben Sie eine gültige E-Mail-Adresse ein." : "Укажите корректный email.",
      );
      return;
    }
    if (portalAccountForm.password !== portalAccountForm.passwordConfirm) {
      setPortalAccountError(
        lang === "de" ? "Die Passwörter stimmen nicht überein." : "Пароли не совпадают.",
      );
      return;
    }

    setPortalAccountBusy(true);
    setPortalAccountError("");
    try {
      const response = await apiFetch<PortalAccountActivationResponse>(
        `/patients/${patientId}/portal-account/activate`,
        {
          method: "POST",
          body: JSON.stringify({
            email: portalAccountForm.email.trim(),
            password: portalAccountForm.password,
          }),
        },
      );
      setActivatedPortalAccount(response);
    } catch (error) {
      setPortalAccountError(
        error instanceof Error
          ? error.message
          : lang === "de"
            ? "Das Patientenkonto konnte nicht aktiviert werden."
            : "Не удалось активировать аккаунт пациента.",
      );
    } finally {
      setPortalAccountBusy(false);
    }
  }

  async function copyPortalCredentials() {
    const text = `${activatedPortalAccount?.email ?? portalAccountForm.email}\n${portalAccountForm.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setPortalCredentialsCopied(true);
    } catch {
      setPortalCredentialsCopied(false);
    }
  }

  async function handleConsumePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !consumeTargetId) return;
    const quantity = Number(consumeForm.quantity.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setConsumeError(t.patient_invoices_error_quantity_positive);
      return;
    }
    setConsumeBusy(true);
    setConsumeError("");
    try {
      await apiFetch(
        `/patients/${patientId}/service-packages/${consumeTargetId}/consume`,
        {
          method: "POST",
          body: JSON.stringify({
            package_item_id: consumeForm.packageItemId || null,
            order_id: consumeForm.orderId || null,
            order_leistung_id: consumeForm.orderLeistungId.trim() || null,
            quantity,
            notes: consumeForm.notes.trim() || null,
          }),
        },
      );
      setConsumeForm(BLANK_CONSUMPTION_FORM);
      setConsumeTargetId("");
      await refreshPackages();
    } catch (error) {
      setConsumeError(error instanceof Error ? error.message : t.patient_invoices_error_record_consumption);
    } finally {
      setConsumeBusy(false);
    }
  }

  async function handleOverageDecision(
    patientServicePackageId: string,
    packageItemId: string | null | undefined,
    approvalStatus: "approved" | "declined",
  ) {
    if (!patientId) return;
    const busyKey = `${patientServicePackageId}:${packageItemId ?? "summary"}:${approvalStatus}`;
    setApprovalBusyKey(busyKey);
    try {
      await apiFetch(
        `/patients/${patientId}/service-packages/${patientServicePackageId}/overage-approval`,
        {
          method: "POST",
          body: JSON.stringify({
            package_item_id: packageItemId ?? null,
            approval_status: approvalStatus,
          }),
        },
      );
      await refreshPackages();
    } finally {
      setApprovalBusyKey("");
    }
  }

  const effectiveServicePackages = refreshedServicePackages ?? servicePackages;
  const portalAccountEmail =
    activatedPortalAccount?.email ?? linkedPortalAssignment?.user_email ?? patientEmail ?? "";
  const portalAccountIsActive =
    activatedPortalAccount?.is_active ?? linkedPortalAssignment?.user_active ?? false;
  const portalAccountUserId =
    activatedPortalAccount?.user_id ?? linkedPortalAssignment?.user_id ?? "";
  const canOpenPatientChat = Boolean(
    portalAccountIsActive &&
      portalAccountUserId &&
      user?.id &&
      PATIENT_CHAT_STAFF_ROLES.has(user.role) &&
      assignments.some(
        (item) => item.user_id === user.id && item.user_role !== "patient" && !item.revoked_at,
      ),
  );
  const hasEligiblePortalPackage = effectiveServicePackages.some((item) =>
    ["draft", "active", "paused"].includes(item.status),
  );
  const filteredServicePackages = useMemo(
    () =>
      effectiveServicePackages.filter((item) => {
        if (financeFilters.orderId && item.order_id !== financeFilters.orderId) return false;
        if (financeFilters.packageId && item.package_id !== financeFilters.packageId) return false;
        if (financeFilters.from && item.ends_on && item.ends_on < financeFilters.from) return false;
        if (financeFilters.to && item.starts_on && item.starts_on > financeFilters.to) return false;
        return true;
      }),
    [effectiveServicePackages, financeFilters],
  );
  const packageGroupItems = buildPackageGroups(effectiveServicePackages);
  const consumeTargetGroup =
    packageGroupItems.find(([id]) => id === consumeTargetId)?.[1] ?? null;
  const assignedPackageIds = new Set(
    effectiveServicePackages.map((item) => item.package_id),
  );
  const assignablePackages = packageCatalog.filter(
    (item) => item.is_active && !assignedPackageIds.has(item.id),
  );
  const filterPackageOptions = useMemo(() => {
    const packagesById = new Map<string, string>();
    for (const item of effectiveServicePackages) {
      packagesById.set(item.package_id, item.package_name);
    }
    return Array.from(packagesById, ([id, name]) => ({ id, name })).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }, [effectiveServicePackages]);
  const effectiveFinancialSummary = refreshedFinancialSummary ?? financialSummary;
  const effectiveFinancialLedger = refreshedFinancialLedger ?? financialLedger;
  const accountStatement = refreshedAccountStatement;
  const accountMovements = useMemo(
    () =>
      (accountStatement?.movements ?? []).filter((movement) => {
        if (
          movementDirectionFilter !== "all" &&
          movement.direction !== movementDirectionFilter
        ) {
          return false;
        }
        return movementKindFilter === "all" || movement.kind === movementKindFilter;
      }),
    [accountStatement?.movements, movementDirectionFilter, movementKindFilter],
  );
  const ledgerEntries = effectiveFinancialLedger?.entries ?? [];
  const ledgerLabels = useMemo(
    () => ({
      documents: lang === "de" ? "Belege" : "Документы",
      isIncome: (direction: string) =>
        direction === "revenue" || direction === "income",
    }),
    [lang],
  );
  const hasFinanceFilters = Boolean(
    financeFilters.from ||
      financeFilters.to ||
      financeFilters.orderId ||
      financeFilters.packageId,
  );
  const filteredInvoices = useMemo(() => {
    if (!hasFinanceFilters) return invoices;
    const invoiceIds = new Set(
      (effectiveFinancialSummary?.breakdown_by_order ?? []).map((item) => item.invoice_id),
    );
    return invoices.filter((invoice) => invoiceIds.has(invoice.id));
  }, [effectiveFinancialSummary, hasFinanceFilters, invoices]);
  const invoiceIsOverdue = (invoice: InvoiceItem) =>
    invoice.status === "overdue" ||
    (Boolean(invoice.due_date) &&
      moneyValueNumber(invoice.balance_due) > 0 &&
      new Date(invoice.due_date as string).getTime() < Date.now());
  const invoiceColumns = useMemo<ColumnDef<InvoiceItem>[]>(
    () => [
      {
        id: "invoice_number",
        label: t.invoices_number,
        accessor: (invoice) => invoice.invoice_number,
        sortable: true,
        searchable: true,
        required: true,
        width: 200,
        render: (invoice) => (
          <span className="inline-flex max-w-full truncate rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-sky-700">
            {invoice.invoice_number}
          </span>
        ),
      },
      {
        id: "invoice_type",
        label: t.invoices_type,
        accessor: (invoice) => invoiceTypeLabel(invoice.invoice_type),
        sortable: true,
        width: 150,
        render: (invoice) => (
          <Badge variant="outline" className="rounded-full font-mono text-[10px]">
            {invoiceTypeLabel(invoice.invoice_type)}
          </Badge>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (invoice) => statusLabel(invoice.status),
        sortable: true,
        width: 150,
        render: (invoice) => (
          <Badge
            variant="outline"
            className={cn("rounded-full font-mono text-[10px]", statusColors[invoice.status] ?? "")}
          >
            {statusLabel(invoice.status)}
          </Badge>
        ),
      },
      {
        id: "issued_at",
        label: t.invoices_issued,
        accessor: (invoice) => invoice.issued_at,
        sortable: true,
        filterType: "date",
        width: 170,
        render: (invoice) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDateTime(invoice.issued_at)}
          </span>
        ),
      },
      {
        id: "due_date",
        label: t.patient_invoices_due,
        accessor: (invoice) => invoice.due_date ?? "",
        sortable: true,
        filterType: "date",
        width: 130,
        render: (invoice) => (
          <span
            className={cn(
              "font-mono text-xs tabular-nums",
              invoiceIsOverdue(invoice) ? "font-medium text-rose-600" : "text-foreground",
            )}
          >
            {formatDate(invoice.due_date, commonNotSet)}
          </span>
        ),
      },
      {
        id: "order",
        label: t.patient_invoices_order,
        accessor: (invoice) => invoice.order_number ?? invoice.quote_number ?? "",
        searchable: true,
        width: 170,
        render: (invoice) => (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {invoice.order_number ?? invoice.quote_number ?? commonNotSet}
          </span>
        ),
      },
      {
        id: "total_gross",
        label: t.patient_invoices_total,
        accessor: (invoice) => moneyValueNumber(invoice.total_gross),
        sortable: true,
        filterType: "number",
        width: 130,
        render: (invoice) => (
          <span className="block text-right font-mono text-xs font-medium tabular-nums text-foreground">
            {formatMoney(invoice.total_gross)}
          </span>
        ),
      },
      {
        id: "paid_amount",
        label: t.patient_invoices_paid,
        accessor: (invoice) => moneyValueNumber(invoice.paid_amount),
        sortable: true,
        filterType: "number",
        width: 130,
        render: (invoice) => (
          <span className="block text-right font-mono text-xs tabular-nums text-foreground">
            {formatMoney(invoice.paid_amount)}
          </span>
        ),
      },
      {
        id: "balance_due",
        label: t.patient_invoices_open,
        accessor: (invoice) => moneyValueNumber(invoice.balance_due),
        sortable: true,
        filterType: "number",
        width: 140,
        render: (invoice) => {
          const balance = moneyValueNumber(invoice.balance_due);
          return (
            <span
              className={cn(
                "block text-right font-mono text-xs font-semibold tabular-nums",
                balance > 0
                  ? invoice.status === "overdue"
                    ? "text-rose-600"
                    : "text-amber-700"
                  : "text-foreground",
              )}
            >
              {formatMoney(invoice.balance_due)}
            </span>
          );
        },
      },
      {
        id: "patient_view",
        label: t.patient_invoices_patient_view,
        accessor: (invoice) =>
          invoice.portal_visibility?.visible_to_patient
            ? invoice.portal_visibility.amounts_visible_to_patient
              ? t.patient_invoices_amounts_visible
              : t.patient_invoices_amounts_hidden
            : t.patient_invoices_hidden,
        sortable: true,
        width: 170,
        render: (invoice) => {
          const visible = invoice.portal_visibility?.visible_to_patient;
          const amountsVisible = invoice.portal_visibility?.amounts_visible_to_patient;
          return (
            <Badge
              variant="outline"
              className={cn(
                "rounded-full font-mono text-[10px]",
                visible
                  ? amountsVisible
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-border bg-muted/40 text-muted-foreground",
              )}
            >
              {visible
                ? amountsVisible
                  ? t.patient_invoices_amounts_visible
                  : t.patient_invoices_amounts_hidden
                : t.patient_invoices_hidden}
            </Badge>
          );
        },
      },
    ],

    [commonNotSet, formatDate, formatDateTime, formatMoney, invoiceTypeLabel, moneyValueNumber, statusColors, statusLabel, t],
  );
  const ledgerColumns = useMemo<ColumnDef<PatientFinancialLedgerEntry>[]>(
    () => [
      {
        id: "entry_date",
        label: t.appointments_date,
        accessor: (entry) => entry.entry_date,
        sortable: true,
        filterType: "date",
        required: true,
        width: 120,
        render: (entry) => (
          <span className="font-mono text-xs tabular-nums text-foreground">
            {formatDate(entry.entry_date)}
          </span>
        ),
      },
      {
        id: "direction",
        label: t.appointments_type,
        accessor: (entry) => patientInvoiceLedgerDirectionLabel(entry.direction),
        sortable: true,
        filterType: "enum",
        filterOptions: [
          ...new Set(
            ledgerEntries.map((entry) => patientInvoiceLedgerDirectionLabel(entry.direction)),
          ),
        ].map((label) => ({ value: label, label })),
        width: 130,
        render: (entry) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full text-[10px]",
              ledgerLabels.isIncome(entry.direction)
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-rose-200 bg-rose-50 text-rose-700",
            )}
          >
            {patientInvoiceLedgerDirectionLabel(entry.direction)}
          </Badge>
        ),
      },
      {
        id: "category",
        label: t.services_category,
        accessor: (entry) => patientInvoiceLedgerCategoryLabel(entry.category),
        sortable: true,
        filterType: "enum",
        filterOptions: [
          ...new Set(
            ledgerEntries.map((entry) => patientInvoiceLedgerCategoryLabel(entry.category)),
          ),
        ].map((label) => ({ value: label, label })),
        width: 160,
        render: (entry) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full font-mono text-[10px]",
              ledgerCategoryChipClass(entry.category),
            )}
          >
            {patientInvoiceLedgerCategoryLabel(entry.category)}
          </Badge>
        ),
      },
      {
        id: "description",
        label: t.contracts_notes,
        accessor: (entry) => localizeFinancialDescription(entry.description, lang),
        filterType: "text",
        width: 300,
        render: (entry) => (
          <span
            className="block truncate text-xs text-foreground"
            title={localizeFinancialDescription(entry.description, lang)}
          >
            {localizeFinancialDescription(entry.description, lang)}
          </span>
        ),
      },
      {
        id: "documents",
        label: ledgerLabels.documents,
        accessor: (entry) =>
          [entry.order_number, entry.invoice_number, entry.external_invoice_number]
            .filter(Boolean)
            .join(" / "),
        filterType: "text",
        width: 220,
        render: (entry) => {
          const value = [entry.order_number, entry.invoice_number, entry.external_invoice_number]
            .filter(Boolean)
            .join(" / ");
          return value ? (
            <span className="block truncate font-mono text-xs text-foreground" title={value}>
              {value}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{commonNotSet}</span>
          );
        },
      },
      {
        id: "amount",
        label: t.invoices_amount,
        accessor: (entry) =>
          (ledgerLabels.isIncome(entry.direction) ? 1 : -1) * Number(entry.amount_gross || 0),
        sortable: true,
        filterType: "number",
        width: 150,
        render: (entry) => (
          <span
            className={cn(
              "block text-right font-mono text-xs font-medium tabular-nums",
              ledgerLabels.isIncome(entry.direction) ? "text-emerald-700" : "text-rose-700",
            )}
          >
            {ledgerLabels.isIncome(entry.direction) ? "+" : "-"}
            {formatMoney(entry.amount_gross, entry.currency)}
          </span>
        ),
      },
    ],
    [commonNotSet, formatDate, formatMoney, lang, ledgerEntries, ledgerLabels, t],
  );
  const accountMovementColumns = useMemo<ColumnDef<PatientAccountMovement>[]>(
    () => [
      {
        id: "entry_date",
        label: lang === "de" ? "Datum" : "Дата",
        accessor: (movement) => movement.entry_date,
        sortable: true,
        filterType: "date",
        required: true,
        width: 120,
        render: (movement) => (
          <span className="font-mono text-xs tabular-nums">
            {formatDate(movement.entry_date)}
          </span>
        ),
      },
      {
        id: "direction",
        label: lang === "de" ? "Belastung / Zahlung" : "Начисление / оплата",
        accessor: (movement) => accountMovementDirectionLabel(movement.direction, lang),
        sortable: true,
        filterType: "enum",
        width: 135,
        render: (movement) => (
          <Badge
            variant="outline"
            className={cn(
              "rounded-full text-[10px]",
              movement.direction === "debit"
                ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {accountMovementDirectionLabel(movement.direction, lang)}
          </Badge>
        ),
      },
      {
        id: "kind",
        label: lang === "de" ? "Buchung" : "Операция",
        accessor: (movement) => accountMovementKindLabel(movement.kind, lang),
        sortable: true,
        filterType: "enum",
        width: 185,
        render: (movement) => (
          <span className="text-xs font-medium text-foreground">
            {accountMovementKindLabel(movement.kind, lang)}
          </span>
        ),
      },
      {
        id: "description",
        label: lang === "de" ? "Beschreibung / Beleg" : "Описание / документ",
        accessor: (movement) =>
          `${localizeFinancialDescription(movement.description, lang)} ${movement.document_number ?? ""} ${movement.order_number ?? ""}`,
        searchable: true,
        width: 280,
        render: (movement) => (
          <div className="min-w-0">
            <div
              className="truncate text-xs text-foreground"
              title={localizeFinancialDescription(movement.description, lang)}
            >
              {localizeFinancialDescription(movement.description, lang)}
            </div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {[movement.order_number, movement.document_number].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        ),
      },
      {
        id: "debit",
        label: lang === "de" ? "Belastung" : "Начисление",
        accessor: (movement) => moneyNumeric(movement.debit),
        sortable: true,
        filterType: "number",
        width: 135,
        render: (movement) => (
          <span className="block text-right font-mono text-xs font-semibold tabular-nums text-amber-700">
            {moneyNumeric(movement.debit) > 0
              ? formatMoney(movement.debit, movement.currency)
              : "—"}
          </span>
        ),
      },
      {
        id: "credit",
        label: lang === "de" ? "Zahlung / Gutschrift" : "Оплата / уменьшение",
        accessor: (movement) => moneyNumeric(movement.credit),
        sortable: true,
        filterType: "number",
        width: 135,
        render: (movement) => (
          <span className="block text-right font-mono text-xs font-semibold tabular-nums text-emerald-700">
            {moneyNumeric(movement.credit) > 0
              ? formatMoney(movement.credit, movement.currency)
              : "—"}
          </span>
        ),
      },
      {
        id: "balance_after",
        label: lang === "de" ? "Saldo danach" : "Сальдо после",
        accessor: (movement) => moneyNumeric(movement.balance_after),
        sortable: true,
        filterType: "number",
        width: 170,
        render: (movement) => {
          const balance = moneyNumeric(movement.balance_after);
          return (
            <span
              className={cn(
                "block text-right font-mono text-xs font-semibold tabular-nums",
                balance > 0
                  ? "text-amber-700"
                  : balance < 0
                    ? "text-sky-700"
                    : "text-emerald-700",
              )}
            >
              {accountBalanceLabel(
                movement.balance_after,
                movement.currency,
                formatMoney,
                lang,
              )}
            </span>
          );
        },
      },
    ],
    [formatDate, formatMoney, lang],
  );
  const accountStatementColumns = useMemo<ColumnDef<PatientAccountStatementItem>[]>(
    () => [
      {
        id: "entry_date",
        label: lang === "de" ? "Datum" : "Дата",
        accessor: (item) => item.entry_date,
        sortable: true,
        filterType: "date",
        required: true,
        width: 120,
        render: (item) => (
          <span className="font-mono text-xs tabular-nums">{formatDate(item.entry_date)}</span>
        ),
      },
      {
        id: "kind",
        label: lang === "de" ? "Position" : "Позиция",
        accessor: (item) => accountStatementKindLabel(item.kind, lang),
        sortable: true,
        filterType: "enum",
        width: 145,
        render: (item) => (
          <Badge variant="outline" className="rounded-full text-[10px]">
            {accountStatementKindLabel(item.kind, lang)}
          </Badge>
        ),
      },
      {
        id: "description",
        label: lang === "de" ? "Beschreibung / Beleg" : "Описание / документ",
        accessor: (item) =>
          `${localizeFinancialDescription(item.description, lang)} ${item.document_number ?? ""}`,
        searchable: true,
        width: 260,
        render: (item) => (
          <div className="min-w-0">
            <div
              className="truncate text-xs text-foreground"
              title={localizeFinancialDescription(item.description, lang)}
            >
              {localizeFinancialDescription(item.description, lang)}
            </div>
            <div className="truncate font-mono text-[10px] text-muted-foreground">
              {[item.order_number, item.document_number].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
        ),
      },
      {
        id: "payment_state",
        label: lang === "de" ? "Zahlungsstand" : "Состояние оплаты",
        accessor: (item) => accountStatementStateLabel(item.payment_state, lang),
        sortable: true,
        filterType: "enum",
        width: 230,
        render: (item) => {
          const due = moneyNumeric(item.amount_due);
          const settled = [
            "paid",
            "patient_paid",
            "invoiced",
            "reconciled_to_patient_invoice",
          ].includes(item.payment_state);
          return (
            <span
              className={cn(
                "text-xs font-medium",
                due > 0
                  ? "text-amber-700"
                  : settled
                    ? "text-emerald-700"
                    : "text-foreground",
              )}
            >
              {accountStatementStateLabel(item.payment_state, lang)}
            </span>
          );
        },
      },
      {
        id: "paid_by",
        label: lang === "de" ? "Bezahlt durch" : "Кто оплатил",
        accessor: (item) => accountStatementPayerLabel(item.paid_by, lang),
        sortable: true,
        width: 130,
        render: (item) => (
          <span className="text-xs text-foreground">
            {accountStatementPayerLabel(item.paid_by, lang)}
          </span>
        ),
      },
      {
        id: "amount_gross",
        label: lang === "de" ? "Gesamt" : "Всего",
        accessor: (item) => moneyNumeric(item.amount_gross),
        sortable: true,
        filterType: "number",
        width: 125,
        render: (item) => (
          <span className="block text-right font-mono text-xs tabular-nums">
            {item.amounts_visible && item.amount_gross != null
              ? formatMoney(item.amount_gross, item.currency ?? accountStatement?.currency)
              : "—"}
          </span>
        ),
      },
      {
        id: "settled",
        label: lang === "de" ? "Bezahlt / verrechnet" : "Оплачено / зачтено",
        accessor: (item) => moneyNumeric(item.cash_paid) + moneyNumeric(item.prepayment_applied),
        sortable: true,
        filterType: "number",
        width: 160,
        render: (item) => {
          const settled = moneyNumeric(item.cash_paid) + moneyNumeric(item.prepayment_applied);
          return (
            <span className="block text-right font-mono text-xs tabular-nums text-emerald-700">
              {item.kind === "invoice" || item.kind === "prepayment"
                ? formatMoney(String(settled), accountStatement?.currency)
                : "—"}
            </span>
          );
        },
      },
      {
        id: "allocated_receivable",
        label: lang === "de" ? "Patientenrechnung zugeordnet" : "Распределено по счёту",
        accessor: (item) => moneyNumeric(item.allocated_receivable),
        sortable: true,
        filterType: "number",
        width: 175,
        render: (item) => (
          <span className="block text-right font-mono text-xs tabular-nums text-sky-700">
            {item.kind === "external_expense" && item.allocated_receivable != null
              ? formatMoney(item.allocated_receivable, item.currency ?? accountStatement?.currency)
              : "—"}
          </span>
        ),
      },
      {
        id: "amount_due",
        label: lang === "de" ? "Noch zu zahlen" : "Требуется доплатить",
        accessor: (item) => moneyNumeric(item.amount_due),
        sortable: true,
        filterType: "number",
        width: 155,
        render: (item) => {
          const due = moneyNumeric(item.amount_due);
          return (
            <span
              className={cn(
                "block text-right font-mono text-xs font-semibold tabular-nums",
                due > 0 ? "text-amber-700" : "text-foreground",
              )}
            >
              {item.amount_due != null
                ? formatMoney(item.amount_due, item.currency ?? accountStatement?.currency)
                : "—"}
            </span>
          );
        },
      },
    ],
    [accountStatement?.currency, formatDate, formatMoney, lang],
  );
  const servicePackageColumns = useMemo<ColumnDef<PatientServicePackageItem>[]>(
    () => [
      {
        id: "package",
        label: t.patient_invoices_package,
        accessor: (item) => item.package_name,
        sortable: true,
        filterType: "text",
        required: true,
        width: 240,
        render: (item) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <Badge
              variant="outline"
              className={cn(
                "max-w-full rounded-full",
                packageChipTone(item.package_id || item.package_name),
              )}
            >
              <span className="truncate" title={item.package_name}>
                {item.package_name}
              </span>
            </Badge>
          </span>
        ),
      },
      {
        id: "position",
        label: t.revenue_agency_service_catalog_items,
        accessor: (item) =>
          item.package_item_id
            ? packageItemLabel(item, t)
            : t.patient_invoices_package_summary,
        filterType: "text",
        width: 260,
        render: (item) => (
          <span className="block truncate text-xs text-foreground">
            {item.package_item_id
              ? packageItemLabel(item, t)
              : t.patient_invoices_package_summary}
          </span>
        ),
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (item) => statusLabel(item.status),
        sortable: true,
        filterType: "enum",
        filterOptions: [
          ...new Set(effectiveServicePackages.map((item) => statusLabel(item.status))),
        ].map((label) => ({ value: label, label })),
        width: 130,
        render: (item) => (
          <Badge
            variant="outline"
            className={cn("rounded-full text-[10px]", statusColors[item.status] ?? "")}
          >
            {statusLabel(item.status)}
          </Badge>
        ),
      },
      {
        id: "period",
        label: t.providers_date,
        accessor: (item) => item.starts_on ?? "",
        sortable: true,
        filterType: "date",
        width: 180,
        render: (item) => {
          const range = [
            item.starts_on ? formatDate(item.starts_on) : null,
            item.ends_on ? formatDate(item.ends_on) : null,
          ].filter(Boolean).join(" – ");
          return range ? (
            <span className="font-mono text-xs tabular-nums text-foreground">{range}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{commonNotSet}</span>
          );
        },
      },
      {
        id: "included",
        label: t.patient_invoices_included,
        accessor: (item) => moneyNumeric(item.included_quantity),
        sortable: true,
        filterType: "number",
        width: 110,
        render: (item) => (
          <span className="block text-right font-mono text-xs tabular-nums text-foreground">
            {item.included_quantity} {agencyServiceUnitLabel(item.unit_label, t)}
          </span>
        ),
      },
      {
        id: "used",
        label: t.patient_invoices_used,
        accessor: (item) => moneyNumeric(item.used_quantity),
        sortable: true,
        filterType: "number",
        width: 110,
        render: (item) => (
          <span className="block text-right font-mono text-xs tabular-nums text-foreground">
            {item.used_quantity}
          </span>
        ),
      },
      {
        id: "remaining",
        label: t.patient_invoices_remaining,
        accessor: (item) => moneyNumeric(item.remaining_quantity),
        sortable: true,
        filterType: "number",
        width: 110,
        render: (item) => (
          <span className="block text-right font-mono text-xs tabular-nums text-foreground">
            {item.remaining_quantity}
          </span>
        ),
      },
      {
        id: "overage",
        label: t.patient_invoices_overage,
        accessor: (item) => moneyNumeric(item.overage_quantity),
        sortable: true,
        filterType: "number",
        width: 220,
        render: (item) => (
          <span className="flex flex-wrap items-center gap-1">
            {moneyValueNumber(item.overage_quantity) > 0 ? (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                {t.patient_invoices_overage}: {item.overage_quantity}
              </span>
            ) : null}
            {moneyNumeric(item.pending_overage_quantity) > 0 ? (
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                {t.patient_invoices_pending}: {item.pending_overage_quantity}
              </span>
            ) : null}
            {moneyNumeric(item.approved_overage_quantity) > 0 ? (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                {t.patient_invoices_approved}: {item.approved_overage_quantity}
              </span>
            ) : null}
            {item.requires_patient_approval ? (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                {t.patient_invoices_patient_approval}
              </span>
            ) : null}
            {moneyValueNumber(item.overage_quantity) === 0 &&
            moneyNumeric(item.pending_overage_quantity) === 0 &&
            moneyNumeric(item.approved_overage_quantity) === 0 &&
            !item.requires_patient_approval ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : null}
          </span>
        ),
      },
      ...(canManageInvoices
        ? [
            {
              id: "package_actions",
              label: t.table_actions,
              accessor: () => "",
              width: 44,
              render: (item: PatientServicePackageItem) => (
                <PackageActionsMenu
                  item={item}
                  t={t}
                  approvalBusyKey={approvalBusyKey}
                  onDecision={(approvalStatus) =>
                    void handleOverageDecision(
                      item.patient_service_package_id,
                      item.package_item_id,
                      approvalStatus,
                    )
                  }
                  onRecordConsumption={() => {
                    setConsumeTargetId(item.patient_service_package_id);
                    setConsumeForm(BLANK_CONSUMPTION_FORM);
                    setConsumeError("");
                  }}
                />
              ),
            } satisfies ColumnDef<PatientServicePackageItem>,
          ]
        : []),
    ],
    [
      approvalBusyKey,
      canManageInvoices,
      commonNotSet,
      effectiveServicePackages,
      formatDate,
      handleOverageDecision,
      moneyValueNumber,
      statusColors,
      statusLabel,
      t,
    ],
  );

  return (
    <TabsContent value="invoices" className="mt-4 min-h-[400px] space-y-4">
      {financeError ? (
        <Banner tone="error" withIcon>
          {financeError}
        </Banner>
      ) : null}
        <AdminToolbar className="items-start gap-2 rounded-xl border border-border/60 bg-card p-3 shadow-none">
          <Field
            label={t.patient_invoices_from}
            htmlFor="profitability-from"
            className="min-w-[150px] flex-[1_1_150px]"
          >
            <Input
              id="profitability-from"
              type="date"
              value={financeFilters.from}
              onChange={(event) =>
                setFinanceFilters((current) => ({
                  ...current,
                  from: event.target.value,
                }))
              }
              className={inputClass}
              disabled={financeBusy}
            />
          </Field>
          <Field
            label={t.patient_invoices_to}
            htmlFor="profitability-to"
            className="min-w-[150px] flex-[1_1_150px]"
          >
            <Input
              id="profitability-to"
              type="date"
              value={financeFilters.to}
              onChange={(event) =>
                setFinanceFilters((current) => ({
                  ...current,
                  to: event.target.value,
                }))
              }
              className={inputClass}
              disabled={financeBusy}
            />
          </Field>
          <Field
            label={t.patient_invoices_order}
            htmlFor="profitability-order"
            className="min-w-[190px] flex-[1.2_1_190px]"
          >
            <NativeComboboxSelect
              id="profitability-order"
              value={financeFilters.orderId || "__all__"}
              onChange={(event) =>
                setFinanceFilters((current) => ({
                  ...current,
                  orderId: event.target.value === "__all__" ? "" : event.target.value,
                }))
              }
              className={selectClass}
              disabled={financeBusy}
            >
              <option value="__all__">{t.patient_invoices_all_orders}</option>
              {patientOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.order_number}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field
            label={t.patient_invoices_package}
            htmlFor="profitability-package"
            className="min-w-[220px] flex-[1.4_1_220px]"
          >
            <NativeComboboxSelect
              id="profitability-package"
              value={financeFilters.packageId || "__all__"}
              onChange={(event) =>
                setFinanceFilters((current) => ({
                  ...current,
                  packageId: event.target.value === "__all__" ? "" : event.target.value,
                }))
              }
              className={selectClass}
              disabled={financeBusy}
            >
              <option value="__all__">{t.patient_invoices_all_packages}</option>
              {filterPackageOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <div className="ml-auto flex shrink-0 items-start gap-2 pt-[18px]">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg gap-1.5"
              onClick={() => setFinanceFilters({ from: "", to: "", orderId: "", packageId: "" })}
              disabled={financeBusy}
            >
              <RotateCcw className="size-3.5" />
              {t.patient_invoices_reset}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg gap-1.5"
              onClick={() =>
                patientId
                  ? void downloadPatientLedgerExport(patientId, financeQuery).catch((error) =>
                      setFinanceError(
                        error instanceof Error ? error.message : t.patient_invoices_error_export,
                      ),
                    )
                  : undefined
              }
              disabled={!patientId || financeBusy}
            >
              <Download className="size-3.5" />
              {t.patient_invoices_export}
            </Button>
          </div>
        </AdminToolbar>

      {accountStatement ? (
        <>
          <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
            {[
              [
                lang === "de" ? "Anfangssaldo" : "Входящее сальдо",
                accountBalanceLabel(
                  accountStatement.summary.opening_balance,
                  accountStatement.currency,
                  formatMoney,
                  lang,
                ),
              ],
              [
                lang === "de" ? "Belastungen im Zeitraum" : "Начислено за период",
                formatMoney(accountStatement.summary.debit_total, accountStatement.currency),
              ],
              [
                lang === "de" ? "Zahlungen und Gutschriften im Zeitraum" : "Оплачено или уменьшено за период",
                formatMoney(accountStatement.summary.credit_total, accountStatement.currency),
              ],
              [
                lang === "de" ? "Berechneter Saldo" : "Расчётное сальдо",
                accountBalanceLabel(
                  accountStatement.summary.calculated_balance,
                  accountStatement.currency,
                  formatMoney,
                  lang,
                ),
              ],
              [
                lang === "de" ? "Noch abzustimmen" : "Требует распределения",
                formatMoney(
                  accountStatement.summary.unreconciled_external_debit,
                  accountStatement.currency,
                ),
              ],
              [
                lang === "de" ? "Bestätigter Saldo" : "Подтверждённое сальдо",
                accountBalanceLabel(
                  accountStatement.summary.closing_balance,
                  accountStatement.currency,
                  formatMoney,
                  lang,
                ),
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid min-w-0 gap-1.5 border-b border-border/60 px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center sm:gap-4"
              >
                <div className="text-xs font-medium text-muted-foreground sm:text-[13px]">
                  {label}
                </div>
                <div className="font-mono text-sm font-semibold tabular-nums text-foreground sm:text-right">
                  {value}
                </div>
              </div>
            ))}
          </section>
          <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
            {[
              [lang === "de" ? "Offene Rechnungen" : "Открытые счета", accountStatement.summary.invoice_due],
              [lang === "de" ? "Zahlungen erhalten" : "Получено оплат", accountStatement.summary.cash_paid],
              [lang === "de" ? "Vorauszahlung verfügbar" : "Доступно предоплаты", accountStatement.summary.available_prepayment],
              [lang === "de" ? "Externe Restforderung" : "Остаток внешнего долга", accountStatement.summary.external_receivable],
            ].map(([label, value]) => (
              <div
                key={label}
                className="grid min-w-0 gap-1.5 border-b border-border/60 px-3.5 py-2.5 last:border-b-0 sm:grid-cols-[minmax(12rem,1fr)_auto] sm:items-center sm:gap-4"
              >
                <div className="text-xs font-medium text-muted-foreground sm:text-[13px]">
                  {label}
                </div>
                <div className="font-mono text-sm font-semibold tabular-nums text-foreground sm:text-right">
                  {value == null ? "—" : formatMoney(value, accountStatement.currency)}
                </div>
              </div>
            ))}
          </section>
          {accountStatement.summary.reconciliation_required ? (
            <Banner tone="warning" withIcon>
              {lang === "de"
                ? "Der berechnete Saldo enthält noch nicht vollständig zugeordnete externe Forderungen. Ordnen Sie diese einer Patientenrechnung zu oder bestätigen Sie sie als separate Forderung; erst danach wird der Saldo als bestätigt angezeigt."
                : "Расчётное сальдо содержит внешние требования, которые ещё не полностью распределены. Свяжите их со счётом пациента либо подтвердите как отдельный долг — после этого сальдо станет подтверждённым."}
            </Banner>
          ) : null}
          <section className="rounded-xl border border-border/70 bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  {lang === "de" ? "Manuelle Kontokorrekturen" : "Ручные корректировки баланса"}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {lang === "de"
                    ? "Nur für Salden, die nicht durch Rechnung, Zahlung oder Gutschrift abgebildet werden. Ein Fehler wird storniert, nie gelöscht."
                    : "Только для сальдо, которое не отражено счётом, оплатой или кредит-нотой. Ошибка сторнируется, а не удаляется."}
                </p>
              </div>
              {canManageBalance ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg"
                  onClick={() => {
                    setBalanceAdjustmentError("");
                    setBalanceAdjustmentOpen(true);
                  }}
                >
                  <Plus className="size-3.5" />
                  {lang === "de" ? "Korrektur buchen" : "Добавить корректировку"}
                </Button>
              ) : null}
            </div>
            {balanceAdjustmentError ? (
              <div className="mt-3">
                <Banner tone="error">{balanceAdjustmentError}</Banner>
              </div>
            ) : null}
            {balanceAdjustments.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                {lang === "de" ? "Keine manuellen Kontokorrekturen" : "Ручных корректировок пока нет"}
              </div>
            ) : (
              <div className="mt-3 space-y-2">
                {balanceAdjustments.map((adjustment) => (
                  <div
                    key={adjustment.id}
                    className={cn(
                      "rounded-lg border border-border/70 bg-background/70 p-3",
                      adjustment.is_reversed && "opacity-70",
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full text-[10px]",
                              adjustment.direction === "debit"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-emerald-200 bg-emerald-50 text-emerald-700",
                            )}
                          >
                            {accountMovementDirectionLabel(adjustment.direction, lang)}
                          </Badge>
                          <span className="text-sm font-semibold text-foreground">
                            {adjustment.transaction_type === "reversal"
                              ? lang === "de" ? "Korrekturstorno" : "Сторно корректировки"
                              : balanceAdjustmentCategoryLabel(adjustment.category, lang)}
                          </span>
                          {adjustment.is_reversed ? (
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {lang === "de" ? "Storniert" : "Сторнировано"}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatDate(adjustment.effective_on)} · {adjustment.reason}
                          {adjustment.order_number ? ` · ${adjustment.order_number}` : ""}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {adjustment.created_by_name}
                          {adjustment.portal_visible
                            ? ` · ${lang === "de" ? "Begründung im Portal sichtbar" : "причина видна клиенту"}`
                            : ` · ${lang === "de" ? "Begründung intern" : "причина скрыта"}`}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                          {adjustment.direction === "debit" ? "+" : "−"}
                          {formatMoney(adjustment.amount, adjustment.currency)}
                        </span>
                        {canManageBalance &&
                        adjustment.transaction_type === "adjustment" &&
                        !adjustment.is_reversed ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg"
                            onClick={() => {
                              setReversingBalanceAdjustmentId(adjustment.id);
                              setBalanceAdjustmentReversalReason("");
                              setBalanceAdjustmentReversalRequestId(crypto.randomUUID());
                            }}
                          >
                            {lang === "de" ? "Stornieren" : "Сторнировать"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    {reversingBalanceAdjustmentId === adjustment.id ? (
                      <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3 sm:flex-row">
                        <Input
                          value={balanceAdjustmentReversalReason}
                          onChange={(event) => setBalanceAdjustmentReversalReason(event.target.value)}
                          placeholder={lang === "de" ? "Grund der Stornierung" : "Причина сторно"}
                          className={cn(inputClass, "h-8 flex-1")}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg"
                          onClick={() => {
                            setReversingBalanceAdjustmentId("");
                            setBalanceAdjustmentReversalRequestId("");
                          }}
                          disabled={balanceAdjustmentBusy}
                        >
                          {lang === "de" ? "Abbrechen" : "Отмена"}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 rounded-lg"
                          onClick={() => void handleReverseBalanceAdjustment(adjustment.id)}
                          disabled={balanceAdjustmentBusy || !balanceAdjustmentReversalReason.trim()}
                        >
                          {lang === "de" ? "Storno buchen" : "Провести сторно"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>
          <DataTableSurface
            rows={accountMovements}
            columns={accountMovementColumns}
            rowId={(movement) => movement.id}
            dictionary={t as unknown as Record<string, string>}
            emptyState={
              <EmptyCell>
                {lang === "de" ? "Keine Kontobewegungen für diesen Filter" : "Нет движений по выбранному фильтру"}
              </EmptyCell>
            }
            toolbarStart={
              <>
                <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  {lang === "de" ? "Kontobewegungen" : "Движения взаиморасчётов"}
                </span>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
                <NativeComboboxSelect
                  aria-label={lang === "de" ? "Belastungen und Zahlungen filtern" : "Фильтр начислений и оплат"}
                  value={movementDirectionFilter}
                  onChange={(event) =>
                    setMovementDirectionFilter(
                      event.target.value as "all" | PatientAccountMovement["direction"],
                    )
                  }
                  className={cn(selectClass, "h-8 !w-56 max-w-full shrink-0")}
                >
                  <option value="all">{lang === "de" ? "Belastungen und Zahlungen" : "Начисления и оплаты"}</option>
                  <option value="debit">{lang === "de" ? "Nur Belastungen" : "Только начисления"}</option>
                  <option value="credit">{lang === "de" ? "Nur Zahlungen und Gutschriften" : "Только оплаты и уменьшения"}</option>
                </NativeComboboxSelect>
                <NativeComboboxSelect
                  aria-label={lang === "de" ? "Buchungsart filtern" : "Фильтр типа операции"}
                  value={movementKindFilter}
                  onChange={(event) =>
                    setMovementKindFilter(
                      event.target.value as "all" | PatientAccountMovement["kind"],
                    )
                  }
                  className={cn(selectClass, "h-8 !w-52 max-w-full shrink-0")}
                >
                  <option value="all">{lang === "de" ? "Alle Buchungen" : "Все операции"}</option>
                  <option value="invoice">{accountMovementKindLabel("invoice", lang)}</option>
                  <option value="payment">{accountMovementKindLabel("payment", lang)}</option>
                  <option value="payment_reversal">{accountMovementKindLabel("payment_reversal", lang)}</option>
                  <option value="refund">{accountMovementKindLabel("refund", lang)}</option>
                  <option value="refund_reversal">{accountMovementKindLabel("refund_reversal", lang)}</option>
                  <option value="balance_adjustment">{accountMovementKindLabel("balance_adjustment", lang)}</option>
                  <option value="balance_adjustment_reversal">{accountMovementKindLabel("balance_adjustment_reversal", lang)}</option>
                  <option value="external_receivable">{accountMovementKindLabel("external_receivable", lang)}</option>
                  <option value="external_allocation">{accountMovementKindLabel("external_allocation", lang)}</option>
                  <option value="external_allocation_reversal">{accountMovementKindLabel("external_allocation_reversal", lang)}</option>
                </NativeComboboxSelect>
              </>
            }
            pagination={{
              resetKey: `${movementDirectionFilter}:${movementKindFilter}:${accountMovements.map((movement) => movement.id).join(":")}`,
            }}
          />
          <DataTableSurface
            rows={accountStatement.items}
            columns={accountStatementColumns}
            rowId={(item) => `${item.kind}:${item.id}`}
            dictionary={t as unknown as Record<string, string>}
            emptyState={
              <EmptyCell>
                {lang === "de" ? "Keine Kontobewegungen vorhanden" : "Нет данных по взаиморасчётам"}
              </EmptyCell>
            }
            toolbarStart={
              <>
                <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  {lang === "de" ? "Belege und Leistungen" : "Документы и услуги"}
                </span>
                <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
              </>
            }
            pagination={{
              resetKey: accountStatement.items.map((item) => `${item.kind}:${item.id}`).join(":"),
            }}
          />
        </>
      ) : null}

      <PatientSheetScaffold
        open={balanceAdjustmentOpen && canManageBalance}
        onOpenChange={(open) => {
          setBalanceAdjustmentOpen(open);
          if (!open) setBalanceAdjustmentError("");
        }}
        width="form-heavy"
        onSubmit={handleCreateBalanceAdjustment}
        title={lang === "de" ? "Kontokorrektur buchen" : "Добавить корректировку баланса"}
        bodyClassName="space-y-4 px-5 py-4"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setBalanceAdjustmentOpen(false)}
              disabled={balanceAdjustmentBusy}
            >
              {lang === "de" ? "Abbrechen" : "Отмена"}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg"
              disabled={
                balanceAdjustmentBusy ||
                Number(balanceAdjustmentForm.amount.replace(",", ".")) <= 0 ||
                !balanceAdjustmentForm.reason.trim()
              }
            >
              {balanceAdjustmentBusy
                ? lang === "de" ? "Wird gebucht…" : "Сохранение…"
                : lang === "de" ? "Buchen" : "Провести"}
            </Button>
          </>
        }
      >
        {balanceAdjustmentError ? (
          <Banner tone="error" withIcon>
            {balanceAdjustmentError}
          </Banner>
        ) : null}

        <Banner tone="warning" withIcon>
          {lang === "de"
            ? "Nur für Beträge verwenden, die nicht bereits durch Rechnung, Zahlung, Rückzahlung oder Gutschrift gebucht sind. Eine falsche Buchung wird storniert und bleibt nachvollziehbar."
            : "Используйте только для сумм, которые ещё не отражены счётом, оплатой, возвратом или кредит-нотой. Ошибочная запись сторнируется и остаётся в истории."}
        </Banner>

        <FormSection title={lang === "de" ? "Buchung" : "Операция"}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={lang === "de" ? "Richtung" : "Направление"} htmlFor="balance-adjustment-direction">
              <NativeComboboxSelect
                id="balance-adjustment-direction"
                value={balanceAdjustmentForm.direction}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({
                    ...current,
                    direction: event.target.value as BalanceAdjustmentForm["direction"],
                  }))
                }
                className={selectClass}
                disabled={balanceAdjustmentBusy}
              >
                <option value="debit">{lang === "de" ? "Forderung erhöhen" : "Увеличить долг"}</option>
                <option value="credit">{lang === "de" ? "Forderung mindern oder Guthaben bilden" : "Уменьшить долг или создать переплату"}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={lang === "de" ? "Kategorie" : "Категория"} htmlFor="balance-adjustment-category">
              <NativeComboboxSelect
                id="balance-adjustment-category"
                value={balanceAdjustmentForm.category}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({
                    ...current,
                    category: event.target.value as BalanceAdjustmentForm["category"],
                  }))
                }
                className={selectClass}
                disabled={balanceAdjustmentBusy}
              >
                {(["opening_balance", "fee", "goodwill", "correction", "other"] as const).map((category) => (
                  <option key={category} value={category}>
                    {balanceAdjustmentCategoryLabel(category, lang)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field label={lang === "de" ? "Betrag" : "Сумма"} htmlFor="balance-adjustment-amount">
              <Input
                id="balance-adjustment-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={balanceAdjustmentForm.amount}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({ ...current, amount: event.target.value }))
                }
                className={inputClass}
                disabled={balanceAdjustmentBusy}
                required
              />
            </Field>
            <Field label={lang === "de" ? "Währung" : "Валюта"} htmlFor="balance-adjustment-currency">
              <Input
                id="balance-adjustment-currency"
                value={balanceAdjustmentForm.currency}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({
                    ...current,
                    currency: event.target.value.toUpperCase().slice(0, 3),
                  }))
                }
                className={inputClass}
                disabled={balanceAdjustmentBusy || Boolean(balanceAdjustmentForm.orderId)}
                maxLength={3}
                required
              />
            </Field>
            <Field label={lang === "de" ? "Buchungsdatum" : "Дата операции"} htmlFor="balance-adjustment-date">
              <Input
                id="balance-adjustment-date"
                type="date"
                value={balanceAdjustmentForm.effectiveOn}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({ ...current, effectiveOn: event.target.value }))
                }
                className={inputClass}
                disabled={balanceAdjustmentBusy}
                required
              />
            </Field>
            <Field label={lang === "de" ? "Auftrag (optional)" : "Заказ (необязательно)"} htmlFor="balance-adjustment-order">
              <NativeComboboxSelect
                id="balance-adjustment-order"
                value={balanceAdjustmentForm.orderId || "__none__"}
                onChange={(event) => {
                  const orderId = event.target.value === "__none__" ? "" : event.target.value;
                  const orderCurrency = patientOrders.find((order) => order.id === orderId)?.currency;
                  setBalanceAdjustmentForm((current) => ({
                    ...current,
                    orderId,
                    currency: orderCurrency?.toUpperCase() || current.currency,
                  }));
                }}
                className={selectClass}
                disabled={balanceAdjustmentBusy}
              >
                <option value="__none__">{lang === "de" ? "Ohne Auftrag" : "Без заказа"}</option>
                {patientOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number}{order.currency ? ` · ${order.currency}` : ""}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
          </div>
        </FormSection>

        <FormSection title={lang === "de" ? "Begründung" : "Основание"}>
          <div className="space-y-3">
            <Field label={lang === "de" ? "Grund" : "Причина"} htmlFor="balance-adjustment-reason">
              <Input
                id="balance-adjustment-reason"
                value={balanceAdjustmentForm.reason}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({ ...current, reason: event.target.value }))
                }
                className={inputClass}
                disabled={balanceAdjustmentBusy}
                required
              />
            </Field>
            <Field label={lang === "de" ? "Interne Notiz (optional)" : "Внутренняя заметка (необязательно)"} htmlFor="balance-adjustment-note">
              <textarea
                id="balance-adjustment-note"
                value={balanceAdjustmentForm.note}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({ ...current, note: event.target.value }))
                }
                className={textareaClass}
                rows={3}
                disabled={balanceAdjustmentBusy}
              />
            </Field>
            <label className="flex items-start gap-2 rounded-lg border border-border/70 px-3 py-2.5 text-sm text-foreground">
              <input
                type="checkbox"
                className="mt-0.5 size-4 rounded border-border"
                checked={balanceAdjustmentForm.portalVisible}
                onChange={(event) =>
                  setBalanceAdjustmentForm((current) => ({
                    ...current,
                    portalVisible: event.target.checked,
                  }))
                }
                disabled={balanceAdjustmentBusy}
              />
              <span>
                <span className="block font-medium">
                  {lang === "de" ? "Begründung im Patientenportal anzeigen" : "Показывать причину в портале пациента"}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {lang === "de"
                    ? "Betrag und Datum sind für einen korrekten Saldo immer sichtbar. Diese Option zeigt zusätzlich die Begründung; die interne Notiz bleibt verborgen."
                    : "Сумма и дата всегда видны для правильного сальдо. Эта опция дополнительно показывает причину; внутренняя заметка остаётся скрытой."}
                </span>
              </span>
            </label>
          </div>
        </FormSection>
      </PatientSheetScaffold>

      <PatientSheetScaffold
        open={portalAccountOpen && canManagePortalAccount}
        onOpenChange={(open) => {
          if (open) setPortalAccountOpen(true);
          else closePortalAccountActivation();
        }}
        width="default"
        onSubmit={activatedPortalAccount ? undefined : handleActivatePortalAccount}
        title={
          portalAccountIsActive
            ? lang === "de"
              ? "Patientenkonto bearbeiten"
              : "Редактировать аккаунт пациента"
            : lang === "de"
              ? "Patientenkonto aktivieren"
              : "Активировать аккаунт пациента"
        }
        description={
          lang === "de"
            ? `Portalzugang für ${patientName}`
            : `Доступ в портал для ${patientName}`
        }
        bodyClassName="space-y-4 px-5 py-4"
        footer={
          activatedPortalAccount ? (
            <Button
              type="button"
              size="sm"
              className="h-8 rounded-lg"
              onClick={closePortalAccountActivation}
            >
              {lang === "de" ? "Fertig" : "Готово"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={closePortalAccountActivation}
                disabled={portalAccountBusy}
              >
                {lang === "de" ? "Abbrechen" : "Отмена"}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-8 rounded-lg"
                disabled={
                  portalAccountBusy ||
                  !portalAccountForm.email.trim() ||
                  !portalAccountForm.password ||
                  !portalAccountForm.passwordConfirm
                }
              >
                {portalAccountBusy
                  ? portalAccountIsActive
                    ? lang === "de"
                      ? "Wird gespeichert…"
                      : "Сохранение…"
                    : lang === "de"
                      ? "Wird aktiviert…"
                      : "Активация…"
                  : portalAccountIsActive
                    ? lang === "de"
                      ? "Änderungen speichern"
                      : "Сохранить изменения"
                    : lang === "de"
                      ? "Konto aktivieren"
                      : "Активировать аккаунт"}
              </Button>
            </>
          )
        }
      >
        {portalAccountError ? (
          <Banner tone="error" withIcon>
            {portalAccountError}
          </Banner>
        ) : null}

        {activatedPortalAccount ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-semibold">
                  {activatedPortalAccount.created
                    ? lang === "de"
                      ? "Patientenkonto wurde erstellt"
                      : "Аккаунт пациента создан"
                    : lang === "de"
                      ? "Patientenkonto wurde aktualisiert"
                      : "Аккаунт пациента обновлён"}
                </p>
                <p className="mt-1 text-emerald-700">
                  {lang === "de"
                    ? "Übermitteln Sie diese Zugangsdaten sicher an den Patienten. Das temporäre Passwort wird nach dem Schließen nicht mehr angezeigt."
                    : "Безопасно передайте эти данные пациенту. После закрытия временный пароль больше не будет показан."}
                </p>
              </div>
            </div>

            <FormSection title={lang === "de" ? "Zugangsdaten" : "Данные для входа"}>
              <div className="space-y-3">
                <Field
                  label={lang === "de" ? "E-Mail" : "Электронная почта"}
                  htmlFor="portal-account-result-email"
                >
                  <Input
                    id="portal-account-result-email"
                    value={activatedPortalAccount.email}
                    className={inputClass}
                    readOnly
                  />
                </Field>
                <Field
                  label={
                    portalAccountIsActive
                      ? lang === "de"
                        ? "Neues Passwort"
                        : "Новый пароль"
                      : lang === "de"
                        ? "Temporäres Passwort"
                        : "Временный пароль"
                  }
                  htmlFor="portal-account-result-password"
                >
                  <Input
                    id="portal-account-result-password"
                    value={portalAccountForm.password}
                    className={inputClass}
                    readOnly
                  />
                </Field>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={() => void copyPortalCredentials()}
                >
                  {portalCredentialsCopied ? (
                    <CheckCircle2 className="size-3.5" />
                  ) : (
                    <Copy className="size-3.5" />
                  )}
                  {portalCredentialsCopied
                    ? lang === "de"
                      ? "Kopiert"
                      : "Скопировано"
                    : lang === "de"
                      ? "Zugangsdaten kopieren"
                      : "Скопировать данные"}
                </Button>
              </div>
            </FormSection>
          </>
        ) : (
          <>
            <Banner tone="warning" withIcon>
              {portalAccountIsActive
                ? lang === "de"
                  ? "Ändern Sie die E-Mail-Adresse oder vergeben Sie ein neues Passwort. Aktive Sitzungen werden nach dem Speichern beendet."
                  : "Измените email или задайте новый пароль. После сохранения активные сессии будут завершены."
                : linkedPortalAssignment
                  ? lang === "de"
                    ? "Das bestehende Patientenkonto wird aktiviert und erhält ein neues Passwort. Aktive Sitzungen werden beendet."
                    : "Существующий аккаунт пациента будет активирован и получит новый пароль. Активные сессии будут завершены."
                : lang === "de"
                  ? "Ein Patientenkonto wird erstellt und mit dieser Patientenakte verknüpft."
                  : "Будет создан аккаунт пациента и привязан к этой карточке."}
            </Banner>

            <FormSection title={lang === "de" ? "Patientenzugang" : "Доступ пациента"}>
              <div className="space-y-3">
                <Field
                  label={lang === "de" ? "E-Mail" : "Электронная почта"}
                  htmlFor="portal-account-email"
                >
                  <Input
                    id="portal-account-email"
                    type="email"
                    autoComplete="off"
                    value={portalAccountForm.email}
                    onChange={(event) =>
                      setPortalAccountForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    className={inputClass}
                    disabled={portalAccountBusy}
                    required
                  />
                </Field>
                <Field
                  label={
                    portalAccountIsActive
                      ? lang === "de"
                        ? "Neues Passwort"
                        : "Новый пароль"
                      : lang === "de"
                        ? "Temporäres Passwort"
                        : "Временный пароль"
                  }
                  htmlFor="portal-account-password"
                >
                  <Input
                    id="portal-account-password"
                    type="text"
                    autoComplete="new-password"
                    value={portalAccountForm.password}
                    onChange={(event) =>
                      setPortalAccountForm((current) => ({
                        ...current,
                        password: event.target.value,
                      }))
                    }
                    className={inputClass}
                    disabled={portalAccountBusy}
                    required
                  />
                </Field>
                <Field
                  label={lang === "de" ? "Passwort bestätigen" : "Повторите пароль"}
                  htmlFor="portal-account-password-confirm"
                >
                  <Input
                    id="portal-account-password-confirm"
                    type="text"
                    autoComplete="new-password"
                    value={portalAccountForm.passwordConfirm}
                    onChange={(event) =>
                      setPortalAccountForm((current) => ({
                        ...current,
                        passwordConfirm: event.target.value,
                      }))
                    }
                    className={inputClass}
                    disabled={portalAccountBusy}
                    required
                  />
                </Field>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {lang === "de"
                      ? "Mindestens 8 Zeichen mit Groß- und Kleinbuchstaben, Zahl und Sonderzeichen."
                      : "Минимум 8 символов: большие и маленькие буквы, цифра и специальный символ."}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 rounded-lg px-2 text-xs"
                    onClick={() =>
                      setPortalAccountForm((current) => {
                        const password = generateTemporaryPortalPassword();
                        return { ...current, password, passwordConfirm: password };
                      })
                    }
                    disabled={portalAccountBusy}
                  >
                    {lang === "de" ? "Neu generieren" : "Сгенерировать новый"}
                  </Button>
                </div>
              </div>
            </FormSection>
          </>
        )}
      </PatientSheetScaffold>


      <PatientSheetScaffold
        open={assignOpen && canManageInvoices}
        onOpenChange={(open) => setAssignOpen(open)}
        width="form-heavy"
        onSubmit={handleAssignPackage}
        title={t.patient_invoices_assign_package}
        bodyClassName="space-y-4 px-5 py-4"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => setAssignOpen(false)}
              disabled={assignBusy}
            >
              {t.patient_invoices_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg"
              disabled={assignBusy || !assignForm.packageId}
            >
              {t.patient_invoices_assign}
            </Button>
          </>
        }
      >
        {assignError ? (
          <Banner tone="error" withIcon>
            {assignError}
          </Banner>
        ) : null}

        <FormSection title={t.patient_invoices_package}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t.patient_invoices_package} htmlFor="assign-package-id">
              <NativeComboboxSelect
                id="assign-package-id"
                value={assignForm.packageId || "__empty__"}
                onChange={(event) =>
                  setAssignForm((current) => ({
                    ...current,
                    packageId:
                      event.target.value === "__empty__" ? "" : event.target.value,
                  }))
                }
                className={selectClass}
                disabled={assignBusy}
              >
                <option value="__empty__">
                  {t.patient_invoices_choose_package}
                </option>
                {assignablePackages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field label={t.patient_invoices_order} htmlFor="assign-package-order">
              <NativeComboboxSelect
                id="assign-package-order"
                value={assignForm.orderId || "__none__"}
                onChange={(event) =>
                  setAssignForm((current) => ({
                    ...current,
                    orderId: event.target.value === "__none__" ? "" : event.target.value,
                  }))
                }
                className={selectClass}
                disabled={assignBusy}
              >
                <option value="__none__">{t.patient_invoices_no_order_link}</option>
                {patientOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field label={t.patient_invoices_starts} htmlFor="assign-package-starts">
              <Input
                id="assign-package-starts"
                type="date"
                value={assignForm.startsOn}
                onChange={(event) =>
                  setAssignForm((current) => ({
                    ...current,
                    startsOn: event.target.value,
                  }))
                }
                className={inputClass}
                disabled={assignBusy}
              />
            </Field>
            <Field label={t.patient_invoices_ends} htmlFor="assign-package-ends">
              <Input
                id="assign-package-ends"
                type="date"
                value={assignForm.endsOn}
                onChange={(event) =>
                  setAssignForm((current) => ({
                    ...current,
                    endsOn: event.target.value,
                  }))
                }
                className={inputClass}
                disabled={assignBusy}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title={t.patient_invoices_payer}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t.patient_invoices_payer} htmlFor="assign-package-payer">
              <Input
                id="assign-package-payer"
                value={assignForm.payerName}
                onChange={(event) =>
                  setAssignForm((current) => ({
                    ...current,
                    payerName: event.target.value,
                  }))
                }
                className={inputClass}
                disabled={assignBusy}
              />
            </Field>
            <Field
              label={t.patient_invoices_relationship}
              htmlFor="assign-package-relationship"
            >
              <Input
                id="assign-package-relationship"
                value={assignForm.payerRelationship}
                onChange={(event) =>
                  setAssignForm((current) => ({
                    ...current,
                    payerRelationship: event.target.value,
                  }))
                }
                className={inputClass}
                disabled={assignBusy}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title={l("patients_additional")}>
          <Field label={t.patient_invoices_notes} htmlFor="assign-package-notes">
            <textarea
              id="assign-package-notes"
              value={assignForm.notes}
              onChange={(event) =>
                setAssignForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              className={textareaClass}
              rows={3}
              disabled={assignBusy}
            />
          </Field>
        </FormSection>
      </PatientSheetScaffold>

      <PatientSheetScaffold
        open={Boolean(consumeTargetId) && canManageInvoices}
        onOpenChange={(open) => {
          if (!open) closeConsumeSheet();
        }}
        width="form-heavy"
        onSubmit={handleConsumePackage}
        title={t.patient_invoices_record_consumption}
        bodyClassName="space-y-4 px-5 py-4"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={closeConsumeSheet}
              disabled={consumeBusy}
            >
              {t.patient_invoices_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg"
              disabled={consumeBusy || !consumeTargetId}
            >
              {t.patient_invoices_record}
            </Button>
          </>
        }
      >
        {consumeError ? (
          <Banner tone="error" withIcon>
            {consumeError}
          </Banner>
        ) : null}

        <FormSection title={l("patients_consumption")}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t.patient_invoices_item} htmlFor="consume-package-item">
              <NativeComboboxSelect
                id="consume-package-item"
                value={consumeForm.packageItemId || "__summary__"}
                onChange={(event) =>
                  setConsumeForm((current) => ({
                    ...current,
                    packageItemId:
                      event.target.value === "__summary__"
                        ? ""
                        : event.target.value,
                  }))
                }
                className={selectClass}
                disabled={consumeBusy}
              >
                <option value="__summary__">
                  {t.patient_invoices_package_summary}
                </option>
                {consumeTargetGroup?.items.reduce<ReactNode[]>((options, item) => {
                  if (!item.package_item_id) {
                    return options;
                  }
                  options.push(
                    <option key={item.package_item_id} value={item.package_item_id}>
                      {packageItemLabel(item, t)}
                    </option>,
                  );
                  return options;
                }, []) ?? []}
              </NativeComboboxSelect>
            </Field>
            <Field label={t.patient_invoices_order} htmlFor="consume-package-order">
              <NativeComboboxSelect
                id="consume-package-order"
                value={consumeForm.orderId || "__none__"}
                onChange={(event) =>
                  setConsumeForm((current) => ({
                    ...current,
                    orderId: event.target.value === "__none__" ? "" : event.target.value,
                  }))
                }
                className={selectClass}
                disabled={consumeBusy}
              >
                <option value="__none__">{t.patient_invoices_no_order}</option>
                {patientOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field label={t.patient_invoices_order_service_id} htmlFor="consume-order-service-id">
              <Input
                id="consume-order-service-id"
                value={consumeForm.orderLeistungId}
                onChange={(event) =>
                  setConsumeForm((current) => ({
                    ...current,
                    orderLeistungId: event.target.value,
                  }))
                }
                className={inputClass}
                disabled={consumeBusy}
                placeholder={t.patient_invoices_optional_uuid}
              />
            </Field>
            <Field label={t.patient_invoices_quantity} htmlFor="consume-package-quantity">
              <Input
                id="consume-package-quantity"
                value={consumeForm.quantity}
                onChange={(event) =>
                  setConsumeForm((current) => ({
                    ...current,
                    quantity: event.target.value,
                  }))
                }
                className={inputClass}
                disabled={consumeBusy}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title={l("patients_additional")}>
          <Field label={t.patient_invoices_consumption_note} htmlFor="consume-package-note">
            <textarea
              id="consume-package-note"
              value={consumeForm.notes}
              onChange={(event) =>
                setConsumeForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              className={textareaClass}
              rows={3}
              disabled={consumeBusy}
            />
          </Field>
        </FormSection>
      </PatientSheetScaffold>

      {tabLoading ? (
        <TabLoader />
      ) : (
        <DataTableSurface
          rows={filteredServicePackages}
          columns={servicePackageColumns}
          rowId={(item) =>
            `${item.patient_service_package_id}:${item.package_item_id ?? "summary"}`
          }
          dictionary={t as unknown as Record<string, string>}
          emptyState={<EmptyCell>{t.patient_invoices_no_service_package}</EmptyCell>}
          toolbarStart={
            <>
              <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                {t.patient_invoices_service_packages}
              </span>
              {canManageInvoices ? (
                <Button
                  type="button"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg gap-1.5"
                  onClick={() => setAssignOpen(true)}
                  disabled={!patientId}
                >
                  <Plus className="size-3.5" />
                  {t.patient_invoices_assign_package}
                </Button>
              ) : null}
              {canManagePortalAccount && portalAccountIsActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 max-w-72 shrink-0 gap-1.5 rounded-lg border-emerald-200 bg-emerald-50 px-2.5 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100 hover:text-emerald-900"
                  onClick={openPortalAccountActivation}
                  disabled={!patientId}
                  title={lang === "de" ? "Patientenkonto bearbeiten" : "Редактировать аккаунт пациента"}
                >
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span className="truncate">
                    {lang === "de" ? "Konto aktiv" : "Аккаунт активен"}
                    {portalAccountEmail ? ` · ${portalAccountEmail}` : ""}
                  </span>
                </Button>
              ) : null}
              {canManagePortalAccount && hasEligiblePortalPackage && !portalAccountIsActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg gap-1.5"
                  onClick={openPortalAccountActivation}
                  disabled={!patientId}
                >
                  <KeyRound className="size-3.5" />
                  {lang === "de" ? "Konto aktivieren" : "Активировать аккаунт"}
                </Button>
              ) : null}
              {canOpenPatientChat ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 rounded-lg gap-1.5"
                  onClick={() =>
                    staffGo(
                      `/chat?peer=${encodeURIComponent(portalAccountUserId)}&name=${encodeURIComponent(patientName)}&role=patient`,
                    )
                  }
                >
                  <MessageSquare className="size-3.5" />
                  {lang === "de" ? "Chat öffnen" : "Открыть чат"}
                </Button>
              ) : null}
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
            </>
          }
          pagination={{
            resetKey: filteredServicePackages
              .map((item) => `${item.patient_service_package_id}:${item.package_item_id ?? "summary"}`)
              .join(":"),
          }}
        />
      )}

      {tabLoading ? (
        <TabLoader />
      ) : (
        <DataTableSurface
          surfaceClassName="mt-3"
          rows={ledgerEntries}
          columns={ledgerColumns}
          rowId={(entry) => entry.id}
          dictionary={t as unknown as Record<string, string>}
          emptyState={<EmptyCell>{t.patient_invoices_no_ledger_entries}</EmptyCell>}
          toolbarStart={
            <>
              <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                {t.patient_invoices_accounting_ledger}
              </span>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
            </>
          }
          pagination={{ resetKey: ledgerEntries.map((entry) => entry.id).join(":") }}
        />
      )}

      {tabLoading ? (
        <TabLoader />
      ) : (
        <DataTableSurface
          surfaceClassName="mt-3"
          rows={filteredInvoices}
          columns={invoiceColumns}
          rowId={(invoice) => invoice.id}
          dictionary={t as unknown as Record<string, string>}
          emptyState={<EmptyCell>{t.patient_invoices_no_invoices}</EmptyCell>}
          onRowClick={(invoice) => onOpenInvoice(invoice.id)}
          rowAccent={(invoice) => invoiceAccentClass(invoice.status)}
          toolbarStart={
            <>
              <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                {t.patient_invoices_payment_followup}
              </span>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
            </>
          }
          rowActions={(invoice) => (
            <RowActionsMenu
              label={t.table_actions}
              items={[
                {
                  key: "open",
                  label: t.patient_invoices_open,
                  icon: <ExternalLink className="size-3.5" />,
                  onSelect: () => onOpenInvoice(invoice.id),
                },
                ...(canManageInvoices
                  ? [
                      {
                        key: "billing",
                        label: t.patient_invoices_manage_billing,
                        icon: <CircleDollarSign className="size-3.5" />,
                        onSelect: () => onManageInvoice(invoice),
                      },
                    ]
                  : []),
              ]}
            />
          )}
          rowActionsWidth={44}
          pagination={{ resetKey: filteredInvoices.map((invoice) => invoice.id).join(":") }}
        />
      )}
    </TabsContent>
  );
}

export function PatientInvoicesTab(...args: Parameters<typeof usePatientInvoicesTabContent>) {
  return usePatientInvoicesTabContent(...args);
}
