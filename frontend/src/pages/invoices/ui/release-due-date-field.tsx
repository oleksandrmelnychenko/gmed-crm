import type React from "react";
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

const pillButtonClass =
  "mt-1 inline-flex cursor-pointer rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed";

/**
 * «Оплатить до» of a draft: empty by default, the release then sets the
 * invoice date + payment term (shown under the field for a release today); a
 * typed date stays and is marked when it gives less than the term. A pill
 * sets that date itself (QA3: it opened the calendar, and the next click
 * picked another day).
 */
export function ReleaseDueDateField({ value, onChange, termDays, ariaLabel, disabled, className }: Props) {
  const { lang } = useLang();
  const de = lang === "de";
  const state = releaseDueDateState(value, new Date(), termDays);
  const shown = formatAppDate(state.defaultDate);
  const setTermDate = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onChange(state.defaultDate);
  };
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
        <button type="button" className={pillButtonClass} disabled={disabled} onClick={setTermDate}>
          <StatusChip tone="neutral" className="font-mono text-[11px] tabular-nums" data-testid="release-due-date-default">
            {de ? `+${state.termDays} Tage · ${shown}` : `+${state.termDays} дней · ${shown}`}
          </StatusChip>
        </button>
      ) : state.shorterThanTerm ? (
        <button type="button" className={pillButtonClass} disabled={disabled} onClick={setTermDate}>
          <StatusChip tone="warning" className="text-[11px] tabular-nums" data-testid="release-due-date-short">
            <CircleAlert aria-hidden />
            {de ? `Unter ${state.termDays} Tagen · ${shown}` : `Меньше ${state.termDays} дней · ${shown}`}
          </StatusChip>
        </button>
      ) : null}
    </>
  );
}
