import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Field, checkboxClass } from "@/components/ui-shell";
import { appDateKeyOf } from "@/lib/app-time-zone";

import type { OrderPrepaymentTerms } from "../model/order-prepayment";

/** Required prepayment of an order: flag, amount in EUR and due date. */
export function OrderPrepaymentFields({
  value,
  maxAmount,
  lang,
  hint,
  onChange,
}: {
  value: OrderPrepaymentTerms;
  /** The order total the amount may not exceed, when it is known. */
  maxAmount?: number;
  lang: "de" | "ru";
  hint?: ReactNode;
  onChange: (patch: Partial<OrderPrepaymentTerms>) => void;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const amountLabel = tx("Сумма предоплаты, EUR", "Vorauszahlung, EUR");
  return (
    <>
      <label className="flex items-center gap-2 text-xs font-medium">
        <input
          className={checkboxClass}
          type="checkbox"
          checked={value.prepayment_required}
          onChange={(event) => onChange({ prepayment_required: event.target.checked })}
        />
        {tx("Предоплата предусмотрена", "Vorauszahlung vorgesehen")}
      </label>
      {value.prepayment_required ? (
        <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-2">
          <Field label={amountLabel}>
            <Input
              aria-label={amountLabel}
              type="number"
              min="0"
              max={maxAmount}
              step="0.01"
              value={value.prepayment_amount}
              onChange={(event) => onChange({ prepayment_amount: event.target.value })}
            />
          </Field>
          <Field label={tx("Срок оплаты", "Zahlungsfrist")}>
            <Input
              type="date"
              value={appDateKeyOf(value.prepayment_due_at)}
              onChange={(event) =>
                onChange({
                  prepayment_due_at: event.target.value
                    ? `${event.target.value}T12:00:00Z`
                    : null,
                })
              }
            />
          </Field>
          {hint ? <p className="text-xs text-muted-foreground sm:col-span-2">{hint}</p> : null}
        </div>
      ) : null}
    </>
  );
}
