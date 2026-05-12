import {
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  Banknote,
  ChevronDown,
  CircleDollarSign,
  Download,
  Plus,
  ReceiptText,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  WalletCards,
} from "lucide-react";

import { AdminInlineMetric, AdminToolbar } from "@/components/admin-page-patterns";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TabsContent } from "@/components/ui/tabs";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  Section as FormSection,
  TabLoader,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { apiFetch, downloadApiFile } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type {
  InvoiceItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientServicePackageItem,
  OrderItem,
} from "../../model/detail-tab-types";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";
import {
  patientInvoiceLedgerCategoryLabel,
  patientInvoiceLedgerDirectionLabel,
  patientInvoiceServiceTypeLabel,
} from "../../model/portal-shared";

type LocalizeFn = (de: string, ru: string, en: string) => string;
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

function moneyNumeric(value?: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function invoiceAccentClass(status: string) {
  if (status === "paid") return "bg-emerald-500";
  if (status === "overdue" || status === "cancelled") return "bg-rose-500";
  if (status === "partially_paid") return "bg-amber-500";
  if (status === "draft") return "bg-zinc-400";
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
  invoiceOpenCount,
  invoiceOverdueCount,
  invoiceOutstandingAmount,
  invoicePaidAmountTotal,
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
  const { t } = useLang();
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
  const packageGroupItems = buildPackageGroups(effectiveServicePackages);
  const consumeTargetGroup =
    packageGroupItems.find(([id]) => id === consumeTargetId)?.[1] ?? null;
  const assignedPackageIds = new Set(
    effectiveServicePackages.map((item) => item.package_id),
  );
  const assignablePackages = packageCatalog.filter(
    (item) => item.is_active && !assignedPackageIds.has(item.id),
  );
  const effectiveFinancialSummary = refreshedFinancialSummary ?? financialSummary;
  const effectiveFinancialLedger = refreshedFinancialLedger ?? financialLedger;
  const ledgerEntries = effectiveFinancialLedger?.entries ?? [];
  const revenueGross =
    effectiveFinancialSummary?.revenue_gross ??
    String(invoiceOutstandingAmount + invoicePaidAmountTotal);
  const openBalance =
    effectiveFinancialSummary?.open_balance ?? String(invoiceOutstandingAmount);
  const paidAmount =
    effectiveFinancialSummary?.paid_amount ?? String(invoicePaidAmountTotal);
  const overdueAmount =
    effectiveFinancialSummary?.overdue_amount ?? String(invoiceOverdueCount);

  return (
    <TabsContent value="invoices" className="mt-4 min-h-[400px] space-y-4">
      <WorkspaceSectionIntro
        title={t.patient_invoices_billing_cockpit}
        description={t.patient_invoices_billing_cockpit_description}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      />

      <FormSection
        title={t.patient_invoices_financial_overview}
        accessory={
          <CountBadge>
            {invoices.length} {t.patient_invoices_count_suffix}
          </CountBadge>
        }
      >
        {financeError ? (
          <Banner tone="error" withIcon>
            {financeError}
          </Banner>
        ) : null}
        <AdminToolbar className="mb-4 items-start gap-2 rounded-xl bg-card/70 p-3 shadow-none">
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
              {packageCatalog.map((item) => (
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
        <div className="grid gap-y-4 overflow-hidden rounded-xl border border-border px-3 pb-4 pt-4 md:grid-cols-2 xl:grid-cols-4 [&>article:not(:last-child):not(:nth-child(4n))_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric
            icon={CircleDollarSign}
            label={t.patient_invoices_gross_revenue}
            value={formatMoney(revenueGross)}
            description={t.patient_invoices_gross_revenue_description}
            tone="sky"
          />
          <AdminInlineMetric
            icon={ReceiptText}
            label={t.patient_invoices_open_invoices}
            value={invoiceOpenCount}
            description={t.patient_invoices_open_invoices_description}
            tone="slate"
          />
          <AdminInlineMetric
            icon={WalletCards}
            label={t.patient_invoices_outstanding_amount}
            value={formatMoney(openBalance)}
            description={t.patient_invoices_outstanding_amount_description}
            tone="amber"
          />
          <AdminInlineMetric
            icon={Banknote}
            label={t.patient_invoices_paid}
            value={formatMoney(paidAmount)}
            description={t.patient_invoices_paid_description}
            tone="emerald"
          />
          <AdminInlineMetric
            icon={TriangleAlert}
            label={t.patient_invoices_overdue_amount}
            value={formatMoney(overdueAmount)}
            description={t.patient_invoices_overdue_amount_description}
            tone="rose"
          />
          {effectiveFinancialSummary?.margin_visible ? (
            <>
              <AdminInlineMetric
                icon={TrendingDown}
                label={t.patient_invoices_gross_expenses}
                value={formatMoney(effectiveFinancialSummary.expenses_gross)}
                description={t.patient_invoices_visible_ceo_billing}
                tone="slate"
              />
              <AdminInlineMetric
                icon={TrendingUp}
                label={t.patient_invoices_net_margin}
                value={formatMoney(effectiveFinancialSummary.margin_net)}
                description={`${effectiveFinancialSummary.margin_percent ?? "0"}%`}
                tone="emerald"
              />
            </>
          ) : (
            <AdminInlineMetric
              icon={TrendingUp}
              label={t.patient_invoices_margin_hidden}
              value={commonNotSet}
              description={t.patient_invoices_margin_hidden_description}
              tone="slate"
            />
          )}
        </div>

        {effectiveFinancialSummary?.breakdown_by_service_type.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {effectiveFinancialSummary.breakdown_by_service_type.map((item) => (
              <div
                key={item.service_type}
                className="rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <p className="text-sm font-semibold text-foreground">
                  {patientInvoiceServiceTypeLabel(item.service_type)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMoney(item.revenue_gross)} {t.patient_invoices_money_gross} /{" "}
                  {formatMoney(item.revenue_net)} {t.patient_invoices_money_net}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </FormSection>

      <PatientSheetScaffold
        open={assignOpen && canManageInvoices}
        onOpenChange={(open) => setAssignOpen(open)}
        width="form-heavy"
        onSubmit={handleAssignPackage}
        title={t.patient_invoices_assign_package}
        bodyClassName="px-4 py-4 space-y-3"
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

        <FormSection title={l("Zusatzlich", "Дополнительно", "Additional")}>
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
        bodyClassName="px-4 py-4 space-y-3"
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

        <FormSection title={l("Verbrauch", "Использование", "Consumption")}>
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
                      {item.description}
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

        <FormSection title={l("Zusatzlich", "Дополнительно", "Additional")}>
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

      <FormSection
        title={t.patient_invoices_service_packages}
        accessory={
          <div className="flex items-center gap-2">
            <CountBadge>{packageGroupItems.length}</CountBadge>
            {canManageInvoices ? (
              <Button
                type="button"
                variant={assignOpen ? "default" : "outline"}
                size="sm"
                className="h-8 rounded-lg"
                onClick={() => setAssignOpen(true)}
                disabled={!patientId}
              >
                {t.patient_invoices_assign_package}
              </Button>
            ) : null}
          </div>
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : packageGroupItems.length === 0 ? (
          <EmptyCell>
            {t.patient_invoices_no_service_package}
          </EmptyCell>
        ) : (
          <div className="space-y-0">
            {packageGroupItems.map(([id, group]) => {
              const dateRange = [group.startsOn, group.endsOn].filter(Boolean).join(" - ");
              const payerLabel = [group.payerName, group.payerRelationship].filter(Boolean).join(" / ");

              return (
                <details key={id} className="group relative pl-9">
                  <summary className="relative grid cursor-pointer list-none gap-2 rounded-lg p-3 pr-12 transition hover:bg-[#f9fdff] group-open:bg-[#f9fdff] group-open:ring-1 group-open:ring-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <div className="absolute -left-9 bottom-0 top-0 flex w-8 items-start justify-center pt-3">
                      <span
                        className={cn(
                          "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
                          group.status === "active"
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                            : "bg-slate-50 text-slate-500 ring-1 ring-slate-200",
                        )}
                      >
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                      </span>
                    </div>

                    {canManageInvoices ? (
                      <div
                        role="presentation"
                        className="absolute right-3 top-3 z-20"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="size-7 rounded-full bg-white text-muted-foreground shadow-sm ring-1 ring-border/60 hover:bg-[#f9fdff] hover:text-foreground"
                          onClick={() => {
                            setConsumeTargetId(id);
                            setConsumeForm(BLANK_CONSUMPTION_FORM);
                            setConsumeError("");
                          }}
                          aria-label={t.patient_invoices_record_consumption}
                          title={t.patient_invoices_record_consumption}
                        >
                          <Plus className="size-3.5" />
                        </Button>
                      </div>
                    ) : null}

                    <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="max-w-full truncate text-[15px] font-semibold leading-5 text-foreground">
                            {group.packageName}
                          </p>
                          {group.orderNumber ? (
                            <>
                              <span className="size-1 rounded-full bg-muted-foreground/35" />
                              <span className="font-mono text-xs text-muted-foreground">
                                {group.orderNumber}
                              </span>
                            </>
                          ) : null}
                          {dateRange ? (
                            <>
                              <span className="size-1 rounded-full bg-muted-foreground/35" />
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {dateRange}
                              </span>
                            </>
                          ) : null}
                        </div>
                        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            {group.items.length} {t.patient_invoices_items_suffix}
                          </span>
                          {payerLabel ? (
                            <>
                              <span className="size-1 rounded-full bg-muted-foreground/35" />
                              <span className="max-w-[320px] truncate">
                                {t.patient_invoices_payer}:{" "}
                                <span className="font-medium text-foreground">
                                  {payerLabel}
                                </span>
                              </span>
                            </>
                          ) : null}
                          {group.notes ? (
                            <>
                              <span className="size-1 rounded-full bg-muted-foreground/35" />
                              <span className="max-w-[420px] truncate">
                                {group.notes}
                              </span>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex min-w-0 flex-wrap justify-start gap-1.5 lg:max-w-[520px] lg:justify-end lg:pr-1">
                        <Badge
                          variant="outline"
                          className={cn("rounded-full text-[10px]", statusColors[group.status] ?? "")}
                        >
                          {statusLabel(group.status)}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                        >
                          {t.patient_invoices_included}:{" "}
                          <span className="ml-1 font-semibold text-foreground">
                            {group.items.reduce(
                              (sum, item) => sum + moneyNumeric(item.included_quantity),
                              0,
                            )}
                          </span>
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                        >
                          {t.patient_invoices_used}:{" "}
                          <span className="ml-1 font-semibold text-foreground">
                            {group.items.reduce(
                              (sum, item) => sum + moneyNumeric(item.used_quantity),
                              0,
                            )}
                          </span>
                        </Badge>
                      </div>
                    </div>
                  </summary>

                  <div aria-hidden="true" className="ml-20 flex h-3 items-center px-3">
                    <span className="h-px w-12 bg-gradient-to-r from-transparent via-border/70 to-border/70" />
                    <span className="size-1.5 rounded-full bg-border" />
                    <span className="h-px flex-1 bg-gradient-to-r from-border/70 to-transparent" />
                  </div>
                  <div className="mb-2 ml-20 overflow-hidden rounded-lg bg-[#fbfdff] p-2 shadow-sm">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {group.items.map((item) => (
                        <div
                          key={item.package_item_id ?? `${id}:summary`}
                          className="rounded-md bg-white px-3 py-2 text-xs shadow-sm ring-1 ring-border/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 truncate font-medium text-foreground">
                              {item.description ?? t.patient_invoices_package_summary}
                            </p>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {item.included_quantity} {item.unit_label ?? ""}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                            <span>
                              {t.patient_invoices_used}:{" "}
                              <span className="font-medium text-foreground">
                                {item.used_quantity}
                              </span>
                            </span>
                            <span>
                              {t.patient_invoices_remaining}:{" "}
                              <span className="font-medium text-foreground">
                                {item.remaining_quantity}
                              </span>
                            </span>
                            {moneyValueNumber(item.overage_quantity) > 0 ? (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                                {t.patient_invoices_overage}: {item.overage_quantity}
                              </span>
                            ) : null}
                            {moneyNumeric(item.pending_overage_quantity) > 0 ? (
                              <span className="rounded-full bg-orange-50 px-2 py-0.5 font-medium text-orange-700">
                                {t.patient_invoices_pending}: {item.pending_overage_quantity}
                              </span>
                            ) : null}
                            {moneyNumeric(item.approved_overage_quantity) > 0 ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                                {t.patient_invoices_approved}: {item.approved_overage_quantity}
                              </span>
                            ) : null}
                            {item.requires_patient_approval ? (
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                                {t.patient_invoices_patient_approval}
                              </span>
                            ) : null}
                          </div>
                          {canManageInvoices && moneyNumeric(item.pending_overage_quantity) > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 rounded-lg"
                                disabled={
                                  approvalBusyKey ===
                                  `${item.patient_service_package_id}:${item.package_item_id ?? "summary"}:approved`
                                }
                                onClick={() =>
                                  void handleOverageDecision(
                                    item.patient_service_package_id,
                                    item.package_item_id,
                                    "approved",
                                  )
                                }
                              >
                                {t.patient_invoices_approve_overage}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 rounded-lg text-rose-700"
                                disabled={
                                  approvalBusyKey ===
                                  `${item.patient_service_package_id}:${item.package_item_id ?? "summary"}:declined`
                                }
                                onClick={() =>
                                  void handleOverageDecision(
                                    item.patient_service_package_id,
                                    item.package_item_id,
                                    "declined",
                                  )
                                }
                              >
                                {t.patient_invoices_decline}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>

                  </div>
                </details>
              );
            })}
          </div>
        )}
      </FormSection>

      <FormSection
        title={t.patient_invoices_accounting_ledger}
        accessory={<CountBadge>{ledgerEntries.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : ledgerEntries.length === 0 ? (
          <EmptyCell>
            {t.patient_invoices_no_ledger_entries}
          </EmptyCell>
        ) : (
          <div className="space-y-2">
            {ledgerEntries.slice(0, 12).map((entry) => (
              <article
                key={entry.id}
                className="overflow-hidden rounded-xl border border-border bg-card"
              >
                <div className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[96px_minmax(0,1fr)_180px] md:items-center">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {formatDate(entry.entry_date)}
                    </span>
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        entry.direction === "revenue" || entry.direction === "income"
                          ? "bg-emerald-500"
                          : "bg-rose-500",
                      )}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full text-[10px]",
                          entry.direction === "revenue" || entry.direction === "income"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700",
                        )}
                      >
                        {patientInvoiceLedgerDirectionLabel(entry.direction)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                      >
                        {patientInvoiceLedgerCategoryLabel(entry.category)}
                      </Badge>
                    </div>
                    <p className="mt-2 truncate font-medium text-foreground">
                      {entry.description}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[entry.order_number, entry.invoice_number, entry.external_invoice_number]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/20 px-3 py-2 text-right">
                    <p
                      className={cn(
                        "text-base font-semibold tabular-nums leading-none",
                        entry.direction === "revenue" || entry.direction === "income"
                          ? "text-emerald-700"
                          : "text-rose-700",
                      )}
                    >
                      {entry.direction === "expense" ? "-" : "+"}
                      {formatMoney(entry.amount_gross, entry.currency)}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {entry.currency}
                    </p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </FormSection>

      <FormSection
        title={t.patient_invoices_payment_followup}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : invoices.length === 0 ? (
          <EmptyCell>
            {t.patient_invoices_no_invoices}
          </EmptyCell>
        ) : (
          <div className="space-y-3">
            {invoices.map((invoice) => (
              <article
                key={invoice.id}
                className="rounded-xl border border-border bg-card"
              >
                <div className="relative overflow-hidden p-4">
                  <span
                    className={cn(
                      "absolute left-0 top-4 h-12 w-1 rounded-r-full",
                      invoiceAccentClass(invoice.status),
                    )}
                  />
                  <div className="grid gap-4 pl-3 md:grid-cols-[minmax(0,1fr)_190px]">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-px w-8 bg-border" />
                        <Badge
                          variant="outline"
                          className={cn("rounded-full text-[10px]", statusColors[invoice.status] ?? "")}
                        >
                          {statusLabel(invoice.status)}
                        </Badge>
                      </div>

                      <h3 className="mt-2 font-mono text-lg font-semibold leading-none text-foreground">
                        {invoice.invoice_number}
                      </h3>

                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {[
                          invoiceTypeLabel(invoice.invoice_type),
                          formatDateTime(invoice.issued_at),
                          `${t.patient_invoices_due}: ${formatDate(invoice.due_date, commonNotSet)}`,
                          invoice.order_number ? `${t.patient_invoices_order}: ${invoice.order_number}` : "",
                          invoice.quote_number ? `${t.patient_invoices_quote}: ${invoice.quote_number}` : "",
                        ]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                        >
                          {t.patient_invoices_total}:{" "}
                          <span className="ml-1 font-semibold text-foreground">
                            {formatMoney(invoice.total_gross)}
                          </span>
                        </Badge>
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 bg-white px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
                        >
                          {t.patient_invoices_paid}:{" "}
                          <span className="ml-1 font-semibold text-foreground">
                            {formatMoney(invoice.paid_amount)}
                          </span>
                        </Badge>
                        {moneyValueNumber(invoice.balance_due) > 0 ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              "rounded-full text-[10px]",
                              invoice.status === "overdue"
                                ? "border-rose-200 bg-rose-50 text-rose-700"
                                : "border-amber-200 bg-amber-50 text-amber-700",
                            )}
                          >
                            {invoice.status === "overdue"
                              ? t.patient_invoices_needs_urgent_followup
                              : t.patient_invoices_balance_outstanding}
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className="rounded-full border-0 bg-[#f9fdff] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {t.patient_invoices_patient_view}:{" "}
                          <span className="ml-1 font-semibold text-foreground">
                            {invoice.portal_visibility?.visible_to_patient
                              ? invoice.portal_visibility.amounts_visible_to_patient
                                ? t.patient_invoices_amounts_visible
                                : t.patient_invoices_amounts_hidden
                              : t.patient_invoices_hidden}
                          </span>
                        </Badge>
                      </div>

                      {invoice.portal_visibility &&
                      !invoice.portal_visibility.amounts_visible_to_patient ? (
                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          {t.patient_invoices_patient_preview_hidden}
                        </div>
                      ) : null}
                    </div>

                    <div className="flex flex-col justify-between gap-4 border-l border-dashed border-border pl-4">
                      <div>
                        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                          {t.patient_invoices_open}
                        </span>
                        <p className="mt-2 text-lg font-semibold leading-none text-foreground">
                          {formatMoney(invoice.balance_due)}
                        </p>
                        <p className="mt-2 text-xs leading-5 text-muted-foreground">
                          {invoice.payer?.contact_name ??
                            invoice.payer?.contact_relationship ??
                            commonNotSet}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="justify-center rounded-lg"
                          onClick={() => onOpenInvoice(invoice.id)}
                        >
                          {t.patient_invoices_open}
                        </Button>
                        {canManageInvoices ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="justify-center rounded-lg"
                            onClick={() => onManageInvoice(invoice)}
                          >
                            {t.patient_invoices_manage_billing}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}

export function PatientInvoicesTab(...args: Parameters<typeof usePatientInvoicesTabContent>) {
  return usePatientInvoicesTabContent(...args);
}
