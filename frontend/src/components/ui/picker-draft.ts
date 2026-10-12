import type { Dayjs } from "dayjs"

/**
 * What a date, date-time or time field shows and what it hands to the form.
 *
 * The MUI field is controlled: it shows the value it gets back. If the form
 * refused a value the field published (an unfinished year "0002", a date
 * before the field's minimum), the field threw the typed day and month away
 * ("ДД.ММ.2026"). The field therefore always gets its own published value
 * back (`draft`), and the form only receives complete dates the field allows.
 */
export type PickerDraft = {
  /** The value the field shows: the last one it published, possibly unfinished or out of range. */
  draft: Dayjs | null
  /**
   * The form value the draft stands for: "" for an empty field, the
   * formatted date for a complete allowed one, null while the typed date is
   * unfinished, invalid or outside the allowed range.
   */
  committable: string | null
  /** The last form value this field handed over or received. */
  lastValue: string
}

export type PickerDraftStep = {
  state: PickerDraft
  /** A value to hand to the form, or null when the form keeps its value. */
  emit: string | null
}

export function formatPickerValue(nextDate: Dayjs | null, format: string) {
  return nextDate && nextDate.isValid() ? nextDate.format(format) : ""
}

function normalizedValue(
  value: string,
  parse: (value: string) => Dayjs | null,
  format: string,
) {
  return formatPickerValue(parse(value), format)
}

export function pickerDraftFromValue(
  value: string,
  parse: (value: string) => Dayjs | null,
  format: string,
): PickerDraft {
  const draft = parse(value)
  return { draft, committable: formatPickerValue(draft, format), lastValue: value }
}

/**
 * The field published a value while someone typed or picked. Unfinished and
 * disallowed dates stay visible (MUI marks them as errors); the form gets a
 * value only once the date is complete and allowed, or when the field was
 * emptied.
 */
export function applyPickerChange(
  state: PickerDraft,
  nextDate: Dayjs | null,
  validationError: unknown,
  format: string,
): PickerDraftStep {
  if (nextDate === null) {
    return {
      state: { draft: null, committable: "", lastValue: "" },
      emit: state.lastValue === "" ? null : "",
    }
  }
  if (validationError || !nextDate.isValid()) {
    return { state: { ...state, draft: nextDate, committable: null }, emit: null }
  }
  const formatted = formatPickerValue(nextDate, format)
  return {
    state: { draft: nextDate, committable: formatted, lastValue: formatted },
    emit: formatted === state.lastValue ? null : formatted,
  }
}

/**
 * The form's value changed from outside: a reset, a programmatic change, or
 * the answer of an autosave that re-renders the form. While the person types
 * in this field, the typed segments stay; a complete typed date wins over an
 * older value coming back from the server.
 */
export function applyExternalValue(
  state: PickerDraft,
  value: string,
  focused: boolean,
  parse: (value: string) => Dayjs | null,
  format: string,
): PickerDraftStep {
  if (value === state.lastValue) return { state, emit: null }
  const normalized = normalizedValue(value, parse, format)
  if (state.committable !== null && normalized === state.committable) {
    // The same date in another spelling (a timestamp from the server).
    return { state: { ...state, lastValue: value }, emit: null }
  }
  if (focused) {
    if (state.committable) {
      return { state: { ...state, lastValue: state.committable }, emit: state.committable }
    }
    return { state: { ...state, lastValue: value }, emit: null }
  }
  return {
    state: { draft: parse(value), committable: normalized, lastValue: value },
    emit: null,
  }
}

/**
 * The person left the field. A complete date they typed reaches the form if
 * an outside value arrived meanwhile; an empty field that was overtaken by an
 * outside value shows that value. Unfinished or disallowed dates stay
 * visible as errors instead of being thrown away.
 */
export function applyPickerBlur(
  state: PickerDraft,
  parse: (value: string) => Dayjs | null,
  format: string,
): PickerDraftStep {
  const normalized = normalizedValue(state.lastValue, parse, format)
  if (state.committable === null || state.committable === normalized) {
    return { state, emit: null }
  }
  if (state.committable === "") {
    return {
      state: { draft: parse(state.lastValue), committable: normalized, lastValue: state.lastValue },
      emit: null,
    }
  }
  return {
    state: { ...state, lastValue: state.committable },
    emit: state.committable,
  }
}

/** A calendar date read from pasted text. */
export type PastedDate = { year: number; month: number; day: number }

/**
 * A whole date pasted into a date field (QA 2026-10-12, A2-03): the segmented MUI field takes a
 * paste only into the selected segment, so "05.06.1970" pasted into "TT" filled nothing. Accepted
 * are the spellings people copy: DD.MM.YYYY, D.M.YYYY (also with "/" or "-"), and the ISO form
 * YYYY-MM-DD; surrounding spaces and a trailing dot are ignored. Anything else, and dates that do
 * not exist (31.02.2026), is `null`: the paste then goes to the field as before.
 */
export function parsePastedDate(text: string): PastedDate | null {
  const value = text.trim().replace(/\.$/, "")
  const dayFirst = value.match(/^(\d{1,2})\s*([./-])\s*(\d{1,2})\s*\2\s*(\d{4})$/)
  const isoForm = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const parts = dayFirst
    ? { day: Number(dayFirst[1]), month: Number(dayFirst[3]), year: Number(dayFirst[4]) }
    : isoForm
      ? { year: Number(isoForm[1]), month: Number(isoForm[2]), day: Number(isoForm[3]) }
      : null
  if (!parts) return null
  const { year, month, day } = parts
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return day <= daysInMonth ? parts : null
}
