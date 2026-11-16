//! An existing patient changes the consent options and the trusted persons
//! (owner request 2026-11-16): staff in the patient card, the patient in the
//! portal. A removal applies at once, an addition once the new version of the
//! consent form is signed; the lead the patient came from stays frozen.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::auth::jwt;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";
const TEXT_VERSION: &str = "2026-10-12";

fn bearer(user_id: Uuid, role: &str) -> String {
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
    let req = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", bearer)
        .header("Content-Type", "application/json")
        .body(match body {
            Some(value) => Body::from(serde_json::to_vec(&value).unwrap()),
            None => Body::empty(),
        })
        .unwrap();
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let bytes = axum::body::to_bytes(resp.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(json!(null)),
    )
}

async fn seed_user(pool: &PgPool, tag: &str, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'x', $2, $3) RETURNING id",
    )
    .bind(format!("{tag}-{role}@example.com"))
    .bind(format!("{role} {tag}"))
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient_id: Uuid, user_id: Uuid, by: Uuid) {
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(by)
    .execute(pool)
    .await
    .unwrap();
}

fn person(name: &str, scopes: &[&str]) -> Value {
    json!({
        "name": name,
        "relation": "relative",
        "phone": "+49 30 1234567",
        "birth_date": "1970-01-02",
        "scope_codes": scopes,
    })
}

fn core(extra: Value) -> Value {
    let mut choices = json!({
        "agency_processing": true,
        "doctors_to_agency": true,
        "data_system": true,
        "named_recipients": true,
    });
    if let (Some(choices), Some(extra)) = (choices.as_object_mut(), extra.as_object()) {
        for (key, value) in extra {
            choices.insert(key.clone(), value.clone());
        }
    }
    choices
}

struct Fixture {
    patient_id: Uuid,
    lead_id: Uuid,
    lead_choice_id: Uuid,
}

/// An adult patient converted from a lead whose cabinet named two trusted
/// persons (Eva for everything, Otto for medical information).
async fn seed_converted_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Fixture {
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
           VALUES ($1, 'Erika', 'Muster', '1980-03-04', 'female', $2)
           RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    let persons = json!([
        person("Eva Muster", &["all"]),
        person("Otto Muster", &["medical"])
    ]);
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (first_name, last_name, date_of_birth, qualification_status,
                              converted_patient_id, portal_trusted_persons, created_by)
           VALUES ('Erika', 'Muster', '1980-03-04', 'converted', $1, $2, $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(&persons)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    let lead_choice_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO consent_form_choices (
               template_id, lead_id, choices, chosen_by, access_kind, source, language,
               text_version, recipients, disclosure, recorded_how)
           VALUES ('privacy_consents', $1, $2, $3, 'staff', 'staff_recorded', 'de', $4, $5, $6, 'phone')
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(core(json!({ "channel_whatsapp": true })))
    .bind(created_by)
    .bind(TEXT_VERSION)
    .bind(&persons)
    .bind(json!({
        "allow_disclosure": true, "consent_given": true, "version": "2026-10-14",
        "language": "de", "chosen_at": "2026-11-01T10:00:00Z", "chosen_by": created_by,
        "access_kind": "staff", "company_name": "GMED", "consent_text": "Ich willige ein."
    }))
    .fetch_one(pool)
    .await
    .unwrap();
    // The staff entry needs how the client gave it.
    sqlx::query("SELECT 1").execute(pool).await.unwrap();
    Fixture {
        patient_id,
        lead_id,
        lead_choice_id,
    }
}

fn names(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|person| person["name"].as_str().unwrap().to_string())
        .collect()
}

async fn generate_consent(
    app: &axum::Router,
    ceo: &str,
    patient_id: Uuid,
    replace: Option<&str>,
) -> String {
    let mut body =
        json!({ "template_id": "privacy_consents", "patient_id": patient_id, "language": "de" });
    if let Some(replace) = replace {
        body["replace_document_id"] = json!(replace);
    }
    let (status, generated) =
        json_request(app, "POST", "/api/v1/documents/generate", ceo, Some(body)).await;
    assert_eq!(status, StatusCode::OK, "{generated}");
    generated["id"].as_str().unwrap().to_string()
}

async fn recorded_choice(pool: &PgPool, document_id: &str) -> Option<String> {
    sqlx::query_scalar(
        "SELECT generated_bindings -> '_own_consent_choice' ->> 'id' FROM documents WHERE id = $1::uuid",
    )
    .bind(document_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn staff_remove_at_once_and_add_after_the_signed_new_version() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let tag = Uuid::new_v4().simple().to_string();
    let ceo = bearer(ctx.admin_id, "ceo");
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    let pm = bearer(pm_id, "patient_manager");
    let fixture = seed_converted_patient(&pool, ctx.admin_id, &tag).await;
    let patient_id = fixture.patient_id;
    assign(&pool, patient_id, pm_id, ctx.admin_id).await;
    let path = format!("/api/v1/patients/{patient_id}/consent-choices");

    // The consent form made from the lead's choice, signed on paper.
    let unsigned = generate_consent(&app, &ceo, patient_id, None).await;
    assert_eq!(
        recorded_choice(&pool, &unsigned).await,
        Some(fixture.lead_choice_id.to_string())
    );
    let (status, signed_first) = support::paper_signature(&app, &ceo, &unsigned).await;
    assert!(status.is_success(), "{status} {signed_first}");
    let first: String =
        sqlx::query_scalar("SELECT id::text FROM documents WHERE replaces_document_id = $1::uuid")
            .bind(&unsigned)
            .fetch_one(&pool)
            .await
            .unwrap();
    let dsgvo_signed = || async {
        sqlx::query_scalar::<_, Option<bool>>(
            "SELECT (legal_status ->> 'dsgvo_signed')::boolean FROM patients WHERE id = $1",
        )
        .bind(patient_id)
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    let signed_before = dsgvo_signed().await;

    let (status, state) = json_request(&app, "GET", &path, &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(
        names(&state["effective"]["recipients"]),
        ["Eva Muster", "Otto Muster"]
    );
    assert_eq!(state["requested"]["id"], json!(fixture.lead_choice_id));
    assert_eq!(state["can_edit"], true);
    assert_eq!(state["documents"][0]["needs_new_version"], false);

    // Staff record a withdrawal for Otto, given by phone: it applies at once.
    let (status, refused) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({
            "choices": core(json!({ "channel_whatsapp": true })),
            "recipients": [person("Eva Muster", &["all"])],
            "version": TEXT_VERSION,
            "language": "de",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "consent_recorded_how_required");
    let (status, removed) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({
            "choices": core(json!({ "channel_whatsapp": true })),
            "recipients": [person("Eva Muster", &["all"])],
            "version": TEXT_VERSION,
            "language": "de",
            "recorded_how": "phone",
            "recorded_note": "Anruf der Patientin",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{removed}");
    assert_eq!(names(&removed["effective"]["recipients"]), ["Eva Muster"]);
    assert_eq!(removed["pending"]["recipients"], json!([false]));
    assert_eq!(removed["history"][0]["source"], "patient_staff");
    assert_eq!(removed["history"][0]["recorded_how"], "phone");
    assert_eq!(
        removed["history"][0]["recorded_note"],
        "Anruf der Patientin"
    );
    assert_eq!(removed["documents"][0]["id"], json!(first));
    assert_eq!(removed["documents"][0]["needs_new_version"], true);
    let removed_id = removed["saved_id"].as_str().unwrap().to_string();
    let (source, lead, owner): (String, Option<Uuid>, Option<Uuid>) = sqlx::query_as(
        "SELECT source, lead_id, patient_id FROM consent_form_choices WHERE id = $1::uuid",
    )
    .bind(&removed_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (source.as_str(), lead, owner),
        ("patient_staff", None, Some(patient_id))
    );

    // Audited without names.
    let context: Value = sqlx::query_scalar(
        r#"SELECT context FROM audit_log
           WHERE action = 'patient_consent_choices_changed' AND entity_id = $1
           ORDER BY created_at DESC LIMIT 1"#,
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(context["removed_recipients"], 1);
    assert_eq!(context["added_recipients"], 0);
    assert_eq!(context["recorded_how"], "phone");
    assert_eq!(context["withdrawal_only"], true);
    assert!(!context.to_string().contains("Otto"), "{context}");

    // Nothing changed: refused.
    let (status, same) = json_request(
        &app,
        "POST",
        &path,
        &pm,
        Some(json!({
            "choices": core(json!({ "channel_whatsapp": true })),
            "recipients": [person("Eva Muster", &["all"])],
            "version": TEXT_VERSION, "language": "de", "recorded_how": "phone",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{same}");
    assert_eq!(same["code"], "nothing_changed");

    // The new version of the form prints the new choice; the old one is superseded.
    let second = generate_consent(&app, &pm, patient_id, Some(&first)).await;
    assert_eq!(
        recorded_choice(&pool, &second).await,
        Some(removed_id.clone())
    );
    let replaced: Option<Uuid> =
        sqlx::query_scalar("SELECT replaces_document_id FROM documents WHERE id = $1::uuid")
            .bind(&second)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(replaced.map(|id| id.to_string()), Some(first.clone()));
    // The signed version keeps its signature; the legal status stays as it was.
    let first_signed: Option<chrono::DateTime<chrono::Utc>> =
        sqlx::query_scalar("SELECT signed_at FROM documents WHERE id = $1::uuid")
            .bind(&first)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(first_signed.is_some());
    assert_eq!(dsgvo_signed().await, signed_before);
    let (_, state) = json_request(&app, "GET", &path, &pm, None).await;
    assert_eq!(state["documents"][0]["id"], json!(second));
    assert_eq!(state["documents"][0]["needs_new_version"], false);

    // Adding Karl and the e-mail channel needs the explicit consent ...
    let add = |consent: bool| {
        json!({
            "choices": core(json!({ "channel_whatsapp": true, "channel_email": true })),
            "recipients": [person("Eva Muster", &["all"]), person("Karl Neu", &["medical"])],
            "consent_given": consent,
            "version": TEXT_VERSION, "language": "de", "recorded_how": "in_person",
        })
    };
    let (status, refused) = json_request(&app, "POST", &path, &ceo, Some(add(false))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "disclosure_consent_required");
    // ... and waits for the signature.
    let (status, added) = json_request(&app, "POST", &path, &ceo, Some(add(true))).await;
    assert_eq!(status, StatusCode::CREATED, "{added}");
    assert_eq!(names(&added["effective"]["recipients"]), ["Eva Muster"]);
    assert_eq!(added["effective"]["choices"]["channel_email"], false);
    assert_eq!(
        names(&added["requested"]["recipients"]),
        ["Eva Muster", "Karl Neu"]
    );
    assert_eq!(added["pending"]["recipients"], json!([false, true]));
    assert_eq!(added["pending"]["options"], json!(["channel_email"]));
    let added_id = added["saved_id"].as_str().unwrap().to_string();

    let third = generate_consent(&app, &ceo, patient_id, Some(&second)).await;
    assert_eq!(recorded_choice(&pool, &third).await, Some(added_id));
    let (status, signed) = support::paper_signature(&app, &ceo, &third).await;
    assert!(status.is_success(), "{status} {signed}");

    let (_, state) = json_request(&app, "GET", &path, &pm, None).await;
    assert_eq!(
        names(&state["effective"]["recipients"]),
        ["Eva Muster", "Karl Neu"]
    );
    assert_eq!(state["effective"]["choices"]["channel_email"], true);
    assert_eq!(state["pending"]["recipients"], json!([false, false]));
    assert_eq!(state["pending"]["options"], json!([]));
    assert_eq!(state["history"][0]["signed"], true);

    // The service consents are not withdrawn here.
    let (status, refused) = json_request(
        &app,
        "POST",
        &path,
        &ceo,
        Some(json!({
            "choices": { "agency_processing": true, "doctors_to_agency": false, "data_system": true },
            "recipients": [],
            "version": TEXT_VERSION, "language": "de", "recorded_how": "paper",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");
    assert_eq!(refused["code"], "consent_core_required");

    // The lead stays frozen: its list and its choices are untouched.
    let (lead_persons, lead_rows): (Value, i64) = sqlx::query_as(
        r#"SELECT l.portal_trusted_persons,
                  (SELECT count(*) FROM consent_form_choices c WHERE c.lead_id = l.id)
           FROM leads l WHERE l.id = $1"#,
    )
    .bind(fixture.lead_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(names(&lead_persons), ["Eva Muster", "Otto Muster"]);
    assert_eq!(lead_rows, 1);
    let (status, _) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{}/trusted-persons/1", fixture.lead_id),
        &ceo,
        Some(json!({ "base": person("Otto Muster", &["medical"]), "person": null, "reason": "Widerruf" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn only_ceo_and_the_patients_manager_change_consents() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let tag = Uuid::new_v4().simple().to_string();
    let fixture = seed_converted_patient(&pool, ctx.admin_id, &tag).await;
    let patient_id = fixture.patient_id;
    let path = format!("/api/v1/patients/{patient_id}/consent-choices");
    let change = json!({
        "choices": core(json!({})),
        "recipients": [person("Eva Muster", &["all"])],
        "version": TEXT_VERSION, "language": "de", "recorded_how": "phone",
    });
    for role in ["interpreter", "sales", "billing", "concierge", "it_admin"] {
        let user = seed_user(&pool, &tag, role).await;
        assign(&pool, patient_id, user, ctx.admin_id).await;
        let auth = bearer(user, role);
        let (status, _) = json_request(&app, "GET", &path, &auth, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} reads");
        let (status, _) = json_request(&app, "POST", &path, &auth, Some(change.clone())).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role} writes");
    }
    // A Patient Manager without the patient.
    let other_pm = seed_user(&pool, &format!("{tag}-other"), "patient_manager").await;
    let (status, _) = json_request(
        &app,
        "GET",
        &path,
        &bearer(other_pm, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // The CEO Assistant reads, never writes.
    let assistant = bearer(
        seed_user(&pool, &tag, "ceo_assistant").await,
        "ceo_assistant",
    );
    let (status, state) = json_request(&app, "GET", &path, &assistant, None).await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(state["can_edit"], false);
    let (status, _) = json_request(&app, "POST", &path, &assistant, Some(change.clone())).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM consent_form_choices WHERE patient_id = $1 AND source LIKE 'patient_%'",
    )
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn the_patient_withdraws_a_person_in_the_portal() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let tag = Uuid::new_v4().simple().to_string();
    let fixture = seed_converted_patient(&pool, ctx.admin_id, &tag).await;
    let patient_id = fixture.patient_id;
    let pm_id = seed_user(&pool, &tag, "patient_manager").await;
    assign(&pool, patient_id, pm_id, ctx.admin_id).await;
    let patient_user = seed_user(&pool, &tag, "patient").await;
    assign(&pool, patient_id, patient_user, ctx.admin_id).await;
    let me = bearer(patient_user, "patient");

    let (status, state) =
        json_request(&app, "GET", "/api/v1/me/consent-choices?lang=ru", &me, None).await;
    assert_eq!(status, StatusCode::OK, "{state}");
    assert_eq!(state["can_edit"], true);
    assert_eq!(state["documents"], json!([]));
    assert!(
        state["disclosure_text"]
            .as_str()
            .unwrap()
            .starts_with("Я даю")
    );
    assert_eq!(
        names(&state["effective"]["recipients"]),
        ["Eva Muster", "Otto Muster"]
    );

    // No channel choice in the portal.
    let (status, refused) = json_request(
        &app,
        "POST",
        "/api/v1/me/consent-choices",
        &me,
        Some(json!({
            "choices": core(json!({ "channel_whatsapp": true })),
            "recipients": [person("Otto Muster", &["medical"])],
            "version": TEXT_VERSION, "language": "ru", "recorded_how": "phone",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{refused}");

    let (status, saved) = json_request(
        &app,
        "POST",
        "/api/v1/me/consent-choices",
        &me,
        Some(json!({
            "choices": core(json!({ "channel_whatsapp": true })),
            "recipients": [person("Otto Muster", &["medical"])],
            "version": TEXT_VERSION, "language": "ru",
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{saved}");
    assert_eq!(names(&saved["effective"]["recipients"]), ["Otto Muster"]);
    assert_eq!(saved["history"][0]["source"], "patient_portal");
    assert_eq!(saved["history"][0]["access_kind"], "self");

    // The patient's manager is told to make the new version.
    let notified: i64 = sqlx::query_scalar(
        r#"SELECT count(*) FROM user_notifications
           WHERE user_id = $1 AND kind = 'patient_consent_choice_changed' AND entity_id = $2"#,
    )
    .bind(pm_id)
    .bind(patient_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(notified, 1);
    // Staff see the patient's change.
    let (_, staff_view) = json_request(
        &app,
        "GET",
        &format!("/api/v1/patients/{patient_id}/consent-choices"),
        &bearer(pm_id, "patient_manager"),
        None,
    )
    .await;
    assert_eq!(staff_view["history"][0]["source"], "patient_portal");
    assert_eq!(
        names(&staff_view["effective"]["recipients"]),
        ["Otto Muster"]
    );
}

/// A signed framework contract, an active order and its open quote.
async fn seed_order_with_quote(
    pool: &PgPool,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Uuid {
    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                patient_id, contract_number, signed_at, valid_from, valid_to,
                conditions, status, created_by
           ) VALUES ($1, $2, '2026-04-01T09:15:00Z', '2026-04-01', '2027-12-31',
                     '{}'::jsonb, 'signed', $3)
           RETURNING id"#,
    )
    .bind(patient_id)
    .bind(format!("FC-{tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, contract_id, phase, status, needs_description, created_by
           ) VALUES ($1, $2, $3, 'execution', 'active', 'Lock test', $4)
           RETURNING id"#,
    )
    .bind(format!("AUF-{tag}"))
    .bind(patient_id)
    .bind(contract_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, valid_until, line_items, notes, created_by
           ) VALUES ($1, $2, 750, 142.50, 892.50, 'sent', $3, $4::jsonb, NULL, $5)"#,
    )
    .bind(order_id)
    .bind(format!("KV-{tag}"))
    .bind(gmed_server::app_time::today() + chrono::Days::new(120))
    .bind(json!([{
        "description": "Koordination vor stationärer Aufnahme",
        "quantity": "1", "unit_price": "750", "vat_rate": "19", "line_gross": "892.50"
    }]))
    .bind(created_by)
    .execute(pool)
    .await
    .unwrap();
    order_id
}

#[tokio::test]
async fn an_open_order_locks_manual_new_versions_of_its_documents_but_not_the_consent_form() {
    let Some(ctx) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pool = ctx.pool.clone();
    let app = ctx.app.clone();
    let tag = Uuid::new_v4().simple().to_string();
    let ceo = bearer(ctx.admin_id, "ceo");
    let fixture = seed_converted_patient(&pool, ctx.admin_id, &tag).await;
    let patient_id = fixture.patient_id;
    let order_id = seed_order_with_quote(&pool, patient_id, ctx.admin_id, &tag).await;

    let estimate = |replace: Option<&str>| {
        let mut body = json!({
            "template_id": "order_cost_estimate", "patient_id": patient_id,
            "order_id": order_id, "language": "de",
            "bindings": { "party_sign_place": "Paris" }
        });
        if let Some(replace) = replace {
            body["replace_document_id"] = json!(replace);
        }
        let (app, ceo) = (app.clone(), ceo.clone());
        async move { json_request(&app, "POST", "/api/v1/documents/generate", &ceo, Some(body)).await }
    };
    let (status, first) = estimate(None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let first_id = first["id"].as_str().unwrap().to_string();
    let (_, detail) = json_request(
        &app,
        "GET",
        &format!("/api/v1/documents/{first_id}"),
        &ceo,
        None,
    )
    .await;
    assert_eq!(detail["manual_version_locked"], true, "{detail}");

    // A manual new version of the Kostenvoranschlag: refused while the order is open.
    let (status, refused) = estimate(Some(&first_id)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"], "document_locked_by_active_order");

    // The framework contract of the patient is locked too; a lead's document is not.
    let contract_doc: Uuid = sqlx::query_scalar(
        r#"INSERT INTO documents (id, version_root_document_id, patient_id, auto_name, art, category,
                                  status, visibility, is_medical, uploaded_by, generated_template_id)
           SELECT g, g, $1, 'Rahmenvertrag', 'framework_contract', 'contract', 'active', 'internal',
                  false, $2, 'framework_contract'
           FROM gen_random_uuid() g RETURNING id"#,
    )
    .bind(patient_id)
    .bind(ctx.admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let lead_doc: Uuid = sqlx::query_scalar(
        r#"INSERT INTO documents (id, version_root_document_id, lead_id, auto_name, art, category,
                                  status, visibility, is_medical, uploaded_by, generated_template_id)
           SELECT g, g, $1, 'Einzelauftrag', 'single_order', 'contract', 'active', 'internal',
                  false, $2, 'single_order'
           FROM gen_random_uuid() g RETURNING id"#,
    )
    .bind(fixture.lead_id)
    .bind(ctx.admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let locked_now = |id: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar::<_, bool>("SELECT document_manual_version_locked($1)")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    assert!(locked_now(contract_doc).await);
    assert!(!locked_now(lead_doc).await);
    let (status, refused) = json_request(
        &app,
        "POST",
        "/api/v1/documents/generate",
        &ceo,
        Some(
            json!({ "template_id": "framework_contract", "patient_id": patient_id,
                     "language": "de", "replace_document_id": contract_doc }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    assert_eq!(refused["error"], "document_locked_by_active_order");

    // The consent form stays open.
    let consent = generate_consent(&app, &ceo, patient_id, None).await;
    sqlx::query("UPDATE patients SET first_name = 'Erika Maria', updated_at = now() WHERE id = $1")
        .bind(patient_id)
        .execute(&pool)
        .await
        .unwrap();
    generate_consent(&app, &ceo, patient_id, Some(&consent)).await;

    // An order change makes it outdated: the new version the order asks for is made.
    sqlx::query(
        "UPDATE orders SET client_terms_changed_at = now() + interval '1 second' WHERE id = $1",
    )
    .bind(order_id)
    .execute(&pool)
    .await
    .unwrap();
    let (status, renewed) = estimate(Some(&first_id)).await;
    assert_ne!(
        renewed["error"], "document_locked_by_active_order",
        "{status} {renewed}"
    );

    // A closed order: the earlier behaviour.
    sqlx::query("UPDATE orders SET status = 'completed' WHERE id = $1")
        .bind(order_id)
        .execute(&pool)
        .await
        .unwrap();
    let current: String = sqlx::query_scalar(
        r#"SELECT d.id::text FROM documents d
           WHERE d.order_id = $1 AND d.generated_template_id = 'order_cost_estimate'
             AND NOT EXISTS (SELECT 1 FROM documents n WHERE n.replaces_document_id = d.id)
           ORDER BY d.created_at DESC LIMIT 1"#,
    )
    .bind(order_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    let locked: bool = sqlx::query_scalar("SELECT document_manual_version_locked($1::uuid)")
        .bind(&current)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(!locked);
    assert!(!locked_now(contract_doc).await);
    let (_, after) = estimate(Some(&current)).await;
    assert_ne!(after["error"], "document_locked_by_active_order", "{after}");
}
