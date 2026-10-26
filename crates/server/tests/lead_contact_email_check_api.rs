//! `POST /leads/{id}/contact-email-check` (DEV QA V-A6, owner 2026-10-26):
//! the wizard warns when a contact's e-mail is the login of another person.
//! Synthetic data only, in disposable databases.
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";

fn bearer(id: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        gmed_server::auth::jwt::issue_access_token(SECRET, id, role, Uuid::new_v4()).unwrap()
    )
}

async fn check(app: &Router, lead: Uuid, token: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method("POST")
        .uri(format!("/api/v1/leads/{lead}/contact-email-check"))
        .header("Authorization", token)
        .header("Content-Type", "application/json")
        .body(Body::from(serde_json::to_vec(&body).unwrap()))
        .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) })),
    )
}

fn unique(prefix: &str) -> String {
    format!("{prefix}-{}@example.test", Uuid::new_v4().simple())
}

async fn user(pool: &PgPool, name: &str, role: &str, email: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users (email, name, password_hash, role, is_active)
         VALUES ($1, $2, 'test-password-hash', $3, true) RETURNING id",
    )
    .bind(email)
    .bind(name)
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A patient record with its own login.
async fn patient_with_login(pool: &PgPool, actor: Uuid, number: &str, login: Uuid) -> Uuid {
    let patient: Uuid = sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, created_by)
         VALUES ($1, 'Olga', 'Beispiel', '1980-02-03', 'female', $2) RETURNING id",
    )
    .bind(number)
    .bind(actor)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by) VALUES ($1, $2, $3)",
    )
    .bind(patient)
    .bind(login)
    .bind(actor)
    .execute(pool)
    .await
    .unwrap();
    patient
}

/// A minor's request with one parent contact and the lead's own login.
async fn lead_with_contact(
    pool: &PgPool,
    actor: Uuid,
    contact: &Value,
    login: Option<Uuid>,
) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, email, created_by,
                            portal_user_id, trusted_contacts)
         VALUES ('Mia', 'Muster', '2016-05-06', $1, $2, $3, jsonb_build_array($4::jsonb))
         RETURNING id",
    )
    .bind(unique("mia"))
    .bind(actor)
    .bind(login)
    .bind(contact)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn another_patients_login_names_the_patient_only_to_a_caller_with_access() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let ceo = user(pool, "Chef", "ceo", &unique("ceo")).await;
    let manager = user(pool, "Manager", "patient_manager", &unique("pm")).await;
    let login_email = unique("olga");
    let login = user(pool, "Olga Beispiel", "patient", &login_email).await;
    let number = format!("P-{}", &Uuid::new_v4().simple().to_string()[..8]);
    let patient = patient_with_login(pool, ceo, &number, login).await;
    let contact_id = Uuid::new_v4();
    let lead = lead_with_contact(
        pool,
        ceo,
        &json!({ "id": contact_id, "name": "Anna Muster", "relation": "mother" }),
        None,
    )
    .await;

    // Typed with other case and surrounding spaces: the login compares the
    // normalised address.
    let typed = format!("  {}  ", login_email.to_uppercase());
    let (status, body) = check(
        &suite.app,
        lead,
        &bearer(ceo, "ceo"),
        json!({ "email": typed, "contact_id": contact_id }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let owner = &body["login_owner"];
    assert_eq!(owner["kind"], "patient");
    assert_eq!(owner["patient_id"], json!(patient));
    assert_eq!(owner["patient_number"], json!(number));
    assert_eq!(owner["display_name"], "Olga Beispiel");

    // A patient manager not assigned to the patient learns only the kind.
    let (status, body) = check(
        &suite.app,
        lead,
        &bearer(manager, "patient_manager"),
        json!({ "email": login_email, "contact_id": contact_id }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["login_owner"],
        json!({ "kind": "patient", "patient_id": null, "patient_number": null,
                "lead_id": null, "display_name": null })
    );

    // The contact linked to that patient record is that person: no warning.
    let (_, body) = check(
        &suite.app,
        lead,
        &bearer(ceo, "ceo"),
        json!({ "email": login_email, "contact_id": contact_id, "related_patient_id": patient }),
    )
    .await;
    assert_eq!(body["login_owner"], Value::Null, "{body}");
}

#[tokio::test]
async fn the_contacts_own_guardian_login_and_the_leads_own_login_are_not_reported() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let ceo = user(pool, "Chef", "ceo", &unique("ceo")).await;
    let parent_email = unique("anna");
    let parent_login = user(pool, "Anna Muster", "patient", &parent_email).await;
    let own_email = unique("mia-login");
    let own_login = user(pool, "Mia Muster", "patient", &own_email).await;
    let contact_id = Uuid::new_v4();
    let lead = lead_with_contact(
        pool,
        ceo,
        &json!({ "id": contact_id, "name": "Anna Muster", "relation": "mother",
                 "email": parent_email }),
        Some(own_login),
    )
    .await;
    sqlx::query(
        "INSERT INTO lead_portal_access (lead_id, user_id, kind, trusted_contact_id, created_by)
         VALUES ($1, $2, 'guardian', $3, $4)",
    )
    .bind(lead)
    .bind(parent_login)
    .bind(contact_id)
    .bind(ceo)
    .execute(pool)
    .await
    .unwrap();
    let token = bearer(ceo, "ceo");

    let (status, body) = check(
        &suite.app,
        lead,
        &token,
        json!({ "email": parent_email, "contact_id": contact_id }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["login_owner"], Value::Null, "{body}");

    // The same address typed for another contact is somebody else's login:
    // a parent's login for a request, reported as a lead login by its name.
    let (_, body) = check(
        &suite.app,
        lead,
        &token,
        json!({ "email": parent_email, "contact_id": Uuid::new_v4() }),
    )
    .await;
    assert_eq!(body["login_owner"]["kind"], "lead", "{body}");
    assert_eq!(body["login_owner"]["display_name"], "Anna Muster");
    assert_eq!(body["login_owner"]["patient_number"], Value::Null);

    // The lead's own address against the lead's own login: no warning.
    let (_, body) = check(&suite.app, lead, &token, json!({ "email": own_email })).await;
    assert_eq!(body["login_owner"], Value::Null, "{body}");
    // ... but typed for a contact it is the lead's login.
    let (_, body) = check(
        &suite.app,
        lead,
        &token,
        json!({ "email": own_email, "contact_id": contact_id }),
    )
    .await;
    assert_eq!(body["login_owner"]["kind"], "lead", "{body}");
    assert_eq!(body["login_owner"]["lead_id"], json!(lead));
}

#[tokio::test]
async fn staff_logins_are_reported_without_a_name_and_unknown_addresses_not_at_all() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let ceo = user(pool, "Chef", "ceo", &unique("ceo")).await;
    let sales = user(pool, "Verkauf", "sales", &unique("sales")).await;
    let staff_email = unique("billing");
    user(pool, "Berta Buchhaltung", "billing", &staff_email).await;
    let lead = lead_with_contact(
        pool,
        ceo,
        &json!({ "id": Uuid::new_v4(), "name": "Anna Muster", "relation": "mother" }),
        None,
    )
    .await;
    let token = bearer(sales, "sales");

    let (status, body) = check(&suite.app, lead, &token, json!({ "email": staff_email })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["login_owner"],
        json!({ "kind": "staff", "patient_id": null, "patient_number": null,
                "lead_id": null, "display_name": null })
    );
    assert!(!body.to_string().contains("Berta"));

    let (status, body) = check(
        &suite.app,
        lead,
        &token,
        json!({ "email": unique("nobody") }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["login_owner"], Value::Null);

    let (status, body) = check(
        &suite.app,
        lead,
        &token,
        json!({ "email": "not-an-address" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["login_owner"], Value::Null);

    let (status, _) = check(
        &suite.app,
        Uuid::new_v4(),
        &token,
        json!({ "email": staff_email }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn roles_that_cannot_edit_leads_are_refused() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let ceo = user(pool, "Chef", "ceo", &unique("ceo")).await;
    let lead = lead_with_contact(
        pool,
        ceo,
        &json!({ "id": Uuid::new_v4(), "name": "Anna Muster", "relation": "mother" }),
        None,
    )
    .await;
    for role in ["billing", "interpreter", "concierge"] {
        let caller = user(pool, "Staff", role, &unique(role)).await;
        let (status, body) = check(
            &suite.app,
            lead,
            &bearer(caller, role),
            json!({ "email": unique("x") }),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{role}: {body}");
    }
}
