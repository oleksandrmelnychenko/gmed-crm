import { PatientConsentsSection } from "@/pages/admin/ui/patient-consents-section";
import { PatientRecipientsSection } from "@/pages/admin/ui/patient-recipients-section";

/**
 * Consents and Art. 19 recipients of the selected patient. Both sections are
 * keyed by the patient so switching patients drops their local state; the keys
 * must differ between the two siblings. A shared key made React lose track of
 * the old consent section on re-render and leave stale, never-updated copies
 * (duplicate `consent-type`/`consent-note` ids) above the live one.
 */
export function PatientPrivacySections({
  patientId,
  canManageConsents,
}: {
  patientId: string;
  canManageConsents: boolean;
}) {
  return (
    <>
      {canManageConsents ? (
        <PatientConsentsSection key={`consents:${patientId}`} patientId={patientId} />
      ) : null}
      {patientId ? (
        <PatientRecipientsSection key={`recipients:${patientId}`} patientId={patientId} />
      ) : null}
    </>
  );
}
