use crate::{audit, auth::middleware::AuthUser, state::AppState};
use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use gmed_domain::role::Role;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use uuid::Uuid;

pub(super) fn router() -> Router<AppState> {
    Router::new()
        .route("/external-invoices", get(list))
        .route("/external-invoices/{invoice_id}/approve", post(approve))
        .route(
            "/external-invoices/{invoice_id}/patient-payment",
            post(update_patient_payment),
        )
}

#[derive(Deserialize, Default)]
struct ListQuery {
    patient_id: Option<Uuid>,
    order_id: Option<Uuid>,
    search: Option<String>,
    page: Option<i64>,
    per_page: Option<i64>,
}

async fn list(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListQuery>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[
        Role::Ceo,
        Role::CeoAssistant,
        Role::Billing,
        Role::PatientManager,
    ]) {
        return response.into_response();
    }
    let page = query.page.unwrap_or(1).clamp(1, 1_000_000);
    let per_page = query.per_page.unwrap_or(25).clamp(1, 100);
    // Managers see assigned patients and their own company imports only.
    let manager_id = (auth.role == Role::PatientManager).then_some(auth.user_id);
    let search = query.search.unwrap_or_default();
    let result = sqlx::query_scalar::<_, Value>(r#"
        WITH visible AS (
            SELECT external.*, orders.order_number, patient.patient_id AS patient_pid,
                   CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
                   COALESCE(NULLIF(BTRIM(provider.name), ''), external.supplier_name) AS provider_name,
                   source.id AS original_id,
                   COALESCE(NULLIF(BTRIM(source.original_filename), ''), source.auto_name) AS source_document_name,
                   settlement.company_paid_gross, settlement.remaining_provider_liability_gross,
                   settlement.settlement_status, settlement.latest_payment_on, settlement.payment_count,
                   receivable.patient_receivable_gross AS receivable_patient_receivable_gross,
                   receivable.allocated_receivable_gross,
                   receivable.remaining_receivable_gross
            FROM external_invoices external
            LEFT JOIN orders ON orders.id = external.order_id
            LEFT JOIN patients patient ON patient.id = external.patient_id
            LEFT JOIN providers provider ON provider.id = external.provider_id
            LEFT JOIN documents source ON source.id = external.source_document_id AND source.file_deleted_at IS NULL
            JOIN external_invoice_provider_settlement_balances settlement ON settlement.external_invoice_id = external.id
            JOIN external_invoice_receivable_balances receivable ON receivable.external_invoice_id = external.id
            WHERE ($1::uuid IS NULL OR external.patient_id = $1)
              AND ($2::uuid IS NULL OR external.order_id = $2)
              AND ($3::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM patient_assignments assignment WHERE assignment.patient_id = external.patient_id
                    AND assignment.user_id = $3 AND assignment.revoked_at IS NULL
              ) OR (external.invoice_scope = 'company' AND external.created_by = $3))
              AND ($4 = '' OR CONCAT_WS(' ', external.external_invoice_number, provider.name, external.supplier_name,
                    patient.first_name, patient.last_name, patient.patient_id, orders.order_number) ILIKE '%' || $4 || '%')
        ), paged AS (
            SELECT * FROM visible ORDER BY created_at DESC, id DESC LIMIT $5 OFFSET $6
        )
        SELECT jsonb_build_object('total', (SELECT COUNT(*) FROM visible), 'items', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', id, 'external_invoice_number', external_invoice_number,
                'invoice_scope', invoice_scope, 'source_document_id', original_id, 'source_document_name', source_document_name,
                'invoice_date', invoice_date, 'due_date', due_date, 'status', status, 'paid_by', paid_by,
                'amount_gross', amount_gross::text, 'currency', currency,
                'company_paid_gross', company_paid_gross::text, 'remaining_gross', remaining_provider_liability_gross::text,
                'patient_receivable_gross', receivable_patient_receivable_gross::text,
                'allocated_receivable_gross', allocated_receivable_gross::text,
                'remaining_receivable_gross', remaining_receivable_gross::text,
                'settlement_status', settlement_status, 'latest_payment_on', latest_payment_on, 'payment_count', payment_count,
                'liability_kind', CASE WHEN remaining_provider_liability_gross <= 0 THEN 'settled' WHEN status = 'expected' THEN 'expected' ELSE 'payable' END,
                'order_id', order_id, 'order_number', order_number, 'patient_id', patient_id, 'patient_pid', patient_pid,
                'patient_name', patient_name, 'provider_id', provider_id, 'provider_name', provider_name
            ) ORDER BY created_at DESC, id DESC) FROM paged
        ), '[]'::jsonb))
    "#)
        .bind(query.patient_id).bind(query.order_id).bind(manager_id).bind(search.trim())
        .bind(per_page).bind((page - 1) * per_page).fetch_one(&state.db).await;
    match result {
        Ok(mut payload) => {
            payload["page"] = json!(page);
            payload["per_page"] = json!(per_page);
            Json(payload).into_response()
        }
        Err(error) => {
            tracing::error!(%error, "list incoming invoices");
            super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to load incoming invoices",
            )
        }
    }
}

#[derive(Deserialize)]
struct PatientPaymentRequest {
    request_id: Uuid,
    paid: bool,
    paid_on: String,
    note: Option<String>,
}

async fn update_patient_payment(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
    Json(body): Json<PatientPaymentRequest>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo, Role::Billing]) {
        return response.into_response();
    }
    let paid_on = match chrono::NaiveDate::parse_from_str(body.paid_on.trim(), "%Y-%m-%d") {
        Ok(value) if value <= chrono::Utc::now().date_naive() => value,
        _ => {
            return super::err(
                StatusCode::UNPROCESSABLE_ENTITY,
                "Patient payment date must be a valid date not later than today",
            );
        }
    };
    let event_type = if body.paid {
        "patient_paid"
    } else {
        "patient_payment_reopened"
    };
    let note = body
        .note
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let mut transaction = match state.db.begin().await {
        Ok(value) => value,
        Err(error) => {
            tracing::error!(%error, %invoice_id, "begin patient payment update");
            return super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update payment state",
            );
        }
    };

    let duplicate = sqlx::query(
        "SELECT event_type FROM external_invoice_patient_payment_events
         WHERE external_invoice_id = $1 AND request_id = $2",
    )
    .bind(invoice_id)
    .bind(body.request_id)
    .fetch_optional(&mut *transaction)
    .await;
    match duplicate {
        Ok(Some(row)) => {
            if row.try_get::<String, _>("event_type").unwrap_or_default() != event_type {
                return super::err(
                    StatusCode::CONFLICT,
                    "Request id was already used for another payment state",
                );
            }
            let _ = transaction.rollback().await;
            return Json(
                json!({"id": invoice_id, "paid_by": if body.paid { "patient" } else { "unpaid" }}),
            )
            .into_response();
        }
        Ok(None) => {}
        Err(error) => {
            tracing::error!(%error, %invoice_id, "check patient payment request");
            return super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update payment state",
            );
        }
    }

    let row = match sqlx::query(
        r#"SELECT external.status, external.paid_by, external.invoice_scope,
                  external.patient_id, external.due_date,
                  settlement.company_paid_gross
           FROM external_invoices external
           JOIN external_invoice_provider_settlement_balances settlement
             ON settlement.external_invoice_id = external.id
           WHERE external.id = $1
           FOR UPDATE OF external"#,
    )
    .bind(invoice_id)
    .fetch_optional(&mut *transaction)
    .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return super::err(StatusCode::NOT_FOUND, "Invoice not found"),
        Err(error) => {
            tracing::error!(%error, %invoice_id, "load invoice for patient payment");
            return super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to update payment state",
            );
        }
    };
    let status = row.try_get::<String, _>("status").unwrap_or_default();
    let paid_by = row.try_get::<String, _>("paid_by").unwrap_or_default();
    let invoice_scope = row
        .try_get::<String, _>("invoice_scope")
        .unwrap_or_default();
    let patient_id = row
        .try_get::<Option<Uuid>, _>("patient_id")
        .unwrap_or_default();
    let company_paid = row
        .try_get::<rust_decimal::Decimal, _>("company_paid_gross")
        .unwrap_or_default();

    if invoice_scope != "patient_order" || patient_id.is_none() {
        return super::err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "Company invoices cannot be paid by a patient",
        );
    }
    if status == "cancelled" {
        return super::err(
            StatusCode::CONFLICT,
            "Cancelled invoice payment state cannot be changed",
        );
    }
    if body.paid {
        if !matches!(status.as_str(), "approved" | "overdue") || paid_by != "unpaid" {
            return super::err(
                StatusCode::CONFLICT,
                "Only approved unpaid invoices can be marked as paid by the patient",
            );
        }
        if company_paid > rust_decimal::Decimal::ZERO {
            return super::err(
                StatusCode::CONFLICT,
                "Reverse company payments before changing the payer",
            );
        }
    } else if status != "paid" || paid_by != "patient" {
        return super::err(
            StatusCode::CONFLICT,
            "Only patient-paid invoices can be reopened",
        );
    }

    let updated = if body.paid {
        sqlx::query(
            r#"UPDATE external_invoices
               SET status = 'paid', paid_by = 'patient',
                   paid_at = ($2::date::timestamp AT TIME ZONE 'UTC'), updated_at = now()
               WHERE id = $1"#,
        )
        .bind(invoice_id)
        .bind(paid_on)
        .execute(&mut *transaction)
        .await
    } else {
        sqlx::query(
            r#"UPDATE external_invoices
               SET status = CASE WHEN due_date IS NOT NULL AND due_date < CURRENT_DATE
                                 THEN 'overdue' ELSE 'approved' END,
                   paid_by = 'unpaid', paid_at = NULL, updated_at = now()
               WHERE id = $1"#,
        )
        .bind(invoice_id)
        .execute(&mut *transaction)
        .await
    };
    if let Err(error) = updated {
        tracing::error!(%error, %invoice_id, "update patient-paid invoice state");
        return super::err(
            StatusCode::CONFLICT,
            "Payment state changed; reload the invoice and try again",
        );
    }
    if let Err(error) = sqlx::query(
        r#"INSERT INTO external_invoice_patient_payment_events
              (external_invoice_id, request_id, event_type, effective_on, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)"#,
    )
    .bind(invoice_id)
    .bind(body.request_id)
    .bind(event_type)
    .bind(paid_on)
    .bind(note)
    .bind(auth.user_id)
    .execute(&mut *transaction)
    .await
    {
        tracing::error!(%error, %invoice_id, "write patient payment event");
        return super::err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update payment state",
        );
    }
    if let Err(error) = transaction.commit().await {
        tracing::error!(%error, %invoice_id, "commit patient payment update");
        return super::err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to update payment state",
        );
    }

    state.audit_sender.try_send(audit::domain_event(
        event_type,
        Some(auth.user_id),
        "external_invoice",
        Some(invoice_id),
        json!({"paid_on": paid_on, "patient_id": patient_id}),
    ));
    crate::realtime::publish_company_finance_event(
        &state,
        Some(auth.user_id),
        "provider_invoice.payment_state_changed",
        "external_invoice",
        invoice_id,
        json!({"paid_by": if body.paid { "patient" } else { "unpaid" }}),
    )
    .await;
    Json(json!({"id": invoice_id, "paid_by": if body.paid { "patient" } else { "unpaid" }}))
        .into_response()
}

async fn approve(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(invoice_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(response) = auth.require_any_role(&[Role::Ceo, Role::Billing]) {
        return response.into_response();
    }
    // Confirmation changes no money. Payments still go through the settlement journal.
    match sqlx::query_scalar::<_, Uuid>(
        r#"
        UPDATE external_invoices SET status = 'approved', updated_at = now()
        WHERE id = $1 AND status = 'received' AND paid_by = 'unpaid'
        RETURNING id
    "#,
    )
    .bind(invoice_id)
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(id)) => {
            state.audit_sender.try_send(audit::domain_event(
                "approve_external_invoice",
                Some(auth.user_id),
                "external_invoice",
                Some(id),
                json!({"status": "approved"}),
            ));
            crate::realtime::publish_company_finance_event(
                &state,
                Some(auth.user_id),
                "provider_invoice.approved",
                "external_invoice",
                id,
                json!({"status": "approved"}),
            )
            .await;
            Json(json!({"id": id})).into_response()
        }
        Ok(None) => match sqlx::query_scalar::<_, String>(
            "SELECT status FROM external_invoices WHERE id = $1",
        )
        .bind(invoice_id)
        .fetch_optional(&state.db)
        .await
        {
            Ok(Some(status)) if status == "approved" => {
                Json(json!({"id": invoice_id})).into_response()
            }
            Ok(Some(_)) => super::err(
                StatusCode::CONFLICT,
                "Only received unpaid invoices can be approved",
            ),
            Ok(None) => super::err(StatusCode::NOT_FOUND, "Invoice not found"),
            Err(_) => super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to approve invoice",
            ),
        },
        Err(error) => {
            tracing::error!(%error, "approve incoming invoice");
            super::err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to approve invoice",
            )
        }
    }
}
