//! Whether the lead's patient form ("Patientenformular – Angaben und
//! Erklärungen", template `lead_self_disclosure`) must be signed before the
//! lead becomes a patient. Owner decision 2026-10-23: required in the first
//! onboarding package of a new patient, optional for repeat orders (a repeat
//! request of an existing patient). The signing presets, the onboarding
//! manifest, the conversion readiness and the wizard all ask this module.
use uuid::Uuid;

/// The document template of the patient form.
pub(crate) const TEMPLATE: &str = "lead_self_disclosure";

/// The binding key (`documents.generated_bindings`) of a patient form made
/// from the lead's data as GMED recorded them, without a cabinet submission
/// (owner decision 2026-10-23, "Angaben aufgenommen durch GMED"). Once the
/// lead sends the request through the cabinet, such a form no longer counts
/// as the signed patient form ([`status`]): staff make it anew from the
/// cabinet's data.
pub(crate) const RECORDED_BY_GMED_KEY: &str = "_recorded_by_gmed";

/// The rule itself: a lead that is not converted yet and is no repeat request
/// of an existing patient (`leads.repeat_patient_id`) is a new patient's first
/// onboarding, which needs the signed patient form.
pub(crate) fn required(
    converted_patient_id: Option<Uuid>,
    repeat_patient_id: Option<Uuid>,
) -> bool {
    converted_patient_id.is_none() && repeat_patient_id.is_none()
}

/// The patient form's place in the lead's onboarding.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Status {
    /// [`required`] for this lead.
    pub(crate) required: bool,
    /// A current signed patient form exists (QES result or paper scan).
    pub(crate) signed: bool,
}

/// [`Status`] of a lead; an unknown lead requires nothing.
pub(crate) async fn status(db: &gmed_db::DbPool, lead_id: Uuid) -> Result<Status, sqlx::Error> {
    let row: Option<(Option<Uuid>, Option<Uuid>, bool)> = sqlx::query_as(
        "SELECT l.converted_patient_id, l.repeat_patient_id,
                EXISTS(SELECT 1 FROM documents d
                       WHERE d.lead_id = l.id
                         AND d.generated_template_id = $2
                         AND d.status = 'active'
                         AND d.file_deleted_at IS NULL
                         AND d.signed_at IS NOT NULL
                         -- A form GMED recorded counts until the lead sends
                         -- the request through the cabinet.
                         AND NOT (l.portal_submitted_at IS NOT NULL
                                  AND COALESCE((d.generated_bindings ->> $3)::boolean, false)))
         FROM leads l WHERE l.id = $1",
    )
    .bind(lead_id)
    .bind(TEMPLATE)
    .bind(RECORDED_BY_GMED_KEY)
    .fetch_optional(db)
    .await?;
    Ok(
        row.map_or_else(Status::default, |(converted, repeat, signed)| Status {
            required: required(converted, repeat),
            signed,
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_new_patients_first_onboarding_requires_the_patient_form() {
        let patient = Some(Uuid::new_v4());
        assert!(required(None, None), "new patient, first onboarding");
        assert!(!required(None, patient), "repeat request of a patient");
        assert!(!required(patient, None), "already converted");
        assert!(!required(patient, patient));
    }
}
