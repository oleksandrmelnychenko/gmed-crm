import * as React from "react";

import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";
import { moneyInputMessage, moneyInputProblem } from "@/lib/money";
import { cn } from "@/lib/utils";

type MoneyInputProps = Omit<React.ComponentProps<typeof Input>, "type" | "inputMode" | "min" | "step" | "value"> & {
  value: string;
  /** 0,00 is a valid amount here (a price, an opening balance). */
  allowZero?: boolean;
  allowNegative?: boolean;
  /** The form shows its own message for the problem; the field only marks it. */
  hideMessage?: boolean;
  messageClassName?: string;
};

/**
 * The one money field of the app (owner 2026-11-11, German money format
 * everywhere; the payout field since QA D3-02): typed as "1.234,56",
 * "1234,56" or "1234.56". An amount that cannot be read, or zero/negative
 * where the field does not allow it, is named under the field and blocks the
 * form like a number field did. The form parses the value before sending
 * (`parseMoneyInput` / `moneyInputPayload`), so the server gets the same
 * number as before.
 */
export function MoneyInput({
  value,
  allowZero = false,
  allowNegative = false,
  hideMessage = false,
  messageClassName,
  className,
  ref,
  "aria-invalid": ariaInvalid,
  ...props
}: MoneyInputProps) {
  const { lang } = useLang();
  const problem = moneyInputProblem(value, { allowZero, allowNegative });
  const message = problem ? moneyInputMessage(problem, lang) : "";
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    inputRef.current?.setCustomValidity(message);
  }, [message]);

  const setRef = (element: HTMLInputElement | null) => {
    inputRef.current = element;
    if (typeof ref === "function") ref(element);
    else if (ref) (ref as React.RefObject<HTMLInputElement | null>).current = element;
  };

  return (
    <>
      <Input
        {...props}
        ref={setRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={problem ? true : ariaInvalid}
        className={cn("tabular-nums", className)}
      />
      {problem && !hideMessage ? (
        <span role="alert" data-testid="money-input-error" className={cn("block text-xs font-normal text-rose-700 dark:text-rose-400", messageClassName)}>
          {message}
        </span>
      ) : null}
    </>
  );
}
