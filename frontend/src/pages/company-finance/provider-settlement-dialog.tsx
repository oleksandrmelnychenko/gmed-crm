import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { LoaderCircle, Undo2 } from "lucide-react";

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
  SuccessBanner as ShellSuccessBanner,
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
      <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-h-[92vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{text.title}</DialogTitle>
          <DialogDescription>
            {settlement?.external_invoice_number ?? liability?.external_invoice_number} · {text.description}
          </DialogDescription>
        </DialogHeader>

        {loadError ? <ShellBanner tone="error">{loadError}</ShellBanner> : null}
        {loading && !settlement ? (
          <div className="flex justify-center py-10"><LoaderCircle className="size-5 animate-spin text-muted-foreground" /></div>
        ) : settlement ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {([
                [text.invoiceAmount, settlement.amount_gross, "default"],
                [text.paid, settlement.company_paid_gross, "positive"],
                [text.remaining, settlement.remaining_provider_liability_gross, remaining > 0 ? "negative" : "positive"],
              ] as const).map(([label, value, tone]) => (
                <div key={label} className="min-w-0 rounded-lg border border-border/70 bg-muted/20 p-2 sm:p-3">
                  <dt className="line-clamp-2 min-h-7 text-[10px] leading-3.5 text-muted-foreground sm:min-h-0 sm:text-xs">{label}</dt>
                  <dd className={cn(
                    "mt-1 truncate text-xs font-semibold tabular-nums sm:text-lg",
                    tone === "positive" && "text-emerald-700 dark:text-emerald-400",
                    tone === "negative" && "text-rose-700 dark:text-rose-400",
                  )}>{formatMoney(value, currency, locale)}</dd>
                </div>
              ))}
            </dl>

            {canPay ? (
              <form className="space-y-3 rounded-lg border border-border/70 p-3" onSubmit={handlePayment}>
                <h3 className="text-sm font-semibold">{text.payment}</h3>
                {paymentError ? <ShellBanner tone="error">{paymentError}</ShellBanner> : null}
                {activeAccounts.length === 0 ? <ShellBanner tone="warning">{text.noAccount}</ShellBanner> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5 text-sm">
                    <span>{text.account}</span>
                    <select className={shellSelectClassName} required value={paymentForm.accountId} onChange={(event) => setPaymentForm((current) => ({ ...current, accountId: event.target.value }))}>
                      {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.name} · {formatMoney(account.current_balance, account.currency, locale)}</option>)}
                    </select>
                  </label>
                  <label className="block space-y-1.5 text-sm"><span>{text.amount}</span><Input required inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm((current) => ({ ...current, amount: event.target.value }))} /></label>
                  <label className="block space-y-1.5 text-sm"><span>{text.date}</span><Input required type="date" max={todayIso()} value={paymentForm.paidOn} onChange={(event) => setPaymentForm((current) => ({ ...current, paidOn: event.target.value }))} /></label>
                  <label className="block space-y-1.5 text-sm">
                    <span>{text.method}</span>
                    <select className={shellSelectClassName} value={paymentForm.method} onChange={(event) => setPaymentForm((current) => ({ ...current, method: event.target.value }))}>
                      <option value="bank_transfer">{text.bankTransfer}</option>
                      <option value="cash">{text.cash}</option>
                      <option value="card">{text.card}</option>
                      <option value="other">{text.other}</option>
                    </select>
                  </label>
                </div>
                <label className="block space-y-1.5 text-sm"><span>{text.reference}</span><Input maxLength={200} value={paymentForm.reference} onChange={(event) => setPaymentForm((current) => ({ ...current, reference: event.target.value }))} /></label>
                <label className="block space-y-1.5 text-sm"><span>{text.note}</span><Input maxLength={1000} value={paymentForm.note} onChange={(event) => setPaymentForm((current) => ({ ...current, note: event.target.value }))} /></label>
                <div className="flex justify-stretch sm:justify-end">
                  <Button type="submit" className="w-full sm:w-auto" disabled={loading || paymentBusy || Boolean(loadError) || !activeAccounts.some((account) => account.id === paymentForm.accountId) || Number(paymentForm.amount) <= 0 || Number(paymentForm.amount) > remaining}>
                    {paymentBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{text.record}
                  </Button>
                </div>
              </form>
            ) : settlement.status === "expected" || settlement.status === "received" ? (
              <ShellBanner tone="warning">{text.approveFirst}</ShellBanner>
            ) : remaining <= 0 ? (
              <ShellSuccessBanner>{text.paidInFull}</ShellSuccessBanner>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{text.history}</h3>
              {(settlement.transactions ?? []).length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">{text.noHistory}</p>
              ) : (
                <div className="space-y-2">
                  {settlement.transactions.map((item) => {
                    const isReversal = item.transaction_type === "reversal";
                    const isReversed = !isReversal && reversedPaymentIds.has(item.id);
                    return (
                      <article key={item.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant={isReversal ? "outline" : "secondary"}>{isReversal ? text.reversalOperation : text.paymentOperation}</Badge>
                              <span className="text-xs text-muted-foreground">{formatDate(item.paid_on, locale)} · {item.financial_account_name}</span>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{item.reference || item.note || "—"}</p>
                            <p className="mt-1 text-[11px] text-muted-foreground">{text.by}: {item.created_by_name}</p>
                          </div>
                          <div className="text-right">
                            <p className={cn("font-semibold tabular-nums", isReversal ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400")}>{isReversal ? "+" : "−"} {formatMoney(item.amount_gross, item.currency, locale)}</p>
                            {!isReversal && !isReversed ? <Button type="button" size="xs" variant="ghost" className="mt-1" onClick={() => { setReversalError(null); setReversal(item); setReversalForm({ requestId: crypto.randomUUID(), paidOn: todayIso(), note: "" }); }}><Undo2 className="size-3.5" />{text.reverse}</Button> : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {reversal ? (
              <form className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-500/30 dark:bg-rose-500/5" onSubmit={handleReversal}>
                <h3 className="text-sm font-semibold">{text.reverse}: {formatMoney(reversal.amount_gross, reversal.currency, locale)}</h3>
                {reversalError ? <ShellBanner tone="error">{reversalError}</ShellBanner> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1.5 text-sm"><span>{text.date}</span><Input required type="date" min={reversal.paid_on} max={todayIso()} value={reversalForm.paidOn} onChange={(event) => setReversalForm((current) => ({ ...current, paidOn: event.target.value }))} /></label>
                  <label className="block space-y-1.5 text-sm"><span>{text.reversalReason}</span><Input required maxLength={1000} value={reversalForm.note} onChange={(event) => setReversalForm((current) => ({ ...current, note: event.target.value }))} /></label>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end"><Button type="button" variant="outline" onClick={() => setReversal(null)}>{text.cancel}</Button><Button type="submit" variant="destructive" disabled={reversalBusy || !reversalForm.note.trim()}>{reversalBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{text.confirmReversal}</Button></div>
              </form>
            ) : null}

            <div className="flex justify-stretch sm:justify-end"><Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>{text.close}</Button></div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
