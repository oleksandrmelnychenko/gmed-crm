import { formatAppDate } from "./app-time-zone";
import { uiText, type Lang } from "./i18n";
import { localizeTimelineTitle } from "./timeline-labels";

/**
 * Follow-up reminders of an appointment ("Завершить и запланировать" 1W/1M/6M
 * and the handoff presets) are stored language-neutral and translated when
 * shown, so a German colleague does not read Russian titles. The titles are
 * the ones the order follow-up gate already recognizes (orders.rs counts
 * reminders by these title patterns) – keep them in sync.
 */
export const FOLLOW_UP_REMINDER_STORED_TITLES = {
  post_1w: "1-week follow-up check-in",
  post_1m: "1-month follow-up check-in",
  post_6m: "6-month follow-up check-in",
} as const;

export type FollowUpReminderPreset = keyof typeof FOLLOW_UP_REMINDER_STORED_TITLES;

export function followUpReminderStoredTitle(preset: string): string | null {
  return FOLLOW_UP_REMINDER_STORED_TITLES[preset as FollowUpReminderPreset] ?? null;
}

// Stored titles, including the ones saved before 2026-10-11 in the language
// of whoever completed the appointment.
const FOLLOW_UP_REMINDER_TITLE_KEYS: Record<string, string> = {
  "1-week follow-up check-in": "follow_up_reminder_title_post_1w",
  "1-month follow-up check-in": "follow_up_reminder_title_post_1m",
  "6-month follow-up check-in": "follow_up_reminder_title_post_6m",
  "Контроль через 1 неделю": "follow_up_reminder_title_post_1w",
  "Контроль через 1 месяц": "follow_up_reminder_title_post_1m",
  "Контроль через 6 месяцев": "follow_up_reminder_title_post_6m",
  "Контрольный контакт через 1 неделю": "follow_up_reminder_title_post_1w",
  "Контрольный контакт через 1 месяц": "follow_up_reminder_title_post_1m",
  "Контрольный контакт через 6 месяцев": "follow_up_reminder_title_post_6m",
  "Nachsorge nach 1 Woche": "follow_up_reminder_title_post_1w",
  "Nachsorge nach 1 Monat": "follow_up_reminder_title_post_1m",
  "Nachsorge nach 6 Monaten": "follow_up_reminder_title_post_6m",
};

/** The stored note of a follow-up reminder: planned on completion or from the appointment. */
export function followUpReminderStoredNote(
  kind: "completion" | "appointment",
  patientPid: string,
  title: string,
): string {
  return kind === "completion"
    ? `Scheduled automatically when appointment ${patientPid} · ${title} was completed.`
    : `Scheduled automatically from appointment ${patientPid} · ${title}.`;
}

// [pattern, uiText key]: the canonical notes and the RU/DE notes stored before.
const FOLLOW_UP_REMINDER_NOTE_PATTERNS: Array<[RegExp, string]> = [
  [/^Scheduled automatically when appointment (.+?) · ([\s\S]+) was completed\.$/, "follow_up_reminder_note_completion"],
  [/^Автоматически запланировано при завершении приёма для (.+?) · ([\s\S]+)\.$/, "follow_up_reminder_note_completion"],
  [/^Automatisch beim Terminabschluss für (.+?) · ([\s\S]+) geplant\.$/, "follow_up_reminder_note_completion"],
  [/^Scheduled automatically from appointment (.+?) · ([\s\S]+)\.$/, "follow_up_reminder_note_from_appointment"],
  [/^Автоматически запланировано из приёма (.+?) · ([\s\S]+)\.$/, "follow_up_reminder_note_from_appointment"],
  [/^Automatisch aus Termin (.+?) · ([\s\S]+) geplant\.$/, "follow_up_reminder_note_from_appointment"],
];

// Translate system templates when displayed, keeping stored text intact for edits.
export function localizeTaskTitle(title: string, lang: Lang): string {
  const followUpKey = FOLLOW_UP_REMINDER_TITLE_KEYS[title?.trim() ?? ""];
  if (followUpKey) return uiText(followUpKey, lang);
  return localizeTimelineTitle(title, (key) => uiText(key, lang));
}

// Descriptions the server writes into generated tasks and reminders.
const GENERATED_NOTE_KEYS: Record<string, string> = {
  "Confirm provider details, logistics and patient-facing service delivery":
    "generated_task_note_coordinate_concierge_service",
  "Gather confirmations and receipts after the non-medical service":
    "generated_task_note_collect_concierge_receipts",
  // The service (and its task) the server creates for a non-medical appointment.
  "Automatisch aus nichtmedizinischem Termin erstellt":
    "generated_service_note_from_non_medical_appointment",
};

export function localizeTaskNote(note: string | null | undefined, lang: Lang): string {
  const match = note?.match(/^Auto-generated from (order|patient) workflow checklist\.?$/);
  if (match) return uiText(`workflow_task_note_${match[1]}`, lang);
  const trimmed = note?.trim() ?? "";
  const generatedKey = GENERATED_NOTE_KEYS[trimmed];
  if (generatedKey) return uiText(generatedKey, lang);
  const preparation = trimmed.match(/^Prepare non-medical support for appointment on (\d{4}-\d{2}-\d{2})$/);
  if (preparation) {
    return uiText("generated_reminder_note_prepare_concierge_service", lang, {
      date: formatAppDate(preparation[1]) || preparation[1],
    });
  }
  for (const [pattern, key] of FOLLOW_UP_REMINDER_NOTE_PATTERNS) {
    const followUp = trimmed.match(pattern);
    if (followUp) return uiText(key, lang, { patientPid: followUp[1], title: followUp[2] });
  }
  return note ?? "";
}
