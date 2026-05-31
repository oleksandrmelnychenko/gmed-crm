mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<(axum::Router, PgPool, Uuid)> {
    let ctx = support::suite_context(TEST_SECRET).await?;
    Some((ctx.app, ctx.pool, ctx.admin_id))
}

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
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn multipart_upload(
    app: &axum::Router,
    path: &str,
    bearer: &str,
    text_fields: &[(&str, String)],
    file_name: &str,
    mime_type: &str,
    file_bytes: &[u8],
) -> (StatusCode, Value) {
    let boundary = format!("----gmed-boundary-{}", Uuid::new_v4().simple());
    let mut body = Vec::new();

    for (name, value) in text_fields {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
        );
        body.extend_from_slice(value.as_bytes());
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(
        format!(
            "Content-Disposition: form-data; name=\"file\"; filename=\"{file_name}\"\r\nContent-Type: {mime_type}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file_bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    let request = Request::builder()
        .method("POST")
        .uri(path)
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
    let payload = serde_json::from_slice(&bytes).unwrap_or(json!(null));
    (status, payload)
}

async fn download_request(app: &axum::Router, path: &str, bearer: &str) -> (StatusCode, Vec<u8>) {
    let request = Request::builder()
        .method("GET")
        .uri(path)
        .header("Authorization", bearer)
        .body(Body::empty())
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap()
        .to_vec();
    (status, bytes)
}

fn auth_header_for(user_id: Uuid, role: &str) -> String {
    let token = jwt::issue_access_token(TEST_SECRET, user_id, role, Uuid::new_v4()).unwrap();
    format!("Bearer {token}")
}

fn unique_tag(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4().simple())
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO users (email, password_hash, name, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id"#,
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind("test-password-hash")
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn manager_can_save_interpreter_profile_and_interpreter_can_view_self() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let other_interpreter_id = seed_user(&pool, &format!("{tag}-other"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let other_bearer = auth_header_for(other_interpreter_id, "interpreter");

    let (status, body) = json_request(&app, "GET", "/api/v1/interpreters", &pm_bearer, None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters?status=active&search={tag}-int"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let profile = json!({
        "status": "active",
        "contractType": "freelancer",
        "employmentKind": "external",
        "phone": "+49 170 000000",
        "workCountries": ["DE"],
        "workLocations": ["Berlin", "Charite"],
        "credentials": [
            {
                "credentialType": "medical_translation",
                "title": "Medical translation certificate",
                "issuer": "GMED Academy",
                "issuedAt": "2026-01-15",
                "expiresAt": "2027-01-15",
                "documentUrl": "https://example.com/cert.pdf",
                "notes": "Annual renewal required"
            }
        ],
        "languages": [
            { "language": "de", "level": "C1", "specialization": "medicine" }
        ],
        "compliance": {
            "confidentialityStatus": "signed",
            "gdprTrainingAt": "2026-05-31"
        },
        "finance": {
            "hourlyRate": 45,
            "billingStatus": "unpaid"
        },
        "access": {
            "level": "appointment_only",
            "autoBlockPolicy": "immediate"
        },
        "equipment": ["Secure phone"],
        "internalNotes": "Ready for controlled rollout"
    });

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(profile.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["status"], "active");
    assert_eq!(
        body["profile"]["finance"]["hourlyRate"].as_f64(),
        Some(45.0)
    );
    assert_eq!(body["profile"]["workCountries"], json!(["DE"]));
    assert_eq!(
        body["profile"]["workLocations"],
        json!(["Berlin", "Charite"])
    );
    assert_eq!(
        body["profile"]["credentials"][0]["title"],
        "Medical translation certificate"
    );
    assert_eq!(body["profile"]["credentials"][0]["expiresAt"], "2027-01-15");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters?status=active&contract_type=freelancer&search={tag}"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let (status, body) = json_request(
        &app,
        "GET",
        "/api/v1/interpreters?status=invalid",
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid interpreter status");

    let details = sqlx::query(
        r#"SELECT status, contract_type, phone, email_secure
           FROM interpreter_profile_details
           WHERE user_id = $1"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(details.try_get::<String, _>("status").unwrap(), "active");
    assert_eq!(
        details
            .try_get::<Option<String>, _>("contract_type")
            .unwrap()
            .as_deref(),
        Some("freelancer")
    );
    assert_eq!(
        details
            .try_get::<Option<String>, _>("phone")
            .unwrap()
            .as_deref(),
        Some("+49 170 000000")
    );
    assert!(!details.try_get::<bool, _>("email_secure").unwrap());

    let hourly_rate: Option<String> = sqlx::query_scalar(
        "SELECT hourly_rate::text FROM interpreter_finance_profiles WHERE user_id = $1",
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(hourly_rate.as_deref(), Some("45.00"));

    let zone_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM interpreter_work_zones
           WHERE interpreter_id = $1
             AND value IN ('DE', 'Berlin', 'Charite')"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(zone_count, 3);

    let equipment_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM interpreter_equipment
           WHERE interpreter_id = $1
             AND label = 'Secure phone'"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(equipment_count, 1);

    let credential = sqlx::query(
        r#"SELECT credential_type, title, issuer, expires_at
           FROM interpreter_credentials
           WHERE interpreter_id = $1"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        credential.try_get::<String, _>("credential_type").unwrap(),
        "medical_translation"
    );
    assert_eq!(
        credential.try_get::<String, _>("title").unwrap(),
        "Medical translation certificate"
    );
    assert_eq!(
        credential
            .try_get::<Option<String>, _>("issuer")
            .unwrap()
            .as_deref(),
        Some("GMED Academy")
    );
    assert_eq!(
        credential
            .try_get::<Option<chrono::NaiveDate>, _>("expires_at")
            .unwrap()
            .map(|date| date.to_string())
            .as_deref(),
        Some("2027-01-15")
    );

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["contractType"], "freelancer");
    assert!(body["profile"]["finance"].is_null());
    assert!(body["profile"]["internalNotes"].is_null());

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &other_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &interpreter_bearer,
        Some(json!({ "status": "blocked" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");
}

#[tokio::test]
async fn interpreter_profile_rejects_invalid_structured_values() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile-invalid");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "unknown",
            "finance": { "hourlyRate": "not-a-number" }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid interpreter status");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "active",
            "credentials": [
                { "credentialType": "bogus", "title": "Broken credential" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid interpreter credential type");
}

#[tokio::test]
async fn it_admin_can_manage_interpreter_profiles() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile-it-admin");
    let it_admin_id = seed_user(&pool, &format!("{tag}-it"), "it_admin").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let it_admin_bearer = auth_header_for(it_admin_id, "it_admin");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters?search={tag}-int"),
        &it_admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert!(
        body.as_array()
            .unwrap()
            .iter()
            .any(|item| item["id"] == interpreter_id.to_string())
    );

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &it_admin_bearer,
        Some(json!({
            "status": "training",
            "contractType": "hourly",
            "employmentKind": "internal",
            "access": {
                "level": "appointment_only",
                "autoBlockPolicy": "immediate"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["status"], "training");
    assert_eq!(body["profile"]["contractType"], "hourly");
    assert_eq!(body["profile"]["access"]["autoBlockPolicy"], "immediate");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &it_admin_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["status"], "training");
}

#[tokio::test]
async fn partial_interpreter_profile_update_preserves_omitted_structured_fields() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile-partial");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "active",
            "contractType": "freelancer",
            "workCountries": ["DE", "AT"],
            "workLocations": ["Berlin"],
            "equipment": ["Secure phone"],
            "credentials": [
                {
                    "credentialType": "medical_translation",
                    "title": "Medical translation certificate",
                    "issuer": "GMED Academy"
                }
            ],
            "finance": {
                "hourlyRate": 55,
                "bankDetails": "DE00 0000 0000 0000 0000 00",
                "billingStatus": "unpaid"
            },
            "access": {
                "level": "appointment_only",
                "autoBlockPolicy": "immediate"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "vacation",
            "finance": {
                "billingStatus": "paid"
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["profile"]["status"], "vacation");
    assert_eq!(body["profile"]["contractType"], "freelancer");
    assert_eq!(body["profile"]["workCountries"], json!(["DE", "AT"]));
    assert_eq!(body["profile"]["workLocations"], json!(["Berlin"]));
    assert_eq!(body["profile"]["equipment"], json!(["Secure phone"]));
    assert_eq!(
        body["profile"]["credentials"][0]["title"],
        "Medical translation certificate"
    );
    assert_eq!(
        body["profile"]["finance"]["hourlyRate"].as_f64(),
        Some(55.0)
    );
    assert_eq!(
        body["profile"]["finance"]["bankDetails"],
        "DE00 0000 0000 0000 0000 00"
    );
    assert_eq!(body["profile"]["finance"]["billingStatus"], "paid");
    assert_eq!(body["profile"]["access"]["autoBlockPolicy"], "immediate");

    let zone_count: i64 = sqlx::query_scalar(
        r#"SELECT count(*)
           FROM interpreter_work_zones
           WHERE interpreter_id = $1
             AND value IN ('DE', 'AT', 'Berlin')"#,
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(zone_count, 3);

    let credential_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM interpreter_credentials WHERE interpreter_id = $1",
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(credential_count, 1);
}

#[tokio::test]
async fn managers_can_manage_interpreter_languages_and_interpreters_can_read_self() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-languages");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let other_interpreter_id = seed_user(&pool, &format!("{tag}-other"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let other_bearer = auth_header_for(other_interpreter_id, "interpreter");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &pm_bearer,
        Some(json!({
            "languages": [
                {
                    "languageCode": "DE",
                    "languageLabel": "Deutsch",
                    "proficiency": "fluent",
                    "cefrLevel": "c1",
                    "specialization": "medicine"
                },
                {
                    "languageCode": "uk",
                    "languageLabel": "Ukrainisch",
                    "proficiency": "native",
                    "level": "C2",
                    "specialization": "legal"
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let languages = body.as_array().unwrap();
    assert_eq!(languages.len(), 2);
    assert!(languages.iter().any(|item| {
        item["language_code"] == "de"
            && item["language_label"] == "Deutsch"
            && item["proficiency"] == "fluent"
            && item["cefr_level"] == "C1"
            && item["specialization"] == "medicine"
    }));
    assert!(languages.iter().any(|item| {
        item["language_code"] == "uk"
            && item["language_label"] == "Ukrainisch"
            && item["proficiency"] == "native"
            && item["cefr_level"] == "C2"
            && item["specialization"] == "legal"
    }));

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &interpreter_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body.as_array().unwrap().len(), 2);

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &other_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &interpreter_bearer,
        Some(json!({ "languages": [] })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &pm_bearer,
        Some(json!({
            "languages": [
                { "languageCode": "de", "proficiency": "working" },
                { "languageCode": "DE", "proficiency": "basic" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Duplicate language code");

    let saved_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM interpreter_languages WHERE interpreter_id = $1")
            .bind(interpreter_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(saved_count, 2);

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &pm_bearer,
        Some(json!({
            "languages": [
                { "languageCode": "de!", "proficiency": "working" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid language code");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &pm_bearer,
        Some(json!({
            "languages": [
                { "languageCode": "de", "proficiency": "expert" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid proficiency");

    let (status, body) = json_request(
        &app,
        "POST",
        &format!("/api/v1/interpreters/{interpreter_id}/languages"),
        &pm_bearer,
        Some(json!({
            "languages": [
                { "languageCode": "de", "cefrLevel": "D1" }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(body["message"], "Invalid CEFR level");
}

#[tokio::test]
async fn interpreter_profile_documents_upload_link_and_download() {
    let Some((app, pool, _admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-profile-docs");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let other_interpreter_id = seed_user(&pool, &format!("{tag}-other"), "interpreter").await;
    let billing_id = seed_user(&pool, &format!("{tag}-billing"), "billing").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");
    let interpreter_bearer = auth_header_for(interpreter_id, "interpreter");
    let other_bearer = auth_header_for(other_interpreter_id, "interpreter");
    let billing_bearer = auth_header_for(billing_id, "billing");

    let (status, body) = multipart_upload(
        &app,
        &format!("/api/v1/interpreters/{interpreter_id}/profile/documents"),
        &pm_bearer,
        &[("documentKind", "confidentiality".to_string())],
        "confidentiality.pdf",
        "application/pdf",
        b"%PDF-interpreter-confidentiality%",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let confidentiality_document_id =
        Uuid::parse_str(body["id"].as_str().expect("uploaded document id")).unwrap();
    assert_eq!(body["documentKind"], "confidentiality");

    let (status, body) = multipart_upload(
        &app,
        &format!("/api/v1/interpreters/{interpreter_id}/profile/documents"),
        &pm_bearer,
        &[("documentKind", "credential".to_string())],
        "sworn-certificate.pdf",
        "application/pdf",
        b"%PDF-interpreter-credential%",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    let credential_document_id =
        Uuid::parse_str(body["id"].as_str().expect("credential document id")).unwrap();

    let (status, body) = multipart_upload(
        &app,
        &format!("/api/v1/interpreters/{interpreter_id}/profile/documents"),
        &interpreter_bearer,
        &[("documentKind", "credential".to_string())],
        "self-upload.pdf",
        "application/pdf",
        b"%PDF-self-upload%",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "Insufficient permissions");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "active",
            "compliance": {
                "confidentialityStatus": "signed",
                "confidentialityDocumentId": confidentiality_document_id
            },
            "credentials": [
                {
                    "credentialType": "sworn_interpreter",
                    "title": "Sworn interpreter certificate",
                    "issuer": "Court",
                    "documentId": credential_document_id
                }
            ]
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(
        body["profile"]["compliance"]["confidentialityDocumentId"],
        confidentiality_document_id.to_string()
    );
    assert_eq!(
        body["profile"]["credentials"][0]["documentId"],
        credential_document_id.to_string()
    );
    assert_eq!(
        body["profile"]["credentials"][0]["documentName"],
        "sworn-certificate.pdf"
    );

    let compliance_document: Option<Uuid> = sqlx::query_scalar(
        "SELECT confidentiality_document_id FROM interpreter_compliance_profiles WHERE user_id = $1",
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(compliance_document, Some(confidentiality_document_id));

    let credential_document: Option<Uuid> = sqlx::query_scalar(
        "SELECT document_id FROM interpreter_credentials WHERE interpreter_id = $1",
    )
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(credential_document, Some(credential_document_id));

    let (status, bytes) = download_request(
        &app,
        &format!(
            "/api/v1/interpreters/{interpreter_id}/profile/documents/{credential_document_id}/download"
        ),
        &pm_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&bytes).contains("%PDF-interpreter-credential%"));

    let (status, bytes) = download_request(
        &app,
        &format!(
            "/api/v1/interpreters/{interpreter_id}/profile/documents/{credential_document_id}/download"
        ),
        &interpreter_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(String::from_utf8_lossy(&bytes).contains("%PDF-interpreter-credential%"));

    let (status, _bytes) = download_request(
        &app,
        &format!(
            "/api/v1/interpreters/{interpreter_id}/profile/documents/{credential_document_id}/download"
        ),
        &other_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, _bytes) = download_request(
        &app,
        &format!(
            "/api/v1/interpreters/{interpreter_id}/profile/documents/{credential_document_id}/download"
        ),
        &billing_bearer,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "active",
            "compliance": {
                "confidentialityDocumentId": Uuid::new_v4()
            }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        body["message"],
        "Document is not linked to interpreter profile"
    );
}

#[tokio::test]
async fn interpreter_profile_operations_exposes_live_workload() {
    let Some((app, pool, admin_id)) = test_context().await else {
        return;
    };

    let tag = unique_tag("interpreter-operations");
    let pm_id = seed_user(&pool, &format!("{tag}-pm"), "patient_manager").await;
    let interpreter_id = seed_user(&pool, &format!("{tag}-int"), "interpreter").await;
    let pm_bearer = auth_header_for(pm_id, "patient_manager");

    let (status, body) = json_request(
        &app,
        "PUT",
        &format!("/api/v1/interpreters/{interpreter_id}/profile"),
        &pm_bearer,
        Some(json!({
            "status": "active",
            "weeklyCapacityHours": 30
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");

    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by
           ) VALUES ($1, 'Live', 'Workload', CURRENT_DATE - interval '35 years', 'female', $2)
           RETURNING id"#,
    )
    .bind(format!("P-{tag}"))
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (order_number, patient_id, created_by)
           VALUES ($1, $2, $3)
           RETURNING id"#,
    )
    .bind(format!("ORD-{tag}"))
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, order_id, interpreter_id, appointment_type, title,
                date, time_start, time_end, status, interpreter_response, created_by
           ) VALUES (
                $1, $2, $3, 'medical', 'Live workload test',
                CURRENT_DATE, '09:00', '10:30', 'confirmed', 'accepted', $4
           )
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(order_id)
    .bind(interpreter_id)
    .bind(pm_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let report_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO interpreter_reports (
                appointment_id, interpreter_id, hours, approval_status
           ) VALUES ($1, $2, 1.50, 'approved')
           RETURNING id"#,
    )
    .bind(appointment_id)
    .bind(interpreter_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, status, source_interpreter_report_id
           ) VALUES ($1, 'Interpreter report sync', 1, 90.00, 'approved', $2)"#,
    )
    .bind(order_id)
    .bind(report_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO tasks (
                title, assigned_to, assigned_by, patient_id, order_id, appointment_id,
                due_date, priority, status
           ) VALUES (
                'Confirm terminology pack', $1, $2, $3, $4, $5,
                now() + interval '1 day', 'high', 'open'
           )"#,
    )
    .bind(interpreter_id)
    .bind(pm_id)
    .bind(patient_id)
    .bind(order_id)
    .bind(appointment_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, appointment_id, interpreter_id, submitted_by,
                source, overall_score, interpreter_score, nps_score
           ) VALUES ($1, $2, $3, $4, 'staff_capture', 5, 4, 9)"#,
    )
    .bind(patient_id)
    .bind(appointment_id)
    .bind(interpreter_id)
    .bind(pm_id)
    .execute(&pool)
    .await
    .unwrap();

    let (status, body) = json_request(
        &app,
        "GET",
        &format!("/api/v1/interpreters/{interpreter_id}/profile/operations"),
        &pm_bearer,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body:?}");
    assert_eq!(body["summary"]["assigned_patients"], 1);
    assert_eq!(body["summary"]["appointments_next_30_days"], 1);
    assert_eq!(
        body["summary"]["capacity_hours_week"].as_f64().unwrap(),
        30.0
    );
    assert_eq!(body["summary"]["booked_hours_week"].as_f64().unwrap(), 1.5);
    assert_eq!(
        body["summary"]["average_feedback_score"].as_f64().unwrap(),
        4.0
    );
    assert_eq!(body["summary"]["active_tasks"], 1);
    assert_eq!(body["summary"]["approved_reports"], 1);
    assert_eq!(body["summary"]["synced_billing_lines"], 1);
    assert_eq!(body["patients"][0]["patient_code"], format!("P-{tag}"));
    assert_eq!(
        body["upcoming_appointments"][0]["title"],
        "Live workload test"
    );
    assert_eq!(body["active_tasks"][0]["title"], "Confirm terminology pack");
    assert_eq!(body["recent_reports"][0]["billing_status"], "approved");
    assert_eq!(
        body["billing_lines"][0]["description"],
        "Interpreter report sync"
    );
}
