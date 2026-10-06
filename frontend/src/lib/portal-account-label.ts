import { useSyncExternalStore } from "react";

/**
 * What the side bar calls a portal login when the role name does not fit: a
 * parent's login in the lead cabinet fills in the request for a child and is
 * no patient ("Elternteil / gesetzliche Vertretung"). `/me` does not say so;
 * the lead cabinet knows it from the login's requests (`access_kind`) and sets
 * the label in its own language. It is kept per user for the browser tab, so
 * the account page shows it after a reload as well, and never for another
 * login.
 */
type Entry = { userId: string; label: string };

const STORAGE_KEY = "gmed-portal-account-label";

const listeners = new Set<() => void>();
let entry: Entry | null = readStored();

function readStored(): Entry | null {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Entry> | null;
    return typeof value?.userId === "string" && typeof value.label === "string" && value.label.trim()
      ? { userId: value.userId, label: value.label }
      : null;
  } catch {
    return null;
  }
}

function store(next: Entry | null) {
  try {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Without storage the label lasts until the next reload.
  }
}

/** Sets (or, with `null`, clears) the label of the login `userId`. */
export function setPortalAccountLabel(userId: string, label: string | null) {
  const text = label?.trim() ?? "";
  const next = text ? { userId, label: text } : null;
  if (!next && entry?.userId !== userId) return;
  if (next && entry?.userId === next.userId && entry.label === next.label) return;
  entry = next;
  store(next);
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

/** The label of the login `userId`; null when none is set (the role name applies). */
export function usePortalAccountLabel(userId: string | null | undefined): string | null {
  const current = useSyncExternalStore(subscribe, currentEntry, currentEntry);
  return userId && current?.userId === userId ? current.label : null;
}
