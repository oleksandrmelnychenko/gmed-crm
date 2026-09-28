import { uiText, type Lang } from "@/lib/i18n";

/**
 * The title the server gives a medical appointment a concierge may see only
 * as a busy slot (`is_blocked`). It is a fixed English placeholder, not the
 * appointment's title.
 */
export const BLOCKED_MEDICAL_SLOT_TITLE = "Blocked medical slot";

/** Shows the placeholder title of a blocked medical slot in the UI language. */
export function localizeBlockedAppointmentTitle<
  T extends { title: string; is_blocked?: boolean | null },
>(item: T, lang?: Lang): T {
  if (!item.is_blocked || item.title !== BLOCKED_MEDICAL_SLOT_TITLE) return item;
  return { ...item, title: uiText("appointments_blocked_slot", lang) };
}
