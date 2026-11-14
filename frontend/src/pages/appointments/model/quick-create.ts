import type { ConflictSummary } from "./types";

/**
 * The clashes the server found, named: «пациент уже записан: 10:00–11:00
 * Check up-Kardiologie (Dr. Weber)», as the planning grid says it.
 */
export function namedConflictLines(conflicts: ConflictSummary | null | undefined, lang: string): string[] {
  if (!conflicts?.has_conflicts) return [];
  const de = lang === "de";
  type Item = ConflictSummary["patient_conflicts"][number];
  const describe = (item: Item) => {
    const time = item.time_start ? `${item.time_start.slice(0, 5)}${item.time_end ? `–${item.time_end.slice(0, 5)}` : ""}` : "";
    const who = item.doctor_name || item.provider_name;
    return [time, item.is_blocked ? "" : item.title, who ? `(${who})` : ""].filter(Boolean).join(" ");
  };
  return [
    ...(conflicts.patient_conflicts ?? []).map((item) =>
      `${de ? "Patient schon gebucht" : "пациент уже записан"}: ${describe(item)}`,
    ),
    ...(conflicts.doctor_conflicts ?? []).map((item) =>
      `${de ? "Arzt belegt" : "врач занят"}: ${describe(item)}`,
    ),
    ...(conflicts.interpreter_conflicts ?? []).map((item) =>
      `${de ? "Dolmetscher belegt" : "переводчик занят"}: ${describe(item)}`,
    ),
  ];
}

/** Duration chips of the calendar's quick create, as in the planning grid. */
export const QUICK_DURATIONS = [30, 45, 60, 90, 120] as const;

const DEFAULT_MINUTES = 60;

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The duration the quick create starts with: the selected range (drag in the
 * calendar), else one hour.
 */
export function quickCreateDuration(timeStart: string, timeEnd: string): number {
  const start = toMinutes(timeStart);
  const end = toMinutes(timeEnd);
  if (start === null || end === null || end <= start) return DEFAULT_MINUTES;
  return end - start;
}

/** «HH:MM» end for a start and a duration, capped at 23:59 (a visit stays on its day). */
export function quickCreateEnd(timeStart: string, minutes: number): string {
  const start = toMinutes(timeStart) ?? 0;
  const end = Math.min(start + minutes, 23 * 60 + 59);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
}

const POPOVER_WIDTH = 320;
const POPOVER_HEIGHT = 520;
const MARGIN = 8;

/** Next to the click, kept inside the viewport. */
export function quickCreatePopoverPosition(
  anchor: { x: number; y: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const fitsRight = anchor.x + MARGIN + POPOVER_WIDTH <= viewport.width - MARGIN;
  const left = fitsRight ? anchor.x + MARGIN : anchor.x - MARGIN - POPOVER_WIDTH;
  const top = Math.min(anchor.y, viewport.height - POPOVER_HEIGHT - MARGIN);
  return {
    left: Math.max(MARGIN, Math.min(left, viewport.width - POPOVER_WIDTH - MARGIN)),
    top: Math.max(MARGIN, top),
  };
}
