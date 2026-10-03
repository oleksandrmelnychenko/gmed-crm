//! What a completed electronic signature changes, in the archiving
//! transaction: the canonical signed bundle of a package, the signed state of
//! every covered document and the business records that depend on it (signed
//! framework contract, order signatures, consents, lead compliance).
//!
//! Effects are applied only for live, verified, current signatures, or when
//! staff accept a signature in review. Test (DEMO) signatures and withdrawn,
//! declined or expired requests never create them.
use super::*;
use crate::routes::documents::{
    DocumentSignatureRecord, DocumentSignatureRecordError, compliance_kind_for_signed_document,
    record_document_signature_tx,
};

type Tx<'a> = sqlx::Transaction<'a, sqlx::Postgres>;

fn database(_: sqlx::Error) -> &'static str {
    "signature_database_error"
}

const REVIEW_PREFIX: &str = "Prüfung erforderlich – ";

/// Visibility of a bundle: patient-visible only if every covered document is;
/// otherwise internal. Medical if any document is medical.
async fn bundle_classification(
    tx: &mut Tx<'_>,
    ids: &[Uuid],
) -> Result<(String, bool, Option<String>, Option<Uuid>, Option<Uuid>), &'static str> {
    let row = sqlx::query(
        r#"SELECT bool_and(visibility = 'patient_visible') AS all_patient_visible,
                  bool_or(is_medical) AS any_medical,
                  count(DISTINCT access_category) AS categories,
                  min(access_category) AS access_category,
                  count(DISTINCT order_id) FILTER (WHERE order_id IS NOT NULL) AS orders,
                  bool_or(order_id IS NULL) AS without_order,
                  (array_agg(order_id) FILTER (WHERE order_id IS NOT NULL))[1] AS order_id,
                  count(DISTINCT appointment_id) FILTER (WHERE appointment_id IS NOT NULL) AS appointments,
                  bool_or(appointment_id IS NULL) AS without_appointment,
                  (array_agg(appointment_id) FILTER (WHERE appointment_id IS NOT NULL))[1] AS appointment_id
           FROM documents WHERE id = ANY($1)"#,
    )
    .bind(ids)
    .fetch_one(&mut **tx)
    .await
    .map_err(database)?;
    let medical = row.get::<Option<bool>, _>("any_medical").unwrap_or(false);
    let visibility = if row
        .get::<Option<bool>, _>("all_patient_visible")
        .unwrap_or(false)
        && !medical
    {
        "patient_visible"
    } else {
        "internal"
    };
    let access_category = if medical {
        Some("medical".to_string())
    } else if row.get::<i64, _>("categories") == 1 {
        row.get("access_category")
    } else {
        Some("internal".to_string())
    };
    let order_id = (row.get::<i64, _>("orders") == 1
        && !row.get::<Option<bool>, _>("without_order").unwrap_or(true))
    .then(|| row.get::<Option<Uuid>, _>("order_id"))
    .flatten();
    let appointment_id = (row.get::<i64, _>("appointments") == 1
        && !row
            .get::<Option<bool>, _>("without_appointment")
            .unwrap_or(true))
    .then(|| row.get::<Option<Uuid>, _>("appointment_id"))
    .flatten();
    Ok((
        visibility.to_string(),
        medical,
        access_category,
        order_id,
        appointment_id,
    ))
}

/// Stores the signed package once, as its own document. The members keep their
/// own rows and link to it (with the page range that holds them); the signed
/// PDF is never split, because an extract would no longer carry the signature.
///
/// Access follows the strictest member: any member's record-level deny applies
/// to the bundle, a record-level allow only if every member has it.
#[allow(clippy::too_many_arguments)]
pub(super) async fn insert_bundle_document(
    tx: &mut Tx<'_>,
    request: &PgRow,
    entries: &[BundleEntry],
    result_id: Uuid,
    publish: bool,
    test_mode: bool,
    file_size: i64,
    storage_key: &str,
    signed_at: DateTime<Utc>,
) -> Result<(), &'static str> {
    let ids: Vec<Uuid> = entries.iter().map(|entry| entry.document_id).collect();
    let (visibility, medical, access_category, order_id, appointment_id) =
        bundle_classification(tx, &ids).await?;
    let prefix = if test_mode {
        "TEST – "
    } else if !publish {
        REVIEW_PREFIX
    } else {
        ""
    };
    let name = format!(
        "{prefix}Signiertes Dokumentenpaket ({} Dokumente)",
        entries.len()
    );
    sqlx::query(
        r#"INSERT INTO documents (
               id, patient_id, lead_id, order_id, appointment_id, auto_name, original_filename,
               art, category, status, visibility, is_medical, mime_type, file_size, storage_key,
               ursprung, document_direction, document_variant, access_category, document_date,
               version_root_document_id, version_number, uploaded_by, signed_at, signed_by)
           SELECT $2, patient_id, lead_id, $3, $4, $5, 'signed-package.pdf',
                  CASE WHEN $6 THEN 'signed_document_package' ELSE 'signature_evidence' END,
                  'signature', 'active', CASE WHEN $6 THEN $7 ELSE 'internal' END, $8,
                  'application/pdf', $9, $10, 'electronic_signature_package', 'outgoing',
                  'original', $11, (now() AT TIME ZONE 'Europe/Berlin')::date,
                  $2, 1, $12, CASE WHEN $6 THEN $13::timestamptz ELSE NULL END, NULL
           FROM documents WHERE id = $1"#,
    )
    .bind(ids[0])
    .bind(result_id)
    .bind(order_id)
    .bind(appointment_id)
    .bind(&name)
    .bind(publish)
    .bind(&visibility)
    .bind(medical)
    .bind(file_size)
    .bind(storage_key)
    .bind(access_category)
    .bind(request.get::<Uuid, _>("requested_by"))
    .bind(signed_at)
    .execute(&mut **tx)
    .await
    .map_err(database)?;
    copy_strictest_access_rules(tx, &ids, result_id).await
}

async fn copy_strictest_access_rules(
    tx: &mut Tx<'_>,
    ids: &[Uuid],
    result_id: Uuid,
) -> Result<(), &'static str> {
    let members = ids.len() as i64;
    sqlx::query(
        r#"INSERT INTO staff_user_access_rules(
               user_id, granted_for_role, resource_type, scope_type, resource_id, capability,
               effect, reason, granted_by, valid_from, valid_until)
           SELECT user_id, min(granted_for_role), 'document', 'record', $2, capability,
                  CASE WHEN bool_or(effect = 'deny') THEN 'deny' ELSE 'allow' END,
                  'Signed package: strictest rule of its documents',
                  (array_agg(granted_by ORDER BY (effect = 'deny') DESC, created_at))[1],
                  CASE WHEN bool_or(effect = 'deny')
                       THEN min(valid_from) FILTER (WHERE effect = 'deny')
                       ELSE max(valid_from) END,
                  CASE WHEN bool_or(effect = 'deny')
                       THEN CASE WHEN bool_or(effect = 'deny' AND valid_until IS NULL) THEN NULL
                                 ELSE max(valid_until) FILTER (WHERE effect = 'deny') END
                       ELSE min(valid_until) END
           FROM staff_user_access_rules
           WHERE resource_type = 'document' AND scope_type = 'record'
             AND resource_id = ANY($1) AND revoked_at IS NULL
           GROUP BY user_id, capability
           HAVING bool_or(effect = 'deny')
               OR count(DISTINCT resource_id) FILTER (WHERE effect = 'allow') = $3"#,
    )
    .bind(ids)
    .bind(result_id)
    .bind(members)
    .execute(&mut **tx)
    .await
    .map_err(database)?;
    sqlx::query(
        r#"INSERT INTO staff_access_profile_rules(
               profile_id, resource_type, scope_type, resource_id, capability, effect, created_by)
           SELECT profile_id, 'document', 'record', $2, capability,
                  CASE WHEN bool_or(effect = 'deny') THEN 'deny' ELSE 'allow' END,
                  (array_agg(created_by ORDER BY (effect = 'deny') DESC))[1]
           FROM staff_access_profile_rules
           WHERE resource_type = 'document' AND scope_type = 'record' AND resource_id = ANY($1)
           GROUP BY profile_id, capability
           HAVING bool_or(effect = 'deny')
               OR count(DISTINCT resource_id) FILTER (WHERE effect = 'allow') = $3"#,
    )
    .bind(ids)
    .bind(result_id)
    .bind(members)
    .execute(&mut **tx)
    .await
    .map_err(database)?;
    Ok(())
}

/// Signers of the patient side as consent evidence (Art. 7 Abs. 1 DSGVO).
fn patient_signers(evidence: &Value) -> Vec<Value> {
    evidence["signatures"]
        .as_array()
        .map(|signatures| {
            signatures
                .iter()
                .filter(|signature| {
                    signature["role"]
                        .as_str()
                        .is_some_and(provider::is_patient_side)
                })
                .map(|signature| {
                    json!({
                        "email": signature["email"],
                        "role": signature["role"],
                        "signed_at": signature["signed_at"],
                        "signature_id": signature["signature_id"],
                        "quality": signature["quality"],
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn signed_role(evidence: &Value, role: &str) -> bool {
    evidence["signatures"].as_array().is_some_and(|signatures| {
        signatures
            .iter()
            .any(|signature| signature["role"] == role && signature["status"] == "SIGNED")
    })
}

/// Applies the legal effects of a signed request in the caller's transaction.
/// A single document's signed version is `result_id`; a package's documents
/// are the members themselves, each marked signed in place and linked to the
/// bundle. Idempotent per request.
pub(super) async fn apply(
    tx: &mut Tx<'_>,
    request: &PgRow,
    entries: &[BundleEntry],
    result_id: Uuid,
    signed_at: DateTime<Utc>,
    evidence: &Value,
) -> Result<(), &'static str> {
    let request_id: Uuid = request.get("id");
    let already: Option<DateTime<Utc>> = sqlx::query_scalar(
        "SELECT effects_applied_at FROM document_signature_requests WHERE id=$1",
    )
    .bind(request_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(database)?;
    if already.is_some() {
        return Ok(());
    }
    let targets: Vec<Uuid> = if entries.len() > 1 {
        entries.iter().map(|entry| entry.document_id).collect()
    } else {
        vec![result_id]
    };
    let context = json!({
        "source": "electronic_signature",
        "signature_request_id": request_id,
        "provider_request_id": evidence["request_id"],
        "level": request_level(request).as_str(),
        "signed_document_id": result_id,
        "signers": patient_signers(evidence),
    });
    let client_signed = signed_role(evidence, "client");
    let agency_signed = signed_role(evidence, "agency");
    for document_id in targets {
        apply_one(
            tx,
            request,
            document_id,
            result_id,
            signed_at,
            &context,
            client_signed,
            agency_signed,
        )
        .await?;
    }
    sqlx::query("UPDATE document_signature_requests SET effects_applied_at=now() WHERE id=$1")
        .bind(request_id)
        .execute(&mut **tx)
        .await
        .map_err(database)?;
    Ok(())
}

/// The signed document the business effects are derived from.
#[derive(Clone, Copy)]
pub(super) struct SignedDocument<'a> {
    pub(super) document_id: Uuid,
    pub(super) template: Option<&'a str>,
    pub(super) art: &'a str,
    pub(super) patient_id: Option<Uuid>,
    pub(super) lead_id: Option<Uuid>,
    pub(super) order_id: Option<Uuid>,
}

/// How the signature was given, for the audit trail of its effects.
pub(super) struct SignatureSource {
    /// `electronic_signature` or `paper_signature`.
    pub(super) name: &'static str,
    pub(super) request_id: Option<Uuid>,
    /// The staff member who recorded a paper signature; `None` for an
    /// electronic one, whose signers are external.
    pub(super) actor: Option<Uuid>,
}

/// What a signed document means for the records around it, whichever way it
/// was signed: a framework contract becomes signed, a single order records
/// which parties signed. The details of what changed are added to `effects`.
pub(super) async fn apply_business_effects(
    tx: &mut Tx<'_>,
    document: &SignedDocument<'_>,
    signed_at: DateTime<Utc>,
    source: &SignatureSource,
    client_signed: bool,
    agency_signed: bool,
    effects: &mut Value,
) -> Result<(), &'static str> {
    let SignedDocument {
        document_id,
        template,
        art,
        patient_id,
        lead_id,
        order_id,
    } = *document;
    if template == Some("framework_contract") || art == "framework_contract" {
        let contract_id: Option<Uuid> = sqlx::query_scalar(
            r#"SELECT COALESCE(
                   (SELECT o.contract_id FROM orders o WHERE o.id = $1),
                   (SELECT fc.id FROM framework_contracts fc
                    WHERE $1::uuid IS NULL
                      AND (($2::uuid IS NOT NULL AND fc.patient_id = $2)
                           OR ($2::uuid IS NULL AND $3::uuid IS NOT NULL AND fc.lead_id = $3))
                    ORDER BY fc.created_at DESC, fc.id DESC LIMIT 1))"#,
        )
        .bind(order_id)
        .bind(patient_id)
        .bind(lead_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(database)?;
        if let Some(contract_id) = contract_id {
            let updated = sqlx::query(
                r#"UPDATE framework_contracts
                   SET status = 'signed', signed_at = COALESCE(signed_at, $2)
                   WHERE id = $1 AND status IN ('draft', 'sent')
                   RETURNING patient_id"#,
            )
            .bind(contract_id)
            .bind(signed_at)
            .fetch_optional(&mut **tx)
            .await
            .map_err(database)?;
            if let Some(updated) = updated {
                if let Some(patient) = updated.get::<Option<Uuid>, _>("patient_id") {
                    crate::routes::contracts::sync_patient_contract_status_tx(tx, patient)
                        .await
                        .map_err(database)?;
                }
                audit::write_in_transaction(
                    tx,
                    &audit::domain_event(
                        "update_framework_contract_status",
                        source.actor,
                        "framework_contract",
                        Some(contract_id),
                        json!({"status":"signed","signed_at":signed_at.to_rfc3339(),
                            "source":source.name,"request_id":source.request_id,
                            "document_id":document_id}),
                    ),
                )
                .await
                .map_err(database)?;
                effects["framework_contract_id"] = json!(contract_id);
            }
        }
    }
    if template == Some("single_order")
        && let Some(order_id) = order_id
        && (client_signed || agency_signed)
    {
        let order = sqlx::query(
            r#"UPDATE orders
               SET signed_patient = signed_patient OR $2,
                   signed_agency = signed_agency OR $3,
                   signed_patient_at = CASE WHEN $2 AND NOT signed_patient THEN $4 ELSE signed_patient_at END,
                   signed_agency_at = CASE WHEN $3 AND NOT signed_agency THEN $4 ELSE signed_agency_at END,
                   signed_at = CASE WHEN (signed_patient OR $2) AND (signed_agency OR $3)
                                    THEN COALESCE(signed_at, $4) ELSE signed_at END,
                   updated_at = now()
               WHERE id = $1
               RETURNING signed_patient, signed_agency"#,
        )
        .bind(order_id)
        .bind(client_signed)
        .bind(agency_signed)
        .bind(signed_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(database)?;
        if let Some(order) = order {
            effects["order_id"] = json!(order_id);
            effects["order_signed_patient"] = json!(order.get::<bool, _>("signed_patient"));
            effects["order_signed_agency"] = json!(order.get::<bool, _>("signed_agency"));
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn apply_one(
    tx: &mut Tx<'_>,
    request: &PgRow,
    document_id: Uuid,
    result_id: Uuid,
    signed_at: DateTime<Utc>,
    consent_context: &Value,
    client_signed: bool,
    agency_signed: bool,
) -> Result<(), &'static str> {
    let request_id: Uuid = request.get("id");
    let requested_by: Uuid = request.get("requested_by");
    let document = sqlx::query(
        "SELECT id, patient_id, lead_id, order_id, generated_template_id, art, compliance_kind
         FROM documents WHERE id=$1 FOR UPDATE",
    )
    .bind(document_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(database)?;
    let template: Option<String> = document.get("generated_template_id");
    let art: String = document.get("art");
    let patient_id: Option<Uuid> = document.get("patient_id");
    let lead_id: Option<Uuid> = document.get("lead_id");
    let order_id: Option<Uuid> = document.get("order_id");
    let kind = compliance_kind_for_signed_document(template.as_deref(), &art);
    match kind {
        Some(kind) => {
            match record_document_signature_tx(
                tx,
                &DocumentSignatureRecord {
                    document_id,
                    patient_id,
                    lead_id,
                    compliance_kind: kind,
                    signed_at,
                    signed_by: None,
                    actor_id: requested_by,
                    consent_context: consent_context.clone(),
                    converted_lead_is_error: false,
                },
            )
            .await
            {
                Ok(_) => {}
                Err(DocumentSignatureRecordError::ConvertedLead) => {}
                Err(DocumentSignatureRecordError::Database(_)) => {
                    return Err("signature_database_error");
                }
            }
        }
        None => {
            sqlx::query(
                "UPDATE documents SET signed_at=$2, signed_by=NULL,
                        status=CASE WHEN status='draft' THEN 'active' ELSE status END, updated_at=now()
                 WHERE id=$1",
            )
            .bind(document_id)
            .bind(signed_at)
            .execute(&mut **tx)
            .await
            .map_err(database)?;
        }
    }
    let mut effects = json!({
        "request_id": request_id,
        "signed_document_id": result_id,
        "compliance_kind": kind,
        "level": request_level(request).as_str(),
    });
    apply_business_effects(
        tx,
        &SignedDocument {
            document_id,
            template: template.as_deref(),
            art: &art,
            patient_id,
            lead_id,
            order_id,
        },
        signed_at,
        &SignatureSource {
            name: "electronic_signature",
            request_id: Some(request_id),
            actor: None,
        },
        client_signed,
        agency_signed,
        &mut effects,
    )
    .await?;
    audit::write_in_transaction(
        tx,
        &audit::domain_event(
            "document_signature_effects_applied",
            None,
            "document",
            Some(document_id),
            effects,
        ),
    )
    .await
    .map_err(database)
}

/// A signature in review is accepted: the archived result becomes the
/// operational signed document and the effects follow. The result keeps its
/// own place (it does not become a new version of a source that changed).
pub(super) async fn promote(tx: &mut Tx<'_>, request: &PgRow) -> Result<(), &'static str> {
    let result_id: Uuid = request
        .get::<Option<Uuid>, _>("result_document_id")
        .ok_or("signature_result_missing")?;
    if request.get::<bool, _>("test_mode") {
        return Ok(());
    }
    let signed_at: DateTime<Utc> = request
        .get::<Option<DateTime<Utc>>, _>("signed_at")
        .unwrap_or_else(Utc::now);
    let entries = bundle_entries(&mut **tx, request).await.map_err(database)?;
    if entries.len() > 1 {
        let ids: Vec<Uuid> = entries.iter().map(|entry| entry.document_id).collect();
        let (visibility, _, _, _, _) = bundle_classification(tx, &ids).await?;
        sqlx::query(
            r#"UPDATE documents
               SET art = 'signed_document_package', visibility = $2,
                   auto_name = regexp_replace(auto_name, '^' || $3, ''),
                   signed_at = $4, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(result_id)
        .bind(visibility)
        .bind(REVIEW_PREFIX)
        .bind(signed_at)
        .execute(&mut **tx)
        .await
        .map_err(database)?;
    } else {
        sqlx::query(
            r#"UPDATE documents result
               SET art = source.art, generated_template_id = source.generated_template_id,
                   visibility = source.visibility,
                   auto_name = regexp_replace(result.auto_name, '^' || $3, ''),
                   signed_at = $4, updated_at = now()
               FROM documents source
               WHERE result.id = $1 AND source.id = $2"#,
        )
        .bind(result_id)
        .bind(entries[0].document_id)
        .bind(REVIEW_PREFIX)
        .bind(signed_at)
        .execute(&mut **tx)
        .await
        .map_err(database)?;
    }
    let evidence: Value = request.get("evidence");
    apply(tx, request, &entries, result_id, signed_at, &evidence).await
}
