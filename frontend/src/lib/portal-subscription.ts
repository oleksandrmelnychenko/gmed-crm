import type { PortalPatient } from "./portal-patient-context";

type PortalUser = { role: string; portal_mode?: "lead" | "patient" | null; patients?: PortalPatient[] };

/** Entitlements belong to the selected person, never to the whole family login. */
export function hasPortalSubscription(user: PortalUser | null, patientId: string | null): boolean {
  if (user?.role !== "patient") return true;
  if (user.portal_mode === "lead") return false;
  const patients = user.patients ?? [];
  const selected = patientId ? patients.find((patient) => patient.id === patientId)
    : patients.length === 1 ? patients[0] : undefined;
  return selected?.has_active_subscription === true;
}

/**
 * The selected person's subscription is paused (owner decision 2026-11-10):
 * new requests are closed, but the visits already booked, the subscriptions
 * page, the chat and the notifications stay open.
 */
export function isPortalSubscriptionPaused(user: PortalUser | null, patientId: string | null): boolean {
  if (user?.role !== "patient" || user.portal_mode === "lead") return false;
  const patients = user.patients ?? [];
  const selected = patientId ? patients.find((patient) => patient.id === patientId)
    : patients.length === 1 ? patients[0] : undefined;
  return selected?.has_active_subscription !== true && selected?.subscription_paused === true;
}

/**
 * What stays open during a pause besides the basic routes (the server allows the same).
 * `/services` shows the own requests read-only and lets the patient cancel an
 * open one; no new request (owner decision 2026-11-12).
 */
export function isPausedPortalRoute(pathname: string): boolean {
  return ["/appointments", "/services", "/subscriptions", "/chat", "/notifications"]
    .some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

export function isBasicPortalRoute(pathname: string): boolean {
  return ["/account", "/privacy", "/documents", "/invoices", "/legal", "/security", "/request", "/trusted-persons"]
    .some((root) => pathname === root || pathname.startsWith(`${root}/`));
}
