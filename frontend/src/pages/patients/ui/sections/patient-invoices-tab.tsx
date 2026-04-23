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

import type { InvoiceItem } from "../../model/detail-tab-types";
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

export function PatientInvoicesTab({
  l,
  commonNotSet,
  tabLoading,
  invoices,
  invoiceOpenCount,
  invoiceOverdueCount,
  invoiceOutstandingAmount,
  invoicePaidAmountTotal,
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
  return (
    <TabsContent value="invoices" className="space-y-4 mt-4 min-h-[400px]">
      <WorkspaceSectionIntro
        title={l("Billing-Cockpit", "Панель биллинга", "Billing cockpit")}
        description={l(
          "Zahlungsstatus, offene Beträge und Eskalation direkt im Kontext des Patienten.",
          "Статусы оплат, открытые суммы и эскалация прямо в контексте пациента.",
          "Payment status, outstanding balances and escalation directly in patient context.",
        )}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      />

      <FormSection
        title={l("Finanzüberblick", "Финансовый обзор", "Financial overview")}
        accessory={<CountBadge>{invoices.length} {l("Rechnungen", "счетов", "invoices")}</CountBadge>}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={l("Offene Rechnungen", "Открытые счета", "Open invoices")}
            value={invoiceOpenCount}
            description={l(
              "Rechnungen mit verbleibendem Saldo.",
              "Счета, по которым ещё остаётся остаток.",
              "Invoices with a remaining balance.",
            )}
          />
          <StatCard
            label={l("Überfällig", "Просрочено", "Overdue")}
            value={invoiceOverdueCount}
            description={l(
              "Rechnungen, die sofortige Nachverfolgung erfordern.",
              "Счета, требующие немедленного follow-up.",
              "Invoices that require immediate follow-up.",
            )}
          />
          <StatCard
            label={l("Offener Betrag", "Открытая сумма", "Outstanding amount")}
            value={formatMoney(String(invoiceOutstandingAmount))}
            description={l(
              "Noch nicht bezahlte Gesamtsumme in diesem Patientenprofil.",
              "Общая сумма, которая ещё не оплачена по этому профилю пациента.",
              "Total amount still unpaid in this patient profile.",
            )}
          />
          <StatCard
            label={l("Bezahlt", "Оплачено", "Paid")}
            value={formatMoney(String(invoicePaidAmountTotal))}
            description={l(
              "Bereits vereinnahmter Betrag über alle Rechnungen.",
              "Сумма, уже оплаченная по всем счетам.",
              "Amount already collected across all invoices.",
            )}
          />
        </div>
      </FormSection>

      <FormSection
        title={l("Rechnungen und Zahlungsnachverfolgung", "Счета и контроль оплат", "Invoices and payment follow-up")}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : invoices.length === 0 ? (
          <EmptyCell>
            {l("Für diesen Patienten wurden noch keine Rechnungen erstellt.", "Для этого пациента пока не создано ни одного счёта.", "No invoices have been issued for this patient yet.")}
          </EmptyCell>
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{invoice.invoice_number}</span>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px]", statusColors[invoice.status] ?? "")}
                    >
                      {statusLabel(invoice.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/80">{formatDateTime(invoice.issued_at)}</p>
                </div>
                <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-4 text-sm text-muted-foreground">
                  <p>{l("Typ", "Тип", "Type")}: {invoiceTypeLabel(invoice.invoice_type)}</p>
                  <p>{l("Gesamt", "Итого", "Total")}: {formatMoney(invoice.total_gross)}</p>
                  <p>{l("Bezahlt", "Оплачено", "Paid")}: {formatMoney(invoice.paid_amount)}</p>
                  <p>{l("Offen", "Остаток", "Open")}: {formatMoney(invoice.balance_due)}</p>
                  <p>{l("Fällig", "Срок", "Due")}: {formatDate(invoice.due_date, commonNotSet)}</p>
                  <p>{l("Auftrag", "Заказ", "Order")}: {invoice.order_number ?? commonNotSet}</p>
                  <p>{l("Angebot", "Смета", "Quote")}: {invoice.quote_number ?? commonNotSet}</p>
                </div>
                {moneyValueNumber(invoice.balance_due) > 0 ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px] w-fit",
                      invoice.status === "overdue"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700",
                    )}
                  >
                    {invoice.status === "overdue"
                      ? l("Sofort nachverfolgen", "Требует срочного follow-up", "Needs urgent follow-up")
                      : l("Saldo offen", "Есть остаток", "Balance outstanding")}
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
                    {l("Öffnen", "Открыть", "Open")}
                  </Button>
                  {canManageInvoices ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => onManageInvoice(invoice)}
                    >
                      {l("Billing verwalten", "Управлять биллингом", "Manage billing")}
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
