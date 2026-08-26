mod support;

use axum::body::Body;
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const INSTANCE_ID: &str = "0123456789ABCDEF0123456789ABCDEF";

async fn json_request(
    app: &axum::Router,
    method: Method,
    path: &str,
    bearer: &str,
    body: Value,
) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 2 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

fn auth_header(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

async fn seed_user(pool: &PgPool, role: &str) -> Uuid {
    let suffix = Uuid::new_v4().simple().to_string();
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, 'test-password-hash', $2, $3)
           RETURNING id"#,
    )
    .bind(format!("bmp-import-{role}-{suffix}@example.com"))
    .bind(format!("BMP import {role}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_patient(pool: &PgPool, created_by: Uuid, suffix: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
               patient_id, first_name, last_name, birth_date, gender, created_by, languages
           ) VALUES ($1, 'Erika', 'Mustermann', '1980-01-02', 'diverse', $2, ARRAY['de']::text[])
           RETURNING id"#,
    )
    .bind(format!("PT-BMP-{suffix}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

fn carrier(patient_family: &str, medication: &str) -> String {
    format!(
        r#"<MP v="028" U="{INSTANCE_ID}" l="de-DE"><P g="Erika" f="{patient_family}" b="19800102" s="W"/><A n="Praxis Beispiel" t="2026-08-26T10:15:30"/><S c="412">{medication}</S></MP>"#
    )
}

fn valid_medication() -> &'static str {
    r#"<M p="12345678" a="Ibu Beispiel" fd="Tablette" m="1" d="1/2" dud="Stück"><W w="Ibuprofen" s="400 mg"/></M>"#
}

#[tokio::test]
async fn ceo_previews_confirms_and_replays_once_while_non_ceo_is_denied() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let suffix = Uuid::new_v4().simple().to_string();
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &suffix).await;
    sqlx::query(
        r#"INSERT INTO patient_medications
              (patient_id, wirkstoff, handelsname, category, status, on_hold, sort_order)
           VALUES ($1, 'Altstoff', 'Altpräparat', 'dauer', 'aktiv', false, 0)"#,
    )
    .bind(patient_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let manager_id = seed_user(&ctx.pool, "patient_manager").await;
    let ceo = auth_header(ctx.admin_id, "ceo");
    let manager = auth_header(manager_id, "patient_manager");
    let preview_path = format!("/api/v1/patients/{patient_id}/bmp-imports/preview");
    let confirm_path = format!("/api/v1/patients/{patient_id}/bmp-imports/confirm");
    let xml = carrier("Mustermann", valid_medication());

    let (denied, _) = json_request(
        &ctx.app,
        Method::POST,
        &preview_path,
        &manager,
        json!({ "carrier_xml": xml }),
    )
    .await;
    assert_eq!(denied, StatusCode::FORBIDDEN);

    let (preview_status, preview) = json_request(
        &ctx.app,
        Method::POST,
        &preview_path,
        &ceo,
        json!({ "carrier_xml": xml }),
    )
    .await;
    assert_eq!(preview_status, StatusCode::OK, "{preview}");
    assert_eq!(preview["identity_match"]["status"], "matched");
    assert_eq!(preview["permissions"]["can_confirm"], true);
    assert_eq!(preview["summary"]["current_medications_replaced"], 1);
    let key = format!("bmp-confirm-{suffix}");
    let confirm_body = json!({
        "carrier_xml": xml,
        "preview_fingerprint": preview["preview_fingerprint"],
        "idempotency_key": key,
        "staff_acknowledged": true,
    });
    let (confirm_status, confirmed) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        confirm_body.clone(),
    )
    .await;
    assert_eq!(confirm_status, StatusCode::CREATED, "{confirmed}");
    assert_eq!(confirmed["imported_medications"], 1);
    assert_eq!(confirmed["superseded_medications"], 1);
    assert_eq!(confirmed["idempotent_replay"], false);

    let (replay_status, replay) =
        json_request(&ctx.app, Method::POST, &confirm_path, &ceo, confirm_body).await;
    assert_eq!(replay_status, StatusCode::OK, "{replay}");
    assert_eq!(replay["import_id"], confirmed["import_id"]);
    assert_eq!(replay["idempotent_replay"], true);

    let counts = sqlx::query(
        r#"SELECT
             (SELECT COUNT(*) FROM patient_bmp_imports WHERE patient_id = $1) AS imports,
             (SELECT COUNT(*) FROM patient_medications WHERE patient_id = $1 AND superseded_at IS NULL) AS current_meds,
             (SELECT COUNT(*) FROM patient_medications WHERE patient_id = $1 AND superseded_at IS NOT NULL) AS old_meds,
             (SELECT COUNT(*) FROM patient_clinical_versions WHERE patient_id = $1 AND section = 'medications') AS versions"#,
    )
    .bind(patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(counts.get::<i64, _>("imports"), 1);
    assert_eq!(counts.get::<i64, _>("current_meds"), 1);
    assert_eq!(counts.get::<i64, _>("old_meds"), 1);
    assert_eq!(counts.get::<i64, _>("versions"), 1);
    let identifiers: Value = sqlx::query_scalar(
        "SELECT source_identifiers FROM patient_medications WHERE patient_id = $1 AND superseded_at IS NULL",
    )
    .bind(patient_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(identifiers["source"], "kbv_bmp_carrier");
    assert_eq!(identifiers["pzn"], "12345678");
}

#[tokio::test]
async fn mismatch_blocking_rows_stale_preview_and_cross_patient_key_reuse_are_rejected() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let suffix = Uuid::new_v4().simple().to_string();
    let patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("A-{suffix}")).await;
    let second_patient_id = seed_patient(&ctx.pool, ctx.admin_id, &format!("B-{suffix}")).await;
    let ceo = auth_header(ctx.admin_id, "ceo");
    let preview_path = format!("/api/v1/patients/{patient_id}/bmp-imports/preview");
    let confirm_path = format!("/api/v1/patients/{patient_id}/bmp-imports/confirm");

    let mismatch_xml = carrier("Andere", valid_medication());
    let (_, mismatch) = json_request(
        &ctx.app,
        Method::POST,
        &preview_path,
        &ceo,
        json!({ "carrier_xml": mismatch_xml }),
    )
    .await;
    assert_eq!(mismatch["identity_match"]["status"], "mismatch");
    assert_eq!(mismatch["permissions"]["can_confirm"], false);
    let (mismatch_status, mismatch_error) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        json!({
            "carrier_xml": mismatch_xml,
            "preview_fingerprint": mismatch["preview_fingerprint"],
            "idempotency_key": format!("bmp-mismatch-{suffix}"),
            "staff_acknowledged": true,
        }),
    )
    .await;
    assert_eq!(mismatch_status, StatusCode::CONFLICT, "{mismatch_error}");
    assert_eq!(mismatch_error["code"], "bmp_patient_identity_mismatch");

    let unresolved_xml = carrier(
        "Mustermann",
        r#"<M p="12345678" a="Product only" fd="Tablette" m="1"/>"#,
    );
    let (_, unresolved) = json_request(
        &ctx.app,
        Method::POST,
        &preview_path,
        &ceo,
        json!({ "carrier_xml": unresolved_xml }),
    )
    .await;
    assert_eq!(unresolved["summary"]["blocked_medications"], 1);
    assert_eq!(unresolved["permissions"]["can_confirm"], false);
    let (blocked_status, blocked) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        json!({
            "carrier_xml": unresolved_xml,
            "preview_fingerprint": unresolved["preview_fingerprint"],
            "idempotency_key": format!("bmp-blocked-{suffix}"),
            "staff_acknowledged": true,
        }),
    )
    .await;
    assert_eq!(
        blocked_status,
        StatusCode::UNPROCESSABLE_ENTITY,
        "{blocked}"
    );
    assert_eq!(blocked["code"], "bmp_import_blocked");

    let xml = carrier("Mustermann", valid_medication());
    let (_, preview) = json_request(
        &ctx.app,
        Method::POST,
        &preview_path,
        &ceo,
        json!({ "carrier_xml": xml }),
    )
    .await;
    sqlx::query("UPDATE patients SET first_name = 'Changed' WHERE id = $1")
        .bind(patient_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let key = format!("bmp-conflict-{suffix}");
    let (stale_status, stale) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        json!({
            "carrier_xml": xml,
            "preview_fingerprint": preview["preview_fingerprint"],
            "idempotency_key": key,
            "staff_acknowledged": true,
        }),
    )
    .await;
    assert_eq!(stale_status, StatusCode::CONFLICT, "{stale}");
    assert_eq!(stale["code"], "bmp_preview_stale");

    sqlx::query("UPDATE patients SET first_name = 'Erika' WHERE id = $1")
        .bind(patient_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let (_, refreshed) = json_request(
        &ctx.app,
        Method::POST,
        &preview_path,
        &ceo,
        json!({ "carrier_xml": xml }),
    )
    .await;
    let (created_status, created) = json_request(
        &ctx.app,
        Method::POST,
        &confirm_path,
        &ceo,
        json!({
            "carrier_xml": xml,
            "preview_fingerprint": refreshed["preview_fingerprint"],
            "idempotency_key": key,
            "staff_acknowledged": true,
        }),
    )
    .await;
    assert_eq!(created_status, StatusCode::CREATED, "{created}");

    let second_preview_path = format!("/api/v1/patients/{second_patient_id}/bmp-imports/preview");
    let second_confirm_path = format!("/api/v1/patients/{second_patient_id}/bmp-imports/confirm");
    let (_, second_preview) = json_request(
        &ctx.app,
        Method::POST,
        &second_preview_path,
        &ceo,
        json!({ "carrier_xml": xml }),
    )
    .await;
    let (conflict_status, conflict) = json_request(
        &ctx.app,
        Method::POST,
        &second_confirm_path,
        &ceo,
        json!({
            "carrier_xml": xml,
            "preview_fingerprint": second_preview["preview_fingerprint"],
            "idempotency_key": key,
            "staff_acknowledged": true,
        }),
    )
    .await;
    assert_eq!(conflict_status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(conflict["code"], "bmp_idempotency_conflict");
}
