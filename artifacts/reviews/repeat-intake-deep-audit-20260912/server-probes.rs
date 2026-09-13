// Append these diagnostic probes to a copy of crates/server/tests/leads_api.rs; run only deep_audit tests against a disposable DB.

async fn audit_patient(app: &TestApp) -> Uuid {
    sqlx::query_scalar("INSERT INTO patients(patient_id,first_name,last_name,birth_date,gender,lifecycle_status,created_by) VALUES($1,'Audit','Repeat',DATE '1982-04-03','female','active',$2) RETURNING id")
        .bind(format!("P-AUDIT-{}",Uuid::new_v4())).bind(app.ceo_id).fetch_one(&app.suite.pool).await.unwrap()
}
async fn audit_lead(app: &TestApp) -> Uuid {
    let (s,b)=json_request(app,"POST","/api/v1/leads",&app.auth_header("patient_manager"),Some(json!({"first_name":"Audit","last_name":"Repeat","email":"synthetic-audit@example.com"}))).await;
    assert_eq!(s,StatusCode::CREATED,"{b}");
    let id=Uuid::parse_str(b["id"].as_str().unwrap()).unwrap();
    // Same master fields supplied by the wizard's next /update request.
    sqlx::query("UPDATE leads SET date_of_birth=DATE '1982-04-03',legal_sex='female',intake_model='patient_first' WHERE id=$1").bind(id).execute(&app.suite.pool).await.unwrap();
    id
}
async fn audit_attach(app: &TestApp, lead:Uuid, patient:Uuid) -> Value {
    let (s,b)=json_request(app,"POST",&format!("/api/v1/leads/{lead}/prospect"),&app.auth_header("patient_manager"),Some(json!({"attach_patient_id":patient}))).await;
    assert_eq!(s,StatusCode::OK,"{b}"); b
}
async fn audit_order(app: &TestApp, lead:Uuid) -> Uuid {
    let (s,b)=json_request(app,"POST","/api/v1/orders",&app.auth_header("patient_manager"),Some(json!({"source_lead_id":lead}))).await;
    assert!(s.is_success(),"{s}: {b}"); Uuid::parse_str(b["id"].as_str().unwrap()).unwrap()
}
#[tokio::test]
async fn deep_audit_repeat_bootstrap_duplicate_and_archive() {
    let app=test_app().await.expect("disposable DB required");
    let pool=&app.suite.pool; let pm=app.auth_header("patient_manager");
    let patient=audit_patient(&app).await;
    let first=audit_lead(&app).await; let second=audit_lead(&app).await;
    assert_ne!(first,second,"Identical first-save requests insert distinct leads");
    let a=audit_attach(&app,first,patient).await;
    let replay=audit_attach(&app,first,patient).await;
    assert_eq!(a["case_id"],replay["case_id"]);
    let b=audit_attach(&app,second,patient).await; assert_ne!(a["case_id"],b["case_id"]);
    let order=audit_order(&app,first).await;
    assert_eq!(order,audit_order(&app,first).await);
    assert_ne!(order,audit_order(&app,second).await);
    let rows:Vec<(String,String,Option<Uuid>)>=sqlx::query_as("SELECT intake_state,status,patient_id FROM orders WHERE source_lead_id=ANY($1)").bind(vec![first,second]).fetch_all(pool).await.unwrap();
    assert_eq!(rows.len(),2);
    for row in rows { assert_eq!(row,("legacy".into(),"active".into(),None)); }
    let (s,listed)=json_request(&app,"GET",&format!("/api/v1/patients/{patient}/orders"),&pm,None).await;
    assert_eq!(s,StatusCode::OK,"{listed}"); assert_eq!(listed.as_array().unwrap().len(),0);
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM order_payment_tracking WHERE order_id=$1").bind(order).fetch_one(pool).await.unwrap(); assert_eq!(count,1);
    let planning:i64=sqlx::query_scalar("SELECT count(*) FROM order_planning_preparation WHERE order_id=$1").bind(order).fetch_one(pool).await.unwrap(); assert_eq!(planning,1);
    let (s,archived)=json_request(&app,"POST",&format!("/api/v1/leads/{first}/failed-flow"),&pm,Some(json!({"resolution":"archive","reason":"not_our_lead"}))).await;
    assert_eq!(s,StatusCode::OK,"{archived}");
    let state:(String,String)=sqlx::query_as("SELECT status,intake_state FROM orders WHERE id=$1").bind(order).fetch_one(pool).await.unwrap();
    assert_eq!(state,("active".into(),"legacy".into()));
    println!("AUDIT CONFIRMED: identical create requests -> 2 leads / 2 cases / 2 active legacy orders; 0 orders visible in patient; payment-tracking and planning exist before completion; archive keeps order active");
}
#[tokio::test]
async fn deep_audit_clinical_merge_retry_and_delete() {
    let app=test_app().await.expect("disposable DB required"); let pool=&app.suite.pool;
    let patient=audit_patient(&app).await; let ceo=app.auth_header("ceo");
    let path=format!("/api/v1/patients/{patient}/clinical-warnings?mode=merge");
    let body=json!({"kind":"allergie","items":[{"label":"Synthetic allergy","reaction":"Synthetic reaction"}]});
    for _ in 0..2 { let (s,b)=json_request(&app,"POST",&path,&ceo,Some(body.clone())).await; assert_eq!(s,StatusCode::OK,"{b}"); }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM patient_clinical_warnings WHERE patient_id=$1").bind(patient).fetch_one(pool).await.unwrap(); assert_eq!(count,2);
    let (s,b)=json_request(&app,"POST",&path,&ceo,Some(json!({"kind":"allergie","items":[]}))).await; assert_eq!(s,StatusCode::OK,"{b}");
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM patient_clinical_warnings WHERE patient_id=$1").bind(patient).fetch_one(pool).await.unwrap(); assert_eq!(count,2);
    let path=format!("/api/v1/patients/{patient}/diagnoses?mode=merge");
    for _ in 0..2 { let (s,b)=json_request(&app,"POST",&path,&ceo,Some(json!({"items":[{"kind":"main","label":"Synthetic diagnosis"}]}))).await; assert_eq!(s,StatusCode::OK,"{b}"); }
    let count:i64=sqlx::query_scalar("SELECT count(*) FROM patient_diagnoses WHERE patient_id=$1").bind(patient).fetch_one(pool).await.unwrap(); assert_eq!(count,2);
    println!("AUDIT CONFIRMED: same new warning/diagnosis merge payload saved twice creates two records; merge with empty items does not delete existing entries");
}
#[tokio::test]
async fn deep_audit_unassigned_patient_attach_grants_access() {
    let app=test_app().await.expect("disposable DB required"); let pm=app.auth_header("patient_manager");
    let patient=audit_patient(&app).await;
    let (before,_)=json_request(&app,"GET",&format!("/api/v1/patients/{patient}"),&pm,None).await;
    assert_eq!(before,StatusCode::FORBIDDEN);
    let lead=audit_lead(&app).await; audit_attach(&app,lead,patient).await;
    let (after,b)=json_request(&app,"GET",&format!("/api/v1/patients/{patient}"),&pm,None).await;
    assert_eq!(after,StatusCode::OK,"{b}");
    println!("AUDIT CONFIRMED: unassigned PM denied patient GET, then explicit attach assigns self and GET succeeds");
}
#[tokio::test]
async fn deep_audit_changed_period_keeps_old_document_readiness() {
    let Some(app) = test_app().await else {
        return;
    };
    let pool = &app.suite.pool;
    let tag = Uuid::new_v4().simple().to_string();
    let existing_email = format!("existing-{tag}@example.com");
    let incoming_email = format!("incoming-{tag}@example.com");
    let patient_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender,
                email, notes, lifecycle_status, is_active, created_by, languages
           ) VALUES (
                $1, 'Returning', 'Patient', DATE '1982-04-03', 'female',
                $2, 'Existing longitudinal note', 'active', true, $3, ARRAY['de']::text[]
           ) RETURNING id"#,
    )
    .bind(format!("P-RETURNING-{tag}"))
    .bind(&existing_email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let lead_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO leads (
                first_name, last_name, email, phone, country, primary_language,
                date_of_birth, legal_sex, street_address, city, zip_code,
                primary_concern_text, requested_specialties,
                qualification_status, compliance_status,
                consent_healthcare, consent_privacy_practices,
                intake_source, intake_model, created_by
           ) VALUES (
                'Returning', 'Patient', $1, '+4915776543210', 'DE', 'de',
                DATE '1982-04-03', 'female', 'Neue Str. 2', 'Berlin', '10115',
                'New episode concern', '["orthopedics"]'::jsonb,
                'qualified', 'signed', true, true,
                'staff_wizard', 'patient_first', $2
           ) RETURNING id"#,
    )
    .bind(&incoming_email)
    .bind(app.patient_manager_id)
    .fetch_one(pool)
    .await
    .unwrap();
    let pm = app.auth_header("patient_manager");

    let (status, duplicate_response) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({ "hauptanfragegrund": "New episode concern" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{duplicate_response}");
    let candidates = duplicate_response["duplicate_candidates"]
        .as_array()
        .unwrap();
    assert!(
        candidates
            .iter()
            .any(|candidate| candidate["id"] == patient_id.to_string())
    );
    let patient_count_before: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patients WHERE first_name = 'Returning' AND last_name = 'Patient'",
    )
    .fetch_one(pool)
    .await
    .unwrap();

    let (status, attached) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/prospect"),
        &pm,
        Some(json!({
            "attach_patient_id": patient_id,
            "hauptanfragegrund": "New episode concern"
        })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{attached}");
    assert_eq!(attached["patient_id"], patient_id.to_string());
    assert_eq!(attached["attached"], true);
    assert_eq!(attached["lifecycle_status"], "active");
    let case_id = Uuid::parse_str(attached["case_id"].as_str().unwrap()).unwrap();

    let replay_body = json!({ "attach_patient_id": patient_id });
    let replay_path = format!("/api/v1/leads/{lead_id}/prospect");
    let (first_replay, second_replay) = tokio::join!(
        json_request(&app, "POST", &replay_path, &pm, Some(replay_body.clone())),
        json_request(&app, "POST", &replay_path, &pm, Some(replay_body)),
    );
    for (status, replay) in [first_replay, second_replay] {
        assert_eq!(status, StatusCode::OK, "{replay}");
        assert_eq!(replay["patient_id"], patient_id.to_string());
        assert_eq!(replay["case_id"], case_id.to_string());
    }
    let case_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM cases WHERE source_lead_id = $1")
            .bind(lead_id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(case_count, 1, "repeated attachment must reuse the episode");

    let artifacts = seed_complete_lead_onboarding(&app, lead_id).await;
    assert_eq!(artifacts.case_id, case_id);
    // Reuse previous patient confirmations and the signed framework for the whole new visit.
    sqlx::query("UPDATE patients SET legal_status = $2 WHERE id = $1")
        .bind(patient_id)
        .bind(json!({"identity_verified": true, "dsgvo_signed": true,
            "confidentiality_release_signed": true, "compliance_completed": true}))
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE documents SET patient_id = $2, lead_id = NULL WHERE lead_id = $1 AND compliance_kind IN ('identity', 'dsgvo', 'confidentiality_release')")
        .bind(lead_id).bind(patient_id).execute(pool).await.unwrap();
    sqlx::query("UPDATE framework_contracts SET patient_id = $2, lead_id = NULL, valid_from = DATE '2030-01-01', valid_to = DATE '2030-12-31' WHERE id = $1")
        .bind(artifacts.contract_id).bind(patient_id).execute(pool).await.unwrap();
    let contract_path = format!("/api/v1/orders/{}/commercial-basis", artifacts.order_id);
    let (status, response) = json_request(&app, "POST", &contract_path, &pm,
        Some(json!({"contract_id": artifacts.contract_id, "date_from": "2030-09-01", "date_to": "2030-09-15"}))).await;
    assert_eq!(status, StatusCode::OK, "{response}");
    let other_patient: Uuid = sqlx::query_scalar("INSERT INTO patients (patient_id, first_name, last_name, birth_date, gender, lifecycle_status, created_by) VALUES ($1, 'Other', 'Patient', DATE '1985-01-01', 'female', 'active', $2) RETURNING id")
        .bind(format!("P-OTHER-{tag}")).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
    let other_contract: Uuid = sqlx::query_scalar("INSERT INTO framework_contracts (patient_id, contract_number, signed_at, status, created_by) VALUES ($1, $2, now(), 'signed', $3) RETURNING id")
        .bind(other_patient).bind(format!("FC-OTHER-{tag}")).bind(app.patient_manager_id).fetch_one(pool).await.unwrap();
    let (status, response) = json_request(
        &app,
        "POST",
        &contract_path,
        &pm,
        Some(json!({"contract_id": other_contract})),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{response}");
    // Expiry during the visit fails even if the stored status still says signed.
    for (contract_status, end) in [("signed", "2030-09-14"), ("expired", "2030-12-31")] {
        sqlx::query(
            "UPDATE framework_contracts SET status = $2, valid_to = $3::text::date WHERE id = $1",
        )
        .bind(artifacts.contract_id)
        .bind(contract_status)
        .bind(end)
        .execute(pool)
        .await
        .unwrap();
        let (status, checked) =
            json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
        assert_eq!(status, StatusCode::OK, "{checked}");
        assert_eq!(checked["readiness"]["conversion_ready"], false, "{checked}");
        let contract_check = checked["readiness"]["checks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|check| check["key"] == "contract_signed")
            .unwrap();
        assert_eq!(contract_check["passed"], false, "{contract_check}");
    }
    sqlx::query("UPDATE framework_contracts SET status = 'signed', valid_to = DATE '2030-12-31' WHERE id = $1")
        .bind(artifacts.contract_id).execute(pool).await.unwrap();

    let (status, lead) =
        json_request(&app, "GET", &format!("/api/v1/leads/{lead_id}"), &pm, None).await;
    assert_eq!(status, StatusCode::OK, "{lead}");
    assert_eq!(lead["readiness"]["conversion_ready"], true, "{lead}");


    let (s,b)=json_request(&app,"POST",&contract_path,&pm,Some(json!({"date_from":"2030-10-01","date_to":"2030-10-15"}))).await;
    assert_eq!(s,StatusCode::OK,"{b}");
    let (s,b)=json_request(&app,"GET",&format!("/api/v1/leads/{lead_id}"),&pm,None).await;
    assert_eq!(s,StatusCode::OK,"{b}");
    assert_eq!(b["readiness"]["conversion_ready"],true,"{b}");
    println!("AUDIT CONFIRMED: program period changed after prepared/signed commercial data; old order document and estimate still satisfy readiness");
    let (status, converted) = json_request(
        &app,
        "POST",
        &format!("/api/v1/leads/{lead_id}/wizard-convert"),
        &pm,
        Some(json!({ "confirmed": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{converted}");
    assert_eq!(converted["patient_id"], patient_id.to_string());

    let preserved: (Option<String>, Option<String>, Option<Uuid>, String, bool) = sqlx::query_as(
        r#"SELECT email, notes, source_lead_id, lifecycle_status, is_active
           FROM patients WHERE id = $1"#,
    )
    .bind(patient_id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(preserved.0.as_deref(), Some(existing_email.as_str()));
    assert_eq!(preserved.1.as_deref(), Some("Existing longitudinal note"));
    assert_eq!(preserved.2, None);
    assert_eq!(preserved.3, "active");
    assert!(preserved.4);
    let patient_count_after: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM patients WHERE first_name = 'Returning' AND last_name = 'Patient'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(patient_count_after, patient_count_before);
}
