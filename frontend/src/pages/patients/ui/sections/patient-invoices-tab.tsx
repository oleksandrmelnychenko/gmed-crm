import { useEffect, useMemo, useState, type FormEvent } from "react";

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
  StatCard,
  TabLoader,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { apiFetch, buildApiUrl, getAccessToken } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type {
  InvoiceItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientServicePackageItem,
  OrderItem,
} from "../../model/detail-tab-types";
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
      items: PatientServicePackageItem[];
    }
  >();

  for (const item of servicePackages) {
    const current = packageGroups.get(item.patient_service_package_id) ?? {
      packageName: item.package_name,
      status: item.status,
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

async function downloadPatientLedgerExport(patientId: string, query: URLSearchParams) {
  const token = getAccessToken();
  const response = await fetch(
    buildApiUrl(`/patients/${patientId}/financial-ledger/export?${query.toString()}`),
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `patient-profitability-${patientId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function PatientInvoicesTab({
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
  const [financeFilters, setFinanceFilters] = useState({
    from: "",
    to: "",
    orderId: "",
    packageId: "",
  });
  const [localFinancialSummary, setLocalFinancialSummary] =
    useState<PatientFinancialSummary | null>(financialSummary);
  const [localFinancialLedger, setLocalFinancialLedger] =
    useState<PatientFinancialLedger | null>(financialLedger);
  const [localServicePackages, setLocalServicePackages] =
    useState<PatientServicePackageItem[]>(servicePackages);
  const [packageCatalog, setPackageCatalog] = useState<PackageCatalogItem[]>([]);
  const [patientOrders, setPatientOrders] = useState<OrderItem[]>([]);
  const [financeBusy, setFinanceBusy] = useState(false);
  const [financeError, setFinanceError] = useState("");
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignForm, setAssignForm] = useState<AssignPackageForm>(BLANK_ASSIGN_PACKAGE_FORM);
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignError, setAssignError] = useState("");
  const [consumeTargetId, setConsumeTargetId] = useState("");
  const [consumeForm, setConsumeForm] = useState<ConsumptionForm>(BLANK_CONSUMPTION_FORM);
  const [consumeBusy, setConsumeBusy] = useState(false);
  const [consumeError, setConsumeError] = useState("");
  const [approvalBusyKey, setApprovalBusyKey] = useState("");

  useEffect(() => {
    setLocalFinancialSummary(financialSummary);
  }, [financialSummary]);

  useEffect(() => {
    setLocalFinancialLedger(financialLedger);
  }, [financialLedger]);

  useEffect(() => {
    setLocalServicePackages(servicePackages);
  }, [servicePackages]);

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
      setFinanceBusy(true);
      setFinanceError("");
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
        setLocalFinancialSummary(summary);
        setLocalFinancialLedger(ledger);
        setLocalServicePackages(packages);
        setPackageCatalog(catalog);
        setPatientOrders(orders);
      } catch (error) {
        if (!cancelled) {
          setFinanceError(error instanceof Error ? error.message : t.patient_invoices_error_load_filters);
        }
      } finally {
        if (!cancelled) setFinanceBusy(false);
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
    setLocalServicePackages(packages);
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

  const packageGroupItems = buildPackageGroups(localServicePackages);
  const assignedPackageIds = new Set(
    localServicePackages.map((item) => item.package_id),
  );
  const assignablePackages = packageCatalog.filter(
    (item) => item.is_active && !assignedPackageIds.has(item.id),
  );
  const effectiveFinancialSummary = localFinancialSummary ?? financialSummary;
  const effectiveFinancialLedger = localFinancialLedger ?? financialLedger;
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
        <div className="mb-4 grid gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label={t.patient_invoices_from} htmlFor="profitability-from">
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
          <Field label={t.patient_invoices_to} htmlFor="profitability-to">
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
          <Field label={t.patient_invoices_order} htmlFor="profitability-order">
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
          <Field label={t.patient_invoices_package} htmlFor="profitability-package">
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
          <div className="flex items-end gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => setFinanceFilters({ from: "", to: "", orderId: "", packageId: "" })}
              disabled={financeBusy}
            >
              {t.patient_invoices_reset}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg"
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
              {t.patient_invoices_export}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={t.patient_invoices_gross_revenue}
            value={formatMoney(revenueGross)}
            description={t.patient_invoices_gross_revenue_description}
          />
          <StatCard
            label={t.patient_invoices_open_invoices}
            value={invoiceOpenCount}
            description={t.patient_invoices_open_invoices_description}
          />
          <StatCard
            label={t.patient_invoices_outstanding_amount}
            value={formatMoney(openBalance)}
            description={t.patient_invoices_outstanding_amount_description}
          />
          <StatCard
            label={t.patient_invoices_paid}
            value={formatMoney(paidAmount)}
            description={t.patient_invoices_paid_description}
          />
          <StatCard
            label={t.patient_invoices_overdue_amount}
            value={formatMoney(overdueAmount)}
            description={t.patient_invoices_overdue_amount_description}
          />
          {effectiveFinancialSummary?.margin_visible ? (
            <>
              <StatCard
                label={t.patient_invoices_gross_expenses}
                value={formatMoney(effectiveFinancialSummary.expenses_gross)}
                description={t.patient_invoices_visible_ceo_billing}
              />
              <StatCard
                label={t.patient_invoices_net_margin}
                value={formatMoney(effectiveFinancialSummary.margin_net)}
                description={`${effectiveFinancialSummary.margin_percent ?? "0"}%`}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {t.patient_invoices_margin_hidden}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {t.patient_invoices_margin_hidden_description}
              </p>
            </div>
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
                onClick={() => setAssignOpen((current) => !current)}
                disabled={!patientId}
              >
                {t.patient_invoices_assign_package}
              </Button>
            ) : null}
          </div>
        }
      >
        {assignOpen && canManageInvoices ? (
          <form
            className="mb-4 rounded-xl border border-border/50 bg-card px-4 py-3"
            onSubmit={handleAssignPackage}
          >
            {assignError ? (
              <Banner tone="error" withIcon>
                {assignError}
              </Banner>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field label={t.patient_invoices_package}>
                <NativeComboboxSelect
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
              <Field label={t.patient_invoices_order}>
                <NativeComboboxSelect
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
              <Field label={t.patient_invoices_starts}>
                <Input
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
              <Field label={t.patient_invoices_ends}>
                <Input
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
              <Field label={t.patient_invoices_payer}>
                <Input
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
              <Field label={t.patient_invoices_relationship}>
                <Input
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
              <Field label={t.patient_invoices_notes} className="md:col-span-2">
                <textarea
                  value={assignForm.notes}
                  onChange={(event) =>
                    setAssignForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={textareaClass}
                  rows={2}
                  disabled={assignBusy}
                />
              </Field>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => setAssignOpen(false)}
                disabled={assignBusy}
              >
                {t.patient_invoices_cancel}
              </Button>
              <Button
                type="submit"
                className="h-9 rounded-lg"
                disabled={assignBusy || !assignForm.packageId}
              >
                {t.patient_invoices_assign}
              </Button>
            </div>
          </form>
        ) : null}

        {tabLoading ? (
          <TabLoader />
        ) : packageGroupItems.length === 0 ? (
          <EmptyCell>
            {t.patient_invoices_no_service_package}
          </EmptyCell>
        ) : (
          <div className="space-y-3">
            {packageGroupItems.map(([id, group]) => (
              <div
                key={id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {group.packageName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {group.items.length} {t.patient_invoices_items_suffix}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[group.status] ?? "")}
                  >
                    {statusLabel(group.status)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {group.items.map((item) => (
                    <div
                      key={item.package_item_id ?? `${id}:summary`}
                      className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-sm"
                    >
                      <p className="font-medium text-foreground">
                        {item.description ?? t.patient_invoices_package_summary}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t.patient_invoices_included}:{" "}
                        {item.included_quantity} {item.unit_label ?? ""} /{" "}
                        {t.patient_invoices_used}: {item.used_quantity} /{" "}
                        {t.patient_invoices_remaining}:{" "}
                        {item.remaining_quantity}
                      </p>
                      {moneyValueNumber(item.overage_quantity) > 0 ||
                      item.requires_patient_approval ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {moneyValueNumber(item.overage_quantity) > 0 ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-amber-200 bg-amber-50 text-[10px] text-amber-700"
                            >
                              {t.patient_invoices_overage}:{" "}
                              {item.overage_quantity}
                            </Badge>
                          ) : null}
                          {moneyNumeric(item.pending_overage_quantity) > 0 ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-orange-200 bg-orange-50 text-[10px] text-orange-700"
                            >
                              {t.patient_invoices_pending}:{" "}
                              {item.pending_overage_quantity}
                            </Badge>
                          ) : null}
                          {moneyNumeric(item.approved_overage_quantity) > 0 ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                            >
                              {t.patient_invoices_approved}:{" "}
                              {item.approved_overage_quantity}
                            </Badge>
                          ) : null}
                          {item.requires_patient_approval ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-sky-200 bg-sky-50 text-[10px] text-sky-700"
                            >
                              {t.patient_invoices_patient_approval}
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
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
                {canManageInvoices ? (
                  <div className="mt-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-3">
                    {consumeError && consumeTargetId === id ? (
                      <Banner tone="error" withIcon>
                        {consumeError}
                      </Banner>
                    ) : null}
                    {consumeTargetId === id ? (
                      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" onSubmit={handleConsumePackage}>
                        <Field label={t.patient_invoices_item}>
                          <NativeComboboxSelect
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
                            {group.items
                              .filter((item) => item.package_item_id)
                              .map((item) => (
                                <option key={item.package_item_id} value={item.package_item_id ?? ""}>
                                  {item.description}
                                </option>
                              ))}
                          </NativeComboboxSelect>
                        </Field>
                        <Field label={t.patient_invoices_order}>
                          <NativeComboboxSelect
                            value={consumeForm.orderId || "__none__"}
                            onChange={(event) =>
                              setConsumeForm((current) => ({
                                ...current,
                                orderId:
                                  event.target.value === "__none__" ? "" : event.target.value,
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
                        <Field label={t.patient_invoices_order_service_id}>
                          <Input
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
                        <Field label={t.patient_invoices_quantity}>
                          <Input
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
                        <div className="flex items-end gap-2">
                          <Button
                            type="submit"
                            className="h-9 rounded-lg"
                            disabled={consumeBusy}
                          >
                            {t.patient_invoices_record}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-9 rounded-lg"
                            onClick={() => {
                              setConsumeTargetId("");
                              setConsumeForm(BLANK_CONSUMPTION_FORM);
                            }}
                            disabled={consumeBusy}
                          >
                            {t.patient_invoices_cancel}
                          </Button>
                        </div>
                        <Field label={t.patient_invoices_consumption_note} className="md:col-span-2 xl:col-span-5">
                          <textarea
                            value={consumeForm.notes}
                            onChange={(event) =>
                              setConsumeForm((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            className={textareaClass}
                            rows={2}
                            disabled={consumeBusy}
                          />
                        </Field>
                      </form>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => {
                          setConsumeTargetId(id);
                          setConsumeForm(BLANK_CONSUMPTION_FORM);
                          setConsumeError("");
                        }}
                      >
                        {t.patient_invoices_record_consumption}
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
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
              <div
                key={entry.id}
                className="grid gap-2 rounded-xl border border-border/50 bg-card px-4 py-3 text-sm md:grid-cols-[120px_minmax(0,1fr)_160px]"
              >
                <div className="text-xs text-muted-foreground">
                  {formatDate(entry.entry_date)}
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
                    <span className="truncate font-medium text-foreground">
                      {entry.description}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {patientInvoiceLedgerCategoryLabel(entry.category)}
                    {entry.order_number ? ` / ${entry.order_number}` : ""}
                    {entry.invoice_number ? ` / ${entry.invoice_number}` : ""}
                    {entry.external_invoice_number
                      ? ` / ${entry.external_invoice_number}`
                      : ""}
                  </p>
                </div>
                <div className="text-right font-semibold tabular-nums text-foreground">
                  {formatMoney(entry.amount_gross, entry.currency)}
                </div>
              </div>
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
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="space-y-2.5 rounded-xl border border-border/50 bg-card px-4 py-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {invoice.invoice_number}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px]", statusColors[invoice.status] ?? "")}
                    >
                      {statusLabel(invoice.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/80">
                    {formatDateTime(invoice.issued_at)}
                  </p>
                </div>
                <div className="grid gap-1 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                  <p>
                    {t.patient_invoices_type}:{" "}
                    {invoiceTypeLabel(invoice.invoice_type)}
                  </p>
                  <p>
                    {t.patient_invoices_total}:{" "}
                    {formatMoney(invoice.total_gross)}
                  </p>
                  <p>
                    {t.patient_invoices_paid}:{" "}
                    {formatMoney(invoice.paid_amount)}
                  </p>
                  <p>
                    {t.patient_invoices_open}:{" "}
                    {formatMoney(invoice.balance_due)}
                  </p>
                  <p>
                    {t.patient_invoices_due}:{" "}
                    {formatDate(invoice.due_date, commonNotSet)}
                  </p>
                  <p>
                    {t.patient_invoices_order}:{" "}
                    {invoice.order_number ?? commonNotSet}
                  </p>
                  <p>
                    {t.patient_invoices_quote}:{" "}
                    {invoice.quote_number ?? commonNotSet}
                  </p>
                  <p>
                    {t.patient_invoices_patient_view}:{" "}
                    {invoice.portal_visibility?.visible_to_patient
                      ? invoice.portal_visibility.amounts_visible_to_patient
                        ? t.patient_invoices_amounts_visible
                        : t.patient_invoices_amounts_hidden
                      : t.patient_invoices_hidden}
                  </p>
                  <p>
                    {t.patient_invoices_payer}:{" "}
                    {invoice.payer?.contact_name ??
                      invoice.payer?.contact_relationship ??
                      commonNotSet}
                  </p>
                </div>
                {invoice.portal_visibility &&
                !invoice.portal_visibility.amounts_visible_to_patient ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {t.patient_invoices_patient_preview_hidden}
                  </div>
                ) : null}
                {moneyValueNumber(invoice.balance_due) > 0 ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "w-fit rounded-full text-[10px]",
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
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => onOpenInvoice(invoice.id)}
                  >
                    {t.patient_invoices_open}
                  </Button>
                  {canManageInvoices ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => onManageInvoice(invoice)}
                    >
                      {t.patient_invoices_manage_billing}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
