import { useSyncExternalStore } from "react";

/**
 * A parent's login in the lead cabinet whose access to every request ended
 * (the child came of age, a custody change, the contact was removed by
 * staff …) sees only the neutral notice of the cabinet (QA 2026-10-24,
 * B-2/D-4). `/me` does not say so; the cabinet knows it from
 * `GET /me/lead-requests` (`guardian_access_ended`) and tells the side bar,
 * which then shows no locked patient-portal entries. Kept per login for the
 * browser tab, like the account label, and never for another login.
 */
type Entry = { userId: string };

const listeners = new Set<() => void>();
let entry: Entry | null = null;

/** Marks (or, with `false`, unmarks) the login `userId` as one without an accessible request. */
export function setLeadPortalClosed(userId: string, closed: boolean) {
  const next = closed ? { userId } : null;
  if (!next && entry?.userId !== userId) return;
  if (next && entry?.userId === userId) return;
  entry = next;
  listeners.forEach((listener) => listener());
}

function currentEntry(): Entry | null {
  return entry;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the login `userId` reaches no request any more (the cabinet said so). */
export function useLeadPortalClosed(userId: string | null | undefined): boolean {
  const current = useSyncExternalStore(subscribe, currentEntry, currentEntry);
  return Boolean(userId && current?.userId === userId);
}
