import { uiText, type Lang } from "./i18n";
import { localizeTimelineTitle } from "./timeline-labels";

// Translate system templates when displayed, keeping stored text intact for edits.
export function localizeTaskTitle(title: string, lang: Lang): string {
  return localizeTimelineTitle(title, (key) => uiText(key, lang));
}

export function localizeTaskNote(note: string | null | undefined, lang: Lang): string {
  const match = note?.match(/^Auto-generated from (order|patient) workflow checklist\.?$/);
  return match ? uiText(`workflow_task_note_${match[1]}`, lang) : note ?? "";
}
