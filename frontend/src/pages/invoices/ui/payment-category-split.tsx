import { Input } from "@/components/ui/input";
import { checkboxClass, inputClass, tokens } from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import {
  categoryKey,
  categoryLabel,
  openCategories,
  paymentSplitProblem,
  proRataSplit,
  type PaymentSplitValues,
} from "../model/payment-split";
import type { AdvanceCategory } from "../model/types";

type Props = {
  lang: string;
  categories: AdvanceCategory[];
  amount: number;
  /** `null`: pro rata (the default); otherwise the parts set by hand. */
  value: PaymentSplitValues | null;
  disabled?: boolean;
  onChange: (value: PaymentSplitValues | null) => void;
};

/** «Распределить вручную»: the VAT split of a part payment on an advance. */
export function PaymentCategorySplit({ lang, categories, amount, value, disabled, onChange }: Props) {
  const de = lang === "de";
  const problem = value ? paymentSplitProblem(categories, amount, value, lang) : null;
  return (
    <div className="grid gap-2 sm:col-span-2" data-testid="payment-category-split">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={value !== null}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked ? proRataSplit(categories, amount) : null)}
        />
        {de ? "Manuell aufteilen" : "Распределить вручную"}
      </label>
      {value ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {openCategories(categories).map((category) => {
            const key = categoryKey(category);
            return (
              <label key={key} className="flex flex-col gap-1.5">
                <span className={tokens.text.label}>{categoryLabel(category, lang)}</span>
                <Input
                  inputMode="decimal"
                  className={inputClass}
                  value={value[key] ?? ""}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...value, [key]: event.target.value })}
                />
              </label>
            );
          })}
          {problem ? (
            <p role="alert" className={cn("text-xs text-destructive sm:col-span-2")}>{problem}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
