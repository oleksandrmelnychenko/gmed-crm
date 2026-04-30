import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  StatCard,
  TabLoader,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import type {
  InvoiceItem,
  PatientFinancialLedger,
  PatientFinancialSummary,
  PatientServicePackageItem,
} from "../../model/detail-tab-types";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (de: string, ru: string, en: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type MoneyFormatter = (value?: string | null, currency?: string) => string;

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
  const packageGroupItems = buildPackageGroups(servicePackages);
  const ledgerEntries = financialLedger?.entries ?? [];
  const revenueGross =
    financialSummary?.revenue_gross ??
    String(invoiceOutstandingAmount + invoicePaidAmountTotal);
  const openBalance =
    financialSummary?.open_balance ?? String(invoiceOutstandingAmount);
  const paidAmount =
    financialSummary?.paid_amount ?? String(invoicePaidAmountTotal);
  const overdueAmount =
    financialSummary?.overdue_amount ?? String(invoiceOverdueCount);

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
          {financialSummary?.margin_visible ? (
            <>
              <StatCard
                label={l("Gross expenses", "Gross expenses", "Gross expenses")}
                value={formatMoney(financialSummary.expenses_gross)}
                description={l(
                  "Visible only to CEO and Billing.",
                  "Visible only to CEO and Billing.",
                  "Visible only to CEO and Billing.",
                )}
              />
              <StatCard
                label={l("Net margin", "Net margin", "Net margin")}
                value={formatMoney(financialSummary.margin_net)}
                description={`${financialSummary.margin_percent ?? "0"}%`}
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

        {financialSummary?.breakdown_by_service_type.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {financialSummary.breakdown_by_service_type.map((item) => (
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
        accessory={<CountBadge>{packageGroupItems.length}</CountBadge>}
      >
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
                        {item.included_quantity} /{" "}
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
                    </div>
                  ))}
                </div>
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
                </div>
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
