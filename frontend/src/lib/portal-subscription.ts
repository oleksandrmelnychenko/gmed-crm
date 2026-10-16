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

export function isBasicPortalRoute(pathname: string): boolean {
  return ["/account", "/privacy", "/documents", "/invoices", "/legal", "/security", "/request", "/trusted-persons"]
    .some((root) => pathname === root || pathname.startsWith(`${root}/`));
}
