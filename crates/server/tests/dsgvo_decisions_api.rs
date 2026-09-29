//! Owner decisions 2026-09-28 on the DSGVO package: request decisions and
//! identity checks, the retention sweep, the deadline digest, breach closing
//! and reopening, the Art. 18 restriction scope, consent revocation acting on
//! shares, manual revocation of patient links and staff deactivation.
//! Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::{Duration, Utc};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

fn bearer(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Synthetic', $2, '1990-01-01', 'diverse', $3)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("Patient {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)
           ON CONFLICT (patient_id, user_id)
           DO UPDATE SET revoked_at = NULL, assigned_by = $3, assigned_at = now()"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (
                name, provider_type, address_street, address_city, address_zip, address_country,
                phone, email, fachbereich
           ) VALUES ($1, 'medical', 'Street 1', 'Cologne', '50667', 'Germany',
                     '+49 221 555000', $2, 'Cardiology')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(format!("{tag}@clinic.example"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_document(
    pool: &PgPool,
    patient_id: Uuid,
    uploaded_by: Uuid,
    visibility: &str,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, auto_name, original_filename, art, category, status, visibility,
                is_medical, mime_type, file_size, version_root_document_id, version_number,
                uploaded_by
           ) VALUES (
                $1, $2, 'Synthetic report', 'report.pdf', 'medical_report', 'report', 'active', $3,
                true, 'application/pdf', 1024, $1, 1, $4
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(visibility)
    .bind(uploaded_by)
    .execute(pool)
    .await
    .unwrap();
    document_id
}

async fn audit_count(pool: &PgPool, action: &str, entity_id: Uuid, expected: i64) -> i64 {
    let count = || async {
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM audit_log WHERE action = $1 AND entity_id = $2",
        )
        .bind(action)
        .bind(entity_id)
        .fetch_one(pool)
        .await
        .unwrap()
    };
    support::wait_until(&format!("{action} audit for {entity_id}"), || async {
        count().await >= expected
    })
    .await;
    count().await
}

#[tokio::test]
async fn rejecting_needs_a_reason_the_patient_sees_and_approved_requests_can_be_revised() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (ctx.app.clone(), ctx.pool.clone(), ctx.admin_id);
    let t = tag("privacy-decision");
    let patient_id = seed_patient(&pool, admin_id, &t).await;
    let patient_user = seed_user(&pool, &format!("{t}-patient"), "patient").await;
    let pm_id = seed_user(&pool, &t, "patient_manager").await;
    let it_admin = seed_user(&pool, &format!("{t}-it"), "it_admin").await;
    assign(&pool, patient_id, patient_user, admin_id).await;
    assign(&pool, patient_id, pm_id, admin_id).await;
    let patient = bearer(patient_user, "patient");
    let pm = bearer(pm_id, "patient_manager");
    let it = bearer(it_admin, "it_admin");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &patient,
        Some(json!({ "request_type": "objection", "reason": "No marketing please" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let objection = body["id"].as_str().unwrap().to_string();
    let review = format!("/api/v1/admin/compliance/privacy-requests/{objection}/review");

    // Art. 12 Abs. 4: no rejection without a reason for the data subject.
    let (status, _) = json_request(
        &app,
        "POST",
        &review,
        &pm,
        Some(json!({ "action": "reject" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, _) = json_request(
        &app,
        "POST",
        &review,
        &pm,
        Some(json!({ "action": "reject", "reason": "short" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let reason = "No processing for marketing takes place; nothing to object to.";
    let (status, body) = json_request(
        &app,
        "POST",
        &review,
        &pm,
        Some(json!({ "action": "reject", "reason": reason, "note": "internal only" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "rejected");
    assert_eq!(body["decision_reason"], reason);

    // The portal shows the reason, never the internal note.
    let (status, body) =
        json_request(&app, "GET", "/api/v1/me/privacy-requests", &patient, None).await;
    assert_eq!(status, StatusCode::OK);
    let mine = body
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == objection.as_str())
        .cloned()
        .unwrap();
    assert_eq!(mine["decision_reason"], reason);
    assert!(mine.get("review_note").is_none());

    // An approved request: a patient manager cannot revise it; CEO / IT can,
    // with a reason. Identity is verified before a patient's erasure runs.
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/me/privacy-requests",
        &patient,
        Some(json!({ "request_type": "erasure", "reason": "Please delete my data" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let erasure = body["id"].as_str().unwrap().to_string();
    let review = format!("/api/v1/admin/compliance/privacy-requests/{erasure}/review");
    let (status, body) = json_request(
        &app,
        "POST",
        &review,
        &it,
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["identity_verification_required"], true);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{erasure}/execute"),
        &it,
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "no erasure before the identity check"
    );
    let (status, _) = json_request(
        &app,
        "POST",
        &review,
        &it,
        Some(json!({ "action": "approve" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let hold =
        json!({ "action": "hold", "reason": "Invoices must be kept for ten years (§ 147 AO)" });
    let (status, _) = json_request(&app, "POST", &review, &pm, Some(hold.clone())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = json_request(
        &app,
        "POST",
        &review,
        &it,
        Some(json!({ "action": "hold" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let (status, body) = json_request(&app, "POST", &review, &it, Some(hold)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "retention_hold");
    let history = body["decision_history"].as_array().unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[1]["from_status"], "approved");
    assert_eq!(
        audit_count(&pool, "privacy_request_decision_revised", patient_id, 1).await,
        1
    );
}

#[tokio::test]
async fn retention_sweep_respects_rejections_and_clinical_retention() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (ctx.app.clone(), ctx.pool.clone(), ctx.admin_id);
    let t = tag("retention");
    let expired = seed_patient(&pool, admin_id, &format!("{t}-a")).await;
    let clinical_hold = seed_patient(&pool, admin_id, &format!("{t}-b")).await;
    for patient in [expired, clinical_hold] {
        sqlx::query(
            r#"UPDATE patients
               SET lifecycle_status = 'inactive', is_active = false,
                   inactive_since = now() - interval '4000 days'
               WHERE id = $1"#,
        )
        .bind(patient)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "UPDATE patients SET clinical_retention_until = now() + interval '1 year' WHERE id = $1",
    )
    .bind(clinical_hold)
    .execute(&pool)
    .await
    .unwrap();
    let raised = |patient: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM patient_privacy_requests WHERE patient_id = $1 AND request_type = 'erasure'",
            )
            .bind(patient)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    let sweep = || gmed_server::routes::retention::flag_expired_patient_files(&ctx.state);

    sweep().await.unwrap();
    assert_eq!(raised(expired).await, 1);
    assert_eq!(
        raised(clinical_hold).await,
        0,
        "clinical retention not expired"
    );

    // A rejected sweep request is not raised again for the same inactive period.
    let request_id: Uuid =
        sqlx::query_scalar("SELECT id FROM patient_privacy_requests WHERE patient_id = $1")
            .bind(expired)
            .fetch_one(&pool)
            .await
            .unwrap();
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/admin/compliance/privacy-requests/{request_id}/review"),
        &bearer(admin_id, "ceo"),
        Some(json!({ "action": "reject", "reason": "Open claim against the insurer, keep the file" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    sweep().await.unwrap();
    assert_eq!(raised(expired).await, 1);

    // Reactivated and closed again later: a new inactive period, a new request.
    sqlx::query(
        "UPDATE patient_privacy_requests SET reviewed_at = now() - interval '3500 days' WHERE id = $1",
    )
    .bind(request_id)
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("UPDATE patients SET inactive_since = now() - interval '3000 days' WHERE id = $1")
        .bind(expired)
        .execute(&pool)
        .await
        .unwrap();
    sweep().await.unwrap();
    assert_eq!(raised(expired).await, 2);
}

#[tokio::test]
async fn incident_reopening_needs_a_reason_and_high_risk_needs_subject_notice() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool) = (ctx.app.clone(), ctx.pool.clone());
    let t = tag("incident-rules");
    let manager = bearer(seed_user(&pool, &t, "it_admin").await, "it_admin");
    let aware = Utc::now() - Duration::hours(100);
    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/admin/compliance/incidents",
        &manager,
        Some(json!({
            "title": format!("Lost laptop {t}"),
            "description": "Unencrypted laptop with synthetic patient lists was lost.",
            "category": "confidentiality",
            "severity": "critical",
            "became_aware_at": aware.to_rfc3339(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let incident_id = Uuid::parse_str(body["id"].as_str().unwrap()).unwrap();
    let path = format!("/api/v1/admin/compliance/incidents/{incident_id}");

    // Reported after 72 hours: flagged as late.
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({
            "risk_assessment": "high_risk",
            "authority_notified_at": Utc::now().to_rfc3339(),
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["authority_notified_late"], true);
    assert_eq!(body["subjects_notification_required"], true);

    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "status": "closed" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "status": "closed", "subjects_notified_at": Utc::now().to_rfc3339() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    let (status, _) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "status": "open" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    let reason = "The laptop was found with the disk removed";
    let (status, body) = json_request(
        &app,
        "POST",
        &path,
        &manager,
        Some(json!({ "status": "open", "reopen_reason": reason })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["status"], "open");
    assert_eq!(body["reopen_reason"], reason);
    assert_eq!(
        audit_count(&pool, "security_incident_reopened", incident_id, 1).await,
        1
    );
}

#[tokio::test]
async fn deadline_digest_goes_to_ceo_and_it_once_per_german_day() {
    use gmed_server::services::compliance_digest::{DigestOutcome, run_compliance_digest_at};
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let t = tag("digest");
    let it_admin = seed_user(&pool, &format!("{t}-it"), "it_admin").await;
    let pm_id = seed_user(&pool, &format!("{t}-pm"), "patient_manager").await;
    let patient_id = seed_patient(&pool, ctx.admin_id, &t).await;
    let at = |value: &str| {
        chrono::DateTime::parse_from_rfc3339(value)
            .unwrap()
            .to_utc()
    };
    let morning = at("2030-03-04T07:00:00Z");
    sqlx::query(
        r#"INSERT INTO patient_privacy_requests (patient_id, requested_by, request_type, status, due_at)
           VALUES ($1, $2, 'access', 'requested', $3)"#,
    )
    .bind(patient_id)
    .bind(ctx.admin_id)
    .bind(morning - Duration::days(1))
    .execute(&pool)
    .await
    .unwrap();

    // 05:00 in Berlin is before the send hour; 08:00 sends; later runs do not.
    assert_eq!(
        run_compliance_digest_at(&ctx.state, at("2030-03-04T04:00:00Z"))
            .await
            .unwrap(),
        DigestOutcome::NotYet
    );
    let sent = run_compliance_digest_at(&ctx.state, morning).await.unwrap();
    assert!(
        matches!(sent, DigestOutcome::Sent { recipients, .. } if recipients >= 2),
        "{sent:?}"
    );
    assert_eq!(
        run_compliance_digest_at(&ctx.state, at("2030-03-04T20:00:00Z"))
            .await
            .unwrap(),
        DigestOutcome::AlreadySent
    );

    let count = |user: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM user_notifications WHERE user_id = $1 AND kind = 'compliance_deadline_digest'",
            )
            .bind(user)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(count(it_admin).await, 1);
    assert_eq!(count(ctx.admin_id).await, 1);
    assert_eq!(count(pm_id).await, 0);
    let body: String = sqlx::query_scalar(
        "SELECT body FROM user_notifications WHERE user_id = $1 AND kind = 'compliance_deadline_digest'",
    )
    .bind(it_admin)
    .fetch_one(&pool)
    .await
    .unwrap();
    let digest: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(digest["digest_date"], "2030-03-04");
    assert!(digest["privacy"]["overdue"].as_i64().unwrap() >= 1);
}

#[tokio::test]
async fn restricted_patient_blocks_new_work_and_disclosure_but_can_be_deactivated() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (ctx.app.clone(), ctx.pool.clone(), ctx.admin_id);
    let t = tag("restriction-scope");
    let patient_id = seed_patient(&pool, admin_id, &t).await;
    let billing = seed_user(&pool, &t, "billing").await;
    let provider_id = seed_provider(&pool, &t).await;
    let document_id = seed_document(&pool, patient_id, admin_id, "released_external").await;
    sqlx::query(
        r#"UPDATE patients
           SET legal_status = COALESCE(legal_status, '{}'::jsonb)
                              || '{"processing_restricted": true}'::jsonb
           WHERE id = $1"#,
    )
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();
    let ceo = bearer(admin_id, "ceo");

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/appointments",
        &ceo,
        Some(json!({
            "patient_id": patient_id,
            "appointment_type": "internal",
            "title": "Check-in",
            "date": "2030-01-10",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");
    assert!(body["message"].as_str().unwrap().contains("Art. 18"));

    let (status, body) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &ceo,
        Some(json!({ "patient_id": patient_id })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");

    let shares = format!("/api/v1/documents/{document_id}/shares");
    let (status, body) = json_request(
        &app,
        "POST",
        &shares,
        &ceo,
        Some(json!({ "shared_with_user_id": billing, "channel": "email" })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &shares,
        &ceo,
        Some(json!({
            "shared_with_provider_id": provider_id,
            "channel": "email",
            "message": "Bitte vor dem Termin pruefen."
        })),
    )
    .await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");

    // Closing the file stays possible while restricted.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/deactivate"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn revoking_a_consent_revokes_its_shares_and_blocks_provider_shares() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (ctx.app.clone(), ctx.pool.clone(), ctx.admin_id);
    let t = tag("consent-shares");
    let patient_id = seed_patient(&pool, admin_id, &t).await;
    let patient_user = seed_user(&pool, &format!("{t}-patient"), "patient").await;
    assign(&pool, patient_id, patient_user, admin_id).await;
    let provider_id = seed_provider(&pool, &t).await;
    let patient_doc = seed_document(&pool, patient_id, admin_id, "patient_visible").await;
    let external_doc = seed_document(&pool, patient_id, admin_id, "released_external").await;
    for (document, user, provider, channel) in [
        (patient_doc, Some(patient_user), None, "email"),
        (patient_doc, Some(patient_user), None, "patient_portal"),
        (external_doc, None, Some(provider_id), "secure_email"),
    ] {
        sqlx::query(
            r#"INSERT INTO document_shares (
                    document_id, shared_with_user_id, shared_with_provider_id, shared_by, channel
               ) VALUES ($1, $2, $3, $4, $5)"#,
        )
        .bind(document)
        .bind(user)
        .bind(provider)
        .bind(admin_id)
        .bind(channel)
        .execute(&pool)
        .await
        .unwrap();
    }
    let ceo = bearer(admin_id, "ceo");
    let consents = format!("/api/v1/admin/compliance/patient/{patient_id}/consents");
    let open_shares = |channel: &'static str| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, i64>(
                r#"SELECT count(*)
                   FROM document_shares ds
                   JOIN documents d ON d.id = ds.document_id
                   WHERE d.patient_id = $1 AND ds.channel = $2 AND ds.revoked_at IS NULL"#,
            )
            .bind(patient_id)
            .bind(channel)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    let (status, body) = json_request(
        &app,
        "POST",
        &consents,
        &ceo,
        Some(json!({ "consent_type": "document_share_email", "action": "revoke" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["revoked_share_count"], 1);
    assert_eq!(open_shares("email").await, 0);
    assert_eq!(
        open_shares("patient_portal").await,
        1,
        "other channels stay"
    );
    assert_eq!(open_shares("secure_email").await, 1);

    let (status, body) = json_request(
        &app,
        "POST",
        &consents,
        &ceo,
        Some(json!({ "consent_type": "third_party_sharing", "action": "revoke" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["third_party_sharing_revoked"], true);
    assert_eq!(open_shares("secure_email").await, 0);

    // No new provider share until the patient consents again.
    let share = json!({
        "shared_with_provider_id": provider_id,
        "channel": "email",
        "message": "Bitte vor dem Termin pruefen."
    });
    let share_path = format!("/api/v1/documents/{external_doc}/shares");
    let (status, body) = json_request(&app, "POST", &share_path, &ceo, Some(share.clone())).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert!(body["message"].as_str().unwrap().contains("third parties"));

    let (status, _) = json_request(
        &app,
        "POST",
        &consents,
        &ceo,
        Some(json!({ "consent_type": "third_party_sharing", "action": "grant" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, body) = json_request(&app, "POST", &share_path, &ceo, Some(share)).await;
    assert!(
        !body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("third parties"),
        "{status}: {body}"
    );
}

#[tokio::test]
async fn deactivating_staff_revokes_patient_links_and_lists_open_work() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let (app, pool, admin_id) = (ctx.app.clone(), ctx.pool.clone(), ctx.admin_id);
    let t = tag("deactivate-staff");
    let patient_id = seed_patient(&pool, admin_id, &t).await;
    let pm_id = seed_user(&pool, &t, "patient_manager").await;
    let it_admin = seed_user(&pool, &format!("{t}-it"), "it_admin").await;
    assign(&pool, patient_id, pm_id, admin_id).await;
    sqlx::query(
        r#"INSERT INTO tasks (title, assigned_to, assigned_by, status)
           VALUES ('Call the clinic', $1, $2, 'open')"#,
    )
    .bind(pm_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();
    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, owner_user_id, appointment_type, title, date, status, created_by
           ) VALUES ($1, $2, 'internal', 'Planning', CURRENT_DATE + 5, 'planned', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(pm_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/users/{pm_id}/deactivate"),
        &bearer(it_admin, "it_admin"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["revoked_patient_assignments"], 1);
    assert_eq!(body["open_tasks"].as_array().unwrap().len(), 1);
    let owned = body["owned_appointments"].as_array().unwrap();
    assert_eq!(owned.len(), 1);
    assert_eq!(owned[0]["id"], appointment_id.to_string());

    let still_linked: bool = sqlx::query_scalar(
        "SELECT revoked_at IS NULL FROM patient_assignments WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!still_linked);
    let audit: Value = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'revoke_assignment' AND entity_id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(audit["reason"], "user_deactivated");

    // The owned visit is flagged in the attention list; nothing is reassigned.
    let owner: Uuid = sqlx::query_scalar("SELECT owner_user_id FROM appointments WHERE id = $1")
        .bind(appointment_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(owner, pm_id);
    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/appointments/meta/attention",
        &bearer(admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let item = body
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == appointment_id.to_string())
        .cloned()
        .expect("owned visit flagged");
    assert!(
        item["reason_details"]
            .as_array()
            .unwrap()
            .iter()
            .any(|reason| reason["key"] == "appointments_attention_reason_owner_deactivated")
    );
}
