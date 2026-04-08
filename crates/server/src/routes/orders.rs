use axum::{
    Json, Router,
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use serde::Deserialize;
use uuid::Uuid;

use crate::access;
use crate::auth::middleware::AuthUser;
use crate::state::AppState;
use gmed_domain::role::Role;
use sqlx::Row;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/orders", get(list_orders).post(create_order))
        .route("/orders/{order_id}", get(get_order))
        .route("/orders/{order_id}/phase", post(update_phase))
        .route(
            "/orders/{order_id}/leistungen",
            get(list_leistungen).post(add_leistung),
        )
        .route(
            "/orders/{order_id}/leistungen/{leistung_id}/approve",
            post(approve_leistung),
        )
}

#[derive(Deserialize)]
struct CreateOrderRequest {
    patient_id: Uuid,
    contract_id: Option<Uuid>,
    needs_description: Option<String>,
}

#[derive(Deserialize)]
struct PhaseRequest {
    phase: String,
}

#[derive(Deserialize)]
struct AddLeistungRequest {
    description: String,
    quantity: f64,
    unit_price: f64,
    vat_rate: Option<f64>,
    is_cost_passthrough: Option<bool>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
    notes: Option<String>,
}

#[derive(Deserialize)]
struct ListOrdersQuery {
    search: Option<String>,
    phase: Option<String>,
    status: Option<String>,
    patient_id: Option<Uuid>,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
}

fn gen_order_number(seq: i64) -> String {
    format!("A-{}-{:04}", chrono::Utc::now().format("%Y%m%d"), seq)
}

async fn list_orders(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Query(query): Query<ListOrdersQuery>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }

    if let Some(ref phase) = query.phase
        && !is_valid_order_phase(phase)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid phase");
    }
    if let Some(ref status) = query.status
        && !is_valid_order_status(status)
    {
        return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid status");
    }

    let search_pattern = format!("%{}%", query.search.unwrap_or_default());

    match sqlx::query(
        r#"SELECT o.id, o.order_number, o.patient_id, o.phase, o.status,
                  o.total_estimated, o.created_at,
                  p.first_name, p.last_name, p.patient_id AS p_pid
           FROM orders o
           JOIN patients p ON p.id = o.patient_id
           WHERE ($1::text = '%%'
                  OR o.order_number ILIKE $1
                  OR COALESCE(o.needs_description, '') ILIKE $1
                  OR p.first_name ILIKE $1
                  OR p.last_name ILIKE $1
                  OR p.patient_id ILIKE $1
                  OR EXISTS (
                        SELECT 1
                        FROM order_leistungen ol
                        LEFT JOIN providers pr ON pr.id = ol.provider_id
                        LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
                        WHERE ol.order_id = o.id
                          AND (
                                ol.description ILIKE $1
                                OR COALESCE(pr.name, '') ILIKE $1
                                OR COALESCE(d.name, '') ILIKE $1
                          )
                  )
           )
             AND ($2::text IS NULL OR o.phase = $2)
             AND ($3::text IS NULL OR o.status = $3)
             AND ($4::uuid IS NULL OR o.patient_id = $4)
             AND (
                $5::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    WHERE ol.order_id = o.id
                      AND ol.provider_id = $5
                )
             )
             AND (
                $6::uuid IS NULL
                OR EXISTS (
                    SELECT 1
                    FROM order_leistungen ol
                    WHERE ol.order_id = o.id
                      AND ol.doctor_id = $6
                )
             )
           ORDER BY o.created_at DESC
           LIMIT 200"#,
    )
    .bind(search_pattern)
    .bind(query.phase)
    .bind(query.status)
    .bind(query.patient_id)
    .bind(query.provider_id)
    .bind(query.doctor_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut orders = Vec::with_capacity(rows.len());
            for r in rows {
                let order_id = r.try_get::<Uuid, _>("id").unwrap_or_default();
                let patient_id = r.try_get::<Uuid, _>("patient_id").unwrap_or_default();

                match can_access_order(&state, &auth, order_id, Some(patient_id)).await {
                    Ok(true) => {}
                    Ok(false) => continue,
                    Err(resp) => return resp,
                }

                orders.push(serde_json::json!({
                    "id": order_id,
                    "order_number": r.try_get::<String, _>("order_number").unwrap_or_default(),
                    "patient_id": patient_id,
                    "patient_name": format!(
                        "{} {}",
                        r.try_get::<String, _>("first_name").unwrap_or_default(),
                        r.try_get::<String, _>("last_name").unwrap_or_default()
                    ),
                    "patient_pid": r.try_get::<String, _>("p_pid").unwrap_or_default(),
                    "phase": r.try_get::<String, _>("phase").unwrap_or_default(),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "total_estimated": r.try_get::<Option<rust_decimal::Decimal>, _>("total_estimated").unwrap_or_default(),
                    "created_at": r.try_get::<chrono::DateTime<chrono::Utc>, _>("created_at").map(|v| v.to_rfc3339()).unwrap_or_default(),
                }));
            }
            Json(orders).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list orders");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

fn is_valid_order_phase(value: &str) -> bool {
    matches!(
        value,
        "discovery" | "intake" | "execution" | "closure" | "followup"
    )
}

fn is_valid_order_status(value: &str) -> bool {
    matches!(value, "active" | "paused" | "completed" | "cancelled")
}

async fn create_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Json(body): Json<CreateOrderRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match ensure_patient_access(&state, &auth, body.patient_id).await {
        Ok(()) => {}
        Err(resp) => return resp,
    }

    let seq: i64 = match sqlx::query_scalar!("SELECT nextval('order_number_seq') AS \"v!\"")
        .fetch_one(&state.db)
        .await
    {
        Ok(v) => v,
        Err(e) => {
            tracing::error!(error = %e, "seq");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    let num = gen_order_number(seq);

    match sqlx::query!(
        "INSERT INTO orders (order_number, patient_id, contract_id, needs_description, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, order_number, created_at",
        num,
        body.patient_id,
        body.contract_id,
        body.needs_description,
        auth.user_id
    )
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'create_order', 'order', $2, $3)",
                auth.user_id, r.id, serde_json::json!({"order_number": r.order_number, "patient_id": body.patient_id})
            ).execute(&state.db).await;
            tracing::info!(by = %auth.user_id, order = %r.order_number, "Order created");
            (StatusCode::CREATED, Json(serde_json::json!({"id": r.id, "order_number": r.order_number, "created_at": r.created_at}))).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "create order");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn get_order(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }

    let order = match sqlx::query!(
        r#"SELECT o.*, p.first_name, p.last_name, p.patient_id AS p_pid
           FROM orders o JOIN patients p ON p.id = o.patient_id WHERE o.id = $1"#,
        order_id
    )
    .fetch_optional(&state.db)
    .await
    {
        Ok(Some(o)) => o,
        Ok(None) => return err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, "get order");
            return err(StatusCode::INTERNAL_SERVER_ERROR, "Failed");
        }
    };

    match can_access_order(&state, &auth, order.id, Some(order.patient_id)).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let leistungen = sqlx::query(
        r#"SELECT ol.id, ol.description, ol.quantity, ol.unit_price, ol.currency, ol.vat_rate,
                  ol.is_cost_passthrough, ol.status, ol.delivered_at, ol.approved_at, ol.notes,
                  ol.provider_id, ol.doctor_id,
                  pr.name AS provider_name, d.name AS doctor_name
           FROM order_leistungen ol
           LEFT JOIN providers pr ON pr.id = ol.provider_id
           LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
           WHERE ol.order_id = $1
           ORDER BY ol.created_at"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    .unwrap_or_default();

    let mut leist_json = Vec::new();
    for l in leistungen {
        leist_json.push(serde_json::json!({
            "id": l.try_get::<Uuid, _>("id").unwrap_or_default(),
            "description": l.try_get::<String, _>("description").unwrap_or_default(),
            "quantity": l.try_get::<rust_decimal::Decimal, _>("quantity").unwrap_or(rust_decimal::Decimal::ZERO),
            "unit_price": l.try_get::<rust_decimal::Decimal, _>("unit_price").unwrap_or(rust_decimal::Decimal::ZERO),
            "currency": l.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
            "vat_rate": l.try_get::<rust_decimal::Decimal, _>("vat_rate").unwrap_or(rust_decimal::Decimal::ZERO),
            "is_cost_passthrough": l.try_get::<bool, _>("is_cost_passthrough").unwrap_or(false),
            "status": l.try_get::<String, _>("status").unwrap_or_default(),
            "delivered_at": l.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("delivered_at").unwrap_or_default().map(|v| v.to_rfc3339()),
            "approved_at": l.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("approved_at").unwrap_or_default().map(|v| v.to_rfc3339()),
            "notes": l.try_get::<Option<String>, _>("notes").unwrap_or_default(),
            "provider_id": l.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
            "provider_name": l.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
            "doctor_id": l.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
            "doctor_name": l.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
        }));
    }

    Json(serde_json::json!({
        "id": order.id, "order_number": order.order_number,
        "patient_id": order.patient_id,
        "patient_name": format!("{} {}", order.first_name, order.last_name),
        "patient_pid": order.p_pid,
        "phase": order.phase, "status": order.status,
        "needs_description": order.needs_description,
        "signed_patient": order.signed_patient, "signed_agency": order.signed_agency,
        "total_estimated": order.total_estimated, "total_actual": order.total_actual,
        "leistungen": leist_json,
        "created_at": order.created_at, "updated_at": order.updated_at,
    }))
    .into_response()
}

async fn update_phase(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<PhaseRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match body.phase.as_str() {
        "discovery" => {}
        "intake" => {}
        "execution" => {}
        "closure" => {}
        "followup" => {}
        _ => return err(StatusCode::UNPROCESSABLE_ENTITY, "Invalid phase"),
    }

    match sqlx::query!(
        "UPDATE orders SET phase = $2 WHERE id = $1",
        order_id,
        body.phase
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => {
            let _ = sqlx::query!("INSERT INTO audit_log (user_id, action, entity_type, entity_id, context) VALUES ($1, 'update_phase', 'order', $2, $3)",
                auth.user_id, order_id, serde_json::json!({"phase": body.phase})
            ).execute(&state.db).await;
            Json(serde_json::json!({"ok": true})).into_response()
        }
        Ok(_) => err(StatusCode::NOT_FOUND, "Order not found"),
        Err(e) => {
            tracing::error!(error = %e, "update phase");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn list_leistungen(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager, Role::Billing]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query(
        r#"SELECT ol.id, ol.description, ol.quantity, ol.unit_price, ol.currency, ol.vat_rate,
                  ol.is_cost_passthrough, ol.status, ol.notes, ol.provider_id, ol.doctor_id,
                  pr.name AS provider_name, d.name AS doctor_name
           FROM order_leistungen ol
           LEFT JOIN providers pr ON pr.id = ol.provider_id
           LEFT JOIN provider_doctors d ON d.id = ol.doctor_id
           WHERE ol.order_id = $1
           ORDER BY ol.created_at"#,
    )
    .bind(order_id)
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) => {
            let mut items = Vec::with_capacity(rows.len());
            for r in rows {
                items.push(serde_json::json!({
                    "id": r.try_get::<Uuid, _>("id").unwrap_or_default(),
                    "description": r.try_get::<String, _>("description").unwrap_or_default(),
                    "quantity": r.try_get::<rust_decimal::Decimal, _>("quantity").unwrap_or(rust_decimal::Decimal::ZERO),
                    "unit_price": r.try_get::<rust_decimal::Decimal, _>("unit_price").unwrap_or(rust_decimal::Decimal::ZERO),
                    "currency": r.try_get::<String, _>("currency").unwrap_or_else(|_| "EUR".to_string()),
                    "vat_rate": r.try_get::<rust_decimal::Decimal, _>("vat_rate").unwrap_or(rust_decimal::Decimal::ZERO),
                    "is_cost_passthrough": r.try_get::<bool, _>("is_cost_passthrough").unwrap_or(false),
                    "status": r.try_get::<String, _>("status").unwrap_or_default(),
                    "notes": r.try_get::<Option<String>, _>("notes").unwrap_or_default(),
                    "provider_id": r.try_get::<Option<Uuid>, _>("provider_id").unwrap_or_default(),
                    "provider_name": r.try_get::<Option<String>, _>("provider_name").unwrap_or_default(),
                    "doctor_id": r.try_get::<Option<Uuid>, _>("doctor_id").unwrap_or_default(),
                    "doctor_name": r.try_get::<Option<String>, _>("doctor_name").unwrap_or_default(),
                }));
            }
            Json(items).into_response()
        }
        Err(e) => {
            tracing::error!(error = %e, "list leistungen");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn add_leistung(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path(order_id): Path<Uuid>,
    Json(body): Json<AddLeistungRequest>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    let vat = rust_decimal::Decimal::try_from(body.vat_rate.unwrap_or(19.0))
        .unwrap_or(rust_decimal::Decimal::new(19, 0));
    let qty = rust_decimal::Decimal::try_from(body.quantity).unwrap_or(rust_decimal::Decimal::ONE);
    let price =
        rust_decimal::Decimal::try_from(body.unit_price).unwrap_or(rust_decimal::Decimal::ZERO);
    let passthrough = body.is_cost_passthrough.unwrap_or(false);
    if let Err(resp) =
        validate_provider_doctor_context(&state, body.provider_id, body.doctor_id).await
    {
        return resp;
    }

    match sqlx::query(
        "INSERT INTO order_leistungen (order_id, description, quantity, unit_price, vat_rate, is_cost_passthrough, provider_id, doctor_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id",
    )
    .bind(order_id)
    .bind(body.description)
    .bind(qty)
    .bind(price)
    .bind(vat)
    .bind(passthrough)
    .bind(body.provider_id)
    .bind(body.doctor_id)
    .bind(body.notes)
    .fetch_one(&state.db)
    .await
    {
        Ok(r) => {
            let id: Uuid = r.try_get("id").unwrap_or_default();
            (StatusCode::CREATED, Json(serde_json::json!({"id": id}))).into_response()
        }
        Err(e) => { tracing::error!(error = %e, "add leistung"); err(StatusCode::INTERNAL_SERVER_ERROR, "Failed") }
    }
}

async fn approve_leistung(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthUser>,
    Path((order_id, leistung_id)): Path<(Uuid, Uuid)>,
) -> axum::response::Response {
    if let Err(e) = auth.require_any_role(&[Role::PatientManager]) {
        return e;
    }
    match can_access_order(&state, &auth, order_id, None).await {
        Ok(true) => {}
        Ok(false) => return err(StatusCode::FORBIDDEN, "Insufficient permissions"),
        Err(resp) => return resp,
    }

    match sqlx::query!(
        "UPDATE order_leistungen SET status = 'approved', approved_by = $3, approved_at = now()
         WHERE id = $2 AND order_id = $1 AND status = 'delivered'",
        order_id,
        leistung_id,
        auth.user_id
    )
    .execute(&state.db)
    .await
    {
        Ok(r) if r.rows_affected() > 0 => Json(serde_json::json!({"ok": true})).into_response(),
        Ok(_) => err(
            StatusCode::NOT_FOUND,
            "Leistung not found or not in delivered status",
        ),
        Err(e) => {
            tracing::error!(error = %e, "approve leistung");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed")
        }
    }
}

async fn validate_provider_doctor_context(
    state: &AppState,
    provider_id: Option<Uuid>,
    doctor_id: Option<Uuid>,
) -> Result<(), axum::response::Response> {
    match (provider_id, doctor_id) {
        (None, Some(_)) => Err(err(
            StatusCode::UNPROCESSABLE_ENTITY,
            "doctor_id requires provider_id",
        )),
        (Some(provider_id), Some(doctor_id)) => {
            let row = sqlx::query("SELECT id FROM provider_doctors WHERE provider_id = $1 AND id = $2")
                .bind(provider_id)
                .bind(doctor_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, provider_id = %provider_id, doctor_id = %doctor_id, "Failed to validate provider doctor");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate provider doctor")
                })?;

            if row.is_some() {
                Ok(())
            } else {
                Err(err(
                    StatusCode::UNPROCESSABLE_ENTITY,
                    "Doctor does not belong to provider",
                ))
            }
        }
        (Some(provider_id), None) => {
            let row = sqlx::query("SELECT id FROM providers WHERE id = $1")
                .bind(provider_id)
                .fetch_optional(&state.db)
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, provider_id = %provider_id, "Failed to validate provider");
                    err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate provider")
                })?;

            if row.is_some() {
                Ok(())
            } else {
                Err(err(StatusCode::UNPROCESSABLE_ENTITY, "Provider not found"))
            }
        }
        (None, None) => Ok(()),
    }
}

fn err(status: StatusCode, message: &str) -> axum::response::Response {
    (status, Json(serde_json::json!({ "error": status.canonical_reason().unwrap_or("error"), "message": message }))).into_response()
}

async fn ensure_patient_access(
    state: &AppState,
    auth: &AuthUser,
    patient_id: Uuid,
) -> Result<(), axum::response::Response> {
    if auth.role == Role::Ceo {
        return Ok(());
    }

    let assigned = access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate patient assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate patient access")
        })?;

    if assigned {
        Ok(())
    } else {
        Err(err(StatusCode::FORBIDDEN, "Insufficient permissions"))
    }
}

async fn can_access_order(
    state: &AppState,
    auth: &AuthUser,
    order_id: Uuid,
    patient_id: Option<Uuid>,
) -> Result<bool, axum::response::Response> {
    if matches!(auth.role, Role::Ceo | Role::Billing) {
        return Ok(true);
    }

    let Some(patient_id) = patient_id else {
        let row = sqlx::query("SELECT patient_id FROM orders WHERE id = $1")
            .bind(order_id)
            .fetch_optional(&state.db)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %order_id, "Failed to load order access context");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order access")
            })?;

        let Some(row) = row else {
            return Ok(false);
        };

        let patient_id: Uuid = row.try_get("patient_id").map_err(|_| {
            err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to decode order access context",
            )
        })?;

        return access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
            .await
            .map_err(|e| {
                tracing::error!(error = %e, order_id = %order_id, "Failed to validate order assignment");
                err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order access")
            });
    };

    access::has_active_patient_assignment(&state.db, patient_id, auth.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, patient_id = %patient_id, "Failed to validate order assignment");
            err(StatusCode::INTERNAL_SERVER_ERROR, "Failed to validate order access")
        })
}
