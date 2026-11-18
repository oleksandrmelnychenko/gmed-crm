import { CircleAlert } from "lucide-react";

import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
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
        <StatusChip tone="neutral" className="mt-1 font-mono text-[11px] tabular-nums" data-testid="release-due-date-default">
          {de ? `+${state.termDays} Tage · ${shown}` : `+${state.termDays} дней · ${shown}`}
        </StatusChip>
      ) : state.shorterThanTerm ? (
        <StatusChip tone="warning" className="mt-1 text-[11px] tabular-nums" data-testid="release-due-date-short">
          <CircleAlert aria-hidden />
          {de ? `Unter ${state.termDays} Tagen · ${shown}` : `Меньше ${state.termDays} дней · ${shown}`}
        </StatusChip>
      ) : null}
    </>
  );
}
