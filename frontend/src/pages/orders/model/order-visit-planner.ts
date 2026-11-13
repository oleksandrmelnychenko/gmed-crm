import { addDaysToDateKey } from "@/lib/app-time-zone";

import type { PlanningDoctor } from "./order-planned-appointments";

/** The grid (planning stage 6): 07:00–20:00 in half hours, Europe/Berlin wall clock. */
export const GRID_START_MINUTES = 7 * 60;
export const GRID_END_MINUTES = 20 * 60;
export const GRID_STEP_MINUTES = 30;
export const GRID_DAY_COUNT = 5;
export const DEFAULT_VISIT_MINUTES = 60;
export const VISIT_DURATIONS = [30, 45, 60, 90, 120] as const;

/** A visit laid out on the grid, not created yet. */
export type DraftVisit = {
  key: string;
  doctor: PlanningDoctor;
  date: string;
  /** Minutes after midnight. */
  start: number;
  duration: number;
  title: string;
  interpreterNeeded: boolean;
  interpreterId: string;
};

/** Taken time the server reports (`GET /orders/{id}/appointments/busy`). */
export type BusySlot = {
  id: string | null;
  date: string;
  time_start: string | null;
  time_end: string | null;
  scopes: Array<"patient" | "doctor" | "interpreter">;
  doctor_id: string | null;
  interpreter_id: string | null;
  title: string | null;
  same_order: boolean;
};

/** One refusal of `POST /orders/{id}/appointments/batch`, by item index. */
export type BatchFailure = {
  index: number;
  code: "invalid" | "batch_overlap" | "conflict" | "busy_retry" | string;
  message?: string;
  other_index?: number;
  scopes?: string[];
  conflicts?: {
    patient_conflict_count?: number;
    doctor_conflict_count?: number;
    interpreter_conflict_count?: number;
  };
};

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** "HH:MM" (or "HH:MM:SS") to minutes; null for an empty value. */
export function timeToMinutes(value: string | null | undefined): number | null {
  if (!value) return null;
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
}

export function gridDays(firstDay: string, count = GRID_DAY_COUNT): string[] {
  return Array.from({ length: count }, (_, index) => addDaysToDateKey(firstDay, index));
}

export function gridSlots(): number[] {
  const slots: number[] = [];
  for (let minutes = GRID_START_MINUTES; minutes < GRID_END_MINUTES; minutes += GRID_STEP_MINUTES) {
    slots.push(minutes);
  }
  return slots;
}

export function doctorKeyOf(doctor: PlanningDoctor) {
  return `${doctor.providerId}:${doctor.doctorId ?? ""}`;
}

/** A visit placed at a slot ends by 20:00 at the latest. */
export function newDraft(
  key: string,
  doctor: PlanningDoctor,
  date: string,
  start: number,
): DraftVisit {
  return {
    key,
    doctor,
    date,
    start,
    duration: Math.min(DEFAULT_VISIT_MINUTES, GRID_END_MINUTES - start),
    title: doctor.doctorName ?? doctor.providerName,
    interpreterNeeded: false,
    interpreterId: "",
  };
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Who would be in two places, seen on the client before the server's dry
 * run: the patient for any two overlapping drafts, plus the doctor or the
 * interpreter they share; and the taken time the server reported.
 */
export function draftConflicts(
  drafts: readonly DraftVisit[],
  busy: readonly BusySlot[],
): Map<string, Set<"patient" | "doctor" | "interpreter">> {
  const result = new Map<string, Set<"patient" | "doctor" | "interpreter">>();
  const mark = (key: string, scope: "patient" | "doctor" | "interpreter") => {
    const current = result.get(key) ?? new Set();
    current.add(scope);
    result.set(key, current);
  };
  drafts.forEach((a, index) => {
    const aEnd = a.start + a.duration;
    for (const b of drafts.slice(index + 1)) {
      if (a.date !== b.date || !rangesOverlap(a.start, aEnd, b.start, b.start + b.duration)) continue;
      for (const draft of [a, b]) mark(draft.key, "patient");
      if (a.doctor.doctorId && a.doctor.doctorId === b.doctor.doctorId) {
        mark(a.key, "doctor");
        mark(b.key, "doctor");
      }
      if (a.interpreterId && a.interpreterId === b.interpreterId) {
        mark(a.key, "interpreter");
        mark(b.key, "interpreter");
      }
    }
    for (const slot of busy) {
      if (slot.date !== a.date) continue;
      const start = timeToMinutes(slot.time_start) ?? 0;
      const end = timeToMinutes(slot.time_end) ?? 24 * 60;
      if (!rangesOverlap(a.start, aEnd, start, end)) continue;
      if (slot.scopes.includes("patient")) mark(a.key, "patient");
      if (slot.scopes.includes("doctor") && slot.doctor_id && slot.doctor_id === a.doctor.doctorId) {
        mark(a.key, "doctor");
      }
      if (
        slot.scopes.includes("interpreter") &&
        a.interpreterId &&
        slot.interpreter_id === a.interpreterId
      ) {
        mark(a.key, "interpreter");
      }
    }
  });
  return result;
}

/** The body of `POST /orders/{id}/appointments/batch`. */
export function batchPayload(drafts: readonly DraftVisit[], dryRun: boolean) {
  return {
    dry_run: dryRun,
    items: drafts.map((draft) => ({
      provider_id: draft.doctor.providerId,
      doctor_id: draft.doctor.doctorId,
      title: draft.title.trim(),
      date: draft.date,
      time_start: minutesToTime(draft.start),
      time_end: minutesToTime(draft.start + draft.duration),
      // An unticked box leaves the visit to the order's planning (null), as
      // the appointment form does; only a tick is the visit's own answer.
      interpreter_needed: draft.interpreterNeeded ? true : null,
      interpreter_id: draft.interpreterNeeded && draft.interpreterId ? draft.interpreterId : null,
      // The appointment form fills the place from the provider the same way.
      location: draft.doctor.providerName,
    })),
  };
}

/** A saved grid draft line (`GET /orders/{id}/visit-drafts`). */
export type SavedVisitDraft = {
  id: string;
  provider_id: string;
  provider_name: string;
  doctor_id: string | null;
  doctor_name: string | null;
  title: string;
  date: string;
  time_start: string;
  time_end: string;
  interpreter_needed: boolean;
  interpreter_id: string | null;
};

/** The saved draft back on the grid; a line whose times cannot be read is left out. */
export function draftsFromSaved(saved: readonly SavedVisitDraft[]): DraftVisit[] {
  return saved.flatMap((item) => {
    const start = timeToMinutes(item.time_start);
    const end = timeToMinutes(item.time_end);
    if (start === null || end === null || end <= start) return [];
    return [
      {
        key: `saved-${item.id}`,
        doctor: {
          providerId: item.provider_id,
          providerName: item.provider_name,
          doctorId: item.doctor_id,
          doctorName: item.doctor_name,
        },
        date: item.date,
        start,
        duration: end - start,
        title: item.title,
        interpreterNeeded: item.interpreter_needed,
        interpreterId: item.interpreter_id ?? "",
      },
    ];
  });
}

/** The body of `POST /orders/{id}/visit-drafts`: the grid as it stands. */
export function draftSavePayload(drafts: readonly DraftVisit[]) {
  return {
    items: batchPayload(drafts, false).items.map((item) => ({
      provider_id: item.provider_id,
      doctor_id: item.doctor_id,
      title: item.title,
      date: item.date,
      time_start: item.time_start,
      time_end: item.time_end,
      interpreter_needed: item.interpreter_needed === true,
      interpreter_id: item.interpreter_id,
    })),
  };
}

const SCOPE_TEXT = {
  ru: { patient: "пациент", doctor: "врач", interpreter: "переводчик" },
  de: { patient: "Patient", doctor: "Arzt", interpreter: "Dolmetscher" },
} as const;

export function scopesLabel(scopes: Iterable<string>, lang: string) {
  const texts = lang === "de" ? SCOPE_TEXT.de : SCOPE_TEXT.ru;
  return [...scopes]
    .map((scope) => texts[scope as keyof typeof texts] ?? scope)
    .join(", ");
}

/** A server refusal in the planner's words; the raw English message is not shown. */
export function batchFailureText(failure: BatchFailure, lang: string): string {
  const de = lang === "de";
  if (failure.code === "batch_overlap") {
    return de
      ? `Überschneidet sich mit einem anderen Termin dieses Plans (${scopesLabel(failure.scopes ?? ["patient"], lang)})`
      : `Пересекается с другим приёмом плана (${scopesLabel(failure.scopes ?? ["patient"], lang)})`;
  }
  if (failure.code === "conflict") {
    const scopes: string[] = [];
    if (failure.conflicts?.patient_conflict_count) scopes.push("patient");
    if (failure.conflicts?.doctor_conflict_count) scopes.push("doctor");
    if (failure.conflicts?.interpreter_conflict_count) scopes.push("interpreter");
    const who = scopes.length ? scopesLabel(scopes, lang) : de ? "Termin" : "запись";
    return de ? `Zeit bereits belegt (${who})` : `Время уже занято (${who})`;
  }
  if (failure.code === "busy_retry") {
    return de
      ? "Der Kalender wird gerade geändert, bitte erneut versuchen"
      : "Календарь сейчас меняется, попробуйте ещё раз";
  }
  // The server's own text stays in the tooltip; the line is translated.
  return de
    ? "Arzt, Klinik oder Dolmetscher können nicht gebucht werden"
    : "Врача, клинику или переводчика нельзя записать";
}
