/**
 * Why a date field did not take what was typed.
 *
 * The shared date input keeps a date outside `min`/`max` visible but never
 * hands it to the form (`onPickerValidation` of `@/components/ui/input`), so
 * the form would silently book its previous date: a payment typed for 31.12.
 * was recorded for today (QA 2026-11-10, D-05). The money forms show this
 * text instead and do not submit while it is set.
 */
export function dateEntryRefusalText(error: string | null, lang: string): string | null {
  if (!error) return null;
  const de = lang === "de";
  switch (error) {
    case "maxDate":
    case "disableFuture":
      return de ? "Ein Datum in der Zukunft ist nicht zulässig." : "Дата в будущем не допускается.";
    case "minDate":
    case "disablePast":
      return de
        ? "Das Datum liegt vor dem frühesten zulässigen Tag."
        : "Дата раньше самой ранней допустимой.";
    case "outOfRange":
      return de
        ? "Das Datum liegt außerhalb des zulässigen Zeitraums."
        : "Дата вне допустимого периода.";
    default:
      return de
        ? "Das Datum ist unvollständig oder ungültig."
        : "Дата указана не полностью или неверно.";
  }
}
