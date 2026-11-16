import { Input } from "@/components/ui/input";
import { formatAppDate } from "@/lib/app-time-zone";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { releaseDueDateState } from "../model/invoice-model";

type Props = {
  value: string;
  onChange: (value: string) => void;
  termDays?: number;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * «Оплатить до» of a draft: empty by default, the release then sets the
 * invoice date + payment term (shown under the field for a release today); a
 * typed date stays and is marked when it gives less than the term.
 */
export function ReleaseDueDateField({ value, onChange, termDays, ariaLabel, disabled, className }: Props) {
  const { lang } = useLang();
  const de = lang === "de";
  const state = releaseDueDateState(value, new Date(), termDays);
  const shown = formatAppDate(state.defaultDate);
  return (
    <>
      <Input
        type="date"
        aria-label={ariaLabel}
        disabled={disabled}
        value={value}
        data-testid="release-due-date"
        data-short-term={state.shorterThanTerm ? "true" : undefined}
        className={cn(className, state.shorterThanTerm && "border-amber-400 bg-amber-50 dark:bg-amber-950/20")}
        onChange={(event) => onChange(event.target.value)}
      />
      {state.empty ? (
        <span className="block text-xs text-muted-foreground" data-testid="release-due-date-default">
          {de ? `+${state.termDays} Tage ab Ausstellung (${shown})` : `+${state.termDays} дней от выставления (${shown})`}
        </span>
      ) : state.shorterThanTerm ? (
        <span className="block text-xs text-amber-700 dark:text-amber-300" data-testid="release-due-date-short">
          {de ? `Weniger als ${state.termDays} Tage ab heute (${shown})` : `Меньше ${state.termDays} дней от сегодня (${shown})`}
        </span>
      ) : null}
    </>
  );
}
