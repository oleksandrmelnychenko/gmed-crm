//! Explicit links to an existing parent's basic identity, without copying
//! clinical data, and their effect on the child's sanctions/country gate.

mod support;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use chrono::NaiveDate;
use gmed_server::auth::jwt;
use gmed_server::sanctions::screening::{self, SubjectKind};
use gmed_server::services::lead_guardian_identity;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn request(
    suite: &support::TestSuiteContext,
    user: Uuid,
    role: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let bearer = jwt::issue_access_token(TEST_SECRET, user, role, Uuid::new_v4()).unwrap();
    let req = Request::builder()
        .method(method)
        .uri(format!("/api/v1{path}"))
        .header("Authorization", format!("Bearer {bearer}"))
        .header("Content-Type", "application/json")
        .body(body.map_or_else(Body::empty, |body| {
            Body::from(serde_json::to_vec(&body).unwrap())
        }))
        .unwrap();
    let response = suite.app.clone().oneshot(req).await.unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn user(suite: &support::TestSuiteContext, role: &str) -> Uuid {
    sqlx::query_scalar(
        "INSERT INTO users(email,password_hash,name,role) VALUES($1,'synthetic-hash','Synthetic identity reviewer',$2) RETURNING id",
    )
    .bind(format!("identity-{}@example.com", Uuid::new_v4().simple()))
    .bind(role)
    .fetch_one(&suite.pool)
    .await
    .unwrap()
}

async fn lead(suite: &support::TestSuiteContext, contacts: Value) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO leads(first_name,last_name,date_of_birth,citizenships,country,
                             trusted_contacts,email,created_by)
           VALUES('Synthetic','Child','2015-04-20',ARRAY['DE'],'DE',$1,$2,$3)
           RETURNING id"#,
    )
    .bind(contacts)
    .bind(format!("child-{}@example.com", Uuid::new_v4().simple()))
    .bind(suite.admin_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap()
}

async fn parent(suite: &support::TestSuiteContext, country: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,
               citizenships,residence_country,address_country,address_street,
               address_city,address_zip,email,phone_primary,passport_number,
               passport_expiry,notes,clinical_warnings,legal_status,created_by)
           VALUES($1,'Anna','Canonical','1985-03-02','female',ARRAY[$2::text],$2,$2,
               'Synthetic street 10','Synthetic city','00000','canonical@example.com',
               '+491234567890','SYNTHETIC-PASSPORT','2035-01-01',
               'PRIVATE-CLINICAL-MARKER','PRIVATE-CLINICAL-MARKER',
               '{"private_consent":"PRIVATE-CONSENT-MARKER"}',$3)
           RETURNING id"#,
    )
    .bind(format!("P-IDENTITY-{}", Uuid::new_v4().simple()))
    .bind(country)
    .bind(suite.admin_id)
    .fetch_one(&suite.pool)
    .await
    .unwrap()
}

async fn status(suite: &support::TestSuiteContext, pm: Uuid, lead: Uuid) -> Value {
    let (code, body) = request(
        suite,
        pm,
        "patient_manager",
        "GET",
        &format!("/sanctions/leads/{lead}/status"),
        None,
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
async fn linked_parent_identity_is_screened_and_its_country_holds_the_child() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pm = user(&suite, "patient_manager").await;
    let existing_parent = parent(&suite, "RU").await;
    sqlx::query("UPDATE patients SET address_country=NULL WHERE id=$1")
        .bind(existing_parent)
        .execute(&suite.pool)
        .await
        .unwrap();
    let mother = Uuid::new_v4();
    let father = Uuid::new_v4();
    let child = lead(
        &suite,
        json!([
            {"id": mother, "related_patient_id": existing_parent, "name": "Anna Canonical", "relation": "mother"},
            {"id": father, "name": "Ben Rawparent", "relation": "father", "citizenships": ["AT"], "country": "DE", "birth_date": "1980-06-01"}
        ]),
    )
    .await;
    let subjects = screening::load_lead_subjects(&suite.pool, child)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(subjects.subjects.len(), 3);
    let mother_subject = subjects
        .subjects
        .iter()
        .find(|subject| subject.subject_ref == mother.to_string())
        .unwrap();
    assert_eq!(mother_subject.kind, SubjectKind::LeadGuardian);
    assert_eq!(mother_subject.lead_id, Some(child));
    assert!(mother_subject.patient_id.is_none());
    assert_eq!(mother_subject.subject.first_name, "Anna");
    assert_eq!(mother_subject.subject.last_name, "Canonical");
    assert_eq!(
        mother_subject.subject.date_of_birth,
        NaiveDate::from_ymd_opt(1985, 3, 2)
    );
    assert_eq!(mother_subject.subject.citizenships, vec!["RU"]);
    assert_eq!(mother_subject.residence, vec!["RU"]);
    let mut conn = suite.pool.acquire().await.unwrap();
    let identities = lead_guardian_identity::load(&mut conn, child)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(
        identities[0].extras["country"], "RU",
        "A known residence fills the short form even without a separate address country"
    );
    let father_subject = subjects
        .subjects
        .iter()
        .find(|subject| subject.subject_ref == father.to_string())
        .unwrap();
    assert_eq!(father_subject.subject.citizenships, vec!["AT"]);
    assert_eq!(father_subject.residence, vec!["DE"]);
    let body = status(&suite, pm, child).await;
    assert_eq!(body["country"]["blocking"], json!(["RU"]));
    assert_eq!(body["open_hits"], 0);
    assert_eq!(body["confirmed_hits"], 0);
    let (code, body) = request(
        &suite,
        pm,
        "patient_manager",
        "POST",
        &format!("/leads/{child}/qualify"),
        Some(json!({"status":"qualified"})),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"], "blocked_country");
    let logins: i64 =
        sqlx::query_scalar("SELECT count(*) FROM lead_portal_access WHERE lead_id=$1")
            .bind(child)
            .fetch_one(&suite.pool)
            .await
            .unwrap();
    assert_eq!(
        logins, 0,
        "Screening parents does not need a login or payer role"
    );

    // Current linked identity is read again, and the migration queues the
    // child when the linked parent's screened identity changes.
    sqlx::query(
        "DELETE FROM sanctions_screening_queue WHERE subject_type='lead' AND subject_id=$1",
    )
    .bind(child)
    .execute(&suite.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE patients SET citizenships=ARRAY['DE'],residence_country='DE',address_country='DE',birth_date='1986-04-03' WHERE id=$1")
        .bind(existing_parent)
        .execute(&suite.pool)
        .await
        .unwrap();
    let queued: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sanctions_screening_queue WHERE subject_type='lead' AND subject_id=$1)")
        .bind(child)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert!(
        queued,
        "Changing a linked parent must also queue their child's lead"
    );
    let body = status(&suite, pm, child).await;
    assert_eq!(body["country"]["blocking"], json!([]));
    let updated = screening::load_lead_subjects(&suite.pool, child)
        .await
        .unwrap()
        .unwrap();
    let mother_subject = updated
        .subjects
        .iter()
        .find(|subject| subject.subject_ref == mother.to_string())
        .unwrap();
    assert_eq!(mother_subject.subject.citizenships, vec!["DE"]);
    assert_eq!(
        mother_subject.subject.date_of_birth,
        NaiveDate::from_ymd_opt(1986, 4, 3)
    );
}

#[tokio::test]
async fn local_parent_answers_win_and_only_missing_basic_identity_is_prefilled() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pm = user(&suite, "patient_manager").await;
    let existing_parent = parent(&suite, "RU").await;
    let source = lead(&suite, json!([])).await;
    sqlx::query("INSERT INTO lead_gwg_declarations(lead_id,birth_place,birth_country,id_document_type,id_document_number,id_issuing_authority,id_issuing_country,id_issued_on) VALUES($1,'Synthetic birthplace','AT','passport','SYNTHETIC-PASSPORT','Synthetic office','AT','2020-01-01')")
        .bind(source)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE patients SET source_lead_id=$2 WHERE id=$1")
        .bind(existing_parent)
        .bind(source)
        .execute(&suite.pool)
        .await
        .unwrap();
    let mother = Uuid::new_v4();
    let child = lead(
        &suite,
        json!([{"id":mother,"related_patient_id":existing_parent,"name":"Local Mother","relation":"mother","birth_date":"1990-05-06","email":"local@example.com","phone":"+491111111111"}]),
    )
    .await;
    sqlx::query("INSERT INTO lead_representatives(lead_id,contact_id,role,contact_origin,first_name,last_name,citizenships,country,street,id_document_number) VALUES($1,$2,'legal_representative','staff','Local','Mother',ARRAY['DE'],'DE','Local street 1','LOCAL-ID')")
        .bind(child)
        .bind(mother)
        .execute(&suite.pool)
        .await
        .unwrap();
    let mut conn = suite.pool.acquire().await.unwrap();
    let identities = lead_guardian_identity::load(&mut conn, child)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(identities.len(), 1);
    let identity = &identities[0];
    assert_eq!(identity.contact_id, Some(mother));
    assert_eq!(identity.related_patient_id, Some(existing_parent));
    assert_eq!(identity.name, "Local Mother");
    assert_eq!(identity.contact["birth_date"], "1990-05-06");
    assert_eq!(identity.contact["email"], "local@example.com");
    assert_eq!(identity.contact["phone"], "+491111111111");
    assert_eq!(identity.citizenships, vec!["DE"]);
    assert_eq!(identity.residences, vec!["DE"]);
    assert_eq!(identity.extras["street"], "Local street 1");
    assert_eq!(identity.extras["city"], "Synthetic city");
    assert_eq!(identity.extras["zip"], "00000");
    assert_eq!(identity.extras["birth_place"], "Synthetic birthplace");
    assert_eq!(identity.extras["birth_country"], "AT");
    assert_eq!(identity.extras["id_document_number"], "LOCAL-ID");
    assert!(identity.extras["id_issuing_authority"].is_null());
    assert!(identity.extras["id_valid_until"].is_null());
    let safe_projection = format!("{} {}", identity.contact, identity.extras);
    assert!(!safe_projection.contains("PRIVATE-CLINICAL-MARKER"));
    assert!(!safe_projection.contains("PRIVATE-CONSENT-MARKER"));
    let body = status(&suite, pm, child).await;
    assert_eq!(body["country"]["blocking"], json!([]));
    let stored: Value = sqlx::query_scalar("SELECT trusted_contacts FROM leads WHERE id=$1")
        .bind(child)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert!(
        stored[0].get("country").is_none(),
        "Loading does not copy canonical values into the child"
    );

    // A partial local name without a display name fills only its missing part.
    sqlx::query("UPDATE leads SET trusted_contacts=$2 WHERE id=$1")
        .bind(child)
        .bind(json!([{"id":mother,"related_patient_id":existing_parent,"relation":"mother"}]))
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE lead_representatives SET last_name=NULL,id_document_number=NULL WHERE lead_id=$1",
    )
    .bind(child)
    .execute(&suite.pool)
    .await
    .unwrap();
    let mut conn = suite.pool.acquire().await.unwrap();
    let identities = lead_guardian_identity::load(&mut conn, child)
        .await
        .unwrap();
    assert_eq!(identities[0].name, "Local Canonical");
    assert_eq!(identities[0].extras["first_name"], "Local");
    assert_eq!(identities[0].extras["last_name"], "Canonical");
    assert_eq!(
        identities[0].extras["id_document_number"],
        "SYNTHETIC-PASSPORT"
    );
    assert_eq!(
        identities[0].extras["id_issuing_authority"],
        "Synthetic office"
    );
    assert_eq!(identities[0].extras["id_valid_until"], "2035-01-01");
}

#[tokio::test]
async fn deleted_missing_unrelated_and_removed_links_do_not_supply_parent_identity() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let pm = user(&suite, "patient_manager").await;
    let deleted = parent(&suite, "RU").await;
    let anonymized = parent(&suite, "RU").await;
    let unrelated = parent(&suite, "RU").await;
    sqlx::query("UPDATE patients SET lifecycle_status='deleted',is_active=false WHERE id=$1")
        .bind(deleted)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE patients SET legal_status=jsonb_build_object('anonymized_at',now()) WHERE id=$1",
    )
    .bind(anonymized)
    .execute(&suite.pool)
    .await
    .unwrap();
    let mother = Uuid::new_v4();
    let father = Uuid::new_v4();
    let guardian = Uuid::new_v4();
    let friend = Uuid::new_v4();
    let child = lead(
        &suite,
        json!([
            {"id":mother,"related_patient_id":deleted,"name":"Local Mother","relation":"mother"},
            {"id":father,"related_patient_id":anonymized,"name":"Local Father","relation":"father"},
            {"id":guardian,"related_patient_id":Uuid::new_v4(),"name":"Local Guardian","relation":"guardian"},
            {"id":friend,"related_patient_id":unrelated,"name":"Anna Canonical","relation":"friend"}
        ]),
    )
    .await;
    let mut conn = suite.pool.acquire().await.unwrap();
    let identities = lead_guardian_identity::load(&mut conn, child)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(identities.len(), 3);
    for identity in identities {
        assert!(identity.citizenships.is_empty());
        assert!(identity.residences.is_empty());
        assert!(identity.contact.get("birth_date").is_none());
        assert!(identity.contact.get("email").is_none());
        assert!(identity.extras.get("id_document_number").is_none());
    }
    let subjects = screening::load_lead_subjects(&suite.pool, child)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(subjects.subjects.len(), 4);
    assert!(
        !subjects
            .subjects
            .iter()
            .any(|subject| subject.subject_ref == friend.to_string())
    );
    assert_eq!(
        status(&suite, pm, child).await["country"]["blocking"],
        json!([])
    );

    // Reusing an e-mail is not an identity link, and a deleted contact's row
    // alone cannot keep that person in the child's screening scope.
    sqlx::query("INSERT INTO lead_representatives(lead_id,contact_id,role,citizenships,country) VALUES($1,$2,'legal_representative',ARRAY['RU'],'RU')")
        .bind(child)
        .bind(mother)
        .execute(&suite.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE leads SET trusted_contacts=$2 WHERE id=$1")
        .bind(child)
        .bind(json!([{"name":"Raw Unlinked","relation":"father","email":"canonical@example.com","citizenships":["DE"],"country":"AT"}]))
        .execute(&suite.pool)
        .await
        .unwrap();
    let subjects = screening::load_lead_subjects(&suite.pool, child)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(subjects.subjects.len(), 2);
    assert_eq!(subjects.subjects[1].subject_ref, "contact-0");
    assert_eq!(subjects.subjects[1].subject.citizenships, vec!["DE"]);
    assert_eq!(subjects.subjects[1].residence, vec!["AT"]);
    assert!(subjects.subjects[1].subject.date_of_birth.is_none());
    assert_eq!(
        status(&suite, pm, child).await["country"]["blocking"],
        json!([])
    );
}

#[tokio::test]
async fn a_linked_parent_list_match_keeps_its_contact_reference_and_confirmed_decision() {
    let Some(suite) = support::suite_context(TEST_SECRET).await else {
        return;
    };
    let ceo = user(&suite, "ceo").await;
    let pm = user(&suite, "patient_manager").await;
    let existing_parent = parent(&suite, "RU").await;
    sqlx::query("UPDATE patients SET first_name='Testomir',last_name='Korneev',birth_date='1961-03-14' WHERE id=$1")
        .bind(existing_parent)
        .execute(&suite.pool)
        .await
        .unwrap();
    let contact_id = Uuid::new_v4();
    let child = lead(
        &suite,
        json!([{"id":contact_id,"related_patient_id":existing_parent,"relation":"father"}]),
    )
    .await;
    let boundary = format!("----identity-{}", Uuid::new_v4().simple());
    let xml = include_str!("../src/sanctions/testdata/synthetic_fsf_1_1.xml");
    let token = jwt::issue_access_token(TEST_SECRET, ceo, "ceo", Uuid::new_v4()).unwrap();
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/sanctions/list/upload")
        .header("Authorization", format!("Bearer {token}"))
        .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
        .body(Body::from(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"synthetic.xml\"\r\nContent-Type: application/xml\r\n\r\n{xml}\r\n--{boundary}--\r\n")))
        .unwrap();
    let response = suite.app.clone().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = status(&suite, pm, child).await;
    assert_eq!(body["screening"], "review_pending");
    assert_eq!(body["open_hits"], 1);
    assert_eq!(body["confirmed_hits"], 0);
    let (hit_id, subject_ref, snapshot): (Uuid, String, Value) = sqlx::query_as(
        "SELECT id,subject_ref,subject_snapshot FROM sanctions_hits WHERE lead_id=$1 AND subject_kind='lead_guardian'",
    )
    .bind(child)
    .fetch_one(&suite.pool)
    .await
    .unwrap();
    assert_eq!(subject_ref, contact_id.to_string());
    assert_eq!(snapshot["date_of_birth"], "1961-03-14");
    assert_eq!(snapshot["citizenships"], json!(["RU"]));
    let (code, body) = request(
        &suite,
        ceo,
        "ceo",
        "POST",
        &format!("/sanctions/hits/{hit_id}/decision"),
        Some(json!({"decision":"confirmed","reason":"Synthetic fixture identity verified"})),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    sqlx::query("UPDATE patients SET first_name='Another',last_name='Canonical',citizenships=ARRAY['DE'],residence_country='DE',address_country='DE' WHERE id=$1")
        .bind(existing_parent)
        .execute(&suite.pool)
        .await
        .unwrap();
    let body = status(&suite, pm, child).await;
    assert_eq!(body["country"]["blocking"], json!([]));
    assert_eq!(body["screening"], "confirmed");
    assert_eq!(body["confirmed_hits"], 1);
    assert_eq!(body["open_hits"], 0);
    let hit_status: String = sqlx::query_scalar("SELECT status FROM sanctions_hits WHERE id=$1")
        .bind(hit_id)
        .fetch_one(&suite.pool)
        .await
        .unwrap();
    assert_eq!(hit_status, "confirmed");
}
