//! A guardian login can acquire its owner's adult record without rotating the
//! login or losing child access. All fixtures are synthetic, in disposable DBs.
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::{PgPool, Row};
use tower::ServiceExt;
use uuid::Uuid;

const SECRET: &str = "test-secret-at-least-32-characters-long!!";
fn bearer(id: Uuid, role: &str) -> String {
    format!(
        "Bearer {}",
        gmed_server::auth::jwt::issue_access_token(SECRET, id, role, Uuid::new_v4()).unwrap()
    )
}
async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    request_for_patient(app, method, path, token, body, None).await
}
async fn request_for_patient(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
    selected: Option<Uuid>,
) -> (StatusCode, Value) {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("Authorization", token)
        .header("Content-Type", "application/json");
    if let Some(patient) = selected {
        builder = builder.header("x-patient-id", patient.to_string());
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(if method == "GET" {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({"raw":String::from_utf8_lossy(&bytes)})),
    )
}
struct Family {
    mother: Uuid,
    child: Uuid,
    contact: Uuid,
    email: String,
    session: Uuid,
}
async fn family(pool: &PgPool, actor: Uuid) -> Family {
    let email = format!("mother-{}@example.test", Uuid::new_v4());
    let mother=sqlx::query_scalar("INSERT INTO users(email,name,password_hash,role) VALUES($1,'Anna Mother','unchanged-parent-password','patient') RETURNING id")
        .bind(&email).fetch_one(pool).await.unwrap();
    let contact = Uuid::new_v4();
    let child=sqlx::query_scalar("INSERT INTO leads(first_name,last_name,date_of_birth,trusted_contacts,created_by) VALUES('Mia','Mother','2015-01-02',$1,$2) RETURNING id")
        .bind(json!([{"id":contact,"name":"Anna Mother","relation":"parent","email":email,"phone":"+491234567891","birth_date":"1985-02-03"}]))
        .bind(actor).fetch_one(pool).await.unwrap();
    sqlx::query("INSERT INTO lead_portal_access(lead_id,user_id,kind,trusted_contact_id,created_by) VALUES($1,$2,'guardian',$3,$4)")
        .bind(child).bind(mother).bind(contact).bind(actor).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO lead_representatives(lead_id,contact_id,role,first_name,last_name,street,zip,city,country) VALUES($1,$2,'legal_representative','Anna','Mother','Parent Street 2','10115','Berlin','DE')")
        .bind(child).bind(contact).execute(pool).await.unwrap();
    let session = sqlx::query_scalar("INSERT INTO token_families(user_id) VALUES($1) RETURNING id")
        .bind(mother)
        .fetch_one(pool)
        .await
        .unwrap();
    Family {
        mother,
        child,
        contact,
        email,
        session,
    }
}
async fn patient(pool: &PgPool, actor: Uuid, first: &str, birth: &str, email: &str) -> Uuid {
    sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,email,created_by) VALUES($1,$2,'Mother',$3::date,'female',$4,$5) RETURNING id")
        .bind(format!("P-{}",Uuid::new_v4())).bind(first).bind(birth).bind(email).bind(actor).fetch_one(pool).await.unwrap()
}
async fn converted_child(pool: &PgPool, actor: Uuid, family: &Family, source: &str) -> Uuid {
    let child = patient(pool, actor, "Mia", "2015-01-02", "child@example.test").await;
    sqlx::query(
        "UPDATE leads SET converted_patient_id=$2,qualification_status='converted' WHERE id=$1",
    )
    .bind(family.child)
    .bind(child)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by,source) VALUES($1,$2,$3,$4)")
        .bind(child).bind(family.mother).bind(actor).bind(source).execute(pool).await.unwrap();
    sqlx::query("INSERT INTO patient_relations(patient_id,related_name,relation_type) VALUES($1,'Anna Mother','parent')").bind(child).execute(pool).await.unwrap();
    child
}
async fn assert_login_preserved(pool: &PgPool, family: &Family) {
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id=$1")
        .bind(family.mother)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(hash, "unchanged-parent-password");
    let revoked: bool = sqlx::query_scalar("SELECT is_revoked FROM token_families WHERE id=$1")
        .bind(family.session)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!revoked);
    let access: i64=sqlx::query_scalar("SELECT count(*) FROM lead_portal_access WHERE user_id=$1 AND lead_id=$2 AND revoked_at IS NULL")
        .bind(family.mother).bind(family.child).fetch_one(pool).await.unwrap();
    assert_eq!(access, 1);
}

#[tokio::test]
async fn mother_gets_own_lead_before_or_after_child_conversion_without_new_credentials() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    for converted in [false, true] {
        let family = family(&suite.pool, suite.admin_id).await;
        if converted {
            converted_child(&suite.pool, suite.admin_id, &family, "lead_guardian").await;
        }
        // Each scenario is a distinct person; do not reuse another family's phone.
        let explicit_phone = if converted {
            "+33987654322"
        } else {
            "+33987654321"
        };
        let (status,result)=request(&suite.app,"POST","/api/v1/leads",&bearer(suite.admin_id,"ceo"),
            json!({"first_name":"Anna","last_name":"Mother","email":family.email,"country":"FR","phone":explicit_phone})).await;
        assert_eq!(status, StatusCode::CREATED, "{result}");
        assert_eq!(
            result["portal_account"]["user_id"],
            family.mother.to_string()
        );
        assert_eq!(result["portal_account"]["reused"], true);
        assert_eq!(result["portal_account"]["created"], false);
        assert!(result["portal_account"]["one_time_password"].is_null());
        let own_id = Uuid::parse_str(result["id"].as_str().unwrap()).unwrap();
        let own = sqlx::query(
            "SELECT date_of_birth::text,street_address,city,country,phone FROM leads WHERE id=$1",
        )
        .bind(own_id)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
        assert_eq!(own.get::<String, _>("date_of_birth"), "1985-02-03");
        assert_eq!(own.get::<String, _>("street_address"), "Parent Street 2");
        assert_eq!(own.get::<String, _>("city"), "Berlin");
        assert_eq!(own.get::<String, _>("country"), "FR");
        assert_eq!(own.get::<String, _>("phone"), explicit_phone);
        assert_login_preserved(&suite.pool, &family).await;
        let (status, list) = request(
            &suite.app,
            "GET",
            "/api/v1/me/lead-requests",
            &bearer(family.mother, "patient"),
            Value::Null,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{list}");
        assert!(list.to_string().contains(&own_id.to_string()), "{list}");
        if !converted {
            assert!(
                list.to_string().contains(&family.child.to_string()),
                "{list}"
            );
        }
        let (status, duplicate) = request(
            &suite.app,
            "POST",
            "/api/v1/leads",
            &bearer(suite.admin_id, "ceo"),
            json!({"first_name":"Anna","last_name":"Mother","email":family.email}),
        )
        .await;
        assert!(
            matches!(
                status,
                StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
            ),
            "{duplicate}"
        );
        assert_login_preserved(&suite.pool, &family).await;
    }
}

#[tokio::test]
async fn unrelated_inactive_staff_and_existing_own_patient_accounts_cannot_be_reused() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    for reason in ["name", "birth_date", "inactive", "staff", "own_patient"] {
        let family = family(&suite.pool, suite.admin_id).await;
        if reason == "inactive" {
            sqlx::query("UPDATE users SET is_active=false WHERE id=$1")
                .bind(family.mother)
                .execute(&suite.pool)
                .await
                .unwrap();
        }
        if reason == "staff" {
            sqlx::query("UPDATE users SET role='billing' WHERE id=$1")
                .bind(family.mother)
                .execute(&suite.pool)
                .await
                .unwrap();
        }
        if reason == "own_patient" {
            let own = patient(
                &suite.pool,
                suite.admin_id,
                "Anna",
                "1985-02-03",
                &family.email,
            )
            .await;
            sqlx::query(
                "INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)",
            )
            .bind(own)
            .bind(family.mother)
            .bind(suite.admin_id)
            .execute(&suite.pool)
            .await
            .unwrap();
        }
        let (status,result)=request(&suite.app,"POST","/api/v1/leads",&bearer(suite.admin_id,"ceo"),json!({"first_name":if reason=="name" {"Other"} else {"Anna"},"last_name":"Mother","email":family.email,"date_of_birth":if reason=="birth_date" {"1986-02-03"} else {"1985-02-03"}})).await;
        assert!(
            matches!(
                status,
                StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
            ),
            "{reason}: {status} {result}"
        );
        assert_login_preserved(&suite.pool, &family).await;
    }
}

#[tokio::test]
async fn direct_patient_access_reuses_guardian_login_and_links_the_exact_parent_contact() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    let child = converted_child(&suite.pool, suite.admin_id, &family, "lead_guardian").await;
    // Older conversions collapsed an explicit mother to generic parent.
    sqlx::query("UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(c || jsonb_build_object('relation','mother')) FROM jsonb_array_elements(trusted_contacts)c) WHERE id=$1")
        .bind(family.child).execute(&suite.pool).await.unwrap();
    let own = patient(
        &suite.pool,
        suite.admin_id,
        "Anna",
        "1985-02-03",
        &family.email,
    )
    .await;
    let (status, result) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{own}/portal-account"),
        &bearer(suite.admin_id, "ceo"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["reused"], true);
    assert!(result["one_time_password"].is_null());
    assert_login_preserved(&suite.pool, &family).await;
    let links: Vec<(Uuid,String)>=sqlx::query_as("SELECT patient_id,source FROM patient_assignments WHERE user_id=$1 AND revoked_at IS NULL ORDER BY source").bind(family.mother).fetch_all(&suite.pool).await.unwrap();
    assert!(links.contains(&(child, "lead_guardian".into())));
    assert!(links.contains(&(own, "manual".into())));
    let parent: Uuid=sqlx::query_scalar("SELECT related_patient_id FROM patient_relations WHERE patient_id=$1 AND relation_type='mother'").bind(child).fetch_one(&suite.pool).await.unwrap();
    assert_eq!(parent, own);
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM patient_relations WHERE patient_id=$1")
            .bind(child)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(
        count, 1,
        "Clarifying the mother's role must not duplicate her relationship"
    );
    let relation: Uuid = sqlx::query_scalar("SELECT id FROM patient_relations WHERE patient_id=$1")
        .bind(child)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    let (status, saved) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{child}/relations/{relation}/update"),
        &bearer(suite.admin_id, "ceo"),
        json!({"related_name":"Anna Mother","relation_type":"mother","is_emergency_contact":true,
               "email":family.email,"phone":null}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["related_patient_id"],
        json!(own),
        "An omitted link must survive a contact-only edit"
    );
    assert_eq!(saved["relation_type"], "mother");
    assert_eq!(saved["email"], family.email);
    let linked: String=sqlx::query_scalar("SELECT c->>'related_patient_id' FROM leads l CROSS JOIN LATERAL jsonb_array_elements(l.trusted_contacts)c WHERE l.id=$1 AND c->>'id'=$2").bind(family.child).bind(family.contact.to_string()).fetch_one(&suite.pool).await.unwrap();
    assert_eq!(linked, own.to_string());
}

#[tokio::test]
async fn legacy_guardian_assignment_is_repaired_without_reclassifying_an_own_record() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    let child = converted_child(&suite.pool, suite.admin_id, &family, "manual").await;
    let own = patient(
        &suite.pool,
        suite.admin_id,
        "Anna",
        "1985-02-03",
        &family.email,
    )
    .await;
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(own)
        .bind(family.mother)
        .bind(suite.admin_id)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20261014183000_parent_portal_assignment_provenance.sql"
    ))
    .execute(&suite.pool)
    .await
    .unwrap();
    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT patient_id,source FROM patient_assignments WHERE user_id=$1")
            .bind(family.mother)
            .fetch_all(&suite.pool)
            .await
            .unwrap();
    assert!(rows.contains(&(child, "lead_guardian".into())));
    assert!(rows.contains(&(own, "manual".into())));
    let related: Uuid =
        sqlx::query_scalar("SELECT related_patient_id FROM patient_relations WHERE patient_id=$1")
            .bind(child)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(related, own);
    assert_login_preserved(&suite.pool, &family).await;
}

#[tokio::test]
async fn package_activation_reuses_parent_without_requiring_or_changing_a_password() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    converted_child(&suite.pool, suite.admin_id, &family, "lead_guardian").await;
    let own = patient(
        &suite.pool,
        suite.admin_id,
        "Anna",
        "1985-02-03",
        &family.email,
    )
    .await;
    let package: Uuid=sqlx::query_scalar("INSERT INTO service_packages(package_key,name,created_by) VALUES($1,'Parent account test',$2) RETURNING id")
        .bind(Uuid::new_v4().to_string()).bind(suite.admin_id).fetch_one(&suite.pool).await.unwrap();
    sqlx::query("INSERT INTO patient_service_packages(patient_id,package_id,status,assigned_by) VALUES($1,$2,'active',$3)")
        .bind(own).bind(package).bind(suite.admin_id).execute(&suite.pool).await.unwrap();
    let (status, result) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{own}/portal-account/activate"),
        &bearer(suite.admin_id, "ceo"),
        json!({"email":family.email}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["user_id"], family.mother.to_string());
    assert_eq!(result["reused"], true);
    assert_eq!(result["password_changed"], false);
    assert_login_preserved(&suite.pool, &family).await;
}

#[tokio::test]
async fn own_patient_is_the_default_but_child_access_requires_explicit_authorized_context() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    let child = converted_child(&suite.pool, suite.admin_id, &family, "lead_guardian").await;
    let own = patient(
        &suite.pool,
        suite.admin_id,
        "Anna",
        "1985-02-03",
        &family.email,
    )
    .await;
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(own)
        .bind(family.mother)
        .bind(suite.admin_id)
        .execute(&suite.pool)
        .await
        .unwrap();
    let token = bearer(family.mother, "patient");
    let (status, me) = request(&suite.app, "GET", "/api/v1/me", &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    let records = me["patients"].as_array().unwrap();
    assert!(
        records
            .iter()
            .any(|p| p["id"] == own.to_string() && p["access_kind"] == "self")
    );
    assert!(
        records
            .iter()
            .any(|p| p["id"] == child.to_string() && p["access_kind"] == "guardian")
    );
    for (selected, expected) in [(None, own), (Some(child), child), (Some(own), own)] {
        let (status, export) = request_for_patient(
            &suite.app,
            "GET",
            "/api/v1/me/export",
            &token,
            Value::Null,
            selected,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{export}");
        assert_eq!(export["patient"]["id"], expected.to_string(), "{export}");
    }
    let stranger = patient(
        &suite.pool,
        suite.admin_id,
        "Unrelated",
        "1980-01-01",
        "unrelated@example.test",
    )
    .await;
    let (status, body) = request_for_patient(
        &suite.app,
        "GET",
        "/api/v1/me/export",
        &token,
        Value::Null,
        Some(stranger),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by) VALUES($1,$2,$3)")
        .bind(stranger)
        .bind(family.mother)
        .bind(suite.admin_id)
        .execute(&suite.pool)
        .await
        .unwrap();
    let (status, body) = request(&suite.app, "GET", "/api/v1/me/export", &token, Value::Null).await;
    assert_eq!(
        status,
        StatusCode::CONFLICT,
        "ambiguous own patients must not be guessed: {body}"
    );
}

#[tokio::test]
async fn prospective_assignments_keep_the_parent_in_the_request_cabinet_until_conversion() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    let token = bearer(family.mother, "patient");
    let (status, me) = request(&suite.app, "GET", "/api/v1/me", &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["portal_mode"], "lead");
    assert_eq!(me["lead_portal"]["requests"], 1);
    assert_eq!(me["patients"], json!([]));

    let (status, own_lead) = request(
        &suite.app,
        "POST",
        "/api/v1/leads",
        &bearer(suite.admin_id, "ceo"),
        json!({"first_name":"Anna","last_name":"Mother","email":family.email}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{own_lead}");
    let own = patient(
        &suite.pool,
        suite.admin_id,
        "Anna",
        "1985-02-03",
        &family.email,
    )
    .await;
    let child = patient(
        &suite.pool,
        suite.admin_id,
        "Mia",
        "2015-01-02",
        "child-prospect@example.test",
    )
    .await;
    for (id, source) in [(own, "manual"), (child, "lead_guardian")] {
        // Some historical placeholders already have an assignment. Neither
        // an own placeholder nor a child's one is an accepted patient context.
        sqlx::query(
            "UPDATE patients SET lifecycle_status='prospective',is_active=true WHERE id=$1",
        )
        .bind(id)
        .execute(&suite.pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO patient_assignments(patient_id,user_id,assigned_by,source) VALUES($1,$2,$3,$4)")
            .bind(id).bind(family.mother).bind(suite.admin_id).bind(source).execute(&suite.pool).await.unwrap();
    }
    let (_, me) = request(&suite.app, "GET", "/api/v1/me", &token, Value::Null).await;
    assert_eq!(me["portal_mode"], "lead", "{me}");
    assert_eq!(me["lead_portal"]["requests"], 2);
    assert_eq!(me["patients"], json!([]));
    for path in [
        "/api/v1/me/documents",
        "/api/v1/me/invoices",
        "/api/v1/me/appointments",
    ] {
        let (status, body) = request(&suite.app, "GET", path, &token, Value::Null).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        assert_eq!(body["code"], "lead_portal_only", "{path}: {body}");
    }

    // The converted child's real patient record unlocks the patient portal.
    // The mother's still-prospective own record must not become the default.
    sqlx::query("UPDATE patients SET lifecycle_status='active',is_active=true WHERE id=$1")
        .bind(child)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE leads SET qualification_status='converted',converted_patient_id=$2 WHERE id=$1",
    )
    .bind(family.child)
    .bind(child)
    .execute(&suite.pool)
    .await
    .unwrap();
    let (_, me) = request(&suite.app, "GET", "/api/v1/me", &token, Value::Null).await;
    assert_eq!(me["portal_mode"], "patient", "{me}");
    assert_eq!(me["lead_portal"]["requests"], 1);
    assert_eq!(me["patients"].as_array().unwrap().len(), 1);
    assert_eq!(me["patients"][0]["id"], child.to_string());
    assert_eq!(me["patients"][0]["access_kind"], "guardian");
    let (status, export) =
        request(&suite.app, "GET", "/api/v1/me/export", &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{export}");
    assert_eq!(export["patient"]["id"], child.to_string(), "{export}");
    let (status, body) = request_for_patient(
        &suite.app,
        "GET",
        "/api/v1/me/export",
        &token,
        Value::Null,
        Some(own),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // An archived/deactivated record also does not make full navigation appear.
    sqlx::query("UPDATE patients SET is_active=false WHERE id=$1")
        .bind(child)
        .execute(&suite.pool)
        .await
        .unwrap();
    let (_, me) = request(&suite.app, "GET", "/api/v1/me", &token, Value::Null).await;
    assert_eq!(me["portal_mode"], "lead", "{me}");
    assert_eq!(me["patients"], json!([]));
    assert_login_preserved(&suite.pool, &family).await;
}

#[tokio::test]
async fn proven_existing_parent_uses_activation_and_repeat_intake_without_a_duplicate_patient() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    let profile = patient(
        &suite.pool,
        suite.admin_id,
        "Anna",
        "1985-02-03",
        &family.email,
    )
    .await;
    sqlx::query(r#"UPDATE patients SET phone_primary='+491234567892',address_street='Canonical street 4',address_zip='10101',address_city='Canonical city',address_country='NL',citizenships=ARRAY['NL'],notes='PRIVATE-MEDICAL-MARKER',legal_status='{"private_consent":"PRIVATE-CONSENT-MARKER"}' WHERE id=$1"#)
        .bind(profile).execute(&suite.pool).await.unwrap();
    sqlx::query("UPDATE leads SET trusted_contacts=(SELECT jsonb_agg((c-'birth_date'-'phone') || jsonb_build_object('related_patient_id',$2::uuid)) FROM jsonb_array_elements(trusted_contacts)c) WHERE id=$1")
        .bind(family.child).bind(profile).execute(&suite.pool).await.unwrap();
    sqlx::query("UPDATE lead_representatives SET street=NULL,zip=NULL,city=NULL,country=NULL,citizenships='{}' WHERE lead_id=$1 AND contact_id=$2")
        .bind(family.child).bind(family.contact).execute(&suite.pool).await.unwrap();
    let staff = bearer(suite.admin_id, "ceo");
    let (status, conflict) = request(&suite.app,"POST","/api/v1/leads",&staff,
        json!({"first_name":"Anna","last_name":"Mother","email":family.email,"date_of_birth":"1986-02-03"})).await;
    assert!(
        matches!(
            status,
            StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
        ),
        "Canonical known birth date must prevent reuse: {conflict}"
    );
    let (status, conflict) = request(
        &suite.app,
        "POST",
        "/api/v1/leads",
        &staff,
        json!({"first_name":"Anna","last_name":"Mother","email":family.email}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(
        conflict["code"],
        "existing_parent_patient_use_repeat_intake"
    );
    assert_eq!(conflict["patient_id"], profile.to_string());
    let restricted_manager:Uuid=sqlx::query_scalar("INSERT INTO users(email,name,password_hash,role) VALUES($1,'Unassigned manager','synthetic','patient_manager') RETURNING id")
        .bind(format!("manager-{}@example.test",Uuid::new_v4())).fetch_one(&suite.pool).await.unwrap();
    let (status, limited) = request(
        &suite.app,
        "POST",
        "/api/v1/leads",
        &bearer(restricted_manager, "patient_manager"),
        json!({"first_name":"Anna","last_name":"Mother","email":family.email}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{limited}");
    assert_eq!(limited["code"], "existing_parent_patient_use_repeat_intake");
    assert!(
        limited["patient_id"].is_null(),
        "An unassigned manager must not receive a patient link: {limited}"
    );

    let own_leads: i64 = sqlx::query_scalar("SELECT count(*) FROM leads WHERE portal_user_id=$1")
        .bind(family.mother)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(
        own_leads, 0,
        "Refused creation must leave no draft or account link"
    );
    let (status, activated) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{profile}/portal-account"),
        &staff,
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{activated}");
    assert_eq!(activated["reused"], true);
    assert!(activated["one_time_password"].is_null());
    let (status, created) = request(&suite.app,"POST","/api/v1/leads",&staff,
        json!({"first_name":"Anna","last_name":"Mother","repeat_patient_id":profile,"creation_key":Uuid::new_v4()})).await;
    assert!(
        matches!(status, StatusCode::OK | StatusCode::CREATED),
        "{created}"
    );
    let own: Uuid = created["id"].as_str().unwrap().parse().unwrap();
    let row: Value = sqlx::query_scalar("SELECT to_jsonb(l) FROM leads l WHERE id=$1")
        .bind(own)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(row["repeat_patient_id"], profile.to_string());
    assert_eq!(row["prospect_patient_id"], profile.to_string());
    assert_eq!(row["date_of_birth"], "1985-02-03");
    assert_eq!(row["phone"], "+491234567892");
    assert_eq!(row["street_address"], "Canonical street 4");
    assert_eq!(row["zip_code"], "10101");
    assert_eq!(row["city"], "Canonical city");
    assert_eq!(row["country"], "NL");
    assert!(!row.to_string().contains("PRIVATE-MEDICAL-MARKER"));
    assert!(!row.to_string().contains("PRIVATE-CONSENT-MARKER"));
    // The migrated fixture contains unrelated seed patients. Check this
    // parent's identity, including duplicates that lost the e-mail field.
    let matching_patients: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM patients WHERE id=$1 OR lower(email)=lower($2)
         OR (first_name='Anna' AND last_name='Mother' AND birth_date='1985-02-03')
         ORDER BY id",
    )
    .bind(profile)
    .bind(&family.email)
    .fetch_all(&suite.pool)
    .await
    .unwrap();
    assert_eq!(
        matching_patients,
        vec![profile],
        "Activation and repeat intake use the same record"
    );
    let inherited: i64=sqlx::query_scalar("SELECT (SELECT count(*) FROM consent_records WHERE lead_id=$1) + (SELECT count(*) FROM lead_portal_uploads WHERE lead_id=$1)")
        .bind(own).fetch_one(&suite.pool).await.unwrap();
    assert_eq!(
        inherited, 0,
        "Profile reuse must not copy consents or files"
    );
    assert_login_preserved(&suite.pool, &family).await;
}

#[tokio::test]
async fn parent_role_migration_only_recovers_unambiguous_identity_matches() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let family = family(&suite.pool, suite.admin_id).await;
    let child = converted_child(&suite.pool, suite.admin_id, &family, "lead_guardian").await;
    sqlx::query("UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(c || jsonb_build_object('relation','mother')) FROM jsonb_array_elements(trusted_contacts)c) WHERE id=$1")
        .bind(family.child).execute(&suite.pool).await.unwrap();
    sqlx::query("UPDATE patient_relations SET email=$2 WHERE patient_id=$1")
        .bind(child)
        .bind(&family.email)
        .execute(&suite.pool)
        .await
        .unwrap();
    let unproven: Uuid = sqlx::query_scalar("INSERT INTO patient_relations(patient_id,related_name,relation_type,email) VALUES($1,'Anna Mother','parent','different-person@example.test') RETURNING id")
        .bind(child).fetch_one(&suite.pool).await.unwrap();
    sqlx::raw_sql(include_str!(
        "../../../migrations/20261017090000_patient_parent_roles.sql"
    ))
    .execute(&suite.pool)
    .await
    .unwrap();
    let proven: String = sqlx::query_scalar(
        "SELECT relation_type FROM patient_relations WHERE patient_id=$1 AND email=$2",
    )
    .bind(child)
    .bind(&family.email)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(proven, "mother");
    let unchanged: String =
        sqlx::query_scalar("SELECT relation_type FROM patient_relations WHERE id=$1")
            .bind(unproven)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(
        unchanged, "parent",
        "A matching name alone must not infer the role"
    );
}

/// Owner decision 2026-10-19: the child's request names the mother with her
/// patronymic, her login and her own request without it. The own request
/// still reuses the guardian login (no 409, no new password); a different
/// first name or birth date is still another person.
#[tokio::test]
async fn own_lead_reuses_the_guardian_login_despite_a_patronymic_on_one_side() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    for (first_name, birth_date, reused) in [
        ("Anna", "1985-02-03", true),
        ("Hanna", "1985-02-03", false),
        ("Anna", "1986-02-03", false),
    ] {
        let family = family(&suite.pool, suite.admin_id).await;
        sqlx::query(
            "UPDATE leads SET trusted_contacts=(SELECT jsonb_agg(c || jsonb_build_object('name','Anna Petrivna Mother')) FROM jsonb_array_elements(trusted_contacts) c) WHERE id=$1",
        )
        .bind(family.child)
        .execute(&suite.pool)
        .await
        .unwrap();
        let (status, result) = request(
            &suite.app,
            "POST",
            "/api/v1/leads",
            &bearer(suite.admin_id, "ceo"),
            json!({"first_name":first_name,"last_name":"Mother","email":family.email,
                   "date_of_birth":birth_date,"country":"FR"}),
        )
        .await;
        if reused {
            assert_eq!(status, StatusCode::CREATED, "{result}");
            assert_eq!(
                result["portal_account"]["user_id"],
                family.mother.to_string()
            );
            assert_eq!(result["portal_account"]["reused"], true);
            assert!(result["portal_account"]["one_time_password"].is_null());
        } else {
            assert!(
                matches!(
                    status,
                    StatusCode::CONFLICT | StatusCode::UNPROCESSABLE_ENTITY
                ),
                "{first_name} {birth_date}: {status} {result}"
            );
        }
        assert_login_preserved(&suite.pool, &family).await;
    }
}
