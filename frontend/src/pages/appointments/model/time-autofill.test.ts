import { describe, expect, it } from "vitest";

import {
  addAppointmentDuration,
  applyAppointmentEndChange,
  applyAppointmentStartChange,
  INITIAL_APPOINTMENT_END_AUTOFILL,
  isAppointmentEndCapped,
  type AppointmentEndAutofillState,
} from "./time-autofill";

const fresh = INITIAL_APPOINTMENT_END_AUTOFILL;

function startThen(
  pair: { timeStart: string; timeEnd: string },
  state: AppointmentEndAutofillState,
  nextStart: string,
  defaultDuration?: number,
) {
  return applyAppointmentStartChange(pair, state, nextStart, defaultDuration);
}

describe("addAppointmentDuration", () => {
  it("adds minutes and caps at 23:59", () => {
    expect(addAppointmentDuration("09:30", 60)).toEqual({ timeEnd: "10:30", capped: false });
    expect(addAppointmentDuration("22:59", 60)).toEqual({ timeEnd: "23:59", capped: false });
    expect(addAppointmentDuration("23:15", 60)).toEqual({ timeEnd: "23:59", capped: true });
    expect(addAppointmentDuration("", 60)).toBeNull();
    expect(addAppointmentDuration("25:00", 60)).toBeNull();
  });
});

describe("applyAppointmentStartChange", () => {
  it("fills an empty end with start + 60 minutes", () => {
    const next = startThen({ timeStart: "", timeEnd: "" }, fresh, "13:00");
    expect(next).toMatchObject({ timeStart: "13:00", timeEnd: "14:00" });
    expect(next.state).toMatchObject({ endManual: false, durationMinutes: 60, endCapped: false });
  });

  it("uses the form's default duration when it knows one", () => {
    const next = startThen({ timeStart: "", timeEnd: "" }, fresh, "13:00", 30);
    expect(next.timeEnd).toBe("13:30");
  });

  it("moves an automatic end with the start and keeps the duration", () => {
    const first = startThen({ timeStart: "", timeEnd: "" }, fresh, "13:00", 45);
    const moved = startThen(first, first.state, "15:10", 45);
    expect(moved).toMatchObject({ timeStart: "15:10", timeEnd: "15:55" });
  });

  it("moves a loaded end with its known duration", () => {
    const moved = startThen({ timeStart: "10:00", timeEnd: "11:30" }, fresh, "12:00");
    expect(moved).toMatchObject({ timeStart: "12:00", timeEnd: "13:30" });
  });

  it("keeps an end the person typed", () => {
    const first = startThen({ timeStart: "", timeEnd: "" }, fresh, "13:00");
    const typed = applyAppointmentEndChange(first, first.state, "13:20");
    expect(typed).toMatchObject({ timeStart: "13:00", timeEnd: "13:20" });
    const moved = startThen(typed, typed.state, "14:00");
    expect(moved).toMatchObject({ timeStart: "14:00", timeEnd: "13:20" });
  });

  it("caps the end at 23:59 and reports it", () => {
    const next = startThen({ timeStart: "", timeEnd: "" }, fresh, "23:30");
    expect(next.timeEnd).toBe("23:59");
    expect(isAppointmentEndCapped(next.state, next.timeEnd)).toBe(true);
    // Back to a daytime start: the remembered full length applies again.
    const back = startThen(next, next.state, "10:00");
    expect(back.timeEnd).toBe("11:00");
    expect(isAppointmentEndCapped(back.state, back.timeEnd)).toBe(false);
  });

  it("clears an automatic end with the start and restores the length on the next start", () => {
    const first = startThen({ timeStart: "", timeEnd: "" }, fresh, "09:00", 90);
    const cleared = startThen(first, first.state, "", 90);
    expect(cleared).toMatchObject({ timeStart: "", timeEnd: "" });
    const again = startThen(cleared, cleared.state, "11:00", 60);
    expect(again.timeEnd).toBe("12:30");
  });

  it("keeps a typed end when the start is cleared", () => {
    const typed = applyAppointmentEndChange({ timeStart: "09:00", timeEnd: "10:00" }, fresh, "10:15");
    const cleared = startThen(typed, typed.state, "");
    expect(cleared).toMatchObject({ timeStart: "", timeEnd: "10:15" });
  });

  it("refills an end the person cleared once a start is entered", () => {
    const first = startThen({ timeStart: "", timeEnd: "" }, fresh, "09:00");
    const clearedEnd = applyAppointmentEndChange(first, first.state, "");
    expect(clearedEnd).toMatchObject({ timeStart: "09:00", timeEnd: "" });
    const restarted = startThen(clearedEnd, clearedEnd.state, "09:30");
    expect(restarted.timeEnd).toBe("10:30");
  });

  it("treats the state as fresh when the form's end changed from outside", () => {
    const typed = applyAppointmentEndChange({ timeStart: "09:00", timeEnd: "" }, fresh, "09:20");
    // The form was reset to a new slot 14:00–14:30; the typed end no longer applies.
    const moved = startThen({ timeStart: "14:00", timeEnd: "14:30" }, typed.state, "15:00");
    expect(moved).toMatchObject({ timeStart: "15:00", timeEnd: "15:30" });
  });

  it("leaves the end for the range check when a typed end lies before the start", () => {
    const typed = applyAppointmentEndChange({ timeStart: "10:00", timeEnd: "11:00" }, fresh, "10:30");
    const moved = startThen(typed, typed.state, "11:00");
    expect(moved).toMatchObject({ timeStart: "11:00", timeEnd: "10:30" });
  });
});
