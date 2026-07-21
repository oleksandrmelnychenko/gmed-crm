use std::path::Path as FsPath;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::post,
};
use chrono::{Duration, NaiveDate, Utc};
use serde_json::json;
use uuid::Uuid;

use crate::state::AppState;

const UPLOAD_DIR: &str = "uploads/documents";
const E2E_PASSWORD: &str = "Password1!";
const SEEDED_MEDICAL_PROVIDER_ID: &str = "c0000000-0000-0000-0000-000000000001";
const MEDICAL_TREATMENT_ORGANIZATION_SERVICE_KEY: &str = "treatment_organization";

pub fn public_router() -> Router<AppState> {
    Router::new().route("/e2e/bootstrap/{scenario}", post(bootstrap_scenario))
}

async fn bootstrap_scenario(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(scenario): Path<String>,
) -> axum::response::Response {
    if !e2e_support_enabled() {
        return err(StatusCode::NOT_FOUND, "Not found");
    }

    let Some(secret) = std::env::var("E2E_SUPPORT_SECRET").ok() else {
        return err(StatusCode::NOT_FOUND, "Not found");
    };

    let provided_secret = headers
        .get("x-e2e-secret")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();

    if provided_secret != secret {
        return err(StatusCode::UNAUTHORIZED, "Invalid E2E support secret");
    }

    match scenario.as_str() {
        "full-smoke" => match seed_full_smoke(&state).await {
            Ok(payload) => (StatusCode::CREATED, Json(payload)).into_response(),
            Err(message) => err(StatusCode::INTERNAL_SERVER_ERROR, &message),
        },
        _ => err(StatusCode::NOT_FOUND, "Unknown E2E scenario"),
    }
}

fn e2e_support_enabled() -> bool {
    std::env::var("ENABLE_E2E_SUPPORT")
        .ok()
        .as_deref()
        .is_some_and(|value| matches!(value, "1" | "true" | "TRUE" | "yes" | "YES"))
}

async fn seed_full_smoke(state: &AppState) -> Result<serde_json::Value, String> {
    tokio::fs::create_dir_all(UPLOAD_DIR)
        .await
        .map_err(|error| format!("create upload directory: {error}"))?;

    let tag = format!("e2e-{}", Uuid::new_v4().simple());

    let pm = create_user(state, &tag, "patient_manager", "Patient Manager", "pm").await?;
    let ceo = create_user(state, &tag, "ceo", "CEO", "ceo").await?;
    let assistant = create_user(state, &tag, "ceo_assistant", "CEO Assistant", "assistant").await?;
    let billing = create_user(state, &tag, "billing", "Billing", "billing").await?;
    let sales = create_user(state, &tag, "sales", "Sales", "sales").await?;
    let concierge = create_user(state, &tag, "concierge", "Concierge", "concierge").await?;
    let it_admin = create_user(state, &tag, "it_admin", "IT Admin", "itadmin").await?;
    let teamlead = create_user(
        state,
        &tag,
        "teamlead_interpreter",
        "Teamlead Interpreter",
        "teamlead",
    )
    .await?;
    let interpreter = create_user(state, &tag, "interpreter", "Interpreter", "interpreter").await?;
    let patient_user = create_user(state, &tag, "patient", "Portal Patient", "patient").await?;
    let mfa_staff =
        create_user_with_mfa_required(state, &tag, "sales", "MFA Gate Sales", "mfa").await?;

    let patient = create_patient(state, &tag, pm.id).await?;
    assign_patient(state, patient.id, pm.id, pm.id).await?;
    assign_patient(state, patient.id, assistant.id, pm.id).await?;
    assign_patient(state, patient.id, interpreter.id, pm.id).await?;
    assign_patient(state, patient.id, patient_user.id, pm.id).await?;

    let contract = create_contract(state, patient.id, pm.id, &tag).await?;
    let order = create_order(state, patient.id, contract.id, pm.id, &tag).await?;
    create_agency_service_catalog_item(
        state,
        MEDICAL_TREATMENT_ORGANIZATION_SERVICE_KEY,
        "Organisation der Behandlung",
        pm.id,
    )
    .await?;
    let quote = create_quote(state, order.id, pm.id, &tag).await?;
    let invoice = create_invoice(state, order.id, patient.id, quote.id, pm.id, &tag).await?;
    let appointment = create_appointment(state, patient.id, order.id, pm.id, &tag).await?;
    let recurring_appointment =
        create_recurring_appointment_series(state, patient.id, order.id, pm.id, &tag).await?;

    let internal_document = create_document(
        state,
        SeedDocumentInput {
            tag: &tag,
            patient_id: patient.id,
            appointment_id: Some(appointment.id),
            uploaded_by: pm.id,
            auto_name: "Internal MRI report",
            original_filename: "internal-mri-report.pdf",
            visibility: "internal",
            is_medical: true,
            provider_label: "Clinic Berlin",
            source_label: "provider",
            notes: Some("Internal-only report for live E2E release flow."),
            file_slug: "internal-mri-report",
        },
    )
    .await?;

    let released_document = create_document(
        state,
        SeedDocumentInput {
            tag: &tag,
            patient_id: patient.id,
            appointment_id: Some(appointment.id),
            uploaded_by: pm.id,
            auto_name: "Released discharge note",
            original_filename: "released-discharge-note.pdf",
            visibility: "patient_visible",
            is_medical: true,
            provider_label: "Clinic Berlin",
            source_label: "provider",
            notes: Some("Released for patient portal confirmation."),
            file_slug: "released-discharge-note",
        },
    )
    .await?;

    let released_share_id = create_document_share(
        state,
        released_document.id,
        Some(patient_user.id),
        None,
        pm.id,
        Some("patient_portal"),
        true,
        false,
        None,
        None,
    )
    .await?;

    let externally_released_document = create_document(
        state,
        SeedDocumentInput {
            tag: &tag,
            patient_id: patient.id,
            appointment_id: Some(appointment.id),
            uploaded_by: pm.id,
            auto_name: "Provider share bundle",
            original_filename: "provider-share-bundle.pdf",
            visibility: "released_external",
            is_medical: true,
            provider_label: "Clinic Berlin",
            source_label: "provider",
            notes: Some("Released for provider-share live E2E flow."),
            file_slug: "provider-share-bundle",
        },
    )
    .await?;

    let blocked_lead = create_lead(state, &tag, pm.id, "Blocked", false).await?;
    let ready_lead = create_lead(state, &tag, pm.id, "Ready", true).await?;
    seed_complete_lead_onboarding(state, blocked_lead.id, pm.id, false).await?;
    seed_complete_lead_onboarding(state, ready_lead.id, pm.id, true).await?;
    let feedback = create_feedback(
        state,
        patient.id,
        appointment.id,
        pm.id,
        patient_user.id,
        &tag,
    )
    .await?;

    Ok(json!({
        "scenario": "full-smoke",
        "tag": tag,
        "credentials": {
            "password": E2E_PASSWORD,
            "pm": {
                "email": pm.email,
                "name": pm.name,
                "user_id": pm.id,
            },
            "ceo": {
                "email": ceo.email,
                "name": ceo.name,
                "user_id": ceo.id,
            },
            "assistant": {
                "email": assistant.email,
                "name": assistant.name,
                "user_id": assistant.id,
            },
            "billing": {
                "email": billing.email,
                "name": billing.name,
                "user_id": billing.id,
            },
            "sales": {
                "email": sales.email,
                "name": sales.name,
                "user_id": sales.id,
            },
            "concierge": {
                "email": concierge.email,
                "name": concierge.name,
                "user_id": concierge.id,
            },
            "it_admin": {
                "email": it_admin.email,
                "name": it_admin.name,
                "user_id": it_admin.id,
            },
            "teamlead_interpreter": {
                "email": teamlead.email,
                "name": teamlead.name,
                "user_id": teamlead.id,
            },
            "interpreter": {
                "email": interpreter.email,
                "name": interpreter.name,
                "user_id": interpreter.id,
            },
            "patient": {
                "email": patient_user.email,
                "name": patient_user.name,
                "user_id": patient_user.id,
            },
            "mfa_staff": {
                "email": mfa_staff.email,
                "name": mfa_staff.name,
                "user_id": mfa_staff.id,
            }
        },
        "patient": {
            "id": patient.id,
            "patient_id": patient.patient_id,
            "name": patient.name,
        },
        "contract": {
            "id": contract.id,
            "contract_number": contract.contract_number,
        },
        "quote": {
            "id": quote.id,
            "quote_number": quote.quote_number,
        },
        "order": {
            "id": order.id,
        },
        "invoice": {
            "id": invoice.id,
            "invoice_number": invoice.invoice_number,
        },
        "appointment": {
            "id": appointment.id,
            "title": appointment.title,
            "date": appointment.date,
        },
        "recurring_appointment": {
            "id": recurring_appointment.id,
            "title": recurring_appointment.title,
            "series_id": recurring_appointment.series_id,
        },
        "documents": {
            "internal": {
                "id": internal_document.id,
                "title": internal_document.auto_name,
            },
            "released": {
                "id": released_document.id,
                "title": released_document.auto_name,
                "share_id": released_share_id,
            },
            "provider_ready": {
                "id": externally_released_document.id,
                "title": externally_released_document.auto_name,
            }
        },
        "leads": {
            "blocked": {
                "id": blocked_lead.id,
                "name": blocked_lead.name,
            },
            "ready": {
                "id": ready_lead.id,
                "name": ready_lead.name,
            }
        },
        "feedback": {
            "id": feedback.id,
            "comments": feedback.comments,
        }
    }))
}

struct SeededUser {
    id: Uuid,
    email: String,
    name: String,
}

struct SeededPatient {
    id: Uuid,
    patient_id: String,
    name: String,
}

struct SeededContract {
    id: Uuid,
    contract_number: String,
}

struct SeededOrder {
    id: Uuid,
}

struct SeededQuote {
    id: Uuid,
    quote_number: String,
}

struct SeededInvoice {
    id: Uuid,
    invoice_number: String,
}

struct SeededAppointment {
    id: Uuid,
    title: String,
    date: String,
}

struct SeededDocument {
    id: Uuid,
    auto_name: String,
}

struct SeededRecurringAppointment {
    id: Uuid,
    title: String,
    series_id: Uuid,
}

struct SeededLead {
    id: Uuid,
    name: String,
}

struct SeededFeedback {
    id: Uuid,
    comments: String,
}

struct SeedDocumentInput<'a> {
    tag: &'a str,
    patient_id: Uuid,
    appointment_id: Option<Uuid>,
    uploaded_by: Uuid,
    auto_name: &'a str,
    original_filename: &'a str,
    visibility: &'a str,
    is_medical: bool,
    provider_label: &'a str,
    source_label: &'a str,
    notes: Option<&'a str>,
    file_slug: &'a str,
}

async fn create_user(
    state: &AppState,
    tag: &str,
    role: &str,
    display_role: &str,
    local_part: &str,
) -> Result<SeededUser, String> {
    let id = Uuid::new_v4();
    let email = format!("{local_part}.{tag}@example.com");
    let name = format!("{display_role} {tag}");
    let password_hash = crate::auth::password::hash_password(E2E_PASSWORD)
        .map_err(|error| format!("hash e2e password: {error}"))?;

    sqlx::query(
        r#"INSERT INTO users (id, email, password_hash, name, role, is_active)
           VALUES ($1, $2, $3, $4, $5, true)"#,
    )
    .bind(id)
    .bind(&email)
    .bind(password_hash)
    .bind(&name)
    .bind(role)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert user {email}: {error}"))?;

    Ok(SeededUser { id, email, name })
}

async fn create_user_with_mfa_required(
    state: &AppState,
    tag: &str,
    role: &str,
    display_role: &str,
    local_part: &str,
) -> Result<SeededUser, String> {
    let id = Uuid::new_v4();
    let email = format!("{local_part}.{tag}@example.com");
    let name = format!("{display_role} {tag}");
    let password_hash = crate::auth::password::hash_password(E2E_PASSWORD)
        .map_err(|error| format!("hash e2e password: {error}"))?;

    sqlx::query(
        r#"INSERT INTO users (id, email, password_hash, name, role, is_active, mfa_required)
           VALUES ($1, $2, $3, $4, $5, true, true)"#,
    )
    .bind(id)
    .bind(&email)
    .bind(password_hash)
    .bind(&name)
    .bind(role)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert mfa user {email}: {error}"))?;

    Ok(SeededUser { id, email, name })
}

async fn create_patient(
    state: &AppState,
    tag: &str,
    created_by: Uuid,
) -> Result<SeededPatient, String> {
    let id = Uuid::new_v4();
    let patient_id = format!("PT-{}", &tag[tag.len().saturating_sub(8)..]);
    let first_name = "Anna";
    let last_name = format!("Portal {}", &tag[tag.len().saturating_sub(6)..]);

    sqlx::query(
        r#"INSERT INTO patients (
                id, patient_id, title, first_name, last_name, birth_date, gender,
                nationality, residence_country, languages, phone_primary, email,
                address_city, address_country, insurance_type, insurance_provider,
                is_active, created_by
           ) VALUES (
                $1, $2, NULL, $3, $4, $5, $6,
                'German', 'Germany', $7, $8, $9,
                'Berlin', 'Germany', 'private', 'AOK',
                true, $10
           )"#,
    )
    .bind(id)
    .bind(&patient_id)
    .bind(first_name)
    .bind(&last_name)
    .bind(NaiveDate::from_ymd_opt(1990, 1, 1).ok_or("invalid static birth date")?)
    .bind("female")
    .bind(vec!["de".to_string(), "en".to_string()])
    .bind("+49 30 000000")
    .bind(format!("patient.{tag}@example.com"))
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert patient {patient_id}: {error}"))?;

    Ok(SeededPatient {
        id,
        patient_id,
        name: format!("{first_name} {last_name}"),
    })
}

async fn assign_patient(
    state: &AppState,
    patient_id: Uuid,
    user_id: Uuid,
    assigned_by: Uuid,
) -> Result<(), String> {
    sqlx::query(
        r#"INSERT INTO patient_assignments (patient_id, user_id, assigned_by)
           VALUES ($1, $2, $3)"#,
    )
    .bind(patient_id)
    .bind(user_id)
    .bind(assigned_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("assign patient {patient_id} to {user_id}: {error}"))?;
    Ok(())
}

async fn create_contract(
    state: &AppState,
    patient_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Result<SeededContract, String> {
    let id = Uuid::new_v4();
    let contract_number = format!("CTR-{}", &tag[tag.len().saturating_sub(8)..]);

    sqlx::query(
        r#"INSERT INTO framework_contracts (
                id, patient_id, contract_number, signed_at, valid_from, valid_to,
                conditions, status, created_by
           ) VALUES (
                $1, $2, $3, now(), CURRENT_DATE, CURRENT_DATE + 365,
                $4, 'signed', $5
           )"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(&contract_number)
    .bind(json!({
        "service_package": "Premium Care",
        "portal_enabled": true,
    }))
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert contract {contract_number}: {error}"))?;

    Ok(SeededContract {
        id,
        contract_number,
    })
}

async fn create_order(
    state: &AppState,
    patient_id: Uuid,
    contract_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Result<SeededOrder, String> {
    let id = Uuid::new_v4();
    let order_number = format!("ORD-E2E-{}", &tag[tag.len().saturating_sub(8)..]);

    sqlx::query(
        r#"INSERT INTO orders (
                id, order_number, patient_id, contract_id, phase, status,
                needs_description, signed_patient, signed_agency, signed_at,
                total_estimated, total_actual, currency, created_by
           ) VALUES (
                $1, $2, $3, $4, 'execution', 'active',
                'Live E2E care package', true, true, now(),
                1000, 1000, 'EUR', $5
           )"#,
    )
    .bind(id)
    .bind(order_number)
    .bind(patient_id)
    .bind(contract_id)
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert order: {error}"))?;

    sqlx::query(
        r#"INSERT INTO order_leistungen (
                id, order_id, patient_id, description, quantity, unit_price, currency,
                vat_rate, is_cost_passthrough, provider_id, status,
                delivered_at, approved_by, approved_at, notes
           ) VALUES (
                $1, $2, $3, 'Treatment package', 1, 1000, 'EUR',
                0, false, $4, 'approved',
                now(), $5, now(), 'E2E seeded line item'
           )"#,
    )
    .bind(Uuid::new_v4())
    .bind(id)
    .bind(patient_id)
    .bind(parse_uuid(SEEDED_MEDICAL_PROVIDER_ID)?)
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert order leistung: {error}"))?;

    Ok(SeededOrder { id })
}

async fn create_agency_service_catalog_item(
    state: &AppState,
    service_key: &str,
    service_name: &str,
    created_by: Uuid,
) -> Result<Uuid, String> {
    sqlx::query_scalar(
        r#"INSERT INTO agency_service_catalog (
                service_key, service_name, description, unit_label,
                unit_price, currency, vat_rate, is_active, valid_from, created_by
           ) VALUES (
                $1, $2, $3, 'item',
                150.00, 'EUR', 19.00, true, CURRENT_DATE - 30, $4
           )
           ON CONFLICT (service_key)
           DO UPDATE SET
                service_name = EXCLUDED.service_name,
                description = EXCLUDED.description,
                unit_label = EXCLUDED.unit_label,
                unit_price = EXCLUDED.unit_price,
                currency = EXCLUDED.currency,
                vat_rate = EXCLUDED.vat_rate,
                is_active = true,
                valid_from = EXCLUDED.valid_from,
                valid_to = NULL,
                updated_at = now(),
                updated_by = EXCLUDED.created_by
           RETURNING id"#,
    )
    .bind(service_key)
    .bind(service_name)
    .bind(format!("{service_name} live E2E seeded catalog item"))
    .bind(created_by)
    .fetch_one(&state.db)
    .await
    .map_err(|error| format!("insert agency service catalog item {service_key}: {error}"))
}

async fn create_quote(
    state: &AppState,
    order_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Result<SeededQuote, String> {
    let id = Uuid::new_v4();
    let quote_number = format!("QU-{}", &tag[tag.len().saturating_sub(8)..]);

    sqlx::query(
        r#"INSERT INTO quotes (
                id, order_id, quote_number, total_net, total_vat, total_gross,
                status, valid_until, line_items, notes, created_by
           ) VALUES (
                $1, $2, $3, 1000, 0, 1000,
                'accepted', CURRENT_DATE + 30,
                $4, 'Live E2E quote', $5
           )"#,
    )
    .bind(id)
    .bind(order_id)
    .bind(&quote_number)
    .bind(json!([
        {
            "description": "Treatment package",
            "quantity": 1,
            "unit_price": "1000.00",
            "total_gross": "1000.00"
        }
    ]))
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert quote: {error}"))?;

    Ok(SeededQuote { id, quote_number })
}

async fn create_invoice(
    state: &AppState,
    order_id: Uuid,
    patient_id: Uuid,
    quote_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Result<SeededInvoice, String> {
    let id = Uuid::new_v4();
    let invoice_number = format!("INV-{}", &tag[tag.len().saturating_sub(8)..]);

    sqlx::query(
        r#"INSERT INTO invoices (
                id, quote_id, order_id, patient_id, invoice_number, invoice_type,
                status, issued_at, due_date, total_net, total_vat, total_gross,
                paid_amount, line_items, notes, created_by
           ) VALUES (
                $1, $2, $3, $4, $5, 'advance',
                'sent', now(), CURRENT_DATE + 14, 1000, 0, 1000,
                0, $6, 'Live E2E invoice', $7
           )"#,
    )
    .bind(id)
    .bind(quote_id)
    .bind(order_id)
    .bind(patient_id)
    .bind(&invoice_number)
    .bind(json!([
        {
            "description": "Treatment package",
            "quantity": 1,
            "unit_price": "1000.00",
            "total_gross": "1000.00"
        }
    ]))
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert invoice: {error}"))?;

    Ok(SeededInvoice { id, invoice_number })
}

async fn create_appointment(
    state: &AppState,
    patient_id: Uuid,
    order_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Result<SeededAppointment, String> {
    let id = Uuid::new_v4();
    let title = format!("Clinic follow-up {tag}");
    let date = (Utc::now() + Duration::days(7))
        .date_naive()
        .format("%Y-%m-%d")
        .to_string();

    sqlx::query(
        r#"INSERT INTO appointments (
                id, patient_id, provider_id, order_id, appointment_type, title, date,
                time_start, time_end, location, category, status, created_by
           ) VALUES (
                $1, $2, $3, $4, 'medical', $5, $6,
                '09:00', '10:00', 'Clinic Berlin', 'followup', 'confirmed', $7
           )"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(parse_uuid(SEEDED_MEDICAL_PROVIDER_ID)?)
    .bind(order_id)
    .bind(&title)
    .bind(
        NaiveDate::parse_from_str(&date, "%Y-%m-%d")
            .map_err(|error| format!("parse appointment date: {error}"))?,
    )
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert appointment: {error}"))?;

    Ok(SeededAppointment { id, title, date })
}

async fn create_recurring_appointment_series(
    state: &AppState,
    patient_id: Uuid,
    order_id: Uuid,
    created_by: Uuid,
    tag: &str,
) -> Result<SeededRecurringAppointment, String> {
    let series_id = Uuid::new_v4();
    let title = format!("Recurring therapy {tag}");
    let first_date = (Utc::now() + Duration::days(14)).date_naive();
    let recurrence_count = 3_i32;

    for recurrence_index in 0..recurrence_count {
        let appointment_id = if recurrence_index == 0 {
            series_id
        } else {
            Uuid::new_v4()
        };
        let date = first_date + Duration::days(i64::from(recurrence_index) * 7);

        sqlx::query(
            r#"INSERT INTO appointments (
                    id, patient_id, provider_id, order_id, appointment_type, title, date,
                    time_start, time_end, location, category, status, notes, created_by,
                    recurrence_series_id, recurrence_frequency, recurrence_interval,
                    recurrence_count, recurrence_until, recurrence_index,
                    recurrence_parent_series_id, recurrence_split_from_appointment_id,
                    recurrence_split_from_index
               ) VALUES (
                    $1, $2, $3, $4, 'medical', $5, $6,
                    '09:00', '10:00', 'Clinic Berlin', 'followup', $7, $8, $9,
                    $10, 'weekly', 1, $11, $12, $13,
                    NULL, NULL, NULL
               )"#,
        )
        .bind(appointment_id)
        .bind(patient_id)
        .bind(parse_uuid(SEEDED_MEDICAL_PROVIDER_ID)?)
        .bind(order_id)
        .bind(&title)
        .bind(date)
        .bind(if recurrence_index == 0 {
            "confirmed"
        } else {
            "planned"
        })
        .bind("E2E recurring appointment series fixture")
        .bind(created_by)
        .bind(series_id)
        .bind(recurrence_count)
        .bind(first_date + Duration::days(14))
        .bind(recurrence_index)
        .execute(&state.db)
        .await
        .map_err(|error| format!("insert recurring appointment series item: {error}"))?;
    }

    Ok(SeededRecurringAppointment {
        id: series_id,
        title,
        series_id,
    })
}

async fn create_document(
    state: &AppState,
    input: SeedDocumentInput<'_>,
) -> Result<SeededDocument, String> {
    let id = Uuid::new_v4();
    let storage_key = format!(
        "e2e/{}/{}-{}",
        input.tag,
        Uuid::new_v4().simple(),
        input.file_slug
    );
    let file_path = FsPath::new(UPLOAD_DIR).join(&storage_key);

    if let Some(parent) = file_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|error| format!("create document subdir: {error}"))?;
    }

    let bytes = format!(
        "GMED live E2E fixture\n{}\n{}\n{}",
        input.auto_name, input.provider_label, input.tag
    )
    .into_bytes();

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|error| format!("write document file: {error}"))?;

    sqlx::query(
        r#"INSERT INTO documents (
                id, patient_id, appointment_id, auto_name, original_filename, art,
                category, status, visibility, is_medical, mime_type, file_size,
                storage_key, klinik, ursprung, notes, version_root_document_id,
                replaces_document_id, version_number, uploaded_by
           ) VALUES (
                $1, $2, $3, $4, $5, 'medical_report',
                'report', 'active', $6, $7, 'application/pdf', $8,
                $9, $10, $11, $12, $13, NULL, 1, $14
           )"#,
    )
    .bind(id)
    .bind(input.patient_id)
    .bind(input.appointment_id)
    .bind(input.auto_name)
    .bind(input.original_filename)
    .bind(input.visibility)
    .bind(input.is_medical)
    .bind(i64::try_from(bytes.len()).map_err(|error| format!("document size overflow: {error}"))?)
    .bind(storage_key)
    .bind(input.provider_label)
    .bind(input.source_label)
    .bind(input.notes)
    .bind(id)
    .bind(input.uploaded_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert document {}: {error}", input.auto_name))?;

    Ok(SeededDocument {
        id,
        auto_name: input.auto_name.to_string(),
    })
}

#[allow(clippy::too_many_arguments)]
async fn create_document_share(
    state: &AppState,
    document_id: Uuid,
    shared_with_user_id: Option<Uuid>,
    shared_with_provider_id: Option<Uuid>,
    shared_by: Uuid,
    channel: Option<&str>,
    requires_confirmation: bool,
    confirmed: bool,
    confirmed_at: Option<chrono::DateTime<chrono::Utc>>,
    revoked_at: Option<chrono::DateTime<chrono::Utc>>,
) -> Result<Uuid, String> {
    let id = Uuid::new_v4();

    sqlx::query(
        r#"INSERT INTO document_shares (
                id, document_id, shared_with_provider_id, shared_with_user_id,
                shared_by, channel, requires_confirmation, confirmed, confirmed_at,
                shared_at, revoked_at
           ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8, $9,
                now(), $10
           )"#,
    )
    .bind(id)
    .bind(document_id)
    .bind(shared_with_provider_id)
    .bind(shared_with_user_id)
    .bind(shared_by)
    .bind(channel)
    .bind(requires_confirmation)
    .bind(confirmed)
    .bind(confirmed_at)
    .bind(revoked_at)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert document share: {error}"))?;

    Ok(id)
}

async fn create_lead(
    state: &AppState,
    tag: &str,
    created_by: Uuid,
    label: &str,
    ready_for_conversion: bool,
) -> Result<SeededLead, String> {
    let id = Uuid::new_v4();
    let first_name = label.to_string();
    let last_name = format!("Lead {}", &tag[tag.len().saturating_sub(6)..]);
    let email = format!("{}.{}@example.com", label.to_lowercase(), tag);

    sqlx::query(
        r#"INSERT INTO leads (
                id, first_name, last_name, email, phone, source, country,
                compliance_status, qualification_status, created_by,
                intake_source, flow, primary_language, primary_concern_text,
                date_of_birth, legal_sex,
                consent_privacy_practices, consent_healthcare
           ) VALUES (
                $1, $2, $3, $4, $5, 'website', 'Germany',
                $6, 'qualified', $7,
                'manual', 'standard', 'de', 'Cardiology follow-up',
                $8, $9,
                $10, $11
           )"#,
    )
    .bind(id)
    .bind(&first_name)
    .bind(&last_name)
    .bind(email)
    .bind("+49 30 100001")
    .bind(if ready_for_conversion {
        "signed"
    } else {
        "pending"
    })
    .bind(created_by)
    .bind(if ready_for_conversion {
        Some(NaiveDate::from_ymd_opt(1991, 1, 1).ok_or("invalid lead birth date")?)
    } else {
        None
    })
    .bind(if ready_for_conversion {
        Some("female")
    } else {
        None::<&str>
    })
    .bind(ready_for_conversion)
    .bind(ready_for_conversion)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert lead {label}: {error}"))?;

    Ok(SeededLead {
        id,
        name: format!("{first_name} {last_name}"),
    })
}

async fn seed_complete_lead_onboarding(
    state: &AppState,
    lead_id: Uuid,
    created_by: Uuid,
    gate_ready: bool,
) -> Result<(), String> {
    let tag = lead_id.simple().to_string();

    sqlx::query(
        r#"UPDATE leads
           SET street_address = 'Hauptstr. 1',
               city = 'Berlin',
               zip_code = '10115',
               primary_concern_text = 'Cardiology follow-up',
               requested_specialties = '["cardiology"]'::jsonb,
               wizard_state = jsonb_set(
                   COALESCE(wizard_state, '{}'::jsonb),
                   '{clinical_draft}',
                   '{"anamnese":"Symptoms require a cardiology follow-up."}'::jsonb,
                   true
               ),
               compliance_status = CASE WHEN $2 THEN 'signed' ELSE compliance_status END,
               consent_healthcare = CASE WHEN $2 THEN true ELSE consent_healthcare END,
               consent_privacy_practices = CASE WHEN $2 THEN true ELSE consent_privacy_practices END
           WHERE id = $1"#,
    )
    .bind(lead_id)
    .bind(gate_ready)
    .execute(&state.db)
    .await
    .map_err(|error| format!("prepare lead onboarding fixture: {error}"))?;

    sqlx::query(
        r#"INSERT INTO cases (
                case_id, lead_id, manager_id, status, hauptanfragegrund,
                aktuelle_anamnese, zuweiser, intake_completed_at, intake_completed_by
           ) VALUES (
                $1, $2, $3, 'open', 'Cardiology follow-up',
                'Symptoms require a cardiology follow-up.', 'Self referral', now(), $3
           )"#,
    )
    .bind(format!("C-E2E-{tag}"))
    .bind(lead_id)
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert lead intake fixture: {error}"))?;

    for compliance_kind in ["identity", "dsgvo", "confidentiality_release"] {
        let document_id = Uuid::new_v4();
        let storage_key = format!("e2e/{tag}/{compliance_kind}-{document_id}.pdf");
        let file_path = FsPath::new(UPLOAD_DIR).join(&storage_key);
        if let Some(parent) = file_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("create lead document fixture directory: {error}"))?;
        }
        tokio::fs::write(
            &file_path,
            format!("GMED live E2E lead fixture\n{compliance_kind}\n{lead_id}"),
        )
        .await
        .map_err(|error| format!("write lead compliance fixture: {error}"))?;
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, auto_name, original_filename, art, category,
                    status, visibility, is_medical, mime_type, file_size, storage_key,
                    version_root_document_id, version_number, uploaded_by,
                    signed_at, signed_by, compliance_kind
               ) VALUES (
                    $1, $2, $3, $4, $5, 'administrative',
                    'active', 'internal', false, 'application/pdf', 128, $6,
                    $1, 1, $7, now(), $7, $5
               )"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(format!("{compliance_kind} {tag}"))
        .bind(format!("{compliance_kind}-{tag}.pdf"))
        .bind(compliance_kind)
        .bind(storage_key)
        .bind(created_by)
        .execute(&state.db)
        .await
        .map_err(|error| format!("insert lead compliance fixture: {error}"))?;
    }

    let contract_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO framework_contracts (
                lead_id, contract_number, signed_at, status, created_by, client_reference
           ) VALUES ($1, $2, now(), 'signed', $3, $4)
           RETURNING id"#,
    )
    .bind(lead_id)
    .bind(format!("FC-E2E-{tag}"))
    .bind(created_by)
    .bind(format!("lead-onboarding:{lead_id}:framework"))
    .fetch_one(&state.db)
    .await
    .map_err(|error| format!("insert lead contract fixture: {error}"))?;

    let order_id: Uuid = sqlx::query_scalar(
        r#"INSERT INTO orders (
                order_number, contract_id, source_lead_id, needs_description,
                signed_patient, signed_agency, signed_patient_at, signed_agency_at,
                signed_at, prepayment_required, total_estimated, created_by
           ) VALUES (
                $1, $2, $3, 'Coordinate cardiology follow-up',
                true, true, now(), now(), now(), true, 119, $4
           ) RETURNING id"#,
    )
    .bind(format!("A-E2E-{tag}"))
    .bind(contract_id)
    .bind(lead_id)
    .bind(created_by)
    .fetch_one(&state.db)
    .await
    .map_err(|error| format!("insert lead order fixture: {error}"))?;

    sqlx::query(
        r#"INSERT INTO order_leistungen (
                order_id, description, quantity, unit_price, vat_rate, client_reference
           ) VALUES ($1, 'Initial cardiology coordination', 1, 100, 19, $2)"#,
    )
    .bind(order_id)
    .bind(format!("lead-onboarding:{lead_id}:service:1"))
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert lead order service fixture: {error}"))?;

    sqlx::query(
        r#"INSERT INTO quotes (
                order_id, quote_number, total_net, total_vat, total_gross,
                status, paid_amount, paid_at, line_items, created_by
           ) VALUES (
                $1, $2, 100, 19, 119,
                'accepted', 119, now(), '[]'::jsonb, $3
           )"#,
    )
    .bind(order_id)
    .bind(format!("KV-E2E-{tag}"))
    .bind(created_by)
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert lead quote fixture: {error}"))?;

    for (template_id, category) in [
        ("framework_contract", "contract"),
        ("single_order", "administrative_single_order"),
        ("order_cost_estimate", "finance_order_cost_estimate"),
        ("cost_estimate", "finance_cost_estimate"),
    ] {
        let document_id = Uuid::new_v4();
        let storage_key = format!("e2e/{tag}/{template_id}-{document_id}.pdf");
        let file_path = FsPath::new(UPLOAD_DIR).join(&storage_key);
        if let Some(parent) = file_path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("create commercial fixture directory: {error}"))?;
        }
        tokio::fs::write(
            &file_path,
            format!("GMED live E2E lead fixture\n{template_id}\n{lead_id}"),
        )
        .await
        .map_err(|error| format!("write lead commercial document fixture: {error}"))?;
        sqlx::query(
            r#"INSERT INTO documents (
                    id, lead_id, order_id, auto_name, original_filename, art, category,
                    status, visibility, is_medical, mime_type, file_size, storage_key,
                    generated_template_id, version_root_document_id, version_number, uploaded_by
               ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7,
                    'active', 'patient_visible', false, 'application/pdf', 128, $8,
                    $6, $1, 1, $9
               )"#,
        )
        .bind(document_id)
        .bind(lead_id)
        .bind(order_id)
        .bind(format!("{template_id} {tag}"))
        .bind(format!("{template_id}-{tag}.pdf"))
        .bind(template_id)
        .bind(category)
        .bind(storage_key)
        .bind(created_by)
        .execute(&state.db)
        .await
        .map_err(|error| format!("insert lead commercial document fixture: {error}"))?;
    }

    Ok(())
}

async fn create_feedback(
    state: &AppState,
    patient_id: Uuid,
    appointment_id: Uuid,
    patient_manager_id: Uuid,
    submitted_by: Uuid,
    tag: &str,
) -> Result<SeededFeedback, String> {
    let id = Uuid::new_v4();
    let comments = format!("Portal feedback {tag}");

    sqlx::query(
        r#"INSERT INTO patient_feedback_forms (
                id, patient_id, appointment_id, provider_id, doctor_id, patient_manager_id,
                interpreter_id, concierge_id, submitted_by, source, status,
                overall_score, patient_manager_score, interpreter_score, concierge_score,
                treatment_score, doctor_score, organization_score, service_score,
                infrastructure_score, price_value_score, treatment_success,
                complication_reported, nps_score, comments, improvement_notes
           ) VALUES (
                $1, $2, $3, $4, NULL, $5,
                NULL, NULL, $6, 'patient_portal', 'submitted',
                5, 5, NULL, NULL,
                5, 5, 4, 5,
                4, 4, 'yes',
                false, 9, $7, $8
           )"#,
    )
    .bind(id)
    .bind(patient_id)
    .bind(appointment_id)
    .bind(parse_uuid(SEEDED_MEDICAL_PROVIDER_ID)?)
    .bind(patient_manager_id)
    .bind(submitted_by)
    .bind(&comments)
    .bind("Please shorten the waiting time at check-in.")
    .execute(&state.db)
    .await
    .map_err(|error| format!("insert feedback fixture: {error}"))?;

    Ok(SeededFeedback { id, comments })
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|error| format!("parse uuid {value}: {error}"))
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": status.canonical_reason().unwrap_or("error"),
            "message": message,
        })),
    )
        .into_response()
}
