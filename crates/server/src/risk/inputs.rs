//! Loads the [`Inputs`] of one lead in the caller's connection or transaction.
//!
//! The patient's and the third-party payer's countries come from
//! [`lead_enhanced_check::load_subjects`] (the same values the enhanced check
//! reads); the rest — answers, payer, orders, identity document, sanctions
//! hits — from one query here.

use sqlx::{PgConnection, Row};
use uuid::Uuid;

use super::Inputs;
use crate::routes::lead_enhanced_check;

/// Who a representative is for the release fingerprint
/// ([`super::RepresentativeInputs`]): the name, the date of birth, the
/// relation and a linked patient record of the trusted contact — another
/// person in the slot is reviewed again. Nothing staff or the parent enter
/// later counts: the ID-document data (`id_*`), the contract details of the
/// `lead_representatives` row (created by that entry), birth place, e-mail,
/// phone and address raise no trigger, so they must not void the release
/// (QA 2026-10-25, R-4; owner rule: only a new or a higher trigger re-opens
/// the review). Countries, an expired or unreadable document, a PEP or a
/// sanctions answer fire their own triggers.
pub(crate) fn risk_identity_material(contact: &serde_json::Value) -> serde_json::Value {
    const CONTACT: [&str; 5] = [
        "name",
        "relation",
        "birth_date",
        "date_of_birth",
        "related_patient_id",
    ];
    serde_json::Value::Object(
        CONTACT
            .iter()
            .filter_map(|key| {
                contact
                    .get(*key)
                    .filter(|value| !value.is_null())
                    .map(|value| ((*key).to_string(), value.clone()))
            })
            .collect(),
    )
}

/// Payer identity of an order: who it names (not the patient).
const ORDER_PAYER_SQL: &str = r#"COALESCE(
    'patient:' || o.payer_patient_id::text,
    'relation:' || o.payer_patient_relation_id::text,
    'email:' || lower(NULLIF(btrim(o.payer_contact_email), '')),
    'name:' || lower(NULLIF(btrim(o.payer_contact_name), ''))
)"#;

/// A sanctions hit (`h`) on the payer's side: the third-party payer and the
/// people behind it, the bank the payer pays through, the third-party
/// invoice recipient who does not pay (owner decisions 2026-10-11: the
/// recipient is a third party on the money side) and a free-text payer
/// contact staff named on one of the lead's orders (`payer_contact`,
/// 2026-10-12), and a minor's parent who pays, screened once as the guardian
/// with the payer role noted (2026-10-19,
/// [`crate::sanctions::screening::PAYING_REPRESENTATIVE_NOTE`]). Every
/// other hit of the lead — the patient, a guardian, the bank the patient pays
/// through — is the patient's side (T16).
///
/// Only a CONFIRMED hit counts (owner decision 2026-10-07, QA 2026-10-11
/// A-15/A-21/A-33): "under sanctions" means a match the CEO confirmed. An
/// open, undecided hit is the internal hold `sanctions_review_pending` of
/// [`crate::sanctions::gate`] only — it never raises the risk level, so it
/// never opens a follow-up block, the enhanced check or the payer's proof of
/// funds, and nothing the lead, the payer or the recipient sees changes.
pub(crate) const PAYER_SIDE_HIT_SQL: &str = "(h.subject_kind IN ('lead_payer', 'lead_recipient', 'payer_contact') \
     OR (h.subject_kind = 'lead_bank' AND h.subject_ref = 'payer-bank') \
     OR (h.subject_kind = 'lead_guardian' \
         AND (COALESCE(h.subject_snapshot->>'relation', '') = 'payer' \
              OR COALESCE(h.subject_snapshot->>'relation', '') LIKE '%; payer')))";

/// The inputs of a lead for the stored assessment; `None` when the lead does
/// not exist. The payer's statement counts only once sent (owner decision
/// 2026-10-25 «Рахувати лише відправлене»): an unsent draft is pending
/// ([`Inputs::pending_unsent`]).
pub async fn load(conn: &mut PgConnection, lead_id: Uuid) -> Result<Option<Inputs>, sqlx::Error> {
    load_inner(conn, lead_id, false).await
}

/// [`load`] with the payer's unsent draft as if it were sent: the payer
/// form's own preview ([`super::store::payer_form_preview`]), never stored.
/// The cabinet's unsent answers stay pending.
pub async fn load_with_payer_draft(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<Inputs>, sqlx::Error> {
    load_inner(conn, lead_id, true).await
}

async fn load_inner(
    conn: &mut PgConnection,
    lead_id: Uuid,
    payer_draft: bool,
) -> Result<Option<Inputs>, sqlx::Error> {
    let subjects = if payer_draft {
        lead_enhanced_check::load_subjects_with_payer_draft(conn, lead_id).await?
    } else {
        lead_enhanced_check::load_subjects(conn, lead_id).await?
    };
    let Some(subjects) = subjects else {
        return Ok(None);
    };
    let row = sqlx::query(&format!(
        r#"SELECT l.date_of_birth,
                  g.former_citizenships, g.has_representative, g.under_guardianship,
                  g.pep_self, g.pep_related, g.sanctions_links, g.id_document_unreadable,
                  g.id_valid_until,
                  d.payer_kind, d.payer_type, d.relationship_kind, d.payment_method,
                  d.via_third_party, d.via_third_party_kind,
                  s.pep_self AS statement_pep_self,
                  s.pep_related AS statement_pep_related,
                  s.sanctions_links AS statement_sanctions_links,
                  -- The payer link's statement not sent yet (a draft, also
                  -- one staff reopened) and what of it the payer answered.
                  (s.lead_id IS NOT NULL AND s.submitted_at IS NULL) AS statement_draft,
                  (s.country IS NOT NULL OR s.habitual_residence_country IS NOT NULL
                   OR COALESCE(cardinality(s.citizenships), 0) > 0) AS statement_countries,
                  -- Section 8 as the payer link last wrote it (a digest).
                  s.payment_route_marker AS statement_route_marker,
                  -- What the cabinet sent last: the request's submit or the
                  -- follow-up's (`follow_up_answered_at`, cleared by a
                  -- "request more"; its history keeps the time).
                  GREATEST(
                      l.portal_submitted_at,
                      ra.follow_up_answered_at,
                      (SELECT max(e.at) FROM lead_risk_events e
                       WHERE e.lead_id = l.id AND e.kind = 'follow_up_answered')
                  ) AS follow_up_sent_at,
                  l.portal_field_updates,
                  (SELECT max(r.updated_at) FROM lead_representatives r
                   JOIN users ru ON ru.id = r.updated_by
                   WHERE r.lead_id = l.id AND ru.role <> 'patient') AS representatives_staff_at,
                  (
                      EXISTS (
                          SELECT 1 FROM lead_portal_uploads u
                          JOIN documents doc ON doc.id = u.document_id
                          WHERE u.lead_id = l.id AND u.kind = 'identity'
                            AND u.withdrawn_at IS NULL AND doc.file_deleted_at IS NULL
                      )
                      OR EXISTS (
                          SELECT 1 FROM documents doc
                          WHERE (doc.lead_id = l.id
                                 OR (l.prospect_patient_id IS NOT NULL
                                     AND doc.patient_id = l.prospect_patient_id))
                            AND doc.status = 'active'
                            AND doc.file_deleted_at IS NULL
                            AND doc.compliance_kind = 'identity'
                      )
                  ) AS identity_on_file,
                  COALESCE(hits.patient_hit, false) AS patient_hit,
                  COALESCE(hits.payer_hit, false) AS payer_hit,
                  COALESCE(hits.recipient_hit, false) AS recipient_hit,
                  COALESCE(lead_orders.order_payers, 0) AS order_payers
           FROM leads l
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           LEFT JOIN lead_payer_declarations d ON d.lead_id = l.id
           LEFT JOIN lead_payer_statements s ON s.lead_id = l.id
           LEFT JOIN lead_risk_assessments ra ON ra.lead_id = l.id
           LEFT JOIN LATERAL (
               SELECT bool_or(NOT {PAYER_SIDE_HIT_SQL}) AS patient_hit,
                      bool_or({PAYER_SIDE_HIT_SQL} AND h.subject_kind <> 'lead_recipient')
                          AS payer_hit,
                      bool_or(h.subject_kind = 'lead_recipient') AS recipient_hit
               FROM sanctions_hits h
               WHERE h.status = 'confirmed'
                 AND ((h.lead_id = l.id AND h.subject_kind <> 'patient')
                      OR (h.subject_kind = 'patient'
                          AND h.patient_id IN (l.prospect_patient_id, l.converted_patient_id)))
           ) hits ON true
           LEFT JOIN LATERAL (
               SELECT count(DISTINCT {ORDER_PAYER_SQL}) AS order_payers
               FROM orders o
               WHERE o.source_lead_id = l.id AND o.status <> 'cancelled'
           ) lead_orders ON true
           WHERE l.id = $1"#
    ))
    .bind(lead_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let text = |column: &str| row.try_get::<Option<String>, _>(column).ok().flatten();
    let flag = |column: &str| {
        row.try_get::<Option<bool>, _>(column)
            .ok()
            .flatten()
            .unwrap_or(false)
    };
    let today = crate::app_time::today();
    let third_party =
        text("payer_kind").as_deref() == Some(crate::routes::lead_payer::PAYER_KIND_THIRD_PARTY);
    let payer_type = text("payer_type").filter(|_| third_party);
    let active = crate::routes::lead_representatives::load(conn, lead_id)
        .await?
        .unwrap_or_default();
    let canonical = crate::services::lead_guardian_identity::load(conn, lead_id).await?;
    let representatives = active.representation.representatives.iter()
        .filter(|person| person.slot.is_some())
        .map(|person| {
            use sha2::{Digest, Sha256};
            let identity = canonical.iter().find(|identity| identity.contact_id == Some(person.id));
            let citizenships = identity.map(|identity| identity.citizenships.clone()).unwrap_or_else(|| person.extras.citizenships.clone());
            let residences = identity.map(|identity| identity.residences.clone()).unwrap_or_else(|| person.extras.country.clone().into_iter().collect());
            let fallback = serde_json::json!({"id":person.id,"name":person.name(),"citizenships":citizenships,"residences":residences});
            let legacy = identity.map(|identity| serde_json::json!({"contact":identity.contact,"extras":identity.extras}))
                .unwrap_or(fallback);
            let material = identity.map(|identity| risk_identity_material(&identity.contact))
                .unwrap_or_else(|| serde_json::json!({"id":person.id,"name":person.name()}));
            super::RepresentativeInputs {
                id: person.id, name: person.name(), citizenships, residences,
                fields: crate::routes::lead_representatives::representative_question_fields(&person.extras),
                identity_fingerprint: hex::encode(Sha256::digest(material.to_string().as_bytes())),
                legacy_identity_fingerprint: hex::encode(Sha256::digest(legacy.to_string().as_bytes())),
            }
        }).collect();
    let pending_unsent = pending_cabinet(conn, lead_id, &row, &active).await?;
    // The payer link's statement counts once sent (submit), also its PEP and
    // sanctions answers; the preview of the payer form counts the draft.
    let statement_draft = third_party && flag("statement_draft");
    let statement_counts = payer_draft || !statement_draft;
    let mut inputs = Inputs {
        representatives,
        patient_citizenships: subjects.patient_citizenships,
        former_citizenships: row
            .try_get::<Option<Vec<String>>, _>("former_citizenships")
            .ok()
            .flatten()
            .unwrap_or_default(),
        patient_residences: subjects.patient_residence,
        third_party,
        payer_type,
        relationship_kind: text("relationship_kind").filter(|_| third_party),
        payer_citizenships: subjects.payer_citizenships,
        payer_residences: subjects.payer_residence,
        via_third_party_person: flag("via_third_party")
            && text("via_third_party_kind").as_deref() == Some("person"),
        order_payers: usize::try_from(row.try_get::<i64, _>("order_payers").unwrap_or(0))
            .unwrap_or(0),
        payment_method: text("payment_method"),
        identity_document_on_file: flag("identity_on_file"),
        id_document_unreadable: flag("id_document_unreadable"),
        id_valid_until: row.try_get("id_valid_until").ok().flatten(),
        minor: crate::routes::leads::is_minor_on(
            row.try_get("date_of_birth").ok().flatten(),
            today,
        ),
        has_representative: flag("has_representative"),
        under_guardianship: flag("under_guardianship"),
        patient_pep: flag("pep_self") || flag("pep_related"),
        payer_pep: third_party
            && statement_counts
            && (flag("statement_pep_self") || flag("statement_pep_related")),
        patient_sanctions_links: flag("sanctions_links"),
        payer_sanctions_links: third_party && statement_counts && flag("statement_sanctions_links"),
        patient_hit: flag("patient_hit"),
        // A hit of the invoice recipient is the payer's side even while the
        // patient pays: the recipient is a third party on the money side.
        // A paying parent or a payer changed since: a confirmed hit counts all the same.
        payer_hit: flag("payer_hit") || flag("recipient_hit"),
        recipient_hit_only: flag("recipient_hit") && !flag("payer_hit"),
        // A confirmation is final: its T16 stays even when the subject no
        // longer fires (e.g. the patient took over the payment).
        confirmed_hit_patient: flag("patient_hit"),
        confirmed_hit_payer: flag("payer_hit") || flag("recipient_hit"),
        today: Some(today),
        pending_unsent,
    };
    // The payer triggers the link's unsent draft answers (owner decision
    // 2026-10-25 «Рахувати лише відправлене»): T6 (the payer's citizenship,
    // residence or seat), T14 (PEP), T15 (sanctions links) and — extended
    // 2026-10-26 — the payment route's T8 / T9 wait for the submit like the cabinet's unsent sections — the stored state stays as
    // after the last submit: a draft "yes" fires nothing, a draft "no"
    // withdraws nothing, and a "yes" corrected before the submit leaves no
    // trace. Only what the draft answers waits (a statement emptied for a new
    // payer holds nothing back). The payer form asks by the draft
    // ([`load_with_payer_draft`]).
    if !statement_counts {
        let answered = |column: &str| {
            row.try_get::<Option<bool>, _>(column)
                .ok()
                .flatten()
                .is_some()
        };
        let mut pending = Vec::new();
        if answered("statement_pep_self") || answered("statement_pep_related") {
            pending.push("T14");
        }
        if answered("statement_sanctions_links") {
            pending.push("T15");
        }
        // T6 also reads the declaration staff keep: only while that alone
        // does not fire it does the draft's country wait for the submit.
        if flag("statement_countries") {
            let config = super::store::load_config(conn).await?;
            if !super::evaluate(&inputs, &config)
                .iter()
                .any(|fired| fired.key == "T6" && fired.subject == PAYER)
            {
                pending.push("T6");
            }
        }
        // The payment route of section 8 (extended 2026-10-26): kept on the
        // declaration as the payer types it, it waits too while the stored
        // route is still the one the link wrote — a route staff changed
        // afterwards is staff's and counts at once. T9 reads the route alone;
        // T8 also reads the orders' payers staff keep, so it waits only while
        // those alone do not fire it.
        if let Some(marker) = text("statement_route_marker")
            && let Some(declaration) =
                crate::routes::lead_payer::load_declaration(conn, lead_id).await?
            && crate::routes::lead_payer_link::payment_route_marker(lead_id, &declaration) == marker
        {
            pending.push("T9");
            if inputs.order_payers < 2 {
                pending.push("T8");
            }
        }
        for key in pending {
            if !inputs.pending(key, PAYER) {
                inputs.pending_unsent.push((key, PAYER));
            }
        }
    }
    Ok(Some(inputs))
}

use super::{
    SUBJECT_PATIENT as PATIENT, SUBJECT_PAYER as PAYER, SUBJECT_REPRESENTATIVE as REPRESENTATIVE,
};

/// The triggers whose cabinet answers wait for the person's send (owner
/// decision 2026-10-25 «Рахувати лише відправлене», [`Inputs::pending_unsent`]).
///
/// A cabinet write leaves a marker in `leads.portal_field_updates` (when,
/// and for most sections a digest of the value). A section is unsent while
/// its marker is later than the last send — the request's submit or the
/// follow-up's (the cabinet shows the follow-up blocks a change brings at
/// once, so their send carries the change too, `cabinet::follow_up_json`).
/// Where the marker carries the value's digest, a later change by staff
/// makes the value staff's own and counts at once; the statements (PEP,
/// sanctions links, former citizenships, habitual residence) are written by
/// the cabinet only. The representatives' answers count at once again once
/// staff saved a representative after them.
///
/// The sources and what they feed:
/// * statements / extra step → T14, T15, T2, T3 of the patient;
/// * citizenships → T1, T3; residence (`country`) → T2 of the patient;
/// * who pays → T4–T7 and T8, T9; payment route (block C) → T8, T9;
/// * representation and a representative's questions (block R) → T1, T2,
///   T14, T15 of the representative.
///
/// T12, T13 and T16 are never pending: T12 and T13 are withdrawn as soon as
/// they no longer fire, T16 is a confirmed hit. The payer link's unsent
/// draft is added by [`load`] itself (the statement's `submitted_at`).
async fn pending_cabinet(
    conn: &mut PgConnection,
    lead_id: Uuid,
    row: &sqlx::postgres::PgRow,
    representation: &crate::routes::lead_representatives::Loaded,
) -> Result<Vec<(&'static str, &'static str)>, sqlx::Error> {
    use crate::routes::lead_portal_intake::{self as intake, marker_time, value_marker};
    use chrono::{DateTime, Utc};
    let follow_up_sent_at: Option<DateTime<Utc>> = row.try_get("follow_up_sent_at").ok().flatten();
    let markers: serde_json::Value = row
        .try_get::<Option<serde_json::Value>, _>("portal_field_updates")
        .ok()
        .flatten()
        .unwrap_or_default();
    let after = |at: Option<DateTime<Utc>>, sent_at: Option<DateTime<Utc>>| {
        at.is_some_and(|at| sent_at.is_none_or(|sent_at| at > sent_at))
    };
    // A paying parent's payment route saved after the send goes to GMED with
    // its save (owner 2026-10-26): never pending.
    // Staff's own entries in the client's form count at once (owner
    // 2026-10-29): only the client's changes wait for a send.
    let by_staff = |key: &str| {
        markers
            .get(key)
            .and_then(|marker| marker.get("kind"))
            .and_then(serde_json::Value::as_str)
            == Some("staff")
    };
    let unsent = |key: &str| {
        markers
            .get(key)
            .and_then(|marker| marker.get("sent_with_save"))
            .and_then(serde_json::Value::as_bool)
            != Some(true)
            && !by_staff(key)
            && after(marker_time(markers.get(key)), follow_up_sent_at)
    };
    let digest_matches = |key: &str, value: String| {
        markers
            .get(key)
            .and_then(|marker| marker.get("hash"))
            .and_then(serde_json::Value::as_str)
            == Some(value_marker(lead_id, key, Some(&value)).as_str())
    };
    let mut pending: Vec<(&'static str, &'static str)> = Vec::new();
    let mut add = |keys: &[&'static str], subject: &'static str| {
        for key in keys {
            if !pending.contains(&(*key, subject)) {
                pending.push((*key, subject));
            }
        }
    };
    if unsent(intake::STATEMENTS_MARKER) || unsent(intake::ENHANCED_DETAILS_MARKER) {
        add(&["T2", "T3", "T14", "T15"], PATIENT);
    }
    let personal = intake::unsent_personal_fields(
        conn,
        lead_id,
        follow_up_sent_at,
        &["citizenships", "country"],
    )
    .await?;
    if personal.contains(&"citizenships") {
        add(&["T1", "T3"], PATIENT);
    }
    if personal.contains(&"country") {
        add(&["T2"], PATIENT);
    }
    let declaration = crate::routes::lead_payer::load_declaration(conn, lead_id).await?;
    if let Some(declaration) = declaration.as_ref() {
        if unsent(intake::PAYER_MARKER)
            && digest_matches(
                intake::PAYER_MARKER,
                crate::routes::lead_payer::portal_marker_value(declaration),
            )
        {
            add(&["T4", "T5", "T6", "T7"], PAYER);
            add(&["T8", "T9"], PATIENT);
            add(&["T8", "T9"], PAYER);
        }
        if unsent(intake::BILLING_MARKER)
            && digest_matches(intake::BILLING_MARKER, declaration.billing_marker_value())
        {
            add(&["T8", "T9"], PATIENT);
            add(&["T8", "T9"], PAYER);
        }
    }
    let staff_saved_representative: Option<DateTime<Utc>> =
        row.try_get("representatives_staff_at").ok().flatten();
    let questions_at = marker_time(markers.get("representative_questions"));
    let questions_unsent = !by_staff("representative_questions")
        && after(questions_at, follow_up_sent_at)
        && questions_at
            .zip(staff_saved_representative)
            .is_none_or(|(answered, staff)| answered > staff);
    let representation_marker = crate::routes::lead_representatives::REPRESENTATION_MARKER;
    let representation_unsent = unsent(representation_marker)
        && digest_matches(
            representation_marker,
            crate::routes::lead_representatives::marker_value(representation),
        );
    if questions_unsent || representation_unsent {
        add(&["T1", "T2", "T14", "T15"], REPRESENTATIVE);
    }
    Ok(pending)
}

#[cfg(test)]
mod tests {
    use super::risk_identity_material;
    use serde_json::json;

    /// QA 2026-10-25, R-4: the parent's passport, contact and address
    /// entered after the CEO release change nothing the release fingerprint
    /// reads; another person in the slot does.
    #[test]
    fn only_who_the_representative_is_counts_for_the_release() {
        let contact = json!({
            "id": "c1", "name": "Olga Kindrisk", "relation": "mother",
            "birth_date": "1988-02-02", "email": "olga@example.test",
            "phone": "+49 30 1", "address": "Hauptstr. 1",
            "citizenships": ["IR"], "country": "DE",
        });
        let before = risk_identity_material(&contact);
        let mut reached = contact.clone();
        reached["email"] = json!("olga.k@example.test");
        reached["phone"] = json!("+49 30 2");
        reached["address"] = json!("Nebenstr. 2");
        // A country fires its own trigger (T1 / T2).
        reached["citizenships"] = json!(["IR", "SY"]);
        assert_eq!(risk_identity_material(&reached), before);
        let mut other_person = contact.clone();
        other_person["name"] = json!("Max Kindrisk");
        assert_ne!(risk_identity_material(&other_person), before);
        let mut other_birth = contact;
        other_birth["birth_date"] = json!("1987-01-01");
        assert_ne!(risk_identity_material(&other_birth), before);
    }
}
