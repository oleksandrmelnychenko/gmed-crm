import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Banner, StatusBadge, inputClass, selectClass, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount, toCents } from "@/lib/money";
import { cn } from "@/lib/utils";

import { createCreditTransfer, reverseCreditTransfer } from "../data/invoice-api";
import {
  creditTransferDefaultAmount,
  creditTransferProblem,
  type CreditTransferProblem,
  type InvoiceCreditTransfer,
  type InvoiceCreditTransferTarget,
} from "../model/overpayment";

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

const PROBLEM_KEYS = {
  invalid_amount: "finance_credit_transfer_error_invalid_amount",
  exceeds_credit: "finance_credit_transfer_error_exceeds_credit",
  exceeds_target: "finance_credit_transfer_error_exceeds_target",
  no_target: "finance_credit_transfer_error_no_target",
} as const satisfies Record<CreditTransferProblem, string>;

type CreditBalancePanelProps = {
  invoiceId: string;
  currency: string;
  /** Cash beyond what the invoice asks for (overpayment or unrefunded credit note). */
  creditBalance: unknown;
  transfers: InvoiceCreditTransfer[] | undefined;
  targets: InvoiceCreditTransferTarget[] | undefined;
  canManage: boolean;
  released: boolean;
  onChanged: () => void;
};

/**
 * The patient's credit balance on an invoice and its moves to other open
 * invoices of the patient. Refunds of the credit stay in the refund section.
 */
export function CreditBalancePanel({
  invoiceId,
  currency,
  creditBalance,
  transfers,
  targets,
  canManage,
  released,
  onChanged,
}: CreditBalancePanelProps) {
  const { t } = useLang();
  const money = (value: unknown) => formatMoneyAmount(value, currency);
  const credit = Number(creditBalance ?? 0);
  const openTargets = useMemo(() => targets ?? [], [targets]);
  const [targetId, setTargetId] = useState("");
  const [amountGross, setAmountGross] = useState("");
  const [transferredOn, setTransferredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState("");
  const [reversalReason, setReversalReason] = useState("");

  const target = openTargets.find((item) => item.invoice_id === targetId);
  useEffect(() => {
    const first = openTargets[0];
    setTargetId(first?.invoice_id ?? "");
    setAmountGross(first ? creditTransferDefaultAmount(creditBalance, first.balance_due) : "");
  }, [creditBalance, openTargets]);

  const problem = creditTransferProblem(amountGross, creditBalance, target?.balance_due);
  const hasCredit = toCents(credit) > 0;
  if (!hasCredit && !(transfers?.length)) return null;

  async function submit() {
    if (problem || !target) return;
    setBusy(true);
    setError(null);
    try {
      await createCreditTransfer(invoiceId, {
        request_id: requestId,
        target_invoice_id: target.invoice_id,
        amount_gross: amountGross,
        transferred_on: transferredOn,
        note: note.trim() || null,
      });
      setRequestId(crypto.randomUUID());
      setNote("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.common_error);
    } finally {
      setBusy(false);
    }
  }

  async function reverse(transferId: string) {
    if (!reversalReason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await reverseCreditTransfer(invoiceId, transferId, { reason: reversalReason.trim() });
      setReversingId("");
      setReversalReason("");
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.common_error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {hasCredit ? (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2">
          <p className="max-w-2xl text-sm text-muted-foreground">{t.finance_credit_balance_description}</p>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{t.finance_credit_balance_amount}</div>
            <div className="font-mono font-semibold tabular-nums text-emerald-700">{money(credit)}</div>
          </div>
        </div>
      ) : null}

      {hasCredit && canManage && released ? (
        openTargets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
            {t.finance_credit_transfer_no_targets}
          </div>
        ) : (
          <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t.finance_credit_transfer_target} className="sm:col-span-2 lg:col-span-3">
              <NativeComboboxSelect
                value={targetId}
                onChange={(event) => {
                  const next = openTargets.find((item) => item.invoice_id === event.target.value);
                  setTargetId(event.target.value);
                  setAmountGross(next ? creditTransferDefaultAmount(creditBalance, next.balance_due) : "");
                }}
                className={selectClass}
              >
                {openTargets.map((item) => (
                  <option key={item.invoice_id} value={item.invoice_id}>
                    {t.finance_credit_transfer_target_option
                      .replace("{number}", item.invoice_number)
                      .replace("{order}", item.order_number ?? "—")
                      .replace("{amount}", money(item.balance_due))}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field label={t.finance_credit_transfer_amount}>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={amountGross}
                onChange={(event) => setAmountGross(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label={t.finance_credit_transfer_date}>
              <Input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={transferredOn}
                onChange={(event) => setTransferredOn(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label={t.finance_credit_transfer_note}>
              <Input value={note} onChange={(event) => setNote(event.target.value)} className={inputClass} />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-2 lg:col-span-3">
              <span className="text-sm text-rose-700" aria-live="polite">
                {problem && amountGross ? t[PROBLEM_KEYS[problem]] : null}
              </span>
              <Button type="button" disabled={busy || problem !== null || !transferredOn} onClick={() => void submit()}>
                {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {t.finance_credit_transfer_submit}
              </Button>
            </div>
          </div>
        )
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}

      {transfers?.length ? (
        <div className="space-y-2">
          <div className={tokens.text.label}>{t.finance_credit_transfer_history_title}</div>
          {transfers.map((transfer) => (
            <div
              key={transfer.id}
              className={cn(
                "rounded-lg border border-border/70 bg-background/70 p-3",
                transfer.is_reversed && "opacity-70",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                    {transfer.direction === "out"
                      ? t.finance_credit_transfer_out.replace("{number}", transfer.target_invoice_number)
                      : t.finance_credit_transfer_in.replace("{number}", transfer.source_invoice_number)}
                    {transfer.is_reversed ? (
                      <StatusBadge tone="neutral">{t.finance_credit_transfer_reversed}</StatusBadge>
                    ) : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {transfer.transferred_on} · {transfer.created_by_name}
                    {transfer.note ? ` · ${transfer.note}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold tabular-nums text-foreground">
                    {transfer.direction === "out" ? "−" : "+"}
                    {money(transfer.amount_gross)}
                  </div>
                  {canManage && !transfer.is_reversed ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-1 h-7 px-2 text-xs"
                      onClick={() => {
                        setReversingId(transfer.id);
                        setReversalReason("");
                      }}
                    >
                      {t.finance_credit_transfer_reverse}
                    </Button>
                  ) : null}
                </div>
              </div>
              {reversingId === transfer.id ? (
                <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row">
                  <Input
                    value={reversalReason}
                    onChange={(event) => setReversalReason(event.target.value)}
                    placeholder={t.finance_credit_transfer_reversal_reason}
                    className={inputClass}
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => setReversingId("")}>
                      {t.common_cancel}
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || !reversalReason.trim()}
                      onClick={() => void reverse(transfer.id)}
                    >
                      {t.finance_credit_transfer_reverse}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
