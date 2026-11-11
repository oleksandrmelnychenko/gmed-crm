import { useContext, useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";

import { appDateKey } from "@/lib/app-time-zone";

import { AutosaveFlushContext, StepRefusedEntryContext, type AutosaveFlush } from "./lead-request-parts";

// A date field of the cabinet takes complete, allowed dates only: a date that does not exist
// (31.02.), an unfinished one or one outside the field's range never reaches the form. The field
// then said nothing, or "required" (QA 2026-11-10, finding 4). The field now says what is wrong.

type DateRefusalText = {
  invalid: string;
  future: string;
  past: string;
  after: (date: string) => string;
  before: (date: string) => string;
};

const TEXT: Record<"de" | "ru" | "uk" | "en", DateRefusalText> = {
  de: {
    invalid: "Dieses Datum gibt es nicht oder es ist unvollständig. Bitte prüfen Sie Tag, Monat und Jahr.",
    future: "Das Datum darf nicht in der Zukunft liegen.",
    past: "Das Datum darf nicht in der Vergangenheit liegen.",
    after: (date) => `Das Datum darf nicht nach dem ${date} liegen.`,
    before: (date) => `Das Datum darf nicht vor dem ${date} liegen.`,
  },
  ru: {
    invalid: "Такой даты нет, или дата введена не полностью. Проверьте день, месяц и год.",
    future: "Дата не может быть в будущем.",
    past: "Дата не может быть в прошлом.",
    after: (date) => `Дата не может быть позже ${date}.`,
    before: (date) => `Дата не может быть раньше ${date}.`,
  },
  uk: {
    invalid: "Такої дати немає, або дату введено не повністю. Перевірте день, місяць і рік.",
    future: "Дата не може бути в майбутньому.",
    past: "Дата не може бути в минулому.",
    after: (date) => `Дата не може бути пізніше ніж ${date}.`,
    before: (date) => `Дата не може бути раніше ніж ${date}.`,
  },
  en: {
    invalid: "This date does not exist or is incomplete. Please check the day, month and year.",
    future: "The date cannot be in the future.",
    past: "The date cannot be in the past.",
    after: (date) => `The date cannot be later than ${date}.`,
    before: (date) => `The date cannot be earlier than ${date}.`,
  },
};

function textOf(lang: string): DateRefusalText {
  return lang === "de" || lang === "uk" || lang === "en" ? TEXT[lang] : TEXT.ru;
}

/** "2026-11-10" as "10.11.2026". */
function shown(dateKey: string): string {
  const [year, month, day] = dateKey.split("-");
  return year && month && day ? `${day}.${month}.${year}` : dateKey;
}

export type DateLimits = { min?: string; max?: string };

/** Where a date is typed: its day, month and year, and the list holding them (MUI pickers). */
const DATE_SECTIONS = '[role="spinbutton"], .MuiPickersSectionList-root';

/**
 * Why a typed date is not taken, in words: `reason` is the picker's own ("minDate", "maxDate",
 * "invalidDate", …); the field's limits say which date is the first or last allowed one.
 */
export function dateRefusalMessage(lang: string, reason: string, limits: DateLimits = {}, today: string = appDateKey()): string {
  const text = textOf(lang);
  if (reason === "maxDate" || reason === "disableFuture") {
    return !limits.max || limits.max === today ? text.future : text.after(shown(limits.max));
  }
  if (reason === "minDate" || reason === "disablePast") {
    return !limits.min || limits.min === today ? text.past : text.before(shown(limits.min));
  }
  return text.invalid;
}

/**
 * The same sentence for a stored or typed date value the server would refuse for its range
 * (a date of issue in the future): undefined while the value is inside the limits.
 */
export function dateRangeMessage(lang: string, value: string, limits: DateLimits, today: string = appDateKey()): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  if (limits.max && value > limits.max) return dateRefusalMessage(lang, "maxDate", limits, today);
  if (limits.min && value < limits.min) return dateRefusalMessage(lang, "minDate", limits, today);
  return undefined;
}

/**
 * One date field's refusal: `message` once the person left the field (or tried to leave the step)
 * with a date the field did not take, `onPickerValidation` for the `Input`, and `wrap` around the
 * `Input` (it notices when the field is left). While such a date is on screen the step is not left: what is
 * shown would silently not be saved.
 */
/**
 * `useDateRefusal` for a date field of a component that renders its step's frame itself: the
 * hook then runs inside the frame, where it can tell the step that an entry is refused (called
 * above the frame, the first step kept saying "saved" next to the refused date of birth —
 * release QA 2026-11-11).
 */
export function DateRefusal({
  lang,
  value,
  limits,
  children,
}: {
  lang: string;
  value: string;
  limits?: DateLimits;
  children: (refusal: ReturnType<typeof useDateRefusal>) => ReactNode;
}) {
  return <>{children(useDateRefusal(lang, value, limits))}</>;
}

export function useDateRefusal(lang: string, value: string, limits: DateLimits = {}) {
  const [reason, setReason] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const reasonRef = useRef(reason);
  reasonRef.current = reason;
  // The field shows the form's value again (another language, a value taken from the scan or
  // saved by the other parent): what was typed and refused is gone, and so is its message.
  useEffect(() => {
    setReason(null);
    setLeft(false);
  }, [lang, value]);
  const flushers = useContext(AutosaveFlushContext);
  useEffect(() => {
    const flush: AutosaveFlush = {
      save: () => {
        if (reasonRef.current !== null) setLeft(true);
        return Promise.resolve(reasonRef.current === null);
      },
      version: () => undefined,
    };
    flushers?.add(flush);
    return () => { flushers?.delete(flush); };
  }, [flushers]);
  const message = reason !== null && left ? dateRefusalMessage(lang, reason, limits) : undefined;
  // While the refusal is shown the step does not say "saved": what the field shows is not saved.
  const reportRefused = useContext(StepRefusedEntryContext);
  const refusalKey = useRef({});
  const refusalShown = message !== undefined;
  useEffect(() => {
    if (!reportRefused) return;
    const key = refusalKey.current;
    reportRefused(key, refusalShown);
    return () => reportRefused(key, false);
  }, [reportRefused, refusalShown]);
  // The date is left when the cursor leaves its day, month and year. Tab from the year goes to
  // the field's own calendar button first: counting that as still in the field kept the message
  // (and «Не сохранено») back until the first «Далее» (recheck 2026-11-11 N1).
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget;
    const typing = next instanceof Element && event.currentTarget.contains(next) && next.closest(DATE_SECTIONS) !== null;
    if (typing) return;
    setLeft(true);
  };
  return {
    message,
    onPickerValidation: (next: string | null) => {
      setReason(next);
      if (next === null) setLeft(false);
    },
    /** Around the date `Input`: `contents` keeps it out of the layout. */
    wrap: (input: ReactNode) => (
      <span className="contents" data-cabinet-invalid={message ? "true" : undefined} onBlur={onBlur}>
        {input}
      </span>
    ),
  };
}
