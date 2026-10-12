import dayjs, { type Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { describe, expect, it } from "vitest";

import {
  applyExternalValue,
  applyPickerBlur,
  applyPickerChange,
  parsePastedDate,
  pickerDraftFromValue,
  type PickerDraft,
} from "./picker-draft";

dayjs.extend(customParseFormat);

const FORMAT = "YYYY-MM-DD";
const parse = (value: string) => {
  if (!value) return null;
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
};

/** What the MUI field publishes after a keystroke: its sections parsed strictly. */
function typed(sections: string): Dayjs {
  return dayjs(sections, "DD.MM.YYYY", true);
}

/** Feeds published values the way the field does and collects what the form receives. */
function typeInto(
  start: PickerDraft,
  steps: Array<{ value: Dayjs | null; error?: string | null }>,
) {
  const emitted: string[] = [];
  let state = start;
  for (const step of steps) {
    const next = applyPickerChange(state, step.value, step.error ?? null, FORMAT);
    expect(next.state.draft).toBe(step.value);
    state = next.state;
    if (next.emit !== null) emitted.push(next.emit);
  }
  return { state, emitted };
}

describe("picker draft", () => {
  it("keeps the typed day and month while the year is typed into a field with a minimum date", () => {
    // Lead wizard "Начало программы" (min = today), keys 20 10 2026.
    const { state, emitted } = typeInto(pickerDraftFromValue("", parse, FORMAT), [
      { value: typed("20.10.0002"), error: "invalidDate" },
      { value: typed("20.10.0020"), error: "invalidDate" },
      { value: typed("20.10.0202"), error: "minDate" },
      { value: typed("20.10.2026") },
    ]);

    expect(emitted).toEqual(["2026-10-20"]);
    expect(state.draft?.format("DD.MM.YYYY")).toBe("20.10.2026");
    expect(state).toMatchObject({ committable: "2026-10-20", lastValue: "2026-10-20" });
  });

  it("does not hand unfinished or disallowed dates to the form", () => {
    const start = pickerDraftFromValue("2026-10-20", parse, FORMAT);
    const { state, emitted } = typeInto(start, [
      { value: typed("20.10.0002"), error: "invalidDate" },
      { value: typed("20.10.0202"), error: "minDate" },
    ]);

    expect(emitted).toEqual([]);
    expect(state.committable).toBeNull();
    expect(state.lastValue).toBe("2026-10-20");
    expect(state.draft?.format("DD.MM.YYYY")).toBe("20.10.0202");
  });

  it("empties the form value when the field is cleared", () => {
    const step = applyPickerChange(pickerDraftFromValue("2026-10-20", parse, FORMAT), null, null, FORMAT);

    expect(step.emit).toBe("");
    expect(step.state).toEqual({ draft: null, committable: "", lastValue: "" });
  });

  it("keeps typed segments when an autosave answer re-renders the form while the person types", () => {
    // Lead cabinet date of birth: day and month typed, the year not yet; another
    // field's autosave answer comes back with an older value of the form.
    const typing: PickerDraft = { draft: typed("01.02.0198"), committable: null, lastValue: "" };
    const step = applyExternalValue(typing, "1970-01-01", true, parse, FORMAT);

    expect(step.emit).toBeNull();
    expect(step.state.draft).toBe(typing.draft);
    expect(step.state.lastValue).toBe("1970-01-01");
  });

  it("hands a complete typed date back when an older value arrives while the field has focus", () => {
    const typed1985 = typeInto(pickerDraftFromValue("", parse, FORMAT), [
      { value: typed("01.02.1985") },
    ]).state;
    const step = applyExternalValue(typed1985, "", true, parse, FORMAT);

    expect(step.emit).toBe("1985-02-01");
    expect(step.state.draft).toBe(typed1985.draft);
  });

  it("takes an outside value when the field does not have focus", () => {
    const start = pickerDraftFromValue("2026-10-20", parse, FORMAT);
    const step = applyExternalValue(start, "2026-11-02", false, parse, FORMAT);

    expect(step.emit).toBeNull();
    expect(step.state.draft?.format(FORMAT)).toBe("2026-11-02");
    expect(step.state).toMatchObject({ committable: "2026-11-02", lastValue: "2026-11-02" });
  });

  it("ignores the same date coming back in another spelling", () => {
    const start = pickerDraftFromValue("2026-10-20", parse, FORMAT);
    const step = applyExternalValue(start, "2026-10-20T00:00:00", true, parse, FORMAT);

    expect(step.emit).toBeNull();
    expect(step.state.draft).toBe(start.draft);
    expect(step.state.lastValue).toBe("2026-10-20T00:00:00");
  });

  it("does nothing when the form echoes the value the field handed over", () => {
    const { state } = typeInto(pickerDraftFromValue("", parse, FORMAT), [{ value: typed("20.10.2026") }]);
    const step = applyExternalValue(state, "2026-10-20", true, parse, FORMAT);

    expect(step).toEqual({ state, emit: null });
  });

  it("on leaving keeps an unfinished date visible instead of discarding it", () => {
    const typing: PickerDraft = { draft: typed("20.10.0202"), committable: null, lastValue: "" };

    expect(applyPickerBlur(typing, parse, FORMAT)).toEqual({ state: typing, emit: null });
  });

  it("on leaving shows an outside value that arrived while the field stayed empty", () => {
    const empty: PickerDraft = { draft: null, committable: "", lastValue: "2026-10-20" };
    const step = applyPickerBlur(empty, parse, FORMAT);

    expect(step.emit).toBeNull();
    expect(step.state.draft?.format(FORMAT)).toBe("2026-10-20");
    expect(step.state.committable).toBe("2026-10-20");
  });

  it("on leaving hands over a complete typed date the form does not have yet", () => {
    const state: PickerDraft = { draft: typed("01.02.1985"), committable: "1985-02-01", lastValue: "" };
    const step = applyPickerBlur(state, parse, FORMAT);

    expect(step.emit).toBe("1985-02-01");
    expect(step.state.lastValue).toBe("1985-02-01");
  });

  it("types times segment by segment", () => {
    const timeParse = (value: string) => (value ? dayjs(`2000-01-01T${value}`) : null);
    let state = pickerDraftFromValue("", timeParse, "HH:mm");
    const step = applyPickerChange(state, dayjs("2000-01-01T09:45"), null, "HH:mm");
    state = step.state;

    expect(step.emit).toBe("09:45");
    expect(applyExternalValue(state, "09:45", true, timeParse, "HH:mm").emit).toBeNull();
  });
});

describe("parsePastedDate (QA 2026-10-12, A2-03)", () => {
  it("reads the spellings people paste", () => {
    for (const [text, expected] of [
      ["05.06.1970", { year: 1970, month: 6, day: 5 }],
      [" 5.6.1970 ", { year: 1970, month: 6, day: 5 }],
      ["05.06.1970.", { year: 1970, month: 6, day: 5 }],
      ["20/03/1990", { year: 1990, month: 3, day: 20 }],
      ["20-03-1990", { year: 1990, month: 3, day: 20 }],
      ["1965-11-11", { year: 1965, month: 11, day: 11 }],
      ["29.02.2024", { year: 2024, month: 2, day: 29 }],
    ] as const) {
      expect(parsePastedDate(text), text).toEqual(expected);
    }
  });

  it("leaves other text and impossible dates to the field", () => {
    for (const text of ["", "05", "0506", "05.06", "05.06.70", "1970/06/05", "05.06-1970", "31.02.2026", "29.02.2023", "00.01.2020", "12.13.2020", "abc", "05.06.1970 10:30"]) {
      expect(parsePastedDate(text), text).toBeNull();
    }
  });

  it("fills the whole date in one step, as typing it would", () => {
    const pasted = parsePastedDate("05.06.1970")!;
    const date = dayjs(new Date(pasted.year, pasted.month - 1, pasted.day));
    const step = applyPickerChange(pickerDraftFromValue("", parse, FORMAT), date, null, FORMAT);
    expect(step.emit).toBe("1970-06-05");
  });
});
