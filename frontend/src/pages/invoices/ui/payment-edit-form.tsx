import { useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass, tokens } from "@/components/ui-shell";
import { hasFormChanges } from "@/lib/form-changes";
import { cn } from "@/lib/utils";

import {
  INVOICE_PAYMENT_METHODS,
  buildPaymentCorrectionPayload,
  paymentCorrectionProblem,
  type PaymentCorrectionForm,
} from "../model/payment-correction";
import type { InvoicePaymentTransaction } from "../model/types";

type PaymentEditFormProps = {
  lang: string;
  payment: InvoicePaymentTransaction;
  /** Highest amount the corrected payment may carry: open balance plus this payment. */
  maxAmount: number;
  methodLabels: Record<string, string>;
  busy: boolean;
  cancelLabel: string;
  onCancel: () => void;
  /** Reports whether the correction differs from the recorded payment. */
  onDirtyChange?: (dirty: boolean) => void;
  onSubmit: (payload: ReturnType<typeof buildPaymentCorrectionPayload>) => void;
};

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

export function PaymentEditForm({
  lang,
  payment,
  maxAmount,
  methodLabels,
  busy,
  cancelLabel,
  onCancel,
  onDirtyChange,
  onSubmit,
}: PaymentEditFormProps) {
  const de = lang === "de";
  const [initialForm] = useState<PaymentCorrectionForm>(() => ({
    requestId: crypto.randomUUID(),
    amountGross: String(payment.amount_gross ?? ""),
    paymentMethod: payment.payment_method,
    paymentReference: payment.payment_reference ?? "",
    receivedOn: payment.received_on,
    note: payment.note ?? "",
    reason: "",
  }));
  const [form, setForm] = useState<PaymentCorrectionForm>(initialForm);
  const problem = paymentCorrectionProblem(form, payment, maxAmount);
  const set = (patch: Partial<PaymentCorrectionForm>) => {
    const next = { ...form, ...patch };
    setForm(next);
    onDirtyChange?.(hasFormChanges(next, initialForm));
  };

  return (
    <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
      <p className="text-xs text-muted-foreground">
        {de
          ? "Die ursprüngliche Zahlung wird storniert und mit den korrigierten Angaben neu erfasst. Beide Buchungen bleiben im Journal."
          : "Исходный платёж сторнируется и записывается заново с исправленными данными. Обе записи остаются в журнале."}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={de ? "Eingang brutto" : "Сумма брутто"}>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            max={String(maxAmount)}
            value={form.amountGross}
            onChange={(event) => set({ amountGross: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={de ? "Zahlungsart" : "Способ оплаты"}>
          <NativeComboboxSelect
            value={form.paymentMethod}
            onChange={(event) => set({ paymentMethod: event.target.value })}
            className={selectClass}
          >
            {INVOICE_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {methodLabels[method] ?? method}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
        <Field label={de ? "Eingangsdatum" : "Дата поступления"}>
          <Input
            type="date"
            max={new Date().toISOString().slice(0, 10)}
            value={form.receivedOn}
            onChange={(event) => set({ receivedOn: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={de ? "Referenz" : "Референс"}>
          <Input
            value={form.paymentReference}
            onChange={(event) => set({ paymentReference: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={de ? "Interne Notiz" : "Внутренняя заметка"} className="sm:col-span-2">
          <Input
            value={form.note}
            onChange={(event) => set({ note: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label={de ? "Grund der Korrektur" : "Причина исправления"} className="sm:col-span-2 lg:col-span-3">
          <Input
            value={form.reason}
            onChange={(event) => set({ reason: event.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          type="button"
          disabled={busy || problem !== null}
          onClick={() => onSubmit(buildPaymentCorrectionPayload(form))}
        >
          {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
          {de ? "Korrektur speichern" : "Сохранить исправление"}
        </Button>
      </div>
    </div>
  );
}
