//! Operational signer progress never changes a document's legal signature.
use super::*;
use gmed_domain::role::Role;

fn signed(evidence: &Value, signer: &Signer) -> bool {
    let Some(items) = evidence["signatures"].as_array() else {
        return false;
    };
    let mut matches = items.iter().filter(|item| {
        item["email"]
            .as_str()
            .is_some_and(|email| email.trim().eq_ignore_ascii_case(signer.email.trim()))
    });
    let first = matches.next();
    first.is_some_and(|item| item["status"] == "SIGNED") && matches.next().is_none()
}

pub(super) fn summary(signers: &[Signer], evidence: &Value) -> Value {
    let count = |role: Option<&str>, signed_only: bool| {
        signers
            .iter()
            .filter(|signer| {
                role.is_none_or(|role| signer.role == role)
                    && (!signed_only || signed(evidence, signer))
            })
            .count()
    };
    json!({ "signed": count(None, true), "total": signers.len(),
        "client_signed": count(Some("client"), true), "client_total": count(Some("client"), false),
        "agency_signed": count(Some("agency"), true), "agency_total": count(Some("agency"), false) })
}

/// Called in the same transaction as persisting verified evidence, after the
/// lease-guarded request update acquired its row lock. A poll/webhook retry
/// therefore cannot create duplicate notices, even after provider regression.
pub(super) async fn notify_client_signatures(
    state: &AppState,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    row: &PgRow,
    signers: &[Signer],
    evidence: &Value,
) -> Result<Vec<(Uuid, Uuid)>, sqlx::Error> {
    let previous: Value = row.get("evidence");
    let clients: Vec<_> = signers
        .iter()
        .filter(|signer| {
            signer.role == "client" && signed(evidence, signer) && !signed(&previous, signer)
        })
        .collect();
    if clients.is_empty() {
        return Ok(Vec::new());
    }
    let source: Uuid = row.get("source_document_id");
    let request_id: Uuid = row.get("id");
    let test_mode: bool = row.get("test_mode");
    let recipients = sqlx::query("SELECT id, role FROM users WHERE is_active AND (role='ceo' OR (id=$1 AND role='patient_manager'))")
        .bind(row.get::<Uuid,_>("requested_by")).fetch_all(&mut **tx).await?;
    let counts = summary(signers, evidence);
    let mut notices = Vec::new();
    for recipient in recipients {
        let user_id: Uuid = recipient.get("id");
        let auth = AuthUser {
            user_id,
            role: if recipient.get::<String, _>("role") == "ceo" {
                Role::Ceo
            } else {
                Role::PatientManager
            },
            selected_patient_id: None,
            family_id: Uuid::nil(),
            access_token_jti: Uuid::nil(),
            access_token_expires_at: Utc::now(),
        };
        // Recheck current document scope: a sender may have lost assignment
        // or received a different role since sending the invitation.
        if let Err(response) = signature_document_access(state, &auth, source, false).await {
            if response.status().is_server_error() {
                return Err(sqlx::Error::Protocol(
                    "signature notification access check failed".into(),
                ));
            }
            continue;
        }
        for client in &clients {
            let signer_key = sha256(client.email.trim().to_lowercase().as_bytes());
            let id = sqlx::query_scalar::<_, Uuid>(
                "INSERT INTO user_notifications (user_id,kind,title,body,entity_type,entity_id,params)
                 SELECT $1,'signature_client_signed',$2,$3,'document',$4,$5
                 WHERE NOT EXISTS (SELECT 1 FROM user_notifications WHERE user_id=$1
                   AND kind='signature_client_signed' AND params->>'request_id'=$6 AND params->>'signer_key'=$7)
                 RETURNING id")
                .bind(user_id)
                .bind(if test_mode { "DEMO: client signature received" } else { "Client signature received" })
                .bind("A client signature was confirmed by Skribble. Check the remaining signers in the document's signature panel.")
                .bind(source)
                .bind(json!({ "outcome": if test_mode { "test_client_signed" } else { "client_signed" },
                    "request_id": request_id, "signer_key": signer_key, "signed": counts["signed"], "total": counts["total"] }))
                .bind(request_id.to_string()).bind(signer_key)
                .fetch_optional(&mut **tx).await?;
            if let Some(id) = id {
                notices.push((user_id, id))
            }
        }
    }
    Ok(notices)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_only_matching_unique_provider_evidence() {
        let signers = super::super::tests::signers();
        let evidence = json!({"signatures":[{"email":" ERIKA@EXAMPLE.ORG ","status":"SIGNED"},{"email":"max@example.org","status":"OPEN"}]});
        assert_eq!(
            summary(&signers, &evidence),
            json!({"signed":1,"total":2,"client_signed":1,"client_total":1,"agency_signed":0,"agency_total":1})
        );
        let duplicates = json!({"signatures":[{"email":"erika@example.org","status":"SIGNED"},{"email":"erika@example.org","status":"SIGNED"}]});
        assert_eq!(summary(&signers, &duplicates)["signed"], 0);
        assert_eq!(summary(&signers, &json!({}))["signed"], 0);
    }
}
