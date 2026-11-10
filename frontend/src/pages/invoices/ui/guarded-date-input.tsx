import { useEffect, useRef, useState, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { dateEntryRefusalText } from "../model/date-entry";

type GuardedDateInputProps = Omit<ComponentProps<typeof Input>, "type" | "onPickerValidation"> & {
  /** `true` while the field shows a date it did not hand to the form. */
  onRefusedChange: (refused: boolean) => void;
};

/**
 * A date field of a money form that says why it did not take what was typed.
 *
 * The shared date input keeps a date outside `min`/`max` visible but hands
 * the form nothing, so the form would book its previous date: a payment typed
 * for 31.12. was recorded for today without a word (QA 2026-11-10, D-05).
 * The reason stands under the field and the form is told not to submit.
 */
export function GuardedDateInput({ onRefusedChange, ...inputProps }: GuardedDateInputProps) {
  const { lang } = useLang();
  const [refusal, setRefusal] = useState<string | null>(null);
  const reportRef = useRef(onRefusedChange);

  useEffect(() => {
    reportRef.current = onRefusedChange;
  }, [onRefusedChange]);

  useEffect(() => {
    reportRef.current(refusal !== null);
  }, [refusal]);

  // A field that goes away takes its refused date with it.
  useEffect(() => () => reportRef.current(false), []);

  // The form set another date itself (a reset, the next invoice): the field
  // shows that date now, the earlier refusal is over.
  const formValue = inputProps.value;
  useEffect(() => {
    setRefusal(null);
  }, [formValue]);

  const text = dateEntryRefusalText(refusal, lang);
  return (
    <>
      <Input {...inputProps} type="date" onPickerValidation={setRefusal} />
      {text ? (
        <span role="alert" className="text-xs text-rose-700" data-testid="date-entry-refused">
          {text}
        </span>
      ) : null}
    </>
  );
}
