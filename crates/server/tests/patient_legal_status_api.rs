//! The "Правовой статус" checklist of the patient card (owner decision
//! 2026-10-12): DSGVO consent and the confidentiality release follow signed
//! documents only — the scan of the paper copy ("Подписано на бумаге") or a
//! QES — and are never ticked or unticked by hand, for any role. Items ticked
//! by hand before stay set, keep counting for the gates and are flagged on
//! the card. Synthetic data only.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid, String)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    let token = jwt::issue_access_token(TEST_SECRET, ctx.admin_id, "ceo", Uuid::new_v4()).ok()?;
    Some((ctx.app, ctx.pool, ctx.admin_id, format!("Bearer {token}")))
}

fn bearer_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn json_request(
    app: &axum::Router,
    method: &str,
    path: &str,
    bearer: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let body = match body {
        Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
        None => Body::empty(),
    };
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(body)
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

/// `POST /documents/{id}/paper-signature` with the scan of the signed copy,
/// signed today.
async fn sign_on_paper(app: &axum::Router, document_id: Uuid, bearer: &str) -> (StatusCode, Value) {
    sign_on_paper_dated(app, document_id, bearer, None).await
}

/// The same with the day the paper copy was signed (`YYYY-MM-DD`).
async fn sign_on_paper_dated(
    app: &axum::Router,
    document_id: Uuid,
    bearer: &str,
    signed_on: Option<&str>,
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();
    if let Some(day) = signed_on {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(b"Content-Disposition: form-data; name=\"signed_on\"\r\n\r\n");
        body.extend_from_slice(day.as_bytes());
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        b"Content-Disposition: form-data; name=\"file\"; filename=\"signed-scan.pdf\"\r\nContent-Type: application/pdf\r\n\r\n",
    );
    body.extend_from_slice(b"%PDF-1.4 signed scan");
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    let request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/documents/{document_id}/paper-signature"))
        .header("Authorization", bearer)
        .header(
            "Content-Type",
            format!("multipart/form-data; boundary={boundary}"),
        )
        .body(Body::from(body))
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

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
    )
    .bind(format!("legal-{role}-{}@example.com", Uuid::new_v4().simple()))
    .bind(format!("{role} legal status test"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Mia Muster; `legal_status` as stored (a legacy file ticked by hand).
async fn seed_patient(pool: &PgPool, created_by: Uuid, legal_status: Value) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by, legal_status
           ) VALUES ($1, 'Mia', 'Muster', '1990-01-01', 'female', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("P-LEGAL-{}", Uuid::new_v4().simple()))
    .bind(created_by)
    .bind(legal_status)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, assigned_by: Uuid) {
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(pool)
    .await
    .unwrap();
}

/// A consent GMED generated for the patient and nobody signed yet.
async fn seed_generated_draft(pool: &PgPool, patient_id: Uuid, template: &str, by: Uuid) -> Uuid {
    seed_generated_draft_of_type(pool, patient_id, template, template, by).await
}

/// The same with the document type the template stores (`art`), e.g. the
/// minor's Einverständniserklärung (`consent_data_release`).
async fn seed_generated_draft_of_type(
    pool: &PgPool,
    patient_id: Uuid,
    template: &str,
    art: &str,
    by: Uuid,
) -> Uuid {
    let document_id = Uuid::new_v4();
    sqlx::query(
        r#"INSERT INTO documents (
               id, patient_id, auto_name, original_filename, art, category, status, visibility,
               is_medical, mime_type, generated_template_id, ursprung,
               version_root_document_id, version_number, uploaded_by
           ) VALUES (
               $1, $2, $3, $4, $6, 'consent', 'draft', 'patient_visible', false,
               'application/pdf', $3, 'template:' || $3, $1, 1, $5
           )"#,
    )
    .bind(document_id)
    .bind(patient_id)
    .bind(template)
    .bind(format!("{template}.pdf"))
    .bind(by)
    .bind(art)
    .execute(pool)
    .await
    .unwrap();
    document_id
}

/// `POST /admin/compliance/patient/{id}/consents` (the consent register).
async fn revoke_consent(
    app: &axum::Router,
    patient_id: Uuid,
    consent_type: &str,
    bearer: &str,
) -> Value {
    let (status, body) = json_request(
        app,
        "POST",
        &format!("/api/v1/admin/compliance/patient/{patient_id}/consents"),
        bearer,
        Some(json!({ "consent_type": consent_type, "action": "revoke", "note": "Widerruf per Brief" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

async fn recheck(app: &axum::Router, patient_id: Uuid, bearer: &str) -> Value {
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recheck"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn active_grants(pool: &PgPool, patient_id: Uuid, consent_type: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM consent_records
         WHERE patient_id = $1 AND consent_type = $2 AND granted = true AND revoked_at IS NULL",
    )
    .bind(patient_id)
    .bind(consent_type)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn is_revocation_reason(reason: &Value, prefix: &str) -> bool {
    reason.as_str().is_some_and(|text| {
        text.strip_prefix(prefix).is_some_and(|date| {
            date.len() == 10 && chrono::NaiveDate::parse_from_str(date, "%d.%m.%Y").is_ok()
        })
    })
}

async fn stored_legal_status(pool: &PgPool, patient_id: Uuid) -> Value {
    sqlx::query_scalar("SELECT COALESCE(legal_status, '{}'::jsonb) FROM patients WHERE id = $1")
        .bind(patient_id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn detail(app: &axum::Router, patient_id: Uuid, bearer: &str) -> Value {
    let (status, body) = json_request(
        app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
async fn ticking_or_unticking_the_document_bound_items_is_refused_for_every_role() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id, json!({})).await;
    let manager_id = seed_user(&pool, "patient_manager").await;
    assign(&pool, patient_id, manager_id, admin_id).await;
    let manager = bearer_for(manager_id, "patient_manager");
    let update = format!("/api/v1/patients/{patient_id}/update");

    for bearer in [&ceo, &manager] {
        let (status, body) = json_request(
            &app,
            "POST",
            &update,
            bearer,
            Some(json!({ "legal_status": { "dsgvo_signed": true } })),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["error"], "legal_status_requires_signed_document");
        assert_eq!(body["items"], json!(["dsgvo_signed"]));

        // The whole save is refused: the identity item is not stored either.
        let (status, body) = json_request(
            &app,
            "POST",
            &update,
            bearer,
            Some(json!({ "legal_status": {
                "confidentiality_release_signed": true,
                "identity_verified": true
            } })),
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["items"], json!(["confidentiality_release_signed"]));
    }
    assert_eq!(stored_legal_status(&pool, patient_id).await, json!({}));

    // The checklist sent unchanged (an older profile editor) or without the
    // two items saves the other items.
    let (status, body) = json_request(
        &app,
        "POST",
        &update,
        &manager,
        Some(json!({ "legal_status": {
            "dsgvo_signed": false,
            "confidentiality_release_signed": false,
            "identity_verified": true,
            "compliance_completed": false,
            "contract_status": "not_started",
            "notes": null
        } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["identity_verified"], true);
    assert!(stored.get("dsgvo_signed").is_none(), "{stored}");
    assert!(
        stored.get("confidentiality_release_signed").is_none(),
        "{stored}"
    );

    // Unticking an item a signed document set is refused as well.
    support::seed_signed_consent_document(&pool, patient_id, "dsgvo", admin_id).await;
    let (status, body) = json_request(
        &app,
        "POST",
        &update,
        &ceo,
        Some(json!({ "legal_status": { "dsgvo_signed": false } })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["items"], json!(["dsgvo_signed"]));
    let (status, body) = json_request(
        &app,
        "POST",
        &update,
        &ceo,
        Some(json!({ "legal_status": { "notes": "Unterlagen geprüft" } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["dsgvo_signed"], true, "{stored}");
    assert_eq!(stored["notes"], "Unterlagen geprüft");
}

#[tokio::test]
async fn the_paper_signature_sets_the_item_and_the_card_names_the_signed_document() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id, json!({})).await;
    let release =
        seed_generated_draft(&pool, patient_id, "confidentiality_release", admin_id).await;
    let consent = seed_generated_draft(&pool, patient_id, "privacy_consents", admin_id).await;

    let card = detail(&app, patient_id, &ceo).await;
    let evidence = &card["legal_status_evidence"];
    assert_eq!(
        evidence["confidentiality_release"]["state"], "missing",
        "{evidence}"
    );
    assert_eq!(
        evidence["confidentiality_release"]["pending_document"]["id"],
        release.to_string()
    );
    assert_eq!(
        evidence["confidentiality_release"]["pending_document"]["signature_pending"],
        false
    );
    assert_eq!(
        evidence["confidentiality_release"]["template_id"],
        "confidentiality_release"
    );
    assert_eq!(evidence["dsgvo"]["state"], "missing");
    assert_eq!(
        evidence["dsgvo"]["pending_document"]["id"],
        consent.to_string()
    );
    assert_eq!(evidence["dsgvo"]["template_id"], "privacy_consents");

    // "Подписано на бумаге": the scan becomes the signed version and sets the item.
    let (status, signed) = sign_on_paper(&app, release, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["compliance_kind"], "confidentiality_release");
    let signed_version = signed["document_id"].as_str().unwrap().to_string();
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["confidentiality_release_signed"], true, "{stored}");
    assert!(stored.get("dsgvo_signed").is_none(), "{stored}");

    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(card["legal_status"]["confidentiality_release_signed"], true);
    let release_evidence = &card["legal_status_evidence"]["confidentiality_release"];
    assert_eq!(release_evidence["state"], "signed", "{release_evidence}");
    assert_eq!(release_evidence["signed_document"]["id"], signed_version);
    assert_eq!(
        release_evidence["signed_document"]["source"],
        "paper_signature"
    );
    assert!(release_evidence["signed_document"]["signed_at"].is_string());
    assert!(release_evidence["pending_document"].is_null());
    assert_eq!(card["legal_status_evidence"]["dsgvo"]["state"], "missing");

    // The DSGVO consent the same way.
    let (status, signed) = sign_on_paper(&app, consent, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["compliance_kind"], "dsgvo");
    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(card["legal_status"]["dsgvo_signed"], true);
    assert_eq!(card["legal_status_evidence"]["dsgvo"]["state"], "signed");
}

#[tokio::test]
async fn an_item_ticked_by_hand_before_stays_set_counts_for_the_gates_and_is_flagged() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    // A file from before 2026-10-12: both items ticked by hand, no document.
    let patient_id = seed_patient(
        &pool,
        admin_id,
        json!({
            "dsgvo_signed": true,
            "confidentiality_release_signed": true,
            "identity_verified": true,
            "document_pack_complete": true,
            "compliance_completed": true,
            "contract_status": "signed"
        }),
    )
    .await;
    sqlx::query(
        "UPDATE patients SET phone_primary = '+49 30 1234567', residence_country = 'DE', languages = ARRAY['de'] WHERE id = $1",
    )
    .bind(patient_id)
    .execute(&pool)
    .await
    .unwrap();
    // An earlier order makes the existing-customer re-check apply.
    sqlx::query(
        "INSERT INTO orders (order_number, patient_id, needs_description, created_by) VALUES ($1, $2, 'Earlier order', $3)",
    )
    .bind(format!("A-LEGAL-{}", Uuid::new_v4().simple()))
    .bind(patient_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(card["legal_status"]["dsgvo_signed"], true);
    assert_eq!(card["legal_status"]["confidentiality_release_signed"], true);
    for (kind, template) in [
        ("dsgvo", "privacy_consents"),
        ("confidentiality_release", "confidentiality_release"),
    ] {
        let evidence = &card["legal_status_evidence"][kind];
        assert_eq!(evidence["set"], true, "{kind}: {evidence}");
        assert_eq!(evidence["state"], "manual", "{kind}: {evidence}");
        assert!(evidence["signed_document"].is_null());
        assert!(evidence["pending_document"].is_null());
        assert_eq!(evidence["template_id"], template);
    }

    // The items keep counting: no running case is blocked.
    let (status, recheck) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/recheck"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{recheck}");
    assert_eq!(recheck["requires_recheck"], true);
    assert_eq!(recheck["compliance_ready"], true, "{recheck}");
    assert_eq!(recheck["confidentiality_release_ready"], true, "{recheck}");

    // A profile save re-sends them unchanged and keeps them; unticking is refused.
    let update = format!("/api/v1/patients/{patient_id}/update");
    let (status, body) = json_request(
        &app,
        "POST",
        &update,
        &ceo,
        Some(json!({ "legal_status": {
            "dsgvo_signed": true,
            "confidentiality_release_signed": true,
            "identity_verified": true,
            "document_pack_complete": true,
            "compliance_completed": true,
            "contract_status": "signed",
            "notes": "Scan folgt"
        } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = json_request(
        &app,
        "POST",
        &update,
        &ceo,
        Some(json!({ "legal_status": { "confidentiality_release_signed": false } })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["dsgvo_signed"], true);
    assert_eq!(stored["confidentiality_release_signed"], true);

    // The scan of the signed copy turns the flagged item into a signed one.
    let release =
        seed_generated_draft(&pool, patient_id, "confidentiality_release", admin_id).await;
    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(
        card["legal_status_evidence"]["confidentiality_release"]["pending_document"]["id"],
        release.to_string()
    );
    let (status, signed) = sign_on_paper(&app, release, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(
        card["legal_status_evidence"]["confidentiality_release"]["state"],
        "signed"
    );
    assert_eq!(card["legal_status_evidence"]["dsgvo"]["state"], "manual");
}

#[tokio::test]
async fn roles_without_the_legal_status_get_no_evidence() {
    let Some((app, pool, admin_id, _ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id, json!({ "dsgvo_signed": true })).await;
    let billing_id = seed_user(&pool, "billing").await;
    assign(&pool, patient_id, billing_id, admin_id).await;
    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}"),
        &bearer_for(billing_id, "billing"),
        None,
    )
    .await;
    if status == StatusCode::OK {
        assert!(body.get("legal_status").is_none(), "{body}");
        assert!(body.get("legal_status_evidence").is_none(), "{body}");
    } else {
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
}

/// Owner decision 2026-10-12: revoking the DSGVO consent in the consent
/// register unticks the item and blocks new orders until a consent signed
/// after the revocation exists; the card and the re-check say why.
#[tokio::test]
async fn a_revoked_dsgvo_consent_unticks_the_item_and_blocks_new_orders_until_signed_again() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    // A patient without earlier orders: the existing-customer re-check would
    // not apply, the revocation blocks anyway.
    let patient_id = seed_patient(&pool, admin_id, json!({})).await;
    support::seed_signed_consent_document(&pool, patient_id, "dsgvo", admin_id).await;
    support::seed_signed_consent_document(&pool, patient_id, "confidentiality_release", admin_id)
        .await;
    assert_eq!(
        recheck(&app, patient_id, &ceo).await["can_create_order"],
        true
    );

    let revoked = revoke_consent(&app, patient_id, "dsgvo_data_transfer", &ceo).await;
    assert_eq!(
        revoked["legal_status_items_withdrawn"],
        json!(["dsgvo_signed"])
    );
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["dsgvo_signed"], false, "{stored}");
    assert!(stored["dsgvo_revoked_at"].is_string(), "{stored}");
    assert_eq!(stored["confidentiality_release_signed"], true, "{stored}");
    assert!(stored.get("confidentiality_release_revoked_at").is_none());

    // The card says why.
    let card = detail(&app, patient_id, &ceo).await;
    let dsgvo = &card["legal_status_evidence"]["dsgvo"];
    assert_eq!(dsgvo["state"], "revoked", "{dsgvo}");
    assert_eq!(dsgvo["revoked_at"], stored["dsgvo_revoked_at"]);
    assert_eq!(
        card["legal_status_evidence"]["confidentiality_release"]["state"],
        "signed"
    );

    // New orders are blocked, with the reason.
    let blocked = recheck(&app, patient_id, &ceo).await;
    assert_eq!(blocked["can_create_order"], false, "{blocked}");
    assert_eq!(blocked["compliance_ready"], false);
    assert_eq!(blocked["confidentiality_release_ready"], true);
    let reasons = blocked["blocking_reasons"].as_array().unwrap();
    assert_eq!(reasons.len(), 1, "{blocked}");
    assert!(
        is_revocation_reason(&reasons[0], "DSGVO consent was revoked on "),
        "{blocked}"
    );
    assert_eq!(
        blocked["consent_revocations"]["dsgvo"],
        stored["dsgvo_revoked_at"]
    );
    let (status, refused) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &ceo,
        Some(json!({ "patient_id": patient_id, "needs_description": "Kontrolle nach Widerruf" })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(
        refused["message"],
        "Existing customer re-check is incomplete"
    );

    // Ticking by hand stays refused.
    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/patients/{patient_id}/update"),
        &ceo,
        Some(json!({ "legal_status": { "dsgvo_signed": true } })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // The scan of a copy signed before the revocation changes nothing.
    let older = seed_generated_draft(&pool, patient_id, "privacy_consents", admin_id).await;
    let before = (gmed_server::app_time::today() - chrono::Duration::days(2)).to_string();
    let (status, body) = sign_on_paper_dated(&app, older, &ceo, Some(&before)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["dsgvo_signed"], false, "{stored}");
    assert!(stored["dsgvo_revoked_at"].is_string(), "{stored}");
    assert_eq!(
        active_grants(&pool, patient_id, "dsgvo_data_transfer").await,
        0
    );
    assert_eq!(
        recheck(&app, patient_id, &ceo).await["can_create_order"],
        false
    );

    // A consent signed after the revocation sets the item again.
    let renewed = seed_generated_draft(&pool, patient_id, "privacy_consents", admin_id).await;
    let (status, body) = sign_on_paper(&app, renewed, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["dsgvo_signed"], true, "{stored}");
    assert!(stored.get("dsgvo_revoked_at").is_none(), "{stored}");
    assert_eq!(
        active_grants(&pool, patient_id, "dsgvo_data_transfer").await,
        1
    );
    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(card["legal_status_evidence"]["dsgvo"]["state"], "signed");
    assert!(card["legal_status_evidence"]["dsgvo"]["revoked_at"].is_null());
    let ready = recheck(&app, patient_id, &ceo).await;
    assert_eq!(ready["can_create_order"], true, "{ready}");
    let (status, created) = json_request(
        &app,
        "POST",
        "/api/v1/orders",
        &ceo,
        Some(json!({ "patient_id": patient_id, "needs_description": "Kontrolle nach neuer Einwilligung" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
}

/// A revoked Schweigepflichtsentbindung unticks only its item; for an
/// existing customer the re-check names both the missing release and why.
#[tokio::test]
async fn a_revoked_confidentiality_release_unticks_its_item_for_an_existing_customer() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id, json!({})).await;
    support::seed_signed_consent_document(&pool, patient_id, "dsgvo", admin_id).await;
    support::seed_signed_consent_document(&pool, patient_id, "confidentiality_release", admin_id)
        .await;
    sqlx::query(
        "INSERT INTO orders (order_number, patient_id, needs_description, created_by) VALUES ($1, $2, 'Earlier order', $3)",
    )
    .bind(format!("A-REVOKE-{}", Uuid::new_v4().simple()))
    .bind(patient_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    let revoked = revoke_consent(&app, patient_id, "schweigepflicht_release", &ceo).await;
    assert_eq!(
        revoked["legal_status_items_withdrawn"],
        json!(["confidentiality_release_signed"])
    );
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["confidentiality_release_signed"], false, "{stored}");
    assert!(stored["confidentiality_release_revoked_at"].is_string());
    assert_eq!(stored["dsgvo_signed"], true, "{stored}");

    let blocked = recheck(&app, patient_id, &ceo).await;
    assert_eq!(blocked["requires_recheck"], true);
    assert_eq!(blocked["can_create_order"], false);
    assert_eq!(blocked["confidentiality_release_ready"], false);
    let reasons = blocked["blocking_reasons"].as_array().unwrap();
    assert!(
        reasons
            .iter()
            .any(|reason| reason == "Medical confidentiality release is not signed"),
        "{blocked}"
    );
    assert!(
        reasons.iter().any(|reason| is_revocation_reason(
            reason,
            "Medical confidentiality release was revoked on "
        )),
        "{blocked}"
    );
    let card = detail(&app, patient_id, &ceo).await;
    assert_eq!(
        card["legal_status_evidence"]["confidentiality_release"]["state"],
        "revoked"
    );
    assert_eq!(card["legal_status_evidence"]["dsgvo"]["state"], "signed");

    // Another consent type (a channel) leaves the items alone.
    let channel = revoke_consent(&app, patient_id, "document_share_email", &ceo).await;
    assert_eq!(channel["legal_status_items_withdrawn"], json!([]));
    assert_eq!(
        stored_legal_status(&pool, patient_id).await["dsgvo_signed"],
        true
    );
}

/// Owner decision 2026-10-12: the Einverständniserklärung for a minor (with
/// the Schweigepflichtsentbindung clause) counts for both items when signed.
#[tokio::test]
async fn a_signed_child_consent_form_sets_both_items() {
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let patient_id = seed_patient(&pool, admin_id, json!({})).await;
    sqlx::query("UPDATE patients SET first_name = 'Ben', birth_date = '2016-03-03' WHERE id = $1")
        .bind(patient_id)
        .execute(&pool)
        .await
        .unwrap();
    let child_form = seed_generated_draft_of_type(
        &pool,
        patient_id,
        "consent_data_release_child",
        "consent_data_release",
        admin_id,
    )
    .await;

    // Before the signature the form waits for both items.
    let card = detail(&app, patient_id, &ceo).await;
    for kind in ["dsgvo", "confidentiality_release"] {
        let evidence = &card["legal_status_evidence"][kind];
        assert_eq!(evidence["state"], "missing", "{kind}: {evidence}");
        assert_eq!(evidence["pending_document"]["id"], child_form.to_string());
    }

    let (status, signed) = sign_on_paper(&app, child_form, &ceo).await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    assert_eq!(signed["compliance_kind"], "dsgvo");
    let signed_version = signed["document_id"].as_str().unwrap().to_string();
    let stored = stored_legal_status(&pool, patient_id).await;
    assert_eq!(stored["dsgvo_signed"], true, "{stored}");
    assert_eq!(stored["confidentiality_release_signed"], true, "{stored}");
    assert_eq!(
        active_grants(&pool, patient_id, "dsgvo_data_transfer").await,
        1
    );
    assert_eq!(
        active_grants(&pool, patient_id, "schweigepflicht_release").await,
        1
    );

    let card = detail(&app, patient_id, &ceo).await;
    for kind in ["dsgvo", "confidentiality_release"] {
        let evidence = &card["legal_status_evidence"][kind];
        assert_eq!(evidence["state"], "signed", "{kind}: {evidence}");
        assert_eq!(evidence["signed_document"]["id"], signed_version);
        assert!(evidence["pending_document"].is_null());
    }
}

/// Lead conversion follows the same rules: a signed child form satisfies the
/// confidentiality requirement, and a consent the patient revoked counts only
/// when signed after the revocation.
#[tokio::test]
async fn lead_readiness_counts_a_child_form_for_both_and_ignores_consents_older_than_a_revocation()
{
    let Some((app, pool, admin_id, ceo)) = test_context().await else {
        return;
    };
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
               first_name, last_name, email, phone, country, primary_language,
               date_of_birth, legal_sex, qualification_status, intake_source, created_by
           ) VALUES (
               'Ben', 'Muster', $1, '+4915100000001', 'DE', 'de',
               DATE '2016-03-03', 'male', 'in_progress', 'staff_wizard', $2
           ) RETURNING id"#,
    )
    .bind(format!("ben-{}@example.com", Uuid::new_v4().simple()))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let check = |lead: &Value, key: &str| {
        lead["readiness"]["checks"]
            .as_array()
            .and_then(|checks| checks.iter().find(|check| check["key"] == key))
            .and_then(|check| check["passed"].as_bool())
            .unwrap_or_else(|| panic!("missing readiness check {key}: {lead}"))
    };
    let lead = |app: axum::Router, bearer: String| async move {
        let (status, body) = json_request(
            &app,
            "GET",
            &format!("/api/v1/leads/{lead_id}"),
            &bearer,
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        body
    };

    let before = lead(app.clone(), ceo.clone()).await;
    assert!(!check(&before, "confidentiality_release_signed"));

    // The minor's Einverständniserklärung signed two days ago.
    sqlx::query(
        r#"INSERT INTO documents (
               id, lead_id, auto_name, original_filename, art, category, status, visibility,
               is_medical, mime_type, generated_template_id, ursprung,
               version_root_document_id, version_number,
               uploaded_by, signed_at, signed_by, compliance_kind
           ) VALUES (
               $3, $1, 'Einverständniserklärung (Kind)', 'einverstaendnis-kind.pdf',
               'consent_data_release', 'consent', 'active', 'internal', false,
               'application/pdf', 'consent_data_release_child', 'paper_signature',
               $3, 1, $2, now() - INTERVAL '2 days', $2, 'dsgvo'
           )"#,
    )
    .bind(lead_id)
    .bind(admin_id)
    .bind(Uuid::new_v4())
    .execute(&pool)
    .await
    .unwrap();
    let signed = lead(app.clone(), ceo.clone()).await;
    assert!(check(&signed, "dsgvo_document_signed"), "{signed}");
    assert!(check(&signed, "confidentiality_release_signed"), "{signed}");

    // The patient of this request revoked the DSGVO consent yesterday: the
    // older signature no longer counts for it.
    let patient_id = seed_patient(
        &pool,
        admin_id,
        json!({ "dsgvo_signed": false, "dsgvo_revoked_at": (chrono::Utc::now() - chrono::Duration::days(1)).to_rfc3339() }),
    )
    .await;
    sqlx::query("UPDATE leads SET prospect_patient_id = $2 WHERE id = $1")
        .bind(lead_id)
        .bind(patient_id)
        .execute(&pool)
        .await
        .unwrap();
    let revoked = lead(app.clone(), ceo.clone()).await;
    assert!(!check(&revoked, "dsgvo_document_signed"), "{revoked}");
    assert!(
        check(&revoked, "confidentiality_release_signed"),
        "{revoked}"
    );
}
