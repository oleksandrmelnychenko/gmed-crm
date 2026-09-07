import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, LoaderCircle, Undo2 } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Banner as ShellBanner,
  selectClass as shellSelectClassName,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useFinanceAutoRefresh } from "./use-finance-auto-refresh";

import {
  createCompanyProviderPayment,
  fetchCompanyProviderSettlement,
  reverseCompanyProviderPayment,
} from "./data";
import type {
  CompanyFinancialAccount,
  CompanyProviderLiability,
  CompanyProviderPaymentTransaction,
  CompanyProviderSettlement,
} from "./types";

type Props = {
  liability: CompanyProviderLiability | null;
  accounts: CompanyFinancialAccount[];
  locale: string;
  onClose: () => void;
  onChanged: () => void;
};

const copy = {
  ru: {
    title: "Выплаты партнёру / исполнителю",
    description: "Частичные и полные выплаты по счёту партнёра / исполнителя",
    invoiceAmount: "Сумма счёта партнёра / исполнителя",
    paid: "Выплачено компанией",
    remaining: "Осталось выплатить партнёру / исполнителю",
    payment: "Записать новую выплату",
    account: "Счёт компании, с которого оплачено",
    amount: "Сумма выплаты",
    date: "Дата выплаты",
    method: "Способ оплаты",
    bankTransfer: "Банковский перевод",
    cash: "Наличные",
    card: "Карта",
    other: "Другой способ",
    reference: "Назначение или номер операции",
    note: "Внутренняя заметка",
    record: "Записать выплату",
    close: "Закрыть",
    history: "История выплат",
    noHistory: "Выплат пока нет",
    paymentOperation: "Выплата",
    reversalOperation: "Отмена выплаты",
    by: "Операцию записал",
    reverse: "Отменить операцию",
    reversalReason: "Причина отмены",
    confirmReversal: "Подтвердить отмену",
    cancel: "Не отменять",
    noAccount: "Нет активного счёта компании в этой валюте.",
    approveFirst: "Сначала подтвердите счёт партнёра / исполнителя в заказе.",
    paidInFull: "Счёт партнёра / исполнителя полностью оплачен.",
    loadFailed: "Не удалось загрузить историю выплат партнёру / исполнителю.",
    saveFailed: "Не удалось записать выплату.",
    reversalFailed: "Не удалось отменить выплату.",
  },
  de: {
    title: "Zahlungen an Partner / Leistungserbringer",
    description: "Teil- und Vollzahlungen einer Rechnung des Partners / Leistungserbringers",
    invoiceAmount: "Rechnungsbetrag des Partners / Leistungserbringers",
    paid: "Vom Unternehmen bezahlt",
    remaining: "Noch an Partner / Leistungserbringer zu zahlen",
    payment: "Neue Zahlung erfassen",
    account: "Unternehmenskonto, von dem bezahlt wurde",
    amount: "Zahlungsbetrag",
    date: "Zahlungsdatum",
    method: "Zahlungsart",
    bankTransfer: "Banküberweisung",
    cash: "Barzahlung",
    card: "Kartenzahlung",
    other: "Andere Zahlungsart",
    reference: "Verwendungszweck oder Referenz",
    note: "Interne Notiz",
    record: "Zahlung erfassen",
    close: "Schließen",
    history: "Zahlungsverlauf",
    noHistory: "Noch keine Zahlungen",
    paymentOperation: "Zahlung",
    reversalOperation: "Stornierung",
    by: "Vorgang erfasst von",
    reverse: "Zahlung stornieren",
    reversalReason: "Stornogrund",
    confirmReversal: "Stornierung bestätigen",
    cancel: "Nicht stornieren",
    noAccount: "Für diese Währung ist kein aktives Unternehmenskonto vorhanden.",
    approveFirst: "Die Rechnung des Partners / Leistungserbringers muss zuerst im Auftrag freigegeben werden.",
    paidInFull: "Die Rechnung des Partners / Leistungserbringers ist vollständig bezahlt.",
    loadFailed: "Der Zahlungsverlauf für den Partner / Leistungserbringer konnte nicht geladen werden.",
    saveFailed: "Die Zahlung konnte nicht erfasst werden.",
    reversalFailed: "Die Zahlung konnte nicht storniert werden.",
  },
} as const;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

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

const paymentFieldClassName = "grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground";
const paymentInputClassName = "h-9 min-w-0 bg-field font-normal text-foreground";

function SettlementSection({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <AdminSectionTitle>{title}</AdminSectionTitle>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ProviderSettlementDialog({
  liability,
  accounts,
  locale,
  onClose,
  onChanged,
}: Props) {
  const { lang } = useLang();
  const text = copy[lang];
  const [settlement, setSettlement] = useState<CompanyProviderSettlement | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    requestId: crypto.randomUUID(),
    accountId: "",
    amount: "",
    paidOn: todayIso(),
    method: "bank_transfer",
    reference: "",
    note: "",
  });
  const [reversal, setReversal] = useState<CompanyProviderPaymentTransaction | null>(null);
  const [reversalBusy, setReversalBusy] = useState(false);
  const [reversalError, setReversalError] = useState<string | null>(null);
  const [reversalForm, setReversalForm] = useState({
    requestId: crypto.randomUUID(),
    paidOn: todayIso(),
    note: "",
  });

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.is_active),
    [accounts],
  );
  const activeAccountsRef = useRef(activeAccounts);
  useEffect(() => { activeAccountsRef.current = activeAccounts; }, [activeAccounts]);
  const initializedIdRef = useRef<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const liabilityId = liability?.id ?? null;
  useFinanceAutoRefresh(() => setReloadToken((current) => current + 1), loading || paymentBusy || reversalBusy, Boolean(liabilityId));

  async function reload(externalInvoiceId: string, forceFresh = false) {
    const result = await fetchCompanyProviderSettlement(externalInvoiceId, forceFresh);
    setSettlement(result);
    return result;
  }

  useEffect(() => {
    if (!liabilityId) {
      initializedIdRef.current = null;
      setSettlement(null);
      setLoadError(null);
      setReversal(null);
      setLoading(false);
      return;
    }
    let active = true;
    const initializeForm = initializedIdRef.current !== liabilityId;
    if (initializeForm) setSettlement(null);
    setLoading(true);
    void fetchCompanyProviderSettlement(liabilityId, true)
      .then((result) => {
        if (!active) return;
        setLoadError(null);
        setSettlement(result);
        if (!initializeForm) return;
        initializedIdRef.current = liabilityId;
        const defaultAccount = activeAccountsRef.current.find((account) => account.is_default)
          ?? activeAccountsRef.current[0];
        setPaymentForm({
          requestId: crypto.randomUUID(),
          accountId: defaultAccount?.id ?? "",
          amount: result.remaining_provider_liability_gross,
          paidOn: todayIso(),
          method: "bank_transfer",
          reference: result.external_invoice_number,
          note: "",
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : text.loadFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [liabilityId, reloadToken, text.loadFailed]);

  const reversedPaymentIds = useMemo(
    () => new Set(
      (settlement?.transactions ?? [])
        .filter((item) => item.transaction_type === "reversal")
        .map((item) => item.reverses_transaction_id)
        .filter((value): value is string => Boolean(value)),
    ),
    [settlement?.transactions],
  );

  async function handlePayment(event: FormEvent) {
    event.preventDefault();
    if (!liability) return;
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      await createCompanyProviderPayment(liability.id, {
        request_id: paymentForm.requestId,
        financial_account_id: paymentForm.accountId,
        amount_gross: paymentForm.amount,
        paid_on: paymentForm.paidOn,
        payment_method: paymentForm.method,
        reference: paymentForm.reference.trim() || null,
        note: paymentForm.note.trim() || null,
      });
      const updated = await reload(liability.id, true);
      setPaymentForm((current) => ({
        ...current,
        requestId: crypto.randomUUID(),
        amount: updated.remaining_provider_liability_gross,
        reference: updated.external_invoice_number,
        note: "",
      }));
      onChanged();
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : text.saveFailed);
    } finally {
      setPaymentBusy(false);
    }
  }

  async function handleReversal(event: FormEvent) {
    event.preventDefault();
    if (!liability || !reversal) return;
    setReversalBusy(true);
    setReversalError(null);
    try {
      await reverseCompanyProviderPayment(liability.id, reversal.id, {
        request_id: reversalForm.requestId,
        paid_on: reversalForm.paidOn,
        note: reversalForm.note.trim() || null,
      });
      const updated = await reload(liability.id, true);
      setPaymentForm((current) => ({
        ...current,
        amount: updated.remaining_provider_liability_gross,
      }));
      setReversal(null);
      setReversalForm({ requestId: crypto.randomUUID(), paidOn: todayIso(), note: "" });
      onChanged();
    } catch (error) {
      setReversalError(error instanceof Error ? error.message : text.reversalFailed);
    } finally {
      setReversalBusy(false);
    }
  }

  const currency = settlement?.currency ?? "EUR";
  const remaining = Number(settlement?.remaining_provider_liability_gross ?? 0);
  const canPay = settlement
    && remaining > 0
    && (settlement.status === "approved" || settlement.status === "overdue")
    && settlement.paid_by !== "patient";

  return (
    <Dialog open={Boolean(liability)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[92dvh] sm:max-w-2xl sm:pb-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border/70 bg-muted/20 px-4 py-3.5 pr-12 sm:px-5 sm:pr-14">
          <DialogTitle className="flex min-w-0 items-start gap-2 text-base"><span aria-hidden className="mt-2 size-2 shrink-0 rounded-full bg-primary" /><span className="min-w-0 break-words">{text.title}</span></DialogTitle>
          <DialogDescription className="break-words text-xs leading-5">
            <span className="font-mono text-foreground">{settlement?.external_invoice_number ?? liability?.external_invoice_number}</span> · {text.description}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 sm:p-5">
        {loadError ? <ShellBanner tone="error">{loadError}</ShellBanner> : null}
        {loading && !settlement ? (
          <div className="flex justify-center py-10"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>
        ) : settlement ? (
          <div className="min-w-0 space-y-3">
            <dl className="grid gap-2 sm:grid-cols-3">
              {([
                [text.invoiceAmount, settlement.amount_gross, "default"],
                [text.paid, settlement.company_paid_gross, "positive"],
                [text.remaining, settlement.remaining_provider_liability_gross, remaining > 0 ? "negative" : "positive"],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className={cn(
                  "flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border/70 border-l-[3px] bg-card px-3 py-2.5 sm:flex-col sm:items-start sm:justify-between sm:gap-1.5",
                  tone === "default" && "border-l-slate-300 dark:border-l-slate-600",
                  tone === "positive" && "border-l-emerald-400 dark:border-l-emerald-500",
                  tone === "negative" && "border-l-rose-400 dark:border-l-rose-500",
                )}>
                  <dt className="min-w-0 break-words text-xs leading-5 text-muted-foreground">{label}</dt>
                  <dd className={cn(
                    "shrink-0 whitespace-nowrap font-mono text-sm font-semibold tabular-nums sm:text-base",
                    tone === "positive" && "text-emerald-700 dark:text-emerald-400",
                    tone === "negative" && "text-rose-700 dark:text-rose-400",
                  )}>{formatMoney(value, currency, locale)}</dd>
                </div>
              ))}
            </dl>

            {canPay ? (
              <SettlementSection title={text.payment}>
              <form onSubmit={handlePayment}>
                <div className="space-y-3 p-3.5">
                {paymentError ? <ShellBanner tone="error">{paymentError}</ShellBanner> : null}
                {activeAccounts.length === 0 ? <ShellBanner tone="warning">{text.noAccount}</ShellBanner> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={paymentFieldClassName}>
                    <span>{text.account}</span>
                    <select className={cn(shellSelectClassName, paymentInputClassName, "w-full text-sm")} required value={paymentForm.accountId} onChange={(event) => setPaymentForm((current) => ({ ...current, accountId: event.target.value }))}>
                      {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {formatMoney(account.current_balance, account.currency, locale)}</option>)}
                    </select>
                  </label>
                  <label className={paymentFieldClassName}><span>{text.amount}</span><Input className={paymentInputClassName} required inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                  <label className={paymentFieldClassName}><span>{text.date}</span><Input className={paymentInputClassName} required type="date" max={todayIso()} value={paymentForm.paidOn} onChange={(event) => setPaymentForm((current) => ({ ...current, paidOn: event.target.value }))} /></label>
                  <label className={paymentFieldClassName}>
                    <span>{text.method}</span>
                    <select className={cn(shellSelectClassName, paymentInputClassName, "w-full text-sm")} value={paymentForm.method} onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value }))}>
                      <option value="bank_transfer">{text.bankTransfer}</option>
                      <option value="cash">{text.cash}</option>
                      <option value="card">{text.card}</option>
                      <option value="other">{text.other}</option>
                    </select>
                  </label>
                </div>
                <label className={paymentFieldClassName}><span>{text.reference}</span><Input className={paymentInputClassName} maxLength={200} value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} /></label>
                <label className={paymentFieldClassName}><span>{text.note}</span><Input className={paymentInputClassName} maxLength={1000} value={paymentForm.note} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} /></label>
                </div>
                <div className="flex justify-stretch border-t border-border/60 bg-muted/20 px-3.5 py-3 sm:justify-end">
                  <Button type="submit" size="sm" className="h-9 w-full rounded-md sm:h-8 sm:w-auto" disabled={loading || paymentBusy || Boolean(loadError) || !activeAccounts.some((account) => account.id === paymentForm.accountId) || Number(paymentForm.amount) <= 0 || Number(paymentForm.amount) > remaining}>
                    {paymentBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{text.record}
                  </Button>
                </div>
              </form>
              </SettlementSection>
            ) : settlement.status === "expected" || settlement.status === "received" ? (
              <ShellBanner tone="warning">{text.approveFirst}</ShellBanner>
            ) : remaining <= 0 ? (
              <div role="status" className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" /><p>{text.paidInFull}</p></div>
            ) : null}

            <SettlementSection title={text.history} action={<Badge variant="secondary">{(settlement.transactions ?? []).length}</Badge>}>
              {(settlement.transactions ?? []).length === 0 ? (
                <p className="px-3.5 py-6 text-center text-xs text-muted-foreground">{text.noHistory}</p>
              ) : (
                <div className="divide-y divide-border/60">
                  {settlement.transactions.map((item) => {
                    const isReversal = item.transaction_type === "reversal";
                    const isReversed = !isReversal && reversedPaymentIds.has(item.id);
                    return (
                      <article key={item.id} className="min-w-0 p-3.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={isReversal ? "outline" : "secondary"} className="whitespace-normal text-[10px]">{isReversal ? text.reversalOperation : text.paymentOperation}</Badge>
                              <span className="text-xs text-muted-foreground">{formatDate(item.paid_on, locale)}</span>
                            </div>
                          </div>
                          <p className={cn("shrink-0 whitespace-nowrap font-mono text-sm font-semibold tabular-nums", isReversal ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{isReversal ? "+" : "−"} {formatMoney(item.amount_gross, item.currency, locale)}</p>
                        </div>
                        <p className="mt-1.5 break-words text-xs leading-5">{item.financial_account_name}</p>
                        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{item.reference || item.note || "—"}</p>
                        <p className="mt-1 break-words text-[11px] leading-5 text-muted-foreground">{text.by}: {item.created_by_name}</p>
                        {!isReversal && !isReversed ? <div className="mt-2 flex justify-end"><Button type="button" size="sm" variant="ghost" className="h-8 rounded-md text-xs text-muted-foreground hover:text-destructive" onClick={() => { setReversalError(null); setReversal(item); setReversalForm({ requestId: crypto.randomUUID(), paidOn: todayIso(), note: "" }); }}><Undo2 className="size-3.5" />{text.reverse}</Button></div> : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </SettlementSection>

            {reversal ? (
              <SettlementSection title={text.reverse} action={<Badge variant="outline" className="text-rose-700 dark:text-rose-400">{formatMoney(reversal.amount_gross, reversal.currency, locale)}</Badge>}>
              <form onSubmit={handleReversal}>
                <div className="space-y-3 p-3.5">
                {reversalError ? <ShellBanner tone="error">{reversalError}</ShellBanner> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className={paymentFieldClassName}><span>{text.date}</span><Input className={paymentInputClassName} required type="date" min={reversal.paid_on} max={todayIso()} value={reversalForm.paidOn} onChange={(event) => setReversalForm((current) => ({ ...current, paidOn: event.target.value }))} /></label>
                  <label className={paymentFieldClassName}><span>{text.reversalReason}</span><Input className={paymentInputClassName} required maxLength={1000} value={reversalForm.note} onChange={(event) => setReversalForm((current) => ({ ...current, note: event.target.value }))} /></label>
                </div>
                </div>
                <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-3 sm:flex-row sm:flex-wrap sm:justify-end"><Button type="button" variant="outline" size="sm" className="h-9 rounded-md sm:h-8" onClick={() => setReversal(null)}>{text.cancel}</Button><Button type="submit" variant="destructive" size="sm" className="h-9 rounded-md sm:h-8" disabled={reversalBusy || !reversalForm.note.trim()}>{reversalBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{text.confirmReversal}</Button></div>
              </form>
              </SettlementSection>
            ) : null}

          </div>
        ) : null}
        </div>
        <div className="flex shrink-0 justify-end border-t border-border/70 bg-muted/20 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5"><Button type="button" variant="outline" size="sm" className="h-9 w-full rounded-md sm:h-8 sm:w-auto" onClick={onClose}>{text.close}</Button></div>
      </DialogContent>
    </Dialog>
  );
}
