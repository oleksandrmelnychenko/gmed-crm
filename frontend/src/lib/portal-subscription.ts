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
 * The only portal page that needs the order tariff (owner decision 9,
 * 2026-11-13): the team chat. Without a tariff the portal shows everything
 * of the own orders — visits, services already booked, notifications,
 * documents, invoices; a new concierge request is closed inside the services
 * page. A pause keeps the chat open (owner decision 2026-11-10). The server
 * allows the same.
 */
export function isTariffPortalRoute(pathname: string): boolean {
  return ["/chat"].some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

/** The chat (the tariff page) is closed for the selected person. */
export function isPortalRouteLocked(user: PortalUser | null, patientId: string | null, pathname: string): boolean {
  if (user?.role !== "patient" || user.portal_mode === "lead") return false;
  if (!isTariffPortalRoute(pathname)) return false;
  return !hasPortalSubscription(user, patientId) && !isPortalSubscriptionPaused(user, patientId);
}

/** A new concierge request needs an active tariff (not a paused one). */
export function canRequestPortalService(user: PortalUser | null, patientId: string | null): boolean {
  return hasPortalSubscription(user, patientId);
}
