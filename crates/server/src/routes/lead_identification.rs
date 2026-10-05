//! Identification of a lead's contract partners by qualified electronic
//! signature (§ 12 Abs. 1 GwG, owner decision 2026-10-05).
//!
//! A completed qualified electronic signature (QES) of the person counts as
//! the verification of the identity. The law adds two conditions: the
//! signature is validated (the provider does that before a request counts as
//! completed) and a payment arrives directly from a payment account in that
//! person's own name. Staff confirm that payment by hand: one mark per person
//! with who and when (`lead_identification_payments`).
//!
//! Two persons per lead: the patient (`contract_partner`, signer role
//! `client`) and, when somebody else pays, the third-party payer (`payer`,
//! signer role `payer`). The status is information only — the lead wizard and
//! the identification sheet show it, nothing is blocked by it. See
//! `docs/architecture/gwg-identification-sheet_ua.md`.

use axum::{
    Json, Router,
    extract::{Extension, Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use uuid::Uuid;

use crate::audit;
use crate::auth::middleware::AuthUser;
use crate::routes::lead_payer;
use crate::state::AppState;
use gmed_domain::access::capabilities::Capability;

pub const SUBJECT_CONTRACT_PARTNER: &str = "contract_partner";
pub const SUBJECT_PAYER: &str = "payer";

/// Signer roles of a signature request: the patient side and the payer.
const SIGNER_ROLE_CLIENT: &str = "client";
const SIGNER_ROLE_PAYER: &str = "payer";

const NOTE_MAX: usize = 500;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/leads/{lead_id}/identification-status",
            get(get_identification_status),
        )
        .route(
            "/leads/{lead_id}/identification-status/{subject}/own-account-payment",
            post(set_own_account_payment),
        )
}

// ----------------------------------------------------------------------------
// Status
// ----------------------------------------------------------------------------

/// The qualified electronic signature of one person.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct QualifiedSignature {
    pub signed_at: DateTime<Utc>,
    /// Signed on the provider's demo account: shown, but no legal evidence.
    pub test_mode: bool,
}

/// Staff's confirmation of the payment from the person's own account.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OwnAccountPayment {
    pub confirmed_at: DateTime<Utc>,
    pub confirmed_by: Option<Uuid>,
    pub confirmed_by_name: Option<String>,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct PersonIdentification {
    pub qes: Option<QualifiedSignature>,
    pub own_account_payment: Option<OwnAccountPayment>,
}

impl PersonIdentification {
    fn to_json(&self) -> Value {
        json!({
            "qes": self.qes.map(|signature| json!({
                "signed_at": signature.signed_at.to_rfc3339(),
                "test_mode": signature.test_mode,
            })),
            "own_account_payment": self.own_account_payment.as_ref().map(|payment| json!({
                "confirmed_at": payment.confirmed_at.to_rfc3339(),
                "confirmed_by_name": payment.confirmed_by_name,
                "note": payment.note,
            })),
        })
    }
}

/// The identification state of a lead: the patient and, only when the payer
/// declaration names a third party, the payer.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct IdentificationStatus {
    pub contract_partner: PersonIdentification,
    pub payer: Option<PersonIdentification>,
}

impl IdentificationStatus {
    fn to_json(&self) -> Value {
        json!({
            "contract_partner": self.contract_partner.to_json(),
            "payer": self.payer.as_ref().map(PersonIdentification::to_json),
        })
    }
}

/// One signature of a completed QES request that counts for a person.
#[derive(Clone, Debug, PartialEq, Eq)]
struct RoleSignature {
    role: String,
    signature: QualifiedSignature,
}

/// The signatures of one completed request with level QES that count as a
/// qualified signature of the patient side or of the payer. On a live account
/// the signature itself must be a QES under eIDAS (§ 12 Abs. 1 GwG names the
/// QES of Art. 3 Nr. 12 of that regulation); on the demo account the provider
/// signs with the quality `DEMO`, which is reported as a test signature. A
/// signature without a time of its own takes the time of the request.
fn qualified_signatures(
    evidence: &Value,
    test_mode: bool,
    request_signed_at: Option<DateTime<Utc>>,
) -> Vec<RoleSignature> {
    evidence["signatures"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let role = entry["role"].as_str()?;
            if role != SIGNER_ROLE_CLIENT && role != SIGNER_ROLE_PAYER {
                return None;
            }
            let quality = entry["quality"].as_str().unwrap_or_default();
            let qualified = if test_mode {
                matches!(quality, "DEMO" | "QES")
            } else {
                quality == "QES" && entry["legislation"] == "EIDAS"
            };
            if !qualified {
                return None;
            }
            let signed_at = entry["signed_at"]
                .as_str()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .map(|value| value.with_timezone(&Utc))
                .or(request_signed_at)?;
            Some(RoleSignature {
                role: role.to_string(),
                signature: QualifiedSignature {
                    signed_at,
                    test_mode,
                },
            })
        })
        .collect()
}

/// The signature that stands for a person: the latest one of that role, a
/// real one before any test signature. `since` leaves out what was signed
/// before the person was named (an earlier payer).
fn signature_of(
    signatures: &[RoleSignature],
    role: &str,
    since: Option<DateTime<Utc>>,
) -> Option<QualifiedSignature> {
    signatures
        .iter()
        .filter(|candidate| candidate.role == role)
        .map(|candidate| candidate.signature)
        .filter(|signature| since.is_none_or(|since| signature.signed_at >= since))
        .max_by_key(|signature| (!signature.test_mode, signature.signed_at))
}

/// When the lead's third-party payer was last named (`identity_changed_at` of
/// the payer declaration); `None` without a third-party payer. What an earlier
/// payer signed, or what staff confirmed for an earlier payer, does not count
/// for the person named now — the rule of the Kostenübernahmeerklärung.
async fn third_party_payer_since(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<Option<DateTime<Utc>>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT identity_changed_at FROM lead_payer_declarations
         WHERE lead_id = $1 AND payer_kind = $2",
    )
    .bind(lead_id)
    .bind(lead_payer::PAYER_KIND_THIRD_PARTY)
    .fetch_optional(conn)
    .await
}

/// Loads the identification state of a lead in the caller's connection or
/// transaction: the qualified signatures on the lead's documents (and on the
/// documents of the lead's orders, as primary document or package member) and
/// the confirmed own-account payments.
pub(crate) async fn load_identification_status(
    conn: &mut PgConnection,
    lead_id: Uuid,
) -> Result<IdentificationStatus, sqlx::Error> {
    let payer_since = third_party_payer_since(&mut *conn, lead_id).await?;

    let requests = sqlx::query(
        r#"WITH lead_documents AS (
               SELECT d.id FROM documents d
               WHERE d.lead_id = $1
                  OR d.order_id IN (SELECT o.id FROM orders o WHERE o.source_lead_id = $1)
           )
           SELECT r.test_mode, r.signed_at, r.evidence
           FROM document_signature_requests r
           WHERE r.status = 'completed'
             AND r.level = 'QES'
             AND (r.source_document_id IN (SELECT id FROM lead_documents)
                  OR EXISTS (
                      SELECT 1 FROM document_signature_members m
                      WHERE m.request_id = r.id
                        AND m.document_id IN (SELECT id FROM lead_documents)))"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    let signatures: Vec<RoleSignature> = requests
        .iter()
        .flat_map(|row| {
            qualified_signatures(
                &row.try_get::<Value, _>("evidence").unwrap_or(Value::Null),
                row.try_get::<bool, _>("test_mode").unwrap_or(true),
                row.try_get::<Option<DateTime<Utc>>, _>("signed_at")
                    .ok()
                    .flatten(),
            )
        })
        .collect();

    let payments = sqlx::query(
        r#"SELECT p.subject, p.confirmed_at, p.confirmed_by, p.note, u.name AS confirmed_by_name
           FROM lead_identification_payments p
           LEFT JOIN users u ON u.id = p.confirmed_by
           WHERE p.lead_id = $1"#,
    )
    .bind(lead_id)
    .fetch_all(&mut *conn)
    .await?;
    let payment_of = |subject: &str, since: Option<DateTime<Utc>>| {
        payments
            .iter()
            .find(|row| row.try_get::<String, _>("subject").ok().as_deref() == Some(subject))
            .and_then(|row| {
                Some(OwnAccountPayment {
                    confirmed_at: row.try_get("confirmed_at").ok()?,
                    confirmed_by: row.try_get("confirmed_by").unwrap_or_default(),
                    confirmed_by_name: row.try_get("confirmed_by_name").unwrap_or_default(),
                    note: row.try_get("note").unwrap_or_default(),
                })
            })
            .filter(|payment| since.is_none_or(|since| payment.confirmed_at >= since))
    };

    Ok(IdentificationStatus {
        contract_partner: PersonIdentification {
            qes: signature_of(&signatures, SIGNER_ROLE_CLIENT, None),
            own_account_payment: payment_of(SUBJECT_CONTRACT_PARTNER, None),
        },
        payer: payer_since.map(|since| PersonIdentification {
            qes: signature_of(&signatures, SIGNER_ROLE_PAYER, Some(since)),
            own_account_payment: payment_of(SUBJECT_PAYER, Some(since)),
        }),
    })
}

/// Removes the confirmed payments of a lead in the caller's transaction (the
/// lead is deleted or anonymized).
pub(crate) async fn purge_in_tx(conn: &mut PgConnection, lead_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM lead_identification_payments WHERE lead_id = $1")
        .bind(lead_id)
        .execute(conn)
        .await
        .map(|_| ())
}

// ----------------------------------------------------------------------------
// Handlers
// ----------------------------------------------------------------------------

fn error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(json!({"error": code, "message": message}))).into_response()
}

fn database_error(error: sqlx::Error, context: &'static str) -> Response {
    tracing::error!(%error, context, "lead identification status");
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error": "Internal Server Error", "message": "Failed to load the identification status"})),
    )
        .into_response()
}

async fn get_identification_status(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(lead_id): Path<Uuid>,
) -> Response {
    // The same readers as the payer declaration.
    if !lead_payer::may_view(&auth) {
        return error(
            StatusCode::FORBIDDEN,
            "forbidden",
            "Insufficient permissions",
        );
    }
    let mut conn = match state.db.acquire().await {
        Ok(conn) => conn,
        Err(error) => return database_error(error, "acquire identification status"),
    };
    match sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM leads WHERE id = $1)")
        .bind(lead_id)
        .fetch_one(&mut *conn)
        .await
    {
        Ok(true) => {}
        Ok(false) => return error(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => return database_error(error, "load identification status lead"),
    }
    match load_identification_status(&mut conn, lead_id).await {
        Ok(status) => Json(status.to_json()).into_response(),
        Err(error) => database_error(error, "load identification status"),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OwnAccountPaymentInput {
    confirmed: bool,
    note: Option<String>,
}

/// Staff confirm (or take back) that the payment arrived from a payment
/// account in the person's own name. The first confirmation keeps its time
/// and author; a later one only adds or replaces the note.
async fn set_own_account_payment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((lead_id, subject)): Path<(Uuid, String)>,
    Json(body): Json<OwnAccountPaymentInput>,
) -> Response {
    if let Err(response) = auth.require_capability(Capability::LeadsEdit) {
        return response;
    }
    if subject != SUBJECT_CONTRACT_PARTNER && subject != SUBJECT_PAYER {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "identification_subject_invalid",
            "Unknown person: contract_partner or payer",
        );
    }
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|note| !note.is_empty())
        .map(str::to_string);
    if note
        .as_deref()
        .is_some_and(|note| note.chars().count() > NOTE_MAX)
    {
        return error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "identification_note_too_long",
            "The note is too long",
        );
    }

    let mut tx = match state.db.begin().await {
        Ok(tx) => tx,
        Err(error) => return database_error(error, "begin own-account payment"),
    };
    let lead = match sqlx::query(
        "SELECT converted_patient_id, qualification_status FROM leads WHERE id = $1 FOR UPDATE",
    )
    .bind(lead_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return error(StatusCode::NOT_FOUND, "not_found", "Lead not found"),
        Err(error) => return database_error(error, "lock own-account payment lead"),
    };
    if lead
        .try_get::<Option<Uuid>, _>("converted_patient_id")
        .unwrap_or_default()
        .is_some()
    {
        return error(
            StatusCode::CONFLICT,
            "lead_converted",
            "The lead is converted; its identification belongs to the patient record",
        );
    }
    if lead
        .try_get::<String, _>("qualification_status")
        .unwrap_or_default()
        == "deleted"
    {
        return error(StatusCode::CONFLICT, "lead_deleted", "The lead is deleted");
    }

    let before = match load_identification_status(&mut tx, lead_id).await {
        Ok(status) => status,
        Err(error) => return database_error(error, "load own-account payment state"),
    };
    let person = if subject == SUBJECT_PAYER {
        match &before.payer {
            Some(payer) => payer,
            None => {
                return error(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "payer_declaration_not_third_party",
                    "The payer declaration names no third-party payer",
                );
            }
        }
    } else {
        &before.contract_partner
    };

    // What changed, for the audit event; `None` when nothing did.
    let change = if body.confirmed {
        match &person.own_account_payment {
            None => {
                // No mark that counts: a new one, also over the mark of an
                // earlier payer.
                let stored = sqlx::query(
                    r#"INSERT INTO lead_identification_payments
                           (lead_id, subject, confirmed_at, confirmed_by, note)
                       VALUES ($1, $2, clock_timestamp(), $3, $4)
                       ON CONFLICT (lead_id, subject) DO UPDATE SET
                           confirmed_at = EXCLUDED.confirmed_at,
                           confirmed_by = EXCLUDED.confirmed_by,
                           note = EXCLUDED.note"#,
                )
                .bind(lead_id)
                .bind(&subject)
                .bind(auth.user_id)
                .bind(&note)
                .execute(&mut *tx)
                .await;
                if let Err(error) = stored {
                    return database_error(error, "store own-account payment");
                }
                Some((
                    "confirm_lead_own_account_payment",
                    json!({ "has_note": note.is_some() }),
                ))
            }
            Some(current) if note.is_some() && note != current.note => {
                let stored = sqlx::query(
                    "UPDATE lead_identification_payments SET note = $3
                     WHERE lead_id = $1 AND subject = $2",
                )
                .bind(lead_id)
                .bind(&subject)
                .bind(&note)
                .execute(&mut *tx)
                .await;
                if let Err(error) = stored {
                    return database_error(error, "update own-account payment note");
                }
                Some((
                    "confirm_lead_own_account_payment",
                    json!({ "has_note": true, "note_changed": true }),
                ))
            }
            Some(_) => None,
        }
    } else {
        let removed = sqlx::query(
            r#"DELETE FROM lead_identification_payments
               WHERE lead_id = $1 AND subject = $2
               RETURNING confirmed_at, confirmed_by"#,
        )
        .bind(lead_id)
        .bind(&subject)
        .fetch_optional(&mut *tx)
        .await;
        match removed {
            Ok(Some(row)) => Some((
                "revoke_lead_own_account_payment",
                json!({
                    "confirmed_at": row
                        .try_get::<DateTime<Utc>, _>("confirmed_at")
                        .ok()
                        .map(|at| at.to_rfc3339()),
                    "confirmed_by": row
                        .try_get::<Option<Uuid>, _>("confirmed_by")
                        .unwrap_or_default(),
                }),
            )),
            Ok(None) => None,
            Err(error) => return database_error(error, "remove own-account payment"),
        }
    };

    let Some((action, mut context)) = change else {
        drop(tx);
        return Json(before.to_json()).into_response();
    };
    context["lead_id"] = json!(lead_id);
    context["subject"] = json!(subject);
    let event = audit::domain_event(action, Some(auth.user_id), "lead", Some(lead_id), context);
    if let Err(error) = audit::write_in_transaction(&mut tx, &event).await {
        return database_error(error, "audit own-account payment");
    }
    let after = match load_identification_status(&mut tx, lead_id).await {
        Ok(status) => status,
        Err(error) => return database_error(error, "reload own-account payment state"),
    };
    if let Err(error) = tx.commit().await {
        return database_error(error, "commit own-account payment");
    }
    crate::realtime::publish_lead_event(
        &state,
        Some(auth.user_id),
        "lead.updated",
        lead_id,
        json!({ "identification_updated": true }),
    )
    .await;
    Json(after.to_json()).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    fn entry(role: &str, quality: &str, signed_at: &str) -> Value {
        json!({
            "email": format!("{role}@example.com"),
            "role": role,
            "status": "SIGNED",
            "signed_at": signed_at,
            "quality": quality,
            "legislation": "EIDAS",
        })
    }

    #[test]
    fn a_live_signature_counts_only_as_a_qes_under_eidas() {
        let evidence = json!({ "signatures": [
            entry("client", "QES", "2026-10-02T09:00:00Z"),
            entry("payer", "AES", "2026-10-02T09:05:00Z"),
            entry("agency", "QES", "2026-10-02T09:10:00Z"),
            { "role": "payer", "quality": "QES", "legislation": "ZERTES",
              "signed_at": "2026-10-02T09:15:00Z" },
        ]});
        let found = qualified_signatures(&evidence, false, None);
        assert_eq!(
            found,
            vec![RoleSignature {
                role: "client".into(),
                signature: QualifiedSignature {
                    signed_at: at("2026-10-02T09:00:00Z"),
                    test_mode: false,
                },
            }]
        );
        // The demo quality of a live request is not a qualified signature.
        let demo = json!({ "signatures": [entry("client", "DEMO", "2026-10-02T09:00:00Z")] });
        assert!(qualified_signatures(&demo, false, None).is_empty());
    }

    #[test]
    fn a_demo_signature_is_reported_as_a_test_and_takes_the_request_time_when_it_has_none() {
        let evidence = json!({ "signatures": [
            entry("client", "DEMO", "2026-10-03T10:00:00+02:00"),
            { "role": "payer", "quality": "DEMO" },
        ]});
        let found = qualified_signatures(&evidence, true, Some(at("2026-10-03T08:30:00Z")));
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|candidate| candidate.signature.test_mode));
        assert_eq!(found[0].signature.signed_at, at("2026-10-03T08:00:00Z"));
        assert_eq!(found[1].signature.signed_at, at("2026-10-03T08:30:00Z"));
        // Without any time the signature cannot be dated and is left out.
        assert_eq!(qualified_signatures(&evidence, true, None).len(), 1);
        // Evidence of another shape names no signatures.
        assert!(qualified_signatures(&json!({}), true, None).is_empty());
        assert!(qualified_signatures(&Value::Null, false, None).is_empty());
    }

    #[test]
    fn the_latest_signature_of_the_role_stands_and_a_real_one_beats_a_test() {
        let signature = |role: &str, signed_at: &str, test_mode: bool| RoleSignature {
            role: role.into(),
            signature: QualifiedSignature {
                signed_at: at(signed_at),
                test_mode,
            },
        };
        let signatures = vec![
            signature("client", "2026-10-01T09:00:00Z", false),
            signature("client", "2026-10-02T09:00:00Z", false),
            signature("client", "2026-10-04T09:00:00Z", true),
            signature("payer", "2026-10-01T09:00:00Z", true),
            signature("payer", "2026-10-03T09:00:00Z", true),
        ];
        assert_eq!(
            signature_of(&signatures, "client", None),
            Some(QualifiedSignature {
                signed_at: at("2026-10-02T09:00:00Z"),
                test_mode: false,
            })
        );
        assert_eq!(
            signature_of(&signatures, "payer", None).map(|found| found.signed_at),
            Some(at("2026-10-03T09:00:00Z"))
        );
        // What was signed before the payer was named belongs to somebody else.
        assert_eq!(
            signature_of(&signatures, "payer", Some(at("2026-10-02T00:00:00Z")))
                .map(|found| found.signed_at),
            Some(at("2026-10-03T09:00:00Z"))
        );
        assert_eq!(
            signature_of(&signatures, "payer", Some(at("2026-10-04T00:00:00Z"))),
            None
        );
        assert_eq!(signature_of(&signatures, "agency", None), None);
    }
}
