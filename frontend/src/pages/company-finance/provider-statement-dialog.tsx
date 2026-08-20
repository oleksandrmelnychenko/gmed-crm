import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Banner as ShellBanner } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { fetchCompanyProviderStatement } from "./data";
import type {
  CompanyFinancialFilters,
  CompanyProviderPosition,
  CompanyProviderStatement,
  CompanyProviderStatementMovement,
} from "./types";

type Props = {
  provider: CompanyProviderPosition | null;
  filters: Pick<CompanyFinancialFilters, "from" | "to" | "currency">;
  locale: string;
  onClose: () => void;
  onOpenInvoice: (externalInvoiceId: string) => void;
};

const copy = {
  ru: {
    title: "Взаиморасчеты с поставщиком",
    description: "Все начисления и выплаты за выбранный период",
    opening: "Остаток на начало",
    charged: "Начислено поставщиком",
    paid: "Выплачено компанией",
    reversed: "Отменено выплат",
    expected: "Ожидаемые расходы",
    closing: "Осталось выплатить",
    date: "Дата",
    operation: "Операция",
    document: "Документ",
    patient: "Пациент",
    chargedColumn: "Увеличение обязательства",
    paidColumn: "Уменьшение обязательства",
    balance: "Остаток после операции",
    invoice: "Счет поставщика",
    payment: "Выплата поставщику",
    reversal: "Отмена выплаты",
    noMovements: "За выбранный период операций нет",
    loadFailed: "Не удалось загрузить взаиморасчеты с поставщиком.",
  },
  de: {
    title: "Abrechnung mit dem Leistungserbringer",
    description: "Alle Belastungen und Zahlungen im gewählten Zeitraum",
    opening: "Anfangsbestand",
    charged: "Vom Leistungserbringer berechnet",
    paid: "Vom Unternehmen bezahlt",
    reversed: "Stornierte Zahlungen",
    expected: "Erwartete Kosten",
    closing: "Noch zu zahlen",
    date: "Datum",
    operation: "Vorgang",
    document: "Beleg",
    patient: "Patient",
    chargedColumn: "Erhöhung der Verbindlichkeit",
    paidColumn: "Minderung der Verbindlichkeit",
    balance: "Restbetrag nach dem Vorgang",
    invoice: "Eingangsrechnung",
    payment: "Zahlung an Leistungserbringer",
    reversal: "Stornierung der Zahlung",
    noMovements: "Im gewählten Zeitraum gibt es keine Vorgänge",
    loadFailed: "Die Abrechnung mit dem Leistungserbringer konnte nicht geladen werden.",
  },
} as const;

function formatMoney(value: string | null | undefined, currency: string, locale: string) {
  const parsed = Number(value ?? 0);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(parsed) ? parsed : 0);
}

function formatDate(value: string, locale: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale);
}

function operationLabel(
  movement: CompanyProviderStatementMovement,
  text: (typeof copy)[keyof typeof copy],
) {
  if (movement.movement_type === "invoice") return text.invoice;
  if (movement.movement_type === "payment") return text.payment;
  return text.reversal;
}

export function ProviderStatementDialog({
  provider,
  filters,
  locale,
  onClose,
  onOpenInvoice,
}: Props) {
  const { lang } = useLang();
  const text = copy[lang];
  const [statement, setStatement] = useState<CompanyProviderStatement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!provider?.provider_id) {
      setStatement(null);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void fetchCompanyProviderStatement(provider.provider_id, filters, true)
      .then((result) => {
        if (active) setStatement(result);
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setError(requestError instanceof Error ? requestError.message : text.loadFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filters, provider, text.loadFailed]);

  const currency = statement?.currency ?? filters.currency ?? "EUR";
  const closingBalance = Number(statement?.summary.closing_balance ?? 0);

  return (
    <Dialog open={Boolean(provider?.provider_id)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>
            {provider?.provider_name} · {text.description}
            {statement ? ` · ${formatDate(statement.period.from, locale)} — ${formatDate(statement.period.to, locale)}` : ""}
          </DialogDescription>
        </DialogHeader>

        {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}
        {loading ? (
          <div className="flex justify-center py-16"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>
        ) : statement ? (
          <div className="space-y-4">
            <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {([
                [text.opening, statement.summary.opening_balance, "default"],
                [text.charged, statement.summary.charged_gross, "negative"],
                [text.paid, statement.summary.paid_gross, "positive"],
                [text.reversed, statement.summary.reversed_gross, "negative"],
                [text.expected, statement.summary.expected_gross, "warning"],
                [text.closing, statement.summary.closing_balance, closingBalance > 0 ? "negative" : "positive"],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <dt className="text-[11px] text-muted-foreground">{label}</dt>
                  <dd className={cn(
                    "mt-1 text-base font-semibold tabular-nums",
                    tone === "positive" && "text-emerald-700 dark:text-emerald-400",
                    tone === "negative" && "text-rose-700 dark:text-rose-400",
                    tone === "warning" && "text-amber-700 dark:text-amber-400",
                  )}>{formatMoney(value, currency, locale)}</dd>
                </div>
              ))}
            </dl>

            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[1040px] text-sm">
                <thead className="bg-muted/40 text-left text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{text.date}</th>
                    <th className="px-3 py-2 font-medium">{text.operation}</th>
                    <th className="px-3 py-2 font-medium">{text.document}</th>
                    <th className="px-3 py-2 font-medium">{text.patient}</th>
                    <th className="px-3 py-2 text-right font-medium">{text.chargedColumn}</th>
                    <th className="px-3 py-2 text-right font-medium">{text.paidColumn}</th>
                    <th className="px-3 py-2 text-right font-medium">{text.balance}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {statement.movements.map((movement) => (
                    <tr key={`${movement.movement_type}:${movement.id}`} className="align-top hover:bg-muted/20">
                      <td className="whitespace-nowrap px-3 py-2.5">{formatDate(movement.movement_date, locale)}</td>
                      <td className="px-3 py-2.5">
                        <Badge variant={movement.movement_type === "payment" ? "secondary" : "outline"}>
                          {operationLabel(movement, text)}
                        </Badge>
                        {movement.financial_account_name ? <div className="mt-1 text-[11px] text-muted-foreground">{movement.financial_account_name}</div> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <Button type="button" variant="link" className="h-auto p-0 text-sm" onClick={() => onOpenInvoice(movement.external_invoice_id)}>
                          {movement.external_invoice_number}
                        </Button>
                        <div className="text-[11px] text-muted-foreground">{movement.order_number}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div>{movement.patient_name || movement.patient_pid}</div>
                        <div className="text-[11px] text-muted-foreground">{movement.patient_pid}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-rose-700 dark:text-rose-400">
                        {Number(movement.amount_charged) > 0 ? formatMoney(movement.amount_charged, currency, locale) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums text-emerald-700 dark:text-emerald-400">
                        {Number(movement.amount_paid) > 0 ? formatMoney(movement.amount_paid, currency, locale) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(movement.running_balance, currency, locale)}</td>
                    </tr>
                  ))}
                  {statement.movements.length === 0 ? (
                    <tr><td className="px-3 py-10 text-center text-sm text-muted-foreground" colSpan={7}>{text.noMovements}</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
