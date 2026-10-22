//! PostgreSQL regression coverage, called by the isolated signature suite.
use super::*;

pub(super) async fn verify_initial_manifest_and_paper_opt_in(
    pool: &gmed_db::DbPool,
    auth: &AuthUser,
    endpoint: &str,
    created_keys: &mut Vec<String>,
) {
    use printpdf::{Mm, PdfDocument, PdfPage, PdfSaveOptions};
    let state = AppState::new(
        pool.clone(),
        "test",
        crate::settings::SettingsCache::new(crate::settings::TokenSettings::default()),
    )
    .with_document_signatures(Some(
        tests::provider(false).with_test_endpoint(endpoint.to_string()),
    ));
    let mut pdf = PdfDocument::new("Synthetic paper scan");
    pdf.with_pages(vec![PdfPage::new(Mm(210.0), Mm(297.0), vec![])]);
    let bytes = pdf.save(&PdfSaveOptions::default(), &mut Vec::new());
    let (_, key, _) = documents::store_document_blob(&bytes, "scan.pdf")
        .await
        .unwrap();
    created_keys.push(key.clone());
    let lead = Uuid::new_v4();
    sqlx::query("INSERT INTO leads(id,first_name,last_name,date_of_birth,created_by) VALUES($1,'Test','Manifest','1990-01-01',$2)")
        .bind(lead).bind(auth.user_id).execute(pool).await.unwrap();
    let templates = [
        "framework_contract",
        "single_order",
        "order_cost_estimate",
        "lead_self_disclosure",
        "confidentiality_release",
        "privacy_consents",
    ];
    let mut ids = Vec::new();
    let original_date = Utc::now() - chrono::Duration::days(3);
    for template in templates {
        let id = Uuid::new_v4();
        ids.push(id);
        sqlx::query("INSERT INTO documents(id,lead_id,auto_name,art,generated_template_id,mime_type,storage_key,file_size,version_root_document_id,uploaded_by,ursprung,signed_at,signed_by)
            VALUES($1,$2,'Synthetic manifest scan','other',$3,'application/pdf',$4,$5,$1,$6,'paper_signature',$7,$6)")
            .bind(id).bind(lead).bind(template).bind(&key).bind(bytes.len() as i64).bind(auth.user_id).bind(original_date)
            .execute(pool).await.unwrap();
    }
    let source = signature_document_access(&state, auth, ids[0], true)
        .await
        .unwrap();
    let manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manifest.expected_count, 6);
    assert!(
        manifest
            .items
            .iter()
            .all(|item| item.state == "signed" && item.paper_signed)
    );
    assert!(onboarding::validate(Some(&manifest), &[]).is_ok());
    sqlx::query("UPDATE documents SET mime_type='image/png' WHERE id=$1")
        .bind(ids[5])
        .execute(pool)
        .await
        .unwrap();
    let image_manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        image_manifest.items[5].state, "signed",
        "A signed paper image is valid existing proof"
    );
    assert!(onboarding::validate(Some(&image_manifest), &[]).is_ok());
    assert!(
        package::preset_document_ids(&state, auth, &source)
            .await
            .unwrap()
            .is_empty()
    );
    // A new unsigned form supersedes the old signed evidence. No fallback to v1.
    let newer = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,lead_id,auto_name,art,generated_template_id,mime_type,storage_key,version_root_document_id,replaces_document_id,version_number,uploaded_by)
        VALUES($1,$2,'New form','other','lead_self_disclosure','application/pdf',$3,$4,$4,2,$5)")
        .bind(newer).bind(lead).bind(&key).bind(ids[3]).bind(auth.user_id).execute(pool).await.unwrap();
    let manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    let form = manifest
        .items
        .iter()
        .find(|item| item.template == "lead_self_disclosure")
        .unwrap();
    assert_eq!(form.document_id, Some(newer));
    assert_eq!(form.state, "ready");
    assert!(onboarding::validate(Some(&manifest), &[]).is_err());
    assert!(onboarding::validate(Some(&manifest), &[newer]).is_ok());
    sqlx::query("UPDATE documents SET file_deleted_at=now() WHERE id=$1")
        .bind(newer)
        .execute(pool)
        .await
        .unwrap();
    let manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manifest.items[3].state, "blocked");
    assert!(onboarding::validate(Some(&manifest), &[newer]).is_err());
    // The public send endpoint must reject the incomplete initial packet.
    let plan = |docs: Vec<Uuid>, paper: Vec<Uuid>| create::Plan {
        document_ids: docs,
        paper_signed_document_ids: paper,
        signers: tests::signers(),
        attachment_ids: vec![],
        level: None,
        expires_at: None,
        note: None,
        language: Some("de".into()),
    };
    let response = create::create_request(&state, auth, plan(vec![ids[0]], vec![ids[0]]))
        .await
        .unwrap_err();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body = axum::body::to_bytes(response.into_body(), 100000)
        .await
        .unwrap();
    assert!(String::from_utf8_lossy(&body).contains("onboarding_package_incomplete"));
    sqlx::query("UPDATE leads SET date_of_birth='2015-01-01' WHERE id=$1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    let manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manifest.expected_count, 5);
    assert_eq!(manifest.items[4].template, "consent_data_release_child");
    assert_eq!(manifest.items[4].state, "missing");
    sqlx::query("INSERT INTO lead_gwg_declarations(lead_id,custody) VALUES($1,'sole_parent') ON CONFLICT(lead_id) DO UPDATE SET custody='sole_parent'")
        .bind(lead).execute(pool).await.unwrap();
    let manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(manifest.items[4].template, "consent_data_release_single");
    // Only an effective signed framework contract exempts a repeat lead.
    let patient: Uuid = sqlx::query_scalar("SELECT id FROM patients ORDER BY id LIMIT 1")
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE leads SET repeat_patient_id=$2 WHERE id=$1")
        .bind(lead)
        .bind(patient)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query("UPDATE framework_contracts SET valid_to=CURRENT_DATE-1 WHERE patient_id=$1")
        .bind(patient)
        .execute(pool)
        .await
        .unwrap();
    let repeat_manifest = onboarding::manifest(&state, auth, &source)
        .await
        .unwrap()
        .unwrap();
    // A repeat order may go without the patient form (owner decision
    // 2026-10-23); the minor's consent stays the last expected slot.
    assert!(
        repeat_manifest
            .items
            .iter()
            .all(|item| item.template != "lead_self_disclosure")
    );
    assert_eq!(repeat_manifest.expected_count, 4);
    assert_eq!(
        repeat_manifest.items[3].template,
        "consent_data_release_single"
    );
    let contract = Uuid::new_v4();
    sqlx::query("INSERT INTO framework_contracts(id,patient_id,contract_number,signed_at,valid_from,status,created_by)
        VALUES($1,$2,$3,now(),$4,'signed',$5)")
        .bind(contract).bind(patient).bind(format!("TEST-{}",contract)).bind(crate::app_time::today()).bind(auth.user_id)
        .execute(pool).await.unwrap();
    assert!(
        onboarding::manifest(&state, auth, &source)
            .await
            .unwrap()
            .is_none()
    );
    sqlx::query("UPDATE framework_contracts SET valid_to=$2 WHERE id=$1")
        .bind(contract)
        .bind(crate::app_time::today() - chrono::Duration::days(1))
        .execute(pool)
        .await
        .unwrap();
    assert!(
        onboarding::manifest(&state, auth, &source)
            .await
            .unwrap()
            .is_some()
    );
    // Finish the separate minor/repeat scenario before using this patient's
    // unrelated free PDFs (the minor's missing representatives must still block
    // contractual invitations while that lead is associated with the patient).
    sqlx::query("UPDATE leads SET repeat_patient_id=NULL,date_of_birth='1990-01-01' WHERE id=$1")
        .bind(lead)
        .execute(pool)
        .await
        .unwrap();
    // Generic paper PDFs exercise real server opt-in and durable outbox guards.
    let mut paper = Vec::new();
    for _ in 0..2 {
        let id = Uuid::new_v4();
        paper.push(id);
        sqlx::query("INSERT INTO documents(id,patient_id,auto_name,art,mime_type,storage_key,file_size,version_root_document_id,uploaded_by,ursprung,signed_at,signed_by)
            VALUES($1,$2,'Synthetic paper PDF','other','application/pdf',$3,$4,$1,$5,'paper_signature',$6,$5)")
            .bind(id).bind(patient).bind(&key).bind(bytes.len() as i64).bind(auth.user_id).bind(original_date).execute(pool).await.unwrap();
    }
    let response = create::create_request(&state, auth, plan(paper.clone(), vec![]))
        .await
        .unwrap_err();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert!(
        create::create_request(&state, auth, plan(paper.clone(), vec![Uuid::new_v4()]))
            .await
            .is_err()
    );
    assert!(
        create::create_request(&state, auth, plan(paper.clone(), vec![paper[0], paper[0]]))
            .await
            .is_err()
    );
    assert!(
        create::create_request(&state, auth, plan(paper.clone(), vec![paper[0]]))
            .await
            .is_err(),
        "Every selected paper PDF needs opt-in"
    );
    let single = create::create_request(&state, auth, plan(vec![paper[0]], vec![paper[0]]))
        .await
        .unwrap();
    tests::wait_for_status(pool, single, "pending").await;
    sqlx::query("UPDATE document_signature_requests SET status='withdrawn' WHERE id=$1")
        .bind(single)
        .execute(pool)
        .await
        .unwrap();
    let request_id = create::create_request(&state, auth, plan(paper.clone(), paper.clone()))
        .await
        .unwrap();
    tests::wait_for_status(pool, request_id, "pending").await;
    let request = sqlx::query("SELECT * FROM document_signature_requests WHERE id=$1")
        .bind(request_id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(paper_resigning_ids(&request), {
        let mut ids = paper.clone();
        ids.sort();
        ids
    });
    assert!(
        create::create_request(&state, auth, plan(paper.clone(), paper.clone()))
            .await
            .is_err(),
        "Active requests cannot be duplicated"
    );
    let original = signature_document_access(&state, auth, paper[0], true)
        .await
        .unwrap();
    assert!(
        request.get::<Value, _>("source_context")["paper_signature_proof"]["signed_at"].is_string()
    );
    assert!(
        package::signing_sources_current(&state, &request, &original)
            .await
            .unwrap()
    );
    let entries = bundle_entries(pool, &request).await.unwrap();
    let result = Uuid::new_v4();
    sqlx::query("INSERT INTO documents(id,patient_id,auto_name,art,mime_type,storage_key,version_root_document_id,uploaded_by)
        VALUES($1,$2,'Synthetic QES result','other','application/pdf',$3,$1,$4)")
        .bind(result).bind(patient).bind(&key).bind(auth.user_id).execute(pool).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    effects::apply(
        &mut tx,
        &request,
        &entries,
        result,
        Utc::now(),
        &json!({"signatures":[
        {"role":"client","status":"SIGNED"},{"role":"agency","status":"SIGNED"}]}),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    for id in paper {
        let doc = signature_document_access(&state, auth, id, true)
            .await
            .unwrap();
        assert_eq!(doc.get::<String, _>("ursprung"), "paper_signature");
        assert_eq!(doc.get::<Option<Uuid>, _>("signed_by"), Some(auth.user_id));
        assert_eq!(
            doc.get::<Option<DateTime<Utc>>, _>("signed_at")
                .unwrap()
                .timestamp_micros(),
            original_date.timestamp_micros()
        );
        assert_eq!(source_bytes(&doc).await.unwrap(), bytes);
    }
    // This fixture exercised business effects directly, not provider archival.
    // Release its mock outbox before the following connection-rotation tests.
    sqlx::query("UPDATE document_signature_requests SET status='withdrawn',result_document_id=$2 WHERE id=$1")
        .bind(request_id).bind(result).execute(pool).await.unwrap();
}
