export function buildPatientOrderCreateHref(patientId: string) {
  return `/orders?create=1&patient=${encodeURIComponent(patientId)}`;
}
