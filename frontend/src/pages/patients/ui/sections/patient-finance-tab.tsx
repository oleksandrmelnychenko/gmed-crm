import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, LoaderCircle } from "lucide-react";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select-field";
import { Banner, Field } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useFinanceAutoRefresh } from "@/pages/company-finance/use-finance-auto-refresh";
import type { PatientAccountMovement, PatientAccountStatement } from "../../model/detail-tab-types";
import { buildPatientFinancePeriods, financeAmount, financeCents, isFinanceDate, patientFinanceDateRange, type FinancePeriodPreset, type PatientFinancePeriod } from "../../model/finance-periods";

const copy = {
  ru: {
    title: "Финансы по периодам", from: "Период с", to: "По", currency: "Валюта",
    month: "Этот месяц", previous_month: "Прошлый месяц", quarter: "Этот квартал", year: "Этот год", all: "За всё время", custom: "Свои даты",
    opening: "На начало периода", invoices: "Счета и кредит-ноты", payments: "Получено оплат", refunds: "Возвращено пациенту", adjustments: "Прочие начисления / корректировки", closing: "На конец периода",
    monthly: "По месяцам", monthColumn: "Месяц", openingColumn: "Входящий остаток", closingColumn: "Расчётный остаток", status: "Состояние", debt: "Долг", credit: "Переплата", settled: "Без долга",
    movements: "Операции за период", date: "Дата", document: "Документ", kind: "Операция", debit: "Начислено", creditAmount: "Уменьшено", balance: "Остаток", order: "Заказ", count: "Операций",
    empty: "За выбранный период операций нет. Остаток перенесён с начала периода.", noMovements: "За выбранный месяц операций нет.", back: "Все месяцы", invoicesLink: "Открыть счета",
    loading: "Загрузка финансов", updating: "Обновление…", failed: "Не удалось загрузить финансы пациента.", retry: "Повторить",
    datesError: "Укажите корректные даты: начало периода не должно быть позже окончания.", dataError: "Не удалось сверить движения с остатком. Суммы не показаны — повторите загрузку.",
    reconciliation: "Остаток расчётный: есть суммы, требующие сверки. Они учитываются в таблице, но пока не подтверждены.",
    explanation: "Счета показаны с учётом кредит-нот, оплаты и возвраты — с учётом сторно. Прочие движения включают внешние требования и ручные корректировки. Нажмите на месяц, чтобы увидеть операции.",
    invoice: "Выставлен счёт", credit_note: "Кредит-нота", credit_note_reversal: "Сторно кредит-ноты", payment: "Оплата", payment_reversal: "Сторно оплаты", refund: "Возврат", refund_reversal: "Сторно возврата", balance_adjustment: "Корректировка", balance_adjustment_reversal: "Сторно корректировки", external_receivable: "Внешнее требование", external_allocation: "Распределение внешнего требования", external_allocation_reversal: "Сторно распределения", imported: "Перенесённая оплата", unknown: "Прочая операция",
  },
  de: {
    title: "Finanzen nach Zeitraum", from: "Zeitraum von", to: "Bis", currency: "Währung",
    month: "Dieser Monat", previous_month: "Letzter Monat", quarter: "Dieses Quartal", year: "Dieses Jahr", all: "Gesamter Zeitraum", custom: "Eigene Daten",
    opening: "Saldo zu Beginn", invoices: "Rechnungen und Gutschriften", payments: "Zahlungseingänge", refunds: "An Patienten erstattet", adjustments: "Sonstige Belastungen / Korrekturen", closing: "Saldo am Ende",
    monthly: "Nach Monaten", monthColumn: "Monat", openingColumn: "Anfangssaldo", closingColumn: "Berechneter Saldo", status: "Kontostand", debt: "Offener Betrag", credit: "Guthaben", settled: "Ausgeglichen",
    movements: "Buchungen im Zeitraum", date: "Datum", document: "Beleg", kind: "Buchung", debit: "Belastung", creditAmount: "Minderung", balance: "Saldo", order: "Auftrag", count: "Buchungen",
    empty: "Keine Buchungen im gewählten Zeitraum. Der Anfangssaldo wird fortgeführt.", noMovements: "Keine Buchungen in diesem Monat.", back: "Alle Monate", invoicesLink: "Rechnungen öffnen",
    loading: "Finanzen werden geladen", updating: "Aktualisierung…", failed: "Die Patientenfinanzen konnten nicht geladen werden.", retry: "Erneut versuchen",
    datesError: "Gültige Daten eingeben: Der Beginn darf nicht nach dem Ende liegen.", dataError: "Buchungen und Saldo konnten nicht abgestimmt werden. Beträge werden nicht angezeigt. Bitte erneut laden.",
    reconciliation: "Der Saldo ist vorläufig: Einige Beträge müssen noch abgestimmt werden. Sie sind in der Tabelle berücksichtigt, aber noch nicht bestätigt.",
    explanation: "Rechnungen enthalten Gutschriften, Zahlungen und Erstattungen berücksichtigen Stornierungen. Sonstige Buchungen umfassen externe Forderungen und manuelle Korrekturen. Ein Klick auf einen Monat zeigt die Buchungen.",
    invoice: "Rechnung", credit_note: "Gutschrift", credit_note_reversal: "Gutschriftstorno", payment: "Zahlung", payment_reversal: "Zahlungsstorno", refund: "Erstattung", refund_reversal: "Erstattungsstorno", balance_adjustment: "Kontokorrektur", balance_adjustment_reversal: "Korrekturstorno", external_receivable: "Externe Forderung", external_allocation: "Forderungszuordnung", external_allocation_reversal: "Zuordnungsstorno", imported: "Übernommene Zahlung", unknown: "Sonstige Buchung",
  },
} as const;

function balanceTone(value: bigint) {
  return value > 0n ? "text-rose-600 dark:text-rose-400" : value < 0n ? "text-sky-700 dark:text-sky-400" : "text-foreground";
}

export function PatientFinanceTab({ patientId, onOpenInvoices }: { patientId: string; onOpenInvoices: () => void }) {
  const { lang, t } = useLang();
  const l = copy[lang];
  const [preset, setPreset] = useState<FinancePeriodPreset>("year");
  const [range, setRange] = useState(() => patientFinanceDateRange("year"));
  const [currency, setCurrency] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [revision, setRevision] = useState(0);
  const movementSection = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ key: string; data: PatientAccountStatement | null; busy: boolean; error: boolean }>({ key: "", data: null, busy: true, error: false });
  const validRange = (!range.from || isFinanceDate(range.from)) && isFinanceDate(range.to) && (!range.from || range.from <= range.to) && (preset !== "custom" || Boolean(range.from));
  const query = new URLSearchParams({ to: range.to });
  if (range.from) query.set("from", range.from);
  if (currency) query.set("currency", currency);
  const requestPath = `/patients/${patientId}/account-statement?${query.toString()}`;
  const data = result.key === requestPath && validRange ? result.data : null;
  const busy = validRange && (result.key !== requestPath || result.busy);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useFinanceAutoRefresh(refresh, busy, validRange);

  useEffect(() => {
    if (!validRange) return;
    const controller = new AbortController();
    setResult(current => ({ key: requestPath, data: current.key === requestPath ? current.data : null, busy: true, error: false }));
    void apiFetch<PatientAccountStatement>(requestPath, { signal: controller.signal, forceFresh: true })
      .then(payload => {
        if (!controller.signal.aborted) setResult({ key: requestPath, data: payload, busy: false, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult(current => ({ ...current, busy: false, error: true }));
      });
    return () => controller.abort();
  }, [requestPath, revision, validRange]);

  const report = useMemo(() => {
    if (!data) return { periods: [], invalid: false };
    try {
      if (data.patient_id !== patientId || (currency && data.currency !== currency) || !data.amounts_complete) throw new Error("Account statement scope mismatch");
      return { periods: buildPatientFinancePeriods(data, range), invalid: false };
    }
    catch { return { periods: [], invalid: true }; }
  }, [data, range, patientId, currency]);
  const effectiveCurrency = data?.currency ?? currency ?? "EUR";
  const amount = useCallback((value: bigint) => formatMoneyAmount(financeAmount(value), effectiveCurrency || "EUR"), [effectiveCurrency]);
  const monthLabel = useCallback((value: string) => new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T12:00:00Z`)), [lang]);
  const balanceLabel = (value: bigint) => value > 0n ? l.debt : value < 0n ? l.credit : l.settled;
  const periods = report.periods;
  const totals = periods.reduce((sum, period) => ({ invoices: sum.invoices + period.invoices, payments: sum.payments + period.payments, refunds: sum.refunds + period.refunds, adjustments: sum.adjustments + period.adjustments }), { invoices: 0n, payments: 0n, refunds: 0n, adjustments: 0n });
  const selectedPeriod = periods.find(period => period.month === selectedMonth);
  const movements = data?.movements.filter(movement => !selectedPeriod || movement.entry_date.startsWith(selectedMonth)) ?? [];
  const changePreset = (next: FinancePeriodPreset) => {
    setPreset(next);
    setSelectedMonth("");
    if (next !== "custom") setRange(patientFinanceDateRange(next));
  };
  const tableLabels = lang === "de"
    ? { opening: "Anfangssaldo", invoices: "Rechnungen", payments: "Zahlungen", refunds: "Erstattungen", adjustments: "Sonstiges", closing: "Endsaldo" }
    : { opening: "На начало", invoices: "Счета", payments: "Оплаты", refunds: "Возвраты", adjustments: "Прочее", closing: "На конец" };
  const periodColumns: ColumnDef<PatientFinancePeriod>[] = [
    { id: "month", label: l.monthColumn, accessor: row => row.month, width: 165, minWidth: 150, sortable: true, render: row => <button type="button" className="text-left font-medium text-primary hover:underline" onClick={() => { setSelectedMonth(row.month); movementSection.current?.scrollIntoView({ block: "start" }); }}>{monthLabel(row.month)}</button> },
    ...(["opening", "invoices", "payments", "refunds", "adjustments", "closing"] as const).map(id => ({
      id, label: tableLabels[id], accessor: (row: PatientFinancePeriod) => Number(financeAmount(row[id])), width: 115, minWidth: 100, filterType: "number" as const, sortable: true,
      render: (row: PatientFinancePeriod) => <span className={cn("block whitespace-nowrap text-right font-mono tabular-nums", (id === "closing" || id === "opening") && balanceTone(row[id]), id === "payments" && row[id] > 0n && "text-emerald-700", id === "refunds" && row[id] > 0n && "text-rose-600")}>{amount(row[id])}</span>,
    })),
  ];
  const movementColumns: ColumnDef<PatientAccountMovement>[] = [
    { id: "date", label: l.date, accessor: row => row.entry_date, filterType: "date", width: 130, sortable: true, render: row => <span className="whitespace-nowrap">{new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU").format(new Date(`${row.entry_date}T12:00:00`))}</span> },
    { id: "kind", label: l.kind, accessor: row => row.id.startsWith("payment-balance:") ? l.imported : (l[row.kind as keyof typeof l] ?? l.unknown), width: 235 },
    { id: "document", label: l.document, accessor: row => row.document_number ?? "", width: 190, render: row => <span className="font-mono text-xs">{row.document_number || "—"}</span> },
    { id: "order", label: l.order, accessor: row => row.order_number ?? "", width: 180, render: row => <span className="font-mono text-xs">{row.order_number || "—"}</span> },
    ...(["debit", "credit", "balance_after"] as const).map(id => ({
      id, label: id === "debit" ? l.debit : id === "credit" ? l.creditAmount : l.balance, accessor: (row: PatientAccountMovement) => Number(row[id]), width: 170, filterType: "number" as const,
      render: (row: PatientAccountMovement) => <span className={cn("block whitespace-nowrap text-right font-mono tabular-nums", id === "balance_after" && balanceTone(financeCents(row[id])))}>{formatMoneyAmount(row[id], row.currency)}</span>,
    })),
  ];

  return (
    <div className="mt-4 min-w-0 space-y-4" data-testid="patient-finance">
      <section className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold"><span role="status" className="flex size-3 shrink-0 items-center justify-center">{busy ? <><LoaderCircle className="size-3 animate-spin text-muted-foreground" /><span className="sr-only">{data ? l.updating : l.loading}</span></> : <span className="size-2 rounded-full bg-[var(--brand)]" />}</span>{l.title}</h2>
          <Button type="button" size="sm" variant="outline" onClick={onOpenInvoices}>{l.invoicesLink}<ArrowRight /></Button>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap gap-1.5">
            {(["month", "previous_month", "quarter", "year", "all", "custom"] as const).map(value => <Button key={value} type="button" size="sm" variant={preset === value ? "default" : "ghost"} aria-pressed={preset === value} onClick={() => changePreset(value)}>{l[value]}</Button>)}
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem] lg:max-w-3xl">
            <Field label={l.from} htmlFor="patient-finance-from"><Input id="patient-finance-from" type="date" value={range.from} onChange={event => { setPreset("custom"); setSelectedMonth(""); setRange(current => ({ ...current, from: event.target.value })); }} /></Field>
            <Field label={l.to} htmlFor="patient-finance-to"><Input id="patient-finance-to" type="date" value={range.to} onChange={event => { setPreset("custom"); setSelectedMonth(""); setRange(current => ({ ...current, to: event.target.value })); }} /></Field>
            <Field label={l.currency}><SelectField aria-label={l.currency} value={effectiveCurrency || "EUR"} options={[...new Set([...(data?.available_currencies ?? []), effectiveCurrency || "EUR"])].map(value => ({ value, label: value }))} onValueChange={value => { setCurrency(value); setSelectedMonth(""); }} /></Field>
          </div>
        </div>
      </section>
      {!validRange ? <Banner tone="error">{l.datesError}</Banner> : null}
      {(result.key === requestPath && result.error) || report.invalid ? <Banner tone="error"><div className="flex flex-wrap items-center justify-between gap-3"><span>{report.invalid ? l.dataError : l.failed}</span><Button type="button" size="sm" variant="outline" onClick={refresh} disabled={busy}>{l.retry}</Button></div></Banner> : null}
      {data && !report.invalid && periods.length > 0 ? (
        <>
          {data.summary.reconciliation_required || data.summary.closing_balance == null ? <Banner tone="warning">{l.reconciliation}</Banner> : null}
          <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-3">
            {([
              ["opening", periods[0].opening], ["invoices", totals.invoices], ["payments", totals.payments], ["refunds", totals.refunds], ["adjustments", totals.adjustments], ["closing", periods[periods.length - 1].closing],
            ] as const).map(([key, value]) => {
              const isBalance = key === "opening" || key === "closing";
              const provisional = key === "closing" && data.summary.closing_balance == null;
              return <div key={key} data-testid={`finance-${key}`} className={cn("min-w-0 rounded-xl border border-border/70 border-l-[3px] bg-card px-4 py-3 shadow-sm", provisional ? "border-l-amber-400" : isBalance && value > 0n ? "border-l-rose-400" : isBalance && value < 0n ? "border-l-sky-400" : "border-l-border")}>
                <p className="text-xs text-muted-foreground">{l[key]}</p>
                <p className={cn("mt-1 break-words font-mono text-lg font-semibold tabular-nums", provisional ? "text-amber-700" : isBalance ? balanceTone(value) : key === "payments" && value > 0n ? "text-emerald-700" : "text-foreground")}>{amount(isBalance && value < 0n ? -value : value)}</p>
                {isBalance ? <p className="mt-1 text-xs text-muted-foreground">{provisional ? l.closingColumn : balanceLabel(value)}</p> : null}
              </div>;
            })}
          </div>
          {!data.movements.length ? <p className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">{l.empty}</p> : null}
          <DataTableSurface rows={periods} columns={periodColumns} rowId={row => row.month} dictionary={t as unknown as Record<string, string>} defaultFrozenColumns={["month"]} mobilePrimaryColumnId="month" mobileDetailColumnIds={["opening", "invoices", "payments", "refunds", "adjustments", "closing"]} rowHeightOverrides={{ comfortable: 44, compact: 40, condensed: 36 }} pagination={{ pageSize: 12, resetKey: requestPath }} toolbarStart={<h3 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-[var(--brand)]" />{l.monthly}</h3>} />
          <p className="text-xs leading-relaxed text-muted-foreground">{l.explanation}</p>
          <div ref={movementSection} className="scroll-mt-4">
          <DataTableSurface rows={movements} columns={movementColumns} rowId={row => row.id} dictionary={t as unknown as Record<string, string>} mobilePrimaryColumnId="kind" mobileDetailColumnIds={["date", "document", "debit", "credit", "balance_after"]} rowHeightOverrides={{ comfortable: 44, compact: 40, condensed: 36 }} pagination={{ pageSize: 20, resetKey: `${requestPath}:${selectedMonth}` }} emptyState={<p className="px-4 py-8 text-center text-sm text-muted-foreground">{l.noMovements}</p>} toolbarStart={<div className="flex flex-wrap items-center gap-3"><h3 className="flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full bg-[var(--brand)]" />{selectedPeriod ? monthLabel(selectedMonth) : l.movements}</h3>{selectedPeriod ? <Button type="button" size="sm" variant="outline" onClick={() => setSelectedMonth("")}><ArrowLeft />{l.back}</Button> : null}</div>} />
          </div>
        </>
      ) : null}
    </div>
  );
}
