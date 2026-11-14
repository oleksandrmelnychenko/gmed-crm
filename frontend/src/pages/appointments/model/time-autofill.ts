import { useState } from "react";

/**
 * The end time of an appointment follows its start (owner 2026-11-14):
 * entering a start fills an empty end with start + the visit's duration
 * (60 minutes when the form knows no duration), moving the start moves an
 * end that was filled automatically or loaded with a known duration, and an
 * end the person typed stays as typed. A visit never runs past 23:59 of its
 * day: a longer end is cut to 23:59 and the form says so (`endCapped`).
 *
 * Times are naive Europe/Berlin wall-clock "HH:MM" strings, as everywhere in
 * the appointment forms.
 */
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;

const LAST_MINUTE_OF_DAY = 23 * 60 + 59;
const HH_MM = /^(\d{2}):(\d{2})/;

export type AppointmentTimePair = { timeStart: string; timeEnd: string };

export type AppointmentEndAutofillState = {
  /** The person typed or cleared the end themselves: a moved start leaves it alone. */
  endManual: boolean;
  /** The visit length the end follows; null = take it from the current pair. */
  durationMinutes: number | null;
  /** The last automatic end was cut to 23:59. */
  endCapped: boolean;
  /**
   * The end this state was made for. When the form's end differs (the form
   * was reset, a slot was picked, another record loaded) the state no longer
   * applies and counts as fresh.
   */
  lastEnd: string | null;
};

export const INITIAL_APPOINTMENT_END_AUTOFILL: AppointmentEndAutofillState = {
  endManual: false,
  durationMinutes: null,
  endCapped: false,
  lastEnd: null,
};

export type AppointmentTimeChange = AppointmentTimePair & {
  state: AppointmentEndAutofillState;
};

export function appointmentTimeToMinutes(value: string | null | undefined): number | null {
  const match = HH_MM.exec(value ?? "");
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function minutesToAppointmentTime(total: number): string {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/** Start + duration as "HH:MM", cut to 23:59 when it would reach the next day. */
export function addAppointmentDuration(
  timeStart: string,
  durationMinutes: number,
): { timeEnd: string; capped: boolean } | null {
  const start = appointmentTimeToMinutes(timeStart);
  if (start === null) return null;
  const end = start + Math.max(1, Math.round(durationMinutes));
  if (end > LAST_MINUTE_OF_DAY) {
    return { timeEnd: minutesToAppointmentTime(LAST_MINUTE_OF_DAY), capped: true };
  }
  return { timeEnd: minutesToAppointmentTime(end), capped: false };
}

/** Minutes between start and end when the end lies after the start. */
function pairDurationMinutes(timeStart: string, timeEnd: string): number | null {
  const start = appointmentTimeToMinutes(timeStart);
  const end = appointmentTimeToMinutes(timeEnd);
  if (start === null || end === null || end <= start) return null;
  return end - start;
}

function currentState(
  state: AppointmentEndAutofillState,
  timeEnd: string,
): AppointmentEndAutofillState {
  return state.lastEnd === timeEnd ? state : INITIAL_APPOINTMENT_END_AUTOFILL;
}

/** The person set (or cleared) the start. */
export function applyAppointmentStartChange(
  pair: AppointmentTimePair,
  state: AppointmentEndAutofillState,
  nextStart: string,
  defaultDurationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
): AppointmentTimeChange {
  const current = currentState(state, pair.timeEnd);
  const knownDuration =
    current.durationMinutes ?? pairDurationMinutes(pair.timeStart, pair.timeEnd);
  const keepsManualEnd = current.endManual && Boolean(pair.timeEnd);

  if (appointmentTimeToMinutes(nextStart) === null) {
    if (keepsManualEnd) {
      return {
        timeStart: nextStart,
        timeEnd: pair.timeEnd,
        state: { ...current, endCapped: false, lastEnd: pair.timeEnd },
      };
    }
    // A cleared start takes the automatic end with it; the length is kept
    // for the next start.
    return {
      timeStart: nextStart,
      timeEnd: "",
      state: {
        endManual: false,
        durationMinutes: knownDuration,
        endCapped: false,
        lastEnd: "",
      },
    };
  }

  if (keepsManualEnd) {
    return {
      timeStart: nextStart,
      timeEnd: pair.timeEnd,
      state: { ...current, endCapped: false, lastEnd: pair.timeEnd },
    };
  }

  const durationMinutes = knownDuration ?? defaultDurationMinutes;
  const filled = addAppointmentDuration(nextStart, durationMinutes);
  const timeEnd = filled?.timeEnd ?? pair.timeEnd;
  return {
    timeStart: nextStart,
    timeEnd,
    state: {
      endManual: false,
      durationMinutes,
      endCapped: filled?.capped ?? false,
      lastEnd: timeEnd,
    },
  };
}

/**
 * The person set or cleared the end. Their end stays as typed (validation
 * still checks it); a cleared end with a start keeps the pair error until a
 * start is entered again or the end is typed.
 */
export function applyAppointmentEndChange(
  pair: AppointmentTimePair,
  state: AppointmentEndAutofillState,
  nextEnd: string,
): AppointmentTimeChange {
  const current = currentState(state, pair.timeEnd);
  const durationMinutes =
    pairDurationMinutes(pair.timeStart, nextEnd) ??
    current.durationMinutes ??
    pairDurationMinutes(pair.timeStart, pair.timeEnd);
  return {
    timeStart: pair.timeStart,
    timeEnd: nextEnd,
    state: {
      endManual: true,
      durationMinutes,
      endCapped: false,
      lastEnd: nextEnd,
    },
  };
}

export function isAppointmentEndCapped(
  state: AppointmentEndAutofillState,
  timeEnd: string,
): boolean {
  return state.endCapped && state.lastEnd === timeEnd && Boolean(timeEnd);
}

/**
 * Per-form state of the end autofill. The handlers take the form's current
 * pair and return the next one for the form to store.
 */
export function useAppointmentEndAutofill(
  defaultDurationMinutes = DEFAULT_APPOINTMENT_DURATION_MINUTES,
) {
  const [state, setState] = useState(INITIAL_APPOINTMENT_END_AUTOFILL);
  return {
    changeStart(pair: AppointmentTimePair, nextStart: string): AppointmentTimePair {
      const next = applyAppointmentStartChange(pair, state, nextStart, defaultDurationMinutes);
      setState(next.state);
      return { timeStart: next.timeStart, timeEnd: next.timeEnd };
    },
    changeEnd(pair: AppointmentTimePair, nextEnd: string): AppointmentTimePair {
      const next = applyAppointmentEndChange(pair, state, nextEnd);
      setState(next.state);
      return { timeStart: next.timeStart, timeEnd: next.timeEnd };
    },
    isEndCapped(timeEnd: string) {
      return isAppointmentEndCapped(state, timeEnd);
    },
  };
}
