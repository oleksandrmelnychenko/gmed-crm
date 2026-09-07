//! Delivery and manager-recorded acknowledgement, never a digital signature.
use super::*;
use gmed_domain::role::Role;

pub(super) fn router() -> Router<AppState> {
    Router::new().route("/documents/{id}/review-status", get(list).post(record))
}

pub(super) fn informational(template: Option<&str>) -> bool {
    matches!(template, Some("privacy_information" | "cost_estimate"))
}

async fn access(
    state: &AppState,
    auth: &AuthUser,
    id: Uuid,
    write: bool,
) -> Result<PgRow, Response> {
    let row = signature_document_access(state, auth, id, write).await?;
    if !informational(
        row.get::<Option<String>, _>("generated_template_id")
            .as_deref(),
    ) {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_informational_document",
        ));
    }
    Ok(row)
}

async fn latest(state: &AppState, id: Uuid) -> Result<Value, Response> {
    let rows = sqlx::query(
        "SELECT e.*, u.name AS actor_name FROM document_review_events e
         JOIN users u ON u.id=e.actor_id WHERE document_id=$1
         ORDER BY e.created_at DESC,e.id DESC LIMIT 50",
    )
    .bind(id)
    .fetch_all(&state.db)
    .await
    .map_err(db_error)?;
    let sent = rows.iter().find(|r| r.get::<String, _>("kind") == "sent");
    let sent_id = sent.map(|r| r.get::<Uuid, _>("id"));
    let acknowledged = rows.iter().find(|r| {
        r.get::<String, _>("kind") == "acknowledged"
            && r.get::<Option<Uuid>, _>("sent_event_id") == sent_id
    });
    let event = |r: &PgRow| {
        json!({"id":r.get::<Uuid,_>("id"),
        "at":r.get::<DateTime<Utc>,_>("created_at"),"by":r.get::<String,_>("actor_name"),
        "test_mode":r.get::<bool,_>("test_mode"),
        "automatic":r.get::<Option<Uuid>,_>("signature_request_id").is_some()})
    };
    Ok(json!({"sent":sent.map(event),"acknowledged":acknowledged.map(event)}))
}

async fn list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, Response> {
    let row = access(&state, &auth, id, false).await?;
    let mut value = latest(&state, id).await?;
    value["can_record"] = json!(
        matches!(auth.role, Role::Ceo | Role::PatientManager)
            && eligibility(&row).is_none()
            && signature_document_access(&state, &auth, id, true)
                .await
                .is_ok()
    );
    Ok(Json(value))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RecordRequest {
    kind: String,
    sent_event_id: Option<Uuid>,
}

async fn record(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(id): Path<Uuid>,
    Json(body): Json<RecordRequest>,
) -> Result<Json<Value>, Response> {
    auth.require_exact_role(&[Role::Ceo, Role::PatientManager])?;
    access(&state, &auth, id, true).await?;
    if !matches!(body.kind.as_str(), "sent" | "acknowledged") {
        return Err(error(
            StatusCode::UNPROCESSABLE_ENTITY,
            "invalid_review_event",
        ));
    }
    let mut tx = state.db.begin().await.map_err(db_error)?;
    let current = sqlx::query("SELECT *, NOT EXISTS(SELECT 1 FROM documents v WHERE v.replaces_document_id=d.id) AS is_latest_version FROM documents d WHERE id=$1 FOR UPDATE")
        .bind(id).fetch_one(&mut *tx).await.map_err(db_error)?;
    if eligibility(&current).is_some()
        || !informational(
            current
                .get::<Option<String>, _>("generated_template_id")
                .as_deref(),
        )
    {
        return Err(error(StatusCode::CONFLICT, "document_changed"));
    }
    let sent = sqlx::query("SELECT id,test_mode FROM document_review_events WHERE document_id=$1 AND kind='sent' ORDER BY created_at DESC,id DESC LIMIT 1")
        .bind(id).fetch_optional(&mut *tx).await.map_err(db_error)?;
    let acknowledged = body.kind == "acknowledged";
    let sent_id = sent.as_ref().map(|r| r.get::<Uuid, _>("id"));
    if acknowledged && (sent_id.is_none() || body.sent_event_id != sent_id) {
        return Err(error(StatusCode::CONFLICT, "review_delivery_changed"));
    }
    // Repeated manual clicks are idempotent. Resending electronically creates
    // its own event and requires a fresh acknowledgement.
    if acknowledged || sent.is_none() {
        sqlx::query("INSERT INTO document_review_events(id,document_id,kind,actor_id,sent_event_id,test_mode) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING")
            .bind(Uuid::new_v4()).bind(id).bind(&body.kind).bind(auth.user_id)
            .bind(if acknowledged { sent_id } else { None })
            .bind(acknowledged && sent.as_ref().is_some_and(|r| r.get::<bool,_>("test_mode")))
            .execute(&mut *tx).await.map_err(db_error)?;
    }
    tx.commit().await.map_err(db_error)?;
    state.audit_sender.try_send(audit::domain_event(
        "document_review_recorded",
        Some(auth.user_id),
        "document",
        Some(id),
        json!({"kind":body.kind,"sent_event_id":body.sent_event_id,"source":"manager"}),
    ));
    Ok(Json(latest(&state, id).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_two_information_templates_have_review_status() {
        for value in ["privacy_information", "cost_estimate"] {
            assert!(informational(Some(value)));
        }
        for value in [
            "framework_contract",
            "order_cost_estimate",
            "privacy_consents",
            "identity",
            "free_document",
        ] {
            assert!(!informational(Some(value)));
        }
        assert!(!informational(None));
    }
}
