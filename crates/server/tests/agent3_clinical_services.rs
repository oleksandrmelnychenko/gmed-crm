mod support;

use sqlx::{PgPool, Row};
use uuid::Uuid;

use gmed_server::services::drug_matching::{load_german_equivalents, search_drug_products};
use gmed_server::services::interpreter_suggestions::load_appointment_interpreter_suggestions;
use gmed_server::services::order_service_groups::generate_order_service_group_lines;

const TEST_SECRET: &str = "test-secret-at-least-32-characters-long!!";

async fn test_context() -> Option<support::TestSuiteContext> {
    support::suite_context(TEST_SECRET).await
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

async fn seed_patient(pool: &PgPool, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO patients (
                patient_id, first_name, last_name, birth_date, gender, created_by, languages
           ) VALUES (
                $1, $2, $3, '1990-01-01', 'diverse', $4, ARRAY['uk','de']::text[]
           ) RETURNING id"#,
    )
    .bind(format!("PT-{tag}"))
    .bind(format!("First {tag}"))
    .bind(format!("Last {tag}"))
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_provider(pool: &PgPool, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO providers (name, provider_type, address_city, fachbereich, address_country)
           VALUES ($1, 'medical', $2, 'Cardiology', 'Germany')
           RETURNING id"#,
    )
    .bind(format!("Clinic {tag}"))
    .bind(format!("City {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_doctor(pool: &PgPool, provider_id: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO provider_doctors (provider_id, name, fachbereich)
           VALUES ($1, $2, 'Cardiology')
           RETURNING id"#,
    )
    .bind(provider_id)
    .bind(format!("Dr {tag}"))
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn seed_order(pool: &PgPool, patient_id: Uuid, created_by: Uuid, tag: &str) -> Uuid {
    sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, patient_id, phase, status, needs_description, created_by
           ) VALUES (
                $1, $2, 'execution', 'active', 'Agent 3 service group order', $3
           ) RETURNING id"#,
    )
    .bind(format!("O-{tag}"))
    .bind(patient_id)
    .bind(created_by)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn interpreter_suggestions_prefer_history_and_exclude_avoid_without_language_blocking() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let pool = ctx.pool.clone();
    let admin_id = ctx.admin_id;

    let tag = unique_tag("agent3-interpreter-suggestions");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let preferred_interpreter_id =
        seed_user(&pool, &format!("{tag}-preferred"), "interpreter").await;
    let avoid_interpreter_id = seed_user(&pool, &format!("{tag}-avoid"), "interpreter").await;
    let neutral_interpreter_id = seed_user(&pool, &format!("{tag}-neutral"), "interpreter").await;

    let previous_appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, interpreter_id, appointment_type, title, date, time_start,
                time_end, status, created_by
           ) VALUES (
                $1, $2, 'medical', 'Prior interpreted visit', '2026-04-10',
                '09:00', '10:30', 'completed', $3
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(preferred_interpreter_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO interpreter_reports (
                appointment_id, interpreter_id, hours, report_text, approval_status, approved_by, approved_at
           ) VALUES ($1, $2, 1.5, 'Good rapport', 'approved', $3, now())"#,
    )
    .bind(previous_appointment_id)
    .bind(preferred_interpreter_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                patient_id, appointment_id, interpreter_id, submitted_by, source,
                overall_score, interpreter_score, nps_score, comments
           ) VALUES ($1, $2, $3, $4, 'staff_capture', 5, 5, 10, 'High feedback')"#,
    )
    .bind(patient_id)
    .bind(previous_appointment_id)
    .bind(preferred_interpreter_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO interpreter_patient_preferences (
                patient_id, interpreter_id, preference, updated_by
           ) VALUES ($1, $2, 'preferred', $4), ($1, $3, 'avoid', $4)"#,
    )
    .bind(patient_id)
    .bind(preferred_interpreter_id)
    .bind(avoid_interpreter_id)
    .bind(admin_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO interpreter_languages (interpreter_id, language_code, proficiency)
           VALUES ($1, 'uk', 'fluent')"#,
    )
    .bind(neutral_interpreter_id)
    .execute(&pool)
    .await
    .unwrap();

    let target_appointment_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO appointments (
                patient_id, appointment_type, title, date, time_start, time_end, status, created_by
           ) VALUES (
                $1, 'medical', 'Target visit', '2026-05-10', '09:00', '10:00', 'planned', $2
           ) RETURNING id"#,
    )
    .bind(patient_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    let suggestions = load_appointment_interpreter_suggestions(&pool, target_appointment_id)
        .await
        .unwrap();

    assert!(!suggestions.is_empty());
    assert_eq!(suggestions[0].interpreter_id, preferred_interpreter_id);
    assert_eq!(suggestions[0].preference, "preferred");
    assert!(
        suggestions[0]
            .reasons
            .iter()
            .any(|reason| reason.contains("worked before"))
    );
    assert!(
        suggestions[0]
            .reasons
            .iter()
            .any(|reason| reason == "high feedback")
    );
    assert_eq!(suggestions[0].language_status, "language unknown");
    assert!(
        !suggestions
            .iter()
            .any(|item| item.interpreter_id == avoid_interpreter_id)
    );
}

#[tokio::test]
async fn service_group_generates_one_line_per_doctor_without_medical_appointment_source() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let pool = ctx.pool.clone();
    let admin_id = ctx.admin_id;

    let tag = unique_tag("agent3-service-group");
    let patient_id = seed_patient(&pool, admin_id, &tag).await;
    let order_id = seed_order(&pool, patient_id, admin_id, &tag).await;
    let provider_id = seed_provider(&pool, &tag).await;
    let doctor_ids = vec![
        seed_doctor(&pool, provider_id, &format!("{tag}-1")).await,
        seed_doctor(&pool, provider_id, &format!("{tag}-2")).await,
        seed_doctor(&pool, provider_id, &format!("{tag}-3")).await,
    ];

    let service_group_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO order_service_groups (
                order_id, group_title, description, quantity, unit_price, vat_rate,
                currency, status, created_by
           ) VALUES (
                $1, 'Cardiology board', 'Split by doctors', 1, 120, 19, 'EUR', 'ready', $2
           ) RETURNING id"#,
    )
    .bind(order_id)
    .bind(admin_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    for doctor_id in doctor_ids {
        sqlx::query(
            r#"INSERT INTO order_service_group_participants (
                    service_group_id, provider_id, doctor_id
               ) VALUES ($1, $2, $3)"#,
        )
        .bind(service_group_id)
        .bind(provider_id)
        .bind(doctor_id)
        .execute(&pool)
        .await
        .unwrap();
    }

    let first_summary = generate_order_service_group_lines(&pool, service_group_id, false)
        .await
        .unwrap();
    assert_eq!(first_summary.generated_count, 3);
    assert_eq!(first_summary.updated_count, 0);
    assert_eq!(first_summary.skipped_duplicate_count, 0);

    let line_row = sqlx::query(
        r#"SELECT COUNT(*)::bigint AS line_count,
                  COUNT(DISTINCT source_service_group_participant_id)::bigint AS participant_source_count,
                  COUNT(*) FILTER (WHERE source_medical_appointment_id IS NULL)::bigint AS null_appointment_source_count
           FROM order_leistungen
           WHERE order_id = $1
             AND source_service_group_id = $2"#,
    )
    .bind(order_id)
    .bind(service_group_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(line_row.try_get::<i64, _>("line_count").unwrap(), 3);
    assert_eq!(
        line_row
            .try_get::<i64, _>("participant_source_count")
            .unwrap(),
        3
    );
    assert_eq!(
        line_row
            .try_get::<i64, _>("null_appointment_source_count")
            .unwrap(),
        3
    );

    let second_summary = generate_order_service_group_lines(&pool, service_group_id, false)
        .await
        .unwrap();
    assert_eq!(second_summary.generated_count, 0);
    assert_eq!(second_summary.updated_count, 0);
    assert_eq!(second_summary.skipped_duplicate_count, 3);

    let total_lines: i64 = sqlx::query_scalar(
        r#"SELECT COUNT(*)::bigint
           FROM order_leistungen
           WHERE order_id = $1
             AND source_service_group_id = $2"#,
    )
    .bind(order_id)
    .bind(service_group_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(total_lines, 3);
}

#[tokio::test]
async fn drug_search_and_german_equivalents_hide_unverified_by_default() {
    let Some(ctx) = test_context().await else {
        return;
    };
    let pool = ctx.pool.clone();

    let products = search_drug_products(&pool, "atorvastatin", None, false)
        .await
        .unwrap();
    assert!(products.iter().any(|item| item.brand_name == "Atoris"));
    let atoris = products
        .iter()
        .find(|item| item.brand_name == "Atoris")
        .expect("Atoris seed product");

    let candidate_product_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO drug_products (
                brand_name, normalized_brand_name, country_code, atc_code, form,
                strength, verification_status, source_kind
           ) VALUES (
                $1, $2, 'DE', 'C10AA05', 'tablet', '20 mg', 'candidate', 'manual_candidate'
           ) RETURNING id"#,
    )
    .bind(format!(
        "Atorvastatin Candidate {}",
        Uuid::new_v4().simple()
    ))
    .bind(format!(
        "atorvastatin candidate {}",
        Uuid::new_v4().simple()
    ))
    .fetch_one(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"INSERT INTO drug_equivalents (
                source_product_id, equivalent_product_id, confidence, verification_status, note
           ) VALUES ($1, $2, 0.55, 'candidate', 'Unverified test candidate')"#,
    )
    .bind(atoris.id)
    .bind(candidate_product_id)
    .execute(&pool)
    .await
    .unwrap();

    let verified = load_german_equivalents(&pool, atoris.id, false)
        .await
        .unwrap();
    assert!(verified.iter().any(|item| item.brand_name == "Sortis"));
    assert!(
        verified
            .iter()
            .all(|item| item.verification_status == "verified")
    );
    assert!(
        verified
            .iter()
            .all(|item| item.staff_warning.contains("не назначением"))
    );
    assert!(
        verified
            .iter()
            .all(|item| item.staff_warning_ru.contains("не назначением"))
    );
    assert!(
        verified
            .iter()
            .all(|item| item.staff_warning_de.contains("keine Verordnung"))
    );
    assert!(verified.iter().any(|item| {
        item.note_ru
            .as_deref()
            .is_some_and(|note| note.contains("Только для команды"))
    }));
    assert!(verified.iter().any(|item| {
        item.note_de
            .as_deref()
            .is_some_and(|note| note.contains("Nur Team-Information"))
    }));
    assert!(
        !verified
            .iter()
            .any(|item| item.equivalent_id == candidate_product_id)
    );

    let with_candidates = load_german_equivalents(&pool, atoris.id, true)
        .await
        .unwrap();
    assert!(
        with_candidates
            .iter()
            .any(|item| item.equivalent_id == candidate_product_id)
    );
}
