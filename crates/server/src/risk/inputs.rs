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

/// Payer identity of an order: who it names (not the patient).
const ORDER_PAYER_SQL: &str = r#"COALESCE(
    'patient:' || o.payer_patient_id::text,
    'relation:' || o.payer_patient_relation_id::text,
    'email:' || lower(NULLIF(btrim(o.payer_contact_email), '')),
    'name:' || lower(NULLIF(btrim(o.payer_contact_name), ''))
)"#;

/// The inputs of a lead; `None` when the lead does not exist.
pub async fn load(conn: &mut PgConnection, lead_id: Uuid) -> Result<Option<Inputs>, sqlx::Error> {
    let Some(subjects) = lead_enhanced_check::load_subjects(conn, lead_id).await? else {
        return Ok(None);
    };
    let row = sqlx::query(&format!(
        r#"SELECT l.date_of_birth, l.prospect_patient_id, l.converted_patient_id,
                  g.former_citizenships, g.has_representative, g.under_guardianship,
                  g.pep_self, g.pep_related, g.sanctions_links, g.id_document_unreadable,
                  g.id_valid_until,
                  d.payer_kind, d.payer_type, d.relationship_kind, d.payment_method,
                  d.via_third_party, d.via_third_party_kind,
                  d.expected_total_eur::float8 AS expected_total_eur,
                  lower(NULLIF(btrim(d.email), '')) AS payer_email,
                  s.pep_self AS statement_pep_self,
                  s.pep_related AS statement_pep_related,
                  s.sanctions_links AS statement_sanctions_links,
                  s.estimated_total_eur::float8 AS statement_estimated_total_eur,
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
                  lead_orders.lead_value,
                  COALESCE(lead_orders.order_payers, 0) AS order_payers
           FROM leads l
           LEFT JOIN lead_gwg_declarations g ON g.lead_id = l.id
           LEFT JOIN lead_payer_declarations d ON d.lead_id = l.id
           LEFT JOIN lead_payer_statements s ON s.lead_id = l.id
           LEFT JOIN LATERAL (
               SELECT bool_or(h.subject_kind <> 'lead_payer') AS patient_hit,
                      bool_or(h.subject_kind = 'lead_payer') AS payer_hit
               FROM sanctions_hits h
               WHERE h.status IN ('open', 'confirmed')
                 AND ((h.lead_id = l.id AND h.subject_kind <> 'patient')
                      OR (h.subject_kind = 'patient'
                          AND h.patient_id IN (l.prospect_patient_id, l.converted_patient_id)))
           ) hits ON true
           LEFT JOIN LATERAL (
               SELECT max(COALESCE(order_service_total_gross(o.id), o.total_estimated))::float8
                          AS lead_value,
                      count(DISTINCT {ORDER_PAYER_SQL}) AS order_payers
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
    let amount = |column: &str| {
        row.try_get::<Option<f64>, _>(column)
            .ok()
            .flatten()
            .unwrap_or(0.0)
    };
    let today = crate::app_time::today();
    let third_party =
        text("payer_kind").as_deref() == Some(crate::routes::lead_payer::PAYER_KIND_THIRD_PARTY);
    let lead_value = amount("lead_value")
        .max(amount("statement_estimated_total_eur"))
        .max(amount("expected_total_eur"));
    let prospect: Option<Uuid> = row.try_get("prospect_patient_id").ok().flatten();
    let converted: Option<Uuid> = row.try_get("converted_patient_id").ok().flatten();
    let payer_email = text("payer_email");
    // T11: the other non-cancelled orders of the same payer created in the
    // last 365 days, each once, plus this lead's value.
    let others: Option<f64> = if third_party {
        match &payer_email {
            Some(email) => sqlx::query_scalar(
                r#"SELECT sum(COALESCE(order_service_total_gross(o.id), o.total_estimated))::float8
                       FROM orders o
                       WHERE o.status <> 'cancelled'
                         AND o.created_at >= now() - interval '365 days'
                         AND o.source_lead_id IS DISTINCT FROM $1
                         AND lower(btrim(o.payer_contact_email)) = $2"#,
            )
            .bind(lead_id)
            .bind(email)
            .fetch_one(&mut *conn)
            .await?,
            None => None,
        }
    } else {
        let patients: Vec<Uuid> = [prospect, converted].into_iter().flatten().collect();
        if patients.is_empty() {
            None
        } else {
            sqlx::query_scalar(
                r#"SELECT sum(COALESCE(order_service_total_gross(o.id), o.total_estimated))::float8
                   FROM orders o
                   WHERE o.status <> 'cancelled'
                     AND o.created_at >= now() - interval '365 days'
                     AND o.source_lead_id IS DISTINCT FROM $1
                     AND o.patient_id = ANY($2)
                     AND o.payer_patient_id IS NULL
                     AND o.payer_patient_relation_id IS NULL
                     AND NULLIF(btrim(o.payer_contact_email), '') IS NULL
                     AND NULLIF(btrim(o.payer_contact_name), '') IS NULL"#,
            )
            .bind(lead_id)
            .bind(&patients)
            .fetch_one(&mut *conn)
            .await?
        }
    };
    let payer_type = text("payer_type").filter(|_| third_party);
    let inputs = Inputs {
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
        lead_value_eur: lead_value,
        payer_year_sum_eur: others.unwrap_or(0.0) + lead_value,
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
        payer_pep: third_party && (flag("statement_pep_self") || flag("statement_pep_related")),
        patient_sanctions_links: flag("sanctions_links"),
        payer_sanctions_links: third_party && flag("statement_sanctions_links"),
        patient_hit: flag("patient_hit"),
        payer_hit: third_party && flag("payer_hit"),
        today: Some(today),
    };
    Ok(Some(inputs))
}
