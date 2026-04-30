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
import { cn } from "@/lib/utils";

import type {
  InvoiceItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientServicePackageItem,
  OrderItem,
} from "../../model/detail-tab-types";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

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
          setFinanceError(error instanceof Error ? error.message : "Failed to load finance filters");
        }
      } finally {
        if (!cancelled) setFinanceBusy(false);
      }
    }

    void loadFinanceContext();
    return () => {
      cancelled = true;
    };
  }, [financeQuery, patientId]);

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
      setAssignError(error instanceof Error ? error.message : "Failed to assign package");
    } finally {
      setAssignBusy(false);
    }
  }

  async function handleConsumePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!patientId || !consumeTargetId) return;
    const quantity = Number(consumeForm.quantity.replace(",", "."));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setConsumeError("Quantity must be greater than zero.");
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
      setConsumeError(error instanceof Error ? error.message : "Failed to record consumption");
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
        title={l("Billing cockpit", "Billing cockpit", "Billing cockpit")}
        description={l(
          "Payment status, package coverage, ledger and profitability in patient context.",
          "Payment status, package coverage, ledger and profitability in patient context.",
          "Payment status, package coverage, ledger and profitability in patient context.",
        )}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      />

      <FormSection
        title={l("Financial overview", "Financial overview", "Financial overview")}
        accessory={
          <CountBadge>
            {invoices.length} {l("invoices", "invoices", "invoices")}
          </CountBadge>
        }
      >
        {financeError ? (
          <Banner tone="error" withIcon>
            {financeError}
          </Banner>
        ) : null}
        <div className="mb-4 grid gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3 md:grid-cols-2 xl:grid-cols-5">
          <Field label={l("From", "From", "From")} htmlFor="profitability-from">
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
          <Field label={l("To", "To", "To")} htmlFor="profitability-to">
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
          <Field label={l("Order", "Order", "Order")} htmlFor="profitability-order">
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
              <option value="__all__">{l("All orders", "All orders", "All orders")}</option>
              {patientOrders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.order_number}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={l("Package", "Package", "Package")} htmlFor="profitability-package">
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
              <option value="__all__">{l("All packages", "All packages", "All packages")}</option>
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
              {l("Reset", "Reset", "Reset")}
            </Button>
            <Button
              type="button"
              className="h-9 rounded-lg"
              onClick={() =>
                patientId
                  ? void downloadPatientLedgerExport(patientId, financeQuery).catch((error) =>
                      setFinanceError(
                        error instanceof Error ? error.message : "Failed to export",
                      ),
                    )
                  : undefined
              }
              disabled={!patientId || financeBusy}
            >
              {l("Export", "Export", "Export")}
            </Button>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={l("Gross revenue", "Gross revenue", "Gross revenue")}
            value={formatMoney(revenueGross)}
            description={l(
              "Invoice revenue for this patient.",
              "Invoice revenue for this patient.",
              "Invoice revenue for this patient.",
            )}
          />
          <StatCard
            label={l("Open invoices", "Open invoices", "Open invoices")}
            value={invoiceOpenCount}
            description={l(
              "Invoices with a remaining balance.",
              "Invoices with a remaining balance.",
              "Invoices with a remaining balance.",
            )}
          />
          <StatCard
            label={l("Outstanding amount", "Outstanding amount", "Outstanding amount")}
            value={formatMoney(openBalance)}
            description={l(
              "Total amount still unpaid in this patient profile.",
              "Total amount still unpaid in this patient profile.",
              "Total amount still unpaid in this patient profile.",
            )}
          />
          <StatCard
            label={l("Paid", "Paid", "Paid")}
            value={formatMoney(paidAmount)}
            description={l(
              "Amount already collected across all invoices.",
              "Amount already collected across all invoices.",
              "Amount already collected across all invoices.",
            )}
          />
          <StatCard
            label={l("Overdue amount", "Overdue amount", "Overdue amount")}
            value={formatMoney(overdueAmount)}
            description={l(
              "Balance requiring immediate billing follow-up.",
              "Balance requiring immediate billing follow-up.",
              "Balance requiring immediate billing follow-up.",
            )}
          />
          {effectiveFinancialSummary?.margin_visible ? (
            <>
              <StatCard
                label={l("Gross expenses", "Gross expenses", "Gross expenses")}
                value={formatMoney(effectiveFinancialSummary.expenses_gross)}
                description={l(
                  "Visible only to CEO and Billing.",
                  "Visible only to CEO and Billing.",
                  "Visible only to CEO and Billing.",
                )}
              />
              <StatCard
                label={l("Net margin", "Net margin", "Net margin")}
                value={formatMoney(effectiveFinancialSummary.margin_net)}
                description={`${effectiveFinancialSummary.margin_percent ?? "0"}%`}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {l("Margin hidden", "Margin hidden", "Margin hidden")}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                {l(
                  "Profitability is intentionally visible only to CEO and Billing.",
                  "Profitability is intentionally visible only to CEO and Billing.",
                  "Profitability is intentionally visible only to CEO and Billing.",
                )}
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
                  {item.service_type}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatMoney(item.revenue_gross)} gross /{" "}
                  {formatMoney(item.revenue_net)} net
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </FormSection>

      <FormSection
        title={l("Service packages", "Service packages", "Service packages")}
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
                {l("Assign package", "Assign package", "Assign package")}
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
              <Field label={l("Package", "Package", "Package")}>
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
                    {l("Choose package", "Choose package", "Choose package")}
                  </option>
                  {assignablePackages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={l("Order", "Order", "Order")}>
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
                  <option value="__none__">{l("No order link", "No order link", "No order link")}</option>
                  {patientOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={l("Starts", "Starts", "Starts")}>
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
              <Field label={l("Ends", "Ends", "Ends")}>
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
              <Field label={l("Payer", "Payer", "Payer")}>
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
              <Field label={l("Relationship", "Relationship", "Relationship")}>
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
              <Field label={l("Notes", "Notes", "Notes")} className="md:col-span-2">
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
                {l("Cancel", "Cancel", "Cancel")}
              </Button>
              <Button
                type="submit"
                className="h-9 rounded-lg"
                disabled={assignBusy || !assignForm.packageId}
              >
                {l("Assign", "Assign", "Assign")}
              </Button>
            </div>
          </form>
        ) : null}

        {tabLoading ? (
          <TabLoader />
        ) : packageGroupItems.length === 0 ? (
          <EmptyCell>
            {l(
              "No service package is assigned to this patient yet.",
              "No service package is assigned to this patient yet.",
              "No service package is assigned to this patient yet.",
            )}
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
                      {group.items.length} {l("items", "items", "items")}
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
                        {item.description ??
                          l("Package summary", "Package summary", "Package summary")}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {l("Included", "Included", "Included")}:{" "}
                        {item.included_quantity} {item.unit_label ?? ""} /{" "}
                        {l("Used", "Used", "Used")}: {item.used_quantity} /{" "}
                        {l("Remaining", "Remaining", "Remaining")}:{" "}
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
                              {l("Overage", "Overage", "Overage")}:{" "}
                              {item.overage_quantity}
                            </Badge>
                          ) : null}
                          {moneyNumeric(item.pending_overage_quantity) > 0 ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-orange-200 bg-orange-50 text-[10px] text-orange-700"
                            >
                              {l("Pending", "Pending", "Pending")}:{" "}
                              {item.pending_overage_quantity}
                            </Badge>
                          ) : null}
                          {moneyNumeric(item.approved_overage_quantity) > 0 ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700"
                            >
                              {l("Approved", "Approved", "Approved")}:{" "}
                              {item.approved_overage_quantity}
                            </Badge>
                          ) : null}
                          {item.requires_patient_approval ? (
                            <Badge
                              variant="outline"
                              className="rounded-full border-sky-200 bg-sky-50 text-[10px] text-sky-700"
                            >
                              {l("Patient approval", "Patient approval", "Patient approval")}
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
                            {l("Approve overage", "Approve overage", "Approve overage")}
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
                            {l("Decline", "Decline", "Decline")}
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
                        <Field label={l("Item", "Item", "Item")}>
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
                              {l("Package summary", "Package summary", "Package summary")}
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
                        <Field label={l("Order", "Order", "Order")}>
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
                            <option value="__none__">{l("No order", "No order", "No order")}</option>
                            {patientOrders.map((order) => (
                              <option key={order.id} value={order.id}>
                                {order.order_number}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </Field>
                        <Field label={l("Order service ID", "Order service ID", "Order service ID")}>
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
                            placeholder="optional UUID"
                          />
                        </Field>
                        <Field label={l("Quantity", "Quantity", "Quantity")}>
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
                            {l("Record", "Record", "Record")}
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
                            {l("Cancel", "Cancel", "Cancel")}
                          </Button>
                        </div>
                        <Field label={l("Consumption note", "Consumption note", "Consumption note")} className="md:col-span-2 xl:col-span-5">
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
                        {l("Record order/service consumption", "Record order/service consumption", "Record order/service consumption")}
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
        title={l("Accounting ledger", "Accounting ledger", "Accounting ledger")}
        accessory={<CountBadge>{ledgerEntries.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : ledgerEntries.length === 0 ? (
          <EmptyCell>
            {l(
              "No ledger entries for this patient yet.",
              "No ledger entries for this patient yet.",
              "No ledger entries for this patient yet.",
            )}
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
                        entry.direction === "revenue"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-rose-200 bg-rose-50 text-rose-700",
                      )}
                    >
                      {entry.direction}
                    </Badge>
                    <span className="truncate font-medium text-foreground">
                      {entry.description}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.category}
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
        title={l("Invoices and payment follow-up", "Invoices and payment follow-up", "Invoices and payment follow-up")}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : invoices.length === 0 ? (
          <EmptyCell>
            {l(
              "No invoices have been issued for this patient yet.",
              "No invoices have been issued for this patient yet.",
              "No invoices have been issued for this patient yet.",
            )}
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
                    {l("Type", "Type", "Type")}:{" "}
                    {invoiceTypeLabel(invoice.invoice_type)}
                  </p>
                  <p>
                    {l("Total", "Total", "Total")}:{" "}
                    {formatMoney(invoice.total_gross)}
                  </p>
                  <p>
                    {l("Paid", "Paid", "Paid")}:{" "}
                    {formatMoney(invoice.paid_amount)}
                  </p>
                  <p>
                    {l("Open", "Open", "Open")}:{" "}
                    {formatMoney(invoice.balance_due)}
                  </p>
                  <p>
                    {l("Due", "Due", "Due")}:{" "}
                    {formatDate(invoice.due_date, commonNotSet)}
                  </p>
                  <p>
                    {l("Order", "Order", "Order")}:{" "}
                    {invoice.order_number ?? commonNotSet}
                  </p>
                  <p>
                    {l("Quote", "Quote", "Quote")}:{" "}
                    {invoice.quote_number ?? commonNotSet}
                  </p>
                  <p>
                    {l("Patient view", "Patient view", "Patient view")}:{" "}
                    {invoice.portal_visibility?.visible_to_patient
                      ? invoice.portal_visibility.amounts_visible_to_patient
                        ? l("amounts visible", "amounts visible", "amounts visible")
                        : l("amounts hidden", "amounts hidden", "amounts hidden")
                      : l("hidden", "hidden", "hidden")}
                  </p>
                  <p>
                    {l("Payer", "Payer", "Payer")}:{" "}
                    {invoice.payer?.contact_name ??
                      invoice.payer?.contact_relationship ??
                      commonNotSet}
                  </p>
                </div>
                {invoice.portal_visibility &&
                !invoice.portal_visibility.amounts_visible_to_patient ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {l(
                      "Patient preview: amount fields and PDF are hidden from the portal.",
                      "Patient preview: amount fields and PDF are hidden from the portal.",
                      "Patient preview: amount fields and PDF are hidden from the portal.",
                    )}
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
                      ? l("Needs urgent follow-up", "Needs urgent follow-up", "Needs urgent follow-up")
                      : l("Balance outstanding", "Balance outstanding", "Balance outstanding")}
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
                    {l("Open", "Open", "Open")}
                  </Button>
                  {canManageInvoices ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => onManageInvoice(invoice)}
                    >
                      {l("Manage billing", "Manage billing", "Manage billing")}
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
