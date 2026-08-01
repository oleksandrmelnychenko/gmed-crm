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
  CircleDollarSign,
  Download,
  ExternalLink,
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
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type {
  InvoiceItem,
  PatientFinancialLedger,
  PatientFinancialLedgerEntry,
  PatientFinancialSummary,
  PatientServicePackageItem,
  OrderItem,
} from "../../model/detail-tab-types";
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
  const patientId = financialSummary?.patient_id ?? invoices.find((item) => item.patient_id)?.patient_id ?? "";
  const [financeState, dispatchFinanceState] = useReducer(
    patientInvoicesFinanceReducer,
    undefined,
    createPatientInvoicesFinanceState,
  );
  const {
    financeFilters,
    refreshedFinancialSummary,
    refreshedFinancialLedger,
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
        const [summary, ledger, packages, catalog, orders] = await Promise.all([
          apiFetch<PatientFinancialSummary>(
            `/patients/${patientId}/financial-summary${suffix ? `?${suffix}` : ""}`,
          ),
          apiFetch<PatientFinancialLedger>(
            `/patients/${patientId}/financial-ledger${suffix ? `?${suffix}` : ""}`,
          ),
          apiFetch<PatientServicePackageItem[]>(`/patients/${patientId}/service-packages`),
          apiFetch<PackageCatalogItem[]>("/service-packages").catch(() => []),
          apiFetch<OrderItem[]>(`/patients/${patientId}/orders`).catch(() => []),
        ]);
        if (cancelled) return;
        dispatchFinanceState({
          refreshedFinancialSummary: summary,
          refreshedFinancialLedger: ledger,
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
        accessor: (entry) => entry.description,
        filterType: "text",
        width: 300,
        render: (entry) => (
          <span className="block truncate text-xs text-foreground" title={entry.description}>
            {entry.description}
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
    [commonNotSet, formatDate, formatMoney, ledgerEntries, ledgerLabels, t],
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
          const range = [item.starts_on, item.ends_on].filter(Boolean).join(" – ");
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
              width: 70,
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
              <span className="shrink-0 self-center text-[13px] font-semibold tracking-tight text-foreground">
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
              <span className="shrink-0 self-center text-[13px] font-semibold tracking-tight text-foreground">
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
              <span className="shrink-0 self-center text-[13px] font-semibold tracking-tight text-foreground">
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
          rowActionsWidth={70}
          pagination={{ resetKey: filteredInvoices.map((invoice) => invoice.id).join(":") }}
        />
      )}
    </TabsContent>
  );
}

export function PatientInvoicesTab(...args: Parameters<typeof usePatientInvoicesTabContent>) {
  return usePatientInvoicesTabContent(...args);
}
