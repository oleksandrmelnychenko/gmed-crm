import type { RealtimeEvent } from "@/lib/realtime";

/**
 * Timed events of a lead that the background jobs raise (owner request
 * 2026-10-26; crates/server/src/routes/leads.rs, crates/server/src/services/coming_of_age.rs):
 *
 * - `lead.retention_warning`: the one-time staff warning before the automatic
 *   deletion went out; the countdown («Автоудаление») now names its day.
 * - `lead.purged`: the retention sweep deleted the lead.
 * - `lead.coming_of_age_soon`: the minor turns 18 within 30 days.
 * - `lead.came_of_age`: the 18th birthday ended the parents' access.
 * - `lead.portal_access_ended`: to the cabinet logins only — the request is
 *   gone for them (deleted, or the parents' access ended at 18).
 */
export const LEAD_RETENTION_WARNING_EVENT = "lead.retention_warning";
export const LEAD_PURGED_EVENT = "lead.purged";
export const LEAD_COMING_OF_AGE_SOON_EVENT = "lead.coming_of_age_soon";
export const LEAD_CAME_OF_AGE_EVENT = "lead.came_of_age";
export const LEAD_PORTAL_ACCESS_ENDED_EVENT = "lead.portal_access_ended";

/** The events after which an open lead (list row, detail, wizard) is read again. */
export const LEAD_TIME_REFRESH_EVENTS = [
  LEAD_RETENTION_WARNING_EVENT,
  LEAD_COMING_OF_AGE_SOON_EVENT,
  LEAD_CAME_OF_AGE_EVENT,
] as const;

/** The leads the retention sweep deleted, among `events`. */
export function purgedLeadIds(events: readonly RealtimeEvent[]): Set<string> {
  return new Set(
    events
      .filter((event) => event.type === LEAD_PURGED_EVENT && event.entity_type === "lead" && Boolean(event.entity_id))
      .map((event) => event.entity_id),
  );
}

/** Whether `event` says that the lead `leadId` was deleted by the retention sweep. */
export function isLeadPurgedEvent(event: RealtimeEvent, leadId: string | null | undefined): boolean {
  return Boolean(leadId) && event.type === LEAD_PURGED_EVENT && event.entity_type === "lead" && event.entity_id === leadId;
}

/** Whether one of `events` changes what an open view of the lead `leadId` shows. */
export function touchesLeadTimeState(events: readonly RealtimeEvent[], leadId: string | null | undefined): boolean {
  if (!leadId) return false;
  return events.some(
    (event) =>
      event.entity_type === "lead" &&
      event.entity_id === leadId &&
      (LEAD_TIME_REFRESH_EVENTS as readonly string[]).includes(event.type),
  );
}

export function leadPurgedTitle(lang: "ru" | "de"): string {
  return lang === "de" ? "Lead wegen Ablauf der Aufbewahrungsfrist gelöscht" : "Лид удалён по сроку хранения";
}

export function leadPurgedText(lang: "ru" | "de"): string {
  return lang === "de"
    ? "Der Lead war nicht qualifiziert und hatte keine unterschriebene Einwilligung. Er wurde mit allen Dokumenten automatisch gelöscht; nicht gespeicherte Eingaben sind verloren."
    : "Лид не был квалифицирован и не имел подписанного согласия. Он удалён автоматически вместе со всеми документами; несохранённые изменения потеряны.";
}
