import { PatientConsentsSection } from "@/pages/admin/ui/patient-consents-section";
import { PatientRecipientsSection } from "@/pages/admin/ui/patient-recipients-section";

/**
 * Consents and Art. 19 recipients of the selected patient. Both sections are
 * keyed by the patient so switching patients drops their local state; the keys
 * must differ between the two siblings. A shared key made React lose track of
 * the old consent section on re-render and leave stale, never-updated copies
 * (duplicate `consent-type`/`consent-note` ids) above the live one.
 *
 * `canViewConsents` shows the consent history (the CEO Assistant reads it,
 * QA 2026-10-12 B3-11); only `canManageConsents` offers grant and revoke.
 * `patientLabel` names the patient in the section and in the revoke dialog,
 * and `actionsDisabled` holds every action while the page has not loaded the
 * patient it shows (QA 2026-10-12 B3-02).
 */
export function PatientPrivacySections({
  patientId,
  patientLabel = "",
  canManageConsents,
  canViewConsents = canManageConsents,
  actionsDisabled = false,
}: {
  patientId: string;
  patientLabel?: string;
  canManageConsents: boolean;
  canViewConsents?: boolean;
  actionsDisabled?: boolean;
}) {
  return (
    <>
      {canViewConsents ? (
        <PatientConsentsSection
          key={`consents:${patientId}`}
          patientId={patientId}
          patientLabel={patientLabel}
          canManage={canManageConsents}
          actionsDisabled={actionsDisabled}
        />
      ) : null}
      {patientId ? (
        <PatientRecipientsSection key={`recipients:${patientId}`} patientId={patientId} />
      ) : null}
    </>
  );
}
