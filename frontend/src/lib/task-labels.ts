import { uiText, type Lang } from "./i18n";
import { localizeTimelineTitle } from "./timeline-labels";

// Translate system templates when displayed, keeping stored text intact for edits.
export function localizeTaskTitle(title: string, lang: Lang): string {
  return localizeTimelineTitle(title, (key) => uiText(key, lang));
}

// Descriptions the server writes into generated tasks and reminders.
const GENERATED_NOTE_KEYS: Record<string, string> = {
  "Confirm provider details, logistics and patient-facing service delivery":
    "generated_task_note_coordinate_concierge_service",
  "Gather confirmations and receipts after the non-medical service":
    "generated_task_note_collect_concierge_receipts",
};

export function localizeTaskNote(note: string | null | undefined, lang: Lang): string {
  const match = note?.match(/^Auto-generated from (order|patient) workflow checklist\.?$/);
  if (match) return uiText(`workflow_task_note_${match[1]}`, lang);
  const trimmed = note?.trim() ?? "";
  const generatedKey = GENERATED_NOTE_KEYS[trimmed];
  if (generatedKey) return uiText(generatedKey, lang);
  const preparation = trimmed.match(/^Prepare non-medical support for appointment on (\d{4}-\d{2}-\d{2})$/);
  if (preparation) {
    const date = new Date(`${preparation[1]}T00:00:00`);
    return uiText("generated_reminder_note_prepare_concierge_service", lang, {
      date: Number.isFinite(date.getTime())
        ? date.toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })
        : preparation[1],
    });
  }
  return note ?? "";
}
