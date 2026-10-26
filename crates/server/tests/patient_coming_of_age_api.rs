//! A minor patient turns 18 (owner decision 2026-10-20): the daily job ends
//! the parents' access to the patient record and the converted request,
//! tells the staff once to issue the patient's own login, and the login the
//! child had as a lead becomes the patient's login. Synthetic data only, in
//! disposable databases.
mod support;

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use chrono::{Months, NaiveDate};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

use gmed_server::realtime::LEAD_PORTAL_ACCESS_ENDED;
use gmed_server::services::coming_of_age::{
    ADVANCE_NOTICE_DAYS, CAME_OF_AGE_EVENT, ComingOfAgeReport, LEAD_CAME_OF_AGE_EVENT,
    LEAD_NOTIFICATION_KIND, LEAD_NOTIFIED_ACTION, LEAD_SOON_EVENT, LEAD_SOON_NOTIFICATION_KIND,
    LEAD_SOON_NOTIFIED_ACTION, NOTIFICATION_KIND, NOTIFIED_ACTION, REVOKE_REASON, SOON_EVENT,
    SOON_NOTIFICATION_KIND, SOON_NOTIFIED_ACTION, run_advance_notices_on, run_on,
};

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
    let body = if method == "GET" {
        Body::empty()
    } else {
        Body::from("{}")
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) })),
    )
}

fn years_before(today: NaiveDate, years: u32) -> NaiveDate {
    today.checked_sub_months(Months::new(years * 12)).unwrap()
}

async fn user(pool: &PgPool, name: &str, role: &str) -> (Uuid, String) {
    let email = format!(
        "{}-{}@example.test",
        name.to_lowercase(),
        Uuid::new_v4().simple()
    );
    let id = sqlx::query_scalar(
        "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, 'test-password-hash', $3) RETURNING id",
    )
    .bind(&email)
    .bind(name)
    .bind(role)
    .fetch_one(pool)
    .await
    .unwrap();
    (id, email)
}

async fn patient(pool: &PgPool, actor: Uuid, first: &str, birth: NaiveDate, email: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, email, created_by)
         VALUES ($1, $2, 'Muster', $3, 'female', $4, $5) RETURNING id",
    )
    .bind(format!("P-{}", Uuid::new_v4()))
    .bind(first)
    .bind(birth)
    .bind(email)
    .bind(actor)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn assign(pool: &PgPool, patient: Uuid, user: Uuid, actor: Uuid, source: &str) {
    sqlx::query(
        "INSERT INTO patient_assignments (patient_id, user_id, assigned_by, source) VALUES ($1, $2, $3, $4)",
    )
    .bind(patient)
    .bind(user)
    .bind(actor)
    .bind(source)
    .execute(pool)
    .await
    .unwrap();
}

/// The converted request of the child: its own login (closed while it was
/// a minor) and the mother's guardian access.
async fn converted_request(
    pool: &PgPool,
    actor: Uuid,
    child: Uuid,
    birth: NaiveDate,
    child_login: Uuid,
    guardian: Option<Uuid>,
) -> Uuid {
    let lead: Uuid = sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, created_by, portal_user_id,
                            converted_patient_id, qualification_status)
         VALUES ('Mia', 'Muster', $1, $2, $3, $4, 'converted') RETURNING id",
    )
    .bind(birth)
    .bind(actor)
    .bind(child_login)
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    if let Some(guardian) = guardian {
        sqlx::query(
            "INSERT INTO lead_portal_access (lead_id, user_id, kind, created_by) VALUES ($1, $2, 'guardian', $3)",
        )
        .bind(lead)
        .bind(guardian)
        .bind(actor)
        .execute(pool)
        .await
        .unwrap();
    }
    lead
}

async fn revoked(pool: &PgPool, patient: Uuid, user: Uuid) -> (bool, Option<String>, Option<Uuid>) {
    sqlx::query_as(
        "SELECT revoked_at IS NOT NULL, revoked_reason, revoked_by
         FROM patient_assignments WHERE patient_id = $1 AND user_id = $2",
    )
    .bind(patient)
    .bind(user)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn count(pool: &PgPool, sql: &str, id: Uuid) -> i64 {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

/// The realtime events of `event_type` about `entity`, as published (and
/// persisted for the replay): `(target users, payload)`.
async fn realtime(pool: &PgPool, event_type: &str, entity: Uuid) -> Vec<(Vec<Uuid>, Value)> {
    sqlx::query_as(
        "SELECT target_user_ids, payload FROM realtime_events
         WHERE event_type = $1 AND entity_id = $2 ORDER BY seq",
    )
    .bind(event_type)
    .bind(entity)
    .fetch_all(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn parents_lose_access_on_the_eighteenth_birthday_and_staff_is_told_once() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let birth = years_before(today, 18);

    let (manager, _) = user(pool, "Manager", "patient_manager").await;
    let (child_login, child_email) = user(pool, "Mia", "patient").await;
    let (mother, _) = user(pool, "Anna", "patient").await;
    let (father, father_email) = user(pool, "Ben", "patient").await;
    let child = patient(pool, suite.admin_id, "Mia", birth, &child_email).await;
    assign(pool, child, manager, suite.admin_id, "manual").await;
    let lead = converted_request(
        pool,
        suite.admin_id,
        child,
        birth,
        child_login,
        Some(mother),
    )
    .await;
    assign(pool, child, mother, suite.admin_id, "lead_guardian").await;
    assign(pool, child, father, suite.admin_id, "lead_guardian").await;
    // The father has his own record: his login stays.
    let father_own = patient(
        pool,
        suite.admin_id,
        "Ben",
        NaiveDate::from_ymd_opt(1980, 1, 1).unwrap(),
        &father_email,
    )
    .await;
    assign(pool, father_own, father, suite.admin_id, "manual").await;
    let mother_session: Uuid =
        sqlx::query_scalar("INSERT INTO token_families (user_id) VALUES ($1) RETURNING id")
            .bind(mother)
            .fetch_one(pool)
            .await
            .unwrap();

    // Before: the father opens the child's record in the portal.
    let (status, body) = request(
        &suite.app,
        "GET",
        "/api/v1/me/export",
        &bearer(father, "patient"),
        Some(child),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");

    // The day before the birthday nothing happens.
    let eve = today.pred_opt().unwrap();
    let report = run_on(&suite.state, eve).await.unwrap();
    assert_eq!(report.assignments_revoked, 0, "{report:?}");
    assert!(!revoked(pool, child, mother).await.0);

    let report = run_on(&suite.state, today).await.unwrap();
    assert_eq!(report.patients, 1, "{report:?}");
    assert_eq!(report.assignments_revoked, 2, "{report:?}");
    assert_eq!(report.lead_accesses_revoked, 1, "{report:?}");
    assert_eq!(report.logins_deactivated, 1, "{report:?}");
    assert_eq!(report.notifications, 1, "{report:?}");

    for parent in [mother, father] {
        assert_eq!(
            revoked(pool, child, parent).await,
            (true, Some(REVOKE_REASON.to_string()), None),
            "the parents' assignment ends by the system"
        );
    }
    assert!(
        !revoked(pool, father_own, father).await.0,
        "own record kept"
    );
    assert!(!revoked(pool, child, manager).await.0, "staff untouched");
    let access: (bool, Option<String>) = sqlx::query_as(
        "SELECT revoked_at IS NOT NULL, revoked_reason FROM lead_portal_access WHERE lead_id = $1 AND user_id = $2",
    )
    .bind(lead)
    .bind(mother)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(access, (true, Some(REVOKE_REASON.to_string())));

    // The mother's login reaches nothing else: switched off, never deleted.
    let mother_active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(mother)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(!mother_active);
    let session_revoked: bool =
        sqlx::query_scalar("SELECT is_revoked FROM token_families WHERE id = $1")
            .bind(mother_session)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(session_revoked);
    let father_active: bool = sqlx::query_scalar("SELECT is_active FROM users WHERE id = $1")
        .bind(father)
        .fetch_one(pool)
        .await
        .unwrap();
    assert!(father_active, "a parent with an own record keeps the login");

    // The father no longer reaches the child's record; his own still opens.
    let (status, body) = request(
        &suite.app,
        "GET",
        "/api/v1/me/export",
        &bearer(father, "patient"),
        Some(child),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    let (status, body) = request(
        &suite.app,
        "GET",
        "/api/v1/me/export",
        &bearer(father, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["patient"]["id"], father_own.to_string(), "{body}");

    // Audit in the same transaction.
    assert_eq!(
        count(
            pool,
            "SELECT count(*) FROM audit_log WHERE action = 'revoke_guardian_patient_access' AND entity_id = $1",
            child,
        )
        .await,
        2
    );
    assert_eq!(
        count(
            pool,
            "SELECT count(*) FROM audit_log WHERE action = 'revoke_lead_guardian_access' AND entity_id = $1",
            lead,
        )
        .await,
        1
    );
    let notice_sql = format!(
        "SELECT count(*) FROM user_notifications WHERE kind = '{NOTIFICATION_KIND}' AND entity_type = 'patient' AND entity_id = $1"
    );
    assert_eq!(count(pool, &notice_sql, child).await, 1);
    let recipient: Uuid = sqlx::query_scalar(
        "SELECT user_id FROM user_notifications WHERE kind = $1 AND entity_id = $2",
    )
    .bind(NOTIFICATION_KIND)
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(recipient, manager, "the patient's own manager is told");

    // Live (owner request 2026-10-26): the patient's open card reloads, the
    // mother's open cabinet of the converted request hears that it ended.
    let came_of_age = realtime(pool, CAME_OF_AGE_EVENT, child).await;
    assert_eq!(came_of_age.len(), 1, "{came_of_age:?}");
    assert!(came_of_age[0].0.contains(&manager), "{came_of_age:?}");
    assert_eq!(came_of_age[0].1["reason"], REVOKE_REASON);
    assert_eq!(came_of_age[0].1["assignments_revoked"], 2);
    let ended = realtime(pool, LEAD_PORTAL_ACCESS_ENDED, lead).await;
    assert_eq!(ended.len(), 1, "{ended:?}");
    assert_eq!(ended[0].0, vec![mother], "only the parent who lost it");
    assert_eq!(ended[0].1, json!({ "reason": REVOKE_REASON }));

    // Idempotent: a second run changes nothing and tells nobody again.
    let again = run_on(&suite.state, today).await.unwrap();
    assert_eq!(again, ComingOfAgeReport::default());
    assert_eq!(count(pool, &notice_sql, child).await, 1);
    assert_eq!(realtime(pool, CAME_OF_AGE_EVENT, child).await.len(), 1);
    assert_eq!(
        count(
            pool,
            &format!(
                "SELECT count(*) FROM audit_log WHERE action = '{NOTIFIED_ACTION}' AND entity_id = $1"
            ),
            child,
        )
        .await,
        1
    );

    // The patient's own login: the child's login of the request is linked
    // instead of a conflict over its e-mail, with a new one-time password.
    let (status, body) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{child}/portal-account"),
        &bearer(suite.admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user_id"], child_login.to_string(), "{body}");
    assert_eq!(body["created"], false, "{body}");
    assert_eq!(body["linked_request_login"], true, "{body}");
    assert!(body["one_time_password"].is_string(), "{body}");
    let source: String = sqlx::query_scalar(
        "SELECT source FROM patient_assignments WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL",
    )
    .bind(child)
    .bind(child_login)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(source, "manual");
    assert_eq!(
        count(
            pool,
            "SELECT count(*) FROM audit_log WHERE action = 'link_request_login_to_patient' AND entity_id = $1",
            child,
        )
        .await,
        1
    );
    // A second issue only renews the password of the now linked login.
    let (status, body) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{child}/portal-account"),
        &bearer(suite.admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user_id"], child_login.to_string(), "{body}");
    assert_eq!(body["linked_request_login"], false, "{body}");
}

#[tokio::test]
async fn staff_granted_access_and_minors_stay_untouched() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let adult_birth = years_before(today, 19);
    let minor_birth = years_before(today, 10);

    let (aunt, _) = user(pool, "Clara", "patient").await;
    let (parent, _) = user(pool, "Dora", "patient").await;
    let (adult_login, adult_email) = user(pool, "Eva", "patient").await;
    let (sibling_login, sibling_email) = user(pool, "Finn", "patient").await;
    let adult = patient(pool, suite.admin_id, "Eva", adult_birth, &adult_email).await;
    let sibling = patient(pool, suite.admin_id, "Finn", minor_birth, &sibling_email).await;
    converted_request(pool, suite.admin_id, adult, adult_birth, adult_login, None).await;
    let sibling_lead = converted_request(
        pool,
        suite.admin_id,
        sibling,
        minor_birth,
        sibling_login,
        Some(parent),
    )
    .await;
    // Staff granted the aunt access to the adult explicitly.
    assign(pool, adult, aunt, suite.admin_id, "manual").await;
    // The minor sibling keeps the parent's access.
    assign(pool, sibling, parent, suite.admin_id, "lead_guardian").await;

    let report = run_on(&suite.state, today).await.unwrap();
    assert_eq!(report, ComingOfAgeReport::default(), "{report:?}");
    assert!(!revoked(pool, adult, aunt).await.0);
    assert!(!revoked(pool, sibling, parent).await.0);
    assert_eq!(
        count(
            pool,
            "SELECT count(*) FROM lead_portal_access WHERE lead_id = $1 AND revoked_at IS NULL",
            sibling_lead,
        )
        .await,
        1
    );

    // A minor still gets no own login.
    let (status, body) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/patients/{sibling}/portal-account"),
        &bearer(suite.admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
}

#[tokio::test]
async fn a_new_password_on_the_converted_request_links_the_adults_own_login() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let birth = years_before(today, 18);
    let (child_login, child_email) = user(pool, "Gina", "patient").await;
    let child = patient(pool, suite.admin_id, "Gina", birth, &child_email).await;
    let lead = converted_request(pool, suite.admin_id, child, birth, child_login, None).await;

    let (status, body) = request(
        &suite.app,
        "POST",
        &format!("/api/v1/leads/{lead}/portal-account"),
        &bearer(suite.admin_id, "ceo"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["user_id"], child_login.to_string(), "{body}");
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patient_assignments WHERE patient_id = $1 AND user_id = $2 AND revoked_at IS NULL AND source = 'manual'",
    )
    .bind(child)
    .bind(child_login)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(active, 1);
    // The child's login now reaches its own record.
    let (status, body) = request(
        &suite.app,
        "GET",
        "/api/v1/me/export",
        &bearer(child_login, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["patient"]["id"], child.to_string(), "{body}");
}

#[tokio::test]
async fn an_adults_new_order_names_the_patient_not_the_parents_of_the_minors_contract() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let birth = years_before(today, 18);
    let child = patient(pool, suite.admin_id, "Hana", birth, "hana@example.test").await;
    let relation: Uuid = sqlx::query_scalar(
        "INSERT INTO patient_relations (patient_id, related_name, relation_type) VALUES ($1, 'Ida Muster', 'mother') RETURNING id",
    )
    .bind(child)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query("UPDATE patients SET contracting_relation_ids = $2 WHERE id = $1")
        .bind(child)
        .bind(vec![relation])
        .execute(pool)
        .await
        .unwrap();
    // The parents concluded the framework contract a year ago.
    let contract: Uuid = sqlx::query_scalar(
        "INSERT INTO framework_contracts (patient_id, contract_number, status, created_by, created_at,
                                          contracting_party)
         VALUES ($1, $2, 'draft', $3, now() - INTERVAL '1 year', 'legal_representatives') RETURNING id",
    )
    .bind(child)
    .bind(format!("FC-{}", Uuid::new_v4().simple()))
    .bind(suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let order: Uuid = sqlx::query_scalar(
        "INSERT INTO orders (order_number, patient_id, phase, status, created_by, contract_id)
         VALUES ($1, $2, 'execution', 'active', $3, $4) RETURNING id",
    )
    .bind(format!("ORD-{}", Uuid::new_v4().simple()))
    .bind(child)
    .bind(suite.admin_id)
    .bind(contract)
    .fetch_one(pool)
    .await
    .unwrap();

    let mut conn = pool.acquire().await.unwrap();
    let party = gmed_server::services::contracting_party::resolve(
        &mut conn,
        child,
        Some(order),
        None,
        today,
    )
    .await
    .unwrap();
    assert_eq!(
        party.kind,
        gmed_server::services::contracting_party::PartyKind::Patient
    );
    assert!(!party.explicit);
    assert!(party.representatives.is_empty());

    // The custody parents stored at the conversion applied while a minor only.
    let before = gmed_server::services::contracting_party::load_representatives(
        &mut conn,
        child,
        &[],
        today.pred_opt().unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(
        before.iter().map(|r| r.relation_id).collect::<Vec<_>>(),
        vec![relation]
    );
}

/// A minor's request (lead) that was not converted when the person turned 18
/// (owner decision 2026-10-23): the parents' access ends on the birthday,
/// staff are told once to issue the lead's own login, the parents' cabinet
/// says why, and a second run does nothing.
#[tokio::test]
async fn parents_lose_the_access_to_an_open_request_on_the_eighteenth_birthday() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let birth = years_before(today, 18);

    let (child_login, _) = user(pool, "Mia", "patient").await;
    let (mother, _) = user(pool, "Anna", "patient").await;
    let (father, _) = user(pool, "Ben", "patient").await;
    let lead: Uuid = sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, created_by, portal_user_id)
         VALUES ('Mia', 'Muster', $1, $2, $3) RETURNING id",
    )
    .bind(birth)
    .bind(suite.admin_id)
    .bind(child_login)
    .fetch_one(pool)
    .await
    .unwrap();
    for parent in [mother, father] {
        sqlx::query(
            "INSERT INTO lead_portal_access (lead_id, user_id, kind, created_by) VALUES ($1, $2, 'guardian', $3)",
        )
        .bind(lead)
        .bind(parent)
        .bind(suite.admin_id)
        .execute(pool)
        .await
        .unwrap();
    }
    // A younger sibling's request keeps the mother's access.
    let sibling: Uuid = sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, created_by)
         VALUES ('Finn', 'Muster', $1, $2) RETURNING id",
    )
    .bind(years_before(today, 10))
    .bind(suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO lead_portal_access (lead_id, user_id, kind, created_by) VALUES ($1, $2, 'guardian', $3)",
    )
    .bind(sibling)
    .bind(mother)
    .bind(suite.admin_id)
    .execute(pool)
    .await
    .unwrap();
    let active_sql =
        "SELECT count(*) FROM lead_portal_access WHERE lead_id = $1 AND revoked_at IS NULL";

    // The day before the birthday nothing happens.
    let report = run_on(&suite.state, today.pred_opt().unwrap())
        .await
        .unwrap();
    assert_eq!(report, ComingOfAgeReport::default(), "{report:?}");
    assert_eq!(count(pool, active_sql, lead).await, 2);

    let report = run_on(&suite.state, today).await.unwrap();
    assert_eq!(report.leads, 1, "{report:?}");
    assert_eq!(report.patients, 0, "{report:?}");
    assert_eq!(report.lead_accesses_revoked, 2, "{report:?}");
    assert_eq!(report.logins_deactivated, 0, "{report:?}");
    assert!(report.notifications >= 1, "{report:?}");
    assert_eq!(count(pool, active_sql, lead).await, 0);
    assert_eq!(
        count(pool, active_sql, sibling).await,
        1,
        "the minor sibling"
    );
    let reasons: Vec<(Option<String>, Option<Uuid>)> = sqlx::query_as(
        "SELECT revoked_reason, revoked_by FROM lead_portal_access WHERE lead_id = $1",
    )
    .bind(lead)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(
        reasons,
        vec![(Some(REVOKE_REASON.to_string()), None::<Uuid>); 2],
        "ended by the system"
    );
    assert_eq!(
        count(
            pool,
            "SELECT count(*) FROM audit_log WHERE action = 'revoke_lead_guardian_access' AND entity_id = $1",
            lead,
        )
        .await,
        2
    );
    let notice_sql = format!(
        "SELECT count(*) FROM user_notifications WHERE kind = '{LEAD_NOTIFICATION_KIND}' AND entity_type = 'lead' AND entity_id = $1"
    );
    let notices = count(pool, &notice_sql, lead).await;
    assert_eq!(notices, report.notifications as i64);
    let owner_told: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM user_notifications WHERE kind = $1 AND entity_id = $2 AND user_id = $3)",
    )
    .bind(LEAD_NOTIFICATION_KIND)
    .bind(lead)
    .bind(suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(owner_told, "the request's owner is told");

    // The parents keep their logins; the father's cabinet says why it is empty.
    let active: Vec<bool> = sqlx::query_scalar("SELECT is_active FROM users WHERE id = ANY($1)")
        .bind(vec![mother, father])
        .fetch_all(pool)
        .await
        .unwrap();
    assert_eq!(active, vec![true, true]);
    let (status, body) = request(
        &suite.app,
        "GET",
        "/api/v1/me/lead-requests",
        &bearer(father, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["requests"], json!([]), "{body}");
    assert_eq!(body["guardian_access_ended"], true, "{body}");
    let (status, body) = request(
        &suite.app,
        "GET",
        &format!("/api/v1/me/lead-requests/{lead}"),
        &bearer(father, "patient"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    // Live: open wizards reload, both parents' open cabinets hear it ended.
    let came_of_age = realtime(pool, LEAD_CAME_OF_AGE_EVENT, lead).await;
    assert_eq!(came_of_age.len(), 1, "{came_of_age:?}");
    assert!(
        came_of_age[0].0.contains(&suite.admin_id),
        "the request's owner"
    );
    assert_eq!(came_of_age[0].1["lead_accesses_revoked"], 2);
    let ended = realtime(pool, LEAD_PORTAL_ACCESS_ENDED, lead).await;
    assert_eq!(ended.len(), 1, "{ended:?}");
    let mut targets = ended[0].0.clone();
    targets.sort();
    let mut parents = vec![mother, father];
    parents.sort();
    assert_eq!(targets, parents, "{ended:?}");
    assert!(
        !ended[0].0.contains(&child_login),
        "the child's own login is not told"
    );
    assert_eq!(ended[0].1, json!({ "reason": REVOKE_REASON }));
    assert!(
        realtime(pool, LEAD_PORTAL_ACCESS_ENDED, sibling)
            .await
            .is_empty(),
        "the sibling's request stays open"
    );

    // Idempotent: nothing again, nobody told twice.
    let again = run_on(&suite.state, today).await.unwrap();
    assert_eq!(again, ComingOfAgeReport::default());
    assert_eq!(count(pool, &notice_sql, lead).await, notices);
    assert_eq!(
        count(
            pool,
            &format!(
                "SELECT count(*) FROM audit_log WHERE action = '{LEAD_NOTIFIED_ACTION}' AND entity_id = $1"
            ),
            lead,
        )
        .await,
        1
    );
}

/// Owner request 2026-10-26: staff hear 30 days ahead that a minor patient
/// (or an open request of a minor) turns 18 and the parents' access ends,
/// once per person, with a realtime event for the open card or wizard. A
/// person further away, already of age, or without a parent's access is not
/// told; neither is the patient of a request that was told already.
#[tokio::test]
async fn staff_hear_thirty_days_ahead_once_that_a_minor_turns_eighteen() {
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    let pool = &suite.pool;
    let today = gmed_server::app_time::today();
    let turns_18_in = |days: u64| years_before(today + chrono::Days::new(days), 18);

    let (manager, _) = user(pool, "Manager", "patient_manager").await;
    let (mother, _) = user(pool, "Anna", "patient").await;
    let (_, child_email) = user(pool, "Mia", "patient").await;
    let (_, later_email) = user(pool, "Lena", "patient").await;
    // Turns 18 in 20 days: inside the window.
    let child = patient(pool, suite.admin_id, "Mia", turns_18_in(20), &child_email).await;
    assign(pool, child, manager, suite.admin_id, "manual").await;
    assign(pool, child, mother, suite.admin_id, "lead_guardian").await;
    // Turns 18 in 40 days: not yet.
    let later = patient(pool, suite.admin_id, "Lena", turns_18_in(40), &later_email).await;
    assign(pool, later, manager, suite.admin_id, "manual").await;
    assign(pool, later, mother, suite.admin_id, "lead_guardian").await;
    // Inside the window but no parent has access: nothing ends.
    let (_, alone_email) = user(pool, "Ole", "patient").await;
    let alone = patient(pool, suite.admin_id, "Ole", turns_18_in(10), &alone_email).await;
    assign(pool, alone, manager, suite.admin_id, "manual").await;

    // An open request turning 18 in exactly 30 days, with a parent's access.
    let open_lead: Uuid = sqlx::query_scalar(
        "INSERT INTO leads (first_name, last_name, date_of_birth, created_by)
         VALUES ('Finn', 'Muster', $1, $2) RETURNING id",
    )
    .bind(turns_18_in(ADVANCE_NOTICE_DAYS as u64))
    .bind(suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO lead_portal_access (lead_id, user_id, kind, created_by) VALUES ($1, $2, 'guardian', $3)",
    )
    .bind(open_lead)
    .bind(mother)
    .bind(suite.admin_id)
    .execute(pool)
    .await
    .unwrap();

    let report = run_advance_notices_on(&suite.state, today).await.unwrap();
    assert!(report.patients >= 1 && report.leads >= 1, "{report:?}");

    // The patient: the assigned manager, with the day and the days left.
    let notices: Vec<(Uuid, Option<Value>)> = sqlx::query_as(
        "SELECT user_id, params FROM user_notifications
         WHERE kind = $1 AND entity_type = 'patient' AND entity_id = $2",
    )
    .bind(SOON_NOTIFICATION_KIND)
    .bind(child)
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(notices.len(), 1, "{notices:?}");
    assert_eq!(notices[0].0, manager);
    let params = notices[0].1.clone().unwrap();
    assert_eq!(params["days_left"], 20, "{params}");
    assert_eq!(
        params["turns_18_on"],
        (today + chrono::Days::new(20)).to_string(),
        "{params}"
    );
    assert!(
        params["patient_label"].as_str().unwrap().contains("Mia"),
        "{params}"
    );
    let events = realtime(pool, SOON_EVENT, child).await;
    assert_eq!(events.len(), 1, "{events:?}");
    assert!(events[0].0.contains(&manager), "{events:?}");
    assert_eq!(events[0].1["days_left"], 20);
    // Not told: too far away, or nobody's access ends.
    for quiet in [later, alone] {
        assert_eq!(
            count(
                pool,
                &format!(
                    "SELECT count(*) FROM user_notifications WHERE kind = '{SOON_NOTIFICATION_KIND}' AND entity_id = $1"
                ),
                quiet,
            )
            .await,
            0
        );
    }

    // The open request: its owner (and the patient managers) are told.
    let lead_notice_sql = format!(
        "SELECT count(*) FROM user_notifications WHERE kind = '{LEAD_SOON_NOTIFICATION_KIND}' AND entity_type = 'lead' AND entity_id = $1"
    );
    let lead_notices = count(pool, &lead_notice_sql, open_lead).await;
    assert!(lead_notices >= 1);
    let owner_params: Option<Value> = sqlx::query_scalar(
        "SELECT params FROM user_notifications WHERE kind = $1 AND entity_id = $2 AND user_id = $3",
    )
    .bind(LEAD_SOON_NOTIFICATION_KIND)
    .bind(open_lead)
    .bind(suite.admin_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let owner_params = owner_params.unwrap();
    assert_eq!(owner_params["lead_name"], "Finn Muster");
    assert_eq!(owner_params["days_left"], ADVANCE_NOTICE_DAYS);
    let lead_events = realtime(pool, LEAD_SOON_EVENT, open_lead).await;
    assert_eq!(lead_events.len(), 1, "{lead_events:?}");
    assert!(
        lead_events[0].0.contains(&suite.admin_id),
        "{lead_events:?}"
    );

    // Once per person: the next day's run and a repeated run tell nobody again.
    run_advance_notices_on(&suite.state, today).await.unwrap();
    run_advance_notices_on(&suite.state, today.succ_opt().unwrap())
        .await
        .unwrap();
    assert_eq!(
        count(
            pool,
            &format!(
                "SELECT count(*) FROM user_notifications WHERE kind = '{SOON_NOTIFICATION_KIND}' AND entity_id = $1"
            ),
            child,
        )
        .await,
        1
    );
    assert_eq!(count(pool, &lead_notice_sql, open_lead).await, lead_notices);
    assert_eq!(realtime(pool, SOON_EVENT, child).await.len(), 1);
    assert_eq!(
        count(
            pool,
            &format!(
                "SELECT count(*) FROM audit_log WHERE action = '{SOON_NOTIFIED_ACTION}' AND entity_id = $1"
            ),
            child,
        )
        .await,
        1
    );
    assert_eq!(
        count(
            pool,
            &format!(
                "SELECT count(*) FROM audit_log WHERE action = '{LEAD_SOON_NOTIFIED_ACTION}' AND entity_id = $1"
            ),
            open_lead,
        )
        .await,
        1
    );

    // The request becomes the patient record: the patient is not told again.
    let (_, converted_email) = user(pool, "Finn", "patient").await;
    let converted = patient(
        pool,
        suite.admin_id,
        "Finn",
        turns_18_in(ADVANCE_NOTICE_DAYS as u64),
        &converted_email,
    )
    .await;
    assign(pool, converted, manager, suite.admin_id, "manual").await;
    assign(pool, converted, mother, suite.admin_id, "lead_guardian").await;
    sqlx::query(
        "UPDATE leads SET converted_patient_id = $2, qualification_status = 'converted' WHERE id = $1",
    )
    .bind(open_lead)
    .bind(converted)
    .execute(pool)
    .await
    .unwrap();
    run_advance_notices_on(&suite.state, today).await.unwrap();
    assert_eq!(
        count(
            pool,
            &format!(
                "SELECT count(*) FROM user_notifications WHERE kind = '{SOON_NOTIFICATION_KIND}' AND entity_id = $1"
            ),
            converted,
        )
        .await,
        0
    );
}

/// The job trigger for live tests (`POST /e2e/jobs/run`) exists only with
/// `ENABLE_E2E_SUPPORT` and the secret: without them it answers 404 to
/// anything, before it reads the body.
#[tokio::test]
async fn the_job_trigger_is_not_reachable_without_e2e_support() {
    if std::env::var_os("ENABLE_E2E_SUPPORT").is_some() {
        return;
    }
    let Some(suite) = support::suite_context(SECRET).await else {
        return;
    };
    for body in [
        r#"{"job":"coming_of_age"}"#,
        r#"{"job":"lead_retention"}"#,
        "not json",
    ] {
        let response = suite
            .app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/e2e/jobs/run")
                    .header("Content-Type", "application/json")
                    .header("x-e2e-secret", "anything")
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{body}");
    }
}
